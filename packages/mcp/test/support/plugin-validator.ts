import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PROHIBITED_CLAIMS } from "./claims.ts";

export interface Finding {
  file: string;
  problem: string;
}

const NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const PLUGIN_ALLOWED = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);
const CLAUDE_PLUGIN_ALLOWED = new Set(["name", "version", "description", "author", "homepage", "repository", "license", "keywords"]);

function validName(n: unknown, max: number): boolean {
  return typeof n === "string" && n.length >= 1 && n.length <= max && NAME_RE.test(n) && !n.includes("--") && !n.includes("..");
}

/** Structural validation of the shared WalletWall plugin directory: Agent Plugins 1.0.0 plus the Claude plugin envelope. */
export function validatePluginDir(dir: string, repoRoot: string): Finding[] {
  const out: Finding[] = [];
  const add = (file: string, problem: string): void => {
    out.push({ file, problem });
  };
  const readJson = (file: string): Record<string, unknown> | undefined => {
    try {
      const v: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        add(file, "must be a JSON object");
        return undefined;
      }
      return v as Record<string, unknown>;
    } catch {
      add(file, "missing or not valid JSON");
      return undefined;
    }
  };

  const manifest = readJson("plugin.json");
  if (manifest) {
    if (manifest["$schema"] !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") add("plugin.json", "$schema must be the Agent Plugins 1.0.0 plugin schema");
    if (!validName(manifest["name"], 64)) add("plugin.json", "name violates the Agent Plugins name constraints");
    for (const k of Object.keys(manifest)) if (!PLUGIN_ALLOWED.has(k)) add("plugin.json", `unknown top-level field ${k}`);
    for (const k of ["version", "description", "homepage", "repository", "license"]) {
      if (manifest[k] !== undefined && typeof manifest[k] !== "string") add("plugin.json", `${k} must be a string`);
    }
    const author = manifest["author"];
    if (author !== undefined) {
      if (author === null || typeof author !== "object") add("plugin.json", "author must be an object");
      else for (const [k, v] of Object.entries(author)) if (!["name", "email", "url"].includes(k) || typeof v !== "string") add("plugin.json", `author.${k} invalid`);
    }
    if (manifest["keywords"] !== undefined && !(Array.isArray(manifest["keywords"]) && manifest["keywords"].every((x) => typeof x === "string"))) {
      add("plugin.json", "keywords must be string[]");
    }
    if (typeof manifest["description"] === "string" && PROHIBITED_CLAIMS.test(manifest["description"])) {
      add("plugin.json", "description makes a prohibited claim");
    }
  }

  const mcp = readJson("mcp.json");
  if (mcp) {
    if (mcp["$schema"] !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json") add("mcp.json", "$schema must be the Agent Plugins 1.0.0 mcp schema");
    for (const k of Object.keys(mcp)) if (!["$schema", "mcpServers"].includes(k)) add("mcp.json", `unknown top-level field ${k}`);
    const servers = mcp["mcpServers"];
    if (servers === null || typeof servers !== "object" || Array.isArray(servers)) add("mcp.json", "mcpServers must be an object");
    else {
      for (const [name, s] of Object.entries(servers as Record<string, unknown>)) {
        const server = s as Record<string, unknown>;
        const allowed = ["type", "command", "args", "env", "cwd"];
        if (server["type"] !== "stdio") add("mcp.json", `${name}: type must be stdio`);
        if (typeof server["command"] !== "string" || /\s/.test(server["command"]) || !/^(\.\/[^\s]+|[A-Za-z0-9._-]+)$/.test(server["command"])) {
          add("mcp.json", `${name}: command must be one bare executable token or ./relative path`);
        }
        for (const k of Object.keys(server)) if (!allowed.includes(k)) add("mcp.json", `${name}: unknown field ${k}`);
        if (server["args"] !== undefined && !(Array.isArray(server["args"]) && server["args"].every((a) => typeof a === "string"))) add("mcp.json", `${name}: args must be string[]`);
        if (server["env"] !== undefined) add("mcp.json", `${name}: env must not be set (no credentials or configuration are passed)`);
        const args = (server["args"] as string[] | undefined) ?? [];
        for (const a of args) {
          const m = /^\$\{PLUGIN_ROOT\}\/(.+)$/.exec(a);
          if (m?.[1] !== undefined && !existsSync(join(dir, m[1]))) add("mcp.json", `${name}: argument points at a missing file ${m[1]}`);
        }
      }
    }
  }

  const claudeManifest = readJson(".claude-plugin/plugin.json");
  if (claudeManifest) {
    if (claudeManifest["name"] !== "walletwall") add(".claude-plugin/plugin.json", "name must be walletwall");
    if (typeof claudeManifest["version"] !== "string" || !/^\d+\.\d+\.\d+$/.test(claudeManifest["version"])) add(".claude-plugin/plugin.json", "version must be semver");
    for (const k of Object.keys(claudeManifest)) if (!CLAUDE_PLUGIN_ALLOWED.has(k)) add(".claude-plugin/plugin.json", `unknown top-level field ${k}`);
    for (const k of ["description", "homepage", "repository", "license"]) {
      if (claudeManifest[k] !== undefined && typeof claudeManifest[k] !== "string") add(".claude-plugin/plugin.json", `${k} must be a string`);
    }
    const author = claudeManifest["author"];
    if (author !== undefined) {
      if (author === null || typeof author !== "object" || Array.isArray(author)) add(".claude-plugin/plugin.json", "author must be an object");
      else for (const [k, v] of Object.entries(author)) if (!["name", "email", "url"].includes(k) || typeof v !== "string") add(".claude-plugin/plugin.json", `author.${k} invalid`);
    }
    if (claudeManifest["keywords"] !== undefined && !(Array.isArray(claudeManifest["keywords"]) && claudeManifest["keywords"].every((x) => typeof x === "string"))) {
      add(".claude-plugin/plugin.json", "keywords must be string[]");
    }
    if (typeof claudeManifest["description"] === "string" && PROHIBITED_CLAIMS.test(claudeManifest["description"])) {
      add(".claude-plugin/plugin.json", "description makes a prohibited claim");
    }
  }

  const claudeMcp = readJson(".mcp.json");
  if (claudeMcp) {
    if (Object.keys(claudeMcp).length !== 1 || claudeMcp["mcpServers"] === undefined) add(".mcp.json", "must contain only mcpServers");
    const servers = claudeMcp["mcpServers"];
    if (servers === null || typeof servers !== "object" || Array.isArray(servers)) add(".mcp.json", "mcpServers must be an object");
    else {
      const entries = Object.entries(servers as Record<string, unknown>);
      if (entries.length !== 1 || entries[0]?.[0] !== "walletwall") add(".mcp.json", "must expose exactly one server named walletwall");
      const raw = (servers as Record<string, unknown>)["walletwall"];
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) add(".mcp.json", "walletwall server must be an object");
      else {
        const server = raw as Record<string, unknown>;
        if (Object.keys(server).some((k) => !["command", "args"].includes(k))) add(".mcp.json", "walletwall server may contain only command and args");
        if (server["command"] !== "node") add(".mcp.json", "walletwall command must be node");
        if (!Array.isArray(server["args"]) || server["args"].length !== 1 || server["args"][0] !== "${CLAUDE_PLUGIN_ROOT}/server/walletwall-mcp.mjs") {
          add(".mcp.json", "walletwall args must be exactly the Claude plugin-root server path");
        }
        if (!existsSync(join(dir, "server", "walletwall-mcp.mjs"))) add(".mcp.json", "walletwall argument points at a missing server file");
      }
    }
  }

  const skillsDir = join(dir, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, entry, "SKILL.md");
      if (!statSync(join(skillsDir, entry)).isDirectory()) continue;
      if (!existsSync(skillFile)) {
        add(`skills/${entry}`, "directory has no SKILL.md");
        continue;
      }
      const text = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
      if (!fm?.[1]) {
        add(`skills/${entry}/SKILL.md`, "missing YAML frontmatter");
        continue;
      }
      const nameLine = /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();
      const descLine = /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();
      if (nameLine !== entry || !validName(nameLine, 64) || (nameLine ?? "").includes(".")) add(`skills/${entry}/SKILL.md`, "name must equal the directory name and be a valid skill name");
      if (!descLine || descLine.length > 1024) add(`skills/${entry}/SKILL.md`, "description missing or longer than 1024 characters");
    }
  } else {
    add("skills", "no skills directory");
  }

  const bundle = join(dir, "server", "walletwall-mcp.mjs");
  if (!existsSync(bundle)) add("server/walletwall-mcp.mjs", "bundled server is missing; run npm run build:bundle");
  else {
    const sha = createHash("sha256").update(readFileSync(bundle, "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
    const recorded = readFileSync(join(repoRoot, "security", "bundle.sha256"), "utf8").trim();
    if (recorded !== `${sha}  plugin/server/walletwall-mcp.mjs`) add("server/walletwall-mcp.mjs", "does not match security/bundle.sha256");
  }

  const forbidden = ["hooks.json", "agents", "lsp.json", ".github"];
  for (const f of forbidden) if (existsSync(join(dir, f))) add(f, "is not part of the plugin (no hooks, agents or remote configuration)");
  validateCopilotDir(dir, add);
  return out;
}

const EXTENSION_FILES = new Set(["extension.mjs", "explorer.mjs", "mcp-client.mjs", "render.mjs", "wall.mjs", "coinstellation-model.mjs", "styles.mjs", "client.mjs", "brand.mjs", "fixtures.mjs", "copilot-extension.json"]);

/** `com.github.copilot/` may hold canvas extensions only: no hooks, agents, commands, rules or LSP servers. */
function validateCopilotDir(dir: string, add: (file: string, problem: string) => void): void {
  const cg = join(dir, "com.github.copilot");
  if (!existsSync(cg)) return;
  for (const entry of readdirSync(cg)) {
    if (entry !== "extensions") add(`com.github.copilot/${entry}`, "only extensions/ is allowed (no hooks, agents, commands, rules or LSP servers)");
  }
  const extRoot = join(cg, "extensions");
  if (!existsSync(extRoot)) return;
  for (const name of readdirSync(extRoot)) {
    const base = `com.github.copilot/extensions/${name}`;
    const extDir = join(extRoot, name);
    if (!statSync(extDir).isDirectory()) {
      add(base, "must be an extension directory");
      continue;
    }
    if (!validName(name, 64)) add(base, "extension directory name is not a valid name");
    for (const f of readdirSync(extDir)) {
      if (!EXTENSION_FILES.has(f)) add(`${base}/${f}`, "is not an expected extension file (no package.json, node_modules or other payload)");
    }
    if (!existsSync(join(extDir, "extension.mjs"))) add(`${base}/extension.mjs`, "entry point is missing");
    try {
      const meta: unknown = JSON.parse(readFileSync(join(extDir, "copilot-extension.json"), "utf8"));
      const m = meta as { name?: unknown; version?: unknown };
      if (m.name !== name || m.version !== 1 || Object.keys(meta as object).length !== 2) add(`${base}/copilot-extension.json`, "must be exactly { name: <directory name>, version: 1 }");
    } catch {
      add(`${base}/copilot-extension.json`, "missing or not valid JSON");
    }
  }
}
