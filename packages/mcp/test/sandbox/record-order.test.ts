import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { claimContracts } from "../../src/claims.ts";
import { type Assertion, type Bundle, type LimitationCode } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { buildWallPrintSnapshot, externalAssessmentAdmissionFindings } from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { WALLPRINT_VERSIONS } from "../../src/wallprint/vocabulary.ts";
import { BLOCK_HASH, BLOCK_NUMBER, EVALUATED_AT, HOLDER, OBSERVED_AT, USDC, balanceAssertion, balanceObservation, clone, golden, identityAssertion, identityObservation, priceAssertion, priceObservation } from "../support/builders.ts";
import { loadCorpus } from "../support/runner.ts";

/**
 * No answer depends on the order of the records in a bundle. A dependency cycle used to be read from wherever evaluation happened
 * to enter it, so the first assertion listed decided what the others retained, and whether check_invariants passed. Supersessions
 * that overlap were read two ways at once: the first record for supersededBy, the last for a cycle, and record order for what
 * provenance walks. Every expectation is written by hand from the published contract (spec/EVIDENCE_PROFILE.md,
 * spec/SUPPORT_STATES.md), or relates two of the engine's own answers; no expected value is computed by the engine.
 */

interface Evaluated {
  assertionId: string;
  supportState: string;
  freshnessState: string;
  finalityState: string | null;
  authority: { satisfied: boolean } | null;
  limitations: string[];
  diagnostics: { limitation: string; mismatchedKeys: string[] }[];
  independentCorroboration: number | null;
  conflictsWith: string[];
  supersededBy: string | null;
  dependencies: { observationIds: string[]; assertionIds: string[] };
}
interface Inspected {
  bundleDigest: string;
  assertions: Evaluated[];
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
interface Traced {
  lineage: { id: string; kind: string; depth: number }[];
  issues: { code: string; id: string | null }[];
  prov: { wasRevisionOf: Record<string, { "prov:generatedEntity": string; "prov:usedEntity": string }> };
}
type Supersession = NonNullable<Bundle["supersessions"]>[number];

function tool<T>(name: string, args: unknown): T {
  const r = callTool(name, args);
  assert.ok(r.ok, `${name} accepted the input: ${JSON.stringify(r)}`);
  return r.result as T;
}
const inspect = (bundle: Bundle): Inspected => tool<Inspected>("inspect_evidence", { bundle, evaluatedAt: EVALUATED_AT });
const invariants = (bundle: Bundle): Checked => tool<Checked>("check_invariants", { bundle, evaluatedAt: EVALUATED_AT });
const trace = (bundle: Bundle, assertionId: string): Traced => tool<Traced>("trace_provenance", { bundle, assertionId });
const readiness = (bundle: Bundle, identityAssertionId: string, balanceAssertionId: string): unknown => tool("assess_vault_readiness", { bundle, evaluatedAt: EVALUATED_AT, identityAssertionId, balanceAssertionId });
const byId = (b: Bundle, id: string): Evaluated => {
  const e = inspect(b).assertions.find((a) => a.assertionId === id);
  assert.ok(e, `assertion ${id} is evaluated`);
  return e;
};
const violations = (b: Bundle): string[] => invariants(b).violations.map((v) => `${v.assertionId ?? "-"} ${v.invariant} ${v.code}`);
const listing = (b: Bundle): string => b.assertions.map((a) => a.id).join();

/** What a claim reads apart from its limitations and its lifecycle. */
const readingOf = (e: Evaluated): unknown => ({ supportState: e.supportState, freshnessState: e.freshnessState, finalityState: e.finalityState, satisfied: e.authority?.satisfied, corroboration: e.independentCorroboration });
/** A derived claim past every refusal, over an input with no basis. */
const OVER_NO_BASIS = (freshnessState: string, finalityState = "UNKNOWN_FINALITY"): unknown => ({ supportState: "NOT_ESTABLISHED", freshnessState, finalityState, satisfied: true, corroboration: null });
/** A derived claim stopped by a refusal of its own, as any derived claim is. */
const REFUSED = { supportState: "NOT_ESTABLISHED", freshnessState: "UNKNOWN_FRESHNESS", finalityState: "UNKNOWN_FINALITY", satisfied: false, corroboration: null };

const permutations = <T>(xs: readonly T[]): T[][] => (xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map((p) => [x, ...p])));
/** The bundle with its assertion records in every order. */
const everyAssertionOrder = (b: Bundle): Bundle[] => permutations(b.assertions).map((assertions) => ({ ...clone(b), assertions: clone(assertions) }));
/** The bundle with each assertion listed first, the rest as listed and reversed: enough to enter a cycle at each member, for bundles too large for every order. */
const eachListedFirst = (b: Bundle): Bundle[] =>
  b.assertions.flatMap((first) => {
    const rest = b.assertions.filter((a) => a !== first);
    return [[first, ...rest], [first, ...[...rest].reverse()]].map((assertions) => ({ ...clone(b), assertions: clone(assertions) }));
  });
/** The bundle with its supersession records in every order. */
const everySupersessionOrder = (b: Bundle): Bundle[] => permutations(b.supersessions ?? []).map((supersessions) => ({ ...clone(b), supersessions: clone(supersessions) }));

const balanceSubject = (over: Record<string, string> = {}): Record<string, string> => ({ chainId: "1", token: USDC, holder: HOLDER, blockNumber: BLOCK_NUMBER, blockHash: BLOCK_HASH, ...over });
const USD_VALUE = { usdScaled18: "1500150000000000000", rounding: "FLOOR_SCALED_18" };
const USD_RULE = { ruleId: "wwdr.usd-value", rulesVersion: "0.1.0-draft" } as const;
/** What a USD value over golden()'s balance and price retains from them, and says of itself. */
const USD_LIMITATIONS: LimitationCode[] = ["NO_AUTHORITATIVE_OBSERVATION", "PRICE_IS_PROVIDER_OBSERVATION", "REGISTRY_VERIFIED_POINT_IN_TIME", "TRANSPORT_FIDELITY_NOT_VERIFIED", "WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY"];
const ON_A_CYCLE: LimitationCode[] = ["DEPENDENCY_CYCLE", ...USD_LIMITATIONS];
/** ON_A_CYCLE and more, in the order the engine reports limitations, which is sorted. */
const onACycleAnd = (...more: LimitationCode[]): LimitationCode[] => [...ON_A_CYCLE, ...more].sort();

/** A USD value named id over these inputs, through a derivation of its own, declaring these limitations. */
function addUsd(b: Bundle, id: string, inputs: readonly string[], limitations: readonly LimitationCode[] = ON_A_CYCLE, over: Partial<Assertion> = {}): void {
  b.derivations.push({ id: `d-${id}`, ...USD_RULE, inputAssertionIds: [...inputs], outputAssertionId: id });
  b.assertions.push({ id, claimType: "TOKEN_USD_VALUE", origin: "WALLETWALL_DERIVED", temporality: "PINNED", subject: balanceSubject(), value: USD_VALUE, observationIds: [], derivationId: `d-${id}`, assertedAt: EVALUATED_AT, limitations: [...limitations], ...over });
}

/** Two USD values over each other, each with a complete set of inputs. */
function cycleOfTwo(limitations: readonly LimitationCode[] = ON_A_CYCLE, over: Partial<Assertion> = {}): Bundle {
  const b = golden();
  addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], limitations, over);
  addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], limitations, over);
  return b;
}

/** Three USD values in a ring, each with a complete set of inputs, the last with this extra input. */
function ringOfThree(extra: readonly string[] = [], limitations: readonly LimitationCode[] = ON_A_CYCLE, over: Partial<Assertion> = {}): Bundle {
  const b = golden();
  addUsd(b, "a-usd-1", ["a-balance", "a-price", "a-usd-2"], limitations, over);
  addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd-3"], limitations, over);
  addUsd(b, "a-usd-3", ["a-balance", "a-price", ...extra, "a-usd-1"], limitations, over);
  return b;
}

/**
 * Two USD values over each other, the second with no balance input, so it alone is MISSING_REQUIRED_DEPENDENCY. The first declares
 * that limitation and the second does not. The second depends on the first, which depends on the second, so each must retain it,
 * and the second does not declare it: INV-10.
 */
const MISSING_ONE_DECLARES = onACycleAnd("MISSING_REQUIRED_DEPENDENCY");
function cycleWithAMissingInput(first = "a-usd", second = "a-usd-2"): Bundle {
  const b = golden();
  addUsd(b, first, ["a-balance", "a-price", second], MISSING_ONE_DECLARES);
  addUsd(b, second, [first, "a-price"], ON_A_CYCLE);
  return b;
}

/** A second reading of golden()'s balance that is not finalized: same subject and value, so no conflict, and it reports NOT_FINALIZED. */
function withUnfinalizedBalance(b: Bundle): void {
  b.observations.push(balanceObservation({ id: "obs-balance-unfinal", finality: "UNFINALIZED" }));
  b.assertions.push(balanceAssertion({ id: "a-balance-unfinal", observationIds: ["obs-balance-unfinal"] }));
}

const withCurrentBalance = (b: Bundle): Bundle => ({ ...b, assertions: b.assertions.map((a) => (a.id === "a-balance" ? { ...a, temporality: "CURRENT" as const } : a)) });

/** A reading of golden()'s balance dated after the evaluation time: a-balance-future reports OBSERVATION_FROM_FUTURE. */
function withFutureBalance(b: Bundle): void {
  b.observations.push(balanceObservation({ id: "obs-balance-future", observedAt: "2031-01-01T00:00:00Z" }));
  b.assertions.push(balanceAssertion({ id: "a-balance-future", observationIds: ["obs-balance-future"] }));
}

/** A reading of golden()'s price too old for a CURRENT claim: a-price-old is stale for one. */
function withStalePrice(b: Bundle): void {
  b.observations.push({ ...(b.observations.find((o) => o.id === "obs-price-a") as Bundle["observations"][number]), id: "obs-price-old", observedAt: "2026-10-23T11:00:00Z" });
  b.assertions.push({ ...(b.assertions.find((a) => a.id === "a-price") as Assertion), id: "a-price-old", observationIds: ["obs-price-old"] });
}

