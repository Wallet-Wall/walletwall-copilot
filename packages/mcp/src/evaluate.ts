import { canonicalize, evidenceDigest } from "./canonical.ts";
import {
  ORIGIN_SOURCE_KINDS,
  SUBJECT_KEY_RULES,
  VALUE_KEY_RULES,
  diagnoseRecord,
  subjectValid,
  valueValid,
  type AssertionDiagnostic,
} from "./claims.ts";
import { dependencySubjectMismatches, subjectIdentityKey, subjectKeyEqual, subjectMatches } from "./subject.ts";
import {
  type Assertion,
  type Bundle,
  type ClaimType,
  type FinalityState,
  type FlatRecordValue,
  type FreshnessState,
  type LimitationCode,
  type Observation,
  type Origin,
  type Source,
  type SupportState,
} from "./schemas.ts";
import {
  POLICIES_VERSION,
  REGISTRY_VERSION,
  RULES_VERSION,
  findAsset,
  findChain,
  getPolicy,
  ruleKnown,
  type Policy,
} from "./registry.ts";

/** Strongest to weakest. Combination of dependencies always takes the weakest member. */
export const SUPPORT_RANK: Readonly<Record<SupportState, number>> = {
  ESTABLISHED: 7,
  SUPPORTED: 6,
  PARTIAL: 5,
  STALE: 4,
  SUPERSEDED: 3,
  UNKNOWN: 2,
  CONFLICTING: 1,
  NOT_ESTABLISHED: 0,
};

export function weakest(states: readonly SupportState[]): SupportState {
  let out: SupportState | undefined;
  for (const s of states) if (out === undefined || SUPPORT_RANK[s] < SUPPORT_RANK[out]) out = s;
  return out ?? "NOT_ESTABLISHED";
}

/** The shape rules and origin-to-source-kind table live in claims.ts, where the published contract is generated from them. */
export { ORIGIN_SOURCE_KINDS, subjectValid, valueValid } from "./claims.ts";
export type { AssertionDiagnostic } from "./claims.ts";

export type InvariantId =
  | "INV-00"
  | "INV-01"
  | "INV-02"
  | "INV-03"
  | "INV-04"
  | "INV-05"
  | "INV-06"
  | "INV-07"
  | "INV-08"
  | "INV-09"
  | "INV-10"
  | "INV-11"
  | "INV-12"
  | "INV-13";

export interface Violation {
  invariant: InvariantId;
  code: string;
  assertionId: string | null;
}

export interface AssertionEvaluation {
  assertionId: string;
  claimType: ClaimType;
  origin: Origin;
  temporality: "CURRENT" | "PINNED";
  supportState: SupportState;
  freshnessState: FreshnessState;
  /** null means finality is not applicable to this claim type. */
  finalityState: FinalityState | null;
  authority: { authorityId: string; kind: string; scope: ClaimType; satisfied: boolean } | null;
  limitations: LimitationCode[];
  /** Structural explanations for INVALID_SUBJECT, SUBJECT_MISMATCH, INVALID_VALUE and VALUE_MISMATCH; empty otherwise. */
  diagnostics: AssertionDiagnostic[];
  /** Distinct independence groups after duplicate collapse. null for derived assertions. */
  independentCorroboration: number | null;
  conflictsWith: string[];
  supersededBy: string | null;
  dependencies: { observationIds: string[]; assertionIds: string[] };
  policyId: string | null;
  digest: string;
}

export interface Evaluation {
  evaluatedAt: string;
  bundleDigest: string;
  versions: { wwep: string; registry: string; policies: string; rules: string };
  assertions: AssertionEvaluation[];
  violations: Violation[];
}

export interface BundleIndex {
  sources: Map<string, Source>;
  observations: Map<string, Observation>;
  assertions: Map<string, Assertion>;
  derivations: Map<string, Bundle["derivations"][number]>;
  duplicateIds: Violation[];
}

/** What evaluating evidence reads. An id used by more than one record of its kind is absent from that kind's table: it names no record. */
export interface EvidenceIndex extends BundleIndex {
  /** The records behind each reused assertion id. */
  ambiguousAssertions: Map<string, Assertion[]>;
  /** The DUPLICATE_*_ID of a reused id, in a fixed order of kinds, or null when no id is reused. A code stops every evaluation of the bundle. */
  reusedIdCode: string | null;
}

