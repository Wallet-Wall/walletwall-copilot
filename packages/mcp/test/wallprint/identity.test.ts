import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateBundle, indexBundle } from "../../src/evaluate.ts";
import { checkInvariants } from "../../src/invariants.ts";
import type { Bundle } from "../../src/schemas.ts";
import { importExternalAssessments } from "../../src/wallprint/assessor-import.ts";
import { sameSubjectIdentity, subjectIdentity, subjectIdentityKeys, supersessionIdentity } from "../../src/wallprint/identity.ts";
import { buildWallPrintSnapshot, externalAssessmentAdmissionFindings, wallPrintDigest, wallPrintPayload } from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { WALLPRINT_VERSIONS } from "../../src/wallprint/vocabulary.ts";
import { EVALUATED_AT, OBSERVED_AT, USDC, balanceAssertion, balanceObservation, clone, golden, identityAssertion, withUsdValue } from "../support/builders.ts";

/**
 * WallPrint subject identity is computed in exactly one place (src/wallprint/identity.ts) and compares the exact subject
 * strings, because a record commits to the spelling it holds. The evidence engine is a different seam: it compares
 * address-like keys case-insensitively everywhere (src/subject.ts). Normalising case in WallPrint is a later, explicit
 * semantic decision and must be made here and nowhere else.
 */
const UPPER_USDC = USDC.toUpperCase().replace("0X", "0x");

describe("WallPrint subject identity: one module, exact strings, no silent case change", () => {
  test("the identity key is the policy's subject keys in canonical form, independent of insertion order", () => {
    const a = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC });
    const b = subjectIdentity("ASSET_IDENTITY", { address: USDC, chainId: "1" });
    assert.equal(a, b);
    assert.equal(a, '{"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","chainId":"1"}');
    assert.deepEqual(subjectIdentityKeys("ASSET_IDENTITY"), ["chainId", "address"]);
  });

  test("keys outside the policy's subject keys do not change the identity", () => {
    const a = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC });
    const b = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC, note: "ignored" });
    assert.equal(a, b);
  });

  test("a subject missing a required key has no identity (null), never a partial one", () => {
    assert.equal(subjectIdentity("ASSET_IDENTITY", { chainId: "1" }), null);
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1" }, { chainId: "1" }), false);
  });

  test("REGRESSION (address case): two subjects differing only in hex case are DIFFERENT identities today", () => {
    assert.notEqual(subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }), subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: UPPER_USDC }));
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }, { chainId: "1", address: UPPER_USDC }), false);
  });

  test("the seams differ on purpose: the engine groups case-variant assertions as a conflict, WallPrint identity keeps them apart", () => {
    const b = clone(golden());
    // Same claim, same temporality, same chain; the address differs only by case; the values disagree.
    b.assertions.push(identityAssertion({ id: "a-identity-upper", subject: { chainId: "1", address: UPPER_USDC }, value: { symbol: "USDX", decimals: "6", issuerAuthorityId: "issuer:circle" }, observationIds: ["obs-identity"] }));
    const ev = evaluateBundle(b, EVALUATED_AT);
    const lower = ev.assertions.find((e) => e.assertionId === "a-identity");
    const upper = ev.assertions.find((e) => e.assertionId === "a-identity-upper");
    assert.ok(lower && upper);
    assert.deepEqual(lower.conflictsWith, ["a-identity-upper"], "the engine compares addresses case-insensitively");
    assert.deepEqual(upper.conflictsWith, ["a-identity"]);
    assert.equal(upper.supportState, "CONFLICTING");
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }, { chainId: "1", address: UPPER_USDC }), false);
  });

  test("the seams differ on purpose: the engine accepts a supersession across a case difference, WallPrint's supersession identity stays exact", () => {
    const b = clone(golden());
    b.assertions.push(identityAssertion({ id: "a-identity-upper", subject: { chainId: "1", address: UPPER_USDC }, assertedAt: EVALUATED_AT }));
    b.supersessions = [{ id: "s-1", supersededAssertionId: "a-identity", supersedingAssertionId: "a-identity-upper", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
    const ev = evaluateBundle(b, EVALUATED_AT);
    const violations = checkInvariants(b, ev);
    assert.ok(!violations.some((v) => v.code === "SUPERSESSION_CLAIM_IDENTITY_MISMATCH"), JSON.stringify(violations));
    assert.notEqual(supersessionIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }), supersessionIdentity("ASSET_IDENTITY", { chainId: "1", address: UPPER_USDC }));
  });

  test("REGRESSION (address case): observation-to-assertion matching folds case", () => {
    const b = clone(golden());
    b.assertions = b.assertions.map((a) => (a.id === "a-identity" ? { ...a, subject: { chainId: "1", address: UPPER_USDC } } : a));
    const ev = evaluateBundle(b, EVALUATED_AT);
    const e = ev.assertions.find((x) => x.assertionId === "a-identity");
    assert.ok(e);
    assert.ok(!e.limitations.includes("SUBJECT_MISMATCH"), "the observation still supports the assertion despite the case difference");
    assert.equal(OBSERVED_AT < EVALUATED_AT, true);
  });
});

