import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest } from "../../src/canonical.ts";
import { evaluateBundle } from "../../src/evaluate.ts";
import { POLICIES_VERSION, REGISTRY_VERSION, RULES_VERSION, policiesDigest, registryDigest } from "../../src/registry.ts";
import { WWEP_VERSION, type Bundle } from "../../src/schemas.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import {
  buildWallPrintSnapshot,
  validateWallPrintRecord,
  verifyWallPrintDigest,
  wallPrintPayload,
  type WallPrintRecord,
} from "../../src/wallprint/record.ts";
import { WALLETWALL_ASSESSOR_ID, WALLPRINT_VERSION } from "../../src/wallprint/vocabulary.ts";
import { USDC, replaceObservation } from "../support/builders.ts";
import { SNAPSHOT_AT, baseInput, clone, golden, issuerAssessment, readinessWorld, reviewerAssessment } from "./support.ts";

const HEX64 = /^[0-9a-f]{64}$/;

function rejected(input: unknown, code: string, pathPart?: string): void {
  assert.throws(
    () => buildWallPrintSnapshot(input as never),
    (e: unknown) => {
      assert.ok(e instanceof WallPrintError, `expected WallPrintError, got ${String(e)}`);
      assert.ok(e.code === "INVALID_INPUT" || e.code === "INVALID_RECORD", `code ${e.code}`);
      const hit = e.findings.find((f) => f.code === code && (pathPart === undefined || f.path.includes(pathPart)));
      assert.ok(hit, `expected finding ${code}${pathPart ? ` at ${pathPart}` : ""}; got ${JSON.stringify(e.findings)}`);
      return true;
    },
  );
}

describe("WallPrint canonical snapshot: shape, versions and digest", () => {
  test("a valid snapshot is accepted and carries the contract identifiers, WWEP versions and digests", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.equal(r.wallprintVersion, WALLPRINT_VERSION);
    assert.equal(r.canonicalization, "RFC8785");
    assert.equal(r.digestAlgorithm, "SHA-256");
    assert.match(r.digest, HEX64);
    assert.equal(r.id, "wp-golden-identity");
    assert.equal(r.snapshotAt, SNAPSHOT_AT);
    assert.deepEqual(r.versions, { wwep: WWEP_VERSION, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION, registryDigest: registryDigest(), policiesDigest: policiesDigest() });
    assert.equal(r.evidence.bundleDigest, evidenceDigest(golden()));
    assert.equal(r.supersedes, null);
    assert.deepEqual(validateWallPrintRecord(r), { ok: true, record: r });
  });

  test("the subject is the focal claim's exact-string identity under its policy's subject keys", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(r.subject, { focalAssertionId: "a-identity", claimType: "ASSET_IDENTITY", temporality: "CURRENT", identity: { chainId: "1", address: USDC } });
  });

  test("claims are the engine's evaluations, one per assertion, sorted by id, with the computed support state", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(r.claims.map((c) => c.assertionId), ["a-balance", "a-identity", "a-price"]);
    const ev = evaluateBundle(golden(), SNAPSHOT_AT);
    for (const c of r.claims) {
      const e = ev.assertions.find((x) => x.assertionId === c.assertionId);
      assert.ok(e);
      assert.equal(c.supportState, e.supportState);
      assert.equal(c.freshnessState, e.freshnessState);
      assert.deepEqual(c.limitations, e.limitations);
      assert.equal(c.digest, e.digest);
      assert.equal(c.independentCorroboration, e.independentCorroboration === null ? null : String(e.independentCorroboration));
    }
    assert.equal(r.claims.find((c) => c.assertionId === "a-identity")?.supportState, "ESTABLISHED");
  });

  test("the record is deeply frozen and independent of later mutation of the input", () => {
    const input = baseInput();
    const r = buildWallPrintSnapshot(input);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.claims) && Object.isFrozen(r.claims[0]) && Object.isFrozen(r.versions));
    (input.bundle as Bundle).assertions[0]!.subject = { chainId: "8453", token: USDC };
    assert.equal(r.claims.find((c) => c.assertionId === "a-balance")?.subject["chainId"], "1");
    assert.throws(() => {
      (r as { snapshotAt: string }).snapshotAt = "x";
    }, TypeError);
  });

  test("verifyWallPrintDigest matches a fresh record, reports a missing digest as absence, and fails on any covered change", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(verifyWallPrintDigest(r), { hasDigest: true, matches: true, computedDigest: r.digest });
    const { digest: _d, ...bare } = r;
    assert.equal(verifyWallPrintDigest(bare).hasDigest, false);
    const tampered = { ...r, snapshotAt: "2026-10-24T12:00:30Z" };
    assert.equal(verifyWallPrintDigest(tampered).matches, false);
  });

  test("the digest preimage is the record minus its own digest, and nothing else", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const payload = wallPrintPayload(r);
    assert.equal("digest" in payload, false);
    const { digest: _d, ...rest } = r;
    assert.equal(canonicalize(payload), canonicalize(rest));
    assert.equal(evidenceDigest(payload), r.digest);
  });
});

