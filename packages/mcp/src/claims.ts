import { ATOMIC_RE, DECIMALS_RE, MAX_DECIMALS, PRICE_RE, parseAtomic, parseDecimals, parsePriceScaled18 } from "./quantity.ts";
import { POLICIES_VERSION, allPolicies, type Policy } from "./registry.ts";
import {
  ADDRESS_RE,
  CHAIN_ID_RE,
  HASH_RE,
  KEY_RE,
  KNOWN_PATH_SEGMENTS,
  LIMITS,
  SAFE_TEXT_RE,
  WWEP_VERSION,
  type ClaimType,
  type FlatRecordValue,
  type Origin,
  type SourceKind,
} from "./schemas.ts";

/**
 * The per-claim-type contract: which keys a subject and a value must carry and what each key must look like.
 * The evaluator validates with these rules and the `walletwall://schemas/claims` resource is generated from them,
 * so the published contract cannot drift from what the engine accepts.
 */

export const ORIGIN_SOURCE_KINDS: Readonly<Record<Origin, readonly SourceKind[]>> = {
  CHAIN_OBSERVED: ["CHAIN_STATE"],
  AUTHORITY_ATTESTED: ["ISSUER_PUBLICATION"],
  PROVIDER_OBSERVED: ["PROVIDER_ENDPOINT"],
  USER_SUPPLIED: ["USER_INPUT"],
  WALLETWALL_DERIVED: ["WALLETWALL_RULES"],
};

export interface KeySchema {
  type: "string";
  pattern?: string;
  enum?: readonly string[];
  description: string;
}

export interface KeyRule {
  /** Accepts a string value for this key. Exact parsers only; never floating point. */
  accepts: (value: string) => boolean;
  /** JSON Schema fragment published for this key. */
  schema: KeySchema;
  /** Observation-to-assertion subject matching folds case for this key (hex addresses and hashes). */
  caseInsensitive?: true;
}

const BLOCK_NUMBER_RE = /^(0|[1-9][0-9]{0,17})$/;
const USD_SCALED_18_RE = /^(0|[1-9][0-9]{0,139})$/;
const ROUNDING_MODES = ["FLOOR_SCALED_18"] as const;
const READINESS_CLASSIFICATIONS = ["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"] as const;

const parses =
  (parse: (text: string) => unknown) =>
  (value: string): boolean => {
    try {
      parse(value);
      return true;
    } catch {
      return false;
    }
  };

const safeText = (description: string): KeyRule => ({
  accepts: (v) => SAFE_TEXT_RE.test(v),
  schema: { type: "string", pattern: SAFE_TEXT_RE.source, description },
});

const DECIMALS_RULE: KeyRule = {
  accepts: parses(parseDecimals),
  schema: {
    type: "string",
    pattern: DECIMALS_RE.source,
    description: `Token decimals as a decimal string, 0 to ${MAX_DECIMALS}. For a registered deployment it must equal the registry decimals.`,
  },
};

/** Subject keys. A policy's subjectKeys selects which of these a claim type needs. */
export const SUBJECT_KEY_RULES: Readonly<Record<string, KeyRule>> = {
  chainId: {
    accepts: (v) => CHAIN_ID_RE.test(v),
    schema: { type: "string", pattern: CHAIN_ID_RE.source, description: "EIP-155 chain ID as a decimal string." },
  },
  address: {
    accepts: (v) => ADDRESS_RE.test(v),
    schema: { type: "string", pattern: ADDRESS_RE.source, description: "Token contract address: 0x followed by 40 hex digits." },
    caseInsensitive: true,
  },
  token: {
    accepts: (v) => ADDRESS_RE.test(v),
    schema: { type: "string", pattern: ADDRESS_RE.source, description: "Token contract address of the balance: 0x followed by 40 hex digits." },
    caseInsensitive: true,
  },
  holder: {
    accepts: (v) => ADDRESS_RE.test(v),
    schema: { type: "string", pattern: ADDRESS_RE.source, description: "Account address whose balance is observed: 0x followed by 40 hex digits." },
    caseInsensitive: true,
  },
  blockNumber: {
    accepts: (v) => BLOCK_NUMBER_RE.test(v),
    schema: { type: "string", pattern: BLOCK_NUMBER_RE.source, description: "Block height as a decimal string." },
  },
  blockHash: {
    accepts: (v) => HASH_RE.test(v),
    schema: { type: "string", pattern: HASH_RE.source, description: "Block hash: 0x followed by 64 hex digits." },
    caseInsensitive: true,
  },
};

