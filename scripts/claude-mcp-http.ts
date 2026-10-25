import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "../packages/mcp/src/server.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_URL_LENGTH = 256;

class RequestRejected extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("request rejected");
    this.statusCode = statusCode;
  }
}

function fatal(): never {
  process.stderr.write("walletwall-mcp-http: fatal error\n");
  process.exit(1);
}

function parsePort(raw: string): number {
  if (!/^\d{1,5}$/.test(raw)) throw new Error("invalid port");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error("invalid port");
  return value;
}

function parseArgs(argv: readonly string[], envPort: string | undefined): { host: string; port: number } {
  let host = DEFAULT_HOST;
  let port: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) throw new Error("invalid argument");

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
      throw new Error("unsupported argument");
    }

    if (raw === undefined) throw new Error("missing value");
    if (key === "host") {
      if (raw !== "127.0.0.1" && raw !== "0.0.0.0") throw new Error("invalid host");
      host = raw;
      continue;
    }

    port = parsePort(raw);
  }

  if (port === undefined) port = envPort === undefined ? DEFAULT_PORT : parsePort(envPort);
  return { host, port };
}

function sendFixed(res: ServerResponse, statusCode: number): void {
  const message =
    statusCode === 400 ? "bad request" :
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
  res.end(JSON.stringify({ error: message }));
}

function allowedOrigin(value: string | undefined, host: string, port: number): boolean {
  if (value === undefined) return true;
  if (host !== "127.0.0.1") return false;

  try {
    const origin = new URL(value);
    const originPort = origin.port === "" ? 80 : Number(origin.port);
    return (
      origin.protocol === "http:" &&
      (origin.hostname === "127.0.0.1" || origin.hostname === "localhost") &&
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, host: string, port: number): Promise<void> {
  if (req.url === undefined || req.url.length > MAX_URL_LENGTH) {
    sendFixed(res, req.url === undefined ? 400 : 414);
    return;
  }

  if (req.url === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok" }));
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
  if (!allowedOrigin(req.headers.origin, host, port)) {
    sendFixed(res, 403);
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

let requestedHost: string;
let requestedPort: number;
try {
  ({ host: requestedHost, port: requestedPort } = parseArgs(process.argv.slice(2), process.env.PORT));
} catch {
  fatal();
}

let boundPort = requestedPort;
const httpServer = createHttpServer((req, res) => {
  void handleRequest(req, res, requestedHost, boundPort).catch((error: unknown) => {
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

function shutdown(): void {
  httpServer.close(() => process.exit(0));
  httpServer.closeIdleConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

httpServer.listen(requestedPort, requestedHost, () => {
  const address = httpServer.address();
  if (address === null || typeof address === "string") fatal();
  boundPort = address.port;
  process.stderr.write(`walletwall-mcp-http: streamable-http http://${requestedHost}:${boundPort}/mcp\n`);
});
