/**
 * WallPrint trust-checkpoint vocabulary: the fixed names of the signed registry-head + acceptance-ledger checkpoint, in a
 * module with no imports so a verifier that runs in a browser can share them, exactly as attestation-vocabulary.ts does.
 * Nothing here decides anything; it names things. Design: spec/WALLPRINT_ATTESTATIONS.md, section 23.
 *
 *   signature validity != factual truth
 *   checkpoint validity != record truth
 *   checkpoint validity != assessor correctness
 *   registry binding != issuer factual correctness
 *   historical acceptance != current key status
 *   assessor agreement != corroboration
 *
 * A checkpoint authenticates which signing-key registry state and which acceptance-ledger prefix were committed together.
 * It does not certify any WallPrint claim, any attestation or any assessor. This lane contains no signing operation, no
 * private key and no production governance key.
 */

/** The checkpoint format version. It fixes how both committed heads are read: the registry snapshot format, the ledger entry construction and the digest construction. */
export const CHECKPOINT_VERSION = "0.1";
export const CHECKPOINT_VERSIONS = ["0.1"] as const;
export const CHECKPOINT_TYPE = "walletwall.wallprint.trust-checkpoint";
export const GOVERNANCE_TRUST_ROOT_TYPE = "walletwall.wallprint.governance-trust-root";
export const GOVERNANCE_TRUST_ROOT_FORMAT_VERSION = "0.1";
export const CHECKPOINT_VERIFICATION_VERSION = "0.1";

/** What a checkpoint signature is for. One purpose today; it is signed, it selects the domain tag and it is what a governance key is authorized for. */
export const CHECKPOINT_PURPOSES = ["REGISTRY_LEDGER_CHECKPOINT"] as const;
export type CheckpointPurpose = (typeof CHECKPOINT_PURPOSES)[number];

/**
 * What a governance key can be scoped to in a trust root. `STANDING_HEAD` is the deferred lifecycle-ledger-head purpose named
 * in spec/WALLPRINT_ATTESTATIONS.md (sections 2 and 21); no statement of that purpose is defined or accepted by this lane. It is in
 * the list so a root can scope a key to it and the checkpoint verifier can refuse that key: authorization is per purpose.
 */
export const GOVERNANCE_KEY_PURPOSES = ["REGISTRY_LEDGER_CHECKPOINT", "STANDING_HEAD"] as const;
export type GovernanceKeyPurpose = (typeof GOVERNANCE_KEY_PURPOSES)[number];

/**
 * Domain separation, the same construction as an attestation: the signed bytes are `UTF-8(tag) || 0x00 || UTF-8(RFC 8785(statement))`.
 * The tag names the product, the object, the format version and the purpose, is ASCII with no 0x00, and differs from every attestation
 * tag, so a signature over a checkpoint is not a signature over any attestation, and the reverse.
 */
export const CHECKPOINT_DOMAIN_TAGS: Readonly<Record<CheckpointPurpose, string>> = Object.freeze({
  REGISTRY_LEDGER_CHECKPOINT: "walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint",
});

export const CHECKPOINT_LIMITS = Object.freeze({
  /** A checkpoint is a few hundred bytes. */
  maxEnvelopeBytes: 4 * 1024,
  maxJsonDepth: 8,
  maxTrustRootKeys: 16,
});

/** Dimensions of a checkpoint verification result. They never collapse into one verdict. */
export const CHECKPOINT_PARSE_STATUSES = ["PARSED", "MALFORMED", "UNSUPPORTED_VERSION"] as const;
export const CHECKPOINT_PARSE_PROBLEMS = ["BODY_TOO_LARGE", "DUPLICATE_KEY", "FORBIDDEN_STRUCTURE", "SHAPE", "SYNTAX", "TOO_DEEP", "VERSION_MISMATCH"] as const;
export const GOVERNANCE_KEY_KNOWLEDGE = ["KNOWN", "UNKNOWN", "MATERIAL_MISMATCH", "NOT_EVALUATED"] as const;
export const GOVERNANCE_AUTHORIZATION = ["AUTHORIZED", "NOT_AUTHORIZED", "NOT_EVALUATED"] as const;
export const LOG_CHAIN_STATUSES = ["VALID", "INVALID", "NOT_SUPPLIED"] as const;
/** How the supplied log relates to what the checkpoint committed: exactly it, it with more after, or no usable match. */
export const LOG_STATE_STATUSES = ["MATCHED", "EXTENDED", "MISMATCHED", "NOT_EVALUATED"] as const;
export const CROSS_BINDING_STATUSES = ["CONSISTENT", "INCONSISTENT", "NOT_EVALUATED"] as const;
export const ANCHOR_STATUSES = ["NO_ANCHOR", "AT_ANCHOR", "ADVANCES_ANCHOR", "BEHIND_ANCHOR", "FORKED_FROM_ANCHOR", "ANCHOR_INVALID", "NOT_EVALUATED"] as const;
export const IDENTITY_STATUSES = ["MATCHED", "MISMATCHED", "NOT_COMPARED"] as const;

