import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { STORE_RECORDS_DIR, STORE_STANDING_FILE, isPublishableId, verifyPublicDisclosure, verifyStanding } from "../packages/mcp/src/wallprint/publication.ts";
import { RESOLVER_ROUTE, isResolverBase } from "../packages/mcp/src/wallprint/reference.ts";
import { createOwnedRun } from "../packages/mcp/test/support/owned-temp.ts";
import { hostConfig, shellHtml } from "../packages/wallprint-web/lib/host-config.ts";

/**
 * Builds the public WallPrint resolver as a static site: one shell page, one script, one stylesheet, the self-hosted
 * fonts and mark, and the publication store, all under `wallprint/`, plus a `vercel.json` holding the route-scoped
 * rewrites and headers the host must serve (packages/wallprint-web/lib/host-config.ts, tested there). Output:
 * dist/wallprint-public (ignored by Git). Nothing here runs on a server: the page fetches two static files per record
 * and checks the bytes itself.
 *
 *   npm run build:wallprint-public      write dist/wallprint-public
 *   npm run verify:wallprint-public     build into an owned temp directory and prove the bundle is inert and bounded
 *
 * Every name served with immutable caching changes when its bytes change: the script, the stylesheet, every font and
 * the mark carry a content hash in their names. Artifacts are named by their digest but revalidated, because the host's
 * rule for their paths also answers the 404 of a record not yet published (lib/host-config.ts).
 * The bundle must stay inert and lean:
 * no Node module, no clock, no identifier, no persistence, no code evaluation, no navigation primitive, no host name, one
 * same-origin fetch, one markup sink, and none of the canvas's embedded font, fixture or client data. Nothing is deleted
 * (only the owned-temp helper removes paths): a rebuild overwrites what it produces and reports stale hashed assets.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const ownedRun = check ? createOwnedRun() : null;
const outRoot = ownedRun === null ? join(root, "dist", "wallprint-public") : ownedRun.mkdir("wallprint-public");
const site = join(outRoot, "wallprint");
const publication = join(root, "packages", "wallprint-web", "publication");
const ext = join(root, "plugin", "com.github.copilot", "extensions", "walletwall-evidence-explorer");
const brand = join(root, "canvas", "brand");
const MAX_JS_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 128 * 1024;

function fail(message: string): never {
  console.error(message);
  ownedRun?.dispose();
  process.exit(1);
}

const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sha512 = (data: string | Buffer): string => createHash("sha512").update(data).digest("hex");
const shortHash = (data: string | Buffer): string => sha512(data).slice(0, 16);
/** `name.ext` -> `name.<hash16>.ext`, so the name changes whenever the bytes do. */
const hashedName = (file: string, data: string | Buffer): string => {
  const base = basename(file);
  const dot = base.lastIndexOf(".");
  return `${base.slice(0, dot)}.${shortHash(data)}${base.slice(dot)}`;
};

// ─── the publication store ───────────────────────────────────────────────────

const indexPath = join(publication, "index.json");
if (!existsSync(indexPath)) fail("packages/wallprint-web/publication/index.json is missing: publish first (npm run wallprint:publish)");
const index = JSON.parse(read(indexPath)) as { resolverBase?: unknown; route?: unknown };
if (!isResolverBase(index.resolverBase)) fail("the publication index names no valid resolver base");
if (index.route !== RESOLVER_ROUTE) fail("the publication index names another route");
const resolverBase: string = index.resolverBase;

function copyStore(): { records: number } {
  mkdirSync(join(site, STORE_RECORDS_DIR), { recursive: true });
  cpSync(indexPath, join(site, "index.json"));
  let records = 0;
  const recordsDir = join(publication, STORE_RECORDS_DIR);
  for (const id of existsSync(recordsDir) ? readdirSync(recordsDir).sort() : []) {
    if (!isPublishableId(id)) fail(`${id}: not a publishable record id; nothing is built`);
    const standing = verifyStanding(JSON.parse(read(join(recordsDir, id, STORE_STANDING_FILE))));
    if (!standing.ok || standing.standing.recordId !== id) fail(`${id}: the standing does not verify; nothing is built`);
    for (const f of readdirSync(join(recordsDir, id))) {
      if (f === STORE_STANDING_FILE) continue;
      const v = verifyPublicDisclosure(read(join(recordsDir, id, f)));
      if (!v.ok || v.artifact.recordId !== id || `${v.artifact.digest}.json` !== f) fail(`${id}/${f}: the artifact does not verify; nothing is built`);
    }
    cpSync(join(recordsDir, id), join(site, STORE_RECORDS_DIR, id), { recursive: true });
    records++;
  }
  return { records };
}

// ─── fonts and mark ──────────────────────────────────────────────────────────

