import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOES_NOT_ESTABLISH } from "../../src/readiness.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { RECEIPT_DOES_NOT_ESTABLISH, RECEIPT_ESTABLISHES, verifyReceipt, wallPrintReceipt } from "../../src/wallprint/receipt.ts";
import { buildWallPrintSnapshot } from "../../src/wallprint/record.ts";
import { baseInput, issuerAssessment } from "./support.ts";

/**
 * WallPrint is the disclosure record. A Receipt is proof that a disclosed canonical record matches its committed
 * bytes, and nothing more. receipt integrity != factual truth. No signature system exists in this lane; the receipt
 * exposes only the minimum a later Receipt lane needs: record id, canonicalization, digest algorithm, digest.
 */
describe("WallPrint receipt boundary", () => {
  test("a receipt carries exactly the integrity data: record id, canonicalization, digest algorithm, digest, bundle digest, versions", () => {
    const record = buildWallPrintSnapshot(baseInput({ wallprintVersion: "0.1" }));
    const receipt = wallPrintReceipt(record);
    assert.deepEqual(receipt, {
      wallprintVersion: "0.1",
      recordId: record.id,
      canonicalization: "RFC8785",
      digestAlgorithm: "SHA-256",
      digest: record.digest,
      bundleDigest: record.evidence.bundleDigest,
      versions: { wwep: record.versions.wwep, registry: record.versions.registry, policies: record.versions.policies, rules: record.versions.rules },
    });
    assert.ok(Object.isFrozen(receipt));
    for (const k of Object.keys(receipt)) assert.doesNotMatch(k, /true|truth|verified|valid|safe|certified|assurance|status/i);
  });

  test("a receipt verifies the record it was issued for and nothing else", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const receipt = wallPrintReceipt(record);
    assert.deepEqual(verifyReceipt(receipt, record), { matches: true, reasons: [] });
    const other = buildWallPrintSnapshot(baseInput({ id: "wp-other" }));
    assert.deepEqual(verifyReceipt(receipt, other), { matches: false, reasons: ["DIGEST_MISMATCH", "RECORD_ID_MISMATCH"] });
    assert.deepEqual(verifyReceipt(receipt, { ...record, snapshotAt: "2026-10-24T12:00:30Z" }), { matches: false, reasons: ["RECORD_INVALID"] });
    assert.deepEqual(verifyReceipt({ ...receipt, digest: "0".repeat(64) }, record), { matches: false, reasons: ["DIGEST_MISMATCH"] });
    assert.deepEqual(verifyReceipt({ ...receipt, digestAlgorithm: "SHA-512" }, record), { matches: false, reasons: ["RECEIPT_INVALID"] });
    assert.deepEqual(verifyReceipt({ ...receipt, extra: true }, record), { matches: false, reasons: ["RECEIPT_INVALID"] });
    assert.deepEqual(Object.keys(verifyReceipt(receipt, record)).sort(), ["matches", "reasons"]);
  });

  test("receipt integrity != factual truth: a record carrying an attributed CERTIFIED and a NOT_AVAILABLE review verifies exactly like any other", () => {
    const record = buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ assessment: "CERTIFIED", statement: "Certified by the issuer." })] }));
    assert.equal(verifyReceipt(wallPrintReceipt(record), record).matches, true);
    assert.equal(RECEIPT_ESTABLISHES, "The disclosed canonical record matches its committed bytes.");
    for (const phrase of ["factual truth", "solvency", "safety", "regulatory compliance", "issuer endorsement", "investment merit", ...DOES_NOT_ESTABLISH]) {
      assert.ok(RECEIPT_DOES_NOT_ESTABLISH.includes(phrase), phrase);
    }
    assert.ok(Object.isFrozen(RECEIPT_DOES_NOT_ESTABLISH));
  });

  test("a receipt cannot be issued for an invalid record", () => {
    const record = buildWallPrintSnapshot(baseInput());
    assert.throws(() => wallPrintReceipt({ ...record, digest: "0".repeat(64) }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_RECORD");
  });
});
