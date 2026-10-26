import { z } from "zod";
import { canonicalize, evidenceDigest } from "../canonical.ts";
import { WwError } from "../errors.ts";
import { evaluateBundle, indexBundle, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";
import { checkInvariants } from "../invariants.ts";
import { traceProvenance } from "../provenance.ts";
import { ASSETS, EXCLUDED_ASSETS, POLICIES_VERSION, findAsset, policiesDigest, registryDigest } from "../registry.ts";
import {
  CLAIM_TYPES,
  EvaluatedAtSchema,
  FINALITY_STATES,
  FRESHNESS_STATES,
  FlatRecord,
  ID_RE,
  ISO_RE,
  LIMITATION_CODES,
  LIMITS,
  ORIGINS,
  SAFE_TEXT_RE,
  SupportStateSchema,
  TEMPORALITIES,
  hasForbiddenStructure,
  parseBundleStrict,
  type Bundle,
  type ClaimType,
  type FlatRecordValue,
} from "../schemas.ts";
import { WallPrintError, finding, type Finding } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { subjectIdentityKeys } from "./identity.ts";
import { findReservedAssuranceTerms, findSecretLike, isReservedIdentity, isReservedPolicyId } from "./language.ts";
import {
  ASSESSOR_ROLES,
  EVIDENCE_ITEM_KINDS,
  HEX64_RE,
  RECORD_ID_RE,
  SUPERSESSION_KINDS,
  WALLETWALL_ASSESSOR_ID,
  WALLPRINT_CANONICALIZATION,
  WALLPRINT_DIGEST_ALGORITHM,
  WALLPRINT_LIMITS,
  WALLPRINT_VERSION,
  type AssessorRole,
  type EvidenceItemKind,
  type SupersessionKind,
} from "./vocabulary.ts";

/**
 * The WallPrint record: an immutable, digest-covered disclosure of one WWEP evaluation, focused on one assertion.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * What a record holds, and where each part comes from:
 *   - subject        the focal assertion's claim type, temporality and exact-string identity (identity.ts)
 *   - claims         every assertion of the bundle with the evaluation the engine computed for it (evaluate.ts),
 *                    copied as the engine reported it: support, freshness, finality, authority, limitations,
 *                    diagnostics, corroboration count, conflicts, supersession, dependencies, digest
 *   - assessments    WalletWall's own assessment, GENERATED from the focal claim's computed support state and
 *                    attributed to walletwall-rules, plus the attributed external assessments the caller supplied
 *   - evidence       the bundle digest and one (kind, id, digest) reference per bundle object; payloads stay in the bundle
 *   - provenance     the engine's lineage for the focal assertion (provenance.ts)
 *   - limitations    the sorted union of every claim's limitation codes
 *   - conflicts      the engine's declared / detected conflicts and observation disagreements; never resolved here
 *   - violations     check_invariants output (invariants.ts)
 *   - policyVersions / ruleVersions / versions   the published versions and digests in force (registry.ts);
 *                    ruleVersions are the rule versions the bundle's derivations DECLARED (evidence, flagged by the
 *                    engine when they differ from its own), versions.rules is the engine's
 *   - supersedes     the predecessor's id, digest, the kind of replacement and the reason (digested, so the chain binds)
 *
 * What a record never holds: a lifecycle state or a `supersededBy` back-link (they change after commit and live in
 * the history, history.ts), any consensus or overall verdict, raw provider payloads, UI state, a clock reading.
 *
 * Every value is a string, boolean or null: the payload is canonicalized with RFC 8785 and JSON numbers refused, and
 * digested with SHA-256 through the engine's evidenceDigest(). The digest preimage is the record minus `digest`.
 *
 * Every rule the builder applies is re-applied by validateWallPrintRecord, which is what commit, receipt, diff and
 * replay trust: a record from anywhere is admitted only if this engine could have produced it from its own parts.
 *
 * Everything here is a pure function of its inputs. No clock, no I/O, no identifiers are generated.
 */

// ─── patterns and caps ───────────────────────────────────────────────────────

/** The record id and digest shapes are defined in vocabulary.ts (shared with the portable reference codec) and re-exported here. */
export { HEX64_RE, RECORD_ID_RE };
export const POLICY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,95}$/;
/** An attributed assessment code, recorded exactly as the assessor stated it. */
export const ASSESSMENT_CODE_RE = /^[A-Z][A-Z0-9_-]{0,47}$/;
const COUNT_RE = /^(0|[1-9][0-9]{0,2})$/;
const DEPTH_RE = /^(0|[1-9][0-9]{0,3})$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const INVARIANT_RE = /^INV-[0-9]{2}$/;

// Caps derive from the engine's own maxima so every engine-valid evaluation is recordable.
const MAX_EVIDENCE_ITEMS = LIMITS.sources + LIMITS.observations + LIMITS.assertions + LIMITS.derivations;
const MAX_VIOLATIONS = LIMITS.assertions * 32;
const MAX_PROVENANCE_ISSUES = (LIMITS.assertions + LIMITS.observations + LIMITS.derivations) * 2;
const MAX_CONFLICTS = LIMITS.conflicts + LIMITS.assertions;
/** Record walker budget: a record is far larger than its bundle, so it gets its own bound (the schema bounds the rest). */
const RECORD_MAX_NODES = 1_000_000;
const RECORD_MAX_DEPTH = 32;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const isoValid = (s: string): boolean => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 19) === s.slice(0, 19);

