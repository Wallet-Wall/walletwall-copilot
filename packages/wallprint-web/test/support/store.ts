import { buildPublicDisclosure, recordStanding, type DisclosureExport } from "../../../mcp/src/wallprint/publication.ts";
import { RESOLVER_ROUTE } from "../../../mcp/src/wallprint/reference.ts";
import { buildWallPrintDisclosures, type DisclosureFixture, type DisclosureRecord } from "../../../mcp/test/support/wallprint-disclosures.ts";
import type { PublicStore, StoreResponse } from "../../lib/resolve.ts";

/**
 * A public store in memory, published from the engine's synthetic disclosure lineages exactly as the publisher would
 * write it: one immutable artifact per record and one standing document per record id, under the resolver route.
 * Every request is recorded so a test can prove what the resolver asked for and what it never asked for.
 */

export const PUBLISHED_AT = "2026-10-26T18:00:00.000Z";
export const FIXTURES = buildWallPrintDisclosures();

export const exportOf = (fixture: DisclosureFixture, r: DisclosureRecord): DisclosureExport => structuredClone({ title: fixture.title, construction: fixture.scenario, registry: fixture.registry, ...r });

export interface MemoryStore extends PublicStore {
  files: Map<string, string>;
  requests: string[];
  /** Replace the text served at a path (a corrupted artifact, a stale standing); absent paths answer 404. */
  set(path: string, text: string | null): void;
  /** Make every request fail as the network would. */
  offline: boolean;
  /** Answer every request with this status instead (a 500, a 301). */
  statusOverride: number | null;
}

export function publishedExports(): DisclosureExport[] {
  return Object.values(FIXTURES)
    .flatMap((f) => f.records.map((r) => exportOf(f, r)))
    .filter((e) => e.validation.ok);
}

export function memoryStore(exports: DisclosureExport[] = publishedExports(), route = RESOLVER_ROUTE): MemoryStore {
  const files = new Map<string, string>();
  for (const e of exports) {
    const { bytes } = buildPublicDisclosure(e);
    files.set(`${route}records/${e.id}/${e.record.digest}.json`, bytes);
    const standing = recordStanding(e, [{ digest: e.record.digest, wallprintVersion: e.record.wallprintVersion, publishedAt: PUBLISHED_AT }]);
    files.set(`${route}records/${e.id}/index.json`, JSON.stringify(standing));
  }
  const store: MemoryStore = {
    files,
    requests: [],
    offline: false,
    statusOverride: null,
    set(path, text) {
      if (text === null) files.delete(path);
      else files.set(path, text);
    },
    get(path: string): Promise<StoreResponse> {
      store.requests.push(path);
      if (store.offline) return Promise.resolve({ status: 0, text: "" });
      if (store.statusOverride !== null) return Promise.resolve({ status: store.statusOverride, text: "" });
      const text = files.get(path);
      return Promise.resolve(text === undefined ? { status: 404, text: "" } : { status: 200, text });
    },
  };
  return store;
}
