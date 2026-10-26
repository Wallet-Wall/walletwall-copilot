import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { ROOT } from "../support/harness.ts";
import type { DisclosureFixture, DisclosureRecord } from "../support/wallprint-disclosures.ts";

/**
 * The WallPrint Receipt verification UX: the Verify section of the disclosure document as four separate questions (record,
 * digest, receipt, replay), each answered only by the engine's recorded result. These tests pin that the document consumes
 * the canonical result and fails closed, that receipt and replay stay independent, that every version of a lineage keeps
 * its own receipt, that exact values copy in full, and that the local section-focus action never invents a target.
 * No loopback, no MCP server: the renderer is a function and the page script runs in a stand-in DOM.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface RenderMod {
  renderView: (view: unknown) => string;
  WALLPRINT_CSS: string;
  WALLPRINT_JS: string;
}
interface WallPrintMod {
  RECEIPT_STATES: string[];
  receiptStatusOf: (receipt: unknown) => string;
  recordStatusOf: (validation: unknown) => string;
  digestStatusOf: (digest: unknown) => string;
  replayStatusOf: (replay: unknown, outcomes: unknown) => string;
}
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const wp = (await import(pathToFileURL(`${EXT}/wallprint-render.mjs`).href)) as WallPrintMod;
const { WALLPRINT_FIXTURES, WALLPRINT_VOCABULARY } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture>; WALLPRINT_VOCABULARY: { replayOutcomes: string[] } };

const view = (name: string, disclosure: DisclosureFixture = WALLPRINT_FIXTURES[name]!) => ({ status: "wallprint", source: `wallprint:${name}`, fixture: name, disclosure, vocabulary: WALLPRINT_VOCABULARY });
const fragment = (name: string, disclosure?: DisclosureFixture): string => render.renderView(view(name, disclosure));
const names = Object.keys(WALLPRINT_FIXTURES);
const articles = (html: string): string[] => html.split(/(?=<article class="wp-record")/).slice(1).map((a) => a.slice(0, a.indexOf("</article>") + 10));
const articleOf = (html: string, id: string): string => {
  const a = articles(html).find((x) => x.includes(`data-record-id="${id}"`));
  assert.ok(a, `article ${id}`);
  return a;
};
const focusOf = (name: string): DisclosureRecord => {
  const f = WALLPRINT_FIXTURES[name]!;
  return f.records.find((r) => r.id === f.focus)!;
};
const records = (): [string, string, DisclosureRecord][] => names.flatMap((name) => WALLPRINT_FIXTURES[name]!.records.map((r): [string, string, DisclosureRecord] => [name, `${name}/${r.id}`, r]));
/** The receipt check of one article: from its opening tag to the replay check. */
const receiptBlock = (a: string): string => {
  const start = a.indexOf('data-check="receipt"');
  assert.ok(start >= 0, "the article has a receipt check");
  const end = a.indexOf('data-check="replay"', start);
  return a.slice(a.lastIndexOf("<li", start), end >= 0 ? end : undefined);
};
/** The replay check of one article: from its opening tag to the end of the checks list. */
const replayBlock = (a: string): string => {
  const start = a.indexOf('data-check="replay"');
  assert.ok(start >= 0, "the article has a replay check");
  return a.slice(a.lastIndexOf("<li", start), a.indexOf("</ol>", start));
};
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const QUESTIONS: Record<string, string> = {
  record: "Is this a structurally valid WallPrint record?",
  digest: "Do these canonical bytes produce the embedded digest?",
  receipt: "Does the disclosed record match the committed record?",
  replay: "Can the historical evaluation be reproduced under the recorded context?",
};

