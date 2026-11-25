import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { INTEGRITY_POLICY } from "./integrity-policy.ts";

/**
 * The Directory listing icon is metadata for the generated Claude Directory package only. The shared `plugin/` manifest
 * does not declare it (it does not ship the file), so `claude --plugin-dir ./plugin` never sees a dangling reference;
 * the generator adds the key when it copies the file. The key goes right after `keywords` (or last), and the result is
 * plain two-space JSON, so the output depends only on the input.
 */
export function withDirectoryIcon(manifestJson: string, iconPath: string): string {
  const source = JSON.parse(manifestJson) as Record<string, unknown>;
  if ("icon" in source) throw new Error("the shared plugin/.claude-plugin/plugin.json must not declare icon; the Claude Directory generator adds it");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value;
    if (key === "keywords") out["icon"] = iconPath;
  }
  if (!("icon" in out)) out["icon"] = iconPath;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Every file a plugin's manifests reference, checked against the package it would be installed from: `./` paths in
 * `.claude-plugin/plugin.json` and `plugin.json` (the icon, and any component path), and `${CLAUDE_PLUGIN_ROOT}/` or
 * `${PLUGIN_ROOT}/` paths in the command and arguments of `.mcp.json` and `mcp.json` servers. Returns one problem per
 * reference that does not name an existing file or directory inside the package (an empty list means all resolve).
 */
export function unresolvedManifestReferences(packageRoot: string): string[] {
  const root = realpathSync(packageRoot);
  const problems: string[] = [];
  const check = (where: string, reference: string, relativePath: string): void => {
    const target = resolve(root, relativePath);
    const inside = target === root || target.startsWith(`${root}${sep}`);
    if (!inside) problems.push(`${where} ${JSON.stringify(reference)} points outside the package`);
    else if (!existsSync(target)) problems.push(`${where} ${JSON.stringify(reference)} is not a file in the package`);
  };
  const strings = (value: unknown, at: string): [string, string][] => {
    if (typeof value === "string") return [[at, value]];
    if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}[${i}]`));
    if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, at === "" ? k : `${at}.${k}`));
    return [];
  };
  for (const manifest of [".claude-plugin/plugin.json", "plugin.json"]) {
    const path = join(root, ...manifest.split("/"));
    if (!existsSync(path)) continue;
    for (const [at, value] of strings(JSON.parse(readFileSync(path, "utf8")), "")) {
      if (value.startsWith("./") || value.startsWith("../")) check(`${manifest} ${at}`, value, value);
    }
  }
  for (const config of [".mcp.json", "mcp.json"]) {
    const path = join(root, config);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const servers = (parsed["mcpServers"] ?? parsed) as Record<string, { command?: unknown; args?: unknown }>;
    for (const [name, server] of Object.entries(servers)) {
      for (const [at, value] of strings({ command: server.command, args: server.args }, "")) {
        const m = /^\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}\/(.*)$/.exec(value);
        if (m) check(`${config} ${name}.${at}`, value, m[1] ?? "");
      }
    }
  }
  return problems;
}

/**
 * Skill text that only applies to another host (today: the Copilot canvas) sits between these markers in the shared
 * `plugin/skills/` files. The Claude Directory build removes each such section, markers included; the multi-host
 * `plugin/` package keeps it.
 */
export const COPILOT_ONLY_START = "<!-- copilot-only:start -->";
export const COPILOT_ONLY_END = "<!-- copilot-only:end -->";

/** Remove every copilot-only section. Unbalanced or nested markers throw, so half a section can never ship. */
export function stripCopilotOnly(text: string): { text: string; removed: number } {
  let out = "";
  let rest = text;
  let removed = 0;
  for (;;) {
    const start = rest.indexOf(COPILOT_ONLY_START);
    const end = rest.indexOf(COPILOT_ONLY_END);
    if (start < 0 && end < 0) return { text: out + rest, removed };
    if (start < 0 || (end >= 0 && end < start)) throw new Error("a copilot-only end marker has no start marker before it");
    if (end < 0) throw new Error("a copilot-only start marker has no end marker after it");
    const nested = rest.indexOf(COPILOT_ONLY_START, start + COPILOT_ONLY_START.length);
    if (nested >= 0 && nested < end) throw new Error("copilot-only sections cannot be nested");
    out += rest.slice(0, start);
    rest = rest.slice(end + COPILOT_ONLY_END.length);
    // Drop the end marker's own line break, and one more where the section stood between two blank lines, so the
    // surrounding text keeps a single blank line.
    rest = rest.replace(/^\r?\n/, "");
    if (/(?:\r?\n){2}$/.test(out)) rest = rest.replace(/^\r?\n/, "");
    removed += 1;
  }
}

/** The npm packages the Claude Directory package vendors under `node_modules/`: the server's only runtime dependencies. */
export const VENDORED_PACKAGES = ["@modelcontextprotocol/sdk", "zod", "zod-to-json-schema"] as const;
export type VendoredPackage = (typeof VENDORED_PACKAGES)[number];

/**
 * The files of each vendored package that the server can load, read from the input paths of an esbuild metafile of the
 * server's module graph: the package-relative path of every module the graph reaches. Inputs outside `node_modules/`
 * (WalletWall's own source, a build plugin's stub namespace) are not package files and are skipped. An input from any
 * other package throws, because the Claude Directory package would not contain it. Only the graph decides, so a file
 * that no import resolves to (for example zod-to-json-schema's CommonJS build) is never selected.
 */
export function vendoredModuleSelection(graphInputs: readonly string[]): Record<VendoredPackage, Set<string>> {
  const selection = Object.fromEntries(VENDORED_PACKAGES.map((name) => [name, new Set<string>()])) as Record<VendoredPackage, Set<string>>;
  const strays: string[] = [];
  for (const input of graphInputs) {
    const path = input.replaceAll("\\", "/");
    const match = /^(?:.*?\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(path);
    if (match === null) continue;
    const name = match[1] ?? "";
    const rel = match[2] ?? "";
    if ((VENDORED_PACKAGES as readonly string[]).includes(name)) selection[name as VendoredPackage].add(rel);
    else strays.push(path);
  }
  if (strays.length > 0) throw new Error(`the server's module graph reaches packages the Claude Directory package does not vendor:\n${strays.join("\n")}`);
  return selection;
}

