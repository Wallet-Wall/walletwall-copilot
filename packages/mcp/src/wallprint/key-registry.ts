import { z } from "zod";
import { canonicalize, evidenceDigest } from "../canonical.ts";
import { ID_RE, SAFE_TEXT_RE, hasForbiddenStructure } from "../schemas.ts";
import {
  ATTESTATION_LIMITS,
  BINDING_METHODS,
  KEY_REGISTRY_FORMAT_VERSION,
  KEY_REGISTRY_TYPE,
  KEY_STATUSES,
  KEY_STATUS_TRANSITIONS,
  SIGNER_KINDS,
  SIGNER_KIND_PURPOSES,
  ATTESTATION_PURPOSES,
  SUPPORTED_ALGORITHMS,
  type BindingMethod,
  type KeyStatus,
  type SignerKind,
} from "./attestation-vocabulary.ts";
import { admissionRulesFor } from "./admission.ts";
import { AlgorithmSchema, PublicKeyHexSchema, SignerIdSchema } from "./attestation.ts";
import { ed25519KeyProblem } from "./ed25519.ts";
import { finding, type Finding } from "./errors.ts";
import { HEX64_RE } from "./record.ts";

/**
 * The signing-key registry: a versioned, append-only chain of immutable snapshots that says which public key is bound to
 * which signer, for which purpose, with what status. It is separate from the evidence registry on purpose: the evidence
 * registry's digest is pinned by every WallPrint record and bundled into the shipped runtime, so a key rotation or
 * revocation placed there would make every historical record unreplayable and change the shipped artifact. Design:
 * spec/WALLPRINT_ATTESTATIONS.md, "The signing-key registry".
 *
 * A snapshot is never edited. Version N+1 may only add signers and keys and change a key's status along the allowed
 * transitions, so a historical lookup under version N is the same bytes for ever and a later revocation cannot rewrite it.
 *
 * Pure: no clock, no I/O. Every instant-free decision is made on registry VERSIONS, never on wall-clock time.
 */

const Hex64 = z.string().regex(HEX64_RE);
const Version = z.string().regex(/^[1-9][0-9]{0,5}$/);
const SafeText64 = z.string().regex(SAFE_TEXT_RE).max(64);
const AUTHORITY_ID_RE = /^(?:issuer|protocol):[a-z0-9][a-z0-9-]{0,62}$/;
const HTTPS_URL_RE = /^https:\/\/[a-z0-9][a-z0-9.-]{0,252}(?:\/[A-Za-z0-9._~/-]{0,256})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const BindingEvidenceSchema = z.strictObject({
  method: z.enum(BINDING_METHODS),
  publisher: SafeText64,
  url: z.string().regex(HTTPS_URL_RE).nullable(),
  locator: z.string().regex(SAFE_TEXT_RE).max(128).nullable(),
  retrievedAt: z.string().regex(DATE_RE).nullable(),
});

export const RegisteredKeySchema = z.strictObject({
  keyId: SignerIdSchema,
  algorithm: AlgorithmSchema,
  publicKey: PublicKeyHexSchema,
  purposes: z.array(z.enum(ATTESTATION_PURPOSES)).min(1).max(ATTESTATION_PURPOSES.length),
  status: z.enum(KEY_STATUSES),
  addedIn: Version,
  statusFrom: Version,
  successor: SignerIdSchema.nullable(),
  retainedBefore: Version.nullable(),
});
export type RegisteredKey = z.infer<typeof RegisteredKeySchema>;

export const RegisteredSignerSchema = z.strictObject({
  signerId: SignerIdSchema,
  kind: z.enum(SIGNER_KINDS),
  authorityId: z.string().regex(AUTHORITY_ID_RE).nullable(),
  assessorIds: z.array(z.string().regex(ID_RE)).max(ATTESTATION_LIMITS.maxAssessorIdsPerSigner),
  binding: BindingEvidenceSchema,
  keys: z.array(RegisteredKeySchema).min(1).max(ATTESTATION_LIMITS.maxKeysPerSigner),
});
export type RegisteredSigner = z.infer<typeof RegisteredSignerSchema>;

