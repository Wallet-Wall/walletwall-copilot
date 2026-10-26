import { z } from "zod";
import { canonicalize, evidenceDigest } from "../canonical.ts";
import { SAFE_TEXT_RE } from "../schemas.ts";
import { WallPrintError, finding, type Finding } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { findReservedAssuranceTerms, findSecretLike } from "./language.ts";
import { HEX64_RE, RECORD_ID_RE, validateWallPrintRecord, type Supersedes, type WallPrintRecord } from "./record.ts";
import { LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, SUPERSESSION_KINDS, WALLPRINT_LIMITS, type LifecycleState, type SupersessionKind } from "./vocabulary.ts";

/**
 * WallPrint history: the append-only disclosure lifecycle of committed records.
 *
 *   correction != mutation · supersession != deletion · withdrawal != deletion
 *   WallPrint lifecycle != WWEP evidence state
 *
 * The history owns COMMITTED -> DISCLOSED -> CORRECTED | SUPERSEDED -> WITHDRAWN. It never rewrites a committed
 * record. Every change is an appended, hash-chained EVENT naming the record by id AND digest:
 *
 *   { seq, recordId, recordDigest, state, at, reason, ref, previousEventDigest, eventDigest }
 *
 * A correction or supersession is a NEW record whose `supersedes` binds the predecessor's id, digest, the kind of
 * replacement and (for a correction) the reason; committing it appends a CORRECTED / SUPERSEDED event to the
 * predecessor whose `ref` names the successor, and a COMMITTED event to the successor. Withdrawal appends a WITHDRAWN
 * event with the reason; the record, its digest, its payload, its assessments and its earlier events stay addressable.
 *
 * Lifecycle times are WallPrint-owned and must be canonical instants (UTC, millisecond precision) so one instant has
 * one spelling and one event digest. No clock is read: every `at` is supplied by the caller.
 *
 * In-memory and synchronous; a durable store is a later lane and must preserve exactly these rules.
 */

