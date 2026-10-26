import { z } from "zod";
import { canonicalize, evidenceDigest } from "../canonical.ts";
import { CHAIN_ID_RE, SAFE_TEXT_RE, hasForbiddenStructure } from "../schemas.ts";
import { WallPrintError, finding, type Finding } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { LifecycleEventSchema, isCanonicalInstant, verifyLifecycleChain, type LifecycleEvent, type Lineage, type SuccessorRef } from "./history.ts";
import { findReservedAssuranceTerms, findSecretLike } from "./language.ts";
import { RECEIPT_REASONS, WallPrintReceiptSchema, verifyReceipt, type ReceiptVerification, type WallPrintReceipt } from "./receipt.ts";
import { HEX64_RE, RECORD_ID_RE, SupersedesSchema, validateWallPrintRecord, verifyWallPrintDigest, wallPrintDigest, wallPrintPayload, type DigestVerification, type Supersedes, type WallPrintRecord } from "./record.ts";
import { RESOLVER_ROUTE, SUPPORTED_WALLPRINT_VERSIONS, isResolverBase } from "./reference.ts";
import { DIFF_CATEGORIES, LIFECYCLE_STATES, REPLAY_OUTCOMES, REPLAY_REASONS, SUPERSESSION_KINDS, UNREPLAYABLE_REASONS, type LifecycleState, type ReplayOutcome, type ReplayReason } from "./vocabulary.ts";

/**
 * WallPrint publication: the deliberate step that makes one canonical disclosure publicly resolvable.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * Publication takes a DISCLOSURE EXPORT (one record exactly as the engine exported it: the record, its canonical
 * preimage, and the engine's own results for it: validation, digest check, lifecycle ledger, lineage, receipt and
 * verification, replay, semantic diff) and produces two things:
 *
 *   - an IMMUTABLE PUBLIC DISCLOSURE: a pure function of the export, serialized in RFC 8785 form, identified by
 *     record id + digest. The same disclosure always publishes to the same bytes; different bytes under the same id
 *     and digest are a conflict and never overwrite. It carries no lifecycle standing, no successor, no lineage and
 *     no instant of publication, because those change after commit;
 *   - the record's STANDING: mutable metadata (lifecycle ledger, successor, lineage, publication instants) that may
 *     only ever extend (events append, a successor is set once, the chain grows at its end), plus a small index.
 *
 * Nothing here decides an evidence state, a lifecycle state, a receipt or replay verdict: every carried result is
 * re-checked against the record it accompanies and refused when it disagrees. A record that does not validate, whose
 * canonical bytes do not digest to its digest, or whose id cannot be one path segment on every filesystem is refused.
 * The privacy gate refuses anything credential-, path-, address-, environment- or control-shaped outside the record's
 * own content, and the strict schemas admit no field the contract does not name. Errors and findings carry fixed codes
 * and fixed paths, never caller values. No clock, no I/O, no resolver base is named: the publisher supplies the instant
 * and the base, and both are checked.
 *
 * Nothing here is imported by main.ts, server.ts or tools.ts.
 */

import { CONSTRUCTION_KINDS, DISCLOSURE_TYPE, PUBLICATION_INDEX_TYPE, PUBLICATION_MAX_BYTES, PUBLICATION_VERSION, RECORD_INDEX_TYPE, isPublishableId, type ConstructionKind } from "./publication-vocabulary.ts";

export { CONSTRUCTION_KINDS, DISCLOSURE_FIELDS, DISCLOSURE_TYPE, PUBLICATION_INDEX_TYPE, PUBLICATION_MAX_BYTES, PUBLICATION_STATEMENT, PUBLICATION_VERSION, PUBLISHABLE_ID_RE, RECORD_INDEX_TYPE, STANDING_FIELDS, STORE_RECORDS_DIR, STORE_STANDING_FILE, isPublishableId } from "./publication-vocabulary.ts";
export type { ConstructionKind } from "./publication-vocabulary.ts";

export interface Construction {
  kind: ConstructionKind;
  patched: string[];
}
export interface DisclosureRegistry {
  asset: { symbol: string; name: string; issuerName: string; authorityId: string } | null;
  chain: { chainId: string; name: string } | null;
}
export interface RecordValidationResult {
  ok: boolean;
  findings: Finding[];
}
export interface ReceiptCarried {
  issued: WallPrintReceipt | null;
  verification: ReceiptVerification | null;
}
export interface ReplayCarried {
  outcome: ReplayOutcome;
  reasons: ReplayReason[];
  recomputedDigest: string | null;
  mismatches: string[];
}
export interface DiffCarried {
  changed: boolean;
  changes: { category: string; path: string; before: string | null; after: string | null; reason?: string | undefined }[];
}

/** One record exactly as the engine exported it for disclosure, with a WalletWall-authored title and the registry's point-in-time names. */
export interface DisclosureExport {
  title: string;
  construction: Construction | null;
  registry: DisclosureRegistry;
  id: string;
  record: WallPrintRecord;
  /** The digest preimage: the record without `digest`, in RFC 8785 form. */
  canonical: string;
  validation: RecordValidationResult;
  digest: DigestVerification;
  lifecycle: { state: LifecycleState; events: LifecycleEvent[] };
  supersedes: Supersedes | null;
  supersededBy: SuccessorRef | null;
  lineage: Lineage;
  diff: DiffCarried | null;
  receipt: ReceiptCarried;
  replay: ReplayCarried;
}

