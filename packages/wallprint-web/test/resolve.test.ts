import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest } from "../../mcp/src/canonical.ts";
import { buildPublicDisclosure, recordStanding } from "../../mcp/src/wallprint/publication.ts";
import { encodeReference, referenceOf, REFERENCE_TARGETS, RESOLVER_ROUTE, toResolverPath, type ReferenceTarget } from "../../mcp/src/wallprint/reference.ts";
import { PUBLIC_OUTCOMES, resolvePublic, type PublicResolution } from "../lib/resolve.ts";
import { exportOf, FIXTURES, memoryStore, PUBLISHED_AT, publishedExports } from "./support/store.ts";

/**
 * The public resolver's one job: locate the published disclosure a URL names, prove its bytes, and say exactly one of
 * seven things. It never redirects, never repairs, never renders what it did not prove, never fetches anything but the
 * two fixed files of the record it was asked about, and says nothing about a record when the store could not be reached.
 */

const first = publishedExports()[0]!;
const refOf = (e = first, target: ReferenceTarget | null = null) => referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion }, target);
const pathOf = (e = first, target: ReferenceTarget | null = null): string => toResolverPath(refOf(e, target));
const standingPath = (id: string): string => `${RESOLVER_ROUTE}records/${id}/index.json`;
const artifactPath = (id: string, digest: string): string => `${RESOLVER_ROUTE}records/${id}/${digest}.json`;
const json = (r: PublicResolution): string => JSON.stringify(r);

describe("outcomes: a closed vocabulary", () => {
  test("seven outcomes, the codec's six plus UNREACHABLE; none of them is a verdict word", () => {
    assert.deepEqual([...PUBLIC_OUTCOMES], ["RESOLVED", "UNAVAILABLE", "NOT_COMPARED", "DIGEST_MISMATCH", "MALFORMED_REFERENCE", "UNSUPPORTED_VERSION", "UNREACHABLE"]);
    for (const o of PUBLIC_OUTCOMES) assert.doesNotMatch(o, /INVALID|FALSE|FAKE|FRAUD|FORGED|UNTRUSTED|VERIFIED|VALID/);
  });
});