export const KeyRegistrySnapshotSchema = z.strictObject({
  type: z.literal(KEY_REGISTRY_TYPE),
  formatVersion: z.literal(KEY_REGISTRY_FORMAT_VERSION),
  keyRegistryVersion: Version,
  previous: z.strictObject({ version: Version, digest: Hex64 }).nullable(),
  signers: z.array(RegisteredSignerSchema).max(ATTESTATION_LIMITS.maxSignersPerRegistry),
  digest: Hex64,
});
export type KeyRegistrySnapshot = Readonly<z.infer<typeof KeyRegistrySnapshotSchema>>;

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const num = (v: string): number => Number(v);
const fold = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const strictlyAscending = (list: readonly string[]): boolean => list.every((v, i) => i === 0 || ordinal(list[i - 1] ?? "", v) < 0);
const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b);

/** SHA-256 over the RFC 8785 form of a snapshot without its own `digest` (the engine's `evidenceDigest`, as the evidence registry does). */
export function keyRegistryDigest(snapshot: Omit<KeyRegistrySnapshot, "digest"> | KeyRegistrySnapshot): string {
  const { digest: _digest, ...rest } = snapshot as KeyRegistrySnapshot;
  return evidenceDigest(rest);
}

/** Shape and internal-consistency findings for one snapshot. Fixed codes; paths are fixed field names and indices. */
export function keyRegistrySnapshotFindings(raw: unknown): Finding[] {
  if (hasForbiddenStructure(raw)) return [finding("FORBIDDEN_STRUCTURE", "")];
  const parsed = KeyRegistrySnapshotSchema.safeParse(raw);
  if (!parsed.success) return [finding("SHAPE", "")];
  const s = parsed.data;
  const out: Finding[] = [];
  const v = num(s.keyRegistryVersion);
  if (s.digest !== keyRegistryDigest(s)) out.push(finding("DIGEST_MISMATCH", "digest"));
  if (s.previous !== null && (num(s.previous.version) !== v - 1 || v === 1)) out.push(finding("PREVIOUS_MISMATCH", "previous"));
  if (s.previous === null && v !== 1) out.push(finding("PREVIOUS_MISMATCH", "previous"));
  if (!strictlyAscending(s.signers.map((x) => x.signerId))) out.push(finding("SIGNERS_NOT_ORDERED", "signers"));

  const keyIds = new Set<string>();
  const publicKeys = new Set<string>();
  const assessorIds = new Set<string>();
  const authorityIds = new Set<string>();
  let publishers = 0;
  const rules = admissionRulesFor("0.2");

  s.signers.forEach((signer, i) => {
    const at = `signers[${i}]`;
    const kind: SignerKind = signer.kind;
    if (kind === "WALLETWALL_PUBLISHER") {
      publishers++;
      if (signer.assessorIds.length !== 0 || signer.authorityId !== null || signer.binding.method !== "GOVERNANCE_DECLARATION") out.push(finding("SIGNER_KIND_INVALID", at));
    } else if (kind === "ISSUER_AUTHORITY") {
      if (signer.authorityId === null || !same(signer.assessorIds, [signer.authorityId]) || signer.binding.method !== "ISSUER_PUBLICATION" || signer.binding.url === null) out.push(finding("SIGNER_KIND_INVALID", at));
      else if (authorityIds.has(signer.authorityId)) out.push(finding("AUTHORITY_DUPLICATE", `${at}.authorityId`));
      else authorityIds.add(signer.authorityId);
    } else {
      if (signer.authorityId !== null || signer.assessorIds.length === 0 || (signer.binding.method !== "ASSESSOR_PUBLICATION" && signer.binding.method !== "ASSESSOR_DECLARATION")) out.push(finding("SIGNER_KIND_INVALID", at));
      for (const id of signer.assessorIds) {
        if (rules.readsAsReservedIdentity(id) || rules.collidesWithAuthorityIdentity(id)) out.push(finding("ASSESSOR_ID_RESERVED", `${at}.assessorIds`));
      }
    }
    if (!strictlyAscending(signer.assessorIds)) out.push(finding("ASSESSOR_IDS_NOT_ORDERED", `${at}.assessorIds`));
    for (const id of signer.assessorIds) {
      if (assessorIds.has(fold(id))) out.push(finding("ASSESSOR_ID_DUPLICATE", `${at}.assessorIds`));
      assessorIds.add(fold(id));
    }
    const evidence = signer.binding;
    const present = [evidence.url !== null, evidence.locator !== null, evidence.retrievedAt !== null];
    const expected = evidence.method === "GOVERNANCE_DECLARATION" ? [false, false, false] : evidence.method === "ASSESSOR_DECLARATION" ? [false, false, true] : [true, true, true];
    if (!same(present, expected)) out.push(finding("BINDING_EVIDENCE_INVALID", `${at}.binding`));
    if (!strictlyAscending(signer.keys.map((k) => k.keyId))) out.push(finding("KEYS_NOT_ORDERED", `${at}.keys`));

    signer.keys.forEach((key, j) => {
      const kat = `${at}.keys[${j}]`;
      if (keyIds.has(key.keyId)) out.push(finding("KEY_ID_DUPLICATE", `${kat}.keyId`));
      keyIds.add(key.keyId);
      if (publicKeys.has(key.publicKey)) out.push(finding("PUBLIC_KEY_DUPLICATE", `${kat}.publicKey`));
      publicKeys.add(key.publicKey);
      if ((SUPPORTED_ALGORITHMS as readonly string[]).includes(key.algorithm) && ed25519KeyProblem(key.publicKey) !== null) out.push(finding("KEY_MATERIAL_INVALID", `${kat}.publicKey`));
      if (!strictlyAscending(key.purposes) || key.purposes.some((p) => !SIGNER_KIND_PURPOSES[kind].includes(p))) out.push(finding("PURPOSES_INVALID", `${kat}.purposes`));
      if (num(key.addedIn) > num(key.statusFrom) || num(key.statusFrom) > v) out.push(finding("VERSION_ORDER_INVALID", kat));
      const withdrawn = key.status === "REVOKED" || key.status === "COMPROMISED";
      if (key.status === "ACTIVE" && key.statusFrom !== key.addedIn) out.push(finding("STATUS_INVALID", kat));
      if ((key.status === "SUPERSEDED") !== (key.successor !== null)) out.push(finding("STATUS_INVALID", `${kat}.successor`));
      if (key.successor !== null && (key.successor === key.keyId || !signer.keys.some((k) => k.keyId === key.successor))) out.push(finding("SUCCESSOR_INVALID", `${kat}.successor`));
      if (!withdrawn && key.retainedBefore !== null) out.push(finding("STATUS_INVALID", `${kat}.retainedBefore`));
      if (withdrawn && key.retainedBefore !== null && (num(key.retainedBefore) <= num(key.addedIn) || num(key.retainedBefore) > num(key.statusFrom))) out.push(finding("RETAINED_BEFORE_INVALID", `${kat}.retainedBefore`));
    });
  });
  if (publishers > 1) out.push(finding("PUBLISHER_NOT_UNIQUE", "signers"));
  return out;
}