const Hex64 = z.string().regex(HEX64_RE);
const WwId = z.string().regex(ID_RE);
const RecordId = z.string().regex(RECORD_ID_RE);
const PolicyId = z.string().regex(POLICY_ID_RE);
const SafeText = z.string().regex(SAFE_TEXT_RE);
const SafeText64 = SafeText.max(64);
const Code = z.string().regex(CODE_RE);
const PresentedIso = z.string().regex(ISO_RE).refine(isoValid, { message: "invalid timestamp" });
const KeyName = z.string().max(32);

// ─── input schemas ───────────────────────────────────────────────────────────

export const ExternalAssessmentInputSchema = z.strictObject({
  assessor: WwId,
  assessorRole: z.enum(ASSESSOR_ROLES),
  assessment: z.string().regex(ASSESSMENT_CODE_RE),
  statement: SafeText.optional(),
  policy: PolicyId,
  policyVersion: SafeText64,
  assessedAt: PresentedIso,
  evidenceRefs: z.array(WwId).max(LIMITS.idsPerList),
  limitations: z.array(z.enum(LIMITATION_CODES)).max(LIMITS.idsPerList).optional(),
});
export type ExternalAssessmentInput = z.infer<typeof ExternalAssessmentInputSchema>;

export const SupersedesSchema = z.strictObject({
  id: RecordId,
  digest: Hex64,
  kind: z.enum(SUPERSESSION_KINDS),
  reason: SafeText.nullable(),
});
export type Supersedes = z.infer<typeof SupersedesSchema>;

export const SnapshotInputSchema = z.strictObject({
  id: RecordId,
  bundle: z.unknown(),
  evaluatedAt: EvaluatedAtSchema,
  focalAssertionId: WwId,
  assessments: z.array(ExternalAssessmentInputSchema).max(WALLPRINT_LIMITS.externalAssessments).optional(),
  supersedes: SupersedesSchema.nullable().optional(),
});
export interface SnapshotInput {
  id: string;
  bundle: unknown;
  evaluatedAt: string;
  focalAssertionId: string;
  assessments?: ExternalAssessmentInput[];
  supersedes?: Supersedes | null;
}

// ─── record schema ───────────────────────────────────────────────────────────

const DiagnosticSchema = z.strictObject({
  limitation: z.enum(["INVALID_SUBJECT", "SUBJECT_MISMATCH", "INVALID_VALUE", "VALUE_MISMATCH"]),
  record: z.enum(["ASSERTION_SUBJECT", "ASSERTION_VALUE", "OBSERVATION_SUBJECT", "OBSERVATION_PAYLOAD"]),
  observationId: WwId.nullable(),
  requiredKeys: z.array(KeyName).max(LIMITS.recordEntries),
  missingKeys: z.array(KeyName).max(LIMITS.recordEntries),
  invalidKeys: z.array(z.strictObject({ key: KeyName, reason: z.enum(["WRONG_TYPE", "INVALID_FORMAT"]) })).max(LIMITS.recordEntries),
  unexpectedKeys: z.array(KeyName).max(LIMITS.recordEntries),
  mismatchedKeys: z.array(KeyName).max(LIMITS.recordEntries),
});

export const ClaimRecordSchema = z.strictObject({
  assertionId: WwId,
  claimType: z.enum(CLAIM_TYPES),
  origin: z.enum(ORIGINS),
  temporality: z.enum(TEMPORALITIES),
  subject: FlatRecord,
  value: FlatRecord.nullable(),
  supportState: SupportStateSchema,
  freshnessState: z.enum(FRESHNESS_STATES),
  finalityState: z.enum(FINALITY_STATES).nullable(),
  authority: z.strictObject({ authorityId: SafeText64, kind: SafeText64, satisfied: z.boolean() }).nullable(),
  limitations: z.array(z.enum(LIMITATION_CODES)).max(LIMITATION_CODES.length),
  diagnostics: z.array(DiagnosticSchema).max(LIMITS.observations),
  independentCorroboration: z.string().regex(COUNT_RE).nullable(),
  conflictsWith: z.array(WwId).max(LIMITS.assertions),
  supersededBy: WwId.nullable(),
  dependencies: z.strictObject({ observationIds: z.array(WwId).max(LIMITS.idsPerList), assertionIds: z.array(WwId).max(LIMITS.idsPerList) }),
  policyId: PolicyId.nullable(),
  digest: Hex64,
});
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;

export const AssessmentRecordSchema = z.strictObject({
  assessor: WwId,
  assessorRole: z.enum(ASSESSOR_ROLES),
  assessment: z.string().regex(ASSESSMENT_CODE_RE),
  statement: SafeText.nullable(),
  policy: PolicyId,
  policyVersion: SafeText64,
  assessedAt: PresentedIso,
  evidenceRefs: z.array(WwId).max(LIMITS.idsPerList * 2),
  limitations: z.array(z.enum(LIMITATION_CODES)).max(LIMITATION_CODES.length),
});
export type AssessmentRecord = z.infer<typeof AssessmentRecordSchema>;