interface FontSource {
  file: string;
  sha512: string;
  family: string;
  weight: string;
  licenseFile: string;
}

function copyBrand(): { fontFaces: string; mark: string } {
  const sources = JSON.parse(read(join(brand, "brand-sources.json"))) as { fonts: FontSource[]; images: { file: string; sha512: string }[] };
  mkdirSync(join(site, "fonts"), { recursive: true });
  mkdirSync(join(site, "brand"), { recursive: true });
  const faces: string[] = [];
  const licenses = new Set<string>();
  for (const f of sources.fonts) {
    const bytes = readFileSync(join(brand, f.file));
    if (sha512(bytes) !== f.sha512) fail(`${f.file}: font bytes do not match canvas/brand/brand-sources.json`);
    const name = hashedName(f.file, bytes);
    writeFileSync(join(site, "fonts", name), bytes);
    licenses.add(f.licenseFile);
    faces.push(`@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url("${RESOLVER_ROUTE}fonts/${name}") format("woff2")}`);
  }
  // Licence texts keep their names and the host's default caching: they are documents, not immutable assets.
  for (const l of licenses) cpSync(join(brand, l), join(site, "fonts", basename(l)));
  const markSource = sources.images.find((i) => i.file === "walletwall-brick-wallet-96.png");
  if (markSource === undefined) fail("the WalletWall mark is not listed in brand-sources.json");
  const markBytes = readFileSync(join(brand, markSource.file));
  if (sha512(markBytes) !== markSource.sha512) fail("the WalletWall mark's bytes do not match brand-sources.json");
  const mark = `brand/${hashedName("mark.png", markBytes)}`;
  writeFileSync(join(site, mark), markBytes);
  return { fontFaces: faces.join("\n"), mark };
}

// ─── stylesheet ──────────────────────────────────────────────────────────────

/**
 * The public page is one document, not a panel beside a detail sheet: the room the canvas reserves for its phone sheet
 * (bottom peek, landscape right-hand panel) is given back, and the plate is centred with a reading width.
 */
const PUBLIC_CSS = `
#app{max-width:1120px;margin:0 auto}
.ww-lens-badge{white-space:nowrap;flex:0 0 auto}
.wp-mirror{font-size:12.5px}
@media (max-width:767px){body{padding-bottom:24px}}
@media (max-width:767px) and (orientation:landscape) and (max-height:500px){body{padding-right:12px}.copy-status{right:12px}}
`;

async function stylesheet(fontFaces: string, mark: string): Promise<string> {
  const { CSS } = (await import(pathToFileURL(join(ext, "styles.mjs")).href)) as { CSS: string };
  const { WALLPRINT_CSS } = (await import(pathToFileURL(join(ext, "wallprint-styles.mjs")).href)) as { WALLPRINT_CSS: string };
  const markCss = `.ww-mark{background-image:url("${RESOLVER_ROUTE}${mark}")}`;
  return `${fontFaces}\n${markCss}\n${CSS}\n${WALLPRINT_CSS}\n${PUBLIC_CSS}`.replace(/\r\n/g, "\n");
}

// ─── script ──────────────────────────────────────────────────────────────────

