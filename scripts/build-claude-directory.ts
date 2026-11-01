import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createOwnedRun } from "../packages/mcp/test/support/owned-temp.ts";
import { ALLOWED_SDK_MODULES, bundleOptions } from "./bundle-config.ts";
import { byPath, checkedOutCommit, sourceCommit } from "./claude-directory-provenance.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const ownedRun = check ? createOwnedRun() : null;
const outDir = ownedRun === null ? join(root, "dist", "claude-directory") : ownedRun.mkdir("claude-directory");
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 512;
const EXPECTED_TOOLS = [
  "assess_vault_readiness",
  "check_invariants",
  "inspect_evidence",
  "normalize_observation",
  "resolve_asset",
  "trace_provenance",
] as const;
const AJV_STUB = `export class AjvJsonSchemaValidator {
  getValidator() {
    throw new Error("SDK JSON Schema validation is disabled in the WalletWall Claude Directory package.");
  }
}
`;
const AJV_PROVIDER = "dist/esm/validation/ajv-provider.js";
// A clone of the distribution must keep the exact bytes PROVENANCE.json records; core.autocrlf=true would otherwise
// rewrite every text file to CRLF on checkout and fail the size and SHA-512 checks.
const GITATTRIBUTES = "* -text\n";
const isLicense = (rel: string): boolean => /^LICENSE(?:\.|$)/i.test(rel);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function copyStatic(): void {
  cpSync(join(root, "plugin", ".claude-plugin"), join(outDir, ".claude-plugin"), { recursive: true });
  cpSync(join(root, "plugin", ".mcp.json"), join(outDir, ".mcp.json"));
  cpSync(join(root, "plugin", "skills"), join(outDir, "skills"), { recursive: true });
  cpSync(join(root, "LICENSE"), join(outDir, "LICENSE"));
  cpSync(join(root, "docs", "CLAUDE_DIRECTORY_README.md"), join(outDir, "README.md"));
  writeFileSync(join(outDir, ".gitattributes"), GITATTRIBUTES);
}

