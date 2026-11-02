/**
 * WallPrint governance-ceremony vocabulary: the fixed names of the governance bootstrap, the root-to-operational-key
 * authorization, the ceremony transcript and the public ceremony policy, in a module with no imports so a verifier that runs in a
 * browser can share them, exactly as attestation-vocabulary.ts and checkpoint-vocabulary.ts do. Nothing here decides anything; it
 * names things. Design: spec/WALLPRINT_ATTESTATIONS.md, section 24; procedure: docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md.
 *
 *   bootstrap != trust until it is pinned out of band
 *   root authorization != checkpoint validity
 *   operational key != governance root
 *   governance signature != factual truth
 *   historical signature validity != current reliance
 *   ceremony transcript != proof that the ceremony happened
 *   root-signed replacement != root-compromise recovery
 *   synthetic key != production key
 *
 * The hierarchy is: an offline governance root authorizes one operational checkpoint-signing key at a time; the operational key signs
 * the registry + acceptance-ledger checkpoints of spec section 23. This lane contains no signing operation, no private key, no
 * production root and no production operational key.
 */

/** One format version for the bootstrap, the authorization, the transcript and the policy. A change to a field, a tag or a limit is a new version. */
export const GOVERNANCE_FORMAT_VERSION = "0.1";
export const GOVERNANCE_FORMAT_VERSIONS = ["0.1"] as const;
export const GOVERNANCE_BOOTSTRAP_TYPE = "walletwall.wallprint.governance-bootstrap";
export const GOVERNANCE_AUTHORIZATION_TYPE = "walletwall.wallprint.governance-authorization";
export const GOVERNANCE_TRANSCRIPT_TYPE = "walletwall.wallprint.governance-ceremony-transcript";
export const GOVERNANCE_POLICY_TYPE = "walletwall.wallprint.governance-ceremony-policy";
export const GOVERNANCE_VERIFICATION_VERSION = "0.1";

/**
 * What the governance root may be used for: authorizing the operational checkpoint-signing key, and nothing else. The root never signs a
 * checkpoint, a record, an attestation, an assessment, a wallet transaction, a deployment credential or an MCP tool authorization.
 */
export const ROOT_PURPOSES = ["CHECKPOINT_KEY_AUTHORIZATION"] as const;
export type RootPurpose = (typeof ROOT_PURPOSES)[number];

/** What an authorization statement is for. It is signed, it selects the domain tag, and it is the root's one purpose. */
export const AUTHORIZATION_PURPOSES = ["CHECKPOINT_KEY_AUTHORIZATION"] as const;
export type AuthorizationPurpose = (typeof AUTHORIZATION_PURPOSES)[number];

/**
 * What an operational key may be granted: the checkpoint purpose of spec section 23 and nothing else. `STANDING_HEAD` is a reserved,
 * unimplemented governance purpose (checkpoint-vocabulary.ts) and is not grantable; no attestation purpose is ever grantable.
 */
export const OPERATIONAL_KEY_PURPOSES = ["REGISTRY_LEDGER_CHECKPOINT"] as const;
export type OperationalKeyPurpose = (typeof OPERATIONAL_KEY_PURPOSES)[number];

/** Purposes no governance key may ever be granted by this ceremony: they belong to other signers, other lanes or no signer at all. */
export const NOT_GRANTABLE_PURPOSES = ["RECORD_PUBLICATION", "ASSESSMENT_ORIGIN", "ISSUER_ASSESSMENT_ORIGIN", "STANDING_HEAD"] as const;

/** The root's decision about the key an authorization supersedes. */
export const SUPERSEDED_STANDINGS = ["RETIRED", "COMPROMISED"] as const;
export type SupersededStanding = (typeof SUPERSEDED_STANDINGS)[number];

