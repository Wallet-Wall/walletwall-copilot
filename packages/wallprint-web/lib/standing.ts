import { PUBLICATION_MAX_BYTES, PUBLICATION_VERSION, RECORD_INDEX_TYPE, STANDING_FIELDS } from "../../mcp/src/wallprint/publication-vocabulary.ts";
import { HEX64_RE, hasExactKeys, isPlainObject, isString, parsePlainJson } from "./shape.ts";

/**
 * A record's standing as the resolver reads it: the mutable, append-only metadata the publisher keeps beside the
 * immutable bytes (which digests are published and since when, the lifecycle ledger, the lineage, the successor). The
 * resolver uses exactly one fact from it to locate bytes, the published digests; everything else is passed to the page
 * as the index says it, labelled as standing, and never changes the record.
 */

export interface PublishedDigest {
  digest: string;
  wallprintVersion: string;
  publishedAt: string;
}

export interface Standing {
  recordId: string;
  publications: PublishedDigest[];
  lifecycle: { state: unknown; events: unknown[] };
  supersedes: unknown;
  supersededBy: { id: string; digest: string; kind: string } | null;
  lineage: { root: unknown; current: unknown; predecessor: unknown; successor: unknown; chain: unknown[] };
}

/** Read a standing document for one record id. Null when it is not a standing for that record; nothing is repaired. */
export function parseStanding(text: unknown, recordId: string): Standing | null {
  const v = parsePlainJson(text, PUBLICATION_MAX_BYTES);
  if (!isPlainObject(v) || !hasExactKeys(v, STANDING_FIELDS)) return null;
  if (v["type"] !== RECORD_INDEX_TYPE || v["version"] !== PUBLICATION_VERSION || v["recordId"] !== recordId) return null;
  const pubs = v["publications"];
  if (!Array.isArray(pubs) || pubs.length === 0 || pubs.length > 256) return null;
  const publications: PublishedDigest[] = [];
  for (const p of pubs) {
    if (!isPlainObject(p) || !hasExactKeys(p, ["digest", "wallprintVersion", "publishedAt"])) return null;
    const digest = p["digest"];
    const wallprintVersion = p["wallprintVersion"];
    const publishedAt = p["publishedAt"];
    if (!isString(digest) || !HEX64_RE.test(digest) || !isString(wallprintVersion) || !isString(publishedAt)) return null;
    publications.push({ digest, wallprintVersion, publishedAt });
  }
  const lifecycle = v["lifecycle"];
  if (!isPlainObject(lifecycle) || !hasExactKeys(lifecycle, ["state", "events"]) || !Array.isArray(lifecycle["events"])) return null;
  // One committed digest per record: every publication listed is of the digest the ledger's first event commits. The
  // page picks which artifact to fetch from this list, so the list must agree with the ledger before anything is fetched.
  const committed: unknown = lifecycle["events"][0];
  if (!isPlainObject(committed) || !publications.every((p) => p.digest === committed["recordDigest"])) return null;
  const by = v["supersededBy"];
  let supersededBy: Standing["supersededBy"] = null;
  if (by !== null) {
    if (!isPlainObject(by) || !hasExactKeys(by, ["id", "digest", "kind"]) || !isString(by["id"]) || !isString(by["digest"]) || !isString(by["kind"])) return null;
    supersededBy = { id: by["id"], digest: by["digest"], kind: by["kind"] };
  }
  const lineage = v["lineage"];
  if (!isPlainObject(lineage) || !hasExactKeys(lineage, ["root", "current", "predecessor", "successor", "chain"]) || !Array.isArray(lineage["chain"])) return null;
  return {
    recordId,
    publications,
    lifecycle: { state: lifecycle["state"], events: lifecycle["events"] },
    supersedes: v["supersedes"],
    supersededBy,
    lineage: { root: lineage["root"], current: lineage["current"], predecessor: lineage["predecessor"], successor: lineage["successor"], chain: lineage["chain"] },
  };
}
