import { z } from "zod";

export const WWEP_VERSION = "0.1";

export const ORIGINS = [
  "CHAIN_OBSERVED",
  "AUTHORITY_ATTESTED",
  "PROVIDER_OBSERVED",
  "USER_SUPPLIED",
  "WALLETWALL_DERIVED",
] as const;
export const SUPPORT_STATES = [
  "ESTABLISHED",
  "SUPPORTED",
  "PARTIAL",
  "CONFLICTING",
  "STALE",
  "SUPERSEDED",
  "UNKNOWN",
  "NOT_ESTABLISHED",
] as const;
export const FINALITY_STATES = ["FINALIZED", "UNFINALIZED", "UNKNOWN_FINALITY"] as const;
export const FRESHNESS_STATES = ["CURRENT", "STALE", "PINNED", "UNKNOWN_FRESHNESS"] as const;
export const SOURCE_KINDS = [
  "CHAIN_STATE",
  "ISSUER_PUBLICATION",
  "PROVIDER_ENDPOINT",
  "USER_INPUT",
  "WALLETWALL_RULES",
] as const;
export const CLAIM_TYPES = [
  "ASSET_IDENTITY",
  "TOKEN_BALANCE_AT_BLOCK",
  "TOKEN_USD_PRICE",
  "TOKEN_USD_VALUE",
  "VAULT_TECHNICAL_READINESS",
] as const;
export const OBSERVATION_RESULTS = ["VALUE", "NO_RESULT", "ERROR"] as const;
export const TEMPORALITIES = ["CURRENT", "PINNED"] as const;
export const LIMITATION_CODES = [
  "NO_SOURCE",
  "NO_RESULT",
  "DANGLING_REFERENCE",
  "TRANSPORT_FIDELITY_NOT_VERIFIED",
  "NOT_FINALIZED",
  "FINALITY_UNKNOWN",
  "STALE_EVIDENCE",
  "FRESHNESS_UNKNOWN",
  "OBSERVATION_FROM_FUTURE",
  "NO_AUTHORITATIVE_OBSERVATION",
  "NON_AUTHORITATIVE_ONLY",
  "INSUFFICIENT_INDEPENDENT_CORROBORATION",
  "DUPLICATE_EVIDENCE_COLLAPSED",
  "ORIGIN_SOURCE_KIND_MISMATCH",
  "AUTHORITY_ID_MISMATCH",
  "SUBJECT_MISMATCH",
  "INVALID_SUBJECT",
  "VALUE_MISMATCH",
  "OBSERVATION_DISAGREEMENT",
  "NOT_IN_REGISTRY",
  "CHAIN_NOT_IN_REGISTRY",
  "REGISTRY_MISMATCH",
  "REGISTRY_VERIFIED_POINT_IN_TIME",
  "SYMBOL_NOT_AUTHORITY",
  "POLICY_MISSING",
  "DERIVATION_MISSING",
  "DERIVATION_NOT_PERMITTED",
  "MISSING_REQUIRED_DEPENDENCY",
  "DEPENDENCY_CYCLE",
  "DEPENDENCY_SUPERSEDED",
  "PINNED_DEPENDENCY_FOR_CURRENT_CLAIM",
  "RULES_UNKNOWN",
  "WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY",
  "CONFLICT_DECLARED",
  "CONFLICT_DETECTED",
  "SUPERSEDED",
  "REGISTRY_VERSION_MISMATCH",
  "RULES_VERSION_MISMATCH",
  "PRICE_IS_PROVIDER_OBSERVATION",
  "INVALID_VALUE",
] as const;
export const CONFLICT_REASONS = ["VALUE_DISAGREEMENT", "AUTHORITY_DISAGREEMENT", "SUBJECT_DISAGREEMENT"] as const;
export const SUPERSESSION_REASONS = ["CORRECTED", "NEWER_OBSERVATION", "RULES_UPDATED", "REGISTRY_UPDATED"] as const;

export type Origin = (typeof ORIGINS)[number];
export type SupportState = (typeof SUPPORT_STATES)[number];
export type FinalityState = (typeof FINALITY_STATES)[number];
export type FreshnessState = (typeof FRESHNESS_STATES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type LimitationCode = (typeof LIMITATION_CODES)[number];

export const LIMITS = {
  sources: 64,
  observations: 128,
  assertions: 128,
  derivations: 64,
  conflicts: 32,
  supersessions: 64,
  idsPerList: 32,
  recordEntries: 16,
  textLength: 128,
} as const;

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
export const CHAIN_ID_RE = /^[1-9][0-9]{0,17}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** Conservative output-safe text: no quotes, brackets, newlines or control characters. */
export const SAFE_TEXT_RE = /^[A-Za-z0-9 _.:/+-]{0,128}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const Id = z.string().regex(ID_RE);
const Iso = z
  .string()
  .regex(ISO_RE)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 19) === s.slice(0, 19), {
    message: "invalid timestamp",
  });
const SafeText = z.string().regex(SAFE_TEXT_RE);
const Scalar = z.union([SafeText, z.boolean(), z.null()]);
export const FlatRecord = z
  .record(z.string().regex(KEY_RE), Scalar)
  .refine((r) => Object.keys(r).length <= LIMITS.recordEntries, { message: "too many entries" });

