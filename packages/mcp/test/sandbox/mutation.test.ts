import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { evaluateBundle } from "../../src/evaluate.ts";
import { checkInvariants } from "../../src/invariants.ts";
import { assessReadiness } from "../../src/readiness.ts";
import { parseBundleStrict, type Bundle } from "../../src/schemas.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, USDC, clone, golden, withUsdValue } from "../support/builders.ts";

interface Outcome {
  rejected: boolean;
  identity: string;
  balance: string;
  usd: string;
  readiness: string;
  violations: number;
}

function observe(raw: unknown, evaluatedAt = EVALUATED_AT): Outcome {
  const parsed = parseBundleStrict(raw);
  if (!parsed.success) return { rejected: true, identity: "-", balance: "-", usd: "-", readiness: "-", violations: 0 };
  const ev = evaluateBundle(parsed.data, evaluatedAt);
  const sup = (id: string): string => ev.assertions.find((a) => a.assertionId === id)?.supportState ?? "MISSING";
  return {
    rejected: false,
    identity: sup("a-identity"),
    balance: sup("a-balance"),
    usd: sup("a-usd"),
    readiness: assessReadiness(parsed.data, ev, "a-identity", "a-balance").classification,
    violations: checkInvariants(parsed.data, ev).length,
  };
}

const baseline = observe(withUsdValue(golden()));

type Mutate = (b: Bundle) => void;
const obs = (b: Bundle, id: string) => b.observations.find((o) => o.id === id)!;
const asr = (b: Bundle, id: string) => b.assertions.find((a) => a.id === id)!;
const OTHER = `0x${"99".repeat(20)}`;

const MUTATIONS: { field: string; name: string; apply: Mutate; at?: string }[] = [
  // chain ID
  { field: "chainId", name: "balance assertion chainId only", apply: (b) => { asr(b, "a-balance").subject = { ...asr(b, "a-balance").subject, chainId: "8453" }; } },
  { field: "chainId", name: "balance observation chainId only", apply: (b) => { obs(b, "obs-balance").subject = { ...obs(b, "obs-balance").subject, chainId: "8453" }; } },
  { field: "chainId", name: "identity moved to an unregistered chain", apply: (b) => { asr(b, "a-identity").subject = { chainId: "10", address: USDC }; obs(b, "obs-identity").subject = { chainId: "10", address: USDC }; } },
  // contract address
  { field: "contractAddress", name: "balance assertion token only", apply: (b) => { asr(b, "a-balance").subject = { ...asr(b, "a-balance").subject, token: OTHER }; } },
  { field: "contractAddress", name: "identity address replaced consistently", apply: (b) => { asr(b, "a-identity").subject = { chainId: "1", address: OTHER }; obs(b, "obs-identity").subject = { chainId: "1", address: OTHER }; } },
  { field: "contractAddress", name: "balance token replaced consistently (identity no longer matches)", apply: (b) => {
    const s = { chainId: "1", token: OTHER, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH };
    asr(b, "a-balance").subject = s; obs(b, "obs-balance").subject = s; } },
  { field: "contractAddress", name: "malformed address", apply: (b) => { asr(b, "a-balance").subject = { ...asr(b, "a-balance").subject, token: "0x1234" }; } },
  // decimals
  { field: "decimals", name: "balance assertion decimals only", apply: (b) => { asr(b, "a-balance").value = { balanceAtomic: "1500000", decimals: "18" }; } },
  { field: "decimals", name: "balance decimals consistently changed (registry disagrees)", apply: (b) => { asr(b, "a-balance").value = { balanceAtomic: "1500000", decimals: "18" }; obs(b, "obs-balance").payload = { balanceAtomic: "1500000", decimals: "18" }; } },
  { field: "decimals", name: "identity decimals consistently changed", apply: (b) => { asr(b, "a-identity").value = { symbol: "USDC", decimals: "18", issuerAuthorityId: "issuer:circle" }; obs(b, "obs-identity").payload = { symbol: "USDC", decimals: "18", issuerAuthorityId: "issuer:circle" }; } },
  { field: "decimals", name: "decimals out of range", apply: (b) => { asr(b, "a-balance").value = { balanceAtomic: "1500000", decimals: "99" }; obs(b, "obs-balance").payload = { balanceAtomic: "1500000", decimals: "99" }; } },
  // amount
  { field: "amount", name: "assertion amount only", apply: (b) => { asr(b, "a-balance").value = { balanceAtomic: "1500001", decimals: "6" }; } },
  { field: "amount", name: "observation amount only", apply: (b) => { obs(b, "obs-balance").payload = { balanceAtomic: "1500001", decimals: "6" }; } },
  { field: "amount", name: "amount made non-canonical", apply: (b) => { asr(b, "a-balance").value = { balanceAtomic: "01500000", decimals: "6" }; obs(b, "obs-balance").payload = { balanceAtomic: "01500000", decimals: "6" }; } },
  { field: "amount", name: "derived USD value tampered", apply: (b) => { asr(b, "a-usd").value = { usdScaled18: "1500150000000000001", rounding: "FLOOR_SCALED_18" }; } },
  // freshness
  { field: "freshness", name: "identity observation made old", apply: (b) => { obs(b, "obs-identity").observedAt = "2025-01-01T00:00:00Z"; } },
  { field: "freshness", name: "price observations made old", apply: (b) => { obs(b, "obs-price-a").observedAt = "2026-10-23T10:00:00Z"; obs(b, "obs-price-b").observedAt = "2026-10-23T10:00:00Z"; } },
  { field: "freshness", name: "evaluation time moved a year forward", apply: () => undefined, at: "2027-10-23T12:00:30Z" },
  { field: "freshness", name: "observation dated in the future", apply: (b) => { obs(b, "obs-price-a").observedAt = "2026-10-24T00:00:00Z"; obs(b, "obs-price-b").observedAt = "2026-10-24T00:00:00Z"; } },
  // finality
  { field: "finality", name: "balance made UNFINALIZED", apply: (b) => { obs(b, "obs-balance").finality = "UNFINALIZED"; } },
  { field: "finality", name: "balance finality made unknown", apply: (b) => { obs(b, "obs-balance").finality = "UNKNOWN_FINALITY"; } },
  // authority
  { field: "authority", name: "chain source retyped as provider endpoint", apply: (b) => { b.sources.find((s) => s.id === "src-chain")!.kind = "PROVIDER_ENDPOINT"; } },
  { field: "authority", name: "issuer authorityId swapped", apply: (b) => { b.sources.find((s) => s.id === "src-issuer")!.authorityId = "issuer:tether"; } },
  { field: "authority", name: "issuer attestation downgraded to provider origin", apply: (b) => { obs(b, "obs-identity").origin = "PROVIDER_OBSERVED"; } },
  { field: "authority", name: "balance observation downgraded to user supplied", apply: (b) => { obs(b, "obs-balance").origin = "USER_SUPPLIED"; } },
  { field: "authority", name: "derived assertion relabelled as chain observed", apply: (b) => { asr(b, "a-usd").origin = "CHAIN_OBSERVED"; } },
  { field: "authority", name: "declared support exceeds computed", apply: (b) => { asr(b, "a-usd").declared = { supportState: "ESTABLISHED" }; } },
  // dependency graph
  { field: "dependencyGraph", name: "observation reference removed", apply: (b) => { b.observations = b.observations.filter((o) => o.id !== "obs-balance"); } },
  { field: "dependencyGraph", name: "price dependency dropped from derivation", apply: (b) => { b.derivations[0]!.inputAssertionIds = ["a-balance"]; } },
  { field: "dependencyGraph", name: "balance dependency replaced by identity", apply: (b) => { b.derivations[0]!.inputAssertionIds = ["a-identity", "a-price"]; } },
  { field: "dependencyGraph", name: "derivation dropped", apply: (b) => { b.derivations = []; } },
  { field: "dependencyGraph", name: "self-dependency cycle", apply: (b) => { b.derivations[0]!.inputAssertionIds = ["a-usd", "a-balance", "a-price"]; } },
  { field: "dependencyGraph", name: "price observations deduplicated to one group", apply: (b) => { obs(b, "obs-price-b").sourceId = "src-prov-a"; } },
];

