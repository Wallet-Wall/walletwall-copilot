import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, type Socket } from "node:net";
import { after, describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";

/**
 * The documented adapter timeouts, measured from outside over raw sockets. Every test starts its own adapter, so a sweep
 * cannot happen to fall just after a test connects and hide a slow one. Node's default sweep runs every 30 seconds, which
 * would close both unfinished requests around the 30-second mark whatever the configured timeouts say.
 *
 * The bounds allow for a loaded runner: a close must not come early, and may come a few seconds late. They are not
 * millisecond expectations.
 */
const HEADERS_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const LATE_BY_AT_MOST_MS = 4_000;
const GIVE_UP_AFTER_MS = 45_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything this file opens. A broken adapter must fail these tests, not hang the run: a live child or socket would keep the runner alive. */
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
const liveSockets = new Set<Socket>();
after(() => {
  for (const socket of liveSockets) socket.destroy();
  for (const child of liveChildren) child.kill("SIGKILL");
});

interface Adapter {
  child: ChildProcessWithoutNullStreams;
  port: number;
  token: string;
}

function startAdapter(): Promise<Adapter> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`${ROOT}scripts/claude-mcp-http.ts`, "--enable", "--port", "0"], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    liveChildren.add(child);
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("adapter did not start"));
    }, 20_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const url = /streamable-http http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(stderr);
      const token = /bearer-token ([A-Za-z0-9_-]{43})/.exec(stderr);
      if (url?.[1] !== undefined && token?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, port: Number(url[1]), token: token[1] });
      }
    });
    child.once("exit", (code) => {
      liveChildren.delete(child);
      clearTimeout(timer);
      reject(new Error(`adapter exited before ready (${String(code)})`));
    });
  });
}

async function stopAdapter(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function open(port: number, allowHalfOpen = false): Socket {
  const socket = connect({ host: "127.0.0.1", port, allowHalfOpen });
  liveSockets.add(socket);
  socket.once("close", () => liveSockets.delete(socket));
  return socket;
}

interface Closed {
  ms: number;
  received: string;
  /** The connection ended in an error rather than a clean close. */
  reset: boolean;
}

/** Writes `first` and returns when the server closes the socket, or fails after GIVE_UP_AFTER_MS. */
function closedAfter(port: number, first: string): Promise<Closed> {
  return new Promise((resolve, reject) => {
    const socket = open(port);
    const started = performance.now();
    let received = "";
    let reset = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`not closed within ${String(GIVE_UP_AFTER_MS)} ms`));
    }, GIVE_UP_AFTER_MS);
    socket.on("connect", () => socket.write(first));
    socket.on("data", (d: Buffer) => {
      received += d.toString("latin1");
    });
    socket.on("error", () => {
      reset = true;
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve({ ms: performance.now() - started, received, reset });
    });
  });
}

interface Cut {
  finAfterMs: number;
  socket: Socket;
  received: () => string;
  serverSocketGone: () => boolean;
}

/**
 * A client that never closes its side: the server's FIN does not close this socket. Returns at that FIN, having written nothing else.
 * This is what a stalled, non-cooperating client looks like to the adapter.
 */
