import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evidenceDigest } from "../../src/canonical.ts";
import { WWEP_VERSION } from "../../src/schemas.ts";
import { buildWallPrintSnapshot, wallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { createEvidenceStore, isUnreplayableReason, replayWallPrint, type EvidenceStore } from "../../src/wallprint/replay.ts";
import { REPLAY_REASONS } from "../../src/wallprint/vocabulary.ts";
import { replaceObservation } from "../support/builders.ts";
import { baseInput, clone, golden, issuerAssessment, readinessWorld } from "./support.ts";

/**
 * Replay re-derives a historical WallPrint from the evidence it references and the versioned policies, rules and
 * registry it was committed under. It REPRODUCES, finds a MISMATCH, or is UNREPLAYABLE because a required historical
 * input is unavailable to this engine. UNREPLAYABLE != INCORRECT. Replay never substitutes present-day policy for
 * historical policy and never fills in missing evidence.
 */

/** A record that was "committed elsewhere": the payload re-digested after a change, so it validates but was not produced by this engine. */
function forged(record: WallPrintRecord, patch: (payload: ReturnType<typeof wallPrintPayload>) => void): WallPrintRecord {
  const payload = structuredClone(wallPrintPayload(record));
  patch(payload);
  return { ...payload, digest: wallPrintDigest(payload) };
}

const CONTENT_REASONS = new Set(REPLAY_REASONS.filter((r) => !isUnreplayableReason(r)));

describe("WallPrint replay", () => {
  test("the evidence store is keyed by the bundle's evidence digest and holds plain copies", () => {
    const store = createEvidenceStore();
    const digest = store.put(golden());
    assert.equal(digest, evidenceDigest(golden()));
    assert.equal(store.has(digest), true);
    assert.deepEqual(store.get(digest), golden());
    assert.equal(store.get("0".repeat(64)), undefined);
    assert.equal(store.size(), 1);
    assert.equal(store.put(golden()), digest, "idempotent for identical evidence");
    assert.equal(store.size(), 1);
  });

  test("exact replay REPRODUCES: same evidence, same versions, same external assessments give the same digest", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    const result = replayWallPrint(record, { evidence: store });
    assert.deepEqual(result, { outcome: "REPRODUCED", reasons: [], recomputedDigest: record.digest, mismatches: [] });
  });

  test("missing historical evidence is UNREPLAYABLE, nothing is recomputed, and the store is never written to", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    const result = replayWallPrint(record, { evidence: store });
    assert.equal(result.outcome, "UNREPLAYABLE");
    assert.deepEqual(result.reasons, ["MISSING_EVIDENCE"]);
    assert.equal(result.recomputedDigest, null);
    assert.deepEqual(result.mismatches, []);
    assert.equal(store.size(), 0, "replay never fills missing evidence");
  });

  test("a record committed under other policies or another registry is UNREPLAYABLE: present-day policy is never substituted", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    // A record committed under other policies keeps itself consistent: the policies version appears in versions, in every
    // policyVersions entry and on WalletWall's own assessment.
    const otherPolicies = forged(record, (p) => {
      p.versions.policiesDigest = "f".repeat(64);
      p.versions.policies = "0.0.9-draft";
      for (const k of Object.keys(p.policyVersions)) p.policyVersions[k] = "0.0.9-draft";
      p.assessments.find((a) => a.assessorRole === "WALLETWALL")!.policyVersion = "0.0.9-draft";
    });
    const r1 = replayWallPrint(otherPolicies, { evidence: store });
    assert.equal(r1.outcome, "UNREPLAYABLE");
    assert.deepEqual(r1.reasons, ["MISSING_POLICY_VERSION"]);
    assert.equal(r1.recomputedDigest, null, "no recomputation under present-day policy");

    const otherRegistry = forged(record, (p) => {
      p.versions.registryDigest = "e".repeat(64);
    });
    assert.deepEqual(replayWallPrint(otherRegistry, { evidence: store }).reasons, ["MISSING_REGISTRY_VERSION"]);

    const otherRules = forged(record, (p) => {
      p.versions.rules = "0.0.1";
    });
    const r3 = replayWallPrint(otherRules, { evidence: store });
    assert.equal(r3.outcome, "UNREPLAYABLE");
    assert.deepEqual(r3.reasons, ["MISSING_RULE_VERSION"]);

    const otherWwep = forged(record, (p) => {
      p.versions.wwep = "0.2";
    });
    assert.deepEqual(replayWallPrint(otherWwep, { evidence: store }).reasons, ["WWEP_VERSION_MISMATCH"]);
    assert.notEqual(record.versions.wwep, "0.2");
    assert.equal(record.versions.wwep, WWEP_VERSION);
  });

  test("UNREPLAYABLE is not INCORRECT: an unreplayable result carries no content-mismatch reason and no recomputed digest", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const result = replayWallPrint(forged(record, (p) => { p.versions.policiesDigest = "f".repeat(64); }), { evidence: createEvidenceStore() });
    assert.equal(result.outcome, "UNREPLAYABLE");
    assert.ok(result.reasons.length >= 2, "every unavailable input is reported, not just the first");
    assert.ok(result.reasons.every((r) => !CONTENT_REASONS.has(r)));
    assert.equal(result.recomputedDigest, null);
    assert.ok(!("correct" in result) && !("incorrect" in result) && !("valid" in result));
  });

  test("evidence returned under the record's digest but not matching it is UNREPLAYABLE (EVIDENCE_DIGEST_MISMATCH), never trusted", () => {
    const record = buildWallPrintSnapshot(baseInput());
    // A corrupted or lying store: the entry it returns for the key does not digest to the key.
    const corrupted: EvidenceStore = {
      put: () => "",
      get: () => replaceObservation(golden(), "obs-balance", { payload: { balanceAtomic: "1", decimals: "6" } }),
      has: () => true,
      size: () => 1,
    };
    const result = replayWallPrint(record, { evidence: corrupted });
    assert.equal(result.outcome, "UNREPLAYABLE");
    assert.deepEqual(result.reasons, ["EVIDENCE_DIGEST_MISMATCH"]);
    assert.equal(result.recomputedDigest, null);
  });

  test("a record whose claims do not match what the engine computes from its own evidence is a MISMATCH, categorised", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    // The record says the price is PARTIAL; the engine computes SUPPORTED.
    const tampered = forged(record, (p) => {
      const price = p.claims.find((c) => c.assertionId === "a-price")!;
      price.supportState = "PARTIAL";
    });
    const result = replayWallPrint(tampered, { evidence: store });
    assert.equal(result.outcome, "MISMATCH");
    assert.deepEqual(result.reasons, ["CLAIM_MISMATCH", "DIGEST_MISMATCH"]);
    assert.deepEqual(result.mismatches, ["claims"]);
    assert.equal(result.recomputedDigest, record.digest);
  });

  test("a WalletWall assessment that disagrees with the recomputed evidence state is an ASSESSMENT_MISMATCH", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    const tampered = forged(record, (p) => {
      p.claims.find((c) => c.assertionId === "a-identity")!.supportState = "SUPPORTED";
      p.assessments.find((a) => a.assessorRole === "WALLETWALL")!.assessment = "SUPPORTED";
    });
    const result = replayWallPrint(tampered, { evidence: store });
    assert.equal(result.outcome, "MISMATCH");
    assert.deepEqual(result.reasons, ["ASSESSMENT_MISMATCH", "CLAIM_MISMATCH", "DIGEST_MISMATCH"]);
    assert.deepEqual(result.mismatches, ["assessments", "claims"]);
  });

  test("external assessments are inputs, not recomputed: a record with them replays exactly", () => {
    const record = buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ assessment: "CERTIFIED", statement: "Certified by the issuer." })] }));
    const store = createEvidenceStore();
    store.put(golden());
    assert.equal(replayWallPrint(record, { evidence: store }).outcome, "REPRODUCED");
  });

  test("a changed input bundle gives a different record, and the old record replays only against its own evidence", () => {
    const before = buildWallPrintSnapshot(baseInput());
    const changed = replaceObservation(golden(), "obs-balance", { payload: { balanceAtomic: "1500001", decimals: "6" } });
    const after = buildWallPrintSnapshot(baseInput({ bundle: clone(changed) }));
    const store = createEvidenceStore();
    store.put(changed);
    assert.equal(replayWallPrint(after, { evidence: store }).outcome, "REPRODUCED");
    assert.deepEqual(replayWallPrint(before, { evidence: store }).reasons, ["MISSING_EVIDENCE"], "the old evidence is simply absent; nothing is substituted");
  });

  test("an invalid record is UNREPLAYABLE with RECORD_INVALID, not INCORRECT", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    const result = replayWallPrint({ ...record, digest: "0".repeat(64) }, { evidence: store });
    assert.equal(result.outcome, "UNREPLAYABLE");
    assert.deepEqual(result.reasons, ["RECORD_INVALID"]);
  });

  test("a rule version DECLARED by the evidence is evidence, not an engine input: such a record replays REPRODUCED", () => {
    const world = readinessWorld();
    world.derivations = world.derivations.map((d) => (d.id === "d-usd" ? { ...d, rulesVersion: "0.2.0" } : d));
    const record = buildWallPrintSnapshot(baseInput({ bundle: clone(world), focalAssertionId: "readiness-result" }));
    assert.equal(record.ruleVersions["wwdr.usd-value"], "0.2.0");
    assert.ok(record.claims.find((c) => c.assertionId === "a-usd")?.limitations.includes("RULES_VERSION_MISMATCH"));
    const store = createEvidenceStore();
    store.put(world);
    const result = replayWallPrint(record, { evidence: store });
    assert.equal(result.outcome, "REPRODUCED");
    assert.equal(result.recomputedDigest, record.digest);
  });

  test("a store that throws or returns garbage leaves the replay UNREPLAYABLE (MISSING_EVIDENCE), never an exception", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const throwing: EvidenceStore = { put: () => "", get: () => { throw new Error("backend down"); }, has: () => false, size: () => 0 };
    assert.deepEqual(replayWallPrint(record, { evidence: throwing }), { outcome: "UNREPLAYABLE", reasons: ["MISSING_EVIDENCE"], recomputedDigest: null, mismatches: [] });
    const garbage: EvidenceStore = { put: () => "", get: () => ({ a: 1 }) as never, has: () => true, size: () => 1 };
    assert.equal(replayWallPrint(record, { evidence: garbage }).outcome, "UNREPLAYABLE");
  });

  test("a MISMATCH names every differing top-level section, not only five", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    const tampered = forged(record, (p) => {
      p.ruleVersions = { "wwdr.usd-value": "0.9.0" };
    });
    const result = replayWallPrint(tampered, { evidence: store });
    assert.equal(result.outcome, "MISMATCH");
    assert.deepEqual(result.mismatches, ["ruleVersions"]);
    assert.deepEqual(result.reasons, ["DIGEST_MISMATCH", "RULE_VERSION_MISMATCH"]);
    for (const r of result.reasons) assert.ok(!isUnreplayableReason(r));
  });

  test("every replay reason is a vocabulary code and results are deterministic", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const store = createEvidenceStore();
    store.put(golden());
    const a = replayWallPrint(record, { evidence: store });
    const b = replayWallPrint(record, { evidence: store });
    assert.deepEqual(a, b);
    for (const r of a.reasons) assert.ok((REPLAY_REASONS as readonly string[]).includes(r));
  });
});