export const OriginSchema = z.enum(ORIGINS);
export const SupportStateSchema = z.enum(SUPPORT_STATES);
export const FinalitySchema = z.enum(FINALITY_STATES);
export const FreshnessSchema = z.enum(FRESHNESS_STATES);
export const ClaimTypeSchema = z.enum(CLAIM_TYPES);
const LimitationSchema = z.enum(LIMITATION_CODES);

export const SourceSchema = z.strictObject({
  id: Id,
  kind: z.enum(SOURCE_KINDS),
  authorityId: Id.optional(),
  transport: z.strictObject({ retrievedVia: SafeText.max(64) }).optional(),
  independenceGroup: Id.optional(),
});

export const ObservationSchema = z.strictObject({
  id: Id,
  sourceId: Id,
  origin: OriginSchema,
  observedAt: Iso,
  finality: FinalitySchema,
  result: z.enum(OBSERVATION_RESULTS),
  subject: FlatRecord,
  payload: FlatRecord,
});

export const AssertionSchema = z.strictObject({
  id: Id,
  claimType: ClaimTypeSchema,
  origin: OriginSchema,
  temporality: z.enum(TEMPORALITIES),
  subject: FlatRecord,
  value: FlatRecord.nullable(),
  observationIds: z.array(Id).max(LIMITS.idsPerList),
  derivationId: Id.optional(),
  assertedAt: Iso,
  limitations: z.array(LimitationSchema).max(LIMITS.idsPerList).optional(),
  declared: z
    .strictObject({
      supportState: SupportStateSchema.optional(),
      freshnessState: FreshnessSchema.optional(),
      finalityState: FinalitySchema.optional(),
      independentCorroboration: z.string().regex(/^[0-9]{1,3}$/).optional(),
    })
    .optional(),
});

export const DerivationSchema = z.strictObject({
  id: Id,
  ruleId: Id,
  rulesVersion: SafeText.max(64),
  inputAssertionIds: z.array(Id).max(LIMITS.idsPerList),
  outputAssertionId: Id,
});

export const ConflictSchema = z.strictObject({
  id: Id,
  assertionIds: z.array(Id).min(2).max(16),
  reason: z.enum(CONFLICT_REASONS),
});

export const SupersessionSchema = z.strictObject({
  id: Id,
  supersededAssertionId: Id,
  supersedingAssertionId: Id,
  effectiveAt: Iso,
  reason: z.enum(SUPERSESSION_REASONS),
});

export const BundleSchema = z.strictObject({
  wwepVersion: z.literal(WWEP_VERSION),
  registryVersion: SafeText.max(64).optional(),
  rulesVersion: SafeText.max(64).optional(),
  sources: z.array(SourceSchema).max(LIMITS.sources),
  observations: z.array(ObservationSchema).max(LIMITS.observations),
  assertions: z.array(AssertionSchema).max(LIMITS.assertions),
  derivations: z.array(DerivationSchema).max(LIMITS.derivations),
  conflicts: z.array(ConflictSchema).max(LIMITS.conflicts).optional(),
  supersessions: z.array(SupersessionSchema).max(LIMITS.supersessions).optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;
export type Derivation = z.infer<typeof DerivationSchema>;
export type Bundle = z.infer<typeof BundleSchema>;
export type FlatRecordValue = z.infer<typeof FlatRecord>;

export const EvaluatedAtSchema = Iso;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * True if the raw value contains an object key that could target the prototype chain, or is too large or deep
 * to inspect. Runs on caller input before schema validation so such input is rejected, not silently stripped.
 */
export function hasForbiddenStructure(value: unknown): boolean {
  let nodes = 0;
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 12 || ++nodes > 20_000) return true;
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    for (const k of Object.getOwnPropertyNames(v)) {
      if (FORBIDDEN_KEYS.has(k)) return true;
      if (walk((v as Record<string, unknown>)[k], depth + 1)) return true;
    }
    return false;
  };
  return walk(value, 0);
}

export function parseBundleStrict(raw: unknown): ReturnType<typeof BundleSchema.safeParse> {
  if (hasForbiddenStructure(raw)) {
    return BundleSchema.safeParse(undefined);
  }
  return BundleSchema.safeParse(raw);
}

/** Field names that may appear in sanitized validation-error paths. Anything else is reported as "*". */
export const KNOWN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "bundle",
  "evaluatedAt",
  "assertionId",
  "identityAssertionId",
  "balanceAssertionId",
  "chainId",
  "address",
  "symbol",
  "wwepVersion",
  "registryVersion",
  "rulesVersion",
  "sources",
  "observations",
  "assertions",
  "derivations",
  "conflicts",
  "supersessions",
  "id",
  "kind",
  "authorityId",
  "transport",
  "retrievedVia",
  "independenceGroup",
  "sourceId",
  "origin",
  "observedAt",
  "finality",
  "result",
  "subject",
  "payload",
  "claimType",
  "temporality",
  "value",
  "observationIds",
  "derivationId",
  "assertedAt",
  "limitations",
  "declared",
  "supportState",
  "freshnessState",
  "finalityState",
  "independentCorroboration",
  "ruleId",
  "inputAssertionIds",
  "outputAssertionId",
  "assertionIds",
  "reason",
  "supersededAssertionId",
  "supersedingAssertionId",
  "effectiveAt",
  "token",
  "holder",
  "balanceAtomic",
  "decimals",
  "blockNumber",
  "blockHash",
]);
