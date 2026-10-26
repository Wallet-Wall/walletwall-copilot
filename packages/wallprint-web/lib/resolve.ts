import { STORE_RECORDS_DIR, STORE_STANDING_FILE } from "../../mcp/src/wallprint/publication-vocabulary.ts";
import { REFERENCE_OUTCOMES, RESOLVER_ROUTE, parseResolverPath, resolveReference, type ReferenceProblem, type WallPrintPortableReference } from "../../mcp/src/wallprint/reference.ts";
import { readArtifact, type PublicArtifact } from "./artifact.ts";
import { standingFindings } from "./ledger.ts";
import type { Finding } from "./shape.ts";
import { parseStanding, type Standing } from "./standing.ts";

/**
 * The public resolver: locate the published disclosure a URL names, prove its bytes, and say exactly one of seven things.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *   A resolver locates a disclosure. It does not make that disclosure authoritative.
 *
 *   MALFORMED_REFERENCE / UNSUPPORTED_VERSION   the URL is not a reference this resolver reads; the store is never asked
 *   UNAVAILABLE                                 the store holds no standing for that record id (not invalid, not false)
 *   UNREACHABLE                                 the store could not be read (network, status, unreadable standing, a
 *                                               listed artifact missing); nothing is said about the record
 *   NOT_COMPARED                                the artifact is not a disclosure this resolver reads; nothing was compared
 *   DIGEST_MISMATCH                             the record is held under other bytes, or the artifact fails its own
 *                                               digest check (flagged); every digest is reported, no record is carried
 *   RESOLVED                                    the artifact's canonical preimage digests to the digest the URL names
 *
 * It fetches exactly two fixed files of the record named, both under the route: the standing (`records/<id>/index.json`)
 * and one immutable artifact (`records/<id>/<digest>.json`). It never follows a reference to another record, never
 * redirects an old record to a newer one, never repairs what it reads, and renders nothing it did not prove.
 */

export const PUBLIC_OUTCOMES = [...REFERENCE_OUTCOMES, "UNREACHABLE"] as const;
export type PublicOutcome = (typeof PUBLIC_OUTCOMES)[number];

export interface StoreResponse {
  /** HTTP status; 0 when the request itself failed. */
  status: number;
  text: string;
}
export interface PublicStore {
  get(path: string): Promise<StoreResponse>;
}

export type UnreachableReason = "NETWORK" | "STATUS" | "STANDING_INVALID" | "ARTIFACT_MISSING";

export type PublicResolution =
  | { outcome: "MALFORMED_REFERENCE"; problem: ReferenceProblem; reference: null }
  | { outcome: "UNSUPPORTED_VERSION"; problem: ReferenceProblem; reference: null }
  | { outcome: "UNAVAILABLE"; reference: WallPrintPortableReference }
  | { outcome: "UNREACHABLE"; reference: WallPrintPortableReference; reason: UnreachableReason }
  | { outcome: "NOT_COMPARED"; reference: WallPrintPortableReference; standing: Standing; referenceDigest: string; embeddedDigest: string | null; computedDigest: null; findings: Finding[] }
  | { outcome: "DIGEST_MISMATCH"; reference: WallPrintPortableReference; standing: Standing; referenceDigest: string; embeddedDigest: string; computedDigest: string; artifactFailedOwnCheck: boolean }
  | { outcome: "RESOLVED"; reference: WallPrintPortableReference; standing: Standing; artifact: PublicArtifact; record: Record<string, unknown>; computedDigest: string };

/** The two store paths for one record under the route: its standing, and one immutable artifact by digest. */
export function storePaths(route: string, recordId: string, digest: string): { standing: string; artifact: string } {
  const dir = `${route}${STORE_RECORDS_DIR}/${recordId}/`;
  return { standing: `${dir}${STORE_STANDING_FILE}`, artifact: `${dir}${digest}.json` };
}

async function fetchText(store: PublicStore, path: string): Promise<StoreResponse> {
  try {
    const r = await store.get(path);
    return typeof r.status === "number" && typeof r.text === "string" ? r : { status: 0, text: "" };
  } catch {
    return { status: 0, text: "" };
  }
}

export async function resolvePublic(pathAndQuery: unknown, store: PublicStore, route: string = RESOLVER_ROUTE): Promise<PublicResolution> {
  const parsed = parseResolverPath(pathAndQuery);
  if (!parsed.ok) return { outcome: parsed.outcome, problem: parsed.problem, reference: null };
  const reference = parsed.reference;
  const unreachable = (reason: UnreachableReason): PublicResolution => ({ outcome: "UNREACHABLE", reference, reason });

  const standingResponse = await fetchText(store, storePaths(route, reference.recordId, reference.digest).standing);
  if (standingResponse.status === 0) return unreachable("NETWORK");
  if (standingResponse.status === 404) return { outcome: "UNAVAILABLE", reference };
  if (standingResponse.status !== 200) return unreachable("STATUS");
  const standing = parseStanding(standingResponse.text, reference.recordId);
  if (standing === null) return unreachable("STANDING_INVALID");

  // The bytes the URL names when the store publishes them; otherwise the record's published bytes, for the comparison.
  const published = standing.publications.find((p) => p.digest === reference.digest) ?? standing.publications[0]!;
  const artifactResponse = await fetchText(store, storePaths(route, reference.recordId, published.digest).artifact);
  if (artifactResponse.status === 0) return unreachable("NETWORK");
  if (artifactResponse.status === 404) return unreachable("ARTIFACT_MISSING");
  if (artifactResponse.status !== 200) return unreachable("STATUS");

  const read = await readArtifact(artifactResponse.text, reference.recordId);
  if (read.findings.length > 0 || read.artifact === null || read.record === null || read.computedDigest === null || read.embeddedDigest === null) {
    return { outcome: "NOT_COMPARED", reference, standing, referenceDigest: reference.digest, embeddedDigest: read.embeddedDigest, computedDigest: null, findings: read.findings };
  }
  const resolution = resolveReference(reference, { recordId: read.artifact.recordId, embeddedDigest: read.embeddedDigest, computedDigest: read.computedDigest });
  switch (resolution.outcome) {
    case "RESOLVED": {
      // The standing is printed beside the record and feeds its portable reference: it must be about these bytes.
      const findings = await standingFindings(standing, reference.recordId, read.computedDigest, read.record);
      if (findings.length > 0) return unreachable("STANDING_INVALID");
      return { outcome: "RESOLVED", reference, standing, artifact: read.artifact, record: read.record, computedDigest: read.computedDigest };
    }
    case "DIGEST_MISMATCH":
      return { outcome: "DIGEST_MISMATCH", reference, standing, referenceDigest: reference.digest, embeddedDigest: resolution.embeddedDigest, computedDigest: resolution.computedDigest, artifactFailedOwnCheck: resolution.embeddedDigest !== resolution.computedDigest };
    case "NOT_COMPARED":
      return { outcome: "NOT_COMPARED", reference, standing, referenceDigest: reference.digest, embeddedDigest: resolution.embeddedDigest, computedDigest: null, findings: [{ code: "DIGEST_NOT_COMPUTED", path: "" }] };
    default:
      return { outcome: "UNAVAILABLE", reference };
  }
}
