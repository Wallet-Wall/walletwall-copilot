import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest } from "../../src/canonical.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory, isCanonicalInstant, validateHistoryGraph, verifyLifecycleChain, type LifecycleEvent } from "../../src/wallprint/history.ts";
import { buildWallPrintSnapshot, verifyWallPrintDigest, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { COMMIT_AT, DISCLOSE_AT, LATER2_AT, LATER3_AT, LATER_AT, LATER_SNAPSHOT_AT, baseInput } from "./support.ts";

/**
 * The disclosure lifecycle lives in the history, not in the record. Every change is an appended, hash-chained event
 * that names the record by id AND digest. A correction or supersession is a NEW record whose `supersedes` binds the
 * predecessor's digest; the predecessor's bytes never change.
 *
 *   correction != mutation · supersession != deletion · withdrawal != deletion · lifecycle != WWEP evidence state
 */

function recordA(): WallPrintRecord {
  return buildWallPrintSnapshot(baseInput({ id: "wp-a" }));
}

function successorOf(prior: WallPrintRecord, kind: "CORRECTION" | "SUPERSESSION", over: Partial<Parameters<typeof baseInput>[0]> = {}): WallPrintRecord {
  return buildWallPrintSnapshot(
    baseInput({
      id: `${prior.id}-next`,
      evaluatedAt: LATER_SNAPSHOT_AT,
      supersedes: { id: prior.id, digest: prior.digest, kind, reason: kind === "CORRECTION" ? "Recounted after a provider pagination fix." : null },
      ...over,
    }),
  );
}

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof WallPrintError, `expected WallPrintError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code} ${JSON.stringify(e.findings)}`);
    return true;
  });
}

/** A forger with the algorithm: rebuild an event body with a correct eventDigest. */
function forge(event: LifecycleEvent, patch: Partial<LifecycleEvent>): LifecycleEvent {
  const { eventDigest: _drop, ...body } = { ...event, ...patch };
  return { ...body, eventDigest: evidenceDigest(body) };
}

describe("WallPrint history: commit", () => {
  test("commit stores the frozen record and starts the lifecycle at COMMITTED with one hash-chained event", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    assert.equal(h.state(a.id), "COMMITTED");
    const events = h.events(a.id);
    assert.equal(events.length, 1);
    assert.deepEqual({ ...events[0], eventDigest: "x" }, { seq: "0", recordId: a.id, recordDigest: a.digest, state: "COMMITTED", at: COMMIT_AT, reason: null, ref: null, previousEventDigest: null, eventDigest: "x" });
    assert.match(events[0]!.eventDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(h.get(a.id), a, "get returns the committed record");
    assert.ok(Object.isFrozen(a) && Object.isFrozen(h.get(a.id)));
  });

  test("commit refuses a duplicate record id, with identical or different content: records are never overwritten", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const before = canonicalize(a);
    throwsCode(() => h.commit(recordA(), { at: LATER_AT }), "DUPLICATE_RECORD_ID");
    throwsCode(() => h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-a", evaluatedAt: LATER_SNAPSHOT_AT })), { at: LATER_AT }), "DUPLICATE_RECORD_ID");
    assert.equal(canonicalize(h.get(a.id)), before);
    assert.equal(h.events(a.id).length, 1);
  });

  test("commit requires a canonical instant that is not before the snapshot it describes", () => {
    const h = createWallPrintHistory();
    throwsCode(() => h.commit(recordA(), { at: "2026-10-23T12:10:00Z" }), "INVALID_INPUT");
    throwsCode(() => h.commit(recordA(), { at: "2026-10-23T12:10:00.000+00:00" }), "INVALID_INPUT");
    throwsCode(() => h.commit(recordA(), { at: "2026-10-23T11:00:00.000Z" }), "COMMIT_BEFORE_SNAPSHOT");
    assert.deepEqual(h.list(), []);
    assert.equal(isCanonicalInstant("2026-10-23T12:10:00.000Z"), true);
    assert.equal(isCanonicalInstant("2026-02-30T12:10:00.000Z"), false);
  });

  test("commit validates the record: a tampered digest or an unknown shape is refused", () => {
    const h = createWallPrintHistory();
    const a = recordA();
    throwsCode(() => h.commit({ ...a, digest: "0".repeat(64) }, { at: COMMIT_AT }), "INVALID_RECORD");
    throwsCode(() => h.commit({ ...a, verdict: "VERIFIED" }, { at: COMMIT_AT }), "INVALID_RECORD");
    throwsCode(() => h.commit({ ...a, snapshotAt: LATER_SNAPSHOT_AT }, { at: LATER_AT }), "INVALID_RECORD");
    assert.deepEqual(h.list(), []);
  });
});

