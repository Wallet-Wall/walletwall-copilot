import type { Bundle, Assertion, LimitationCode, SupportState } from "./schemas.ts";
import { evidenceDigest } from "./canonical.ts";
import { RULES_VERSION } from "./registry.ts";
import { evaluateBundle, weakest, type AssertionEvaluation, type Evaluation } from "./evaluate.ts";

export const READINESS_RULE_ID = "wwvr.vault-technical-readiness";
export const READINESS_RULES_VERSION = RULES_VERSION;

export type CriterionOutcome = "MET" | "NOT_MET" | "INDETERMINATE";
export type ReadinessClassification = "CRITERIA_MET" | "CRITERIA_NOT_MET" | "NOT_ESTABLISHED";

export interface Criterion {
  id: string;
  description: string;
  outcome: CriterionOutcome;
  reason: string;
}

export interface ReadinessResult {
  claimType: "VAULT_TECHNICAL_READINESS";
  classification: ReadinessClassification;
  ruleId: string;
  rulesVersion: string;
  criteria: Criterion[];
  inputs: { assertionId: string; claimType: string; supportState: SupportState; digest: string }[];
  supportOfInputs: SupportState;
  limitations: LimitationCode[];
  doesNotEstablish: readonly string[];
  suggestedDerivation: {
    id: string;
    ruleId: string;
    rulesVersion: string;
    inputAssertionIds: string[];
    outputAssertionId: string;
  };
  suggestedAssertion: Assertion;
  resultDigest: string;
}

export const DOES_NOT_ESTABLISH: readonly string[] = [
  "investment merit",
  "solvency",
  "creditworthiness",
  "legal status",
  "regulatory compliance",
  "absence of fraud",
  "future performance",
];

const DESCRIPTIONS = {
  C1: "Asset identity is established against the WalletWall registry and issuer or protocol authority.",
  C2: "Balance observation is established at a finalized block from canonical chain state.",
  C3: "Balance subject refers to the same chain and token contract as the asset identity.",
  C4: "Decimals agree between the identity assertion and the balance assertion.",
  C5: "Neither input assertion is conflicting or superseded.",
  C6: "Every current-temporality input is fresh under its authority policy.",
} as const;

function find(evalById: Map<string, AssertionEvaluation>, id: string): AssertionEvaluation | undefined {
  return evalById.get(id);
}

/**
 * VAULT_TECHNICAL_READINESS rules 0.1.0-draft. A deterministic classification of whether presented evidence
 * meets WalletWall's published technical criteria. It is not a statement about the asset's quality or safety.
 */
