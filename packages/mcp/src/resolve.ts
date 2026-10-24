import { DEFAULT_LOOKUP, REGISTRY_STATUS, REGISTRY_VERSION, findChain } from "./registry.ts";
import type { Asset, AssetLookup } from "./registry.ts";
import type { LimitationCode, SupportState } from "./schemas.ts";

export interface ResolveInput {
  chainId?: string | undefined;
  address?: string | undefined;
  symbol?: string | undefined;
}

export interface AssetView {
  symbol: string;
  name: string;
  chainId: string;
  address: string;
  decimals: string;
  issuerName: string;
  authorityId: string;
  verification: Asset["verification"];
}

export interface ResolveResult {
  resolution: "REGISTRY_MATCH" | "NOT_IN_REGISTRY" | "SYMBOL_CANDIDATES" | "NO_SYMBOL_MATCH" | "CHAIN_NOT_IN_REGISTRY";
  supportState: SupportState;
  origin: "WALLETWALL_DERIVED";
  registry: { version: string; status: string };
  asset: AssetView | null;
  candidates: AssetView[];
  limitations: LimitationCode[];
  notes: string[];
}

const view = (a: Asset): AssetView => ({
  symbol: a.symbol,
  name: a.name,
  chainId: a.chainId,
  address: a.address,
  decimals: a.decimals,
  issuerName: a.issuerName,
  authorityId: a.authorityId,
  verification: a.verification,
});

/**
 * Registry lookup only. The result is WALLETWALL_DERIVED and carries no issuer attestation, so it can be at most
 * PARTIAL. Symbol lookups never return a single identity because symbols are not unique identifiers.
 */
export function resolveAsset(input: ResolveInput, lookup: AssetLookup = DEFAULT_LOOKUP): ResolveResult {
  const { findAsset, findAssetsBySymbol, findExcluded } = lookup;
  const base = { origin: "WALLETWALL_DERIVED" as const, registry: { version: REGISTRY_VERSION, status: REGISTRY_STATUS } };
  const snapshot: LimitationCode = "REGISTRY_VERIFIED_POINT_IN_TIME";

  if (input.address !== undefined && input.chainId !== undefined) {
    if (findChain(input.chainId) === undefined) {
      return {
        ...base,
        resolution: "CHAIN_NOT_IN_REGISTRY",
        supportState: "NOT_ESTABLISHED",
        asset: null,
        candidates: [],
        limitations: ["CHAIN_NOT_IN_REGISTRY"],
        notes: [],
      };
    }
    const hit = findAsset(input.chainId, input.address);
    if (hit === undefined) {
      const excluded = findExcluded(input.chainId, input.address) !== undefined;
      return {
        ...base,
        resolution: "NOT_IN_REGISTRY",
        supportState: "NOT_ESTABLISHED",
        asset: null,
        candidates: [],
        limitations: ["NOT_IN_REGISTRY"],
        notes: [
          excluded
            ? "A registry record exists for this address but its identity is not authority-attested, so it is excluded from the factual registry."
            : "Absence from the registry does not mean the contract is fraudulent; it means WalletWall has no identity for it.",
        ],
      };
    }
    return {
      ...base,
      resolution: "REGISTRY_MATCH",
      supportState: "PARTIAL",
      asset: view(hit),
      candidates: [],
      limitations: [snapshot, "NO_AUTHORITATIVE_OBSERVATION"],
      notes: [
        `Registry match only. The record was verified against an authority publication on ${hit.verification.verifiedAt}; no issuer attestation was presented with this query, so identity is not ESTABLISHED.`,
      ],
    };
  }

  const matches = findAssetsBySymbol(input.symbol ?? "", input.chainId);
  if (matches.length === 0) {
    return {
      ...base,
      resolution: "NO_SYMBOL_MATCH",
      supportState: "NOT_ESTABLISHED",
      asset: null,
      candidates: [],
      limitations: ["NOT_IN_REGISTRY", "SYMBOL_NOT_AUTHORITY"],
      notes: ["A symbol is not an identity. Identify assets by chain ID and contract address."],
    };
  }
  return {
    ...base,
    resolution: "SYMBOL_CANDIDATES",
    supportState: "PARTIAL",
    asset: null,
    candidates: matches.map(view),
    limitations: [snapshot, "SYMBOL_NOT_AUTHORITY"],
    notes: ["Symbols are not unique. Spoofed tokens reuse symbols. Confirm chain ID and contract address before relying on any candidate."],
  };
}
