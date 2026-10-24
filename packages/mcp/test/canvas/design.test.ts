import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { SUPPORT_STATES } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";

const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
const BRAND = `${ROOT}canvas/brand`;

interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string }>;
  close: (id: string) => Promise<void>;
}
interface WallNode {
  id: string;
  type: string;
  x: number;
  y: number;
  x0: number;
  y0: number;
  ax: number | null;
  ay: number | null;
  kx: number;
  ky: number;
  w: number;
  h: number;
  state?: string | null;
}
interface ModelMod {
  buildCoinstellation: (view: unknown, presentation?: unknown) => { nodes: WallNode[]; edges: { from: string; to: string; kind: string }[]; box: Record<string, { w: number; h: number }> };
  NODE_TYPES: Record<string, { name: string; entity: string }>;
}
const { createExplorer } = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { renderPage: (o: { nonce: string }) => string; renderView: (v: unknown) => string; CLIENT_JS: string; CSS: string; STATE_GEOMETRY: Record<string, string>; UNAVAILABLE: Record<string, string> };
const brand = (await import(pathToFileURL(`${EXT}/brand.mjs`).href)) as { FONT_FACES: string; MARK: string; WALLABY: Record<string, string>; FONT_FAMILIES: Record<string, string> };
const modelMod = (await import(pathToFileURL(`${EXT}/coinstellation-model.mjs`).href)) as ModelMod;
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, { bundle: { assertions: { id: string; claimType: string }[] }; evaluatedAt: string }> };

