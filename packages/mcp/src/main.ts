import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

// No logging, telemetry or crash reporting. Fatal errors print one fixed line and exit.
function fatal(): never {
  process.stderr.write("walletwall-mcp: fatal error\n");
  process.exit(1);
}
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

const server = createServer();
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => process.exit(0));
