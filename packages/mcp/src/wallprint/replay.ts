import { canonicalize, evidenceDigest } from "../canonical.ts";
import { POLICIES_VERSION, REGISTRY_VERSION, RULES_VERSION, policiesDigest, registryDigest } from "../registry.ts";
import { WWEP_VERSION, parseBundleStrict, type Bundle } from "../schemas.ts";
import { WallPrintError, finding } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import {
  buildWallPrintSnapshot,
  validateWallPrintRecord,
  type AssessmentRecord,
  type ExternalAssessmentInput,
  type WallPrintPayload,
  type WallPrintRecord,
} from "./record.ts";
import { UNREPLAYABLE_REASONS, type ReplayOutcome, type ReplayReason } from "./vocabulary.ts";

/**
 * WallPrint replay: re-derive a historical record from the evidence it references and the versioned registry,
 * policies and rules it was committed under, and say whether this engine REPRODUCES it, finds a MISMATCH, or
 * cannot replay it at all (UNREPLAYABLE).
 *
 *   UNREPLAYABLE != INCORRECT
 *
 * A replay is UNREPLAYABLE when a required historical input is not available to this engine: the record's WWEP
 * version, policies version or digest, registry version or digest, or rules version differs from this engine's, the
 * referenced evidence bundle is not in the store (or does not digest to its key), the record itself is invalid, or
 * this engine's admission rules refuse to rebuild it. In every one of those cases nothing is recomputed: replay never
 * evaluates historical evidence under present-day policy, never fills in evidence, and says nothing about correctness.
 *
 * The rule versions a bundle's derivations DECLARE are evidence (the engine flags a mismatch with
 * RULES_VERSION_MISMATCH); they do not gate replay. Only the engine's own rules version does, and the policies digest
 * already pins the rules table.
 *
 * Only when every input is the committed one does replay rebuild the snapshot from the stored bundle, the record's
 * own snapshot time, focal assertion, external assessments and supersedes link, and compare canonical bytes. A
 * MISMATCH names every top-level section that differs. External assessments are inputs (attributed statements), so
 * they are never "recomputed"; WalletWall's own assessment is, and may mismatch.
 */

export interface EvidenceStore {
  /** Store one bundle; returns its evidence digest (the key). Idempotent for identical evidence. */
  put: (bundle: unknown) => string;
  get: (digest: string) => Bundle | undefined;
  has: (digest: string) => boolean;
  size: () => number;
}

/** An in-memory evidence store keyed by evidence digest. Holds frozen plain copies; never mutated by replay. */
export function createEvidenceStore(): EvidenceStore {
  const entries = new Map<string, Bundle>();
  return Object.freeze({
    put: (bundle: unknown): string => {
      const parsed = parseBundleStrict(bundle);
      if (!parsed.success) throw new WallPrintError("INVALID_INPUT", [finding("INVALID_BUNDLE", "bundle")]);
      const plain = JSON.parse(JSON.stringify(parsed.data)) as Bundle;
      const digest = evidenceDigest(plain);
      if (!entries.has(digest)) entries.set(digest, deepFreeze(plain));
      return digest;
    },
    get: (digest: string) => entries.get(digest),
    has: (digest: string) => entries.has(digest),
    size: () => entries.size,
  });
}