const explorer = createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
const fragments = new Map<string, string>();
async function fragment(name: string): Promise<string> {
  if (!fragments.has(name)) {
    const id = `d-${name}`;
    opened.push(id);
    const o = await explorer.open(id, { fixture: name });
    fragments.set(name, await (await fetch(`${o.url}view`)).text());
  }
  return fragments.get(name) as string;
}
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const sources = JSON.parse(readFileSync(`${BRAND}/brand-sources.json`, "utf8")) as { images: { file: string; sha256: string; source: { repository: string; path: string } }[]; fonts: { file: string; sha256: string; family: string; package: string }[] };
const pieces = (html: string): Record<string, string>[] =>
  [...html.matchAll(/<g class="ww-node[^"]*"([^>]*)>/g)].map((m) => Object.fromEntries([...(m[1] as string).matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1] as string, a[2] as string]))).filter((p) => p["data-node-id"] !== undefined);

describe("brand: real WalletWall assets, shipped locally, nothing fetched", () => {
  test("every embedded asset is the file recorded in brand-sources.json, byte for byte, from a named WalletWall source", () => {
    for (const a of [...sources.images, ...sources.fonts]) assert.equal(sha256(readFileSync(`${BRAND}/${a.file}`)), a.sha256, a.file);
    for (const i of sources.images) assert.match(i.source.repository, /^Wallet-Wall\/walletwall-audio-visual-docs$/, `${i.file} comes from the WalletWall brand repository`);
    const named = new Set([...readFileSync(`${BRAND}/brand-sources.json`, "utf8").matchAll(/"repository":\s*"([^"]*)"/g)].map((m) => m[1]));
    assert.deepEqual([...named], ["Wallet-Wall/walletwall-audio-visual-docs"], "brand provenance names only the public WalletWall brand repository, never a private one");
    const dataOf = (uri: string): Buffer => Buffer.from(uri.replace(/^data:[^;]+;base64,/, ""), "base64");
    assert.equal(sha256(dataOf(brand.MARK)), sources.images.find((i) => i.file === "walletwall-brick-wallet-96.png")?.sha256, "the mark is the brick-wallet mark");
    assert.equal(sha256(dataOf(brand.WALLABY["inspect"] as string)), sources.images.find((i) => i.file === "walletwallaby-inspect.png")?.sha256);
    assert.equal(sha256(dataOf(brand.WALLABY["perch"] as string)), sources.images.find((i) => i.file === "walletwallaby-perch.png")?.sha256);
    const embedded = [...brand.FONT_FACES.matchAll(/base64,([A-Za-z0-9+/=]+)/g)].map((m) => sha256(Buffer.from(m[1] as string, "base64")));
    assert.deepEqual(embedded, sources.fonts.map((f) => f.sha256), "each @font-face is the recorded font file");
  });

  test("the type voices are WalletWall's: Sora (display), Manrope (UI), IBM Plex Mono (data), loaded only from data: URIs", () => {
    assert.deepEqual(Object.keys(brand.FONT_FAMILIES).sort(), ["IBM Plex Mono", "Manrope Variable", "Sora Variable"]);
    for (const m of brand.FONT_FACES.matchAll(/src:([^}]*)/g)) assert.match(m[1] as string, /^url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2(-variations)?"\)$/);
    assert.match(render.CSS, /--font-display:"Sora Variable"/);
    assert.match(render.CSS, /--font-ui:"Manrope Variable"/);
    assert.match(render.CSS, /--font-mono:"IBM Plex Mono"/);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr|@import/i.test(render.renderPage({ nonce: "n" })));
  });

  test("canonical colours come from the WalletWall brand contract: terracotta, paper, charcoal", () => {
    for (const [token, value] of [["--ww-accent", "#BF4E32"], ["--ww-bg", "#F2ECDF"], ["--ww-charcoal", "#2B2B2E"], ["--ww-surface", "#F8F2E4"], ["--ww-accent-dark", "#8B3120"]]) assert.ok(render.CSS.includes(`${token}:${value}`), token);
    assert.ok(!/#(?:7c3aed|8b5cf6|6366f1|a855f7|00ffff|0ff)\b/i.test(render.CSS), "no purple or neon Web3 palette");
  });

  test("the cream horizontal lockup is never used; the mark is the brick-wallet mark only", () => {
    const listed = [...sources.images.map((i) => i.source.path), ...readdirSync(BRAND)].join("\n");
    assert.ok(!/horizontal|lockup/i.test(listed));
  });
});

describe("naming and characters", () => {
  test("the canvas is WalletWall; the guide is WalletWallaby; no other mascot or retired name appears", async () => {
    const page = render.renderPage({ nonce: "n" });
    const html = await fragment("usdc-established");
    assert.ok(page.includes("<title>WalletWall</title>") && html.includes("<h1>WalletWall</h1>"));
    assert.ok(page.includes("WalletWallaby") && !/Evidence Explorer|walletwallrus/i.test(page + html));
    const eye = ["WalletWall", "eye"].join("");
    const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : scan(join(dir, e.name))) : [join(dir, e.name)]));
    const text = [...scan(`${ROOT}plugin`), ...scan(`${ROOT}docs`), ...scan(`${ROOT}canvas`)].filter((f) => !/\.(png|woff2)$/.test(f));
    for (const f of text) assert.ok(!new RegExp(eye, "i").test(readFileSync(f, "utf8")), `${f} mentions ${eye}`);
  });
});

describe("future affordances are reserved and disabled, never faked", () => {
  test("Compare, Replay and Scenario are disabled with their reason visible on screen; Observed is the active lens", async () => {
    const html = await fragment("usdc-established");
    for (const [label, id] of [["Compare", "why-compare"], ["Replay", "why-replay"], ["Scenario", "why-scenario"]]) {
      assert.ok(html.includes(`<button type="button" disabled aria-describedby="${id}">${label}</button>`), label);
      assert.ok(new RegExp(`<li id="${id}">[^<]+</li>`).test(html), `${label} reason is visible text`);
    }
    assert.ok(html.includes("Replay — requires immutable snapshots.") && html.includes("Scenario — simulation engine not yet enabled."));
    assert.ok(html.includes('<button type="button" class="is-on" aria-pressed="true">Observed</button>'));
  });

  test("Receipt, Verify and QR are disabled, say Requires immutable snapshot, and nothing generates a receipt or QR code", async () => {
    const html = await fragment("usdc-established");
    for (const label of ["Copy receipt", "Verify", "QR"]) assert.ok(html.includes(`<button type="button" disabled aria-describedby="receipt-why">${label}</button>`), label);
    assert.ok(html.includes('<p id="receipt-why" class="ww-reason">Requires immutable snapshot.</p>'));
    const slot = /<div class="ww-qr-slot"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    assert.equal(slot, '<span>QR</span><span class="small">reserved</span>', "the QR slot is empty space, not a code");
    assert.ok(!/qrcode|toDataURL|<canvas/i.test(render.CLIENT_JS + html), "no QR generation anywhere");
    assert.ok(!/receipt[-_:]?id|snapshot[-_:]?id|merkle/i.test(html), "no fake receipt or snapshot identifier");
  });
});