describe("WallPrint history: disclosure is lifecycle, not evidence state", () => {
  test("disclosing changes the lifecycle state and nothing inside the record", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const before = canonicalize(a);
    h.disclose(a.id, { at: DISCLOSE_AT });
    assert.equal(h.state(a.id), "DISCLOSED");
    assert.equal(canonicalize(h.get(a.id)), before);
    assert.equal(h.get(a.id)!.claims.find((c) => c.assertionId === "a-identity")?.supportState, "ESTABLISHED");
    assert.equal(verifyWallPrintDigest(h.get(a.id)).matches, true);
  });

  test("ESTABLISHED + DISCLOSED and SUPPORTED + DISCLOSED are distinct records sharing one lifecycle state", () => {
    const h = createWallPrintHistory();
    const identity = h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-identity" })), { at: COMMIT_AT });
    const price = h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-price", focalAssertionId: "a-price", assessments: [] })), { at: COMMIT_AT });
    h.disclose(identity.id, { at: DISCLOSE_AT });
    h.disclose(price.id, { at: DISCLOSE_AT });
    assert.equal(identity.assessments.find((a) => a.assessorRole === "WALLETWALL")?.assessment, "ESTABLISHED");
    assert.equal(price.assessments.find((a) => a.assessorRole === "WALLETWALL")?.assessment, "SUPPORTED");
    assert.equal(h.state(identity.id), "DISCLOSED");
    assert.equal(h.state(price.id), "DISCLOSED");
    assert.notEqual(identity.digest, price.digest);
  });

  test("disclose refuses an unknown record, a repeat, and an event dated before the previous one", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    throwsCode(() => h.disclose("wp-nobody", { at: DISCLOSE_AT }), "UNKNOWN_RECORD");
    throwsCode(() => h.disclose(a.id, { at: "2026-10-23T12:05:00.000Z" }), "EVENT_TIME_ORDER");
    h.disclose(a.id, { at: DISCLOSE_AT });
    throwsCode(() => h.disclose(a.id, { at: LATER_AT }), "INVALID_TRANSITION");
  });
});