const EvidenceItemSchema = z.strictObject({ kind: z.enum(EVIDENCE_ITEM_KINDS), id: WwId, digest: Hex64 });

const CONFLICT_CAUSES = ["CONFLICT_DECLARED", "CONFLICT_DETECTED", "OBSERVATION_DISAGREEMENT"] as const;
type ConflictCause = (typeof CONFLICT_CAUSES)[number];
const ConflictRecordSchema = z.strictObject({ assertionIds: z.array(WwId).min(1).max(LIMITS.assertions), cause: z.enum(CONFLICT_CAUSES) });

const ProvenanceSchema = z.strictObject({
  target: WwId,
  lineage: z.array(z.strictObject({ id: WwId, kind: z.enum(["assertion", "observation"]), depth: z.string().regex(DEPTH_RE) })).max(LIMITS.assertions + LIMITS.observations),
  issues: z.array(z.strictObject({ code: z.enum(["TARGET_NOT_FOUND", "DANGLING_REFERENCE", "DEPENDENCY_CYCLE"]), id: WwId.nullable() })).max(MAX_PROVENANCE_ISSUES),
});

const ViolationSchema = z.strictObject({ invariant: z.string().regex(INVARIANT_RE), code: Code, assertionId: WwId.nullable() });

const versionMap = (key: z.ZodString) => z.record(key, SafeText64).refine((m) => Object.keys(m).length <= LIMITS.recordEntries, { message: "too many entries" });

export const WallPrintRecordSchema = z.strictObject({
  wallprintVersion: z.literal(WALLPRINT_VERSION),
  id: RecordId,
  subject: z.strictObject({ focalAssertionId: WwId, claimType: z.enum(CLAIM_TYPES), temporality: z.enum(TEMPORALITIES), identity: FlatRecord }),
  snapshotAt: PresentedIso,
  evidence: z.strictObject({ bundleDigest: Hex64, items: z.array(EvidenceItemSchema).max(MAX_EVIDENCE_ITEMS) }),
  claims: z.array(ClaimRecordSchema).min(1).max(LIMITS.assertions),
  assessments: z.array(AssessmentRecordSchema).min(1).max(1 + WALLPRINT_LIMITS.externalAssessments),
  provenance: ProvenanceSchema,
  limitations: z.array(z.enum(LIMITATION_CODES)).max(LIMITATION_CODES.length),
  conflicts: z.array(ConflictRecordSchema).max(MAX_CONFLICTS),
  violations: z.array(ViolationSchema).max(MAX_VIOLATIONS),
  policyVersions: versionMap(PolicyId),
  ruleVersions: versionMap(WwId),
  versions: z.strictObject({ wwep: SafeText64, registry: SafeText64, policies: SafeText64, rules: SafeText64, registryDigest: Hex64, policiesDigest: Hex64 }),
  supersedes: SupersedesSchema.nullable(),
  canonicalization: z.literal(WALLPRINT_CANONICALIZATION),
  digestAlgorithm: z.literal(WALLPRINT_DIGEST_ALGORITHM),
  digest: Hex64,
});
export type WallPrintRecord = Readonly<z.infer<typeof WallPrintRecordSchema>>;
export type WallPrintPayload = Omit<z.infer<typeof WallPrintRecordSchema>, "digest">;

// ─── helpers ─────────────────────────────────────────────────────────────────

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = <T extends string>(ids: readonly T[]): T[] => [...new Set(ids)].sort(ordinal);
const sameCanonical = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b);

/** The registry's authority identities, case-folded: reserved for the ISSUER role. */
const REGISTRY_AUTHORITY_IDS: ReadonlySet<string> = new Set([...ASSETS, ...EXCLUDED_ASSETS].map((a) => a.authorityId.toLowerCase()));

/** Render a zod issue path from fixed schema segments; caller-supplied key names never appear (unknown keys report their parent). */
function renderPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (typeof seg === "string") out += out === "" ? seg : `.${seg}`;
  }
  return out;
}

const TIMESTAMP_FIELDS = new Set(["evaluatedAt", "assessedAt", "snapshotAt"]);
const ID_FIELDS = new Set(["id", "assessor", "focalAssertionId", "assertionId"]);

function issueCode(issue: z.core.$ZodIssue): string {
  const last = issue.path[issue.path.length - 1];
  const field = typeof last === "string" ? last : "";
  switch (issue.code) {
    case "unrecognized_keys":
      return "UNKNOWN_FIELD";
    case "invalid_value":
      return "INVALID_ENUM";
    case "too_big":
      return "TOO_MANY";
    case "too_small":
      return "TOO_FEW";
    case "invalid_type":
      return "INVALID_TYPE";
    case "invalid_format":
    case "custom":
      if (field === "digest") return "INVALID_DIGEST";
      if (TIMESTAMP_FIELDS.has(field)) return "INVALID_TIMESTAMP";
      if (ID_FIELDS.has(field)) return "INVALID_ID";
      return "INVALID_FORMAT";
    default:
      return "INVALID_SHAPE";
  }
}

