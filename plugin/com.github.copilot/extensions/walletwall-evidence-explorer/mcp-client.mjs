// Minimal stdio client for the bundled WalletWall MCP server. The WalletWall canvas asks the real MCP server (the same
// file the plugin launches) for every state it displays; it never computes support, freshness, finality or conflicts.
//
// The server is started per request, receives a minimal environment, and is closed again. Nothing is cached on disk.
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

export class McpCallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "McpCallError";
    this.code = code;
  }
}

/**
 * Runs `calls` (each `{ name, arguments }`) against one short-lived server process and resolves to one result per call:
 * `{ name, ok: true, structured }` or `{ name, ok: false, errorCode }`.
 */
export function callTools({ command, args, calls, timeoutMs = 20_000, onStderr }) {
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH ?? "" };
    if (process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot;
    let child;
    try {
      // stderr is discarded unless a test instrument asks for it; the server writes nothing to it in normal operation.
      child = spawn(command, args, { stdio: ["pipe", "pipe", onStderr ? "pipe" : "ignore"], env, windowsHide: true });
      child.stderr?.on("data", (d) => onStderr?.(d.toString("utf8")));
    } catch {
      reject(new McpCallError("MCP_LAUNCH_FAILED", "The WalletWall MCP server could not be started."));
      return;
    }

    const results = new Array(calls.length);
    let received = 0;
    let buffer = "";
    let settled = false;
    let closed = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      if (err) {
        child.kill();
        reject(err);
      } else if (onStderr && !closed) {
        // A test instrument is reading stderr: let the server exit so its last diagnostic line is delivered first.
        child.once("close", () => resolve(results));
      } else resolve(results);
    };
    const timer = setTimeout(() => finish(new McpCallError("MCP_TIMEOUT", "The WalletWall MCP server did not answer in time.")), timeoutMs);

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on("error", () => finish(new McpCallError("MCP_LAUNCH_FAILED", "The WalletWall MCP server could not be started.")));
    child.on("close", () => {
      closed = true;
      finish(received === calls.length ? undefined : new McpCallError("MCP_EXITED", "The WalletWall MCP server exited early."));
    });
    child.stdin.on("error", () => {});

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 0) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          calls.forEach((c, i) => send({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: c.name, arguments: c.arguments } }));
        } else if (typeof message.id === "number" && message.id >= 1 && results[message.id - 1] === undefined) {
          const call = calls[message.id - 1];
          const r = message.result;
          if (message.error !== undefined || r === undefined) results[message.id - 1] = { name: call.name, ok: false, errorCode: "PROTOCOL_ERROR" };
          else if (r.isError === true) {
            let code = "TOOL_ERROR";
            try {
              code = JSON.parse(r.content?.[0]?.text ?? "{}").error?.code ?? code;
            } catch {
              // keep the generic code
            }
            results[message.id - 1] = { name: call.name, ok: false, errorCode: code };
          } else results[message.id - 1] = { name: call.name, ok: true, structured: r.structuredContent };
          received++;
          if (received === calls.length) finish();
        }
      }
    });

    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "walletwall-evidence-explorer", version: "0.1.0" } } });
  });
}
