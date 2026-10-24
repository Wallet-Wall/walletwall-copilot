import { createHash } from "node:crypto";
import { WwError } from "./errors.ts";

const MAX_DEPTH = 64;

export interface CanonicalizeOptions {
  /**
   * "reject" (default) refuses every JSON number. Evidence-critical quantities are decimal strings.
   * "jcs" serializes finite numbers exactly as RFC 8785 section 3.2.2 (ECMAScript Number::toString);
   * it exists for tool-manifest hashing and RFC 8785 test vectors, never for evidence quantities.
   */
  numbers?: "reject" | "jcs";
}

function fail(): never {
  throw new WwError("CANONICALIZATION_FAILED", "Value cannot be canonicalized under RFC 8785 / I-JSON rules.");
}

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function ser(value: unknown, numbers: "reject" | "jcs", depth: number): string {
  if (depth > MAX_DEPTH) fail();
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      if (hasLoneSurrogate(value)) fail();
      return JSON.stringify(value);
    case "number":
      if (numbers === "reject" || !Number.isFinite(value)) fail();
      return String(value);
    case "object":
      break;
    default:
      return fail();
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => ser(v, numbers, depth + 1)).join(",")}]`;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const k of keys) if (hasLoneSurrogate(k)) fail();
  // Default sort compares UTF-16 code units, which is the RFC 8785 section 3.2.3 ordering.
  keys.sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${JSON.stringify(k)}:${ser(record[k], numbers, depth + 1)}`);
  }
  return `{${parts.join(",")}}`;
}

/** RFC 8785 JSON Canonicalization Scheme. Never use JSON.stringify for evidence hashing. */
export function canonicalize(value: unknown, options: CanonicalizeOptions = {}): string {
  return ser(value, options.numbers ?? "reject", 0);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 over the RFC 8785 canonical form. */
export function evidenceDigest(value: unknown, options: CanonicalizeOptions = {}): string {
  return sha256Hex(canonicalize(value, options));
}
