import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { LIMITS } from "../../src/schemas.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord, wallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { WALLPRINT_INVARIANTS, WALLPRINT_PRINCIPLE } from "../../src/wallprint/vocabulary.ts";
import { priceObservation, replaceAssertion } from "../support/builders.ts";
import { COMMIT_AT, baseInput, clone, golden, issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * Adversarial review follow-ups (brief section 16). Each test reproduces an attack or ambiguity and pins the rule that
 * closes it, or pins an inherited WWEP behaviour so nobody is surprised by it later.
 */

function rejected(input: unknown, code: string, pathPart?: string): void {
  assert.throws(
    () => buildWallPrintSnapshot(input as never),
    (e: unknown) => {
      assert.ok(e instanceof WallPrintError);
      const hit = e.findings.find((f) => f.code === code && (pathPart === undefined || f.path.includes(pathPart)));
      assert.ok(hit, `expected ${code}${pathPart ? ` at ${pathPart}` : ""}; got ${JSON.stringify(e.findings)}`);
      return true;
    },
  );
}

function forged(record: WallPrintRecord, patch: (payload: ReturnType<typeof wallPrintPayload>) => void): WallPrintRecord {
  const payload = structuredClone(wallPrintPayload(record));
  patch(payload);
  return { ...payload, digest: wallPrintDigest(payload) };
}

const walkNumbers = (v: unknown): number => {
  if (typeof v === "number") return 1;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + walkNumbers(x), 0);
  if (v !== null && typeof v === "object") return Object.values(v as Record<string, unknown>).reduce<number>((n, x) => n + walkNumbers(x), 0);
  return 0;
};

