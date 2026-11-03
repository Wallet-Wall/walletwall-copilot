import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { claimContracts } from "../../src/claims.ts";
import { evaluateBundle } from "../../src/evaluate.ts";
import { assessReadiness } from "../../src/readiness.ts";
import { BundleSchema, type Assertion, type Bundle, type Derivation, type Observation, type Source } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, USDC, balanceAssertion, balanceObservation, clone, golden, identityAssertion, identityObservation, withUsdValue } from "../support/builders.ts";

/**
 * A reused source, observation or derivation id names no record, as a reused assertion id does (evidence-identity.test.ts,
 * BUG 3): no first or last record supplies an answer, a reference to the id resolves to nothing, and the whole bundle is
 * refused, so record order cannot decide CRITERIA_MET against NOT_ESTABLISHED and CRITERIA_MET cannot sit beside a
 * DUPLICATE_* violation. Every expectation is written by hand from the published contract (spec/EVIDENCE_PROFILE.md,
 * spec/SUPPORT_STATES.md), or relates two of the engine's own answers; no expected value is computed by the engine.
 */

interface Evaluated {
  assertionId: string;
  supportState: string;
  freshnessState: string;
  finalityState: string | null;
  authority: { satisfied: boolean } | null;
  limitations: string[];
  independentCorroboration: number | null;
  conflictsWith: string[];
  supersededBy: string | null;
  dependencies: { observationIds: string[]; assertionIds: string[] };
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
  violationCount: number;
  violations: Violation[];
  bundleDigest: string;
}
interface Readiness {
  classification: string;
  criteria: { id: string; outcome: string; reason: string }[];
  inputs: { assertionId: string; supportState: string; digest: string }[];
  supportOfInputs: string;
  limitations: string[];
  suggestedAssertion: Assertion;
  suggestedDerivation: Derivation;
}
interface Traced {
  lineage: { id: string; kind: string }[];
  issues: { code: string; id: string | null }[];
  prov: Record<"agent" | "activity" | "entity" | "wasAttributedTo" | "wasDerivedFrom" | "wasGeneratedBy" | "used", Record<string, unknown>>;
}

function tool<T>(name: string, args: unknown): T {
  const r = callTool(name, args);
  assert.ok(r.ok, `${name} accepted the input: ${JSON.stringify(r)}`);
  return r.result as T;
}
const inspect = (bundle: Bundle): Inspected => tool<Inspected>("inspect_evidence", { bundle, evaluatedAt: EVALUATED_AT });
const invariants = (bundle: Bundle): Checked => tool<Checked>("check_invariants", { bundle, evaluatedAt: EVALUATED_AT });
const readiness = (bundle: Bundle): Readiness => tool<Readiness>("assess_vault_readiness", { bundle, evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" });
const trace = (bundle: Bundle, assertionId: string): Traced => tool<Traced>("trace_provenance", { bundle, assertionId });
const byId = (i: Inspected, id: string): Evaluated => {
  const e = i.assertions.find((a) => a.assertionId === id);
  assert.ok(e, `assertion ${id} is evaluated`);
  return e;
};
const hasViolation = (c: Checked, invariant: string, code: string, assertionId: string | null): boolean => c.violations.some((v) => v.invariant === invariant && v.code === code && v.assertionId === assertionId);
const statesIn = (i: Inspected): string => JSON.stringify(i.assertions.map((e) => [e.assertionId, e.supportState]));

type Kind = "sources" | "observations" | "derivations";
type AnyRecord = Source | Observation | Derivation;
const CODE: Readonly<Record<Kind, string>> = { sources: "DUPLICATE_SOURCE_ID", observations: "DUPLICATE_OBSERVATION_ID", derivations: "DUPLICATE_DERIVATION_ID" };
const ONE: Readonly<Record<Kind, string>> = { sources: "source", observations: "observation", derivations: "derivation" };

function withRecord(b: Bundle, kind: Kind, record: AnyRecord, first: boolean): Bundle {
  const list = b[kind] as AnyRecord[];
  return { ...clone(b), [kind]: clone(first ? [record, ...list] : [...list, record]) };
}

/** Every ordering of the records sharing an id, with the rest of their list after them and before them. */
function orderings(b: Bundle, kind: Kind, id: string): Bundle[] {
  const list = b[kind] as AnyRecord[];
  const shared = list.filter((r) => r.id === id);
  const others = list.filter((r) => r.id !== id);
  const perms = (xs: AnyRecord[]): AnyRecord[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms(xs.filter((_, j) => j !== i)).map((p) => [x, ...p])));
  return perms(shared).flatMap((p) => [[...p, ...others], [...others, ...p]].map((arranged) => ({ ...clone(b), [kind]: clone(arranged) })));
}

/** Everything every tool answers, leaving out only the digest of the supplied bytes, which follows their order by design. */
const answers = (b: Bundle, focus: string): string => JSON.stringify([{ ...inspect(b), bundleDigest: "" }, { ...invariants(b), bundleDigest: "" }, readiness(b), trace(b, focus)]);

/** The engine's own readiness suggestion placed back into the bundle, optionally overridden. */
function withDerivedReadiness(bundle: Bundle, over: Partial<Assertion> = {}): Bundle {
  const parsed = BundleSchema.parse(clone(bundle));
  const r = assessReadiness(parsed, evaluateBundle(parsed, EVALUATED_AT), "a-identity", "a-balance");
  const out = clone(bundle);
  out.derivations.push(r.suggestedDerivation);
  out.assertions.push({ ...r.suggestedAssertion, ...over });
  return out;
}

const balanceSubject = (over: Record<string, string> = {}): Record<string, string> => ({ chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, ...over });

/** A second chain-state reading and balance assertion, tweaked by the caller. */
function withSecondBalance(bundle: Bundle, subject: Record<string, string>, balanceAtomic: string): Bundle {
  const b = clone(bundle);
  b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-chain-2" });
  b.observations.push(balanceObservation({ id: "obs-balance-2", sourceId: "src-chain-2", subject, payload: { balanceAtomic, decimals: "6" } }));
  b.assertions.push(balanceAssertion({ id: "a-balance-2", subject, value: { balanceAtomic, decimals: "6" }, observationIds: ["obs-balance-2"] }));
  return b;
}

const USD_RULE = { ruleId: "wwdr.usd-value", rulesVersion: "0.1.0-draft" } as const;
const READINESS_RULE = { ruleId: "wwvr.vault-technical-readiness", rulesVersion: "0.1.0-draft" } as const;

/** golden() with the balance input naming a derivation: the only way a derivation id can be a dependency of a readiness input. */
function balanceNamingADerivation(): Bundle {
  const b = golden();
  b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, derivationId: "d-balance" } : a));
  b.derivations.push({ id: "d-balance", ...USD_RULE, inputAssertionIds: ["a-identity"], outputAssertionId: "a-balance" });
  return b;
}

interface Scenario {
  label: string;
  kind: Kind;
  id: string;
  /** Holds the honest record of the id. */
  base: () => Bundle;
  /** The record that competes with it: in the first-record reading of the id it changes the answer. */
  rival: AnyRecord;
  citedBy: string;
  /** What the citing assertion reports once the reference resolves to nothing. */
  limitations: string[];
  observationIds: string[];
  lineage: string[];
  /** The assertion id of the DANGLING_REFERENCE check_invariants reports; undefined when a missing record is not such a violation. */
  dangling?: string | null;
  /**
   * The citing claim is a direct claim type, which no derivation can support, so either record already leaves it NOT_ESTABLISHED
   * and only its reason moves with record order: the tests of its state and of the rival-first reading are controls here.
   */
  alreadyRefused?: true;
}

