import { parseAtomic, parseDecimals, parsePriceScaled18, usdValueScaled18 } from "./quantity.ts";
import { getPolicy } from "./registry.ts";
import { assessReadiness, READINESS_RULE_ID } from "./readiness.ts";
import type { Assertion, Bundle } from "./schemas.ts";
import { subjectKeyEqual } from "./subject.ts";
import {
  ORIGIN_SOURCE_KINDS,
  SUPPORT_RANK,
  evaluateBundle,
  indexEvidence,
  supersessionFaults,
  type AssertionEvaluation,
  type EvidenceIndex,
  type Evaluation,
  type Violation,
} from "./evaluate.ts";

export const INVARIANT_TEXT: Readonly<Record<string, string>> = {
  "INV-00": "Declared states MUST NOT exceed states computed by the published rules.",
  "INV-01": "NO_SOURCE -> NO_FACT.",
  "INV-02": "STALE MUST NOT satisfy CURRENT.",
  "INV-03": "CONFLICTING MUST NOT satisfy ESTABLISHED.",
  "INV-04": "NO_RESULT MUST NOT become ZERO.",
  "INV-05": "UNKNOWN MUST NOT become FALSE.",
  "INV-06": "WALLETWALL_DERIVED MUST NOT masquerade as upstream authority.",
  "INV-07": "Processing evidence MUST NOT increase the authority of its inputs.",
  "INV-08": "Duplicate evidence MUST NOT increase independent corroboration.",
  "INV-09": "Multiple provider endpoints MUST NOT automatically imply independent authority.",
  "INV-10": "Derived results retain the limitations of their dependencies.",
  "INV-11": "Token quantity MUST NOT silently become USD value without explicit price evidence.",
  "INV-12": "Historical assertions are superseded, never silently rewritten.",
  "INV-13": "Source transport and source authority are separate concepts.",
};

const CANONICAL_AUTHORITY_PREFIXES = ["canonical-chain-state", "issuer:", "protocol:", "issuer-publication"];

const isZeroLike = (v: unknown): boolean => typeof v === "string" && /^0+(\.0+)?$/.test(v);

function declaredSupportAtLeast(a: Assertion, rank: number): boolean {
  const s = a.declared?.supportState;
  return s !== undefined && SUPPORT_RANK[s] >= rank;
}

