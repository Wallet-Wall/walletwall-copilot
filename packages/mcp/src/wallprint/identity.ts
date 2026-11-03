import { canonicalize } from "../canonical.ts";
import { pick } from "../evaluate.ts";
import { getPolicy } from "../registry.ts";
import type { ClaimType, FlatRecordValue } from "../schemas.ts";

/**
 * Canonical subject identity for WallPrint, computed in this one module: the exact subject strings chosen by the
 * policy's `subjectKeys` / `supersessionKeys`, serialized with RFC 8785.
 *
 * ADDRESS CASE: two subjects that differ only in hexadecimal address case are DIFFERENT identities here, because a record
 * commits to the spelling it holds. The evidence engine compares them case-insensitively (subject.ts), so this is no
 * longer the engine's grouping key: it is WallPrint's own, and it fails closed (a successor that re-spells its
 * predecessor's subject is refused). Whether WallPrint should normalise case is an explicit semantic decision that has
 * not been made. When it is made, change it here and nowhere else; the regression tests in
 * test/wallprint/identity.test.ts pin the current behaviour until then.
 *
 * The admission rules read evaluate.ts `indexBundle`, not the evidence index, for the same reason: a correction to how
 * evidence is evaluated must not move what a historical WallPrint version admits.
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

/** WallPrint's exact-string group key: claim type, temporality and exact subject identity. The engine groups conflicts with subject.ts. */
export function claimGroupKey(claimType: ClaimType, temporality: "CURRENT" | "PINNED", subject: FlatRecordValue | null): string | null {
  const id = subjectIdentity(claimType, subject);
  return id === null ? null : `${claimType}|${temporality}|${id}`;
}
