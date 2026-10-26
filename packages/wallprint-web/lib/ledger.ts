import { HEX64_RE, LIFECYCLE_STATES, LIFECYCLE_TRANSITIONS, RECORD_ID_RE, type LifecycleState } from "../../mcp/src/wallprint/vocabulary.ts";
import { canonicalForm } from "./canonical-form.ts";
import { sha256Hex } from "./digest.ts";
import { hasExactKeys, isPlainObject, isString, type Finding } from "./shape.ts";
import type { Standing } from "./standing.ts";

/**
 * The standing beside a proved record, checked before the page shows either. The standing is mutable metadata from the
 * store's index, and nothing signs it; what can be checked is that it is internally what the engine's history would
 * have produced and that it is about THIS record and THESE bytes:
 *
 *   - the lifecycle ledger is a hash chain the engine's own rules accept (history.ts verifyLifecycleChain, rule for
 *     rule): sequence, links, each event's own SHA-256 over its canonical form, a COMMITTED start, table transitions,
 *     time moving forward, a successor reference exactly on CORRECTED / SUPERSEDED, a reason where one is required;
 *   - every event names this record id and the digest this page computed over the record's canonical bytes;
 *   - the lifecycle state is the ledger's last state; the successor is the ledger's own successor reference; the
 *     predecessor is the one the proved record binds; the lineage places this record between them;
 *   - every publication listed is of that one digest.
 *
 * A standing that fails any of these is not read, and the page says nothing about the record (UNREACHABLE,
 * STANDING_INVALID). A standing that passes may still be stale (an authentic ledger before a later event) or extended by
 * whoever controls the store (there is no signature): it is printed as the store's index records it, never as a fact
 * about the record's content. No clock is read: instants are checked by their one canonical spelling.
 */

const EVENT_FIELDS = ["seq", "recordId", "recordDigest", "state", "at", "reason", "ref", "previousEventDigest", "eventDigest"] as const;
/** The engine's output-safe text (schemas.ts SAFE_TEXT_RE): lifecycle reasons are WalletWall-authored and bounded by it. */
const SAFE_TEXT_RE = /^[A-Za-z0-9 _.:/+-]{0,128}$/;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;
const MAX_EVENTS = 64;

/** True for a canonical instant (UTC, millisecond precision) naming a real calendar date, without reading a clock. */
export function isCanonicalInstantText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = INSTANT_RE.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= days;
}

const isState = (v: unknown): v is LifecycleState => typeof v === "string" && (LIFECYCLE_STATES as readonly string[]).includes(v);

/** The findings for a standing against the proved record and digest; empty when the page may print it. Never throws. */
export async function standingFindings(standing: Standing, recordId: string, digest: string, record: Record<string, unknown>): Promise<Finding[]> {
  const out: Finding[] = [];
  const events = standing.lifecycle.events;
  if (events.length === 0 || events.length > MAX_EVENTS) return [{ code: "LEDGER_INVALID", path: "lifecycle.events" }];
  let prev: Record<string, unknown> | null = null;
  let successor: unknown = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const at = `lifecycle.events[${i}]`;
    const bad = (): Finding[] => [...out, { code: "LEDGER_INVALID", path: at }];
    if (!isPlainObject(e) || !hasExactKeys(e, EVENT_FIELDS)) return bad();
    if (e["seq"] !== String(i) || e["recordId"] !== recordId || e["recordDigest"] !== digest) return bad();
    const state = e["state"];
    if (!isState(state) || !isCanonicalInstantText(e["at"])) return bad();
    const reason = e["reason"];
    if (reason !== null && (!isString(reason) || !SAFE_TEXT_RE.test(reason))) return bad();
    if ((state === "WITHDRAWN" || state === "CORRECTED") && reason === null) return bad();
    const ref = e["ref"];
    if (state === "CORRECTED" || state === "SUPERSEDED") {
      const kind = state === "CORRECTED" ? "CORRECTION" : "SUPERSESSION";
      if (!isPlainObject(ref) || !hasExactKeys(ref, ["id", "digest", "kind"]) || !isString(ref["id"]) || !RECORD_ID_RE.test(ref["id"]) || ref["id"] === recordId || !isString(ref["digest"]) || !HEX64_RE.test(ref["digest"]) || ref["kind"] !== kind) return bad();
      if (successor !== null) return bad();
      successor = ref;
    } else if (ref !== null) return bad();
    if (prev === null) {
      if (state !== "COMMITTED" || reason !== null || e["previousEventDigest"] !== null) return bad();
    } else {
      const prevState = prev["state"] as LifecycleState;
      if (e["previousEventDigest"] !== prev["eventDigest"] || !LIFECYCLE_TRANSITIONS[prevState].includes(state) || (e["at"]) < (prev["at"] as string)) return bad();
    }
    const body: Record<string, unknown> = { ...e };
    delete body["eventDigest"];
    const canonical = canonicalForm(body);
    const eventDigest = e["eventDigest"];
    if (!isString(eventDigest) || !HEX64_RE.test(eventDigest) || canonical === null || (await sha256Hex(canonical)) !== eventDigest) return bad();
    prev = e;
  }
  if (prev === null || standing.lifecycle.state !== prev["state"]) out.push({ code: "LEDGER_INVALID", path: "lifecycle.state" });
  if (canonicalForm(standing.supersededBy) !== canonicalForm(successor)) out.push({ code: "STANDING_MISMATCH", path: "supersededBy" });
  if (!("supersedes" in record) || canonicalForm(standing.supersedes) !== canonicalForm(record["supersedes"])) out.push({ code: "STANDING_MISMATCH", path: "supersedes" });
  if (!standing.publications.every((p) => p.digest === digest)) out.push({ code: "STANDING_MISMATCH", path: "publications" });
  const L = standing.lineage;
  const chain = L.chain;
  const bound = record["supersedes"];
  const predecessor = isPlainObject(bound) && isString(bound["id"]) ? bound["id"] : null;
  const next = standing.supersededBy === null ? null : standing.supersededBy.id;
  const ids = chain.every((x): x is string => isString(x) && RECORD_ID_RE.test(x)) ? chain : null;
  const pos = ids === null ? -1 : ids.indexOf(recordId);
  const placed =
    ids !== null &&
    pos >= 0 &&
    new Set(ids).size === ids.length &&
    L.root === ids[0] &&
    L.current === ids[ids.length - 1] &&
    L.predecessor === predecessor &&
    L.successor === next &&
    (ids[pos - 1] ?? null) === predecessor &&
    (ids[pos + 1] ?? null) === next;
  if (!placed) out.push({ code: "LINEAGE_MISMATCH", path: "lineage" });
  return out;
}
