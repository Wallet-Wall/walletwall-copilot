import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { canonicalize } from "../../mcp/src/canonical.ts";
import { privacyFindings, publicationIndex, PUBLISHABLE_ID_RE, verifyPublicDisclosure, verifyStanding } from "../../mcp/src/wallprint/publication.ts";
import { referenceOf, RESOLVER_ROUTE, toResolverPath } from "../../mcp/src/wallprint/reference.ts";
import { resolvePublic, type PublicStore } from "../lib/resolve.ts";
import { FIXTURES, publishedExports } from "./support/store.ts";

/**
 * The committed publication store (packages/wallprint-web/publication): what the public resolver serves. It must hold
 * exactly the engine-built synthetic lineages that publication admits, each artifact proving itself, each standing
 * verifying and naming exactly its artifact, and an index that is byte for byte what the standings regenerate. The
 * altered-after-commit copy was refused and is absent. The resolver, fed these files from disk, resolves every entry.
 */

const DIR = new URL("../publication/", import.meta.url);
const dir = decodeURIComponent(DIR.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const BASE = ["https:", "//", "walletwall.org"].join("");

describe("the committed publication store", () => {
  test("it exists and contains only the index and the records directory", () => {
    assert.ok(existsSync(dir), "packages/wallprint-web/publication is committed");
    assert.deepEqual(readdirSync(dir).sort(), ["index.json", "records"]);
  });

  test("the index names the canonical resolver base and the route, and is the canonical bytes of what the standings regenerate", () => {
    const text = read(join(dir, "index.json"));
    const index = JSON.parse(text) as { type: string; version: string; resolverBase: string; route: string; records: { recordId: string; digest: string }[] };
    assert.equal(index.type, "walletwall.wallprint.publication-index");
    assert.equal(index.version, "0.1");
    assert.equal(index.resolverBase, BASE);
    assert.equal(index.route, RESOLVER_ROUTE);
    const standings = readdirSync(join(dir, "records"))
      .sort()
      .map((id) => {
        const v = verifyStanding(JSON.parse(read(join(dir, "records", id, "index.json"))));
        assert.ok(v.ok, id);
        return v.ok ? v.standing : null!;
      });
    assert.equal(canonicalize(publicationIndex(standings, BASE)), text);
    assert.ok(!text.includes("\n"), "canonical bytes, no formatting");
  });

  test("every record directory holds one verified artifact named by its digest and a standing that names exactly it", () => {
    const ids = readdirSync(join(dir, "records")).sort();
    assert.ok(ids.length >= 12);
    for (const id of ids) {
      assert.match(id, PUBLISHABLE_ID_RE);
      const files = readdirSync(join(dir, "records", id)).sort();
      const artifacts = files.filter((f) => f !== "index.json");
      assert.equal(artifacts.length, 1, `${id}: one committed digest per record`);
      const digest = artifacts[0]!.replace(/\.json$/, "");
      assert.match(digest, /^[0-9a-f]{64}$/);
      const bytes = read(join(dir, "records", id, artifacts[0]!));
      const v = verifyPublicDisclosure(bytes);
      assert.ok(v.ok, `${id}: ${v.ok ? "" : JSON.stringify(v.findings)}`);
      if (!v.ok) continue;
      assert.equal(v.artifact.recordId, id);
      assert.equal(v.artifact.digest, digest);
      assert.equal(canonicalize(v.artifact), bytes, "canonical bytes on disk");
      const s = verifyStanding(JSON.parse(read(join(dir, "records", id, "index.json"))));
      assert.ok(s.ok, id);
      if (s.ok) {
        assert.deepEqual(s.standing.publications.map((p) => p.digest), [digest]);
        assert.equal(s.standing.publications[0]!.publishedAt, "2026-10-26T18:00:00.000Z");
        assert.deepEqual(privacyFindings(s.standing), []);
      }
      assert.deepEqual(privacyFindings(v.artifact), [], `${id}: nothing private leaves`);
    }
  });

  test("the store holds exactly the publishable engine-built records and not the altered copy", () => {
    const ids = readdirSync(join(dir, "records")).sort();
    const expected = publishedExports()
      .map((e) => e.id)
      .sort();
    assert.deepEqual(ids, expected);
    assert.ok(!ids.includes(FIXTURES["receipt-mismatch"]!.records[0]!.id), "the altered-after-commit copy was refused at publication");
    for (const e of publishedExports()) {
      const bytes = read(join(dir, "records", e.id, `${e.record.digest}.json`));
      const v = verifyPublicDisclosure(bytes);
      assert.ok(v.ok && JSON.stringify(v.record) === JSON.stringify(e.record), `${e.id}: the published record is the engine's record, byte for byte`);
    }
  });

  test("served from disk, the resolver resolves every published record and nothing else", async () => {
    const store: PublicStore = {
      get(path) {
        if (!path.startsWith(RESOLVER_ROUTE)) return Promise.resolve({ status: 404, text: "" });
        const file = join(dir, ...path.slice(RESOLVER_ROUTE.length).split("/"));
        return Promise.resolve(existsSync(file) ? { status: 200, text: read(file) } : { status: 404, text: "" });
      },
    };
    for (const e of publishedExports()) {
      const r = await resolvePublic(toResolverPath(referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion })), store);
      assert.equal(r.outcome, "RESOLVED", e.id);
    }
    const altered = FIXTURES["receipt-mismatch"]!.records[0]!;
    const committed = altered.lifecycle.events[0]!;
    const r = await resolvePublic(toResolverPath(referenceOf({ id: committed.recordId, digest: committed.recordDigest, wallprintVersion: "0.1" })), store);
    assert.equal(r.outcome, "UNAVAILABLE");
  });
});