const ALLOWED_INPUTS = [
  /^packages\/wallprint-web\/browser\/page\.ts$/,
  /^packages\/wallprint-web\/lib\/(artifact|canonical-form|digest|ledger|resolve|shape|standing|view)\.ts$/,
  /^packages\/mcp\/src\/wallprint\/(reference|vocabulary|errors|language|publication-vocabulary)\.ts$/,
  /^plugin\/com\.github\.copilot\/extensions\/walletwall-evidence-explorer\/(labels|wall|coinstellation-model|wallprint-render|wallprint-client|wallprint-reference|wallprint-qr|wallprint-fixtures)\.mjs$/,
];
/** Modules that must contribute (almost) nothing to the output: their exports the page uses are small, the rest is tree-shaken. */
const LEAN_INPUTS: Record<string, number> = { "wallprint-fixtures.mjs": 24 * 1024, "coinstellation-model.mjs": 512, "wall.mjs": 8 * 1024 };
/** Anything the page must never do or name. The page reads `location.pathname` and `location.search`; it never assigns a location. */
const INERT =
  /\brequire\(|node:|process\.env|Date\.now|new Date\(|Math\.random|randomUUID|getRandomValues|\beval\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|XMLHttpRequest|WebSocket|EventSource|sendBeacon|postMessage|window\.open|location\.(assign|replace|reload)|location\.href\s*=(?!=)|\blocation\s*=(?!=)|location\.(?:search|pathname|hash|host|port|protocol)\s*=(?!=)|document\.location|history\.(?:push|replace)State|navigation\.navigate|\bopen\(|http-equiv|importScripts|serviceWorker|document\.write|insertAdjacentHTML|outerHTML\s*=|srcdoc|createContextualFragment|setHTMLUnsafe|DOMParser|https?:\/\/|walletwall\.(com|io|xyz|app|dev|org)|vercel\.app|console\./;

async function script(): Promise<{ js: string; inputs: Record<string, number> }> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["packages/wallprint-web/browser/page.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    write: false,
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
    treeShaking: true,
    charset: "utf8",
    sourcemap: false,
    minify: false,
  });
  const outputs = Object.values(result.metafile.outputs);
  const output = outputs[0];
  if (output === undefined || outputs.length !== 1) fail("expected exactly one output file");
  const inputs: Record<string, number> = {};
  for (const [path, meta] of Object.entries(output.inputs)) {
    const p = path.replaceAll("\\", "/");
    if (!ALLOWED_INPUTS.some((re) => re.test(p))) fail(`${p} is not allowed in the public resolver bundle`);
    inputs[p] = meta.bytesInOutput;
    const lean = LEAN_INPUTS[basename(p)];
    if (lean !== undefined && meta.bytesInOutput > lean) fail(`${p} contributes ${meta.bytesInOutput} bytes to the bundle; at most ${lean} are expected (embedded fonts or fixtures would be a leak)`);
  }
  const js = `// GENERATED by scripts/build-wallprint-public.ts: the public WallPrint resolver. Do not edit; run: npm run build:wallprint-public\n${(result.outputFiles[0]?.text ?? "").replace(/\r\n/g, "\n")}`;
  const m = INERT.exec(js);
  if (m !== null) fail(`the public resolver bundle must be inert: found ${m[0]}`);
  if (js.length > MAX_JS_BYTES) fail(`the public resolver bundle is ${js.length} bytes; at most ${MAX_JS_BYTES} are allowed`);
  if ((js.match(/\bfetch\(/g) ?? []).length !== 1) fail("the bundle must contain exactly one fetch call");
  if ((js.match(/\.innerHTML\s*=/g) ?? []).length !== 1) fail("the bundle must contain exactly one markup sink");
  if (/WALLPRINT_FIXTURES\s*=\s*\{/.test(js) || /"canonical":\s*"\{/.test(js)) fail("fixture data leaked into the bundle");
  if (/data:font|data:image/.test(js)) fail("embedded brand data leaked into the bundle");
  return { js, inputs };
}

// ─── build ───────────────────────────────────────────────────────────────────

const HASHED_ASSET_RE = /^(?:wallprint\.[0-9a-f]{16}\.(?:js|css)|[a-z0-9-]+\.[0-9a-f]{16}\.(?:woff2|png))$/;
const before = new Set(
  ["", "fonts", "brand"].flatMap((d) => {
    const dir = join(site, d);
    return existsSync(dir) ? readdirSync(dir).filter((f) => HASHED_ASSET_RE.test(f)).map((f) => (d === "" ? f : `${d}/${f}`)) : [];
  }),
);
mkdirSync(site, { recursive: true });
const { records } = copyStore();
const { fontFaces, mark } = copyBrand();
const css = await stylesheet(fontFaces, mark);
if (css.length > MAX_CSS_BYTES) fail(`the stylesheet is ${css.length} bytes; at most ${MAX_CSS_BYTES} are allowed`);
if (/data:|https?:\/\//.test(css)) fail("the stylesheet must reference only same-origin files");
const { js, inputs } = await script();
const jsName = `wallprint.${shortHash(js)}.js`;
const cssName = `wallprint.${shortHash(css)}.css`;
writeFileSync(join(site, jsName), js);
writeFileSync(join(site, cssName), css);
writeFileSync(join(site, "index.html"), shellHtml({ js: jsName, css: cssName, mark, resolverBase }));
writeFileSync(join(outRoot, "vercel.json"), `${JSON.stringify(hostConfig(), null, 2)}\n`);
const current = new Set([jsName, cssName, mark, ...readdirSync(join(site, "fonts")).filter((f) => fontFaces.includes(`fonts/${f}`)).map((f) => `fonts/${f}`)]);
const summary = `public resolver: ${records} record(s), ${jsName} (${js.length} bytes), ${cssName} (${css.length} bytes), base ${resolverBase}`;
if (ownedRun !== null) {
  ownedRun.dispose();
  console.log(`wallprint public resolver builds and is inert: ${summary}; bundle inputs: ${Object.keys(inputs).length}`);
} else {
  const stale = [...before].filter((f) => !current.has(f));
  console.log(`wrote dist/wallprint-public: ${summary}${stale.length ? `; stale assets from an earlier build remain unreferenced: ${stale.join(", ")}` : ""}`);
}