/** The immutable public disclosure: identified by record id + digest, serialized in RFC 8785 form. */
export interface PublicDisclosure {
  readonly type: typeof DISCLOSURE_TYPE;
  readonly version: typeof PUBLICATION_VERSION;
  readonly wallprintVersion: string;
  readonly recordId: string;
  readonly digest: string;
  readonly canonical: string;
  readonly title: string;
  readonly construction: Construction | null;
  readonly registry: DisclosureRegistry;
  readonly validation: RecordValidationResult;
  readonly digestCheck: DigestVerification;
  readonly receipt: ReceiptCarried;
  readonly replay: ReplayCarried;
  readonly diff: DiffCarried | null;
  readonly supersedes: Supersedes | null;
}

export interface PublicationRecord {
  digest: string;
  wallprintVersion: string;
  publishedAt: string;
}

/** A record's standing: mutable metadata beside its immutable bytes. It only ever extends. */
export interface RecordStanding {
  type: typeof RECORD_INDEX_TYPE;
  version: typeof PUBLICATION_VERSION;
  recordId: string;
  publications: PublicationRecord[];
  lifecycle: { state: LifecycleState; events: LifecycleEvent[] };
  supersedes: Supersedes | null;
  supersededBy: SuccessorRef | null;
  lineage: Lineage;
}

export interface PublicationIndexEntry {
  recordId: string;
  digest: string;
  wallprintVersion: string;
  publishedAt: string;
  lifecycle: LifecycleState;
  successor: SuccessorRef | null;
  predecessor: { id: string; digest: string } | null;
}

export interface PublicationIndex {
  type: typeof PUBLICATION_INDEX_TYPE;
  version: typeof PUBLICATION_VERSION;
  resolverBase: string;
  route: string;
  records: PublicationIndexEntry[];
}

export type Verification<T> = { ok: true } & T | { ok: false; findings: Finding[] };

// ─── schemas ─────────────────────────────────────────────────────────────────

const Hex64 = z.string().regex(HEX64_RE);
const RecordId = z.string().regex(RECORD_ID_RE);
const SafeText64 = z.string().regex(SAFE_TEXT_RE).max(64);
const Instant = z.string().refine(isCanonicalInstant, { message: "not a canonical instant" });
/** WalletWall-authored title: output-safe prose with sentence punctuation, no quotes, brackets, slashes or control characters. */
const TITLE_RE = /^[A-Za-z0-9 _.,:;()-]{1,320}$/;
const PATCHED_PATH_RE = /^[A-Za-z0-9_.[\]-]{1,96}$/;
/** A semantic diff path: fixed section names with keyed indices (`assessments[<assessor>|<policy>].field`), as diff.ts spells them. */
const DIFF_PATH_RE = /^[A-Za-z0-9_.:/|[\]-]{1,200}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FINDING_PATH_RE = /^[A-Za-z0-9_.[\]]{0,160}$/;
const SECTION_RE = /^[A-Za-z]{1,32}$/;
const VERSION_RE = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;

const FindingSchema = z.strictObject({ code: z.string().regex(CODE_RE), path: z.string().regex(FINDING_PATH_RE) });
const ValidationSchema = z.strictObject({ ok: z.boolean(), findings: z.array(FindingSchema).max(4096) });
const DigestCheckSchema = z.strictObject({ hasDigest: z.boolean(), matches: z.boolean(), computedDigest: Hex64.nullable() });
const SuccessorSchema = z.strictObject({ id: RecordId, digest: Hex64, kind: z.enum(SUPERSESSION_KINDS) });
const LineageSchema = z.strictObject({ root: RecordId, current: RecordId, predecessor: RecordId.nullable(), successor: RecordId.nullable(), chain: z.array(RecordId).min(1).max(1024) });
const LifecycleSchema = z.strictObject({ state: z.enum(LIFECYCLE_STATES), events: z.array(LifecycleEventSchema).min(1).max(64) });
const DiffChangeSchema = z.strictObject({
  category: z.enum(DIFF_CATEGORIES),
  path: z.string().regex(DIFF_PATH_RE),
  before: z.string().max(PUBLICATION_MAX_BYTES).nullable(),
  after: z.string().max(PUBLICATION_MAX_BYTES).nullable(),
  reason: z.string().regex(CODE_RE).optional(),
});
const DiffSchema = z.strictObject({ changed: z.boolean(), changes: z.array(DiffChangeSchema).max(4096) }).refine((d) => d.changed === d.changes.length > 0, { message: "changed must say whether changes exist" });
const ReceiptVerificationSchema = z.strictObject({ matches: z.boolean(), reasons: z.array(z.enum(RECEIPT_REASONS)).max(RECEIPT_REASONS.length) });
const ReceiptSchema = z.strictObject({ issued: WallPrintReceiptSchema.nullable(), verification: ReceiptVerificationSchema.nullable() });
const ReplaySchema = z.strictObject({
  outcome: z.enum(REPLAY_OUTCOMES),
  reasons: z.array(z.enum(REPLAY_REASONS)).max(REPLAY_REASONS.length),
  recomputedDigest: Hex64.nullable(),
  mismatches: z.array(z.string().regex(SECTION_RE)).max(32),
});
const RegistrySchema = z.strictObject({
  asset: z.strictObject({ symbol: SafeText64, name: SafeText64, issuerName: SafeText64, authorityId: SafeText64 }).nullable(),
  chain: z.strictObject({ chainId: z.string().regex(CHAIN_ID_RE), name: SafeText64 }).nullable(),
});
const ConstructionSchema = z.strictObject({ kind: z.enum(CONSTRUCTION_KINDS), patched: z.array(z.string().regex(PATCHED_PATH_RE)).max(32) });
const Title = z.string().regex(TITLE_RE);

