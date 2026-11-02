import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { canonicalize } from "../../mcp/src/canonical.ts";
import { createWallPrintHistory } from "../../mcp/src/wallprint/history.ts";
import { buildPublicDisclosure, recordStanding, storeGraphFindings, verifyPublicDisclosure, type DisclosureExport } from "../../mcp/src/wallprint/publication.ts";
import { referenceOf, RESOLVER_ROUTE, toResolverPath } from "../../mcp/src/wallprint/reference.ts";
import { buildWallPrintSnapshot, verifyWallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../mcp/src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../mcp/src/wallprint/replay.ts";
import { baseInput, COMMIT_AT, DISCLOSE_AT } from "../../mcp/test/wallprint/support.ts";
import { resolvePublic } from "../lib/resolve.ts";
import { publicView } from "../lib/view.ts";
import { memoryStore, publishedExports, PUBLISHED_AT } from "./support/store.ts";
import { golden } from "../../mcp/test/wallprint/support.ts";

/**
 * Publication and resolution with both WallPrint versions in one store. The store is content-addressed (a path is
 * `records/<id>/<digest>.json` and the digest covers the record's WallPrint version), so a 0.1 and a 0.2 record never share
 * a path; the resolver renders the version of the record it actually proved; and the committed 0.1 artifacts are what they
 * were. Everything here is built in memory: nothing is added to the committed store.
 */
const COMMITTED = new URL("../publication/", import.meta.url);
const committedDir = decodeURIComponent(COMMITTED.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const BASE = ["https:", "//", "walletwall.org"].join("");

function exportOf(record: WallPrintRecord, title: string): DisclosureExport {
  const h = createWallPrintHistory();
  h.commit(record, { at: COMMIT_AT });
  h.disclose(record.id, { at: DISCLOSE_AT });
  const view = h.view(record.id)!;
  const evidence = createEvidenceStore();
  evidence.put(golden());
  return structuredClone({
    title,
    construction: null,
    registry: { asset: null, chain: null },
    id: record.id,
    record,
    canonical: canonicalize(wallPrintPayload(record)),
    validation: { ok: true, findings: [] },
    digest: verifyWallPrintDigest(record),
    lifecycle: { state: view.lifecycle.state, events: [...view.lifecycle.events] },
    supersedes: view.supersedes,
    supersededBy: view.supersededBy,
    lineage: view.lineage,
    diff: null,
    receipt: { issued: null, verification: null },
    replay: replayWallPrint(record, { evidence }),
  });
}

const v02 = (): DisclosureExport => exportOf(buildWallPrintSnapshot(baseInput({ id: "wp-mixed-current-v1", assessments: [] })), "A WallPrint 0.2 record published beside 0.1 records.");
const pathOf = (e: DisclosureExport): string => `${RESOLVER_ROUTE}records/${e.id}/${e.record.digest}.json`;

describe("a store holding WallPrint 0.1 and 0.2 records", () => {
  test("the committed 0.1 artifacts are byte-for-byte what the engine publishes today, so adding 0.2 touched none of them", () => {
    const exports = publishedExports();
    assert.ok(exports.length >= 12);
    for (const e of exports) {
      assert.equal(e.record.wallprintVersion, "0.1");
      const committed = read(join(committedDir, "records", e.id, `${e.record.digest}.json`));
      assert.equal(buildPublicDisclosure(e).bytes, committed, `${e.id}: unchanged`);
    }
    assert.deepEqual(readdirSync(join(committedDir, "records")).sort(), exports.map((e) => e.id).sort(), "the committed store holds no 0.2 record");
  });

  test("a 0.2 record publishes to its own path: no path of a 0.1 artifact is ever a 0.2 path, and the artifact states and proves its version", () => {
    const e02 = v02();
    const built = buildPublicDisclosure(e02);
    assert.equal(built.artifact.wallprintVersion, "0.2");
    const verified = verifyPublicDisclosure(built.bytes);
    assert.ok(verified.ok && verified.artifact.wallprintVersion === "0.2" && verified.record.wallprintVersion === "0.2");
    const paths = [...publishedExports().map(pathOf), pathOf(e02)];
    assert.equal(new Set(paths).size, paths.length, "every artifact path is unique");
    const store = memoryStore([...publishedExports(), e02]);
    for (const e of [...publishedExports(), e02]) assert.ok(store.files.has(pathOf(e)), pathOf(e));
  });

  test("the resolver proves and renders the version of the record it resolved, for each version, from its own reference", async () => {
    const e02 = v02();
    const store = memoryStore([...publishedExports(), e02]);
    const mixed = [publishedExports()[0]!, e02];
    for (const e of mixed) {
      const ref = referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion });
      assert.ok(toResolverPath(ref).includes(`wallprint=${e.record.wallprintVersion}`));
      const resolved = await resolvePublic(toResolverPath(ref), store);
      assert.equal(resolved.outcome, "RESOLVED", e.id);
      const view = publicView(resolved, BASE, {});
      assert.equal(view.status, "wallprint");
      if (view.status !== "wallprint") continue;
      const shown = (view.disclosure["records"] as { record: { wallprintVersion: string; digest: string } }[])[0]!;
      assert.equal(shown.record.wallprintVersion, e.record.wallprintVersion);
      assert.equal(shown.record.digest, e.record.digest, "digest verification happened before render: the shown record is the proved one");
      assert.equal(view.reference.wallprintVersion, e.record.wallprintVersion);
      assert.deepEqual(view.publication.published.map((p) => p.path), [toResolverPath(ref)], "the published link carries the publication's own version");
    }
  });

  test("a reference that states the wrong version for a digest still resolves only the record that digest names, and the page prints that record's version", async () => {
    const e02 = v02();
    const store = memoryStore([...publishedExports(), e02]);
    const mislabelled = toResolverPath(referenceOf({ id: e02.id, digest: e02.record.digest, wallprintVersion: "0.1" }));
    const resolved = await resolvePublic(mislabelled, store);
    assert.equal(resolved.outcome, "RESOLVED");
    const view = publicView(resolved, BASE, {});
    assert.equal(view.reference.wallprintVersion, "0.2", "what was resolved, not what was asked");
    const other = toResolverPath(referenceOf({ id: e02.id, digest: publishedExports()[0]!.record.digest, wallprintVersion: "0.2" }));
    assert.equal((await resolvePublic(other, store)).outcome, "DIGEST_MISMATCH", "a digest that is not the committed one is a mismatch whatever version it states");
  });

  test("a tampered 0.2 artifact is not rendered: its bytes must digest to the path they are served under", async () => {
    const e02 = v02();
    const store = memoryStore([e02]);
    const good = store.files.get(pathOf(e02))!;
    store.set(pathOf(e02), good.replace('"wallprintVersion":"0.2"', '"wallprintVersion":"0.1"'));
    const resolved = await resolvePublic(toResolverPath(referenceOf({ id: e02.id, digest: e02.record.digest, wallprintVersion: "0.2" })), store);
    assert.notEqual(resolved.outcome, "RESOLVED");
  });

  test("one record id carries one digest: a 0.2 record under an id a 0.1 record holds is a conflict in the store graph, never an overwrite", () => {
    const first = publishedExports()[0]!;
    const same = exportOf(buildWallPrintSnapshot(baseInput({ id: first.id, assessments: [] })), "A 0.2 record under the id of a 0.1 record.");
    assert.equal(same.record.wallprintVersion, "0.2");
    assert.notEqual(same.record.digest, first.record.digest);
    assert.notEqual(buildPublicDisclosure(same).bytes, buildPublicDisclosure(first).bytes);
    const standings = [first, same].map((e) => recordStanding(e, [{ digest: e.record.digest, wallprintVersion: e.record.wallprintVersion, publishedAt: PUBLISHED_AT }]));
    assert.ok(storeGraphFindings(standings).length > 0, "two records under one id are refused as a graph");
  });
});
