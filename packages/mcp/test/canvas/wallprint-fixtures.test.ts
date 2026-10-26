import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalize } from "../../src/canonical.ts";
import { WWEP_VERSION } from "../../src/schemas.ts";
import { verifyLifecycleChain } from "../../src/wallprint/history.ts";
import { verifyReceipt } from "../../src/wallprint/receipt.ts";
import { validateWallPrintRecord, verifyWallPrintDigest, wallPrintPayload } from "../../src/wallprint/record.ts";
import { UNREPLAYABLE_REASONS, WALLPRINT_INVARIANTS, WALLPRINT_PRINCIPLE } from "../../src/wallprint/vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { WALLPRINT_FIXTURE_NAMES, buildWallPrintDisclosures, wallPrintVocabulary, type DisclosureFixture, type DisclosureRecord } from "../support/wallprint-disclosures.ts";

/**
 * The WallPrint disclosure fixtures are engine outputs, serialized. These tests pin that: the shipped module equals a fresh
 * run of the builder (so no semantic field was hand-authored or edited), every verdict in it is re-derivable from the
 * record it sits beside, and the lineages cover every scenario the disclosure view must show.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
const shipped = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture>; WALLPRINT_VOCABULARY: ReturnType<typeof wallPrintVocabulary> };
const FIXTURES = shipped.WALLPRINT_FIXTURES;
const all = (): [string, DisclosureFixture][] => Object.entries(FIXTURES);
const records = (): [string, DisclosureRecord][] => all().flatMap(([name, f]) => f.records.map((r): [string, DisclosureRecord] => [`${name}/${r.id}`, r]));
const focus = (name: string): DisclosureRecord => {
  const f = FIXTURES[name]!;
  const r = f.records.find((x) => x.id === f.focus);
  assert.ok(r, `${name}: focus record exists`);
  return r;
};
const focalClaim = (r: DisclosureRecord) => r.record.claims.find((c) => c.assertionId === r.record.subject.focalAssertionId)!;

describe("WallPrint disclosure fixtures are engine outputs, not authored views", () => {
  test("the shipped module is byte-for-byte what the builder produces now, and two builds agree", () => {
    const built = buildWallPrintDisclosures();
    assert.deepEqual(FIXTURES, built, "regenerate with npm run gen:wallprint");
    assert.deepEqual(buildWallPrintDisclosures(), built, "deterministic: no clock, no randomness");
    assert.deepEqual(Object.keys(FIXTURES), [...WALLPRINT_FIXTURE_NAMES]);
  });

  test("every fixture declares how it was constructed; exactly two are adversarial and name the one field they changed", () => {
    const adversarial = Object.entries(FIXTURES).filter(([, f]) => f.scenario.kind !== "ENGINE_BUILT");
    assert.deepEqual(adversarial.map(([name, f]) => [name, f.scenario]), [
      ["receipt-mismatch", { kind: "ALTERED_AFTER_COMMIT", patched: ["assessments[reviewer-y].statement"] }],
      ["replay-mismatch", { kind: "COMMITTED_ELSEWHERE", patched: ["claims[a-price].supportState"] }],
    ]);
    for (const [name, f] of all()) if (f.scenario.kind === "ENGINE_BUILT") assert.deepEqual(f.scenario.patched, [], name);
    // The declared patches are the only places those records depart from what this engine builds.
    const altered = focus("receipt-mismatch");
    assert.equal(altered.record.assessments.find((a) => a.assessor === "reviewer-y")?.statement, "Review completed.");
    assert.equal(focus("replay-mismatch").record.claims.find((c) => c.assertionId === "a-price")?.supportState, "PARTIAL");
    assert.ok(focus("replay-mismatch").replay.mismatches.length === 1 && focus("replay-mismatch").replay.mismatches[0] === "claims");
  });

  test("the shipped vocabulary is the engine's: principle, invariants, states, lifecycle, replay and receipt boundary", () => {
    assert.deepEqual(shipped.WALLPRINT_VOCABULARY, wallPrintVocabulary());
    assert.equal(shipped.WALLPRINT_VOCABULARY.principle, WALLPRINT_PRINCIPLE);
    assert.deepEqual(shipped.WALLPRINT_VOCABULARY.invariants, [...WALLPRINT_INVARIANTS]);
    assert.deepEqual(shipped.WALLPRINT_VOCABULARY.lifecycleStates, ["COMMITTED", "DISCLOSED", "CORRECTED", "SUPERSEDED", "WITHDRAWN"]);
    assert.deepEqual(shipped.WALLPRINT_VOCABULARY.replayOutcomes, ["REPRODUCED", "MISMATCH", "UNREPLAYABLE"]);
    assert.ok(shipped.WALLPRINT_VOCABULARY.receipt.doesNotEstablish.includes("factual truth"));
  });

  test("every record's digest check, validation, canonical payload, lifecycle chain and receipt verification re-derive from the record beside them", () => {
    for (const [label, r] of records()) {
      assert.equal(r.id, r.record.id, label);
      assert.deepEqual(r.digest, verifyWallPrintDigest(r.record), `${label}: digest`);
      const v = validateWallPrintRecord(r.record);
      assert.equal(v.ok, r.validation.ok, `${label}: validation`);
      if (!v.ok) assert.deepEqual(r.validation.findings, v.findings, `${label}: findings`);
      assert.equal(r.canonical, canonicalize(wallPrintPayload(r.record)), `${label}: canonical bytes`);
      assert.deepEqual(verifyLifecycleChain(r.lifecycle.events), { ok: true, brokenAt: null }, `${label}: lifecycle chain`);
      assert.equal(r.lifecycle.state, r.lifecycle.events[r.lifecycle.events.length - 1]?.state, `${label}: state is the last event`);
      if (r.receipt.issued !== null) assert.deepEqual(r.receipt.verification, verifyReceipt(r.receipt.issued, r.record), `${label}: receipt`);
      else assert.equal(r.receipt.verification, null, `${label}: no verification without a receipt`);
      assert.equal(r.record.versions.wwep, WWEP_VERSION, label);
    }
  });

  test("replay results carry their boundary: REPRODUCED reproduces the digest, UNREPLAYABLE recomputes nothing, MISMATCH names sections", () => {
    for (const [label, r] of records()) {
      const rp = r.replay;
      if (rp.outcome === "REPRODUCED") {
        assert.equal(rp.recomputedDigest, r.record.digest, label);
        assert.deepEqual(rp.reasons, [], label);
        assert.deepEqual(rp.mismatches, [], label);
      } else if (rp.outcome === "UNREPLAYABLE") {
        assert.equal(rp.recomputedDigest, null, `${label}: nothing recomputed`);
        assert.deepEqual(rp.mismatches, [], label);
        assert.ok(rp.reasons.length >= 1 && rp.reasons.every((x) => UNREPLAYABLE_REASONS.includes(x)), `${label}: ${rp.reasons.join(",")}`);
      } else {
        assert.equal(rp.outcome, "MISMATCH", label);
        assert.ok(rp.reasons.includes("DIGEST_MISMATCH") && rp.mismatches.length >= 1, label);
        assert.notEqual(rp.recomputedDigest, r.record.digest, label);
      }
    }
  });

  test("lineage records are bound by digest and the semantic diff is present exactly on successors", () => {
    for (const [name, f] of all()) {
      const ids = f.records.map((r) => r.id);
      for (const r of f.records) {
        assert.deepEqual(r.lineage.chain, ids, `${name}: every record sees the whole chain, root first`);
        if (r.supersedes !== null) {
          const pred = f.records.find((x) => x.id === r.supersedes!.id);
          assert.ok(pred, `${name}: predecessor is in the lineage`);
          assert.equal(r.supersedes.digest, pred.record.digest, `${name}: predecessor bound by digest`);
          assert.equal(pred.supersededBy?.id, r.id, `${name}: back-link`);
          assert.equal(pred.supersededBy?.kind, r.supersedes.kind);
          assert.ok(r.diff !== null && r.diff.changed, `${name}: successor carries the diff`);
          assert.ok(["CORRECTED", "SUPERSEDED"].includes(pred.lifecycle.state), `${name}: predecessor lifecycle`);
          assert.ok(pred.lifecycle.events.some((e) => e.ref?.id === r.id), `${name}: the predecessor's event names the successor`);
        } else {
          assert.equal(r.diff, null, `${name}: no predecessor, no diff`);
        }
      }
    }
  });

  test("the brief's scenarios are all present, with the engine-produced outcomes that make them what they are", () => {
    const cs = focus("current-supported");
    assert.equal(focalClaim(cs).supportState, "SUPPORTED");
    assert.ok(focalClaim(cs).limitations.includes("NOT_FINALIZED"));
    assert.equal(cs.lifecycle.state, "DISCLOSED");

    const ca = focus("conflicting-assessors");
    assert.equal(ca.record.assessments.length, 3);
    assert.equal(new Set(ca.record.assessments.map((a) => a.assessment)).size, 3, "three different conclusions, all kept");
    assert.ok(ca.record.assessments.some((a) => a.assessorRole === "INDEPENDENT_REVIEWER" && a.assessment === "CONFLICTING"));

    const corrected = FIXTURES["corrected"]!;
    assert.equal(corrected.records.length, 2);
    assert.equal(corrected.records[0]!.lifecycle.state, "CORRECTED");
    assert.equal(corrected.records[1]!.supersedes?.kind, "CORRECTION");
    const reason = corrected.records[1]!.supersedes?.reason;
    assert.ok(typeof reason === "string" && reason.length > 0, "a correction states its reason");
    assert.equal(focalClaim(corrected.records[0]!).supportState, "PARTIAL");
    assert.equal(focalClaim(corrected.records[1]!).supportState, "ESTABLISHED");
    const support = corrected.records[1]!.diff!.changes.find((c) => c.path === "claims[a-identity].supportState");
    assert.deepEqual(support, { category: "claims", path: "claims[a-identity].supportState", before: "PARTIAL", after: "ESTABLISHED", reason: "STRONGER" });

    const superseded = FIXTURES["superseded"]!;
    assert.equal(superseded.records[0]!.lifecycle.state, "SUPERSEDED");
    assert.equal(superseded.records[1]!.supersedes?.kind, "SUPERSESSION");
    assert.ok(superseded.records[1]!.diff!.changes.some((c) => c.category === "snapshot"));

    const withdrawn = focus("withdrawn");
    assert.equal(withdrawn.lifecycle.state, "WITHDRAWN");
    assert.match(withdrawn.lifecycle.events[withdrawn.lifecycle.events.length - 1]!.reason ?? "", /withdrawn/i);
    assert.equal(withdrawn.receipt.verification?.matches, true, "a withdrawn record's receipt still proves its bytes");

    const unreplayable = focus("unreplayable");
    assert.deepEqual(unreplayable.replay, { outcome: "UNREPLAYABLE", reasons: ["MISSING_EVIDENCE"], recomputedDigest: null, mismatches: [] });
    assert.equal(unreplayable.receipt.issued, null);
    assert.equal(unreplayable.lifecycle.state, "COMMITTED");

    const valid = focus("receipt-valid");
    assert.deepEqual(valid.receipt.verification, { matches: true, reasons: [] });
    assert.equal(valid.replay.outcome, "REPRODUCED");
    assert.ok(valid.record.evidence.items.some((i) => i.kind === "DERIVATION"), "a derivation sits in its provenance");
    assert.ok(Object.keys(valid.record.ruleVersions).length >= 1);

    const mismatch = focus("receipt-mismatch");
    assert.equal(mismatch.digest.matches, false);
    assert.deepEqual(mismatch.validation.findings, [{ code: "DIGEST_MISMATCH", path: "digest" }]);
    assert.deepEqual(mismatch.receipt.verification, { matches: false, reasons: ["RECORD_INVALID"] });
    assert.equal(mismatch.replay.outcome, "UNREPLAYABLE");
    assert.notEqual(mismatch.digest.computedDigest, mismatch.record.digest);

    const replay = focus("replay-mismatch");
    assert.deepEqual(replay.receipt.verification, { matches: true, reasons: [] }, "bytes match");
    assert.equal(replay.replay.outcome, "MISMATCH");
    assert.deepEqual(replay.replay.mismatches, ["claims"]);

    const conflict = focus("conflicting-evidence");
    assert.equal(focalClaim(conflict).supportState, "CONFLICTING");
    assert.ok(conflict.record.conflicts.length >= 1 && focalClaim(conflict).conflictsWith.length >= 1);
  });

  test("nothing in the fixtures describes a real wallet, and no timestamp is a clock reading", () => {
    const text = JSON.stringify(FIXTURES);
    const registry = new Set(["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]);
    const synthetic = (a: string): boolean => a === "0x1234567890123456789012345678901234567890" || /^0x(.)\1{39}$/.test(a);
    for (const m of text.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) assert.ok(registry.has(m[0].toLowerCase()) || synthetic(m[0]), m[0]);
    for (const m of text.matchAll(/"(\d{4})-\d{2}-\d{2}T/g)) assert.equal(m[1], "2026", "literal fixture instants only");
  });
});