function cutOff(port: number, first: string): Promise<Cut> {
  return new Promise((resolve, reject) => {
    const socket = open(port, true);
    const started = performance.now();
    let received = "";
    let serverSocketGone = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no FIN within ${String(GIVE_UP_AFTER_MS)} ms`));
    }, GIVE_UP_AFTER_MS);
    socket.on("connect", () => socket.write(first));
    socket.on("data", (d: Buffer) => {
      received += d.toString("latin1");
    });
    socket.on("error", () => {
      serverSocketGone = true;
    });
    socket.once("end", () => {
      clearTimeout(timer);
      resolve({ finAfterMs: performance.now() - started, socket, received: () => received, serverSocketGone: () => serverSocketGone });
    });
  });
}

/**
 * After the cut, sends `late` on the same connection and reports whether the server's socket was gone. A response could not show it
 * either way: after the FIN nothing more can reach this client, even from a server that goes on to read the rest of the request and
 * run it. A socket the server closed resets the first write, which fails the next.
 */
async function cutThenLate(port: number, first: string, late: string, settleMs = 0): Promise<{ finAfterMs: number; received: string; serverSocketGone: boolean }> {
  const cut = await cutOff(port, first);
  await sleep(settleMs);
  cut.socket.write(late);
  await sleep(1_000);
  cut.socket.write("\r\n");
  await sleep(1_000);
  return { finAfterMs: cut.finAfterMs, received: cut.received(), serverSocketGone: cut.serverSocketGone() };
}

const INITIALIZE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "timeouts", version: "0" } } });
const INITIALIZE_BYTES = Buffer.byteLength(INITIALIZE);
const LIST_TOOLS = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const HOST = ({ port }: Adapter): string => `Host: 127.0.0.1:${String(port)}\r\n`;
const REST_OF_HEAD = ({ token }: Adapter, length: number, connection = "close"): string =>
  `Authorization: Bearer ${token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nConnection: ${connection}\r\nContent-Length: ${String(length)}\r\n\r\n`;
const POST_HEAD = (adapter: Adapter, length: number, connection?: string): string => `POST /mcp HTTP/1.1\r\n${HOST(adapter)}${REST_OF_HEAD(adapter, length, connection)}`;

describe("optional Streamable HTTP MCP bridge: documented timeouts", { concurrency: true, timeout: 90_000 }, () => {
  test("headers that never finish are cut off at the documented 5 seconds, not at the next 30-second sweep", async () => {
    const adapter = await startAdapter();
    try {
      const { ms, received } = await closedAfter(adapter.port, `POST /mcp HTTP/1.1\r\n${HOST(adapter)}`);
      assert.ok(ms >= HEADERS_TIMEOUT_MS - 500, `closed early: ${String(ms)} ms`);
      assert.ok(ms <= HEADERS_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `closed late: ${String(ms)} ms`);
      assert.match(received, /^HTTP\/1\.1 4\d\d /, "the client is told, not just dropped");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a connection that never sends a byte is cut off at the same limit", async () => {
    const adapter = await startAdapter();
    try {
      const { ms } = await closedAfter(adapter.port, "");
      assert.ok(ms >= HEADERS_TIMEOUT_MS - 500, `closed early: ${String(ms)} ms`);
      assert.ok(ms <= HEADERS_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `closed late: ${String(ms)} ms`);
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a request whose body never finishes is cut off at the documented 20 seconds", async () => {
    const adapter = await startAdapter();
    try {
      const { ms, received } = await closedAfter(adapter.port, `${POST_HEAD(adapter, 1000)}{`);
      assert.ok(ms >= REQUEST_TIMEOUT_MS - 500, `closed early: ${String(ms)} ms`);
      assert.ok(ms <= REQUEST_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `closed late: ${String(ms)} ms`);
      assert.match(received, /^HTTP\/1\.1 4\d\d /);
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a slow but healthy call survives past the headers timeout and is answered", async () => {
    const adapter = await startAdapter();
    try {
      const socket = open(adapter.port);
      let received = "";
      socket.on("data", (d: Buffer) => {
        received += d.toString("latin1");
      });
      socket.on("error", () => undefined);
      const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
      await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
      socket.write(POST_HEAD(adapter, INITIALIZE_BYTES));
      // Well past the 5-second headers timeout and several 1-second sweeps, still inside the 20-second request timeout.
      const half = Math.floor(INITIALIZE.length / 2);
      socket.write(INITIALIZE.slice(0, half));
      await sleep(HEADERS_TIMEOUT_MS + 2_000);
      socket.write(INITIALIZE.slice(half));
      await closed;
      assert.match(received, /^HTTP\/1\.1 200 /);
      assert.ok(received.includes('"walletwall-mcp"'), "the MCP answer arrived");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a client that never closes its side is cut off too: the rest of its headers finds the socket closed", async () => {
    const adapter = await startAdapter();
    try {
      const { finAfterMs, received, serverSocketGone } = await cutThenLate(adapter.port, `POST /mcp HTTP/1.1\r\n${HOST(adapter)}`, `${REST_OF_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      assert.ok(finAfterMs <= HEADERS_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `cut late: ${String(finAfterMs)} ms`);
      assert.match(received, /^HTTP\/1\.1 4\d\d /);
      assert.ok(serverSocketGone, "a request that timed out must not stay readable: its rest would run");
      const next = await closedAfter(adapter.port, `${POST_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      assert.match(next.received, /^HTTP\/1\.1 200 /, "and the adapter keeps serving");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a client that never closes its side is cut off too: the rest of its body finds the socket closed", async () => {
    const adapter = await startAdapter();
    try {
      const half = Math.floor(INITIALIZE.length / 2);
      const { finAfterMs, received, serverSocketGone } = await cutThenLate(adapter.port, `${POST_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE.slice(0, half)}`, INITIALIZE.slice(half));
      assert.ok(finAfterMs <= REQUEST_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `cut late: ${String(finAfterMs)} ms`);
      assert.match(received, /^HTTP\/1\.1 4\d\d /);
      assert.ok(serverSocketGone, "a request that timed out must not stay readable: its rest would run");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a client that has stopped reading is cut off too: with its answers undelivered, the rest of its request finds the socket closed", async () => {
    const adapter = await startAdapter();
    try {
      // Answers enough to back up on the way to a client that reads nothing, and the start of one more request, in one write so the adapter reads it all first.
      const calls = `${POST_HEAD(adapter, Buffer.byteLength(LIST_TOOLS), "keep-alive")}${LIST_TOOLS}`.repeat(99);
      const socket = open(adapter.port);
      socket.pause();
      let serverSocketGone = false;
      socket.on("error", () => {
        serverSocketGone = true;
      });
      socket.on("connect", () => socket.write(`${calls}POST /mcp HTTP/1.1\r\n${HOST(adapter)}`));
      await sleep(HEADERS_TIMEOUT_MS + LATE_BY_AT_MOST_MS);
      socket.write(`${REST_OF_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      await sleep(1_000);
      socket.write("\r\n");
      await sleep(1_000);
      assert.ok(serverSocketGone, "a request that timed out must not stay readable behind responses the client will not read");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  // SIGTERM on Windows ends the process at once, whatever it holds, so this can only be observed elsewhere.
  test("a client already cut off, which never closes its side, does not hold up shutdown", { skip: process.platform === "win32" }, async () => {
    const adapter = await startAdapter();
    const { child } = adapter;
    try {
      // Nothing more is written after the cut: another line would complete the request, and a connection with its answer written counts as idle at shutdown.
      await cutOff(adapter.port, `POST /mcp HTTP/1.1\r\n${HOST(adapter)}`);
      const started = performance.now();
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const inTime = await Promise.race([exited.then(() => true), sleep(3_000).then(() => false)]);
      assert.ok(inTime, `still running ${String(performance.now() - started)} ms after SIGTERM with a cut client attached`);
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("a malformed request keeps its refusal: an oversized header with bytes still unread gets a clean 400, not a reset", async () => {
    const adapter = await startAdapter();
    try {
      // Far past Node's 16 KiB header limit. Destroying a socket with these bytes unread resets the connection, which can lose the response, so more than one try.
      const oversized = `GET / HTTP/1.1\r\n${HOST(adapter)}X-Padding: ${"x".repeat(200_000)}\r\n\r\n`;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const { received, reset } = await closedAfter(adapter.port, oversized);
        assert.match(received, /^HTTP\/1\.1 400 /, `attempt ${String(attempt)}`);
        assert.equal(reset, false, `attempt ${String(attempt)} ended in a reset`);
      }
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a malformed request from a client that never closes its side is told at once and dropped by the headers timeout", async () => {
    const adapter = await startAdapter();
    try {
      const { finAfterMs, received, serverSocketGone } = await cutThenLate(adapter.port, "NOT HTTP AT ALL\r\n\r\n", "x", HEADERS_TIMEOUT_MS + LATE_BY_AT_MOST_MS);
      assert.ok(finAfterMs < HEADERS_TIMEOUT_MS, `refused late: ${String(finAfterMs)} ms`);
      assert.match(received, /^HTTP\/1\.1 400 /);
      assert.ok(serverSocketGone, "the connection must not hold its descriptor for as long as the client likes");
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("an idle keep-alive connection closes near the keep-alive timeout", async () => {
    const adapter = await startAdapter();
    try {
      const { ms, received } = await closedAfter(adapter.port, `${POST_HEAD(adapter, INITIALIZE_BYTES, "keep-alive")}${INITIALIZE}`);
      assert.match(received, /^HTTP\/1\.1 200 /);
      assert.ok(ms >= KEEP_ALIVE_TIMEOUT_MS - 1_000, `closed early: ${String(ms)} ms`);
      assert.ok(ms <= KEEP_ALIVE_TIMEOUT_MS + LATE_BY_AT_MOST_MS, `closed late: ${String(ms)} ms`);
    } finally {
      await stopAdapter(adapter.child);
    }
  });

  test("a healthy call is answered at once and the Host, Origin and token checks are unchanged", async () => {
    const adapter = await startAdapter();
    const { port } = adapter;
    try {
      const fast = await closedAfter(port, `${POST_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      assert.match(fast.received, /^HTTP\/1\.1 200 /);
      assert.ok(fast.ms < HEADERS_TIMEOUT_MS, `a complete request was held open: ${String(fast.ms)} ms`);
      const foreignOrigin = await closedAfter(port, `POST /mcp HTTP/1.1\r\n${HOST(adapter)}Origin: https://attacker.example\r\n${REST_OF_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      assert.match(foreignOrigin.received, /^HTTP\/1\.1 403 /, "foreign browser origins stay refused");
      const foreignHost = await closedAfter(port, `POST /mcp HTTP/1.1\r\nHost: attacker.example\r\n${REST_OF_HEAD(adapter, INITIALIZE_BYTES)}${INITIALIZE}`);
      assert.match(foreignHost.received, /^HTTP\/1\.1 403 /, "a foreign Host stays refused");
      const noToken = await closedAfter(port, `POST /mcp HTTP/1.1\r\n${HOST(adapter)}Content-Type: application/json\r\nConnection: close\r\nContent-Length: ${String(INITIALIZE_BYTES)}\r\n\r\n${INITIALIZE}`);
      assert.match(noToken.received, /^HTTP\/1\.1 401 /, "a request without the token stays refused");
    } finally {
      await stopAdapter(adapter.child);
    }
  });
});
