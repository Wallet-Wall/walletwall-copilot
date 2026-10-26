/**
 * Small shape helpers shared by the resolver's readers. They admit only plain JSON data with exactly the keys a contract
 * names; anything else is refused with a fixed code and the reader fails closed. No value is ever echoed.
 */

export interface Finding {
  code: string;
  /** Fixed field names and indices only. */
  path: string;
}

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NODES = 200_000;
const MAX_DEPTH = 64;

export const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** True when the value is plain JSON data (objects, arrays, strings, booleans, null; no numbers) with no prototype-shaped key, bounded in size and depth. */
export function isPlainJsonData(value: unknown): boolean {
  let nodes = 0;
  const walk = (v: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.every((x) => walk(x, depth + 1));
    if (!isPlainObject(v)) return false;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) return false;
      if (!walk(v[k], depth + 1)) return false;
    }
    return true;
  };
  return walk(value, 0);
}

/** True when the object's own keys are exactly `fields` (any order). */
export function hasExactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((k, i) => k === expected[i]);
}

/** Parse JSON text into plain JSON data, or undefined (not text, too large, not JSON, or not plain data). */
export function parsePlainJson(text: unknown, maxBytes: number): unknown {
  if (typeof text !== "string" || text.length > maxBytes) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isPlainJsonData(value) ? value : undefined;
}

export const isString = (v: unknown): v is string => typeof v === "string";
export const HEX64_RE = /^[0-9a-f]{64}$/;
