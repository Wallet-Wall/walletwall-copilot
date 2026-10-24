import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { ENTRIES, ROOT } from "../support/harness.ts";

/**
 * The visual grammar of The Wall: a technical plate, not a set of tokens. Only the semantic anchors are node objects;
 * observations and WalletWall's rule are drafting marks; context is an index mark and a name; states are written, not
 * boxed; line weight says which relationships matter; the sheet grid is sparse and faint; connections are drafted.
 * Presentation only: these tests read the stylesheet and the rendered markup and never touch evidence state.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string }>;
  close: (id: string) => Promise<void>;
}
const { createExplorer } = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { CSS: string };
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, unknown> };
const { LINE_CLASS, EDGE_KINDS } = (await import(pathToFileURL(`${EXT}/coinstellation-model.mjs`).href)) as { LINE_CLASS: Record<string, string>; EDGE_KINDS: Record<string, unknown> };
const css = render.CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const explorer = createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
const plates = new Map<string, string>();
async function plate(name: string): Promise<string> {
  if (!plates.has(name)) {
    const id = `g-${name}`;
    opened.push(id);
    const o = await explorer.open(id, { fixture: name });
    plates.set(name, /<svg class="ww-wall-svg"[\s\S]*?<\/svg>/.exec(await (await fetch(`${o.url}view`)).text())?.[0] ?? "");
  }
  return plates.get(name) as string;
}
const pieces = (svg: string): string[] => svg.split(/(?=<g class="ww-node[ "])/).slice(1);
const attr = (chunk: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(chunk)?.[1];

const token = (name: string): string => {
  const raw = new RegExp(`--${name}:([^;]+);`).exec(css)?.[1] ?? "";
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? token(ref[1] as string) : raw;
};
const rules = (selector: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => (m[1] as string).split(",").map((x) => x.trim()).includes(selector)).map((m) => m[2] as string);
const decl = (selector: string, prop: string): string | undefined => {
  let v: string | undefined;
  for (const r of rules(selector)) for (const d of r.split(";")) if (d.startsWith(`${prop}:`)) v = d.slice(prop.length + 1);
  return v;
};
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (u: number): number => (u / 255 <= 0.03928 ? u / 255 / 12.92 : Math.pow((u / 255 + 0.055) / 1.055, 2.4));
const lum = (c: [number, number, number]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: [number, number, number], b: [number, number, number]): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mix = (c: [number, number, number], base: [number, number, number], a: number): [number, number, number] => c.map((v, i) => v * a + (base[i] as number) * (1 - a)) as [number, number, number];
const colour = (v: string): [number, number, number] => {
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  return rgb(ref ? token(ref[1] as string) : v);
};

describe("a technical plate: only the semantic anchors are node objects", () => {
  test("node objects are at most 45 % of the pieces in every fixture; illustrative glyphs at most 45 % on the canonical three", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const ps = pieces(await plate(name));
      const anchors = ps.filter((p) => attr(p, "data-tier") === "anchor").length;
      const glyphs = ps.filter((p) => /class="ww-glyph"/.test(p)).length;
      assert.ok(anchors / ps.length <= 0.45, `${name}: ${anchors} of ${ps.length} pieces are node objects`);
      // A six-piece bundle is mostly context (contract, wallet, chain keep small glyphs); the share is a gate for the
      // canonical bundles, and every context glyph stays small below.
      if (["usdc-established", "stale-identity", "conflicting-balances"].includes(name)) assert.ok(glyphs / ps.length <= 0.45, `${name}: ${glyphs} of ${ps.length} pieces carry an illustrative glyph`);
      // Context never competes with an anchor: no disc, no enclosing ring at rest, no glyph wider than a small mark.
      for (const p of ps.filter((x) => attr(x, "data-tier") === "context")) assert.ok(!/class="ww-glyph" transform="scale\((?!0\.55\))/.test(p), `${name}: ${attr(p, "data-node-id")} keeps a small mark`);
    }
  });

  test("states are written beside the piece in small capitals; no boxed state tag on the plate", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const svg = await plate(name);
      assert.ok(!/ww-chip/.test(svg), `${name}: no chip component on the plate`);
      for (const p of pieces(svg)) {
        const state = attr(p, "data-state");
        if (state && state !== "NONE" && state !== "UNRECOGNISED") assert.ok(new RegExp(`<text[^>]*class="ww-annot[^"]*"[^>]*>${state}</text>`).test(p), `${name}: ${attr(p, "data-node-id")} writes ${state}`);
        // A rect on a piece is its touch target, a drafting mark, or the keystone's selection frame; none holds words.
        for (const r of p.matchAll(/<rect class="([^"]*)"/g)) assert.ok(/^(ww-hit|ww-draft[\w -]*|ww-halo|ww-reticle)$/.test(r[1] as string), `${name}: ${r[1]} is not a tag`);
      }
    }
    const annot = rules(".ww-annot")[0] ?? "";
    for (const d of ["font-weight:700", "text-transform:uppercase", "letter-spacing:0.08em"]) assert.ok(annot.includes(d), d);
    assert.ok(/\.ww-node text\{font-family:var\(--font-ui\)/.test(css), "annotations are Manrope, like every word on the plate");
    assert.ok(Number(/font-size:([\d.]+)px/.exec(annot)?.[1]) < Number(/font-size:([\d.]+)px/.exec(rules(".ww-node .ww-label")[0] ?? "")?.[1]), "an annotation is smaller than a label, never a giant tag");
  });

  test("context is subordinate: deep-slate Manrope 500 labels that still read at 4.5:1, marks at about 70 %, a quarter in Trace", () => {
    const stage = rgb(token("ww-stage"));
    assert.ok(/font-weight:500;fill:var\(--ww-deep-slate\)/.test(rules('.ww-node[data-tier="context"] .ww-label')[0] ?? ""));
    assert.ok(ratio(rgb(token("ww-deep-slate")), stage) >= 4.5, "context labels keep contrast");
    const o = Number(/opacity:([\d.]+)/.exec(rules('.ww-node[data-tier="context"] .ww-glyph')[0] ?? "")?.[1]);
    assert.ok(o >= 0.55 && o <= 0.75, `context marks at ${o}`);
    assert.ok(/opacity:0\.(2|3)\d?;/.test(rules('.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-node-art')[0] ?? ""), "off-trace pieces fall to 25 to 40 %");
  });
});

describe("line hierarchy and drafted routes", () => {
  test("every connection carries its line class, and the classes keep their order: trace > primary > secondary > reference > grid", async () => {
    for (const k of Object.keys(EDGE_KINDS)) assert.ok(["primary", "secondary", "reference", "construction", "conflict"].includes(LINE_CLASS[k] as string), `${k} has a line class`);
    for (const name of Object.keys(FIXTURES)) for (const e of (await plate(name)).matchAll(/<path class="ww-edge" data-kind="([^"]+)"[^>]*data-line="([^"]+)"/g)) assert.equal(e[2], LINE_CLASS[e[1] as string], `${name}: ${e[1]}`);
    const stage = rgb(token("ww-stage"));
    // Visual weight: how far the line's colour (at its opacity) stands off the stage, times its width.
    const weight = (sel: string, base = ".ww-edge"): number => {
      const stroke = decl(sel, "stroke") ?? decl(base, "stroke") ?? "";
      const w = Number(decl(sel, "stroke-width") ?? decl(base, "stroke-width"));
      const a = Number(decl(sel, "stroke-opacity") ?? 1);
      return (ratio(mix(colour(stroke), stage, a), stage) - 1) * w;
    };
    const trace = weight('.ww-wall-svg[data-trace="true"] .ww-edge[data-trace="true"]');
    const primary = weight('.ww-edge[data-line="primary"]');
    const secondary = weight('.ww-edge[data-line="secondary"]');
    const reference = weight('.ww-edge[data-line="reference"]');
    const construction = weight('.ww-edge[data-line="construction"]');
    const grid = (() => {
      const m = /\.ww-wall\{[^}]*linear-gradient\(rgba\((\d+),(\d+),(\d+),([\d.]+)\) 1px,transparent 1px\)/.exec(css) as RegExpExecArray;
      return ratio(mix([Number(m[1]), Number(m[2]), Number(m[3])], stage, Number(m[4])), stage) - 1;
    })();
    assert.ok(trace > primary && primary > secondary && secondary > reference && reference > grid, `trace ${trace.toFixed(2)} primary ${primary.toFixed(2)} secondary ${secondary.toFixed(2)} reference ${reference.toFixed(2)} grid ${grid.toFixed(3)}`);
    assert.ok(construction <= reference, "construction is the faintest relationship");
    assert.ok(secondary < primary / 2 && reference < primary / 4, "secondary and reference never compete with the evidence path");
    assert.ok(/stroke-dasharray/.test(rules('.ww-edge[data-line="construction"]')[0] ?? ""), "construction is dashed");
    assert.ok(/marker-end:url\(#ww-arrow\)/.test(rules('.ww-edge[data-line="primary"]')[0] ?? "") && !/marker-end/.test(rules('.ww-edge[data-line="reference"]').join("")), "arrows on evidence only");
  });

  test("connections are drafted: straight segments only, each along an axis or at 45 degrees, never a decorative curve", async () => {
    for (const name of Object.keys(FIXTURES)) {
      for (const m of (await plate(name)).matchAll(/<path class="ww-edge" [^>]*d="([^"]+)"/g)) {
        const d = m[1] as string;
        assert.ok(/^[ML\d. -]+$/.test(d), `${name}: ${d} uses only moves and lines`);
        let last: [number, number] | null = null;
        for (const c of d.matchAll(/([ML])([-\d.]+) ([-\d.]+)/g)) {
          const p: [number, number] = [Number(c[2]), Number(c[3])];
          if (c[1] === "L" && last) {
            const dx = Math.abs(p[0] - last[0]), dy = Math.abs(p[1] - last[1]);
            assert.ok(dx < 0.15 || dy < 0.15 || Math.abs(dx - dy) < 0.25, `${name}: segment ${last.join(",")} to ${p.join(",")} is drafted`);
          }
          last = p;
        }
      }
    }
  });

  test("the plate is constructed: the Wallmark, WalletWall's rule and the readiness keystone stand on one evaluation axis", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const ps = pieces(await plate(name));
      const at = (type: string): string[] => ps.filter((p) => attr(p, "data-type") === type);
      const [mark, rule, key] = [at("wallmark")[0], at("derivation")[0], at("readiness")[0]];
      if (!mark || !rule || !key) continue;
      const wide = (p: string): number => Number(/transform="translate\([-\d.]+ ([-\d.]+)\)"/.exec(p)?.[1]);
      const tall = (p: string): number => Number(attr(p, "data-px"));
      assert.ok(Math.abs(wide(mark) - wide(rule)) < 1 && Math.abs(wide(mark) - wide(key)) < 1, `${name}: one horizontal axis on the wide plate`);
      assert.ok(Math.abs(tall(mark) - tall(key)) < 1, `${name}: one vertical axis on the tall plate`);
      for (const plateKey of ["wide", "tall"]) assert.match(await plate(name), new RegExp(`<g class="ww-construction" data-for="${plateKey}" aria-hidden="true">[^]*?class="ww-axis ww-axis-eval"`), `${name} ${plateKey}: the evaluation centreline`);
    }
  });
});

describe("the sheet: sparse grid, few registration marks", () => {
  test("a 64 px major grid at most 1.08:1 and no minor grid; at most 8 registration marks per plate, none on a phone", async () => {
    const stage = rgb(token("ww-stage"));
    const wall = rules(".ww-wall")[0] ?? "";
    const layers = [...wall.matchAll(/linear-gradient\((?:90deg,)?rgba\((\d+),(\d+),(\d+),([\d.]+)\) 1px,transparent 1px\)/g)];
    assert.equal(layers.length, 2, "one major grid: one horizontal and one vertical layer, no minor subdivisions");
    for (const l of layers) assert.ok(ratio(mix([Number(l[1]), Number(l[2]), Number(l[3])], stage, Number(l[4])), stage) <= 1.08);
    const size = Number(/background-size:(\d+)px \d+px/.exec(wall)?.[1]);
    assert.ok(size >= 48 && size <= 64, `major grid ${size} px`);
    for (const name of Object.keys(FIXTURES)) for (const g of (await plate(name)).matchAll(/<g class="ww-construction" data-for="(\w+)"[^>]*>([^]*?)<\/g>/g)) assert.ok(((g[2] as string).match(/class="ww-reg"/g) ?? []).length <= 8, `${name} ${g[1]}`);
    const phone = /@media \(max-width:767px\)\{([\s\S]*?)\n\}/.exec(render.CSS)?.[1] ?? "";
    assert.ok(/\.ww-reg\{display:none\}/.test(phone), "the phone plate drops its crop marks");
  });

  test("the adapter that places the plate stays presentation-only: no clock, randomness, storage or network", () => {
    const src = readFileSync(`${EXT}/coinstellation-model.mjs`, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/Date\b|Math\.random|performance\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|import\(|require\(|process\./.test(src));
    assert.ok(!/^import /m.test(src), "it imports nothing");
  });
});