describe("a dependency cycle is read the same from every side", () => {
  test("BUG: the order of the assertion records cannot flip check_invariants.pass", () => {
    const orders = everyAssertionOrder(cycleWithAMissingInput());
    assert.equal(orders.length, 120);
    for (const b of orders) {
      assert.equal(invariants(b).pass, false, listing(b));
      assert.deepEqual(violations(b), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(b));
    }
  });

  test("BUG: each assertion on a cycle retains what the others report, in every order", () => {
    for (const b of everyAssertionOrder(cycleWithAMissingInput())) {
      for (const id of ["a-usd", "a-usd-2"]) assert.deepEqual(byId(b, id).limitations, MISSING_ONE_DECLARES, `${id} in ${listing(b)}`);
    }
  });

  test("CONTROL: past its refusals an assertion on a cycle reads as any derived claim over a refused input, and is NOT_ESTABLISHED", () => {
    for (const b of everyAssertionOrder(cycleOfTwo())) {
      for (const id of ["a-usd", "a-usd-2"]) {
        const e = byId(b, id);
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("PINNED"), `${id} in ${listing(b)}`);
        assert.deepEqual(e.limitations, ON_A_CYCLE);
      }
    }
  });

  test("CONTROL: a refusal of its own stops an assertion on a cycle as it stops any derived claim, and only that one", () => {
    for (const b of everyAssertionOrder(cycleWithAMissingInput())) {
      assert.deepEqual(readingOf(byId(b, "a-usd")), OVER_NO_BASIS("PINNED"), listing(b));
      assert.deepEqual(readingOf(byId(b, "a-usd-2")), REFUSED, listing(b));
    }
  });

  test("CONTROL: an assertion on a cycle still names its own inputs, in the order its derivation lists them", () => {
    for (const b of everyAssertionOrder(cycleWithAMissingInput())) {
      assert.deepEqual(byId(b, "a-usd").dependencies, { observationIds: [], assertionIds: ["a-balance", "a-price", "a-usd-2"] });
      assert.deepEqual(byId(b, "a-usd-2").dependencies, { observationIds: [], assertionIds: ["a-usd", "a-price"] });
      assert.deepEqual(byId(b, "a-usd").diagnostics, []);
    }
  });

  test("BUG: the spelling of the ids cannot decide it either: a fix that enters a cycle at the smallest id only moves the choice", () => {
    for (const [first, second] of [["a-usd", "z-usd"], ["z-usd", "a-usd"]] as const) {
      for (const b of everyAssertionOrder(cycleWithAMissingInput(first, second))) {
        assert.deepEqual(violations(b), [`${second} INV-10 DEPENDENCY_LIMITATIONS_DROPPED`], `${first} before ${second}, in ${listing(b)}`);
        for (const id of [first, second]) assert.deepEqual(byId(b, id).limitations, MISSING_ONE_DECLARES);
      }
    }
  });

  test("CONTROL: a claim that is its own input is a cycle of one", () => {
    const b = golden();
    addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd"]);
    const e = byId(b, "a-usd");
    assert.deepEqual(readingOf(e), OVER_NO_BASIS("PINNED"));
    assert.deepEqual(e.limitations, ON_A_CYCLE);
    assert.deepEqual(e.dependencies.assertionIds, ["a-balance", "a-price", "a-usd"]);
    assert.equal(invariants(b).pass, true, "every limitation is declared");
  });

  test("BUG: a ring of three: what only one of them reads reaches all three, in every order, and only that one reads it", () => {
    const b = ringOfThree(["a-balance-unfinal"]);
    withUnfinalizedBalance(b);
    for (const ordered of eachListedFirst(b)) {
      for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("NOT_FINALIZED"), `${id} in ${listing(ordered)}`);
      assert.deepEqual(readingOf(byId(ordered, "a-usd-1")), OVER_NO_BASIS("PINNED"), listing(ordered));
      assert.deepEqual(readingOf(byId(ordered, "a-usd-2")), OVER_NO_BASIS("PINNED"), listing(ordered));
      // The least final of what it read itself: the balance that is not finalized, and the others on the cycle, whose finality is unknown.
      assert.deepEqual(readingOf(byId(ordered, "a-usd-3")), OVER_NO_BASIS("PINNED", "UNFINALIZED"), listing(ordered));
      assert.deepEqual(violations(ordered), ["a-usd-1 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd-3 INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(ordered));
    }
  });

  test("BUG: two separate cycles keep to themselves", () => {
    const b = golden();
    withUnfinalizedBalance(b);
    addUsd(b, "a-usd-1", ["a-balance", "a-price", "a-usd-2"]);
    addUsd(b, "a-usd-2", ["a-balance", "a-balance-unfinal", "a-price", "a-usd-1"]);
    addUsd(b, "b-usd-1", ["a-balance", "a-price", "b-usd-2"]);
    addUsd(b, "b-usd-2", ["a-balance", "a-price", "b-usd-1"]);
    for (const ordered of eachListedFirst(b)) {
      for (const id of ["a-usd-1", "a-usd-2"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("NOT_FINALIZED"), `${id} in ${listing(ordered)}`);
      for (const id of ["b-usd-1", "b-usd-2"]) assert.deepEqual(byId(ordered, id).limitations, ON_A_CYCLE, `${id} in ${listing(ordered)}`);
    }
  });

  test("BUG: a cycle that reads another is not on it: what the second reports reaches the first, and not the reverse", () => {
    const b = golden();
    withUnfinalizedBalance(b);
    addUsd(b, "a-1", ["a-balance", "a-price", "a-2"]);
    addUsd(b, "a-2", ["a-balance", "a-price", "a-1", "b-1"]);
    addUsd(b, "b-1", ["a-balance", "a-price", "b-2"]);
    addUsd(b, "b-2", ["a-balance", "a-balance-unfinal", "a-price", "b-1"]);
    b.derivations = b.derivations.map((d) => (d.id === "d-a-1" ? { ...d, rulesVersion: "9.9.9" } : d));
    for (const ordered of eachListedFirst(b)) {
      for (const id of ["a-1", "a-2"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("NOT_FINALIZED", "RULES_VERSION_MISMATCH"), `${id} in ${listing(ordered)}`);
      for (const id of ["b-1", "b-2"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("NOT_FINALIZED"), `${id} in ${listing(ordered)}`);
    }
  });

  describe("a claim over a cycle is not on it, and reads as any derived claim over those assertions as they read", () => {
    test("BUG: it retains the whole cycle's limitations", () => {
      const b = cycleWithAMissingInput();
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], MISSING_ONE_DECLARES);
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        // The weakest of FINALIZED (the balance) and UNKNOWN_FINALITY (the assertion on the cycle); the price has no finality.
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("PINNED"), listing(ordered));
        assert.deepEqual(e.limitations, MISSING_ONE_DECLARES, listing(ordered));
      }
    });

    test("BUG: it retains them through another claim that is not on the cycle", () => {
      const b = cycleWithAMissingInput();
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], MISSING_ONE_DECLARES);
      addUsd(b, "y-over", ["a-balance", "a-price", "x-over"], MISSING_ONE_DECLARES);
      for (const ordered of eachListedFirst(b)) {
        assert.deepEqual(byId(ordered, "y-over").limitations, MISSING_ONE_DECLARES, listing(ordered));
        assert.deepEqual(readingOf(byId(ordered, "y-over")), OVER_NO_BASIS("PINNED"), listing(ordered));
      }
    });

    test("CONTROL: a CURRENT claim over a CURRENT assertion on a cycle has unknown freshness and no support, with every other input fresh", () => {
      const b = withCurrentBalance(cycleOfTwo(ON_A_CYCLE, { temporality: "CURRENT" }));
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.deepEqual(e.limitations, ON_A_CYCLE, listing(ordered));
      }
    });

    test("CONTROL: a CURRENT claim over a PINNED assertion on a cycle reports the pinned dependency", () => {
      const b = withCurrentBalance(cycleOfTwo());
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.deepEqual(e.limitations, onACycleAnd("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM"), listing(ordered));
      }
    });

    test("BUG: its finality is the least final of what it reads, not of what the cycle retained", () => {
      const b = ringOfThree(["a-balance-unfinal"]);
      withUnfinalizedBalance(b);
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-1"], onACycleAnd("NOT_FINALIZED"));
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.equal(e.finalityState, "UNKNOWN_FINALITY", listing(ordered));
        assert.ok(e.limitations.includes("NOT_FINALIZED"), listing(ordered));
      }
    });

    test("CONTROL: over a superseded assertion on a cycle it counts the input as STALE, as any dependent of a superseded input does", () => {
      const b = cycleOfTwo();
      addUsd(b, "a-usd-new", ["a-balance", "a-price"], USD_LIMITATIONS, { assertedAt: "2026-10-23T12:00:31Z" });
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"], onACycleAnd("DEPENDENCY_SUPERSEDED", "SUPERSEDED"));
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-usd-2", supersedingAssertionId: "a-usd-new", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      for (const ordered of eachListedFirst(b)) assert.deepEqual(readingOf(byId(ordered, "x-over")), { supportState: "STALE", freshnessState: "PINNED", finalityState: "UNKNOWN_FINALITY", satisfied: true, corroboration: null }, listing(ordered));
    });

    test("CONTROL: a CURRENT claim over a superseded assertion on a cycle is stale in freshness too, and says so", () => {
      const b = cycleOfTwo(ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-new", ["a-balance", "a-price"], USD_LIMITATIONS, { assertedAt: "2026-10-23T12:00:31Z" });
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-usd-2", supersedingAssertionId: "a-usd-new", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), { supportState: "STALE", freshnessState: "STALE", finalityState: "UNKNOWN_FINALITY", satisfied: true, corroboration: null }, listing(ordered));
        for (const l of ["DEPENDENCY_SUPERSEDED", "STALE_EVIDENCE"]) assert.ok(e.limitations.includes(l), `${l} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: over a conflicting assertion on a cycle it is CONFLICTING: a conflict propagates to a dependent that is not on the cycle", () => {
      const b = cycleOfTwo();
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"], onACycleAnd("CONFLICT_DECLARED"));
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-2", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.equal(e.supportState, "CONFLICTING", listing(ordered));
        assert.deepEqual(e.conflictsWith, [], "the conflict is the input's");
      }
    });

    test("CONTROL: a CURRENT claim over a stale assertion on a cycle is stale, reading no stale input itself", () => {
      const b = golden();
      withStalePrice(b);
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance", "a-price-old", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("STALE"), listing(ordered));
        assert.ok(e.limitations.includes("STALE_EVIDENCE"), listing(ordered));
      }
    });

    test("BUG: a PINNED claim over an assertion on a cycle that the future reached has unknown freshness, reading no such input itself", () => {
      const b = golden();
      withFutureBalance(b);
      addUsd(b, "a-usd", ["a-balance-future", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"]);
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"]);
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.ok(e.limitations.includes("OBSERVATION_FROM_FUTURE"), listing(ordered));
      }
    });

    test("BUG: so it is over a stale assertion that retained the future: what decides is the limitation, not that assertion's own freshness", () => {
      const b = golden();
      withStalePrice(b);
      withFutureBalance(b);
      addUsd(b, "a-usd", ["a-balance", "a-price-old", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance-future", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"]);
      for (const ordered of eachListedFirst(b)) {
        assert.equal(byId(ordered, "a-usd").freshnessState, "STALE", listing(ordered));
        assert.equal(byId(ordered, "x-over").freshnessState, "UNKNOWN_FRESHNESS", listing(ordered));
      }
    });

    test("BUG: a CURRENT claim over a PINNED assertion on a cycle that the future reached reads it as unknown: no pinned dependency", () => {
      const b = golden();
      withFutureBalance(b);
      addUsd(b, "a-usd", ["a-balance-future", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"]);
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "x-over");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.ok(!e.limitations.includes("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM"), listing(ordered));
      }
    });
  });

  test("CONTROL: what a cycle reads is untouched by it", () => {
    for (const b of everyAssertionOrder(cycleOfTwo())) {
      const e = byId(b, "a-balance");
      assert.deepEqual(readingOf(e), { supportState: "ESTABLISHED", freshnessState: "PINNED", finalityState: "FINALIZED", satisfied: true, corroboration: 1 });
      assert.deepEqual(e.limitations, ["REGISTRY_VERIFIED_POINT_IN_TIME", "TRANSPORT_FIDELITY_NOT_VERIFIED"]);
      assert.equal(byId(b, "a-price").supportState, "SUPPORTED");
    }
  });

  test("BUG: a cycle across two claim types: readiness over a USD value over that readiness", () => {
    const b = golden();
    addUsd(b, "a-usd", ["a-balance", "a-price", "readiness-result"]);
    b.derivations.push({ id: "d-readiness", ruleId: "wwvr.vault-technical-readiness", rulesVersion: "0.1.0-draft", inputAssertionIds: ["a-identity", "a-balance", "a-usd"], outputAssertionId: "readiness-result" });
    b.assertions.push({ id: "readiness-result", claimType: "VAULT_TECHNICAL_READINESS", origin: "WALLETWALL_DERIVED", temporality: "PINNED", subject: balanceSubject(), value: { classification: "CRITERIA_MET" }, observationIds: [], derivationId: "d-readiness", assertedAt: EVALUATED_AT, limitations: ON_A_CYCLE });
    for (const ordered of eachListedFirst(b)) {
      for (const id of ["a-usd", "readiness-result"]) {
        assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("PINNED"), `${id} in ${listing(ordered)}`);
        assert.deepEqual(byId(ordered, id).limitations, ON_A_CYCLE, `${id} in ${listing(ordered)}`);
      }
      assert.deepEqual(violations(ordered), [], listing(ordered));
    }
  });

  test("CHARACTERIZATION: a cycle is a limitation, not a violation: with every limitation declared check_invariants passes, in every order", () => {
    for (const b of everyAssertionOrder(cycleOfTwo())) assert.deepEqual(violations(b), [], listing(b));
  });

  test("CONTROL: DEPENDENCY_CYCLE has to be declared, by what is on the cycle and by what is over it", () => {
    const b = cycleOfTwo(USD_LIMITATIONS);
    addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], USD_LIMITATIONS);
    for (const ordered of eachListedFirst(b)) assert.deepEqual(violations(ordered), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "x-over INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(ordered));
  });

  test("CONTROL: readiness over inputs the cycle only reads is unmoved by it", () => {
    for (const b of everyAssertionOrder(cycleOfTwo())) {
      const r = readiness(b, "a-identity", "a-balance") as { classification: string };
      assert.equal(r.classification, "CRITERIA_MET");
    }
  });

  test("BUG: a readiness call that names an assertion on a cycle reads the same in every order", () => {
    const answers = new Set(everyAssertionOrder(cycleWithAMissingInput()).map((b) => JSON.stringify(readiness(b, "a-usd", "a-usd"))));
    assert.equal(answers.size, 1);
  });

  test("BUG: beside a reused id too: the whole bundle is refused, and the cycle is still read the same in every order", () => {
    const b = cycleWithAMissingInput();
    b.sources.push({ id: "src-reused", kind: "USER_INPUT" }, { id: "src-reused", kind: "CHAIN_STATE" });
    for (const ordered of everyAssertionOrder(b)) {
      for (const id of ["a-usd", "a-usd-2"]) assert.deepEqual(byId(ordered, id).limitations, MISSING_ONE_DECLARES, `${id} in ${listing(ordered)}`);
      assert.deepEqual(readingOf(byId(ordered, "a-usd")), OVER_NO_BASIS("PINNED"));
      assert.deepEqual(readingOf(byId(ordered, "a-usd-2")), REFUSED);
      assert.deepEqual(violations(ordered), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "- INV-00 DUPLICATE_SOURCE_ID"]);
    }
  });

  test("CONTROL: a tampered value on a cycle still fails recomputation, and a declared finality still exceeds what is computed", () => {
    const b = cycleOfTwo();
    // Both values alike, or the two would also disagree with each other: CONFLICT_DETECTED.
    b.assertions = b.assertions.map((a) => (a.id.startsWith("a-usd") ? { ...a, value: { ...USD_VALUE, usdScaled18: "1" }, ...(a.id === "a-usd-2" ? { declared: { finalityState: "FINALIZED" as const } } : {}) } : a));
    for (const ordered of everyAssertionOrder(b)) {
      assert.deepEqual(violations(ordered), ["a-usd-2 INV-00 DECLARED_FINALITY_EXCEEDS_COMPUTED", "a-usd-2 INV-00 RECOMPUTATION_MISMATCH", "a-usd INV-00 RECOMPUTATION_MISMATCH"], listing(ordered));
    }
  });

  test("CONTROL: a dense graph at the schema's limits finishes, with every claim on one cycle", () => {
    const b = golden();
    const ids = Array.from({ length: 64 }, (_, i) => `g-${String(i).padStart(2, "0")}`);
    ids.forEach((id, i) => addUsd(b, id, ["a-balance", "a-price", ...Array.from({ length: 30 }, (_, k) => ids[(i + k + 1) % ids.length] as string)]));
    const evaluated = inspect(b).assertions.filter((e) => e.assertionId.startsWith("g-"));
    assert.equal(evaluated.length, 64);
    for (const e of evaluated) assert.deepEqual(e.limitations, ON_A_CYCLE);
    assert.equal(invariants(b).pass, true);
  });

  describe("a refusal that comes first stays, and is retained around the cycle", () => {
    test("BUG: a dangling input: one claim reports it and fails, and the other retains it", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd", "a-ghost"]);
      for (const ordered of everyAssertionOrder(b)) {
        for (const id of ["a-usd", "a-usd-2"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("DANGLING_REFERENCE", "NO_SOURCE"), `${id} in ${listing(ordered)}`);
        assert.deepEqual(readingOf(byId(ordered, "a-usd-2")), REFUSED);
        assert.ok(violations(ordered).includes("a-usd-2 INV-00 DANGLING_REFERENCE"));
        assert.ok(!violations(ordered).includes("a-usd INV-00 DANGLING_REFERENCE"), "only the claim that names the ghost dangles");
      }
    });

    test("BUG: an invalid subject and the mismatch it causes: each claim keeps its own diagnostics and violation, and retains the other's limitation", () => {
      const b = cycleOfTwo();
      const { holder: _holder, ...noHolder } = balanceSubject();
      b.assertions = b.assertions.map((a) => (a.id === "a-usd-2" ? { ...a, subject: noHolder } : a));
      for (const ordered of everyAssertionOrder(b)) {
        const invalid = byId(ordered, "a-usd-2");
        const mismatched = byId(ordered, "a-usd");
        for (const e of [invalid, mismatched]) {
          assert.deepEqual(e.limitations, onACycleAnd("INVALID_SUBJECT", "SUBJECT_MISMATCH"), `${e.assertionId} in ${listing(ordered)}`);
          assert.deepEqual(readingOf(e), REFUSED);
        }
        assert.deepEqual(invalid.diagnostics.map((d) => d.limitation), ["INVALID_SUBJECT"]);
        assert.deepEqual(mismatched.diagnostics.map((d) => [d.limitation, d.mismatchedKeys]), [["SUBJECT_MISMATCH", ["holder"]]]);
        assert.ok(violations(ordered).includes("a-usd-2 INV-00 INVALID_SUBJECT"));
        assert.ok(violations(ordered).includes("a-usd INV-00 SUBJECT_MISMATCH"));
        assert.ok(!violations(ordered).includes("a-usd-2 INV-00 SUBJECT_MISMATCH"), "the invalid subject is what stops that claim");
      }
    });

    test("BUG: an unknown rule version on one claim reaches the others around a ring, past the claim that reads it", () => {
      const b = ringOfThree();
      b.derivations = b.derivations.map((d) => (d.id === "d-a-usd-3" ? { ...d, rulesVersion: "9.9.9" } : d));
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) {
          assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("RULES_VERSION_MISMATCH"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("PINNED"), `${id} in ${listing(ordered)}`);
        }
      }
    });

    test("BUG: an unknown rule on one claim reaches the others around a ring, past the claim that reads it", () => {
      const b = ringOfThree();
      b.derivations = b.derivations.map((d) => (d.id === "d-a-usd-3" ? { ...d, ruleId: "rule.other" } : d));
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("RULES_UNKNOWN"), `${id} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: an input with only NO_RESULT does not lift an assertion on a cycle to UNKNOWN", () => {
      const b = cycleOfTwo();
      b.observations = b.observations.map((o) => (o.id === "obs-balance" ? { ...o, result: "NO_RESULT" as const, payload: {} } : o));
      for (const ordered of everyAssertionOrder(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("PINNED"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, ["DEPENDENCY_CYCLE", "NO_AUTHORITATIVE_OBSERVATION", "NO_RESULT", "PRICE_IS_PROVIDER_OBSERVATION", "REGISTRY_VERIFIED_POINT_IN_TIME", "TRANSPORT_FIDELITY_NOT_VERIFIED", "WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY"]);
        }
      }
    });
  });

  describe("lifecycle still overrides the state, and the others are NOT_ESTABLISHED", () => {
    /** One of the assertions on this world's cycle, and a USD value that replaces it. */
    function superseding(b: Bundle, id: string): Bundle {
      addUsd(b, "a-usd-new", ["a-balance", "a-price"], USD_LIMITATIONS, { assertedAt: "2026-10-23T12:00:31Z" });
      b.supersessions = [{ id: "s-1", supersededAssertionId: id, supersedingAssertionId: "a-usd-new", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      return b;
    }

    test("BUG: a superseded claim on a cycle is SUPERSEDED, and the claim over it stays NOT_ESTABLISHED and is not lifted to STALE", () => {
      for (const b of eachListedFirst(superseding(cycleOfTwo(), "a-usd-2"))) {
        const replaced = byId(b, "a-usd-2");
        const other = byId(b, "a-usd");
        assert.equal(replaced.supportState, "SUPERSEDED", listing(b));
        assert.equal(replaced.supersededBy, "a-usd-new", listing(b));
        assert.deepEqual(readingOf(other), OVER_NO_BASIS("PINNED"), listing(b));
        assert.equal(other.supersededBy, null, listing(b));
        for (const e of [replaced, other]) assert.deepEqual(e.limitations, onACycleAnd("DEPENDENCY_SUPERSEDED", "SUPERSEDED"), `${e.assertionId} in ${listing(b)}`);
      }
    });

    test("BUG: a supersession on one claim reaches the others around a ring, past the claim that reads it", () => {
      for (const b of eachListedFirst(superseding(ringOfThree(), "a-usd-3"))) {
        for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) assert.deepEqual(byId(b, id).limitations, onACycleAnd("DEPENDENCY_SUPERSEDED", "SUPERSEDED"), `${id} in ${listing(b)}`);
        for (const id of ["a-usd-1", "a-usd-2"]) assert.deepEqual(readingOf(byId(b, id)), OVER_NO_BASIS("PINNED"), `${id} in ${listing(b)}`);
        assert.equal(byId(b, "a-usd-3").supportState, "SUPERSEDED", listing(b));
      }
    });

    test("BUG: a conflicting claim on a cycle is CONFLICTING, and the claim over it stays NOT_ESTABLISHED and names no conflict of its own", () => {
      const b = cycleOfTwo();
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-2", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of everyAssertionOrder(b)) {
        const conflicting = byId(ordered, "a-usd-2");
        const other = byId(ordered, "a-usd");
        assert.equal(conflicting.supportState, "CONFLICTING", listing(ordered));
        assert.deepEqual(conflicting.conflictsWith, ["a-identity"], listing(ordered));
        assert.deepEqual(readingOf(other), OVER_NO_BASIS("PINNED"), listing(ordered));
        assert.deepEqual(other.conflictsWith, [], listing(ordered));
        for (const e of [conflicting, other]) assert.deepEqual(e.limitations, onACycleAnd("CONFLICT_DECLARED"), `${e.assertionId} in ${listing(ordered)}`);
      }
    });

    test("BUG: a conflict on one claim reaches the others around a ring, past the claim that reads it", () => {
      const b = ringOfThree();
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-3", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("CONFLICT_DECLARED"), `${id} in ${listing(ordered)}`);
        for (const id of ["a-usd-1", "a-usd-2"]) assert.equal(byId(ordered, id).supportState, "NOT_ESTABLISHED", `${id} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: superseded and conflicting at once, a claim on a cycle is SUPERSEDED, as any claim is", () => {
      const b = superseding(cycleOfTwo(), "a-usd-2");
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-2", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "a-usd-2");
        assert.equal(e.supportState, "SUPERSEDED", listing(ordered));
        assert.deepEqual(e.conflictsWith, ["a-identity"], listing(ordered));
      }
    });

    test("CONTROL: a claim on a cycle superseded by an id that resolves to nothing is SUPERSEDED, as any claim is", () => {
      const b = cycleOfTwo();
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-usd-2", supersedingAssertionId: "z-nothing", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      for (const ordered of everyAssertionOrder(b)) {
        assert.equal(byId(ordered, "a-usd-2").supportState, "SUPERSEDED", listing(ordered));
        assert.equal(byId(ordered, "a-usd-2").supersededBy, "z-nothing", listing(ordered));
        assert.ok(violations(ordered).includes("a-usd-2 INV-12 SUPERSESSION_REFERENCE_INVALID"), listing(ordered));
      }
    });

    test("CONTROL: lifecycle limitations have to be declared around a cycle like any other", () => {
      for (const b of eachListedFirst(superseding(cycleOfTwo(), "a-usd-2"))) assert.deepEqual(violations(b), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(b));
    });

    test("BUG: a state declared above NOT_ESTABLISHED on a cycle is an INV-07 in every order, whatever the lifecycle lifted before", () => {
      const b = superseding(cycleOfTwo(), "a-usd-2");
      b.assertions = b.assertions.map((a) => (a.id === "a-usd" ? { ...a, declared: { supportState: "STALE" } } : a));
      for (const ordered of eachListedFirst(b)) assert.ok(violations(ordered).includes("a-usd INV-07 PROCESSING_INCREASES_AUTHORITY"), listing(ordered));
    });

    test("BUG: a claim over the other assertion on the cycle is NOT_ESTABLISHED", () => {
      const b = superseding(cycleOfTwo(), "a-usd-2");
      addUsd(b, "x-over", ["a-balance", "a-price", "a-usd"], onACycleAnd("DEPENDENCY_SUPERSEDED", "SUPERSEDED"));
      for (const ordered of eachListedFirst(b)) assert.deepEqual(readingOf(byId(ordered, "x-over")), OVER_NO_BASIS("PINNED"), listing(ordered));
    });
  });

  describe("an assertion on a cycle reads the others on it with unknown freshness, unless they are PINNED", () => {
    test("BUG: a reading from the future that one claim reads reaches the other, and neither reports PINNED", () => {
      const b = golden();
      b.observations.push(balanceObservation({ id: "obs-balance-future", observedAt: "2031-01-01T00:00:00Z" }));
      b.assertions.push(balanceAssertion({ id: "a-balance-future", observationIds: ["obs-balance-future"] }));
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-balance-future", "a-price", "a-usd"]);
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("OBSERVATION_FROM_FUTURE"), `${id} in ${listing(ordered)}`);
        }
      }
    });

    test("BUG: a CURRENT claim on a cycle over a PINNED one reports the pinned dependency, whichever is entered first, and the other retains it", () => {
      const b = withCurrentBalance(golden());
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"]);
      for (const ordered of everyAssertionOrder(b)) {
        assert.deepEqual(readingOf(byId(ordered, "a-usd")), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.deepEqual(readingOf(byId(ordered, "a-usd-2")), OVER_NO_BASIS("PINNED"), listing(ordered));
        for (const id of ["a-usd", "a-usd-2"]) assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM"), `${id} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: a CURRENT claim on a cycle over a CURRENT one has unknown freshness, and no pinned dependency", () => {
      const b = withCurrentBalance(cycleOfTwo(ON_A_CYCLE, { temporality: "CURRENT" }));
      for (const ordered of everyAssertionOrder(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, ON_A_CYCLE, `${id} in ${listing(ordered)}`);
        }
      }
    });

    test("CONTROL: a CURRENT claim on a cycle over a stale input is STALE in freshness and retains STALE_EVIDENCE, and stays NOT_ESTABLISHED", () => {
      const b = golden();
      b.observations = b.observations.map((o) => (o.id.startsWith("obs-price") ? { ...o, observedAt: "2026-10-23T11:00:00Z" } : o));
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of everyAssertionOrder(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("STALE"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("STALE_EVIDENCE"));
        }
      }
    });

    test("BUG: a stale input one CURRENT claim reads is retained by the other, whose own freshness stays unknown", () => {
      const b = golden();
      b.observations.push({ ...b.observations.find((o) => o.id === "obs-price-a") as Bundle["observations"][number], id: "obs-price-old", observedAt: "2026-10-23T11:00:00Z" });
      b.assertions.push({ ...b.assertions.find((a) => a.id === "a-price") as Assertion, id: "a-price-old", observationIds: ["obs-price-old"] });
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance", "a-price-old", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        assert.deepEqual(readingOf(byId(ordered, "a-usd")), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), listing(ordered));
        assert.deepEqual(readingOf(byId(ordered, "a-usd-2")), OVER_NO_BASIS("STALE"), listing(ordered));
        for (const id of ["a-usd", "a-usd-2"]) assert.ok(byId(ordered, id).limitations.includes("STALE_EVIDENCE"), `${id} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: a CURRENT claim on a cycle over a superseded input is stale, reports it, and has to have it declared", () => {
      const b = balances("a-balance-2");
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      b.supersessions = [supersession("s-1", "a-balance", "a-balance-2")];
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("STALE"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, onACycleAnd("DEPENDENCY_SUPERSEDED", "STALE_EVIDENCE", "SUPERSEDED"), `${id} in ${listing(ordered)}`);
        }
        assert.deepEqual(violations(ordered), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(ordered));
      }
    });

    test("BUG: a CURRENT claim on a cycle over a superseded assertion on that cycle is stale, and says so, and stays NOT_ESTABLISHED", () => {
      const b = cycleOfTwo(ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-new", ["a-balance", "a-price"], USD_LIMITATIONS, { assertedAt: "2026-10-23T12:00:31Z" });
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-usd-2", supersedingAssertionId: "a-usd-new", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      for (const ordered of eachListedFirst(b)) {
        const e = byId(ordered, "a-usd");
        assert.deepEqual(readingOf(e), OVER_NO_BASIS("STALE"), listing(ordered));
        for (const l of ["DEPENDENCY_SUPERSEDED", "STALE_EVIDENCE"]) assert.ok(e.limitations.includes(l), `${l} in ${listing(ordered)}`);
      }
    });

    test("BUG: a CURRENT claim on a cycle stays STALE over a stale input, and retains a reading from the future: the future decides only a PINNED one", () => {
      const b = golden();
      withStalePrice(b);
      withFutureBalance(b);
      addUsd(b, "a-usd", ["a-balance", "a-price-old", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-balance-future", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        assert.equal(byId(ordered, "a-usd").freshnessState, "STALE", listing(ordered));
        assert.ok(byId(ordered, "a-usd").limitations.includes("OBSERVATION_FROM_FUTURE"), listing(ordered));
      }
    });

    test("BUG: a PINNED claim on a cycle stays PINNED, and retains a stale input another reads: recency is not required of it", () => {
      const b = golden();
      withStalePrice(b);
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-price-old", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of eachListedFirst(b)) {
        assert.deepEqual(readingOf(byId(ordered, "a-usd")), OVER_NO_BASIS("PINNED"), listing(ordered));
        assert.ok(byId(ordered, "a-usd").limitations.includes("STALE_EVIDENCE"), listing(ordered));
      }
    });

    test("BUG: a PINNED assertion in conflict is still read as PINNED by a CURRENT one on its cycle: what it is about comes from its record", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"]);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of everyAssertionOrder(b)) {
        const e = byId(ordered, "a-usd-2");
        assert.equal(e.freshnessState, "UNKNOWN_FRESHNESS", listing(ordered));
        assert.ok(e.limitations.includes("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM"), listing(ordered));
      }
    });

    test("BUG: a PINNED assertion refused on its own is read as PINNED too, so what passed in every old listing can now fail: the stricter way", () => {
      const b = withCurrentBalance(golden());
      // a-usd-2 has no balance input: refused for it, it has no freshness of its own, and its record still says what it is about.
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], MISSING_ONE_DECLARES, { temporality: "CURRENT" });
      addUsd(b, "a-usd-2", ["a-price", "a-usd"], MISSING_ONE_DECLARES);
      for (const ordered of everyAssertionOrder(b)) {
        assert.ok(byId(ordered, "a-usd").limitations.includes("PINNED_DEPENDENCY_FOR_CURRENT_CLAIM"), listing(ordered));
        assert.deepEqual(violations(ordered), ["a-usd-2 INV-10 DEPENDENCY_LIMITATIONS_DROPPED", "a-usd INV-10 DEPENDENCY_LIMITATIONS_DROPPED"], listing(ordered));
      }
    });

    test("CONTROL: a CURRENT claim on a cycle over a CURRENT one and a PINNED balance has no pinned dependency: unknown comes first, as for any derived claim", () => {
      for (const ordered of everyAssertionOrder(cycleOfTwo(ON_A_CYCLE, { temporality: "CURRENT" }))) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), OVER_NO_BASIS("UNKNOWN_FRESHNESS"), `${id} in ${listing(ordered)}`);
          assert.deepEqual(byId(ordered, id).limitations, ON_A_CYCLE, `${id} in ${listing(ordered)}`);
        }
      }
    });
  });

  describe("what check_invariants says of a claim on a cycle is what it says of any claim that reads the same", () => {
    test("CONTROL: a stale claim on a cycle declared SUPPORTED and CURRENT is INV-02 both ways", () => {
      const b = golden();
      withStalePrice(b);
      addUsd(b, "a-usd", ["a-balance", "a-price-old", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT", declared: { supportState: "SUPPORTED", freshnessState: "CURRENT" } });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of everyAssertionOrder(b).slice(0, 12)) {
        for (const v of ["a-usd INV-02 STALE_SATISFIES_CURRENT", "a-usd INV-02 STALE_DECLARED_CURRENT", "a-usd INV-07 PROCESSING_INCREASES_AUTHORITY"]) assert.ok(violations(ordered).includes(v), `${v} in ${listing(ordered)}`);
      }
    });

    test("CONTROL: a conflicting claim on a cycle declared ESTABLISHED is INV-03", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], onACycleAnd("CONFLICT_DECLARED"), { declared: { supportState: "ESTABLISHED" } });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], onACycleAnd("CONFLICT_DECLARED"));
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of everyAssertionOrder(b)) assert.deepEqual(violations(ordered), ["a-usd INV-03 CONFLICT_SATISFIES_ESTABLISHED", "a-usd INV-07 PROCESSING_INCREASES_AUTHORITY"], listing(ordered));
    });

    test("BUG: a claim on a cycle declared ESTABLISHED over a conflicting one is INV-07, not INV-03: it is NOT_ESTABLISHED, not conflicting itself", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], onACycleAnd("CONFLICT_DECLARED"), { declared: { supportState: "ESTABLISHED" } });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], onACycleAnd("CONFLICT_DECLARED"));
      b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-2", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
      for (const ordered of everyAssertionOrder(b)) assert.deepEqual(violations(ordered), ["a-usd INV-07 PROCESSING_INCREASES_AUTHORITY"], listing(ordered));
    });

    test("CONTROL: a claim on a cycle declared CURRENT whose freshness is unknown exceeds what is computed", () => {
      const b = withCurrentBalance(golden());
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], ON_A_CYCLE, { temporality: "CURRENT", declared: { freshnessState: "CURRENT" } });
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], ON_A_CYCLE, { temporality: "CURRENT" });
      for (const ordered of everyAssertionOrder(b)) assert.deepEqual(violations(ordered), ["a-usd INV-00 DECLARED_FRESHNESS_EXCEEDS_COMPUTED"], listing(ordered));
    });

    test("CONTROL: USD values on a cycle with no price input are INV-11, each refused for it", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-usd-2"], onACycleAnd("MISSING_REQUIRED_DEPENDENCY"));
      addUsd(b, "a-usd-2", ["a-balance", "a-usd"], onACycleAnd("MISSING_REQUIRED_DEPENDENCY"));
      for (const ordered of everyAssertionOrder(b)) {
        for (const id of ["a-usd", "a-usd-2"]) {
          assert.deepEqual(readingOf(byId(ordered, id)), REFUSED, `${id} in ${listing(ordered)}`);
          assert.ok(violations(ordered).includes(`${id} INV-11 USD_VALUE_WITHOUT_PRICE_EVIDENCE`), `${id} in ${listing(ordered)}`);
        }
      }
    });
  });

  describe("what is not a cycle stays as it was", () => {
    test("CONTROL: a derivation that does not name the claim as its output is not followed, so nothing loops through it", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], USD_LIMITATIONS);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], USD_LIMITATIONS);
      b.derivations = b.derivations.map((d) => (d.id === "d-a-usd" ? { ...d, outputAssertionId: "someone-else" } : d));
      for (const ordered of everyAssertionOrder(b)) {
        const missing = byId(ordered, "a-usd");
        assert.deepEqual(missing.limitations, ["DERIVATION_MISSING"]);
        assert.deepEqual(missing.dependencies.assertionIds, []);
        const over = byId(ordered, "a-usd-2");
        assert.ok(over.limitations.includes("DERIVATION_MISSING"));
        assert.ok(!over.limitations.includes("DEPENDENCY_CYCLE"), "no cycle");
        assert.deepEqual(readingOf(over), OVER_NO_BASIS("PINNED"));
      }
    });

    test("CONTROL: a claim type that may not be derived has no inputs, so nothing loops through it", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price"], USD_LIMITATIONS);
      b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, derivationId: "d-balance" } : a));
      b.derivations.push({ id: "d-balance", ...USD_RULE, inputAssertionIds: ["a-usd"], outputAssertionId: "a-balance" });
      for (const ordered of everyAssertionOrder(b)) {
        assert.deepEqual(byId(ordered, "a-balance").limitations, ["DERIVATION_NOT_PERMITTED"]);
        const over = byId(ordered, "a-usd");
        assert.ok(!over.limitations.includes("DEPENDENCY_CYCLE"), "no cycle");
        assert.deepEqual(readingOf(over), OVER_NO_BASIS("PINNED"));
      }
    });

    test("CONTROL: a reference to nothing is dangling, and nothing loops through it", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-ghost"], USD_LIMITATIONS);
      const e = byId(b, "a-usd");
      assert.ok(e.limitations.includes("DANGLING_REFERENCE"));
      assert.ok(!e.limitations.includes("DEPENDENCY_CYCLE"));
    });

    test("CONTROL: a reused assertion id resolves to nothing, so nothing loops through it, even with a record that would close the loop", () => {
      // A ring of three: a-usd-1 reads a-usd-2, which reads the reused a-usd-3, whose record would read a-usd-1.
      const b = ringOfThree([], USD_LIMITATIONS);
      b.assertions.push(clone(b.assertions.find((a) => a.id === "a-usd-3") as Assertion));
      const dangling = byId(b, "a-usd-2");
      assert.ok(dangling.limitations.includes("DANGLING_REFERENCE"), JSON.stringify(dangling.limitations));
      const over = byId(b, "a-usd-1");
      assert.ok(over.limitations.includes("DANGLING_REFERENCE"), "retained from the input");
      assert.ok(!over.limitations.includes("DEPENDENCY_CYCLE"), JSON.stringify(over.limitations));
    });

    test("CONTROL: a reused derivation id resolves to nothing, so nothing loops through it, even with a record that would close the loop", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price", "a-usd-2"], USD_LIMITATIONS);
      addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd"], USD_LIMITATIONS);
      b.derivations.push(clone(b.derivations.find((d) => d.id === "d-a-usd-2") as Bundle["derivations"][number]));
      const missing = byId(b, "a-usd-2");
      assert.ok(missing.limitations.includes("DERIVATION_MISSING"), JSON.stringify(missing.limitations));
      assert.ok(!byId(b, "a-usd").limitations.includes("DEPENDENCY_CYCLE"));
    });

    test("CONTROL: two claims over one input, and a third over both, is no cycle: an input reached twice is not a loop", () => {
      const b = golden();
      addUsd(b, "a-usd-1", ["a-balance", "a-price"], USD_LIMITATIONS);
      addUsd(b, "a-usd-2", ["a-balance", "a-price"], USD_LIMITATIONS);
      addUsd(b, "a-usd-3", ["a-balance", "a-price", "a-usd-1", "a-usd-2"], USD_LIMITATIONS);
      for (const ordered of eachListedFirst(b)) {
        for (const id of ["a-usd-1", "a-usd-2", "a-usd-3"]) {
          const e = byId(ordered, id);
          assert.deepEqual(readingOf(e), { supportState: "SUPPORTED", freshnessState: "PINNED", finalityState: "FINALIZED", satisfied: true, corroboration: null });
          assert.deepEqual(e.limitations, USD_LIMITATIONS);
        }
      }
    });
  });

  test("CONTROL: trace_provenance reports the cycle it walks, in every order of the assertions", () => {
    const answers = new Set(everyAssertionOrder(cycleOfTwo()).map((b) => JSON.stringify(trace(b, "a-usd"))));
    assert.equal(answers.size, 1);
    assert.deepEqual(trace(cycleOfTwo(), "a-usd").issues, [{ code: "DEPENDENCY_CYCLE", id: "a-usd" }]);
  });
});

/** golden() and more balances of the same holder and token at later blocks, each from its own reading, each asserted after a-balance. */
function balances(...ids: readonly string[]): Bundle {
  const b = golden();
  ids.forEach((id, i) => {
    const subject = balanceSubject({ blockNumber: String(21000001 + i), blockHash: `0x${"cd".repeat(31)}${String(10 + i)}` });
    b.observations.push(balanceObservation({ id: `obs-${id}`, subject }));
    b.assertions.push(balanceAssertion({ id, subject, observationIds: [`obs-${id}`], assertedAt: EVALUATED_AT }));
  });
  return b;
}
function supersession(id: string, from: string, to: string, effectiveAt: string = EVALUATED_AT): Supersession {
  return { id, supersededAssertionId: from, supersedingAssertionId: to, effectiveAt, reason: "NEWER_OBSERVATION" };
}
const supersede = (b: Bundle, ...pairs: readonly (readonly [string, string])[]): Bundle => ({ ...clone(b), supersessions: pairs.map(([from, to], i) => supersession(`s-${String(i + 1)}`, from, to)) });
const cyclesIn = (b: Bundle): (string | null)[] => invariants(b).violations.filter((v) => v.code === "SUPERSESSION_CYCLE").map((v) => v.assertionId);
const supersessionIds = (b: Bundle): string => (b.supersessions ?? []).map((s) => s.id).join();

/**
 * golden() and the rest of a world in which one assertion can be superseded. a-rival is a rival of a-balance: the same claim identity,
 * block and temporality, read separately, with another value, so the two are ESTABLISHED alone and CONFLICTING together. a-newer is a later
 * balance of the same holder and token, asserted later, which retires either of them as a supersession should. a-older is the same,
 * asserted earlier, so naming it as the superseding assertion is not forward in time.
 */
function rivals(): Bundle {
  const b = balances("a-newer");
  b.observations.push(balanceObservation({ id: "obs-rival", payload: { balanceAtomic: "1400000", decimals: "6" } }));
  b.assertions.push(balanceAssertion({ id: "a-rival", observationIds: ["obs-rival"], value: { balanceAtomic: "1400000", decimals: "6" } }));
  const earlier = balanceSubject({ blockNumber: "20999999", blockHash: `0x${"ef".repeat(32)}` });
  b.observations.push(balanceObservation({ id: "obs-older", subject: earlier }));
  b.assertions.push(balanceAssertion({ id: "a-older", subject: earlier, observationIds: ["obs-older"], assertedAt: "2026-10-23T11:59:00Z" }));
  // A later balance of another holder: later in time, but not the same claim, so naming it has one fault and no other.
  const elsewhere = balanceSubject({ holder: `0x${"99".repeat(20)}` });
  b.observations.push(balanceObservation({ id: "obs-other", subject: elsewhere }));
  b.assertions.push(balanceAssertion({ id: "a-other", subject: elsewhere, observationIds: ["obs-other"], assertedAt: EVALUATED_AT }));
  return b;
}

describe("a supersession that cannot be valid takes nothing out of conflict detection", () => {
  /**
   * The records check_invariants reports as invalid, each about `victim`, which disagrees with `survivor`. Each still reads SUPERSEDED, as
   * CNF-006 says of one that is not later, and each takes the assertion out of nothing: it stays among those compared, so the
   * conflict it was meant to remove stays. `faults` are the violations check_invariants reports against the victim, which it always has.
   */
  const faulty = (victim: string, survivor: string): readonly { label: string; to: string; faults: readonly string[] }[] => [
    { label: "names nothing", to: "a-ghost", faults: ["SUPERSESSION_REFERENCE_INVALID"] },
    { label: "names its own assertion", to: victim, faults: ["SUPERSESSION_CYCLE", "SUPERSESSION_REFERENCE_INVALID"] },
    { label: "names an assertion of another claim", to: "a-identity", faults: ["SUPERSESSION_CLAIM_IDENTITY_MISMATCH", "SUPERSESSION_NOT_FORWARD_IN_TIME"] },
    { label: "names a later assertion of another holder", to: "a-other", faults: ["SUPERSESSION_CLAIM_IDENTITY_MISMATCH"] },
    { label: "names an assertion that is not later", to: survivor, faults: ["SUPERSESSION_NOT_FORWARD_IN_TIME"] },
    { label: "names an earlier assertion of the same claim", to: "a-older", faults: ["SUPERSESSION_NOT_FORWARD_IN_TIME"] },
  ];
  interface Criterion {
    id: string;
    outcome: string;
    reason: string;
  }
  const readinessOver = (b: Bundle, balanceId: string): { classification: string; criteria: Criterion[] } => readiness(b, "a-identity", balanceId) as { classification: string; criteria: Criterion[] };
  /** Violations as check_invariants lists them, which is by assertion, then invariant, then code. */
  const inEngineOrder = (entries: readonly (readonly [string, string, string])[]): string[] =>
    [...entries].sort((x, y) => (`${x[0]}|${x[1]}|${x[2]}` < `${y[0]}|${y[1]}|${y[2]}` ? -1 : 1)).map(([id, inv, code]) => `${id} ${inv} ${code}`);

  test("CONTROL: with no supersession the two disagree: both CONFLICTING, and readiness over either is NOT_ESTABLISHED", () => {
    const b = rivals();
    for (const [id, other] of [["a-balance", "a-rival"], ["a-rival", "a-balance"]] as const) {
      const e = byId(b, id);
      assert.equal(e.supportState, "CONFLICTING", id);
      assert.deepEqual(e.conflictsWith, [other], id);
      const r = readinessOver(b, id);
      assert.equal(r.classification, "NOT_ESTABLISHED", id);
      const c5 = r.criteria.find((c) => c.id === "C5");
      assert.equal(c5?.outcome, "INDETERMINATE", id);
      assert.equal(c5?.reason, "CONFLICT_OR_SUPERSESSION", id);
    }
    assert.deepEqual(violations(b), []);
  });

  test("CONTROL: a well-formed supersession retires either: it is SUPERSEDED and out of detection, and the other reads as if alone", () => {
    for (const [victim, survivor] of [["a-rival", "a-balance"], ["a-balance", "a-rival"]] as const) {
      const b = supersede(rivals(), [victim, "a-newer"]);
      assert.equal(byId(b, victim).supportState, "SUPERSEDED", victim);
      assert.equal(byId(b, victim).supersededBy, "a-newer", victim);
      assert.deepEqual(byId(b, victim).conflictsWith, [], victim);
      assert.equal(byId(b, survivor).supportState, "ESTABLISHED", victim);
      assert.deepEqual(byId(b, survivor).conflictsWith, [], victim);
      assert.equal(readinessOver(b, survivor).classification, "CRITERIA_MET", victim);
      assert.deepEqual(violations(b), [], victim);
    }
  });

  for (const [victim, survivor] of [["a-rival", "a-balance"], ["a-balance", "a-rival"]] as const) {
    describe(`a record about ${victim}, which disagrees with ${survivor}`, () => {
      for (const f of faulty(victim, survivor)) {
        const world = (): Bundle => supersede(rivals(), [victim, f.to]);

        test(`BUG: it ${f.label}: ${survivor} is CONFLICTING, not ESTABLISHED, and ${victim} still reads SUPERSEDED`, () => {
          const b = world();
          const s = byId(b, survivor);
          assert.equal(s.supportState, "CONFLICTING");
          assert.deepEqual(s.conflictsWith, [victim]);
          assert.ok(s.limitations.includes("CONFLICT_DETECTED"), s.limitations.join());
          const v = byId(b, victim);
          assert.equal(v.supportState, "SUPERSEDED", "the published reading of a record that is invalid: CNF-006");
          assert.equal(v.supersededBy, f.to);
          assert.deepEqual(v.conflictsWith, [survivor], "it stays among those compared");
        });

        test(`BUG: it ${f.label}: readiness over ${survivor} is NOT_ESTABLISHED, because of the conflict, not CRITERIA_MET`, () => {
          const r = readinessOver(world(), survivor);
          assert.equal(r.classification, "NOT_ESTABLISHED");
          const c5 = r.criteria.find((c) => c.id === "C5");
          assert.equal(c5?.outcome, "INDETERMINATE");
          assert.equal(c5?.reason, "CONFLICT_OR_SUPERSESSION");
        });

        test(`BUG: it ${f.label}: ${survivor} declared ESTABLISHED is INV-03, which it could not be while the conflict was hidden`, () => {
          const b = world();
          b.assertions = b.assertions.map((a) => (a.id === survivor ? { ...a, declared: { supportState: "ESTABLISHED" as const } } : a));
          assert.deepEqual(violations(b), inEngineOrder([[survivor, "INV-03", "CONFLICT_SATISFIES_ESTABLISHED"], ...f.faults.map((code) => [victim, "INV-12", code] as const)]));
        });

        test(`CONTROL: it ${f.label}: it is reported as invalid, as it has been, and nothing else is`, () => {
          assert.deepEqual(violations(world()), inEngineOrder(f.faults.map((code) => [victim, "INV-12", code] as const)));
        });
      }
    });
  }

  test("CONTROL: beside a well-formed record for the same assertion, a faulty one changes nothing: the well-formed one retires it, in either order", () => {
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: [supersession("s-1", "a-rival", "a-newer"), supersession("s-2", "a-rival", "a-ghost")] })) {
      assert.equal(byId(b, "a-rival").supportState, "SUPERSEDED", supersessionIds(b));
      assert.equal(byId(b, "a-rival").supersededBy, "a-newer", supersessionIds(b));
      assert.deepEqual(byId(b, "a-rival").conflictsWith, [], supersessionIds(b));
      assert.equal(byId(b, "a-balance").supportState, "ESTABLISHED", supersessionIds(b));
    }
  });

  test("CONTROL: a record is judged for the assertion it names: a faulty one beside a well-formed one for the other leaves the other out, and the first compared with nothing", () => {
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: [supersession("s-1", "a-rival", "a-ghost"), supersession("s-2", "a-balance", "a-newer")] })) {
      // a-balance is retired by a well-formed record, so a-rival, whose record is not, is compared with nothing and has no conflict.
      assert.equal(byId(b, "a-balance").supportState, "SUPERSEDED", supersessionIds(b));
      assert.deepEqual(byId(b, "a-balance").conflictsWith, [], supersessionIds(b));
      assert.deepEqual(byId(b, "a-rival").conflictsWith, [], supersessionIds(b));
      assert.equal(byId(b, "a-rival").supportState, "SUPERSEDED", supersessionIds(b));
    }
  });

  test("BUG: three faulty records, about both of the two, in every order: both stay in detection, and each reads SUPERSEDED", () => {
    const records = [supersession("s-1", "a-rival", "a-ghost"), supersession("s-2", "a-balance", "a-balance"), supersession("s-3", "a-rival", "a-identity")];
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: records })) {
      for (const [id, other] of [["a-balance", "a-rival"], ["a-rival", "a-balance"]] as const) {
        assert.equal(byId(b, id).supportState, "SUPERSEDED", `${id} in ${supersessionIds(b)}`);
        assert.deepEqual(byId(b, id).conflictsWith, [other], `${id} in ${supersessionIds(b)}`);
      }
    }
  });

  describe("removing the records that cannot be valid moves no conflict", () => {
    const KEYS: Readonly<Record<string, readonly string[]>> = {
      ASSET_IDENTITY: ["chainId", "address"],
      TOKEN_BALANCE_AT_BLOCK: ["chainId", "token", "holder"],
      TOKEN_USD_PRICE: ["chainId", "token"],
    };
    /** Whether a record is well formed, written from the contract for this file's own count: the engine is not asked. */
    const wellFormed = (b: Bundle, s: Supersession): boolean => {
      const older = b.assertions.find((a) => a.id === s.supersededAssertionId);
      const newer = b.assertions.find((a) => a.id === s.supersedingAssertionId);
      if (older === undefined || newer === undefined || older === newer) return false;
      const identity = (a: Assertion): string => [a.claimType, ...(KEYS[a.claimType] ?? []).map((k) => String(a.subject[k]).toLowerCase())].join("|");
      return identity(older) === identity(newer) && Date.parse(newer.assertedAt) > Date.parse(older.assertedAt);
    };
    const POOL: readonly (readonly [string, string])[] = [
      ["a-rival", "a-ghost"], ["a-rival", "a-rival"], ["a-rival", "a-identity"], ["a-rival", "a-balance"], ["a-rival", "a-older"], ["a-rival", "a-newer"],
      ["a-balance", "a-newer"], ["a-balance", "a-ghost"], ["a-balance", "a-rival"], ["a-ghost", "a-newer"], ["a-newer", "a-balance"], ["a-rival", "a-other"],
    ];
    /** Every ordered choice of up to three distinct records from the pool. */
    const choices = (): (readonly (readonly [string, string])[])[] => {
      const out: (readonly (readonly [string, string])[])[] = [];
      const grow = (chosen: readonly (readonly [string, string])[]): void => {
        if (chosen.length > 0) out.push(chosen);
        if (chosen.length === 3) return;
        for (const p of POOL) if (!chosen.includes(p)) grow([...chosen, p]);
      };
      grow([]);
      return out;
    };

    test("BUG: over every ordered choice of up to three records, every assertion is compared with exactly the assertions it is without the faulty ones", () => {
      let faultyChoices = 0;
      let total = 0;
      for (const pairs of choices()) {
        const b = supersede(rivals(), ...pairs);
        const without: Bundle = { ...clone(b), supersessions: (b.supersessions ?? []).filter((s) => wellFormed(b, s)) };
        if (without.supersessions?.length !== b.supersessions?.length) faultyChoices++;
        total++;
        const [kept, bare] = [inspect(b).assertions, inspect(without).assertions];
        for (const e of kept) {
          const alone = bare.find((x) => x.assertionId === e.assertionId) as Evaluated;
          assert.deepEqual(e.conflictsWith, alone.conflictsWith, `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
        }
      }
      // The pool is not trivial: most choices hold a faulty record.
      assert.ok(total >= 1400, `${String(total)} choices`);
      assert.ok(faultyChoices >= 900, `${String(faultyChoices)} of ${String(total)} choices hold a faulty record`);
    });

    test("BUG: an assertion that no faulty record names reads exactly as it does without them, and one that one names reads SUPERSEDED", () => {
      for (const pairs of choices()) {
        const b = supersede(rivals(), ...pairs);
        const faultyRecords = (b.supersessions ?? []).filter((s) => !wellFormed(b, s));
        const without: Bundle = { ...clone(b), supersessions: (b.supersessions ?? []).filter((s) => wellFormed(b, s)) };
        const named = new Set(faultyRecords.map((s) => s.supersededAssertionId));
        const retired = new Set((without.supersessions ?? []).map((s) => s.supersededAssertionId));
        for (const e of inspect(b).assertions) {
          const alone = inspect(without).assertions.find((x) => x.assertionId === e.assertionId) as Evaluated;
          if (!named.has(e.assertionId)) assert.deepEqual(e, alone, `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
          else if (!retired.has(e.assertionId)) assert.equal(e.supportState, "SUPERSEDED", `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
        }
      }
    });
  });
});

