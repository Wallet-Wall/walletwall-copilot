import type { Assertion, Bundle, Observation } from "../../src/schemas.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, USDC } from "../../src/examples.ts";

/**
 * The synthetic fixtures live in the engine (`src/examples.ts`) because the same objects are served as the
 * `walletwall://examples/*` resources; this module re-exports them for the test corpus and adds test-only helpers.
 */
export {
  BLOCK_HASH,
  BLOCK_NUMBER,
  EVALUATED_AT,
  HOLDER,
  OBSERVED_AT,
  SOURCES,
  USDC,
  balanceAssertion,
  balanceObservation,
  golden,
  identityAssertion,
  identityObservation,
  priceAssertion,
  priceObservation,
} from "../../src/examples.ts";

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
