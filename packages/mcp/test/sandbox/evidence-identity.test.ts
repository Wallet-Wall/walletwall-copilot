import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateBundle } from "../../src/evaluate.ts";
import { assessReadiness } from "../../src/readiness.ts";
import { BundleSchema, type Assertion, type Bundle } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, USDC, balanceAssertion, balanceObservation, clone, golden, identityAssertion, identityObservation, replaceAssertion, replaceObservation, withUsdValue } from "../support/builders.ts";

/**
 * Regressions for the fail-open inconsistencies found by a fresh-clone, real-host evaluation: a derived claim about a subject
 * nobody measured, hex case hiding a conflict, a reused assertion id meaning different records to different components, and a
 * PINNED observation dated after the evaluation time. Every expectation is written by hand from the published contract
 * (spec/EVIDENCE_PROFILE.md, spec/SUPPORT_STATES.md, the claim contract); none is computed by the engine.
 */

interface Diagnostic {
  limitation: string;
  record: string;
  observationId: string | null;
  missingKeys: string[];
  mismatchedKeys: string[];
}
interface Evaluated {
  assertionId: string;
  supportState: string;
  freshnessState: string;
  finalityState: string | null;
  limitations: string[];
  diagnostics: Diagnostic[];
  conflictsWith: string[];
  digest: string;
}
interface Inspected {
  bundleDigest: string;
  assertions: Evaluated[];
  invariantViolationCount: number;
}
interface Violation {
  invariant: string;
  code: string;
  assertionId: string | null;
}
interface Checked {
  pass: boolean;
  violations: Violation[];
  bundleDigest: string;
}
interface Readiness {
  classification: string;
  criteria: { id: string; outcome: string; reason: string }[];
  inputs: { assertionId: string; supportState: string; digest: string }[];
  supportOfInputs: string;
  suggestedAssertion: Assertion;
  suggestedDerivation: Bundle["derivations"][number];
}
interface Traced {
  lineage: { id: string; kind: string }[];
  issues: { code: string; id: string | null }[];
}

function tool<T>(name: string, args: unknown): T {
  const r = callTool(name, args);
  assert.ok(r.ok, `${name} accepted the input: ${JSON.stringify(r)}`);
  return r.result as T;
}
const inspect = (bundle: Bundle, evaluatedAt = EVALUATED_AT): Inspected => tool<Inspected>("inspect_evidence", { bundle, evaluatedAt });
const invariants = (bundle: Bundle, evaluatedAt = EVALUATED_AT): Checked => tool<Checked>("check_invariants", { bundle, evaluatedAt });
const readiness = (bundle: Bundle, evaluatedAt = EVALUATED_AT, identityAssertionId = "a-identity", balanceAssertionId = "a-balance"): Readiness =>
  tool<Readiness>("assess_vault_readiness", { bundle, evaluatedAt, identityAssertionId, balanceAssertionId });
const trace = (bundle: Bundle, assertionId: string): Traced => tool<Traced>("trace_provenance", { bundle, assertionId });
const byId = (i: Inspected, id: string): Evaluated => {
  const e = i.assertions.find((a) => a.assertionId === id);
  assert.ok(e, `assertion ${id} is evaluated`);
  return e;
};
const hasViolation = (c: Checked, invariant: string, code: string, assertionId?: string): boolean =>
  c.violations.some((v) => v.invariant === invariant && v.code === code && (assertionId === undefined || v.assertionId === assertionId));
const NOT_POSITIVE = (state: string): boolean => state !== "ESTABLISHED" && state !== "SUPPORTED";