/** Subject keys whose observation-to-assertion match folds case. The evaluator reads this set; the contract prose is generated from it. */
export const CASE_INSENSITIVE_SUBJECT_KEYS: ReadonlySet<string> = new Set(
  Object.entries(SUBJECT_KEY_RULES)
    .filter(([, rule]) => rule.caseInsensitive === true)
    .map(([key]) => key),
);

const CASE_NOTE =
  " Matched case-insensitively between an observation and its assertion; conflict grouping and supersession identity compare the exact string, so supply lowercase hex.";

/** Value keys per claim type. The same shape applies to assertion.value and to each supporting observation.payload. */
export const VALUE_KEY_RULES: Readonly<Record<ClaimType, Readonly<Record<string, KeyRule>>>> = {
  ASSET_IDENTITY: {
    symbol: safeText("Token symbol as published by the issuer or protocol. For an ESTABLISHED identity it must equal the registry symbol. A symbol is never identity on its own."),
    decimals: DECIMALS_RULE,
    issuerAuthorityId: safeText(
      "Authority identifier of the issuer or protocol publication that attests the deployment, for example the registry record's authorityId. It must equal the registry authorityId for the subject deployment and the authorityId of the attesting ISSUER_PUBLICATION source.",
    ),
  },
  TOKEN_BALANCE_AT_BLOCK: {
    balanceAtomic: {
      accepts: parses(parseAtomic),
      schema: { type: "string", pattern: ATOMIC_RE.source, description: "Balance in atomic units as a canonical decimal integer string, at most 2^256 - 1. Never a JSON number." },
    },
    decimals: DECIMALS_RULE,
  },
  TOKEN_USD_PRICE: {
    priceUsd: {
      accepts: parses(parsePriceScaled18),
      schema: { type: "string", pattern: PRICE_RE.source, description: "USD price as a decimal string with at most 18 fractional digits. A price is a provider observation and can be at most SUPPORTED." },
    },
  },
  TOKEN_USD_VALUE: {
    usdScaled18: {
      accepts: (v) => USD_SCALED_18_RE.test(v),
      schema: { type: "string", pattern: USD_SCALED_18_RE.source, description: "USD value scaled by 10^18 as a decimal integer string, computed by rule wwdr.usd-value from balance and price evidence." },
    },
    rounding: {
      accepts: (v) => (ROUNDING_MODES as readonly string[]).includes(v),
      schema: { type: "string", enum: ROUNDING_MODES, description: "Rounding applied by the derivation rule." },
    },
  },
  VAULT_TECHNICAL_READINESS: {
    classification: {
      accepts: (v) => (READINESS_CLASSIFICATIONS as readonly string[]).includes(v),
      schema: { type: "string", enum: READINESS_CLASSIFICATIONS, description: "The published VAULT_TECHNICAL_READINESS classification. Never a generic READY." },
    },
  },
};

/** The policy file and the shape table must name the same value keys; a mismatch is a build defect, not a runtime state. */
for (const policy of allPolicies()) {
  const shaped = Object.keys(VALUE_KEY_RULES[policy.claimType]).sort();
  const declared = [...policy.valueKeys].sort();
  if (shaped.length !== declared.length || shaped.some((k, i) => k !== declared[i])) {
    throw new Error(`value keys for ${policy.claimType} differ between the authority policy and the claim shape table`);
  }
  for (const k of policy.subjectKeys) {
    if (SUBJECT_KEY_RULES[k] === undefined) throw new Error(`subject key ${k} of ${policy.claimType} has no shape rule`);
  }
}

