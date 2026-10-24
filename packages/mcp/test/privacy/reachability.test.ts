import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { build } from "esbuild";
import { ALLOWED_SDK_MODULES, bundleOptions } from "../../../../scripts/bundle-config.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";
import { MEASURABLE, inetSocketsOf } from "../support/sockets.ts";

interface Started {
  child: ChildProcessWithoutNullStreams;
  lines: () => string[];
  stderr: () => string;
  finish: () => Promise<number | null>;
}

function start(command: string, args: string[], env: Record<string, string>, cwd: string): Started {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const closed = new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
  return {
    child,
    lines: () => out.split("\n").filter((l) => l.length > 0),
    stderr: () => err,
    finish: async () => {
      child.stdin.end();
      return Promise.race([closed, new Promise<number | null>((r) => setTimeout(() => r(-999), 15_000))]);
    },
  };
}

async function until(cond: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for the child process");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sdkSpecifiers = (code: string): string[] => [...code.matchAll(/from\s+["'](@modelcontextprotocol\/[^"']+)["']/g)].map((m) => m[1] as string);

describe("HTTP/server reachability: the shipped runtime is stdio only (PRIV-015, PRIV-016)", () => {
  const runs: ReturnType<typeof createOwnedRun>[] = [];
  after(() => {
    for (const r of runs) r.dispose();
  });

  test("PRIV-015 the module graph of the shipped bundle holds the stdio server only: no HTTP, SSE, client, auth, Ajv or middleware module", async () => {
    const result = await build(bundleOptions(ROOT));
    const inputs = Object.keys(result.metafile.inputs).map((p) => p.replaceAll("\\", "/"));
    assert.deepEqual(inputs.filter((p) => p.startsWith("walletwall-stub:")), ["walletwall-stub:ajv-provider-stub"], "the only synthetic module is the Ajv stub");
    const real = inputs.filter((p) => !p.startsWith("walletwall-stub:"));
    const sdk = real.filter((p) => p.includes("@modelcontextprotocol/sdk/")).map((p) => p.replace(/^.*@modelcontextprotocol\/sdk\/dist\/esm\//, ""));
    assert.ok(sdk.length > 0);
    for (const m of sdk) assert.ok(ALLOWED_SDK_MODULES.includes(m), `unexpected SDK module in the bundle: ${m}`);
    for (const required of ["server/index.js", "server/stdio.js"]) assert.ok(sdk.includes(required), required);

    const packages = new Set(real.map((p) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p)?.[1]).filter((p): p is string => p !== undefined));
    assert.deepEqual([...packages].sort(), ["@modelcontextprotocol/sdk", "zod", "zod-to-json-schema"]);
    const deny = /(streamableHttp|\/sse\.js|express|hono|node-server|cors|\/client\/|\/auth|ajv|fast-uri|undici|\/ws\/|eventsource|raw-body|content-type)/i;
    for (const p of real.filter((x) => x.includes("node_modules/"))) assert.ok(!deny.test(p), `denied module in the bundle graph: ${p}`);
  });

  test("PRIV-015 the shipped bundle text carries no network, server, process-spawn or dynamic-code primitive", () => {
    const text = readFileSync(ENTRIES.bundle, "utf8");
    const specs = new Set([...text.matchAll(/\bfrom\s*["'](node:[^"']+)["']/g)].map((m) => m[1]));
    assert.deepEqual([...specs].sort(), ["node:crypto", "node:process"]);
    const forbidden: [string, RegExp][] = [
      ["node network module", /["'](node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|cluster|child_process|worker_threads|vm|inspector|fs|fs\/promises|os)["']/],
      ["require()", /\brequire\s*\(/],
      ["process.binding / dlopen", /process\.(binding|dlopen|_linkedBinding)/],
      ["environment access", /process\.env\b|\.env\[/],
      ["argument access", /process\.argv|process\.execArgv/],
      ["listen()", /\.listen\s*\(/],
      ["global network primitive", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|Request|Response|Headers)\s*\(/],
      ["eval or Function constructor", /\beval\s*\(|new\s+Function\b|\bFunction\s*\(/],
      ["transport class", /StreamableHTTP|SSEServerTransport|WebStandardStreamableHTTP|NodeStreamableHTTP/],
    ];
    for (const [label, re] of forbidden) assert.ok(!re.test(text), `shipped bundle contains ${label}: ${re.exec(text)?.[0]}`);
    for (const line of text.split("\n")) {
      if (/\bimport\s*\(/.test(line)) assert.match(line.trim(), /^(\/\/|\/\*|\*)/, `dynamic import outside a comment: ${line.trim().slice(0, 80)}`);
    }
  });

  test("PRIV-015 no WalletWall entrypoint imports any SDK module other than the stdio server", () => {
    const seen = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts")) for (const s of sdkSpecifiers(readFileSync(p, "utf8"))) seen.add(s);
      }
    };
    walk(`${ROOT}packages/mcp/src`);
    assert.deepEqual([...seen].sort(), ["@modelcontextprotocol/sdk/server/index.js", "@modelcontextprotocol/sdk/server/stdio.js", "@modelcontextprotocol/sdk/types.js"]);
  });

  test("PRIV-015 the committed bundle is exactly what the module-graph-checked build produces", async () => {
    const result = await build(bundleOptions(ROOT));
    const built = (result.outputFiles?.[0]?.text ?? "").replace(/\r\n/g, "\n");
    assert.equal(built, readFileSync(ENTRIES.bundle, "utf8").replace(/\r\n/g, "\n"));
  });

  test("PRIV-016 the socket reader detects a listening TCP socket and a bound UDP socket (positive control)", { skip: !MEASURABLE && "no OS socket reader on this platform" }, async () => {
    const run = createOwnedRun();
    runs.push(run);
    const probe = start(
      process.execPath,
      ["-e", "const n=require('node:net');const d=require('node:dgram');n.createServer().listen(0,'127.0.0.1',()=>{d.createSocket('udp4').bind(0,'127.0.0.1',()=>process.stdout.write('ready\\n'))});setInterval(()=>{},1000)"],
      { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "" },
      run.mkdir("probe"),
    );
    try {
      await until(() => probe.lines().includes("ready"));
      const sockets = inetSocketsOf(probe.child.pid as number);
      assert.ok(sockets.some((s) => /TCP|tcp/.test(s)), `expected a TCP socket, saw ${JSON.stringify(sockets)}`);
      assert.ok(sockets.some((s) => /UDP|udp/.test(s)), `expected a UDP socket, saw ${JSON.stringify(sockets)}`);
    } finally {
      probe.child.kill();
    }
  });

  const HOSTILE_ENV: Record<string, string> = {
    PORT: "8123",
    HOST: "0.0.0.0",
    HOSTNAME: "0.0.0.0",
    MCP_TRANSPORT: "streamable-http",
    MCP_HTTP_PORT: "8124",
    MCP_PORT: "8125",
    MCP_SERVER_URL: "http://127.0.0.1:8126",
    TRANSPORT: "sse",
    SERVER_MODE: "http",
    NODE_ENV: "development",
    DEBUG: "*",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "socks5://127.0.0.1:9",
    WALLETWALL_HTTP: "1",
    WALLETWALL_LISTEN: "0.0.0.0:8127",
    WALLETWALL_API_KEY: "wwk_not_used",
  };
  const HOSTILE_ARGS = ["--http", "--port", "8128", "--host", "0.0.0.0", "--transport", "streamable-http", "--sse", "--listen=0.0.0.0:8129", "--cors", "*"];

  for (const [label, entry] of Object.entries(ENTRIES)) {
    test(`PRIV-016 entry ${label}: normal startup, and startup with hostile environment and arguments, open zero inet sockets and still answer over stdio`, { skip: !MEASURABLE && "no OS socket reader on this platform" }, async () => {
      for (const hostile of [false, true]) {
        const run = createOwnedRun();
        runs.push(run);
        const home = run.mkdir("home");
        const env: Record<string, string> = {
          PATH: process.env["PATH"] ?? "",
          SystemRoot: process.env["SystemRoot"] ?? "",
          HOME: home,
          USERPROFILE: home,
          TEMP: home,
          TMP: home,
          TMPDIR: home,
          ...(hostile ? HOSTILE_ENV : {}),
        };
        const s = start(process.execPath, [entry, ...(hostile ? HOSTILE_ARGS : [])], env, run.mkdir("cwd"));
        try {
          const send = (o: unknown): void => void s.child.stdin.write(`${JSON.stringify(o)}\n`);
          send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "reachability", version: "0" } } });
          await until(() => s.lines().some((l) => l.includes('"id":1')));
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
          await until(() => s.lines().some((l) => l.includes('"id":2')));
          const tools = s.lines().find((l) => l.includes('"id":2')) ?? "";
          for (const name of ["resolve_asset", "inspect_evidence", "trace_provenance"]) assert.ok(tools.includes(name), `${label}${hostile ? " (hostile)" : ""}: ${name} missing`);
          const sockets = inetSocketsOf(s.child.pid as number);
          assert.deepEqual(sockets, [], `${label}${hostile ? " (hostile)" : ""}: inet sockets found: ${JSON.stringify(sockets)}`);
        } finally {
          const code = await s.finish();
          assert.equal(code, 0, `${label}: stdin close must end the process cleanly`);
          assert.equal(s.stderr(), "", `${label}: nothing may be written to stderr`);
        }
      }
    });
  }

  test("PRIV-016 nothing in the repository lets the runtime be switched to an HTTP transport by configuration", () => {
    const mcp = JSON.parse(readFileSync(`${ROOT}plugin/mcp.json`, "utf8")) as { mcpServers: Record<string, { type: string; args?: string[]; env?: unknown; url?: unknown }> };
    for (const s of Object.values(mcp.mcpServers)) {
      assert.equal(s.type, "stdio");
      assert.equal(s.env, undefined);
      assert.equal(s.url, undefined);
      assert.deepEqual(s.args, ["${PLUGIN_ROOT}/server/walletwall-mcp.mjs"]);
    }
    assert.ok(existsSync(ENTRIES.bundle));
    const main = readFileSync(`${ROOT}packages/mcp/src/main.ts`, "utf8");
    assert.ok(!/process\.(env|argv)/.test(main));
  });
});
