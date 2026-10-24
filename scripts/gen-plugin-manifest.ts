import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256Hex } from "../packages/mcp/src/canonical.ts";
import { POLICIES_VERSION, REGISTRY_VERSION, RULES_VERSION } from "../packages/mcp/src/registry.ts";
import { WWEP_VERSION } from "../packages/mcp/src/schemas.ts";
import { ENGINE_NAME, ENGINE_VERSION } from "../packages/mcp/src/version.ts";

/**
 * A deterministic digest of everything the Copilot plugin ships: every file under plugin/ with its SHA-256 (line endings
 * normalized), the launch command, the declared components and the data versions, plus the digest of the MCP tool manifest.
 * Any change to a plugin file, tool schema or data version changes this digest and must appear in the diff.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const pluginDir = `${root}plugin`;
const outPath = `${root}security/plugin-manifest.json`;
const shaPath = `${root}security/plugin-manifest.sha256`;

const norm = (s: string): string => s.replace(/\r\n/g, "\n");

function list(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, base)).sort()) {
    const rel = base === "" ? name : `${base}/${name}`;
    if (statSync(join(dir, rel)).isDirectory()) out.push(...list(dir, rel));
    else out.push(rel);
  }
  return out;
}

const readText = (rel: string): string => norm(readFileSync(`${pluginDir}/${rel}`, "utf8"));
const pluginJson = JSON.parse(readText("plugin.json")) as { name: string; version: string; $schema: string };
const mcpJson = JSON.parse(readText("mcp.json")) as { mcpServers: Record<string, { type: string; command: string; args: string[] }> };
const toolManifestHash = readFileSync(`${root}security/tool-manifest.sha256`, "utf8").split(/\s+/)[0];
const bundleHash = readFileSync(`${root}security/bundle.sha256`, "utf8").split(/\s+/)[0];

const files = list(pluginDir).map((path) => ({ path: `plugin/${path}`, sha256: sha256Hex(readText(path)), bytes: Buffer.byteLength(readText(path), "utf8") }));
const extDirs = readdirSync(`${pluginDir}/com.github.copilot/extensions`).sort();

const manifest = {
  manifestVersion: "1",
  plugin: { name: pluginJson.name, version: pluginJson.version, format: "Agent Plugins 1.0.0", schema: pluginJson.$schema },
  versions: { engine: `${ENGINE_NAME}@${ENGINE_VERSION}`, wwep: WWEP_VERSION, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION },
  mcpServers: Object.fromEntries(Object.entries(mcpJson.mcpServers).map(([name, s]) => [name, { type: s.type, command: s.command, args: s.args }])),
  canvasExtensions: extDirs,
  skills: readdirSync(`${pluginDir}/skills`).sort(),
  toolManifestSha256: toolManifestHash,
  serverBundleSha256: bundleHash,
  files,
};

const pretty = `${JSON.stringify(manifest, null, 2)}\n`;
const digest = sha256Hex(canonicalize(JSON.parse(pretty), { numbers: "jcs" }));
const shaLine = `${digest}  security/plugin-manifest.json (RFC 8785 canonical form, SHA-256)\n`;

if (process.argv.includes("--check")) {
  let curManifest = "";
  let curSha = "";
  try {
    curManifest = norm(readFileSync(outPath, "utf8"));
    curSha = norm(readFileSync(shaPath, "utf8"));
  } catch {
    // reported below
  }
  if (curManifest !== pretty || curSha !== shaLine) {
    console.error("Plugin contents changed. security/plugin-manifest.json or .sha256 differs from plugin/.");
    console.error("Review the diff, then run: npm run gen:plugin-manifest");
    process.exit(1);
  }
  console.log(`plugin manifest verified: sha256 ${digest}`);
} else {
  writeFileSync(outPath, pretty);
  writeFileSync(shaPath, shaLine);
  console.log(`wrote security/plugin-manifest.json; sha256 ${digest}`);
}
