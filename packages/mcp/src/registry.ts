import { z } from "zod";
import chainsJson from "../registry/chains.json" with { type: "json" };
import stablecoinsJson from "../registry/stablecoins.json" with { type: "json" };
import policiesJson from "../authority-policies/policies.json" with { type: "json" };
import { evidenceDigest } from "./canonical.ts";
import { ADDRESS_RE, CHAIN_ID_RE, ClaimTypeSchema, HASH_RE, ISO_RE, OriginSchema, SupportStateSchema } from "./schemas.ts";
import type { ClaimType } from "./schemas.ts";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Digits = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);

const ChainVerificationSchema = z.strictObject({
  status: z.literal("CHAIN_OBSERVED"),
  verifiedAt: DateOnly,
  method: z.literal("eth_chainId"),
  observedValue: z.string().regex(CHAIN_ID_RE),
});
const ChainSchema = z
  .strictObject({
    chainId: z.string().regex(CHAIN_ID_RE),
    name: z.string().max(64),
    finalityModel: z.string().max(64),
    verification: ChainVerificationSchema,
  })
  .refine((c) => c.verification.observedValue === c.chainId, { message: "observed chain ID differs from the record" });
const ChainsFile = z.strictObject({
  registryVersion: z.string(),
  status: z.literal("VERIFIED_POINT_IN_TIME"),
  note: z.string(),
  chains: z.array(ChainSchema),
});

