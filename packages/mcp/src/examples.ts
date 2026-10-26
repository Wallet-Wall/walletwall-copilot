import type { Assertion, Bundle, ClaimType, Observation, Source } from "./schemas.ts";

/**
 * Synthetic, deterministic evidence shared by the conformance corpus, the canvas fixtures and the published
 * `walletwall://examples/*` resources. Nothing here is a claim about any real wallet, balance or chain state: the holder,
 * block, block hash, balance and timestamps are invented. The contract address, symbol, decimals and issuer authority are
 * the bundled registry's public record for the deployment, which is what lets the identity be ESTABLISHED.
 */

export const EVALUATED_AT = "2026-10-23T12:00:30Z";
export const OBSERVED_AT = "2026-10-23T12:00:00Z";

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const HOLDER = "0x1234567890123456789012345678901234567890";
export const BLOCK_HASH = `0x${"ab".repeat(32)}`;
export const BLOCK_NUMBER = "21000000";

export const SOURCES: Record<string, Source> = {
  chain: { id: "src-chain", kind: "CHAIN_STATE", transport: { retrievedVia: "Alchemy" }, independenceGroup: "grp-chain" },
  issuer: { id: "src-issuer", kind: "ISSUER_PUBLICATION", authorityId: "issuer:circle", independenceGroup: "grp-issuer" },
  provA: { id: "src-prov-a", kind: "PROVIDER_ENDPOINT", transport: { retrievedVia: "ProviderA" }, independenceGroup: "grp-a" },
  provB: { id: "src-prov-b", kind: "PROVIDER_ENDPOINT", transport: { retrievedVia: "ProviderB" }, independenceGroup: "grp-b" },
  user: { id: "src-user", kind: "USER_INPUT", independenceGroup: "grp-user" },
};

const source = (key: string): Source => structuredClone(SOURCES[key] as Source);

/** The chain-state source used by the published examples: the transport label is a placeholder, not a real provider. */
const publishedChainSource = (): Source => ({ ...source("chain"), transport: { retrievedVia: "ExampleRpcProvider" } });

export const identityObservation = (over: Partial<Observation> = {}): Observation => ({
  id: "obs-identity",
  sourceId: "src-issuer",
  origin: "AUTHORITY_ATTESTED",
  observedAt: OBSERVED_AT,
  finality: "UNKNOWN_FINALITY",
  result: "VALUE",
  subject: { chainId: "1", address: USDC },
  payload: { symbol: "USDC", decimals: "6", issuerAuthorityId: "issuer:circle" },
  ...over,
});