const SCENARIOS: readonly Scenario[] = [
  {
    label: "the source of the balance input",
    kind: "sources",
    id: "src-chain",
    base: golden,
    rival: { id: "src-chain", kind: "PROVIDER_ENDPOINT", transport: { retrievedVia: "RivalTransport" }, independenceGroup: "grp-chain" },
    citedBy: "a-balance",
    limitations: ["DANGLING_REFERENCE"],
    observationIds: ["obs-balance"],
    lineage: ["a-balance", "obs-balance"],
    dangling: null,
  },
  {
    label: "the source of the identity input",
    kind: "sources",
    id: "src-issuer",
    base: golden,
    rival: { id: "src-issuer", kind: "ISSUER_PUBLICATION", authorityId: "issuer:tether", independenceGroup: "grp-issuer" },
    citedBy: "a-identity",
    limitations: ["DANGLING_REFERENCE"],
    observationIds: ["obs-identity"],
    lineage: ["a-identity", "obs-identity"],
    dangling: null,
  },
  {
    label: "the observation of the balance input",
    kind: "observations",
    id: "obs-balance",
    base: golden,
    rival: balanceObservation({ payload: { balanceAtomic: "999", decimals: "6" } }),
    citedBy: "a-balance",
    limitations: ["DANGLING_REFERENCE", "NO_SOURCE"],
    observationIds: [],
    lineage: ["a-balance"],
    dangling: "a-balance",
  },
  {
    label: "the observation of the identity input",
    kind: "observations",
    id: "obs-identity",
    base: golden,
    rival: identityObservation({ result: "NO_RESULT", payload: {} }),
    citedBy: "a-identity",
    limitations: ["DANGLING_REFERENCE", "NO_SOURCE"],
    observationIds: [],
    lineage: ["a-identity"],
    dangling: "a-identity",
  },
  {
    label: "a derivation the balance input names",
    kind: "derivations",
    id: "d-balance",
    base: balanceNamingADerivation,
    rival: { id: "d-balance", ...USD_RULE, inputAssertionIds: ["a-identity"], outputAssertionId: "someone-else" },
    citedBy: "a-balance",
    limitations: ["DERIVATION_MISSING"],
    observationIds: [],
    lineage: ["a-balance", "obs-balance"],
    alreadyRefused: true,
  },
  {
    label: "the derivation of a recorded readiness claim",
    kind: "derivations",
    id: "readiness-derivation",
    base: () => withDerivedReadiness(golden()),
    rival: { id: "readiness-derivation", ...READINESS_RULE, inputAssertionIds: ["a-identity"], outputAssertionId: "readiness-result" },
    citedBy: "readiness-result",
    limitations: ["DERIVATION_MISSING"],
    observationIds: [],
    lineage: ["readiness-result"],
  },
  {
    label: "the derivation of a USD value",
    kind: "derivations",
    id: "d-usd",
    base: () => withUsdValue(golden()),
    rival: { id: "d-usd", ...USD_RULE, inputAssertionIds: ["a-balance"], outputAssertionId: "a-usd" },
    citedBy: "a-usd",
    limitations: ["DERIVATION_MISSING"],
    observationIds: [],
    lineage: ["a-usd"],
  },
];

const ORDERS: readonly (readonly [string, boolean])[] = [
  ["honest record first", false],
  ["rival record first", true],
];

describe("a reused source, observation or derivation id names no record, whichever record comes first", () => {
  for (const s of SCENARIOS) {
    const code = CODE[s.kind];
    const bundle = (rivalFirst: boolean): Bundle => withRecord(s.base(), s.kind, s.rival, rivalFirst);
    const controlWhenAlreadyRefused = s.alreadyRefused === true ? "CONTROL: " : "";

    test(`${controlWhenAlreadyRefused}${s.label}: record order does not decide the readiness classification`, () => {
      assert.deepEqual(ORDERS.map(([, first]) => readiness(bundle(first)).classification), ["NOT_ESTABLISHED", "NOT_ESTABLISHED"]);
    });

    test(`${controlWhenAlreadyRefused}${s.label}: record order does not decide the state of ${s.citedBy}`, () => {
      assert.deepEqual(ORDERS.map(([, first]) => byId(inspect(bundle(first)), s.citedBy).supportState), ["NOT_ESTABLISHED", "NOT_ESTABLISHED"]);
    });

    test(`${s.label}: every ordering of the records gets one answer from every tool`, () => {
      const seen = new Set(orderings(bundle(false), s.kind, s.id).map((b) => answers(b, s.citedBy)));
      assert.equal(seen.size, 1, `the answers depend on record order: ${String(seen.size)} different answers`);
    });

    test(`CONTROL: ${s.label}: check_invariants fails and reports ${code} against no assertion`, () => {
      for (const [, first] of ORDERS) {
        const c = invariants(bundle(first));
        assert.equal(c.pass, false);
        assert.ok(hasViolation(c, "INV-00", code, null), JSON.stringify(c.violations));
      }
    });

    if (s.dangling !== undefined) {
      test(`${s.label}: check_invariants reports the reference it left dangling`, () => {
        for (const [, first] of ORDERS) {
          const c = invariants(bundle(first));
          assert.ok(hasViolation(c, "INV-00", "DANGLING_REFERENCE", s.dangling ?? null), `no INV-00 DANGLING_REFERENCE: ${JSON.stringify(c.violations)}`);
        }
      });
    }

    for (const [order, first] of ORDERS) {
      test(`${s.label}, ${order}: readiness refuses, every criterion INDETERMINATE (${code})`, () => {
        const r = readiness(bundle(first));
        assert.deepEqual(r.criteria.map((c) => [c.id, c.outcome, c.reason]), ["C1", "C2", "C3", "C4", "C5", "C6"].map((id) => [id, "INDETERMINATE", code]));
        assert.equal(r.classification, "NOT_ESTABLISHED");
        assert.equal(r.supportOfInputs, "NOT_ESTABLISHED");
        assert.equal(r.suggestedAssertion.value?.["classification"], "NOT_ESTABLISHED");
      });

      test(`${s.label}, ${order}: no assertion in the bundle stays above NOT_ESTABLISHED`, () => {
        const i = inspect(bundle(first));
        assert.ok(i.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(i));
        assert.ok(i.invariantViolationCount > 0);
      });

      test(`${first ? controlWhenAlreadyRefused : ""}${s.label}, ${order}: ${s.citedBy} has no record behind the reference`, () => {
        const e = byId(inspect(bundle(first)), s.citedBy);
        for (const limitation of s.limitations) assert.ok(e.limitations.includes(limitation), `${limitation} missing from ${e.limitations.join()}`);
        assert.deepEqual(e.dependencies.observationIds, s.observationIds);
        assert.deepEqual(e.dependencies.assertionIds, []);
        assert.equal(e.authority?.satisfied, false);
      });

      test(`${s.label}, ${order}: provenance reports the reference as dangling and shows neither record`, () => {
        const t = trace(bundle(first), s.citedBy);
        assert.deepEqual(t.issues, [{ code: "DANGLING_REFERENCE", id: s.id }]);
        assert.deepEqual(t.lineage.map((l) => l.id), s.lineage);
        if (s.kind === "sources") {
          assert.deepEqual(t.prov.agent, {}, "no source is an agent");
          assert.deepEqual(t.prov.wasAttributedTo, {}, "nothing is attributed to a source");
        }
        if (s.kind === "observations") {
          assert.ok(!JSON.stringify(t.prov).includes(`obs/${s.id}`), "no observation entity is shown");
          assert.deepEqual(t.prov.wasDerivedFrom, {}, "nothing is derived from an observation");
        }
        if (s.kind === "derivations") {
          assert.deepEqual([t.prov.activity, t.prov.wasGeneratedBy, t.prov.used], [{}, {}, {}], "no derivation activity is shown");
          assert.ok(!Object.keys(t.prov.agent).includes("ww:agent/walletwall-rules"), "no rule is credited");
        }
      });

      test(`${s.label}, ${order}: readiness and inspect agree on the inputs`, () => {
        const b = bundle(first);
        const i = inspect(b);
        const r = readiness(b);
        assert.deepEqual(r.inputs.map((x) => x.assertionId), ["a-identity", "a-balance"]);
        for (const input of r.inputs) assert.deepEqual([input.supportState, input.digest], ["NOT_ESTABLISHED", byId(i, input.assertionId).digest], input.assertionId);
      });
    }
  }
});