describe("supersessions that overlap are read the same in any order", () => {
  describe("one assertion superseded more than once", () => {
    test("BUG: supersededBy names the smallest of the ids, in every order", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance", "a-balance-3"], ["a-balance", "a-balance-2"]))) {
        const e = byId(b, "a-balance");
        assert.equal(e.supersededBy, "a-balance-2", supersessionIds(b));
        assert.equal(e.supportState, "SUPERSEDED");
      }
    });

    test("BUG: three of them, in every order", () => {
      for (const b of everySupersessionOrder(supersede(balances("b-new", "c-new", "d-new"), ["a-balance", "d-new"], ["a-balance", "b-new"], ["a-balance", "c-new"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "b-new", supersessionIds(b));
      }
    });

    test("BUG: smallest means by code unit, as every other order in the engine is: an upper-case id sorts first, not by locale", () => {
      for (const b of everySupersessionOrder(supersede(balances("Z-new", "a-new"), ["a-balance", "a-new"], ["a-balance", "Z-new"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "Z-new", supersessionIds(b));
      }
    });

    test("BUG: smallest means by code unit, not by length", () => {
      for (const b of everySupersessionOrder(supersede(balances("aaaaaaaa-new", "z"), ["a-balance", "z"], ["a-balance", "aaaaaaaa-new"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "aaaaaaaa-new", supersessionIds(b));
      }
    });

    test("BUG: not the record with the latest effectiveAt, nor the assertion asserted latest", () => {
      const b = balances("b-new", "z-new");
      b.assertions = b.assertions.map((a) => (a.id === "z-new" ? { ...a, assertedAt: "2026-10-23T12:00:29Z" } : a.id === "b-new" ? { ...a, assertedAt: "2026-10-23T12:00:01Z" } : a));
      b.supersessions = [supersession("s-1", "a-balance", "z-new", "2026-10-23T12:00:29Z"), supersession("s-2", "a-balance", "b-new", "2026-10-23T12:00:01Z")];
      for (const ordered of everySupersessionOrder(b)) assert.equal(byId(ordered, "a-balance").supersededBy, "b-new", supersessionIds(ordered));
    });

    test("BUG: not the assertion of the same claim type: that is a violation to report, not a choice to make", () => {
      for (const b of everySupersessionOrder(supersede(balances("z-new"), ["a-balance", "z-new"], ["a-balance", "a-identity"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "a-identity", supersessionIds(b));
        assert.ok(violations(b).includes("a-balance INV-12 SUPERSESSION_CLAIM_IDENTITY_MISMATCH"), supersessionIds(b));
      }
    });

    test("BUG: the two records may share a supersession id: nothing resolves through it", () => {
      const twice = balances("a-balance-2", "a-balance-3");
      twice.supersessions = [supersession("s-1", "a-balance", "a-balance-3"), supersession("s-1", "a-balance", "a-balance-2")];
      for (const b of everySupersessionOrder(twice)) assert.equal(byId(b, "a-balance").supersededBy, "a-balance-2");
    });

    test("BUG: another assertion that resolves outranks an id that resolves to nothing, however that id is spelled", () => {
      for (const ghost of ["0-nothing", "m-nothing", "z-nothing"]) {
        for (const b of everySupersessionOrder(supersede(balances("b-balance-2"), ["a-balance", ghost], ["a-balance", "b-balance-2"]))) {
          assert.equal(byId(b, "a-balance").supersededBy, "b-balance-2", `${ghost} in ${supersessionIds(b)}`);
          assert.deepEqual(violations(b), ["a-balance INV-12 SUPERSESSION_REFERENCE_INVALID"], `${ghost} in ${supersessionIds(b)}`);
        }
      }
    });

    test("BUG: another assertion outranks the assertion itself", () => {
      for (const b of everySupersessionOrder(supersede(balances("b-balance-2"), ["a-balance", "a-balance"], ["a-balance", "b-balance-2"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "b-balance-2", supersessionIds(b));
      }
    });

    test("BUG: with no other assertion, itself outranks an id that resolves to nothing", () => {
      for (const b of everySupersessionOrder(supersede(golden(), ["a-balance", "0-nothing"], ["a-balance", "a-balance"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "a-balance", supersessionIds(b));
      }
    });

    test("BUG: with only ids that resolve to nothing, the smallest of them", () => {
      for (const b of everySupersessionOrder(supersede(golden(), ["a-balance", "z-nothing"], ["a-balance", "m-nothing"]))) {
        assert.equal(byId(b, "a-balance").supersededBy, "m-nothing", supersessionIds(b));
        assert.equal(byId(b, "a-balance").supportState, "SUPERSEDED");
      }
    });

    test("BUG: a reused assertion id resolves to nothing: it does not outrank an assertion that does, however it is spelled", () => {
      const b = balances("r-new", "z-new");
      b.assertions.push(clone(b.assertions.find((a) => a.id === "r-new") as Assertion));
      for (const ordered of everySupersessionOrder(supersede(b, ["a-balance", "r-new"], ["a-balance", "z-new"]))) assert.equal(byId(ordered, "a-balance").supersededBy, "z-new", supersessionIds(ordered));
    });

    // Superseded by itself, by nothing, or by another claim, an assertion used to leave conflict detection: see
    // "a supersession that cannot be valid takes nothing out of conflict detection" below, which says what holds now.

    test("CONTROL: a record naming nothing as the superseded id is invalid", () => {
      assert.deepEqual(violations(supersede(golden(), ["0-nothing", "a-balance"])), ["0-nothing INV-12 SUPERSESSION_REFERENCE_INVALID"]);
    });

    test("CONTROL: a supersession of itself and nothing else still reads SUPERSEDED, naming itself", () => {
      const e = byId(supersede(golden(), ["a-balance", "a-balance"]), "a-balance");
      assert.equal(e.supportState, "SUPERSEDED");
      assert.equal(e.supersededBy, "a-balance");
    });

    test("CONTROL: it is reported as superseded more than once, and is SUPERSEDED, in every order", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance", "a-balance-3"], ["a-balance", "a-balance-2"]))) {
        assert.deepEqual(violations(b), ["a-balance INV-12 SUPERSEDED_MULTIPLE_TIMES"]);
        assert.equal(byId(b, "a-balance").supportState, "SUPERSEDED");
        assert.ok(byId(b, "a-balance").limitations.includes("SUPERSEDED"));
      }
    });

    test("CONTROL: the same pair twice is superseded more than once", () => {
      assert.deepEqual(violations(supersede(balances("a-balance-2"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-2"])), ["a-balance INV-12 SUPERSEDED_MULTIPLE_TIMES"]);
    });

    test("CONTROL: superseded once, it names the one superseding id", () => {
      const b = supersede(balances("z-new"), ["a-balance", "z-new"]);
      assert.equal(byId(b, "a-balance").supersededBy, "z-new");
      assert.equal(byId(b, "z-new").supersededBy, null);
    });
  });

  describe("a supersession cycle counts every supersession", () => {
    test("BUG: a cycle through the smaller successor is reported in every order", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-3"], ["a-balance-2", "a-balance"]))) {
        assert.deepEqual(violations(b), ["a-balance-2 INV-12 SUPERSESSION_CYCLE", "a-balance-2 INV-12 SUPERSESSION_NOT_FORWARD_IN_TIME", "a-balance INV-12 SUPERSEDED_MULTIPLE_TIMES", "a-balance INV-12 SUPERSESSION_CYCLE"], supersessionIds(b));
      }
    });

    test("BUG: a cycle through the larger successor is reported in every order: a fix that follows one successor misses it", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-3"], ["a-balance-3", "a-balance"]))) {
        assert.deepEqual(cyclesIn(b), ["a-balance-3", "a-balance"], supersessionIds(b));
      }
    });

    test("BUG: a claim whose chain reaches a cycle down one branch is reported, as it is down the only branch", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3", "a-balance-4"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-3"], ["a-balance-3", "a-balance-4"], ["a-balance-4", "a-balance-3"]))) {
        assert.deepEqual(cyclesIn(b), ["a-balance-3", "a-balance-4", "a-balance"], supersessionIds(b));
      }
    });

    test("BUG: a supersession of itself beside another is a cycle in either order", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2"), ["a-balance", "a-balance"], ["a-balance", "a-balance-2"]))) {
        assert.deepEqual(violations(b), ["a-balance INV-12 SUPERSESSION_CYCLE", "a-balance INV-12 SUPERSESSION_REFERENCE_INVALID"], supersessionIds(b));
      }
    });

    test("CONTROL: with no overlap: the claims on the cycle and the claim that reaches it", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance-3", "a-balance"], ["a-balance", "a-balance-2"], ["a-balance-2", "a-balance"]))) {
        assert.deepEqual(cyclesIn(b), ["a-balance-2", "a-balance-3", "a-balance"], supersessionIds(b));
      }
    });

    test("CONTROL: a long ring is a cycle, however long", () => {
      const ring = ["a-1", "a-2", "a-3", "a-4", "a-5", "a-6", "a-7"];
      const pairs = ring.map((id, i) => [id, ring[(i + 1) % ring.length] as string] as const);
      assert.deepEqual(cyclesIn(supersede(balances(...ring), ...pairs)), ring);
    });

    test("CONTROL: two ways down to one assertion is no cycle: an assertion reached twice is not a loop", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3", "a-balance-4"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-3"], ["a-balance-2", "a-balance-4"], ["a-balance-3", "a-balance-4"]))) {
        assert.deepEqual(cyclesIn(b), [], supersessionIds(b));
      }
    });

    test("CONTROL: two starts that reach one cycle are both reported, in every order", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-1", "a-2", "a-3", "a-4"), ["a-1", "a-3"], ["a-2", "a-3"], ["a-3", "a-4"], ["a-4", "a-3"]))) {
        assert.deepEqual(cyclesIn(b), ["a-1", "a-2", "a-3", "a-4"], supersessionIds(b));
      }
    });

    test("CONTROL: ids that resolve to nothing still make a cycle if they name one, as they always have", () => {
      for (const b of everySupersessionOrder(supersede(golden(), ["x-nothing", "y-nothing"], ["y-nothing", "x-nothing"]))) assert.deepEqual(cyclesIn(b), ["x-nothing", "y-nothing"]);
    });

    test("CONTROL: a long chain with no loop is not a cycle", () => {
      assert.deepEqual(cyclesIn(supersede(balances("a-balance-2", "a-balance-3", "a-balance-4"), ["a-balance", "a-balance-2"], ["a-balance-2", "a-balance-3"], ["a-balance-3", "a-balance-4"])), []);
    });
  });

  describe("what one assertion supersedes is walked in id order", () => {
    const lineage = (t: Traced): string[] => t.lineage.map((l) => `${l.id} ${String(l.depth)}`);

    test("BUG: two superseded assertions are walked in id order, not as listed", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance-2", "a-balance-3"], ["a-balance", "a-balance-3"]))) {
        const t = trace(b, "a-balance-3");
        assert.deepEqual(lineage(t), ["a-balance-3 0", "obs-a-balance-3 1", "a-balance 1", "obs-balance 2", "a-balance-2 1", "obs-a-balance-2 2"], supersessionIds(b));
        // attr1 and der2 belong to a-balance-3's reading, attr4 and der5 to a-balance's.
        assert.deepEqual(t.prov.wasRevisionOf, {
          "ww:rev3": { "prov:generatedEntity": "ww:assertion/a-balance-3", "prov:usedEntity": "ww:assertion/a-balance" },
          "ww:rev6": { "prov:generatedEntity": "ww:assertion/a-balance-3", "prov:usedEntity": "ww:assertion/a-balance-2" },
        }, supersessionIds(b));
      }
    });

    test("BUG: how deep an assertion is found does not follow the listing: an assertion the walk reaches two ways is found the same way", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance-2", "a-balance-3"], ["a-balance", "a-balance-3"], ["a-balance", "a-balance-2"]))) {
        assert.deepEqual(lineage(trace(b, "a-balance-3")), ["a-balance-3 0", "obs-a-balance-3 1", "a-balance 1", "obs-balance 2", "a-balance-2 1", "obs-a-balance-2 2"], supersessionIds(b));
      }
    });

    test("BUG: id order means by code unit: an upper-case id is walked first, not by locale", () => {
      for (const b of everySupersessionOrder(supersede(balances("a-old", "Z-old", "a-new"), ["a-old", "a-new"], ["Z-old", "a-new"]))) {
        assert.deepEqual(lineage(trace(b, "a-new")).filter((l) => !l.startsWith("obs-")), ["a-new 0", "Z-old 1", "a-old 1"], supersessionIds(b));
      }
    });

    test("CHARACTERIZATION: the same pair twice is two relations, as it has been", () => {
      const twice = supersede(balances("a-balance-2"), ["a-balance", "a-balance-2"], ["a-balance", "a-balance-2"]);
      assert.equal(Object.keys(trace(twice, "a-balance-2").prov.wasRevisionOf).length, 2);
    });

    test("CONTROL: the ids of relations and lineage are unchanged with one superseded assertion", () => {
      const t = trace(supersede(balances("a-balance-2"), ["a-balance", "a-balance-2"]), "a-balance-2");
      assert.deepEqual(lineage(t), ["a-balance-2 0", "obs-a-balance-2 1", "a-balance 1", "obs-balance 2"]);
      assert.deepEqual(Object.keys(t.prov.wasRevisionOf), ["ww:rev3"]);
    });

    test("CONTROL: only supersessions are walked in id order: a derivation's inputs and an assertion's observations keep their listing", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-price", "a-balance"], USD_LIMITATIONS);
      b.assertions = b.assertions.map((a) => (a.id === "a-price" ? { ...a, observationIds: ["obs-price-b", "obs-price-a"] } : a));
      assert.deepEqual(lineage(trace(b, "a-usd")), ["a-usd 0", "a-price 1", "obs-price-b 2", "obs-price-a 2", "a-balance 1", "obs-balance 2"]);
    });

    test("CONTROL: an assertion is reported at the depth the walk first finds it, not its shortest", () => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price"], USD_LIMITATIONS);
      addUsd(b, "x-over", ["a-usd", "a-balance", "a-price"], USD_LIMITATIONS);
      assert.deepEqual(lineage(trace(b, "x-over")).filter((l) => !l.startsWith("obs-")), ["x-over 0", "a-usd 1", "a-balance 2", "a-price 2"]);
    });
  });
});