describe("The Wall: semantic graph of exactly what the MCP server returned", () => {
  for (const name of Object.keys(FIXTURES)) {
    test(`${name}: every claim piece carries the support state the engine returned, and the readiness keystone its classification`, async () => {
      const fx = FIXTURES[name]!;
      const direct = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(direct.ok);
      const html = await fragment(name);
      const byAssertion = new Map(pieces(html).filter((p) => p["data-assertion-id"]).map((p) => [p["data-assertion-id"], p]));
      for (const e of (direct.result as { assertions: { assertionId: string; supportState: string; supersededBy: string | null }[] }).assertions) {
        const p = byAssertion.get(e.assertionId);
        assert.ok(p, `${e.assertionId} has a piece`);
        assert.equal(p["data-state"], e.supportState, `${e.assertionId} state`);
        assert.equal((p["data-flags"] ?? "").includes("superseded"), e.supersededBy !== null, `${e.assertionId} superseded layer`);
        assert.ok((p["aria-label"] ?? "").includes(`support ${e.supportState}`), "the state is in the accessible name, not only the picture");
      }
      const keystone = pieces(html).find((p) => p["data-type"] === "readiness");
      if (keystone) {
        const r = callTool("assess_vault_readiness", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" });
        assert.ok(r.ok);
        const cls = (r.result as { classification: string }).classification;
        assert.equal(keystone["data-classification"], cls);
        assert.ok(html.includes(`<div class="ww-arch" data-fit="${cls === "CRITERIA_MET"}">`), "the keystone seats only when the engine says CRITERIA_MET");
        assert.ok(pieces(html).some((p) => p["data-type"] === "snapshot"), "a reserved snapshot slot sits in the chamber");
      }
    });
  }

  test("conflict is a split seam between the two disagreeing pieces; no winner is chosen", async () => {
    const html = await fragment("conflicting-balances");
    const seam = pieces(html).find((p) => p["data-type"] === "conflict");
    assert.equal(seam?.["data-node-id"], "conflict:a-balance|a-balance-2");
    assert.equal((html.match(/data-kind="conflict" data-from="as:a-balance(-2)?" data-to="conflict:a-balance\|a-balance-2"/g) ?? []).length, 2);
    assert.ok(html.includes('data-cue="conflict"'));
  });

  test("unknown is an empty slot, never a zero or false", async () => {
    const html = await fragment("unknown-balance");
    const obs = pieces(html).find((p) => p["data-type"] === "observation");
    assert.ok(obs?.["data-flags"]?.includes("missing"));
    assert.ok(/result NO_RESULT, not a value/.test(obs?.["aria-label"] ?? ""));
    assert.equal(pieces(html).find((p) => p["data-assertion-id"] === "a-nr")?.["data-state"], "UNKNOWN");
    assert.ok(html.includes('data-cue="unknown"'));
  });

  test("superseded stays as a faint historical layer connected to its replacement", async () => {
    const html = await fragment("superseded-balance");
    assert.ok(html.includes('data-kind="supersedes" data-from="as:a-balance" data-to="as:a-balance-new"'));
    const old = pieces(html).find((p) => p["data-assertion-id"] === "a-balance");
    assert.equal(old?.["data-flags"], "superseded");
    assert.equal(old?.["data-state"], "SUPERSEDED");
    assert.ok(html.includes('<circle class="ghost"'), "drawn with a faint historical outline behind it");
  });

  test("a blocked readiness shows which criterion piece is loose, exactly as the engine reported it", async () => {
    const html = await fragment("readiness-blocked");
    assert.ok(html.includes('<li class="ww-piece" data-outcome="INDETERMINATE"><span class="ww-piece-id">C2</span><span class="ww-piece-name">Balance and finality</span>'));
    assert.ok(html.includes('<div class="ww-arch" data-fit="false">'));
    assert.ok(html.includes('data-cue="readiness"'));
  });

  test("the layout is deterministic: the same view always gives the same picture, and nothing simulates", async () => {
    const html = await fragment("conflicting-balances");
    assert.equal(html.replace(/fixture:[a-z-]+/, ""), (await fragment("conflicting-balances")).replace(/fixture:[a-z-]+/, ""));
    const view = { assertions: [], observations: [], sources: [], derivations: [] };
    assert.deepEqual(modelMod.buildCoinstellation(view).nodes, []);
    assert.ok(!/forceLayout|velocity|\.vx\b|LAYOUT_TICKS/.test(render.CLIENT_JS), "the page runs no force simulation");
    for (const p of pieces(html)) assert.ok(/^translate\([-0-9.]+ [-0-9.]+\)$/.test(p["transform"] ?? "") && p["data-px"] !== undefined, `${p["data-node-id"]} has its wide and tall places`);
  });

  test("pieces do not overlap once settled", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const p = pieces(await fragment(name)).map((a) => ({ id: a["data-node-id"], w: Number(a["data-w"]), h: Number(a["data-h"]), xy: (/translate\(([-0-9.]+) ([-0-9.]+)\)/.exec(a["transform"] ?? "") ?? []).slice(1).map(Number) }));
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const a = p[i]!;
        const b = p[j]!;
        const overlap = Math.abs(a.xy[0]! - b.xy[0]!) < (a.w + b.w) / 2 && Math.abs(a.xy[1]! - b.xy[1]!) < (a.h + b.h) / 2;
        assert.ok(!overlap, `${name}: ${a.id} overlaps ${b.id}`);
      }
    }
  });

  test("every support state has a geometry and a legend entry; the graph has a text version", async () => {
    assert.deepEqual(Object.keys(render.STATE_GEOMETRY), [...SUPPORT_STATES]);
    const html = await fragment("usdc-established");
    for (const s of SUPPORT_STATES) assert.ok(html.includes(`<strong>${s}</strong>`), `legend: ${s}`);
    const count = pieces(html).length;
    assert.ok(html.includes(`<summary>The Wall as a list (${count} pieces)</summary>`));
    assert.equal((/<details class="ww-section ww-text-version">[\s\S]*?<\/details>/.exec(html)?.[0].match(/<tr><th scope="row">/g) ?? []).length, count, "one row per piece");
    for (const pc of pieces(html)) assert.ok(pc["tabindex"] === "0" && pc["role"] === "button" && (pc["aria-label"] ?? "").length > 0, `${pc["data-node-id"]} is keyboard-reachable and named`);
  });
});

