import { fileURLToPath } from "node:url";
import { validatePluginDir } from "../packages/mcp/test/support/plugin-validator.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const findings = validatePluginDir(`${root}plugin`, root);
if (findings.length > 0) {
  for (const f of findings) console.error(`plugin/${f.file}: ${f.problem}`);
  process.exit(1);
}
console.log("plugin directory conforms to Agent Plugins 1.0.0 structure");