/** A balance of golden()'s block, read separately, so a derived claim over several balances has several readings. */
function addBalanceReading(b: Bundle, id: string, atomic: string, over: { finality?: "FINALIZED" | "UNFINALIZED"; temporality?: "CURRENT" | "PINNED" } = {}): void {
  const value = { balanceAtomic: atomic, decimals: "6" };
  b.observations.push(balanceObservation({ id: `obs-${id}`, payload: value, finality: over.finality ?? "FINALIZED" }));
  b.assertions.push(balanceAssertion({ id, temporality: over.temporality ?? "PINNED", observationIds: [`obs-${id}`], value }));
}
/** A price of golden()'s token from the same two providers as a-price. */
function addPriceReading(b: Bundle, id: string, price: string, temporality: "CURRENT" | "PINNED" = "CURRENT"): void {
  b.observations.push(priceObservation(`obs-${id}-a`, "src-prov-a", price), priceObservation(`obs-${id}-b`, "src-prov-b", price));
  b.assertions.push(priceAssertion({ id, temporality, value: { priceUsd: price }, observationIds: [`obs-${id}-a`, `obs-${id}-b`] }));
}
/** An identity of golden()'s token read only from chain state: no issuer attests it, so it is PARTIAL and readiness over it is not met. */
function addPartialIdentity(b: Bundle, id: string): void {
  b.observations.push(identityObservation({ id: `obs-${id}`, sourceId: "src-chain", origin: "CHAIN_OBSERVED" }));
  b.assertions.push(identityAssertion({ id, origin: "CHAIN_OBSERVED", observationIds: [`obs-${id}`] }));
}
/** Every limitation these inputs report, which a claim over them has to declare (INV-10): so that only recomputation can fault it. */
function retainedBy(b: Bundle, inputs: readonly string[]): LimitationCode[] {
  const retained = new Set<LimitationCode>(["WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY"]);
  for (const e of inspect(b).assertions) if (inputs.includes(e.assertionId)) for (const l of e.limitations as LimitationCode[]) retained.add(l);
  return [...retained].sort();
}
/** A USD value named a-usd over these inputs, declaring this value. */
function usdOver(b: Bundle, inputs: readonly string[], usdScaled18: string): Bundle {
  addUsd(b, "a-usd", inputs, retainedBy(b, inputs), { value: { usdScaled18, rounding: "FLOOR_SCALED_18" } });
  return b;
}
/** A readiness claim named a-ready over these inputs, declaring this classification. */
function readinessOver(b: Bundle, inputs: readonly string[], classification: string): Bundle {
  b.derivations.push({ id: "d-ready", ruleId: "wwvr.vault-technical-readiness", rulesVersion: "0.1.0-draft", inputAssertionIds: [...inputs], outputAssertionId: "a-ready" });
  b.assertions.push({ id: "a-ready", claimType: "VAULT_TECHNICAL_READINESS", origin: "WALLETWALL_DERIVED", temporality: "PINNED", subject: balanceSubject(), value: { classification }, observationIds: [], derivationId: "d-ready", assertedAt: EVALUATED_AT, limitations: retainedBy(b, inputs) });
  return b;
}
/** golden() and a second balance of the same block, CURRENT where a-balance is PINNED, so the two never conflict. With golden()'s own amount it agrees with a-balance. */
function twoBalances(atomic = "2000000", finality: "FINALIZED" | "UNFINALIZED" = "FINALIZED"): Bundle {
  const b = golden();
  addBalanceReading(b, "a-balance-cur", atomic, { temporality: "CURRENT", finality });
  return b;
}
/** The USD values the rule gives, written by hand: floor(atomic units x price / 10^6) at 18 places. */
const USD_OF = { firstBalanceFirstPrice: "1500150000000000000", secondBalanceFirstPrice: "2000200000000000000", firstBalanceSecondPrice: "3750000000000000000" } as const;
const MISMATCH = ["a-usd INV-00 RECOMPUTATION_MISMATCH"];

