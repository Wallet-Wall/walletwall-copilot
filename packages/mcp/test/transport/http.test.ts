import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { networkInterfaces } from "node:os";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EVALUATED_AT, HOLDER, USDC, golden } from "../support/builders.ts";
import { ENTRIES, ROOT, listTree } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";
import { MEASURABLE, tcpListenersOf } from "../support/sockets.ts";

const ADAPTER = "scripts/claude-mcp-http.ts";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK_V4 = "127.0.0.1";
const LOOPBACK_V6 = "::1";
// Documentation-only address (RFC 5737), written in parts so no literal non-loopback address sits in this file.
const TEST_NET = [192, 0, 2, 1].join(".");
const ANY_V4 = ["0", "0", "0", "0"].join(".");

interface Bridge {
  child: ChildProcessWithoutNullStreams;
  url: URL;
  host: string;
  port: number;
  token: string;
  stdout: () => string;
  stderr: () => string;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

const bearer = (token: string): string => `Bearer ${token}`;

function startBridge(args: readonly string[] = ["--enable", "--port", "0"], env: NodeJS.ProcessEnv = {}, cwd: string = ROOT): Promise<Bridge> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`${ROOT}${ADAPTER}`, ...args], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => fail(new Error("bridge did not start")), 10_000);

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.once("error", fail);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const url = /streamable-http (http:\/\/(127\.0\.0\.1|\[::1\]):(\d+)\/mcp)/.exec(stderr);
      const token = /bearer-token ([A-Za-z0-9_-]+)/.exec(stderr);
      if (!settled && url?.[1] !== undefined && url[2] !== undefined && url[3] !== undefined && token?.[1] !== undefined) {
        settled = true;
        clearTimeout(timer);
        resolve({
          child,
          url: new URL(url[1]),
          host: url[2],
          port: Number(url[3]),
          token: token[1],
          stdout: () => stdout,
          stderr: () => stderr,
        });
      }
    });
    child.once("exit", (code) => fail(new Error(`bridge exited before ready (${String(code)})`)));
  });
}

async function stopBridge(bridge: Bridge): Promise<void> {
  const { child } = bridge;
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the adapter expecting it to refuse or exit on its own. A listener that appears fails the test. */
function runToExit(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`${ROOT}${ADAPTER}`, ...args], {
      cwd: ROOT,
      env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("adapter did not exit: it must refuse, not listen"));
    }, 8_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

interface SendOptions {
  method?: string;
  path?: string;
  /** `false` omits Authorization; a string is sent verbatim; default is the bridge's valid token. */
  auth?: false | string;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer | Buffer[];
  /** Declare this Content-Length but send only `body`, then wait for the reply before closing. */
  declaredLength?: number;
}

function send(bridge: Bridge, options: SendOptions = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  const method = options.method ?? "POST";
  if (options.auth !== false) headers["authorization"] = options.auth ?? bearer(bridge.token);
  if (method === "POST") headers["content-type"] = "application/json";
  if (options.declaredLength !== undefined) headers["content-length"] = String(options.declaredLength);
  for (const [k, v] of Object.entries(options.headers ?? {})) {
    if (v === undefined) delete headers[k.toLowerCase()];
    else headers[k.toLowerCase()] = v;
  }
  // Header names are lower-cased above; Host is kept as given so tests can lie about it.
  const hostHeader = Object.entries(options.headers ?? {}).find(([k]) => k.toLowerCase() === "host");

  return new Promise((resolve, reject) => {
    let answered = false;
    const req = request(
      {
        host: bridge.host === "[::1]" ? LOOPBACK_V6 : LOOPBACK_V4,
        port: bridge.port,
        path: options.path ?? "/mcp",
        method,
        headers: hostHeader === undefined ? headers : { ...headers, Host: hostHeader[1] ?? "" },
        setHost: hostHeader === undefined,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        const done = (): void => {
          if (answered) return;
          answered = true;
          req.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") });
        };
        res.on("end", done);
        res.on("close", done);
        res.on("aborted", done);
      },
    );
    req.on("error", (error) => {
      if (!answered) reject(error);
    });
    const body = options.body;
    if (Array.isArray(body)) {
      for (const chunk of body) req.write(chunk);
      req.end();
    } else if (options.declaredLength !== undefined) {
      req.write(body ?? "{");
    } else if (body !== undefined) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "0" } },
});
const MCP_HEADERS = { accept: "application/json, text/event-stream" };