function issuesToFindings(error: z.ZodError): Finding[] {
  return error.issues.slice(0, 64).map((issue) => finding(issueCode(issue), renderPath(issue.path)));
}

/**
 * Prototype-key and size walk for a record received from anywhere. The engine's hasForbiddenStructure caps at
 * 20 000 nodes, which a legitimate record can exceed; the record walker has its own budget and the schema bounds the
 * rest. Returns a finding or null.
 */
function recordStructureFinding(value: unknown): Finding | null {
  let nodes = 0;
  let problem: Finding | null = null;
  const walk = (v: unknown, depth: number, path: string): boolean => {
    if (problem !== null) return true;
    if (depth > RECORD_MAX_DEPTH || ++nodes > RECORD_MAX_NODES) {
      problem = finding("RECORD_TOO_LARGE", "");
      return true;
    }
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some((x, i) => walk(x, depth + 1, `${path}[${i}]`));
    for (const k of Object.getOwnPropertyNames(v)) {
      if (FORBIDDEN_KEYS.has(k)) {
        problem = finding("FORBIDDEN_STRUCTURE", path);
        return true;
      }
      if (walk((v as Record<string, unknown>)[k], depth + 1, path === "" ? k : `${path}.${k}`)) return true;
    }
    return false;
  };
  walk(value, 0, "");
  return problem;
}

/** Credential-shaped text in any string slot of a value, with the path of each hit. */
function secretFindings(value: unknown, path: string): Finding[] {
  const out: Finding[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "string") {
      const code = findSecretLike(v);
      if (code !== null) out.push(finding(code, p));
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v !== null && typeof v === "object") for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], p === "" ? k : `${p}.${k}`);
  };
  walk(value, path);
  return out.slice(0, 64);
}

function reasonFindings(reason: string | null, path: string): Finding[] {
  if (reason === null) return [];
  const out: Finding[] = [];
  if (findReservedAssuranceTerms(reason).length > 0) out.push(finding("MANUFACTURED_ASSURANCE", path));
  const secret = findSecretLike(reason);
  if (secret !== null) out.push(finding(secret, path));
  return out;
}

function supersedesFindings(s: Supersedes | null, recordId: string): Finding[] {
  if (s === null) return [];
  const out: Finding[] = [];
  if (s.id === recordId) out.push(finding("SELF_SUPERSESSION", "supersedes.id"));
  if (s.kind === "CORRECTION" && (s.reason === null || s.reason.trim() === "")) out.push(finding("REASON_REQUIRED", "supersedes.reason"));
  out.push(...reasonFindings(s.reason, "supersedes.reason"));
  return out;
}

/** The registry deployment a focal subject refers to, if any (identity claims name `address`, the others `token`). */
function focalRegistryAuthority(claimType: ClaimType, subject: FlatRecordValue): string | null {
  const chainId = subject["chainId"];
  const address = claimType === "ASSET_IDENTITY" ? subject["address"] : subject["token"];
  if (typeof chainId !== "string" || typeof address !== "string") return null;
  return findAsset(chainId, address)?.authorityId ?? null;
}

interface ExternalLike {
  assessor: string;
  assessorRole: AssessorRole;
  policy: string;
  evidenceRefs: readonly string[];
  statement?: string | null | undefined;
}

/**
 * The attribution rules for external assessments, applied identically at build time and at validation time.
 * `knownIds` are the ids an evidence reference may name; `registryAuthority` is the focal deployment's authority id.
 */
function externalAssessmentFindings(list: readonly ExternalLike[], knownIds: ReadonlySet<string>, registryAuthority: string | null, path: (i: number) => string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  list.forEach((a, i) => {
    const p = path(i);
    if (a.assessorRole === "WALLETWALL") out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessorRole`));
    if (isReservedIdentity(a.assessor)) out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessor`));
    const folded = a.assessor.toLowerCase();
    if (a.assessorRole === "ISSUER") {
      if (registryAuthority === null) out.push(finding("ISSUER_NOT_IN_REGISTRY", `${p}.assessor`));
      else if (a.assessor !== registryAuthority) out.push(finding("ISSUER_AUTHORITY_MISMATCH", `${p}.assessor`));
    } else if (REGISTRY_AUTHORITY_IDS.has(folded)) {
      out.push(finding("ASSESSOR_IDENTITY_RESERVED", `${p}.assessor`));
    }
    if (isReservedPolicyId(a.policy)) out.push(finding("RESERVED_POLICY_NAMESPACE", `${p}.policy`));
    if (a.evidenceRefs.some((id) => !knownIds.has(id))) out.push(finding("UNKNOWN_EVIDENCE_REFERENCE", `${p}.evidenceRefs`));
    const key = `${folded}|${a.policy.toLowerCase()}`;
    if (seen.has(key)) out.push(finding("DUPLICATE_ASSESSMENT", p));
    seen.add(key);
  });
  return out;
}

