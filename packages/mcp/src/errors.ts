export type ErrorCode =
  | "CANONICALIZATION_FAILED"
  | "INVALID_QUANTITY"
  | "INVALID_INPUT"
  | "UNKNOWN_TOOL"
  | "UNKNOWN_RESOURCE"
  | "INTERNAL";

/** Errors carry a fixed code and a fixed message. They never include caller-supplied values. */
export class WwError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "WwError";
    this.code = code;
  }
}