export function checkInvariants(bundle: Bundle, evaluation: Evaluation): Violation[] {
  const out: Violation[] = [...evaluation.violations];
  const idx = indexEvidence(bundle);
  const evalById = new Map<string, AssertionEvaluation>(evaluation.assertions.map((e) => [e.assertionId, e]));
  const push = (invariant: Violation["invariant"], code: string, assertionId: string | null): void => {
    out.push({ invariant, code, assertionId });
  };
  const classified = new Map<string, string | null>();

  for (const s of bundle.sources) {
    const via = s.transport?.retrievedVia.toLowerCase();
    if (
      s.authorityId !== undefined &&
      ((s.kind === "PROVIDER_ENDPOINT" && CANONICAL_AUTHORITY_PREFIXES.some((p) => s.authorityId?.startsWith(p))) ||
        (via !== undefined && s.authorityId.toLowerCase() === via))
    ) {
      push("INV-13", "TRANSPORT_AS_AUTHORITY", null);
    }
  }
  for (const o of bundle.observations) {
    const s = idx.sources.get(o.sourceId);
    if (s === undefined) push("INV-00", "DANGLING_REFERENCE", null);
    else if (!ORIGIN_SOURCE_KINDS[o.origin].includes(s.kind)) push("INV-13", "ORIGIN_SOURCE_KIND_MISMATCH", null);
  }

  for (const a of bundle.assertions) {
    const e = evalById.get(a.id);
    if (e === undefined) continue;
    const obs = a.observationIds.map((id) => idx.observations.get(id)).filter((o) => o !== undefined);
    const derived = a.derivationId !== undefined;
    let specificSupportFlag = false;

    if (!derived && a.observationIds.length === 0 && (a.value !== null || declaredSupportAtLeast(a, SUPPORT_RANK.PARTIAL))) {
      push("INV-01", "NO_SOURCE_PRESENTED_AS_FACT", a.id);
      specificSupportFlag = true;
    }
    if (!derived && obs.length > 0 && obs.every((o) => o.result !== "VALUE") && a.value !== null) {
      const vals = Object.values(a.value);
      if (vals.some(isZeroLike)) push("INV-04", "NO_RESULT_AS_ZERO", a.id);
      else if (vals.some((v) => v === false)) push("INV-05", "UNKNOWN_AS_FALSE", a.id);
      else push("INV-01", "NO_RESULT_AS_VALUE", a.id);
      specificSupportFlag = true;
    }

    const declared = a.declared;
    if (declared?.supportState !== undefined && SUPPORT_RANK[declared.supportState] >= SUPPORT_RANK.SUPPORTED) {
      if (a.temporality === "CURRENT" && e.freshnessState === "STALE") {
        push("INV-02", "STALE_SATISFIES_CURRENT", a.id);
        specificSupportFlag = true;
      }
    }
    if (declared?.freshnessState === "CURRENT" && e.freshnessState === "STALE") {
      push("INV-02", "STALE_DECLARED_CURRENT", a.id);
    }
    if (declared?.supportState === "ESTABLISHED" && e.supportState === "CONFLICTING") {
      push("INV-03", "CONFLICT_SATISFIES_ESTABLISHED", a.id);
      specificSupportFlag = true;
    }

    if (a.origin !== "WALLETWALL_DERIVED" && derived) {
      push("INV-06", "DERIVED_MASQUERADES_AS_UPSTREAM_ORIGIN", a.id);
    } else if (a.origin === "WALLETWALL_DERIVED" && !derived) {
      push("INV-06", "DERIVED_WITHOUT_DERIVATION", a.id);
    } else if (!derived && obs.length > 0 && !obs.some((o) => o.origin === a.origin)) {
      push("INV-06", "ORIGIN_NOT_PRESENT_IN_BASIS", a.id);
    }

    const policy = getPolicy(a.claimType);
    if (derived) {
      const d = a.derivationId === undefined ? undefined : idx.derivations.get(a.derivationId);
      const deps = (d?.inputAssertionIds ?? []).map((id) => evalById.get(id)).filter((x) => x !== undefined);
      if (declared?.supportState !== undefined && SUPPORT_RANK[declared.supportState] > SUPPORT_RANK[e.supportState]) {
        push("INV-07", "PROCESSING_INCREASES_AUTHORITY", a.id);
        specificSupportFlag = true;
      }
      const declaredLimits = new Set(a.limitations ?? []);
      if (deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {
        push("INV-10", "DEPENDENCY_LIMITATIONS_DROPPED", a.id);
      }
      if (a.claimType === "TOKEN_USD_VALUE" && !deps.some((dep) => dep.claimType === "TOKEN_USD_PRICE")) {
        push("INV-11", "USD_VALUE_WITHOUT_PRICE_EVIDENCE", a.id);
      }
      if (d !== undefined && policy?.ruleId === d.ruleId) recompute(bundle, idx, evaluation, a, d.inputAssertionIds, classified, push);
    }

    if (a.claimType !== "TOKEN_USD_PRICE" && a.claimType !== "TOKEN_USD_VALUE" && a.value !== null) {
      if (Object.keys(a.value).some((k) => /usd/i.test(k))) push("INV-11", "QUANTITY_CLAIM_CARRIES_USD", a.id);
    }

    if (declared?.independentCorroboration !== undefined && e.independentCorroboration !== null) {
      if (Number.parseInt(declared.independentCorroboration, 10) > e.independentCorroboration) {
        const providerBasis = obs.some((o) => o.origin === "PROVIDER_OBSERVED");
        const dup = e.limitations.includes("DUPLICATE_EVIDENCE_COLLAPSED");
        if (providerBasis && !dup) push("INV-09", "PROVIDER_ENDPOINTS_COUNTED_AS_INDEPENDENT", a.id);
        else push("INV-08", "CORROBORATION_OVERCOUNT", a.id);
      }
    }

    if (!specificSupportFlag && declared?.supportState !== undefined && SUPPORT_RANK[declared.supportState] > SUPPORT_RANK[e.supportState]) {
      push("INV-00", "DECLARED_SUPPORT_EXCEEDS_COMPUTED", a.id);
    }
    if (declared?.finalityState === "FINALIZED" && e.finalityState !== null && e.finalityState !== "FINALIZED") {
      push("INV-00", "DECLARED_FINALITY_EXCEEDS_COMPUTED", a.id);
    }
    if (declared?.freshnessState === "CURRENT" && e.freshnessState !== "CURRENT" && e.freshnessState !== "STALE") {
      push("INV-00", "DECLARED_FRESHNESS_EXCEEDS_COMPUTED", a.id);
    }
  }

  // What makes a record faulty is one rule, supersessionFaults, which evaluation also reads: a faulty record is reported here and takes
  // nothing out of conflict detection there.
  const supersededIds = new Set<string>();
  for (const s of bundle.supersessions ?? []) {
    const faults = supersessionFaults(idx, s);
    const oldA = idx.assertions.get(s.supersededAssertionId);
    if (oldA === undefined || faults.includes("SUPERSESSION_REFERENCE_INVALID")) {
      push("INV-12", "SUPERSESSION_REFERENCE_INVALID", s.supersededAssertionId);
      continue;
    }
    if (supersededIds.has(oldA.id)) push("INV-12", "SUPERSEDED_MULTIPLE_TIMES", oldA.id);
    supersededIds.add(oldA.id);
    for (const fault of faults) push("INV-12", fault, oldA.id);
  }
  // Every supersession counts: a chain that comes back on itself by any of them is a cycle, whichever record comes first or last.
  const successors = new Map<string, string[]>();
  for (const s of bundle.supersessions ?? []) successors.set(s.supersededAssertionId, [...(successors.get(s.supersededAssertionId) ?? []), s.supersedingAssertionId]);
  const onChain = new Set<string>();
  const endsCleanly = new Set<string>();
  const reachesCycle = (id: string): boolean => {
    if (onChain.has(id)) return true;
    if (endsCleanly.has(id)) return false;
    onChain.add(id);
    const found = (successors.get(id) ?? []).some(reachesCycle);
    onChain.delete(id);
    if (!found) endsCleanly.add(id);
    return found;
  };
  for (const start of successors.keys()) {
    if (reachesCycle(start)) push("INV-12", "SUPERSESSION_CYCLE", start);
  }

  const seenKey = new Set<string>();
  return out
    .filter((v) => {
      const k = `${v.invariant}|${v.code}|${v.assertionId ?? ""}`;
      if (seenKey.has(k)) return false;
      seenKey.add(k);
      return true;
    })
    .sort((x, y) => {
      const kx = `${x.assertionId ?? ""}|${x.invariant}|${x.code}`;
      const ky = `${y.assertionId ?? ""}|${y.invariant}|${y.code}`;
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
}

/**
 * Whether a derived value is the rule's answer. A derivation may list several balances and prices, or several identities and balances, and
 * the value must be the answer under every reading: every balance with every price, every identity with every balance. Taking the first
 * of each in the order the derivation lists them would let that order decide whether a value passes, and let an author pick the verdict
 * by listing the reading that reproduces it first. `classified` holds what the readiness rule says of each identity and balance, so that
 * a pair read for one derivation is not worked out again for the next: it is a cache of an answer, and changes none.
 */
function recompute(
  bundle: Bundle,
  idx: EvidenceIndex,
  evaluation: Evaluation,
  a: Assertion,
  inputIds: readonly string[],
  classified: Map<string, string | null>,
  push: (invariant: Violation["invariant"], code: string, assertionId: string | null) => void,
): void {
  const inputs = [...new Set(inputIds)].map((id) => idx.assertions.get(id)).filter((x): x is Assertion => x !== undefined);
  const ofType = (claimType: Assertion["claimType"]): Assertion[] => inputs.filter((x) => x.claimType === claimType);
  const mismatch = (): void => push("INV-00", "RECOMPUTATION_MISMATCH", a.id);

  if (a.claimType === "TOKEN_USD_VALUE") {
    const balances = ofType("TOKEN_BALANCE_AT_BLOCK");
    const prices = ofType("TOKEN_USD_PRICE");
    if (balances.length === 0 || prices.length === 0 || a.value === null) return;
    for (const bal of balances) {
      for (const price of prices) {
        try {
          const sameToken = bal.subject["chainId"] === price.subject["chainId"] && subjectKeyEqual("token", String(bal.subject["token"]), String(price.subject["token"]));
          const atomic = parseAtomic(String(bal.value?.["balanceAtomic"]));
          const decimals = parseDecimals(String(bal.value?.["decimals"]));
          const p = parsePriceScaled18(String(price.value?.["priceUsd"]));
          const expected = usdValueScaled18(atomic, decimals, p).toString();
          if (!sameToken || a.value["usdScaled18"] !== expected || a.value["rounding"] !== "FLOOR_SCALED_18") return mismatch();
        } catch {
          return mismatch();
        }
      }
    }
    return;
  }

  if (a.claimType === "VAULT_TECHNICAL_READINESS") {
    const identities = ofType("ASSET_IDENTITY");
    const balances = ofType("TOKEN_BALANCE_AT_BLOCK");
    if (identities.length === 0 || balances.length === 0 || a.value === null) return;
    for (const ident of identities) {
      for (const bal of balances) {
        const key = `${ident.id}\u0000${bal.id}`;
        let classification = classified.get(key);
        if (classification === undefined) {
          const r = assessReadiness(bundle, evaluation, ident.id, bal.id);
          classification = r.ruleId === READINESS_RULE_ID ? r.classification : null;
          classified.set(key, classification);
        }
        if (a.value["classification"] !== classification) return mismatch();
      }
    }
  }
}

export function inspectInvariants(bundle: Bundle, evaluatedAt: string): { evaluation: Evaluation; violations: Violation[] } {
  const evaluation = evaluateBundle(bundle, evaluatedAt);
  return { evaluation, violations: checkInvariants(bundle, evaluation) };
}
