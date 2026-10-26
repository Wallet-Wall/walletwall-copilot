/**
 * RFC 8785 canonical form for the public resolver, mirroring the engine's canonicalize() (packages/mcp/src/canonical.ts)
 * rule for rule: keys in UTF-16 code unit order, JSON string escapes, no whitespace, every JSON number refused (evidence
 * quantities are strings), lone surrogates refused, non-plain objects refused, nesting beyond 64 refused. It returns null
 * where the engine throws, because the page fails closed on anything it cannot canonicalize and never prints why in
 * terms of the value. Parity with the engine is pinned by test over every published record and the engine's vectors.
 *
 * The engine's module is not imported here on purpose: it reaches for node:crypto, and this file must run in a browser.
 */

const MAX_DEPTH = 64;

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

function ser(value: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return hasLoneSurrogate(value) ? null : JSON.stringify(value);
    case "object":
      break;
    default:
      // number, undefined, bigint, symbol, function: no canonical form in a WallPrint document.
      return null;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const v of value) {
      const s = ser(v, depth + 1);
      if (s === null) return null;
      parts.push(s);
    }
    return `[${parts.join(",")}]`;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const k of keys) if (hasLoneSurrogate(k)) return null;
  // Default sort compares UTF-16 code units, which is the RFC 8785 section 3.2.3 ordering.
  keys.sort();
  const parts: string[] = [];
  for (const k of keys) {
    const s = ser(record[k], depth + 1);
    if (s === null) return null;
    parts.push(`${JSON.stringify(k)}:${s}`);
  }
  return `{${parts.join(",")}}`;
}

/** The RFC 8785 canonical form of a value, or null when it has none. Never throws. */
export function canonicalForm(value: unknown): string | null {
  return ser(value, 0);
}
