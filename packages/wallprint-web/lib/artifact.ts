import { DISCLOSURE_FIELDS, DISCLOSURE_TYPE, PUBLICATION_MAX_BYTES, PUBLICATION_VERSION } from "../../mcp/src/wallprint/publication-vocabulary.ts";
import { REPLAY_OUTCOMES, REPLAY_REASONS, UNREPLAYABLE_REASONS } from "../../mcp/src/wallprint/vocabulary.ts";
import { canonicalForm } from "./canonical-form.ts";
import { sha256Hex } from "./digest.ts";
import { HEX64_RE, hasExactKeys, isPlainObject, isString, parsePlainJson, type Finding } from "./shape.ts";

const RECEIPT_FIELDS = ["wallprintVersion", "recordId", "canonicalization", "digestAlgorithm", "digest", "bundleDigest", "versions"] as const;
const VERSION_KEYS = ["wwep", "registry", "policies", "rules"] as const;
const strictlySorted = (xs: readonly string[]): boolean => xs.every((x, i) => i === 0 || xs[i - 1]! < x);
const stringsIn = (v: unknown, allowed: readonly string[]): v is string[] => Array.isArray(v) && v.every((x) => isString(x) && allowed.includes(x));

/**
 * The engine results an artifact carries beside the record, checked against the record and the artifact's own digest
 * as the publication contract requires them (publication.ts admits nothing else). This re-derives no result: it refuses
 * a published artifact whose carried results contradict the record it carries. A result that is consistent but not the
 * engine's (a replay outcome flipped together with its fields) cannot be told apart here; the page says so, because the
 * URL's digest covers the record's canonical bytes and not these results.
 */
export function carriedFindings(v: Record<string, unknown>, payload: Record<string, unknown>, recordId: string, digest: string): Finding[] {
  const out: Finding[] = [];
  const mismatch = (path: string): void => {
    out.push({ code: "CARRIED_RESULT_MISMATCH", path });
  };
  // A published record validated at publication, so its carried validation and self-digest check are fixed values.
  if (canonicalForm(v["validation"]) !== canonicalForm({ ok: true, findings: [] })) mismatch("validation");
  if (canonicalForm(v["digestCheck"]) !== canonicalForm({ hasDigest: true, matches: true, computedDigest: digest })) mismatch("digestCheck");
  if (!("supersedes" in payload) || canonicalForm(v["supersedes"]) !== canonicalForm(payload["supersedes"])) mismatch("supersedes");
  const diff = v["diff"];
  const diffShaped = diff === null || (isPlainObject(diff) && hasExactKeys(diff, ["changed", "changes"]) && typeof diff["changed"] === "boolean" && Array.isArray(diff["changes"]) && diff["changed"] === diff["changes"].length > 0);
  if (!diffShaped || (payload["supersedes"] === null) !== (diff === null)) mismatch("diff");
  // The receipt names exactly this record's id, digest, bundle digest and versions; its verification, when carried, is
  // the one result a published record's own receipt can have.
  const receipt = v["receipt"];
  if (!isPlainObject(receipt) || !hasExactKeys(receipt, ["issued", "verification"])) mismatch("receipt");
  else {
    const issued = receipt["issued"];
    const verification = receipt["verification"];
    const evidence = payload["evidence"];
    const versions = payload["versions"];
    if (issued === null) {
      if (verification !== null) mismatch("receipt");
    } else if (
      !isPlainObject(issued) ||
      !hasExactKeys(issued, RECEIPT_FIELDS) ||
      issued["recordId"] !== recordId ||
      issued["digest"] !== digest ||
      issued["wallprintVersion"] !== payload["wallprintVersion"] ||
      issued["canonicalization"] !== payload["canonicalization"] ||
      issued["digestAlgorithm"] !== payload["digestAlgorithm"] ||
      !isPlainObject(evidence) ||
      issued["bundleDigest"] !== evidence["bundleDigest"] ||
      !isPlainObject(issued["versions"]) ||
      !hasExactKeys(issued["versions"], VERSION_KEYS) ||
      !isPlainObject(versions) ||
      !VERSION_KEYS.every((k) => isString((issued["versions"] as Record<string, unknown>)[k]) && (issued["versions"] as Record<string, unknown>)[k] === versions[k])
    ) {
      mismatch("receipt");
    } else if (verification !== null && canonicalForm(verification) !== canonicalForm({ matches: true, reasons: [] })) mismatch("receipt");
  }
  // The replay result is internally consistent the way replay.ts produces it; whether it is the engine's is not decidable here.
  const replay = v["replay"];
  let replayOk = false;
  if (isPlainObject(replay) && hasExactKeys(replay, ["outcome", "reasons", "recomputedDigest", "mismatches"])) {
    const { outcome, reasons, recomputedDigest, mismatches } = replay;
    const shaped = isString(outcome) && (REPLAY_OUTCOMES as readonly string[]).includes(outcome) && stringsIn(reasons, REPLAY_REASONS) && strictlySorted(reasons) && Array.isArray(mismatches) && mismatches.every(isString) && strictlySorted(mismatches);
    if (shaped) {
      const r = reasons;
      const m = mismatches;
      const unreplayable = UNREPLAYABLE_REASONS as readonly string[];
      if (outcome === "REPRODUCED") replayOk = r.length === 0 && m.length === 0 && recomputedDigest === digest;
      else if (outcome === "MISMATCH") replayOk = r.length > 0 && r.every((x) => !unreplayable.includes(x)) && m.length > 0 && isString(recomputedDigest) && HEX64_RE.test(recomputedDigest) && recomputedDigest !== digest;
      else replayOk = r.length > 0 && r.every((x) => unreplayable.includes(x)) && m.length === 0 && recomputedDigest === null;
    }
  }
  if (!replayOk) mismatch("replay");
  return out;
}