const everythingOf = (reply: Reply): string => JSON.stringify({ status: reply.status, headers: reply.headers, text: reply.text });

describe("optional HTTP adapter: disabled by default, explicit opt-in", () => {
  test("starting it without --enable opens nothing, prints no token and exits non-zero", async () => {
    for (const args of [[], ["--port", "0"], ["--host", LOOPBACK_V4, "--port", "0"]]) {
      const out = await runToExit(args);
      assert.equal(out.code, 1, `args ${JSON.stringify(args)}`);
      assert.match(out.stderr, /disabled: pass --enable/);
      assert.ok(!/streamable-http|bearer-token/.test(out.stderr + out.stdout), "no URL or token is printed while disabled");
      assert.equal(out.stdout, "");
    }
  });

  test("the enable switch is a flag only: no environment variable turns the adapter on or configures it", async () => {
    const out = await runToExit(["--port", "0"], { WALLETWALL_MCP_HTTP: "1", WALLETWALL_MCP_HTTP_ENABLE: "1", ENABLE: "1", MCP_TRANSPORT: "streamable-http", PORT: "0" });
    assert.equal(out.code, 1);
    assert.match(out.stderr, /disabled/);
  });

  test("a hostile PORT environment value is ignored: the adapter reads no environment", async () => {
    const bridge = await startBridge(["--enable", "--port", "0"], { PORT: "not-a-port", HOST: "0.0.0.0" });
    try {
      assert.equal(bridge.host, LOOPBACK_V4);
    } finally {
      await stopBridge(bridge);
    }
  });

  test("unsupported, duplicated and malformed arguments are refused with a fixed message that does not echo them", async () => {
    const cases: string[][] = [
      ["--enable", "--bogus"],
      ["--enable", "--token", "abc"],
      ["--enable", "--cors", "*"],
      ["--enable", "--enable"],
      ["--enable", "--port"],
      ["--enable", "--port", "70000"],
      ["--enable", "--port", "-1"],
      ["--enable", "--port", "8x"],
      ["--enable", "--port", "1", "--port", "2"],
      ["--enable", "--host", LOOPBACK_V4, "--host", LOOPBACK_V4],
      ["--enable", "positional"],
    ];
    for (const args of cases) {
      const out = await runToExit(args);
      assert.equal(out.code, 1, JSON.stringify(args));
      assert.match(out.stderr, /^walletwall-mcp-http: refused: /);
      assert.ok(!/streamable-http|bearer-token/.test(out.stderr));
      for (const word of args.filter((a) => !a.startsWith("--") && a.length > 2)) assert.ok(!out.stderr.includes(word), `the rejected value ${word} is not echoed`);
    }
  });
});

