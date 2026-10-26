import { assessReadiness } from "../../src/readiness.ts";
import { evaluateBundle } from "../../src/evaluate.ts";
import type { Bundle } from "../../src/schemas.ts";
import type { ExternalAssessmentInput, SnapshotInput } from "../../src/wallprint/record.ts";
import { EVALUATED_AT, OBSERVED_AT, clone, golden, withUsdValue } from "../support/builders.ts";

/**
 * Deterministic WallPrint fixtures built on the engine's synthetic evidence (src/examples.ts). Nothing here describes a
 * real wallet. Timestamps are literals; no test reads a clock.
 */
export const SNAPSHOT_AT = EVALUATED_AT; // 2026-10-23T12:00:30Z — a WWEP evaluation time, spelled as the engine accepts it
// Lifecycle times are WallPrint-owned and must be canonical instants (UTC, millisecond precision).
export const COMMIT_AT = "2026-10-23T12:10:00.000Z";
export const DISCLOSE_AT = "2026-10-23T12:20:00.000Z";
export const LATER_AT = "2026-10-24T12:00:00.000Z";
export const LATER2_AT = "2026-10-25T12:00:00.000Z";
export const LATER3_AT = "2026-10-26T12:00:00.000Z";
/** A later WWEP evaluation time for successor snapshots. */
export const LATER_SNAPSHOT_AT = "2026-10-24T11:00:00Z";

/** golden() plus the derived USD value and a derived VAULT_TECHNICAL_READINESS assertion produced by the published rule. */
export function readinessWorld(): Bundle {
  const b = withUsdValue(golden());
  const ev = evaluateBundle(b, EVALUATED_AT);
  const r = assessReadiness(b, ev, "a-identity", "a-balance");
  b.derivations.push(r.suggestedDerivation);
  b.assertions.push(r.suggestedAssertion);
  return b;
}

export const issuerAssessment = (over: Partial<ExternalAssessmentInput> = {}): ExternalAssessmentInput => ({
  assessor: "issuer:circle",
  assessorRole: "ISSUER",
  assessment: "CONFIRMED",
  statement: "Deployment confirmed for the stated period.",
  policy: "issuer-attestation",
  policyVersion: "2026-Q3",
  assessedAt: OBSERVED_AT,
  evidenceRefs: ["obs-identity"],
  limitations: [],
  ...over,
});

export const reviewerAssessment = (over: Partial<ExternalAssessmentInput> = {}): ExternalAssessmentInput => ({
  assessor: "reviewer-y",
  assessorRole: "INDEPENDENT_REVIEWER",
  assessment: "NOT_AVAILABLE",
  policy: "reviewer-y-review",
  policyVersion: "1",
  assessedAt: OBSERVED_AT,
  evidenceRefs: [],
  limitations: [],
  ...over,
});

/** The base snapshot input: the golden world, focused on the asset identity (the Wallmark), with two external assessors. */
export function baseInput(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    id: "wp-golden-identity",
    bundle: clone(golden()),
    evaluatedAt: SNAPSHOT_AT,
    focalAssertionId: "a-identity",
    assessments: [issuerAssessment(), reviewerAssessment()],
    supersedes: null,
    ...over,
  };
}

export { clone, golden, withUsdValue };
