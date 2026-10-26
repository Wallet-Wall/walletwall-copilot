// The canvas's words for the engine's states and limitation codes: one line per code, the same on The Wall, in the
// WallPrint disclosure document and on the public WallPrint page. Data only: this module imports nothing and runs nothing,
// so the public resolver can carry these tables without the rest of the canvas.
//
// Every hint describes how well presented evidence satisfies published policy. None asserts that upstream data is true,
// that an asset is safe, or that anything is approved.

export const SUPPORT_HINTS = {
  ESTABLISHED: "Presented evidence satisfies the published policy for this claim. This does not verify that upstream data is true.",
  SUPPORTED: "Meets the policy except for authority or finality.",
  PARTIAL: "Some usable evidence exists, but it is insufficient.",
  CONFLICTING: "Evidence about the same claim disagrees, or a conflict is declared.",
  STALE: "Older than the policy allows for a current claim, or a dependency was superseded.",
  SUPERSEDED: "A later assertion replaces this one. The old assertion stays in the bundle.",
  UNKNOWN: "Sources produced no result or an error. Not false, not zero.",
  NOT_ESTABLISHED: "No admissible basis under the policy.",
};
export const FRESHNESS_HINTS = {
  CURRENT: "Newest observation is within the policy maximum age.",
  STALE: "Older than the policy maximum age.",
  PINNED: "About a specific point such as a block; recency is not required.",
  UNKNOWN_FRESHNESS: "Freshness cannot be judged from the evidence.",
};
export const FINALITY_HINTS = {
  FINALIZED: "Every relied-upon observation states finalized finality.",
  UNFINALIZED: "At least one relied-upon observation is not finalized.",
  UNKNOWN_FINALITY: "Finality was not stated for at least one observation.",
};

export const LIMITATION_LABELS = {
  NO_SOURCE: "No source or derivation supports this value.",
  NO_RESULT: "A source returned no result. No result is not zero.",
  DANGLING_REFERENCE: "A referenced record is missing from the bundle.",
  TRANSPORT_FIDELITY_NOT_VERIFIED: "Whether the transport reported chain state faithfully is not verified.",
  NOT_FINALIZED: "Relied-upon evidence is not finalized.",
  FINALITY_UNKNOWN: "Finality of the evidence is unknown.",
  STALE_EVIDENCE: "Evidence is older than the policy allows.",
  FRESHNESS_UNKNOWN: "Freshness could not be judged.",
  OBSERVATION_FROM_FUTURE: "An observation is dated after the evaluation time.",
  NO_AUTHORITATIVE_OBSERVATION: "No observation from the authority this claim type requires.",
  NON_AUTHORITATIVE_ONLY: "Only non-authoritative observations support this claim.",
  INSUFFICIENT_INDEPENDENT_CORROBORATION: "Too few independent sources agree.",
  DUPLICATE_EVIDENCE_COLLAPSED: "Duplicate evidence was counted once.",
  ORIGIN_SOURCE_KIND_MISMATCH: "An observation's origin does not match its source kind.",
  AUTHORITY_ID_MISMATCH: "The source's authority ID is not the registry authority for this deployment.",
  SUBJECT_MISMATCH: "An observation is about a different subject than the assertion.",
  INVALID_SUBJECT: "The subject is not valid for this claim type.",
  VALUE_MISMATCH: "The asserted value differs from the observed value.",
  OBSERVATION_DISAGREEMENT: "Observations disagree.",
  NOT_IN_REGISTRY: "The asset is not in the WalletWall registry.",
  CHAIN_NOT_IN_REGISTRY: "The chain is not in the WalletWall registry.",
  REGISTRY_MISMATCH: "The evidence disagrees with the registry record.",
  REGISTRY_VERIFIED_POINT_IN_TIME: "The registry was verified at a point in time and may have changed since.",
  SYMBOL_NOT_AUTHORITY: "A symbol is not an identity.",
  POLICY_MISSING: "No policy exists for this claim type.",
  DERIVATION_MISSING: "A derived claim has no derivation record.",
  DERIVATION_NOT_PERMITTED: "This claim type may not be derived.",
  MISSING_REQUIRED_DEPENDENCY: "A required input assertion is missing.",
  DEPENDENCY_CYCLE: "The dependency graph contains a cycle.",
  DEPENDENCY_SUPERSEDED: "An input assertion was superseded.",
  PINNED_DEPENDENCY_FOR_CURRENT_CLAIM: "A current claim depends on pinned evidence.",
  RULES_UNKNOWN: "The derivation rules or version are not known.",
  WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY: "A WalletWall-derived result is not an upstream authority.",
  CONFLICT_DECLARED: "A conflict was declared in the bundle.",
  CONFLICT_DETECTED: "A conflict was detected between assertions.",
  SUPERSEDED: "This assertion was superseded.",
  REGISTRY_VERSION_MISMATCH: "The bundle names a different registry version than the engine used.",
  RULES_VERSION_MISMATCH: "The bundle names a different rules version than the engine used.",
  PRICE_IS_PROVIDER_OBSERVATION: "A price is a provider observation, not an authority.",
  INVALID_VALUE: "A value is not valid for this claim type.",
};