export const CANONICAL_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True for the one canonical spelling of an instant (a real calendar date, UTC, millisecond precision). */
export function isCanonicalInstant(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_INSTANT_RE.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export interface SuccessorRef {
  id: string;
  digest: string;
  kind: SupersessionKind;
}

export interface LifecycleEvent {
  /** Decimal string, 0-based per record. */
  seq: string;
  recordId: string;
  recordDigest: string;
  state: LifecycleState;
  at: string;
  reason: string | null;
  /** The successor, on CORRECTED / SUPERSEDED events; null otherwise. */
  ref: SuccessorRef | null;
  previousEventDigest: string | null;
  eventDigest: string;
}

export interface Lineage {
  root: string;
  current: string;
  predecessor: string | null;
  successor: string | null;
  chain: string[];
}

/** The four separate facts the future UI renders. Never a merged status. */
export interface WallPrintView {
  record: WallPrintRecord;
  lifecycle: { state: LifecycleState; events: readonly LifecycleEvent[] };
  supersedes: Supersedes | null;
  supersededBy: SuccessorRef | null;
  lineage: Lineage;
}

export interface HistoryValidation {
  ok: boolean;
  findings: Finding[];
}

type EventBody = Omit<LifecycleEvent, "eventDigest">;

const Hex64 = z.string().regex(HEX64_RE);

/** The closed shape of a lifecycle event. A `ref` belongs only to CORRECTED / SUPERSEDED; WITHDRAWN and CORRECTED carry a reason. */
export const LifecycleEventSchema = z
  .strictObject({
    seq: z.string().regex(/^(0|[1-9][0-9]{0,5})$/),
    recordId: z.string().regex(RECORD_ID_RE),
    recordDigest: Hex64,
    state: z.enum(LIFECYCLE_STATES),
    at: z.string().refine(isCanonicalInstant, { message: "not a canonical instant" }),
    reason: z.string().regex(SAFE_TEXT_RE).nullable(),
    ref: z.strictObject({ id: z.string().regex(RECORD_ID_RE), digest: Hex64, kind: z.enum(SUPERSESSION_KINDS) }).nullable(),
    previousEventDigest: Hex64.nullable(),
    eventDigest: Hex64,
  })
  .refine((e) => (e.ref !== null) === (e.state === "CORRECTED" || e.state === "SUPERSEDED"), { message: "ref belongs to CORRECTED/SUPERSEDED only" })
  .refine((e) => !(e.state === "WITHDRAWN" || e.state === "CORRECTED") || e.reason !== null, { message: "reason required" })
  .refine((e) => !(e.state === "COMMITTED") || (e.reason === null && e.previousEventDigest === null && e.seq === "0"), { message: "COMMITTED is the bare first event" })
  .refine((e) => e.ref === null || e.ref.id !== e.recordId, { message: "a record cannot succeed itself" });

function buildEvent(body: EventBody): LifecycleEvent {
  return deepFreeze({ ...body, eventDigest: evidenceDigest(body) });
}

function requireInstant(at: unknown): string {
  if (!isCanonicalInstant(at)) throw new WallPrintError("INVALID_INPUT", [finding("INVALID_TIMESTAMP", "at")]);
  return at;
}

/** Lifecycle reasons are WalletWall-authored prose: output-safe text, bounded by SAFE_TEXT_RE, guarded. */
function admitReason(reason: unknown, required: boolean): string | null {
  const empty = reason === undefined || reason === null || (typeof reason === "string" && reason.trim() === "");
  if (empty) {
    if (required) throw new WallPrintError("REASON_REQUIRED", [finding("REASON_REQUIRED", "reason")]);
    return null;
  }
  if (typeof reason !== "string") throw new WallPrintError("INVALID_INPUT", [finding("INVALID_TYPE", "reason")]);
  if (reason.length > WALLPRINT_LIMITS.reasonLength || !SAFE_TEXT_RE.test(reason)) throw new WallPrintError("INVALID_INPUT", [finding("INVALID_FORMAT", "reason")]);
  if (findReservedAssuranceTerms(reason).length > 0) throw new WallPrintError("MANUFACTURED_ASSURANCE", [finding("MANUFACTURED_ASSURANCE", "reason")]);
  const secret = findSecretLike(reason);
  if (secret !== null) throw new WallPrintError("SUSPECTED_SECRET", [finding(secret, "reason")]);
  return reason;
}

const subjectKey = (r: WallPrintRecord): string => canonicalize({ claimType: r.subject.claimType, temporality: r.subject.temporality, identity: r.subject.identity });

/**
 * Verify one record's event chain: sequence numbers, hash links, each event's own digest, one record and one digest
 * throughout, time moving forward, a COMMITTED start and only table transitions. Never throws.
 */
const isEventList = (value: unknown): value is readonly LifecycleEvent[] => Array.isArray(value);

export function verifyLifecycleChain(events: readonly LifecycleEvent[]): { ok: boolean; brokenAt: number | null } {
  const raw: unknown = events;
  if (!isEventList(raw)) return { ok: false, brokenAt: 0 };
  const list = raw;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === undefined || e === null || typeof e !== "object" || !LifecycleEventSchema.safeParse(e).success) return { ok: false, brokenAt: i };
    const prev = i === 0 ? null : list[i - 1];
    if (e.seq !== String(i) || e.previousEventDigest !== (prev ? prev.eventDigest : null)) return { ok: false, brokenAt: i };
    if (prev === null || prev === undefined) {
      if (e.state !== "COMMITTED") return { ok: false, brokenAt: 0 };
    } else {
      if (e.recordId !== prev.recordId || e.recordDigest !== prev.recordDigest) return { ok: false, brokenAt: i };
      if (e.at < prev.at) return { ok: false, brokenAt: i };
      if (!(LIFECYCLE_TRANSITIONS[prev.state] as readonly string[] | undefined)?.includes(e.state)) return { ok: false, brokenAt: i };
    }
    const { eventDigest, ...body } = e;
    let computed: string;
    try {
      computed = evidenceDigest(body);
    } catch {
      return { ok: false, brokenAt: i };
    }
    if (computed !== eventDigest) return { ok: false, brokenAt: i };
  }
  return { ok: true, brokenAt: null };
}

/**
 * Validate an externally supplied set of records as a history graph: every record valid, ids unique, every
 * `supersedes` link resolving to a record in the set with the matching digest, same subject, forward snapshots,
 * at most one successor per record, and no cycles. Structural checks run before digest checks so a hand-written
 * cycle is reported as a cycle. Pure; never throws.
 */
