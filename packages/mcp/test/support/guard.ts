/**
 * Privacy test guard. Loaded into the MCP server process with `node --import <this file>`.
 * It blocks and records any attempt to use the network, write the filesystem, spawn a process, or read
 * machine identity, and prints one report line to stderr at exit. It is a test instrument only; the shipped
 * server never loads it. Its own effectiveness is proven by a positive control (privacy.guard.test.ts).
 */
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);

type Kind = "network" | "dns" | "fsWrite" | "spawn" | "random" | "fingerprint";
const report: Record<Kind, string[]> = { network: [], dns: [], fsWrite: [], spawn: [], random: [], fingerprint: [] };

/**
 * `WW_GUARD_PROFILE=canvas` is for the Evidence Explorer process only. It still blocks and records every outbound or
 * non-loopback network use, every filesystem write and every spawn except the bundled MCP server, but it permits (and
 * records) the one loopback listener and loopback connections to it. The MCP server itself never runs in this profile.
 */
const CANVAS = process.env["WW_GUARD_PROFILE"] === "canvas";
const canvas = { listen: [] as string[], loopbackConnect: [] as string[], spawnAllowed: [] as string[] };

const fs = require("node:fs") as typeof import("node:fs");
const realWriteSync = fs.writeSync.bind(fs);

function record(kind: Kind, api: string): void {
  report[kind].push(api);
}

function blocked(kind: Kind, api: string): never {
  record(kind, api);
  throw new Error(`WW_GUARD_BLOCKED:${api}`);
}

type AnyFn = (...args: unknown[]) => unknown;
type Bag = Record<string, unknown>;

function patchBlock(obj: Bag | undefined, names: readonly string[], kind: Kind, label: string): void {
  if (obj === undefined) return;
  for (const name of names) {
    if (typeof obj[name] !== "function") continue;
    obj[name] = (): never => blocked(kind, `${label}.${name}`);
  }
}

function patchObserve(obj: Bag, names: readonly string[], kind: Kind, label: string): void {
  for (const name of names) {
    const orig = obj[name];
    if (typeof orig !== "function") continue;
    try {
      obj[name] = function (this: unknown, ...args: unknown[]): unknown {
        record(kind, `${label}.${name}`);
        return (orig as AnyFn).apply(this, args);
      };
    } catch {
      // accessor-only export; cannot be observed this way
    }
  }
}

const c = fs.constants;
const WRITE_BITS = c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND;
function isWriteFlags(flags: unknown): boolean {
  if (flags === undefined || flags === null) return false;
  if (typeof flags === "number") return (flags & WRITE_BITS) !== 0;
  return typeof flags === "string" && /[wa+]/.test(flags);
}

// Network
const net = require("node:net") as Bag & { Socket: { prototype: Bag }; Server: { prototype: Bag } };
if (CANVAS) {
  // Canvas profile: the Evidence Explorer binds one loopback listener and its page is fetched from loopback. Everything
  // else stays blocked and recorded. http and net.createServer sit on net.Server and net.Socket, so patching those two
  // methods covers them.
  const loopback = (host: unknown): boolean => host === "127.0.0.1";
  const origListen = net.Server.prototype["listen"] as AnyFn;
  net.Server.prototype["listen"] = function (this: unknown, ...args: unknown[]): unknown {
    const first = args[0];
    const host = typeof first === "object" && first !== null ? (first as Bag)["host"] : args.find((a, i) => i > 0 && typeof a === "string");
    if (!loopback(host)) return blocked("network", `net.Server.listen(${typeof host === "string" ? host : "all-interfaces"})`);
    canvas.listen.push(String(host));
    return origListen.apply(this, args);
  };
  const origConnect = net.Socket.prototype["connect"] as AnyFn;
  net.Socket.prototype["connect"] = function (this: unknown, ...args: unknown[]): unknown {
    // net.connect hands connect() an already normalized [options, callback] array.
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const host = typeof first === "object" && first !== null ? (first as Bag)["host"] : args[1];
    if (!loopback(host)) return blocked("network", `net.Socket.connect(${typeof host === "string" ? host : "path"})`);
    canvas.loopbackConnect.push(String(host));
    return origConnect.apply(this, args);
  };
} else {
  patchBlock(net, ["connect", "createConnection", "createServer"], "network", "net");
  patchBlock(net.Socket.prototype, ["connect"], "network", "net.Socket");
  patchBlock(net.Server.prototype, ["listen"], "network", "net.Server");
  patchBlock(require("node:http") as Bag, ["request", "get", "createServer"], "network", "http");
}
patchBlock(require("node:tls") as Bag, ["connect", "createServer"], "network", "tls");
patchBlock(require("node:https") as Bag, ["request", "get", "createServer"], "network", "https");
patchBlock(require("node:http2") as Bag, ["connect", "createServer", "createSecureServer"], "network", "http2");
patchBlock(require("node:dgram") as Bag, ["createSocket"], "network", "dgram");
const dns = require("node:dns") as Bag & { promises: Bag };
const DNS_NAMES = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveMx", "resolveTxt", "resolveSrv", "resolveNs", "resolveCname", "resolvePtr", "reverse"];
const origLookup = dns["lookup"] as AnyFn;
patchBlock(dns, DNS_NAMES, "dns", "dns");
patchBlock(dns.promises, DNS_NAMES, "dns", "dns.promises");
if (CANVAS) {
  // Binding to, or connecting to, the literal 127.0.0.1 makes Node call dns.lookup, which answers an IP literal without
  // asking any resolver. That is the only lookup the canvas profile lets through.
  dns["lookup"] = function (this: unknown, ...args: unknown[]): unknown {
    if (args[0] !== "127.0.0.1") return blocked("dns", "dns.lookup");
    return origLookup.apply(this, args);
  };
}
const g = globalThis as unknown as Bag;
for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
  if (typeof g[name] === "function") g[name] = (): never => blocked("network", `global.${name}`);
}

