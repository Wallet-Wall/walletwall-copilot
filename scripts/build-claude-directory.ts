import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createOwnedRun } from "../packages/mcp/test/support/owned-temp.ts";
import { ALLOWED_SDK_MODULES, bundleOptions } from "./bundle-config.ts";
import {
  checkDirectoryIcon,
  dynamicImportLines,
  stripCopilotOnly,
  unresolvedManifestReferences,
  VENDORED_PACKAGES,
  type VendoredPackage,
  vendoredModuleSelection,
  withDirectoryIcon,
} from "./claude-directory-content.ts";
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
// The listing icon: one reviewed file, its digests pinned in a provenance record beside it.
const ICON_SOURCE = join(root, "docs", "claude-directory", "icon.png");
const ICON_RECORD = join(root, "docs", "claude-directory", "icon-provenance.json");
const ICON_PATH = "assets/icon.png";

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

/** Claude gets the shared skills without their Copilot-only sections (the canvas, which Claude hosts do not have). */
function stripCopilotOnlySkillSections(): number {
  let removed = 0;
  for (const path of walk(join(outDir, "skills"))) {
    if (!path.endsWith("SKILL.md")) continue;
    const original = readFileSync(path, "utf8");
    const stripped = stripCopilotOnly(original);
    if (/open_canvas|walletwall-evidence-explorer/.test(stripped.text)) {
      throw new Error(`${relative(outDir, path).replace(/\\/g, "/")} still refers to the Copilot canvas outside a copilot-only section`);
    }
    if (stripped.removed > 0) writeFileSync(path, stripped.text);
    removed += stripped.removed;
  }
  return removed;
}

/**
 * Copies the reviewed listing icon only if it is exactly the recorded file and meets the directory's icon rule, and adds
 * the `icon` key to the generated manifest. The shared plugin/ manifest never declares it: only this package ships the file.
 */