const OTHER_HOLDER = `0x${"99".repeat(20)}`;
const OTHER_TOKEN = `0x${"ee".repeat(20)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
/** The EIP-55 spelling of the USDC contract, exactly as issuers and explorers publish it. */
const USDC_CHECKSUM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
/** USDC on Base: a second registered deployment of the same issuer, so its identity is ESTABLISHED on its own. */
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MIXED_HOLDER = "0xAbCdEf7890123456789012345678901234567890";
const LOWER_HOLDER = MIXED_HOLDER.toLowerCase();
const UPPER_HASH = `0x${"AB".repeat(32)}`;

const balanceSubject = (over: Record<string, string> = {}): Record<string, string> => ({ chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, ...over });

/** The engine's own readiness suggestion placed back into the bundle, optionally overridden. */
function withDerivedReadiness(bundle: Bundle, over: Partial<Assertion> = {}): Bundle {
  const parsed = BundleSchema.parse(clone(bundle));
  const r = assessReadiness(parsed, evaluateBundle(parsed, EVALUATED_AT), "a-identity", "a-balance");
  const out = clone(bundle);
  out.derivations.push(r.suggestedDerivation);
  out.assertions.push({ ...r.suggestedAssertion, ...over });
  return out;
}

/** A second chain-state reading and balance assertion, tweaked by the caller. */
function withSecondBalance(bundle: Bundle, subject: Record<string, string>, balanceAtomic: string): Bundle {
  const b = clone(bundle);
  b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-chain-2" });
  b.observations.push(balanceObservation({ id: "obs-balance-2", sourceId: "src-chain-2", subject, payload: { balanceAtomic, decimals: "6" } }));
  b.assertions.push(balanceAssertion({ id: "a-balance-2", subject, value: { balanceAtomic, decimals: "6" }, observationIds: ["obs-balance-2"] }));
  return b;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOLDED_KEYS = new Set(["address", "token", "holder", "blockHash"]);
const flipHex = (hex: string, rand: () => number): string => `0x${[...hex.slice(2)].map((c) => (rand() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join("")}`;
function flipSubject<T extends { subject: Record<string, unknown> }>(rec: T, rand: () => number): T {
  const subject: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec.subject)) subject[k] = FOLDED_KEYS.has(k) && typeof v === "string" ? flipHex(v, rand) : v;
  return { ...rec, subject };
}
/** Every hex subject value in the bundle re-spelled at random: the same evidence, as different providers would print it. */
function respell(bundle: Bundle, rand: () => number): Bundle {
  const b = clone(bundle);
  b.observations = b.observations.map((o) => flipSubject(o, rand));
  b.assertions = b.assertions.map((a) => flipSubject(a, rand));
  return b;
}
/** Everything a reader relies on, without the digests of the supplied bytes (which rightly follow the spelling). */
const statesOf = (i: Inspected): unknown => i.assertions.map(({ digest: _digest, ...rest }) => rest);

describe("BUG 1: a derived claim only gets support from dependencies about its own subject", () => {
  test("CONTROL: the engine's own suggestion, put back in the bundle, stays ESTABLISHED with no violation", () => {
    const b = withDerivedReadiness(golden());
    assert.equal(byId(inspect(b), "readiness-result").supportState, "ESTABLISHED");
    assert.deepEqual(invariants(b).violations, []);
  });

  test("a readiness claim about a holder nobody measured is refused by every surface, not merely flagged", () => {
    const b = withDerivedReadiness(golden(), { subject: balanceSubject({ holder: OTHER_HOLDER }) });
    const i = inspect(b);
    const e = byId(i, "readiness-result");
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    assert.ok(e.limitations.includes("SUBJECT_MISMATCH"), e.limitations.join());
    assert.deepEqual(e.diagnostics.map((d) => [d.limitation, d.record, d.observationId, d.mismatchedKeys]), [["SUBJECT_MISMATCH", "ASSERTION_SUBJECT", null, ["holder"]]]);
    assert.ok(i.invariantViolationCount > 0);
    const c = invariants(b);
    assert.equal(c.pass, false);
    assert.ok(hasViolation(c, "INV-00", "SUBJECT_MISMATCH", "readiness-result"), JSON.stringify(c.violations));
    assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED", "the honest input keeps its own state");
  });

  for (const [key, value] of [["chainId", "8453"], ["token", OTHER_TOKEN], ["holder", OTHER_HOLDER], ["blockNumber", "21000001"], ["blockHash", OTHER_HASH]] as const) {
    test(`every subject key of the policy is bound, not just the holder: readiness ${key}`, () => {
      const b = withDerivedReadiness(golden(), { subject: balanceSubject({ [key]: value }) });
      const e = byId(inspect(b), "readiness-result");
      assert.equal(e.supportState, "NOT_ESTABLISHED", key);
      assert.ok(e.diagnostics.some((d) => d.limitation === "SUBJECT_MISMATCH" && d.mismatchedKeys.includes(key)), JSON.stringify(e.diagnostics));
      assert.ok(hasViolation(invariants(b), "INV-00", "SUBJECT_MISMATCH", "readiness-result"), key);
    });

    test(`every subject key of the policy is bound, not just the holder: USD value ${key}`, () => {
      const b = replaceAssertion(withUsdValue(golden()), "a-usd", { subject: balanceSubject({ [key]: value }) });
      const e = byId(inspect(b), "a-usd");
      assert.equal(e.supportState, "NOT_ESTABLISHED", key);
      assert.ok(e.limitations.includes("SUBJECT_MISMATCH"), key);
      assert.ok(hasViolation(invariants(b), "INV-00", "SUBJECT_MISMATCH", "a-usd"), key);
    });
  }

  test("a dependency about another deployment breaks the claim even when the claim copies the balance subject (identity address compares as the token)", () => {
    // The identity is ESTABLISHED on its own, for USDC on Base; the balance is USDC on Ethereum.
    const b = clone(golden());
    b.observations = b.observations.map((o) => (o.id === "obs-identity" ? identityObservation({ subject: { chainId: "8453", address: BASE_USDC } }) : o));
    b.assertions = b.assertions.map((a) => (a.id === "a-identity" ? identityAssertion({ subject: { chainId: "8453", address: BASE_USDC } }) : a));
    const r = readiness(b);
    assert.equal(r.classification, "CRITERIA_NOT_MET", "CONTROL: the rule itself rejects the pair");
    for (const classification of ["CRITERIA_MET", "CRITERIA_NOT_MET"]) {
      const d = withDerivedReadiness(b, { value: { classification } });
      const i = inspect(d);
      assert.equal(byId(i, "a-identity").supportState, "ESTABLISHED");
      assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED");
      const e = byId(i, "readiness-result");
      assert.equal(e.supportState, "NOT_ESTABLISHED", classification);
      assert.deepEqual(e.diagnostics.flatMap((x) => x.mismatchedKeys).sort(), ["chainId", "token"], classification);
      assert.ok(hasViolation(invariants(d), "INV-00", "SUBJECT_MISMATCH", "readiness-result"), classification);
    }
  });

  test("an extra input about another holder cannot lend support: every input is bound, not only the required ones", () => {
    const b = withSecondBalance(withUsdValue(golden()), balanceSubject({ holder: OTHER_HOLDER }), "1500000");
    b.derivations = b.derivations.map((d) => ({ ...d, inputAssertionIds: ["a-balance", "a-price", "a-balance-2"] }));
    const e = byId(inspect(b), "a-usd");
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    assert.ok(e.limitations.includes("SUBJECT_MISMATCH"));
    assert.equal(byId(inspect(b), "a-balance-2").supportState, "ESTABLISHED", "a genuinely different holder is its own valid claim");
  });

  test("a derived subject missing a required key is a mismatch, reported by key name and never by value", () => {
    const b = withDerivedReadiness(golden(), { subject: { chainId: "1", token: USDC, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH } });
    const e = byId(inspect(b), "readiness-result");
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    const d = e.diagnostics.find((x) => x.limitation === "SUBJECT_MISMATCH");
    assert.deepEqual(d?.missingKeys, ["holder"]);
    assert.ok(!JSON.stringify(e.diagnostics).includes(USDC), "record values are never echoed");
  });

  test("a case-only spelling difference is not a mismatch: the comparison follows the claim vocabulary", () => {
    const b = withDerivedReadiness(golden(), { subject: balanceSubject({ token: USDC_CHECKSUM, blockHash: UPPER_HASH }) });
    const e = byId(inspect(b), "readiness-result");
    assert.equal(e.supportState, "ESTABLISHED", JSON.stringify(e));
    assert.deepEqual(invariants(b).violations, []);
  });

  test("an inert extra subject key is not part of the identity", () => {
    const b = withDerivedReadiness(golden(), { subject: { ...balanceSubject(), note: "not contract" } });
    assert.equal(byId(inspect(b), "readiness-result").supportState, "ESTABLISHED");
  });

  test("the underlying observations stay bound: claim and input agree on a holder the reading is not about", () => {
    const subject = balanceSubject({ holder: OTHER_HOLDER });
    const b = withDerivedReadiness(replaceAssertion(golden(), "a-balance", { subject }), { subject });
    const i = inspect(b);
    assert.equal(byId(i, "a-balance").supportState, "NOT_ESTABLISHED");
    assert.ok(byId(i, "a-balance").limitations.includes("SUBJECT_MISMATCH"));
    assert.equal(byId(i, "readiness-result").supportState, "NOT_ESTABLISHED");
    assert.ok(byId(i, "readiness-result").limitations.includes("SUBJECT_MISMATCH"), "a dependency's limitation is inherited");
  });

  test("provenance still shows the lineage of a refused claim, and its support stays refused when traced", () => {
    const b = withDerivedReadiness(golden(), { subject: balanceSubject({ holder: OTHER_HOLDER }) });
    const ids = trace(b, "readiness-result").lineage.map((l) => l.id);
    for (const id of ["readiness-result", "a-identity", "a-balance", "obs-identity", "obs-balance"]) assert.ok(ids.includes(id), id);
    assert.equal(byId(inspect(b), "readiness-result").supportState, "NOT_ESTABLISHED");
  });
});

describe("BUG 2: address identity is case-insensitive everywhere the claim vocabulary says so", () => {
  const conflicting: [string, Record<string, string>, Record<string, string>][] = [
    ["holder", balanceSubject({ holder: LOWER_HOLDER }), balanceSubject({ holder: MIXED_HOLDER })],
    ["token contract", balanceSubject(), balanceSubject({ token: USDC_CHECKSUM })],
    ["block hash", balanceSubject(), balanceSubject({ blockHash: UPPER_HASH })],
  ];

  test("CONTROL: identical spelling with different values is CONFLICTING", () => {
    const b = withSecondBalance(golden(), balanceSubject(), "999");
    assert.deepEqual(byId(inspect(b), "a-balance").conflictsWith, ["a-balance-2"]);
  });

  for (const [label, first, second] of conflicting) {
    test(`a case-only ${label} variant with a different value is a conflict on every surface`, () => {
      const base = replaceObservation(replaceAssertion(golden(), "a-balance", { subject: first }), "obs-balance", { subject: first });
      const b = withSecondBalance(base, second, "999");
      const i = inspect(b);
      for (const [id, other] of [["a-balance", "a-balance-2"], ["a-balance-2", "a-balance"]] as const) {
        assert.equal(byId(i, id).supportState, "CONFLICTING", id);
        assert.deepEqual(byId(i, id).conflictsWith, [other], id);
        assert.ok(byId(i, id).limitations.includes("CONFLICT_DETECTED"), id);
      }
      const r = readiness(b);
      assert.equal(r.classification, "NOT_ESTABLISHED");
      assert.equal(r.criteria.find((c) => c.id === "C5")?.outcome, "INDETERMINATE");
      assert.equal(r.supportOfInputs, "CONFLICTING");
    });
  }

  test("a case-only variant of an identity address with a different value is a conflict", () => {
    const b = clone(golden());
    b.observations.push(identityObservation({ id: "obs-identity-2", subject: { chainId: "1", address: USDC_CHECKSUM }, payload: { symbol: "USDT", decimals: "6", issuerAuthorityId: "issuer:circle" } }));
    b.assertions.push(identityAssertion({ id: "a-identity-2", subject: { chainId: "1", address: USDC_CHECKSUM }, value: { symbol: "USDT", decimals: "6", issuerAuthorityId: "issuer:circle" }, observationIds: ["obs-identity-2"] }));
    const i = inspect(b);
    assert.deepEqual(byId(i, "a-identity").conflictsWith, ["a-identity-2"]);
    assert.equal(byId(i, "a-identity").supportState, "CONFLICTING");
  });

  test("a case-only variant with the SAME value is the same claim and no conflict; each assertion keeps its own evaluation", () => {
    const b = withSecondBalance(golden(), balanceSubject({ token: USDC_CHECKSUM }), "1500000");
    const i = inspect(b);
    assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED");
    assert.equal(byId(i, "a-balance-2").supportState, "ESTABLISHED");
    assert.deepEqual(byId(i, "a-balance").conflictsWith, []);
    assert.equal(readiness(b).classification, "CRITERIA_MET");
    assert.deepEqual(invariants(b).violations, []);
  });

  test("corroboration is unchanged: two readings of one assertion, spelled differently, count by independence group", () => {
    const b = clone(golden());
    b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-chain-2" });
    b.observations.push(balanceObservation({ id: "obs-balance-2", sourceId: "src-chain-2", subject: balanceSubject({ token: USDC_CHECKSUM }) }));
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: ["obs-balance", "obs-balance-2"] } : a));
    const e = inspect(b).assertions.find((a) => a.assertionId === "a-balance") as Evaluated & { independentCorroboration: number };
    assert.equal(e.supportState, "ESTABLISHED");
    assert.equal(e.independentCorroboration, 2);
    assert.ok(!e.limitations.includes("DUPLICATE_EVIDENCE_COLLAPSED"));
  });

  test("a genuinely different address is a different claim, whatever its case", () => {
    const b = withSecondBalance(golden(), balanceSubject({ holder: OTHER_HOLDER.toUpperCase().replace("0X", "0x") }), "999");
    const i = inspect(b);
    assert.deepEqual(byId(i, "a-balance").conflictsWith, []);
    assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED");
    assert.equal(byId(i, "a-balance-2").supportState, "ESTABLISHED");
  });

  test("only the keys the vocabulary marks case-insensitive fold: a block number stays exact, and a value is never folded", () => {
    const otherBlock = withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001" }), "999");
    assert.deepEqual(byId(inspect(otherBlock), "a-balance").conflictsWith, []);
    const b = clone(golden());
    b.observations.push(identityObservation({ id: "obs-identity-2", payload: { symbol: "usdc", decimals: "6", issuerAuthorityId: "issuer:circle" } }));
    b.assertions.push(identityAssertion({ id: "a-identity-2", value: { symbol: "usdc", decimals: "6", issuerAuthorityId: "issuer:circle" }, observationIds: ["obs-identity-2"] }));
    assert.deepEqual(byId(inspect(b), "a-identity").conflictsWith, ["a-identity-2"], "a symbol differing in case is a different value");
  });

  test("supersession identity follows the same rule: a case-only re-spelling supersedes cleanly, a different holder does not", () => {
    const newer = (subject: Record<string, string>): Bundle => {
      const b = withSecondBalance(golden(), subject, "1400000");
      b.assertions = b.assertions.map((a) => (a.id === "a-balance-2" ? { ...a, assertedAt: EVALUATED_AT } : a));
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" }];
      return b;
    };
    const respelled = newer(balanceSubject({ token: USDC_CHECKSUM, blockNumber: "21000001", blockHash: OTHER_HASH }));
    assert.ok(!hasViolation(invariants(respelled), "INV-12", "SUPERSESSION_CLAIM_IDENTITY_MISMATCH"), JSON.stringify(invariants(respelled).violations));
    assert.equal(byId(inspect(respelled), "a-balance").supportState, "SUPERSEDED");
    const different = newer(balanceSubject({ holder: OTHER_HOLDER, blockNumber: "21000001", blockHash: OTHER_HASH }));
    assert.ok(hasViolation(invariants(different), "INV-12", "SUPERSESSION_CLAIM_IDENTITY_MISMATCH"));
  });

  test("readiness keeps treating a checksummed token and a lowercase identity address as the same contract (C3)", () => {
    const b = replaceObservation(replaceAssertion(golden(), "a-balance", { subject: balanceSubject({ token: USDC_CHECKSUM }) }), "obs-balance", { subject: balanceSubject({ token: USDC_CHECKSUM }) });
    const r = readiness(b);
    assert.equal(r.classification, "CRITERIA_MET");
    assert.equal(r.criteria.find((c) => c.id === "C3")?.reason, "SUBJECT_CONSISTENT");
  });

  test("comparison is not rewriting: every record, digest and suggestion keeps the spelling that was supplied", () => {
    const subject = balanceSubject({ token: USDC_CHECKSUM, holder: MIXED_HOLDER, blockHash: UPPER_HASH });
    const b = replaceObservation(replaceAssertion(golden(), "a-balance", { subject }), "obs-balance", { subject });
    const lower = replaceObservation(replaceAssertion(golden(), "a-balance", { subject: balanceSubject({ holder: LOWER_HOLDER }) }), "obs-balance", { subject: balanceSubject({ holder: LOWER_HOLDER }) });
    const r = readiness(b);
    assert.equal(r.classification, "CRITERIA_MET");
    assert.deepEqual(r.suggestedAssertion.subject, subject, "the suggested subject is the supplied spelling, not a folded one");
    assert.notEqual(byId(inspect(b), "a-balance").digest, byId(inspect(lower), "a-balance").digest, "the digest follows the supplied bytes");
    assert.notEqual(inspect(b).bundleDigest, inspect(lower).bundleDigest);
  });

  test("seeded: re-spelling every hex subject value at random never changes a state, a conflict, a violation or a classification", () => {
    const conflict = withSecondBalance(golden(), balanceSubject(), "999");
    const superseded = withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001", blockHash: OTHER_HASH }), "1400000");
    superseded.assertions = superseded.assertions.map((a) => (a.id === "a-balance-2" ? { ...a, assertedAt: EVALUATED_AT } : a));
    superseded.supersessions = [{ id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" }];
    const bases: [string, Bundle][] = [["golden", golden()], ["derived readiness", withDerivedReadiness(golden())], ["derived USD", withUsdValue(golden())], ["conflict", conflict], ["supersession", superseded]];
    const rand = mulberry32(0x5eed1234);
    for (const [label, base] of bases) {
      const lowered = inspect(base);
      const rule = readiness(base);
      const checked = invariants(base);
      for (let n = 0; n < 40; n++) {
        const b = respell(base, rand);
        assert.deepEqual(statesOf(inspect(b)), statesOf(lowered), `${label} #${n}`);
        const r = readiness(b);
        assert.equal(r.classification, rule.classification, `${label} #${n}`);
        assert.deepEqual(r.criteria, rule.criteria, `${label} #${n}`);
        assert.deepEqual(invariants(b).violations, checked.violations, `${label} #${n}`);
      }
    }
  });
});

