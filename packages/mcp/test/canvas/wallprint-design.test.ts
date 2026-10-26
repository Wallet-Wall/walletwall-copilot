import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { ROOT } from "../support/harness.ts";
import type { DisclosureFixture } from "../support/wallprint-disclosures.ts";

/**
 * Design regression guard for the WallPrint disclosure document, in the repository's established pattern: the stylesheet
 * and the rendered markup are read as text; nothing is pixel-compared. It guards against drifting back toward generic
 * cards, pills, gradients, shadows, badges or seals, hidden limitations, viewport-only layout, and motion that never rests.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { renderView: (v: unknown) => string; renderPage: (o: { nonce: string }) => string; CSS: string; WALLPRINT_CSS: string; WALLPRINT_JS: string };
const { WALLPRINT_FIXTURES, WALLPRINT_VOCABULARY } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture>; WALLPRINT_VOCABULARY: unknown };
const css = render.WALLPRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const fragments = Object.entries(WALLPRINT_FIXTURES).map(([name, f]) => [name, render.renderView({ status: "wallprint", source: `wallprint:${name}`, fixture: name, disclosure: f, vocabulary: WALLPRINT_VOCABULARY })] as const);
/** Every rule as [selector, declarations], container and media blocks flattened. */
const rules = [...css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].map((m) => [(m[1] as string).trim(), m[2] as string] as const);
const block = (query: string): string => {
  const start = css.indexOf(query);
  assert.ok(start >= 0, `the stylesheet has ${query}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return css.slice(start);
};

describe("material: warm technical paper, narrow rules, registration marks; no card, pill, shadow, gradient or seal", () => {
  test("the only gradient is the plate's sheet grid; nothing casts a shadow, blurs, bevels or shines", () => {
    const gradients = rules.filter(([, d]) => /gradient\(/.test(d)).map(([s]) => s);
    assert.deepEqual(gradients, [".wp-plate"]);
    assert.ok(!/radial-gradient|conic-gradient/.test(css));
    assert.ok(!/box-shadow|text-shadow|drop-shadow|filter:|backdrop-filter/.test(css));
    assert.ok(!/border(-\w+)?:[^;]*\b(outset|inset|ridge|groove)\b/.test(css));
  });

  test("every colour is a WalletWall token or a stated mix of the ink: no hex, no named colour, no purple, blue or green", () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no hex literal: colours come from the canvas tokens");
    assert.ok(!/\b(white|black|purple|blue|green|red|violet|indigo|cyan|magenta)\b/.test(css.replace(/white-space:[a-z-]+/g, "")), "no named colour");
    for (const m of css.matchAll(/(?:^|;)\s*(?:color|background|background-color|border-color|stroke|fill):([^;}]+)/g)) {
      const v = (m[1] as string).trim();
      assert.ok(/^(var\(--ww-[\w-]+\)|inherit|none|transparent|rgba\(79,60,53,0\.0\d+\)|0 solid var\(--ww-[\w-]+\))$/.test(v), `colour value ${v}`);
    }
    assert.ok(!/color:var\(--ww-accent\)/.test(css), "terracotta paints no text here; the wordmark alone is in the accent");
  });

  test("corners are hairline radii, borders at most 2 px, no pill and no 50 % radius on a box", () => {
    for (const m of css.matchAll(/border-radius:([^;}]+)/g)) assert.match((m[1] as string).trim(), /^var\(--ww-radius-(panel|badge)\)$/, `radius ${m[1]}`);
    for (const m of css.matchAll(/border(?:-(?:top|right|bottom|left))?(?:-width)?:(\d+)px/g)) assert.ok(Number(m[1]) <= 2, `border ${m[1]} px`);
    assert.ok(!/999px|9999px/.test(css));
  });

  test("type stays in the three WalletWall voices at editorial sizes: no giant KPI, mono only through code", () => {
    for (const m of css.matchAll(/font(?:-size)?:(?:\d{3} )?([\d.]+)px/g)) assert.ok(Number(m[1]) <= 30, `font size ${m[1]} px`);
    assert.ok(!/var\(--font-mono\)/.test(css), "exact values are monospace through the page's code rule, never a new mono selector");
    assert.ok(/\.wp-title\{[^}]*var\(--font-display\)/.test(css) && /\.wp-assessment-word\{[^}]*var\(--font-display\)/.test(css), "Sora for the document title and the assessment word");
    assert.ok(!/font-weight:(?:8|9)00|font:(?:8|9)00 /.test(css), "no synthesised weight");
    assert.ok(!/text-transform:uppercase/.test(rules.find(([s]) => s === ".wp-assessment-word")?.[1] ?? "x"), "the assessment word is the recorded code itself, not a styled shout");
  });

  test("the plate is a registered print: crop marks, a registration mark, a sheet grid felt rather than read", () => {
    assert.ok(rules.some(([s]) => s === ".wp-plate::before,.wp-plate::after"), "crop marks");
    assert.ok(/\.wp-reg\{[^}]*stroke:var\(--ww-accent\)/.test(css), "the registration mark is drawn in the accent, as a mark not as text");
    assert.match(css, /\.wp-plate\{[^}]*linear-gradient\(rgba\(79,60,53,0\.055\) 1px,transparent 1px\)/);
    assert.ok(/background-size:64px 64px/.test(css));
    for (const [name, html] of fragments) assert.equal((html.match(/<svg class="wp-reg wp-rise"/g) ?? []).length, WALLPRINT_FIXTURES[name]!.records.length, `${name}: one registration mark per record`);
  });
});

describe("layout: container-driven, semantic order kept, nothing critical hidden at any width", () => {
  test("the document is a container and recomposes on its own width at three ranges, with a media fallback where container queries are unsupported", () => {
    assert.ok(/\.wp\{[^}]*container-type:inline-size;container-name:wp/.test(css));
    assert.ok(css.includes("@container wp (max-width:719px)") && css.includes("@container wp (min-width:720px) and (max-width:1023px)"));
    assert.ok(css.includes("@supports not (container-type:inline-size)") && block("@supports not (container-type:inline-size)").includes("@media (max-width:767px)"));
    const narrow = block("@container wp (max-width:719px)");
    assert.ok(narrow.includes(".wp-columns{grid-template-columns:1fr") && narrow.includes(".wp-table,.wp-table tbody,.wp-table tr,.wp-table th,.wp-table td{display:block}"), "stacked columns and stacked table rows on a narrow plate");
    const inner = narrow.slice(narrow.indexOf("{") + 1, narrow.lastIndexOf("}")).trim();
    assert.ok(inner.length > 200 && block("@supports not (container-type:inline-size)").includes(inner), "the fallback is the same composition");
  });

  test("no rule reorders the document or hides limitations, assessments, lineage, receipt, replay or verification at any width", () => {
    assert.ok(!/(^|;|\{)\s*order:/.test(css), "visual order is the document order");
    for (const [selector, decl] of rules) {
      if (!/display:none/.test(decl)) continue;
      assert.ok(!/\.wp-(limitations|assessments|history|verify|why|receipt|replay|ledger|lineage|differ|diff|boundary|violations|codes|raw)(?![\w-])/.test(selector), `${selector} hides critical content`);
      assert.ok(/^\.wp-record\[hidden\]$|^\.wp-lineage-arrow$/.test(selector), `only a folded version or a decorative connector may be display:none: ${selector}`);
    }
    for (const [, html] of fragments) assert.ok(!/<(section|div) class="wp-(limitations|assessments|history|verify|why)[^>]*\shidden/.test(html));
  });

  test("touch targets: version controls at least 44 px, copy controls 36 px, folds 44 px on a coarse pointer", () => {
    const coarse = block("@media (pointer:coarse)");
    assert.ok(coarse.includes(".wp-version{min-height:44px}") && coarse.includes(".wp-copyable button.copy{min-height:36px") && coarse.includes(".wp .wp-more>summary{min-height:44px}"));
    assert.ok(/\.wp-version\{[^}]*min-height:44px/.test(css), "version controls are 44 px at every pointer");
  });
});

describe("motion: one orchestrated reveal that rests; reduced motion shows the finished document", () => {
  test("only the reveal keyframes exist, nothing loops, scales or pulses, and every step is at most 600 ms with delays that read in order", () => {
    const keyframes = [...css.matchAll(/@keyframes ([\w-]+)\{/g)].map((m) => m[1]);
    assert.deepEqual(keyframes.sort(), ["wp-draw", "wp-draw-y", "wp-rise"]);
    assert.ok(!/infinite|alternate|scale\(|rotate\(3|bounce|pulse|confetti/.test(css.replace(/rotate\(45deg\)/g, "")), "no loop, pulse or scale");
    for (const m of css.matchAll(/animation:[^;}]*?(\d+)ms/g)) assert.ok(Number(m[1]) <= 600, `duration ${m[1]} ms`);
    const delays = [0, 1, 2, 3, 4, 5].map((s) => Number(/\d+/.exec(rules.find(([sel]) => sel === `.wp-rise[data-wp-step="${s}"]`)?.[1] ?? "")?.[0]));
    assert.deepEqual([...delays].sort((a, b) => a - b), delays, "steps reveal in reading order");
    assert.ok(delays[5]! <= 600);
  });

  test("the base state of every animated element is its final state, so animation:none (reduced motion) shows everything", () => {
    const outside = css.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})+\}/g, "");
    assert.ok(!/opacity:0[;}]/.test(outside), "no element rests at opacity 0");
    assert.ok(!/transform:scale[XY]?\(0\)|transform:translateY\(4px\)/.test(outside), "no element rests translated or collapsed");
    assert.ok(/#app\[data-motion="reduced"\] \*[^{]*\{transition:none!important;animation:none!important\}/.test(render.CSS), "the page's reduced-motion rule covers the document's elements");
    assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\*\{transition:none!important;animation:none!important\}\}/.test(render.CSS));
    // `*` never matches a pseudo-element, so every animated pseudo-element needs its own reduced-motion rule, for both switches.
    const animatedPseudo = [...new Set(rules.filter(([s, d]) => /::(before|after)/.test(s) && /animation(?:-name)?:(?!none)/.test(d)).map(([s]) => s))];
    assert.deepEqual(animatedPseudo, [".wp-chain::before"]);
    assert.ok(css.includes('#app[data-motion="reduced"] .wp-chain::before{animation:none!important}'));
    assert.ok(block("@media (prefers-reduced-motion:reduce)").includes(".wp-chain::before{animation:none!important}"));
    // The entrance uses fill-mode backwards only: the from-state holds through the delay and nothing is kept after it.
    for (const m of css.matchAll(/animation:[^;}]+/g)) assert.ok(/ backwards$/.test(m[0]) || /^animation:none/.test(m[0]), m[0]);
    // The reveal plays once per document: a revealed document animates nothing when another version is chosen.
    assert.ok(css.includes('.wp[data-wp-revealed="true"] .wp-rise,.wp[data-wp-revealed="true"] .wp-chain::before{animation:none}'));
    assert.ok(/root\.dataset\.wpRevealed = "true"/.test(render.WALLPRINT_JS));
    for (const [name, html] of fragments) {
      const steps = [...html.matchAll(/data-wp-step="(\d)"/g)].map((m) => Number(m[1]));
      assert.deepEqual([...new Set(steps)].sort(), [0, 1, 2, 3, 4, 5], `${name}: registration mark, identity, assessment, evidence columns, provenance and lineage, verification`);
    }
  });

  test("the reveal order is registration mark, identity, assessment, evidence columns, provenance line, record and receipt metadata", () => {
    const [, html] = fragments[0]!;
    const at = (needle: string): number => html.indexOf(needle);
    assert.ok(at('class="wp-reg wp-rise" data-wp-step="0"') < at('class="wp-identity wp-rise" data-wp-step="1"'));
    assert.ok(at('data-wp-step="1"') < at('class="wp-current wp-rise" data-wp-step="2"'));
    assert.ok(at('data-wp-step="2"') < at('class="wp-why wp-rise" data-wp-step="3"'));
    assert.ok(at('data-wp-step="3"') < at('class="wp-provenance wp-rise" data-wp-step="4"'));
    assert.ok(at('data-wp-step="4"') < at('class="wp-verify wp-rise" data-wp-step="5"'));
    assert.ok(/\.wp-chain::before\{[^}]*animation:wp-draw 560ms var\(--ww-ease\) 480ms backwards/.test(css), "the provenance line draws after the columns");
  });
});

describe("the page: the WallPrint stylesheet and script ship inside the same nonce-gated page, with no new origin, storage or inline style", () => {
  test("renderPage embeds the stylesheet and the script once each; neither references a URL, storage, dynamic code or a style attribute", () => {
    const page = render.renderPage({ nonce: "n" });
    assert.equal((page.match(/<script nonce="n">/g) ?? []).length, 2);
    assert.ok(page.includes(render.WALLPRINT_CSS) && page.includes(render.WALLPRINT_JS));
    const code = `${render.WALLPRINT_JS}\n${render.WALLPRINT_CSS}`;
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.(?!clipboard\.writeText\()|sendBeacon|XMLHttpRequest|WebSocket|EventSource|importScripts|eval\(|new Function|postMessage|window\.open|https?:\/\/|url\(|@import|fetch\(/.test(code));
    assert.ok(!/setAttribute\("style"|\.innerHTML|outerHTML|insertAdjacentHTML/.test(render.WALLPRINT_JS), "the script toggles attributes; it never writes markup");
    for (const [, html] of fragments) assert.ok(!/ style="/.test(html), "no inline style attribute under the nonce CSP");
  });

  test("no generic dashboard vocabulary in the markup: no card, tile, KPI, badge, seal or score classes", () => {
    for (const [name, html] of fragments) {
      // `ww-lens-badge` is the canvas's pre-existing lens label in the header ("Observed" on The Wall), not a verdict.
      for (const m of html.replaceAll('class="ww-lens-badge"', "").matchAll(/class="([^"]*)"/g)) assert.ok(!/\b(card|tile|kpi|badge|seal|score|progress|gauge|stat)\b/i.test(m[1] as string), `${name}: class ${m[1]}`);
      assert.ok(!/✅|✔|🏆|🎉|⭐|🔒|🛡/.test(html), `${name}: no celebration or security glyph`);
      // The only drawings are the registration mark and the portable reference's QR code: one per portable block, inside it, nowhere else.
      assert.ok(!/<svg(?! class="wp-reg)(?! class="wp-qr-code")/.test(html), `${name}: the only drawings are the registration mark and the QR code`);
      assert.equal((html.match(/<svg class="wp-qr-code"/g) ?? []).length, (html.match(/data-wp-reference="available"/g) ?? []).length, `${name}: one QR code per available reference`);
      for (const m of html.matchAll(/<svg class="wp-qr-code"/g)) {
        const before = html.lastIndexOf('<div class="wp-portable"', m.index);
        const after = html.indexOf('<div class="wp-derivation">', m.index);
        assert.ok(before >= 0 && after >= 0 && html.lastIndexOf('<div class="wp-derivation">', m.index) < before, `${name}: a QR code is drawn only inside a portable reference block`);
      }
    }
  });
});

describe("the Verify readout is an instrument, not a badge: calm positive results, neutral absences, attention only for a mismatch", () => {
  const checksOf = (html: string): string[] => [...html.matchAll(/<ol class="wp-checks"[\s\S]*?<\/ol>/g)].map((m) => m[0]);

  test("no stylesheet rule singles out a positive result: MATCH, VALID and REPRODUCED are the plate's resting state, never a seal, a fill or a glow", () => {
    for (const [selector] of rules) assert.ok(!/="(MATCH|VALID|REPRODUCED)"\]/.test(selector), `${selector} styles a positive result`);
    assert.ok(!/\.wp-check[^{]*\{[^}]*background/.test(css), "no check is a filled panel: there is no success card");
    assert.ok(!/\.wp-check[^{]*\{[^}]*font-size:(1[7-9]|[2-9]\d)/.test(css), "no result is shouted: nothing in a check is larger than body text");
    for (const [, html] of fragments) for (const list of checksOf(html)) assert.ok(!/<span class="chip"[^>]*>[^<]*<\/span>[^<]*<span class="chip"/.test(list.replace(/<ul class="limits wp-codes">[\s\S]*?<\/ul>/g, "")), "one chip per answer, no row of chips reading as a scorecard");
  });

  test("attention is a dashed brick edge on a mismatch, an invalid record or an unrecognised result only; absence is a dotted neutral edge", () => {
    const attention = rules.filter(([s, d]) => /border-style:dashed/.test(d) && /wp-check/.test(s)).map(([s]) => s);
    assert.deepEqual(attention, ['.wp-check[data-result="INVALID"],.wp-check[data-result="MISMATCH"],.wp-check[data-result="NOT_COMPUTABLE"],.wp-check[data-result="UNRECOGNISED"],.wp-check[data-receipt="MISMATCH"],.wp-check[data-receipt="UNRECOGNISED"],.wp-check[data-replay="MISMATCH"],.wp-check[data-replay="UNRECOGNISED"]']);
    const neutral = rules.filter(([, d]) => /border-style:dotted/.test(d)).map(([s]) => s);
    assert.deepEqual(neutral, ['.wp-check[data-result="NOT_CARRIED"],.wp-check[data-result="NO_DIGEST"],.wp-check[data-receipt="UNAVAILABLE"],.wp-check[data-receipt="UNCHECKED"],.wp-check[data-replay="UNREPLAYABLE"],.wp-check[data-replay="NOT_CARRIED"]']);
    for (const [name, html] of fragments) {
      for (const list of checksOf(html)) {
        for (const m of list.matchAll(/<li class="wp-check[^"]*" data-check="[a-z]+" data-(?:result|receipt|replay)="([A-Z_]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
          const attentionMarks = (m[2]!.match(/data-attention="true"/g) ?? []).length;
          if (["MATCH", "VALID", "REPRODUCED", "UNAVAILABLE", "UNCHECKED", "NOT_CARRIED", "NO_DIGEST"].includes(m[1]!)) assert.equal(attentionMarks - (m[2]!.match(/wp-receipt-standing|data-state="(CORRECTED|SUPERSEDED|WITHDRAWN)"/g) ?? []).length, 0, `${name}: a ${m[1]} answer asks for no attention`);
        }
      }
    }
  });

  test("the four checks sit in one grid: two columns on a wide plate, one column on a narrow plate and in the fallback; nothing is folded or hidden", () => {
    assert.ok(/\.wp-checks\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css));
    assert.ok(block("@container wp (max-width:719px)").includes(".wp-checks{grid-template-columns:1fr}"));
    assert.ok(block("@supports not (container-type:inline-size)").includes(".wp-checks{grid-template-columns:1fr}"));
    for (const [name, html] of fragments) {
      const lists = checksOf(html);
      assert.ok(lists.length >= 1, `${name}: a checks list per record`);
      for (const list of lists) assert.ok(!list.includes("<details") && !/\shidden[\s>]/.test(list), `${name}: no check is folded or hidden at any width`);
    }
    assert.ok(!/\.wp-(check|registration|derivation|independent|jump)[^{]*\{[^}]*display:none/.test(css));
  });

  test("no celebration, security or certification glyph, and no such word in WalletWall-authored prose; attributed external text stays marked", () => {
    const labels = render as unknown as { SUPPORT_HINTS: Record<string, string>; FRESHNESS_HINTS: Record<string, string>; FINALITY_HINTS: Record<string, string>; LIMITATION_LABELS: Record<string, string> };
    const hints = [...Object.values(labels.SUPPORT_HINTS), ...Object.values(labels.FRESHNESS_HINTS), ...Object.values(labels.FINALITY_HINTS), ...Object.values(labels.LIMITATION_LABELS)].map((s) => s.replaceAll("&", "&amp;").replaceAll("'", "&#39;"));
    for (const [name, html] of fragments) {
      assert.ok(!/✓|✔|☑|✅|🛡|🔒|🏆|🎉|⭐/.test(html), `${name}: no check mark, shield, lock or celebration glyph`);
      let prose = html.replace(/<code[^>]*>[^<]*<\/code>/g, "").replace(/<(q|code) class="wp-attributed" data-attributed="true">[^<]*<\/\1>/g, "");
      for (const h of hints) prose = prose.replaceAll(h, "");
      const words = prose.replace(/<[^>]+>/g, " ");
      assert.ok(!/\b(authentic\w*|certif\w*|trust\w*|guarantee\w*|100 ?%|seal|badge|shield|tamper\w*|verified|genuine)\b/i.test(words), `${name}: ${/\b(authentic\w*|certif\w*|trust\w*|guarantee\w*|100 ?%|seal|badge|shield|tamper\w*|verified|genuine)\b/i.exec(words)?.[0]} appears in WalletWall-authored prose`);
      for (const m of html.matchAll(/<q [^>]*>/g)) assert.ok(m[0].includes('class="wp-attributed" data-attributed="true"'), `${name}: every quotation is marked attributed`);
    }
  });

  test("jump and inline version controls are real buttons at 36 px, 44 px on a coarse pointer, in the chip material; the derivation rail is a static hairline", () => {
    assert.ok(/\.wp-jump button\{[^}]*min-height:36px/.test(css) && /\.wp-version-inline\{[^}]*min-height:36px/.test(css));
    const coarse = block("@media (pointer:coarse)");
    assert.ok(coarse.includes(".wp-jump button,.wp-version-inline{min-height:44px}"));
    assert.ok(/\.wp-jump button\{[^}]*background:var\(--ww-label\)/.test(css), "the chip material, not a link");
    const rail = rules.find(([s]) => s === ".wp-steps::before");
    assert.ok(rail && /width:1px/.test(rail[1]) && !/animation/.test(rail[1]), "the rail is drawn once, static");
    for (const [, html] of fragments) assert.ok(!/<a\b/.test(html), "no link anywhere in the document");
  });
});
