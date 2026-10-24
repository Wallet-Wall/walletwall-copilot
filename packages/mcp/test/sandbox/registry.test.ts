import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ASSETS, CHAINS, EXCLUDED_ASSETS, ChainsFileSchema, StablecoinsFileSchema, lookupFrom, partitionAssets, rawRegistry } from "../../src/registry.ts";
import type { Asset } from "../../src/registry.ts";
import { resolveAsset } from "../../src/resolve.ts";
import { callTool } from "../../src/tools.ts";

const AUTHORITY_HOSTS: Record<string, string> = {
  "issuer:circle": "developers.circle.com",
  "issuer:tether": "tether.to",
  "protocol:sky": "chainlog.sky.money",
};
const first = (): Asset => structuredClone(ASSETS[0]) as Asset;
const withStatus = (a: Asset, status: Asset["verification"]["status"]): Asset => ({ ...structuredClone(a), verification: { ...structuredClone(a.verification), status } });

describe("registry verification (every factual record carries authority provenance)", () => {
  test("all five seed records were verified, none was silently kept as canonical without evidence", () => {
    assert.equal(ASSETS.length, 5);
    assert.deepEqual(EXCLUDED_ASSETS, []);
    assert.deepEqual(
      ASSETS.map((a) => `${a.symbol}@${a.chainId}`),
      ["USDC@1", "USDC@8453", "USDC@42161", "USDT@1", "DAI@1"],
    );
  });

  test("identity is attested by the issuer or protocol itself, at the exact address, never by symbol or name", () => {
    for (const a of ASSETS) {
      const v = a.verification;
      assert.equal(v.status, "AUTHORITY_ATTESTED");
      assert.match(v.verifiedAt, /^2026-10-24$/);
      assert.ok(v.identity !== null);
      assert.equal(v.identity.class, "AUTHORITY_ATTESTED");
      assert.equal(v.identity.authorityId, a.authorityId);
      assert.equal(v.identity.publishedAddress.toLowerCase(), a.address);
      assert.equal(new URL(v.identity.url).hostname, AUTHORITY_HOSTS[a.authorityId], `${a.symbol}@${a.chainId} source host`);
      assert.ok(v.identity.locator.length > 0);
      assert.deepEqual(Object.keys(v.identity).sort(), ["authorityId", "class", "locator", "publishedAddress", "publisher", "retrievedAt", "url"]);
    }
  });

  test("decimals come from a finalized chain observation on the record's own chain and agree with the record", () => {
    for (const a of ASSETS) {
      const d = a.verification.decimals;
      assert.ok(d !== null);
      assert.equal(d.class, "CHAIN_OBSERVED");
      assert.equal(d.finality, "FINALIZED");
      assert.equal(d.chainId, a.chainId);
      assert.equal(d.observedValue, a.decimals);
      assert.match(d.blockHash, /^0x[0-9a-f]{64}$/);
      assert.match(d.blockNumber, /^[1-9][0-9]*$/);
    }
  });

  test("record identity is the (chain, address) pair: no two records share it and addresses are lowercase", () => {
    const keys = ASSETS.map((a) => `${a.chainId}:${a.address}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const a of ASSETS) assert.equal(a.address, a.address.toLowerCase());
  });

  test("chains carry an observed chain ID, and the finality model stays a descriptive label", () => {
    for (const c of CHAINS) {
      assert.equal(c.verification.status, "CHAIN_OBSERVED");
      assert.equal(c.verification.observedValue, c.chainId);
    }
  });

  test("a record that does not carry its evidence is rejected by the schema, not loaded", () => {
    const file = structuredClone(rawRegistry().stablecoins) as { assets: Record<string, unknown>[] };
    assert.ok(StablecoinsFileSchema.safeParse(file).success);

    const noVerification = structuredClone(file);
    delete noVerification.assets[0]?.["verification"];
    assert.ok(!StablecoinsFileSchema.safeParse(noVerification).success);

    const otherAddress = structuredClone(file) as { assets: { verification: { identity: { publishedAddress: string } } }[] };
    otherAddress.assets[0]!.verification.identity.publishedAddress = "0x0000000000000000000000000000000000000001";
    assert.ok(!StablecoinsFileSchema.safeParse(otherAddress).success, "an authority publication for a different address does not attest this record");

    const otherAuthority = structuredClone(file) as { assets: { authorityId: string }[] };
    otherAuthority.assets[0]!.authorityId = "issuer:someone-else";
    assert.ok(!StablecoinsFileSchema.safeParse(otherAuthority).success);

    const wrongDecimals = structuredClone(file) as { assets: { decimals: string }[] };
    wrongDecimals.assets[0]!.decimals = "18";
    assert.ok(!StablecoinsFileSchema.safeParse(wrongDecimals).success, "decimals must agree with the finalized observation");

    const wrongChain = structuredClone(file) as { assets: { verification: { decimals: { chainId: string } } }[] };
    wrongChain.assets[0]!.verification.decimals.chainId = "8453";
    assert.ok(!StablecoinsFileSchema.safeParse(wrongChain).success, "an observation on another chain does not count");

    const unfinalized = structuredClone(file) as { assets: { verification: { decimals: { finality: string } } }[] };
    unfinalized.assets[0]!.verification.decimals.finality = "UNFINALIZED";
    assert.ok(!StablecoinsFileSchema.safeParse(unfinalized).success);

    const mixedCase = structuredClone(file) as { assets: { address: string }[] };
    mixedCase.assets[0]!.address = mixedCase.assets[0]!.address.replace("a", "A");
    assert.ok(!StablecoinsFileSchema.safeParse(mixedCase).success);

    const extra = structuredClone(file);
    extra.assets[0]!["owner"] = "someone";
    assert.ok(!StablecoinsFileSchema.safeParse(extra).success, "no field outside the schema is accepted");

    const chains = structuredClone(rawRegistry().chains) as { chains: { verification: { observedValue: string } }[] };
    assert.ok(ChainsFileSchema.safeParse(chains).success);
    chains.chains[0]!.verification.observedValue = "5";
    assert.ok(!ChainsFileSchema.safeParse(chains).success);
  });

  test("a record that is NOT_ESTABLISHED or FIXTURE_ONLY is excluded from the factual registry", () => {
    for (const status of ["NOT_ESTABLISHED", "FIXTURE_ONLY"] as const) {
      const rec = withStatus(first(), status);
      const part = partitionAssets([rec, ...ASSETS.slice(1)]);
      assert.equal(part.established.length, ASSETS.length - 1);
      assert.equal(part.excluded.length, 1);

      const lookup = lookupFrom([rec]);
      assert.equal(lookup.findAsset(rec.chainId, rec.address), undefined);
      assert.equal(lookup.findAssetsBySymbol(rec.symbol).length, 0);
      assert.ok(lookup.findExcluded(rec.chainId, rec.address) !== undefined);

      const r = resolveAsset({ chainId: rec.chainId, address: rec.address }, lookup);
      assert.equal(r.resolution, "NOT_IN_REGISTRY");
      assert.equal(r.supportState, "NOT_ESTABLISHED");
      assert.equal(r.asset, null);
      assert.ok(/not authority-attested/.test(r.notes.join(" ")));

      const bySymbol = resolveAsset({ symbol: rec.symbol }, lookup);
      assert.equal(bySymbol.resolution, "NO_SYMBOL_MATCH");
      assert.deepEqual(bySymbol.candidates, []);
    }
  });

  test("resolve_asset reports the verification record, stays PARTIAL, and never claims the asset is safe", () => {
    const out = callTool("resolve_asset", { chainId: "1", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" });
    assert.ok(out.ok);
    const r = out.result as ReturnType<typeof resolveAsset>;
    assert.equal(r.resolution, "REGISTRY_MATCH");
    assert.equal(r.supportState, "PARTIAL");
    assert.equal(r.asset?.verification.status, "AUTHORITY_ATTESTED");
    assert.ok(r.limitations.includes("REGISTRY_VERIFIED_POINT_IN_TIME"));
    assert.ok(r.limitations.includes("NO_AUTHORITATIVE_OBSERVATION"));
    assert.ok(!r.limitations.includes("REGISTRY_SEED_UNREVIEWED" as never));
    assert.ok(!/safe|guarantee|audited|solvent/i.test(r.notes.join(" ")));
  });

  test("a symbol alone is never identity: candidates are listed, no asset is returned", () => {
    const r = resolveAsset({ symbol: "USDC" });
    assert.equal(r.asset, null);
    assert.equal(r.candidates.length, 3);
    assert.ok(r.limitations.includes("SYMBOL_NOT_AUTHORITY"));
  });
});