function copyRuntimeTree(source: string, destination: string, include: (relativePath: string) => boolean): void {
  for (const path of walk(source)) {
    const rel = relative(source, path).replace(/\\/g, "/");
    if (!include(rel)) continue;
    const target = join(destination, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(path, target);
  }
}

/**
 * The MCP SDK modules the server can load: the module graph of the multi-host plugin bundle (same entry point, Ajv
 * replaced by the stub), held to that bundle's stdio-only allowlist. Client, auth, SSE, Streamable HTTP and example
 * modules stay out.
 */
async function reachableSdkModules(): Promise<Set<string>> {
  const { metafile } = await build(bundleOptions(root));
  const modules = Object.keys(metafile.inputs).flatMap((path) => /node_modules\/@modelcontextprotocol\/sdk\/dist\/esm\/(.+)$/.exec(path.replace(/\\/g, "/"))?.[1] ?? []);
  const unexpected = modules.filter((module) => !ALLOWED_SDK_MODULES.includes(module));
  if (unexpected.length > 0) throw new Error(`MCP SDK modules outside the stdio allowlist: ${unexpected.join(", ")}`);
  for (const required of ["server/index.js", "server/stdio.js"]) if (!modules.includes(required)) throw new Error(`MCP SDK module graph lacks ${required}`);
  return new Set(modules.map((module) => `dist/esm/${module}`));
}

function vendorRuntimeDependencies(sdkModules: ReadonlySet<string>): void {
  const sdkSource = join(root, "node_modules", "@modelcontextprotocol", "sdk");
  const sdkTarget = join(outDir, "node_modules", "@modelcontextprotocol", "sdk");
  copyRuntimeTree(sdkSource, sdkTarget, (rel) => rel === "package.json" || isLicense(rel) || rel === AJV_PROVIDER || sdkModules.has(rel));
  const ajvProvider = join(sdkTarget, ...AJV_PROVIDER.split("/"));
  if (!statSync(ajvProvider).isFile()) throw new Error("vendored MCP SDK is missing validation/ajv-provider.js");
  writeFileSync(ajvProvider, AJV_STUB);

  const zodSource = join(root, "node_modules", "zod");
  const zodTarget = join(outDir, "node_modules", "zod");
  copyRuntimeTree(zodSource, zodTarget, (rel) => rel === "package.json" || isLicense(rel) || rel.endsWith(".js"));

  const zodToJsonSource = join(root, "node_modules", "zod-to-json-schema");
  const zodToJsonTarget = join(outDir, "node_modules", "zod-to-json-schema");
  copyRuntimeTree(zodToJsonSource, zodToJsonTarget, (rel) => rel === "package.json" || isLicense(rel) || rel.endsWith(".js") || rel.endsWith(".mjs"));
}

function validatePackage(): { files: number; largest: string; largestBytes: number } {
  const files = walk(outDir);
  if (files.length > MAX_FILES) throw new Error(`Claude Directory package has ${files.length} files; maximum is ${MAX_FILES}`);

  let largest = "";
  let largestBytes = 0;
  const oversized: string[] = [];
  for (const path of files) {
    const rel = relative(outDir, path).replace(/\\/g, "/");
    const bytes = statSync(path).size;
    if (bytes > largestBytes) {
      largest = rel;
      largestBytes = bytes;
    }
    if (bytes > MAX_FILE_BYTES && !/\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(rel)) {
      oversized.push(`${rel} (${bytes} bytes)`);
    }
  }
  if (oversized.length > 0) throw new Error(`Claude Directory non-media files exceed ${MAX_FILE_BYTES} bytes:\n${oversized.join("\n")}`);

  const sdkDir = join(outDir, "node_modules", "@modelcontextprotocol", "sdk");
  const allowedSdkModules = new Set(ALLOWED_SDK_MODULES.map((module) => `dist/esm/${module}`));
  const strays = walk(sdkDir)
    .map((path) => relative(sdkDir, path).replace(/\\/g, "/"))
    .filter((rel) => rel !== "package.json" && !isLicense(rel) && rel !== AJV_PROVIDER && !allowedSdkModules.has(rel));
  if (strays.length > 0) throw new Error(`vendored MCP SDK holds files outside the stdio allowlist:\n${strays.join("\n")}`);

  return { files: files.length, largest, largestBytes };
}

async function smokeArtifact(): Promise<void> {
  const entry = join(outDir, "server", "walletwall-mcp.mjs");
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 8192) stderr += chunk.toString("utf8");
  });
  const client = new Client({ name: "claude-directory-build-smoke", version: "0" });
  try {
    await client.connect(transport);
    const version = client.getServerVersion();
    if (version?.name !== "walletwall-mcp") throw new Error(`unexpected generated server name: ${version?.name ?? "missing"}`);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
      throw new Error(`generated Claude Directory tool set changed: ${names.join(", ")}`);
    }
  } catch (error) {
    const detail = stderr.trim();
    if (detail !== "") throw new Error(`generated Claude Directory server failed to start:\n${detail}`, { cause: error });
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

try {
  const commit = sourceCommit(process.env, () => checkedOutCommit(root));
  if (!check) {
    if (existsSync(outDir)) throw new Error("dist/claude-directory already exists; remove that generated output explicitly before rebuilding");
    mkdirSync(outDir, { recursive: true });
  }

  copyStatic();
  const sdkModules = await reachableSdkModules();
  vendorRuntimeDependencies(sdkModules);

  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/mcp/src/main.ts"],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(outDir, "server", "walletwall-mcp.mjs"),
    legalComments: "none",
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
  });

  const files = walk(outDir)
    .map((path) => ({
      path: relative(outDir, path).replace(/\\/g, "/"),
      bytes: statSync(path).size,
      sha512: createHash("sha512").update(readFileSync(path)).digest("hex"),
    }))
    .sort(byPath);
  writeFileSync(
    join(outDir, "PROVENANCE.json"),
    `${JSON.stringify({ schemaVersion: "1", sourceRepository: "Wallet-Wall/walletwall-copilot", sourceCommit: commit, files }, null, 2)}\n`,
  );

  const summary = validatePackage();
  await smokeArtifact();
  console.log(`Claude Directory package: ${summary.files} files; largest ${summary.largest} ${summary.largestBytes} bytes`);
  console.log(`esbuild outputs: ${Object.keys(result.metafile.outputs).length}; vendored MCP SDK modules: ${sdkModules.size} + Ajv stub; generated server smoke: ${EXPECTED_TOOLS.length} tools`);
} finally {
  ownedRun?.dispose();
}