/**
 * Domain separation, the same construction as an attestation and a checkpoint: the signed bytes are
 * `UTF-8(tag) || 0x00 || UTF-8(RFC 8785(statement))`, built by the one shared function (`domainSeparatedPreimage`). The tag names the
 * product, the object, the format version and the purpose, is ASCII with no 0x00, and is neither an attestation tag nor the checkpoint tag
 * nor a prefix of either, so a signature over an authorization is not a signature over anything else, and the reverse.
 */
export const AUTHORIZATION_DOMAIN_TAGS: Readonly<Record<AuthorizationPurpose, string>> = Object.freeze({
  CHECKPOINT_KEY_AUTHORIZATION: "walletwall.wallprint.governance-authorization/0.1/checkpoint-key-authorization",
});

/** Every key id of a synthetic rehearsal starts with this. A production verifier refuses it unless the caller says it is rehearsing. */
export const SYNTHETIC_KEY_ID_PREFIX = "synthetic-";
export const SYNTHETIC_CEREMONY_ID_PREFIX = "synthetic-";

export const GOVERNANCE_LIMITS = Object.freeze({
  maxBootstrapBytes: 2 * 1024,
  maxAuthorizationBytes: 4 * 1024,
  maxTranscriptBytes: 32 * 1024,
  maxJsonDepth: 8,
  maxAuthorizations: 256,
  maxTranscriptEvents: 64,
  maxTooling: 16,
  maxConfirmations: 16,
  maxEpoch: 9999,
});

/** What a public bootstrap may be confirmed through. Origins, not channels: two confirmations from one origin are one origin. */
export const CONFIRMATION_ORIGINS = ["GITHUB", "PACKAGE_REGISTRY", "WALLETWALL_WEBSITE", "VERIFIER_RELEASE_BUNDLE", "PRINTED_OR_IN_PERSON", "THIRD_PARTY_PUBLICATION"] as const;
export type ConfirmationOrigin = (typeof CONFIRMATION_ORIGINS)[number];
export const MINIMUM_INDEPENDENT_ORIGINS = 2;

// ─── ceremony transcript ─────────────────────────────────────────────────────

export const CEREMONY_MODES = ["SYNTHETIC_REHEARSAL", "LIVE"] as const;
export type CeremonyMode = (typeof CEREMONY_MODES)[number];
export const CEREMONY_KINDS = ["ROOT_BOOTSTRAP", "OPERATIONAL_KEY_ACTION"] as const;
export type CeremonyKind = (typeof CEREMONY_KINDS)[number];
export const CEREMONY_ROLES = ["OPERATOR", "WITNESS"] as const;
export type CeremonyRole = (typeof CEREMONY_ROLES)[number];

/** What a participant may attest happened. A closed set: a transcript never carries raw shell output, free text or a screenshot. */
export const CEREMONY_EVENTS = [
  "CEREMONY_OPENED",
  "ROLES_ACKNOWLEDGED",
  "TOOLING_VERIFIED",
  "NETWORK_CONFIRMED_OFFLINE",
  "ROOT_PUBLIC_KEY_RECORDED",
  "BACKUP_CREATED",
  "BACKUP_RECOVERY_TESTED",
  "ROOT_KEY_RESTORED",
  "OPERATIONAL_KEY_AUTHORIZED",
  "WORKING_SECRET_REMOVED",
  "CEREMONY_CLOSED",
] as const;
export type CeremonyEvent = (typeof CEREMONY_EVENTS)[number];