/** Record key names that may be reported verbatim in diagnostics. Anything else is reported as "*". */
export const KNOWN_RECORD_KEYS: ReadonlySet<string> = new Set([
  ...KNOWN_PATH_SEGMENTS,
  ...Object.keys(SUBJECT_KEY_RULES),
  ...Object.values(VALUE_KEY_RULES).flatMap((rules) => Object.keys(rules)),
]);

export interface RecordDiagnosis {
  requiredKeys: string[];
  missingKeys: string[];
  invalidKeys: { key: string; reason: "WRONG_TYPE" | "INVALID_FORMAT" }[];
  /** Keys present but outside the contract. Names outside the known vocabulary are reported as "*". */
  unexpectedKeys: string[];
}

export interface AssertionDiagnostic extends RecordDiagnosis {
  limitation: "INVALID_SUBJECT" | "SUBJECT_MISMATCH" | "INVALID_VALUE" | "VALUE_MISMATCH";
  record: "ASSERTION_SUBJECT" | "ASSERTION_VALUE" | "OBSERVATION_SUBJECT" | "OBSERVATION_PAYLOAD";
  observationId: string | null;
  /** Keys whose value differs from the record it was compared with. */
  mismatchedKeys: string[];
}

/**
 * Explains why a record fails its shape. Deterministic and bounded: key names come from the contract or the known
 * vocabulary, values are never included, and a record holds at most LIMITS.recordEntries keys.
 */
export function diagnoseRecord(rec: FlatRecordValue | null, rules: Readonly<Record<string, KeyRule>>, requiredKeys: readonly string[]): RecordDiagnosis {
  const missingKeys: string[] = [];
  const invalidKeys: RecordDiagnosis["invalidKeys"] = [];
  for (const key of requiredKeys) {
    const value = rec === null ? undefined : rec[key];
    if (value === undefined) missingKeys.push(key);
    else if (typeof value !== "string") invalidKeys.push({ key, reason: "WRONG_TYPE" });
    else if (!(rules[key]?.accepts(value) ?? true)) invalidKeys.push({ key, reason: "INVALID_FORMAT" });
  }
  const required = new Set(requiredKeys);
  const unexpectedKeys =
    rec === null
      ? []
      : Object.keys(rec)
          .filter((k) => !required.has(k))
          .slice(0, LIMITS.recordEntries)
          .map((k) => (KNOWN_RECORD_KEYS.has(k) ? k : "*"))
          .sort();
  return { requiredKeys: [...requiredKeys], missingKeys, invalidKeys, unexpectedKeys };
}

export function subjectValid(subject: FlatRecordValue, keys: readonly string[]): boolean {
  for (const k of keys) {
    const v = subject[k];
    if (typeof v !== "string") return false;
    const rule = SUBJECT_KEY_RULES[k];
    if (rule !== undefined && !rule.accepts(v)) return false;
  }
  return true;
}

/** Validates the value shape for a claim type using exact parsers. Never uses floating point. */
export function valueValid(claimType: ClaimType, rec: FlatRecordValue | null): boolean {
  if (rec === null) return false;
  const rules = VALUE_KEY_RULES[claimType] as Readonly<Record<string, KeyRule>> | undefined;
  if (rules === undefined) return false;
  for (const [key, rule] of Object.entries(rules)) {
    const v = rec[key];
    if (typeof v !== "string" || !rule.accepts(v)) return false;
  }
  return true;
}

export const CLAIMS_RESOURCE_URI = "walletwall://schemas/claims";

const SHAPE_LIMITATIONS = ["INVALID_SUBJECT", "SUBJECT_MISMATCH", "INVALID_VALUE", "VALUE_MISMATCH"] as const;