/** A small stand-in DOM, enough for the page script to load one fragment and drive The Wall and the guide. */
function stage(html: string, opts: { reduce: boolean }) {
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const classes = (): { set: Set<string>; add: (c: string) => void; remove: (c: string) => void; toggle: (c: string, f?: boolean) => void; contains: (c: string) => boolean } => {
    const set = new Set<string>();
    return { set, add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => ((f ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const toCamel = (s: string): string => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  const element = (attrs: Record<string, string>) => {
    const attributes = { ...attrs };
    const dataset: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith("data-")) dataset[toCamel(k.slice(5))] = v;
    const classList = classes();
    for (const c of (attrs["class"] ?? "").split(/\s+/).filter(Boolean)) classList.add(c);
    return { attributes, dataset, classList, style: {} as Record<string, string>, hidden: false, textContent: "", getAttribute: (k: string) => attributes[k] ?? null, setAttribute: (k: string, v: string) => (attributes[k] = String(v)), focus: () => undefined, querySelectorAll: () => [], querySelector: () => null };
  };
  const nodes = pieces(html).map((a) => element(a));
  const edges = [...html.matchAll(/<path class="ww-edge"([^>]*)>/g)].map((m) => element(Object.fromEntries([...(m[1] as string).matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1] as string, x[2] as string]))));
  const svgAttrs = Object.fromEntries([...(/<svg class="ww-wall-svg"([^>]*)>/.exec(html)?.[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1] as string, x[2] as string]));
  const svg = { ...element(svgAttrs), querySelectorAll: (s: string) => (s === ".ww-node" ? nodes : s === ".ww-edge" ? edges : []), querySelector: () => null };
  const cues = [...html.matchAll(/<li data-cue="([^"]*)" data-node="([^"]*)" data-pose="([^"]*)">([^<]*)<\/li>/g)].map((m) => ({ ...element({ "data-cue": m[1] as string, "data-node": m[2] as string, "data-pose": m[3] as string }), textContent: m[4] as string }));
  const handlers: Record<string, (e: unknown) => void> = {};
  const app = { ...element({}), innerHTML: "", addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h), querySelector: (s: string) => (s === ".ww-wall-svg" ? svg : s === "[data-guide-toggle]" ? toggle : null), querySelectorAll: (s: string) => (s === ".ww-guide-cues li" ? cues : s === "[data-guide-toggle]" ? [toggle] : []) };
  const toggle = element({ "data-guide-toggle": "" });
  let guideClick: ((e: unknown) => void) | undefined;
  const guide = { ...element({ "data-peek": "out" }), hidden: true, addEventListener: (_t: string, h: (e: unknown) => void) => (guideClick = h) };
  const guideText = element({});
  const guideArt = element({ "data-pose": "inspect" });
  const ids: Record<string, unknown> = { app, wallaby: guide, "wallaby-text": guideText, "wallaby-art": guideArt, "copy-status": element({}), "view-status": element({}) };
  const context = {
    location: { pathname: "/KEY/" },
    document: { activeElement: null, getElementById: (id: string) => ids[id] ?? null },
    window: { matchMedia: (q: string) => ({ matches: opts.reduce && q.includes("reduced-motion"), addEventListener: () => undefined }), requestAnimationFrame: (f: () => void) => frames.push(f), getSelection: () => null },
    fetch: () => Promise.resolve({ text: () => Promise.resolve(html) }),
    EventSource: class {
      onmessage: unknown;
    },
    CSS: { escape: (s: string) => s },
    setTimeout: (f: () => void) => timers.push(f),
    clearTimeout: () => undefined,
    Math,
    Map,
    Set,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Infinity,
  };
  runInNewContext(render.CLIENT_JS, context);
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const pump = (limit = 1000): number => {
    let n = 0;
    while (frames.length && n < limit) {
      (frames.shift() as () => void)();
      n++;
    }
    return n;
  };
  return { nodes, svg, guide, guideText, toggle, frames, timers, settle, pump, click: (target: unknown) => guideClick?.({ target }), appClick: (target: unknown) => handlers["click"]?.({ target }) };
}

