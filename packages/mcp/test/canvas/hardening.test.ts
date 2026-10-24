import assert from "node:assert/strict";
import { request } from "node:http";
import { connect } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { ENTRIES, ROOT } from "../support/harness.ts";
import { MEASURABLE, tcpListenersOf } from "../support/sockets.ts";

const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;

interface Summary {
  status: string;
  selectedAssertionId?: string | null;
}
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string; title: string; status: string }>;
  select: (id: string, assertionId: string) => Promise<Summary>;
  view: (id: string) => Summary;
  close: (id: string) => Promise<void>;
  instanceCount: () => number;
}
interface RenderMod {
  renderView: (view: unknown) => string;
  renderPage: (o: { nonce: string }) => string;
  CLIENT_JS: string;
}
const mod = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { command?: string; serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, { bundle: unknown; evaluatedAt: string }> };

const explorer = mod.createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: { ex: Explorer; id: string }[] = [];
after(async () => {
  for (const o of opened) await o.ex.close(o.id);
});
let n = 0;
async function open(input?: unknown, ex: Explorer = explorer): Promise<{ id: string; url: string; ex: Explorer }> {
  const id = `h${++n}`;
  opened.push({ ex, id });
  const o = await ex.open(id, input);
  return { id, url: o.url, ex };
}

interface Raw {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}
function raw(url: string, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: "127.0.0.1", port: u.port, path: opts.path ?? u.pathname, method: opts.method ?? "GET", agent: false, headers: { host: u.host, ...opts.headers } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** Opens the SSE stream, reports its status and content type, and hangs up. */
function sseHead(url: string): Promise<{ status: number; type: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: "127.0.0.1", port: u.port, path: `${u.pathname}events`, agent: false, headers: { host: u.host } }, (res) => {
      resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]) });
      req.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}

const reachable = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = connect({ host, port, timeout: 2000 });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(false));
  });

