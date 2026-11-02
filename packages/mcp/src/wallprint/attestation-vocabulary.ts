/**
 * WallPrint attestation vocabulary: the fixed names of the detached-attestation contract, in a module with no imports so
 * a verifier that runs in a browser can share them with the engine, exactly as publication-vocabulary.ts does for the
 * public resolver. Nothing here decides anything; it names things. Design: spec/WALLPRINT_ATTESTATIONS.md.
 *
 *   record integrity != signer authentication
 *   signer authentication != assessor authority
 *   assessor authority != factual truth
 *   issuer signature != WalletWall endorsement
 *   WalletWall signature != truth certification
 *   signature validity != key currently trusted
 *   key currently trusted != key was trusted historically
 *   assessment agreement != corroboration
 *
 * This lane defines verification and trust semantics. It contains no signing operation and no private key.
 */

/** The attestation format version. Independent of the WallPrint contract version, the import envelope version and the reference version. */
export const ATTESTATION_VERSION = "0.1";
export const ATTESTATION_VERSIONS = ["0.1"] as const;
export const ATTESTATION_TYPE = "walletwall.wallprint.attestation";
export const KEY_REGISTRY_TYPE = "walletwall.wallprint.key-registry";
/** The key registry document format. Registry *versions* are decimal strings that grow by exactly one; the format version is separate. */
export const KEY_REGISTRY_FORMAT_VERSION = "0.1";
export const VERIFICATION_VERSION = "0.1";

/**
 * What a signature is for. Each purpose has one target kind, one signer kind, one domain tag and one meaning. A key is
 * authorized per purpose, so a key for one purpose never speaks for another.
 */
export const ATTESTATION_PURPOSES = ["RECORD_PUBLICATION", "ASSESSMENT_ORIGIN", "ISSUER_ASSESSMENT_ORIGIN"] as const;
export type AttestationPurpose = (typeof ATTESTATION_PURPOSES)[number];

export const TARGET_KINDS = ["WALLPRINT_RECORD", "WALLPRINT_ASSESSMENT"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const SIGNER_KINDS = ["WALLETWALL_PUBLISHER", "EXTERNAL_ASSESSOR", "ISSUER_AUTHORITY"] as const;
export type SignerKind = (typeof SIGNER_KINDS)[number];

export const PURPOSE_TARGET_KIND: Readonly<Record<AttestationPurpose, TargetKind>> = Object.freeze({
  RECORD_PUBLICATION: "WALLPRINT_RECORD",
  ASSESSMENT_ORIGIN: "WALLPRINT_ASSESSMENT",
  ISSUER_ASSESSMENT_ORIGIN: "WALLPRINT_ASSESSMENT",
});

export const PURPOSE_SIGNER_KIND: Readonly<Record<AttestationPurpose, SignerKind>> = Object.freeze({
  RECORD_PUBLICATION: "WALLETWALL_PUBLISHER",
  ASSESSMENT_ORIGIN: "EXTERNAL_ASSESSOR",
  ISSUER_ASSESSMENT_ORIGIN: "ISSUER_AUTHORITY",
});

/** The purposes a signer kind may ever be granted. A key's own `purposes` list is a subset of this. */
export const SIGNER_KIND_PURPOSES: Readonly<Record<SignerKind, readonly AttestationPurpose[]>> = Object.freeze({
  WALLETWALL_PUBLISHER: ["RECORD_PUBLICATION"],
  EXTERNAL_ASSESSOR: ["ASSESSMENT_ORIGIN"],
  ISSUER_AUTHORITY: ["ISSUER_ASSESSMENT_ORIGIN"],
});

/**
 * Domain separation. The signed bytes are `UTF-8(tag) || 0x00 || UTF-8(RFC 8785(statement))`. The tag names the product,
 * the contract, the attestation format version and the purpose; it is a closed table of ASCII strings that never contain
 * 0x00, so the first 0x00 is the one boundary. A signature over one purpose's bytes is not a signature over any other
 * purpose's bytes, and the non-JSON prefix keeps it from being a signature over any JSON-signing protocol's input.
 */
export const DOMAIN_TAGS: Readonly<Record<AttestationPurpose, string>> = Object.freeze({
  RECORD_PUBLICATION: "walletwall.wallprint.attestation/0.1/record-publication",
  ASSESSMENT_ORIGIN: "walletwall.wallprint.attestation/0.1/assessment-origin",
  ISSUER_ASSESSMENT_ORIGIN: "walletwall.wallprint.attestation/0.1/issuer-assessment-origin",
});

/** Signature algorithms. The algorithm is inside the signed statement and in the key's registry entry; it is never read from unsigned data. */
export const SUPPORTED_ALGORITHMS = ["ED25519"] as const;
export type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];
export const ALGORITHM_SIZES: Readonly<Record<SupportedAlgorithm, { publicKeyHex: number; signatureHex: number }>> = Object.freeze({
  ED25519: { publicKeyHex: 64, signatureHex: 128 },
});

