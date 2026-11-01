/**
 * WallPrint 0.1 on WWEP 0.1 — the canonical disclosure record and its append-only history.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * Named exports only. This module is NOT imported by main.ts, server.ts or tools.ts: WallPrint is a domain contract
 * in this lane, not an MCP tool, so the shipped bundle and its hashes are unchanged.
 */

export {
  ASSESSOR_ROLES,
  DIFF_CATEGORIES,
  EVIDENCE_ITEM_KINDS,
  LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  REPLAY_OUTCOMES,
  REPLAY_REASONS,
  UNREPLAYABLE_REASONS,
  RESERVED_ASSURANCE_TERMS,
  RESERVED_IDENTITY_STEMS,
  SUPERSESSION_KINDS,
  WALLETWALL_ASSESSOR_ID,
  WALLPRINT_CANONICALIZATION,
  WALLPRINT_DIGEST_ALGORITHM,
  WALLPRINT_INVARIANTS,
  WALLPRINT_LIMITS,
  WALLPRINT_PRINCIPLE,
  WALLPRINT_VERSION,
} from "./vocabulary.ts";
export type { AssessorRole, DiffCategory, EvidenceItemKind, LifecycleState, ReplayOutcome, ReplayReason, SupersessionKind } from "./vocabulary.ts";

export { WallPrintError, finding } from "./errors.ts";
export type { Finding, WallPrintErrorCode } from "./errors.ts";

export { claimGroupKey, sameSubjectIdentity, subjectIdentity, subjectIdentityKeys, supersessionIdentity, supersessionIdentityKeys } from "./identity.ts";

export { assertWalletWallText, findReservedAssuranceTerms, findSecretLike, isReservedAssuranceCode, isReservedIdentity, isReservedPolicyId } from "./language.ts";

export {
  ASSESSMENT_CODE_RE,
  AssessmentRecordSchema,
  ClaimRecordSchema,
  ExternalAssessmentInputSchema,
  HEX64_RE,
  POLICY_ID_RE,
  RECORD_ID_RE,
  SnapshotInputSchema,
  SupersedesSchema,
  WallPrintRecordSchema,
  buildWallPrintSnapshot,
  listAssessments,
  validateWallPrintRecord,
  verifyWallPrintDigest,
  wallPrintDigest,
  wallPrintPayload,
} from "./record.ts";
export type { AssessmentRecord, ClaimRecord, DigestVerification, ExternalAssessmentInput, RecordValidation, SnapshotInput, Supersedes, WallPrintPayload, WallPrintRecord } from "./record.ts";

export { CANONICAL_INSTANT_RE, LifecycleEventSchema, createWallPrintHistory, isCanonicalInstant, validateHistoryGraph, verifyLifecycleChain } from "./history.ts";
export type { HistoryValidation, LifecycleEvent, Lineage, SuccessorRef, WallPrintHistory, WallPrintView } from "./history.ts";

export { createEvidenceStore, isUnreplayableReason, replayWallPrint } from "./replay.ts";
export type { EvidenceStore, ReplayResult } from "./replay.ts";

export { diffWallPrints } from "./diff.ts";
export type { DiffChange, WallPrintDiff } from "./diff.ts";

export { RECEIPT_DOES_NOT_ESTABLISH, RECEIPT_ESTABLISHES, WallPrintReceiptSchema, verifyReceipt, wallPrintReceipt } from "./receipt.ts";
export type { ReceiptReason, ReceiptVerification, WallPrintReceipt } from "./receipt.ts";

export {
  REFERENCE_DOES_NOT_ESTABLISH,
  REFERENCE_ENVELOPE_TYPE,
  REFERENCE_IDENTIFIES,
  REFERENCE_MAX_LENGTH,
  REFERENCE_OUTCOMES,
  REFERENCE_PREFIX,
  REFERENCE_TARGETS,
  REFERENCE_VERSION,
  SUPPORTED_WALLPRINT_VERSIONS,
  encodeReference,
  encodeReferenceEnvelope,
  parseReference,
  parseReferenceEnvelope,
  referenceEnvelope,
  referenceFindings,
  referenceOf,
  resolveReference,
  tryReference,
} from "./reference.ts";
export type { FoundRecord, ReferenceOutcome, ReferenceParse, ReferenceProblem, ReferenceResolution, ReferenceTarget, WallPrintPortableReference, WallPrintReferenceEnvelope } from "./reference.ts";

export {
  ASSESSOR_IMPORT_DOES_NOT_ESTABLISH,
  ASSESSOR_IMPORT_ESTABLISHES,
  ASSESSOR_IMPORT_INVARIANTS,
  ASSESSOR_IMPORT_MAX_BYTES,
  ASSESSOR_IMPORT_MAX_DEPTH,
  ASSESSOR_IMPORT_MAX_INPUTS,
  ASSESSOR_IMPORT_REFUSALS,
  ASSESSOR_IMPORT_STATUSES,
  ASSESSOR_IMPORT_VERSION,
  importExternalAssessments,
} from "./assessor-import.ts";
export type {
  AssessorImportContext,
  AssessorImportInput,
  AssessorImportRefusal,
  AssessorImportResult,
  AssessorImportStatus,
} from "./assessor-import.ts";