const FINALITY_ORDER: readonly FinalityState[] = ["UNFINALIZED", "UNKNOWN_FINALITY", "FINALIZED"];

export function weakestFinality(states: readonly FinalityState[]): FinalityState {
  for (const s of FINALITY_ORDER) if (states.includes(s)) return s;
  return "UNKNOWN_FINALITY";
}

function indexBy<T extends { id: string }>(items: readonly T[], dups: Violation[], kind: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) {
    if (m.has(it.id)) {
      dups.push({
        invariant: kind === "ASSERTION" ? "INV-12" : "INV-00",
        code: `DUPLICATE_${kind}_ID`,
        assertionId: kind === "ASSERTION" ? it.id : null,
      });
    } else {
      m.set(it.id, it);
    }
  }
  return m;
}

/**
 * Records by id, keeping the first record of a reused id. WallPrint's versioned admission rules read this, so how the engine
 * evaluates evidence cannot move them. Nothing that evaluates evidence may use it: see indexEvidence.
 */
export function indexBundle(bundle: Bundle): BundleIndex {
  const duplicateIds: Violation[] = [];
  return {
    sources: indexBy(bundle.sources, duplicateIds, "SOURCE"),
    observations: indexBy(bundle.observations, duplicateIds, "OBSERVATION"),
    assertions: indexBy(bundle.assertions, duplicateIds, "ASSERTION"),
    derivations: indexBy(bundle.derivations, duplicateIds, "DERIVATION"),
    duplicateIds,
  };
}

/** Takes every id that more than one record uses out of its table, and returns those records by id. */
function takeReused<T extends { id: string }>(table: Map<string, T>, records: readonly T[]): Map<string, T[]> {
  const byId = new Map<string, T[]>();
  for (const r of records) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  const reused = new Map([...byId].filter(([, sharing]) => sharing.length > 1));
  for (const id of reused.keys()) table.delete(id);
  return reused;
}

/**
 * The index for evaluating evidence. A reused id does not say which record it means, and choosing the first or the last record
 * would only pick which reading wins, so it is taken out of its table. Looking it up finds nothing, for evaluation, invariants,
 * readiness and provenance alike, whichever kind of record it is. check_invariants also reads every record for what the record
 * itself presents: that picks no record, and is the same in any order.
 */
export function indexEvidence(bundle: Bundle): EvidenceIndex {
  const index = indexBundle(bundle);
  const ambiguousAssertions = takeReused(index.assertions, bundle.assertions);
  const reusedSources = takeReused(index.sources, bundle.sources);
  const reusedObservations = takeReused(index.observations, bundle.observations);
  const reusedDerivations = takeReused(index.derivations, bundle.derivations);
  const reused: readonly [number, string][] = [
    [ambiguousAssertions.size, "DUPLICATE_ASSERTION_ID"],
    [reusedSources.size, "DUPLICATE_SOURCE_ID"],
    [reusedObservations.size, "DUPLICATE_OBSERVATION_ID"],
    [reusedDerivations.size, "DUPLICATE_DERIVATION_ID"],
  ];
  return { ...index, ambiguousAssertions, reusedIdCode: reused.find(([size]) => size > 0)?.[1] ?? null };
}

export function pick(rec: FlatRecordValue | null, keys: readonly string[]): Record<string, string | boolean | null> | null {
  if (rec === null) return null;
  const out: Record<string, string | boolean | null> = {};
  for (const k of keys) {
    const v = rec[k];
    if (v === undefined) return null;
    out[k] = v;
  }
  return out;
}