function claimRecord(e: AssertionEvaluation, subject: FlatRecordValue, value: FlatRecordValue | null): ClaimRecord {
  return {
    assertionId: e.assertionId,
    claimType: e.claimType,
    origin: e.origin,
    temporality: e.temporality,
    subject,
    value,
    supportState: e.supportState,
    freshnessState: e.freshnessState,
    finalityState: e.finalityState,
    authority: e.authority === null ? null : { authorityId: e.authority.authorityId, kind: e.authority.kind, satisfied: e.authority.satisfied },
    limitations: [...e.limitations],
    diagnostics: e.diagnostics.map((d) => ({
      limitation: d.limitation,
      record: d.record,
      observationId: d.observationId,
      requiredKeys: [...d.requiredKeys],
      missingKeys: [...d.missingKeys],
      invalidKeys: d.invalidKeys.map((k) => ({ key: k.key, reason: k.reason })),
      unexpectedKeys: [...d.unexpectedKeys],
      mismatchedKeys: [...d.mismatchedKeys],
    })),
    independentCorroboration: e.independentCorroboration === null ? null : String(e.independentCorroboration),
    conflictsWith: [...e.conflictsWith],
    supersededBy: e.supersededBy,
    dependencies: { observationIds: [...e.dependencies.observationIds], assertionIds: [...e.dependencies.assertionIds] },
    policyId: e.policyId,
    digest: e.digest,
  };
}

interface ConflictLike {
  assertionIds: readonly string[];
  cause: ConflictCause;
}

/** The conflict entries implied by a set of claims; the builder derives them and the validator recomputes them. */
function conflictEntries(claims: readonly { assertionId: string; conflictsWith: readonly string[]; limitations: readonly string[] }[]): ConflictLike[] {
  const byKey = new Map<string, ConflictLike>();
  for (const c of claims) {
    if (c.conflictsWith.length > 0) {
      const ids = uniqueSorted([c.assertionId, ...c.conflictsWith]);
      const cause: ConflictCause = c.limitations.includes("CONFLICT_DECLARED") ? "CONFLICT_DECLARED" : "CONFLICT_DETECTED";
      byKey.set(`${cause}|${ids.join("|")}`, { assertionIds: ids, cause });
    } else if (c.limitations.includes("OBSERVATION_DISAGREEMENT")) {
      byKey.set(`OBSERVATION_DISAGREEMENT|${c.assertionId}`, { assertionIds: [c.assertionId], cause: "OBSERVATION_DISAGREEMENT" });
    }
  }
  return [...byKey.values()].sort((a, b) => ordinal(canonicalize(a), canonicalize(b)));
}

function evidenceItems(bundle: Bundle): { kind: EvidenceItemKind; id: string; digest: string }[] {
  const items: { kind: EvidenceItemKind; id: string; digest: string }[] = [];
  const add = (kind: EvidenceItemKind, list: readonly { id: string }[]): void => {
    for (const o of list) items.push({ kind, id: o.id, digest: evidenceDigest(o) });
  };
  add("SOURCE", bundle.sources);
  add("OBSERVATION", bundle.observations);
  add("ASSERTION", bundle.assertions);
  add("DERIVATION", bundle.derivations);
  return items.sort((a, b) => ordinal(a.kind, b.kind) || ordinal(a.id, b.id));
}

function walletWallAssessment(focal: Pick<ClaimRecord, "supportState" | "policyId" | "limitations" | "dependencies">, snapshotAt: string, policiesVersion: string): AssessmentRecord {
  return {
    assessor: WALLETWALL_ASSESSOR_ID,
    assessorRole: "WALLETWALL",
    assessment: focal.supportState,
    statement: null,
    policy: focal.policyId ?? "",
    policyVersion: policiesVersion,
    assessedAt: snapshotAt,
    evidenceRefs: uniqueSorted([...focal.dependencies.observationIds, ...focal.dependencies.assertionIds]),
    limitations: [...focal.limitations],
  };
}

function externalAssessment(a: ExternalAssessmentInput): AssessmentRecord {
  return {
    assessor: a.assessor,
    assessorRole: a.assessorRole,
    assessment: a.assessment,
    statement: a.statement ?? null,
    policy: a.policy,
    policyVersion: a.policyVersion,
    assessedAt: a.assessedAt,
    evidenceRefs: uniqueSorted(a.evidenceRefs),
    limitations: [...new Set(a.limitations ?? [])].sort(ordinal),
  };
}

const byAssessorPolicy = (a: AssessmentRecord, b: AssessmentRecord): number => ordinal(a.assessor, b.assessor) || ordinal(a.policy, b.policy);

/** Strictly increasing under `cmp`: equal neighbours are duplicates and fail. */
function strictlyOrdered<T>(list: readonly T[], cmp: (a: T, b: T) => number): boolean {
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    if (prev !== undefined && cur !== undefined && cmp(prev, cur) >= 0) return false;
  }
  return true;
}

// ─── public API ──────────────────────────────────────────────────────────────

/** The digest preimage: the record without its own `digest`. */
export function wallPrintPayload(record: WallPrintRecord | WallPrintPayload): WallPrintPayload {
  const copy: WallPrintPayload & { digest?: string } = { ...record };
  delete copy.digest;
  return copy;
}