/** The directory's listing-icon rule, as `claude plugin validate` states it: a square PNG, 512 to 2048 px a side, under 2 MB. */
export const ICON_MIN_SIDE = 512;
export const ICON_MAX_SIDE = 2048;
export const ICON_MAX_BYTES = 2_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DirectoryIconCheck {
  width: number;
  height: number;
  bytes: number;
  /** Digest under the current integrity algorithm (security/integrity-policy.json), compared with the record's `sha512`. */
  digest: string;
  problems: string[];
}

export function checkDirectoryIcon(png: Buffer): DirectoryIconCheck {
  const isPng = png.length >= 24 && png.subarray(0, 8).equals(PNG_SIGNATURE) && png.toString("latin1", 12, 16) === "IHDR";
  const width = isPng ? png.readUInt32BE(16) : 0;
  const height = isPng ? png.readUInt32BE(20) : 0;
  const problems: string[] = [];
  if (!isPng) problems.push("not a PNG file");
  else {
    if (width !== height) problems.push(`not square (${width} x ${height} px)`);
    if (width < ICON_MIN_SIDE || width > ICON_MAX_SIDE) problems.push(`side of ${width} px is outside ${ICON_MIN_SIDE}..${ICON_MAX_SIDE}`);
  }
  if (png.length >= ICON_MAX_BYTES) problems.push(`${png.length} bytes is not under ${ICON_MAX_BYTES}`);
  return { width, height, bytes: png.length, digest: createHash(INTEGRITY_POLICY.currentAlgorithm).update(png).digest("hex"), problems };
}