/** The checklist items a participant attests, each tied to one event. */
export const CHECKLIST_ITEMS = [
  "ROLES_UNDERSTOOD",
  "TOOL_DIGESTS_MATCH_PUBLISHED",
  "MEDIA_BOOTED_FROM_VERIFIED_IMAGE",
  "NETWORK_PHYSICALLY_DISABLED",
  "KEY_FROM_OS_CSPRNG",
  "NO_CLIPBOARD_USED",
  "NO_SHELL_HISTORY_WRITTEN",
  "NO_SECRET_IN_TRANSCRIPT",
  "BACKUP_ENCRYPTED",
  "PASSPHRASE_STORED_APART_FROM_MEDIA",
  "NO_CLOUD_OR_REPOSITORY_STORAGE",
  "RECOVERED_PUBLIC_KEY_MATCHES",
  "RESTORED_PUBLIC_KEY_MATCHES_PINNED_BOOTSTRAP",
  "AUTHORIZATION_SIGNED_OFFLINE",
  "OPERATIONAL_KEY_DISTINCT_FROM_ROOT",
  "OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE",
  "EPHEMERAL_MEDIA_POWERED_OFF",
  "NO_PRIVATE_MATERIAL_ON_PERSISTENT_STORAGE",
  "ONLY_PUBLIC_ARTIFACTS_EXPORTED",
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

/** The checklist an event must carry, exactly: a missing item is an incomplete ceremony and an extra one is an unknown claim. */
export const EVENT_CHECKLIST: Readonly<Record<CeremonyEvent, readonly ChecklistItem[]>> = Object.freeze({
  CEREMONY_OPENED: [],
  ROLES_ACKNOWLEDGED: ["ROLES_UNDERSTOOD"],
  TOOLING_VERIFIED: ["MEDIA_BOOTED_FROM_VERIFIED_IMAGE", "TOOL_DIGESTS_MATCH_PUBLISHED"],
  NETWORK_CONFIRMED_OFFLINE: ["NETWORK_PHYSICALLY_DISABLED"],
  ROOT_PUBLIC_KEY_RECORDED: ["KEY_FROM_OS_CSPRNG", "NO_CLIPBOARD_USED", "NO_SECRET_IN_TRANSCRIPT", "NO_SHELL_HISTORY_WRITTEN"],
  BACKUP_CREATED: ["BACKUP_ENCRYPTED", "NO_CLOUD_OR_REPOSITORY_STORAGE", "PASSPHRASE_STORED_APART_FROM_MEDIA"],
  BACKUP_RECOVERY_TESTED: ["RECOVERED_PUBLIC_KEY_MATCHES"],
  ROOT_KEY_RESTORED: ["NO_CLIPBOARD_USED", "NO_SHELL_HISTORY_WRITTEN", "RESTORED_PUBLIC_KEY_MATCHES_PINNED_BOOTSTRAP"],
  OPERATIONAL_KEY_AUTHORIZED: ["AUTHORIZATION_SIGNED_OFFLINE", "OPERATIONAL_KEY_DISTINCT_FROM_ROOT", "OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE"],
  WORKING_SECRET_REMOVED: ["EPHEMERAL_MEDIA_POWERED_OFF", "NO_PRIVATE_MATERIAL_ON_PERSISTENT_STORAGE"],
  CEREMONY_CLOSED: ["ONLY_PUBLIC_ARTIFACTS_EXPORTED"],
});

/** The event order of each ceremony kind. `OPERATIONAL_KEY_AUTHORIZED` may repeat; every other event occurs once. */
export const CEREMONY_SEQUENCES: Readonly<Record<CeremonyKind, readonly CeremonyEvent[]>> = Object.freeze({
  ROOT_BOOTSTRAP: [
    "CEREMONY_OPENED",
    "ROLES_ACKNOWLEDGED",
    "TOOLING_VERIFIED",
    "NETWORK_CONFIRMED_OFFLINE",
    "ROOT_PUBLIC_KEY_RECORDED",
    "BACKUP_CREATED",
    "BACKUP_RECOVERY_TESTED",
    "OPERATIONAL_KEY_AUTHORIZED",
    "WORKING_SECRET_REMOVED",
    "CEREMONY_CLOSED",
  ],
  OPERATIONAL_KEY_ACTION: ["CEREMONY_OPENED", "ROLES_ACKNOWLEDGED", "TOOLING_VERIFIED", "NETWORK_CONFIRMED_OFFLINE", "ROOT_KEY_RESTORED", "OPERATIONAL_KEY_AUTHORIZED", "WORKING_SECRET_REMOVED", "CEREMONY_CLOSED"],
});

/** The backup floor a live ceremony must record. Counts the participants attest; the transcript cannot prove them. */
export const BACKUP_MINIMUMS = Object.freeze({ mediaCopies: 3, mediaLocations: 2, passphraseEnvelopes: 2, passphraseLocations: 2 });

// ─── result vocabularies ─────────────────────────────────────────────────────

export const BOOTSTRAP_PARSE_STATUSES = ["PARSED", "MALFORMED", "UNSUPPORTED_VERSION", "NOT_SUPPLIED"] as const;
export const BOOTSTRAP_PIN_STATUSES = ["PINNED", "UNPINNED", "MISMATCHED", "NOT_EVALUATED"] as const;
export const BOOTSTRAP_EPOCH_STATUSES = ["ACCEPTED", "BELOW_MINIMUM", "NOT_EVALUATED"] as const;
export const CHAIN_STATUSES = ["VALID", "INVALID", "NOT_CHECKED", "NOT_SUPPLIED", "NOT_EVALUATED"] as const;
export const HELD_STATUSES = ["NO_HELD_STATE", "AT_HELD", "ADVANCES_HELD", "BEHIND_HELD", "FORKED_FROM_HELD", "HELD_INVALID", "NOT_EVALUATED"] as const;
export const KEY_STANDINGS = ["CURRENT", "RETIRED", "COMPROMISED"] as const;
export type KeyStanding = (typeof KEY_STANDINGS)[number];
export const RELIANCE_STATUSES = ["RELIED_UPON", "NOT_RELIED_UPON", "NOT_EVALUATED"] as const;
export const RELIANCE_STANDINGS = ["CURRENT", "RETIRED", "COMPROMISED", "UNKNOWN", "NOT_EVALUATED"] as const;

export const BOOTSTRAP_REASONS = [
  "BOOTSTRAP_ALGORITHM_UNSUPPORTED",
  "BOOTSTRAP_DIGEST_MISMATCH",
  "BOOTSTRAP_DIGEST_PIN_MALFORMED",
  "BOOTSTRAP_EPOCH_BELOW_MINIMUM",
  "BOOTSTRAP_KEY_INADMISSIBLE",
  "BOOTSTRAP_MALFORMED",
  "BOOTSTRAP_NOT_SUPPLIED",
  "BOOTSTRAP_PURPOSE_NOT_PERMITTED",
  "BOOTSTRAP_VERSION_UNSUPPORTED",
  "MINIMUM_EPOCH_MALFORMED",
  "SYNTHETIC_KEY_REFUSED",
] as const;

export const CHAIN_REASONS = [
  "AUTHORIZATIONS_EMPTY",
  "AUTHORIZATIONS_NOT_SUPPLIED",
  "AUTHORIZATION_MALFORMED",
  "AUTHORIZATION_VERSION_UNSUPPORTED",
  "AUTHORIZED_KEY_ALGORITHM_UNSUPPORTED",
  "AUTHORIZED_KEY_INADMISSIBLE",
  "AUTHORIZED_KEY_IS_ROOT_KEY",
  "AUTHORIZED_KEY_REUSED",
  "GENERATION_NOT_CONSECUTIVE",
  "PURPOSES_NOT_ORDERED",
  "PURPOSE_NOT_PERMITTED",
  "ROOT_EPOCH_MISMATCH",
  "ROOT_MISMATCH",
  "SUPERSEDES_DIGEST_MISMATCH",
  "SUPERSEDES_MISSING",
  "SUPERSEDES_UNEXPECTED",
  "SYNTHETIC_KEY_REFUSED",
  "TOO_MANY_AUTHORIZATIONS",
] as const;

export const HELD_REASONS = ["GOVERNANCE_FORKS_FROM_HELD_STATE", "GOVERNANCE_ROLLED_BACK_BELOW_HELD_GENERATION", "HELD_STATE_MALFORMED"] as const;

export const RELIANCE_REASONS = [
  "BOOTSTRAP_NOT_PINNED",
  "CHECKPOINT_BEFORE_RETAINED_STATE",
  "CHECKPOINT_BEYOND_RETAINED_STATE",
  "CHECKPOINT_HEAD_DIFFERS_AT_RETAINED_STATE",
  "CHECKPOINT_NOT_PARSED",
  "GOVERNANCE_STATE_NOT_USABLE",
  "KEY_SUPERSEDED_NOT_RETAINED",
  "SIGNER_KEY_MATERIAL_MISMATCH",
  "SIGNER_NOT_AUTHORIZED_BY_ROOT",
] as const;

export const PIN_REASONS = [
  "CANDIDATE_MALFORMED",
  "CONFIRMATIONS_MALFORMED",
  "CONFIRMATION_DIGEST_MISMATCH",
  "EPOCH_NOT_GREATER",
  "INSUFFICIENT_INDEPENDENT_ORIGINS",
  "PINNED_STATE_MALFORMED",
  "ROOT_KEY_PREVIOUSLY_RETIRED",
  "ROOT_KEY_UNCHANGED",
  "SYNTHETIC_KEY_REFUSED",
] as const;

/** Limitations are the things a reader must not assume. They are reported, never hidden, and sorted. */
export const GOVERNANCE_LIMITATIONS = ["BOOTSTRAP_UNPINNED", "GOVERNANCE_STATE_UNHELD", "SUPERSEDED_KEY_RETAINED_STATE_ONLY"] as const;

export const TRANSCRIPT_REASONS = [
  "ARTIFACT_DIGEST_MISMATCH",
  "AUTHORIZATION_ROOT_MISMATCH",
  "BACKUP_BELOW_MINIMUM",
  "BACKUP_COUNTS_IMPOSSIBLE",
  "BACKUP_NOT_ALL_DRILLED",
  "CEREMONY_ID_MODE_MISMATCH",
  "CHECKLIST_INCOMPLETE",
  "EVENT_ORDER_INVALID",
  "EVENT_REQUIRED_MISSING",
  "LIVE_MODE_WITH_SYNTHETIC_KEY",
  "LIVE_NOT_CROSS_CHECKED",
  "ONE_ATTESTER_ONLY",
  "OPERATIONAL_KEY_EVENTS_MISMATCH",
  "PARTICIPANTS_INVALID",
  "SECRET_MATERIAL_SUSPECTED",
  "SYNTHETIC_MODE_WITH_NON_SYNTHETIC_KEY",
  "TOOLING_MISMATCH",
  "TRANSCRIPT_MALFORMED",
  "TRANSCRIPT_VERSION_UNSUPPORTED",
] as const;

export const TRANSCRIPT_LIMITATIONS = ["ARTIFACTS_NOT_CROSS_CHECKED", "TOOLING_NOT_CROSS_CHECKED"] as const;

export const SECRET_SCAN_CODES = [
  "AGE_SECRET_IDENTITY",
  "CI_SECRET_REFERENCE",
  "ENV_SECRET_NAME",
  "PEM_PRIVATE_KEY_BLOCK",
  "PKCS8_ED25519_HEADER",
  "SCAN_DEPTH_EXCEEDED",
  "SECRET_FIELD_NAME",
  "SECRET_VALUE_ASSIGNMENT",
  "SEED_HEX_NEAR_SECRET_WORD",
  "SEED_PHRASE_SHAPE",
] as const;
export type SecretScanCode = (typeof SECRET_SCAN_CODES)[number];

// ─── fixed sentences ─────────────────────────────────────────────────────────

/** What a valid governance state establishes, stated with its precondition and nothing about truth or custody. */
export const GOVERNANCE_ESTABLISHES =
  "Only when the bootstrap was pinned out of band: the holder of the private key for the pinned root public key signed each authorization in the chain, so each listed operational key was authorized by that root, for the listed purposes, at the listed generation. Otherwise this chain establishes only what an unpinned artifact establishes.";

/** What no governance state, in any condition, establishes. */
export const GOVERNANCE_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "that the supplied bootstrap is WalletWall's production root, unless the caller pinned it through channels the caller relies upon",
  "that a ceremony took place, or that its machine, media or participants were uncompromised",
  "that the root private key is uncompromised, held apart or recoverable",
  "that an authorized operational key is uncompromised or that what it signed is right",
  "that the head generation is the latest governance state",
  "factual truth of any record, claim, attestation, assessor or issuer",
  "safety, solvency, regulatory compliance or investment merit",
]);

