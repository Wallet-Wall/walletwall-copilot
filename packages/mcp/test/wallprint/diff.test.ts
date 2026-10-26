import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { diffWallPrints, type DiffChange } from "../../src/wallprint/diff.ts";
import { buildWallPrintSnapshot, wallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { DIFF_CATEGORIES } from "../../src/wallprint/vocabulary.ts";
import { replaceObservation } from "../support/builders.ts";
import { LATER_SNAPSHOT_AT, baseInput, clone, golden, issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * The semantic diff answers the future UI's question "what changed, and why?" in categories, never as a text diff.
 * It carries record data only (states, codes, digests, ids, versions, attributed assessment codes); observation
 * payloads are not in the record and therefore cannot appear in a diff.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const byCategory = (changes: readonly DiffChange[], category: string): DiffChange[] => changes.filter((c) => c.category === category);

function forged(record: WallPrintRecord, patch: (payload: ReturnType<typeof wallPrintPayload>) => void): WallPrintRecord {
  const payload = structuredClone(wallPrintPayload(record));
  patch(payload);
  return { ...payload, digest: wallPrintDigest(payload) };
}

describe("WallPrint semantic diff", () => {
  test("a record diffed against itself has no changes", () => {
    const a = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(diffWallPrints(a, a), { changed: false, changes: [] });
    assert.deepEqual(diffWallPrints(a, buildWallPrintSnapshot(baseInput())), { changed: false, changes: [] });
  });

  test("an evidence change is categorised under evidence and under the claims it moved, with digests, never payloads", () => {
    const a = buildWallPrintSnapshot(baseInput());
    // The observation now disagrees with the asserted balance: the assertion itself is unchanged, its evaluation is not.
    const b = buildWallPrintSnapshot(baseInput({ bundle: replaceObservation(golden(), "obs-balance", { payload: { balanceAtomic: "1500001", decimals: "6" } }) }));
    const d = diffWallPrints(a, b);
    assert.equal(d.changed, true);
    const evidence = byCategory(d.changes, "evidence");
    assert.ok(evidence.some((c) => c.path === "evidence.bundleDigest" && c.before === a.evidence.bundleDigest && c.after === b.evidence.bundleDigest));
    assert.ok(evidence.some((c) => c.path === "evidence.items[OBSERVATION:obs-balance]" && c.before !== null && c.after !== null && c.before !== c.after));
    for (const c of evidence) for (const v of [c.before, c.after]) assert.ok(v === null || HEX64.test(v), `evidence changes carry digests only: ${String(v)}`);
    const claims = byCategory(d.changes, "claims");
    const support = claims.find((c) => c.path === "claims[a-balance].supportState");
    assert.deepEqual(support, { category: "claims", path: "claims[a-balance].supportState", before: "ESTABLISHED", after: "NOT_ESTABLISHED", reason: "WEAKER" });
    const lims = claims.find((c) => c.path === "claims[a-balance].limitations");
    assert.ok(lims?.after?.includes("VALUE_MISMATCH"));
    assert.ok(!claims.some((c) => c.path === "claims[a-balance].value"), "the assertion's own value did not change");
    assert.ok(!claims.some((c) => c.path.startsWith("claims[a-identity]")), "an untouched claim does not appear");
    assert.ok(byCategory(d.changes, "assessments").length === 0, "the WalletWall assessment of the focal identity is unchanged");
    assert.ok(!JSON.stringify(d).includes("1500001"), "the observation payload is not in the record and cannot leak into the diff");
  });

  test("a support-state change is categorised under claims with a strength direction, and the snapshot change under snapshot", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ evaluatedAt: LATER_SNAPSHOT_AT }));
    const d = diffWallPrints(a, b);
    const price = d.changes.find((c) => c.path === "claims[a-price].supportState");
    assert.ok(price, JSON.stringify(d.changes.map((c) => c.path)));
    assert.equal(price.category, "claims");
    assert.equal(price.before, "SUPPORTED");
    assert.equal(price.after, "STALE");
    assert.equal(price.reason, "WEAKER");
    assert.ok(d.changes.some((c) => c.category === "snapshot" && c.path === "snapshotAt" && c.before === a.snapshotAt && c.after === b.snapshotAt));
    const reverse = diffWallPrints(b, a).changes.find((c) => c.path === "claims[a-price].supportState");
    assert.equal(reverse?.reason, "STRONGER");
  });

  test("an assessment change is categorised under assessments, attributed to the assessor and policy", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ assessment: "NOT_CONFIRMED" }), reviewerAssessment()] }));
    const d = diffWallPrints(a, b);
    const change = d.changes.find((c) => c.path === "assessments[issuer:circle|issuer-attestation].assessment");
    assert.ok(change);
    assert.equal(change.category, "assessments");
    assert.deepEqual([change.before, change.after], ["CONFIRMED", "NOT_CONFIRMED"]);
    assert.equal(byCategory(d.changes, "claims").length, 0);
    const removed = diffWallPrints(a, buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment()] })));
    assert.ok(removed.changes.some((c) => c.category === "assessments" && c.path === "assessments[issuer:circle|issuer-attestation]" && c.after === null));
  });

  test("a policy or rule version change is categorised under policyVersions / ruleVersions", () => {
    const a = buildWallPrintSnapshot(baseInput());
    // A record committed under other policies: the policies version changes everywhere it is recorded (a valid record keeps them consistent).
    const b = forged(a, (p) => {
      p.versions.policies = "0.2.0-draft";
      for (const k of Object.keys(p.policyVersions)) p.policyVersions[k] = "0.2.0-draft";
      p.assessments.find((x) => x.assessorRole === "WALLETWALL")!.policyVersion = "0.2.0-draft";
    });
    const d = diffWallPrints(a, b);
    assert.ok(byCategory(d.changes, "policyVersions").some((c) => c.path === "policyVersions[wwap/asset-identity/0.1]" && c.before === "0.1.0-draft" && c.after === "0.2.0-draft"));
    assert.equal(byCategory(d.changes, "policyVersions").length, 3);
    assert.ok(byCategory(d.changes, "versions").some((c) => c.path === "versions.policies"));
    const c = forged(a, (p) => {
      p.ruleVersions["wwdr.usd-value"] = "0.1.0-draft";
    });
    assert.deepEqual(byCategory(diffWallPrints(a, c).changes, "ruleVersions"), [{ category: "ruleVersions", path: "ruleVersions[wwdr.usd-value]", before: null, after: "0.1.0-draft" }]);
  });

  test("two committed records with different bytes are never reported identical: the record digest is always a change", () => {
    const a = buildWallPrintSnapshot(baseInput({ id: "wp-a" }));
    const correction = buildWallPrintSnapshot(baseInput({ id: "wp-b", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: a.id, digest: a.digest, kind: "CORRECTION", reason: "Recounted." } }));
    const supersession = buildWallPrintSnapshot(baseInput({ id: "wp-b", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: a.id, digest: a.digest, kind: "SUPERSESSION", reason: "Recounted." } }));
    const d = diffWallPrints(correction, supersession);
    assert.equal(d.changed, true);
    assert.deepEqual(byCategory(d.changes, "record"), [{ category: "record", path: "digest", before: correction.digest, after: supersession.digest }]);
    assert.deepEqual(byCategory(d.changes, "lifecycle"), [{ category: "lifecycle", path: "supersedes.kind", before: "CORRECTION", after: "SUPERSESSION" }]);
  });

  test("a limitation change is categorised per code", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ evaluatedAt: LATER_SNAPSHOT_AT }));
    const lims = byCategory(diffWallPrints(a, b).changes, "limitations");
    assert.ok(lims.some((c) => c.path === "limitations[STALE_EVIDENCE]" && c.before === null && c.after === "STALE_EVIDENCE"));
  });

  test("a correction or supersession is represented clearly under lifecycle, with its kind and reason", () => {
    const a = buildWallPrintSnapshot(baseInput({ id: "wp-a" }));
    const b = buildWallPrintSnapshot(baseInput({ id: "wp-b", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: a.id, digest: a.digest, kind: "CORRECTION", reason: "Recounted after a provider pagination fix." } }));
    const lifecycle = byCategory(diffWallPrints(a, b).changes, "lifecycle");
    assert.deepEqual(lifecycle, [
      { category: "lifecycle", path: "supersedes", before: null, after: "wp-a", reason: "CORRECTION" },
      { category: "lifecycle", path: "supersedes.digest", before: null, after: a.digest },
      { category: "lifecycle", path: "supersedes.kind", before: null, after: "CORRECTION" },
      { category: "lifecycle", path: "supersedes.reason", before: null, after: "Recounted after a provider pagination fix." },
    ]);
    assert.ok(diffWallPrints(a, b).changes.some((c) => c.category === "subject" && c.path === "id" && c.before === "wp-a" && c.after === "wp-b"));
  });

  test("changes are ordered by category then path, every category is from the vocabulary, and the diff is deterministic and antisymmetric", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ evaluatedAt: LATER_SNAPSHOT_AT, assessments: [issuerAssessment({ assessment: "NOT_CONFIRMED" })] }));
    const d = diffWallPrints(a, b);
    assert.deepEqual(d, diffWallPrints(a, b));
    const order = d.changes.map((c) => `${DIFF_CATEGORIES.indexOf(c.category)}|${c.path}`);
    assert.deepEqual(order, [...order].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    for (const c of d.changes) assert.ok((DIFF_CATEGORIES as readonly string[]).includes(c.category));
    const back = diffWallPrints(b, a);
    assert.equal(back.changes.length, d.changes.length);
    for (const c of d.changes) assert.ok(back.changes.some((r) => r.path === c.path && r.before === c.after && r.after === c.before), c.path);
  });

  test("an invalid record cannot be diffed", () => {
    const a = buildWallPrintSnapshot(baseInput());
    assert.throws(() => diffWallPrints(a, { ...a, digest: "0".repeat(64) }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_RECORD");
    assert.throws(() => diffWallPrints({ ...a, verdict: "VERIFIED" }, a), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_RECORD");
  });

  test("conflict and violation changes are categorised", () => {
    const a = buildWallPrintSnapshot(baseInput({ assessments: [] }));
    const bundle = clone(golden());
    bundle.assertions.push({ ...bundle.assertions.find((x) => x.id === "a-price")!, id: "a-price-2", value: { priceUsd: "0.9" } });
    const b = buildWallPrintSnapshot(baseInput({ bundle, assessments: [] }));
    const d = diffWallPrints(a, b);
    assert.ok(byCategory(d.changes, "conflicts").some((c) => c.before === null && c.after !== null && c.after.includes("CONFLICT_DETECTED")));
    assert.ok(byCategory(d.changes, "claims").some((c) => c.path === "claims[a-price].supportState" && c.after === "CONFLICTING"));
    assert.ok(byCategory(d.changes, "claims").some((c) => c.path === "claims[a-price-2]" && c.before === null));
  });
});