describe("WallPrint canonical snapshot: same semantics, same bytes", () => {
  test("bundle key order and assessment order do not change the digest", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const shuffledBundle = JSON.parse(JSON.stringify(golden(), (_k, v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse()) : v))) as Bundle;
    const b = buildWallPrintSnapshot(baseInput({ bundle: shuffledBundle, assessments: [reviewerAssessment(), issuerAssessment()] }));
    assert.equal(a.digest, b.digest);
    assert.deepEqual(a, b);
  });

  test("two builds of the same input are identical", () => {
    assert.deepEqual(buildWallPrintSnapshot(baseInput()), buildWallPrintSnapshot(baseInput()));
  });

  test("an evidence change changes the digest", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ bundle: replaceObservation(golden(), "obs-balance", { payload: { balanceAtomic: "1500001", decimals: "6" } }) }));
    assert.notEqual(a.digest, b.digest);
    assert.notEqual(a.evidence.bundleDigest, b.evidence.bundleDigest);
  });

  test("an external assessment change changes the digest", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ assessment: "NOT_CONFIRMED" }), reviewerAssessment()] }));
    assert.notEqual(a.digest, b.digest);
  });

  test("a rule version change in the evidence changes the digest and is reported as a limitation, not hidden", () => {
    const world = readinessWorld();
    const a = buildWallPrintSnapshot(baseInput({ bundle: clone(world), focalAssertionId: "readiness-result" }));
    const other = clone(world);
    other.derivations = other.derivations.map((d) => (d.id === "d-usd" ? { ...d, rulesVersion: "0.2.0" } : d));
    const b = buildWallPrintSnapshot(baseInput({ bundle: other, focalAssertionId: "readiness-result" }));
    assert.notEqual(a.digest, b.digest);
    assert.deepEqual(a.ruleVersions, { "wwdr.usd-value": "0.1.0-draft", "wwvr.vault-technical-readiness": "0.1.0-draft" });
    assert.deepEqual(b.ruleVersions, { "wwdr.usd-value": "0.2.0", "wwvr.vault-technical-readiness": "0.1.0-draft" });
    assert.ok(b.claims.find((c) => c.assertionId === "a-usd")?.limitations.includes("RULES_VERSION_MISMATCH"));
  });

  test("policy versions are recorded per policy used and are inside the digest", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(r.policyVersions, { "wwap/asset-identity/0.1": POLICIES_VERSION, "wwap/token-balance-at-block/0.1": POLICIES_VERSION, "wwap/token-usd-price/0.1": POLICIES_VERSION });
    const altered = { ...wallPrintPayload(r), policyVersions: { ...r.policyVersions, "wwap/asset-identity/0.1": "9.9.9" } };
    assert.notEqual(evidenceDigest(altered), r.digest);
  });

  test("a snapshot time change changes the digest", () => {
    const a = buildWallPrintSnapshot(baseInput());
    const b = buildWallPrintSnapshot(baseInput({ evaluatedAt: "2026-10-23T12:00:31Z" }));
    assert.notEqual(a.digest, b.digest);
  });
});