/** What a ceremony transcript establishes: a record of what participants attest, cross-checked against public artifacts. */
export const TRANSCRIPT_ESTABLISHES =
  "That the transcript is complete and consistent with the supplied public artifacts: every required event and checklist item is present in order, attested by both roles, and every digest it records equals the digest of the artifact it names.";

export const TRANSCRIPT_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "that the ceremony took place as described, or that its machine, media or participants were uncompromised",
  "that any checklist item is true: it records what participants attest, nothing more",
  "that the root private key was generated from true randomness, backed up as stated or removed from the working medium",
  "that the tooling digests recorded are the digests of the tools that ran, unless the verifier cross-checked them with a published tooling list",
]);

export const GOVERNANCE_INVARIANTS = Object.freeze([
  "bootstrap != trust until it is pinned out of band",
  "root authorization != checkpoint validity",
  "operational key != governance root",
  "governance signature != factual truth",
  "historical signature validity != current reliance",
  "ceremony transcript != proof that the ceremony happened",
  "root-signed replacement != root-compromise recovery",
  "synthetic key != production key",
] as const);

/**
 * The small public policy a verifier and a reviewer can read: what the ceremony may grant, which artifact versions it speaks, and the
 * floors a live ceremony records. It is data, not an engine: nothing here is evaluated beyond the checks the verifiers already make.
 */