describe("WallPrint admission does not move with the evidence engine's refusal of a reused id", () => {
  /**
   * The engine takes a reused id out of its evidence index. WallPrint's versioned admission rules read the plain
   * index, because a correction to evaluation must not change what a historical version admits: unique ids remain the
   * builder's precondition (spec/WALLPRINT.md), so the importer accepts this context and the builder refuses the bundle.
   */
  const reused = () => {
    const b = clone(golden());
    b.assertions.push(balanceAssertion({ value: { balanceAtomic: "1", decimals: "6" } }));
    return b;
  };
  const envelope = (evidenceRefs: string[]): string =>
    JSON.stringify({ assessmentImportVersion: "0.1", externalAssessment: { assessor: "acme-labs", assessorRole: "INDEPENDENT_REVIEWER", assessment: "REVIEWED", policy: "acme/review-policy", policyVersion: "1", assessedAt: EVALUATED_AT, evidenceRefs } });

  for (const wallprintVersion of WALLPRINT_VERSIONS) {
    test(`the importer still accepts a reused id as the focal assertion and as an evidence reference (${wallprintVersion})`, () => {
      assert.equal(importExternalAssessments([], { bundle: reused(), focalAssertionId: "a-balance", wallprintVersion }).status, "IMPORTED");
      assert.equal(importExternalAssessments([envelope(["obs-balance"])], { bundle: reused(), focalAssertionId: "a-balance", wallprintVersion }).status, "IMPORTED");
      assert.equal(importExternalAssessments([envelope(["a-balance"])], { bundle: reused(), focalAssertionId: "a-identity", wallprintVersion }).status, "IMPORTED");
    });

    test(`the admission rules find nothing new in a reused id (${wallprintVersion})`, () => {
      const assessment = { assessor: "acme-labs", assessorRole: "INDEPENDENT_REVIEWER", assessment: "REVIEWED", policy: "acme/review-policy", policyVersion: "1", assessedAt: EVALUATED_AT, evidenceRefs: ["a-balance"] } as const;
      assert.deepEqual(externalAssessmentAdmissionFindings([{ ...assessment, evidenceRefs: [...assessment.evidenceRefs] }], reused(), "a-identity", wallprintVersion), []);
      assert.deepEqual(externalAssessmentAdmissionFindings([], reused(), "a-balance", wallprintVersion), []);
    });
  }

  test("the builder still refuses the bundle for the reason it always has: the ids in its evidence items are not unique", () => {
    for (const focalAssertionId of ["a-balance", "a-identity"]) {
      assert.throws(
        () => buildWallPrintSnapshot({ id: "rec-reused", bundle: reused(), evaluatedAt: EVALUATED_AT, focalAssertionId }),
        (e: unknown) => {
          const findings = (e as { findings?: { code: string; path: string }[] }).findings ?? [];
          assert.ok(findings.some((f) => f.code === "NOT_CANONICAL_ORDER" && f.path === "evidence.items"), JSON.stringify(findings));
          assert.ok(!findings.some((f) => f.code === "UNKNOWN_FOCAL_ASSERTION"), JSON.stringify(findings));
          return true;
        },
        focalAssertionId,
      );
    }
  });

  // The same boundary for the other three id kinds: the engine refuses them, and the plain index WallPrint reads still holds their first record.
  const REUSED_OTHER_KINDS: readonly (readonly [string, string, () => Bundle])[] = [
    ["source", "src-chain", () => ({ ...clone(golden()), sources: [{ id: "src-chain", kind: "PROVIDER_ENDPOINT" as const }, ...golden().sources] })],
    ["observation", "obs-balance", () => ({ ...clone(golden()), observations: [balanceObservation({ payload: { balanceAtomic: "1", decimals: "6" } }), ...golden().observations] })],
    ["derivation", "d-usd", () => {
      const b = withUsdValue(golden());
      return { ...b, derivations: [{ id: "d-usd", ruleId: "wwdr.usd-value", rulesVersion: "0.1.0-draft", inputAssertionIds: ["a-balance"], outputAssertionId: "someone-else" }, ...b.derivations] };
    }],
  ];

  for (const [kind, id, bundle] of REUSED_OTHER_KINDS) {
    for (const wallprintVersion of WALLPRINT_VERSIONS) {
      test(`the importer still accepts a reused ${kind} id as an evidence reference (${wallprintVersion})`, () => {
        assert.equal(importExternalAssessments([envelope([id])], { bundle: bundle(), focalAssertionId: "a-balance", wallprintVersion }).status, "IMPORTED");
      });

      test(`the admission rules find nothing new in a reused ${kind} id (${wallprintVersion})`, () => {
        const assessment = { assessor: "acme-labs", assessorRole: "INDEPENDENT_REVIEWER", assessment: "REVIEWED", policy: "acme/review-policy", policyVersion: "1", assessedAt: EVALUATED_AT, evidenceRefs: [id] } as const;
        assert.deepEqual(externalAssessmentAdmissionFindings([{ ...assessment, evidenceRefs: [...assessment.evidenceRefs] }], bundle(), "a-balance", wallprintVersion), []);
      });
    }

    test(`the plain index keeps the first record of a reused ${kind} id: what admission reads has not moved`, () => {
      const b = bundle();
      const { sources, observations, derivations, duplicateIds } = indexBundle(b);
      const table = { source: sources, observation: observations, derivation: derivations }[kind] as Map<string, { id: string }>;
      const list = { source: b.sources, observation: b.observations, derivation: b.derivations }[kind] as { id: string }[];
      assert.equal(table.get(id), list.find((r) => r.id === id));
      assert.deepEqual(duplicateIds, [{ invariant: "INV-00", code: `DUPLICATE_${kind.toUpperCase()}_ID`, assertionId: null }]);
    });

    test(`a record that names a bundle with a reused ${kind} id cannot be replayed: the rebuild is refused, not a mismatch`, () => {
      const evidence = createEvidenceStore();
      const bundleDigest = evidence.put(bundle());
      const payload = structuredClone(wallPrintPayload(buildWallPrintSnapshot({ id: "rec-honest", bundle: golden(), evaluatedAt: EVALUATED_AT, focalAssertionId: "a-balance" })));
      payload.evidence = { ...payload.evidence, bundleDigest };
      assert.deepEqual(replayWallPrint({ ...payload, digest: wallPrintDigest(payload) }, { evidence }), { outcome: "UNREPLAYABLE", reasons: ["REBUILD_REFUSED"], recomputedDigest: null, mismatches: [] });
    });

    test(`the builder still refuses a reused ${kind} id for the reason it always has: the ids in its evidence items are not unique`, () => {
      assert.throws(
        () => buildWallPrintSnapshot({ id: "rec-reused", bundle: bundle(), evaluatedAt: EVALUATED_AT, focalAssertionId: "a-balance" }),
        (e: unknown) => {
          const findings = (e as { findings?: { code: string; path: string }[] }).findings ?? [];
          assert.ok(findings.some((f) => f.code === "NOT_CANONICAL_ORDER" && f.path === "evidence.items"), JSON.stringify(findings));
          assert.ok(!findings.some((f) => f.code === "UNKNOWN_FOCAL_ASSERTION"), JSON.stringify(findings));
          return true;
        },
      );
    });
  }
});
