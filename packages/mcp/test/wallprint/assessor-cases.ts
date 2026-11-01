import type { Bundle } from "../../src/schemas.ts";
import { clone, golden, issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * The attribution contract for external assessments, as a table. Each row is what an untrusted caller might hand to
 * `buildWallPrintSnapshot({ assessments })` and exactly what the engine says about it: admitted, or the error code and the
 * (code, path) findings it throws. The table characterizes the existing builder (assessor-attribution.test.ts) and is the
 * oracle the import boundary is held to (assessor-import.test.ts): the same rules, the same findings, one list of cases.
 */
export interface ExpectedFinding {
  code: string;
  /** In the builder's form, `assessments[i].field`. */
  path: string;
}

export interface AttributionCase {
  name: string;
  /** The bundle the assessments are about. Defaults to the golden world focused on `a-identity` (a registered USDC deployment). */
  bundle?: Bundle;
  assessments: unknown[];
  expected: "BUILT" | { error: "INVALID_INPUT" | "INVALID_RECORD"; findings: ExpectedFinding[] };
}

const unregisteredSubject = (): Bundle => {
  const b = clone(golden());
  const other = `0x${"99".repeat(20)}`;
  b.assertions = b.assertions.map((a) => (a.id === "a-identity" ? { ...a, subject: { chainId: "1", address: other } } : a));
  b.observations = b.observations.map((o) => (o.id === "obs-identity" ? { ...o, subject: { chainId: "1", address: other } } : o));
  return b;
};

const reserved = (path: string): ExpectedFinding => ({ code: "ASSESSOR_IDENTITY_RESERVED", path });
const record = (...findings: ExpectedFinding[]): AttributionCase["expected"] => ({ error: "INVALID_RECORD", findings });
const input = (...findings: ExpectedFinding[]): AttributionCase["expected"] => ({ error: "INVALID_INPUT", findings });

export const ATTRIBUTION_CASES: readonly AttributionCase[] = [
  { name: "a caller-supplied WALLETWALL role", assessments: [issuerAssessment({ assessorRole: "WALLETWALL" })], expected: record(reserved("assessments[0].assessorRole"), reserved("assessments[0].assessor")) },
  { name: "an identity that reads as WallPrint (wall.print)", assessments: [reviewerAssessment({ assessor: "wall.print" })], expected: record(reserved("assessments[0].assessor")) },
  { name: "an identity that reads as WalletWall (Wallet-Wall)", assessments: [reviewerAssessment({ assessor: "Wallet-Wall" })], expected: record(reserved("assessments[0].assessor")) },
  { name: "WalletWall's own assessor id", assessments: [reviewerAssessment({ assessor: "walletwall-rules" })], expected: record(reserved("assessments[0].assessor")) },
  { name: "a policy in the wwvr namespace", assessments: [reviewerAssessment({ policy: "wwvr-thing" })], expected: record({ code: "RESERVED_POLICY_NAMESPACE", path: "assessments[0].policy" }) },
  { name: "a policy in the wwap namespace", assessments: [reviewerAssessment({ policy: "wwap/asset-identity/0.1" })], expected: record({ code: "RESERVED_POLICY_NAMESPACE", path: "assessments[0].policy" }) },
  { name: "a policy in the wwdr namespace, upper case", assessments: [reviewerAssessment({ policy: "WWDR.usd-value" })], expected: record({ code: "RESERVED_POLICY_NAMESPACE", path: "assessments[0].policy" }) },
  { name: "an ISSUER that is not the registry authority of the focal deployment", assessments: [issuerAssessment({ assessor: "issuer:tether" })], expected: record({ code: "ISSUER_AUTHORITY_MISMATCH", path: "assessments[0].assessor" }) },
  { name: "an ISSUER on an unregistered subject", bundle: unregisteredSubject(), assessments: [issuerAssessment()], expected: record({ code: "ISSUER_NOT_IN_REGISTRY", path: "assessments[0].assessor" }) },
  { name: "the registry authority identity under a role other than ISSUER, in another letter case", assessments: [reviewerAssessment({ assessor: "Issuer:Circle" })], expected: record(reserved("assessments[0].assessor")) },
  { name: "an evidence reference that names nothing in the bundle", assessments: [reviewerAssessment({ evidenceRefs: ["obs-missing"] })], expected: record({ code: "UNKNOWN_EVIDENCE_REFERENCE", path: "assessments[0].evidenceRefs" }) },
  { name: "the same assessor and policy twice", assessments: [reviewerAssessment(), reviewerAssessment({ assessment: "OTHER_CODE" })], expected: record({ code: "DUPLICATE_ASSESSMENT", path: "assessments[1]" }) },
  { name: "the same assessor and policy twice, in different letter case", assessments: [reviewerAssessment({ assessor: "Reviewer-Y", policy: "REVIEWER-Y-REVIEW" }), reviewerAssessment()], expected: record({ code: "DUPLICATE_ASSESSMENT", path: "assessments[1]" }) },
  { name: "a credential-shaped statement", assessments: [reviewerAssessment({ statement: "token: abcdefghijkl" })], expected: record({ code: "SUSPECTED_SECRET", path: "assessments[0].statement" }) },
  { name: "a credential-shaped assessment code", assessments: [reviewerAssessment({ assessment: "SK_LIVE_ABCDEFGHIJ" })], expected: record({ code: "SUSPECTED_SECRET", path: "assessments[0].assessment" }) },
  { name: "an unknown field", assessments: [{ ...reviewerAssessment(), rank: "1" }], expected: input({ code: "UNKNOWN_FIELD", path: "assessments[0]" }) },
  { name: "a field of the wrong type", assessments: [{ ...reviewerAssessment(), assessor: 5 }], expected: input({ code: "INVALID_TYPE", path: "assessments[0].assessor" }) },
  { name: "a time that is not a time", assessments: [reviewerAssessment({ assessedAt: "yesterday" })], expected: input({ code: "INVALID_TIMESTAMP", path: "assessments[0].assessedAt" }, { code: "INVALID_TIMESTAMP", path: "assessments[0].assessedAt" }) },
  { name: "a limitation that is not a WWEP limitation code", assessments: [reviewerAssessment({ limitations: ["NOT_A_CODE" as never] })], expected: input({ code: "INVALID_ENUM", path: "assessments[0].limitations[0]" }) },
  { name: "an assessment code that is not an upper-case code", assessments: [reviewerAssessment({ assessment: "confirmed" })], expected: input({ code: "INVALID_FORMAT", path: "assessments[0].assessment" }) },
  { name: "an ISSUER spelled in another letter case is not the registry authority", assessments: [issuerAssessment({ assessor: "Issuer:Circle" })], expected: record({ code: "ISSUER_AUTHORITY_MISMATCH", path: "assessments[0].assessor" }) },
  // Pinned as the contract stands (known limits, identical for native and imported assessments). The identity guard is a
  // token-run rule and the registry guard is an exact case-folded match, so a fused or re-spelled name is admitted, and
  // so are engine authority ids as UPSTREAM_AUTHORITY assessors. None of this reaches an evidence state. Closing any of it
  // is an admission-rule change, therefore a WallPrint version change, and is recorded as a follow-up.
  { name: "known limit: a registry authority spelling variant (issuer-circle) under another role is admitted", assessments: [reviewerAssessment({ assessor: "issuer-circle" })], expected: "BUILT" },
  { name: "known limit: a name that fuses the WalletWall and WallPrint stems (walletwallprint) is admitted", assessments: [reviewerAssessment({ assessor: "walletwallprint" })], expected: "BUILT" },
  { name: "known limit: an engine authority id as an UPSTREAM_AUTHORITY assessor (canonical-chain-state) is admitted", assessments: [reviewerAssessment({ assessor: "canonical-chain-state", assessorRole: "UPSTREAM_AUTHORITY" })], expected: "BUILT" },
  { name: "known limit: a policy that only begins with the WalletWall stem (walletwall-policy, wwap2) is not in a reserved namespace", assessments: [reviewerAssessment({ policy: "walletwall-policy" }), reviewerAssessment({ assessor: "reviewer-z", policy: "wwap2" })], expected: "BUILT" },
  // Pinned as the contract stands: the reserved namespace is the prefix `wwap`, `wwdr` or `wwvr` followed by a separator,
  // in any letter case. A separator inside the prefix (`ww-ap/`) is not reserved. Changing it is an admission-rule change,
  // therefore a WallPrint version change, and is recorded as a follow-up rather than altered by the import lane.
  { name: "a policy that splits the reserved prefix with a separator (ww-ap/...) is not in the reserved namespace", assessments: [reviewerAssessment({ policy: "ww-ap/review" })], expected: "BUILT" },
  { name: "a stem buried in a longer token (firewall-print-shop) is not an impersonation", assessments: [reviewerAssessment({ assessor: "firewall-print-shop" })], expected: "BUILT" },
  { name: "an assurance-like statement and code are admitted as the assessor's own words", assessments: [issuerAssessment({ assessment: "CERTIFIED", statement: "Certified and audited by the issuer." })], expected: "BUILT" },
];
