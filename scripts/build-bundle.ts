import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions } from "./bundle-config.ts";
import { INTEGRITY_POLICY } from "./integrity-policy.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const outFile = `${root}plugin/server/walletwall-mcp.mjs`;
const shaFile = `${root}${INTEGRITY_POLICY.current.bundle}`;
const check = process.argv.includes("--check");

const result = await build(bundleOptions(root));

const text = (result.outputFiles[0]?.text ?? "").replace(/\r\n/g, "\n");
const sha = createHash(INTEGRITY_POLICY.currentAlgorithm).update(text, "utf8").digest("hex");

const packages = new Set<string>();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
  if (m?.[1]) packages.add(m[1]);
}

if (check) {
  let current = "";
  let currentSha = "";
  try {
    current = readFileSync(outFile, "utf8").replace(/\r\n/g, "\n");
    currentSha = readFileSync(shaFile, "utf8").trim();
  } catch {
    // reported below
  }
  if (current !== text || currentSha !== `${sha}  plugin/server/walletwall-mcp.mjs`) {
    console.error("plugin/server/walletwall-mcp.mjs is out of date or not reproducible. Run: npm run build:bundle");
    process.exit(1);
  }
  console.log(`bundle reproducible: ${INTEGRITY_POLICY.currentAlgorithm} ${sha}; bundled third-party packages: ${packages.size}`);
} else {
  mkdirSync(`${root}plugin/server`, { recursive: true });
  writeFileSync(outFile, text);
  writeFileSync(shaFile, `${sha}  plugin/server/walletwall-mcp.mjs\n`);
  console.log(`wrote plugin/server/walletwall-mcp.mjs ${INTEGRITY_POLICY.currentAlgorithm} ${sha}`);
  console.log(`bundled third-party packages (${packages.size}): ${[...packages].sort().join(", ")}`);
}
