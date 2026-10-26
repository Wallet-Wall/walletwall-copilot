import { canonicalize } from "../canonical.ts";
import { SUPPORT_RANK } from "../evaluate.ts";
import { WallPrintError } from "./errors.ts";
import { validateWallPrintRecord, type AssessmentRecord, type ClaimRecord, type WallPrintRecord } from "./record.ts";
import { DIFF_CATEGORIES, type DiffCategory } from "./vocabulary.ts";

/**
 * Semantic WallPrint diff: what changed between two records, by category, for the future UI's
 * "CORRECTIONS & SUPERSESSIONS" view. Never a text diff.
 *
 * Every change names a category from DIFF_CATEGORIES, a path built from fixed field names plus record ids, and the
 * before / after values as the record carries them: support states, codes, digests, ids, versions and attributed
 * assessment codes. Observation payloads are not part of a record and therefore cannot appear here. A support-state
 * change carries a `reason` of WEAKER or STRONGER by the engine's SUPPORT_RANK; a lifecycle link carries the kind of
 * replacement. Output is sorted by category then path, so equal inputs give equal diffs.
 */

export interface DiffChange {
  category: DiffCategory;
  path: string;
  before: string | null;
  after: string | null;
  reason?: string;
}

export interface WallPrintDiff {
  changed: boolean;
  changes: DiffChange[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const canon = (v: unknown): string | null => (v === null || v === undefined ? null : canonicalize(v));
const joined = (list: readonly string[]): string | null => (list.length === 0 ? null : [...list].join(" "));

class Changes {
  readonly list: DiffChange[] = [];

  add(category: DiffCategory, path: string, before: string | null, after: string | null, reason?: string): void {
    if (before === after) return;
    const change: DiffChange = { category, path, before, after };
    if (reason !== undefined) change.reason = reason;
    this.list.push(change);
  }

  /** Diff two keyed collections: additions, removals, and per-key field changes. */
  keyed<T>(category: DiffCategory, prefix: string, a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>, summary: (t: T) => string | null, fields: (key: string, x: T, y: T) => void): void {
    for (const [k, x] of a) {
      const y = b.get(k);
      if (y === undefined) this.add(category, `${prefix}[${k}]`, summary(x), null);
      else fields(k, x, y);
    }
    for (const [k, y] of b) if (!a.has(k)) this.add(category, `${prefix}[${k}]`, null, summary(y));
  }
}

const byId = <T>(list: readonly T[], key: (t: T) => string): Map<string, T> => new Map(list.map((t) => [key(t), t]));

function claimFields(c: Changes, key: string, x: ClaimRecord, y: ClaimRecord): void {
  const p = `claims[${key}]`;
  const direction = SUPPORT_RANK[y.supportState] < SUPPORT_RANK[x.supportState] ? "WEAKER" : "STRONGER";
  c.add("claims", `${p}.supportState`, x.supportState, y.supportState, direction);
  c.add("claims", `${p}.freshnessState`, x.freshnessState, y.freshnessState);
  c.add("claims", `${p}.finalityState`, x.finalityState, y.finalityState);
  c.add("claims", `${p}.independentCorroboration`, x.independentCorroboration, y.independentCorroboration);
  c.add("claims", `${p}.supersededBy`, x.supersededBy, y.supersededBy);
  c.add("claims", `${p}.policyId`, x.policyId, y.policyId);
  c.add("claims", `${p}.claimType`, x.claimType, y.claimType);
  c.add("claims", `${p}.origin`, x.origin, y.origin);
  c.add("claims", `${p}.temporality`, x.temporality, y.temporality);
  c.add("claims", `${p}.subject`, canon(x.subject), canon(y.subject));
  c.add("claims", `${p}.value`, canon(x.value), canon(y.value));
  c.add("claims", `${p}.limitations`, joined(x.limitations), joined(y.limitations));
  c.add("claims", `${p}.conflictsWith`, joined(x.conflictsWith), joined(y.conflictsWith));
  c.add("claims", `${p}.authority`, canon(x.authority), canon(y.authority));
  c.add("claims", `${p}.dependencies`, canon(x.dependencies), canon(y.dependencies));
  c.add("claims", `${p}.diagnostics`, canon(x.diagnostics), canon(y.diagnostics));
  c.add("claims", `${p}.digest`, x.digest, y.digest);
}

function assessmentFields(c: Changes, key: string, x: AssessmentRecord, y: AssessmentRecord): void {
  const p = `assessments[${key}]`;
  c.add("assessments", `${p}.assessment`, x.assessment, y.assessment);
  c.add("assessments", `${p}.assessorRole`, x.assessorRole, y.assessorRole);
  c.add("assessments", `${p}.policyVersion`, x.policyVersion, y.policyVersion);
  c.add("assessments", `${p}.assessedAt`, x.assessedAt, y.assessedAt);
  c.add("assessments", `${p}.statement`, x.statement, y.statement);
  c.add("assessments", `${p}.evidenceRefs`, joined(x.evidenceRefs), joined(y.evidenceRefs));
  c.add("assessments", `${p}.limitations`, joined(x.limitations), joined(y.limitations));
}

function requireValid(raw: unknown): WallPrintRecord {
  const v = validateWallPrintRecord(raw);
  if (!v.ok) throw new WallPrintError("INVALID_RECORD", v.findings);
  return v.record;
}

export function diffWallPrints(rawA: unknown, rawB: unknown): WallPrintDiff {
  const a = requireValid(rawA);
  const b = requireValid(rawB);
  const c = new Changes();

  // Two committed records with different bytes are different records, whatever else the diff can name.
  c.add("record", "digest", a.digest, b.digest);
  c.add("subject", "id", a.id, b.id);
  c.add("subject", "subject.focalAssertionId", a.subject.focalAssertionId, b.subject.focalAssertionId);
  c.add("subject", "subject.claimType", a.subject.claimType, b.subject.claimType);
  c.add("subject", "subject.temporality", a.subject.temporality, b.subject.temporality);
  c.add("subject", "subject.identity", canon(a.subject.identity), canon(b.subject.identity));
  c.add("snapshot", "snapshotAt", a.snapshotAt, b.snapshotAt);

  c.keyed("claims", "claims", byId(a.claims, (x) => x.assertionId), byId(b.claims, (x) => x.assertionId), (x) => x.digest, (k, x, y) => claimFields(c, k, x, y));

  c.add("evidence", "evidence.bundleDigest", a.evidence.bundleDigest, b.evidence.bundleDigest);
  c.keyed("evidence", "evidence.items", byId(a.evidence.items, (i) => `${i.kind}:${i.id}`), byId(b.evidence.items, (i) => `${i.kind}:${i.id}`), (i) => i.digest, (k, x, y) =>
    c.add("evidence", `evidence.items[${k}]`, x.digest, y.digest),
  );

  const assessmentKey = (x: AssessmentRecord): string => `${x.assessor}|${x.policy}`;
  c.keyed("assessments", "assessments", byId(a.assessments, assessmentKey), byId(b.assessments, assessmentKey), (x) => x.assessment, (k, x, y) => assessmentFields(c, k, x, y));

  c.keyed("limitations", "limitations", byId(a.limitations, (l) => l), byId(b.limitations, (l) => l), (l) => l, () => undefined);

  const conflictKey = (x: WallPrintRecord["conflicts"][number]): string => `${x.cause}:${x.assertionIds.join(",")}`;
  c.keyed("conflicts", "conflicts", byId(a.conflicts, conflictKey), byId(b.conflicts, conflictKey), conflictKey, () => undefined);

  const violationKey = (v: WallPrintRecord["violations"][number]): string => `${v.invariant}:${v.code}:${v.assertionId ?? ""}`;
  c.keyed("violations", "violations", byId(a.violations, violationKey), byId(b.violations, violationKey), violationKey, () => undefined);

  const mapOf = (r: Record<string, string>): Map<string, string> => new Map(Object.entries(r));
  c.keyed("policyVersions", "policyVersions", mapOf(a.policyVersions), mapOf(b.policyVersions), (v) => v, (k, x, y) => c.add("policyVersions", `policyVersions[${k}]`, x, y));
  c.keyed("ruleVersions", "ruleVersions", mapOf(a.ruleVersions), mapOf(b.ruleVersions), (v) => v, (k, x, y) => c.add("ruleVersions", `ruleVersions[${k}]`, x, y));

  for (const field of ["wwep", "registry", "policies", "rules", "registryDigest", "policiesDigest"] as const) {
    c.add("versions", `versions.${field}`, a.versions[field], b.versions[field]);
  }

  c.add("provenance", "provenance.target", a.provenance.target, b.provenance.target);
  const lineageSummary = (l: WallPrintRecord["provenance"]["lineage"][number]): string => `${l.kind}@${l.depth}`;
  c.keyed("provenance", "provenance.lineage", byId(a.provenance.lineage, (l) => l.id), byId(b.provenance.lineage, (l) => l.id), lineageSummary, (k, x, y) =>
    c.add("provenance", `provenance.lineage[${k}]`, lineageSummary(x), lineageSummary(y)),
  );
  c.add("provenance", "provenance.issues", canon(a.provenance.issues), canon(b.provenance.issues));

  const kind = b.supersedes?.kind ?? a.supersedes?.kind;
  c.add("lifecycle", "supersedes", a.supersedes?.id ?? null, b.supersedes?.id ?? null, kind);
  c.add("lifecycle", "supersedes.digest", a.supersedes?.digest ?? null, b.supersedes?.digest ?? null);
  c.add("lifecycle", "supersedes.kind", a.supersedes?.kind ?? null, b.supersedes?.kind ?? null);
  c.add("lifecycle", "supersedes.reason", a.supersedes?.reason ?? null, b.supersedes?.reason ?? null);

  const changes = c.list.sort((x, y) => DIFF_CATEGORIES.indexOf(x.category) - DIFF_CATEGORIES.indexOf(y.category) || ordinal(x.path, y.path));
  return { changed: changes.length > 0, changes };
}
