import type { Assertion, Bundle, Observation, Source } from "../../src/schemas.ts";

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
    sources: [SOURCES["chain"] as Source, SOURCES["issuer"] as Source, SOURCES["provA"] as Source, SOURCES["provB"] as Source],
    observations: [
      identityObservation(),
      balanceObservation(),
      priceObservation("obs-price-a", "src-prov-a"),
      priceObservation("obs-price-b", "src-prov-b"),
    ],
    assertions: [identityAssertion(), balanceAssertion(), priceAssertion()],
    derivations: [],
  };
}

export function withUsdValue(bundle: Bundle): Bundle {
  const b = structuredClone(bundle);
  b.derivations.push({
    id: "d-usd",
    ruleId: "wwdr.usd-value",
    rulesVersion: "0.1.0-draft",
    inputAssertionIds: ["a-balance", "a-price"],
    outputAssertionId: "a-usd",
  });
  b.assertions.push({
    id: "a-usd",
    claimType: "TOKEN_USD_VALUE",
    origin: "WALLETWALL_DERIVED",
    temporality: "PINNED",
    subject: { chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH },
    value: { usdScaled18: "1500150000000000000", rounding: "FLOOR_SCALED_18" },
    observationIds: [],
    derivationId: "d-usd",
    assertedAt: EVALUATED_AT,
    limitations: [
      "NO_AUTHORITATIVE_OBSERVATION",
      "PRICE_IS_PROVIDER_OBSERVATION",
      "REGISTRY_VERIFIED_POINT_IN_TIME",
      "TRANSPORT_FIDELITY_NOT_VERIFIED",
      "WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY",
    ],
  });
  return b;
}

export const clone = <T>(v: T): T => structuredClone(v);

export function replaceAssertion(b: Bundle, id: string, patch: Partial<Assertion>): Bundle {
  const out = clone(b);
  out.assertions = out.assertions.map((a) => (a.id === id ? { ...a, ...patch } : a));
  return out;
}

export function replaceObservation(b: Bundle, id: string, patch: Partial<Observation>): Bundle {
  const out = clone(b);
  out.observations = out.observations.map((o) => (o.id === id ? { ...o, ...patch } : o));
  return out;
}
