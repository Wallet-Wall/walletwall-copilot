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
  /** What WallPrint 0.1 says: the contract the table was first written against. */
  expected: "BUILT" | { error: "INVALID_INPUT" | "INVALID_RECORD"; findings: ExpectedFinding[] };
  /** What WallPrint 0.2 says, for the rows whose outcome the 0.2 admission rules changed; every other row is the same in both versions. */
  v02?: AttributionCase["expected"];
}

/** The WallPrint contract versions the table is held to, with each row's expectation under that version. */
export const ATTRIBUTION_VERSIONS = ["0.1", "0.2"] as const;
export const expectedUnder = (c: AttributionCase, version: (typeof ATTRIBUTION_VERSIONS)[number]): AttributionCase["expected"] => (version === "0.2" && c.v02 !== undefined ? c.v02 : c.expected);

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
  // The 0.1 gaps, as the 0.1 contract stood (identical for native and imported assessments) and as 0.2 closes them. The identity guard
  // was a token-run rule and the registry guard an exact case-folded match, so a fused or re-spelled name was admitted, and so were
  // engine authority ids as UPSTREAM_AUTHORITY assessors. None of it reached an evidence state; closing it is an admission-rule
  // change, so it is a WallPrint version change: these rows stay admitted under 0.1 and are refused under 0.2.
  { name: "0.1 gap: a registry authority spelling variant (issuer-circle) under another role", assessments: [reviewerAssessment({ assessor: "issuer-circle" })], expected: "BUILT", v02: record(reserved("assessments[0].assessor")) },
  { name: "0.1 gap: a name that fuses the WalletWall and WallPrint stems (walletwallprint)", assessments: [reviewerAssessment({ assessor: "walletwallprint" })], expected: "BUILT", v02: record(reserved("assessments[0].assessor")) },
  { name: "0.1 gap: an engine authority id as an UPSTREAM_AUTHORITY assessor (canonical-chain-state)", assessments: [reviewerAssessment({ assessor: "canonical-chain-state", assessorRole: "UPSTREAM_AUTHORITY" })], expected: "BUILT", v02: record(reserved("assessments[0].assessor")) },
  {
    name: "0.1 gap: a policy that only begins with the WalletWall stem (walletwall-policy, wwap2)",
    assessments: [reviewerAssessment({ policy: "walletwall-policy" }), reviewerAssessment({ assessor: "reviewer-z", policy: "wwap2" })],
    expected: "BUILT",
    v02: record({ code: "RESERVED_POLICY_NAMESPACE", path: "assessments[0].policy" }, { code: "RESERVED_POLICY_NAMESPACE", path: "assessments[1].policy" }),
  },
  // 0.1: the reserved namespace is the prefix `wwap`, `wwdr` or `wwvr` followed by a separator, in any letter case; a separator inside
  // the prefix (`ww-ap/`) was not reserved. 0.2 folds separators inside the prefix.
  { name: "0.1 gap: a policy that splits the reserved prefix with a separator (ww-ap/...)", assessments: [reviewerAssessment({ policy: "ww-ap/review" })], expected: "BUILT", v02: record({ code: "RESERVED_POLICY_NAMESPACE", path: "assessments[0].policy" }) },
  { name: "a stem buried in a longer token (firewall-print-shop) is not an impersonation", assessments: [reviewerAssessment({ assessor: "firewall-print-shop" })], expected: "BUILT" },
  { name: "an assurance-like statement and code are admitted as the assessor's own words", assessments: [issuerAssessment({ assessment: "CERTIFIED", statement: "Certified and audited by the issuer." })], expected: "BUILT" },
];