describe("optional HTTP adapter: loopback-only bind, no external-bind mode", () => {
  const refusedHosts = [
    ANY_V4,
    "::",
    "[::]",
    "0",
    "localhost",
    "::ffff:127.0.0.1",
    [127, 0, 0, 2].join("."),
    "127.1",
    "[::1]",
    "",
    TEST_NET,
  ];
  for (const host of refusedHosts) {
    test(`--host ${JSON.stringify(host)} is refused, with both argument forms, and nothing listens`, async () => {
      for (const args of [["--enable", "--port", "0", "--host", host], ["--enable", "--port", "0", `--host=${host}`]]) {
        const out = await runToExit(args);
        assert.equal(out.code, 1, JSON.stringify(args));
        assert.match(out.stderr, /refused: invalid host: only the loopback addresses/);
        assert.ok(!/streamable-http|bearer-token/.test(out.stderr), "no listener was announced");
      }
    });
  }

  test("a non-loopback address of this very machine is refused as a bind target and is not reachable once the adapter runs on loopback", async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === "IPv4" && !i.internal)?.address;
    if (lan === undefined) return;
    const out = await runToExit(["--enable", "--port", "0", "--host", lan]);
    assert.equal(out.code, 1);

    const bridge = await startBridge();
    try {
      const refused = await new Promise<string>((resolve) => {
        const socket = connect({ host: lan, port: bridge.port });
        socket.once("connect", () => {
          socket.destroy();
          resolve("connected");
        });
        socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
      });
      assert.notEqual(refused, "connected", "the listener must not answer on a LAN address");
    } finally {
      await stopBridge(bridge);
    }
  });

  test("the default bind is exactly 127.0.0.1 and the OS socket table shows no other listener", { skip: !MEASURABLE && "no socket-table reader on this platform" }, async () => {
    const bridge = await startBridge();
    try {
      assert.equal(bridge.host, LOOPBACK_V4);
      assert.deepEqual(tcpListenersOf(bridge.child.pid as number), [`${LOOPBACK_V4}:${bridge.port}`]);
    } finally {
      await stopBridge(bridge);
    }
  });

  test("::1 is accepted where IPv6 loopback exists, and is reached with its own Host", async (t) => {
    const probe = createNetServer();
    const available = await new Promise<boolean>((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(0, LOOPBACK_V6, () => probe.close(() => resolve(true)));
    });
    if (!available) {
      t.skip("no IPv6 loopback on this machine");
      return;
    }
    const bridge = await startBridge(["--enable", "--port", "0", "--host", LOOPBACK_V6]);
    try {
      assert.equal(bridge.host, "[::1]");
      const ok = await send(bridge, { headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(ok.status, 200);
      const wrong = await send(bridge, { headers: { ...MCP_HEADERS, host: `${LOOPBACK_V4}:${bridge.port}` }, body: INIT_BODY });
      assert.equal(wrong.status, 403, "a Host naming another address is refused");
    } finally {
      await stopBridge(bridge);
    }
  });
});