describe("BUG 3: a reused assertion id is refused, whichever record comes first", () => {
  /** Every ordering of the records sharing an id, the rest of the bundle left in place. */
  const orderings = (b: Bundle, id: string): Bundle[] => {
    const shared = b.assertions.filter((a) => a.id === id);
    const others = b.assertions.filter((a) => a.id !== id);
    const perms = (xs: Assertion[]): Assertion[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms(xs.filter((_, j) => j !== i)).map((p) => [x, ...p])));
    return perms(shared).flatMap((p) => [
      { ...clone(b), assertions: [...clone(others), ...clone(p)] },
      { ...clone(b), assertions: [...clone(p), ...clone(others)] },
    ]);
  };

  const duplicate = (over: Partial<Assertion>, id = "a-balance"): Bundle => {
    const b = clone(golden());
    const record = b.assertions.find((a) => a.id === id) as Assertion;
    b.assertions.push({ ...clone(record), ...over });
    return b;
  };

  const CASES: [string, Bundle, string][] = [
    ["two identical records", duplicate({}), "a-balance"],
    ["two different values", duplicate({ value: { balanceAtomic: "999999999", decimals: "6" } }), "a-balance"],
    ["two different subjects, the second never observed", duplicate({ subject: balanceSubject({ holder: OTHER_HOLDER }), observationIds: [] }), "a-balance"],
    ["one record that would make readiness positive and one that would not", duplicate({ value: { balanceAtomic: "1", decimals: "6" }, observationIds: ["obs-missing"] }), "a-balance"],
    ["a reused identity id", duplicate({ subject: { chainId: "8453", address: BASE_USDC } }, "a-identity"), "a-identity"],
    ["records of different claim types", duplicate({ claimType: "TOKEN_USD_PRICE", origin: "PROVIDER_OBSERVED", subject: { chainId: "1", token: USDC }, value: { priceUsd: "1" }, observationIds: ["obs-price-a"] }), "a-balance"],
  ];

  for (const [label, bundle, id] of CASES) {
    test(`${label}: refused the same way by every surface, in every order`, () => {
      const seen = new Set<string>();
      for (const b of orderings(bundle, id)) {
        const i = inspect(b);
        assert.equal(byId(i, id).supportState, "NOT_ESTABLISHED", label);
        assert.ok(i.assertions.every((e) => NOT_POSITIVE(e.supportState)), `nothing in the bundle stays positive: ${JSON.stringify(i.assertions.map((e) => [e.assertionId, e.supportState]))}`);
        assert.ok(i.invariantViolationCount > 0);
        const c = invariants(b);
        assert.equal(c.pass, false);
        assert.ok(hasViolation(c, "INV-12", "DUPLICATE_ASSERTION_ID", id), JSON.stringify(c.violations));
        const r = readiness(b);
        assert.equal(r.classification, "NOT_ESTABLISHED", label);
        assert.ok(r.criteria.every((x) => x.outcome === "INDETERMINATE" && x.reason === "DUPLICATE_ASSERTION_ID"), JSON.stringify(r.criteria));
        assert.equal(r.supportOfInputs, "NOT_ESTABLISHED");
        assert.deepEqual(trace(b, id).issues, [{ code: "TARGET_NOT_FOUND", id: null }], "provenance names no record for an ambiguous id");
        // bundleDigest follows the input bytes by design; nothing else may depend on the order of the records.
        seen.add(JSON.stringify([{ ...i, bundleDigest: "" }, { ...c, bundleDigest: "" }, r]));
      }
      assert.equal(seen.size, 1, `results depend on record order: ${label}`);
    });
  }

  test("the suggested assertion never names one of the competing records", () => {
    const b = duplicate({ subject: balanceSubject({ holder: OTHER_HOLDER }), observationIds: [] });
    for (const ordered of orderings(b, "a-balance")) {
      const r = readiness(ordered);
      assert.equal(r.suggestedAssertion.value?.["classification"], "NOT_ESTABLISHED");
      assert.deepEqual(r.suggestedAssertion.subject, {}, "no subject can be attributed to an ambiguous id");
      assert.ok(!JSON.stringify(r).includes(OTHER_HOLDER) && !JSON.stringify(r).includes(HOLDER));
    }
  });

  test("an id reused anywhere in the bundle stops readiness, even when both inputs are unique: CRITERIA_MET next to INV-12 is not possible", () => {
    const b = clone(golden());
    b.assertions.push({ ...balanceAssertion(), id: "a-unrelated" }, { ...balanceAssertion({ value: { balanceAtomic: "1", decimals: "6" } }), id: "a-unrelated" });
    const r = readiness(b);
    assert.equal(r.classification, "NOT_ESTABLISHED");
    assert.ok(r.criteria.every((x) => x.reason === "DUPLICATE_ASSERTION_ID"));
    assert.ok(hasViolation(invariants(b), "INV-12", "DUPLICATE_ASSERTION_ID", "a-unrelated"));
  });

  test("a derived claim over a reused id fails closed in both orders: the dependency cannot be resolved to either record", () => {
    const honest = withDerivedReadiness(golden());
    const b = clone(honest);
    b.assertions.push(balanceAssertion({ value: { balanceAtomic: "999", decimals: "6" }, observationIds: [] }));
    for (const ordered of orderings(b, "a-balance")) {
      const i = inspect(ordered);
      const e = byId(i, "readiness-result");
      assert.equal(e.supportState, "NOT_ESTABLISHED");
      assert.ok(e.limitations.includes("DANGLING_REFERENCE"), e.limitations.join());
      assert.ok(trace(ordered, "readiness-result").issues.some((x) => x.code === "DANGLING_REFERENCE" && x.id === "a-balance"));
    }
  });

  test("a derived claim whose own id is reused is refused", () => {
    const honest = withDerivedReadiness(golden());
    const copy = honest.assertions.find((a) => a.id === "readiness-result") as Assertion;
    const b = clone(honest);
    b.assertions.push({ ...clone(copy), value: { classification: "CRITERIA_NOT_MET" } });
    for (const ordered of orderings(b, "readiness-result")) {
      assert.equal(byId(inspect(ordered), "readiness-result").supportState, "NOT_ESTABLISHED");
      assert.ok(hasViolation(invariants(ordered), "INV-12", "DUPLICATE_ASSERTION_ID", "readiness-result"));
    }
  });

  test("CONTROL: a derivation naming one input twice is not a reused id and lends no extra support", () => {
    const b = withDerivedReadiness(golden());
    b.derivations = b.derivations.map((d) => ({ ...d, inputAssertionIds: ["a-identity", "a-balance", "a-balance"] }));
    assert.equal(byId(inspect(b), "readiness-result").supportState, "ESTABLISHED");
    assert.ok(!invariants(b).violations.some((v) => v.code === "DUPLICATE_ASSERTION_ID"));
  });

  test("CONTROL: unique ids are unaffected", () => {
    assert.equal(readiness(golden()).classification, "CRITERIA_MET");
    assert.deepEqual(invariants(golden()).violations, []);
  });
});