function sameCanonical(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

/** Explains a SUBJECT_MISMATCH for one observation: which subject keys are absent, malformed or different. */
function subjectMismatchDiagnostic(o: Observation, a: Assertion, keys: readonly string[]): AssertionDiagnostic {
  const mismatchedKeys: string[] = [];
  for (const k of keys) {
    const ov = o.subject[k];
    const av = a.subject[k];
    if (typeof ov === "string" && typeof av === "string" && !subjectKeyEqual(k, ov, av)) mismatchedKeys.push(k);
  }
  return {
    limitation: "SUBJECT_MISMATCH",
    record: "OBSERVATION_SUBJECT",
    observationId: o.id,
    ...diagnoseRecord(o.subject, SUBJECT_KEY_RULES, keys),
    mismatchedKeys,
  };
}

function independenceGroup(s: Source): string {
  return s.independenceGroup ?? "unspecified";
}

interface Core {
  support: SupportState;
  freshness: FreshnessState;
  finality: FinalityState | null;
  authoritySatisfied: boolean;
  limitations: Set<LimitationCode>;
  diagnostics: AssertionDiagnostic[];
  corroboration: number | null;
  observationIds: string[];
  assertionIds: string[];
}

function emptyCore(policy: Policy | undefined): Core {
  return {
    support: "NOT_ESTABLISHED",
    freshness: "UNKNOWN_FRESHNESS",
    finality: policy?.finalityApplies === true ? "UNKNOWN_FINALITY" : null,
    authoritySatisfied: false,
    limitations: new Set(),
    diagnostics: [],
    corroboration: 0,
    observationIds: [],
    assertionIds: [],
  };
}

/**
 * What each assertion depends on, directly or through others, over the inputs evaluation reads: those of a derivation that names
 * it as the output, for a claim type that may be derived. It is worked out from the records, so what lies on a cycle does not
 * follow where evaluation enters it, and an assertion that depends on itself is on a cycle.
 */
function dependencyClosure(idx: EvidenceIndex): Map<string, Set<string>> {
  const inputsOf = (a: Assertion | undefined): readonly string[] => {
    const d = a?.derivationId === undefined ? undefined : idx.derivations.get(a.derivationId);
    return a !== undefined && d?.outputAssertionId === a.id && getPolicy(a.claimType)?.derived === true ? d.inputAssertionIds.filter((id) => idx.assertions.has(id)) : [];
  };
  const closure = new Map<string, Set<string>>();
  for (const a of idx.assertions.values()) {
    const seen = new Set<string>();
    const pending = [...inputsOf(a)];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...inputsOf(idx.assertions.get(id)));
    }
    closure.set(a.id, seen);
  }
  return closure;
}

