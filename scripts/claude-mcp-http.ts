import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "../packages/mcp/src/server.ts";

/**
 * Optional, user-run Streamable HTTP adapter for the WalletWall MCP contract.
 *
 * It is off unless `--enable` is passed, binds only to a loopback address (there is no external-bind mode), and
 * requires a per-process bearer token on every request. The token is generated from the operating system's CSPRNG
 * when the process starts, is never read from the environment or a file, is never written to disk, and is shown once
 * on the operator's terminal (stderr). It dies with the process. Every request is checked in this order: request-target length,
 * Host, Origin, token, then route, method, content type and body size, so a caller without the token learns nothing about routes.
 */

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_URL_LENGTH = 256;
/** 32 random bytes = 256 bits, encoded as 43 base64url characters without padding. */
const TOKEN_BYTES = 32;
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{43})$/i;

/** The only addresses the adapter will bind. The value is how that address appears in a URL and in a Host header. */
const LOOPBACK_BINDS: Readonly<Record<string, string>> = { "127.0.0.1": "127.0.0.1", "::1": "[::1]" };

class RequestRejected extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("request rejected");
    this.statusCode = statusCode;
  }
}

/** Refusals carry a fixed reason. The text of a rejected argument is never echoed. */
class UsageError extends Error {}

function fatal(): never {
  process.stderr.write("walletwall-mcp-http: fatal error\n");
  process.exit(1);
}

function parsePort(raw: string): number {
  if (!/^\d{1,5}$/.test(raw)) throw new UsageError("invalid port");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new UsageError("invalid port");
  return value;
}

interface Options {
  enabled: boolean;
  host: string;
  port: number;
}

function parseArgs(argv: readonly string[]): Options {
  let enabled = false;
  let host = "127.0.0.1";
  let port: number | undefined;
  let hostSeen = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) throw new UsageError("unsupported argument");
    if (arg === "--enable") {
      if (enabled) throw new UsageError("duplicate argument");
      enabled = true;
      continue;
    }

    let key: "host" | "port";
    let raw: string | undefined;
    if (arg === "--port") {
      key = "port";
      raw = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--port=")) {
      key = "port";
      raw = arg.slice("--port=".length);
    } else if (arg === "--host") {
      key = "host";
      raw = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--host=")) {
      key = "host";
      raw = arg.slice("--host=".length);
    } else {
      throw new UsageError("unsupported argument");
    }

    if (raw === undefined) throw new UsageError("missing value");
    if (key === "host") {
      if (hostSeen) throw new UsageError("duplicate argument");
      hostSeen = true;
      if (!Object.hasOwn(LOOPBACK_BINDS, raw)) throw new UsageError("invalid host: only the loopback addresses 127.0.0.1 and ::1 are accepted");
      host = raw;
      continue;
    }

    if (port !== undefined) throw new UsageError("duplicate argument");
    port = parsePort(raw);
  }

  return { enabled, host, port: port ?? DEFAULT_PORT };
}

function sendFixed(res: ServerResponse, statusCode: number): void {
  const message =
    statusCode === 400 ? "bad request" :
    statusCode === 401 ? "unauthorized" :
    statusCode === 403 ? "forbidden" :
    statusCode === 404 ? "not found" :
    statusCode === 405 ? "method not allowed" :
    statusCode === 413 ? "payload too large" :
    statusCode === 414 ? "uri too long" :
    statusCode === 415 ? "unsupported media type" :
    "internal server error";

  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  // A refused request may carry an unread body: do not reuse the connection.
  res.setHeader("connection", "close");
  if (statusCode === 401) res.setHeader("www-authenticate", "Bearer");
  res.end(JSON.stringify({ error: message }));
}

/** DNS-rebinding defence: the Host header must name the loopback listener exactly. A request without one is refused. */
function allowedHost(value: string | undefined, bindHost: string, port: number): boolean {
  if (value === undefined) return false;
  return [`${LOOPBACK_BINDS[bindHost]}:${port}`, `localhost:${port}`].includes(value.toLowerCase());
}

