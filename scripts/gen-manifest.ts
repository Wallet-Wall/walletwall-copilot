import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../packages/mcp/src/canonical.ts";
import { resourcesManifest } from "../packages/mcp/src/resources.ts";
import { TOOLS, TOOL_ANNOTATIONS, inputJsonSchema } from "../packages/mcp/src/tools.ts";
import { ENGINE_NAME, ENGINE_VERSION } from "../packages/mcp/src/version.ts";
import { currentIntegrityHex, INTEGRITY_POLICY } from "./integrity-policy.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = `${root}security/tool-manifest.json`;
const shaPath = `${root}${INTEGRITY_POLICY.current.toolManifest}`;

const manifest = {
  manifestVersion: "1",
  wwepVersion: "0.1",
  server: { name: ENGINE_NAME, version: ENGINE_VERSION, transport: "stdio" },
  tools: [...TOOLS]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: inputJsonSchema(t),
      annotations: { title: t.title, ...TOOL_ANNOTATIONS },
    })),
  resources: resourcesManifest(),
};

const pretty = `${JSON.stringify(manifest, null, 2)}\n`;
const hash = currentIntegrityHex(canonicalize(JSON.parse(pretty), { numbers: "jcs" }));
const shaLine = `${hash}  security/tool-manifest.json (RFC 8785 canonical form, SHA-512)\n`;

if (process.argv.includes("--check")) {
  const norm = (s: string): string => s.replace(/\r\n/g, "\n");
  let curManifest = "";
  let curSha = "";
  try {
    curManifest = norm(readFileSync(manifestPath, "utf8"));
    curSha = norm(readFileSync(shaPath, "utf8"));
  } catch {
    // reported below
  }
  if (curManifest !== pretty || curSha !== shaLine) {
    console.error("Tool contract changed. security/tool-manifest.json or its policy-selected digest differs from the live tool definitions.");
    console.error("Review the diff, then run: npm run gen:manifest");
    process.exit(1);
  }
  console.log(`tool manifest verified: ${INTEGRITY_POLICY.currentAlgorithm} ${hash}`);
} else {
  writeFileSync(manifestPath, pretty);
  writeFileSync(shaPath, shaLine);
  console.log(`wrote security/tool-manifest.json; ${INTEGRITY_POLICY.currentAlgorithm} ${hash}`);
}