describe("a reused id stops the bundle even when nothing cites it and when its records are identical", () => {
  const UNCITED: readonly (readonly [string, Kind, string, AnyRecord])[] = [
    ["a source no observation reads", "sources", "src-uncited", { id: "src-uncited", kind: "USER_INPUT" }],
    ["an observation no assertion cites", "observations", "obs-uncited", balanceObservation({ id: "obs-uncited" })],
    ["a derivation no assertion cites", "derivations", "d-uncited", { id: "d-uncited", ...USD_RULE, inputAssertionIds: [], outputAssertionId: "a-nobody" }],
  ];

  for (const [label, kind, id, record] of UNCITED) {
    const b = withRecord(withRecord(golden(), kind, record, false), kind, record, false);

    test(`${label}, reused: CRITERIA_MET does not sit beside ${CODE[kind]}`, () => {
      const r = readiness(b);
      assert.equal(r.classification, "NOT_ESTABLISHED", `readiness next to ${invariants(b).violations.map((v) => v.code).join()}`);
      assert.ok(r.criteria.every((c) => c.outcome === "INDETERMINATE" && c.reason === CODE[kind]), JSON.stringify(r.criteria));
    });

    test(`${label}, reused: no assertion stays positive beside ${CODE[kind]}`, () => {
      const i = inspect(b);
      assert.ok(i.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(i));
    });

    test(`${label}, reused: every assertion keeps what it has of its own, and only support is overridden`, () => {
      const honest = inspect(golden());
      const refused = inspect(b);
      assert.deepEqual(
        refused.assertions.map((e) => ({ ...e, supportState: "" })),
        honest.assertions.map((e) => ({ ...e, supportState: "" })),
      );
      assert.ok(refused.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(refused));
    });

    test(`CONTROL: ${label}, reused: provenance of a claim with no path to the id reports nothing about it`, () => {
      assert.deepEqual(trace(b, "a-balance").issues, []);
      assert.ok(!JSON.stringify(trace(b, "a-balance")).includes(id));
    });

    test(`CONTROL: ${label}, reused: check_invariants reports ${CODE[kind]}`, () => {
      assert.ok(hasViolation(invariants(b), "INV-00", CODE[kind], null));
    });
  }

  const IDENTICAL: readonly (readonly [string, Kind, string, () => Bundle, string, string])[] = [
    ["two identical source records", "sources", "src-chain", golden, "a-balance", "DANGLING_REFERENCE"],
    ["two identical observation records", "observations", "obs-balance", golden, "a-balance", "DANGLING_REFERENCE"],
    ["two identical derivation records", "derivations", "d-usd", () => withUsdValue(golden()), "a-usd", "DERIVATION_MISSING"],
  ];

  for (const [label, kind, id, base, citedBy, limitation] of IDENTICAL) {
    test(`${label} are refused like any others: nothing says the copy was meant`, () => {
      const honest = base();
      const copy = (honest[kind] as AnyRecord[]).find((r) => r.id === id) as AnyRecord;
      const b = withRecord(honest, kind, copy, false);
      const i = inspect(b);
      assert.ok(i.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(i));
      assert.ok(byId(i, citedBy).limitations.includes(limitation), byId(i, citedBy).limitations.join());
      assert.equal(readiness(b).classification, "NOT_ESTABLISHED");
      assert.deepEqual(trace(b, citedBy).issues, [{ code: "DANGLING_REFERENCE", id }]);
    });
  }
});

