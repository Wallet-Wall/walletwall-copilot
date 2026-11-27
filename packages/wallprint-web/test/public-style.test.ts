import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { PUBLIC_OUTCOMES } from "../lib/resolve.ts";

/**
 * The public page's own stylesheet layer (browser/public.css), appended last by scripts/build-wallprint-public.ts. It may
 * change presentation only: it references nothing, writes no text, hides and reorders nothing, adds no motion, and keeps
 * every state cue that is not colour. These are static proofs over its source; the rendered proof of a change to it is
 * the before-and-after captures of the generated artifact that go with the change.
 */

const here = decodeURIComponent(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = join(here, "..", "..");
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/** The same reduction the build applies before it serves the layer. */
const served = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{2,}/g, "\n").trim();
const layer = served(read(join(here, "browser", "public.css")));
const build = read(join(root, "scripts", "build-wallprint-public.ts"));
const { WALLPRINT_CSS } = (await import(pathToFileURL(join(root, "plugin", "com.github.copilot", "extensions", "walletwall-evidence-explorer", "wallprint-styles.mjs")).href)) as { WALLPRINT_CSS: string };

/** Innermost rules: selector list and declarations (an at-rule's braces are skipped, its rules are kept). */
function rules(css: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1]!.split(",").map((s) => s.trim()).filter(Boolean), body: m[2]! }));
}

/** What a presentation-only layer must never do, each with the reason a reviewer would give. */
const FORBIDDEN: [RegExp, string][] = [
  [/url\(|@import|data:|https?:/i, "references a resource"],
  [/content\s*:\s*(?!none\s*[;}])/i, "writes text through generated content"],
  [/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0\s*[;}]/i, "hides content"],
  [/opacity\s*:\s*(?!1\s*[;}])/i, "fades content"],
  [/(?:^|[;{\s])order\s*:|-reverse\b/i, "reorders content"],
  [/animation|@keyframes|transition/i, "adds motion"],
  [/text-transform\s*:\s*uppercase/i, "sets letter capitals"],
  [/gradient\(/i, "draws a gradient"],
  [/(?:box|text)-shadow/i, "draws a shadow"],
  [/border-radius\s*:\s*(?!0\s*[;}])/i, "rounds a corner"],
  [/position\s*:\s*(?:fixed|sticky)/i, "pins an element"],
  [/!important/i, "overrides with !important"],
];

function findings(css: string): string[] {
  return FORBIDDEN.filter(([re]) => re.test(css)).map(([, why]) => why);
}

/** The attribute selectors a stylesheet gives a dotted or a dashed left edge, as `kind selector-tail`. */
function edges(css: string, element: string): Set<string> {
  const out = new Set<string>();
  for (const r of rules(css)) {
    const kind = /border(?:-left)?(?:-style)?\s*:[^;}]*\bdotted\b/.test(r.body) ? "dotted" : /border(?:-left)?(?:-style)?\s*:[^;}]*\bdashed\b/.test(r.body) ? "dashed" : null;
    if (kind === null) continue;
    for (const s of r.selectors) {
      const m = new RegExp(`\\.${element}(\\[data-[a-z]+="[A-Z_]+"\\])$`).exec(s);
      if (m) out.add(`${kind} ${m[1]}`);
    }
  }
  return out;
}

describe("the public stylesheet layer", () => {
  test("is read from browser/public.css and appended last, after the canvas and WallPrint stylesheets", () => {
    assert.ok(build.includes('read(join(root, "packages", "wallprint-web", "browser", "public.css"))'));
    assert.ok(build.includes("`${fontFaces}\\n${markCss}\\n${CSS}\\n${WALLPRINT_CSS}\\n${PUBLIC_CSS}\\n`"));
    assert.ok(layer.length > 1000 && !layer.includes("/*"), "the served layer is rules only");
  });

  test("changes presentation only: no reference, generated text, hiding, reordering, motion, capitals, gradient, shadow, radius, pinning or !important", () => {
    assert.deepEqual(findings(layer), []);
  });

  test("each of those checks catches its own violation (positive controls)", () => {
    const controls = [
      ".x{background:url(a.png)}",
      ".x::after{content:\"Verified\"}",
      ".x{display:none}",
      ".x{opacity:0}",
      ".x{order:-1}",
      ".x{transition:color .2s}",
      ".x{text-transform:uppercase}",
      ".x{background:linear-gradient(red,blue)}",
      ".x{box-shadow:0 1px 0 red}",
      ".x{border-radius:4px}",
      ".x{position:fixed}",
      ".x{color:red!important}",
    ];
    assert.equal(controls.length, FORBIDDEN.length);
    controls.forEach((css, i) => assert.deepEqual(findings(css), [FORBIDDEN[i]![1]], css));
    assert.deepEqual(findings(".x::before{content:none}.x{opacity:1;border-radius:0}"), [], "the allowed forms pass");
  });

  test("every outcome but RESOLVED keeps a cue that is not colour: a dotted edge for an absence, a dashed edge for a finding", () => {
    const outcome = edges(layer, "wp-reference-result");
    for (const o of PUBLIC_OUTCOMES.filter((x) => x !== "RESOLVED")) {
      assert.ok(outcome.has(`dotted [data-outcome="${o}"]`) || outcome.has(`dashed [data-outcome="${o}"]`), `${o} has no dotted or dashed edge`);
    }
    for (const o of ["UNAVAILABLE", "UNREACHABLE", "NOT_COMPARED"]) assert.ok(outcome.has(`dotted [data-outcome="${o}"]`), `${o} is an absence: dotted`);
    for (const o of ["DIGEST_MISMATCH", "MALFORMED_REFERENCE", "UNSUPPORTED_VERSION", "UNRECOGNISED"]) assert.ok(outcome.has(`dashed [data-outcome="${o}"]`), `${o} is a finding: dashed`);
    assert.ok(!outcome.has('dotted [data-outcome="RESOLVED"]') && !outcome.has('dashed [data-outcome="RESOLVED"]'), "a resolved record keeps the plain edge: no mark of its own");
  });

  test("the Verify rows keep every dotted and dashed edge the WallPrint stylesheet gives a check, with the same kind", () => {
    const canvas = edges(WALLPRINT_CSS, "wp-check");
    assert.ok(canvas.size >= 12, "the WallPrint stylesheet's check edges were read");
    assert.deepEqual([...edges(layer, "wp-check")].sort(), [...canvas].sort());
  });

  test("the masthead wraps instead of widening the page (it laid out at 465 px on a 375 px phone)", () => {
    // The canvas header is a wrapping flex column; its line took the rail's whole width, so the rail's ellipsis never engaged.
    const summary = rules(layer).filter((r) => r.selectors.includes(".ww-summary"));
    const rail = rules(layer).filter((r) => r.selectors.includes(".ww-rail"));
    assert.ok(summary.some((r) => /display\s*:\s*block/.test(r.body)), "the header is a block, not a wrapping column");
    assert.ok(rail.some((r) => /flex-wrap\s*:\s*wrap/.test(r.body)), "the rail wraps");
  });
});