export function evaluateBundle(bundle: Bundle, evaluatedAt: string): Evaluation {
  const idx = indexEvidence(bundle);
  const evalMs = Date.parse(evaluatedAt);
  const violations: Violation[] = [...idx.duplicateIds];

  // An assertion superseded more than once names another assertion over itself, and itself over an id that resolves to nothing, then
  // the smallest id: no record is first or last, and how an id that resolves to nothing is spelled decides nothing.
  const supersededBy = new Map<string, string>();
  const rank = (superseded: string, by: string): number => (by === superseded ? 1 : idx.assertions.has(by) ? 0 : 2);
  for (const { supersededAssertionId: superseded, supersedingAssertionId: by } of bundle.supersessions ?? []) {
    const named = supersededBy.get(superseded);
    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && by < named)) supersededBy.set(superseded, by);
  }

  const conflictsWith = new Map<string, Set<string>>();
  const conflictCause = new Map<string, LimitationCode>();
  const link = (ids: readonly string[], cause: LimitationCode): void => {
    for (const id of ids) {
      if (!idx.assertions.has(id)) continue;
      const set = conflictsWith.get(id) ?? new Set<string>();
      for (const other of ids) if (other !== id && idx.assertions.has(other)) set.add(other);
      if (set.size > 0) {
        conflictsWith.set(id, set);
        if (!conflictCause.has(id)) conflictCause.set(id, cause);
      }
    }
  };
  for (const c of bundle.conflicts ?? []) link(c.assertionIds, "CONFLICT_DECLARED");
  const groups = new Map<string, Assertion[]>();
  for (const a of idx.assertions.values()) {
    if (supersededBy.has(a.id)) continue;
    const policy = getPolicy(a.claimType);
    const subjectKey = policy ? subjectIdentityKey(a.subject, policy.subjectKeys) : canonicalize(a.subject);
    const key = `${a.claimType}|${a.temporality}|${subjectKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(a);
    groups.set(key, arr);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const policy = getPolicy(members[0]?.claimType ?? "ASSET_IDENTITY");
    const values = new Set(members.map((m) => canonicalize(policy ? pick(m.value, policy.valueKeys) : m.value)));
    if (values.size > 1) link(members.map((m) => m.id), "CONFLICT_DETECTED");
  }

  const memo = new Map<string, AssertionEvaluation>();
  const dependsOn = dependencyClosure(idx);
  const onCycle = (id: string): boolean => dependsOn.get(id)?.has(id) === true;
  const onSameCycle = (a: string, b: string): boolean => dependsOn.get(a)?.has(b) === true && dependsOn.get(b)?.has(a) === true;
  const bundleLimitations: LimitationCode[] = [];
  if (bundle.registryVersion !== undefined && bundle.registryVersion !== REGISTRY_VERSION) {
    bundleLimitations.push("REGISTRY_VERSION_MISMATCH");
  }
  if (bundle.rulesVersion !== undefined && bundle.rulesVersion !== RULES_VERSION) {
    bundleLimitations.push("RULES_VERSION_MISMATCH");
  }

  const evalAssertion = (a: Assertion): AssertionEvaluation => {
    const cached = memo.get(a.id);
    if (cached) return cached;
    if (onCycle(a.id)) return evalCycle(a);
    const policy = getPolicy(a.claimType);
    let core: Core;
    if (policy === undefined) {
      core = emptyCore(policy);
      core.limitations.add("POLICY_MISSING");
    } else if (a.derivationId !== undefined) {
      core = evalDerived(a, policy);
    } else {
      core = evalDirect(a, policy);
    }
    return finish(a, policy, core, false);
  };

  /**
   * A dependency cycle is evaluated together, so no assertion on it is read in full by another on it. Each reads the others on the
   * cycle as readOnCycle gives them, which is the same from every side, and each depends on all the others, so all of them retain
   * what any of them reports (INV-10), and a PINNED one that retains a reading from the future reports as if it had read it itself.
   */
  const evalCycle = (entry: Assertion): AssertionEvaluation => {
    const members = [...idx.assertions.values()]
      .filter((m) => onSameCycle(entry.id, m.id))
      .map((m) => {
        const policy = getPolicy(m.claimType) as Policy;
        return { m, policy, core: evalDerived(m, policy) };
      });
    const retained = new Set(members.flatMap(({ core }) => [...core.limitations]));
    for (const { m, policy, core } of members) {
      const freshness = core.freshness === "PINNED" && retained.has("OBSERVATION_FROM_FUTURE") ? "UNKNOWN_FRESHNESS" : core.freshness;
      finish(m, policy, { ...core, freshness, limitations: retained }, false);
    }
    return memo.get(entry.id) as AssertionEvaluation;
  };

  /** An input with no basis. What a PINNED one is about comes from its record, not from its evidence. */
  const readOnCycle = (a: Assertion): AssertionEvaluation => {
    const policy = getPolicy(a.claimType);
    const core = emptyCore(policy);
    core.limitations.add("DEPENDENCY_CYCLE");
    if (a.temporality === "PINNED") core.freshness = "PINNED";
    return finish(a, policy, core, true);
  };

  const finish = (a: Assertion, policy: Policy | undefined, core: Core, transient: boolean): AssertionEvaluation => {
    let support = core.support;
    const limitations = new Set(core.limitations);
    for (const l of bundleLimitations) limitations.add(l);
    const sup = supersededBy.get(a.id) ?? null;
    const conflicts = [...(conflictsWith.get(a.id) ?? [])].sort();
    if (sup !== null) {
      support = "SUPERSEDED";
      limitations.add("SUPERSEDED");
    } else if (conflicts.length > 0) {
      support = "CONFLICTING";
      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");
    }
    if (idx.reusedIdCode !== null) support = "NOT_ESTABLISHED";
    const result: AssertionEvaluation = {
      assertionId: a.id,
      claimType: a.claimType,
      origin: a.origin,
      temporality: a.temporality,
      supportState: support,
      freshnessState: core.freshness,
      finalityState: core.finality,
      authority: policy
        ? {
            authorityId: policy.authority.authorityId,
            kind: policy.authority.kind,
            scope: a.claimType,
            satisfied: core.authoritySatisfied,
          }
        : null,
      limitations: [...limitations].sort(),
      diagnostics: core.diagnostics,
      independentCorroboration: core.corroboration,
      conflictsWith: conflicts,
      supersededBy: sup,
      dependencies: { observationIds: core.observationIds, assertionIds: core.assertionIds },
      policyId: policy?.policyId ?? null,
      digest: evidenceDigest(a),
    };
    if (!transient) memo.set(a.id, result);
    return result;
  };

  const evalDirect = (a: Assertion, policy: Policy): Core => {
    const core = emptyCore(policy);
    const lim = core.limitations;
    const obs: Observation[] = [];
    for (const id of a.observationIds) {
      const o = idx.observations.get(id);
      if (o) {
        obs.push(o);
      } else {
        lim.add("DANGLING_REFERENCE");
        violations.push({ invariant: "INV-00", code: "DANGLING_REFERENCE", assertionId: a.id });
      }
    }
    core.observationIds = obs.map((o) => o.id);
    if (obs.length === 0) {
      lim.add("NO_SOURCE");
      return core;
    }
    if (obs.some((o) => o.origin === "CHAIN_OBSERVED")) lim.add("TRANSPORT_FIDELITY_NOT_VERIFIED");

    const valueObs = obs.filter((o) => o.result === "VALUE");
    if (valueObs.length < obs.length) lim.add("NO_RESULT");
    if (valueObs.length === 0) {
      core.support = "UNKNOWN";
      return core;
    }

    if (!subjectValid(a.subject, policy.subjectKeys)) {
      lim.add("INVALID_SUBJECT");
      core.diagnostics.push({
        limitation: "INVALID_SUBJECT",
        record: "ASSERTION_SUBJECT",
        observationId: null,
        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),
        mismatchedKeys: [],
      });
      return core;
    }
    // One diagnostic per distinct observation: observationIds may repeat an id, dependencies keep the repetition, diagnostics do not.
    const diagnosed = new Set<string>();
    const subjectMismatches = valueObs.filter((o) => !subjectMatches(o.subject, a.subject, policy.subjectKeys));
    if (subjectMismatches.length > 0) {
      lim.add("SUBJECT_MISMATCH");
      for (const o of subjectMismatches) {
        if (diagnosed.has(o.id)) continue;
        diagnosed.add(o.id);
        core.diagnostics.push(subjectMismatchDiagnostic(o, a, policy.subjectKeys));
      }
      return core;
    }
    const invalidPayloads = valueObs.filter((o) => !valueValid(a.claimType, o.payload));
    if (invalidPayloads.length > 0) {
      lim.add("INVALID_VALUE");
      for (const o of invalidPayloads) {
        if (diagnosed.has(o.id)) continue;
        diagnosed.add(o.id);
        core.diagnostics.push({
          limitation: "INVALID_VALUE",
          record: "OBSERVATION_PAYLOAD",
          observationId: o.id,
          ...diagnoseRecord(o.payload, VALUE_KEY_RULES[a.claimType], policy.valueKeys),
          mismatchedKeys: [],
        });
      }
      return core;
    }
    const contents = new Set(valueObs.map((o) => canonicalize(pick(o.payload, policy.valueKeys))));
    if (contents.size > 1) {
      lim.add("OBSERVATION_DISAGREEMENT");
      core.support = "CONFLICTING";
      core.finality = policy.finalityApplies ? weakestFinality(valueObs.map((o) => o.finality)) : null;
      return core;
    }
    const first = valueObs[0];
    if (first === undefined) return core;
    if (!valueValid(a.claimType, a.value)) {
      lim.add("VALUE_MISMATCH");
      core.diagnostics.push({
        limitation: "VALUE_MISMATCH",
        record: "ASSERTION_VALUE",
        observationId: null,
        ...diagnoseRecord(a.value, VALUE_KEY_RULES[a.claimType], policy.valueKeys),
        mismatchedKeys: [],
      });
      return core;
    }
    if (!sameCanonical(pick(a.value, policy.valueKeys), pick(first.payload, policy.valueKeys))) {
      lim.add("VALUE_MISMATCH");
      core.diagnostics.push({
        limitation: "VALUE_MISMATCH",
        record: "ASSERTION_VALUE",
        observationId: first.id,
        ...diagnoseRecord(a.value, VALUE_KEY_RULES[a.claimType], policy.valueKeys),
        mismatchedKeys: policy.valueKeys.filter((k) => canonicalize(a.value?.[k] ?? null) !== canonicalize(first.payload[k] ?? null)),
      });
      return core;
    }

    const chainKnown = typeof a.subject["chainId"] === "string" && findChain(a.subject["chainId"]) !== undefined;
    let cap: SupportState = "ESTABLISHED";
    if (a.claimType === "ASSET_IDENTITY" || a.claimType === "TOKEN_BALANCE_AT_BLOCK") {
      if (!chainKnown) {
        lim.add("CHAIN_NOT_IN_REGISTRY");
        cap = "PARTIAL";
      }
    }
    const regAddress = a.claimType === "ASSET_IDENTITY" ? a.subject["address"] : a.subject["token"];
    const entry =
      typeof a.subject["chainId"] === "string" && typeof regAddress === "string"
        ? findAsset(a.subject["chainId"], regAddress)
        : undefined;
    if (a.claimType === "ASSET_IDENTITY" || a.claimType === "TOKEN_BALANCE_AT_BLOCK" || a.claimType === "TOKEN_USD_PRICE") {
      if (entry === undefined) {
        lim.add("NOT_IN_REGISTRY");
        if (a.claimType === "ASSET_IDENTITY") cap = "PARTIAL";
      } else {
        lim.add("REGISTRY_VERIFIED_POINT_IN_TIME");
        const decimalsMismatch =
          a.value !== null && typeof a.value["decimals"] === "string" && a.value["decimals"] !== entry.decimals;
        const identityMismatch =
          a.claimType === "ASSET_IDENTITY" &&
          a.value !== null &&
          (a.value["symbol"] !== entry.symbol || a.value["issuerAuthorityId"] !== entry.authorityId);
        if (decimalsMismatch || identityMismatch) {
          lim.add("REGISTRY_MISMATCH");
          return core;
        }
      }
    }

    const qualified: Observation[] = [];
    const corroborating: Observation[] = [];
    for (const o of valueObs) {
      const isAuth = policy.authoritativeOrigins.includes(o.origin);
      const isCorro = policy.corroboratingOrigins.includes(o.origin);
      if (!isAuth && !isCorro) continue;
      const s = idx.sources.get(o.sourceId);
      if (s === undefined) {
        lim.add("DANGLING_REFERENCE");
        continue;
      }
      if (!ORIGIN_SOURCE_KINDS[o.origin].includes(s.kind)) {
        lim.add("ORIGIN_SOURCE_KIND_MISMATCH");
        continue;
      }
      if (isAuth) {
        if (policy.authorityIdSource === "REGISTRY" && (entry === undefined || s.authorityId !== entry.authorityId)) {
          lim.add("AUTHORITY_ID_MISMATCH");
          continue;
        }
        qualified.push(o);
      } else {
        corroborating.push(o);
      }
    }

    const finalityBasis = qualified.length > 0 ? qualified : valueObs;
    const finality: FinalityState | null = policy.finalityApplies ? weakestFinality(finalityBasis.map((o) => o.finality)) : null;
    core.finality = finality;

    const distinct = new Set<string>();
    let raw = 0;
    const counted = [...qualified, ...corroborating];
    for (const o of counted) {
      raw++;
      const s = idx.sources.get(o.sourceId);
      if (s) distinct.add(`${independenceGroup(s)}|${evidenceDigest(pick(o.payload, policy.valueKeys))}`);
    }
    if (distinct.size < raw) lim.add("DUPLICATE_EVIDENCE_COLLAPSED");
    const groupSet = new Set<string>();
    for (const o of counted) {
      const s = idx.sources.get(o.sourceId);
      if (s) groupSet.add(independenceGroup(s));
    }
    core.corroboration = groupSet.size;

    let support: SupportState;
    if (qualified.length > 0) {
      core.authoritySatisfied = true;
      if (policy.requiresFinality && finality !== "FINALIZED") {
        support = "SUPPORTED";
        lim.add(finality === "UNKNOWN_FINALITY" ? "FINALITY_UNKNOWN" : "NOT_FINALIZED");
      } else {
        support = "ESTABLISHED";
      }
    } else if (corroborating.length > 0) {
      lim.add("NO_AUTHORITATIVE_OBSERVATION");
      if (groupSet.size >= policy.minIndependentCorroboration) {
        support = weakest(["SUPPORTED", policy.maxSupportWithoutAuthority]);
      } else {
        support = "PARTIAL";
        lim.add("INSUFFICIENT_INDEPENDENT_CORROBORATION");
      }
      if (policy.requiresFinality && finality !== "FINALIZED") {
        support = weakest([support, "PARTIAL"]);
        lim.add(finality === "UNKNOWN_FINALITY" ? "FINALITY_UNKNOWN" : "NOT_FINALIZED");
      }
    } else {
      support = "PARTIAL";
      lim.add("NON_AUTHORITATIVE_ONLY");
    }
    if (
      a.claimType === "ASSET_IDENTITY" &&
      qualified.length === 0 &&
      valueObs.some((o) => o.origin === "CHAIN_OBSERVED" || o.origin === "PROVIDER_OBSERVED")
    ) {
      lim.add("SYMBOL_NOT_AUTHORITY");
    }
    if (a.claimType === "TOKEN_USD_PRICE") lim.add("PRICE_IS_PROVIDER_OBSERVATION");
    support = weakest([support, cap]);

    // The future is checked before temporality: PINNED means a historical point, not a reading from after evaluatedAt.
    let newest = Number.NEGATIVE_INFINITY;
    for (const o of valueObs) newest = Math.max(newest, Date.parse(o.observedAt));
    if (newest > evalMs) {
      core.freshness = "UNKNOWN_FRESHNESS";
      lim.add("OBSERVATION_FROM_FUTURE");
    } else if (a.temporality === "PINNED") {
      core.freshness = "PINNED";
    } else if (policy.maxAgeSeconds === null) {
      core.freshness = "UNKNOWN_FRESHNESS";
      lim.add("FRESHNESS_UNKNOWN");
    } else if ((evalMs - newest) / 1000 > policy.maxAgeSeconds) {
      core.freshness = "STALE";
      lim.add("STALE_EVIDENCE");
    } else {
      core.freshness = "CURRENT";
    }
    if (core.freshness === "STALE") support = weakest([support, "STALE"]);
    if (core.freshness === "UNKNOWN_FRESHNESS") support = weakest([support, "PARTIAL"]);
    core.support = support;
    return core;
  };

  const evalDerived = (a: Assertion, policy: Policy): Core => {
    const core = emptyCore(policy);
    const lim = core.limitations;
    core.corroboration = null;
    const d = a.derivationId === undefined ? undefined : idx.derivations.get(a.derivationId);
    if (d === undefined || d.outputAssertionId !== a.id) {
      lim.add("DERIVATION_MISSING");
      return core;
    }
    if (!policy.derived) {
      lim.add("DERIVATION_NOT_PERMITTED");
      return core;
    }
    const deps: AssertionEvaluation[] = [];
    const mismatchedKeys = new Set<string>();
    for (const id of d.inputAssertionIds) {
      const dep = idx.assertions.get(id);
      if (dep === undefined) {
        lim.add("DANGLING_REFERENCE");
        violations.push({ invariant: "INV-00", code: "DANGLING_REFERENCE", assertionId: a.id });
        continue;
      }
      for (const k of dependencySubjectMismatches(a.subject, policy.subjectKeys, dep.subject, getPolicy(dep.claimType)?.subjectKeys ?? [])) mismatchedKeys.add(k);
      deps.push(onSameCycle(a.id, id) ? readOnCycle(dep) : evalAssertion(dep));
    }
    core.assertionIds = deps.map((x) => x.assertionId);
    lim.add("WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY");
    for (const dep of deps) for (const l of dep.limitations) lim.add(l);
    if (deps.length === 0 || d.inputAssertionIds.length !== deps.length) {
      lim.add("NO_SOURCE");
      return core;
    }
    for (const required of policy.requiredDependencyClaimTypes) {
      if (!deps.some((x) => x.claimType === required)) {
        lim.add("MISSING_REQUIRED_DEPENDENCY");
        return core;
      }
    }
    // A derived claim is about what its inputs are about. Support from inputs about another subject is no support.
    if (!subjectValid(a.subject, policy.subjectKeys)) {
      lim.add("INVALID_SUBJECT");
      core.diagnostics.push({
        limitation: "INVALID_SUBJECT",
        record: "ASSERTION_SUBJECT",
        observationId: null,
        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),
        mismatchedKeys: [],
      });
      violations.push({ invariant: "INV-00", code: "INVALID_SUBJECT", assertionId: a.id });
      return core;
    }
    if (mismatchedKeys.size > 0) {
      lim.add("SUBJECT_MISMATCH");
      core.diagnostics.push({
        limitation: "SUBJECT_MISMATCH",
        record: "ASSERTION_SUBJECT",
        observationId: null,
        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),
        mismatchedKeys: policy.subjectKeys.filter((k) => mismatchedKeys.has(k)),
      });
      violations.push({ invariant: "INV-00", code: "SUBJECT_MISMATCH", assertionId: a.id });
      return core;
    }
    const supports: SupportState[] = [];
    let anyStale = false;
    for (const dep of deps) {
      if (dep.supportState === "SUPERSEDED") {
        supports.push("STALE");
        anyStale = true;
        lim.add("DEPENDENCY_SUPERSEDED");
      } else {
        supports.push(dep.supportState);
      }
    }
    let support = weakest(supports);
    if (!(policy.ruleId === d.ruleId && ruleKnown(d.ruleId, d.rulesVersion))) {
      lim.add(policy.ruleId === d.ruleId ? "RULES_VERSION_MISMATCH" : "RULES_UNKNOWN");
      support = weakest([support, "PARTIAL"]);
    }

    const finalities = deps.map((x) => x.finalityState).filter((x): x is FinalityState => x !== null);
    core.finality = finalities.length > 0 ? weakestFinality(finalities) : null;
    core.authoritySatisfied = true;

    const depFresh = deps.map((x) => x.freshnessState);
    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {
      core.freshness = "UNKNOWN_FRESHNESS";
      support = weakest([support, "PARTIAL"]);
    } else if (a.temporality === "PINNED") {
      core.freshness = "PINNED";
    } else if (anyStale || depFresh.includes("STALE")) {
      core.freshness = "STALE";
      lim.add("STALE_EVIDENCE");
    } else if (depFresh.includes("UNKNOWN_FRESHNESS")) {
      core.freshness = "UNKNOWN_FRESHNESS";
    } else if (depFresh.includes("PINNED")) {
      core.freshness = "UNKNOWN_FRESHNESS";
      lim.add("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM");
      support = weakest([support, "PARTIAL"]);
    } else {
      core.freshness = "CURRENT";
    }
    if (core.freshness === "STALE") support = weakest([support, "STALE"]);
    // A cycle has no basis, whatever its inputs read: it is the weakest thing here, and lifecycle overrides it as it overrides any state.
    core.support = onCycle(a.id) ? "NOT_ESTABLISHED" : support;
    return core;
  };

  /** A reused id is reported once and described only by what does not depend on record order. No record supplies its support. */
  const evalAmbiguous = (records: readonly Assertion[]): AssertionEvaluation => {
    const ordered = [...records].sort((x, y) => {
      const [cx, cy] = [canonicalize(x), canonicalize(y)];
      return cx < cy ? -1 : cx > cy ? 1 : 0;
    });
    const label = ordered[0] as Assertion;
    const policy = getPolicy(label.claimType);
    const core = emptyCore(policy);
    core.limitations.add("NO_SOURCE");
    return { ...finish(label, policy, core, true), digest: evidenceDigest(ordered) };
  };

  const results = [...[...idx.assertions.values()].map(evalAssertion), ...[...idx.ambiguousAssertions.values()].map(evalAmbiguous)].sort((x, y) => (x.assertionId < y.assertionId ? -1 : 1));

  return {
    evaluatedAt,
    bundleDigest: evidenceDigest(bundle),
    versions: { wwep: bundle.wwepVersion, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION },
    assertions: results,
    violations,
  };
}