export const balanceObservation = (over: Partial<Observation> = {}): Observation => ({
  id: "obs-balance",
  sourceId: "src-chain",
  origin: "CHAIN_OBSERVED",
  observedAt: OBSERVED_AT,
  finality: "FINALIZED",
  result: "VALUE",
  subject: { chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
  payload: { balanceAtomic: "1500000", decimals: "6" },
  ...over,
});

export const priceObservation = (id: string, sourceId: string, price = "1.0001"): Observation => ({
  id,
  sourceId,
  origin: "PROVIDER_OBSERVED",
  observedAt: OBSERVED_AT,
  finality: "UNKNOWN_FINALITY",
  result: "VALUE",
  subject: { chainId: "1", token: USDC },
  payload: { priceUsd: price },
});

export const identityAssertion = (over: Partial<Assertion> = {}): Assertion => ({
  id: "a-identity",
  claimType: "ASSET_IDENTITY",
  origin: "AUTHORITY_ATTESTED",
  temporality: "CURRENT",
  subject: { chainId: "1", address: USDC },
  value: { symbol: "USDC", decimals: "6", issuerAuthorityId: "issuer:circle" },
  observationIds: ["obs-identity"],
  assertedAt: OBSERVED_AT,
  ...over,
});

export const balanceAssertion = (over: Partial<Assertion> = {}): Assertion => ({
  id: "a-balance",
  claimType: "TOKEN_BALANCE_AT_BLOCK",
  origin: "CHAIN_OBSERVED",
  temporality: "PINNED",
  subject: { chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
  value: { balanceAtomic: "1500000", decimals: "6" },
  observationIds: ["obs-balance"],
  assertedAt: OBSERVED_AT,
  ...over,
});

export const priceAssertion = (over: Partial<Assertion> = {}): Assertion => ({
  id: "a-price",
  claimType: "TOKEN_USD_PRICE",
  origin: "PROVIDER_OBSERVED",
  temporality: "CURRENT",
  subject: { chainId: "1", token: USDC },
  value: { priceUsd: "1.0001" },
  observationIds: ["obs-price-a", "obs-price-b"],
  assertedAt: OBSERVED_AT,
  ...over,
});

/** A bundle in which identity and balance are ESTABLISHED, price is SUPPORTED, and valuations are derived. */
export function golden(): Bundle {
  return {
    wwepVersion: "0.1",
    sources: [source("chain"), source("issuer"), source("provA"), source("provB")],
    observations: [identityObservation(), balanceObservation(), priceObservation("obs-price-a", "src-prov-a"), priceObservation("obs-price-b", "src-prov-b")],
    assertions: [identityAssertion(), balanceAssertion(), priceAssertion()],
    derivations: [],
  };
}

/** The smallest bundle in which the identity is ESTABLISHED: one issuer source, one attested observation, one assertion. */
export function identityBundle(): Bundle {
  return { wwepVersion: "0.1", sources: [source("issuer")], observations: [identityObservation()], assertions: [identityAssertion()], derivations: [] };
}

/** The smallest bundle in which a balance is ESTABLISHED: one chain-state source, one finalized observation, one assertion. */
export function balanceBundle(): Bundle {
  return { wwepVersion: "0.1", sources: [publishedChainSource()], observations: [balanceObservation()], assertions: [balanceAssertion()], derivations: [] };
}

/** Identity and balance together: every VAULT_TECHNICAL_READINESS criterion is met. */
export function readinessBundle(): Bundle {
  return {
    wwepVersion: "0.1",
    sources: [source("issuer"), publishedChainSource()],
    observations: [identityObservation(), balanceObservation()],
    assertions: [identityAssertion(), balanceAssertion()],
    derivations: [],
  };
}

/**
 * The same balance, but the identity is only read from chain state: no issuer attestation exists, so the identity is
 * PARTIAL and readiness stays NOT_ESTABLISHED. The bundle is complete and well-formed; the evidence is incomplete.
 */
export function incompleteReadinessBundle(): Bundle {
  return {
    wwepVersion: "0.1",
    sources: [publishedChainSource()],
    observations: [identityObservation({ id: "obs-identity-chain", sourceId: "src-chain", origin: "CHAIN_OBSERVED" }), balanceObservation()],
    assertions: [identityAssertion({ origin: "CHAIN_OBSERVED", observationIds: ["obs-identity-chain"] }), balanceAssertion()],
    derivations: [],
  };
}

export type ExampleName = "identity-established" | "balance-established" | "vault-readiness-established" | "vault-readiness-not-established";

export interface PublishedExample {
  name: ExampleName;
  title: string;
  demonstrates: string;
  /** The claim type whose contract this example illustrates; readiness examples illustrate VAULT_TECHNICAL_READINESS. */
  claimType: ClaimType;
  toolCall: { name: "inspect_evidence" | "assess_vault_readiness"; arguments: Record<string, unknown> };
  /** For an incomplete example: the smallest observation that could change the outcome. */
  missingMeasurement: string | null;
}

export const SYNTHETIC_NOTICE =
  "Synthetic, illustrative evidence published by the WalletWall engine for consumers of the MCP contract. The holder address, block number, block hash, balance, timestamps, source ids, independence groups and the transport label are invented placeholders; no provider served these readings. The contract address, symbol, decimals and issuer authority are copied from the bundled registry record for the deployment so that the identity can be established. Nothing here is a claim about any real wallet, balance or chain state, and the expected states describe evidence sufficiency under the published policies, not truth.";

export const PUBLISHED_EXAMPLES: readonly PublishedExample[] = [
  {
    name: "identity-established",
    title: "Established asset identity (synthetic)",
    demonstrates: "The exact ASSET_IDENTITY assertion and attesting observation shape that evaluates to ESTABLISHED against the registry.",
    claimType: "ASSET_IDENTITY",
    toolCall: { name: "inspect_evidence", arguments: { bundle: identityBundle(), evaluatedAt: EVALUATED_AT } },
    missingMeasurement: null,
  },
  {
    name: "balance-established",
    title: "Established balance at a finalized block (synthetic)",
    demonstrates: "The exact TOKEN_BALANCE_AT_BLOCK assertion and chain-state observation shape that evaluates to ESTABLISHED and FINALIZED.",
    claimType: "TOKEN_BALANCE_AT_BLOCK",
    toolCall: { name: "inspect_evidence", arguments: { bundle: balanceBundle(), evaluatedAt: EVALUATED_AT } },
    missingMeasurement: null,
  },
  {
    name: "vault-readiness-established",
    title: "Vault technical readiness: CRITERIA_MET (synthetic)",
    demonstrates: "A complete assess_vault_readiness call over an established identity and an established balance that classifies as CRITERIA_MET.",
    claimType: "VAULT_TECHNICAL_READINESS",
    toolCall: {
      name: "assess_vault_readiness",
      arguments: { bundle: readinessBundle(), evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" },
    },
    missingMeasurement: null,
  },
  {
    name: "vault-readiness-not-established",
    title: "Vault technical readiness: NOT_ESTABLISHED (synthetic, incomplete evidence)",
    demonstrates:
      "A well-formed assess_vault_readiness call whose identity is only chain-observed: no issuer attestation exists, the identity is PARTIAL and readiness fails closed to NOT_ESTABLISHED.",
    claimType: "VAULT_TECHNICAL_READINESS",
    toolCall: {
      name: "assess_vault_readiness",
      arguments: { bundle: incompleteReadinessBundle(), evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" },
    },
    missingMeasurement:
      "An AUTHORITY_ATTESTED observation of the identity from an ISSUER_PUBLICATION source whose authorityId equals the registry authorityId for the deployment.",
  },
];

export const EXAMPLE_URI_PREFIX = "walletwall://examples/";

export const EXAMPLE_BY_CLAIM: Readonly<Partial<Record<ClaimType, string>>> = {
  ASSET_IDENTITY: `${EXAMPLE_URI_PREFIX}identity-established`,
  TOKEN_BALANCE_AT_BLOCK: `${EXAMPLE_URI_PREFIX}balance-established`,
  VAULT_TECHNICAL_READINESS: `${EXAMPLE_URI_PREFIX}vault-readiness-established`,
};