describe("a derived value is checked against every reading of its inputs", () => {
  test("CONTROL: one balance and one price: the value they give passes and any other fails, whatever is listed first", () => {
    for (const inputs of permutations(["a-balance", "a-price"])) {
      assert.deepEqual(violations(usdOver(golden(), inputs, USD_OF.firstBalanceFirstPrice)), [], inputs.join());
      assert.deepEqual(violations(usdOver(golden(), inputs, "1")), MISMATCH, inputs.join());
    }
  });

  test("BUG: two balances that disagree: a value declared from either fails, in every order of the inputs", () => {
    for (const value of [USD_OF.firstBalanceFirstPrice, USD_OF.secondBalanceFirstPrice]) {
      for (const inputs of permutations(["a-balance", "a-balance-cur", "a-price"])) assert.deepEqual(violations(usdOver(twoBalances(), inputs, value)), MISMATCH, `${value} from ${inputs.join()}`);
    }
  });

  test("CONTROL: two balances that agree: the value holds under both, so it passes in every order", () => {
    for (const inputs of permutations(["a-balance", "a-balance-cur", "a-price"])) assert.deepEqual(violations(usdOver(twoBalances("1500000"), inputs, USD_OF.firstBalanceFirstPrice)), [], inputs.join());
  });

  test("BUG: two prices that disagree: a value declared from either fails, in every order of the inputs", () => {
    for (const value of [USD_OF.firstBalanceFirstPrice, USD_OF.firstBalanceSecondPrice]) {
      for (const inputs of permutations(["a-balance", "a-price", "a-price-2"])) {
        const b = golden();
        addPriceReading(b, "a-price-2", "2.5", "PINNED");
        assert.deepEqual(violations(usdOver(b, inputs, value)), MISMATCH, `${value} from ${inputs.join()}`);
      }
    }
  });

  test("BUG: a reading that gives another value fails when it is listed last or in the middle, among many", () => {
    const readings = (disagrees: boolean): Bundle => {
      const b = golden();
      for (let i = 0; i < 15; i++) addBalanceReading(b, `g-balance-${String(i)}`, i === 7 && disagrees ? "2000000" : "1500000", { temporality: i === 7 && disagrees ? "CURRENT" : "PINNED" });
      for (let i = 0; i < 14; i++) addPriceReading(b, `g-price-${String(i)}`, "1.0001");
      return b;
    };
    const balanceIds = ["a-balance", ...Array.from({ length: 15 }, (_, i) => `g-balance-${String(i)}`)];
    const priceIds = ["a-price", ...Array.from({ length: 14 }, (_, i) => `g-price-${String(i)}`)];
    for (const inputs of [[...balanceIds, ...priceIds], [...priceIds, ...balanceIds], [...balanceIds].reverse().concat(priceIds)]) {
      assert.equal(inputs.length, 31);
      assert.deepEqual(violations(usdOver(readings(false), inputs, USD_OF.firstBalanceFirstPrice)), [], "every reading agrees");
      assert.deepEqual(violations(usdOver(readings(true), inputs, USD_OF.firstBalanceFirstPrice)), MISMATCH, "one reading in thirty-one disagrees");
    }
  });

  test("CONTROL: a balance whose amount cannot be read fails recomputation: nothing can be reproduced from it", () => {
    const b = golden();
    addBalanceReading(b, "a-balance-bad", "not-a-number", { temporality: "CURRENT" });
    assert.ok(violations(usdOver(b, ["a-balance-bad", "a-price"], USD_OF.firstBalanceFirstPrice)).includes("a-usd INV-00 RECOMPUTATION_MISMATCH"));
  });

  test("BUG: a reading whose amount cannot be read cannot hide behind one that can: the value fails, in every order of the inputs", () => {
    for (const inputs of permutations(["a-balance", "a-balance-bad", "a-price"])) {
      const b = golden();
      addBalanceReading(b, "a-balance-bad", "not-a-number", { temporality: "CURRENT" });
      assert.ok(violations(usdOver(b, inputs, USD_OF.firstBalanceFirstPrice)).includes("a-usd INV-00 RECOMPUTATION_MISMATCH"), inputs.join());
    }
  });

  describe("readiness", () => {
    const withUnfinalized = (): Bundle => {
      const b = golden();
      withUnfinalizedBalance(b);
      return b;
    };
    const classificationOf = (b: Bundle, identityId: string, balanceId: string): string => (readiness(b, identityId, balanceId) as { classification: string }).classification;

    test("CONTROL: assess_vault_readiness says CRITERIA_MET over the finalized balance and NOT_ESTABLISHED over the other: they are two readings", () => {
      assert.equal(classificationOf(withUnfinalized(), "a-identity", "a-balance"), "CRITERIA_MET");
      assert.equal(classificationOf(withUnfinalized(), "a-identity", "a-balance-unfinal"), "NOT_ESTABLISHED");
    });

    test("BUG: a readiness claim over a finalized and an unfinalized balance: CRITERIA_MET fails, and so does NOT_ESTABLISHED, in every order", () => {
      for (const classification of ["CRITERIA_MET", "NOT_ESTABLISHED"]) {
        for (const inputs of permutations(["a-identity", "a-balance", "a-balance-unfinal"])) {
          assert.deepEqual(violations(readinessOver(withUnfinalized(), inputs, classification)), ["a-ready INV-00 RECOMPUTATION_MISMATCH"], `${classification} from ${inputs.join()}`);
        }
      }
    });

    test("CONTROL: readings the rule reads alike: the classification holds under both, in every order", () => {
      for (const inputs of permutations(["a-identity", "a-balance", "a-balance-cur"])) assert.deepEqual(violations(readinessOver(twoBalances("1500000"), inputs, "CRITERIA_MET")), [], inputs.join());
      const both = withUnfinalized();
      both.observations = both.observations.map((o) => (o.id === "obs-balance" ? { ...o, finality: "UNFINALIZED" as const } : o));
      for (const inputs of permutations(["a-identity", "a-balance", "a-balance-unfinal"])) assert.deepEqual(violations(readinessOver(clone(both), inputs, "NOT_ESTABLISHED")), [], inputs.join());
    });

    test("BUG: two identities, one of them only read from chain state: CRITERIA_MET fails in every order", () => {
      for (const inputs of permutations(["a-identity", "a-identity-2", "a-balance"])) {
        const b = golden();
        addPartialIdentity(b, "a-identity-2");
        assert.equal(classificationOf(b, "a-identity-2", "a-balance"), "NOT_ESTABLISHED", "the second identity is a reading that gives another answer");
        assert.deepEqual(violations(readinessOver(b, inputs, "CRITERIA_MET")), ["a-ready INV-00 RECOMPUTATION_MISMATCH"], inputs.join());
      }
    });
  });

  describe("no list inside a record decides a verdict", () => {
    const PRICE18: Readonly<Record<string, bigint>> = { "1.0001": 1000100000000000000n, "2.5": 2500000000000000000n };
    const usdOf = (atomic: string, price: string): string => ((BigInt(atomic) * (PRICE18[price] as bigint)) / 10n ** 6n).toString();
    /** What the tools classify, which a list inside a record may not move: the walk of provenance and the echo of a record's own lists are left out. */
    const verdicts = (b: Bundle): string =>
      JSON.stringify([inspect(b).assertions.map((e) => [e.assertionId, e.supportState, e.freshnessState, e.finalityState, e.authority?.satisfied, e.limitations, e.independentCorroboration, e.conflictsWith, e.supersededBy]), invariants(b).violations, invariants(b).pass]);
    /** The lists inside the records in another order: what a derivation takes as inputs, and what an assertion rests on. */
    const shuffledInside = (b: Bundle, rand: () => number): Bundle => ({
      ...clone(b),
      assertions: clone(b.assertions).map((a) => ({ ...a, observationIds: shuffle(a.observationIds, rand) })),
      derivations: clone(b.derivations).map((d) => ({ ...d, inputAssertionIds: shuffle(d.inputAssertionIds, rand) })),
    });

    /** Several balances, prices and identities, and a USD value and a readiness claim over some of them, declaring any value. */
    function readingsWorld(rand: () => number): { b: Bundle; usdFails: boolean; readinessFails: boolean; several: boolean } {
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      const b = golden();
      const balances = [{ id: "a-balance", atomic: "1500000" }];
      const prices = [{ id: "a-price", price: "1.0001" }];
      const identities = ["a-identity"];
      for (let i = 0; i < Math.floor(rand() * 3); i++) {
        const atomic = pick(["1500000", "2000000"]);
        addBalanceReading(b, `a-balance-${String(i)}`, atomic, { temporality: pick(["CURRENT", "PINNED"] as const), finality: pick(["FINALIZED", "FINALIZED", "UNFINALIZED"] as const) });
        balances.push({ id: `a-balance-${String(i)}`, atomic });
      }
      for (let i = 0; i < Math.floor(rand() * 2); i++) {
        const price = pick(["1.0001", "2.5"]);
        addPriceReading(b, `a-price-${String(i)}`, price, pick(["CURRENT", "PINNED"] as const));
        prices.push({ id: `a-price-${String(i)}`, price });
      }
      if (rand() < 0.3) {
        addPartialIdentity(b, "a-identity-2");
        identities.push("a-identity-2");
      }
      const some = <T>(xs: readonly T[]): T[] => {
        const kept = xs.filter(() => rand() < 0.7);
        return kept.length > 0 ? kept : [pick(xs)];
      };
      const [bs, ps, is] = [some(balances), some(prices), some(identities)];
      const value = rand() < 0.75 ? pick(bs.flatMap((x) => ps.map((p) => usdOf(x.atomic, p.price)))) : "1";
      usdOver(b, shuffle([...bs.map((x) => x.id), ...ps.map((x) => x.id)], rand), value);
      const classification = pick(["CRITERIA_MET", "NOT_ESTABLISHED", "CRITERIA_NOT_MET"]);
      readinessOver(b, shuffle([...is, ...bs.map((x) => x.id)], rand), classification);
      return {
        b,
        // Written here: a value must be the rule's answer for every balance with every price. And for readiness, assess_vault_readiness over every identity with every balance.
        usdFails: bs.some((x) => ps.some((p) => usdOf(x.atomic, p.price) !== value)),
        readinessFails: is.some((i) => bs.some((x) => (readiness(b, i, x.id) as { classification: string }).classification !== classification)),
        several: bs.length > 1 || ps.length > 1 || is.length > 1,
      };
    }

    test("BUG: over worlds of several readings, a value fails exactly when some reading gives another, and no listing of any list inside a record moves a verdict", () => {
      const rand = mulberry32(20261104);
      let several = 0;
      let failing = 0;
      const WORLDS = 150;
      for (let n = 0; n < WORLDS; n++) {
        const world = readingsWorld(rand);
        if (world.several) several++;
        const listed = verdicts(world.b);
        const codes = violations(world.b);
        assert.equal(codes.includes("a-usd INV-00 RECOMPUTATION_MISMATCH"), world.usdFails, `world ${String(n)} USD: ${JSON.stringify(world.b.derivations)}`);
        assert.equal(codes.includes("a-ready INV-00 RECOMPUTATION_MISMATCH"), world.readinessFails, `world ${String(n)} readiness: ${JSON.stringify(world.b.derivations)}`);
        if (world.usdFails || world.readinessFails) failing++;
        for (let k = 0; k < 4; k++) assert.equal(verdicts(shuffledInside(world.b, rand)), listed, `world ${String(n)}, shuffle ${String(k)}`);
      }
      // The worlds are not trivial: most hold several readings, and a good part fail.
      assert.ok(several >= 90, `${String(several)} of ${String(WORLDS)} worlds hold several readings`);
      assert.ok(failing >= 40, `${String(failing)} of ${String(WORLDS)} worlds hold a value some reading does not give`);
    });
  });
});

