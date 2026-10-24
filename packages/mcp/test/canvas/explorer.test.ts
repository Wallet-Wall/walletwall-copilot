import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { evaluateBundle } from "../../src/evaluate.ts";
import { LIMITATION_CODES, SUPPORT_STATES, FRESHNESS_STATES, FINALITY_STATES } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";

const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;

interface Summary {
  status: string;
  error?: { code: string; message: string };
  selectedAssertionId?: string | null;
  bundleDigest?: string;
  invariantViolationCount?: number;
  assertions?: { id: string; claimType: string; evaluation: Record<string, unknown> | null }[];
  readiness?: { assertionId: string; result?: Record<string, unknown>; errorCode?: string } | null;
}
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string; title: string; status: string }>;
  setInput: (id: string, input: unknown) => Promise<Summary>;
  select: (id: string, assertionId: string) => Promise<Summary>;
  view: (id: string) => Summary;
  close: (id: string) => Promise<void>;
  instanceCount: () => number;
}
interface RenderMod {
  renderView: (view: unknown) => string;
  renderPage: (o: { nonce: string }) => string;
  CLIENT_JS: string;
  CSS: string;
  SUPPORT_STATES: string[];
  FRESHNESS_STATES: string[];
  FINALITY_STATES: string[];
  LIMITATION_LABELS: Record<string, string>;
}
type Fixtures = Record<string, { title: string; evaluatedAt: string; bundle: { assertions: { id: string }[] } }>;
const mod = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { command?: string; serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Fixtures };

const explorer = mod.createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
let n = 0;
async function open(input?: unknown): Promise<{ id: string; url: string }> {
  const id = `t${++n}`;
  opened.push(id);
  const o = await explorer.open(id, input);
  return { id, url: o.url };
}
const get = async (url: string): Promise<string> => (await fetch(url)).text();

function raw(url: string, opts: { method?: string; host?: string; body?: string }): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: "127.0.0.1", port: u.port, path: u.pathname, method: opts.method ?? "GET", headers: { host: opts.host ?? u.host } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const supportChip = (html: string): string | undefined => /<dt>Support<\/dt><dd><span class="chip" data-state="([A-Z_]+)"/.exec(html)?.[1];

