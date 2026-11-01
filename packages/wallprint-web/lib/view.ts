import { PUBLICATION_STATEMENT } from "../../mcp/src/wallprint/publication-vocabulary.ts";
import { isResolverBase, toResolverPath, tryReference } from "../../mcp/src/wallprint/reference.ts";
import type { PublicResolution } from "./resolve.ts";
import type { Standing } from "./standing.ts";

/**
 * From a resolution to the renderer's input. The public page renders with the canvas's WallPrint renderer (the same
 * instrument, not a second design); this module only arranges what the resolver proved into the shape that renderer
 * reads, plus a `publication` block that switches it into public mode: the publication line instead of the fixture
 * line, the standing beside the record, same-origin links to a predecessor or successor, the HTTPS form in the QR code
 * when a resolver base is known, and the boundary statement. Nothing is decided here.
 */

export interface PublishedLink {
  digest: string;
  publishedAt: string;
  /** The same-origin resolver path of that publication: `/wallprint/<id>?reference=...`. */
  path: string;
}

export interface PublicationBlock {
  statement: string;
  /** The HTTPS origin the share form uses, or null when none is known or it does not validate (the QR then carries the reference itself). */
  resolverBase: string | null;
  recordId: string | null;
  digest: string | null;
  publishedAt: string | null;
  /** How a synthetic disclosure was constructed, as its artifact declares it; null for a disclosure of a real evaluation. */
  construction: unknown;
  /** Every publication of the record this store holds, with a same-origin path to each. */
  published: PublishedLink[];
  /** RESOLVED: the record standing as the store index records it (lifecycle, successor, lineage, publications). */
  standing: Standing | null;
  /** UNREACHABLE: why the store could not be read. */
  reason: string | null;
  /** DIGEST_MISMATCH: the published artifact does not digest to the digest it carries. */
  artifactFailedOwnCheck: boolean;
  /** NOT_COMPARED: the fixed codes of what the artifact reader refused. */
  findings: string[];
  /** The page is served from another origin than the resolver base (a mirror, a preview, a local build). The origin itself is never carried. */
  mirror: boolean;
  /** The bare route with no record: a landing sentence instead of a malformed-reference page. */
  landing: boolean;
}

export interface PublicViewOptions {
  /** The origin the page is served from (location.origin), compared with the resolver base and never printed. */
  servedFrom?: string | null;
  /** True when the address is the bare route with no query. */
  landing?: boolean;
}

export interface PublicReferenceSummary {
  outcome: string;
  problem: string | null;
  recordId: string | null;
  digest: string | null;
  target: string | null;
  wallprintVersion: string | null;
  resolution: { outcome: string; recordId: string; referenceDigest?: string; embeddedDigest?: string | null; computedDigest?: string | null; digest?: string; target?: string | null } | null;
}

export type PublicView =
  | { status: "wallprint"; source: string; fixture: string; disclosure: Record<string, unknown>; vocabulary: unknown; reference: PublicReferenceSummary; focus: string; target: string | null; publication: PublicationBlock }
  | { status: "reference"; source: string; wallprints: never[]; vocabulary: unknown; reference: PublicReferenceSummary; publication: PublicationBlock };

export const PUBLIC_SOURCE = "public resolver";

/** One link per publication, each carrying the WallPrint version that publication was committed under: never the version a caller's reference happened to state. */
function links(recordId: string, publications: readonly { digest: string; wallprintVersion: string; publishedAt: string }[]): PublishedLink[] {
  const out: PublishedLink[] = [];
  for (const p of publications) {
    const ref = tryReference({ recordId, digest: p.digest, wallprintVersion: p.wallprintVersion });
    if (ref !== null) out.push({ digest: p.digest, publishedAt: p.publishedAt, path: toResolverPath(ref) });
  }
  return out;
}