/** SHA-256 over the RFC 8785 form of the payload (the engine's evidenceDigest). */
export function wallPrintDigest(record: WallPrintRecord | WallPrintPayload): string {
  return evidenceDigest(wallPrintPayload(record));
}

export interface DigestVerification {
  hasDigest: boolean;
  /** Byte integrity only: the disclosed canonical record is the committed record. Says nothing about factual truth. */
  matches: boolean;
  computedDigest: string | null;
}

/** Verify a record against its embedded digest. Never throws; a non-canonicalizable record reports matches:false. */
export function verifyWallPrintDigest(record: unknown): DigestVerification {
  const embedded = (record as { digest?: unknown } | null)?.digest;
  if (typeof embedded !== "string" || !HEX64_RE.test(embedded)) return { hasDigest: false, matches: false, computedDigest: null };
  try {
    const computed = wallPrintDigest(record as WallPrintRecord);
    return { hasDigest: true, matches: computed === embedded, computedDigest: computed };
  } catch {
    return { hasDigest: true, matches: false, computedDigest: null };
  }
}

export type RecordValidation = { ok: true; record: WallPrintRecord } | { ok: false; findings: Finding[] };

/**
 * Validate a record received from anywhere. Closed shape and contract constants; digest over the preimage; every
 * reference resolving inside the record; collections strictly ordered (sets); the WalletWall assessment equal in
 * every field to what the focal claim generates; external attribution rules; conflicts agreeing with the claims;
 * provenance targeting the focal claim; policy versions consistent; the supersedes rules; no credential-shaped text.
 * Pure and synchronous.
 */