describe("BUG 4: PINNED does not excuse an observation dated after the evaluation time", () => {
  const atBalance = (observedAt: string, temporality: "PINNED" | "CURRENT" = "PINNED"): Bundle => replaceObservation(replaceAssertion(golden(), "a-balance", { temporality }), "obs-balance", { observedAt });

  test("a PINNED observation from 2031 evaluated in 2026 stays PARTIAL with unknown freshness on every surface", () => {
    const b = atBalance("2031-01-01T00:00:00Z");
    const e = byId(inspect(b), "a-balance");
    assert.equal(e.supportState, "PARTIAL");
    assert.equal(e.freshnessState, "UNKNOWN_FRESHNESS");
    assert.ok(e.limitations.includes("OBSERVATION_FROM_FUTURE"));
    const r = readiness(b);
    assert.equal(r.classification, "NOT_ESTABLISHED");
    assert.equal(r.criteria.find((c) => c.id === "C2")?.outcome, "INDETERMINATE");
    assert.equal(r.criteria.find((c) => c.id === "C6")?.outcome, "INDETERMINATE", "C6 agrees with the freshness state");
  });

  test("one millisecond past the evaluation time is the future; a fraction that equals it is not", () => {
    const later = byId(inspect(atBalance("2026-10-23T12:00:30.001Z")), "a-balance");
    assert.ok(later.limitations.includes("OBSERVATION_FROM_FUTURE"));
    assert.equal(later.supportState, "PARTIAL");
    const same = byId(inspect(atBalance("2026-10-23T12:00:30.000Z")), "a-balance");
    assert.ok(!same.limitations.includes("OBSERVATION_FROM_FUTURE"));
    assert.equal(same.supportState, "ESTABLISHED");
  });

  test("PINNED observed exactly at the evaluation time keeps its existing valid state", () => {
    const b = atBalance(EVALUATED_AT);
    const e = byId(inspect(b), "a-balance");
    assert.equal(e.supportState, "ESTABLISHED");
    assert.equal(e.freshnessState, "PINNED");
    assert.equal(readiness(b).classification, "CRITERIA_MET");
  });

  test("CURRENT observed exactly at the evaluation time stays CURRENT; CURRENT from the future is unchanged", () => {
    const now = byId(inspect(atBalance(EVALUATED_AT, "CURRENT")), "a-balance");
    assert.equal(now.freshnessState, "CURRENT");
    assert.equal(now.supportState, "ESTABLISHED");
    const future = byId(inspect(atBalance("2026-10-23T12:05:00Z", "CURRENT")), "a-balance");
    assert.equal(future.supportState, "PARTIAL");
    assert.equal(future.freshnessState, "UNKNOWN_FRESHNESS");
    assert.ok(future.limitations.includes("OBSERVATION_FROM_FUTURE"));
  });

  test("an older PINNED observation is still historical evidence: old is not the future", () => {
    const b = atBalance("2021-10-23T12:00:00Z");
    const e = byId(inspect(b), "a-balance");
    assert.equal(e.supportState, "ESTABLISHED");
    assert.equal(e.freshnessState, "PINNED");
    assert.equal(readiness(b).classification, "CRITERIA_MET");
  });

  test("the newest reading decides: one future reading among past ones is enough, as it already is for CURRENT", () => {
    const b = clone(golden());
    b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-chain-2" });
    b.observations.push(balanceObservation({ id: "obs-balance-2", sourceId: "src-chain-2", observedAt: "2031-01-01T00:00:00Z" }));
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: ["obs-balance", "obs-balance-2"] } : a));
    assert.ok(byId(inspect(b), "a-balance").limitations.includes("OBSERVATION_FROM_FUTURE"));
  });

  test("a derived claim over a future-dated PINNED input cannot be stronger than its input and inherits the limitation", () => {
    const b = withDerivedReadiness(atBalance("2031-01-01T00:00:00Z"));
    const e = byId(inspect(b), "readiness-result");
    assert.ok(NOT_POSITIVE(e.supportState), e.supportState);
    assert.ok(e.limitations.includes("OBSERVATION_FROM_FUTURE"));
  });

  test("a future identity reading stays non-established", () => {
    const b = replaceObservation(golden(), "obs-identity", { observedAt: "2031-01-01T00:00:00Z" });
    const e = byId(inspect(b), "a-identity");
    assert.equal(e.supportState, "PARTIAL");
    assert.ok(e.limitations.includes("OBSERVATION_FROM_FUTURE"));
    assert.equal(readiness(b).classification, "NOT_ESTABLISHED");
  });

  test("timestamps with an offset, impossible dates and an empty fraction keep failing the schema; no machine clock is involved", () => {
    for (const observedAt of ["2026-10-23T17:30:00+05:30", "2026-02-30T00:00:00Z", "2026-10-23T12:00:00.Z", "noon"]) {
      const r = callTool("inspect_evidence", { bundle: replaceObservation(golden(), "obs-balance", { observedAt }), evaluatedAt: EVALUATED_AT });
      assert.equal(r.ok, false, observedAt);
    }
    for (const evaluatedAt of ["2026-10-23T17:30:30+05:30", "yesterday"]) {
      assert.equal(callTool("inspect_evidence", { bundle: golden(), evaluatedAt }).ok, false, evaluatedAt);
    }
    // The same instant evaluated decades apart gives answers that depend only on the explicit evaluatedAt.
    const b = atBalance("2031-01-01T00:00:00Z");
    assert.ok(byId(inspect(b, "2030-12-31T23:59:59Z"), "a-balance").limitations.includes("OBSERVATION_FROM_FUTURE"));
    assert.equal(byId(inspect(replaceObservation(b, "obs-identity", { observedAt: "2031-01-01T00:00:00Z" }), "2031-01-01T00:00:00Z"), "a-balance").supportState, "ESTABLISHED");
  });
});

