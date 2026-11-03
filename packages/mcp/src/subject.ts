import { canonicalize } from "./canonical.ts";
import { CASE_INSENSITIVE_SUBJECT_KEYS, SUBJECT_KEY_RULES } from "./claims.ts";
import type { FlatRecordValue } from "./schemas.ts";

/**
 * Subject identity for the evidence engine, in one module, driven by the claim vocabulary in claims.ts.
 *
 * Whether two subjects name the same thing is decided here for every comparison the engine makes: observation to
 * assertion, conflict grouping, supersession identity, derived claim to dependency, and the readiness and USD rules.
 * A key marked `caseInsensitive` compares case-insensitively and every other key compares exactly. The comparison form
 * is never written back: records, digests and suggested assertions keep the spelling that was supplied.
 *
 * WallPrint keeps its own exact-string record identity in wallprint/identity.ts; a record commits to the spelling it holds.
 */

type SubjectValue = string | boolean | null;

const comparisonForm = (key: string, value: SubjectValue): SubjectValue =>
  typeof value === "string" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;

/** Whether two values of one subject key are the same under that key's rule. */
export function subjectKeyEqual(key: string, a: string, b: string): boolean {
  return comparisonForm(key, a) === comparisonForm(key, b);
}

/** Whether two subjects agree on every one of `keys`. A key that is absent or not a string never matches. */
export function subjectMatches(a: FlatRecordValue, b: FlatRecordValue, keys: readonly string[]): boolean {
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (typeof x !== "string" || typeof y !== "string") return false;
    if (!subjectKeyEqual(k, x, y)) return false;
  }
  return true;
}

/**
 * The canonical comparison key of a subject over `keys`, for grouping. A subject missing one of the keys has the single
 * key `null`, as it always has: such subjects group together and never split into partial identities.
 */
export function subjectIdentityKey(subject: FlatRecordValue, keys: readonly string[]): string {
  const form: Record<string, SubjectValue> = {};
  for (const k of keys) {
    const v = subject[k];
    if (v === undefined) return canonicalize(null);
    form[k] = comparisonForm(k, v);
  }
  return canonicalize(form);
}

/** The name a subject key goes by across claim types: an identity's `address` is the `token` of a balance about that deployment. */
const subjectRole = (key: string): string => SUBJECT_KEY_RULES[key]?.sameAs ?? key;

/**
 * The keys of a derived claim's subject that disagree with one dependency's subject, over the keys the two claim types
 * share. A shared key that either side lacks is a disagreement, so a claim cannot escape the comparison by omitting a key.
 */
export function dependencySubjectMismatches(derived: FlatRecordValue, derivedKeys: readonly string[], dependency: FlatRecordValue, dependencyKeys: readonly string[]): string[] {
  const mismatched: string[] = [];
  for (const key of derivedKeys) {
    const dependencyKey = dependencyKeys.find((k) => subjectRole(k) === subjectRole(key));
    if (dependencyKey === undefined) continue;
    const a = derived[key];
    const b = dependency[dependencyKey];
    if (typeof a !== "string" || typeof b !== "string" || !subjectKeyEqual(key, a, b)) mismatched.push(key);
  }
  return mismatched;
}