/** What the issuer or protocol itself published about the deployment address. */
const IdentitySourceSchema = z.strictObject({
  class: z.literal("AUTHORITY_ATTESTED"),
  authorityId: z.string().max(64),
  publisher: z.string().max(64),
  url: z.string().regex(/^https:\/\/[a-z0-9.-]+\/[^\s"']*$/).max(256),
  locator: z.string().max(160),
  publishedAddress: z.string().regex(ADDRESS_RE),
  retrievedAt: DateOnly,
});
/** A value read from chain state at a finalized block. Symbol and name are deliberately not recorded as identity evidence. */
const DecimalsObservationSchema = z.strictObject({
  class: z.literal("CHAIN_OBSERVED"),
  chainId: z.string().regex(CHAIN_ID_RE),
  blockNumber: Digits,
  blockHash: z.string().regex(HASH_RE),
  blockTimestamp: z.string().regex(ISO_RE),
  finality: z.literal("FINALIZED"),
  method: z.literal("eth_call decimals()"),
  observedValue: z.string().regex(/^[0-9]{1,2}$/),
});
export const RECORD_STATUSES = ["AUTHORITY_ATTESTED", "NOT_ESTABLISHED", "FIXTURE_ONLY"] as const;
const AssetVerificationSchema = z.strictObject({
  status: z.enum(RECORD_STATUSES),
  verifiedAt: DateOnly,
  identity: IdentitySourceSchema.nullable(),
  decimals: DecimalsObservationSchema.nullable(),
});
const AssetSchema = z
  .strictObject({
    symbol: z.string().max(16),
    name: z.string().max(64),
    chainId: z.string().regex(CHAIN_ID_RE),
    address: z.string().regex(ADDRESS_RE),
    decimals: z.string().regex(/^[0-9]{1,2}$/),
    issuerName: z.string().max(64),
    authorityId: z.string().max(64),
    verification: AssetVerificationSchema,
  })
  .superRefine((a, ctx) => {
    if (a.address !== a.address.toLowerCase()) ctx.addIssue({ code: "custom", message: "address must be stored lowercase" });
    if (a.verification.status !== "AUTHORITY_ATTESTED") return;
    const { identity, decimals } = a.verification;
    if (identity === null || identity.authorityId !== a.authorityId || identity.publishedAddress.toLowerCase() !== a.address) {
      ctx.addIssue({ code: "custom", message: "an attested record needs an authority publication that names this exact address" });
    }
    if (decimals === null || decimals.chainId !== a.chainId || decimals.observedValue !== a.decimals) {
      ctx.addIssue({ code: "custom", message: "an attested record needs a finalized decimals observation on its own chain that agrees with it" });
    }
  });
const StablecoinsFile = z.strictObject({
  registryVersion: z.string(),
  status: z.literal("VERIFIED_POINT_IN_TIME"),
  note: z.string(),
  assets: z.array(AssetSchema),
});

const PolicySchema = z.strictObject({
  policyId: z.string(),
  claimType: ClaimTypeSchema,
  authority: z.strictObject({
    authorityId: z.string(),
    kind: z.enum(["ISSUER_PUBLICATION", "CANONICAL_CHAIN_STATE", "WALLETWALL_RULES", "NONE"]),
    description: z.string(),
  }),
  authoritativeOrigins: z.array(OriginSchema),
  authorityIdSource: z.enum(["REGISTRY", "NONE"]),
  corroboratingOrigins: z.array(OriginSchema),
  maxSupportWithoutAuthority: SupportStateSchema,
  requiresFinality: z.boolean(),
  finalityApplies: z.boolean(),
  maxAgeSeconds: z.number().int().positive().nullable(),
  minIndependentCorroboration: z.number().int().positive(),
  requiredDependencyClaimTypes: z.array(ClaimTypeSchema),
  derived: z.boolean(),
  subjectKeys: z.array(z.string()),
  supersessionKeys: z.array(z.string()),
  valueKeys: z.array(z.string()),
  ruleId: z.string().nullable(),
});
const PoliciesFile = z.strictObject({
  policiesVersion: z.string(),
  note: z.string(),
  policies: z.array(PolicySchema),
  rules: z.array(z.strictObject({ ruleId: z.string(), rulesVersion: z.string() })),
});

export type Asset = z.infer<typeof AssetSchema>;
export type Chain = z.infer<typeof ChainSchema>;
export type Policy = z.infer<typeof PolicySchema>;

/**
 * Only records whose identity is attested by the issuer or protocol itself are part of the factual registry.
 * Anything else (NOT_ESTABLISHED, FIXTURE_ONLY) is kept in the file for transparency but is never used for a lookup
 * or a cross-check, so an unverified record can never be treated as canonical.
 */
export function partitionAssets(assets: readonly Asset[]): { established: Asset[]; excluded: Asset[] } {
  return {
    established: assets.filter((a) => a.verification.status === "AUTHORITY_ATTESTED"),
    excluded: assets.filter((a) => a.verification.status !== "AUTHORITY_ATTESTED"),
  };
}

const chainsFile = ChainsFile.parse(chainsJson);
const stablecoinsFile = StablecoinsFile.parse(stablecoinsJson);
const policiesFile = PoliciesFile.parse(policiesJson);

export const REGISTRY_VERSION: string = stablecoinsFile.registryVersion;
export const REGISTRY_STATUS = stablecoinsFile.status;
export const POLICIES_VERSION: string = policiesFile.policiesVersion;
export const RULES_VERSION = "0.1.0-draft";

const partitioned = partitionAssets(stablecoinsFile.assets);
export const CHAINS: readonly Chain[] = chainsFile.chains;
export const ASSETS: readonly Asset[] = partitioned.established;
export const EXCLUDED_ASSETS: readonly Asset[] = partitioned.excluded;
export const RULES: readonly { ruleId: string; rulesVersion: string }[] = policiesFile.rules;

const policyByClaim = new Map<ClaimType, Policy>(policiesFile.policies.map((p) => [p.claimType, p]));

export function getPolicy(claimType: ClaimType): Policy | undefined {
  return policyByClaim.get(claimType);
}

export function allPolicies(): readonly Policy[] {
  return policiesFile.policies;
}

export function findChain(chainId: string): Chain | undefined {
  return CHAINS.find((c) => c.chainId === chainId);
}

export interface AssetLookup {
  findAsset: (chainId: string, address: string) => Asset | undefined;
  /** A record that exists in the registry file but was not verified, so it is excluded from lookups. */
  findExcluded: (chainId: string, address: string) => Asset | undefined;
  findAssetsBySymbol: (symbol: string, chainId?: string) => Asset[];
}

/** Builds the lookup functions over a set of records; only authority-attested records are ever returned as canonical. */
export function lookupFrom(records: readonly Asset[]): AssetLookup {
  const { established, excluded } = partitionAssets(records);
  const at = (set: readonly Asset[], chainId: string, address: string): Asset | undefined => {
    const a = address.toLowerCase();
    return set.find((x) => x.chainId === chainId && x.address === a);
  };
  return {
    findAsset: (chainId, address) => at(established, chainId, address),
    findExcluded: (chainId, address) => at(excluded, chainId, address),
    findAssetsBySymbol: (symbol, chainId) => {
      const s = symbol.toUpperCase();
      return established.filter((x) => x.symbol.toUpperCase() === s && (chainId === undefined || x.chainId === chainId));
    },
  };
}

export const DEFAULT_LOOKUP: AssetLookup = lookupFrom(stablecoinsFile.assets);
export const findAsset = DEFAULT_LOOKUP.findAsset;
export const findExcluded = DEFAULT_LOOKUP.findExcluded;
export const findAssetsBySymbol = DEFAULT_LOOKUP.findAssetsBySymbol;

export const StablecoinsFileSchema = StablecoinsFile;
export const ChainsFileSchema = ChainsFile;

export function ruleKnown(ruleId: string, rulesVersion: string): boolean {
  return RULES.some((r) => r.ruleId === ruleId && r.rulesVersion === rulesVersion);
}

export function registryDigest(): string {
  return evidenceDigest({ chains: chainsFile, assets: stablecoinsFile });
}

export function policiesDigest(): string {
  return evidenceDigest(policiesFile, { numbers: "jcs" });
}

export function rawRegistry(): { stablecoins: unknown; chains: unknown } {
  return { stablecoins: stablecoinsFile, chains: chainsFile };
}

export function rawPolicies(): unknown {
  return policiesFile;
}
