import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { findSecretLike } from "../../src/wallprint/language.ts";
import { encodeReference, encodeReferenceEnvelope, REFERENCE_TARGETS, referenceOf, type ReferenceTarget } from "../../src/wallprint/reference.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";
import { decodeQrMatrix } from "../support/qr-decoder.ts";
import type { DisclosureFixture, DisclosureRecord } from "../support/wallprint-disclosures.ts";

/**
 * The portable reference inside the canvas: every disclosed record prints its locator (id, committed digest, WallPrint
 * version) as exact text and as a locally drawn QR code; a reference opened through the canvas is parsed strictly,
 * resolved only against the bundled lineages, digest-checked, and told by one of five fixed outcomes. A reference is a
 * locator, not authority: nothing here upgrades a record, decides which bytes are right, or echoes unsafe input.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Summary {
  status: string;
  error?: { code: string; message: string };
  fixture?: string;
  recordId?: string | null;
  lifecycle?: string | null;
  reference?: { outcome: string; problem: string | null; recordId: string | null; digest: string | null; target: string | null; resolution: Record<string, unknown> | null } | null;
  selectedAssertionId?: string | null;
}
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string; title: string; status: string }>;
  setInput: (id: string, input: unknown) => Promise<Summary>;
  select: (id: string, assertionId: string) => Promise<Summary>;
  view: (id: string) => Summary;
  canvasView: (id: string) => { status: string; focus?: string | null; target?: string | null; reference?: unknown };
  close: (id: string) => Promise<void>;
}
interface RenderMod {
  renderView: (v: unknown) => string;
  WALLPRINT_JS: string;
  WALLPRINT_CSS: string;
}
interface QrMod {
  encodeQr: (text: string) => { version: number; size: number; modules: Uint8Array };
  qrPathData: (code: { version: number; size: number; modules: Uint8Array }) => { extent: number; d: string };
}
const mod = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer; normalizeInput: (i: unknown) => Record<string, unknown>; openReference: (t: unknown) => { outcome: string; problem: string | null; fixture: string | null } };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const qr = (await import(pathToFileURL(`${EXT}/wallprint-qr.mjs`).href)) as QrMod;
const { WALLPRINT_FIXTURES, WALLPRINT_VOCABULARY } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture>; WALLPRINT_VOCABULARY: unknown };

const view = (name: string, disclosure: DisclosureFixture = WALLPRINT_FIXTURES[name]!, extra: Record<string, unknown> = {}) => ({ status: "wallprint", source: `wallprint:${name}`, fixture: name, disclosure, vocabulary: WALLPRINT_VOCABULARY, reference: null, focus: null, target: null, ...extra });
const fragment = (name: string, disclosure?: DisclosureFixture, extra?: Record<string, unknown>): string => render.renderView(view(name, disclosure, extra));
const articles = (html: string): string[] => html.split(/(?=<article class="wp-record")/).slice(1).map((a) => a.slice(0, a.indexOf("</article>") + 10));
const articleOf = (html: string, id: string): string => {
  const a = articles(html).find((x) => x.includes(`data-record-id="${id}"`));
  assert.ok(a, `article ${id}`);
  return a;
};
const portableOf = (a: string): string => {
  const start = a.indexOf('<div class="wp-portable"');
  assert.ok(start >= 0, "a portable block");
  return a.slice(start, a.indexOf('<div class="wp-derivation">', start));
};
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The resolution readout printed above the lineage: from its opening tag to the first record article. */
const readoutOf = (html: string): string => {
  const start = html.indexOf('<div class="wp-reference-result');
  assert.ok(start >= 0, "a readout");
  return html.slice(start, html.indexOf("<article", start));
};
const unescape = (s: string): string => s.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const records = (): [string, DisclosureRecord][] => Object.entries(WALLPRINT_FIXTURES).flatMap(([name, f]) => f.records.map((r): [string, DisclosureRecord] => [name, r]));
/** The reference a record's committed identity gives: its id and the digest its COMMITTED lifecycle event recorded. */
const committedReference = (r: DisclosureRecord, target: ReferenceTarget | null = null): string => {
  const committed = r.lifecycle.events.find((e) => e.state === "COMMITTED");
  assert.ok(committed, `${r.id} has a COMMITTED event`);
  return encodeReference(referenceOf({ id: committed.recordId, digest: committed.recordDigest, wallprintVersion: r.record.wallprintVersion }, target));
};
const BAD_WORDS = /\b(verified|trusted|certified|authentic\w*|guarantee\w*|genuine|tamper\w*|forged|fake|fraud\w*|malicious|seal|badge|shield|proof of|proves)\b/i;