/** Key lifecycle in a key registry snapshot. A signature's cryptographic validity never depends on any of these. */
export const KEY_STATUSES = ["ACTIVE", "RETIRED", "SUPERSEDED", "REVOKED", "COMPROMISED"] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

/** Allowed status changes between two consecutive registry versions. COMPROMISED is terminal; nothing returns to ACTIVE. */
export const KEY_STATUS_TRANSITIONS: Readonly<Record<KeyStatus, readonly KeyStatus[]>> = Object.freeze({
  ACTIVE: ["RETIRED", "SUPERSEDED", "REVOKED", "COMPROMISED"],
  RETIRED: ["REVOKED", "COMPROMISED"],
  SUPERSEDED: ["REVOKED", "COMPROMISED"],
  REVOKED: ["COMPROMISED"],
  COMPROMISED: [],
});

/**
 * How a key was bound to its signer, strongest evidence first. A binding is a registry governance fact, never something a
 * key can say about itself. There is deliberately no "assessor declared it" method: a key an assessor merely tells
 * WalletWall about has no trust path from the assessor's identity to the key, so it stays unregistered and is `KEY_ONLY`.
 */
export const BINDING_METHODS = ["GOVERNANCE_DECLARATION", "ISSUER_PUBLICATION", "ASSESSOR_PUBLICATION"] as const;
export type BindingMethod = (typeof BINDING_METHODS)[number];

/** Dimensions of a verification result. They never collapse into one verdict. */
export const PARSE_STATUSES = ["PARSED", "MALFORMED", "UNSUPPORTED_VERSION"] as const;
export const SIGNATURE_STATUSES = ["VALID", "INVALID", "NOT_CHECKED"] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];
export const TARGET_STATUSES = ["MATCHED", "MISMATCHED", "NOT_COMPARED"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];
export const ACCEPTANCE_STATUSES = ["PINNED", "NOT_PINNED"] as const;
export const EVALUATION_STATUSES = ["EVALUATED", "UNAVAILABLE"] as const;
export const KEY_KNOWLEDGE = ["KNOWN", "UNKNOWN", "MATERIAL_MISMATCH"] as const;
export const BINDING_STATUSES = ["BOUND", "UNBOUND", "NOT_EVALUATED"] as const;
export const AUTHORIZATION_STATUSES = ["AUTHORIZED", "NOT_AUTHORIZED", "NOT_EVALUATED"] as const;
export const STANDING_STATUSES = ["HELD", "WITHDRAWN", "NOT_EVALUATED"] as const;
export type BindingStatus = (typeof BINDING_STATUSES)[number];
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];
export type StandingStatus = (typeof STANDING_STATUSES)[number];

/**
 * What the verified origin of a statement is, and nothing more. NONE: the signature does not stand for this target.
 * KEY_ONLY: the holder of one public key signed this statement; nothing binds that key to a named party. The BOUND_*
 * origins require a registry binding, an authorization for the purpose and a standing that has not been withdrawn.
 */
export const ORIGINS = ["NONE", "KEY_ONLY", "BOUND_ASSESSOR", "BOUND_ISSUER_AUTHORITY", "BOUND_WALLETWALL_PUBLISHER"] as const;
export type Origin = (typeof ORIGINS)[number];
export const PURPOSE_ORIGIN: Readonly<Record<AttestationPurpose, Origin>> = Object.freeze({
  RECORD_PUBLICATION: "BOUND_WALLETWALL_PUBLISHER",
  ASSESSMENT_ORIGIN: "BOUND_ASSESSOR",
  ISSUER_ASSESSMENT_ORIGIN: "BOUND_ISSUER_AUTHORITY",
});
export const ORIGIN_BASES = ["ACCEPTANCE", "CURRENT", "NONE"] as const;

/** Why a signature is invalid or not checked. Fixed codes; no caller text is ever echoed. */
export const SIGNATURE_REASONS = [
  "ALGORITHM_UNSUPPORTED",
  "KEY_LENGTH_INVALID",
  "KEY_NON_CANONICAL",
  "KEY_NOT_ON_CURVE",
  "KEY_SMALL_ORDER",
  "KEY_TORSION",
  "RUNTIME_UNSUPPORTED",
  "SIGNATURE_LENGTH_INVALID",
  "SIGNATURE_MISMATCH",
  "SIGNATURE_R_INADMISSIBLE",
  "SIGNATURE_S_NON_CANONICAL",
] as const;
export type SignatureReason = (typeof SIGNATURE_REASONS)[number];

export const TARGET_REASONS = [
  "ASSESSMENT_MISMATCH",
  "ASSESSMENT_NOT_IN_RECORD",
  "BUNDLE_DIGEST_MISMATCH",
  "DIGEST_MISMATCH",
  "FOCAL_ASSERTION_MISMATCH",
  "PURPOSE_ROLE_MISMATCH",
  "PURPOSE_TARGET_MISMATCH",
  "RECORD_ID_MISMATCH",
  "VERSION_MISMATCH",
  "WALLETWALL_ASSESSMENT_NOT_ATTESTABLE",
] as const;