describe("RESOLVED: the record the URL names, proved from its bytes", () => {
  test("every published fixture record resolves, with its record equal to the export's record and the requested section carried", async () => {
    for (const e of publishedExports()) {
      for (const target of [null, "receipt" as const]) {
        const store = memoryStore();
        const r = await resolvePublic(pathOf(e, target), store);
        assert.equal(r.outcome, "RESOLVED", `${e.id}: ${json(r)}`);
        if (r.outcome !== "RESOLVED") continue;
        assert.deepEqual(r.record, e.record, e.id);
        assert.equal(r.computedDigest, e.record.digest);
        assert.equal(r.artifact.recordId, e.id);
        assert.equal(r.artifact.title, e.title);
        assert.equal(r.reference.target, target);
        assert.equal(encodeReference(r.reference), encodeReference(refOf(e, target)));
        assert.deepEqual(r.standing.publications, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
        assert.deepEqual(r.standing.lifecycle, e.lifecycle);
        assert.deepEqual(r.standing.supersededBy, e.supersededBy);
        assert.deepEqual(r.standing.lineage, e.lineage);
        assert.deepEqual(store.requests, [standingPath(e.id), artifactPath(e.id, e.record.digest)], "exactly the standing, then the artifact the URL names");
      }
    }
  });

  test("a corrected, superseded or withdrawn record resolves as that record: nothing redirects to the current one", async () => {
    const corrected = FIXTURES["corrected"]!;
    const old = exportOf(corrected, corrected.records[0]!);
    const store = memoryStore();
    const r = await resolvePublic(pathOf(old), store);
    assert.equal(r.outcome, "RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    assert.equal(r.record.id, old.id);
    assert.equal(r.standing.lifecycle.state, "CORRECTED");
    assert.equal(r.standing.supersededBy?.id, corrected.records[1]!.id);
    assert.ok(!store.requests.some((p) => p.includes(corrected.records[1]!.id)), "the successor is named, never fetched in its place");
    const withdrawn = FIXTURES["withdrawn"]!;
    const w = await resolvePublic(pathOf(exportOf(withdrawn, withdrawn.records[0]!)), memoryStore());
    assert.equal(w.outcome, "RESOLVED");
    if (w.outcome === "RESOLVED") assert.equal(w.standing.lifecycle.state, "WITHDRAWN");
  });

  test("an authentic but stale standing (the ledger before a later event) resolves, and the page reports that standing as the index records it", async () => {
    const corrected = FIXTURES["corrected"]!;
    const v1 = exportOf(corrected, corrected.records[0]!);
    const store = memoryStore();
    const full = recordStanding(v1, [{ digest: v1.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    const before = full.lifecycle.events.filter((e) => e.state === "COMMITTED" || e.state === "DISCLOSED");
    assert.equal(before.length, 2);
    store.set(standingPath(v1.id), JSON.stringify({ ...full, lifecycle: { state: "DISCLOSED", events: before }, supersededBy: null, lineage: { root: v1.id, current: v1.id, predecessor: null, successor: null, chain: [v1.id] } }));
    const r = await resolvePublic(pathOf(v1), store);
    assert.equal(r.outcome, "RESOLVED", json(r));
    if (r.outcome !== "RESOLVED") return;
    assert.deepEqual(r.record, v1.record, "the record comes from the proved bytes alone");
    assert.equal(r.standing.lifecycle.state, "DISCLOSED");
    assert.equal(r.standing.supersededBy, null);
  });
});

/** Rebuild a ledger's hash chain after a patch, as anyone holding the events could: there is no signature to stop it. */
function rechain(events: readonly object[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const body: Record<string, unknown> = { ...e, previousEventDigest: prev === undefined ? null : prev["eventDigest"] };
    delete body["eventDigest"];
    out.push({ ...body, eventDigest: evidenceDigest(body) });
  }
  return out;
}

describe("the standing is checked against its own hash-chained ledger and the proved digest before anything is RESOLVED", () => {
  const standingOf = (e = first) => recordStanding(e, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
  const withStanding = async (e: typeof first, standing: unknown): Promise<PublicResolution> => {
    const store = memoryStore();
    store.set(standingPath(e.id), JSON.stringify(standing));
    return resolvePublic(pathOf(e), store);
  };
  const expectRefused = (r: PublicResolution, label: string): void => {
    assert.equal(r.outcome, "UNREACHABLE", `${label}: ${json(r)}`);
    if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "STANDING_INVALID", label);
    assert.ok(!("record" in r), `${label}: no record is carried`);
  };
  const other = "a".repeat(64);

  test("a state the ledger does not end in, an edited event, or a ledger rebuilt around another digest is refused", async () => {
    const s = standingOf();
    expectRefused(await withStanding(first, { ...s, lifecycle: { ...s.lifecycle, state: "WITHDRAWN" } }), "state without its event");
    const edited = s.lifecycle.events.map((e, i) => (i === 1 ? { ...e, at: "2026-10-23T12:21:00.000Z" } : e));
    expectRefused(await withStanding(first, { ...s, lifecycle: { ...s.lifecycle, events: edited } }), "edited event, hash not rebuilt");
    const forged = rechain(s.lifecycle.events.map((e) => ({ ...e, recordDigest: other })));
    expectRefused(await withStanding(first, { ...s, lifecycle: { ...s.lifecycle, events: forged } }), "a ledger rebuilt around another digest beside the true publication");
    expectRefused(await withStanding(first, { ...s, publications: [{ ...s.publications[0]!, digest: other }] }), "a publication of a digest the ledger does not commit");
    // Forged consistently around another digest, the standing points at bytes the store does not serve: unreachable, and
    // nothing is said about the record the URL names.
    const consistent = await withStanding(first, { ...s, lifecycle: { ...s.lifecycle, events: forged }, publications: [{ ...s.publications[0]!, digest: other }] });
    assert.equal(consistent.outcome, "UNREACHABLE", json(consistent));
    assert.ok(!("record" in consistent));
  });

  test("a successor the ledger does not name, a predecessor the record does not bind, or a misplaced lineage is refused", async () => {
    const s = standingOf();
    expectRefused(await withStanding(first, { ...s, supersededBy: { id: "wp-other-v2", digest: other, kind: "CORRECTION" } }), "successor not in the ledger");
    expectRefused(await withStanding(first, { ...s, supersedes: { id: "wp-other-v0", digest: other, kind: "SUPERSESSION", reason: null } }), "predecessor not bound by the record");
    expectRefused(await withStanding(first, { ...s, lineage: { ...s.lineage, successor: "wp-other-v2" } }), "lineage successor");
    expectRefused(await withStanding(first, { ...s, lineage: { ...s.lineage, chain: ["wp-other-v0", first.id], root: "wp-other-v0" } }), "lineage predecessor the record does not bind");
    const corrected = FIXTURES["corrected"]!;
    const v1 = exportOf(corrected, corrected.records[0]!);
    const s1 = standingOf(v1);
    expectRefused(await withStanding(v1, { ...s1, supersededBy: { ...s1.supersededBy!, digest: other } }), "successor digest the ledger does not name");
  });

  test("a well-formed ledger extension cannot be told from an authentic one: no signature exists, so the standing is reported as the index records it", async () => {
    const s = standingOf();
    const last = s.lifecycle.events[s.lifecycle.events.length - 1]!;
    const appended = rechain([...s.lifecycle.events, { ...last, seq: String(s.lifecycle.events.length), state: "WITHDRAWN", at: "2026-10-27T00:00:00.000Z", reason: "Appended by whoever controls the store.", ref: null }]);
    const r = await withStanding(first, { ...s, lifecycle: { state: "WITHDRAWN", events: appended } });
    assert.equal(r.outcome, "RESOLVED", json(r));
    if (r.outcome === "RESOLVED") {
      assert.equal(r.standing.lifecycle.state, "WITHDRAWN");
      assert.deepEqual(r.record, first.record, "the record itself is untouched by its standing");
    }
  });
});

describe("carried engine results that contradict the record are not read: NOT_COMPARED, nothing is hashed or shown", () => {
  const other = "a".repeat(64);
  const corrected = FIXTURES["corrected"]!;
  const v2 = exportOf(corrected, corrected.records[1]!);
  const unreplayable = exportOf(FIXTURES["unreplayable"]!, FIXTURES["unreplayable"]!.records[0]!);
  const withArtifact = async (e: typeof first, patch: (a: Record<string, unknown>) => void): Promise<PublicResolution> => {
    const { artifact } = buildPublicDisclosure(e);
    const a = structuredClone(artifact) as unknown as Record<string, unknown>;
    patch(a);
    const store = memoryStore();
    store.set(artifactPath(e.id, e.record.digest), canonicalize(a));
    return resolvePublic(pathOf(e), store);
  };
  const expectCarried = (r: PublicResolution, path: string, label: string): void => {
    assert.equal(r.outcome, "NOT_COMPARED", `${label}: ${json(r)}`);
    if (r.outcome !== "NOT_COMPARED") return;
    assert.ok(r.findings.some((f) => f.code === "CARRIED_RESULT_MISMATCH" && f.path === path), `${label}: ${JSON.stringify(r.findings)}`);
    assert.equal(r.computedDigest, null);
    assert.ok(!("record" in r));
  };
  const receiptOf = (a: Record<string, unknown>) => a["receipt"] as { issued: Record<string, unknown> | null; verification: unknown };

  test("validation, digest check, receipt and its verification must be what a published record requires", async () => {
    expectCarried(await withArtifact(first, (a) => { a["validation"] = { ok: false, findings: [{ code: "X", path: "" }] }; }), "validation", "validation not ok");
    expectCarried(await withArtifact(first, (a) => { a["digestCheck"] = { hasDigest: true, matches: false, computedDigest: other }; }), "digestCheck", "digest check");
    expectCarried(await withArtifact(v2, (a) => { receiptOf(a).verification = { matches: false, reasons: ["DIGEST_MISMATCH"] }; }), "receipt", "verification flipped");
    expectCarried(await withArtifact(v2, (a) => { receiptOf(a).issued!["digest"] = other; }), "receipt", "receipt names another digest");
    expectCarried(await withArtifact(v2, (a) => { receiptOf(a).issued!["bundleDigest"] = other; }), "receipt", "receipt names another bundle");
    expectCarried(await withArtifact(unreplayable, (a) => { receiptOf(a).verification = { matches: true, reasons: [] }; }), "receipt", "a verification without a receipt");
  });

  test("replay must be internally consistent, supersedes must be the record's own, and a diff exists exactly when the record supersedes another", async () => {
    expectCarried(await withArtifact(first, (a) => { a["replay"] = { outcome: "REPRODUCED", reasons: ["MISSING_EVIDENCE"], recomputedDigest: first.record.digest, mismatches: [] }; }), "replay", "reproduced with a reason");
    expectCarried(await withArtifact(first, (a) => { a["replay"] = { outcome: "REPRODUCED", reasons: [], recomputedDigest: other, mismatches: [] }; }), "replay", "reproduced under another digest");
    expectCarried(await withArtifact(first, (a) => { a["replay"] = { outcome: "UNREPLAYABLE", reasons: ["CLAIM_MISMATCH"], recomputedDigest: null, mismatches: [] }; }), "replay", "unreplayable for a mismatch reason");
    expectCarried(await withArtifact(first, (a) => { a["replay"] = { outcome: "VERIFIED", reasons: [], recomputedDigest: null, mismatches: [] }; }), "replay", "an outcome outside the vocabulary");
    expectCarried(await withArtifact(v2, (a) => { a["supersedes"] = null; }), "supersedes", "supersedes dropped");
    expectCarried(await withArtifact(v2, (a) => { a["diff"] = null; }), "diff", "diff dropped from a successor");
    expectCarried(await withArtifact(first, (a) => { a["diff"] = { changed: false, changes: [] }; }), "diff", "a diff on a root record");
    expectCarried(await withArtifact(v2, (a) => { (a["diff"] as { changed: boolean }).changed = false; }), "diff", "a diff that says unchanged beside its changes");
  });

  test("a consistent but different replay result cannot be told from the published one: the page re-derives no replay, and says the digest does not cover it", async () => {
    const r = await withArtifact(unreplayable, (a) => { a["replay"] = { outcome: "REPRODUCED", reasons: [], recomputedDigest: unreplayable.record.digest, mismatches: [] }; });
    assert.equal(r.outcome, "RESOLVED", json(r));
  });
});

describe("MALFORMED_REFERENCE and UNSUPPORTED_VERSION: the store is never asked", () => {
  test("a path the codec refuses never reaches the store and carries the codec's fixed problem code", async () => {
    const good = pathOf();
    const cases: [string, string, string][] = [
      ["/", "MALFORMED_REFERENCE", "resolver"],
      ["/wallprint/", "MALFORMED_REFERENCE", "query"],
      [`/wallprint/?${good.split("?")[1]}`, "MALFORMED_REFERENCE", "recordId"],
      [`${good}#x`, "MALFORMED_REFERENCE", "characters"],
      [good.replace(first.id, "..%2F"), "MALFORMED_REFERENCE", "characters"],
      [good.replace(first.id, `${first.id}/x`), "MALFORMED_REFERENCE", "recordId"],
      [`${good}&target=body`, "MALFORMED_REFERENCE", "target"],
      [`${good}&digest=${first.record.digest}`, "MALFORMED_REFERENCE", "query"],
      [good.replace("reference=0.1", "reference=0.2"), "UNSUPPORTED_VERSION", "reference"],
      [good.replace("wallprint=0.1", "wallprint=0.2"), "UNSUPPORTED_VERSION", "wallprint"],
      [`${good}${"&target=record".repeat(30)}`, "MALFORMED_REFERENCE", "length"],
    ];
    for (const [path, outcome, problem] of cases) {
      const store = memoryStore();
      const r = await resolvePublic(path, store);
      assert.equal(r.outcome, outcome, path);
      if (r.outcome === "MALFORMED_REFERENCE" || r.outcome === "UNSUPPORTED_VERSION") assert.equal(r.problem, problem, path);
      assert.deepEqual(store.requests, [], `${path}: nothing fetched`);
      assert.ok(!json(r).includes(first.id) && !json(r).includes(first.record.digest), "never echoes the input");
    }
  });
});

describe("UNAVAILABLE: a well-formed reference to a record this store does not hold", () => {
  test("an unpublished id answers UNAVAILABLE after one request, naming the reference and nothing else", async () => {
    const store = memoryStore();
    const r = await resolvePublic(pathOf({ ...first, id: "wp-not-published-v1" }), store);
    assert.equal(r.outcome, "UNAVAILABLE");
    if (r.outcome === "UNAVAILABLE") assert.equal(r.reference.recordId, "wp-not-published-v1");
    assert.deepEqual(store.requests, [standingPath("wp-not-published-v1")]);
    assert.ok(!/invalid|untrusted|false|fake|fraud/i.test(json(r)));
  });

  test("the altered-after-commit copy was refused at publication, so its reference is UNAVAILABLE here", async () => {
    const altered = FIXTURES["receipt-mismatch"]!.records[0]!;
    const committed = altered.lifecycle.events[0]!;
    const ref = referenceOf({ id: committed.recordId, digest: committed.recordDigest, wallprintVersion: altered.record.wallprintVersion });
    const r = await resolvePublic(toResolverPath(ref), memoryStore());
    assert.equal(r.outcome, "UNAVAILABLE");
  });
});

describe("DIGEST_MISMATCH: the record is held, under other bytes", () => {
  test("a reference with another digest fetches the published artifact, compares, reports every digest and renders no record", async () => {
    const store = memoryStore();
    const other = "0".repeat(63) + "1";
    const r = await resolvePublic(pathOf({ ...first, record: { ...first.record, digest: other } }), store);
    assert.equal(r.outcome, "DIGEST_MISMATCH", json(r));
    if (r.outcome !== "DIGEST_MISMATCH") return;
    assert.equal(r.referenceDigest, other);
    assert.equal(r.embeddedDigest, first.record.digest);
    assert.equal(r.computedDigest, first.record.digest);
    assert.equal(r.artifactFailedOwnCheck, false);
    assert.deepEqual(r.standing.publications.map((p) => p.digest), [first.record.digest]);
    assert.ok(!("record" in r) && !("artifact" in r), "no record content is carried on a mismatch");
    assert.deepEqual(store.requests, [standingPath(first.id), artifactPath(first.id, first.record.digest)]);
  });

  test("a published artifact whose bytes no longer digest to their digest fails its own check: DIGEST_MISMATCH, flagged, no record", async () => {
    const store = memoryStore();
    const { artifact } = buildPublicDisclosure(first);
    const flipped = artifact.canonical.replace('"snapshotAt":"2026', '"snapshotAt":"2025');
    store.set(artifactPath(first.id, first.record.digest), canonicalize({ ...artifact, canonical: flipped }));
    const r = await resolvePublic(pathOf(), store);
    assert.equal(r.outcome, "DIGEST_MISMATCH", json(r));
    if (r.outcome !== "DIGEST_MISMATCH") return;
    assert.equal(r.embeddedDigest, first.record.digest);
    assert.notEqual(r.computedDigest, first.record.digest);
    assert.equal(r.artifactFailedOwnCheck, true);
    assert.ok(!("record" in r), "a failed artifact is never rendered");
  });
});

describe("NOT_COMPARED: the artifact could not be read as a disclosure, so nothing was compared", () => {
  test("invalid JSON, a non-canonical artifact, a renamed field, a wrong id inside or an oversized file each refuse without a comparison", async () => {
    const { artifact, bytes } = buildPublicDisclosure(first);
    const corruptions: [string, string][] = [
      ["truncated", bytes.slice(0, -10)],
      ["pretty-printed", JSON.stringify(artifact, null, 2)],
      ["renamed field", bytes.replace('"digestCheck":', '"digestcheck":')],
      ["extra field", canonicalize({ ...artifact, extra: "x" })],
      ["wrong record id inside", canonicalize({ ...artifact, recordId: "wp-other-v1" })],
      ["preimage not canonical", canonicalize({ ...artifact, canonical: JSON.stringify(JSON.parse(artifact.canonical), null, 1) })],
      ["preimage names another id", canonicalize({ ...artifact, canonical: artifact.canonical.replace(`"id":"${first.id}"`, '"id":"wp-other-v1"') })],
      ["oversized", `${bytes.slice(0, -1)},"pad":"${"x".repeat(3 * 1024 * 1024)}"}`],
      ["array", "[]"],
      ["prototype key", '{"__proto__":{"a":1}}'],
    ];
    for (const [label, text] of corruptions) {
      const store = memoryStore();
      store.set(artifactPath(first.id, first.record.digest), text);
      const r = await resolvePublic(pathOf(), store);
      assert.equal(r.outcome, "NOT_COMPARED", `${label}: ${json(r)}`);
      if (r.outcome !== "NOT_COMPARED") continue;
      assert.equal(r.computedDigest, null, label);
      assert.ok(r.findings.length > 0 && r.findings.every((f) => /^[A-Z_]+$/.test(f.code)), label);
      assert.ok(!("record" in r), label);
    }
  });
});

describe("UNREACHABLE: the store could not be read, so nothing is said about the record", () => {
  test("a network failure, a non-200 non-404 status, a redirect, an unreadable standing or a listed artifact that is missing", async () => {
    const offline = memoryStore();
    offline.offline = true;
    let r = await resolvePublic(pathOf(), offline);
    assert.equal(r.outcome, "UNREACHABLE");
    if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "NETWORK");

    for (const status of [500, 503, 301, 302, 307, 403]) {
      const s = memoryStore();
      s.statusOverride = status;
      r = await resolvePublic(pathOf(), s);
      assert.equal(r.outcome, "UNREACHABLE", String(status));
      if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "STATUS", String(status));
    }

    const broken = memoryStore();
    broken.set(standingPath(first.id), "{not json");
    r = await resolvePublic(pathOf(), broken);
    assert.equal(r.outcome, "UNREACHABLE");
    if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "STANDING_INVALID");

    const other = memoryStore();
    const s = recordStanding(first, [{ digest: first.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    other.set(standingPath(first.id), JSON.stringify({ ...s, recordId: "wp-other-v1" }));
    r = await resolvePublic(pathOf(), other);
    assert.equal(r.outcome, "UNREACHABLE");
    if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "STANDING_INVALID");

    const stale = memoryStore();
    stale.set(artifactPath(first.id, first.record.digest), null);
    r = await resolvePublic(pathOf(), stale);
    assert.equal(r.outcome, "UNREACHABLE", json(r));
    if (r.outcome === "UNREACHABLE") assert.equal(r.reason, "ARTIFACT_MISSING");
    assert.ok(!/unavailable|invalid|mismatch/i.test(json(r).replace(/"outcome":"UNREACHABLE"/, "")), "an unreachable store is not told as an unavailable or invalid record");
  });
});

describe("the resolver asks for nothing but the two fixed files of the record named", () => {
  test("across every outcome, every request is under the route, under records/<id>/, and is the standing or a hex64 artifact", async () => {
    const seen: string[] = [];
    const scenarios = [pathOf(), pathOf({ ...first, record: { ...first.record, digest: "f".repeat(64) } }), pathOf({ ...first, id: "wp-none-v1" }), ...REFERENCE_TARGETS.map((t) => pathOf(first, t))];
    for (const path of scenarios) {
      const store = memoryStore();
      await resolvePublic(path, store);
      seen.push(...store.requests);
    }
    assert.ok(seen.length > 0);
    for (const p of seen) {
      const m = /^\/wallprint\/records\/([a-z0-9][a-z0-9_-]{2,63})\/(index|[0-9a-f]{64})\.json$/.exec(p);
      assert.ok(m, p);
      assert.ok(!p.includes(".."), p);
    }
  });
});