describe("WalletWall canvas reflects structured MCP output and re-derives nothing", () => {
  test("for every fixture and every assertion the panel shows exactly the state the MCP engine returns", async () => {
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const direct = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(direct.ok, name);
      const expected = (direct.result as { assertions: Record<string, unknown>[]; bundleDigest: string }).assertions;
      const { id, url } = await open({ fixture: name });
      const summary = explorer.view(id);
      assert.equal(summary.status, "ready");
      assert.equal(summary.bundleDigest, (direct.result as { bundleDigest: string }).bundleDigest);
      const byId = (xs: Record<string, unknown>[]): Record<string, unknown>[] => [...xs].sort((a, b) => String(a["assertionId"]).localeCompare(String(b["assertionId"])));
      assert.deepEqual(byId((summary.assertions ?? []).map((a) => a.evaluation ?? {})), byId(expected), `${name}: summary must equal the engine output`);

      for (const e of expected as { assertionId: string; supportState: string; freshnessState: string; finalityState: string | null; limitations: string[]; conflictsWith: string[] }[]) {
        await explorer.select(id, e.assertionId);
        const html = await get(`${url}view`);
        assert.equal(supportChip(html), e.supportState, `${name}/${e.assertionId} support`);
        assert.ok(html.includes(`<dt>Freshness</dt><dd><span class="chip" data-state="${e.freshnessState}"`), `${name}/${e.assertionId} freshness`);
        if (e.finalityState === null) assert.ok(/<dt>Finality<\/dt><dd><span class="chip" data-state="NA">N\/A<\/span>/.test(html), `${name}/${e.assertionId} finality is N/A`);
        else assert.ok(html.includes(`<dt>Finality</dt><dd><span class="chip" data-state="${e.finalityState}"`), `${name}/${e.assertionId} finality`);
        for (const l of e.limitations) assert.ok(html.includes(`<code>${l}</code>`), `${name}/${e.assertionId} shows limitation ${l}`);
        for (const c of e.conflictsWith) assert.ok(html.includes(`>${c}</button>`), `${name}/${e.assertionId} shows conflict ${c}`);
      }
    }
  });

  test("the readiness panel is the assess_vault_readiness result, criterion by criterion", async () => {
    const fx = FIXTURES["usdc-established"]!;
    const direct = callTool("assess_vault_readiness", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" });
    assert.ok(direct.ok);
    const r = direct.result as { classification: string; criteria: { id: string; outcome: string; reason: string }[]; doesNotEstablish: string[] };
    const { id, url } = await open({ fixture: "usdc-established" });
    assert.equal(explorer.view(id).readiness?.result?.["classification"], r.classification);
    const html = await get(`${url}view`);
    assert.ok(html.includes(`data-state="${r.classification}"`));
    for (const c of r.criteria) assert.ok(html.includes(`<th scope="row">${c.id}</th>`) && html.includes(`<code>${c.reason}</code>`), c.id);
    for (const x of r.doesNotEstablish) assert.ok(html.includes(`<li>${x}</li>`), x);
  });

  test("stale and conflicting fixtures are shown as STALE and CONFLICTING, never as established", async () => {
    const stale = await open({ fixture: "stale-identity", assertionId: "a-identity" });
    const sHtml = await get(`${stale.url}view`);
    assert.equal(supportChip(sHtml), "STALE");
    assert.ok(/<dt>Freshness<\/dt><dd><span class="chip" data-state="STALE" data-attention="true"/.test(sHtml));
    const conflict = await open({ fixture: "conflicting-balances", assertionId: "a-balance" });
    const cHtml = await get(`${conflict.url}view`);
    assert.equal(supportChip(cHtml), "CONFLICTING");
    assert.ok(cHtml.includes("a-balance-2"), "the conflicting assertion is named");
    assert.ok(!/<dt>Support<\/dt><dd><span class="chip" data-state="ESTABLISHED"/.test(cHtml));
  });

  test("every limitation is on screen next to the states, with a description for every WWEP limitation code", () => {
    assert.deepEqual(Object.keys(render.LIMITATION_LABELS).sort(), [...LIMITATION_CODES].sort());
    assert.deepEqual(render.SUPPORT_STATES, [...SUPPORT_STATES]);
    assert.deepEqual(render.FRESHNESS_STATES, [...FRESHNESS_STATES]);
    assert.deepEqual(render.FINALITY_STATES, [...FINALITY_STATES]);
  });

  test("the renderer prints what it is given: no state is upgraded, downgraded or invented", () => {
    const base = (evaluation: Record<string, unknown>) => ({
      status: "ready",
      evaluatedAt: "2026-10-23T12:00:30Z",
      versions: { wwep: "0.1", registry: "r", policies: "p", rules: "u" },
      bundleDigest: "d",
      invariantViolationCount: 0,
      invariantViolations: [],
      assertions: [{ id: "x", claimType: "ASSET_IDENTITY", origin: "AUTHORITY_ATTESTED", temporality: "CURRENT", subject: { a: "b" }, value: { c: "d" }, evaluation }],
      observations: [],
      sources: [],
      selectedId: "x",
      provenance: null,
      readiness: null,
    });
    const ev = (over: Record<string, unknown>) => ({ assertionId: "x", claimType: "ASSET_IDENTITY", supportState: "STALE", freshnessState: "CURRENT", finalityState: null, authority: null, limitations: [], independentCorroboration: null, conflictsWith: [], supersededBy: null, dependencies: { observationIds: [], assertionIds: [] }, policyId: null, digest: "z", ...over });
    for (const support of render.SUPPORT_STATES) {
      const html = render.renderView(base(ev({ supportState: support })));
      assert.equal(supportChip(html), support);
    }
    assert.ok(render.renderView(base(ev({ supportState: "ESTABLISHED" }))).includes("does not verify that upstream data is true"));
    assert.ok(!render.renderView(base(ev({ supportState: "STALE" }))).includes("does not verify that upstream data is true"));
    const odd = render.renderView(base(ev({ supportState: "VERIFIED", freshnessState: "FRESH", finalityState: "SAFE" })));
    assert.ok(!/data-state="(VERIFIED|FRESH|SAFE)"/.test(odd));
    assert.ok(!/>(VERIFIED|FRESH|SAFE)</.test(odd) && !/(support|readiness) (VERIFIED|FRESH|SAFE)/.test(odd), "an unknown value is never printed as if it were a state");
    assert.ok((odd.match(/not recognised: VERIFIED/g) ?? []).length >= 2, "support, in the claim list and the detail");
    assert.ok(odd.includes("not recognised: FRESH") && odd.includes("not recognised: SAFE"), "freshness and finality");
    assert.ok(odd.includes('data-state="UNRECOGNISED"') && odd.includes(">not recognised</text>"), "The Wall's piece says not recognised too");
    assert.ok(render.renderView(base(ev({}))).includes("No limitation codes were returned"));
  });

  test("hostile text anywhere in a result is escaped, never executed", () => {
    const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>"'&`;
    const view = {
      status: "ready", evaluatedAt: evil, versions: { wwep: evil, registry: evil, policies: evil, rules: evil }, bundleDigest: evil, invariantViolationCount: evil,
      invariantViolations: [{ invariant: evil, code: evil, assertionId: evil, rule: evil }],
      assertions: [{ id: evil, claimType: evil, origin: evil, temporality: evil, subject: { [evil]: evil }, value: { [evil]: evil }, evaluation: { assertionId: evil, claimType: evil, supportState: evil, freshnessState: evil, finalityState: evil, authority: { kind: evil, authorityId: evil, scope: evil, satisfied: true }, limitations: [evil], independentCorroboration: evil, conflictsWith: [evil], supersededBy: evil, dependencies: { observationIds: [evil], assertionIds: [evil] }, policyId: evil, digest: evil } }],
      observations: [{ id: evil, sourceId: evil, origin: evil, result: evil, observedAt: evil, finality: evil }], sources: [{ id: evil, kind: evil, authorityId: evil }],
      selectedId: evil,
      provenance: { target: evil, lineage: [], issues: [{ code: evil, id: evil }], prov: { agent: { [evil]: { "ww:kind": evil, "ww:authorityId": evil, "ww:retrievedVia": evil } }, entity: { [`ww:obs/${evil}`]: { "prov:type": "ww:Observation", "ww:origin": evil, "ww:result": evil } }, activity: { [evil]: { "ww:ruleId": evil, "ww:rulesVersion": evil } }, wasAttributedTo: {}, wasDerivedFrom: {}, wasGeneratedBy: {} } },
      readiness: { assertionId: evil, result: { classification: evil, ruleId: evil, rulesVersion: evil, supportOfInputs: evil, criteria: [{ id: evil, description: evil, outcome: evil, reason: evil }], limitations: [evil], doesNotEstablish: [evil] } },
    };
    const html = render.renderView(view);
    const allowed = new Set(["h1", "h2", "h3", "p", "code", "strong", "span", "div", "dl", "dt", "dd", "nav", "ul", "ol", "li", "button", "section", "header", "aside", "details", "summary", "table", "thead", "tbody", "tr", "th", "td", "svg", "defs", "marker", "pattern", "path", "line", "polygon", "circle", "g", "title", "rect", "text", "br", "label", "input"]);
    for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) assert.ok(allowed.has(m[1] as string), `unexpected element <${m[1]}> in the output`);
    assert.ok(!/<img|<script/.test(html), "unescaped markup in the output");
    // The only form control is the list's own search field, which the renderer writes once with fixed attributes.
    assert.deepEqual([...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]), ['<input id="ww-search" class="ww-search" type="search" placeholder="Search The Wall" autocomplete="off" spellcheck="false" data-list-search>']);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!/(data-assertion-id|data-node-id|data-node|data-focus-node|data-node-panel|data-from|data-to|data-state|aria-label|title)="[^"]*<[^"]*"/.test(html));
  });

  test("an invalid bundle shows the MCP error code and no states", async () => {
    const { id, url } = await open({ bundle: { wwepVersion: "9.9", sources: [], observations: [], assertions: [], derivations: [] }, evaluatedAt: "2026-10-23T12:00:00Z" });
    const s = explorer.view(id);
    assert.equal(s.status, "error");
    assert.equal(s.error?.code, "INVALID_INPUT");
    const html = await get(`${url}view`);
    assert.ok(html.includes("INVALID_INPUT") && !html.includes("data-state="));
  });

  test("input validation: unknown fields, missing parts and prototype-key fixture names are refused", async () => {
    for (const input of [{ nope: 1 }, { fixture: "__proto__" }, { fixture: "constructor" }, { fixture: 7 }, { bundle: {} }, { evaluatedAt: "2026-10-23T12:00:00Z" }, { fixture: "usdc-established", assertionId: 5 }]) {
      const { id } = await open(input);
      assert.equal(explorer.view(id).status, "error", JSON.stringify(input));
    }
  });

  test("a replacement bundle fully replaces the previous one", async () => {
    const { id, url } = await open({ fixture: "usdc-established" });
    await explorer.setInput(id, { fixture: "conflicting-balances" });
    const html = await get(`${url}view`);
    assert.ok(html.includes("fixture:conflicting-balances") && !html.includes("fixture:usdc-established"));
  });

  test("a missing or broken MCP server is reported, not hung on and not guessed around", async () => {
    const broken = mod.createExplorer({ serverArgs: [`${ROOT}does-not-exist.mjs`] });
    const o = await broken.open("b1", { fixture: "usdc-established" });
    assert.equal(broken.view("b1").status, "error");
    assert.ok((await get(`${o.url}view`)).includes("No states are shown"));
    await broken.close("b1");
    const missing = mod.createExplorer({ command: "walletwall-no-such-binary", serverArgs: [ENTRIES.bundle] });
    await missing.open("m1", { fixture: "usdc-established" });
    assert.equal(missing.view("m1").error?.code, "MCP_LAUNCH_FAILED");
    await missing.close("m1");
  });
});

