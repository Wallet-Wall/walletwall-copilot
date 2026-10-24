import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { USDC } from "../support/builders.ts";

function startBridge(): Promise<{ child: ChildProcessWithoutNullStreams; url: URL }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["packages/mcp/transport/http.ts", "--port", "0"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("bridge did not start"));
    }, 10_000);

    const fail = (error: Error): void => {
      clearTimeout(timer);
      child.kill();
      reject(error);
    };

    child.once("error", fail);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const match = /streamable-http (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(stderr);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, url: new URL(match[1]) });
      }
    });

    child.once("exit", (code) => {
      if (!/streamable-http /.test(stderr)) fail(new Error(`bridge exited before ready (${String(code)})`));
    });
  });
}

async function stopBridge(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe("optional Streamable HTTP MCP bridge", () => {
  test("initializes, lists and calls the existing read-only WalletWall tools", async () => {
    const { child, url } = await startBridge();
    const client = new Client({ name: "http-e2e", version: "0" });
    const transport = new StreamableHTTPClientTransport(url);

    try {
      await client.connect(transport);
      const info = client.getServerVersion();
      assert.equal(info?.name, "walletwall-mcp");
      assert.equal(info?.title, "WalletWall MCP");

      const { tools } = await client.listTools();
      assert.equal(tools.length, 6);

      const result = await client.callTool({
        name: "resolve_asset",
        arguments: { chainId: "1", address: USDC },
      });
      assert.equal((result.structuredContent as { resolution: string }).resolution, "REGISTRY_MATCH");
    } finally {
      await client.close().catch(() => undefined);
      await stopBridge(child);
    }
  });

  test("binds to loopback and refuses non-MCP routes", async () => {
    const { child, url } = await startBridge();
    try {
      const response = await fetch(new URL("/not-mcp", url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    } finally {
      await stopBridge(child);
    }
  });
});