describe("semantic projection: every status word is a 1:1 label of the engine's result, and anything else fails closed", () => {
  test("every fixture record's receipt status equals the canonical engine output, and the rendered article carries the same word", () => {
    assert.deepEqual(wp.RECEIPT_STATES, ["MATCH", "MISMATCH", "UNAVAILABLE", "UNCHECKED"]);
    for (const [name, label, r] of records()) {
      const expected = r.receipt.issued === null ? "UNAVAILABLE" : r.receipt.verification === null ? "UNCHECKED" : r.receipt.verification.matches ? "MATCH" : "MISMATCH";
      assert.equal(wp.receiptStatusOf(r.receipt), expected, label);
      assert.ok(receiptBlock(articleOf(fragment(name), r.id)).includes(`data-receipt="${expected}"`), `${label}: rendered as ${expected}`);
    }
  });

  test("a malformed verification is never MATCH: a non-boolean, a match with reasons, a mismatch without reasons, a non-object receipt or verification", () => {
    const issued = focusOf("receipt-valid").receipt.issued;
    const cases: [unknown, string][] = [
      [undefined, "UNAVAILABLE"],
      [null, "UNAVAILABLE"],
      [{ issued: null, verification: null }, "UNAVAILABLE"],
      [{ issued, verification: null }, "UNCHECKED"],
      [{ issued, verification: { matches: true, reasons: [] } }, "MATCH"],
      [{ issued, verification: { matches: false, reasons: ["RECORD_INVALID"] } }, "MISMATCH"],
      [{ issued, verification: { matches: "true", reasons: [] } }, "UNRECOGNISED"],
      [{ issued, verification: { matches: 1, reasons: [] } }, "UNRECOGNISED"],
      [{ issued, verification: { matches: true, reasons: ["DIGEST_MISMATCH"] } }, "UNRECOGNISED"],
      [{ issued, verification: { matches: false, reasons: [] } }, "UNRECOGNISED"],
      [{ issued, verification: { matches: false } }, "UNRECOGNISED"],
      [{ issued, verification: "ok" }, "UNRECOGNISED"],
      [{ issued, verification: [] }, "UNRECOGNISED"],
      [{ issued: "yes", verification: { matches: true, reasons: [] } }, "UNRECOGNISED"],
      [{ issued: null, verification: { matches: true, reasons: [] } }, "UNRECOGNISED"],
      ["MATCH", "UNRECOGNISED"],
    ];
    for (const [input, expected] of cases) assert.equal(wp.receiptStatusOf(input), expected, JSON.stringify(input));
  });

  test("the record and digest checks fail closed the same way: absence is not carried, inconsistency is not recognised", () => {
    const hex = "a".repeat(64);
    for (const [input, expected] of [
      [null, "NOT_CARRIED"],
      [undefined, "NOT_CARRIED"],
      [{ ok: true, findings: [] }, "VALID"],
      [{ ok: false, findings: [{ code: "DIGEST_MISMATCH", path: "digest" }] }, "INVALID"],
      [{ ok: "yes", findings: [] }, "UNRECOGNISED"],
      [{ ok: true, findings: [{ code: "X", path: "" }] }, "UNRECOGNISED"],
      [{ ok: false, findings: [] }, "UNRECOGNISED"],
      [{ ok: false, findings: "x" }, "UNRECOGNISED"],
      [{ ok: true }, "UNRECOGNISED"],
    ] as [unknown, string][]) assert.equal(wp.recordStatusOf(input), expected, `record ${JSON.stringify(input)}`);
    for (const [input, expected] of [
      [null, "NOT_CARRIED"],
      [undefined, "NOT_CARRIED"],
      [{ hasDigest: false, matches: false, computedDigest: null }, "NO_DIGEST"],
      [{ hasDigest: true, matches: true, computedDigest: hex }, "MATCH"],
      [{ hasDigest: true, matches: false, computedDigest: hex }, "MISMATCH"],
      [{ hasDigest: true, matches: false, computedDigest: null }, "MISMATCH"],
      [{ hasDigest: true, matches: "true", computedDigest: hex }, "UNRECOGNISED"],
      [{ hasDigest: true, matches: true, computedDigest: null }, "UNRECOGNISED"],
      [{ hasDigest: false, matches: true, computedDigest: null }, "UNRECOGNISED"],
      [{ matches: true }, "UNRECOGNISED"],
    ] as [unknown, string][]) assert.equal(wp.digestStatusOf(input), expected, `digest ${JSON.stringify(input)}`);
    const outcomes = WALLPRINT_VOCABULARY.replayOutcomes;
    for (const [input, expected] of [
      [null, "NOT_CARRIED"],
      [undefined, "NOT_CARRIED"],
      [{ outcome: "REPRODUCED", reasons: [], recomputedDigest: hex, mismatches: [] }, "REPRODUCED"],
      [{ outcome: "MISMATCH", reasons: ["DIGEST_MISMATCH"], recomputedDigest: hex, mismatches: ["claims"] }, "MISMATCH"],
      [{ outcome: "UNREPLAYABLE", reasons: ["MISSING_EVIDENCE"], recomputedDigest: null, mismatches: [] }, "UNREPLAYABLE"],
      [{ outcome: "CORRECT" }, "UNRECOGNISED"],
      [{ reasons: [] }, "UNRECOGNISED"],
      ["REPRODUCED", "UNRECOGNISED"],
    ] as [unknown, string][]) assert.equal(wp.replayStatusOf(input, outcomes), expected, `replay ${JSON.stringify(input)}`);
  });

  test("a malformed verification renders as not recognised: no MATCH and no MISMATCH chip in the receipt check, and the reason is said", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["receipt-valid"]!) as unknown as { records: { receipt: { verification: Record<string, unknown> } }[] };
    f.records[0]!.receipt.verification = { matches: "true", reasons: [] };
    const html = fragment("receipt-valid", f as unknown as DisclosureFixture);
    const block = receiptBlock(articleOf(html, focusOf("receipt-valid").id));
    assert.ok(block.includes('data-receipt="UNRECOGNISED"'));
    assert.ok(block.includes('<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span>'));
    assert.ok(!/data-state="(MATCH|MISMATCH)"/.test(block), "no verdict is invented for a result the document does not recognise");
    assert.ok(block.includes("not in a form this document recognises"));
  });
});