describe("every disclosed record prints its portable reference as exact text and as a locally drawn QR code", () => {
  test("the block carries one QR code, the reference text once with a copy control, the record id, the committed digest, what it encodes and the boundary", () => {
    for (const [name, r] of records()) {
      const block = portableOf(articleOf(fragment(name), r.id));
      const expected = committedReference(r);
      assert.ok(block.includes('data-wp-reference="available"'), `${name}/${r.id}`);
      assert.equal((block.match(/<svg class="wp-qr-code"/g) ?? []).length, 1, "one code");
      const code = /<code class="wp-exact" id="wp-pr-[^"]+">([^<]*)<\/code><button type="button" class="copy" data-wp-copy aria-label="Copy the full portable reference">Copy reference<\/button>/.exec(block);
      assert.ok(code, `${name}/${r.id}: the reference with its copy control`);
      assert.equal(unescape(code[1]!), expected, "the printed text is the record's reference, exactly");
      assert.equal(block.split(`${expected.replaceAll("&", "&amp;")}</code>`).length - 1, 1, "the bare reference is printed exactly once; the section references extend it");
      assert.ok(block.includes(`<code class="wp-exact">${r.id}</code>`) && block.includes(`<code class="wp-exact">${r.lifecycle.events[0]!.recordDigest}</code>`), "id and committed digest, exact");
      assert.ok(block.includes("from the COMMITTED event of the lifecycle ledger"));
      assert.ok(block.includes("the record id, the committed digest, WallPrint version <code>0.1</code> and reference format <code>0.1</code>; no section target, no web or local address, no wallet address, no key, no record content"));
      assert.ok(block.includes("<strong>A reference is a locator, not authority.</strong>"));
      assert.ok(block.includes("This reference identifies the WallPrint record and digest. Resolution depends on a compatible WalletWall disclosure store or resolver."));
      assert.ok(block.includes("The code encodes the <code>walletwall:</code> reference itself, not a web address: no app registers a handler for it, so scanning it opens nothing by itself"));
      assert.ok(block.includes("such as this panel&#39;s bundled lineages or WalletWall&#39;s public resolver for published disclosures, which serves the same reference under an HTTPS form."));
      assert.ok(block.includes('data-wp-reference-form="reference"'), "the canvas names no resolver base, so its code carries the reference itself");
      assert.ok(!BAD_WORDS.test(text(block).replaceAll("not authority", "")), `${name}/${r.id}: ${BAD_WORDS.exec(text(block))?.[0]} in the portable block`);
      assert.ok(!/<a\b|href=|javascript:|data:|https?:\/\/|127\.0\.0\.1|localhost|%[0-9A-Fa-f]{2}/.test(block), "no link, URL, host or percent-encoding");
      assert.ok(!/ style="|fill="|stroke="|<script/.test(block), "no inline style, no attribute colour, no script");
      assert.equal(findSecretLike(block), null);
    }
  });

  test("the QR code is the printed reference: its path is the encoder's path for that exact text, its size is the matrix size, and it decodes to the text", () => {
    for (const [name, r] of records()) {
      const block = portableOf(articleOf(fragment(name), r.id));
      const expected = committedReference(r);
      const svg = /<svg class="wp-qr-code" viewBox="0 0 (\d+) (\d+)" role="img" aria-label="QR code\. It encodes the portable reference printed beside it and nothing else\." aria-describedby="(wp-pr-[^"]+)" shape-rendering="crispEdges" data-qr-version="(\d+)" data-qr-modules="(\d+)" data-qr-ec="M"><rect class="wp-qr-quiet" width="(\d+)" height="(\d+)"\/><path class="wp-qr-dark" d="([^"]*)"\/><\/svg>/.exec(block);
      assert.ok(svg, `${name}/${r.id}: the code's markup is exactly the registration block`);
      const code = qr.encodeQr(expected);
      const { extent, d } = qr.qrPathData(code);
      assert.equal(Number(svg[1]), extent);
      assert.equal(Number(svg[2]), extent);
      assert.equal(Number(svg[4]), code.version);
      assert.equal(Number(svg[5]), code.size);
      assert.equal(extent, code.size + 8, "a quiet zone of four modules on every side is inside the drawing");
      assert.equal(svg[8], d, "the drawn path is the encoder's path for the printed text");
      assert.equal(decodeQrMatrix(code.modules, code.size).text, expected);
      assert.ok(block.includes(`id="${svg[3]}">`), "the accessible description is the printed reference");
      assert.ok(block.includes("<p class=\"wp-qr-caption\">Scan · Copy reference</p>"));
      assert.ok(block.includes(`QR version ${code.version}, ${code.size} modules, error correction M, quiet zone 4`));
    }
  });

  test("the section references are the same locator with one target each, and the envelope is the RFC 8785 form, all exact and copyable inside a fold", () => {
    for (const [name, r] of records()) {
      const block = portableOf(articleOf(fragment(name), r.id));
      const fold = block.slice(block.indexOf('<details class="wp-more wp-portable-sections">'));
      for (const t of REFERENCE_TARGETS.filter((x) => x !== "record")) assert.ok(fold.includes(`<code class="wp-exact">${committedReference(r, t).replaceAll("&", "&amp;")}</code>`), `${name}/${r.id}: ${t}`);
      assert.ok(!fold.includes("target=record"), "the record itself is the untargeted reference");
      const committed = r.lifecycle.events[0]!;
      const envelope = encodeReferenceEnvelope(referenceOf({ id: committed.recordId, digest: committed.recordDigest, wallprintVersion: r.record.wallprintVersion }));
      assert.ok(fold.includes(`<code class="wp-exact">${envelope.replaceAll('"', "&quot;")}</code>`), "the envelope, exact");
      assert.equal((fold.match(/data-wp-copy/g) ?? []).length, 6, "five section references and the envelope, each with a copy control");
    }
  });

  test("without a committed identity there is no reference and no code: the prerequisite is named instead", () => {
    const name = "current-supported";
    const f = structuredClone(WALLPRINT_FIXTURES[name]!);
    const r = f.records[0]!;
    for (const [label, mutate] of [
      ["no lifecycle events", (): void => void (r.lifecycle.events = [])],
      ["a COMMITTED event naming another record", (): void => void (r.lifecycle.events[0]!.recordId = "wp-someone-else")],
      ["a committed digest without its fixed shape", (): void => void (r.lifecycle.events[0]!.recordDigest = "0x" + "a".repeat(62))],
      ["a WallPrint version this codec does not resolve", (): void => void ((r.record as { wallprintVersion: string }).wallprintVersion = "0.2")],
    ] as const) {
      const copy = structuredClone(WALLPRINT_FIXTURES[name]!);
      Object.assign(r, structuredClone(copy.records[0]!));
      mutate();
      const block = portableOf(articleOf(fragment(name, f), r.id));
      assert.ok(block.includes('data-wp-reference="unavailable"'), label);
      assert.ok(!block.includes("<svg") && !block.includes("walletwall://") && !block.includes("data-wp-copy"), `${label}: nothing is drawn or offered in place of a reference`);
      assert.ok(block.includes("No portable reference for this record: this disclosure carries no committed record identity for it"), label);
      assert.ok(block.includes("A reference needs exactly those three values. No code is drawn in its place."), label);
      assert.ok(block.includes("<strong>A reference is a locator, not authority.</strong>"), label);
    }
  });

  test("the reference's digest is the ledger's committed digest, so an altered copy's reference still names the committed record, and the Verify checks beside it say the rest", () => {
    const f = WALLPRINT_FIXTURES["receipt-mismatch"]!;
    const r = f.records[0]!;
    assert.equal(r.digest.matches, false, "the altered copy's bytes do not produce its digest");
    const block = portableOf(articleOf(fragment("receipt-mismatch"), r.id));
    assert.ok(block.includes(committedReference(r).replaceAll("&", "&amp;")));
    assert.ok(block.includes(r.lifecycle.events[0]!.recordDigest));
    assert.ok(!block.includes(r.digest.computedDigest!), "the recomputed digest of the altered copy is not what the reference carries");
  });

  test("the block sits in Verify after the registration readout and before the derivation, under its own h4, and nothing in it asks for attention", () => {
    for (const [name, r] of records()) {
      const a = articleOf(fragment(name), r.id);
      const reg = a.indexOf('<div class="wp-registration">');
      const portable = a.indexOf('<div class="wp-portable"');
      const derivation = a.indexOf('<div class="wp-derivation">');
      assert.ok(reg >= 0 && reg < portable && portable < derivation, `${name}/${r.id}: order`);
      const block = portableOf(a);
      assert.ok(block.startsWith('<div class="wp-portable" data-wp-reference="available" data-wp-reference-target="none" data-wp-reference-form="reference"><h4>Portable reference</h4>'));
      assert.ok(!block.includes('data-attention="true"') && !block.includes('class="chip"'), "a locator is calm: no attention mark, no state chip");
    }
  });

  test("the evidence view's QR control stays disabled and draws nothing: a live bundle has no committed record identity", () => {
    const html = render.renderView({ status: "ready", source: "fixture:usdc-established", evaluatedAt: "2026-10-23T12:00:30Z", versions: { wwep: "0.1", registry: "2026-10", policies: "2026-10", rules: "2026-10" }, bundleDigest: "a".repeat(64), invariantViolationCount: "0", invariantViolations: [], assertions: [], observations: [], sources: [], derivations: [], selectedId: null, provenance: null, readiness: null });
    assert.ok(html.includes('<button type="button" disabled aria-describedby="receipt-why">QR</button>'));
    assert.ok(!/wp-qr-code|walletwall:\/\/|wp-portable|data-wp-reference/.test(html), "no code and no reference are derived from a bundle digest");
    assert.ok(html.includes('<p id="receipt-why" class="ww-reason">Requires immutable snapshot.</p>'));
  });
});