describe("motion means something: assembly once, reduced motion respected, guide dismissible", () => {
  test("with reduced motion requested nothing animates: the pieces are drawn directly at rest", async () => {
    const html = await fragment("conflicting-balances");
    const s = stage(html, { reduce: true });
    const before = s.nodes.map((n) => n.attributes["transform"]);
    await s.settle();
    assert.equal(s.frames.length, 0, "no animation frame was requested");
    assert.deepEqual(s.nodes.map((n) => n.attributes["transform"]), before);
    assert.equal(s.svg.style["minWidth"], undefined, "The Wall has no minimum width, so it never pushes its frame sideways");
    assert.equal(s.svg.dataset["zoom"], "1", "The Wall opens fitted to its frame");
    assert.equal(s.svg.attributes["viewBox"], (/<svg class="ww-wall-svg" viewBox="([^"]*)"/.exec(html)?.[1] ?? "").split(" ").map((v) => String(Math.round(Number(v) * 10) / 10)).join(" "), "the fitted view is the server's whole-wall view box");
    assert.equal(s.guide.dataset["peek"], "in", "the guide appears without a peek animation");
  });

  test("with motion allowed The Wall assembles once, the keystone resolves last, then everything is still at the server's positions", async () => {
    const html = await fragment("readiness-blocked");
    const s = stage(html, { reduce: false });
    const finalPositions = s.nodes.map((n) => n.attributes["transform"]);
    await s.settle();
    assert.ok(s.frames.length > 0, "assembly started");
    const keystone = s.nodes.find((n) => n.dataset["type"] === "readiness")!;
    assert.ok(keystone.classList.contains("is-resolving"), "readiness waits to resolve until the pieces settle");
    (s.frames.shift() as () => void)();
    assert.notDeepEqual(s.nodes.map((n) => n.attributes["transform"]), finalPositions, "the pieces really move during assembly");
    const used = s.pump();
    assert.ok(used < 200, "the simulation stops on its own");
    assert.equal(s.frames.length, 0, "no perpetual animation");
    assert.deepEqual(s.nodes.map((n) => n.attributes["transform"]), finalPositions);
    assert.ok(!keystone.classList.contains("is-resolving"));
  });

  test("WalletWallaby shows one contextual cue, points at the piece it explains, and the guide control hides it", async () => {
    const s = stage(await fragment("conflicting-balances"), { reduce: false });
    await s.settle();
    s.pump();
    assert.equal(s.guide.hidden, false);
    assert.match(s.guideText.textContent, /disagree/);
    const seam = s.nodes.find((n) => n.dataset["type"] === "conflict")!;
    assert.ok(seam.classList.contains("is-pointed"), "the cue points at the conflict it is about");
    assert.equal(s.guide.dataset["target"], seam.dataset["nodeId"], "the guide names its target");
    s.appClick({ closest: (sel: string) => (sel === "[data-guide-toggle]" ? s.toggle : null) });
    assert.equal(s.guide.dataset["peek"], "out");
    for (const t of s.timers.splice(0)) t();
    assert.equal(s.guide.hidden, true);
    assert.ok(!seam.classList.contains("is-pointed"));
  });

  test("Hide Guide hides WalletWallaby and Show Guide brings it back; the control always names what it will do", async () => {
    const s = stage(await fragment("conflicting-balances"), { reduce: true });
    await s.settle();
    const toggleTarget = { closest: (sel: string) => (sel === "[data-guide-toggle]" ? s.toggle : null) };
    assert.equal(s.toggle.textContent, "Hide Guide", "guide visible: the control reads Hide Guide");
    assert.equal(s.guide.hidden, false);
    s.appClick(toggleTarget);
    assert.equal(s.guide.hidden, true, "Hide Guide removes WalletWallaby (immediately, under reduced motion)");
    assert.equal(s.toggle.textContent, "Show Guide", "guide hidden: the control reads Show Guide");
    s.appClick(toggleTarget);
    assert.equal(s.guide.hidden, false, "Show Guide restores WalletWallaby");
    assert.equal(s.guide.dataset["peek"], "in");
    assert.match(s.guideText.textContent, /disagree/, "with the cue it was showing");
    assert.equal(s.toggle.textContent, "Hide Guide");
  });
});