function copyDirectoryIcon(): ReturnType<typeof checkDirectoryIcon> {
  const bytes = readFileSync(ICON_SOURCE);
  const record = JSON.parse(readFileSync(ICON_RECORD, "utf8")) as { bytes: number; sha512: string; packagedAs: string };
  const icon = checkDirectoryIcon(bytes);
  if (icon.problems.length > 0) throw new Error(`Claude Directory icon fails the listing-icon rule: ${icon.problems.join("; ")}`);
  if (icon.bytes !== record.bytes || icon.digest !== record.sha512) {
    throw new Error("docs/claude-directory/icon.png is not the file recorded in docs/claude-directory/icon-provenance.json");
  }
  if (record.packagedAs !== ICON_PATH) throw new Error(`icon-provenance.json packagedAs must be ${ICON_PATH}`);
  const target = join(outDir, ...ICON_PATH.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  const manifest = join(outDir, ".claude-plugin", "plugin.json");
  writeFileSync(manifest, withDirectoryIcon(readFileSync(manifest, "utf8"), `./${ICON_PATH}`));
  return icon;
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

type RuntimeModules = Record<VendoredPackage, ReadonlySet<string>>;

/**
 * The files of each vendored package the server can load: the module graph of the multi-host plugin bundle (same entry
 * point, Ajv replaced by the stub). The SDK part is held to that bundle's stdio-only allowlist, so client, auth, SSE,
 * Streamable HTTP and example modules stay out. Zod and zod-to-json-schema ship exactly their graph modules as well, so
 * files that no import reaches (zod-to-json-schema's CommonJS build, Zod modules nothing imports) are not shipped.
 */
async function reachableRuntimeModules(): Promise<RuntimeModules> {
  const { metafile } = await build(bundleOptions(root));
  const modules = vendoredModuleSelection(Object.keys(metafile.inputs));
  const sdk = [...modules["@modelcontextprotocol/sdk"]].map((rel) => /^dist\/esm\/(.+)$/.exec(rel)?.[1] ?? rel);
  const unexpected = sdk.filter((module) => !ALLOWED_SDK_MODULES.includes(module));
  if (unexpected.length > 0) throw new Error(`MCP SDK modules outside the stdio allowlist: ${unexpected.join(", ")}`);
  for (const required of ["server/index.js", "server/stdio.js"]) if (!sdk.includes(required)) throw new Error(`MCP SDK module graph lacks ${required}`);
  for (const name of ["zod", "zod-to-json-schema"] as const) {
    if (modules[name].size === 0) throw new Error(`the server's module graph reaches no ${name} module`);
  }
  return modules;
}

function vendorRuntimeDependencies(modules: RuntimeModules): void {
  const sdkModules = modules["@modelcontextprotocol/sdk"];
  const sdkSource = join(root, "node_modules", "@modelcontextprotocol", "sdk");
  const sdkTarget = join(outDir, "node_modules", "@modelcontextprotocol", "sdk");
  copyRuntimeTree(sdkSource, sdkTarget, (rel) => rel === "package.json" || isLicense(rel) || rel === AJV_PROVIDER || sdkModules.has(rel));
  const ajvProvider = join(sdkTarget, ...AJV_PROVIDER.split("/"));
  if (!statSync(ajvProvider).isFile()) throw new Error("vendored MCP SDK is missing validation/ajv-provider.js");
  writeFileSync(ajvProvider, AJV_STUB);

  // Each package keeps its package.json (Node resolves the package through it) and its license; the code is exactly the
  // modules the server's module graph reaches.
  for (const name of ["zod", "zod-to-json-schema"] as const) {
    const graph = modules[name];
    copyRuntimeTree(join(root, "node_modules", name), join(outDir, "node_modules", name), (rel) => rel === "package.json" || isLicense(rel) || graph.has(rel));
  }
}

/**
 * Fails closed unless every vendored package holds its package.json, a license file and exactly the modules the server's
 * module graph reaches (plus the SDK's Ajv stub): no extra code file, and no reached module missing.
 */
function checkVendoredClosure(modules: RuntimeModules): void {
  for (const name of VENDORED_PACKAGES) {
    const dir = join(outDir, "node_modules", ...name.split("/"));
    const shipped = walk(dir).map((path) => relative(dir, path).replace(/\\/g, "/"));
    const allowedExtra = name === "@modelcontextprotocol/sdk" ? AJV_PROVIDER : undefined;
    const extra = shipped.filter((rel) => rel !== "package.json" && !isLicense(rel) && rel !== allowedExtra && !modules[name].has(rel));
    const missing = [...modules[name]].filter((rel) => !shipped.includes(rel));
    if (extra.length > 0) throw new Error(`vendored ${name} holds files outside the server's module graph:\n${extra.join("\n")}`);
    if (missing.length > 0) throw new Error(`vendored ${name} lacks modules the server's module graph reaches:\n${missing.join("\n")}`);
    if (!shipped.includes("package.json") || !shipped.some(isLicense)) throw new Error(`vendored ${name} lacks its package.json or license file`);
    // The selection is the static module graph: a dynamic import() or require() could load a file outside it at run time.
    const dynamic = shipped
      .filter((rel) => /\.(?:m|c)?js$/.test(rel))
      .flatMap((rel) => dynamicImportLines(readFileSync(join(dir, ...rel.split("/")), "utf8")).map((hit) => `${rel}:${hit}`));
    if (dynamic.length > 0) throw new Error(`vendored ${name} calls import() or require() outside a comment:\n${dynamic.join("\n")}`);
  }
}

function validatePackage(modules: RuntimeModules): { files: number; largest: string; largestBytes: number } {
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
  checkVendoredClosure(modules);

  const unresolved = unresolvedManifestReferences(outDir);
  if (unresolved.length > 0) throw new Error(`Claude Directory manifests reference files the package does not contain:\n${unresolved.join("\n")}`);
  const generatedManifest = JSON.parse(readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8")) as { icon?: unknown };
  if (generatedManifest.icon !== `./${ICON_PATH}`) throw new Error(`the generated .claude-plugin/plugin.json must name the listing icon as ./${ICON_PATH}`);

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
  const copilotOnlySections = stripCopilotOnlySkillSections();
  const icon = copyDirectoryIcon();
  const modules = await reachableRuntimeModules();
  vendorRuntimeDependencies(modules);

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

  const summary = validatePackage(modules);
  await smokeArtifact();
  console.log(`Claude Directory package: ${summary.files} files; largest ${summary.largest} ${summary.largestBytes} bytes`);
  console.log(`esbuild outputs: ${Object.keys(result.metafile.outputs).length}; generated server smoke: ${EXPECTED_TOOLS.length} tools`);
  console.log(
    `vendored modules from the server's module graph: @modelcontextprotocol/sdk ${modules["@modelcontextprotocol/sdk"].size} + Ajv stub, zod ${modules.zod.size}, zod-to-json-schema ${modules["zod-to-json-schema"].size}`,
  );
  console.log(`listing icon: ${ICON_PATH} ${icon.width}x${icon.height} PNG ${icon.bytes} bytes sha512 ${icon.digest}; copilot-only skill sections removed: ${copilotOnlySections}`);
  console.log("manifest references: every file named by .claude-plugin/plugin.json and .mcp.json is in the package");
} finally {
  ownedRun?.dispose();
}