describe("optional HTTP adapter: ephemeral bearer token", () => {
  test("the token is 32 random bytes in canonical base64url, printed once on stderr, never on stdout", async () => {
    const bridge = await startBridge();
    try {
      assert.match(bridge.token, TOKEN_RE);
      const raw = Buffer.from(bridge.token, "base64url");
      assert.equal(raw.length, 32, "256 bits");
      assert.equal(raw.toString("base64url"), bridge.token, "canonical encoding, no padding");
      assert.equal(bridge.stdout(), "");
      assert.equal(bridge.stderr().split(bridge.token).length - 1, 1, "exactly one occurrence");
      assert.ok(!bridge.url.href.includes(bridge.token), "the URL never carries the token");
    } finally {
      await stopBridge(bridge);
    }
  });

  test("a new process gets a new token and a previous token is dead", async () => {
    const first = await startBridge();
    const firstToken = first.token;
    await stopBridge(first);
    const second = await startBridge();
    const third = await startBridge();
    try {
      assert.notEqual(second.token, firstToken);
      assert.notEqual(third.token, second.token);
      assert.notEqual(third.token, firstToken);
      const reply = await send(second, { auth: bearer(firstToken), headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 401, "the token of an earlier run is refused");
      const own = await send(second, { headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(own.status, 200);
      const crossed = await send(second, { auth: bearer(third.token), headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(crossed.status, 401, "a concurrent instance's token is refused too");
    } finally {
      await stopBridge(second);
      await stopBridge(third);
    }
  });

  test("no environment value becomes the token", async () => {
    const planted = "A".repeat(43);
    const bridge = await startBridge(["--enable", "--port", "0"], { WALLETWALL_MCP_TOKEN: planted, MCP_TOKEN: planted, TOKEN: planted, AUTH_TOKEN: planted, BEARER_TOKEN: planted });
    try {
      assert.notEqual(bridge.token, planted);
      const reply = await send(bridge, { auth: bearer(planted), headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 401);
    } finally {
      await stopBridge(bridge);
    }
  });

  test("the token is not persisted: a full session leaves no file in the working, home or temporary directories", async () => {
    const run = createOwnedRun();
    try {
      const [cwd, home, tmp] = ["cwd", "home", "tmp"].map((n) => run.mkdir(n)) as [string, string, string];
      const bridge = await startBridge(["--enable", "--port", "0"], { HOME: home, USERPROFILE: home, TMP: tmp, TEMP: tmp, TMPDIR: tmp, APPDATA: home, LOCALAPPDATA: home }, cwd);
      try {
        await send(bridge, { headers: MCP_HEADERS, body: INIT_BODY });
        await send(bridge, { auth: false, body: INIT_BODY });
      } finally {
        await stopBridge(bridge);
      }
      assert.deepEqual([cwd, home, tmp].flatMap(listTree), []);
    } finally {
      run.dispose();
    }
  });

  test("the adapter source reads no environment or clock, touches no file, and takes its token only from the CSPRNG", () => {
    const source = readFileSync(`${ROOT}${ADAPTER}`, "utf8");
    assert.ok(!/process\.env|Math\.random|Date\.now|new Date\(|node:fs|writeFile|appendFile|console\./.test(source));
    assert.match(source, /import \{ randomBytes, timingSafeEqual \} from "node:crypto"/);
    assert.match(source, /const TOKEN_BYTES = 32;/);
    assert.match(source, /randomBytes\(TOKEN_BYTES\)\.toString\("base64url"\)/);
    assert.match(source, /timingSafeEqual\(presented, expected\)/);
    assert.equal(source.split("${token}").length - 1, 1, "the token is interpolated into exactly one output line");
    assert.ok(!source.includes(ANY_V4), "no wildcard bind address appears in the adapter");
  });
});

describe("optional HTTP adapter: authentication and request validation", () => {
  let bridge: Bridge;
  before(async () => {
    bridge = await startBridge();
  });
  after(async () => {
    await stopBridge(bridge);
  });

  const tokenOf = (): string => bridge.token;
  const flip = (t: string): string => `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`;

  describe("authentication", () => {
    test("missing Authorization is refused with a fixed 401 and a bearer challenge", async () => {
      const reply = await send(bridge, { auth: false, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 401);
      assert.deepEqual(JSON.parse(reply.text), { error: "unauthorized" });
      assert.equal(reply.headers["www-authenticate"], "Bearer");
      assert.equal(reply.headers["cache-control"], "no-store");
    });

    test("wrong, shorter, longer and empty tokens are refused", async () => {
      const t = tokenOf();
      const wrong = [flip(t), t.slice(0, -1), `${t}A`, t.slice(1), "", "A".repeat(43), "A".repeat(4096)];
      for (const candidate of wrong) {
        const reply = await send(bridge, { auth: bearer(candidate), headers: MCP_HEADERS, body: INIT_BODY });
        assert.equal(reply.status, 401, `candidate of length ${candidate.length}`);
      }
    });

    test("malformed encodings of the right token are refused: padding, standard alphabet, embedded whitespace, controls, non-ASCII", async () => {
      const t = tokenOf();
      const standard = Buffer.from(t, "base64url").toString("base64");
      // Leading and trailing whitespace is stripped by HTTP itself before the adapter sees the value, so it is not testable here.
      const malformed = [`${t}=`, `${t.slice(0, 20)} ${t.slice(20)}`, `${t.slice(0, 20)}\t${t.slice(20)}`, standard.replaceAll("=", ""), `${t.slice(0, 20)}!${t.slice(21)}`, `${t.slice(0, 40)}é${t.slice(41)}`, t.toLowerCase(), t.toUpperCase()].filter((x) => x !== t);
      for (const candidate of malformed) {
        const header = bearer(candidate);
        let reply: Reply;
        try {
          reply = await send(bridge, { auth: header, headers: MCP_HEADERS, body: INIT_BODY });
        } catch {
          continue; // the client refused to emit an illegal header: nothing reached the adapter
        }
        assert.equal(reply.status, 401, JSON.stringify(candidate));
      }
    });

    test("the exact scheme is Bearer with one space: other schemes, bare tokens and other carriers are refused", async () => {
      const t = tokenOf();
      const basic = Buffer.from(`user:${t}`).toString("base64");
      const attempts: SendOptions[] = [
        { auth: `Basic ${basic}` },
        { auth: `Token ${t}` },
        { auth: `Digest ${t}` },
        { auth: t },
        { auth: `Bearer  ${t}` },
        { auth: `Bearer${t}` },
        { auth: `Bearer ${t},Bearer ${t}` },
        { auth: false, headers: { "x-api-key": t } },
        { auth: false, headers: { "x-auth-token": t } },
        { auth: false, headers: { cookie: `token=${t}`, "proxy-authorization": bearer(t) } },
        { auth: false, path: `/mcp?access_token=${t}` },
        { auth: false, path: `/mcp?token=${t}` },
      ];
      for (const attempt of attempts) {
        const reply = await send(bridge, { headers: MCP_HEADERS, body: INIT_BODY, ...attempt });
        assert.equal(reply.status, 401, JSON.stringify({ ...attempt, auth: typeof attempt.auth === "string" ? "<redacted>" : attempt.auth }).replaceAll(t, "<token>"));
      }
    });

    test("the scheme name is case-insensitive as RFC 9110 requires, nothing else is loosened", async () => {
      const reply = await send(bridge, { auth: `bearer ${tokenOf()}`, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 200);
    });

    test("an unauthenticated caller learns nothing about routes or methods: every path and method answers 401", async () => {
      for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        for (const path of ["/mcp", "/", "/health", "/sse", "/admin", "/mcp/", "/../mcp"]) {
          const reply = await send(bridge, { method, path, auth: false });
          assert.equal(reply.status, 401, `${method} ${path}`);
        }
      }
    });

    test("a valid MCP request without the token never reaches the MCP server", async () => {
      const reply = await send(bridge, { auth: false, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 401);
      assert.ok(!reply.text.includes("jsonrpc") && !reply.text.includes("walletwall-mcp"));
    });

    test("with the token, an SDK client initializes, stays stateless, lists and calls the read-only tools", async () => {
      const client = new Client({ name: "http-e2e", version: "0" });
      const transport = new StreamableHTTPClientTransport(bridge.url, { requestInit: { headers: { authorization: bearer(tokenOf()) } } });
      try {
        await client.connect(transport);
        assert.equal(transport.sessionId, undefined);
        assert.equal(client.getServerVersion()?.name, "walletwall-mcp");
        assert.equal((await client.listTools()).tools.length, 6);
        assert.equal((await client.listResources()).resources.length, 11);
        const result = await client.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: USDC } });
        assert.equal((result.structuredContent as { resolution: string }).resolution, "REGISTRY_MATCH");
      } finally {
        await client.close().catch(() => undefined);
      }
    });

    test("an SDK client without the token cannot connect", async () => {
      const client = new Client({ name: "http-e2e-anon", version: "0" });
      const transport = new StreamableHTTPClientTransport(bridge.url);
      await assert.rejects(client.connect(transport));
      await client.close().catch(() => undefined);
    });
  });

  describe("Host and Origin", () => {
    test("a Host header that does not name this listener exactly is refused, even with the token", async () => {
      const p = bridge.port;
      const hosts = ["attacker.example", `attacker.example:${p}`, `${LOOPBACK_V4}:${p + 1}`, LOOPBACK_V4, `${LOOPBACK_V4}.attacker.example:${p}`, `localhost.attacker.example:${p}`, `${LOOPBACK_V4}:${p}.attacker.example`, `${LOOPBACK_V4}@attacker.example:${p}`, `[::1]:${p}`, `0.0.0.0:${p}`, ""];
      for (const host of hosts) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, host }, body: INIT_BODY });
        assert.equal(reply.status, 403, JSON.stringify(host));
        assert.ok(!reply.text.includes("jsonrpc"));
      }
    });

    test("the Host check also holds without a token (a rebinding page gets 403, not a hint)", async () => {
      const reply = await send(bridge, { auth: false, headers: { ...MCP_HEADERS, host: `attacker.example:${bridge.port}` }, body: INIT_BODY });
      assert.equal(reply.status, 403);
    });

    test("localhost with the right port, in any letter case, is accepted", async () => {
      for (const host of [`localhost:${bridge.port}`, `LocalHost:${bridge.port}`, `${LOOPBACK_V4}:${bridge.port}`]) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, host }, body: INIT_BODY });
        assert.equal(reply.status, 200, host);
      }
    });

    test("a request without any Host header is refused", async () => {
      const status = await new Promise<number>((resolve, reject) => {
        const socket = connect({ host: LOOPBACK_V4, port: bridge.port });
        let data = "";
        socket.on("data", (d: Buffer) => (data += d.toString("latin1")));
        socket.on("error", reject);
        socket.on("close", () => resolve(Number(/^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1] ?? 0)));
        socket.write(`POST /mcp HTTP/1.0\r\nAuthorization: ${bearer(tokenOf())}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`);
      });
      assert.equal(status, 403);
    });

    test("a foreign, opaque or malformed Origin is refused, a same-origin one is accepted, and no CORS header is ever sent", async () => {
      const p = bridge.port;
      const refused = ["https://attacker.example", "http://attacker.example", `http://attacker.example:${p}`, `http://${LOOPBACK_V4}:${p + 1}`, `https://${LOOPBACK_V4}:${p}`, `http://${LOOPBACK_V4}:${p}/path`, `http://user@${LOOPBACK_V4}:${p}`, `http://localhost.attacker.example:${p}`, "null", "not a url", "file://"];
      for (const origin of refused) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, origin }, body: INIT_BODY });
        assert.equal(reply.status, 403, origin);
        assert.equal(reply.headers["access-control-allow-origin"], undefined);
      }
      for (const origin of [`http://${LOOPBACK_V4}:${p}`, `http://localhost:${p}`]) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, origin }, body: INIT_BODY });
        assert.equal(reply.status, 200, origin);
        assert.equal(reply.headers["access-control-allow-origin"], undefined);
      }
    });

    test("a CORS preflight is not answered: no allow-origin or allow-methods header, with or without the token", async () => {
      for (const auth of [false, undefined] as const) {
        const reply = await send(bridge, { method: "OPTIONS", ...(auth === false ? { auth } : {}), headers: { origin: `http://${LOOPBACK_V4}:${bridge.port}`, "access-control-request-method": "POST" } });
        assert.ok([401, 405].includes(reply.status));
        assert.ok(Object.keys(reply.headers).every((k) => !k.startsWith("access-control-")));
      }
    });
  });

  describe("methods and paths: one route, one method", () => {
    test("every method but POST is refused on /mcp with 405 and Allow: POST", async () => {
      for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT", "PROPFIND"]) {
        let reply: Reply;
        try {
          reply = await send(bridge, { method });
        } catch {
          continue; // the HTTP client refused to emit it: nothing reached the adapter
        }
        assert.equal(reply.status, 405, method);
        assert.equal(reply.headers["allow"], "POST");
      }
    });

    test("POST to any other path is refused with 404, including the removed health route", async () => {
      const paths = ["/", "/health", "/mcp/", "/mcp?x=1", "/MCP", "//mcp", "/mcp%2f", "/mcp%00", "/%6Dcp", "/../mcp", "/mcp/../mcp", "/sse", "/messages", "/admin", `http://${LOOPBACK_V4}:${bridge.port}/mcp`];
      for (const path of paths) {
        const reply = await send(bridge, { path, headers: MCP_HEADERS, body: INIT_BODY });
        assert.equal(reply.status, 404, path);
      }
      assert.equal((await send(bridge, { method: "GET", path: "/health" })).status, 404);
    });

    test("a request target over 256 characters is refused with 414", async () => {
      const reply = await send(bridge, { path: `/mcp?${"a".repeat(300)}`, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 414);
    });
  });

  describe("content type and body", () => {
    test("anything but application/json is refused with 415", async () => {
      for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonx", "application/json-seq", "text/json", "application/xml", ""]) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, "content-type": contentType || undefined }, body: INIT_BODY });
        assert.equal(reply.status, 415, JSON.stringify(contentType));
      }
    });

    test("application/json with parameters and any letter case is accepted", async () => {
      for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, "content-type": contentType }, body: INIT_BODY });
        assert.equal(reply.status, 200, contentType);
      }
    });

    test("malformed, empty and truncated JSON is refused with 400 before MCP dispatch", async () => {
      for (const body of ["", "{", "not json", INIT_BODY.slice(0, 40), "{'a':1}", "\u0000", INIT_BODY + "}"]) {
        const reply = await send(bridge, { headers: MCP_HEADERS, body });
        assert.equal(reply.status, 400, JSON.stringify(body.slice(0, 20)));
        assert.deepEqual(JSON.parse(reply.text), { error: "bad request" });
      }
    });

    test("a declared Content-Length over 512 KiB is refused with 413 without the body being read", async () => {
      const reply = await send(bridge, { headers: MCP_HEADERS, declaredLength: 512 * 1024 + 1, body: "{" });
      assert.equal(reply.status, 413);
      assert.deepEqual(JSON.parse(reply.text), { error: "payload too large" });
    });

    test("a chunked body that grows past 512 KiB with no declared length is refused with 413", async () => {
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      const reply = await send(bridge, { headers: MCP_HEADERS, body: Array.from({ length: 10 }, () => chunk) });
      assert.equal(reply.status, 413);
    });

    test("an oversized JSON body is refused with 413", async () => {
      const reply = await send(bridge, { headers: MCP_HEADERS, body: JSON.stringify({ data: "x".repeat(512 * 1024) }) });
      assert.equal(reply.status, 413);
    });

    test("an invalid Content-Length is refused", async () => {
      for (const declared of ["abc", "-1", "1e3", "0x10"]) {
        const reply = await send(bridge, { headers: { ...MCP_HEADERS, "content-length": declared }, body: "{}" }).catch(() => ({ status: 400 }));
        assert.equal(reply.status, 400, declared);
      }
    });

    test("the adapter stays up and answers correctly after every refusal above", async () => {
      const reply = await send(bridge, { headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(reply.status, 200);
    });

    test("hostile object keys in tool arguments are refused by the engine over HTTP, and nothing is polluted", async () => {
      const call = (args: string): string =>
        `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"inspect_evidence","arguments":${args}}}`;
      const reply = await send(bridge, { headers: MCP_HEADERS, body: call('{"evaluatedAt":"2026-10-23T12:00:30Z","bundle":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}}') });
      assert.equal(reply.status, 200);
      assert.match(reply.text, /INVALID_INPUT/);
      assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
    });
  });

  describe("the token never leaves the adapter", () => {
    test("no response body or header, success or refusal, contains the token, a presented token or any request header value", async () => {
      const t = tokenOf();
      const probe = "canary-header-value-1f3a9c";
      const replies: Reply[] = [];
      const attempts: SendOptions[] = [
        { headers: MCP_HEADERS, body: INIT_BODY },
        { auth: false, headers: MCP_HEADERS, body: INIT_BODY },
        { auth: bearer(flip(t)), headers: MCP_HEADERS, body: INIT_BODY },
        { auth: bearer(`${t}${probe}`), headers: MCP_HEADERS, body: INIT_BODY },
        { auth: `Basic ${probe}`, headers: MCP_HEADERS, body: INIT_BODY },
        { method: "DELETE", headers: { "x-canary": probe } },
        { path: `/${probe}`, headers: MCP_HEADERS, body: INIT_BODY },
        { headers: { ...MCP_HEADERS, origin: `https://${probe}.example` }, body: INIT_BODY },
        { headers: { ...MCP_HEADERS, host: `${probe}.example` }, body: INIT_BODY },
        { headers: { ...MCP_HEADERS, "content-type": `text/${probe}` }, body: INIT_BODY },
        { headers: MCP_HEADERS, body: `{"canary":"${probe}"` },
        { headers: MCP_HEADERS, body: `{"jsonrpc":"2.0","id":1,"method":"${probe}","params":{}}` },
      ];
      for (const attempt of attempts) replies.push(await send(bridge, attempt));
      for (const reply of replies) {
        const everything = everythingOf(reply);
        assert.ok(!everything.includes(t), "the process token is never echoed");
        assert.ok(!everything.includes(probe), "no caller-supplied header, path or body text is echoed");
      }
    });

    test("after all of the traffic above the token still appears once in the process output and nowhere on stdout", () => {
      assert.equal(bridge.stderr().split(tokenOf()).length - 1, 1);
      assert.equal(bridge.stdout(), "");
      assert.equal(bridge.child.exitCode, null, "the adapter survived all hostile requests");
    });
  });
});