describe("four questions: record, digest, receipt and replay are separate checks, in order, each with its question and the engine's answer", () => {
  test("every article asks the four questions in order inside one list, says they are separate, and folds no check into a closed disclosure", () => {
    for (const [name, label, r] of records()) {
      const a = articleOf(fragment(name), r.id);
      const start = a.indexOf('<ol class="wp-checks"');
      assert.ok(start >= 0, `${label}: the checks list exists`);
      const list = a.slice(start, a.indexOf("</ol>", start));
      const checks = [...list.matchAll(/<li class="wp-check[^"]*" data-check="([a-z]+)"/g)].map((m) => m[1]);
      assert.deepEqual(checks, ["record", "digest", "receipt", "replay"], label);
      for (const [key, q] of Object.entries(QUESTIONS)) assert.ok(list.includes(`data-check="${key}"`) && list.includes(`<p class="wp-check-q">${q}</p>`), `${label}: ${key} asks its question`);
      assert.ok(!list.includes("<details"), `${label}: no check is folded`);
      assert.ok(a.includes("Four separate questions") && a.includes("never combines them into one state"), label);
      assert.ok(list.includes('<h4 id="wp-ck-record-') && list.includes('<h4 id="wp-ck-replay-'), `${label}: every check is a heading`);
    }
  });

  test("the altered copy: record INVALID with the engine's finding, digest MISMATCH with both digests in full, receipt MISMATCH with its reason, and no verdict about the facts", () => {
    const r = focusOf("receipt-mismatch");
    const a = articleOf(fragment("receipt-mismatch"), r.id);
    assert.ok(a.includes('data-check="record" data-result="INVALID"'));
    assert.ok(a.includes('<span class="chip" data-state="INVALID" data-attention="true">INVALID</span>') && a.includes("<li><code>DIGEST_MISMATCH</code> at <code>digest</code></li>"));
    assert.ok(a.includes('data-check="digest" data-result="MISMATCH"'));
    const digest = a.slice(a.indexOf('data-check="digest"'), a.indexOf('data-check="receipt"'));
    assert.ok(digest.includes(`<code class="wp-exact">${r.record.digest}</code>`) && digest.includes(`<code class="wp-exact">${r.digest.computedDigest}</code>`), "embedded and computed digests, in full");
    assert.ok(digest.includes("The embedded digest is not the SHA-256 of the disclosed canonical record."));
    const receipt = receiptBlock(a);
    assert.ok(receipt.includes('data-receipt="MISMATCH"') && receipt.includes("<code>RECORD_INVALID</code>"));
    assert.ok(!/\b(forged|forgery|tamper\w*|fraudulent|fake|lying|dishonest)\b/i.test(text(receipt + digest)), "a mismatch is an integrity finding, never an accusation");
    assert.ok(!/\b(facts? (?:are|is) (?:wrong|false|right|true))\b/i.test(text(receipt + digest)), "nothing says which side is factually right");
  });

  test("the engine-built record: VALID, MATCH, MATCH, REPRODUCED, each a calm chip followed by its meaning in words", () => {
    const r = focusOf("receipt-valid");
    const a = articleOf(fragment("receipt-valid"), r.id);
    assert.ok(a.includes('data-check="record" data-result="VALID"') && a.includes('<span class="chip" data-state="VALID">VALID</span> <span class="wp-check-meaning">Every rule the builder applies holds for the disclosed record.</span>'));
    assert.ok(a.includes('data-check="digest" data-result="MATCH"') && a.includes('<span class="chip" data-state="MATCH">MATCH</span> <span class="wp-check-meaning">The embedded digest is the SHA-256 of the disclosed canonical record.'));
    assert.ok(receiptBlock(a).includes('<span class="chip" data-state="MATCH">MATCH</span> <span class="wp-check-meaning">The disclosed canonical record matches the committed record.</span>'));
    assert.ok(a.includes('data-check="replay" data-replay="REPRODUCED"'));
    const start = a.indexOf('<ol class="wp-checks"');
    assert.ok(!/data-attention="true"/.test(a.slice(start, a.indexOf("</ol>", start))), "nothing in a clean readout asks for attention");
  });

  test("absent checks are absence: a disclosure without a validation result or digest check prints not carried, never a verdict", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["receipt-valid"]!) as unknown as { records: Record<string, unknown>[] };
    delete f.records[0]!["validation"];
    delete f.records[0]!["digest"];
    const a = articleOf(fragment("receipt-valid", f as unknown as DisclosureFixture), focusOf("receipt-valid").id);
    assert.ok(a.includes('data-check="record" data-result="NOT_CARRIED"') && a.includes("No validation result is carried in this disclosure. Nothing was checked here."));
    assert.ok(a.includes('data-check="digest" data-result="NOT_CARRIED"') && a.includes("No digest check is carried in this disclosure. Nothing was computed here."));
    assert.ok(a.includes('<dt>Computed digest</dt><dd><span class="muted">not carried</span></dd>'));
    assert.ok(!/data-state="(INVALID|MISMATCH|VALID)"/.test(a.slice(a.indexOf('<ol class="wp-checks"'), a.indexOf('data-check="receipt"'))), "no result is invented for the missing checks");
  });
});