describe("WallPrint history: correction and supersession", () => {
  test("a correction commits a successor and marks the predecessor CORRECTED without touching its bytes", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.disclose(a.id, { at: DISCLOSE_AT });
    const before = canonicalize(a);
    const b = h.commit(successorOf(a, "CORRECTION"), { at: LATER_AT });
    assert.equal(h.state(a.id), "CORRECTED");
    assert.equal(h.state(b.id), "COMMITTED");
    assert.deepEqual(h.get(a.id), a);
    assert.equal(canonicalize(h.get(a.id)), before);
    assert.equal(verifyWallPrintDigest(h.get(a.id)).matches, true);
    assert.deepEqual(b.supersedes, { id: a.id, digest: a.digest, kind: "CORRECTION", reason: "Recounted after a provider pagination fix." });
    const corrected = h.events(a.id).at(-1)!;
    assert.equal(corrected.state, "CORRECTED");
    assert.equal(corrected.at, LATER_AT);
    assert.equal(corrected.reason, "Recounted after a provider pagination fix.");
    assert.deepEqual(corrected.ref, { id: b.id, digest: b.digest, kind: "CORRECTION" });
    assert.equal(h.events(a.id).map((e) => e.state).join(">"), "COMMITTED>DISCLOSED>CORRECTED");
  });

  test("supersession links both ways and keeps the old record addressable; lineage resolves root, current, predecessor and successor", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const b = h.commit(successorOf(a, "SUPERSESSION"), { at: LATER_AT });
    assert.equal(h.state(a.id), "SUPERSEDED");
    const va = h.view(a.id)!;
    const vb = h.view(b.id)!;
    assert.deepEqual(va.supersededBy, { id: b.id, digest: b.digest, kind: "SUPERSESSION" });
    assert.equal(va.supersedes, null);
    assert.deepEqual(vb.supersedes, b.supersedes);
    assert.equal(vb.supersededBy, null);
    assert.deepEqual(va.record, a);
    assert.deepEqual(h.lineage(a.id), { root: a.id, current: b.id, predecessor: null, successor: b.id, chain: [a.id, b.id] });
    assert.deepEqual(h.lineage(b.id), { root: a.id, current: b.id, predecessor: a.id, successor: null, chain: [a.id, b.id] });
  });

  test("a successor must bind the predecessor's actual digest and name a record this history holds", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const wrong = buildWallPrintSnapshot(baseInput({ id: "wp-a-next", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: a.id, digest: "0".repeat(64), kind: "SUPERSESSION", reason: null } }));
    throwsCode(() => h.commit(wrong, { at: LATER_AT }), "SUPERSEDES_DIGEST_MISMATCH");
    const orphan = buildWallPrintSnapshot(baseInput({ id: "wp-orphan", supersedes: { id: "wp-ghost", digest: "a".repeat(64), kind: "SUPERSESSION", reason: null } }));
    throwsCode(() => h.commit(orphan, { at: COMMIT_AT }), "SUPERSEDES_UNKNOWN_RECORD");
    assert.equal(h.state(a.id), "COMMITTED");
    assert.deepEqual(h.list(), [a.id]);
  });

  test("a successor must describe the same subject and a snapshot no earlier than its predecessor", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const otherSubject = successorOf(a, "SUPERSESSION", { focalAssertionId: "a-price", assessments: [] });
    throwsCode(() => h.commit(otherSubject, { at: LATER_AT }), "SUBJECT_MISMATCH");
    const earlier = buildWallPrintSnapshot(baseInput({ id: "wp-a-next", evaluatedAt: "2026-10-22T12:00:00Z", supersedes: { id: a.id, digest: a.digest, kind: "SUPERSESSION", reason: null } }));
    throwsCode(() => h.commit(earlier, { at: LATER_AT }), "SNAPSHOT_ORDER");
  });

  test("a record cannot correct or supersede itself", () => {
    const a = recordA();
    throwsCode(() => buildWallPrintSnapshot(baseInput({ id: "wp-a", supersedes: { id: "wp-a", digest: a.digest, kind: "CORRECTION", reason: "x" } })), "INVALID_RECORD");
    throwsCode(() => buildWallPrintSnapshot(baseInput({ id: "wp-a", supersedes: { id: "wp-a", digest: a.digest, kind: "SUPERSESSION", reason: null } })), "INVALID_RECORD");
  });

  test("a record has at most one successor: no branching, hence no cycles", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    const b = h.commit(successorOf(a, "SUPERSESSION"), { at: LATER_AT });
    throwsCode(() => h.commit(successorOf(a, "CORRECTION", { id: "wp-branch" }), { at: LATER2_AT }), "INVALID_TRANSITION");
    throwsCode(() => h.commit(buildWallPrintSnapshot(baseInput({ id: "wp-a", supersedes: { id: b.id, digest: b.digest, kind: "SUPERSESSION", reason: null } })), { at: LATER2_AT }), "DUPLICATE_RECORD_ID");
    assert.deepEqual(h.lineage(b.id).chain, [a.id, b.id]);
    assert.deepEqual(h.list(), [a.id, b.id]);
  });
});

describe("WallPrint history: withdrawal", () => {
  test("withdrawal preserves identity, payload, digest, assessments and timestamps, and records when and why", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.disclose(a.id, { at: DISCLOSE_AT });
    const before = canonicalize(a);
    const event = h.withdraw(a.id, { at: LATER_AT, reason: "Issuer attestation reference named the wrong period." });
    assert.equal(h.state(a.id), "WITHDRAWN");
    assert.deepEqual(h.get(a.id), a, "withdrawn record is still addressable: withdrawal is not deletion");
    assert.equal(canonicalize(h.get(a.id)), before);
    assert.equal(h.get(a.id)!.digest, a.digest);
    assert.equal(h.get(a.id)!.snapshotAt, a.snapshotAt);
    assert.deepEqual(h.get(a.id)!.assessments, a.assessments);
    assert.ok(h.list().includes(a.id));
    assert.equal(event.state, "WITHDRAWN");
    assert.equal(event.at, LATER_AT);
    assert.equal(event.reason, "Issuer attestation reference named the wrong period.");
    assert.equal(h.events(a.id).map((e) => e.state).join(">"), "COMMITTED>DISCLOSED>WITHDRAWN");
    assert.equal(verifyWallPrintDigest(h.get(a.id)).matches, true);
  });

  test("withdrawal needs a reason, is terminal, and blocks later disclosure or supersession", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: "" }), "REASON_REQUIRED");
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: "   " }), "REASON_REQUIRED");
    h.withdraw(a.id, { at: LATER_AT, reason: "Retracted." });
    throwsCode(() => h.withdraw(a.id, { at: LATER2_AT, reason: "Again." }), "INVALID_TRANSITION");
    throwsCode(() => h.disclose(a.id, { at: LATER2_AT }), "INVALID_TRANSITION");
    throwsCode(() => h.commit(successorOf(a, "SUPERSESSION"), { at: LATER2_AT }), "INVALID_TRANSITION");
    assert.deepEqual(h.list(), [a.id]);
  });

  test("a corrected or superseded record can still be withdrawn", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.commit(successorOf(a, "SUPERSESSION"), { at: LATER_AT });
    h.withdraw(a.id, { at: LATER2_AT, reason: "Retracted after supersession." });
    assert.equal(h.state(a.id), "WITHDRAWN");
    assert.equal(h.state(`${a.id}-next`), "COMMITTED");
  });

  test("lifecycle reasons are WalletWall-authored prose: guarded, bounded, output-safe", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: "Withdrawn: the wallet is now verified safe." }), "MANUFACTURED_ASSURANCE");
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: `Bearer ${"abcdefghijklmnopqrstuvwxyz0123456789"}` }), "SUSPECTED_SECRET");
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: "x".repeat(129) }), "INVALID_INPUT");
    throwsCode(() => h.withdraw(a.id, { at: LATER_AT, reason: 'quotes "are" not output-safe' }), "INVALID_INPUT");
    assert.equal(h.state(a.id), "COMMITTED");
    assert.equal(h.events(a.id).length, 1);
  });
});