// Process creation
const cp = require("node:child_process") as Bag;
const origSpawn = cp["spawn"] as AnyFn;
patchBlock(cp, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "spawn", "child_process");
if (CANVAS) {
  // The Evidence Explorer may start exactly one kind of child: the bundled (or source) WalletWall MCP server.
  cp["spawn"] = function (this: unknown, ...args: unknown[]): unknown {
    const command = args[0];
    const argv = Array.isArray(args[1]) ? (args[1] as unknown[]) : [];
    const mcpEntry = argv.find((a): a is string => typeof a === "string" && /(walletwall-mcp\.mjs|packages[\\/]mcp[\\/]src[\\/]main\.ts)$/.test(a));
    if (!(command === process.execPath || command === "node") || mcpEntry === undefined) return blocked("spawn", `child_process.spawn(${String(command)})`);
    canvas.spawnAllowed.push(mcpEntry.replace(/^.*[\\/]/, ""));
    return origSpawn.apply(this, args);
  };
}
const wt = require("node:worker_threads") as Bag;
if (typeof wt["Worker"] === "function") wt["Worker"] = (): never => blocked("spawn", "worker_threads.Worker");

// Filesystem writes
const WRITE_APIS = [
  "writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "rename", "copyFile", "cp", "symlink", "link",
  "truncate", "ftruncate", "chmod", "chown", "fchmod", "fchown", "lchmod", "lchown", "utimes", "futimes", "lutimes", "createWriteStream", "writev",
];
const fsBag = fs as unknown as Bag;
for (const api of WRITE_APIS) {
  patchBlock(fsBag, [api, `${api}Sync`], "fsWrite", "fs");
}
const fsp = (fs as unknown as { promises: Bag }).promises;
patchBlock(fsp, WRITE_APIS, "fsWrite", "fs.promises");
for (const name of ["open", "openSync"]) {
  const orig = fsBag[name] as AnyFn;
  fsBag[name] = function (this: unknown, ...args: unknown[]): unknown {
    if (isWriteFlags(args[1])) blocked("fsWrite", `fs.${name}`);
    return orig.apply(this, args);
  };
}
const origPromisesOpen = fsp["open"] as AnyFn;
fsp["open"] = function (this: unknown, ...args: unknown[]): unknown {
  if (isWriteFlags(args[1])) blocked("fsWrite", "fs.promises.open");
  return origPromisesOpen.apply(this, args);
};
for (const name of ["write", "writeSync"]) {
  const orig = fsBag[name] as AnyFn;
  fsBag[name] = function (this: unknown, ...args: unknown[]): unknown {
    // stdout and stderr are the MCP channel and diagnostics; every other descriptor is a write to storage.
    if (typeof args[0] === "number" && args[0] > 2) blocked("fsWrite", `fs.${name}`);
    return orig.apply(this, args);
  };
}

// Randomness and machine identity (generated IDs, fingerprints)
patchObserve(require("node:crypto") as Bag, ["randomUUID", "randomBytes", "randomFillSync", "randomFill", "randomInt", "getRandomValues", "generateKeyPairSync", "generateKeySync"], "random", "crypto");
patchObserve(require("node:os") as Bag, ["hostname", "networkInterfaces", "userInfo", "machine", "cpus", "release", "version", "uptime"], "fingerprint", "os");

syncBuiltinESMExports();

process.on("exit", () => {
  realWriteSync(2, `\nWW_GUARD_REPORT ${JSON.stringify(CANVAS ? { ...report, canvas } : report)}\n`);
});