export function validateWallPrintRecord(raw: unknown): RecordValidation {
  const structure = recordStructureFinding(raw);
  if (structure !== null) return { ok: false, findings: [structure] };
  const parsed = WallPrintRecordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, findings: issuesToFindings(parsed.error) };
  const r = parsed.data;
  const findings: Finding[] = [];

  if (wallPrintDigest(r) !== r.digest) findings.push(finding("DIGEST_MISMATCH", "digest"));
  findings.push(...secretFindings(r, ""));

  const claimIds = new Set(r.claims.map((c) => c.assertionId));
  const itemIds = new Set(r.evidence.items.map((i) => i.id));
  const known = (id: string): boolean => claimIds.has(id) || itemIds.has(id);
  r.claims.forEach((c, i) => {
    if (!itemIds.has(c.assertionId)) findings.push(finding("UNKNOWN_REFERENCE", `claims[${i}].assertionId`));
    if (c.conflictsWith.some((id) => !claimIds.has(id))) findings.push(finding("UNKNOWN_REFERENCE", `claims[${i}].conflictsWith`));
    if (c.supersededBy !== null && !claimIds.has(c.supersededBy)) findings.push(finding("UNKNOWN_REFERENCE", `claims[${i}].supersededBy`));
    if (c.dependencies.observationIds.some((id) => !itemIds.has(id)) || c.dependencies.assertionIds.some((id) => !claimIds.has(id))) {
      findings.push(finding("UNKNOWN_REFERENCE", `claims[${i}].dependencies`));
    }
  });
  r.assessments.forEach((a, i) => {
    if (a.evidenceRefs.some((id) => !known(id))) findings.push(finding("UNKNOWN_REFERENCE", `assessments[${i}].evidenceRefs`));
  });
  r.conflicts.forEach((c, i) => {
    if (c.assertionIds.some((id) => !claimIds.has(id))) findings.push(finding("UNKNOWN_REFERENCE", `conflicts[${i}].assertionIds`));
  });
  r.provenance.lineage.forEach((l, i) => {
    if (!known(l.id)) findings.push(finding("UNKNOWN_REFERENCE", `provenance.lineage[${i}].id`));
  });
  r.violations.forEach((v, i) => {
    if (v.assertionId !== null && !claimIds.has(v.assertionId)) findings.push(finding("UNKNOWN_REFERENCE", `violations[${i}].assertionId`));
  });

  if (!strictlyOrdered(r.claims, (a, b) => ordinal(a.assertionId, b.assertionId))) findings.push(finding("NOT_CANONICAL_ORDER", "claims"));
  if (!strictlyOrdered(r.evidence.items, (a, b) => ordinal(a.kind, b.kind) || ordinal(a.id, b.id))) findings.push(finding("NOT_CANONICAL_ORDER", "evidence.items"));
  if (!strictlyOrdered(r.assessments, byAssessorPolicy)) findings.push(finding("NOT_CANONICAL_ORDER", "assessments"));
  if (!strictlyOrdered(r.limitations, ordinal)) findings.push(finding("NOT_CANONICAL_ORDER", "limitations"));
  if (!sameCanonical(r.conflicts, conflictEntries(r.claims))) findings.push(finding("CONFLICTS_MISMATCH", "conflicts"));
  r.claims.forEach((c, i) => {
    const inConflict = c.conflictsWith.length > 0;
    if (inConflict && c.supportState !== "CONFLICTING" && c.supportState !== "SUPERSEDED") findings.push(finding("CONFLICTS_MISMATCH", `claims[${i}].supportState`));
    if (c.supportState === "CONFLICTING" && !inConflict && !c.limitations.includes("OBSERVATION_DISAGREEMENT")) findings.push(finding("CONFLICTS_MISMATCH", `claims[${i}].supportState`));
  });

  const focal = r.claims.find((c) => c.assertionId === r.subject.focalAssertionId);
  if (focal === undefined) findings.push(finding("UNKNOWN_FOCAL_ASSERTION", "subject.focalAssertionId"));
  else {
    if (focal.claimType !== r.subject.claimType || focal.temporality !== r.subject.temporality) findings.push(finding("SUBJECT_MISMATCH", "subject"));
    const identity = pick(focal.subject, subjectIdentityKeys(focal.claimType));
    if (identity === null || !sameCanonical(identity, r.subject.identity)) findings.push(finding("SUBJECT_MISMATCH", "subject.identity"));
    if (r.provenance.target !== r.subject.focalAssertionId) findings.push(finding("PROVENANCE_MISMATCH", "provenance.target"));
  }

  const walletWall = r.assessments.filter((a) => a.assessorRole === "WALLETWALL");
  if (walletWall.length !== 1) findings.push(finding("WALLETWALL_ASSESSMENT_REQUIRED", "assessments"));
  r.assessments.forEach((a, i) => {
    if (a.assessorRole !== "WALLETWALL") return;
    const path = `assessments[${i}]`;
    if (a.assessor !== WALLETWALL_ASSESSOR_ID) findings.push(finding("ASSESSOR_IDENTITY_RESERVED", `${path}.assessor`));
    if (a.statement !== null) findings.push(finding("MANUFACTURED_ASSURANCE", `${path}.statement`));
    if (!SupportStateSchema.safeParse(a.assessment).success) findings.push(finding("INVALID_ENUM", `${path}.assessment`));
    if (focal === undefined) return;
    const expected = walletWallAssessment(focal, r.snapshotAt, r.versions.policies);
    for (const field of ["assessment", "policy", "policyVersion", "assessedAt", "evidenceRefs", "limitations"] as const) {
      if (!sameCanonical(a[field], expected[field])) findings.push(finding("WALLETWALL_ASSESSMENT_MISMATCH", `${path}.${field}`));
    }
  });
  const externals = r.assessments.map((a, i) => ({ a, i })).filter(({ a }) => a.assessorRole !== "WALLETWALL");
  const registryAuthority = focal === undefined ? null : focalRegistryAuthority(focal.claimType, focal.subject);
  findings.push(...externalAssessmentFindings(externals.map(({ a }) => a), new Set([...claimIds, ...itemIds]), registryAuthority, (k) => `assessments[${externals[k]?.i ?? k}]`));

  const unionLimitations = uniqueSorted(r.claims.flatMap((c) => c.limitations));
  if (!sameCanonical(unionLimitations, r.limitations)) findings.push(finding("LIMITATIONS_MISMATCH", "limitations"));
  const policyIds = uniqueSorted(r.claims.map((c) => c.policyId).filter((p): p is string => p !== null));
  if (!sameCanonical(policyIds, Object.keys(r.policyVersions).sort(ordinal))) findings.push(finding("POLICY_VERSIONS_MISMATCH", "policyVersions"));
  if (Object.values(r.policyVersions).some((v) => v !== r.versions.policies)) findings.push(finding("POLICY_VERSIONS_MISMATCH", "policyVersions"));

  findings.push(...supersedesFindings(r.supersedes, r.id));

  return findings.length === 0 ? { ok: true, record: r } : { ok: false, findings };
}

/**
 * Build the canonical, immutable WallPrint snapshot of one WWEP evaluation.
 * Throws WallPrintError("INVALID_INPUT") for a malformed input and WallPrintError("INVALID_RECORD") when the
 * semantic rules refuse it; both carry findings with fixed codes and paths. Never lets an engine error escape.
 */
export function buildWallPrintSnapshot(input: SnapshotInput): WallPrintRecord {
  try {
    return build(input);
  } catch (e) {
    if (e instanceof WwError) throw new WallPrintError("INVALID_INPUT", [finding(e.code, "bundle")]);
    throw e;
  }
}