export function validateHistoryGraph(records: readonly unknown[]): HistoryValidation {
  const findings: Finding[] = [];
  const byId = new Map<string, { id: string; supersedes: { id: string; digest: string } | null; raw: unknown; index: number }>();
  records.forEach((raw, i) => {
    const r = raw as { id?: unknown; supersedes?: { id?: unknown; digest?: unknown } | null } | null;
    const id = typeof r?.id === "string" ? r.id : null;
    if (id === null) {
      findings.push(finding("INVALID_RECORD", `records[${i}]`));
      return;
    }
    if (byId.has(id)) {
      findings.push(finding("DUPLICATE_RECORD_ID", `records[${i}].id`));
      return;
    }
    const s = r?.supersedes;
    const link = s !== null && s !== undefined && typeof s.id === "string" && typeof s.digest === "string" ? { id: s.id, digest: s.digest } : null;
    byId.set(id, { id, supersedes: link, raw, index: i });
  });

  const successors = new Map<string, string[]>();
  for (const entry of byId.values()) {
    if (entry.supersedes === null) continue;
    if (entry.supersedes.id === entry.id) findings.push(finding("SELF_SUPERSESSION", `records[${entry.index}].supersedes.id`));
    if (!byId.has(entry.supersedes.id)) findings.push(finding("DANGLING_SUPERSEDES", `records[${entry.index}].supersedes.id`));
    const list = successors.get(entry.supersedes.id) ?? [];
    list.push(entry.id);
    successors.set(entry.supersedes.id, list);
  }
  for (const [predecessorId, list] of successors) {
    if (list.length > 1) findings.push(finding("MULTIPLE_SUCCESSORS", `records[${byId.get(predecessorId)?.index ?? 0}]`));
  }
  for (const entry of byId.values()) {
    const seen = new Set<string>([entry.id]);
    let cursor = entry.supersedes?.id ?? null;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        findings.push(finding("HISTORY_CYCLE", `records[${entry.index}]`));
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.supersedes?.id ?? null;
    }
  }

  const valid = new Map<string, WallPrintRecord>();
  for (const entry of byId.values()) {
    const v = validateWallPrintRecord(entry.raw);
    if (v.ok) valid.set(entry.id, v.record);
    else findings.push(finding("INVALID_RECORD", `records[${entry.index}]`));
  }
  for (const entry of byId.values()) {
    if (entry.supersedes === null) continue;
    const pred = valid.get(entry.supersedes.id);
    const self = valid.get(entry.id);
    if (pred === undefined || self === undefined) {
      if (pred !== undefined || byId.has(entry.supersedes.id)) findings.push(finding("SUPERSEDES_DIGEST_MISMATCH", `records[${entry.index}].supersedes.digest`));
      continue;
    }
    if (pred.digest !== entry.supersedes.digest) findings.push(finding("SUPERSEDES_DIGEST_MISMATCH", `records[${entry.index}].supersedes.digest`));
    if (subjectKey(pred) !== subjectKey(self)) findings.push(finding("SUBJECT_MISMATCH", `records[${entry.index}].subject`));
    if (Date.parse(self.snapshotAt) < Date.parse(pred.snapshotAt)) findings.push(finding("SNAPSHOT_ORDER", `records[${entry.index}].snapshotAt`));
  }
  return { ok: findings.length === 0, findings };
}

export interface WallPrintHistory {
  /** Validate and commit a record (plain data; a fresh frozen copy is stored). Commits a successor's predecessor transition atomically. */
  commit: (raw: unknown, options: { at: string }) => WallPrintRecord;
  disclose: (id: string, options: { at: string; reason?: string | null }) => LifecycleEvent;
  withdraw: (id: string, options: { at: string; reason: string }) => LifecycleEvent;
  get: (id: string) => WallPrintRecord | undefined;
  has: (id: string) => boolean;
  /** A fresh copy of the record's events; each event is frozen. */
  events: (id: string) => LifecycleEvent[];
  state: (id: string) => LifecycleState;
  /** Committed ids in commit order. */
  list: () => string[];
  view: (id: string) => WallPrintView | null;
  lineage: (id: string) => Lineage;
}

