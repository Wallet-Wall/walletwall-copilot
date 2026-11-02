import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importExternalAssessments } from "../../src/wallprint/assessor-import.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord, wallPrintDigest, wallPrintPayload, type ExternalAssessmentInput, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { WALLPRINT_VERSIONS, type WallPrintVersion } from "../../src/wallprint/vocabulary.ts";
import { assessmentSet, prng } from "./admission-fuzz.ts";
import { baseInput, clone, golden, reviewerAssessment } from "./support.ts";

/**
 * Importer / native parity: for the same assessment, bundle, focal assertion and target WallPrint version, the import
 * boundary admits exactly what `buildWallPrintSnapshot` admits, with the same findings, and `validateWallPrintRecord`
 * (the third consumer of the one rule table) agrees about a record carrying those assessments. A seeded differential over
 * casing, separators, omitted separators, numeric suffixes, roles, policy ids and registry and engine authorities.
 */
const envelope = (a: ExternalAssessmentInput): string => JSON.stringify({ assessmentImportVersion: "0.1", externalAssessment: a });

type Result = { ok: true } | { ok: false; findings: string[] };

function native(assessments: ExternalAssessmentInput[], version: WallPrintVersion): Result {
  try {
    buildWallPrintSnapshot(baseInput({ assessments, wallprintVersion: version }));
    return { ok: true };
  } catch (e) {
    assert.ok(e instanceof WallPrintError, "only WallPrintErrors escape the builder");
    return { ok: false, findings: e.findings.map((f) => `${f.code}@${f.path}`) };
  }
}

function imported(assessments: ExternalAssessmentInput[], version: WallPrintVersion): Result {
  const r = importExternalAssessments(assessments.map(envelope), { bundle: clone(golden()), focalAssertionId: "a-identity", wallprintVersion: version });
  if (r.status === "IMPORTED") return { ok: true };
  return { ok: false, findings: r.findings.map((f) => `${f.code}@${f.path.replace(/^inputs\[(\d+)\]\.externalAssessment/, "assessments[$1]")}`) };
}

/** The same payload relabelled as another version and honestly re-digested. */
function relabelled(record: WallPrintRecord, version: WallPrintVersion): WallPrintRecord {
  const payload = { ...structuredClone(wallPrintPayload(record)), wallprintVersion: version };
  return { ...payload, digest: wallPrintDigest(payload) };
}

const TRIALS = 1200;

describe("native and imported assessments are admitted identically, per WallPrint version (seeded differential)", () => {
  const stats: Record<string, { admitted: number; refused: number }> = {};
  let versionsDisagree = 0;
  let validatorChecked = 0;

  for (const version of WALLPRINT_VERSIONS) {
    test(`WallPrint ${version}: ${TRIALS} sampled assessment sets, zero disagreements between the builder, the import boundary and the validator`, () => {
      const rand = prng(0xad4155 + Number(version.replace("0.", "")));
      const s = (stats[version] = { admitted: 0, refused: 0 });
      const other: WallPrintVersion = version === "0.1" ? "0.2" : "0.1";
      for (let i = 0; i < TRIALS; i++) {
        const set = assessmentSet(rand);
        const n = native(set, version);
        const m = imported(set, version);
        assert.deepEqual(m, n, `trial ${i} under ${version}: ${JSON.stringify(set.map((a) => [a.assessorRole, a.assessor, a.policy]))}`);
        if (n.ok) s.admitted++;
        else s.refused++;

        if (n.ok) {
          // The validator judges a record by the version it carries, with the builder's rule table: relabel and compare.
          const record = buildWallPrintSnapshot(baseInput({ assessments: set, wallprintVersion: version }));
          assert.equal(validateWallPrintRecord(record).ok, true);
          const there = relabelled(record, other);
          const builderOther = native(set, other).ok;
          assert.equal(validateWallPrintRecord(there).ok, builderOther, `trial ${i}: the validator and the builder disagree under ${other}`);
          validatorChecked++;
          if (!builderOther) versionsDisagree++;
        }
      }
      assert.ok(s.admitted > TRIALS * 0.05 && s.refused > TRIALS * 0.05, `the sample must exercise both outcomes: ${JSON.stringify(s)}`);
    });
  }

  test("the sample really reaches the spellings the versions decide differently, and the validator was exercised on them", () => {
    assert.ok(validatorChecked > 200, `${validatorChecked}`);
    assert.ok(versionsDisagree > 20, `${versionsDisagree} records admitted under one version and refused under the other`);
  });

  test("an imported set that is admitted is admitted by the builder under the same version, record and all", () => {
    const rand = prng(0x1357);
    let admitted = 0;
    for (const version of WALLPRINT_VERSIONS) {
      for (let i = 0; i < 300; i++) {
        const set = assessmentSet(rand);
        const r = importExternalAssessments(set.map(envelope), { bundle: clone(golden()), focalAssertionId: "a-identity", wallprintVersion: version });
        if (r.status !== "IMPORTED") continue;
        admitted++;
        const record = buildWallPrintSnapshot(baseInput({ assessments: [...r.assessments], wallprintVersion: version }));
        assert.equal(validateWallPrintRecord(record).ok, true);
        assert.deepEqual(record.assessments.filter((a) => a.assessorRole !== "WALLETWALL").map((a) => [a.assessor, a.policy]).sort(), set.map((a) => [a.assessor, a.policy]).sort(), "recorded exactly as stated");
      }
    }
    assert.ok(admitted > 30, `${admitted}`);
  });

  test("the same bytes, the same bundle and the same target version always give the same result; a different version may not", () => {
    const set = [reviewerAssessment({ assessor: "issuer-circle" })];
    const a = imported(set, "0.1");
    assert.deepEqual(imported(set, "0.1"), a);
    assert.deepEqual(a, { ok: true });
    assert.equal(imported(set, "0.2").ok, false);
    assert.deepEqual(imported(set, "0.2"), native(set, "0.2"));
  });
});