describe("the receipt check: the engine's fields, the boundary, and one receipt per version", () => {
  test("a matching receipt shows the receipt's record id, commitment digest, bundle digest, versions and the engine result, each exact and copyable, with the boundary from the engine's vocabulary", () => {
    const r = focusOf("receipt-valid");
    const block = receiptBlock(articleOf(fragment("receipt-valid"), r.id));
    const issued = r.receipt.issued!;
    assert.ok(block.includes(`<dt>Receipt for record</dt><dd><span class="wp-copyable"><code class="wp-exact">${issued.recordId}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full receipt record id">Copy</button></span></dd>`));
    assert.ok(block.includes(`<dt>Commitment digest (receipt)</dt><dd><span class="wp-copyable"><code class="wp-exact">${issued.digest}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full receipt digest">Copy</button></span></dd>`));
    assert.ok(block.includes(`<dt>Embedded digest (record)</dt><dd><span class="wp-copyable"><code class="wp-exact">${r.record.digest}</code>`));
    assert.ok(block.includes(`<dt>Receipt bundle digest</dt><dd><span class="wp-copyable"><code class="wp-exact">${issued.bundleDigest}</code>`));
    for (const [k, v] of Object.entries(issued.versions)) assert.ok(block.includes(`<li><code>${k}</code> <code>${v}</code></li>`), k);
    assert.ok(block.includes("<dt>Engine result</dt><dd><code>matches: true</code>"));
    const vocab = WALLPRINT_VOCABULARY as unknown as { receipt: { establishes: string; doesNotEstablish: string[] } };
    assert.ok(block.includes(`<p class="wp-boundary"><strong>${esc(vocab.receipt.establishes)}</strong> A matching receipt demonstrates consistency between this disclosed record and its commitment. A matching receipt does not establish ${vocab.receipt.doesNotEstablish.map(esc).join(", ")}.</p>`));
    assert.ok(!block.includes("Receipt ID") && !block.includes("receipt id:"), "no receipt identifier is invented: a receipt is identified by its record id and digest");
  });

  test("no receipt and an unverified receipt are neutral: no attention mark, no MATCH or MISMATCH, absence said in words, the boundary still present", () => {
    for (const [name, status, saying] of [
      ["unreplayable", "UNAVAILABLE", "No receipt is carried for this record. Absence is not failure."],
      ["receipt-unverified", "UNCHECKED", "A receipt is carried, but no verification result is available in this disclosure. No check was run here."],
    ] as const) {
      const block = receiptBlock(articleOf(fragment(name), focusOf(name).id));
      assert.ok(block.includes(`data-receipt="${status}"`), name);
      assert.ok(block.includes(`<span class="chip" data-state="${status}">${status}</span> <span class="wp-check-meaning">${saying}</span>`), `${name}: status and meaning`);
      assert.ok(!/data-state="(MATCH|MISMATCH)"|data-attention="true"/.test(block), `${name}: absence is not failure`);
      assert.ok(block.includes("A matching receipt does not establish"), `${name}: boundary`);
    }
    const unverified = receiptBlock(articleOf(fragment("receipt-unverified"), focusOf("receipt-unverified").id));
    assert.ok(unverified.includes('<dt>Engine result</dt><dd><span class="muted">not carried</span></dd>'), "no engine result is invented");
    assert.ok(unverified.includes(`<code class="wp-exact">${focusOf("receipt-unverified").receipt.issued!.digest}</code>`), "the receipt's own fields stay inspectable");
    const none = receiptBlock(articleOf(fragment("unreplayable"), focusOf("unreplayable").id));
    assert.ok(none.includes("No receipt fields to show.") && !none.includes("wp-exact"), "nothing is printed in place of an absent receipt");
  });

  test("a corrected lineage: each version's receipt check carries that version's commitment digest; the predecessor says it is not current; each lists the other's receipt as separate", () => {
    const f = WALLPRINT_FIXTURES["corrected"]!;
    const [v1, v2] = f.records as [DisclosureRecord, DisclosureRecord];
    const html = fragment("corrected");
    const b1 = receiptBlock(articleOf(html, v1.id));
    const b2 = receiptBlock(articleOf(html, v2.id));
    assert.ok(b1.includes(`<dt>Commitment digest (receipt)</dt><dd><span class="wp-copyable"><code class="wp-exact">${v1.receipt.issued!.digest}</code>`));
    assert.ok(!b1.includes(v2.receipt.issued!.digest), "the predecessor's check never carries the successor's digest");
    assert.ok(b2.includes(`<dt>Commitment digest (receipt)</dt><dd><span class="wp-copyable"><code class="wp-exact">${v2.receipt.issued!.digest}</code>`));
    // The successor binds the predecessor's committed digest; that is the only place the predecessor's digest appears in its check, labelled as such.
    assert.equal((b2.match(new RegExp(v1.record.digest, "g")) ?? []).length, 1);
    assert.ok(b2.includes(`<dt>Predecessor digest bound</dt><dd><span class="wp-copyable"><code class="wp-exact">${v1.record.digest}</code>`));
    assert.ok(b1.includes('<p class="note wp-receipt-standing" data-attention="true">This receipt belongs to a record whose lifecycle is <code>CORRECTED</code>: not the current record. A later version does not replace this commitment, and a withdrawal does not erase it.</p>'));
    assert.ok(!b2.includes("wp-receipt-standing"), "the current record carries no standing note");
    assert.ok(b2.includes(`data-wp-version="${v1.id}" data-wp-then="receipt"`) && b2.includes(">Show v1 receipt</button>") && b2.includes('data-state="CORRECTED"'), "the successor lists the predecessor's own receipt and lifecycle");
    assert.ok(b1.includes(`data-wp-version="${v2.id}" data-wp-then="receipt"`) && b1.includes(">Show v2 receipt</button>"));
    for (const b of [b1, b2]) assert.ok(b.includes("Each version carries its own receipt") && b.includes("never merged"), "receipts are listed, never merged");
    assert.ok(!receiptBlock(articleOf(fragment("receipt-valid"), focusOf("receipt-valid").id)).includes("wp-receipt-lineage"), "a single-record lineage lists no other receipts");
  });

  test("a withdrawn record keeps its receipt: MATCH beside the WITHDRAWN lifecycle, and withdrawal is said not to erase it", () => {
    const block = receiptBlock(articleOf(fragment("withdrawn"), focusOf("withdrawn").id));
    assert.ok(block.includes('data-receipt="MATCH"') && block.includes("<code>WITHDRAWN</code>") && block.includes("a withdrawal does not erase it"));
  });
});

