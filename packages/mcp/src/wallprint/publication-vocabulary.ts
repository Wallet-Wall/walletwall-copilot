/**
 * Publication vocabulary: the fixed names of the public disclosure contract, in a module with no imports so the public
 * resolver (a browser page) can share them with the publisher (publication.ts) without carrying the engine or its schema
 * library. Nothing here decides anything; it names things.
 */

export const DISCLOSURE_TYPE = "walletwall.wallprint.disclosure";
export const RECORD_INDEX_TYPE = "walletwall.wallprint.record-index";
export const PUBLICATION_INDEX_TYPE = "walletwall.wallprint.publication-index";
export const PUBLICATION_VERSION = "0.1";
/** A publishable record id: the record grammar restricted to one path segment every filesystem and URL accepts (no `:` or `.`). */
export const PUBLISHABLE_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
/** Names Windows reserves for devices: a directory with such a name cannot be created or checked out there. */
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
/** True when a record id can be one directory name on every filesystem and one URL path segment: the shape, and no reserved device name. */
export function isPublishableId(id: unknown): boolean {
  return typeof id === "string" && PUBLISHABLE_ID_RE.test(id) && !WINDOWS_RESERVED_RE.test(id);
}
/** How a synthetic disclosure's records were constructed (the fixture generator's declaration); null for a disclosure of a real evaluation. */
export const CONSTRUCTION_KINDS = ["ENGINE_BUILT", "COMMITTED_ELSEWHERE", "ALTERED_AFTER_COMMIT", "VERIFICATION_NOT_CARRIED"] as const;
export type ConstructionKind = (typeof CONSTRUCTION_KINDS)[number];
/** The sentence every public page carries beside the principle. It names what publication and resolution do not establish. */
export const PUBLICATION_STATEMENT = "This page resolves a published WallPrint disclosure. Publication and resolution do not establish factual truth, safety, solvency, compliance, or investment merit.";
/** The largest artifact or standing document a verifier reads; a record is tens of kilobytes. */
export const PUBLICATION_MAX_BYTES = 2 * 1024 * 1024;
/** The fields of an immutable public disclosure, in RFC 8785 (UTF-16 code unit) order. Nothing else is admitted. */
export const DISCLOSURE_FIELDS = ["canonical", "construction", "diff", "digest", "digestCheck", "receipt", "recordId", "registry", "replay", "supersedes", "title", "type", "validation", "version", "wallprintVersion"] as const;
/** The fields of a record's standing document, in RFC 8785 order. */
export const STANDING_FIELDS = ["lifecycle", "lineage", "publications", "recordId", "supersededBy", "supersedes", "type", "version"] as const;
/** The public resolver's store layout under the route: one directory per record id, the standing beside the immutable artifacts. */
export const STORE_RECORDS_DIR = "records";
export const STORE_STANDING_FILE = "index.json";