export function assessReadiness(
  bundle: Bundle,
  evaluation: Evaluation,
  identityAssertionId: string,
  balanceAssertionId: string,
): ReadinessResult {
  const evalById = new Map(evaluation.assertions.map((e) => [e.assertionId, e]));
  const aById = new Map(bundle.assertions.map((a) => [a.id, a]));
  const idEval = find(evalById, identityAssertionId);
  const balEval = find(evalById, balanceAssertionId);
  const idA = aById.get(identityAssertionId);
  const balA = aById.get(balanceAssertionId);
  const typed = idEval?.claimType === "ASSET_IDENTITY" && balEval?.claimType === "TOKEN_BALANCE_AT_BLOCK";
  const criteria: Criterion[] = [];
  const add = (id: keyof typeof DESCRIPTIONS, outcome: CriterionOutcome, reason: string): void => {
    criteria.push({ id, description: DESCRIPTIONS[id], outcome, reason });
  };

  if (!typed || !idA || !balA || !idEval || !balEval) {
    for (const id of Object.keys(DESCRIPTIONS) as (keyof typeof DESCRIPTIONS)[]) {
      add(id, "INDETERMINATE", "REQUIRED_INPUT_ASSERTION_MISSING_OR_WRONG_CLAIM_TYPE");
    }
  } else {
    if (idEval.limitations.includes("REGISTRY_MISMATCH")) add("C1", "NOT_MET", "REGISTRY_MISMATCH");
    else if (idEval.limitations.includes("NOT_IN_REGISTRY")) add("C1", "NOT_MET", "NOT_IN_REGISTRY");
    else if (idEval.supportState === "ESTABLISHED") add("C1", "MET", "IDENTITY_ESTABLISHED");
    else add("C1", "INDETERMINATE", `IDENTITY_${idEval.supportState}`);

    if (balEval.supportState === "ESTABLISHED") add("C2", "MET", "BALANCE_ESTABLISHED");
    else add("C2", "INDETERMINATE", `BALANCE_${balEval.supportState}`);

    const sameChain = idA.subject["chainId"] === balA.subject["chainId"];
    const idAddr = idA.subject["address"];
    const balToken = balA.subject["token"];
    const sameToken =
      typeof idAddr === "string" && typeof balToken === "string" && idAddr.toLowerCase() === balToken.toLowerCase();
    add("C3", sameChain && sameToken ? "MET" : "NOT_MET", sameChain && sameToken ? "SUBJECT_CONSISTENT" : "SUBJECT_INCONSISTENT");

    const idDec = idA.value?.["decimals"];
    const balDec = balA.value?.["decimals"];
    if (typeof idDec !== "string" || typeof balDec !== "string") add("C4", "INDETERMINATE", "DECIMALS_MISSING");
    else add("C4", idDec === balDec ? "MET" : "NOT_MET", idDec === balDec ? "DECIMALS_CONSISTENT" : "DECIMALS_INCONSISTENT");

    const bad = (e: AssertionEvaluation): boolean =>
      e.supportState === "CONFLICTING" || e.supportState === "SUPERSEDED" || e.conflictsWith.length > 0;
    add("C5", bad(idEval) || bad(balEval) ? "INDETERMINATE" : "MET", bad(idEval) || bad(balEval) ? "CONFLICT_OR_SUPERSESSION" : "NO_CONFLICT");

    const freshOk = (e: AssertionEvaluation): boolean => e.temporality === "PINNED" || e.freshnessState === "CURRENT";
    add("C6", freshOk(idEval) && freshOk(balEval) ? "MET" : "INDETERMINATE", freshOk(idEval) && freshOk(balEval) ? "FRESH_OR_PINNED" : "NOT_CURRENT");
  }

  const classification: ReadinessClassification = criteria.some((c) => c.outcome === "NOT_MET")
    ? "CRITERIA_NOT_MET"
    : criteria.some((c) => c.outcome === "INDETERMINATE")
      ? "NOT_ESTABLISHED"
      : "CRITERIA_MET";

  const inputs = [idEval, balEval]
    .filter((e): e is AssertionEvaluation => e !== undefined)
    .map((e) => ({ assertionId: e.assertionId, claimType: e.claimType, supportState: e.supportState, digest: e.digest }));
  const limitations = new Set<LimitationCode>(["WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY"]);
  for (const e of [idEval, balEval]) if (e) for (const l of e.limitations) limitations.add(l);

  const subjectBase = balA?.subject ?? {};
  const outputId = "readiness-result";
  const derivationId = "readiness-derivation";
  const balancePinned = balEval?.temporality === "PINNED";
  const suggestedAssertion: Assertion = {
    id: outputId,
    claimType: "VAULT_TECHNICAL_READINESS",
    origin: "WALLETWALL_DERIVED",
    temporality: balancePinned ? "PINNED" : "CURRENT",
    subject: subjectBase,
    value: { classification },
    observationIds: [],
    derivationId,
    assertedAt: evaluation.evaluatedAt,
    limitations: [...limitations].sort(),
  };
  const suggestedDerivation = {
    id: derivationId,
    ruleId: READINESS_RULE_ID,
    rulesVersion: READINESS_RULES_VERSION,
    inputAssertionIds: [identityAssertionId, balanceAssertionId],
    outputAssertionId: outputId,
  };
  const core = {
    classification,
    criteria,
    inputs,
    ruleId: READINESS_RULE_ID,
    rulesVersion: READINESS_RULES_VERSION,
  };
  return {
    claimType: "VAULT_TECHNICAL_READINESS",
    classification,
    ruleId: READINESS_RULE_ID,
    rulesVersion: READINESS_RULES_VERSION,
    criteria,
    inputs,
    supportOfInputs: weakest(inputs.map((i) => i.supportState)),
    limitations: [...limitations].sort(),
    doesNotEstablish: DOES_NOT_ESTABLISH,
    suggestedDerivation,
    suggestedAssertion,
    resultDigest: evidenceDigest(core),
  };
}

export function evaluateAndAssess(
  bundle: Bundle,
  evaluatedAt: string,
  identityAssertionId: string,
  balanceAssertionId: string,
): { evaluation: Evaluation; result: ReadinessResult } {
  const evaluation = evaluateBundle(bundle, evaluatedAt);
  return { evaluation, result: assessReadiness(bundle, evaluation, identityAssertionId, balanceAssertionId) };
}