/** The export, as a closed shape. The record itself is admitted by validateWallPrintRecord, never by this schema alone. */
const DisclosureExportSchema = z.strictObject({
  title: Title,
  construction: ConstructionSchema.nullable(),
  registry: RegistrySchema,
  id: RecordId,
  record: z.unknown(),
  canonical: z.string().max(PUBLICATION_MAX_BYTES),
  validation: ValidationSchema,
  digest: DigestCheckSchema,
  lifecycle: LifecycleSchema,
  supersedes: SupersedesSchema.nullable(),
  supersededBy: SuccessorSchema.nullable(),
  lineage: LineageSchema,
  diff: DiffSchema.nullable(),
  receipt: ReceiptSchema,
  replay: ReplaySchema,
});

const PublicDisclosureSchema = z.strictObject({
  type: z.literal(DISCLOSURE_TYPE),
  version: z.string().regex(VERSION_RE),
  wallprintVersion: z.string().regex(VERSION_RE),
  recordId: RecordId,
  digest: Hex64,
  canonical: z.string().max(PUBLICATION_MAX_BYTES),
  title: Title,
  construction: ConstructionSchema.nullable(),
  registry: RegistrySchema,
  validation: ValidationSchema,
  digestCheck: DigestCheckSchema,
  receipt: ReceiptSchema,
  replay: ReplaySchema,
  diff: DiffSchema.nullable(),
  supersedes: SupersedesSchema.nullable(),
});

const PublicationRecordSchema = z.strictObject({ digest: Hex64, wallprintVersion: z.string().regex(VERSION_RE), publishedAt: Instant });

const RecordStandingSchema = z.strictObject({
  type: z.literal(RECORD_INDEX_TYPE),
  version: z.literal(PUBLICATION_VERSION),
  recordId: RecordId,
  publications: z.array(PublicationRecordSchema).min(1).max(256),
  lifecycle: LifecycleSchema,
  supersedes: SupersedesSchema.nullable(),
  supersededBy: SuccessorSchema.nullable(),
  lineage: LineageSchema,
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The canonical form, or null when the value has none (a JSON number, a lone surrogate, a non-plain object, too deep). */
function tryCanonical(v: unknown): string | null {
  try {
    return canonicalize(v);
  } catch {
    return null;
  }
}
/** SHA-256 over the canonical form, or null when the value has no canonical form. */
function tryDigest(v: unknown): string | null {
  try {
    return evidenceDigest(v);
  } catch {
    return null;
  }
}
const same = (a: unknown, b: unknown): boolean => {
  const ca = tryCanonical(a);
  return ca !== null && ca === tryCanonical(b);
};
const sortedUnique = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || ordinal(xs[i - 1]!, x) < 0);

/** A zod issue path rendered from fixed schema segments only; an unrecognised key reports its parent, never itself. */
function renderPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (typeof seg === "string") out += out === "" ? seg : `.${seg}`;
  }
  return out;
}

function issueFindings(error: z.ZodError): Finding[] {
  const out: Finding[] = [];
  for (const issue of error.issues) {
    const path = renderPath(issue.path);
    switch (issue.code) {
      case "unrecognized_keys":
        out.push(finding("UNKNOWN_FIELD", path));
        break;
      case "invalid_value":
        out.push(finding("INVALID_ENUM", path));
        break;
      case "invalid_format":
      case "too_big":
      case "too_small":
      case "custom":
        out.push(finding("INVALID_FORMAT", path));
        break;
      default:
        out.push(finding("INVALID_TYPE", path));
    }
  }
  return out;
}

// ─── privacy gate ────────────────────────────────────────────────────────────