describe("WallPrint history: silent mutation is impossible", () => {
  test("records and events are frozen; events() and view() hand out copies", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    assert.throws(() => {
      (a as { snapshotAt: string }).snapshotAt = "x";
    }, TypeError);
    const events = h.events(a.id);
    assert.throws(() => {
      (events[0] as { reason: string | null }).reason = "edited";
    }, TypeError);
    events.push(events[0]!);
    assert.equal(h.events(a.id).length, 1);
    const view = h.view(a.id)!;
    assert.ok(Object.isFrozen(view) && Object.isFrozen(view.lifecycle) && Object.isFrozen(view.lifecycle.events) && Object.isFrozen(view.lineage));
  });

  test("the per-record event chain is hash-linked and correctly re-hashed forgeries are still detected", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.disclose(a.id, { at: DISCLOSE_AT });
    h.withdraw(a.id, { at: LATER_AT, reason: "Retracted." });
    const events = h.events(a.id);
    assert.deepEqual(events.map((e) => e.seq), ["0", "1", "2"]);
    assert.equal(events[1]!.previousEventDigest, events[0]!.eventDigest);
    assert.equal(events[2]!.previousEventDigest, events[1]!.eventDigest);
    assert.deepEqual(verifyLifecycleChain(events), { ok: true, brokenAt: null });
    assert.deepEqual(verifyLifecycleChain([events[0]!, { ...events[1]!, at: LATER2_AT }, events[2]!]), { ok: false, brokenAt: 1 }, "edited body");
    assert.equal(verifyLifecycleChain([events[0]!, events[2]!, events[1]!]).ok, false, "reordered");
    assert.equal(verifyLifecycleChain([events[0]!, events[2]!]).ok, false, "dropped");
    assert.deepEqual(verifyLifecycleChain([events[0]!, forge(events[1]!, { recordDigest: "e".repeat(64) })]), { ok: false, brokenAt: 1 }, "re-pointed at another record edition");
    assert.deepEqual(verifyLifecycleChain([forge(events[1]!, { seq: "0", previousEventDigest: null })]), { ok: false, brokenAt: 0 }, "must start at COMMITTED");
    assert.deepEqual(verifyLifecycleChain([events[0]!, forge(events[0]!, { seq: "1", previousEventDigest: events[0]!.eventDigest })]), { ok: false, brokenAt: 1 }, "COMMITTED twice");
    assert.deepEqual(verifyLifecycleChain([events[0]!, forge(events[1]!, { at: "2026-10-23T12:00:00.000Z" })]), { ok: false, brokenAt: 1 }, "backwards in time");
    assert.equal(verifyLifecycleChain("nope" as never).ok, false);
  });

  test("two histories replaying the same sequence are identical, event digests included", () => {
    const run = (): unknown => {
      const h = createWallPrintHistory();
      const a = h.commit(recordA(), { at: COMMIT_AT });
      h.disclose(a.id, { at: DISCLOSE_AT });
      const b = h.commit(successorOf(a, "CORRECTION"), { at: LATER_AT });
      h.disclose(b.id, { at: LATER2_AT });
      h.withdraw(a.id, { at: LATER3_AT, reason: "Retracted." });
      return { a: h.view(a.id), b: h.view(b.id) };
    };
    assert.deepEqual(run(), run());
  });
});

