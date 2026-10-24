import { canonicalize, evidenceDigest } from "./canonical.ts";
import { parseAtomic, parseDecimals, parsePriceScaled18 } from "./quantity.ts";
import {
  ADDRESS_RE,
  CHAIN_ID_RE,
  HASH_RE,
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
  type SourceKind,
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

export const ORIGIN_SOURCE_KINDS: Readonly<Record<Origin, readonly SourceKind[]>> = {
  CHAIN_OBSERVED: ["CHAIN_STATE"],
  AUTHORITY_ATTESTED: ["ISSUER_PUBLICATION"],
  PROVIDER_OBSERVED: ["PROVIDER_ENDPOINT"],
  USER_SUPPLIED: ["USER_INPUT"],
  WALLETWALL_DERIVED: ["WALLETWALL_RULES"],
};

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

const SUBJECT_VALIDATORS: Readonly<Record<string, (v: string) => boolean>> = {
  chainId: (v) => CHAIN_ID_RE.test(v),
  address: (v) => ADDRESS_RE.test(v),
  token: (v) => ADDRESS_RE.test(v),
  holder: (v) => ADDRESS_RE.test(v),
  blockHash: (v) => HASH_RE.test(v),
  blockNumber: (v) => /^(0|[1-9][0-9]{0,17})$/.test(v),
};

export function subjectValid(subject: FlatRecordValue, keys: readonly string[]): boolean {
  for (const k of keys) {
    const v = subject[k];
    if (typeof v !== "string") return false;
    const check = SUBJECT_VALIDATORS[k];
    if (check !== undefined && !check(v)) return false;
  }
  return true;
}

function subjectMatches(obsSubject: FlatRecordValue, assertionSubject: FlatRecordValue, keys: readonly string[]): boolean {
  for (const k of keys) {
    const a = obsSubject[k];
    const b = assertionSubject[k];
    if (typeof a !== "string" || typeof b !== "string") return false;
    const addressLike = k === "address" || k === "token" || k === "holder" || k === "blockHash";
    if (addressLike ? a.toLowerCase() !== b.toLowerCase() : a !== b) return false;
  }
  return true;
}

/** Validates the value shape for a claim type using exact parsers. Never uses floating point. */
export function valueValid(claimType: ClaimType, rec: FlatRecordValue | null): boolean {
  if (rec === null) return false;
  try {
    switch (claimType) {
      case "ASSET_IDENTITY":
        return (
          typeof rec["symbol"] === "string" &&
          typeof rec["issuerAuthorityId"] === "string" &&
          typeof rec["decimals"] === "string" &&
          parseDecimals(rec["decimals"]) >= 0
        );
      case "TOKEN_BALANCE_AT_BLOCK":
        return (
          typeof rec["balanceAtomic"] === "string" &&
          typeof rec["decimals"] === "string" &&
          parseAtomic(rec["balanceAtomic"]) >= 0n &&
          parseDecimals(rec["decimals"]) >= 0
        );
      case "TOKEN_USD_PRICE":
        return typeof rec["priceUsd"] === "string" && parsePriceScaled18(rec["priceUsd"]) >= 0n;
      case "TOKEN_USD_VALUE":
        return (
          typeof rec["usdScaled18"] === "string" &&
          /^(0|[1-9][0-9]{0,139})$/.test(rec["usdScaled18"]) &&
          rec["rounding"] === "FLOOR_SCALED_18"
        );
      case "VAULT_TECHNICAL_READINESS":
        return (
          rec["classification"] === "CRITERIA_MET" ||
          rec["classification"] === "CRITERIA_NOT_MET" ||
          rec["classification"] === "NOT_ESTABLISHED"
        );
    }
  } catch {
    return false;
  }
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
    corroboration: 0,
    observationIds: [],
    assertionIds: [],
  };
}

export function evaluateBundle(bundle: Bundle, evaluatedAt: string): Evaluation {
  const idx = indexBundle(bundle);
  const evalMs = Date.parse(evaluatedAt);
  const violations: Violation[] = [...idx.duplicateIds];

  const supersededBy = new Map<string, string>();
  for (const s of bundle.supersessions ?? []) {
    if (!supersededBy.has(s.supersededAssertionId)) supersededBy.set(s.supersededAssertionId, s.supersedingAssertionId);
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
    const subjectKey = canonicalize(policy ? pick(a.subject, policy.subjectKeys) : a.subject);
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
  const inProgress = new Set<string>();
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
    const policy = getPolicy(a.claimType);
    let core: Core;
    if (inProgress.has(a.id)) {
      core = emptyCore(policy);
      core.limitations.add("DEPENDENCY_CYCLE");
      return finish(a, policy, core, true);
    }
    inProgress.add(a.id);
    if (policy === undefined) {
      core = emptyCore(policy);
      core.limitations.add("POLICY_MISSING");
    } else if (a.derivationId !== undefined) {
      core = evalDerived(a, policy);
    } else {
      core = evalDirect(a, policy);
    }
    inProgress.delete(a.id);
    return finish(a, policy, core, false);
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
      return core;
    }
    if (!valueObs.every((o) => subjectMatches(o.subject, a.subject, policy.subjectKeys))) {
      lim.add("SUBJECT_MISMATCH");
      return core;
    }
    if (!valueObs.every((o) => valueValid(a.claimType, o.payload))) {
      lim.add("INVALID_VALUE");
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
    if (!valueValid(a.claimType, a.value) || !sameCanonical(pick(a.value, policy.valueKeys), pick(first.payload, policy.valueKeys))) {
      lim.add("VALUE_MISMATCH");
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

    if (a.temporality === "PINNED") {
      core.freshness = "PINNED";
    } else {
      let newest = Number.NEGATIVE_INFINITY;
      for (const o of valueObs) newest = Math.max(newest, Date.parse(o.observedAt));
      if (newest > evalMs) {
        core.freshness = "UNKNOWN_FRESHNESS";
        lim.add("OBSERVATION_FROM_FUTURE");
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
    }
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
    for (const id of d.inputAssertionIds) {
      const dep = idx.assertions.get(id);
      if (dep === undefined) {
        lim.add("DANGLING_REFERENCE");
        violations.push({ invariant: "INV-00", code: "DANGLING_REFERENCE", assertionId: a.id });
        continue;
      }
      deps.push(evalAssertion(dep));
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
    if (a.temporality === "PINNED") {
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
    core.support = support;
    return core;
  };

  const results = [...idx.assertions.values()].map(evalAssertion).sort((x, y) => (x.assertionId < y.assertionId ? -1 : 1));

  return {
    evaluatedAt,
    bundleDigest: evidenceDigest(bundle),
    versions: { wwep: bundle.wwepVersion, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION },
    assertions: results,
    violations,
  };
}