describe("receipt and replay stay independent", () => {
  test("every combination the fixtures carry renders as two separate results, with the independence sentence and no combined attribute", () => {
    for (const [name, receipt, replay] of [
      ["receipt-valid", "MATCH", "REPRODUCED"],
      ["replay-mismatch", "MATCH", "MISMATCH"],
      ["receipt-unreplayable", "MATCH", "UNREPLAYABLE"],
      ["receipt-mismatch", "MISMATCH", "UNREPLAYABLE"],
      ["unreplayable", "UNAVAILABLE", "UNREPLAYABLE"],
      ["receipt-unverified", "UNCHECKED", "REPRODUCED"],
    ] as const) {
      const a = articleOf(fragment(name), focusOf(name).id);
      assert.ok(a.includes(`data-check="receipt" data-receipt="${receipt}"`), `${name}: receipt ${receipt}`);
      assert.ok(a.includes(`data-check="replay" data-replay="${replay}"`), `${name}: replay ${replay}`);
      assert.ok(!/data-(overall|combined|verified|verdict|status|summary-result)=/.test(a), `${name}: no combined status`);
      assert.ok(a.includes('<p class="wp-independent">Receipt and replay are separate questions'), name);
    }
  });

  test("a matching receipt beside an unreplayable record: the replay check lists the missing input and recomputes nothing; neither check restates the other's result", () => {
    const a = articleOf(fragment("receipt-unreplayable"), focusOf("receipt-unreplayable").id);
    const replay = replayBlock(a);
    assert.ok(replay.includes("<code>MISSING_EVIDENCE</code>") && replay.includes("nothing was recomputed") && replay.includes("<strong>UNREPLAYABLE is not INCORRECT.</strong>"));
    assert.ok(!/\bMATCH\b/.test(text(replay)), "the replay check does not restate the receipt result");
    assert.ok(!/UNREPLAYABLE|MISSING_EVIDENCE/.test(receiptBlock(a)), "the receipt check does not restate the replay result");
  });
});