describe("optional HTTP adapter and stdio serve the same contract", () => {
  let bridge: Bridge;
  let http: Client;
  let stdio: Client;

  before(async () => {
    bridge = await startBridge();
    http = new Client({ name: "parity-http", version: "0" });
    await http.connect(new StreamableHTTPClientTransport(bridge.url, { requestInit: { headers: { authorization: bearer(bridge.token) } } }));
    stdio = new Client({ name: "parity-stdio", version: "0" });
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [ENTRIES.bundle], env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "" }, stderr: "pipe" }));
  });
  after(async () => {
    await http.close().catch(() => undefined);
    await stdio.close().catch(() => undefined);
    await stopBridge(bridge);
  });

  const bundle = golden();
  const calls: { name: string; arguments: Record<string, unknown> }[] = [
    { name: "resolve_asset", arguments: { chainId: "1", address: USDC } },
    { name: "resolve_asset", arguments: { symbol: "USDC" } },
    {
      name: "normalize_observation",
      arguments: { id: "obs-1", sourceId: "src-chain", origin: "CHAIN_OBSERVED", observedAt: EVALUATED_AT, finality: "FINALIZED", result: "VALUE", chainId: "1", token: USDC, holder: HOLDER, blockNumber: "21000000", blockHash: `0x${"ab".repeat(32)}`, balanceAtomic: "1500000", decimals: "6" },
    },
    { name: "inspect_evidence", arguments: { bundle, evaluatedAt: EVALUATED_AT } },
    { name: "check_invariants", arguments: { bundle, evaluatedAt: EVALUATED_AT } },
    { name: "trace_provenance", arguments: { bundle, assertionId: "a-balance" } },
    { name: "assess_vault_readiness", arguments: { bundle, evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" } },
    { name: "resolve_asset", arguments: { chainId: "1", address: USDC, extra: "1" } },
    { name: "inspect_evidence", arguments: { bundle: { wwepVersion: "0.1" }, evaluatedAt: EVALUATED_AT } },
    { name: "no_such_tool", arguments: {} },
  ];

  test("tool and resource listings are identical", async () => {
    assert.deepEqual(await http.listTools(), await stdio.listTools());
    assert.deepEqual(await http.listResources(), await stdio.listResources());
  });

  for (const call of calls) {
    test(`${call.name} (${Object.keys(call.arguments).join(", ") || "no arguments"}) answers identically over stdio and HTTP`, async () => {
      assert.deepEqual(await http.callTool(call).catch((e: Error) => e.message), await stdio.callTool(call).catch((e: Error) => e.message));
    });
  }

  test("every resource reads identically", async () => {
    for (const { uri } of (await stdio.listResources()).resources) assert.deepEqual(await http.readResource({ uri }), await stdio.readResource({ uri }), uri);
  });
});

