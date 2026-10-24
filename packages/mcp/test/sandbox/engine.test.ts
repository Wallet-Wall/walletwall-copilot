import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WwError } from "../../src/errors.ts";
import { evaluateBundle } from "../../src/evaluate.ts";
import { checkInvariants } from "../../src/invariants.ts";
import { normalizeObservation } from "../../src/normalize.ts";
import { traceProvenance } from "../../src/provenance.ts";
import { assessReadiness } from "../../src/readiness.ts";
import { resolveAsset } from "../../src/resolve.ts";
import { BundleSchema } from "../../src/schemas.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, USDC, clone, golden, replaceAssertion, replaceObservation, withUsdValue } from "../support/builders.ts";

const parse = (b: unknown) => BundleSchema.parse(b);

function readiness(b: unknown) {
  const bundle = parse(b);
  const ev = evaluateBundle(bundle, EVALUATED_AT);
  return assessReadiness(bundle, ev, "a-identity", "a-balance");
}

describe("vault technical readiness", () => {
  test("golden evidence meets the technical criteria, with the non-implications stated", () => {
    const r = readiness(golden());
    assert.equal(r.classification, "CRITERIA_MET");
    assert.equal(r.criteria.length, 6);
    assert.ok(r.criteria.every((c) => c.outcome === "MET"));
    assert.deepEqual(
      [...r.doesNotEstablish],
      ["investment merit", "solvency", "creditworthiness", "legal status", "regulatory compliance", "absence of fraud", "future performance"],
    );
    assert.ok(r.limitations.includes("WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY"));
    assert.ok(r.limitations.includes("TRANSPORT_FIDELITY_NOT_VERIFIED"));
  });

  test("never emits a generic READY value", () => {
    const text = JSON.stringify(readiness(golden()));
    assert.ok(!/\bREADY\b/.test(text));
    assert.ok(["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"].includes(readiness(golden()).classification));
  });

  test("unfinalized balance leaves readiness NOT_ESTABLISHED", () => {
    assert.equal(readiness(replaceObservation(golden(), "obs-balance", { finality: "UNFINALIZED" })).classification, "NOT_ESTABLISHED");
  });

  test("identity mismatch is a definite failure", () => {
    const b = replaceAssertion(replaceObservation(golden(), "obs-identity", { payload: { symbol: "USDT", decimals: "6", issuerAuthorityId: "issuer:circle" } }), "a-identity", {
      value: { symbol: "USDT", decimals: "6", issuerAuthorityId: "issuer:circle" },
    });
    const r = readiness(b);
    assert.equal(r.classification, "CRITERIA_NOT_MET");
    assert.equal(r.criteria.find((c) => c.id === "C1")?.outcome, "NOT_MET");
  });

  test("balance for a different token than the identity is a definite failure", () => {
    const other = `0x${"ee".repeat(20)}`;
    let b = replaceAssertion(golden(), "a-balance", { subject: { chainId: "1", token: other, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH } });
    b = replaceObservation(b, "obs-balance", { subject: { chainId: "1", token: other, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH } });
    const r = readiness(b);
    assert.equal(r.classification, "CRITERIA_NOT_MET");
    assert.equal(r.criteria.find((c) => c.id === "C3")?.outcome, "NOT_MET");
  });

  test("conflicting balance leaves readiness NOT_ESTABLISHED, never auto-resolved", () => {
    const b = golden();
    b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-2" });
    b.observations.push({ ...replaceObservation(golden(), "obs-balance", {}).observations[1]!, id: "obs-2", sourceId: "src-chain-2", payload: { balanceAtomic: "9", decimals: "6" } });
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: ["obs-balance", "obs-2"] } : a));
    assert.equal(readiness(b).classification, "NOT_ESTABLISHED");
  });

  test("missing input assertions are indeterminate", () => {
    const bundle = parse(golden());
    const ev = evaluateBundle(bundle, EVALUATED_AT);
    const r = assessReadiness(bundle, ev, "nope", "a-balance");
    assert.equal(r.classification, "NOT_ESTABLISHED");
  });

  test("a readiness assertion produced by the tool re-validates cleanly inside a bundle", () => {
    const b = clone(golden());
    const first = readiness(b);
    b.derivations.push(first.suggestedDerivation);
    b.assertions.push(first.suggestedAssertion);
    const bundle = parse(b);
    const ev = evaluateBundle(bundle, EVALUATED_AT);
    assert.deepEqual(checkInvariants(bundle, ev), []);
    assert.equal(ev.assertions.find((a) => a.assertionId === "readiness-result")?.supportState, "ESTABLISHED");
  });
});