describe("registration readout and derivation chain", () => {
  test("every identifier, digest, version and instant is listed in the registration, in full, with an exact-value copy control", () => {
    for (const [name, label, r] of records()) {
      const a = articleOf(fragment(name), r.id);
      const start = a.indexOf('<div class="wp-registration">');
      assert.ok(start >= 0, `${label}: registration exists`);
      const reg = a.slice(start, a.indexOf('<div class="wp-derivation">'));
      assert.ok(reg.includes("<h4>Registration</h4>"), label);
      for (const [dt, v, what] of [
        ["WallPrint ID", r.record.id, "WallPrint id"],
        ["Evidence bundle digest", r.record.evidence.bundleDigest, "evidence bundle digest"],
      ]) assert.ok(reg.includes(`<dt>${dt}</dt><dd><span class="wp-copyable"><code class="wp-exact">${v}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full ${what}">Copy</button></span></dd>`), `${label}: ${dt}`);
      assert.ok(reg.includes(`<code class="wp-exact">${r.record.versions.registryDigest}</code>`) && reg.includes(`<code class="wp-exact">${r.record.versions.policiesDigest}</code>`), `${label}: registry and policies digests`);
      for (const v of [r.record.versions.wwep, r.record.versions.registry, r.record.versions.policies, r.record.versions.rules, r.record.wallprintVersion]) assert.ok(reg.includes(`<code>${v}</code>`), `${label}: ${v}`);
      assert.ok(reg.includes("<code>RFC8785</code>") && reg.includes("<code>SHA-256</code>"), label);
      assert.ok(reg.includes(`<dt>Snapshot</dt><dd><time datetime="${r.record.snapshotAt}">`), `${label}: snapshot instant`);
      const committed = r.lifecycle.events.find((e) => e.state === "COMMITTED")!;
      assert.ok(reg.includes(`<dt>Committed</dt><dd><time datetime="${committed.at}">`), `${label}: committed instant`);
      const disclosed = r.lifecycle.events.find((e) => e.state === "DISCLOSED");
      assert.ok(reg.includes(disclosed ? `<dt>Disclosed</dt><dd><time datetime="${disclosed.at}">` : '<dt>Disclosed</dt><dd><span class="muted">not reached</span>'), `${label}: disclosed instant or its absence`);
      assert.ok(!/<code class="wp-exact">[^<]*(…|\.\.\.)/.test(reg), `${label}: no shortened exact value`);
    }
  });

  test("the derivation chain runs payload, RFC 8785, SHA-256, digest, receipt, in order, with the raw payload folded in its first step and exact values in the last two", () => {
    const r = focusOf("receipt-mismatch");
    const a = articleOf(fragment("receipt-mismatch"), r.id);
    const start = a.indexOf('<ol class="wp-steps"');
    assert.ok(start >= 0);
    const chain = a.slice(start, a.indexOf("</ol>", start));
    assert.deepEqual([...chain.matchAll(/<li class="wp-step" data-step="([a-z]+)"/g)].map((m) => m[1]), ["payload", "canonical", "hash", "digest", "receipt"]);
    assert.ok(chain.includes('<details class="wp-more wp-raw"><summary>Raw canonical payload (advanced)</summary>') && chain.includes(`<code class="wp-raw-text">${esc(r.canonical)}</code>`), "the raw payload is an advanced fold inside the first step");
    assert.ok(chain.includes("<code>RFC8785</code>") && chain.includes("<code>SHA-256</code>"));
    const digest = chain.slice(chain.indexOf('data-step="digest"'), chain.indexOf('data-step="receipt"'));
    assert.ok(digest.includes(`<code class="wp-exact">${r.record.digest}</code>`) && digest.includes(`<code class="wp-exact">${r.digest.computedDigest}</code>`) && digest.includes('data-state="MISMATCH"'));
    const receipt = chain.slice(chain.indexOf('data-step="receipt"'));
    assert.ok(receipt.includes(`<code class="wp-exact">${r.receipt.issued!.digest}</code>`) && receipt.includes('data-state="MISMATCH"'));
    const none = articleOf(fragment("unreplayable"), focusOf("unreplayable").id);
    assert.ok(none.slice(none.indexOf('data-step="receipt"')).includes("No receipt is carried, so there is no commitment to compare against."));
  });
});