export const GOVERNANCE_CEREMONY_POLICY = Object.freeze({
  type: GOVERNANCE_POLICY_TYPE,
  policyVersion: GOVERNANCE_FORMAT_VERSION,
  algorithms: ["ED25519"] as readonly string[],
  rootPurposes: ROOT_PURPOSES,
  operationalKeyPurposes: OPERATIONAL_KEY_PURPOSES,
  notGrantablePurposes: NOT_GRANTABLE_PURPOSES,
  artifactVersions: Object.freeze({ bootstrap: GOVERNANCE_FORMAT_VERSION, authorization: GOVERNANCE_FORMAT_VERSION, transcript: GOVERNANCE_FORMAT_VERSION, checkpoint: "0.1" }),
  domainTags: Object.freeze({ authorization: AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, checkpoint: "walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint" }),
  generations: Object.freeze({ first: "1", step: "1", maximum: String(GOVERNANCE_LIMITS.maxAuthorizations) }),
  backupMinimums: Object.freeze({
    mediaCopies: String(BACKUP_MINIMUMS.mediaCopies),
    mediaLocations: String(BACKUP_MINIMUMS.mediaLocations),
    passphraseEnvelopes: String(BACKUP_MINIMUMS.passphraseEnvelopes),
    passphraseLocations: String(BACKUP_MINIMUMS.passphraseLocations),
  }),
  participants: Object.freeze({ operators: "1", minimumWitnesses: "1" }),
  pinning: Object.freeze({ minimumIndependentOrigins: String(MINIMUM_INDEPENDENT_ORIGINS), origins: CONFIRMATION_ORIGINS }),
});