export type ChainResult = { ok: true; chain: readonly KeyRegistrySnapshot[] } | { ok: false; findings: Finding[] };

/** Does `next` evolve `prev` only as the append-only rules allow? */
function evolutionFindings(prev: KeyRegistrySnapshot, next: KeyRegistrySnapshot, at: string): Finding[] {
  const out: Finding[] = [];
  const nextSigners = new Map(next.signers.map((s) => [s.signerId, s]));
  const prevSigners = new Map(prev.signers.map((s) => [s.signerId, s]));
  for (const p of prev.signers) {
    const n = nextSigners.get(p.signerId);
    if (n === undefined || n.kind !== p.kind || n.authorityId !== p.authorityId || !same(n.assessorIds, p.assessorIds) || !same(n.binding, p.binding)) {
      out.push(finding("SIGNER_CHANGED", at));
      continue;
    }
    const nextKeys = new Map(n.keys.map((k) => [k.keyId, k]));
    for (const pk of p.keys) {
      const nk = nextKeys.get(pk.keyId);
      if (nk === undefined || nk.algorithm !== pk.algorithm || nk.publicKey !== pk.publicKey || !same(nk.purposes, pk.purposes) || nk.addedIn !== pk.addedIn) {
        out.push(finding("KEY_CHANGED", at));
        continue;
      }
      if (nk.status === pk.status) {
        if (nk.statusFrom !== pk.statusFrom || nk.successor !== pk.successor || nk.retainedBefore !== pk.retainedBefore) out.push(finding("KEY_STATUS_REWRITTEN", at));
        continue;
      }
      if (!KEY_STATUS_TRANSITIONS[pk.status].includes(nk.status) || nk.statusFrom !== next.keyRegistryVersion) out.push(finding("KEY_TRANSITION_INVALID", at));
      // A later finding of compromise can only narrow what a revocation retained, never widen it.
      if (pk.status === "REVOKED" && nk.status === "COMPROMISED" && nk.retainedBefore !== null && (pk.retainedBefore === null || num(nk.retainedBefore) > num(pk.retainedBefore))) out.push(finding("RETAINED_WINDOW_WIDENED", at));
    }
    for (const nk of n.keys) {
      if (!p.keys.some((k) => k.keyId === nk.keyId) && (nk.status !== "ACTIVE" || nk.addedIn !== next.keyRegistryVersion)) out.push(finding("KEY_ADDED_INVALID", at));
    }
  }
  for (const n of next.signers) {
    if (!prevSigners.has(n.signerId) && n.keys.some((k) => k.status !== "ACTIVE" || k.addedIn !== next.keyRegistryVersion)) out.push(finding("KEY_ADDED_INVALID", at));
  }
  return out;
}