const killed = new Map<string, { killed: number; total: number }>();

describe("mutation tests: altered evidence is rejected or downgraded", () => {
  after(() => {
    console.log("\nMutation kill rate by altered field:");
    for (const [f, t] of [...killed.entries()].sort()) console.log(`  ${f.padEnd(16)} ${t.killed}/${t.total}`);
  });

  test("baseline is clean and fully supported", () => {
    assert.deepEqual(baseline, { rejected: false, identity: "ESTABLISHED", balance: "ESTABLISHED", usd: "SUPPORTED", readiness: "CRITERIA_MET", violations: 0 });
  });

  for (const m of MUTATIONS) {
    test(`${m.field}: ${m.name}`, () => {
      const b = withUsdValue(golden());
      m.apply(b);
      const out = observe(clone(b), m.at ?? EVALUATED_AT);
      const downgraded =
        out.rejected ||
        out.violations > 0 ||
        out.readiness !== "CRITERIA_MET" ||
        out.identity !== "ESTABLISHED" ||
        out.balance !== "ESTABLISHED" ||
        out.usd !== "SUPPORTED";
      const t = killed.get(m.field) ?? { killed: 0, total: 0 };
      t.total++;
      if (downgraded) t.killed++;
      killed.set(m.field, t);
      assert.ok(downgraded, `mutation was not detected: ${JSON.stringify(out)}`);
    });
  }

  test("every altered field named in the requirements is mutated", () => {
    const fields = new Set(MUTATIONS.map((m) => m.field));
    for (const f of ["chainId", "contractAddress", "decimals", "amount", "freshness", "finality", "authority", "dependencyGraph"]) {
      assert.ok(fields.has(f), f);
    }
  });
});
