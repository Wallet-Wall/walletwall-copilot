/**
 * WallPrint errors follow the engine rule (errors.ts): a fixed code and a fixed message, never a caller value.
 * Validation findings likewise carry a code and a path built from fixed field names and indices only.
 */
export type WallPrintErrorCode =
  | "INVALID_RECORD"
  | "INVALID_INPUT"
  | "UNKNOWN_RECORD"
  | "DUPLICATE_RECORD_ID"
  | "RECORD_DIGEST_MISMATCH"
  | "INVALID_TRANSITION"
  | "EVENT_TIME_ORDER"
  | "COMMIT_BEFORE_SNAPSHOT"
  | "SUPERSEDES_UNKNOWN_RECORD"
  | "SUPERSEDES_DIGEST_MISMATCH"
  | "SELF_SUPERSESSION"
  | "SUBJECT_MISMATCH"
  | "SNAPSHOT_ORDER"
  | "REASON_REQUIRED"
  | "MANUFACTURED_ASSURANCE"
  | "SUSPECTED_SECRET"
  | "ASSESSOR_IDENTITY_RESERVED";

const MESSAGES: Readonly<Record<WallPrintErrorCode, string>> = {
  INVALID_RECORD: "WallPrint record failed validation.",
  INVALID_INPUT: "WallPrint input failed validation.",
  UNKNOWN_RECORD: "No WallPrint record with that id is committed.",
  DUPLICATE_RECORD_ID: "A WallPrint record with that id is already committed; records are never overwritten.",
  RECORD_DIGEST_MISMATCH: "The supplied digest does not match the canonical bytes of the record.",
  INVALID_TRANSITION: "That disclosure lifecycle transition is not allowed from the record's current state.",
  EVENT_TIME_ORDER: "A lifecycle event cannot be dated before the previous event of the same record.",
  COMMIT_BEFORE_SNAPSHOT: "A record cannot be committed before the snapshot time it describes.",
  SUPERSEDES_UNKNOWN_RECORD: "The predecessor named by supersedes is not committed in this history.",
  SUPERSEDES_DIGEST_MISMATCH: "supersedes.digest does not match the committed digest of the predecessor.",
  SELF_SUPERSESSION: "A record cannot supersede or correct itself.",
  SUBJECT_MISMATCH: "A successor must describe the same subject as its predecessor.",
  SNAPSHOT_ORDER: "A successor's snapshot cannot predate its predecessor's snapshot.",
  REASON_REQUIRED: "This lifecycle action requires a non-empty reason.",
  MANUFACTURED_ASSURANCE: "WalletWall-authored text may not use reserved assurance language.",
  SUSPECTED_SECRET: "Text looks like a credential or secret and cannot enter a WallPrint record.",
  ASSESSOR_IDENTITY_RESERVED: "That assessor identity is reserved.",
};

export interface Finding {
  code: string;
  /** Fixed field names and indices only, e.g. "assessments[2].assessor". Never a caller value. */
  path: string;
}

export class WallPrintError extends Error {
  readonly code: WallPrintErrorCode;
  readonly findings: readonly Finding[];

  constructor(code: WallPrintErrorCode, findings: readonly Finding[] = []) {
    super(MESSAGES[code]);
    this.name = "WallPrintError";
    this.code = code;
    this.findings = findings;
  }
}

export const finding = (code: string, path: string): Finding => ({ code, path });