/**
 * Verify a whole chain of snapshots, versions 1..N in ascending order: every snapshot is valid and carries its own
 * digest, each names the previous snapshot's digest, and each evolves the previous one only by the allowed changes.
 * A chain that fails is not a registry; no lookup is made on it.
 */
export function verifyKeyRegistryChain(raw: unknown): ChainResult {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ATTESTATION_LIMITS.maxRegistryVersions) return { ok: false, findings: [finding("CHAIN_SHAPE", "")] };
  const findings: Finding[] = [];
  const chain: KeyRegistrySnapshot[] = [];
  raw.forEach((item: unknown, i) => {
    const own = keyRegistrySnapshotFindings(item);
    findings.push(...own.map((f) => finding(f.code, `versions[${i}]${f.path === "" ? "" : `.${f.path}`}`)));
    if (own.length > 0) return;
    const snapshot = KeyRegistrySnapshotSchema.parse(item);
    if (snapshot.keyRegistryVersion !== String(i + 1)) findings.push(finding("VERSION_SEQUENCE", `versions[${i}]`));
    const prev = chain[i - 1];
    if (prev === undefined && snapshot.previous !== null) findings.push(finding("PREVIOUS_MISMATCH", `versions[${i}].previous`));
    if (prev !== undefined) {
      if (snapshot.previous?.digest !== prev.digest) findings.push(finding("PREVIOUS_MISMATCH", `versions[${i}].previous`));
      findings.push(...evolutionFindings(prev, snapshot, `versions[${i}]`));
    }
    chain.push(snapshot);
  });
  return findings.length === 0 && chain.length === raw.length ? { ok: true, chain } : { ok: false, findings };
}

export interface FoundKey {
  signer: RegisteredSigner;
  key: RegisteredKey;
  bindingMethod: BindingMethod;
  status: KeyStatus;
}

/** Look one key up in one snapshot. Keys are found by id only; a display name is never consulted. */
export function findRegisteredKey(snapshot: KeyRegistrySnapshot, keyId: string): FoundKey | null {
  for (const signer of snapshot.signers) {
    const key = signer.keys.find((k) => k.keyId === keyId);
    if (key !== undefined) return { signer, key, bindingMethod: signer.binding.method, status: key.status };
  }
  return null;
}