describe("the HTTP adapter is in no release artifact and starts from no shipped manifest or workflow", () => {
  const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8");

  test("no shipped manifest, plugin file, package script or workflow names the adapter or starts an HTTP transport", () => {
    for (const p of ["plugin/mcp.json", "plugin/.mcp.json", "plugin/plugin.json", "plugin/.claude-plugin/plugin.json", "mcpb/manifest.json", "server.json", "package.json", "packages/mcp/package.json", ".github/workflows/ci.yml"]) {
      assert.ok(!/claude-mcp-http|streamable-http|--enable\b|--host\b/i.test(read(p)), p);
    }
  });

  test("the Copilot and Claude plugin MCP entries launch only the stdio bundle", () => {
    for (const p of ["plugin/mcp.json", "plugin/.mcp.json"]) {
      const parsed = JSON.parse(read(p)) as Record<string, unknown>;
      const servers = (parsed["mcpServers"] ?? parsed) as Record<string, { command?: string; args?: string[]; url?: string }>;
      const entries = Object.entries(servers).filter(([name]) => !name.startsWith("$"));
      assert.ok(entries.length > 0, p);
      for (const [, server] of entries) {
        assert.equal(server.url, undefined, "a stdio entry has no URL");
        assert.ok((server.args ?? []).every((a) => !a.startsWith("--")), "no flag, so no adapter mode");
        assert.ok((server.args ?? []).some((a) => a.endsWith("walletwall-mcp.mjs")));
      }
    }
  });

  test("the adapter script is outside the published package and the shipped bundle does not contain it", () => {
    const pkg = JSON.parse(read("packages/mcp/package.json")) as { files: string[] };
    assert.ok(pkg.files.every((f) => !f.includes("scripts")));
    const bundle = read("plugin/server/walletwall-mcp.mjs");
    assert.ok(!/bearer-token|--enable|StreamableHTTP|node:http/.test(bundle));
  });

  test("the Cloud Run deployment that required an external bind is withdrawn", () => {
    assert.ok(!existsSync(`${ROOT}scripts/cloud-run`));
    assert.ok(!existsSync(`${ROOT}docs/CLOUD_RUN_MCP.md`));
  });
});