/** Arrange a resolution for the renderer. `resolverBase` is checked here; an invalid one is dropped, never repaired. */
export function publicView(r: PublicResolution, resolverBase: unknown, vocabulary: unknown, options: PublicViewOptions = {}): PublicView {
  const base = isResolverBase(resolverBase) ? resolverBase : null;
  const mirror = base !== null && typeof options.servedFrom === "string" && options.servedFrom !== base;
  const landing = options.landing === true && r.outcome === "MALFORMED_REFERENCE";
  const block = (over: Partial<PublicationBlock>): PublicationBlock => ({
    statement: PUBLICATION_STATEMENT,
    resolverBase: base,
    recordId: null,
    digest: null,
    publishedAt: null,
    construction: null,
    published: [],
    standing: null,
    reason: null,
    artifactFailedOwnCheck: false,
    findings: [],
    mirror,
    landing,
    ...over,
  });
  if (r.outcome === "MALFORMED_REFERENCE" || r.outcome === "UNSUPPORTED_VERSION") {
    return { status: "reference", source: PUBLIC_SOURCE, wallprints: [], vocabulary, reference: { outcome: r.outcome, problem: r.problem, recordId: null, digest: null, target: null, wallprintVersion: null, resolution: null }, publication: block({}) };
  }
  const ref = r.reference;
  const summary = (resolution: PublicReferenceSummary["resolution"]): PublicReferenceSummary => ({ outcome: r.outcome, problem: null, recordId: ref.recordId, digest: ref.digest, target: ref.target, wallprintVersion: ref.wallprintVersion, resolution });
  if (r.outcome === "UNAVAILABLE") return { status: "reference", source: PUBLIC_SOURCE, wallprints: [], vocabulary, reference: summary({ outcome: "UNAVAILABLE", recordId: ref.recordId }), publication: block({ recordId: ref.recordId, digest: ref.digest }) };
  if (r.outcome === "UNREACHABLE") return { status: "reference", source: PUBLIC_SOURCE, wallprints: [], vocabulary, reference: summary(null), publication: block({ recordId: ref.recordId, digest: ref.digest, reason: r.reason }) };
  const published = links(ref.recordId, r.standing.publications);
  if (r.outcome === "NOT_COMPARED") {
    return {
      status: "reference",
      source: PUBLIC_SOURCE,
      wallprints: [],
      vocabulary,
      reference: summary({ outcome: "NOT_COMPARED", recordId: ref.recordId, referenceDigest: r.referenceDigest, embeddedDigest: r.embeddedDigest, computedDigest: null }),
      publication: block({ recordId: ref.recordId, digest: ref.digest, published, findings: r.findings.map((f) => f.code) }),
    };
  }
  if (r.outcome === "DIGEST_MISMATCH") {
    return {
      status: "reference",
      source: PUBLIC_SOURCE,
      wallprints: [],
      vocabulary,
      reference: summary({ outcome: "DIGEST_MISMATCH", recordId: ref.recordId, referenceDigest: r.referenceDigest, embeddedDigest: r.embeddedDigest, computedDigest: r.computedDigest }),
      publication: block({ recordId: ref.recordId, digest: ref.digest, published: r.artifactFailedOwnCheck ? [] : published, artifactFailedOwnCheck: r.artifactFailedOwnCheck }),
    };
  }
  const a = r.artifact;
  const entry = {
    id: ref.recordId,
    record: r.record,
    canonical: a.canonical,
    validation: a.validation,
    digest: a.digestCheck,
    lifecycle: r.standing.lifecycle,
    // The predecessor link comes from the proved record itself, never from a field carried beside it.
    supersedes: r.record["supersedes"] ?? null,
    supersededBy: r.standing.supersededBy,
    lineage: r.standing.lineage,
    diff: a.diff,
    receipt: a.receipt,
    replay: a.replay,
  };
  const publishedAt = r.standing.publications.find((p) => p.digest === ref.digest)?.publishedAt ?? null;
  return {
    status: "wallprint",
    source: PUBLIC_SOURCE,
    fixture: ref.recordId,
    disclosure: { title: a.title, focus: ref.recordId, scenario: a.construction, registry: a.registry, records: [entry] },
    vocabulary,
    // What was resolved, not what was asked: the digest identifies the record and covers its WallPrint version, so the page prints the version of the record it proved.
    reference: { ...summary({ outcome: "RESOLVED", recordId: ref.recordId, digest: ref.digest, target: ref.target }), wallprintVersion: a.wallprintVersion },
    focus: ref.recordId,
    target: ref.target,
    publication: block({ recordId: ref.recordId, digest: ref.digest, publishedAt, construction: a.construction, published, standing: r.standing }),
  };
}
