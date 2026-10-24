import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { ENTRIES, ROOT } from "../support/harness.ts";

/**
 * Material and typography: the Canvas is a matte, drafted WalletWall plate. The product name is the terracotta wordmark;
 * Sora, Manrope and IBM Plex Mono keep their roles; nothing visible is white; pieces are a flat fill and one ring, and
 * nothing casts a shadow, bevels, shines or presses in. Presentation only: these tests read the stylesheet and the
 * rendered markup and never touch evidence state.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string }>;
  close: (id: string) => Promise<void>;
}
const { createExplorer } = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { CSS: string };
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, unknown> };
// Comments stripped, so a selector is only the selector.
const css = render.CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const explorer = createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
async function fragment(name: string): Promise<string> {
  const id = `m-${name}-${opened.length}`;
  opened.push(id);
  const o = await explorer.open(id, { fixture: name });
  return (await fetch(`${o.url}view`)).text();
}

/** A CSS custom property's value, following var() references. */
const token = (name: string): string => {
  const raw = new RegExp(`--${name}:([^;]+);`).exec(css)?.[1] ?? "";
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? token(ref[1] as string) : raw;
};
/** Every rule whose selector list contains `selector` exactly, as declaration text. */
const rules = (selector: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => (m[1] as string).split(",").map((x) => x.trim()).includes(selector)).map((m) => m[2] as string);
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (u: number): number => (u / 255 <= 0.03928 ? u / 255 / 12.92 : Math.pow((u / 255 + 0.055) / 1.055, 2.4));
const lum = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** OKLab lightness and chroma. */
const oklab = (hex: string): { L: number; C: number } => {
  const [r, g, b] = rgb(hex).map((u) => (u / 255 <= 0.04045 ? u / 255 / 12.92 : Math.pow((u / 255 + 0.055) / 1.055, 2.4))) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, C: Math.hypot(A, B) };
};
/** Reads as white: very light, or light and nearly neutral. Cream, parchment, sand and warm stone stay below it. */
const readsWhite = (hex: string): boolean => {
  const o = oklab(hex);
  return o.L >= 0.9 || (o.L >= 0.86 && o.C < 0.02);
};
/** rgba(r,g,b,a) composited over a hex colour. */
const over = (rgba: string, hex: string): string => {
  const [r, g, b, a] = (/rgba\(([^)]+)\)/.exec(rgba)?.[1] ?? "0,0,0,0").split(",").map(Number) as [number, number, number, number];
  const base = rgb(hex);
  return `#${[r, g, b].map((v, i) => Math.round(v * a + (base[i] as number) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
};

describe("the WalletWall wordmark and type roles", () => {
  test("the product name is the wordmark: Sora 600 in the canonical terracotta token, shown at every width", async () => {
    assert.equal(token("ww-accent"), "#BF4E32", "the canonical terracotta");
    const [rule] = rules(".ww-rail-name h1");
    assert.ok(rule?.includes("color:var(--ww-accent)"), "the wordmark resolves to --ww-accent, not a duplicate hex");
    assert.ok(/font:600 \d+px\/[\d.]+ var\(--font-display\)/.test(rule ?? ""), "Sora 600");
    assert.ok(!/\.ww-rail-name\{[^}]*(position:absolute|clip:rect|display:none)/.test(css), "no width hides the wordmark");
    // Only the product name is recoloured: no other rule paints text in the accent.
    const painted = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /(^|;)color:var\(--ww-accent\)/.test(m[2] as string)).map((m) => (m[1] as string).trim());
    assert.deepEqual(painted, [".ww-rail-name h1"]);
    for (const name of Object.keys(FIXTURES)) assert.ok((await fragment(name)).includes('<div class="ww-rail-name"><h1>WalletWall</h1>'), name);
  });

  test("asset context is Manrope and smaller than the wordmark", () => {
    const [symbol] = rules(".ww-rail-symbol");
    assert.ok(/font:700 15px\/[\d.]+ var\(--font-ui\)/.test(symbol ?? ""));
    assert.ok(Number(/font:600 (\d+)px/.exec(rules(".ww-rail-name h1")[0] ?? "")?.[1]) > 15);
  });

  test("Sora for display headings, Manrope for UI and body, IBM Plex Mono for exact values only", () => {
    assert.ok(/h1,h2\{font-family:var\(--font-display\);font-weight:600/.test(css));
    for (const sel of [".ww-section-head h2", ".ww-wallprint>h2"]) assert.ok(/font:600 [\d.]+px\/[\d.]+ var\(--font-display\)/.test(rules(sel)[0] ?? ""), sel);
    assert.ok(/body\{[^}]*font:14px\/1\.5 var\(--font-ui\);font-weight:500/.test(css));
    // The mono family appears only for code (exact values) and criterion IDs.
    const mono = [...css.matchAll(/([^{}]+)\{([^{}]*var\(--font-mono\)[^{}]*)\}/g)].map((m) => (m[1] as string).trim()).filter((s) => !s.startsWith(":root"));
    assert.deepEqual(mono.sort(), [".ww-piece-id", "code"]);
    for (const v of ["--font-display", "--font-ui", "--font-mono"]) assert.ok(!/url\(|https?:/.test(token(v.slice(2))), `${v} names families only`);
    // Weights stay inside the embedded faces, so nothing is synthesised: Manrope at most 700, IBM Plex Mono 400 or 500.
    assert.ok(!/font-weight:(?:8|9)00|font:(?:8|9)00 /.test(css), "no 800 or 900");
    for (const m of css.matchAll(/(?:font:(\d{3}) [^;]*var\(--font-mono\)|var\(--font-mono\);font-size:[\d.]+px;font-weight:(\d{3}))/g)) assert.ok(["400", "500"].includes((m[1] ?? m[2]) as string), `mono at ${m[1] ?? m[2]}`);
  });

  test("eyebrows: 10.5 px, 700, 0.16 em, uppercase, in the brick tone", () => {
    const [eyebrow] = rules(".ww-eyebrow");
    for (const d of ["font-size:10.5px", "font-weight:700", "letter-spacing:0.16em", "text-transform:uppercase", "color:var(--ww-brick-low)"]) assert.ok(eyebrow?.includes(d), d);
  });
});

describe("no white UI", () => {
  test("no visible surface token is white or reads as white; the near-white canonical tokens paint no surface", () => {
    assert.ok(!/#fff\b|#ffffff\b|rgb\(255, ?255, ?255\)|:white\b/i.test(css), "no pure white anywhere");
    for (const t of ["ww-page", "ww-stage", "ww-rail", "ww-node", "ww-node-quiet", "ww-label", "ww-shell", "ww-charcoal", "ww-deep-slate", "ww-accent-dark"]) {
      const v = token(t);
      assert.match(v, /^#[0-9A-Fa-f]{6}$/, t);
      assert.ok(!readsWhite(v), `${t} ${v} reads as cream, parchment, sand or stone, not white`);
    }
    assert.ok(!/(background|background-color|fill):var\(--ww-(cream|bg|surface|mortar)\)/.test(css), "cream, paper and mortar paint no surface, node, chip or button");
  });

  test("major surfaces separate by flat fill: workspace, stage and rail; the rail is one sheet, its folded rows divided by hairlines", () => {
    const [page, stage, rail] = ["ww-page", "ww-stage", "ww-rail"].map(token) as [string, string, string];
    assert.ok(ratio(page, stage) >= 1.15 && ratio(stage, rail) >= 1.15 && ratio(page, rail) >= 1.15);
    // The folded sections' headers are rows of the rail itself, not tabs on a second fill.
    for (const sel of [".ww-more>summary", ".ww-detail .ww-more>summary", ".ww-more"]) assert.ok(!/background/.test(rules(sel).join(";")), `${sel} paints no fill of its own`);
    assert.ok(rules(".ww-more")[0]?.includes("border-top:1px solid var(--ww-cut)"), "one hairline between folded sections");
    assert.ok(!/--ww-row:/.test(css), "no second rail tone");
  });
});

describe("matte, drafted material", () => {
  test("nothing casts a shadow, bevels, shines or presses in", () => {
    assert.ok(!/box-shadow/.test(css), "no box shadow: not on pieces, chips, controls, panels, menus or tooltips");
    assert.ok(!/text-shadow|drop-shadow|filter:|radial-gradient|conic-gradient/.test(css), "no text shadow, filter or radial shine");
    assert.ok(!/border(-\w+)?:[^;]*\b(outset|inset|ridge|groove)\b/.test(css), "no bevelled border styles");
    // Gradients only draw the stage's 1 px grid and the phone strip's edge fade; no tonal or glossy gradient.
    const gradients = [...css.matchAll(/([^{}]+)\{([^{}]*linear-gradient[^{}]*)\}/g)].map((m) => (m[1] as string).trim());
    assert.deepEqual(gradients, [".ww-wall", ".ww-strip"]);
    for (const k of css.matchAll(/@keyframes ([\w-]+)\{([\s\S]*?\})\}/g)) assert.ok(!/scale\(/.test(k[2] as string), `${k[1]}: no pulsing scale`);
  });

  test("pieces are a flat fill and one ring; a state adds at most one ring; selection lies on the ring", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const svg = /<svg class="ww-wall-svg"[\s\S]*?<\/svg>/.exec(await fragment(name))?.[0] ?? "";
      assert.ok(!/ww-lip"|ww-rim"|<filter|<radialGradient|<linearGradient/.test(svg), `${name}: no lip, rim, filter or gradient on a piece`);
      for (const chunk of svg.split(/(?=<g class="ww-node[ "])/).slice(1)) {
        if (/data-type="readiness"/.test(chunk)) continue;
        const r = Number(/<circle class="body" r="([\d.]+)"/.exec(chunk)?.[1]);
        const rings = [...chunk.matchAll(/<circle class="ww-ring[^"]*" r="([\d.]+)"/g)].map((m) => Number(m[1]));
        assert.ok(rings.length <= 1, `${name}: at most one state ring`);
        for (const x of rings) assert.ok((x + 0.6) / (r + 0.5) <= 1.25, `${name}: the state ring stays close (${x} on ${r})`);
        assert.equal(Number(/<circle class="ww-halo" r="([\d.]+)"/.exec(chunk)?.[1]), r, `${name}: the selection halo lies on the ring`);
        assert.ok(/<path class="ww-reticle" d="/.test(chunk), `${name}: the guide's pointer is ticks, not a ring`);
      }
    }
  });

  test("hairline strokes: 1 to 1.2 units for rings and connectors, 2 for selection and emphasis, nothing past 2.5", () => {
    const width = (sel: string): number => Number(/stroke-width:([\d.]+)/.exec(rules(sel).join(";"))?.[1]);
    assert.equal(width(".ww-node .body"), 1);
    assert.ok(width(".ww-node.is-selected .body") <= 2 && width(".ww-node .ww-halo") <= 2);
    assert.ok(width(".ww-edge") <= 1.2 && width(".ww-node .ww-ring-conflict") <= 1.2);
    for (const m of css.matchAll(/\.ww-(?:edge|node)[^{}]*\{[^{}]*stroke-width:([\d.]+)(px)?/g)) if (!m[2]) assert.ok(Number(m[1]) <= 2.5, `stroke ${m[1]}`);
    for (const m of css.matchAll(/border(?:-(?:top|right|bottom|left))?:(\d+)px/g)) assert.ok(Number(m[1]) <= 2, `border ${m[1]} px`);
  });

  test("etch, grid, chips and controls stay restrained", () => {
    assert.match(token("ww-etch"), /rgba\(245,241,232,0\.12\)/, "the connector etch is at most 0.12");
    const [x, y] = (/\.ww-edge-lip\{[^}]*transform:translate\(([\d.]+)px,([\d.]+)px\)/.exec(css)?.slice(1) ?? []).map(Number) as [number, number];
    assert.ok(Math.hypot(x, y) * 1.25 <= 1, "the etch sits under 1 CSS px away at the largest drawing scale");
    const grid = /\.ww-wall\{[^}]*linear-gradient\((rgba\([^)]+\)) 1px,transparent 1px\)/.exec(css)?.[1] ?? "";
    assert.ok(ratio(over(grid, token("ww-stage")), token("ww-stage")) <= 1.15, "the grid is felt, not read");
    assert.ok(parseFloat(token("ww-radius-badge")) <= 3 && parseFloat(token("ww-radius-panel")) <= 3, "chip and toolbar corners at most 3 px");
    assert.ok(rules(".chip")[0]?.includes("border-radius:var(--ww-radius-badge)") && !/999px/.test(css), "no rounded pills");
    assert.ok(!/press|translateY\(1px\)/.test(rules('.ww-modes button[aria-pressed="true"]').join("")), "the active mode is a flat fill");
  });
});