describe("WallPrint canonical snapshot: rejections", () => {
  test("presentation-only or unknown fields are rejected, not silently dropped (and the unknown key name is never echoed)", () => {
    rejected({ ...baseInput(), ui: { selected: "a-identity" } }, "UNKNOWN_FIELD");
    rejected({ ...baseInput(), lifecycle: { state: "DISCLOSED" } }, "UNKNOWN_FIELD");
    rejected({ ...baseInput(), assessments: [{ ...issuerAssessment(), verified: true }] }, "UNKNOWN_FIELD", "assessments[0]");
    assert.throws(
      () => buildWallPrintSnapshot({ ...baseInput(), secretKeyName: "x" } as never),
      (e: unknown) => e instanceof WallPrintError && e.findings.every((f) => !f.path.includes("secretKeyName")) && !e.message.includes("secretKeyName"),
    );
  });

  test("an own __proto__ key anywhere in the input is refused", () => {
    const raw = JSON.parse(JSON.stringify(baseInput()).replace(/^\{/, '{"__proto__":{"digest":"x"},')) as unknown;
    rejected(raw, "FORBIDDEN_STRUCTURE");
  });

  test("a malformed bundle, an unknown focal assertion and a bad id are rejected", () => {
    rejected(baseInput({ bundle: { wwepVersion: "0.2", sources: [], observations: [], assertions: [], derivations: [] } }), "INVALID_BUNDLE", "bundle");
    rejected(baseInput({ focalAssertionId: "a-nobody" }), "UNKNOWN_FOCAL_ASSERTION", "focalAssertionId");
    rejected(baseInput({ id: "bad id!" }), "INVALID_ID", "id");
    rejected(baseInput({ evaluatedAt: "yesterday" }), "INVALID_TIMESTAMP", "evaluatedAt");
  });

  test("supersedes must be well formed, must not name the record itself, and a correction needs a reason", () => {
    rejected(baseInput({ supersedes: { id: "wp-old", digest: "nope", kind: "CORRECTION", reason: "Recount." } }), "INVALID_DIGEST", "supersedes.digest");
    rejected(baseInput({ supersedes: { id: "wp-old", digest: "a".repeat(64), kind: "REPLACE", reason: null } as never }), "INVALID_ENUM", "supersedes.kind");
    rejected(baseInput({ supersedes: { id: "wp-golden-identity", digest: "a".repeat(64), kind: "SUPERSESSION", reason: null } }), "SELF_SUPERSESSION", "supersedes.id");
    rejected(baseInput({ supersedes: { id: "wp-old", digest: "a".repeat(64), kind: "CORRECTION", reason: null } }), "REASON_REQUIRED", "supersedes.reason");
    rejected(baseInput({ supersedes: { id: "wp-old", digest: "a".repeat(64), kind: "CORRECTION", reason: "Now verified." } }), "MANUFACTURED_ASSURANCE", "supersedes.reason");
  });
});

describe("WallPrint assessors: attribution, disagreement, no consensus", () => {
  test("WalletWall's assessment is generated from the engine and equals the focal claim's computed support state", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const ww = r.assessments.find((a) => a.assessorRole === "WALLETWALL");
    assert.ok(ww);
    assert.equal(ww.assessor, WALLETWALL_ASSESSOR_ID);
    assert.equal(ww.assessment, "ESTABLISHED");
    assert.equal(ww.assessment, r.claims.find((c) => c.assertionId === "a-identity")?.supportState);
    assert.equal(ww.policy, "wwap/asset-identity/0.1");
    assert.equal(ww.policyVersion, POLICIES_VERSION);
    assert.equal(ww.assessedAt, SNAPSHOT_AT);
    assert.deepEqual(ww.evidenceRefs, ["obs-identity"]);
    assert.equal(ww.statement, null);
  });

  test("three assessors may disagree; all three remain, attributed, and no consensus or overall field exists", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.deepEqual(
      r.assessments.map((a) => [a.assessor, a.assessorRole, a.assessment]),
      [
        ["issuer:circle", "ISSUER", "CONFIRMED"],
        ["reviewer-y", "INDEPENDENT_REVIEWER", "NOT_AVAILABLE"],
        [WALLETWALL_ASSESSOR_ID, "WALLETWALL", "ESTABLISHED"],
      ],
    );
    for (const k of Object.keys(r)) assert.doesNotMatch(k, /consensus|overall|verdict|assurance|status/i);
  });

  test("an external assessor may be recorded saying CERTIFIED: it is attributed, not WallPrint speaking", () => {
    const r = buildWallPrintSnapshot(baseInput({ assessments: [issuerAssessment({ assessment: "CERTIFIED", statement: "Certified and audited by the issuer." })] }));
    const issuer = r.assessments.find((a) => a.assessorRole === "ISSUER");
    assert.equal(issuer?.assessment, "CERTIFIED");
    assert.equal(issuer?.statement, "Certified and audited by the issuer.");
  });

  test("a caller may not supply a WalletWall assessment or a WalletWall-looking identity", () => {
    rejected(baseInput({ assessments: [issuerAssessment({ assessorRole: "WALLETWALL" })] }), "ASSESSOR_IDENTITY_RESERVED", "assessments[0].assessorRole");
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "wallet-wall-audit" })] }), "ASSESSOR_IDENTITY_RESERVED", "assessments[0].assessor");
    rejected(baseInput({ assessments: [reviewerAssessment({ assessor: "walletwall-rules" })] }), "ASSESSOR_IDENTITY_RESERVED", "assessments[0].assessor");
  });

  test("an ISSUER assessment must be attributed to the registry authority of the focal deployment", () => {
    rejected(baseInput({ assessments: [issuerAssessment({ assessor: "issuer:tether" })] }), "ISSUER_AUTHORITY_MISMATCH", "assessments[0].assessor");
    const b = clone(golden());
    const other = `0x${"99".repeat(20)}`;
    b.assertions = b.assertions.map((a) => (a.id === "a-identity" ? { ...a, subject: { chainId: "1", address: other } } : a));
    b.observations = b.observations.map((o) => (o.id === "obs-identity" ? { ...o, subject: { chainId: "1", address: other } } : o));
    rejected(baseInput({ bundle: b, assessments: [issuerAssessment()] }), "ISSUER_NOT_IN_REGISTRY", "assessments[0].assessor");
  });

  test("assessment evidence references must name items of the bundle; one assessor assesses once per policy", () => {
    rejected(baseInput({ assessments: [issuerAssessment({ evidenceRefs: ["obs-missing"] })] }), "UNKNOWN_EVIDENCE_REFERENCE", "assessments[0].evidenceRefs");
    rejected(baseInput({ assessments: [issuerAssessment(), issuerAssessment({ assessment: "NOT_CONFIRMED" })] }), "DUPLICATE_ASSESSMENT", "assessments[1]");
  });

  test("absence of assessment is not a failed assessment: zero external assessments is valid, and NOT_AVAILABLE is recorded as said", () => {
    const r = buildWallPrintSnapshot(baseInput({ assessments: [] }));
    assert.equal(r.assessments.length, 1);
    assert.equal(r.assessments[0]?.assessorRole, "WALLETWALL");
    const s = buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment()] }));
    assert.equal(s.assessments.find((a) => a.assessorRole === "INDEPENDENT_REVIEWER")?.assessment, "NOT_AVAILABLE");
  });

  test("the WalletWall assessment is a WWEP support state, never a reserved term: UNKNOWN stays UNKNOWN (not FALSE, not zero)", () => {
    const b = clone(golden());
    b.observations = b.observations.map((o) => (o.id === "obs-identity" ? { ...o, result: "NO_RESULT" as const } : o));
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    const ww = r.assessments[0];
    assert.equal(ww?.assessment, "UNKNOWN");
    assert.equal(r.claims.find((c) => c.assertionId === "a-identity")?.supportState, "UNKNOWN");
  });
});

