import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { callTool } from "../../src/tools.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";

/**
 * The phone and tablet compositions of the WalletWall canvas: a portrait Wall (bands read top to bottom), a compact
 * header and state strip, a detail sheet, one compact control group and a list surface. They change presentation only:
 * every piece, state and limitation of the wide composition is still there, and nothing is computed on the page.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string }>;
  close: (id: string) => Promise<void>;
}
const { createExplorer } = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { CLIENT_JS: string; CSS: string };
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, { bundle: { assertions: { id: string; claimType: string }[] }; evaluatedAt: string }> };

const explorer = createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
const fragments = new Map<string, string>();
async function fragment(name: string): Promise<string> {
  if (!fragments.has(name)) {
    const id = `m-${name}`;
    opened.push(id);
    const o = await explorer.open(id, { fixture: name });
    fragments.set(name, await (await fetch(`${o.url}view`)).text());
  }
  return fragments.get(name) as string;
}
const attrs = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1] as string, a[2] as string]));
/** Each piece of The Wall: its attributes and the markup of its compact (portrait) face. */
const pieces = (html: string): { a: Record<string, string>; compact: string }[] => {
  const svg = /<svg class="ww-wall-svg"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
  return svg
    .split(/(?=<g class="ww-node[ "])/)
    .slice(1)
    .map((chunk) => ({ a: attrs(/^<g ([^>]*)>/.exec(chunk)?.[1] ?? ""), compact: /<g data-face="compact">([\s\S]*?)<\/g>/.exec(chunk)?.[1] ?? "" }))
    .filter((p) => p.a["data-node-id"] !== undefined);
};
const section = (css: string, query: string): string => {
  const start = css.indexOf(`@media ${query}{`);
  assert.ok(start >= 0, `the stylesheet has ${query}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return css.slice(start);
};

describe("portrait Wall: the same pieces, read top to bottom", () => {
  for (const name of Object.keys(FIXTURES)) {
    test(`${name}: every piece has a portrait place inside the portrait frame, and no two pieces overlap`, async () => {
      const html = await fragment(name);
      const all = pieces(html);
      assert.ok(all.length > 0);
      const box = (/data-portrait-viewbox="([^"]*)"/.exec(html)?.[1] ?? "").split(" ").map(Number) as [number, number, number, number];
      assert.equal(box.length, 4);
      const p = all.map(({ a }) => ({ id: a["data-node-id"], x: Number(a["data-px"]), y: Number(a["data-py"]), w: Number(a["data-pw"]), h: Number(a["data-ph"]) }));
      for (const n of p) {
        assert.ok([n.x, n.y, n.w, n.h].every(Number.isFinite), `${n.id} has a portrait place`);
        assert.ok(n.x - n.w / 2 >= box[0] && n.x + n.w / 2 <= box[0] + box[2] && n.y - n.h / 2 >= box[1] && n.y + n.h / 2 <= box[1] + box[3], `${n.id} lies inside the portrait frame`);
      }
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const a = p[i]!;
        const b = p[j]!;
        assert.ok(!(Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2), `${a.id} overlaps ${b.id}`);
      }
      assert.ok(box[2] <= 380, "the portrait frame is a phone's width, not the wide layout's");
    });
  }

  test("bands run in the agreed order: authorities and sources, observations, claims, Wallmark, readiness, foundation", async () => {
    const html = await fragment("usdc-established");
    const titles = [...(/<g data-face="compact" class="ww-bands">([\s\S]*?)<\/g>/.exec(html)?.[1] ?? "").matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
    assert.deepEqual(titles, ["AUTHORITIES · SOURCES", "OBSERVATIONS", "CLAIMS · DERIVATION", "WALLMARK", "VAULT READINESS", "FOUNDATION · SUBJECTS"]);
    const y = (type: string): number => Math.min(...pieces(html).filter(({ a }) => a["data-type"] === type).map(({ a }) => Number(a["data-py"])));
    const order = ["source", "observation", "assertion", "wallmark", "readiness", "contract"].map(y);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "each band sits below the one before it");
  });

  test("a portrait face carries short words and the state: never an assertion ID, never a full address", async () => {
    for (const name of Object.keys(FIXTURES)) {
      for (const { a, compact } of pieces(await fragment(name))) {
        const text = [...compact.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" | ");
        assert.ok(text.length > 0, `${name} ${a["data-node-id"]}: the compact face has words`);
        assert.ok(!/0x[0-9a-fA-F]{40}/.test(text), `${name} ${a["data-node-id"]}: no full address on a piece`);
        if (a["data-assertion-id"]) assert.ok(!text.includes(a["data-assertion-id"]), `${name} ${a["data-node-id"]}: no assertion ID on a piece`);
        if (a["data-state"] && a["data-state"] !== "NONE" && a["data-state"] !== "UNRECOGNISED") assert.ok(text.includes(a["data-state"]), `${name} ${a["data-node-id"]}: the returned state stays on the face`);
        if (a["data-classification"]) assert.ok(text.includes(a["data-classification"]), `${name} ${a["data-node-id"]}: the returned classification stays on the face`);
        assert.ok((a["aria-label"] ?? "").length > 0, "the accessible name keeps the full detail");
      }
    }
  });
});

describe("phone composition: header, state strip, sheet, controls, list", () => {
  test("the state strip repeats exactly what the engine returned, and shows a conflict only when there is one", async () => {
    for (const [name, fx] of Object.entries(FIXTURES)) {
      const html = await fragment(name);
      const strip = /<ul class="ww-strip"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
      const chip = (key: string): string | undefined => new RegExp(`<span class="ww-strip-key">${key}</span><span class="chip"[^>]*>([^<]*)</span>`).exec(strip)?.[1];
      const inspect = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(inspect.ok);
      const identity = fx.bundle.assertions.find((a) => a.claimType === "ASSET_IDENTITY");
      const ev = (inspect.result as { assertions: { assertionId: string; supportState: string; freshnessState: string }[] }).assertions.find((e) => e.assertionId === identity?.id);
      assert.equal(chip("Wallmark"), ev ? ev.supportState : "none", `${name}: Wallmark`);
      assert.equal(chip("Freshness"), ev ? ev.freshnessState : "N/A", `${name}: freshness`);
      const keystone = /data-type="readiness"[^>]*data-classification="([A-Z_]+)"/.exec(html)?.[1];
      if (keystone) assert.equal(chip("Readiness"), keystone, `${name}: readiness`);
      assert.equal(strip.includes('class="ww-strip-key">Conflict<'), html.includes('data-type="conflict"'), `${name}: the conflict chip appears exactly when a split seam does`);
    }
  });

  test("the header carries the asset as presented and its chain ID, and a menu that folds the boundary, versions and lenses", async () => {
    const html = await fragment("usdc-established");
    assert.ok(html.includes('<p class="ww-rail-asset"><span class="ww-rail-symbol">USDC</span><span class="ww-rail-sep" aria-hidden="true">·</span><span class="ww-rail-chain">chain 1</span></p>'));
    assert.ok(html.includes('data-panel-toggle aria-expanded="false" aria-controls="panel-info"'));
    const info = /<div class="ww-panel-info" id="panel-info">([\s\S]*?)<div class="ww-flow">/.exec(html)?.[1] ?? "";
    for (const s of ["ww-boundary", "ww-toolbar", 'class="meta"', "Replay — requires immutable snapshots."]) assert.ok(info.includes(s), s);
  });

  test("one compact Wall control group: Fit, zoom, and a menu with exactly the panel's own controls", async () => {
    const html = await fragment("usdc-established");
    const menu = /<div class="ww-wall-menu" id="wall-menu" hidden>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    assert.deepEqual([...menu.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ["Trace", "Hide Guide", "Reset layout", "Reduce motion", "List view"]);
    assert.ok(html.includes('data-wall-menu-toggle aria-expanded="false" aria-controls="wall-menu" aria-label="Wall options"'));
    assert.ok(html.includes('<button type="button" class="ww-back" data-back-overview>Back to Overview</button>'));
  });

  test("the detail rail is also a sheet: a grip, a one-line summary per panel, and Trace, Show on Wall, More", async () => {
    const html = await fragment("conflicting-balances");
    assert.ok(html.includes('<aside class="ww-detail" id="detail" aria-label="Selected piece" data-sheet="peek">'));
    assert.ok(html.includes('data-sheet-toggle aria-expanded="false" aria-controls="detail"'));
    const actions = /<div class="ww-sheet-actions"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    assert.deepEqual([...actions.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ["Trace", "Show on Wall", "More"]);
    const panels = (html.match(/data-node-panel="/g) ?? []).length + 1;
    assert.equal((html.match(/<div class="ww-sheet-summary">/g) ?? []).length, panels, "every panel the sheet can show has its summary");
    assert.ok(/<div class="ww-sheet-summary"><p class="ww-sheet-title"><span>Wallmark<\/span><span class="chip" data-state="ESTABLISHED">ESTABLISHED<\/span><\/p>/.test(html), "the summary's chip is the returned state");
  });

  test("the list surface has one row per piece, the agreed filters, and full addresses only", async () => {
    const html = await fragment("conflicting-balances");
    const list = /<section class="ww-section ww-list"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    assert.equal((list.match(/<li data-kinds="/g) ?? []).length, pieces(html).length);
    assert.deepEqual([...list.matchAll(/data-list-filter="([a-z]+)"/g)].map((m) => m[1]), ["all", "claims", "sources", "observations", "conflicts", "readiness", "missing"]);
    assert.ok(list.includes('<label class="ww-sr" for="ww-search">Search The Wall</label>'));
    assert.ok(!/0x[0-9a-fA-F]{2,}…/.test(list), "no shortened address in the list or its search text");
    assert.ok(list.includes("0x1234567890123456789012345678901234567890"), "the holder is listed in full");
    for (const row of list.matchAll(/data-focus-node="([^"]+)"/g)) assert.ok(html.includes(`data-node-id="${row[1]}"`), `${row[1]}: a row leads to a piece`);
  });

  test("Receipt folds to one row on a phone and still says why it is unavailable; Wallprint tiles and the readiness list lead to their pieces", async () => {
    const html = await fragment("readiness-blocked");
    assert.ok(html.includes('<button type="button" class="ww-receipt-row" data-receipt-toggle aria-expanded="false" aria-controls="receipt-body"><span class="ww-receipt-row-text"><strong>Receipt</strong><span class="ww-reason">Requires immutable snapshot.</span>'));
    const keystone = /data-node-id="(as:[^"]+)" data-type="readiness"/.exec(html)?.[1];
    assert.ok(keystone && html.includes(`<ol class="ww-course" aria-label="Readiness criteria" data-focus-node="${keystone}">`));
    for (const m of html.matchAll(/class="ww-brick[^"]*"[^>]*data-focus-node="([^"]+)"/g)) assert.ok(html.includes(`data-node-id="${m[1]}"`), `${m[1]}: a Wallprint tile leads to a piece`);
  });
});

describe("the stylesheet's compositions", () => {
  const css = render.CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = section(css, "(max-width:767px)");
  const compact = section(css, "(max-width:1023px)");

  test("breakpoints: phone below 768 px, tablet 768 to 1023 px, the wide composition from 1024 px", () => {
    assert.ok(/@media \(min-width:768px\) and \(max-width:1023px\)\{\s*\.ww-stage\{grid-template-columns:minmax\(0,2fr\) minmax\(240px,1fr\)\}/.test(css));
    assert.ok(/\.ww-wall-svg\[data-layout="portrait"\]\{height:clamp\(360px,70vh,620px\)/.test(css), "the portrait stage uses the viewport, within 360 to 620 px");
    assert.ok(compact.includes(".ww-rail-facts{display:none}") && compact.includes(".ww-strip{display:flex"), "below 1024 px: compact header and state strip");
  });

  test("on a phone only the detail sheet stays on screen: no sticky header, strip or toolbar", () => {
    assert.ok(/\.ww-detail\{position:fixed;left:0;right:0;bottom:0/.test(phone));
    assert.ok(!/sticky/.test(compact), "nothing sticky in the compact header and strip");
    const sticky = [...phone.matchAll(/([^{}]+)\{[^}]*position:sticky/g)].map((m) => (m[1] as string).trim());
    assert.deepEqual(sticky, [".ww-sheet-bar", ".ww-sheet-actions"], "only the sheet's own bar and actions stick, inside the sheet");
    for (const state of ["half", "full"]) assert.ok(phone.includes(`.ww-detail[data-sheet="${state}"]{height:`), state);
    assert.ok(phone.includes(".ww-detail{position:fixed") && phone.includes("height:var(--ww-peek)"), "peek");
  });

  test("touch targets on a phone are at least 44 px; no grey or blue tap flash", () => {
    for (const [block, sel] of [[compact, ".ww-strip-item{"], [phone, ".ww-zoom button{"], [phone, ".ww-wall-menu button{"], [phone, ".ww-sheet-actions button{"], [phone, ".ww-filters button{"], [phone, ".ww-search{"], [phone, ".ww-receipt-row{"], [phone, ".ww-why-more summary{"]] as const) {
      const rule = block.slice(block.indexOf(sel), block.indexOf("}", block.indexOf(sel)));
      assert.ok(block.includes(sel) && /min-height:(4[4-9]|5\d)px/.test(rule), `${sel} has a 44 px target`);
    }
    assert.ok(/\.ww-icon-button\{[^}]*min-width:44px;min-height:44px/.test(css));
    assert.ok(phone.includes("-webkit-tap-highlight-color:transparent"));
  });

  test("on a phone: explanations fold behind Why?, no QR placeholder, no wide table", () => {
    assert.ok(phone.includes(".ww-explain{display:none}") && phone.includes(".ww-why-more{display:block"));
    assert.ok(phone.includes(".ww-qr-slot{display:none}"));
    assert.ok(phone.includes(".ww-flow>.ww-claims,.ww-flow>.ww-text-version{display:none}") && phone.includes(".ww-list{display:block}"), "the list replaces the table");
    assert.ok(phone.includes(".ww-criteria thead{display:none}"), "the criteria table becomes stacked rows");
  });
});

/** The page script against a stand-in DOM in a phone's portrait viewport. */
function phoneStage(html: string, opts: { reduce: boolean }) {
  const frames: (() => void)[] = [];
  const toCamel = (s: string): string => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  const element = (a: Record<string, string>) => {
    const attributes = { ...a };
    const dataset: Record<string, string> = {};
    for (const [k, v] of Object.entries(a)) if (k.startsWith("data-")) dataset[toCamel(k.slice(5))] = v;
    const set = new Set((a["class"] ?? "").split(/\s+/).filter(Boolean));
    const classList = { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c), toggle: (c: string, f?: boolean) => ((f ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c: string) => set.has(c) };
    return { attributes, dataset, classList, style: {} as Record<string, string>, hidden: false, textContent: "", getAttribute: (k: string) => attributes[k] ?? null, setAttribute: (k: string, v: string) => (attributes[k] = String(v)), focus: () => undefined, querySelectorAll: () => [], querySelector: () => null };
  };
  const nodes = pieces(html).map(({ a }) => element(a));
  const edges = [...html.matchAll(/<path class="ww-edge"([^>]*)>/g)].map((m) => element(attrs(m[1] as string)));
  const svg = { ...element(attrs(/<svg class="ww-wall-svg"([^>]*)>/.exec(html)?.[1] ?? "")), querySelectorAll: (s: string) => (s === ".ww-node" ? nodes : s === ".ww-edge" ? edges : []), querySelector: () => null };
  const app = { ...element({}), innerHTML: "", addEventListener: () => undefined, querySelector: (s: string) => (s === ".ww-wall-svg" ? svg : null), querySelectorAll: () => [] };
  const ids: Record<string, unknown> = { app, "copy-status": element({}), "view-status": element({}) };
  const matches = (q: string): boolean => (q.includes("reduced-motion") ? opts.reduce : q.includes("max-width: 767px") || q.includes("orientation: portrait"));
  runInNewContext(render.CLIENT_JS, {
    location: { pathname: "/KEY/" },
    document: { activeElement: null, getElementById: (id: string) => ids[id] ?? null },
    window: { matchMedia: (q: string) => ({ matches: matches(q), addEventListener: () => undefined }), requestAnimationFrame: (f: () => void) => frames.push(f), getSelection: () => null },
    fetch: () => Promise.resolve({ text: () => Promise.resolve(html) }),
    EventSource: class {
      onmessage: unknown;
    },
    CSS: { escape: (s: string) => s },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  return { nodes, svg, frames, settle };
}

describe("the page script in a phone's portrait viewport", () => {
  test("it applies the server's portrait layout: portrait places, the portrait frame, the whole wall in view", async () => {
    const html = await fragment("readiness-blocked");
    const s = phoneStage(html, { reduce: true });
    await s.settle();
    assert.equal(s.frames.length, 0, "reduced motion: nothing animates");
    assert.equal(s.svg.dataset["layout"], "portrait");
    assert.equal(s.svg.dataset["zoom"], "1");
    assert.equal(s.svg.attributes["viewBox"], s.svg.attributes["data-portrait-viewbox"]);
    for (const n of s.nodes) assert.equal(n.attributes["transform"], `translate(${n.dataset["px"]} ${n.dataset["py"]})`, `${n.dataset["nodeId"]} at its portrait place`);
    assert.equal(s.svg.style["aspectRatio"], "", "the stage is not sized from the wide layout's proportions");
  });

  test("with motion allowed the pieces settle once into their rows and then stop: no simulation, nothing perpetual", async () => {
    const html = await fragment("conflicting-balances");
    const s = phoneStage(html, { reduce: false });
    await s.settle();
    let used = 0;
    while (s.frames.length && used < 1000) {
      (s.frames.shift() as () => void)();
      used++;
    }
    assert.ok(used > 0 && used <= 20, `settled in ${used} frames`);
    assert.equal(s.frames.length, 0);
    for (const n of s.nodes) assert.equal(n.attributes["transform"], `translate(${n.dataset["px"]} ${n.dataset["py"]})`);
  });

  test("the script listens for turning and resizing, and recomputes the layout when the composition changes", () => {
    for (const s of ['media("(max-width: 767px)")', 'media("(max-width: 1023px) and (orientation: portrait)")', 'window.addEventListener("resize"', "function relayout()"]) assert.ok(render.CLIENT_JS.includes(s), s);
    assert.ok(/pointerType === "touch"/.test(render.CLIENT_JS), "touch is told apart from a mouse (no drag-to-pin under a finger)");
    assert.ok(/touches\.size === 2/.test(render.CLIENT_JS), "pinch zooms");
  });
});
