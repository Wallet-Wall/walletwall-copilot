import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EVALUATED_AT, USDC, golden } from "../support/builders.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const ENTRYPOINTS = {
  source: `${root}packages/mcp/src/main.ts`,
  bundle: `${root}plugin/server/walletwall-mcp.mjs`,
} as const;

for (const [label, entry] of Object.entries(ENTRYPOINTS)) {
  describe(`stdio MCP launches and works (${label})`, () => {
    test("initialize, list, call and read over real stdio", async () => {
      assert.ok(existsSync(entry), `${entry} is missing; run npm run build:bundle`);
      const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: "pipe" });
      const client = new Client({ name: "e2e", version: "0" });
      await client.connect(transport);
      try {
        const info = client.getServerVersion();
        assert.equal(info?.name, "walletwall-mcp");
        assert.equal(info?.title, "WalletWall MCP");
        const { tools } = await client.listTools();
        assert.equal(tools.length, 6);
        const res = await client.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: USDC } });
        assert.equal((res.structuredContent as { resolution: string }).resolution, "REGISTRY_MATCH");
        const ins = await client.callTool({ name: "inspect_evidence", arguments: { bundle: golden(), evaluatedAt: EVALUATED_AT } });
        assert.equal((ins.structuredContent as { invariantViolationCount: number }).invariantViolationCount, 0);
        const spec = await client.readResource({ uri: "walletwall://spec/wwep" });
        assert.ok((spec.contents[0] as { text: string }).text.includes("WWEP 0.1"));
      } finally {
        await client.close();
      }
    });
  });
}
