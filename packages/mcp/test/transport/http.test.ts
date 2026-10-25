import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { USDC } from "../support/builders.ts";

function startBridge(
  args: readonly string[] = ["--port", "0"],
  env: NodeJS.ProcessEnv = {},
): Promise<{ child: ChildProcessWithoutNullStreams; url: URL }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/claude-mcp-http.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
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

async function runRejectedBridge(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/claude-mcp-http.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("bridge did not fail closed"));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("optional Streamable HTTP MCP bridge", () => {
  test("initializes, stays stateless, lists and calls the existing read-only WalletWall tools", async () => {
    const { child, url } = await startBridge();
    const client = new Client({ name: "http-e2e", version: "0" });
    const transport = new StreamableHTTPClientTransport(url);

    try {
      await client.connect(transport);
      assert.equal(transport.sessionId, undefined);

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
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    } finally {
      await stopBridge(child);
    }
  });

  test("exposes a no-store health check without widening the MCP route", async () => {
    const { child, url } = await startBridge();
    try {
      const response = await fetch(new URL("/health", url));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.deepEqual(await response.json(), { status: "ok" });
    } finally {
      await stopBridge(child);
    }
  });

  test("uses PORT when CLI port is absent", async () => {
    const { child, url } = await startBridge([], { PORT: "0" });
    try {
      assert.ok(Number(url.port) > 0);
      const response = await fetch(new URL("/health", url));
      assert.equal(response.status, 200);
    } finally {
      await stopBridge(child);
    }
  });

  test("CLI port takes precedence over PORT", async () => {
    const { child, url } = await startBridge(["--port", "0"], { PORT: "not-a-port" });
    try {
      assert.ok(Number(url.port) > 0);
    } finally {
      await stopBridge(child);
    }
  });

  test("rejects an invalid PORT when CLI port is absent", async () => {
    assert.equal(await runRejectedBridge([], { PORT: "not-a-port" }), 1);
  });

  test("rejects oversized bodies before MCP dispatch", async () => {
    const { child, url } = await startBridge();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "x".repeat(512 * 1024) }),
      });
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: "payload too large" });
    } finally {
      await stopBridge(child);
    }
  });

  test("rejects browser Origins for non-loopback mode", async () => {
    const child = spawn(process.execPath, ["scripts/claude-mcp-http.ts", "--host", "0.0.0.0", "--port", "0"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    try {
      const url = await new Promise<URL>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("public-mode bridge did not start")), 10_000);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          const match = /streamable-http http:\/\/0\.0\.0\.0:(\d+)\/mcp/.exec(stderr);
          if (match?.[1] !== undefined) {
            clearTimeout(timer);
            resolve(new URL(`http://127.0.0.1:${match[1]}/mcp`));
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: "{}",
      });
      assert.equal(response.status, 403);
    } finally {
      await stopBridge(child);
    }
  });

  test("fails closed for unsupported bind hosts", async () => {
    const testNetHost = [192, 0, 2, 1].join(".");
    assert.equal(await runRejectedBridge(["--host", testNetHost, "--port", "0"]), 1);
  });
});