const cp = (n: number): string => String.fromCodePoint(n);
const range = (a: number, b: number): string => `${cp(a)}-${cp(b)}`;
/** C0 controls, DEL, zero-width and bidirectional marks, embeddings, overrides and isolates: characters that steer a reading without being read. */
const CONTROL_RE = new RegExp(`[${range(0, 0x1f)}${cp(0x7f)}${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2066, 0x2069)}]`, "u");
/** A drive path in either slash, or a Unix home, temporary, system or mount root, or a home-relative path. */
const LOCAL_PATH_RE = /\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var|etc|opt|mnt|srv|Volumes|private)\/|(?:^|[\s"'(=])~\//;
/**
 * Every pattern below is anchored at the start of its run (a lookbehind refusing a character the run itself could hold)
 * and bounded in length, so a hostile long string costs linear time: one attempt per run, never one per character.
 */
/** An e-mail address: a local part of at most 64 characters, an @, and a dotted domain. */
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,16}\.[A-Za-z]{2,24}\b/;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
/** An IPv6 address: at least four colon-separated hex groups, or a compressed form with `::` beside a hex group. A time of day (two colons) and a bare `::` are not one. */
const IPV6_RE = /(?:^|[^0-9A-Za-z:])(?:(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}|[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6}::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?|::[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})(?![0-9A-Za-z:])/;
const URL_RE = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\//i;
/** A bare host name on a common top-level domain, which names a service as a URL would. Checked outside the record's own content. */
const HOST_NAME_RE = /(?<![a-z0-9.-])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,16}\.(?:org|com|net|app|dev|io|xyz|ai|co|gov|edu|info|biz|space|cloud|site)\b/i;
/** An interpolation or an environment lookup, refused everywhere. */
const ENVIRONMENT_RE = /\$\{|\bprocess\.env\b|%[A-Za-z_][A-Za-z0-9_]*%/;
/** A `$NAME` reference, refused in WalletWall-authored text; inside the record a `$` word may be a ticker. */
const DOLLAR_NAME_RE = /\$[A-Z_][A-Z0-9_]*\b/;
const ADDRESS_RE = /\b0x[0-9a-fA-F]{40}\b/;
const PRIVATE_KEY_NAME_RE = /^(?:session(?:id|_id|-id)?|cookie|token|secret|password|passwd|credential|api[_-]?key|user[_-]?id|device[_-]?id|machine[_-]?id|email|ip|history|query)$/i;
/** Paths whose strings are the record's own content: a wallet address there is the disclosure's subject, not metadata. */
const RECORD_CONTENT_RE = /^(?:record|canonical|diff\.changes\[\d+\]\.(?:before|after))(?:$|[.[])/;
const MAX_WALK_NODES = 200_000;

/**
 * Walk every string (and key) of a value and report what may not leave: credential-shaped text, a local filesystem
 * path, an e-mail address, an IP address, a URL, an environment reference, a control or direction character, a
 * private-metadata key name, and (outside the record's own content) a wallet address. Codes and paths are fixed.
 */
export function privacyFindings(value: unknown, path = ""): Finding[] {
  const out: Finding[] = [];
  let nodes = 0;
  const add = (code: string, at: string): void => {
    if (!out.some((f) => f.code === code && f.path === at)) out.push(finding(code, at));
  };
  const walk = (v: unknown, at: string, depth: number): void => {
    if (++nodes > MAX_WALK_NODES || depth > 64) {
      add("TOO_LARGE", at);
      return;
    }
    if (typeof v === "string") {
      if (findSecretLike(v) !== null) add("SUSPECTED_SECRET", at);
      if (LOCAL_PATH_RE.test(v)) add("LOCAL_PATH", at);
      if (EMAIL_RE.test(v)) add("PERSONAL_DATA", at);
      if (IPV4_RE.test(v) || IPV6_RE.test(v)) add("NETWORK_ADDRESS", at);
      if (URL_RE.test(v)) add("URL_LITERAL", at);
      if (ENVIRONMENT_RE.test(v) || (!RECORD_CONTENT_RE.test(at) && DOLLAR_NAME_RE.test(v))) add("ENVIRONMENT_VALUE", at);
      if (CONTROL_RE.test(v)) add("CONTROL_CHARACTERS", at);
      if (!RECORD_CONTENT_RE.test(at) && ADDRESS_RE.test(v)) add("ADDRESS_OUTSIDE_RECORD", at);
      if (!RECORD_CONTENT_RE.test(at) && HOST_NAME_RE.test(v)) add("HOST_NAME", at);
      return;
    }
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`, depth + 1));
      return;
    }
    for (const k of Object.keys(v)) {
      const next = at === "" ? k : `${at}.${k}`;
      // A key name is reported by the parent's fixed path; the key itself is a caller value and is never echoed. Inside the
      // record the keys are the engine's own closed vocabulary (a claim subject names its `token`), so they are not metadata.
      if (!RECORD_CONTENT_RE.test(at) && PRIVATE_KEY_NAME_RE.test(k)) add("PRIVATE_METADATA", at);
      if (CONTROL_RE.test(k)) add("CONTROL_CHARACTERS", at);
      walk((v as Record<string, unknown>)[k], FINDING_PATH_RE.test(next) ? next : at, depth + 1);
    }
  };
  walk(value, path, 0);
  return out;
}

// ─── consistency ─────────────────────────────────────────────────────────────

interface Carried {
  validation: RecordValidationResult;
  digestCheck: DigestVerification;
  receipt: ReceiptCarried;
  replay: ReplayCarried;
  diff: DiffCarried | null;
  supersedes: Supersedes | null;
}

/** The successor a record's ledger names: the `ref` of its CORRECTED or SUPERSEDED event, or null. */
function ledgerSuccessor(events: readonly LifecycleEvent[]): SuccessorRef | null {
  const e = events.find((x) => x.state === "CORRECTED" || x.state === "SUPERSEDED");
  return e?.ref ?? null;
}

/** Every carried engine result must agree with the record it accompanies. Fixed codes, fixed paths. */
function carriedFindings(record: WallPrintRecord, id: string, c: Carried, receiptPath: string, digestPath: string): Finding[] {
  const out: Finding[] = [];
  if (!same(c.validation, { ok: true, findings: [] })) out.push(finding("VALIDATION_MISMATCH", "validation"));
  if (!same(c.digestCheck, verifyWallPrintDigest(record))) out.push(finding("DIGEST_CHECK_MISMATCH", digestPath));
  if (!same(c.supersedes, record.supersedes)) out.push(finding("SUPERSEDES_MISMATCH", "supersedes"));
  if ((record.supersedes === null) !== (c.diff === null)) out.push(finding("DIFF_MISMATCH", "diff"));
  const issued = c.receipt.issued;
  if (issued === null) {
    if (c.receipt.verification !== null) out.push(finding("RECEIPT_MISMATCH", receiptPath));
  } else {
    const v = record.versions;
    if (issued.recordId !== id || issued.digest !== record.digest || issued.bundleDigest !== record.evidence.bundleDigest || issued.wallprintVersion !== record.wallprintVersion) out.push(finding("RECEIPT_MISMATCH", `${receiptPath}.issued`));
    else if (issued.versions.wwep !== v.wwep || issued.versions.registry !== v.registry || issued.versions.policies !== v.policies || issued.versions.rules !== v.rules) out.push(finding("RECEIPT_MISMATCH", `${receiptPath}.issued`));
    if (c.receipt.verification !== null && !same(c.receipt.verification, verifyReceipt(issued, record))) out.push(finding("RECEIPT_VERIFICATION_MISMATCH", `${receiptPath}.verification`));
  }
  const r = c.replay;
  const consistent =
    sortedUnique(r.reasons) &&
    sortedUnique(r.mismatches) &&
    ((r.outcome === "REPRODUCED" && r.reasons.length === 0 && r.mismatches.length === 0 && r.recomputedDigest === record.digest) ||
      (r.outcome === "MISMATCH" && r.reasons.length > 0 && r.reasons.every((x) => !UNREPLAYABLE_REASONS.includes(x)) && r.mismatches.length > 0 && r.recomputedDigest !== null && r.recomputedDigest !== record.digest) ||
      (r.outcome === "UNREPLAYABLE" && r.reasons.length > 0 && r.reasons.every((x) => UNREPLAYABLE_REASONS.includes(x)) && r.mismatches.length === 0 && r.recomputedDigest === null));
  if (!consistent) out.push(finding("REPLAY_INCONSISTENT", "replay"));
  return out;
}

function titleFindings(title: string): Finding[] {
  const out: Finding[] = [];
  if (findReservedAssuranceTerms(title).length > 0) out.push(finding("MANUFACTURED_ASSURANCE", "title"));
  if (findSecretLike(title) !== null) out.push(finding("SUSPECTED_SECRET", "title"));
  return out;
}

/** The findings for a disclosure export; empty when it is publishable. Never throws, never echoes. */
export function publicationFindings(raw: unknown): Finding[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || hasForbiddenStructure(raw)) return [finding("INVALID_TYPE", "")];
  // The privacy gate reads the raw export first, so what may not leave is named even when the shape is also wrong.
  const out: Finding[] = privacyFindings(raw);
  const parsed = DisclosureExportSchema.safeParse(raw);
  if (!parsed.success) return [...out, ...issueFindings(parsed.error)];
  const e = parsed.data;
  if (!isPublishableId(e.id)) out.push(finding("PUBLICATION_ID", "id"));
  out.push(...titleFindings(e.title));
  const valid = validateWallPrintRecord(e.record);
  if (!valid.ok) {
    out.push(finding("INVALID_RECORD", "record"));
    return out;
  }
  const record = valid.record;
  if (record.id !== e.id) out.push(finding("ID_MISMATCH", "record.id"));
  const canonical = tryCanonical(wallPrintPayload(record));
  if (canonical === null || canonical !== e.canonical) out.push(finding("CANONICAL_MISMATCH", "canonical"));
  const events = e.lifecycle.events;
  const first = events[0];
  const last = events[events.length - 1];
  if (!verifyLifecycleChain(events).ok || first === undefined || last === undefined || first.recordId !== e.id || first.recordDigest !== record.digest || last.state !== e.lifecycle.state) out.push(finding("LIFECYCLE_INVALID", "lifecycle"));
  if (!same(e.supersededBy, ledgerSuccessor(events))) out.push(finding("STANDING_MISMATCH", "supersededBy"));
  const L = e.lineage;
  const at = L.chain.indexOf(e.id);
  const predecessor = record.supersedes?.id ?? null;
  const successor = e.supersededBy?.id ?? null;
  const lineageOk = at >= 0 && L.root === L.chain[0] && L.current === L.chain[L.chain.length - 1] && L.predecessor === predecessor && L.successor === successor && (L.chain[at - 1] ?? null) === predecessor && (L.chain[at + 1] ?? null) === successor;
  if (!lineageOk) out.push(finding("LINEAGE_MISMATCH", "lineage"));
  out.push(...carriedFindings(record, e.id, { validation: e.validation, digestCheck: e.digest, receipt: e.receipt, replay: e.replay, diff: e.diff, supersedes: e.supersedes }, "receipt", "digest"));
  return out;
}

// ─── the immutable artifact ──────────────────────────────────────────────────

/** Build the immutable public disclosure and its canonical bytes. Throws INVALID_PUBLICATION with the findings. */
export function buildPublicDisclosure(raw: unknown): { artifact: PublicDisclosure; bytes: string } {
  const findings = publicationFindings(raw);
  if (findings.length > 0) throw new WallPrintError("INVALID_PUBLICATION", findings);
  const e = DisclosureExportSchema.parse(raw);
  const record = e.record as WallPrintRecord;
  const artifact: PublicDisclosure = {
    type: DISCLOSURE_TYPE,
    version: PUBLICATION_VERSION,
    wallprintVersion: record.wallprintVersion,
    recordId: e.id,
    digest: record.digest,
    canonical: e.canonical,
    title: e.title,
    construction: e.construction,
    registry: e.registry,
    validation: e.validation,
    digestCheck: e.digest,
    receipt: e.receipt,
    replay: e.replay,
    diff: e.diff,
    supersedes: e.supersedes,
  };
  const bytes = canonicalize(artifact);
  // Every artifact is read back through the public verifier before it may be written: the bytes must prove themselves.
  const check = verifyPublicDisclosure(bytes);
  if (!check.ok) throw new WallPrintError("INVALID_PUBLICATION", check.findings);
  return { artifact: deepFreeze(JSON.parse(bytes) as PublicDisclosure), bytes };
}

/**
 * Verify published bytes: a canonical-form JSON object of the fixed shape whose canonical preimage parses to a valid
 * record, is that record's RFC 8785 form, digests to the artifact's digest, and whose carried results agree with the
 * record. Fails closed with fixed codes; never echoes.
 */
export function verifyPublicDisclosure(bytes: unknown): Verification<{ artifact: PublicDisclosure; record: WallPrintRecord }> {
  if (typeof bytes !== "string") return { ok: false, findings: [finding("INVALID_TYPE", "")] };
  if (bytes.length > PUBLICATION_MAX_BYTES) return { ok: false, findings: [finding("TOO_LARGE", "")] };
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    return { ok: false, findings: [finding("MALFORMED", "")] };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || hasForbiddenStructure(value)) return { ok: false, findings: [finding("INVALID_TYPE", "")] };
  const v = value as Record<string, unknown>;
  // The version is read first: nothing is assumed about the shape of another publication version.
  if (v["version"] !== PUBLICATION_VERSION) return { ok: false, findings: [finding("UNSUPPORTED_VERSION", "version")] };
  const parsed = PublicDisclosureSchema.safeParse(value);
  if (!parsed.success) return { ok: false, findings: issueFindings(parsed.error) };
  const a = parsed.data;
  const out: Finding[] = [];
  if (canonicalize(a) !== bytes) out.push(finding("NOT_CANONICAL", ""));
  out.push(...titleFindings(a.title));
  out.push(...privacyFindings(a));
  let payload: unknown;
  try {
    payload = JSON.parse(a.canonical);
  } catch {
    out.push(finding("CANONICAL_INVALID", "canonical"));
    return { ok: false, findings: out };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || hasForbiddenStructure(payload)) {
    out.push(finding("CANONICAL_INVALID", "canonical"));
    return { ok: false, findings: out };
  }
  // The integrity question comes first and is answered on its own: do these canonical bytes digest to the digest they are
  // published under? Then: are they the one canonical spelling? Only then is the record itself validated.
  const reserialized = tryCanonical(payload);
  const computed = tryDigest(payload);
  if (computed === null) out.push(finding("CANONICAL_INVALID", "canonical"));
  else if (computed !== a.digest) out.push(finding("DIGEST_MISMATCH", "canonical"));
  if (reserialized !== a.canonical) out.push(finding("NOT_CANONICAL", "canonical"));
  const candidate = { ...(payload as Record<string, unknown>), digest: a.digest };
  const valid = validateWallPrintRecord(candidate);
  if (!valid.ok) {
    out.push(finding("INVALID_RECORD", "canonical"));
    return { ok: false, findings: out };
  }
  const record = valid.record;
  if (wallPrintDigest(record) !== a.digest) out.push(finding("DIGEST_MISMATCH", "canonical"));
  if (record.id !== a.recordId) out.push(finding("ID_MISMATCH", "recordId"));
  if (!isPublishableId(a.recordId)) out.push(finding("PUBLICATION_ID", "recordId"));
  if (a.wallprintVersion !== record.wallprintVersion) out.push(finding("VERSION_MISMATCH", "wallprintVersion"));
  if (!SUPPORTED_WALLPRINT_VERSIONS.includes(a.wallprintVersion)) out.push(finding("UNSUPPORTED_VERSION", "wallprintVersion"));
  out.push(...carriedFindings(record, a.recordId, { validation: a.validation, digestCheck: a.digestCheck, receipt: a.receipt, replay: a.replay, diff: a.diff, supersedes: a.supersedes }, "receipt", "digestCheck"));
  if (out.length > 0) return { ok: false, findings: out };
  return { ok: true, artifact: deepFreeze(a as PublicDisclosure), record };
}

/** IDENTICAL when the bytes already published are exactly these bytes (idempotent re-publication); CONFLICT for any difference. */
export function comparePublication(existingBytes: string, bytes: string): "IDENTICAL" | "CONFLICT" {
  return existingBytes === bytes ? "IDENTICAL" : "CONFLICT";
}

// ─── standing ────────────────────────────────────────────────────────────────

const byInstantThenDigest = (a: PublicationRecord, b: PublicationRecord): number => ordinal(a.publishedAt, b.publishedAt) || ordinal(a.digest, b.digest);

/** The record's standing from its export and the instants it was published at. Throws INVALID_PUBLICATION. */
export function recordStanding(raw: unknown, publications: readonly PublicationRecord[]): RecordStanding {
  const findings = publicationFindings(raw);
  if (findings.length > 0) throw new WallPrintError("INVALID_PUBLICATION", findings);
  const e = DisclosureExportSchema.parse(raw);
  const pubs = z.array(PublicationRecordSchema).min(1).max(256).safeParse(publications);
  if (!pubs.success) throw new WallPrintError("INVALID_PUBLICATION", issueFindings(pubs.error).map((f) => finding(f.code, `publications${f.path === "" ? "" : `.${f.path}`}`)));
  return deepFreeze(
    JSON.parse(
      canonicalize({
        type: RECORD_INDEX_TYPE,
        version: PUBLICATION_VERSION,
        recordId: e.id,
        publications: [...pubs.data].sort(byInstantThenDigest),
        lifecycle: e.lifecycle,
        supersedes: e.supersedes,
        supersededBy: e.supersededBy,
        lineage: e.lineage,
      }),
    ) as RecordStanding,
  );
}

/** Read a standing document as published: the closed shape, with a lifecycle ledger that verifies. Never throws. */
export function verifyStanding(value: unknown): Verification<{ standing: RecordStanding }> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || hasForbiddenStructure(value)) return { ok: false, findings: [finding("STANDING_INVALID", "")] };
  const parsed = RecordStandingSchema.safeParse(value);
  if (!parsed.success) return { ok: false, findings: issueFindings(parsed.error).map((f) => finding("STANDING_INVALID", f.path)) };
  const events = parsed.data.lifecycle.events;
  const last = events[events.length - 1];
  if (!verifyLifecycleChain(events).ok || last === undefined || last.state !== parsed.data.lifecycle.state || events[0]?.recordId !== parsed.data.recordId) return { ok: false, findings: [finding("LIFECYCLE_INVALID", "lifecycle")] };
  // One committed digest per record id: every publication of a record is the digest its COMMITTED event names.
  if (!parsed.data.publications.every((p) => p.digest === events[0]?.recordDigest)) return { ok: false, findings: [finding("STANDING_MISMATCH", "publications")] };
  if (!same(parsed.data.supersededBy, ledgerSuccessor(events))) return { ok: false, findings: [finding("STANDING_MISMATCH", "supersededBy")] };
  return { ok: true, standing: deepFreeze(parsed.data) };
}

/**
 * Extend an existing standing with a newer one. Standing only ever extends: the ledger may append events, a successor
 * is set once, the lineage grows at its end, and the first publication instant of each digest is kept. A rewritten
 * history is refused. `existing` null or undefined is the first publication.
 */
export function extendStanding(existing: unknown, next: RecordStanding): Verification<{ standing: RecordStanding; changed: boolean }> {
  const nextParsed = RecordStandingSchema.safeParse(next);
  if (!nextParsed.success) return { ok: false, findings: issueFindings(nextParsed.error).map((f) => finding("STANDING_INVALID", f.path)) };
  if (existing === null || existing === undefined) return { ok: true, standing: next, changed: true };
  const prevParsed = RecordStandingSchema.safeParse(existing);
  if (!prevParsed.success) return { ok: false, findings: [finding("STANDING_INVALID", "")] };
  const prev = prevParsed.data;
  const out: Finding[] = [];
  if (prev.recordId !== next.recordId) out.push(finding("STANDING_MISMATCH", "recordId"));
  const prefix = prev.lifecycle.events.length <= next.lifecycle.events.length && prev.lifecycle.events.every((ev, i) => same(ev, next.lifecycle.events[i]));
  if (!prefix || !verifyLifecycleChain(next.lifecycle.events).ok) out.push(finding("HISTORY_REWRITTEN", "lifecycle.events"));
  if (!same(prev.supersedes, next.supersedes)) out.push(finding("STANDING_MISMATCH", "supersedes"));
  if (prev.supersededBy !== null && !same(prev.supersededBy, next.supersededBy)) out.push(finding("STANDING_MISMATCH", "supersededBy"));
  const chainPrefix = prev.lineage.chain.length <= next.lineage.chain.length && prev.lineage.chain.every((id, i) => id === next.lineage.chain[i]);
  if (!chainPrefix || prev.lineage.root !== next.lineage.root || prev.lineage.predecessor !== next.lineage.predecessor) out.push(finding("LINEAGE_REWRITTEN", "lineage"));
  if (out.length > 0) return { ok: false, findings: out };
  const known = new Map(prev.publications.map((p) => [p.digest, p]));
  const merged = [...prev.publications, ...next.publications.filter((p) => !known.has(p.digest))].sort(byInstantThenDigest);
  const standing = JSON.parse(canonicalize({ ...next, publications: merged })) as RecordStanding;
  return { ok: true, standing: deepFreeze(standing), changed: !same(standing, prev) };
}

/**
 * The store as a graph: standings that name each other must bind each other. A published successor binds the
 * predecessor that names it (id, committed digest, kind) and is named by it with its own committed digest; a predecessor
 * published beside its successor already names it, and names exactly it (publishing a successor publishes the
 * predecessor's extended standing too); one record per id; at most one successor per predecessor and at most one
 * predecessor per successor, published or not. A neighbour that is not published is allowed: the
 * ledger names it, and its link resolves to "unavailable". Fixed codes and paths; never throws.
 */
export function storeGraphFindings(standings: readonly RecordStanding[]): Finding[] {
  const out: Finding[] = [];
  const add = (code: string, path: string): void => {
    if (!out.some((f) => f.code === code && f.path === path)) out.push(finding(code, path));
  };
  const byId = new Map<string, { s: RecordStanding; i: number }>();
  standings.forEach((s, i) => {
    if (byId.has(s.recordId)) add("DUPLICATE_RECORD_ID", `standings[${i}].recordId`);
    else byId.set(s.recordId, { s, i });
  });
  const committed = (s: RecordStanding): string | null => s.lifecycle.events[0]?.recordDigest ?? null;
  const successorCount = new Map<string, number>();
  /** How many published records name each successor id: a successor can bind only one predecessor, published or not. */
  const predecessorCount = new Map<string, number>();
  standings.forEach((s, i) => {
    if (s.supersedes !== null) {
      successorCount.set(s.supersedes.id, (successorCount.get(s.supersedes.id) ?? 0) + 1);
      const p = byId.get(s.supersedes.id);
      if (p !== undefined) {
        if (committed(p.s) !== s.supersedes.digest) add("PREDECESSOR_MISMATCH", `standings[${i}].supersedes`);
        const named = p.s.supersededBy;
        if (named === null) add("STALE_PREDECESSOR", `standings[${p.i}].supersededBy`);
        // The predecessor's ledger names its one successor; a record claiming to supersede it must be that successor.
        else if (named.id !== s.recordId || named.digest !== committed(s) || named.kind !== s.supersedes.kind) add("PREDECESSOR_NAMES_OTHER", `standings[${i}].supersedes`);
      }
    }
    const by = s.supersededBy;
    if (by !== null) {
      predecessorCount.set(by.id, (predecessorCount.get(by.id) ?? 0) + 1);
      const t = byId.get(by.id);
      if (t !== undefined) {
        const back = t.s.supersedes;
        const binds = back !== null && back.id === s.recordId && back.digest === committed(s) && back.kind === by.kind && committed(t.s) === by.digest;
        if (!binds) add("SUCCESSOR_MISMATCH", `standings[${i}].supersededBy`);
      }
    }
  });
  for (const [predecessor, n] of successorCount) {
    const p = byId.get(predecessor);
    if (n > 1) add("MULTIPLE_SUCCESSORS", p === undefined ? "standings" : `standings[${p.i}]`);
  }
  for (const [successor, n] of predecessorCount) {
    const t = byId.get(successor);
    if (n > 1) add("MULTIPLE_PREDECESSORS", t === undefined ? "standings" : `standings[${t.i}]`);
  }
  return out;
}

/** The publication index: one entry per published digest, sorted, naming the resolver base and route. Throws INVALID_PUBLICATION. */
export function publicationIndex(standings: readonly RecordStanding[], resolverBase: string): PublicationIndex {
  if (!isResolverBase(resolverBase)) throw new WallPrintError("INVALID_PUBLICATION", [finding("INVALID_RESOLVER_BASE", "resolverBase")]);
  const seen = new Set<string>();
  const records: PublicationIndexEntry[] = [];
  standings.forEach((s, i) => {
    const parsed = RecordStandingSchema.safeParse(s);
    if (!parsed.success) throw new WallPrintError("INVALID_PUBLICATION", [finding("STANDING_INVALID", `standings[${i}]`)]);
    if (seen.has(parsed.data.recordId)) throw new WallPrintError("INVALID_PUBLICATION", [finding("DUPLICATE_RECORD_ID", `standings[${i}]`)]);
    seen.add(parsed.data.recordId);
    for (const p of parsed.data.publications) {
      records.push({
        recordId: parsed.data.recordId,
        digest: p.digest,
        wallprintVersion: p.wallprintVersion,
        publishedAt: p.publishedAt,
        lifecycle: parsed.data.lifecycle.state,
        successor: parsed.data.supersededBy,
        predecessor: parsed.data.supersedes === null ? null : { id: parsed.data.supersedes.id, digest: parsed.data.supersedes.digest },
      });
    }
  });
  records.sort((a, b) => ordinal(a.recordId, b.recordId) || ordinal(a.publishedAt, b.publishedAt) || ordinal(a.digest, b.digest));
  return deepFreeze(JSON.parse(canonicalize({ type: PUBLICATION_INDEX_TYPE, version: PUBLICATION_VERSION, resolverBase, route: RESOLVER_ROUTE, records })) as PublicationIndex);
}