/** Why a governance signer is not authorized or not evaluated. Fixed codes; no caller text is ever echoed. */
export const SIGNER_REASONS = ["PURPOSE_NOT_GRANTED", "SIGNER_KEY_MATERIAL_MISMATCH", "SIGNER_UNKNOWN", "TRUST_ROOT_INVALID", "TRUST_ROOT_NOT_SUPPLIED"] as const;

/** Why the supplied registry chain or acceptance ledger is not the state the checkpoint committed. */
export const LOG_REASONS = [
  "LEDGER_CHAIN_INVALID",
  "LEDGER_EXTENDED_BEYOND_CHECKPOINT",
  "LEDGER_HEAD_MISMATCH",
  "LEDGER_NOT_SUPPLIED",
  "LEDGER_TRUNCATED",
  "REGISTRY_CHAIN_INVALID",
  "REGISTRY_EXTENDED_BEYOND_CHECKPOINT",
  "REGISTRY_HEAD_MISMATCH",
  "REGISTRY_NOT_SUPPLIED",
  "REGISTRY_TRUNCATED",
] as const;

export const CROSS_BINDING_REASONS = ["LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD", "LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION", "LEDGER_REGISTRY_DIGEST_MISMATCH", "STATE_NOT_ESTABLISHED"] as const;

export const ANCHOR_REASONS = ["ANCHOR_CONTINUITY_NOT_CHECKED", "ANCHOR_MALFORMED", "CHECKPOINT_BEHIND_ANCHOR", "CHECKPOINT_FORKS_FROM_ANCHOR"] as const;

export const IDENTITY_REASONS = ["CHECKPOINT_DIGEST_MISMATCH"] as const;

/** Limitations are the things a reader must not assume. They are reported, never hidden, and sorted. */
export const CHECKPOINT_LIMITATIONS = ["CHECKPOINT_UNANCHORED", "LEDGER_EXTENDED_BEYOND_CHECKPOINT", "REGISTRY_EXTENDED_BEYOND_CHECKPOINT"] as const;

/** What a valid checkpoint establishes, stated with its precondition and nothing about truth. */
export const CHECKPOINT_ESTABLISHES =
  "The holder of the private key for the stated governance public key signed exactly this statement: one signing-key registry head and one acceptance-ledger head, committed together, under the checkpoint purpose.";

/** What no checkpoint, in any state, establishes. */
export const CHECKPOINT_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "factual truth of any WallPrint record, claim or attestation",
  "that any assessor or issuer is correct, independent or authoritative",
  "that any attestation in the ledger is valid, matches its target or was rightly accepted",
  "that a registry binding names the right party, or that a key is relied upon today",
  "that the checkpoint is the latest state",
  "anything about registry versions or ledger entries after the committed heads",
  "when the checkpoint was signed or when any entry was accepted",
  "that the supplied governance trust root is WalletWall's production key set",
  "safety, solvency, regulatory compliance or investment merit",
]);

export const CHECKPOINT_INVARIANTS = Object.freeze([
  "signature validity != factual truth",
  "checkpoint validity != record truth",
  "checkpoint validity != assessor correctness",
  "registry binding != issuer factual correctness",
  "historical acceptance != current key status",
  "assessor agreement != corroboration",
  "valid checkpoint != current checkpoint",
  "checkpoint signer != self-declared signer",
] as const);