function build(input: SnapshotInput): WallPrintRecord {
  if (hasForbiddenStructure(input)) throw new WallPrintError("INVALID_INPUT", [finding("FORBIDDEN_STRUCTURE", "")]);
  const parsedInput = SnapshotInputSchema.safeParse(input);
  if (!parsedInput.success) throw new WallPrintError("INVALID_INPUT", issuesToFindings(parsedInput.error));
  const { id, evaluatedAt, focalAssertionId } = parsedInput.data;
  const externals = parsedInput.data.assessments ?? [];
  const supersedes = parsedInput.data.supersedes ?? null;

  const parsedBundle = parseBundleStrict(parsedInput.data.bundle);
  if (!parsedBundle.success) throw new WallPrintError("INVALID_INPUT", [finding("INVALID_BUNDLE", "bundle")]);
  // Plain data only: zod keeps an explicitly-undefined optional key, which the canonicalizer refuses.
  const bundle = JSON.parse(JSON.stringify(parsedBundle.data)) as Bundle;

  const idx = indexBundle(bundle);
  const focalAssertion = idx.assertions.get(focalAssertionId);
  if (focalAssertion === undefined) throw new WallPrintError("INVALID_RECORD", [finding("UNKNOWN_FOCAL_ASSERTION", "focalAssertionId")]);

  const evaluation: Evaluation = evaluateBundle(bundle, evaluatedAt);
  const violations = checkInvariants(bundle, evaluation);
  const focalEval = evaluation.assertions.find((e) => e.assertionId === focalAssertionId);
  const findings: Finding[] = [];
  if (focalEval === undefined) findings.push(finding("UNKNOWN_FOCAL_ASSERTION", "focalAssertionId"));
  else if (focalEval.policyId === null) findings.push(finding("FOCAL_POLICY_MISSING", "focalAssertionId"));

  const identity = pick(focalAssertion.subject, subjectIdentityKeys(focalAssertion.claimType));
  if (identity === null) findings.push(finding("INVALID_FOCAL_SUBJECT", "focalAssertionId"));

  const bundleIds = new Set<string>([...idx.sources.keys(), ...idx.observations.keys(), ...idx.assertions.keys(), ...idx.derivations.keys()]);
  findings.push(...externalAssessmentFindings(externals, bundleIds, focalRegistryAuthority(focalAssertion.claimType, focalAssertion.subject), (i) => `assessments[${i}]`));
  externals.forEach((a, i) => findings.push(...secretFindings({ assessor: a.assessor, policy: a.policy, policyVersion: a.policyVersion, statement: a.statement ?? null }, `assessments[${i}]`)));
  findings.push(...secretFindings(id, "id"));
  findings.push(...supersedesFindings(supersedes, id));

  const ruleVersions = new Map<string, string>();
  bundle.derivations.forEach((d, i) => {
    if (FORBIDDEN_KEYS.has(d.ruleId)) findings.push(finding("RULE_ID_RESERVED", `bundle.derivations[${i}]`));
    const existing = ruleVersions.get(d.ruleId);
    if (existing !== undefined && existing !== d.rulesVersion) findings.push(finding("RULE_VERSION_AMBIGUOUS", `bundle.derivations[${i}]`));
    ruleVersions.set(d.ruleId, d.rulesVersion);
  });

  if (findings.length > 0 || focalEval === undefined || identity === null) throw new WallPrintError("INVALID_RECORD", findings);

  const claims = evaluation.assertions.map((e) => {
    const a = idx.assertions.get(e.assertionId);
    return claimRecord(e, a?.subject ?? {}, a?.value ?? null);
  });
  const policyVersions: Record<string, string> = {};
  for (const p of uniqueSorted(claims.map((c) => c.policyId).filter((p): p is string => p !== null))) policyVersions[p] = POLICIES_VERSION;
  const trace = traceProvenance(bundle, focalAssertionId);

  const payload: WallPrintPayload = {
    wallprintVersion: WALLPRINT_VERSION,
    id,
    subject: { focalAssertionId, claimType: focalAssertion.claimType, temporality: focalAssertion.temporality, identity },
    snapshotAt: evaluatedAt,
    evidence: { bundleDigest: evaluation.bundleDigest, items: evidenceItems(bundle) },
    claims,
    assessments: [walletWallAssessment(focalEval, evaluatedAt, POLICIES_VERSION), ...externals.map(externalAssessment)].sort(byAssessorPolicy),
    provenance: {
      target: trace.target,
      lineage: trace.lineage.map((l) => ({ id: l.id, kind: l.kind, depth: String(l.depth) })),
      issues: trace.issues.map((i) => ({ code: i.code, id: i.id })),
    },
    limitations: uniqueSorted(claims.flatMap((c) => c.limitations)),
    conflicts: conflictEntries(claims).map((c) => ({ assertionIds: [...c.assertionIds], cause: c.cause })),
    violations: violations.map((v) => ({ invariant: v.invariant, code: v.code, assertionId: v.assertionId })),
    policyVersions,
    ruleVersions: Object.fromEntries([...ruleVersions.entries()].sort(([a], [b]) => ordinal(a, b))),
    versions: { ...evaluation.versions, registryDigest: registryDigest(), policiesDigest: policiesDigest() },
    supersedes,
    canonicalization: WALLPRINT_CANONICALIZATION,
    digestAlgorithm: WALLPRINT_DIGEST_ALGORITHM,
  };

  const canonical = canonicalize(payload);
  const record = { ...(JSON.parse(canonical) as WallPrintPayload), digest: evidenceDigest(payload) };
  const check = validateWallPrintRecord(record);
  if (!check.ok) throw new WallPrintError("INVALID_RECORD", check.findings);
  return deepFreeze(check.record);
}

/** The attributed conclusions, one per assessment, in record order. Never folded into a consensus. */
export function listAssessments(record: WallPrintRecord): readonly AssessmentRecord[] {
  return record.assessments;
}

export type { AssessorRole, SupersessionKind };