describe("WallPrint evidence, provenance, conflicts and violations are recorded as the engine reports them", () => {
  test("evidence items reference every bundle object by kind, id and evidence digest", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const kinds = r.evidence.items.map((i) => i.kind);
    assert.deepEqual([...new Set(kinds)], ["ASSERTION", "OBSERVATION", "SOURCE"]);
    const src = r.evidence.items.find((i) => i.kind === "SOURCE" && i.id === "src-chain");
    assert.equal(src?.digest, evidenceDigest(golden().sources.find((s) => s.id === "src-chain")));
  });

  test("provenance is the engine's lineage for the focal assertion, with depth as a string", () => {
    const r = buildWallPrintSnapshot(baseInput());
    assert.equal(r.provenance.target, "a-identity");
    assert.deepEqual(r.provenance.lineage, [
      { id: "a-identity", kind: "assertion", depth: "0" },
      { id: "obs-identity", kind: "observation", depth: "1" },
    ]);
    assert.deepEqual(r.provenance.issues, []);
  });

  test("a declared conflict is recorded and the claims involved are CONFLICTING; WallPrint resolves nothing", () => {
    const b = clone(golden());
    b.assertions.push({ ...b.assertions.find((a) => a.id === "a-price")!, id: "a-price-2", value: { priceUsd: "0.9" } });
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    assert.deepEqual(r.conflicts, [{ assertionIds: ["a-price", "a-price-2"], cause: "CONFLICT_DETECTED" }]);
    assert.equal(r.claims.find((c) => c.assertionId === "a-price")?.supportState, "CONFLICTING");
    assert.equal(r.claims.find((c) => c.assertionId === "a-price-2")?.supportState, "CONFLICTING");
  });

  test("invariant violations reported by the engine are part of the record", () => {
    const b = clone(golden());
    b.assertions = b.assertions.map((a) => (a.id === "a-price" ? { ...a, declared: { supportState: "ESTABLISHED" as const } } : a));
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    assert.ok(r.violations.some((v) => v.invariant === "INV-00" && v.code === "DECLARED_SUPPORT_EXCEEDS_COMPUTED" && v.assertionId === "a-price"));
  });

  test("provider multiplicity is not independent corroboration: WallPrint records the engine's count and never recomputes it", () => {
    const b = clone(golden());
    // Two provider endpoints, same (unspecified) independence group.
    b.sources = b.sources.map((s) => (s.kind === "PROVIDER_ENDPOINT" ? { id: s.id, kind: s.kind, transport: s.transport! } : s));
    const r = buildWallPrintSnapshot(baseInput({ bundle: b, assessments: [] }));
    const price = r.claims.find((c) => c.assertionId === "a-price");
    assert.equal(price?.independentCorroboration, "1");
    assert.ok(price?.limitations.includes("INSUFFICIENT_INDEPENDENT_CORROBORATION"));
    assert.equal(price?.supportState, "PARTIAL");
  });
});

describe("validateWallPrintRecord accepts committed records and rejects tampering or unknown shapes", () => {
  test("a record with an extra top-level key, a wrong version constant or a changed digest is rejected", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const extra = validateWallPrintRecord({ ...r, verdict: "VERIFIED" });
    assert.equal(extra.ok, false);
    const wrong = validateWallPrintRecord({ ...r, wallprintVersion: "0.2" });
    assert.equal(wrong.ok, false);
    const digest = validateWallPrintRecord({ ...r, digest: "0".repeat(64) });
    assert.equal(digest.ok, false);
    assert.ok(!digest.ok && digest.findings.some((f) => f.code === "DIGEST_MISMATCH"));
  });

  test("a record whose claim support state is not a WWEP support state is rejected (no WallPrint-local states)", () => {
    const r = buildWallPrintSnapshot(baseInput());
    const claims = r.claims.map((c) => (c.assertionId === "a-identity" ? { ...c, supportState: "VERIFIED" } : c)) as unknown as WallPrintRecord["claims"];
    const result = validateWallPrintRecord({ ...r, claims });
    assert.equal(result.ok, false);
  });
});