describe("what a reused id does to the claims that depend on it", () => {
  const rivalBalanceSource: Source = { id: "src-chain", kind: "PROVIDER_ENDPOINT", independenceGroup: "grp-chain" };
  const rivalBalanceReading = balanceObservation({ payload: { balanceAtomic: "999", decimals: "6" } });
  const rivalPriceSource: Source = { id: "src-prov-a", kind: "USER_INPUT", independenceGroup: "grp-a" };

  const THROUGH: readonly (readonly [string, Kind, AnyRecord, () => Bundle, string, string[], { code: string; id: string }])[] = [
    ["a recorded readiness claim over a reused source of its balance input", "sources", rivalBalanceSource, () => withDerivedReadiness(golden()), "readiness-result", ["DANGLING_REFERENCE"], { code: "DANGLING_REFERENCE", id: "src-chain" }],
    ["a recorded readiness claim over a reused observation of its balance input", "observations", rivalBalanceReading, () => withDerivedReadiness(golden()), "readiness-result", ["DANGLING_REFERENCE", "NO_SOURCE"], { code: "DANGLING_REFERENCE", id: "obs-balance" }],
    ["a USD value over a reused source of its price input", "sources", rivalPriceSource, () => withUsdValue(golden()), "a-usd", ["DANGLING_REFERENCE"], { code: "DANGLING_REFERENCE", id: "src-prov-a" }],
  ];

  for (const [label, kind, rival, base, derived, inherited, issue] of THROUGH) {
    for (const [order, first] of ORDERS) {
      test(`${label}, ${order}: the derived claim is refused and inherits what its input reports`, () => {
        const b = withRecord(base(), kind, rival, first);
        const e = byId(inspect(b), derived);
        assert.equal(e.supportState, "NOT_ESTABLISHED");
        for (const limitation of inherited) assert.ok(e.limitations.includes(limitation), `${limitation} missing from ${e.limitations.join()}`);
        assert.ok(trace(b, derived).issues.some((x) => x.code === issue.code && x.id === issue.id), JSON.stringify(trace(b, derived).issues));
      });
    }
  }

  test("a recorded CRITERIA_MET over a reused source: in either order, recomputation says it is not what the rule gives", () => {
    const reported = ORDERS.map(([, first]) => hasViolation(invariants(withRecord(withDerivedReadiness(golden()), "sources", rivalBalanceSource, first)), "INV-00", "RECOMPUTATION_MISMATCH", "readiness-result"));
    assert.deepEqual(reported, [true, true]);
  });

  test("a recorded NOT_ESTABLISHED over a reused source: in either order, it is what the rule gives", () => {
    const reported = ORDERS.map(([, first]) => hasViolation(invariants(withRecord(withDerivedReadiness(golden(), { value: { classification: "NOT_ESTABLISHED" } }), "sources", rivalBalanceSource, first)), "INV-00", "RECOMPUTATION_MISMATCH", "readiness-result"));
    assert.deepEqual(reported, [false, false]);
  });

  for (const [order, first] of ORDERS) {
    test(`a USD value and a declared state over a reused observation, ${order}: declaring more than the refusal is reported`, () => {
      const declared = withUsdValue(golden());
      declared.assertions = declared.assertions.map((a) => (a.id === "a-identity" ? { ...a, declared: { supportState: "ESTABLISHED" } } : a));
      const b = withRecord(declared, "observations", rivalBalanceReading, first);
      assert.ok(hasViolation(invariants(b), "INV-00", "DECLARED_SUPPORT_EXCEEDS_COMPUTED", "a-identity"), JSON.stringify(invariants(b).violations));
    });
  }

  test("a reused id overrides every lifecycle state: conflicts and supersessions stay shown, and no state looks like a verdict about one record", () => {
    const uncited: Source = { id: "src-uncited", kind: "USER_INPUT" };
    const conflict = withSecondBalance(golden(), balanceSubject(), "999");
    conflict.sources.push(uncited, clone(uncited));
    const conflicted = inspect(conflict);
    assert.deepEqual(byId(conflicted, "a-balance").conflictsWith, ["a-balance-2"], "the conflict is still shown");
    assert.ok(conflicted.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(conflicted));

    const superseded = withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001", blockHash: `0x${"cd".repeat(32)}` }), "1400000");
    superseded.assertions = superseded.assertions.map((a) => (a.id === "a-balance-2" ? { ...a, assertedAt: EVALUATED_AT } : a));
    superseded.supersessions = [{ id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" }];
    superseded.sources.push(uncited, clone(uncited));
    const replaced = inspect(superseded);
    assert.equal(byId(replaced, "a-balance").supersededBy, "a-balance-2", "the supersession is still shown");
    assert.ok(replaced.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(replaced));
  });
});

describe("several reused ids", () => {
  const rivalSource: Source = { id: "src-chain", kind: "PROVIDER_ENDPOINT", independenceGroup: "grp-chain" };
  const rivalReading = balanceObservation({ payload: { balanceAtomic: "999", decimals: "6" } });
  const rivalDerivation: Derivation = { id: "d-usd", ...USD_RULE, inputAssertionIds: ["a-balance"], outputAssertionId: "a-usd" };
  const world = (): Bundle => withUsdValue(golden());
  const reusedAssertion = (b: Bundle): Bundle => {
    const out = clone(b);
    out.assertions.push(identityAssertion({ value: { symbol: "USDT", decimals: "6", issuerAuthorityId: "issuer:circle" } }));
    return out;
  };

  const MIXED: readonly (readonly [string, (b: Bundle) => Bundle, string[], string])[] = [
    ["source and observation", (b) => withRecord(withRecord(b, "observations", rivalReading, false), "sources", rivalSource, false), ["DUPLICATE_SOURCE_ID", "DUPLICATE_OBSERVATION_ID"], "DUPLICATE_SOURCE_ID"],
    ["source and derivation", (b) => withRecord(withRecord(b, "derivations", rivalDerivation, false), "sources", rivalSource, false), ["DUPLICATE_SOURCE_ID", "DUPLICATE_DERIVATION_ID"], "DUPLICATE_SOURCE_ID"],
    ["observation and derivation", (b) => withRecord(withRecord(b, "derivations", rivalDerivation, false), "observations", rivalReading, false), ["DUPLICATE_OBSERVATION_ID", "DUPLICATE_DERIVATION_ID"], "DUPLICATE_OBSERVATION_ID"],
    ["all three", (b) => withRecord(withRecord(withRecord(b, "derivations", rivalDerivation, false), "observations", rivalReading, false), "sources", rivalSource, false), ["DUPLICATE_SOURCE_ID", "DUPLICATE_OBSERVATION_ID", "DUPLICATE_DERIVATION_ID"], "DUPLICATE_SOURCE_ID"],
  ];

  for (const [label, reuse, codes, reason] of MIXED) {
    test(`${label}: readiness gives one fixed reason, ${reason}, and check_invariants reports them all`, () => {
      const b = reuse(world());
      assert.ok(readiness(b).criteria.every((c) => c.outcome === "INDETERMINATE" && c.reason === reason), JSON.stringify(readiness(b).criteria));
      const reported = invariants(b).violations.filter((v) => v.code.startsWith("DUPLICATE_")).map((v) => v.code);
      assert.deepEqual([...reported].sort(), [...codes].sort());
    });
  }

  test("CONTROL: beside a reused assertion id the reason stays DUPLICATE_ASSERTION_ID, as published, whatever else is reused", () => {
    for (const [label, reuse] of MIXED) {
      const r = readiness(reuse(reusedAssertion(world())));
      assert.ok(r.criteria.every((c) => c.reason === "DUPLICATE_ASSERTION_ID"), `${label}: ${JSON.stringify(r.criteria)}`);
    }
  });

  const BESIDE_AN_ASSERTION: readonly (readonly [string, Kind, string, AnyRecord, string])[] = [
    ["source", "sources", "src-chain", rivalSource, "a-balance"],
    ["observation", "observations", "obs-balance", rivalReading, "a-balance"],
    ["derivation", "derivations", "d-usd", rivalDerivation, "a-usd"],
  ];
  for (const [label, kind, id, rival, citedBy] of BESIDE_AN_ASSERTION) {
    test(`a reused ${label} id beside a reused assertion id still names no record: every ordering of its records gets one answer`, () => {
      const b = withRecord(reusedAssertion(world()), kind, rival, false);
      const seen = new Set(orderings(b, kind, id).map((x) => answers(x, citedBy)));
      assert.equal(seen.size, 1, `${String(seen.size)} different answers`);
      assert.deepEqual(trace(b, citedBy).issues, [{ code: "DANGLING_REFERENCE", id }]);
    });
  }

  test("three records of one id: every ordering gets one answer", () => {
    const b = withRecord(withRecord(golden(), "sources", rivalSource, false), "sources", { id: "src-chain", kind: "USER_INPUT" }, false);
    const seen = new Set(orderings(b, "sources", "src-chain").map((x) => answers(x, "a-balance")));
    assert.equal(seen.size, 1, `${String(seen.size)} different answers`);
    assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
  });

  // One reused id per kind, each cited by a claim of its own, so no reference hides another.
  const ONE_OF_EACH: Readonly<Record<Kind, readonly [string, AnyRecord, string, string]>> = {
    sources: ["src-issuer", { id: "src-issuer", kind: "ISSUER_PUBLICATION", authorityId: "issuer:tether" }, "a-identity", "DANGLING_REFERENCE"],
    observations: ["obs-balance", rivalReading, "a-balance", "DANGLING_REFERENCE"],
    derivations: ["d-usd", rivalDerivation, "a-usd", "DERIVATION_MISSING"],
  };
  const TOGETHER: readonly (readonly Kind[])[] = [["sources", "observations"], ["sources", "derivations"], ["observations", "derivations"], ["sources", "observations", "derivations"]];
  for (const kinds of TOGETHER) {
    test(`${kinds.join(" and ")} reused together: each still names no record, and every combination of orders gets one answer`, () => {
      const b = kinds.reduce((x, kind) => withRecord(x, kind, ONE_OF_EACH[kind][1], false), world());
      const i = inspect(b);
      for (const kind of kinds) {
        const [id, , citedBy, limitation] = ONE_OF_EACH[kind];
        assert.ok(byId(i, citedBy).limitations.includes(limitation), `${citedBy}: ${byId(i, citedBy).limitations.join()}`);
        assert.deepEqual(trace(b, citedBy).issues, [{ code: "DANGLING_REFERENCE", id }], citedBy);
      }
      const arranged = kinds.reduce<Bundle[]>((xs, kind) => xs.flatMap((x) => orderings(x, kind, ONE_OF_EACH[kind][0])), [b]);
      const seen = new Set(arranged.map((x) => answers(x, ONE_OF_EACH[kinds[0] as Kind][2])));
      assert.equal(seen.size, 1, `${String(seen.size)} different answers`);
    });
  }

  for (const kind of ["sources", "observations", "derivations"] as const) {
    const uncited = (id: string): AnyRecord => (kind === "sources" ? { id, kind: "USER_INPUT" } : kind === "observations" ? balanceObservation({ id }) : { id, ...USD_RULE, inputAssertionIds: [], outputAssertionId: "a-nobody" });
    test(`two different reused ${ONE[kind]} ids still refuse the bundle`, () => {
      const b = [uncited("first-reused"), uncited("first-reused"), uncited("second-reused"), uncited("second-reused")].reduce((x, r) => withRecord(x, kind, r, false), golden());
      assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
      assert.ok(readiness(b).criteria.every((c) => c.outcome === "INDETERMINATE" && c.reason === CODE[kind]), JSON.stringify(readiness(b).criteria));
    });
  }

  const THREE: readonly (readonly [string, Kind, string, () => Bundle, readonly AnyRecord[], string, string])[] = [
    ["observation", "observations", "obs-balance", golden, [rivalReading, balanceObservation({ payload: { balanceAtomic: "1", decimals: "6" } })], "a-balance", "DANGLING_REFERENCE"],
    ["derivation", "derivations", "d-usd", world, [rivalDerivation, { ...rivalDerivation, outputAssertionId: "someone-else" }], "a-usd", "DERIVATION_MISSING"],
  ];
  for (const [label, kind, id, base, rivals, citedBy, limitation] of THREE) {
    test(`three records of one ${label} id: refused like two, and every ordering gets one answer`, () => {
      const b = rivals.reduce((x, r) => withRecord(x, kind, r, false), base());
      assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
      assert.ok(byId(inspect(b), citedBy).limitations.includes(limitation));
      const seen = new Set(orderings(b, kind, id).map((x) => answers(x, citedBy)));
      assert.equal(seen.size, 1, `${String(seen.size)} different answers`);
    });
  }

  test("CONTROL: three records of one assertion id are refused like two", () => {
    const b = clone(golden());
    b.assertions.push(balanceAssertion({ value: { balanceAtomic: "1", decimals: "6" } }), balanceAssertion({ value: { balanceAtomic: "2", decimals: "6" } }));
    assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
    assert.deepEqual(trace(b, "a-balance").issues, [{ code: "TARGET_NOT_FOUND", id: null }]);
  });
});

describe("a reused id overrides every state, and nothing else", () => {
  const OTHER_HASH = `0x${"cd".repeat(32)}`;
  const holderOf = (digit: string): string => `0x${digit.repeat(40)}`;

  /** A balance about a holder of its own unless told otherwise, so that nothing in a fixture conflicts by accident. */
  function addBalance(b: Bundle, tag: string, assertion: Partial<Assertion> = {}, reading: Partial<Observation> = {}, subject = balanceSubject({ holder: holderOf(tag) })): void {
    b.observations.push(balanceObservation({ id: `obs-${tag}`, subject, ...reading }));
    b.assertions.push(balanceAssertion({ id: `a-${tag}`, subject, observationIds: [`obs-${tag}`], ...assertion }));
  }

  /** Evidence in which, with no reused id, every support state appears, direct and derived. */
  function everyState(): Bundle {
    const b = withDerivedReadiness(withUsdValue(golden()));
    addBalance(b, "1", { value: null }, { result: "NO_RESULT", payload: {} });
    addBalance(b, "2", { temporality: "CURRENT" }, { observedAt: "2020-01-01T00:00:00Z" });
    addBalance(b, "3", { origin: "PROVIDER_OBSERVED" }, { origin: "PROVIDER_OBSERVED", sourceId: "src-prov-a" });
    addBalance(b, "4");
    addBalance(b, "5", { assertedAt: EVALUATED_AT }, {}, balanceSubject({ holder: holderOf("4"), blockNumber: "21000001", blockHash: OTHER_HASH }));
    addBalance(b, "6");
    addBalance(b, "7", { value: { balanceAtomic: "999", decimals: "6" } }, { payload: { balanceAtomic: "999", decimals: "6" } }, balanceSubject({ holder: holderOf("6") }));
    addBalance(b, "8", { value: { balanceAtomic: "1", decimals: "6" } });
    addBalance(b, "9");
    b.derivations.push({ id: "d-usd-old", ...USD_RULE, inputAssertionIds: ["a-balance", "a-price"], outputAssertionId: "a-usd-old" });
    b.assertions.push({ ...clone(b.assertions.find((a) => a.id === "a-usd") as Assertion), id: "a-usd-old", derivationId: "d-usd-old", assertedAt: "2026-10-23T12:00:00Z" });
    b.supersessions = [
      { id: "s-1", supersededAssertionId: "a-4", supersedingAssertionId: "a-5", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" },
      { id: "s-2", supersededAssertionId: "a-usd-old", supersedingAssertionId: "a-usd", effectiveAt: EVALUATED_AT, reason: "RULES_UPDATED" },
    ];
    b.conflicts = [{ id: "c-1", assertionIds: ["readiness-result", "a-9"], reason: "SUBJECT_DISAGREEMENT" }];
    return b;
  }
  const EVERY_STATE: Readonly<Record<string, string>> = {
    "a-identity": "ESTABLISHED",
    "a-balance": "ESTABLISHED",
    "a-price": "SUPPORTED",
    "a-usd": "SUPPORTED",
    "a-usd-old": "SUPERSEDED",
    "readiness-result": "CONFLICTING",
    "a-1": "UNKNOWN",
    "a-2": "STALE",
    "a-3": "PARTIAL",
    "a-4": "SUPERSEDED",
    "a-5": "ESTABLISHED",
    "a-6": "CONFLICTING",
    "a-7": "CONFLICTING",
    "a-8": "NOT_ESTABLISHED",
    "a-9": "CONFLICTING",
  };

  const UNCITED: Readonly<Record<Kind, AnyRecord>> = {
    sources: { id: "uncited", kind: "USER_INPUT" },
    observations: balanceObservation({ id: "uncited" }),
    derivations: { id: "uncited", ...USD_RULE, inputAssertionIds: [], outputAssertionId: "a-nobody" },
  };
  const KINDS = Object.keys(UNCITED) as Kind[];
  const withUncited = (b: Bundle, kind: Kind): Bundle => withRecord(withRecord(b, kind, UNCITED[kind], false), kind, UNCITED[kind], false);
  const withReusedAssertionNothingCites = (b: Bundle): Bundle => {
    const out = clone(b);
    const record = balanceAssertion({ id: "uncited", subject: balanceSubject({ holder: holderOf("e") }), value: null, observationIds: [] });
    out.assertions.push(record, clone(record));
    return out;
  };

  test("CONTROL: with no reused id the fixture reaches every support state", () => {
    assert.deepEqual(Object.fromEntries(inspect(everyState()).assertions.map((e) => [e.assertionId, e.supportState])), EVERY_STATE);
  });

  for (const kind of KINDS) {
    test(`a reused ${ONE[kind]} id overrides every one of those states`, () => {
      const i = inspect(withUncited(everyState(), kind));
      assert.deepEqual(i.assertions.map((e) => e.assertionId).sort(), Object.keys(EVERY_STATE).sort());
      assert.ok(i.assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(i));
    });
  }

  test("CONTROL: a reused assertion id overrides every one of those states, and its own supersession does not show through", () => {
    const b = withReusedAssertionNothingCites(everyState());
    assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
    const superseded = clone(everyState());
    superseded.assertions.push(balanceAssertion({ id: "a-5", value: { balanceAtomic: "1", decimals: "6" } }));
    superseded.supersessions = [{ id: "s-1", supersededAssertionId: "a-5", supersedingAssertionId: "a-balance", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
    const e = byId(inspect(superseded), "a-5");
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    assert.equal(e.supersededBy, "a-balance");
  });

  /**
   * Worlds each reaching a check of its own. Each states by hand what it reaches with no reused id, so that a world that stops
   * reaching its check fails here and not somewhere else, and what the refusal itself adds to check_invariants.
   */
  interface World {
    label: string;
    build: () => Bundle;
    assertions: readonly string[];
    limitations?: readonly string[];
    codes: readonly string[];
    /** A recorded classification the rule no longer gives once readiness is refused. */
    gains?: readonly string[];
  }
  const usdWorld = (over: Partial<Assertion> = {}): Bundle => {
    const b = withUsdValue(golden());
    b.assertions = b.assertions.map((a) => (a.id === "a-usd" ? { ...a, ...over } : a));
    return b;
  };
  const GOLDEN_IDS = ["a-balance", "a-identity", "a-price"];
  const USD_IDS = [...GOLDEN_IDS, "a-usd"];
  const WORLDS: readonly World[] = [
    { label: "golden evidence", build: golden, assertions: GOLDEN_IDS, codes: [] },
    { label: "a recorded readiness claim", build: () => withDerivedReadiness(golden()), assertions: [...GOLDEN_IDS, "readiness-result"], codes: [], gains: ["INV-00|RECOMPUTATION_MISMATCH|readiness-result"] },
    { label: "a USD value recomputation rejects", build: () => usdWorld({ value: { usdScaled18: "1", rounding: "FLOOR_SCALED_18" } }), assertions: USD_IDS, codes: ["RECOMPUTATION_MISMATCH"] },
    { label: "a derived claim dropping its inputs' limitations", build: () => usdWorld({ limitations: [] }), assertions: USD_IDS, codes: ["DEPENDENCY_LIMITATIONS_DROPPED"] },
    {
      label: "a USD value with no price input",
      build: () => {
        const b = usdWorld();
        b.derivations = b.derivations.map((d) => (d.id === "d-usd" ? { ...d, inputAssertionIds: ["a-balance"] } : d));
        return b;
      },
      assertions: USD_IDS,
      codes: ["USD_VALUE_WITHOUT_PRICE_EVIDENCE"],
    },
    {
      label: "a declared state above the computed one",
      build: () => {
        const b = clone(golden());
        b.assertions = b.assertions.map((a) => (a.id === "a-price" ? { ...a, declared: { supportState: "ESTABLISHED" } } : a));
        return b;
      },
      assertions: GOLDEN_IDS,
      codes: ["DECLARED_SUPPORT_EXCEEDS_COMPUTED"],
    },
    {
      label: "declared and detected conflicts",
      build: () => {
        const b = withSecondBalance(golden(), balanceSubject(), "999");
        b.conflicts = [{ id: "c-1", assertionIds: ["a-identity", "a-price"], reason: "AUTHORITY_DISAGREEMENT" }];
        return b;
      },
      assertions: ["a-balance", "a-balance-2", "a-identity", "a-price"],
      limitations: ["CONFLICT_DECLARED", "CONFLICT_DETECTED"],
      codes: [],
    },
    {
      label: "a supersession that is not forward in time",
      build: () => {
        const b = withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001", blockHash: OTHER_HASH }), "1400000");
        b.supersessions = [{ id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" }];
        return b;
      },
      assertions: ["a-balance", "a-balance-2", "a-identity", "a-price"],
      limitations: ["SUPERSEDED"],
      codes: ["SUPERSESSION_NOT_FORWARD_IN_TIME"],
    },
    {
      label: "a dependency cycle",
      build: () => {
        const b = usdWorld();
        b.derivations = b.derivations.map((d) => (d.id === "d-usd" ? { ...d, inputAssertionIds: ["a-balance", "a-price", "a-usd-2"] } : d));
        b.derivations.push({ id: "d-usd-2", ...USD_RULE, inputAssertionIds: ["a-usd", "a-price"], outputAssertionId: "a-usd-2" });
        b.assertions.push({ ...clone(b.assertions.find((a) => a.id === "a-usd") as Assertion), id: "a-usd-2", derivationId: "d-usd-2" });
        return b;
      },
      assertions: [...USD_IDS, "a-usd-2"],
      limitations: ["DEPENDENCY_CYCLE"],
      // Neither claim in the cycle declares DEPENDENCY_CYCLE, so each is reported.
      codes: ["DEPENDENCY_LIMITATIONS_DROPPED", "DEPENDENCY_LIMITATIONS_DROPPED"],
    },
    { label: "bundle versions that are not the engine's", build: () => ({ ...golden(), registryVersion: "9.9.9", rulesVersion: "9.9.9" }), assertions: GOLDEN_IDS, limitations: ["REGISTRY_VERSION_MISMATCH", "RULES_VERSION_MISMATCH"], codes: [] },
  ];

  /** A USD value over a balance a newer one supersedes. Support is not all that moves here: see the test below. */
  function supersededInput(): Bundle {
    const b = withUsdValue(withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001", blockHash: OTHER_HASH }), "1400000"));
    b.assertions = b.assertions.map((a) => {
      if (a.id === "a-balance-2") return { ...a, assertedAt: EVALUATED_AT };
      return a.id === "a-balance" || a.id === "a-usd" ? { ...a, temporality: "CURRENT" as const } : a;
    });
    b.supersessions = [{ id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" }];
    return b;
  }

  const reaches = (w: World, honest: Bundle): void => {
    assert.deepEqual(inspect(honest).assertions.map((e) => e.assertionId), w.assertions, "the world's assertions");
    assert.deepEqual(invariants(honest).violations.map((v) => v.code), w.codes, "what it reports with no reused id");
    const limitations = inspect(honest).assertions.flatMap((e) => e.limitations);
    for (const limitation of w.limitations ?? []) assert.ok(limitations.includes(limitation), `${limitation} is not reached`);
  };
  const keyOf = (v: Violation): string => `${v.invariant}|${v.code}|${String(v.assertionId)}`;

  for (const w of WORLDS) {
    for (const kind of KINDS) {
      test(`CONTROL: ${w.label}, beside a reused ${ONE[kind]} id nothing cites: only the refusal moves`, () => {
        const honest = w.build();
        reaches(w, honest);
        const b = withUncited(honest, kind);
        const apartFromSupport = (i: Inspected): unknown => i.assertions.map((e) => ({ ...e, supportState: "" }));
        assert.deepEqual(apartFromSupport(inspect(b)), apartFromSupport(inspect(honest)), "evaluation");
        const fromTheRefusal = new Set([`INV-00|${CODE[kind]}|null`, ...(w.gains ?? [])]);
        assert.deepEqual(invariants(b).violations.map(keyOf).filter((k) => !fromTheRefusal.has(k)), invariants(honest).violations.map(keyOf), "check_invariants");
        for (const e of inspect(honest).assertions) assert.deepEqual(trace(b, e.assertionId), trace(honest, e.assertionId), e.assertionId);
        const details = (r: Readiness): unknown => ({ limitations: r.limitations, inputs: r.inputs.map((x) => [x.assertionId, x.digest]), derivation: r.suggestedDerivation, assertion: { ...r.suggestedAssertion, value: null } });
        assert.deepEqual(details(readiness(b)), details(readiness(honest)), "readiness beside its verdict");
      });
    }
  }

  const SAME_AS_AN_ASSERTION_ID: readonly World[] = [
    ...WORLDS,
    {
      label: "every support state",
      build: everyState,
      assertions: Object.keys(EVERY_STATE).sort(),
      codes: [],
    },
    {
      label: "a derived claim over a superseded input",
      build: supersededInput,
      assertions: ["a-balance", "a-balance-2", "a-identity", "a-price", "a-usd"],
      limitations: ["DEPENDENCY_SUPERSEDED", "STALE_EVIDENCE"],
      // The USD claim does not declare its input's SUPERSEDED.
      codes: ["DEPENDENCY_LIMITATIONS_DROPPED"],
    },
  ];
  for (const w of SAME_AS_AN_ASSERTION_ID) {
    for (const kind of KINDS) {
      test(`${w.label}: a reused ${ONE[kind]} id nothing cites reads exactly as a reused assertion id nothing cites`, () => {
        const honest = w.build();
        reaches(w, honest);
        const b = withUncited(honest, kind);
        const asAssertion = withReusedAssertionNothingCites(honest);
        assert.deepEqual(inspect(b).assertions, inspect(asAssertion).assertions.filter((e) => e.assertionId !== "uncited"), "evaluation");
        const apartFromTheCode = (c: Checked): Violation[] => c.violations.filter((v) => !v.code.startsWith("DUPLICATE_"));
        assert.deepEqual(apartFromTheCode(invariants(b)), apartFromTheCode(invariants(asAssertion)), "check_invariants");
        const apartFromTheReason = (r: Readiness): unknown => ({ ...r, criteria: r.criteria.map((c) => ({ ...c, reason: "" })), resultDigest: "" });
        assert.deepEqual(apartFromTheReason(readiness(b)), apartFromTheReason(readiness(asAssertion)), "readiness");
        for (const e of inspect(honest).assertions) assert.deepEqual(trace(b, e.assertionId), trace(asAssertion, e.assertionId), e.assertionId);
      });
    }
  }

  test("a derived claim over a superseded input, beside a reused id, reads the input as NOT_ESTABLISHED: the supersession stays a limitation, and what followed from it is gone", () => {
    const honest = byId(inspect(supersededInput()), "a-usd");
    assert.deepEqual([honest.supportState, honest.freshnessState], ["STALE", "STALE"], "with no reused id the claim is stale");
    assert.ok(honest.limitations.includes("DEPENDENCY_SUPERSEDED") && honest.limitations.includes("STALE_EVIDENCE"), honest.limitations.join());
    // Recorded as it is, not as it should be: a refused claim can read CURRENT here, as it has beside a reused assertion id since that was first refused.
    for (const b of [...KINDS.map((kind) => withUncited(supersededInput(), kind)), withReusedAssertionNothingCites(supersededInput())]) {
      const e = byId(inspect(b), "a-usd");
      assert.deepEqual([e.supportState, e.freshnessState], ["NOT_ESTABLISHED", "CURRENT"]);
      assert.ok(e.limitations.includes("SUPERSEDED"), e.limitations.join());
      assert.ok(!e.limitations.includes("DEPENDENCY_SUPERSEDED") && !e.limitations.includes("STALE_EVIDENCE"), e.limitations.join());
    }
  });

  test("readiness over any inputs gives the same refusal: a missing or mistyped input does not hide a reused id", () => {
    for (const kind of KINDS) {
      const b = withUncited(golden(), kind);
      const refused = (identityAssertionId: string, balanceAssertionId: string): Readiness => tool<Readiness>("assess_vault_readiness", { bundle: b, evaluatedAt: EVALUATED_AT, identityAssertionId, balanceAssertionId });
      for (const [identity, balance] of [["nope", "a-balance"], ["a-identity", "nope"], ["nope", "nope"], ["a-balance", "a-identity"], ["a-price", "a-price"]] as const) {
        const r = refused(identity, balance);
        assert.equal(r.classification, "NOT_ESTABLISHED", `${identity} ${balance}`);
        assert.ok(r.criteria.every((c) => c.outcome === "INDETERMINATE" && c.reason === CODE[kind]), `${identity} ${balance}: ${JSON.stringify(r.criteria)}`);
      }
    }
  });

  test("the refusal does not depend on what anything is called", () => {
    const named = JSON.parse(JSON.stringify(golden()).replaceAll("a-identity", "my-identity").replaceAll("a-balance", "my-balance")) as Bundle;
    for (const kind of KINDS) {
      const b = withUncited(named, kind);
      const r = tool<Readiness>("assess_vault_readiness", { bundle: b, evaluatedAt: EVALUATED_AT, identityAssertionId: "my-identity", balanceAssertionId: "my-balance" });
      assert.equal(r.classification, "NOT_ESTABLISHED");
      assert.ok(r.criteria.every((c) => c.outcome === "INDETERMINATE" && c.reason === CODE[kind]), JSON.stringify(r.criteria));
      assert.ok(inspect(b).assertions.every((e) => e.supportState === "NOT_ESTABLISHED"), statesIn(inspect(b)));
    }
  });

  test("two readings of one reused source are two dangling references", () => {
    const b = clone(golden());
    b.observations = b.observations.map((o) => (o.id === "obs-price-b" ? { ...o, sourceId: "src-prov-a" } : o));
    b.sources.push({ id: "src-prov-a", kind: "USER_INPUT" });
    assert.deepEqual(trace(b, "a-price").issues, [{ code: "DANGLING_REFERENCE", id: "src-prov-a" }, { code: "DANGLING_REFERENCE", id: "src-prov-a" }]);
  });

  // check_invariants reads every record for what it presents, and that is a union: no first, last, smallest or largest record wins.
  // Each kind of finding appears twice, with the record that presents it on either side of the other in canonical order.
  for (const [label, kind, records, invariant, code] of [
    ["one record of a reused source presents transport as authority, and sorts first", "sources", [{ id: "src-x", kind: "PROVIDER_ENDPOINT", authorityId: "canonical-chain-state" }, { id: "src-x", kind: "USER_INPUT" }], "INV-13", "TRANSPORT_AS_AUTHORITY"],
    ["one record of a reused source presents transport as authority, and sorts last", "sources", [{ id: "src-x", kind: "USER_INPUT", authorityId: "aaa" }, { id: "src-x", kind: "PROVIDER_ENDPOINT", authorityId: "canonical-chain-state" }], "INV-13", "TRANSPORT_AS_AUTHORITY"],
    ["one record of a reused observation has an origin its source cannot give, and sorts last", "observations", [balanceObservation({ id: "obs-x", sourceId: "src-issuer" }), balanceObservation({ id: "obs-x" })], "INV-13", "ORIGIN_SOURCE_KIND_MISMATCH"],
    ["one record of a reused observation has an origin its source cannot give, and sorts first", "observations", [balanceObservation({ id: "obs-x", origin: "AUTHORITY_ATTESTED" }), balanceObservation({ id: "obs-x" })], "INV-13", "ORIGIN_SOURCE_KIND_MISMATCH"],
    ["one record of a reused observation reads a source that does not exist, and sorts last", "observations", [balanceObservation({ id: "obs-x", sourceId: "src-missing" }), balanceObservation({ id: "obs-x" })], "INV-00", "DANGLING_REFERENCE"],
    ["one record of a reused observation reads a source that does not exist, and sorts first", "observations", [balanceObservation({ id: "obs-x", sourceId: "a-missing" }), balanceObservation({ id: "obs-x" })], "INV-00", "DANGLING_REFERENCE"],
  ] as const) {
    test(`CONTROL: ${label}: check_invariants reports it, whichever record comes first`, () => {
      for (const ordered of [records, [...records].reverse()]) {
        const b = ordered.reduce((x: Bundle, r) => withRecord(x, kind, r, false), golden());
        assert.ok(hasViolation(invariants(b), invariant, code, null), JSON.stringify(invariants(b).violations));
      }
    });
  }

  test("CONTROL: a record of a reused source is reported only for what it presents: being reused adds nothing to the transport rule", () => {
    const record: Source = { id: "src-x", kind: "USER_INPUT", authorityId: "canonical-chain-state" };
    const b = withRecord(withRecord(golden(), "sources", record, false), "sources", record, false);
    assert.ok(!hasViolation(invariants(b), "INV-13", "TRANSPORT_AS_AUTHORITY", null), JSON.stringify(invariants(b).violations));
  });

  test("CONTROL: an id is unique within its kind: a reused id takes nothing from a record of another kind with that id", () => {
    // A reused source id, and an observation, cited by a claim, with that id.
    const sourceShared = clone(golden());
    sourceShared.sources.push({ id: "shared-id", kind: "USER_INPUT" }, { id: "shared-id", kind: "CHAIN_STATE" });
    addBalance(sourceShared, "1", { observationIds: ["shared-id"] }, { id: "shared-id" });
    assert.deepEqual(byId(inspect(sourceShared), "a-1").dependencies.observationIds, ["shared-id"]);
    assert.ok(!byId(inspect(sourceShared), "a-1").limitations.includes("DANGLING_REFERENCE"));
    assert.deepEqual(trace(sourceShared, "a-1").issues, []);

    // A reused observation id, and a source, read by a claim, with that id.
    const observationShared = clone(golden());
    observationShared.observations.push(balanceObservation({ id: "src-chain" }), balanceObservation({ id: "src-chain", payload: { balanceAtomic: "1", decimals: "6" } }));
    assert.equal(byId(inspect(observationShared), "a-balance").authority?.satisfied, true);
    assert.deepEqual(trace(observationShared, "a-balance").issues, []);

    // A reused derivation id, and an observation with that id.
    const derivationShared = clone(golden());
    const derivation = { id: "obs-balance", ...USD_RULE, inputAssertionIds: [], outputAssertionId: "a-nobody" };
    derivationShared.derivations.push(derivation, clone(derivation));
    assert.deepEqual(byId(inspect(derivationShared), "a-balance").dependencies.observationIds, ["obs-balance"]);

    // A reused assertion id, and a source and an observation with that id.
    for (const id of ["src-chain", "obs-balance"]) {
      const assertionShared = clone(golden());
      const record = balanceAssertion({ id, subject: balanceSubject({ holder: holderOf("e") }), value: null, observationIds: [] });
      assertionShared.assertions.push(record, clone(record));
      assert.equal(byId(inspect(assertionShared), "a-balance").authority?.satisfied, true, id);
      assert.deepEqual(trace(assertionShared, "a-balance").issues, [], id);
    }

    // A reused source id, and an assertion with that id.
    const assertionKept = clone(golden());
    assertionKept.sources.push({ id: "a-balance", kind: "USER_INPUT" }, { id: "a-balance", kind: "CHAIN_STATE" });
    assert.deepEqual(trace(assertionKept, "a-balance").issues, []);
  });
});

describe("what is not a reused id", () => {
  test("CONTROL: unique ids are unaffected", () => {
    assert.equal(readiness(golden()).classification, "CRITERIA_MET");
    assert.deepEqual(invariants(golden()).violations, []);
  });

  test("CONTROL: an id is unique within its kind: a source, an observation, an assertion and a derivation may share one", () => {
    const b = clone(golden());
    const subject = balanceSubject({ holder: `0x${"ca".repeat(20)}` });
    b.sources.push({ id: "shared-id", kind: "CHAIN_STATE", independenceGroup: "grp-shared" });
    b.observations.push(balanceObservation({ id: "shared-id", sourceId: "shared-id", subject }));
    b.assertions.push(balanceAssertion({ id: "shared-id", subject, observationIds: ["shared-id"] }));
    b.derivations.push({ id: "shared-id", ...USD_RULE, inputAssertionIds: [], outputAssertionId: "a-nobody" });
    assert.equal(byId(inspect(b), "shared-id").supportState, "ESTABLISHED");
    assert.equal(byId(inspect(b), "a-balance").supportState, "ESTABLISHED");
    assert.equal(readiness(b).classification, "CRITERIA_MET");
    assert.deepEqual(invariants(b).violations, []);
  });

  test("CONTROL: an id differing only in case is another id", () => {
    const b = clone(golden());
    b.sources.push({ id: "SRC-CHAIN", kind: "USER_INPUT" });
    b.observations.push(balanceObservation({ id: "OBS-BALANCE", payload: { balanceAtomic: "1", decimals: "6" } }));
    assert.equal(readiness(b).classification, "CRITERIA_MET");
    assert.deepEqual(invariants(b).violations, []);
  });

  test("CONTROL: many references to one record are not a reused id", () => {
    const b = clone(golden());
    b.sources.push({ id: "src-chain-2", kind: "CHAIN_STATE", independenceGroup: "grp-chain-2" });
    b.observations.push(balanceObservation({ id: "obs-second-reading" }));
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: ["obs-balance", "obs-balance", "obs-second-reading"] } : a));
    b.assertions.push(balanceAssertion({ id: "a-balance-copy" }));
    const i = inspect(b);
    assert.equal(byId(i, "a-balance").supportState, "ESTABLISHED");
    assert.equal(byId(i, "a-balance-copy").supportState, "ESTABLISHED");
    assert.equal(readiness(b).classification, "CRITERIA_MET");
    assert.ok(!invariants(b).violations.some((v) => v.code.startsWith("DUPLICATE_")));
  });

  test("CONTROL: two claims naming one derivation are not a reused id: it has one output", () => {
    const b = withUsdValue(golden());
    b.assertions.push({ ...clone(b.assertions.find((a) => a.id === "a-usd") as Assertion), id: "a-usd-other" });
    const i = inspect(b);
    assert.ok(byId(i, "a-usd-other").limitations.includes("DERIVATION_MISSING"));
    assert.equal(byId(i, "a-usd").supportState, "SUPPORTED");
    assert.ok(!invariants(b).violations.some((v) => v.code.startsWith("DUPLICATE_")));
  });

  test("CHARACTERIZATION: nothing resolves through a conflict id or a supersession id: records about different assertions all apply, whichever comes first", () => {
    const declared = clone(golden());
    declared.conflicts = [
      { id: "c-1", assertionIds: ["a-balance", "a-identity"], reason: "SUBJECT_DISAGREEMENT" },
      { id: "c-1", assertionIds: ["a-price", "a-identity"], reason: "VALUE_DISAGREEMENT" },
    ];
    const reversed = clone(declared);
    reversed.conflicts = [...(reversed.conflicts ?? [])].reverse();
    assert.deepEqual(byId(inspect(declared), "a-identity").conflictsWith, ["a-balance", "a-price"], "every record applies");
    assert.equal(byId(inspect(declared), "a-identity").supportState, "CONFLICTING", "the bundle is not refused: the declared conflict is what shows");
    assert.ok(!readiness(declared).criteria.some((c) => c.reason.startsWith("DUPLICATE_")), JSON.stringify(readiness(declared).criteria));
    assert.equal(answers(declared, "a-identity"), answers(reversed, "a-identity"));
    assert.ok(!invariants(declared).violations.some((v) => v.code.startsWith("DUPLICATE_")));

    const newer = withSecondBalance(golden(), balanceSubject({ blockNumber: "21000001", blockHash: `0x${"cd".repeat(32)}` }), "1400000");
    newer.assertions = newer.assertions.map((a) => (a.id === "a-balance-2" ? { ...a, assertedAt: EVALUATED_AT } : a));
    newer.assertions.push(identityAssertion({ id: "a-identity-2", assertedAt: EVALUATED_AT }));
    newer.supersessions = [
      { id: "s-1", supersededAssertionId: "a-balance", supersedingAssertionId: "a-balance-2", effectiveAt: EVALUATED_AT, reason: "NEWER_OBSERVATION" },
      { id: "s-1", supersededAssertionId: "a-identity", supersedingAssertionId: "a-identity-2", effectiveAt: EVALUATED_AT, reason: "CORRECTED" },
    ];
    const swapped = clone(newer);
    swapped.supersessions = [...(swapped.supersessions ?? [])].reverse();
    assert.equal(byId(inspect(newer), "a-balance").supportState, "SUPERSEDED");
    assert.equal(byId(inspect(newer), "a-identity").supportState, "SUPERSEDED");
    assert.equal(answers(newer, "a-balance"), answers(swapped, "a-balance"));
    assert.ok(!invariants(newer).violations.some((v) => v.code.startsWith("DUPLICATE_")));
  });
});

describe("the published contract states the rule", () => {
  const CODES = Object.values(CODE);

  test("walletwall://schemas/claims names every code", () => {
    const rules = (claimContracts({}) as { bundleRules: Record<string, string> }).bundleRules;
    for (const code of CODES) assert.ok(rules["recordIds"]?.includes(code), `${code} is not in bundleRules.recordIds: ${String(rules["recordIds"])}`);
    for (const said of [/names no record/, /whichever comes first/, /even when the records are identical/, /resolves to nothing/, /every assertion in the bundle is NOT_ESTABLISHED/, /readiness is NOT_ESTABLISHED/]) assert.match(rules["recordIds"] ?? "", said);
  });

  for (const file of ["EVIDENCE_PROFILE.md", "SUPPORT_STATES.md"]) {
    test(`spec/${file} says a reused source, observation or derivation id refuses the bundle`, () => {
      const text = readFileSync(new URL(`../../../../spec/${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");
      assert.match(text, /reused source, observation or derivation id/i);
    });
  }

  test("spec/EVIDENCE_PROFILE.md names every code", () => {
    const text = readFileSync(new URL("../../../../spec/EVIDENCE_PROFILE.md", import.meta.url), "utf8");
    for (const code of CODES) assert.ok(text.includes(code), code);
  });
});