describe("the stylesheet: a registration block at a scannable, bounded size, calm, visible at every width", () => {
  const css = render.WALLPRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  test("the code is 176 px on a wide plate and 160 px on a narrow one, never smaller, never a hero; its fills are the cream and shell tokens", () => {
    for (const m of css.matchAll(/\.wp-qr-code\{[^}]*width:(\d+)px/g)) assert.ok(Number(m[1]) >= 160 && Number(m[1]) <= 224, `code width ${m[1]} px`);
    assert.ok(/\.wp-qr-code\{[^}]*width:176px;height:176px;max-width:100%;border:1px solid var\(--ww-cut-strong\)/.test(css));
    assert.ok(css.includes(".wp-qr-quiet{fill:var(--ww-cream)}") && css.includes(".wp-qr-dark{fill:var(--ww-shell)}"), "ink on paper, through tokens");
    const narrow = css.slice(css.indexOf("@container wp (max-width:719px)"));
    assert.ok(narrow.includes(".wp-qr-code{width:160px;height:160px}") && narrow.includes(".wp-portable-block{grid-template-columns:1fr}"), "the narrow composition stacks the text under a 160 px code");
    assert.ok(css.slice(css.indexOf("@supports not (container-type:inline-size)")).includes(".wp-qr-code{width:160px;height:160px}"), "the fallback composition does the same");
    assert.ok(!/\.wp-(qr|portable|reference)[^{]*\{[^}]*(animation|transition|box-shadow|gradient|[;{]transform)/.test(css), "nothing about the code moves, glows or scales");
    assert.ok(!/\.wp-(qr|portable)[^{]*\{[^}]*display:none/.test(css), "the code and its text are never hidden at any width");
    assert.ok(!/\.wp-(qr|portable)[^{]*\{[^}]*background/.test(css.replace(/\.wp-qr-quiet\{fill[^}]*\}/, "")), "no filled panel around the code");
  });

  test("a digest mismatch readout gets the dashed brick edge; a resolved reference and an unavailable record get the plate's quiet edge", () => {
    assert.ok(/\.wp-reference-result\[data-outcome="DIGEST_MISMATCH"\],\.wp-reference-result\[data-outcome="MALFORMED_REFERENCE"\],\.wp-reference-result\[data-outcome="UNSUPPORTED_VERSION"\],\.wp-reference-result\[data-outcome="UNRECOGNISED"\]\{border-style:dashed;border-color:var\(--ww-brick-low\)\}/.test(css));
    assert.ok(!/data-outcome="(RESOLVED|UNAVAILABLE)"/.test(css), "no rule singles out a resolved reference or an unavailable record");
  });
});

describe("opening a portable reference through the canvas: strict parse, local resolution, digest check, one of five outcomes", () => {
  const explorer = mod.createExplorer({ serverArgs: [ENTRIES.bundle] });
  const opened: string[] = [];
  after(async () => {
    for (const id of opened) await explorer.close(id);
  });
  let n = 0;
  async function open(input?: unknown): Promise<{ id: string; url: string }> {
    const id = `r${++n}`;
    opened.push(id);
    const o = await explorer.open(id, input);
    return { id, url: o.url };
  }
  const get = async (url: string): Promise<string> => (await fetch(url)).text();
  const corrected = WALLPRINT_FIXTURES["corrected"]!;
  const v1 = corrected.records[0]!;
  const v2 = corrected.records[1]!;

  test("normalizeInput keeps the fixed outcome and the parsed fields, never the raw text, and refuses combinations and non-strings", () => {
    const raw = committedReference(v1, "receipt");
    const out = mod.normalizeInput({ reference: raw }) as { reference: { outcome: string; reference: { recordId: string; target: string } }; source: string };
    assert.equal(out.source, "portable reference");
    assert.equal(out.reference.outcome, "RESOLVED");
    assert.deepEqual([out.reference.reference.recordId, out.reference.reference.target], [v1.id, "receipt"]);
    assert.ok(!JSON.stringify(out).includes(raw), "the raw text is not kept");
    for (const bad of [{ reference: 7 }, { reference: null }, { reference: raw, wallprint: "corrected" }, { reference: raw, fixture: "usdc-established" }, { reference: raw, assertionId: "a-identity" }, { reference: raw, evaluatedAt: "2026-10-23T12:00:00Z" }]) assert.throws(() => mod.normalizeInput(bad), /reference/, JSON.stringify(bad));
    assert.equal((mod.normalizeInput({ reference: "not a reference" }) as { reference: { outcome: string } }).reference.outcome, "MALFORMED_REFERENCE", "a malformed reference is an outcome, not an input error");
  });

  test("a reference to the corrected predecessor opens that version with its receipt section, not the lineage's current record; the summary carries the resolution", async () => {
    const { id, url } = await open({ reference: committedReference(v1, "receipt") });
    const s = explorer.view(id);
    assert.equal(s.status, "wallprint");
    assert.equal(s.fixture, "corrected");
    assert.equal(s.recordId, v1.id, "the record the reference named, although the lineage's focus is the correction");
    assert.equal(s.lifecycle, "CORRECTED");
    assert.deepEqual(s.reference, { outcome: "RESOLVED", problem: null, recordId: v1.id, digest: v1.lifecycle.events[0]!.recordDigest, target: "receipt", wallprintVersion: "0.1", resolution: { outcome: "RESOLVED", recordId: v1.id, digest: v1.lifecycle.events[0]!.recordDigest, target: "receipt" } });
    const html = await get(`${url}view`);
    assert.ok(html.includes(`data-wp-focus="${v1.id}" data-wp-open="receipt"`));
    assert.ok(!/<article class="wp-record" data-record-id="wp-identity-corrected-v1"[^>]*\shidden/.test(html) && /<article class="wp-record" data-record-id="wp-identity-corrected-v2"[^>]*\shidden/.test(html), "v1 is shown, v2 stays folded");
    const readout = readoutOf(html);
    assert.ok(readout.startsWith('<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="RESOLVED" role="status">'));
    assert.ok(readout.includes("Opened from a portable reference") && readout.includes('data-state="RESOLVED"') && readout.includes("Section</dt><dd>Receipt</dd>"));
    assert.ok(readout.includes("a reference to an earlier version opens that version, never the lineage's current one in its place"));
    assert.ok(!readout.includes('data-attention="true"'), "a resolved reference asks for no attention");
    assert.ok(html.includes('data-lifecycle="CORRECTED"') && html.includes("not the current record"), "the opened version keeps saying it is not current");
    assert.ok(!BAD_WORDS.test(text(readout)), BAD_WORDS.exec(text(readout))?.[0]);
    const cv = explorer.canvasView(id);
    assert.equal(cv.focus, v1.id);
    assert.equal(cv.target, "receipt");
  });

  test("a superseded predecessor, a withdrawn record and the lineage's current record each resolve to themselves, with and without a target; a resolved reference without a target opens nothing", async () => {
    const superseded = WALLPRINT_FIXTURES["superseded"]!.records[0]!;
    const withdrawn = WALLPRINT_FIXTURES["withdrawn"]!.records[0]!;
    for (const [r, target, fixture, state] of [
      [superseded, "replay", "superseded", "SUPERSEDED"],
      [withdrawn, "history", "withdrawn", "WITHDRAWN"],
      [v2, "provenance", "corrected", "DISCLOSED"],
      [v2, "record", "corrected", "DISCLOSED"],
      [withdrawn, null, "withdrawn", "WITHDRAWN"],
    ] as const) {
      const { id, url } = await open({ reference: committedReference(r, target) });
      const s = explorer.view(id);
      assert.equal(s.status, "wallprint", `${fixture}/${target}`);
      assert.equal(s.fixture, fixture);
      assert.equal(s.recordId, r.id);
      assert.equal(s.lifecycle, state);
      assert.equal(s.reference?.outcome, "RESOLVED");
      assert.equal(s.reference?.target, target);
      const html = await get(`${url}view`);
      if (target === null) assert.ok(!html.includes("data-wp-open="), "no section is opened without a target");
      else assert.ok(html.includes(`data-wp-open="${target}"`));
      assert.ok(!/<article class="wp-record" data-record-id="[^"]+"[^>]*\shidden/.test(articleOf(html, r.id)));
    }
  });

  test("a well-formed digest that is not the record's is DIGEST_MISMATCH: the record is shown, both digests are printed, no section is opened, nothing calls anything forged", async () => {
    const committed = v2.lifecycle.events[0]!;
    const wrong = "f".repeat(64);
    const { id, url } = await open({ reference: encodeReference(referenceOf({ id: committed.recordId, digest: wrong, wallprintVersion: "0.1" }, "receipt")) });
    const s = explorer.view(id);
    assert.equal(s.status, "wallprint");
    assert.equal(s.recordId, v2.id);
    assert.deepEqual(s.reference?.resolution, { outcome: "DIGEST_MISMATCH", recordId: v2.id, referenceDigest: wrong, embeddedDigest: v2.record.digest, computedDigest: v2.digest.computedDigest });
    const html = await get(`${url}view`);
    assert.ok(!html.includes("data-wp-open="), "the asked-for section is not opened on a mismatch");
    const readout = readoutOf(html);
    assert.ok(readout.startsWith('<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="DIGEST_MISMATCH" role="alert">'));
    assert.ok(readout.includes("The resolved record does not match the digest carried by this reference."));
    assert.ok(readout.includes(`<code class="wp-exact">${wrong}</code>`) && readout.includes(`<code class="wp-exact">${v2.record.digest}</code>`) && readout.includes(`<code class="wp-exact">${v2.digest.computedDigest}</code>`), "every digest, exact");
    assert.ok(readout.includes("This document does not decide which bytes are the committed ones") && readout.includes("section asked for: Receipt (not opened, because the digests differ)"));
    assert.ok(readout.includes('data-state="DIGEST_MISMATCH"') && readout.includes('data-attention="true"'));
    assert.ok(!BAD_WORDS.test(text(readout)), BAD_WORDS.exec(text(readout))?.[0]);
    assert.ok(!/\b(invalid|false|untrusted|forged|fake|fraud|malicious)\b/i.test(text(readout).replace(/does not match/g, "")), "no verdict word");
    assert.equal(explorer.canvasView(id).target, null);
  });

  test("the altered-copy fixture's own committed reference is DIGEST_MISMATCH: the copy's bytes do not produce the committed digest", async () => {
    const altered = WALLPRINT_FIXTURES["receipt-mismatch"]!.records[0]!;
    const { id } = await open({ reference: committedReference(altered) });
    const s = explorer.view(id);
    assert.equal(s.status, "wallprint");
    assert.equal(s.reference?.outcome, "DIGEST_MISMATCH");
    const res = s.reference?.resolution as { embeddedDigest: string; computedDigest: string; referenceDigest: string };
    assert.equal(res.embeddedDigest, res.referenceDigest, "the copy still carries the committed digest");
    assert.notEqual(res.computedDigest, res.referenceDigest, "its bytes no longer produce it");
  });

  test("an unknown record id is Record unavailable: said as unavailable, never as invalid, with the lineages this panel holds listed; the agent summary does not repeat the caller's id or digest", async () => {
    const { id, url } = await open({ reference: encodeReference(referenceOf({ id: "wp-not-held-here", digest: "a".repeat(64), wallprintVersion: "0.1" }, "receipt")) });
    const s = explorer.view(id);
    assert.equal(s.status, "reference");
    assert.deepEqual(s.reference, { outcome: "UNAVAILABLE", problem: null, recordId: null, digest: null, target: "receipt", wallprintVersion: "0.1", resolution: { outcome: "UNAVAILABLE" } });
    assert.ok(!JSON.stringify(s).includes("wp-not-held-here") && !JSON.stringify(s).includes("a".repeat(64)), "the caller's own text is not repeated to the agent");
    assert.equal(s.selectedAssertionId, null);
    const html = await get(`${url}view`);
    assert.ok(html.includes('data-wp-reference-outcome="UNAVAILABLE"') && html.includes('<div class="wp-reference-result" data-outcome="UNAVAILABLE" role="status">'));
    assert.ok(html.includes('<h2 class="wp-title">Record unavailable</h2>'));
    assert.ok(html.includes("No record with this id is held in this disclosure store.") && html.includes("Unavailable is not invalid, and this says nothing about the record or its claims."));
    const start = html.indexOf('<div class="wp-reference-result"');
    const result = html.slice(start, html.indexOf('<p class="note">', start));
    assert.ok(!/\b(false|untrusted|forged|fake|malformed|error)\b/i.test(text(result).replace("is not invalid", "")), "unavailable is a different failure mode");
    assert.ok(result.includes('data-state="UNAVAILABLE"') && !result.includes('data-attention="true"'), "neutral, not an alarm");
    assert.ok(html.includes('<dt>Record named, as written in the reference</dt><dd><span class="wp-copyable"><code class="wp-exact">wp-not-held-here</code>'), "the well-formed id is printed back, labelled as the reader's own text");
    for (const name of Object.keys(WALLPRINT_FIXTURES)) assert.ok(html.includes(`<code>${name}</code>`), name);
    assert.ok(!html.includes("<article") && !html.includes("data-state=\"ESTABLISHED\""), "no record and no state is shown");
  });

  test("a malformed reference and an unsupported version are told by their fixed problem code and never echoed, through the summary or the page", async () => {
    for (const [input, outcome, problem] of [
      [`https://evil.example/wallprint/${v1.id}?digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "scheme"],
      ["javascript:alert(document.cookie)", "MALFORMED_REFERENCE", "characters"],
      // A file URL with a user path, assembled at run time so the tracked text carries no path-shaped literal.
      [`file:///${["C:", "Users", "someone", "wallprint.json"].join("/")}`, "MALFORMED_REFERENCE", "scheme"],
      [`http://localhost:3000/${v1.id}`, "MALFORMED_REFERENCE", "scheme"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}&target=<img src=x onerror=alert(1)>`, "MALFORMED_REFERENCE", "characters"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}&target=wp-sec-receipt-${v1.id}`, "MALFORMED_REFERENCE", "target"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "query"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}&target=receipt&target=replay`, "MALFORMED_REFERENCE", "query"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}%0A`, "MALFORMED_REFERENCE", "characters"],
      [`walletwall://wallprint/../${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "recordId"],
      [`walletwall://wallprint/${v1.id.toUpperCase()}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "recordId"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest.toUpperCase()}`, "MALFORMED_REFERENCE", "digest"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}\u202e`, "MALFORMED_REFERENCE", "characters"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}\u0000`, "MALFORMED_REFERENCE", "characters"],
      [`walletwall://wallprint/sk_live_${"x".repeat(24)}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "recordId"],
      [`walletwall://wallprint/0x${"ab".repeat(20)}?reference=0.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "recordId"],
      [`walletwall://wallprint/wp-verified-safe-record?reference=0.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "recordId"],
      [`walletwall://wallprint/${v1.id}?reference=00.1&wallprint=0.1&digest=${v1.record.digest}`, "MALFORMED_REFERENCE", "reference"],
      [`{ "digest": "${v1.record.digest}", "recordId": "${v1.id}", "type": "walletwall.wallprint.reference", "version": "0.1", "wallprintVersion": "0.1" }`, "MALFORMED_REFERENCE", "characters"],
      ["w".repeat(10_000), "MALFORMED_REFERENCE", "length"],
      [`walletwall://wallprint/${v1.id}?reference=0.2&wallprint=0.1&digest=${v1.record.digest}`, "UNSUPPORTED_VERSION", "reference"],
      [`walletwall://wallprint/${v1.id}?reference=0.1&wallprint=0.2&digest=${v1.record.digest}`, "UNSUPPORTED_VERSION", "wallprint"],
      [`{"digest":"${v1.record.digest}","recordId":"${v1.id}","trusted":"true","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ] as const) {
      const { id, url } = await open({ reference: input });
      const s = explorer.view(id);
      assert.equal(s.status, "reference", input.slice(0, 60));
      assert.deepEqual(s.reference, { outcome, problem, recordId: null, digest: null, target: null, wallprintVersion: null, resolution: null }, input.slice(0, 60));
      const html = await get(`${url}view`);
      assert.ok(html.includes(`data-outcome="${outcome}"`) && html.includes(`Problem: <code>${problem}</code>`), input.slice(0, 60));
      assert.ok(html.includes(outcome === "UNSUPPORTED_VERSION" ? '<h2 class="wp-title">Unsupported version</h2>' : '<h2 class="wp-title">Malformed reference</h2>'));
      // Nothing of the input reaches the page or the summary: not the host, the id, the digest, the payload or the file path.
      for (const piece of ["evil.example", "alert(", "someone", "localhost", "onerror", "wp-sec-", v1.record.digest, v1.id, "sk_live", "trusted", "\u202e", "\u0000", "x".repeat(24), "ab".repeat(20), "verified-safe"]) {
        if (input.includes(piece)) {
          assert.ok(!html.includes(piece), `${input.slice(0, 40)}: the page echoes ${piece}`);
          assert.ok(!JSON.stringify(s).includes(piece), `${input.slice(0, 40)}: the summary echoes ${piece}`);
        }
      }
      assert.ok(!html.includes("<article") && !/<script(?! nonce)/.test(html) && !html.includes("<img"), "no record, no script, no injected element");
      assert.ok(html.includes("A reference is read exactly as written: no case folding, no percent-decoding, no reordering of its parameters."));
    }
  });

  test("a reference replaces a bundle and a bundle replaces a reference; select is a no-op on a reference view; the summary is a fresh copy", async () => {
    const { id, url } = await open({ fixture: "usdc-established" });
    assert.equal(explorer.view(id).status, "ready");
    const s = await explorer.setInput(id, { reference: committedReference(v1, "assessments") });
    assert.equal(s.status, "wallprint");
    assert.equal(s.selectedAssertionId, null);
    const before = await get(`${url}view`);
    assert.ok(before.includes('data-wp-open="assessments"') && !before.includes('class="ww-wall-svg"'));
    const after1 = await explorer.select(id, "a-identity");
    assert.equal(after1.status, "wallprint");
    assert.equal(await get(`${url}view`), before, "select changes nothing on a reference view");
    s.reference!.outcome = "tampered";
    assert.equal(explorer.view(id).reference?.outcome, "RESOLVED", "the summary is a copy");
    const back = await explorer.setInput(id, { fixture: "usdc-established" });
    assert.equal(back.status, "ready");
    assert.ok((await get(`${url}view`)).includes('class="ww-wall-svg"'));
    const unavailable = await explorer.setInput(id, { reference: encodeReference(referenceOf({ id: "wp-absent", digest: "b".repeat(64), wallprintVersion: "0.1" })) });
    assert.equal(unavailable.status, "reference");
    assert.equal((await explorer.select(id, "a-identity")).status, "reference");
  });

  test("record ids are unique across the bundled lineages, so a reference resolves to at most one record", () => {
    const ids = records().map(([, r]) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(mod.openReference(committedReference(v1)).fixture, "corrected");
  });

  test("a disclosure that carries no engine-computed digest for the record is NOT_COMPARED: the record is shown with the plate's quiet edge, nothing is said to match or differ, no section is opened", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["current-supported"]!);
    const r = f.records[0]!;
    (r.digest as { computedDigest: string | null }).computedDigest = null;
    const reference = { outcome: "NOT_COMPARED", problem: null, recordId: r.id, digest: r.record.digest, target: "receipt", wallprintVersion: "0.1", resolution: { outcome: "NOT_COMPARED", recordId: r.id, referenceDigest: r.record.digest, embeddedDigest: r.record.digest, computedDigest: null } };
    const html = fragment("current-supported", f, { reference, focus: r.id, target: null });
    const readout = readoutOf(html);
    assert.ok(readout.startsWith('<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="NOT_COMPARED" role="status">'));
    assert.ok(readout.includes("so the reference&#39;s digest was compared with nothing. Nothing is said to match or to differ."));
    assert.ok(readout.includes('data-state="NOT_COMPARED"') && !readout.includes('data-attention="true"'), "absence is neutral");
    assert.ok(readout.includes("not carried: nothing was computed here") && readout.includes(`<code class="wp-exact">${r.record.digest}</code>`));
    assert.ok(readout.includes("section asked for: Receipt (not opened, because the digests were not compared)"));
    assert.ok(!html.includes("data-wp-open="), "no section is opened");
    assert.ok(!/\b(mismatch|does not match|forged|fake|invalid)\b/i.test(text(readout)), "nothing reads as a failed comparison");
    assert.ok(!/data-outcome="NOT_COMPARED"\][^{]*\{[^}]*dashed/.test(render.WALLPRINT_CSS), "no attention edge for an absent comparison");
  });

  test("an id that more than one bundled record carried would be told as ambiguous, never as not held", () => {
    const html = render.renderView({ status: "reference", source: "portable reference", reference: { outcome: "UNAVAILABLE", problem: "ambiguous", recordId: "wp-shared-id", digest: "c".repeat(64), target: null, wallprintVersion: "0.1", resolution: { outcome: "UNAVAILABLE", recordId: "wp-shared-id" } }, wallprints: [] });
    assert.ok(html.includes("More than one record held in this disclosure store carries this id, so the reference resolves to none of them."));
    assert.ok(!html.includes("No record with this id is held"));
    assert.ok(html.includes('<h2 class="wp-title">Record unavailable</h2>') && html.includes('data-outcome="UNAVAILABLE"'));
  });
});

describe("the page script: a document opened from a reference focuses the referenced section once, announces it, and refuses any other key", () => {
  interface FakeEl {
    dataset: Record<string, string>;
    hidden: boolean;
    attrs: Record<string, string>;
    setAttribute: (k: string, v: string) => void;
    removeAttribute: (k: string) => void;
    getAttribute: (k: string) => string | null;
    querySelector: (s: string) => unknown;
    closest: (s: string) => unknown;
    focus: () => void;
    scrollIntoView?: () => void;
    textContent: string;
    focused?: boolean;
  }
  const el = (dataset: Record<string, string>, extra: Partial<FakeEl> = {}): FakeEl => {
    const e: FakeEl = { dataset, hidden: false, attrs: {}, setAttribute: (k, v) => (e.attrs[k] = v), removeAttribute: (k) => delete e.attrs[k], getAttribute: (k) => e.attrs[k] ?? null, querySelector: () => null, closest: () => null, focus: () => (e.focused = true), textContent: "", ...extra };
    return e;
  };
  function page(open: string | null, focusId = "v1"): { root: FakeEl; announcer: FakeEl; h2: FakeEl; receiptHeading: FakeEl; records: FakeEl[] } {
    const h2 = el({});
    const receiptHeading = el({});
    const receipt = el({}, { querySelector: (s: string) => (s === "h3, h4" ? receiptHeading : null) });
    const records = [
      el({ recordId: "v1", version: "v1", lifecycle: "CORRECTED" }, { querySelector: (s: string) => (s === "h2" ? h2 : s === '[data-wp-target="receipt"]' ? receipt : null) }),
      el({ recordId: "v2", version: "v2", lifecycle: "DISCLOSED" }, { querySelector: () => null }),
    ];
    const rootDataset: Record<string, string> = { wpFocus: focusId };
    if (open !== null) rootDataset.wpOpen = open;
    const root = el(rootDataset);
    const announcer = el({});
    const app = {
      dataset: {},
      addEventListener: () => undefined,
      querySelector: (s: string) => (s === ".wp" || (s === ".wp[data-wp-open]" && open !== null) ? root : null),
      querySelectorAll: (s: string) => (s === ".wp-record" ? records : []),
    };
    const context = { document: { getElementById: (id: string) => (id === "app" ? app : id === "view-status" ? announcer : null) }, window: {}, navigator: {}, setTimeout: () => 0, clearTimeout: () => undefined };
    runInNewContext(render.WALLPRINT_JS, context);
    return { root, announcer, h2, receiptHeading, records };
  }

  test("data-wp-open=receipt shows the document at once, moves focus to the receipt heading of the focused record and announces it once", () => {
    const p = page("receipt");
    assert.equal(p.receiptHeading.focused, true);
    assert.equal(p.receiptHeading.attrs["tabindex"], "-1");
    assert.equal(p.announcer.textContent, "Opened from a portable reference: Receipt of v1: v1. Lifecycle CORRECTED.");
    assert.equal(p.root.dataset["wpOpened"], "true");
    assert.equal(p.root.dataset["wpRevealed"], "true", "the reveal is skipped so focus lands on a visible section");
    assert.ok(!p.h2.focused);
  });

  test("data-wp-open=record focuses the record's own heading; a key outside the table focuses nothing and says nothing", () => {
    const p = page("record");
    assert.equal(p.h2.focused, true);
    assert.equal(p.announcer.textContent, "Opened from a portable reference: Record of v1: v1. Lifecycle CORRECTED.");
    for (const key of ["body", "wp-sec-receipt-v1", "receipt' or 1=1", "__proto__", ""]) {
      const q = page(key);
      assert.ok(!q.h2.focused && !q.receiptHeading.focused, key);
      assert.equal(q.announcer.textContent, "", key);
      assert.equal(q.root.dataset["wpRevealed"], undefined, `${key}: a refused key changes nothing, not even the reveal`);
    }
    const none = page(null);
    assert.ok(!none.h2.focused && !none.receiptHeading.focused && none.announcer.textContent === "");
  });

  test("a section the record does not carry is said, not created; the script never builds a selector from the key", () => {
    const p = page("receipt", "v2");
    assert.equal(p.announcer.textContent, "The referenced section is not in this record.");
    assert.ok(!/querySelector\([^)]*wpOpen|querySelector\([^)]*dataset\.wpOpen/.test(render.WALLPRINT_JS), "the key only selects through the fixed table");
    assert.ok(/const SECTIONS = \{ record: "Record", receipt: "Receipt", replay: "Replay", history: "History", assessments: "Assessments", provenance: "Provenance" \};/.test(render.WALLPRINT_JS));
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|EventSource|XMLHttpRequest|postMessage|innerHTML|location\.|history\./.test(render.WALLPRINT_JS), "the script still stores nothing, talks to no origin, writes no markup and touches no URL");
  });
});