function recordSchema(keys: readonly string[], rules: Readonly<Record<string, KeyRule>>, appliesTo: string): unknown {
  const properties: Record<string, KeySchema> = {};
  for (const k of keys) {
    const rule = rules[k];
    const schema: KeySchema = rule?.schema ?? { type: "string", pattern: SAFE_TEXT_RE.source, description: "Output-safe text." };
    properties[k] = rule?.caseInsensitive === true ? { ...schema, description: `${schema.description}${CASE_NOTE}` } : schema;
  }
  return {
    type: "object",
    appliesTo,
    required: [...keys],
    properties,
    propertyNames: { pattern: KEY_RE.source },
    additionalProperties: {
      type: ["string", "boolean", "null"],
      description:
        "Accepted by the bundle schema but not part of this claim's contract. Not used to compute support, freshness or finality; still part of the record's digest and inspected by check_invariants (for example a value key naming USD on a quantity claim violates INV-11). Reported as unexpectedKeys in diagnostics when the record fails its shape.",
    },
    maxProperties: LIMITS.recordEntries,
  };
}

function authorityRequirement(p: Policy): string {
  const kinds = (origins: readonly Origin[]): string => [...new Set(origins.flatMap((o) => ORIGIN_SOURCE_KINDS[o]))].join(", ");
  if (p.derived) {
    return `Established only by the WalletWall rule ${p.ruleId ?? ""} from its dependency assertions (${p.requiredDependencyClaimTypes.join(", ")}). It never carries more support than its weakest dependency and always carries WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY.`;
  }
  if (p.authoritativeOrigins.length === 0) {
    return `No origin can establish this claim. Observations from ${p.corroboratingOrigins.join(", ")} sources (kinds ${kinds(p.corroboratingOrigins)}) corroborate it; with at least ${p.minIndependentCorroboration} independent groups it reaches ${p.maxSupportWithoutAuthority} at most.`;
  }
  const registryRule =
    p.authorityIdSource === "REGISTRY"
      ? " The attesting source's authorityId must equal the registry authorityId for the subject deployment, otherwise AUTHORITY_ID_MISMATCH; value.symbol, value.decimals and value.issuerAuthorityId must equal the registry record, otherwise REGISTRY_MISMATCH."
      : " Transport such as an RPC or provider endpoint is recorded as source.transport.retrievedVia and never counts as authority.";
  const finalityRule = p.requiresFinality ? " The authoritative observation must be FINALIZED to be ESTABLISHED; otherwise it is SUPPORTED." : "";
  return (
    `ESTABLISHED requires at least one observation with origin ${p.authoritativeOrigins.join(" or ")} from a source of kind ${kinds(p.authoritativeOrigins)}.` +
    registryRule +
    finalityRule +
    ` Without an authoritative observation, ${p.corroboratingOrigins.join(", ")} observations from ${p.minIndependentCorroboration} or more independent groups reach ${p.maxSupportWithoutAuthority} at most.`
  );
}