export function createWallPrintHistory(): WallPrintHistory {
  const records = new Map<string, WallPrintRecord>();
  const eventsById = new Map<string, LifecycleEvent[]>();
  const successorOf = new Map<string, SuccessorRef>();

  const requireRecord = (id: string): WallPrintRecord => {
    const r = records.get(id);
    if (r === undefined) throw new WallPrintError("UNKNOWN_RECORD", [finding("UNKNOWN_RECORD", "id")]);
    return r;
  };
  const lastEvent = (id: string): LifecycleEvent => {
    const list = eventsById.get(id);
    const last = list?.[list.length - 1];
    if (last === undefined) throw new WallPrintError("UNKNOWN_RECORD", [finding("UNKNOWN_RECORD", "id")]);
    return last;
  };
  const stateOf = (id: string): LifecycleState => lastEvent(id).state;
  const assertTransition = (id: string, next: LifecycleState): void => {
    if (!LIFECYCLE_TRANSITIONS[stateOf(id)].includes(next)) throw new WallPrintError("INVALID_TRANSITION", [finding("INVALID_TRANSITION", "state")]);
  };
  const assertEventOrder = (id: string, at: string): void => {
    if (at < lastEvent(id).at) throw new WallPrintError("EVENT_TIME_ORDER", [finding("EVENT_TIME_ORDER", "at")]);
  };
  const nextEvent = (id: string, state: LifecycleState, at: string, reason: string | null, ref: SuccessorRef | null): LifecycleEvent => {
    const record = requireRecord(id);
    assertTransition(id, state);
    assertEventOrder(id, at);
    const prev = lastEvent(id);
    return buildEvent({ seq: String(Number(prev.seq) + 1), recordId: id, recordDigest: record.digest, state, at, reason, ref, previousEventDigest: prev.eventDigest });
  };
  const append = (event: LifecycleEvent): LifecycleEvent => {
    eventsById.get(event.recordId)?.push(event);
    return event;
  };

  const commit = (raw: unknown, options: { at: string }): WallPrintRecord => {
    const at = requireInstant(options.at);
    const valid = validateWallPrintRecord(raw);
    if (!valid.ok) throw new WallPrintError("INVALID_RECORD", valid.findings);
    // Store a plain copy rebuilt from canonical bytes, never the caller's object.
    const record = deepFreeze(JSON.parse(canonicalize(valid.record)) as WallPrintRecord);
    if (records.has(record.id)) throw new WallPrintError("DUPLICATE_RECORD_ID", [finding("DUPLICATE_RECORD_ID", "id")]);
    if (Date.parse(at) < Date.parse(record.snapshotAt)) throw new WallPrintError("COMMIT_BEFORE_SNAPSHOT", [finding("COMMIT_BEFORE_SNAPSHOT", "at")]);

    let predecessorEvent: LifecycleEvent | null = null;
    const s = record.supersedes;
    if (s !== null) {
      const pred = records.get(s.id);
      if (pred === undefined) throw new WallPrintError("SUPERSEDES_UNKNOWN_RECORD", [finding("SUPERSEDES_UNKNOWN_RECORD", "supersedes.id")]);
      if (pred.digest !== s.digest) throw new WallPrintError("SUPERSEDES_DIGEST_MISMATCH", [finding("SUPERSEDES_DIGEST_MISMATCH", "supersedes.digest")]);
      if (subjectKey(pred) !== subjectKey(record)) throw new WallPrintError("SUBJECT_MISMATCH", [finding("SUBJECT_MISMATCH", "subject")]);
      if (Date.parse(record.snapshotAt) < Date.parse(pred.snapshotAt)) throw new WallPrintError("SNAPSHOT_ORDER", [finding("SNAPSHOT_ORDER", "snapshotAt")]);
      const next: LifecycleState = s.kind === "CORRECTION" ? "CORRECTED" : "SUPERSEDED";
      predecessorEvent = nextEvent(s.id, next, at, s.reason, { id: record.id, digest: record.digest, kind: s.kind });
    }
    const committed = buildEvent({ seq: "0", recordId: record.id, recordDigest: record.digest, state: "COMMITTED", at, reason: null, ref: null, previousEventDigest: null });

    if (predecessorEvent !== null && s !== null) {
      append(predecessorEvent);
      successorOf.set(s.id, deepFreeze({ id: record.id, digest: record.digest, kind: s.kind }));
    }
    records.set(record.id, record);
    eventsById.set(record.id, [committed]);
    return record;
  };

  const disclose = (id: string, options: { at: string; reason?: string | null }): LifecycleEvent => {
    const at = requireInstant(options.at);
    requireRecord(id);
    const reason = admitReason(options.reason, false);
    return append(nextEvent(id, "DISCLOSED", at, reason, null));
  };

  const withdraw = (id: string, options: { at: string; reason: string }): LifecycleEvent => {
    const at = requireInstant(options.at);
    requireRecord(id);
    const reason = admitReason(options.reason, true);
    return append(nextEvent(id, "WITHDRAWN", at, reason, null));
  };

  const lineage = (id: string): Lineage => {
    requireRecord(id);
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null && records.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      chain.unshift(cursor);
      cursor = records.get(cursor)?.supersedes?.id ?? null;
    }
    let next: string | null = successorOf.get(id)?.id ?? null;
    while (next !== null && !seen.has(next)) {
      seen.add(next);
      chain.push(next);
      next = successorOf.get(next)?.id ?? null;
    }
    const position = chain.indexOf(id);
    return {
      root: chain[0] ?? id,
      current: chain[chain.length - 1] ?? id,
      predecessor: chain[position - 1] ?? null,
      successor: chain[position + 1] ?? null,
      chain,
    };
  };

  const view = (id: string): WallPrintView | null => {
    const record = records.get(id);
    if (record === undefined) return null;
    return deepFreeze({
      record,
      lifecycle: { state: stateOf(id), events: [...(eventsById.get(id) ?? [])] },
      supersedes: record.supersedes,
      supersededBy: successorOf.get(id) ?? null,
      lineage: lineage(id),
    });
  };

  return Object.freeze({
    commit,
    disclose,
    withdraw,
    get: (id: string) => records.get(id),
    has: (id: string) => records.has(id),
    events: (id: string) => {
      requireRecord(id);
      return [...(eventsById.get(id) ?? [])];
    },
    state: (id: string) => {
      requireRecord(id);
      return stateOf(id);
    },
    list: () => [...records.keys()],
    view,
    lineage,
  });
}