describe("WallPrint history: an externally supplied graph is validated, not trusted", () => {
  test("a well-formed chain validates; branching, dangling links, digest mismatches, duplicate ids and cycles are refused", () => {
    const a = recordA();
    const b = successorOf(a, "SUPERSESSION");
    const c = buildWallPrintSnapshot(baseInput({ id: "wp-a-next-next", evaluatedAt: "2026-10-25T11:00:00Z", supersedes: { id: b.id, digest: b.digest, kind: "SUPERSESSION", reason: null } }));
    assert.deepEqual(validateHistoryGraph([a, b, c]), { ok: true, findings: [] });
    assert.deepEqual(validateHistoryGraph([c, a, b]), { ok: true, findings: [] }, "order of supply does not matter");

    const branch = successorOf(a, "CORRECTION", { id: "wp-branch" });
    assert.ok(validateHistoryGraph([a, b, branch]).findings.some((f) => f.code === "MULTIPLE_SUCCESSORS"));
    assert.ok(validateHistoryGraph([b]).findings.some((f) => f.code === "DANGLING_SUPERSEDES"));
    assert.ok(validateHistoryGraph([a, a]).findings.some((f) => f.code === "DUPLICATE_RECORD_ID"));
    const wrongDigest = buildWallPrintSnapshot(baseInput({ id: "wp-a-next", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: a.id, digest: "0".repeat(64), kind: "SUPERSESSION", reason: null } }));
    assert.ok(validateHistoryGraph([a, wrongDigest]).findings.some((f) => f.code === "SUPERSEDES_DIGEST_MISMATCH"));
    // A cycle can only be written by hand (each record binds the other's digest, which is impossible for real records),
    // so the validator checks the links structurally before trusting digests.
    const x = { ...a, id: "wp-x", supersedes: { id: "wp-y", digest: "1".repeat(64), kind: "SUPERSESSION", reason: null } } as unknown as WallPrintRecord;
    const y = { ...a, id: "wp-y", supersedes: { id: "wp-x", digest: "2".repeat(64), kind: "SUPERSESSION", reason: null } } as unknown as WallPrintRecord;
    const cyclic = validateHistoryGraph([x, y]);
    assert.equal(cyclic.ok, false);
    assert.equal(cyclic.findings.filter((f) => f.code === "HISTORY_CYCLE").length, 2, "both members of the cycle are reported");
  });

  test("verifyLifecycleChain never throws on garbage and refuses events outside the closed event shape even when correctly re-hashed", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.disclose(a.id, { at: DISCLOSE_AT });
    h.withdraw(a.id, { at: LATER_AT, reason: "Retracted." });
    const [committed, disclosed, withdrawn] = h.events(a.id) as [LifecycleEvent, LifecycleEvent, LifecycleEvent];
    assert.deepEqual(verifyLifecycleChain([null as never]), { ok: false, brokenAt: 0 });
    assert.deepEqual(verifyLifecycleChain([committed, forge(disclosed, { note: "extra" } as never)]), { ok: false, brokenAt: 1 }, "an extra key");
    assert.deepEqual(verifyLifecycleChain([committed, forge(disclosed, { ref: { id: "wp-x", digest: "a".repeat(64), kind: "CORRECTION" } })]), { ok: false, brokenAt: 1 }, "a ref on a DISCLOSED event");
    assert.deepEqual(verifyLifecycleChain([committed, disclosed, forge(withdrawn, { reason: null })]), { ok: false, brokenAt: 2 }, "a WITHDRAWN event without a reason");
    assert.deepEqual(verifyLifecycleChain([forge(committed, { reason: "hello" })]), { ok: false, brokenAt: 0 }, "a COMMITTED event with a reason");
    assert.deepEqual(verifyLifecycleChain([committed, forge(disclosed, { recordDigest: "not-a-digest" })]), { ok: false, brokenAt: 1 }, "a malformed digest");
  });

  test("view(id) exposes record, lifecycle, supersedes, supersededBy and lineage as separate facts, never a merged status", () => {
    const h = createWallPrintHistory();
    const a = h.commit(recordA(), { at: COMMIT_AT });
    h.disclose(a.id, { at: DISCLOSE_AT });
    const view = h.view(a.id)!;
    assert.deepEqual(Object.keys(view).sort(), ["lifecycle", "lineage", "record", "supersededBy", "supersedes"]);
    assert.deepEqual(Object.keys(view.lifecycle).sort(), ["events", "state"]);
    assert.equal(view.lifecycle.state, "DISCLOSED");
    assert.equal(view.record.digest, a.digest);
    assert.equal(view.supersededBy, null);
    assert.equal(h.view("wp-nobody"), null);
  });
});
