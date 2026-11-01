import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { verifyReceipt, wallPrintReceipt } from "../../src/wallprint/receipt.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord, verifyWallPrintDigest, wallPrintDigest, type SnapshotInput } from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { ADMISSION_CASES, assessmentOf, findingKey, type AdmissionCase, type Outcome } from "./admission-cases.ts";
import { COMMIT_AT, baseInput, golden } from "./support.ts";

/**
 * Characterization of WallPrint 0.1's external-assessor admission, written BEFORE any admission rule changed and run
 * against the unmodified engine. It is the compatibility oracle for historical records: whatever a later contract
 * version decides, a record committed under 0.1 is judged by these rows.
 */
const outcomeOf = (c: AdmissionCase): Outcome => {
  try {
    const record = buildWallPrintSnapshot(baseInput({ assessments: [assessmentOf(c)] }));
    assert.equal(validateWallPrintRecord(record).ok, true, "a built record always validates");
    return "ADMIT";
  } catch (e) {
    assert.ok(e instanceof WallPrintError, "refusals are WallPrintErrors");
    assert.equal(e.code, "INVALID_RECORD");
    return e.findings.map(findingKey);
  }
};

describe("WallPrint 0.1 admission, characterized (unmodified engine)", () => {
  test("the table is not empty and its row ids are unique", () => {
    assert.ok(ADMISSION_CASES.length > 150);
    assert.equal(new Set(ADMISSION_CASES.map((c) => c.id)).size, ADMISSION_CASES.length);
  });

  test("the issue's reviewed examples are all rows of the table", () => {
    const have = new Set(ADMISSION_CASES.flatMap((c) => [c.assessor, c.policy]));
    for (const s of ["issuer-circle", "walletwallprint", "walletwall2", "canonical-chain-state", "walletwall-policy", "wwap2", "ww-ap/x", "wallet-wall", "wall.print", "firewall-print-shop"]) assert.ok(have.has(s), s);
  });

  for (const c of ADMISSION_CASES) {
    test(`${c.family}: ${c.role} ${JSON.stringify(c.assessor)} under ${JSON.stringify(c.policy)}: ${c.why}`, () => {
      assert.deepEqual(outcomeOf(c), c.v01);
    });
  }
});

interface Corpus {
  description: string;
  input: Omit<SnapshotInput, "bundle">;
  record: ReturnType<typeof buildWallPrintSnapshot>;
}
const corpus = JSON.parse(readFileSync(new URL("./fixtures/wallprint-0.1-admission-gaps.json", import.meta.url), "utf8")) as Corpus;

describe("the historical 0.1 corpus: a committed record whose assessors the 0.1 contract admitted", () => {
  test("it is valid, digest-intact and carries every gap spelling the characterization lists as admitted", () => {
    assert.equal(corpus.record.wallprintVersion, "0.1");
    assert.equal(validateWallPrintRecord(corpus.record).ok, true);
    assert.deepEqual(verifyWallPrintDigest(corpus.record), { hasDigest: true, matches: true, computedDigest: corpus.record.digest });
    const names = new Set(corpus.record.assessments.map((a) => a.assessor));
    for (const n of ["issuer-circle", "issuer_circle", "canonical-chain-state", "walletwallprint", "walletwall2", "firewall-print-shop"]) assert.ok(names.has(n), n);
    const policies = new Set(corpus.record.assessments.map((a) => a.policy));
    for (const p of ["walletwall-policy", "wwap2", "ww-ap/review"]) assert.ok(policies.has(p), p);
  });

  test("the engine still builds exactly these bytes from the stored input", () => {
    const rebuilt = buildWallPrintSnapshot({ ...corpus.input, bundle: golden() });
    assert.equal(canonicalize(rebuilt), canonicalize(corpus.record));
    assert.equal(rebuilt.digest, corpus.record.digest);
  });

  test("it replays, receipts, commits and stays intact", () => {
    const evidence = createEvidenceStore();
    evidence.put(golden());
    const replay = replayWallPrint(corpus.record, { evidence });
    assert.equal(replay.outcome, "REPRODUCED");
    assert.equal(replay.recomputedDigest, corpus.record.digest);
    assert.deepEqual(verifyReceipt(wallPrintReceipt(corpus.record), corpus.record), { matches: true, reasons: [] });
    const history = createWallPrintHistory();
    history.commit(corpus.record, { at: COMMIT_AT });
    assert.equal(history.get(corpus.record.id)?.digest, corpus.record.digest);
    assert.equal(wallPrintDigest(corpus.record), corpus.record.digest);
  });
});