describe("CHARACTERIZATION, not a safety claim: same height, different block hash", () => {
  /**
   * blockHash is part of the subject vocabulary, so these are two fork-specific subjects today. Whether WalletWall models
   * state at canonical height N or state in exact block H is a separate authority and finality decision; until it is made
   * this pins the current contract so that a change cannot happen by accident. It must not be read as "this is safe".
   */
  test("two FINALIZED readings at one height with different hashes and balances stay two claims with no conflict", () => {
    const b = withSecondBalance(golden(), balanceSubject({ blockHash: OTHER_HASH }), "999");
    const i = inspect(b);
    assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED");
    assert.equal(byId(i, "a-balance-2").supportState, "ESTABLISHED");
    assert.deepEqual(byId(i, "a-balance").conflictsWith, []);
    assert.deepEqual(invariants(b).violations, []);
    assert.equal(readiness(b).classification, "CRITERIA_MET");
    assert.equal(readiness(b, EVALUATED_AT, "a-identity", "a-balance-2").classification, "CRITERIA_MET");
  });
});

describe("behaviour this lane must not change", () => {
  test("a measured zero balance is a balance: NO_RESULT is not zero, and zero is not NO_RESULT", () => {
    const zero = { balanceAtomic: "0", decimals: "6" };
    const b = replaceObservation(replaceAssertion(golden(), "a-balance", { value: zero }), "obs-balance", { payload: zero });
    assert.equal(byId(inspect(b), "a-balance").supportState, "ESTABLISHED");
    assert.equal(readiness(b).classification, "CRITERIA_MET");
  });

  test("bounded open maps stay open and inert: an extra key does not change support, conflict or authority", () => {
    const b = clone(golden());
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, value: { ...a.value, note: "inert" }, subject: { ...a.subject, note: "inert" } } : a));
    b.observations = b.observations.map((o) => (o.id === "obs-balance" ? { ...o, payload: { ...o.payload, note: "also inert" } } : o));
    assert.deepEqual(statesOf(inspect(b)), statesOf(inspect(golden())));
    assert.deepEqual(invariants(b).violations, []);
    const conflict = withSecondBalance(golden(), balanceSubject(), "1500000");
    conflict.assertions = conflict.assertions.map((a) => (a.id === "a-balance-2" ? { ...a, value: { ...a.value, note: "differs only here" } } : a));
    assert.deepEqual(byId(inspect(conflict), "a-balance").conflictsWith, [], "only contract keys can conflict");
    const usd = clone(golden());
    usd.assertions = usd.assertions.map((a) => (a.id === "a-balance" ? { ...a, value: { ...a.value, usdValue: "1500000" } } : a));
    assert.ok(hasViolation(invariants(usd), "INV-11", "QUANTITY_CLAIM_CARRIES_USD", "a-balance"), "the existing USD-name check still sees open keys");
  });
});