/** Everything every tool answers, leaving out only the digest of the records as listed, which follows their order by design. */
function answers(b: Bundle): string {
  const ids = [...new Set(b.assertions.map((a) => a.id))].sort();
  const pair = ids.slice(0, 2);
  return JSON.stringify([
    { ...inspect(b), bundleDigest: "" },
    { ...invariants(b), bundleDigest: "" },
    readiness(b, "a-identity", "a-balance"),
    readiness(b, pair[0] ?? "nope", pair[1] ?? "nope"),
    ids.map((id) => trace(b, id)),
  ]);
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(xs: readonly T[], rand: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};
/** Every list in the bundle in another order. The records themselves, and the lists inside them, stay as they are. */
const shuffled = (b: Bundle, rand: () => number): Bundle => ({
  ...clone(b),
  sources: shuffle(clone(b.sources), rand),
  observations: shuffle(clone(b.observations), rand),
  assertions: shuffle(clone(b.assertions), rand),
  derivations: shuffle(clone(b.derivations), rand),
  ...(b.conflicts === undefined ? {} : { conflicts: shuffle(clone(b.conflicts), rand) }),
  ...(b.supersessions === undefined ? {} : { supersessions: shuffle(clone(b.supersessions), rand) }),
});

/** Whether a derivation chain from a claim comes back to it. Written from the contract, for this file's own count; the engine is not asked. */
function hasCycle(b: Bundle): boolean {
  const inputs = (id: string): readonly string[] => {
    const a = b.assertions.find((x) => x.id === id);
    const d = b.derivations.find((x) => x.id === a?.derivationId);
    return d === undefined || d.outputAssertionId !== id ? [] : d.inputAssertionIds;
  };
  return b.assertions.some((start) => {
    const seen = new Set<string>();
    const pending = [...inputs(start.id)];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next === start.id) return true;
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(...inputs(next));
      }
    }
    return false;
  });
}