describe("canvas loopback listener: bind address, lifecycle and capabilities", () => {
  test("the operating system's socket table shows exactly one new listener, on 127.0.0.1, and none after close", { skip: !MEASURABLE && "no OS socket reader on this platform" }, async () => {
    const before = new Set(tcpListenersOf(process.pid));
    const { id, url } = await open({ fixture: "usdc-established" });
    const port = new URL(url).port;
    const added = tcpListenersOf(process.pid).filter((l) => !before.has(l));
    assert.deepEqual(added, [`127.0.0.1:${port}`], "one listener, loopback only: never 0.0.0.0, never IPv6, never a LAN address");
    await explorer.close(id);
    assert.ok(!tcpListenersOf(process.pid).some((l) => l.endsWith(`:${port}`)), "the listener is gone after close");
  });

  test("the listener cannot be reached on IPv6 loopback or on any LAN address of this host", async () => {
    const { url } = await open({ fixture: "usdc-established" });
    const port = Number(new URL(url).port);
    assert.equal(await reachable("127.0.0.1", port), true, "positive control: loopback works");
    assert.equal(await reachable("::1", port), false);
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NetworkInterfaceInfo => i !== undefined && !i.internal && i.family === "IPv4")
      .map((i) => i.address);
    for (const address of lan) assert.equal(await reachable(address, port), false, `reachable on ${address}`);
  });

  test("only four method and route pairs exist; every other method, route and path trick is refused", async () => {
    const { url } = await open({ fixture: "usdc-established" });
    const json = { "content-type": "application/json" };
    const expected = (method: string, route: string): number => (method === "GET" && (route === "" || route === "view") ? 200 : method === "POST" && route === "select" ? 204 : 404);
    for (const route of ["", "view", "select"]) {
      for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
        const r = await raw(url, { method, path: `${new URL(url).pathname}${route}`, headers: json, ...(method === "POST" ? { body: "{}" } : {}) });
        assert.equal(r.status, expected(method, route), `${method} /${route}`);
      }
    }
    for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) assert.equal((await raw(url, { method, path: `${new URL(url).pathname}events`, headers: json })).status, 404, `${method} /events`);
    assert.deepEqual(await sseHead(url), { status: 200, type: "text/event-stream" });
    const key = new URL(url).pathname;
    for (const path of [`${key}view/`, `${key}select/`, `${key}events/x`, `${key}..%2fview`, key.slice(0, -1), `//${key.slice(1)}view`, "/", "/favicon.ico"]) {
      assert.equal((await raw(url, { path })).status, 404, path);
    }
    assert.equal((await raw(url, { path: `/${"A".repeat(24)}/view` })).status, 404, "a guessed key");
    assert.equal((await raw(url, { path: `${key}view`, headers: { host: "127.0.0.1:1" } })).status, 403, "a wrong port in Host");
    assert.equal((await raw(url, { path: `${key}view`, headers: { host: "[::1]" } })).status, 403, "an IPv6 Host");
  });

  test("the state-changing route refuses a foreign Origin and a non-JSON body, and the selection does not change", async () => {
    const { id, url } = await open({ fixture: "usdc-established", assertionId: "a-identity" });
    const origin = new URL(url).origin;
    const post = (headers: Record<string, string>, body = JSON.stringify({ assertionId: "a-balance" })): Promise<Raw> => raw(url, { method: "POST", path: `${new URL(url).pathname}select`, headers, body });
    const selected = (): string | null | undefined => explorer.view(id).selectedAssertionId;
    assert.equal(selected(), "a-identity");

    assert.equal((await post({ "content-type": "application/json", origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ "content-type": "application/json", origin: "null" })).status, 403);
    assert.equal((await post({ "content-type": "application/json", origin: "http://127.0.0.1:1" })).status, 403);
    assert.equal((await post({ "content-type": "text/plain", origin })).status, 415, "a cross-site form post cannot declare JSON");
    assert.equal((await post({ "content-type": "application/x-www-form-urlencoded" })).status, 415);
    assert.equal((await post({})).status, 415);
    assert.equal(selected(), "a-identity", "none of the refused requests changed anything");

    assert.equal((await post({ "content-type": "application/json", origin })).status, 204, "the page's own origin works");
    assert.equal(selected(), "a-balance");
    assert.equal((await post({ "content-type": "application/json; charset=utf-8" }, JSON.stringify({ assertionId: "a-identity" }))).status, 204, "no Origin header (non-browser client) still needs the key and Host");
    assert.equal(selected(), "a-identity");
  });

  test("hostile select bodies change nothing, spawn nothing and leave the server serving", async () => {
    const { id, url } = await open({ fixture: "usdc-established", assertionId: "a-identity" });
    const select = (body: string): Promise<Raw> => raw(url, { method: "POST", path: `${new URL(url).pathname}select`, headers: { "content-type": "application/json" }, body });
    const bodies = [
      "not json",
      "[]",
      "null",
      JSON.stringify({ assertionId: 7 }),
      JSON.stringify({ assertionId: "__proto__" }),
      JSON.stringify({ assertionId: "constructor" }),
      JSON.stringify({ assertionId: "no-such-assertion" }),
      JSON.stringify({ assertionId: ["a-balance"] }),
      JSON.stringify({ command: "calc.exe", args: ["x"], file: "C:/Windows/win.ini", url: "http://127.0.0.1:1/" }),
    ];
    for (const b of bodies) {
      const r = await select(b);
      assert.equal(r.status, 204, b);
      assert.equal(explorer.view(id).selectedAssertionId, "a-identity", b);
    }
    // An oversized body is cut off by the server; it must not be processed and must not take the listener down.
    await select("x".repeat(64 * 1024)).catch(() => undefined);
    assert.equal(explorer.view(id).selectedAssertionId, "a-identity");
    assert.equal((await raw(url, { path: `${new URL(url).pathname}view` })).status, 200, "still serving");
  });

  test("the /view fragment is served with a CSP that runs and loads nothing, so direct navigation to it is inert", async () => {
    const { url } = await open({ fixture: "usdc-established" });
    const r = await raw(url, { path: `${new URL(url).pathname}view` });
    const csp = String(r.headers["content-security-policy"]);
    for (const d of ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "sandbox"]) assert.ok(csp.includes(d), d);
    assert.ok(!/unsafe-|\*|https?:/.test(csp));
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  });

  test("the extension has exactly four routes and hands the MCP launcher only constructor options, never request data", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${EXT}/explorer.mjs`, "utf8");
    const routes = [...src.matchAll(/req\.method === "(GET|POST)" && route === "([a-z]*)"/g)].map((m) => `${m[1]} /${m[2]}`).sort();
    assert.deepEqual(routes, ["GET /", "GET /events", "GET /view", "POST /select"]);
    assert.ok(/const mcp = \(calls\) => callTools\(\{ command, args: serverArgs, calls, onStderr: serverStderr \}\);/.test(src), "the launcher gets the constructor's command and arguments only");
    assert.equal((src.match(/callTools\(/g) ?? []).length, 1, "one launch site");
  });
});

describe("canvas state is per instance and per session: nothing survives close, nothing is shared", () => {
  const CANARY = "0x1234567890123456789012345678901234567890";

  test("after close nothing of the bundle remains: a new instance with the same id is empty, has a new key and a new port", async () => {
    const id = `s${++n}`;
    opened.push({ ex: explorer, id });
    const first = await explorer.open(id, { fixture: "conflicting-balances", assertionId: "a-balance" });
    assert.ok((await (await fetch(`${first.url}view`)).text()).includes(CANARY), "the holder address is shown while open");
    await explorer.close(id);
    const second = await explorer.open(id, undefined);
    assert.notEqual(second.url, first.url);
    assert.equal(explorer.view(id).status, "empty");
    const html = await (await fetch(`${second.url}view`)).text();
    assert.ok(!html.includes(CANARY) && !html.includes("fixture:conflicting-balances") && html.includes("Nothing is loaded"));
    await assert.rejects(fetch(`${first.url}view`), "the old URL is dead");
  });

  test("two sessions (two extension processes, modelled by two explorers) share neither instances, keys nor data", async () => {
    const other = mod.createExplorer({ serverArgs: [ENTRIES.bundle] });
    const a = await open({ fixture: "conflicting-balances" });
    // The other session shows its own (synthetic) holder, so the canary can only appear there if it leaked across.
    const fx = FIXTURES["stale-identity"]!;
    const own = JSON.parse(JSON.stringify(fx.bundle).replaceAll(CANARY, `0x${"22".repeat(20)}`)) as unknown;
    const b = await open({ bundle: own, evaluatedAt: fx.evaluatedAt }, other);
    assert.notEqual(new URL(a.url).port, new URL(b.url).port);
    assert.notEqual(new URL(a.url).pathname, new URL(b.url).pathname);
    assert.equal(other.instanceCount(), 1);
    assert.ok(!(await (await fetch(`${b.url}view`)).text()).includes(CANARY));
    assert.equal((await raw(b.url, { path: new URL(a.url).pathname })).status, 404, "the other session's key opens nothing here");
    assert.equal((await raw(a.url, { path: new URL(b.url).pathname })).status, 404);
  });
});

describe("addresses in the canvas: full value, one-click copy of the exact value, chain context, no shortening", () => {
  const MIXED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const HOLDER = "0x1234567890123456789012345678901234567890";
  const view = (subject: Record<string, unknown>, value: Record<string, unknown>) => ({
    status: "ready",
    evaluatedAt: "2026-10-23T12:00:30Z",
    versions: { wwep: "0.1", registry: "r", policies: "p", rules: "u" },
    bundleDigest: "d",
    invariantViolationCount: 0,
    invariantViolations: [],
    assertions: [{ id: "x", claimType: "TOKEN_BALANCE_AT_BLOCK", origin: "CHAIN_OBSERVED", temporality: "PINNED", subject, value, evaluation: null }],
    observations: [],
    sources: [],
    selectedId: "x",
    provenance: null,
    readiness: null,
  });

  test("every address field is printed in full, exactly as presented, with its chain next to it and a copy control", () => {
    const html = render.renderView(view({ chainId: "8453", token: MIXED, holder: HOLDER, blockNumber: "21000000" }, { balanceAtomic: "1500000", decimals: "6" }));
    for (const a of [MIXED, HOLDER]) {
      assert.ok(html.includes(`<code class="addr-full">${a}</code><span class="addr-ctx muted small">chain ID 8453</span><button type="button" class="copy" data-copy-address`), `${a}: full value, then chain, then copy`);
    }
    // The claim's token and holder in the detail, and the contract and wallet pieces' own panels on The Wall: each full
    // address shown has its copy controls, and nothing else has one.
    const full = (html.match(/<code class="addr-full">/g) ?? []).length;
    assert.equal(full, 4);
    assert.equal((html.match(/data-copy-address/g) ?? []).length, full);
    assert.equal((html.match(/data-copy-chain-address/g) ?? []).length, full, "a stated chain also gets Copy chain + address");
    const outsideWall = html.replace(/<svg class="ww-wall-svg"[\s\S]*?<\/svg>/, "");
    assert.ok(!/0x[0-9a-fA-F]{2,}(…|\.\.\.)/.test(outsideWall), "no shortened address outside The Wall's piece faces");
    for (const a of [MIXED, HOLDER]) assert.ok(html.includes(`aria-label="Contract: ${a}`) || html.includes(`aria-label="Wallet: ${a}`), `${a}: The Wall's piece names the full address`);
    assert.ok(html.includes(`aria-label="Copy the full token value (chain ID 8453)"`));
    assert.ok(!html.includes(MIXED.toLowerCase()), "case and checksum are not changed for display");
  });

  test("an address in the value record gets the subject's chain; a missing chain is said, not guessed", () => {
    const withValue = render.renderView(view({ chainId: "1" }, { address: MIXED }));
    assert.ok(withValue.includes(`<code class="addr-full">${MIXED}</code><span class="addr-ctx muted small">chain ID 1</span>`));
    const noChain = render.renderView(view({ token: MIXED }, {}));
    assert.ok(noChain.includes(`<span class="addr-ctx muted small">chain not stated</span>`));
    assert.ok(!noChain.includes("data-copy-chain-address"), "no chain is invented for Copy chain + address");
  });

  test("hostile text in an address field is escaped inside the text and inside the label", () => {
    const evil = `0x"><img src=x onerror=alert(1)>`;
    const html = render.renderView(view({ chainId: `"><script>alert(2)</script>`, token: evil }, {}));
    assert.ok(!/<img|<script/.test(html));
    assert.ok(!/aria-label="[^"]*<[^"]*"/.test(html));
    assert.ok(html.includes(`<code class="addr-full">${evil.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}</code>`));
  });

  test("the fixtures' addresses are in the served page in full and the copy control is present", async () => {
    const { url } = await open({ fixture: "conflicting-balances", assertionId: "a-balance" });
    const html = await (await fetch(`${url}view`)).text();
    for (const a of [HOLDER, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]) assert.ok(html.includes(`<code class="addr-full">${a}</code>`), a);
    assert.ok((html.match(/data-copy-address/g) ?? []).length >= 2);
    assert.ok(render.renderPage({ nonce: "n" }).includes(`id="copy-status"`));
  });

  /** Runs the page script against a stand-in DOM that has no storage, so any storage use would throw. */
  async function click(opts: { exec: boolean; clipboard: boolean; withChain?: boolean }): Promise<{ copied: string[]; status: string; selected: unknown }> {
    const copied: string[] = [];
    const picked: { node?: { textContent: string } } = {};
    const code = { textContent: MIXED };
    const addr = { querySelector: (s: string) => (s === "code" ? code : null), getAttribute: (a: string) => (a === "data-chain" ? "8453" : null) };
    const button = { closest: (s: string) => (s === ".addr" ? addr : null) };
    const status = { textContent: "" };
    let onClick: ((e: unknown) => void) | undefined;
    const app = {
      innerHTML: "",
      dataset: {},
      addEventListener: (type: string, h: (e: unknown) => void) => {
        if (type === "click") onClick = h;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const context = {
      location: { pathname: "/KEY/" },
      document: {
        activeElement: null,
        getElementById: (id: string) => (id === "app" ? app : id === "copy-status" ? status : null),
        createRange: () => ({ selectNodeContents: (node: { textContent: string }) => (picked.node = node) }),
        execCommand: (c: string) => {
          if (c !== "copy" || !opts.exec) return false;
          copied.push(picked.node?.textContent ?? "<nothing selected>");
          return true;
        },
      },
      window: { getSelection: () => ({ removeAllRanges: () => undefined, addRange: () => undefined }) },
      navigator: {
        clipboard: {
          writeText: (t: string) => {
            if (!opts.clipboard) return Promise.reject(new Error("NotAllowedError"));
            copied.push(t);
            return Promise.resolve();
          },
        },
      },
      fetch: () => Promise.resolve({ text: () => Promise.resolve("") }),
      EventSource: class {
        onmessage: unknown;
      },
      CSS: { escape: (s: string) => s },
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    };
    runInNewContext(render.CLIENT_JS, context);
    assert.ok(onClick, "the page registers its click handler");
    onClick({ target: { closest: (s: string) => (s === (opts.withChain ? "[data-copy-chain-address]" : "[data-copy-address]") ? button : null) } });
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    return { copied, status: status.textContent, selected: picked.node };
  }

  test("Copy puts exactly the displayed full value on the clipboard: not shortened, not lower-cased, not checksummed", async () => {
    const viaCommand = await click({ exec: true, clipboard: true });
    assert.deepEqual(viaCommand.copied, [MIXED]);
    assert.match(viaCommand.status, /^Copied the full address \(42 characters\)\.$/);
    assert.ok(!viaCommand.status.includes(MIXED), "the address is not echoed into the status line");
    const viaClipboardApi = await click({ exec: false, clipboard: true });
    assert.deepEqual(viaClipboardApi.copied, [MIXED]);
  });

  test("Copy chain + address copies the stated chain ID and the exact full address, labelled, and nothing else", async () => {
    const r = await click({ exec: true, clipboard: true, withChain: true });
    assert.deepEqual(r.copied, [`chainId:8453 address:${MIXED}`], "the clipboard API is used so the selection cannot shorten it");
    assert.equal(r.status, "Copied the chain ID and the full address.");
    const denied = await click({ exec: true, clipboard: false, withChain: true });
    assert.deepEqual(denied.copied, [], "a partial copy of only the selected address is never made");
    assert.match(denied.status, /full address is selected/);
  });

  test("when copying is not permitted the full value stays selected for manual copy and nothing else happens", async () => {
    const denied = await click({ exec: false, clipboard: false });
    assert.deepEqual(denied.copied, []);
    assert.match(denied.status, /full address is selected/);
    assert.ok(denied.selected, "the full value was selected before any copy attempt");
  });

  test("copying does not persist or transmit the address: the script has no storage and the copy path makes no network call", () => {
    const js = render.CLIENT_JS;
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|postMessage|sendBeacon/.test(js));
    const copyBody = /async function copyAddress[\s\S]*?\n {2}\}\n/.exec(js)?.[0] ?? "";
    assert.ok(copyBody.length > 300, "found the copy function");
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(copyBody));
  });
});