/** The machine-readable and human-readable claim contract served as walletwall://schemas/claims. */
export function claimContracts(examplesByClaim: Readonly<Partial<Record<ClaimType, string>>>): unknown {
  const claims: Record<string, unknown> = {};
  for (const p of allPolicies()) {
    const origins: readonly Origin[] = [...p.authoritativeOrigins, ...p.corroboratingOrigins];
    const sourceKindByOrigin: Record<string, readonly SourceKind[]> = {};
    for (const o of origins) sourceKindByOrigin[o] = ORIGIN_SOURCE_KINDS[o];
    const caseFolded = p.subjectKeys.filter((k) => CASE_INSENSITIVE_SUBJECT_KEYS.has(k));
    claims[p.claimType] = {
      policyId: p.policyId,
      derived: p.derived,
      subject: recordSchema(p.subjectKeys, SUBJECT_KEY_RULES, p.derived ? "assertion.subject" : "assertion.subject and observation.subject"),
      value: recordSchema(p.valueKeys, VALUE_KEY_RULES[p.claimType], p.derived ? "assertion.value" : "assertion.value and observation.payload"),
      observation: p.derived
        ? null
        : {
            origins: { authoritative: p.authoritativeOrigins, corroborating: p.corroboratingOrigins },
            sourceKindByOrigin,
            result: "VALUE",
            finalityApplies: p.finalityApplies,
            requiresFinality: p.requiresFinality,
            linkage: [
              "assertion.observationIds lists the ids of the observations that support it; each must exist in bundle.observations.",
              "observation.sourceId names a bundle source whose kind is listed under sourceKindByOrigin for the observation's origin.",
              caseFolded.length > 0
                ? `observation.subject must equal assertion.subject on every subject key; ${caseFolded.join(", ")} match case-insensitively, the other keys exactly.`
                : "observation.subject must equal assertion.subject on every subject key.",
              "observation.payload must satisfy the value shape; every supporting payload must agree on the value keys and equal assertion.value on them.",
              "assertion.origin must be the origin of at least one supporting observation.",
              "An observation with result NO_RESULT or ERROR carries no value. If no supporting observation carries a value the assertion is UNKNOWN (never zero, never false); otherwise the NO_RESULT limitation is attached and the valued observations are evaluated.",
            ],
          },
      assertion: {
        temporality: p.maxAgeSeconds === null ? "CURRENT or PINNED" : `CURRENT (fresh within ${p.maxAgeSeconds} seconds of evaluatedAt) or PINNED (a historical point)`,
        derivationId: p.derived ? "required: names the bundle derivation that produced this assertion" : "absent for this claim type",
      },
      authority: {
        authorityId: p.authority.authorityId,
        kind: p.authority.kind,
        authorityIdSource: p.authorityIdSource,
        maxSupportWithoutAuthority: p.maxSupportWithoutAuthority,
        minIndependentCorroboration: p.minIndependentCorroboration,
        maxAgeSeconds: p.maxAgeSeconds,
        requirement: authorityRequirement(p),
      },
      derivation: p.derived
        ? {
            ruleId: p.ruleId,
            requiredDependencyClaimTypes: p.requiredDependencyClaimTypes,
            linkage:
              "assertion.derivationId names a bundle derivation whose outputAssertionId is this assertion's id and whose inputAssertionIds name the dependency assertions; assertion.observationIds is empty and assertion.origin is WALLETWALL_DERIVED.",
          }
        : null,
      example: examplesByClaim[p.claimType] ?? null,
    };
  }
  return {
    wwepVersion: WWEP_VERSION,
    policiesVersion: POLICIES_VERSION,
    note: "Per-claim-type contract generated from the bundled authority policies and the evaluator's shape rules. assertion.subject and observation.subject share one subject shape; assertion.value and observation.payload share one value shape. The closed bundle schema is walletwall://schemas/evidence; worked synthetic inputs are served under walletwall://examples/.",
    recordRules: {
      keyPattern: KEY_RE.source,
      scalarValues: "string, boolean or null. Every evidence-critical value is a string; JSON numbers are rejected by the bundle schema.",
      textPattern: SAFE_TEXT_RE.source,
      maxEntries: LIMITS.recordEntries,
    },
    diagnostics: {
      limitations: SHAPE_LIMITATIONS,
      note: "When inspect_evidence attaches one of these limitations, the assertion's diagnostics entries name the record checked (ASSERTION_SUBJECT, ASSERTION_VALUE, OBSERVATION_SUBJECT or OBSERVATION_PAYLOAD), the observationId where applicable, requiredKeys, missingKeys, invalidKeys (WRONG_TYPE or INVALID_FORMAT), unexpectedKeys and mismatchedKeys. Record values are never echoed; only observation ids already present in the evaluation appear; key names outside the contract vocabulary are reported as *; one entry per distinct observation.",
    },
    claims,
  };
}