describe("local section focus: a deterministic action inside the document, never a URL", () => {
  const SECTIONS = ["receipt", "replay", "history", "assessments", "provenance"];

  test("every article has one jump nav with the five section controls, each naming a target that exists exactly once in the same article", () => {
    for (const [name, label, r] of records()) {
      const a = articleOf(fragment(name), r.id);
      const navStart = a.indexOf('<nav class="wp-jump');
      assert.ok(navStart >= 0, `${label}: jump nav`);
      const nav = a.slice(navStart, a.indexOf("</nav>", navStart));
      assert.ok(nav.includes('aria-label="Go to a section of this record"'), label);
      const controls = [...nav.matchAll(/<button type="button" data-wp-jump="([a-z]+)" aria-controls="([^"]+)">([^<]+)<\/button>/g)].map((m) => [m[1], m[2], m[3]]);
      assert.deepEqual(controls.map((c) => c[0]), SECTIONS, label);
      assert.deepEqual(controls.map((c) => c[2]), ["Receipt", "Replay", "History", "Assessments", "Provenance"], label);
      for (const [key, id] of controls) {
        assert.equal(id, `wp-sec-${key}-${r.id}`, `${label}: ${key} follows the id scheme`);
        assert.equal((a.match(new RegExp(` id="${id}"`, "g")) ?? []).length, 1, `${label}: ${key} target exists once in its article`);
        assert.ok(a.includes(`data-wp-target="${key}" id="${id}"`), `${label}: the target carries data-wp-target`);
      }
      assert.ok(!/href=|javascript:|location\./i.test(nav), `${label}: no link and no URL`);
    }
    const html = fragment("corrected");
    assert.equal(new Set([...html.matchAll(/ id="(wp-sec-[a-z]+-[^"]+)"/g)].map((m) => m[1])).size, 10, "a lineage of two records has ten distinct targets");
  });

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
    textContent: string;
    focused?: boolean;
    scrollIntoView?: (o: unknown) => void;
  }
  const el = (dataset: Record<string, string>, extra: Partial<FakeEl> = {}): FakeEl => {
    const e: FakeEl = {
      dataset,
      hidden: false,
      attrs: {},
      setAttribute: (k, v) => (e.attrs[k] = v),
      removeAttribute: (k) => delete e.attrs[k],
      getAttribute: (k) => e.attrs[k] ?? null,
      querySelector: () => null,
      closest: () => null,
      focus: () => (e.focused = true),
      textContent: "",
      ...extra,
    };
    return e;
  };

  /** Two versions, each with an h2 and a receipt target whose heading can take focus; v2 is in view. */
  function page(): { run: (target: unknown) => Promise<void>; records: FakeEl[]; headings: Record<string, FakeEl>; h2: FakeEl[]; announcer: FakeEl; scrolled: string[]; root: FakeEl } {
    const scrolled: string[] = [];
    const headings: Record<string, FakeEl> = {};
    const h2 = [el({}), el({})];
    const record = (id: string, version: string, hidden: boolean): FakeEl => {
      headings[`${id}:receipt`] = el({});
      const target = el({ wpTarget: "receipt" }, { querySelector: (s: string) => (s === "h3, h4" ? headings[`${id}:receipt`] : null), scrollIntoView: () => scrolled.push(`${id}:receipt`) });
      return el({ recordId: id, version }, { hidden, querySelector: (s: string) => (s === "h2" ? h2[id === "v1" ? 0 : 1] : s === '[data-wp-target="receipt"]' ? target : null) });
    };
    const records = [record("v1", "v1", true), record("v2", "v2", false)];
    const root = el({ wpFocus: "v2" });
    const announcer = el({});
    let onClick: ((e: unknown) => void) | undefined;
    const app = {
      dataset: {},
      addEventListener: (type: string, h: (e: unknown) => void) => {
        if (type === "click") onClick = h;
      },
      querySelector: (s: string) => (s === ".wp" ? root : null),
      querySelectorAll: (s: string) => (s === ".wp-record" ? records : []),
    };
    const context = {
      document: { getElementById: (id: string) => (id === "app" ? app : id === "copy-status" ? el({}) : id === "view-status" ? announcer : null), createRange: () => ({ selectNodeContents: () => undefined }), execCommand: () => false },
      window: { getSelection: () => ({ removeAllRanges: () => undefined, addRange: () => undefined }) },
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    };
    runInNewContext(render.WALLPRINT_JS, context);
    assert.ok(onClick, "the script registers its click handler");
    const run = async (target: unknown): Promise<void> => {
      onClick!({ target });
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    };
    return { run, records, headings, h2, announcer, scrolled, root };
  }

  test("a jump control focuses the named section's heading of its own record, scrolls it into view and announces it; nothing else changes", async () => {
    const p = page();
    const jump = el({ wpJump: "receipt" }, { closest: (s: string) => (s === ".wp-record" ? p.records[1] : null) });
    await p.run({ closest: (s: string) => (s === "[data-wp-jump]" ? jump : null) });
    assert.equal(p.headings["v2:receipt"]!.focused, true);
    assert.equal(p.headings["v2:receipt"]!.attrs["tabindex"], "-1");
    assert.deepEqual(p.scrolled, ["v2:receipt"]);
    assert.equal(p.announcer.textContent, "Receipt of v2: v2.");
    assert.deepEqual(p.records.map((r) => r.hidden), [true, false], "no version changed");
    assert.equal(p.headings["v1:receipt"]!.focused, undefined);
  });

  test("a version control that names a section shows that version and focuses its own section, so a predecessor's receipt is reached without passing through the successor's", async () => {
    const p = page();
    const version = el({ wpVersion: "v1", wpThen: "receipt" });
    await p.run({ closest: (s: string) => (s === "[data-wp-version]" ? version : null) });
    assert.deepEqual(p.records.map((r) => r.hidden), [false, true]);
    assert.equal(p.headings["v1:receipt"]!.focused, true);
    assert.equal(p.headings["v2:receipt"]!.focused, undefined);
    assert.equal(p.h2[0]!.focused, undefined, "focus goes to the section, not the record heading");
    assert.equal(p.root.dataset["wpFocus"], "v1");
    assert.equal(p.announcer.textContent, "Showing v1 of this lineage: v1. Receipt section. The other versions stay available.");
  });

  test("a hostile or unknown section key is refused without echo, without a throw and without moving focus", async () => {
    const p = page();
    for (const key of ["evil", "__proto__", "constructor", "<script>", "RECEIPT", ""]) {
      const jump = el({ wpJump: key }, { closest: (s: string) => (s === ".wp-record" ? p.records[1] : null) });
      await p.run({ closest: (s: string) => (s === "[data-wp-jump]" ? jump : null) });
      assert.equal(p.announcer.textContent, "That section is not part of this record.", key);
      assert.ok(!p.announcer.textContent.includes(key) || key === "", `${key}: not echoed`);
    }
    assert.equal(p.headings["v2:receipt"]!.focused, undefined);
    assert.deepEqual(p.scrolled, []);
    // A recognised key whose section the record does not carry is said in words.
    const jump = el({ wpJump: "history" }, { closest: (s: string) => (s === ".wp-record" ? p.records[1] : null) });
    await p.run({ closest: (s: string) => (s === "[data-wp-jump]" ? jump : null) });
    assert.equal(p.announcer.textContent, "The History section is not in this record.");
  });

  test("the page script still stores nothing, talks to no origin, writes no markup and never touches the location", () => {
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|EventSource|XMLHttpRequest|postMessage|innerHTML|outerHTML|insertAdjacentHTML|location\.|history\.(push|replace)State|window\.open/.test(render.WALLPRINT_JS));
  });
});

