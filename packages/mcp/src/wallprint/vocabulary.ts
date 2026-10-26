/**
 * WallPrint vocabulary (WallPrint 0.1 on WWEP 0.1).
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * WallPrint adds exactly one new dimension to WWEP, the DISCLOSURE LIFECYCLE of a committed record, and one new kind
 * of attribution, named ASSESSORS. It defines no evidence state of its own: a claim's support state in a WallPrint is
 * the SupportState the WWEP engine computed, nothing else (schemas.ts SUPPORT_STATES, spec/SUPPORT_STATES.md).
 *
 *   evidence state (WWEP)      : ESTABLISHED .. NOT_ESTABLISHED — how well presented evidence supports a claim
 *   disclosure lifecycle (new) : COMMITTED, DISCLOSED, CORRECTED, SUPERSEDED, WITHDRAWN — where a record is in its life
 *   assessments (new)          : what a NAMED assessor concluded under a NAMED policy at a stated time
 *
 * The lifecycle lives in the append-only history, never inside the digested record, so correction, supersession and
 * withdrawal are appends and the committed bytes never change.
 */

export const WALLPRINT_VERSION = "0.1";
export const WALLPRINT_CANONICALIZATION = "RFC8785";
export const WALLPRINT_DIGEST_ALGORITHM = "SHA-256";

export const LIFECYCLE_STATES = ["COMMITTED", "DISCLOSED", "CORRECTED", "SUPERSEDED", "WITHDRAWN"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Allowed transitions. WITHDRAWN is terminal; a corrected or superseded record has exactly one successor and may only be withdrawn afterwards. */
export const LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  COMMITTED: ["DISCLOSED", "CORRECTED", "SUPERSEDED", "WITHDRAWN"],
  DISCLOSED: ["CORRECTED", "SUPERSEDED", "WITHDRAWN"],
  CORRECTED: ["WITHDRAWN"],
  SUPERSEDED: ["WITHDRAWN"],
  WITHDRAWN: [],
};

export const SUPERSESSION_KINDS = ["CORRECTION", "SUPERSESSION"] as const;
export type SupersessionKind = (typeof SUPERSESSION_KINDS)[number];

export const ASSESSOR_ROLES = ["WALLETWALL", "ISSUER", "UPSTREAM_AUTHORITY", "INDEPENDENT_REVIEWER", "OTHER"] as const;
export type AssessorRole = (typeof ASSESSOR_ROLES)[number];

/** WalletWall's own assessment is attributed to its rule engine, the same agent provenance.ts names. */
export const WALLETWALL_ASSESSOR_ID = "walletwall-rules";

/** Identity stems no external assessor may carry, compared after lower-casing and stripping `.`, `_`, `-` and `:`. */
export const RESERVED_IDENTITY_STEMS = ["walletwall", "wallprint"] as const;

export const EVIDENCE_ITEM_KINDS = ["SOURCE", "OBSERVATION", "ASSERTION", "DERIVATION"] as const;
export type EvidenceItemKind = (typeof EVIDENCE_ITEM_KINDS)[number];

export const REPLAY_OUTCOMES = ["REPRODUCED", "MISMATCH", "UNREPLAYABLE"] as const;
export type ReplayOutcome = (typeof REPLAY_OUTCOMES)[number];

/**
 * Why a replay could not run (UNREPLAYABLE) or did not reproduce (MISMATCH). UNREPLAYABLE is not INCORRECT.
 * The first seven name an unavailable or refused input; the rest name a record section whose recomputation differs.
 */
export const REPLAY_REASONS = [
  "WWEP_VERSION_MISMATCH",
  "MISSING_POLICY_VERSION",
  "MISSING_REGISTRY_VERSION",
  "MISSING_RULE_VERSION",
  "MISSING_EVIDENCE",
  "EVIDENCE_DIGEST_MISMATCH",
  "RECORD_INVALID",
  "REBUILD_REFUSED",
  "DIGEST_MISMATCH",
  "SUBJECT_MISMATCH",
  "SNAPSHOT_MISMATCH",
  "EVIDENCE_MISMATCH",
  "CLAIM_MISMATCH",
  "ASSESSMENT_MISMATCH",
  "PROVENANCE_MISMATCH",
  "LIMITATION_MISMATCH",
  "CONFLICT_MISMATCH",
  "VIOLATION_MISMATCH",
  "POLICY_VERSION_MISMATCH",
  "RULE_VERSION_MISMATCH",
  "VERSION_MISMATCH",
] as const;
export type ReplayReason = (typeof REPLAY_REASONS)[number];

/** Replay reasons that mean "could not run": none of them says anything about correctness. */
export const UNREPLAYABLE_REASONS: readonly ReplayReason[] = [
  "WWEP_VERSION_MISMATCH",
  "MISSING_POLICY_VERSION",
  "MISSING_REGISTRY_VERSION",
  "MISSING_RULE_VERSION",
  "MISSING_EVIDENCE",
  "EVIDENCE_DIGEST_MISMATCH",
  "RECORD_INVALID",
  "REBUILD_REFUSED",
];

export const DIFF_CATEGORIES = [
  "record",
  "subject",
  "snapshot",
  "claims",
  "evidence",
  "assessments",
  "limitations",
  "conflicts",
  "violations",
  "policyVersions",
  "ruleVersions",
  "versions",
  "provenance",
  "lifecycle",
] as const;
export type DiffCategory = (typeof DIFF_CATEGORIES)[number];

/** Terms WallPrint itself never uses as a verdict or in WalletWall-authored text. Attributed external statements may. */
export const RESERVED_ASSURANCE_TERMS = Object.freeze([
  "VERIFIED",
  "CERTIFIED",
  "SAFE",
  "SOLVENT",
  "COMPLIANT",
  "AUDITED",
  "APPROVED",
  "TRUSTED",
  "INVESTMENT-GRADE",
] as const);

export const WALLPRINT_LIMITS = {
  externalAssessments: 32,
  reasonLength: 128,
} as const;

export const WALLPRINT_PRINCIPLE = "WalletWall isn't always right. WallPrint keeps the record.";

/** Non-negotiable invariants, each pinned by a test. */
export const WALLPRINT_INVARIANTS = Object.freeze([
  "correction != mutation",
  "supersession != deletion",
  "withdrawal != deletion",
  "assessor disagreement is preserved",
  "assessor agreement != independent corroboration",
  "provider multiplicity != independent authority",
  "transport != authority",
  "WalletWall-derived != upstream authority",
  "absence of assessment != failed assessment",
  "UNKNOWN != FALSE",
  "NO_RESULT != ZERO",
  "digest integrity != factual truth",
  "receipt integrity != factual truth",
  "WallPrint lifecycle != WWEP evidence state",
  "UNREPLAYABLE != INCORRECT",
] as const);