describe("WalletWall canvas server: loopback only, same-origin only, closed on request", () => {
  test("the listener is bound to 127.0.0.1 and refuses a wrong Host, a wrong path key and unexpected methods", async () => {
    const { url } = await open({ fixture: "usdc-established" });
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{24}\/$/);
    assert.equal((await raw(url, { host: "localhost" })).status, 403);
    assert.equal((await raw(url, { host: "evil.example" })).status, 403);
    assert.equal((await raw(url.replace(/\/[^/]+\/$/, "/AAAAAAAAAAAAAAAAAAAAAAAA/"), {})).status, 404);
    assert.equal((await raw(`${url}view`, { method: "DELETE" })).status, 404);
    assert.equal((await raw(`${url}select`, { method: "GET" })).status, 404);
    assert.equal((await raw(`${url}nope`, {})).status, 404);
    assert.equal((await raw(url, {})).status, 200);
  });

  test("the page carries a Content-Security-Policy that allows no origin but its own, and no CORS header", async () => {
    const { url } = await open({ fixture: "usdc-established" });
    const r = await raw(url, {});
    const csp = String(r.headers["content-security-policy"]);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce && nonce.length >= 16);
    for (const d of ["default-src 'none'", "connect-src 'self'", "img-src data:;", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "worker-src 'none'", "font-src data:;"]) assert.ok(csp.includes(d), d);
    assert.ok(!/unsafe-|\*|https?:|blob:|filesystem:/.test(csp), "no wildcard, unsafe keyword, remote origin, blob or filesystem source");
    assert.equal((csp.match(/data:/g) ?? []).length, 2, "data: is allowed for images and fonts only (the embedded brand assets), nowhere else");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.ok(r.body.includes(`<script nonce="${nonce}">`) && r.body.includes(`<style nonce="${nonce}">`));
    const other = await raw(url, {});
    assert.notEqual(/script-src 'nonce-([^']+)'/.exec(String(other.headers["content-security-policy"]))?.[1], nonce, "the nonce changes on every load");
  });

  test("the page script touches no storage, cookie, remote origin or dynamic code", () => {
    const code = `${render.CLIENT_JS}\n${render.CSS}`;
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.(?!clipboard\.writeText\()|sendBeacon|XMLHttpRequest|WebSocket|importScripts|eval\(|new Function|postMessage|window\.open|https?:\/\//.test(code));
    for (const m of render.CSS.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1] as string, /^#ww-[a-z]+$/, "the stylesheet only refers to the page's own SVG patterns");
    assert.ok(!/@import/.test(render.CSS));
    const page = render.renderPage({ nonce: "n" });
    // The only <link> is the favicon, and it is the embedded brand mark (a data: URI), so it fetches nothing.
    const links = [...page.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    assert.equal(links.length, 1);
    assert.match(links[0] as string, /^<link rel="icon" type="image\/png" sizes="96x96" href="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
    assert.ok(!/https?:\/\/|<img|<iframe|<form|<object|<embed|@import/.test(page.replace(links[0] as string, "")));
    for (const m of page.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1] as string, /^(#ww-[a-z]+|"?data:(?:image\/png|font\/woff2);base64,[A-Za-z0-9+/=]+"?)$/, "every resource is an embedded data: URI or an in-page reference");
  });

  test("closing the canvas stops the listener and drops the loaded bundle", async () => {
    const id = `c${++n}`;
    const o = await explorer.open(id, { fixture: "usdc-established" });
    assert.equal((await fetch(`${o.url}view`)).status, 200);
    const before = explorer.instanceCount();
    await explorer.close(id);
    assert.equal(explorer.instanceCount(), before - 1);
    await assert.rejects(fetch(`${o.url}view`));
    assert.throws(() => explorer.view(id), /not open/);
    await explorer.close(id);
  });

  test("two instances are independent and each has its own listener and path key", async () => {
    const a = await open({ fixture: "usdc-established" });
    const b = await open({ fixture: "stale-identity" });
    assert.notEqual(a.url, b.url);
    assert.ok((await get(`${a.url}view`)).includes("fixture:usdc-established"));
    assert.ok((await get(`${b.url}view`)).includes("fixture:stale-identity"));
    assert.equal((await raw(a.url.replace(/\/[^/]+\/$/, b.url.replace(/^.*\/([^/]+)\/$/, "/$1/")), {})).status, 404, "a key for one instance does not open another");
  });

  test("the extension entry point declares exactly one canvas and no tools, hooks or environment requests", () => {
    const src = readFileSync(`${EXT}/extension.mjs`, "utf8");
    assert.equal((src.match(/createCanvas\(/g) ?? []).length, 1);
    assert.ok(!/\btools\s*:|hooks\s*:|requestedEnvironmentVariables|onPermissionRequest|systemMessage|session\.send|rpc\./.test(src));
    assert.ok(src.includes('id: "walletwall-evidence-explorer"'));
  });

  test("the generated fixtures are exactly what the engine accepts (checked again at generation)", () => {
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const r = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(r.ok, name);
      const bundleAssertions = fx.bundle.assertions.map((a) => a.id).sort();
      const evaluated = evaluateBundle(fx.bundle as never, fx.evaluatedAt).assertions.map((a) => a.assertionId).sort();
      assert.deepEqual(bundleAssertions, evaluated, name);
    }
  });
});