describe("provenance", () => {
  test("transport is an attribute, never an agent or authority", () => {
    const b = parse(withUsdValue(golden()));
    const t = traceProvenance(b, "a-usd");
    assert.deepEqual(t.issues, []);
    assert.ok(!Object.keys(t.prov.agent).some((k) => k.toLowerCase().includes("alchemy")));
    const chainAgent = t.prov.agent["ww:source/src-chain"];
    assert.equal(chainAgent?.["ww:retrievedVia"], "Alchemy");
    assert.equal(chainAgent?.["ww:kind"], "CHAIN_STATE");
    assert.ok(t.prov.agent["ww:agent/walletwall-rules"]);
  });

  test("lineage reaches every ancestor of a derived assertion", () => {
    const t = traceProvenance(parse(withUsdValue(golden())), "a-usd");
    const ids = new Set(t.lineage.map((l) => l.id));
    for (const id of ["a-usd", "a-balance", "a-price", "obs-balance", "obs-price-a", "obs-price-b"]) assert.ok(ids.has(id), id);
    assert.ok(!ids.has("a-identity"));
    assert.equal(Object.keys(t.prov.activity).length, 1);
    assert.ok(Object.keys(t.prov.used).length >= 2);
  });

  test("supersession is a wasRevisionOf relation", () => {
    const b = golden();
    b.assertions.push({ ...balanceNew(), id: "a-new" });
    b.supersessions = [{ id: "s", supersededAssertionId: "a-balance", supersedingAssertionId: "a-new", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
    const t = traceProvenance(parse(b), "a-new");
    assert.equal(Object.keys(t.prov.wasRevisionOf).length, 1);
  });

  test("missing target and dangling references are reported, not guessed", () => {
    assert.deepEqual(traceProvenance(parse(golden()), "nope").issues, [{ code: "TARGET_NOT_FOUND", id: null }]);
    const t = traceProvenance(parse(replaceAssertion(golden(), "a-balance", { observationIds: ["obs-balance", "ghost"] })), "a-balance");
    assert.ok(t.issues.some((i) => i.code === "DANGLING_REFERENCE" && i.id === "ghost"));
  });

  test("dependency cycles terminate", () => {
    const b = withUsdValue(golden());
    b.derivations = b.derivations.map((d) => ({ ...d, inputAssertionIds: ["a-usd", "a-price"] }));
    const t = traceProvenance(parse(b), "a-usd");
    assert.ok(t.issues.some((i) => i.code === "DEPENDENCY_CYCLE"));
  });
});

function balanceNew() {
  const a = golden().assertions.find((x) => x.id === "a-balance")!;
  return { ...a, assertedAt: "2026-10-23T12:01:00Z" };
}

describe("normalize_observation", () => {
  const draft = {
    id: "obs-1",
    sourceId: "src-chain",
    origin: "CHAIN_OBSERVED" as const,
    observedAt: "2026-10-23T12:00:00Z",
    finality: "FINALIZED" as const,
    result: "VALUE" as const,
    chainId: "1",
    token: USDC.toUpperCase().replace("0X", "0x"),
    holder: HOLDER,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH.toUpperCase().replace("0X", "0x"),
    balanceAtomic: "1500000",
    decimals: "6",
  };

  test("lowercases addresses and hashes and renders an exact decimal", () => {
    const n = normalizeObservation(draft);
    assert.equal(n.observation.subject["token"], USDC);
    assert.equal(n.observation.subject["blockHash"], BLOCK_HASH);
    assert.equal(n.balanceDecimal, "1.5");
    assert.match(n.evidenceDigest, /^[0-9a-f]{64}$/);
    assert.ok(n.canonicalJson.startsWith('{"finality":"FINALIZED"'));
  });

  test("content digest ignores IDs and source, so duplicate content is detectable", () => {
    const a = normalizeObservation(draft);
    const b = normalizeObservation({ ...draft, id: "obs-2", sourceId: "src-other" });
    assert.notEqual(a.evidenceDigest, b.evidenceDigest);
    assert.equal(a.contentDigest, b.contentDigest);
  });

  test("NO_RESULT carries no payload and no decimal rendering", () => {
    const n = normalizeObservation({ ...draft, result: "NO_RESULT", balanceAtomic: undefined, decimals: undefined });
    assert.deepEqual(n.observation.payload, {});
    assert.equal(n.balanceDecimal, null);
  });

  test("malformed quantities throw fixed errors that do not echo the value", () => {
    for (const bad of ["1.5", "-1", "01", "1e6"]) {
      try {
        normalizeObservation({ ...draft, balanceAtomic: bad });
        assert.fail("expected throw");
      } catch (e) {
        assert.ok(e instanceof WwError && e.code === "INVALID_QUANTITY");
        assert.ok(!e.message.includes(bad));
      }
    }
    assert.throws(() => normalizeObservation({ ...draft, balanceAtomic: undefined }), WwError);
  });

  test("the normalized observation satisfies the closed schema", () => {
    const b = golden();
    b.observations = [normalizeObservation({ ...draft, id: "obs-balance" }).observation, ...b.observations.filter((o) => o.id !== "obs-balance")];
    assert.doesNotThrow(() => parse(b));
  });
});

describe("resolve_asset", () => {
  test("chain and address resolve to a registry match that is only PARTIAL", () => {
    const r = resolveAsset({ chainId: "1", address: USDC.toUpperCase().replace("0X", "0x") });
    assert.equal(r.resolution, "REGISTRY_MATCH");
    assert.equal(r.supportState, "PARTIAL");
    assert.equal(r.origin, "WALLETWALL_DERIVED");
    assert.equal(r.asset?.symbol, "USDC");
    assert.ok(r.limitations.includes("REGISTRY_VERIFIED_POINT_IN_TIME"));
  });

  test("unknown addresses are NOT_ESTABLISHED, not fraudulent", () => {
    const r = resolveAsset({ chainId: "1", address: `0x${"dead".repeat(10)}` });
    assert.equal(r.resolution, "NOT_IN_REGISTRY");
    assert.equal(r.supportState, "NOT_ESTABLISHED");
    assert.ok(r.notes.join(" ").includes("does not mean the contract is fraudulent"));
  });

  test("the same address on a chain outside the registry is not resolved", () => {
    assert.equal(resolveAsset({ chainId: "10", address: USDC }).resolution, "CHAIN_NOT_IN_REGISTRY");
  });

  test("a symbol never resolves to a single identity", () => {
    const r = resolveAsset({ symbol: "usdc" });
    assert.equal(r.resolution, "SYMBOL_CANDIDATES");
    assert.equal(r.asset, null);
    assert.equal(r.candidates.length, 3);
    assert.ok(r.limitations.includes("SYMBOL_NOT_AUTHORITY"));
    assert.equal(resolveAsset({ symbol: "NOPE" }).resolution, "NO_SYMBOL_MATCH");
  });
});

describe("evaluation determinism", () => {
  test("identical input gives byte-identical output; evaluation time is an explicit input", () => {
    const b = parse(withUsdValue(golden()));
    assert.equal(JSON.stringify(evaluateBundle(b, EVALUATED_AT)), JSON.stringify(evaluateBundle(clone(b), EVALUATED_AT)));
    const later = evaluateBundle(b, "2027-10-23T12:00:30Z");
    assert.equal(later.assertions.find((a) => a.assertionId === "a-identity")?.supportState, "STALE");
  });
});
