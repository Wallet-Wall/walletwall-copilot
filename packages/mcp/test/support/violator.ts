// Positive-control script. It deliberately attempts forbidden operations so the guard can prove it detects them.
// Every attempt targets an unroutable or non-existent resource and is blocked by the guard before it executes.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const attempts: Record<string, () => unknown> = {
  fetch: () => fetch("https://walletwall-control.invalid/ping"),
  netConnect: () => (require("node:net") as typeof import("node:net")).connect(9, "127.0.0.1"),
  httpRequest: () => (require("node:http") as typeof import("node:http")).request("http://walletwall-control.invalid/"),
  dnsLookup: () => (require("node:dns") as typeof import("node:dns")).lookup("walletwall-control.invalid", () => undefined),
  listen: () => (require("node:net") as typeof import("node:net")).createServer().listen(0),
  writeFile: () => (require("node:fs") as typeof import("node:fs")).writeFileSync(`${process.cwd()}/ww-control-should-not-exist.txt`, "x"),
  mkdir: () => (require("node:fs") as typeof import("node:fs")).mkdirSync(`${process.cwd()}/ww-control-dir`),
  openForWrite: () => (require("node:fs") as typeof import("node:fs")).openSync(`${process.cwd()}/ww-control-open.txt`, "w"),
  spawn: () => (require("node:child_process") as typeof import("node:child_process")).spawnSync(process.execPath, ["-e", "0"]),
  randomUUID: () => (require("node:crypto") as typeof import("node:crypto")).randomUUID(),
  hostname: () => (require("node:os") as typeof import("node:os")).hostname(),
};
const results: Record<string, string> = {};
for (const [name, fn] of Object.entries(attempts)) {
  try {
    const r = fn();
    if (r instanceof Promise) await r.catch(() => undefined);
    results[name] = "ALLOWED";
  } catch (e) {
    results[name] = String((e as Error).message).startsWith("WW_GUARD_BLOCKED") ? "BLOCKED" : "ERROR";
  }
}
process.stdout.write(`${JSON.stringify(results)}\n`);