/** A free graph of derived claims over each other, with supersessions and conflicts among them: cycles and overlaps are common, and nothing else is arranged. */
function randomGraph(rand: () => number): Bundle {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const b = golden();
  withUnfinalizedBalance(b);
  const derived = Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, i) => `g-${String(i)}`);
  const pool = [...derived, "a-balance", "a-balance-unfinal", "a-price", "a-identity"];
  for (const id of derived) {
    const inputs = rand() < 0.75 ? ["a-balance", "a-price"] : [];
    for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) inputs.push(pick(pool));
    if (rand() < 0.08) inputs.push("a-ghost");
    const declared = rand() < 0.5 ? ON_A_CYCLE : shuffle<LimitationCode>(["DEPENDENCY_CYCLE", "MISSING_REQUIRED_DEPENDENCY", "NOT_FINALIZED", "SUPERSEDED", "DANGLING_REFERENCE", "NO_SOURCE", ...USD_LIMITATIONS], rand).slice(0, 8);
    const readinessClaim = rand() < 0.25;
    addUsd(b, id, inputs, declared, {
      temporality: pick(["PINNED", "CURRENT"]),
      ...(rand() < 0.1 ? { subject: balanceSubject({ holder: `0x${"99".repeat(20)}` }) } : {}),
      ...(readinessClaim ? { claimType: "VAULT_TECHNICAL_READINESS" as const, value: { classification: pick(["CRITERIA_MET", "NOT_ESTABLISHED"]) } } : {}),
      ...(rand() < 0.15 ? { declared: { supportState: pick(["STALE", "SUPPORTED", "NOT_ESTABLISHED"] as const) } } : {}),
    });
    if (readinessClaim) b.derivations = b.derivations.map((d) => (d.id === `d-${id}` ? { ...d, ruleId: "wwvr.vault-technical-readiness" } : d));
    else if (rand() < 0.1) b.derivations = b.derivations.map((d) => (d.id === `d-${id}` ? { ...d, rulesVersion: "9.9.9" } : d));
  }
  const names = [...pool, "a-ghost"];
  if (rand() < 0.7) b.supersessions = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => supersession(rand() < 0.2 ? "s-shared" : `s-${String(i)}`, pick(rand() < 0.6 ? derived.slice(0, 2) : names), pick(names)));
  if (rand() < 0.4) b.conflicts = [{ id: "c-1", assertionIds: [pick(pool), pick(pool)], reason: "VALUE_DISAGREEMENT" }];
  return b;
}

describe("no list in a bundle has an order that matters", () => {
  test("BUG: over free graphs of claims, shuffling every list moves no answer but the digest of the records as listed", () => {
    const rand = mulberry32(20261103);
    let cycles = 0;
    let overlaps = 0;
    const GRAPHS = 200;
    for (let n = 0; n < GRAPHS; n++) {
      const b = randomGraph(rand);
      const superseded = (b.supersessions ?? []).map((s) => s.supersededAssertionId);
      if (hasCycle(b)) cycles++;
      if (new Set(superseded).size < superseded.length) overlaps++;
      const listed = answers(b);
      for (let k = 0; k < 3; k++) {
        const moved = shuffled(b, rand);
        assert.equal(answers(moved), listed, `graph ${String(n)}, shuffle ${String(k)}: ${JSON.stringify(moved)}`);
      }
    }
    // The graphs are not trivial: most hold what this file is about.
    assert.ok(cycles >= 80, `${String(cycles)} of ${String(GRAPHS)} graphs hold a cycle`);
    assert.ok(overlaps >= 30, `${String(overlaps)} of ${String(GRAPHS)} graphs supersede one assertion twice`);
  });

  test("BUG: over every bundle in the published corpus, shuffling every list moves no answer but the digest of the records as listed", () => {
    const rand = mulberry32(1);
    let run = 0;
    for (const c of loadCorpus()) {
      if (c.expect.schemaRejected === true) continue;
      const b = c.bundle as Bundle;
      run++;
      const listed = answers(b);
      for (let k = 0; k < 2; k++) assert.equal(answers(shuffled(b, rand)), listed, c.id);
    }
    assert.ok(run >= 60, `${String(run)} bundles`);
  });

  test("CHARACTERIZATION: the digest of the bundle does follow the order of its records", () => {
    const b = cycleOfTwo();
    const reversed = { ...clone(b), assertions: [...clone(b.assertions)].reverse() };
    assert.notEqual(inspect(b).bundleDigest, inspect(reversed).bundleDigest);
    assert.notEqual(invariants(b).bundleDigest, invariants(reversed).bundleDigest);
  });
});