export interface ReplayResult {
  outcome: ReplayOutcome;
  /** Sorted vocabulary codes. UNREPLAYABLE reasons name unavailable or refused inputs; MISMATCH reasons name differing sections. */
  reasons: ReplayReason[];
  /** The digest this engine recomputed, or null when nothing was recomputed. */
  recomputedDigest: string | null;
  /** Top-level record sections whose canonical bytes differ, sorted. Empty unless the outcome is MISMATCH. */
  mismatches: string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const unreplayable = (reasons: ReplayReason[]): ReplayResult => ({ outcome: "UNREPLAYABLE", reasons: [...new Set(reasons)].sort(ordinal), recomputedDigest: null, mismatches: [] });

function toInput(a: AssessmentRecord): ExternalAssessmentInput {
  return {
    assessor: a.assessor,
    assessorRole: a.assessorRole,
    assessment: a.assessment,
    ...(a.statement === null ? {} : { statement: a.statement }),
    policy: a.policy,
    policyVersion: a.policyVersion,
    assessedAt: a.assessedAt,
    evidenceRefs: [...a.evidenceRefs],
    limitations: [...a.limitations],
  };
}

/** Every top-level payload section, with the reason that names it when it differs. */
const SECTIONS: readonly { key: keyof WallPrintPayload; reason: ReplayReason }[] = [
  { key: "subject", reason: "SUBJECT_MISMATCH" },
  { key: "snapshotAt", reason: "SNAPSHOT_MISMATCH" },
  { key: "evidence", reason: "EVIDENCE_MISMATCH" },
  { key: "claims", reason: "CLAIM_MISMATCH" },
  { key: "assessments", reason: "ASSESSMENT_MISMATCH" },
  { key: "provenance", reason: "PROVENANCE_MISMATCH" },
  { key: "limitations", reason: "LIMITATION_MISMATCH" },
  { key: "conflicts", reason: "CONFLICT_MISMATCH" },
  { key: "violations", reason: "VIOLATION_MISMATCH" },
  { key: "policyVersions", reason: "POLICY_VERSION_MISMATCH" },
  { key: "ruleVersions", reason: "RULE_VERSION_MISMATCH" },
  { key: "versions", reason: "VERSION_MISMATCH" },
];

export function replayWallPrint(raw: unknown, deps: { evidence: EvidenceStore }): ReplayResult {
  const valid = validateWallPrintRecord(raw);
  if (!valid.ok) return unreplayable(["RECORD_INVALID"]);
  const record = valid.record;

  const reasons: ReplayReason[] = [];
  if (record.versions.wwep !== WWEP_VERSION) reasons.push("WWEP_VERSION_MISMATCH");
  if (record.versions.policies !== POLICIES_VERSION || record.versions.policiesDigest !== policiesDigest()) reasons.push("MISSING_POLICY_VERSION");
  if (record.versions.registry !== REGISTRY_VERSION || record.versions.registryDigest !== registryDigest()) reasons.push("MISSING_REGISTRY_VERSION");
  if (record.versions.rules !== RULES_VERSION) reasons.push("MISSING_RULE_VERSION");

  let bundle: Bundle | undefined;
  try {
    bundle = deps.evidence.get(record.evidence.bundleDigest);
    if (bundle === undefined) reasons.push("MISSING_EVIDENCE");
    else if (evidenceDigest(bundle) !== record.evidence.bundleDigest) reasons.push("EVIDENCE_DIGEST_MISMATCH");
  } catch {
    // A store that throws, or returns something that cannot be canonicalized, has not produced the referenced evidence.
    bundle = undefined;
    reasons.push("MISSING_EVIDENCE");
  }
  if (bundle === undefined || reasons.length > 0) return unreplayable(reasons);

  let recomputed: WallPrintRecord;
  try {
    recomputed = buildWallPrintSnapshot({
      id: record.id,
      bundle,
      evaluatedAt: record.snapshotAt,
      focalAssertionId: record.subject.focalAssertionId,
      assessments: record.assessments.filter((a) => a.assessorRole !== "WALLETWALL").map(toInput),
      supersedes: record.supersedes,
      // A historical record is rebuilt under the admission rules it was committed under, never under today's.
      wallprintVersion: record.wallprintVersion,
    });
  } catch {
    // The admission rules of the record's own version refuse to rebuild from the record's own inputs: it cannot be replayed here.
    return unreplayable(["REBUILD_REFUSED"]);
  }
  if (recomputed.digest === record.digest) return { outcome: "REPRODUCED", reasons: [], recomputedDigest: recomputed.digest, mismatches: [] };

  const mismatchReasons: ReplayReason[] = ["DIGEST_MISMATCH"];
  const mismatches: string[] = [];
  for (const s of SECTIONS) {
    if (canonicalize(record[s.key]) !== canonicalize(recomputed[s.key])) {
      mismatchReasons.push(s.reason);
      mismatches.push(s.key);
    }
  }
  return { outcome: "MISMATCH", reasons: mismatchReasons.sort(ordinal), recomputedDigest: recomputed.digest, mismatches: mismatches.sort(ordinal) };
}

/** True when a reason says "could not run" rather than "differs". */
export function isUnreplayableReason(reason: ReplayReason): boolean {
  return UNREPLAYABLE_REASONS.includes(reason);
}
