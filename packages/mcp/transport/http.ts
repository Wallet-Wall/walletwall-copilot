import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "../src/server.ts";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024;

class RequestRejected extends Error {
  constructor(readonly statusCode: number) {
    super("request rejected");
  }
}

function fatal(): never {
  process.stderr.write("walletwall-mcp-http: fatal error\n");
  process.exit(1);
}

function parsePort(argv: readonly string[]): number {
  let port = DEFAULT_PORT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) throw new Error("invalid argument");

    let raw: string | undefined;
    if (arg === "--port") {
      raw = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--port=")) {
      raw = arg.slice("--port=".length);
    } else {
      throw new Error("unsupported argument");
    }

    if (raw === undefined || !/^\d{1,5}$/.test(raw)) throw new Error("invalid port");
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error("invalid port");
    port = value;
  }

  return port;
}

function sendFixed(res: ServerResponse, statusCode: number): void {
  const message =
    statusCode === 400 ? "bad request" :
    statusCode === 403 ? "forbidden" :
    statusCode === 404 ? "not found" :
    statusCode === 405 ? "method not allowed" :
    statusCode === 413 ? "payload too large" :
    statusCode === 415 ? "unsupported media type" :
    "internal server error";

  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify({ error: message }));
}

function allowedOrigin(value: string | undefined, port: number): boolean {
  if (value === undefined) return true;

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
  if (typeof declared === "string" && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
    throw new RequestRejected(413);
  }

  const chunks: Buffer[] = [];
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  if (req.url !== "/mcp") {
    sendFixed(res, 404);
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendFixed(res, 405);
    return;
  }
  if (!allowedOrigin(req.headers.origin, port)) {
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

  const mcp = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } finally {
    await mcp.close().catch(() => undefined);
  }
}

let requestedPort: number;
try {
  requestedPort = parsePort(process.argv.slice(2));
} catch {
  fatal();
}

let boundPort = requestedPort;
const httpServer = createHttpServer((req, res) => {
  void handleRequest(req, res, boundPort).catch((error: unknown) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendFixed(res, error instanceof RequestRejected ? error.statusCode : 500);
  });
});

httpServer.maxHeadersCount = 64;
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});
httpServer.on("error", fatal);
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

function shutdown(): void {
  httpServer.close(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

httpServer.listen(requestedPort, HOST, () => {
  const address = httpServer.address();
  if (address === null || typeof address === "string") fatal();
  boundPort = address.port;
  process.stderr.write(`walletwall-mcp-http: streamable-http http://${HOST}:${boundPort}/mcp\n`);
});