describe("the published contract says so", () => {
  const rules = (): Record<string, string> => (claimContracts({}) as { bundleRules: Record<string, string> }).bundleRules;

  // Whole sentences: a phrase can survive in a rule that now says the opposite.
  test("BUG: walletwall://schemas/claims says record order changes no answer, and what does follow it", () => {
    assert.equal(rules()["recordOrder"], "The order of the records in any list of a bundle the schema accepts changes no answer of inspect_evidence, check_invariants, assess_vault_readiness or trace_provenance. Only bundleDigest follows it.");
  });

  test("BUG: walletwall://schemas/claims says a derived value is recomputed under every reading of its inputs, and what the order of the inputs moves", () => {
    assert.equal(
      rules()["derivedValues"],
      "check_invariants recomputes a derived USD value under every balance and every price among its inputs, and a derived readiness classification under every identity and every balance, and reports INV-00 RECOMPUTATION_MISMATCH if any reading gives another value. The order of inputAssertionIds changes no verdict; trace_provenance still lists what it walks in that order.",
    );
  });

  test("BUG: walletwall://schemas/claims says what a dependency cycle reads, lifecycle included", () => {
    assert.equal(rules()["dependencyCycles"], "A derived assertion that depends on itself, directly or through others, has no basis: each assertion on the cycle reports DEPENDENCY_CYCLE, is NOT_ESTABLISHED unless a supersession or conflict overrides that, and retains every limitation any of them reports.");
  });

  test("BUG: walletwall://schemas/claims says what overlapping supersessions read", () => {
    assert.equal(
      rules()["supersessions"],
      "An assertion superseded more than once is SUPERSEDED. supersededBy names the smallest of the other assertions its records name that resolve, otherwise the assertion itself if a record names it, otherwise the smallest id named, whichever record comes first. check_invariants reports INV-12 SUPERSEDED_MULTIPLE_TIMES for more than one record that names another assertion, SUPERSESSION_REFERENCE_INVALID for a record that names nothing or its own assertion, SUPERSESSION_CLAIM_IDENTITY_MISMATCH for one whose assertions are not about the same claim, SUPERSESSION_NOT_FORWARD_IN_TIME for one whose superseding assertion is not later, and SUPERSESSION_CYCLE for a chain that comes back on itself by any of them. Only a record with none of those faults takes an assertion out of conflict detection: an assertion that a faulty record supersedes still reads SUPERSEDED but stays among those compared, so a record that cannot be valid cannot hide a conflict.",
    );
  });
});

describe("the specification says what a faulty supersession does", () => {
  const flat = (file: string): string => readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");

  test("BUG: spec/EVIDENCE_PROFILE.md says only a well-formed record takes an assertion out of conflict detection, and what a faulty one leaves", () => {
    assert.ok(
      flat("spec/EVIDENCE_PROFILE.md").includes(
        "A supersession record is well-formed when it names two different assertions that resolve, of one claim identity, the superseding one asserted later. Only a well-formed record takes an assertion out of conflict detection, because only then does a later assertion carry the claim forward. An assertion that a faulty record supersedes (one `check_invariants` reports as `SUPERSESSION_REFERENCE_INVALID`, `SUPERSESSION_CLAIM_IDENTITY_MISMATCH` or `SUPERSESSION_NOT_FORWARD_IN_TIME`) still reads `SUPERSEDED`, and stays among those compared, so a record that cannot be valid cannot hide a conflict. This only ever adds a conflict: an assertion it changes reads `CONFLICTING`, a fall from any state that was a basis and no gain for one that was not (`NOT_ESTABLISHED`), and no readiness answer is more favourable.",
      ),
    );
  });

  test("BUG: spec/EVIDENCE_PROFILE.md defines a conflict among the assertions no well-formed supersession retires, and names the codes INV-12 reports", () => {
    const text = flat("spec/EVIDENCE_PROFILE.md");
    assert.ok(text.includes("detected by the engine when two assertions about the same claim identity, neither retired by a well-formed supersession (section 8), carry different values."));
    assert.ok(text.includes("one whose two assertions are not about the same claim as `SUPERSESSION_CLAIM_IDENTITY_MISMATCH`, one whose superseding assertion is not later as `SUPERSESSION_NOT_FORWARD_IN_TIME`"));
  });

  test("BUG: spec/EVIDENCE_PROFILE.md says what a list inside one record moves, and what it does not, and how a derived value is recomputed", () => {
    const text = flat("spec/EVIDENCE_PROFILE.md");
    assert.ok(text.includes("A list inside one record is part of that record, and this does not cover it. It moves no state, limitation or violation, because a derived value is recomputed under every reading of its inputs, but it is what `trace_provenance` walks and what `dependencies` echo, in that order."));
    assert.ok(text.includes("A derived value that recomputation does not reproduce is reported here as `RECOMPUTATION_MISMATCH`: the rule is applied to every balance with every price among the inputs of a USD value, and to every identity with every balance among those of a readiness claim, and one reading that gives another value is a mismatch."));
  });

  test("BUG: spec/SUPPORT_STATES.md says a faulty record still marks the assertion and does not take it out of conflict detection", () => {
    assert.ok(flat("spec/SUPPORT_STATES.md").includes("A faulty record, one that names nothing, the assertion itself, another claim or an assertion that is not later, still marks it, and does not take it out of conflict detection."));
  });

  test("BUG: THREAT_MODEL.md says a record that fails the checks takes nothing out of conflict detection, and cites the vectors", () => {
    const text = flat("THREAT_MODEL.md");
    assert.ok(text.includes("and a record that fails them, or names nothing, takes nothing out of conflict detection, so it cannot hide a conflict;"));
    assert.ok(text.includes("`CNF-005..009`, `CNF-013..015`, `CNF-017..036`"));
  });
});

describe("WallPrint", () => {
  const snapshot = (bundle: Bundle, focalAssertionId: string): ReturnType<typeof buildWallPrintSnapshot> => buildWallPrintSnapshot({ id: "rec-order", bundle: clone(bundle), evaluatedAt: EVALUATED_AT, focalAssertionId });
  /** A record without what follows the listing it was built from: the digest of the bundle, and its own digest over that. */
  const recordOf = (bundle: Bundle, focalAssertionId: string): unknown => {
    const { digest: _digest, evidence, ...rest } = snapshot(bundle, focalAssertionId);
    const { bundleDigest: _bundleDigest, ...items } = evidence;
    return { ...rest, evidence: items };
  };
  const refusal = (bundle: Bundle, focal: string): string[] => {
    try {
      snapshot(bundle, focal);
      return [];
    } catch (e) {
      assert.ok(e instanceof WallPrintError, String(e));
      return e.findings.map((f) => `${f.code} ${f.path}`);
    }
  };

  test("BUG: a record over a cycle says the same in every order of the assertions", () => {
    const answers = new Set(everyAssertionOrder(cycleWithAMissingInput()).map((b) => JSON.stringify(recordOf(b, "a-balance"))));
    assert.equal(answers.size, 1);
  });

  test("BUG: a record about an assertion on a cycle says the same in every order of the assertions", () => {
    const answers = new Set(everyAssertionOrder(cycleWithAMissingInput()).map((b) => JSON.stringify(recordOf(b, "a-usd"))));
    assert.equal(answers.size, 1);
  });

  test("BUG: a record over overlapping supersessions says the same in every order of them", () => {
    const b = supersede(balances("a-balance-2", "a-balance-3"), ["a-balance-2", "a-balance-3"], ["a-balance", "a-balance-3"], ["a-balance", "a-balance-2"]);
    const answers = new Set(everySupersessionOrder(b).map((x) => JSON.stringify(recordOf(x, "a-balance-3"))));
    assert.equal(answers.size, 1);
  });

  test("BUG: beside another assertion that resolves, an id that resolves to nothing does not refuse the record, whichever is listed first and however it is spelled", () => {
    for (const ghost of ["0-nothing", "m-nothing", "z-nothing"]) {
      for (const b of everySupersessionOrder(supersede(balances("b-balance-2"), ["a-balance", ghost], ["a-balance", "b-balance-2"]))) {
        assert.deepEqual(refusal(b, "a-balance"), [], `${ghost} in ${supersessionIds(b)}`);
        assert.deepEqual(snapshot(b, "a-balance").violations, [{ invariant: "INV-12", code: "SUPERSESSION_REFERENCE_INVALID", assertionId: "a-balance" }]);
      }
    }
  });

  test("CONTROL: with only ids that resolve to nothing the record is refused, as it has been", () => {
    for (const b of everySupersessionOrder(supersede(golden(), ["a-balance", "z-nothing"], ["a-balance", "m-nothing"]))) {
      assert.ok(refusal(b, "a-balance").some((f) => f.startsWith("UNKNOWN_REFERENCE claims[")), supersessionIds(b));
    }
  });

  test("BUG: an id that resolves to nothing is masked by a supersession of itself, whichever is listed first: the record builds, and carries the violation", () => {
    for (const b of everySupersessionOrder(supersede(golden(), ["a-balance", "z-nothing"], ["a-balance", "a-balance"]))) {
      assert.deepEqual(refusal(b, "a-balance"), [], supersessionIds(b));
      assert.ok(snapshot(b, "a-balance").violations.some((v) => v.code === "SUPERSESSION_REFERENCE_INVALID"), supersessionIds(b));
    }
    assert.ok(refusal(supersede(golden(), ["a-balance", "z-nothing"]), "a-balance").some((f) => f.startsWith("UNKNOWN_REFERENCE claims[")));
  });

  test("BUG: a record over a supersession that cannot be valid carries the conflict it cannot hide, and replays as REPRODUCED", () => {
    for (const to of ["a-rival", "a-identity", "a-balance", "a-older", "a-other"]) {
      const b = supersede(rivals(), ["a-rival", to]);
      const r = snapshot(b, "a-balance");
      assert.equal(r.claims.find((c) => c.assertionId === "a-balance")?.supportState, "CONFLICTING", to);
      assert.deepEqual(r.conflicts, [{ assertionIds: ["a-balance", "a-rival"], cause: "CONFLICT_DETECTED" }], to);
      assert.ok(r.violations.some((v) => v.invariant === "INV-12"), to);
      const evidence = createEvidenceStore();
      evidence.put(clone(b));
      assert.equal(replayWallPrint(r, { evidence }).outcome, "REPRODUCED", to);
    }
  });

  test("BUG: a record over a derivation with two balances says the same of every state and violation, in every order of its inputs", () => {
    const readingOf = (b: Bundle): string => {
      const r = snapshot(b, "a-usd");
      return JSON.stringify([r.violations, r.claims.map((c) => [c.assertionId, c.supportState, c.freshnessState, c.finalityState, c.limitations, c.conflictsWith, c.supersededBy])]);
    };
    const answers = new Set(permutations(["a-balance", "a-balance-cur", "a-price"]).map((inputs) => readingOf(usdOver(twoBalances(), inputs, USD_OF.firstBalanceFirstPrice))));
    assert.equal(answers.size, 1);
    assert.deepEqual(snapshot(usdOver(twoBalances(), ["a-balance", "a-balance-cur", "a-price"], USD_OF.firstBalanceFirstPrice), "a-usd").violations, [{ invariant: "INV-00", code: "RECOMPUTATION_MISMATCH", assertionId: "a-usd" }]);
  });

  test("CONTROL: a record over a supersession that names nothing is refused, as it has been, whichever of the two it is about", () => {
    for (const victim of ["a-rival", "a-balance"]) assert.ok(refusal(supersede(rivals(), [victim, "a-ghost"]), "a-balance").some((f) => f.startsWith("UNKNOWN_REFERENCE claims[")), victim);
  });

  describe("at the cap on provenance issues", () => {
    /**
     * 64 USD values on one dense cycle, each reading the next and up to twelve before it, and a balance that supersedes the first
     * and the last. Walking in from the first finds more DEPENDENCY_CYCLE issues than a record may carry, and from the last far fewer.
     */
    function atTheCap(nameOf: (i: number) => string, order: "first-listed-first" | "last-listed-first"): Bundle {
      const b = golden();
      for (let i = 0; i < 64; i++) {
        const back = Array.from({ length: Math.min(i, 12) }, (_, k) => nameOf(i - k - 1));
        addUsd(b, nameOf(i), [...(i < 63 ? [nameOf(i + 1)] : []), "a-balance", "a-price", ...back]);
      }
      b.observations.push(balanceObservation({ id: "obs-t" }));
      b.assertions.push(balanceAssertion({ id: "t", observationIds: ["obs-t"], assertedAt: "2026-10-23T12:00:31Z" }));
      const records = [supersession("s-first", nameOf(0), "t"), supersession("s-last", nameOf(63), "t")];
      b.supersessions = order === "first-listed-first" ? records : [...records].reverse();
      return b;
    }
    const ascending = (i: number): string => `n-${String(i).padStart(2, "0")}`;
    const descending = (i: number): string => `n-${String(63 - i).padStart(2, "0")}`;

    test("BUG: whether a record builds follows no listing. It does follow the spelling of the ids, because they say where the walk enters: a follow-up", () => {
      for (const order of ["first-listed-first", "last-listed-first"] as const) {
        const enteredAtTheFirst = atTheCap(ascending, order);
        assert.ok(trace(enteredAtTheFirst, "t").issues.length > 640, order);
        assert.deepEqual(refusal(enteredAtTheFirst, "t"), ["TOO_MANY provenance.issues"], order);
        const enteredAtTheLast = atTheCap(descending, order);
        assert.ok(trace(enteredAtTheLast, "t").issues.length <= 640, order);
        assert.deepEqual(refusal(enteredAtTheLast, "t"), [], order);
      }
    });
  });

  test("BUG: a conflict on a cycle does not refuse the record: the assertion over it is NOT_ESTABLISHED, not CONFLICTING with nothing", () => {
    const b = cycleOfTwo();
    b.conflicts = [{ id: "c-1", assertionIds: ["a-usd-2", "a-identity"], reason: "VALUE_DISAGREEMENT" }];
    for (const ordered of everyAssertionOrder(b)) assert.deepEqual(refusal(ordered, "a-balance"), [], listing(ordered));
  });

  test("CONTROL: a record over a cycle replays as REPRODUCED under the engine that built it, whichever order it was built from", () => {
    for (const b of everyAssertionOrder(cycleOfTwo()).slice(0, 6)) {
      const evidence = createEvidenceStore();
      evidence.put(clone(b));
      assert.equal(replayWallPrint(snapshot(b, "a-balance"), { evidence }).outcome, "REPRODUCED");
    }
  });

  test("CONTROL: admission reads the records, not the evaluation: a cycle or an overlap changes nothing it finds, in any order", () => {
    const assessment = (refs: string[]): Parameters<typeof externalAssessmentAdmissionFindings>[0][number] => ({ assessor: "reviewer-y", assessorRole: "INDEPENDENT_REVIEWER", assessment: "NOT_AVAILABLE", policy: "reviewer-y-review", policyVersion: "1", assessedAt: OBSERVED_AT, evidenceRefs: refs, limitations: [] });
    const worlds = [...everyAssertionOrder(cycleOfTwo()).slice(0, 6), ...everySupersessionOrder(supersede(balances("a-balance-2", "a-balance-3"), ["a-balance", "a-balance-3"], ["a-balance", "z-nothing"]))];
    for (const version of WALLPRINT_VERSIONS) {
      for (const b of worlds) {
        assert.deepEqual(externalAssessmentAdmissionFindings([assessment(["a-balance"])], b, "a-balance", version), []);
        assert.deepEqual(externalAssessmentAdmissionFindings([assessment(["nope"])], b, "a-balance", version).map((f) => f.code), ["UNKNOWN_EVIDENCE_REFERENCE"]);
      }
    }
  });

  test("CONTROL: the fixture constants are what these expectations assume", () => {
    assert.equal(BLOCK_HASH, `0x${"ab".repeat(32)}`);
    assert.equal(BLOCK_NUMBER, "21000000");
  });
});