describe("the evidence view's reserved Receipt row: disabled, its prerequisite named, no link faked", () => {
  test("Copy receipt, Verify and QR stay disabled with the pinned reason; the missing prerequisite is a committed WallPrint record of this evaluation; nothing points into a disclosure", () => {
    const html = render.renderView({
      status: "ready",
      source: "fixture:usdc-established",
      evaluatedAt: "2026-10-23T12:00:30Z",
      versions: { wwep: "0.1", registry: "2026-10", policies: "2026-10", rules: "2026-10" },
      bundleDigest: "a".repeat(64),
      invariantViolationCount: "0",
      invariantViolations: [],
      assertions: [],
      observations: [],
      sources: [],
      derivations: [],
      selectedId: null,
      provenance: null,
      readiness: null,
    });
    for (const label of ["Copy receipt", "Verify", "QR"]) assert.ok(html.includes(`<button type="button" disabled aria-describedby="receipt-why">${label}</button>`), label);
    assert.ok(html.includes('<p id="receipt-why" class="ww-reason">Requires immutable snapshot.</p>'), "the pinned reason is unchanged");
    assert.ok(html.includes("a committed WallPrint record of this evaluation, with a record id, committed canonical bytes and a disclosure history"));
    assert.ok(html.includes("no committed record, so no WallPrint disclosure can be identified for it and nothing here links to one"));
    assert.ok(!/data-wp-jump|data-wp-target|wp-sec-|wallprint:|class="wp/.test(html), "the evidence view fakes no link into a disclosure and renders none of the document");
  });
});