describe("final layout and copy contract", () => {
  const OLD_GUIDE_WORDING = /Guide on|Guide off|Turn the guide off/i;

  test("guide controls say exactly Show Guide or Hide Guide; the old wording appears nowhere in the plugin or the documentation", async () => {
    const page = render.renderPage({ nonce: "n" });
    const html = await fragment("usdc-established");
    assert.ok(html.includes('<button type="button" data-guide-toggle aria-controls="wallaby">Hide Guide</button>'));
    assert.ok(!/data-wallaby-off|data-wallaby-dismiss/.test(page), "the bubble has no buttons of its own: the one guide control is Hide Guide / Show Guide");
    assert.ok(render.CLIENT_JS.includes('ui.guideOff ? "Show Guide" : "Hide Guide"'));
    const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scan(join(dir, e.name)) : [join(dir, e.name)]));
    const files = [...scan(`${ROOT}plugin`), ...scan(`${ROOT}docs`), `${ROOT}canvas/README.md`].filter((f) => !/\.(png|woff2)$/.test(f));
    for (const f of files) assert.ok(!OLD_GUIDE_WORDING.test(readFileSync(f, "utf8")), `${f} still uses the old guide wording`);
  });

  test("every fixture's whole wall, readiness keystone included, lies inside the view box the page opens with", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const html = await fragment(name);
      const [x, y, w, h] = (/<svg class="ww-wall-svg" viewBox="([^"]*)"/.exec(html)?.[1] ?? "").split(" ").map(Number) as [number, number, number, number];
      for (const p of pieces(html)) {
        const [px, py] = (/translate\(([-0-9.]+) ([-0-9.]+)\)/.exec(p["transform"] ?? "") ?? []).slice(1).map(Number) as [number, number];
        const pw = Number(p["data-w"]) / 2;
        const ph = Number(p["data-h"]) / 2;
        assert.ok(px - pw >= x && px + pw <= x + w && py - ph >= y && py + ph <= y + h, `${name}: ${p["data-node-id"]} is inside the initial view`);
      }
      if (pieces(html).some((p) => p["data-type"] === "readiness")) assert.ok(html.includes('data-type="readiness"'), `${name}: keystone rendered`);
    }
  });

  test("The Wall fits its frame: no minimum width, no inner horizontal scroller, no page-level overflow hiding, zoom and pan stay inside the frame", async () => {
    const html = await fragment("readiness-blocked");
    assert.ok(!/ww-wall-scroll/.test(html + render.CSS), "no horizontal scroller around The Wall");
    assert.ok(/<div class="ww-wall-view"><svg class="ww-wall-svg"/.test(html));
    const wallRule = /\.ww-wall-svg\{[^}]*\}/.exec(render.CSS)?.[0] ?? "";
    assert.ok(/width:100%/.test(wallRule) && !/min-width/.test(wallRule), "The Wall takes its frame's width and has no minimum width");
    assert.ok(!/svg\.style\.minWidth/.test(render.CLIENT_JS), "the page script never imposes a minimum width on The Wall");
    assert.ok(!/overflow-x:\s*hidden/.test(render.CSS), "overflow is prevented by layout, not hidden");
    assert.ok(/\.ww-stage\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(280px,340px\)/.test(render.CSS), "the inspector column is bounded and The Wall's column can shrink");
    assert.ok(/@media \(min-width:768px\) and \(max-width:1023px\)\{\s*\.ww-stage\{grid-template-columns:minmax\(0,2fr\) minmax\(240px,1fr\)\}/.test(render.CSS), "tablet panels keep the inspector beside The Wall, about a third of the width");
    assert.ok(/@media \(max-width:767px\)\{[\s\S]*?\.ww-detail\{position:fixed;left:0;right:0;bottom:0/.test(render.CSS), "phone panels turn the inspector into a bottom sheet, never a full-width block under The Wall");
    assert.ok(!/max-width:1180px/.test(render.CSS), "no breakpoint stacks the inspector under The Wall any more");
    for (const z of ['data-zoom="out"', 'data-zoom="in"', 'data-zoom="fit"', "data-zoom-level"]) assert.ok(html.includes(z), z);
    assert.ok(render.CLIENT_JS.includes('wall.svg.setAttribute("viewBox"'), "zoom and pan change the view box, not the page scroll");
  });

  test("the page declares the WalletWall mark as its favicon, embedded, so no icon request leaves the page", () => {
    const page = render.renderPage({ nonce: "n" });
    const links = [...page.matchAll(/<link [^>]*>/g)].map((m) => m[0]);
    assert.equal(links.length, 1, "exactly one link element: the icon");
    const m = /^<link rel="icon" type="image\/png" sizes="96x96" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">$/.exec(links[0] ?? "");
    assert.ok(m, "a PNG favicon as a data: URI");
    assert.equal(sha256(Buffer.from(m[1] as string, "base64")), sources.images.find((i) => i.file === "walletwall-brick-wallet-96.png")?.sha256, "the favicon is the recorded brick-wallet mark");
  });

  test("scrollbars are narrow and use WalletWall tokens only", () => {
    assert.ok(/\*\{box-sizing:border-box;scrollbar-width:thin\}/.test(render.CSS));
    assert.ok(render.CSS.includes("html{scrollbar-color:var(--ww-deep-slate) var(--ww-cream)}"));
    for (const m of render.CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/scrollbar/.test(`${m[1]}${m[2]}`)) continue;
      assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(m[2] as string), `${(m[1] as string).trim()} uses WalletWall tokens, not raw colours`);
    }
  });
});
