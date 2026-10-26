import { canonicalize } from "../canonical.ts";
import { pick } from "../evaluate.ts";
import { getPolicy } from "../registry.ts";
import type { ClaimType, FlatRecordValue } from "../schemas.ts";

/**
 * Canonical subject identity for WallPrint, computed in this one module.
 *
 * It reproduces the engine's CURRENT behaviour and changes nothing:
 *   - conflict grouping (evaluate.ts) and supersession identity (invariants.ts) compare the exact subject strings
 *     chosen by the policy's `subjectKeys` / `supersessionKeys`, serialized with RFC 8785;
 *   - only observation-to-assertion matching folds case for address-like keys (claims.ts CASE_INSENSITIVE_SUBJECT_KEYS).
 *
 * ADDRESS CASE: two subjects that differ only in hexadecimal address case are therefore DIFFERENT identities here, as
 * they are in the engine today (claims.ts CASE_NOTE: "supply lowercase hex"). Whether to normalise case is an explicit
 * semantic decision that has not been made. When it is made, change it here and nowhere else; the regression tests in
 * test/wallprint/identity.test.ts pin the current behaviour until then.
 */

export function subjectIdentityKeys(claimType: ClaimType): readonly string[] {
  return getPolicy(claimType)?.subjectKeys ?? [];
}

export function supersessionIdentityKeys(claimType: ClaimType): readonly string[] {
  return getPolicy(claimType)?.supersessionKeys ?? [];
}

function identityOver(keys: readonly string[], subject: FlatRecordValue | null): string | null {
  if (keys.length === 0) return null;
  const picked = pick(subject, keys);
  if (picked === null) return null;
  return canonicalize(picked);
}

/** The exact-string identity of a subject under its claim type's subject keys; null when a required key is absent. */
export function subjectIdentity(claimType: ClaimType, subject: FlatRecordValue | null): string | null {
  return identityOver(subjectIdentityKeys(claimType), subject);
}

/** The identity used to decide whether one assertion may supersede another (the policy's supersessionKeys). */
export function supersessionIdentity(claimType: ClaimType, subject: FlatRecordValue | null): string | null {
  return identityOver(supersessionIdentityKeys(claimType), subject);
}

export function sameSubjectIdentity(claimType: ClaimType, a: FlatRecordValue | null, b: FlatRecordValue | null): boolean {
  const x = subjectIdentity(claimType, a);
  return x !== null && x === subjectIdentity(claimType, b);
}

/** The engine's conflict-grouping key: claim type, temporality and exact subject identity. */
export function claimGroupKey(claimType: ClaimType, temporality: "CURRENT" | "PINNED", subject: FlatRecordValue | null): string | null {
  const id = subjectIdentity(claimType, subject);
  return id === null ? null : `${claimType}|${temporality}|${id}`;
}