function allowedOrigin(value: string | undefined, port: number): boolean {
  if (value === undefined) return true;

  try {
    const origin = new URL(value);
    const originPort = origin.port === "" ? 80 : Number(origin.port);
    return (
      origin.protocol === "http:" &&
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost" || origin.hostname === "[::1]") &&
      originPort === port &&
      origin.username === "" &&
      origin.password === "" &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === ""
    );
  } catch {
    return false;
  }
}

/** Constant-time comparison of equal-length buffers. A malformed header never reaches the comparison. */
function authorized(header: string | undefined, expected: Buffer): boolean {
  if (header === undefined) return false;
  const match = BEARER_RE.exec(header);
  if (match?.[1] === undefined) return false;
  const presented = Buffer.from(match[1], "utf8");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers["content-length"];
  if (Array.isArray(declared)) throw new RequestRejected(400);
  if (typeof declared === "string") {
    if (!/^\d+$/.test(declared)) throw new RequestRejected(400);
    if (Number(declared) > MAX_BODY_BYTES) throw new RequestRejected(413);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_BODY_BYTES) throw new RequestRejected(413);
    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestRejected(400);
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, bindHost: string, port: number, token: Buffer): Promise<void> {
  if (req.url === undefined || req.url.length > MAX_URL_LENGTH) {
    sendFixed(res, req.url === undefined ? 400 : 414);
    return;
  }
  // Cheap structural checks first, then authentication, then routing: a caller without the token learns nothing about
  // which routes or methods exist.
  if (!allowedHost(req.headers.host, bindHost, port)) {
    sendFixed(res, 403);
    return;
  }
  if (!allowedOrigin(req.headers.origin, port)) {
    sendFixed(res, 403);
    return;
  }
  if (!authorized(req.headers.authorization, token)) {
    sendFixed(res, 401);
    return;
  }
  if (req.url !== "/mcp") {
    sendFixed(res, 404);
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendFixed(res, 405);
    return;
  }

  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    sendFixed(res, 415);
    return;
  }

  const body = await readJsonBody(req);
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");

  const mcp = createMcpServer();
  // In the pinned SDK, omitting sessionIdGenerator leaves it undefined: stateless mode.
  // A fresh MCP server and transport are created for every POST, so no client session
  // state can be shared between requests.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    await mcp.close().catch(() => undefined);
  }
}

function start(): void {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`walletwall-mcp-http: refused: ${error instanceof UsageError ? error.message : "invalid arguments"}\n`);
    return;
  }
  if (!options.enabled) {
    process.exitCode = 1;
    process.stderr.write("walletwall-mcp-http: disabled: pass --enable to start the loopback-only, token-authenticated adapter\n");
    return;
  }

  const requestedHost = options.host;
  // A new secret for every process start: never read from the environment, a file or the command line, and never written to disk.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenBytes = Buffer.from(token, "utf8");

  let boundPort = options.port;
  const httpServer = createHttpServer((req, res) => {
    void handleRequest(req, res, requestedHost, boundPort, tokenBytes).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendFixed(res, error instanceof RequestRejected ? error.statusCode : 500);
    });
  });

  httpServer.maxHeadersCount = 48;
  httpServer.requestTimeout = 20_000;
  httpServer.headersTimeout = 5_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxRequestsPerSocket = 100;
  httpServer.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  httpServer.on("error", fatal);
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);

  const shutdown = (): void => {
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  httpServer.listen(options.port, requestedHost, () => {
    const address = httpServer.address();
    if (address === null || typeof address === "string" || address.address !== requestedHost) fatal();
    boundPort = address.port;
    // The only place the token is ever emitted: one line, to the operator's terminal. Do not redirect it to a persistent log.
    process.stderr.write(`walletwall-mcp-http: streamable-http http://${LOOPBACK_BINDS[requestedHost]}:${boundPort}/mcp\n`);
    process.stderr.write(`walletwall-mcp-http: bearer-token ${token}\n`);
  });
}

start();