export const KEY_REASONS = [
  "ASSESSOR_NOT_BOUND",
  "ISSUER_AUTHORITY_MISMATCH",
  "ISSUER_ATTRIBUTION_NOT_EVALUATED",
  "KEY_COMPROMISED",
  "KEY_MATERIAL_MISMATCH",
  "KEY_NOT_ACTIVE",
  "KEY_RETIRED",
  "KEY_REVOKED",
  "KEY_SUPERSEDED",
  "KEY_UNKNOWN",
  "KEY_REGISTRY_ANCHOR_MISMATCH",
  "KEY_REGISTRY_CHAIN_INVALID",
  "KEY_REGISTRY_DIGEST_MISMATCH",
  "KEY_REGISTRY_NOT_SUPPLIED",
  "KEY_REGISTRY_VERSION_MISSING",
  "PURPOSE_NOT_GRANTED",
  "SIGNER_ID_MISMATCH",
  "SIGNER_KIND_MISMATCH",
  "WITHDRAWN_AFTER_ACCEPTANCE",
  "WITHDRAWN_ACCEPTANCE_UNANCHORED",
  "WITHDRAWN_ACCEPTANCE_UNKNOWN",
] as const;

/** Limitations are the things a reader must not assume. They are reported, never hidden, and sorted. */
export const VERIFICATION_LIMITATIONS = [
  "ACCEPTANCE_ANCHOR_MISMATCH",
  "ACCEPTANCE_INDEX_INVALID",
  "ACCEPTANCE_NOT_PINNED",
  "ACCEPTANCE_UNANCHORED",
  "DUPLICATE_OF_EARLIER_ATTESTATION",
  "KEY_NOT_ACTIVE_NOW",
  "KEY_REGISTRY_UNANCHORED",
  "RECORD_INVALID",
  "TARGET_NOT_COMPARED",
] as const;

/** Why an attestation could not be parsed. */
export const PARSE_PROBLEMS = ["BODY_TOO_LARGE", "DUPLICATE_KEY", "FORBIDDEN_STRUCTURE", "SHAPE", "SYNTAX", "TOO_DEEP", "VERSION_MISMATCH"] as const;

export const ATTESTATION_LIMITS = Object.freeze({
  /** The largest envelope a verifier reads. An Ed25519 attestation of an assessment is a few kilobytes. */
  maxEnvelopeBytes: 16 * 1024,
  maxRegistryBytes: 256 * 1024,
  maxJsonDepth: 16,
  maxSignersPerRegistry: 256,
  maxKeysPerSigner: 16,
  maxAssessorIdsPerSigner: 16,
  maxRegistryVersions: 4096,
  maxAttestationsPerSet: 256,
  maxLedgerEntries: 100_000,
});

/** What a valid attestation establishes. Authentication of origin, stated with its precondition, and nothing about truth. */
export const ATTESTATION_ESTABLISHES = "The holder of the private key for the stated public key signed exactly the stated statement, under the stated purpose.";

/** What no attestation, at any origin level, establishes. */
export const ATTESTATION_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "factual truth of the attributed statement",
  "that the signer is independent, authoritative or correct",
  "that any other assessment in the record is endorsed",
  "that WalletWall certifies, guarantees or endorses the record",
  "that the key is relied upon today",
  "independent corroboration",
  "safety",
  "solvency",
  "regulatory compliance",
  "investment merit",
]);

/** The fixed sentence each origin level prints. They state the authenticated dimension and never use a verdict word. */
export const ORIGIN_STATEMENTS: Readonly<Record<Origin, string>> = Object.freeze({
  NONE: "No signature stands for this target.",
  KEY_ONLY: "One public key signed this statement. Nothing in the key registry binds that key to a named party for this purpose.",
  BOUND_ASSESSOR: "A key bound to the signer that lists this assessor identity signed this assessment. This authenticates the origin of the attributed statement; it does not show the statement is correct.",
  BOUND_ISSUER_AUTHORITY: "A key bound to the registry authority this assessment is attributed to signed it. This authenticates the origin of the attributed statement; it does not show the issuer endorses WalletWall or that the statement is correct.",
  BOUND_WALLETWALL_PUBLISHER: "A WalletWall publication key signed that WalletWall published exactly this record digest. This authenticates the act of publication; it is not a certification of the record's claims or of any external assessment in it.",
});

export const ATTESTATION_INVARIANTS = Object.freeze([
  "record integrity != signer authentication",
  "signer authentication != assessor authority",
  "assessor authority != factual truth",
  "issuer signature != WalletWall endorsement",
  "WalletWall signature != truth certification",
  "signature validity != key currently trusted",
  "key currently trusted != key was trusted historically",
  "assessment agreement != corroboration",
  "signature count != trust",
  "key label != signer identity",
] as const);