describe("WallPrint hardening", () => {
  test("canonicalization ambiguity: a record holds no JSON number anywhere, so RFC 8785 number formatting never matters", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.equal(walkNumbers(r), 0);
    assert.equal(canonicalize(r), canonicalize(JSON.parse(JSON.stringify(r))));
  });

  test("timestamp ambiguity (inherited): two WWEP spellings of one evaluation instant are two records; lifecycle times accept one spelling only", () => {
    const a = buildWallPrintSnapshot(baseInput({ evaluatedAt: "2026-10-23T12:00:30Z" }));
    const b = buildWallPrintSnapshot(baseInput({ evaluatedAt: "2026-10-23T12:00:30.000Z" }));
    assert.notEqual(a.digest, b.digest, "WWEP ISO_RE allows both spellings; WallPrint records the string as evaluated");
    const h = createWallPrintHistory();
    assert.throws(() => h.commit(a, { at: "2026-10-23T12:10:00Z" }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_INPUT");
    h.commit(a, { at: COMMIT_AT });
  });

  test("id collisions: record ids are lower case so case variants cannot coexist; the ledger refuses a reused id", () => {
    rejected(baseInput({ id: "wp-A" }), "INVALID_ID", "id");
    const h = createWallPrintHistory();
    h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-same" })), { at: COMMIT_AT });
    assert.throws(() => h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-same" })), { at: COMMIT_AT }), (e: unknown) => e instanceof WallPrintError && e.code === "DUPLICATE_RECORD_ID");
  });

  test("orphan references: a claim, assessment or conflict that names an id the record does not hold is refused", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const orphanConflict = forged(r, (p) => {
      p.claims[0]!.conflictsWith = ["a-nobody"];
    });
    assert.ok(!validateWallPrintRecord(orphanConflict).ok);
    const missingItem = forged(r, (p) => {
      p.evidence.items = p.evidence.items.filter((i) => !(i.kind === "ASSERTION" && i.id === "a-identity"));
    });
    const v = validateWallPrintRecord(missingItem);
    assert.ok(!v.ok && v.findings.some((f) => f.code === "UNKNOWN_REFERENCE"));
    rejected(baseInput({ assessments: [issuerAssessment({ evidenceRefs: ["obs-nobody"] })] }), "UNKNOWN_EVIDENCE_REFERENCE");
  });

  test("policy-version omission: every policy a claim used must be present in policyVersions, and vice versa", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const missing = forged(r, (p) => {
      delete p.policyVersions["wwap/token-usd-price/0.1"];
    });
    const v = validateWallPrintRecord(missing);
    assert.ok(!v.ok && v.findings.some((f) => f.code === "POLICY_VERSIONS_MISMATCH"));
    const extra = forged(r, (p) => {
      p.policyVersions["wwap/other/0.1"] = "0.1.0-draft";
    });
    assert.ok(!validateWallPrintRecord(extra).ok);
  });

  test("assessor spoofing: free-form roles, WalletWall look-alikes and WalletWall policy namespaces are refused", () => {
    rejected(baseInput({ assessments: [{ ...issuerAssessment(), assessorRole: "AUDITOR" as never }] }), "INVALID_ENUM", "assessorRole");
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "wallet.wall" })] }), "ASSESSOR_IDENTITY_RESERVED");
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "wall-print-desk" })] }), "ASSESSOR_IDENTITY_RESERVED");
    rejected(baseInput({ assessments: [issuerAssessment({ policy: "wwap/issuer-attestation" })] }), "RESERVED_POLICY_NAMESPACE", "policy");
    rejected(baseInput({ assessments: [reviewerAssessment({ policy: "wwvr.review" })] }), "RESERVED_POLICY_NAMESPACE", "policy");
    const r = buildWallPrintSnapshot(baseInput());
    const spoofed = forged(r, (p) => {
      p.assessments.find((a) => a.assessorRole === "WALLETWALL")!.assessor = "issuer:circle";
    });
    assert.ok(!validateWallPrintRecord(spoofed).ok);
  });

  test("authority escalation: a declared ESTABLISHED never becomes the record's state; the engine's state and its INV-00 violation are recorded", () => {
    const b = replaceAssertion(golden(), "a-price", { declared: { supportState: "ESTABLISHED" } });
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, focalAssertionId: "a-price", assessments: [] }));
    assert.equal(r.claims.find((c) => c.assertionId === "a-price")?.supportState, "SUPPORTED");
    assert.equal(r.assessments[0]?.assessment, "SUPPORTED");
    assert.ok(r.violations.some((v) => v.invariant === "INV-00" && v.code === "DECLARED_SUPPORT_EXCEEDS_COMPUTED"));
  });

  test("duplicate corroboration: two observations from one source collapse to one independence group in the record", () => {
    const b = clone(golden());
    b.observations = b.observations.map((o) => (o.id === "obs-price-b" ? priceObservation("obs-price-b", "src-prov-a") : o));
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    const price = r.claims.find((c) => c.assertionId === "a-price");
    assert.equal(price?.independentCorroboration, "1");
    assert.ok(price?.limitations.includes("DUPLICATE_EVIDENCE_COLLAPSED"));
    assert.equal(price?.supportState, "PARTIAL");
  });

  test("unbounded records: WWEP bundle limits and the external-assessment cap are enforced before any evaluation", () => {
    const b = clone(golden());
    for (let i = 0; i < LIMITS.assertions; i++) b.assertions.push({ ...b.assertions[2]!, id: `a-bulk-${i}` });
    rejected(baseInput({ bundle: b }), "INVALID_BUNDLE", "bundle");
    const many = Array.from({ length: 33 }, (_, i) => reviewerAssessment({ assessor: `reviewer-${i}`, policy: `review-${i}` }));
    rejected(baseInput({ assessments: many }), "TOO_MANY", "assessments");
  });

  test("secrets: credential-shaped text is refused in every free-text slot, attributed statements included", () => {
    // Assembled at run time so no tracked file holds a token-shaped string (public-release hygiene scan).
    const bearer = `Bearer ${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    rejected(baseInput({ assessments: [issuerAssessment({ statement: bearer })] }), "SUSPECTED_SECRET", "statement");
    // `=` is already outside WWEP output-safe text, so an assignment form never reaches the tripwire; the colon form is safe text and must be caught.
    rejected(baseInput({ assessments: [issuerAssessment({ statement: "token: abcdefghijklmnopqrstu" })] }), "SUSPECTED_SECRET", "statement");
    rejected(baseInput({ assessments: [issuerAssessment({ statement: "api_key=abcdefghijklmnopqrstu" })] }), "INVALID_FORMAT", "statement");
    rejected(baseInput({ supersedes: { id: "wp-old", digest: "a".repeat(64), kind: "SUPERSESSION", reason: bearer } }), "SUSPECTED_SECRET", "supersedes.reason");
    const r = buildWallPrintSnapshot(baseInput());
    const smuggled = forged(r, (p) => {
      p.assessments.find((a) => a.assessorRole === "ISSUER")!.statement = bearer;
    });
    assert.ok(!validateWallPrintRecord(smuggled).ok);
  });

  test("validation parity: rules the builder applies are re-applied to a record received from elsewhere", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const issuerRow = (p: ReturnType<typeof wallPrintPayload>) => p.assessments.find((a) => a.assessorRole === "ISSUER")!;
    const wwRow = (p: ReturnType<typeof wallPrintPayload>) => p.assessments.find((a) => a.assessorRole === "WALLETWALL")!;
    const codes = (rec: WallPrintRecord): string[] => {
      const v = validateWallPrintRecord(rec);
      return v.ok ? [] : v.findings.map((f) => f.code);
    };
    // Duplicate assessor|policy rows (strict ordering refuses equal keys, the duplicate rule refuses the pair).
    const dup = forged(r, (p) => {
      p.assessments.splice(1, 0, { ...issuerRow(p), assessment: "NOT_CONFIRMED" });
    });
    assert.ok(codes(dup).some((c) => c === "DUPLICATE_ASSESSMENT" || c === "NOT_CANONICAL_ORDER"), JSON.stringify(codes(dup)));
    // An ISSUER row attributed to another registry authority.
    assert.ok(codes(forged(r, (p) => { issuerRow(p).assessor = "issuer:tether"; })).includes("ISSUER_AUTHORITY_MISMATCH"));
    // WalletWall's generated row with any field altered.
    assert.ok(codes(forged(r, (p) => { wwRow(p).policyVersion = "9.9.9"; })).includes("WALLETWALL_ASSESSMENT_MISMATCH"));
    assert.ok(codes(forged(r, (p) => { wwRow(p).limitations = []; })).includes("WALLETWALL_ASSESSMENT_MISMATCH"));
    assert.ok(codes(forged(r, (p) => { wwRow(p).evidenceRefs = []; })).includes("WALLETWALL_ASSESSMENT_MISMATCH"));
    assert.ok(codes(forged(r, (p) => { wwRow(p).assessedAt = "2030-01-01T00:00:00Z"; })).includes("WALLETWALL_ASSESSMENT_MISMATCH"));
    // A reserved policy namespace in any case on an external row; the provenance target moved off the focal claim.
    assert.ok(codes(forged(r, (p) => { issuerRow(p).policy = "WWAP/issuer"; })).includes("RESERVED_POLICY_NAMESPACE"));
    assert.ok(codes(forged(r, (p) => { p.provenance.target = "a-price"; })).includes("PROVENANCE_MISMATCH"));
    // Conflicts that the claims do not agree with.
    assert.ok(codes(forged(r, (p) => { p.claims.find((c) => c.assertionId === "a-price")!.conflictsWith = ["a-balance"]; })).includes("CONFLICTS_MISMATCH"));
    // A policy version that disagrees with the record's policies version.
    assert.ok(codes(forged(r, (p) => { p.policyVersions["wwap/asset-identity/0.1"] = "0.0.1-draft"; })).includes("POLICY_VERSIONS_MISMATCH"));
  });

  test("registry authority identities are reserved for the ISSUER role; assessor ids are deduplicated case-insensitively", () => {
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "issuer:circle" })] }), "ASSESSOR_IDENTITY_RESERVED", "assessor");
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "Issuer:Tether", assessorRole: "UPSTREAM_AUTHORITY" })] }), "ASSESSOR_IDENTITY_RESERVED", "assessor");
    rejected(baseInput({ assessments: [reviewerAssessment(), reviewerAssessment({ assessor: "Reviewer-Y", assessment: "CONFIRMED" })] }), "DUPLICATE_ASSESSMENT");
  });

  test("credential-shaped text is refused in identifier and version slots too, and token prefixes are matched in any case", () => {
    const aws = `${"AKIA"}${"ABCDEFGHIJKLMNOP"}`;
    const github = `${"ghp_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: aws })] }), "SUSPECTED_SECRET", "assessor");
    rejected(baseInput({ assessments: [reviewerAssessment({ policyVersion: `${"sk_live_"}${"ABCDEFGHIJKLMNOP"}` })] }), "SUSPECTED_SECRET", "policyVersion");
    rejected(baseInput({ assessments: [reviewerAssessment({ policy: github })] }), "SUSPECTED_SECRET", "policy");
    rejected(baseInput({ id: github }), "SUSPECTED_SECRET", "id");
    const r = buildWallPrintSnapshot(baseInput());
    const smuggled = forged(r, (p) => {
      p.assessments.find((a) => a.assessorRole === "INDEPENDENT_REVIEWER")!.policyVersion = `${"SK_LIVE_"}${"ABCDEFGHIJKLMNOP"}`;
    });
    assert.ok(!validateWallPrintRecord(smuggled).ok);
  });

  test("engine-valid evaluations are recordable: a twenty-way conflict group builds, and the conflict entry carries every member", () => {
    const b = clone(golden());
    for (let i = 0; i < 19; i++) b.assertions.push({ ...b.assertions.find((x) => x.id === "a-price")!, id: `a-price-${String(i).padStart(2, "0")}`, value: { priceUsd: `1.${String(i + 1).padStart(2, "0")}` } });
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0]?.assertionIds.length, 20);
    assert.ok(r.claims.filter((c) => c.supportState === "CONFLICTING").length === 20);
  });

  test("a derivation whose rule id is an Object.prototype property name is handled as an ordinary id", () => {
    const b = clone(golden());
    b.derivations.push({ id: "d-odd", ruleId: "toString", rulesVersion: "0.1.0-draft", inputAssertionIds: ["a-balance"], outputAssertionId: "a-odd" });
    b.assertions.push({ ...b.assertions.find((x) => x.id === "a-price")!, id: "a-odd", origin: "WALLETWALL_DERIVED", observationIds: [], derivationId: "d-odd" });
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    assert.ok(Object.hasOwn(r.ruleVersions, "toString"));
    assert.equal(Object.entries(r.ruleVersions).find(([k]) => k === "toString")?.[1], "0.1.0-draft");
  });

  test("the record and its findings never echo caller-supplied text in an error message", () => {
    try {
      buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ statement: "unique-marker-text" })], id: "bad id with spaces" }));
      assert.fail("expected a throw");
    } catch (e) {
      assert.ok(e instanceof WallPrintError);
      assert.ok(!e.message.includes("unique-marker-text") && !e.message.includes("bad id"));
      assert.ok(e.findings.every((f) => !f.path.includes("unique-marker-text") && !f.path.includes("bad id")));
    }
  });

  test("serialization drift: the fixture record's digest is pinned; a change here means every committed WallPrint 0.1 stops verifying", () => {
    // Pinned from a verified run. If this changes, bump WALLPRINT_VERSION rather than updating the constant.
    const r = buildWallPrintSnapshot(baseInput());
    assert.equal(r.digest, "e5041d3a1389b4bd6b17ead9c245362dab8724458442f10ac3db27bfcb45a588");
    assert.equal(r.evidence.bundleDigest, "9fa2a1047b79e4df0b297a8b2d1712eeb01bd2be4c230614efcc87f4426eb082");
  });

  test("the principle and every invariant are present in the vocabulary", () => {
    assert.equal(WALLPRINT_PRINCIPLE, "WalletWall isn't always right. WallPrint keeps the record.");
    for (const inv of ["correction != mutation", "supersession != deletion", "withdrawal != deletion", "digest integrity != factual truth", "receipt integrity != factual truth", "WallPrint lifecycle != WWEP evidence state", "UNREPLAYABLE != INCORRECT"]) {
      assert.ok(WALLPRINT_INVARIANTS.includes(inv as never), inv);
    }
  });
});