/**
 * The immutable public disclosure as the resolver reads it. Reading is in two parts that are never mixed:
 *
 *   1. STRUCTURE: is this text one canonical-form JSON object of exactly the contract's fields, for this record id,
 *      whose canonical preimage is itself in canonical form and names the same record and WallPrint version? Any
 *      failure is a fixed finding and nothing is compared (the resolver tells NOT_COMPARED).
 *   2. INTEGRITY: the SHA-256 of the canonical preimage, computed here, beside the digest the artifact carries. The
 *      comparison itself is the reference codec's (resolveReference), so RESOLVED and DIGEST_MISMATCH mean exactly what
 *      they mean everywhere else in WallPrint.
 *
 * The record the page renders is the parsed canonical preimage plus the artifact's digest: the same bytes the digest
 * was computed over, nothing re-derived. Nothing here validates the record's content against the engine's rules:
 * publication did that, and this page decides no evidence state, lifecycle state, receipt or replay verdict.
 */

export interface PublicArtifact {
  type: string;
  version: string;
  wallprintVersion: string;
  recordId: string;
  digest: string;
  canonical: string;
  title: string;
  construction: unknown;
  registry: unknown;
  validation: unknown;
  digestCheck: unknown;
  receipt: unknown;
  replay: unknown;
  diff: unknown;
  supersedes: unknown;
}

export interface ArtifactReading {
  /** Structural findings; when any is present nothing was compared. */
  findings: Finding[];
  artifact: PublicArtifact | null;
  /** The canonical preimage parsed, with the artifact's digest: the record exactly as its digest covers it. */
  record: Record<string, unknown> | null;
  embeddedDigest: string | null;
  /** SHA-256 of the canonical preimage, computed here; null when the structure failed. */
  computedDigest: string | null;
}

const fail = (code: string, path: string, partial: Partial<ArtifactReading> = {}): ArtifactReading => ({ findings: [{ code, path }], artifact: null, record: null, embeddedDigest: null, computedDigest: null, ...partial });

/** Read an artifact's text for one record id. Never throws; never echoes. */
export async function readArtifact(text: unknown, recordId: string): Promise<ArtifactReading> {
  if (typeof text !== "string") return fail("INVALID_TYPE", "");
  if (text.length > PUBLICATION_MAX_BYTES) return fail("TOO_LARGE", "");
  const v = parsePlainJson(text, PUBLICATION_MAX_BYTES);
  if (v === undefined) return fail("MALFORMED", "");
  if (!isPlainObject(v)) return fail("INVALID_TYPE", "");
  if (v["version"] !== PUBLICATION_VERSION) return fail("UNSUPPORTED_VERSION", "version");
  if (!hasExactKeys(v, DISCLOSURE_FIELDS)) return fail("UNKNOWN_FIELD", "");
  if (v["type"] !== DISCLOSURE_TYPE) return fail("INVALID_ENUM", "type");
  const wallprintVersion = v["wallprintVersion"];
  const id = v["recordId"];
  const digest = v["digest"];
  const canonical = v["canonical"];
  const title = v["title"];
  if (!isString(wallprintVersion) || !isString(id) || !isString(digest) || !isString(canonical) || !isString(title)) return fail("INVALID_TYPE", "");
  if (id !== recordId) return fail("ID_MISMATCH", "recordId");
  if (!HEX64_RE.test(digest)) return fail("INVALID_DIGEST", "digest");
  // One spelling of the artifact: its own canonical form, byte for byte.
  if (canonicalForm(v) !== text) return fail("NOT_CANONICAL", "");
  const payload = parsePlainJson(canonical, PUBLICATION_MAX_BYTES);
  if (!isPlainObject(payload)) return fail("CANONICAL_INVALID", "canonical", { embeddedDigest: digest });
  if (canonicalForm(payload) !== canonical) return fail("NOT_CANONICAL", "canonical", { embeddedDigest: digest });
  if (payload["id"] !== recordId) return fail("ID_MISMATCH", "canonical", { embeddedDigest: digest });
  if (payload["wallprintVersion"] !== wallprintVersion) return fail("VERSION_MISMATCH", "canonical", { embeddedDigest: digest });
  if ("digest" in payload) return fail("NOT_CANONICAL", "canonical", { embeddedDigest: digest });
  const carried = carriedFindings(v, payload, recordId, digest);
  if (carried.length > 0) return { findings: carried, artifact: null, record: null, embeddedDigest: digest, computedDigest: null };
  const artifact: PublicArtifact = {
    type: DISCLOSURE_TYPE,
    version: PUBLICATION_VERSION,
    wallprintVersion,
    recordId: id,
    digest,
    canonical,
    title,
    construction: v["construction"],
    registry: v["registry"],
    validation: v["validation"],
    digestCheck: v["digestCheck"],
    receipt: v["receipt"],
    replay: v["replay"],
    diff: v["diff"],
    supersedes: v["supersedes"],
  };
  const computedDigest = await sha256Hex(canonical);
  return { findings: [], artifact, record: { ...payload, digest }, embeddedDigest: digest, computedDigest };
}
