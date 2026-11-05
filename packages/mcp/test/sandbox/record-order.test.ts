import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { claimContracts } from "../../src/claims.ts";
import { evaluateBundle } from "../../src/evaluate.ts";
import { BundleSchema, type Assertion, type Bundle, type LimitationCode, type Observation } from "../../src/schemas.ts";
import { callTool } from "../../src/tools.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { buildWallPrintSnapshot, externalAssessmentAdmissionFindings, wallPrintDigest, wallPrintPayload } from "../../src/wallprint/record.ts";
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
  prov: { entity: Record<string, unknown>; wasRevisionOf: Record<string, { "prov:generatedEntity": string; "prov:usedEntity": string }> };
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
/** The strength order of spec/SUPPORT_STATES.md, weakest first. */
const WEAKEST_FIRST = ["NOT_ESTABLISHED", "CONFLICTING", "UNKNOWN", "SUPERSEDED", "STALE", "PARTIAL", "SUPPORTED", "ESTABLISHED"];
const weaker = (x: string, y: string): string => (WEAKEST_FIRST.indexOf(x) <= WEAKEST_FIRST.indexOf(y) ? x : y);

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

    // spec/EVIDENCE_PROFILE.md, step 2: beside a reused id "a derived claim reads a superseded input as NOT_ESTABLISHED, not as superseded, so it
    // inherits SUPERSEDED but does not report DEPENDENCY_SUPERSEDED". The one other claim on a cycle reads the superseded one as an input, so
    // this is the path no other test reached once a record that cannot be valid stopped raising the assertion it names.
    test("CONTROL: beside a reused id, the claim over a superseded one on its cycle inherits SUPERSEDED and reports no DEPENDENCY_SUPERSEDED, and every claim is refused", () => {
      const reused = (b: Bundle): Bundle => {
        b.sources.push({ id: "src-reused", kind: "USER_INPUT" }, { id: "src-reused", kind: "CHAIN_STATE" });
        return b;
      };
      for (const b of eachListedFirst(reused(superseding(cycleOfTwo(), "a-usd-2")))) {
        for (const a of b.assertions) assert.equal(byId(b, a.id).supportState, "NOT_ESTABLISHED", `${a.id} in ${listing(b)}`);
        const over = byId(b, "a-usd");
        assert.ok(over.limitations.includes("SUPERSEDED"), listing(b));
        assert.ok(!over.limitations.includes("DEPENDENCY_SUPERSEDED"), listing(b));
        assert.equal(over.supersededBy, null, listing(b));
        assert.equal(byId(b, "a-usd-2").supersededBy, "a-usd-new", listing(b));
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

    test("BUG: a claim on a cycle superseded by an id that resolves to nothing stays NOT_ESTABLISHED, with the record's limitation: a record that cannot be valid raises nothing", () => {
      const b = cycleOfTwo();
      b.supersessions = [{ id: "s-1", supersededAssertionId: "a-usd-2", supersedingAssertionId: "z-nothing", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
      for (const ordered of everyAssertionOrder(b)) {
        assert.equal(byId(ordered, "a-usd-2").supportState, "NOT_ESTABLISHED", listing(ordered));
        assert.ok(byId(ordered, "a-usd-2").limitations.includes("SUPERSEDED"), listing(ordered));
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

  test("BUG: a well-formed supersession retires either, and the disagreement stays: it is SUPERSEDED and lists the other, which reads CONFLICTING and is not met", () => {
    for (const [victim, survivor] of [["a-rival", "a-balance"], ["a-balance", "a-rival"]] as const) {
      const b = supersede(rivals(), [victim, "a-newer"]);
      assert.equal(byId(b, victim).supportState, "SUPERSEDED", victim);
      assert.equal(byId(b, victim).supersededBy, "a-newer", victim);
      assert.deepEqual(byId(b, victim).conflictsWith, [survivor], victim);
      assert.equal(byId(b, survivor).supportState, "CONFLICTING", victim);
      assert.deepEqual(byId(b, survivor).conflictsWith, [victim], victim);
      assert.equal(readinessOver(b, survivor).classification, "NOT_ESTABLISHED", victim);
      assert.deepEqual(violations(b), [], victim);
    }
  });

  for (const [victim, survivor] of [["a-rival", "a-balance"], ["a-balance", "a-rival"]] as const) {
    describe(`a record about ${victim}, which disagrees with ${survivor}`, () => {
      for (const f of faulty(victim, survivor)) {
        const world = (): Bundle => supersede(rivals(), [victim, f.to]);

        test(`BUG: it ${f.label}: ${survivor} is CONFLICTING, not ESTABLISHED, and so is ${victim}, which still carries the record's limitation and supersededBy`, () => {
          const b = world();
          const s = byId(b, survivor);
          assert.equal(s.supportState, "CONFLICTING");
          assert.deepEqual(s.conflictsWith, [victim]);
          assert.ok(s.limitations.includes("CONFLICT_DETECTED"), s.limitations.join());
          const v = byId(b, victim);
          assert.equal(v.supportState, "CONFLICTING", "a record that cannot be valid never raises what it names, and an assertion in a conflict reads CONFLICTING");
          assert.equal(v.supersededBy, f.to);
          assert.ok(v.limitations.includes("SUPERSEDED") && v.limitations.includes("CONFLICT_DETECTED"), v.limitations.join());
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

  test("BUG: beside a well-formed record for the same assertion, a faulty one changes nothing: the well-formed one retires it, and the disagreement it leaves stays, in either order", () => {
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: [supersession("s-1", "a-rival", "a-newer"), supersession("s-2", "a-rival", "a-ghost")] })) {
      assert.equal(byId(b, "a-rival").supportState, "SUPERSEDED", supersessionIds(b));
      assert.equal(byId(b, "a-rival").supersededBy, "a-newer", supersessionIds(b));
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"], supersessionIds(b));
      assert.equal(byId(b, "a-balance").supportState, "CONFLICTING", supersessionIds(b));
    }
  });

  test("BUG: a record is judged for the assertion it names: a faulty one beside a well-formed one for the other leaves its assertion among those compared, and the retired one is compared with it", () => {
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: [supersession("s-1", "a-rival", "a-ghost"), supersession("s-2", "a-balance", "a-newer")] })) {
      // a-balance is retired by a well-formed record, so it is SUPERSEDED, and a-rival, whose record is not, is live: it stays compared, with a-balance,
      // which dissents. It reads the weaker of that conflict and SUPERSEDED, which is CONFLICTING, and carries the faulty record's limitation.
      assert.equal(byId(b, "a-balance").supportState, "SUPERSEDED", supersessionIds(b));
      assert.deepEqual(byId(b, "a-balance").conflictsWith, ["a-rival"], supersessionIds(b));
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"], supersessionIds(b));
      assert.equal(byId(b, "a-rival").supportState, "CONFLICTING", supersessionIds(b));
      assert.ok(byId(b, "a-rival").limitations.includes("SUPERSEDED"), supersessionIds(b));
    }
  });

  test("BUG: three faulty records, about both of the two, in every order: both stay in detection, and each reads CONFLICTING, with the record's limitation", () => {
    const records = [supersession("s-1", "a-rival", "a-ghost"), supersession("s-2", "a-balance", "a-balance"), supersession("s-3", "a-rival", "a-identity")];
    for (const b of everySupersessionOrder({ ...rivals(), supersessions: records })) {
      for (const [id, other] of [["a-balance", "a-rival"], ["a-rival", "a-balance"]] as const) {
        assert.equal(byId(b, id).supportState, "CONFLICTING", `${id} in ${supersessionIds(b)}`);
        assert.ok(byId(b, id).limitations.includes("SUPERSEDED"), `${id} in ${supersessionIds(b)}`);
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

    test("BUG: an assertion that no faulty record names reads exactly as it does without them, and one that only they name reads the weaker of that and SUPERSEDED, carrying the limitation", () => {
      for (const pairs of choices()) {
        const b = supersede(rivals(), ...pairs);
        const faultyRecords = (b.supersessions ?? []).filter((s) => !wellFormed(b, s));
        const without: Bundle = { ...clone(b), supersessions: (b.supersessions ?? []).filter((s) => wellFormed(b, s)) };
        const named = new Set(faultyRecords.map((s) => s.supersededAssertionId));
        const retired = new Set((without.supersessions ?? []).map((s) => s.supersededAssertionId));
        for (const e of inspect(b).assertions) {
          const alone = inspect(without).assertions.find((x) => x.assertionId === e.assertionId) as Evaluated;
          if (!named.has(e.assertionId)) assert.deepEqual(e, alone, `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
          else if (!retired.has(e.assertionId)) {
            assert.equal(e.supportState, weaker(alone.supportState, "SUPERSEDED"), `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
            assert.ok(e.limitations.includes("SUPERSEDED"), `${e.assertionId} with ${pairs.map((p) => p.join(">")).join(" ")}`);
          }
        }
      }
    });
  });
});

/**
 * A retirement ends the standing of the assertion it names, not a disagreement that assertion was part of. a-balance (1,500,000) and a-rival (1,400,000)
 * are two readings of one block, each ESTABLISHED alone and both CONFLICTING together. Whichever one a record that can be valid retires, whatever its
 * superseding assertion carries (nothing, the other reading, a copy of its observation, weak evidence, a later block), the other is still compared with it:
 * it reads CONFLICTING, and the retired one reads SUPERSEDED and lists it, as a declared conflict leaves an assertion that is retired. Every expectation is
 * written by hand from the published contract (spec/EVIDENCE_PROFILE.md, section 8, step 3), or relates two of the engine's own answers.
 */
describe("a retirement ends the standing of what it retires, not a disagreement it was part of", () => {
  type Victim = "a-balance" | "a-rival";
  const READING: Readonly<Record<Victim, { obs: string; atomic: string }>> = { "a-balance": { obs: "obs-balance", atomic: "1500000" }, "a-rival": { obs: "obs-rival", atomic: "1400000" } };
  const BOTH: readonly Victim[] = ["a-rival", "a-balance"];
  const survivorOf = (v: Victim): Victim => (v === "a-rival" ? "a-balance" : "a-rival");
  const amount = (atomic: string): { balanceAtomic: string; decimals: string } => ({ balanceAtomic: atomic, decimals: "6" });
  const NEXT_BLOCK = balanceSubject({ blockNumber: "21000009", blockHash: `0x${"cd".repeat(31)}09` });
  const BLOCK_AFTER = balanceSubject({ blockNumber: "21000010", blockHash: `0x${"cd".repeat(31)}10` });
  interface Readiness {
    classification: string;
    criteria: { id: string; outcome: string; reason: string }[];
  }
  const readinessFor = (b: Bundle, balanceId: string): Readiness => readiness(b, "a-identity", balanceId) as Readiness;
  const withoutRecords = (b: Bundle): Bundle => ({ ...clone(b), supersessions: [] });
  /** rivals() and a successor named a-succ, of the shape `over` gives, and one record that retires `victim` with it. */
  const retiredBy = (victim: Victim, over: Partial<Assertion>, observations: Observation[] = []): Bundle => {
    const b = rivals();
    b.observations.push(...observations);
    b.assertions.push(balanceAssertion({ id: "a-succ", assertedAt: EVALUATED_AT, ...over }));
    return supersede(b, [victim, "a-succ"]);
  };

  interface Shape {
    label: string;
    victims: readonly Victim[];
    build: (victim: Victim) => Bundle;
    /** What the record makes the retired assertion read as superseded by. */
    to: string;
    /** The live assertions of the retired one's group, which it stays compared with: the survivor, and a superseding assertion of the same block. */
    group: (victim: Victim) => readonly string[];
  }
  const SHAPES: readonly Shape[] = [
    { label: "an empty successor at a later block", victims: BOTH, to: "a-succ", group: (v) => [survivorOf(v)], build: (v) => retiredBy(v, { subject: NEXT_BLOCK, observationIds: [], value: null }) },
    { label: "an empty CURRENT successor of the same block", victims: BOTH, to: "a-succ", group: (v) => [survivorOf(v)], build: (v) => retiredBy(v, { temporality: "CURRENT", observationIds: [], value: null }) },
    {
      label: "a successor of the same block that cites the survivor's own observation, which agrees with the survivor and brings nothing",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v), "a-succ"],
      build: (v) => retiredBy(v, { observationIds: [READING[survivorOf(v)].obs], value: amount(READING[survivorOf(v)].atomic) }),
    },
    { label: "a successor of the same block with a value and no source", victims: BOTH, to: "a-succ", group: (v) => [survivorOf(v), "a-succ"], build: (v) => retiredBy(v, { observationIds: [], value: amount(READING[survivorOf(v)].atomic) }) },
    {
      label: "a chain of successors that carry nothing",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v)],
      build: (v) => {
        const b = rivals();
        b.assertions.push(balanceAssertion({ id: "a-succ", subject: NEXT_BLOCK, observationIds: [], value: null, assertedAt: EVALUATED_AT }));
        b.assertions.push(balanceAssertion({ id: "a-succ-2", subject: BLOCK_AFTER, observationIds: [], value: null, assertedAt: "2026-10-23T12:00:31Z" }));
        return supersede(b, [v, "a-succ"], ["a-succ", "a-succ-2"]);
      },
    },
    {
      label: "a provider-reported successor of the same block that agrees with the survivor, whose evidence is weak",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v), "a-succ"],
      build: (v) =>
        retiredBy(v, { origin: "PROVIDER_OBSERVED", observationIds: ["obs-weak"], value: amount(READING[survivorOf(v)].atomic) }, [
          balanceObservation({ id: "obs-weak", sourceId: "src-prov-a", origin: "PROVIDER_OBSERVED", payload: amount(READING[survivorOf(v)].atomic) }),
        ]),
    },
    { label: "an evidenced successor at a later block", victims: BOTH, to: "a-newer", group: (v) => [survivorOf(v)], build: (v) => supersede(rivals(), [v, "a-newer"]) },
    {
      label: "an evidenced CURRENT successor of the same block",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v)],
      build: (v) => retiredBy(v, { temporality: "CURRENT", observationIds: ["obs-succ"], value: amount(READING[survivorOf(v)].atomic) }, [balanceObservation({ id: "obs-succ", payload: amount(READING[survivorOf(v)].atomic) })]),
    },
    {
      label: "a successor that cites the survivor's observation and a copy of it under a new id",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v), "a-succ"],
      build: (v) =>
        retiredBy(v, { observationIds: [READING[survivorOf(v)].obs, "obs-copy"], value: amount(READING[survivorOf(v)].atomic) }, [balanceObservation({ id: "obs-copy", payload: amount(READING[survivorOf(v)].atomic) })]),
    },
    {
      label: "a retired assertion whose own observations disagree, because it also cites the survivor's",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v)],
      build: (v) => {
        const b = retiredBy(v, { subject: NEXT_BLOCK, observationIds: [], value: null });
        b.assertions = b.assertions.map((a) => (a.id === v ? { ...a, observationIds: [READING[v].obs, READING[survivorOf(v)].obs] } : a));
        return b;
      },
    },
    {
      label: "a retired assertion whose own observations disagree, because it cites the survivor's first",
      victims: BOTH,
      to: "a-succ",
      group: (v) => [survivorOf(v)],
      build: (v) => {
        const b = retiredBy(v, { subject: NEXT_BLOCK, observationIds: [], value: null });
        b.assertions = b.assertions.map((a) => (a.id === v ? { ...a, observationIds: [READING[survivorOf(v)].obs, READING[v].obs] } : a));
        return b;
      },
    },
    {
      label: "three live assertions that agree, against the one retired",
      victims: ["a-balance"],
      to: "a-succ",
      group: () => ["a-rival", "a-rival-2", "a-rival-3"],
      build: (v) => {
        const b = retiredBy(v, { subject: NEXT_BLOCK, observationIds: [], value: null });
        for (const id of ["a-rival-2", "a-rival-3"]) {
          b.observations.push(balanceObservation({ id: `obs-${id}`, payload: amount("1400000") }));
          b.assertions.push(balanceAssertion({ id, observationIds: [`obs-${id}`], value: amount("1400000") }));
        }
        return b;
      },
    },
  ];

  for (const shape of SHAPES) {
    for (const victim of shape.victims) {
      const survivor = survivorOf(victim);
      describe(`${shape.label}, retiring ${victim}`, () => {
        test(`BUG: ${victim} reads SUPERSEDED and lists what it stays compared with, which reads CONFLICTING and lists it`, () => {
          const b = shape.build(victim);
          const group = [...shape.group(victim)].sort();
          const retired = byId(b, victim);
          assert.equal(retired.supportState, "SUPERSEDED");
          assert.equal(retired.supersededBy, shape.to);
          assert.deepEqual(retired.conflictsWith, group);
          assert.ok(retired.limitations.includes("SUPERSEDED"), retired.limitations.join());
          assert.ok(!retired.limitations.includes("CONFLICT_DETECTED"), "as a declared conflict leaves an assertion that is retired");
          for (const id of group) {
            const e = byId(b, id);
            assert.equal(e.supportState, "CONFLICTING", id);
            assert.deepEqual(e.conflictsWith, [victim, ...group.filter((x) => x !== id)].sort(), id);
            assert.ok(e.limitations.includes("CONFLICT_DETECTED"), `${id}: ${e.limitations.join()}`);
          }
        });

        test(`BUG: readiness over ${survivor} is NOT_ESTABLISHED, because of the conflict`, () => {
          const r = readinessFor(shape.build(victim), survivor);
          assert.equal(r.classification, "NOT_ESTABLISHED");
          const c5 = r.criteria.find((c) => c.id === "C5");
          assert.equal(c5?.outcome, "INDETERMINATE");
          assert.equal(c5?.reason, "CONFLICT_OR_SUPERSESSION");
        });

        test("CONTROL: the record is well formed and the conflict was there, so check_invariants reports what it reports without the record, and no more", () => {
          const b = shape.build(victim);
          assert.deepEqual(violations(b), violations(withoutRecords(b)));
        });

        test("CONTROL: the assertions that are not in the group read as they do without the record", () => {
          const b = shape.build(victim);
          const group = new Set([victim, ...shape.group(victim)]);
          const without = inspect(withoutRecords(b)).assertions;
          for (const e of inspect(b).assertions) {
            if (group.has(e.assertionId) || e.assertionId === shape.to) continue;
            const alone = without.find((x) => x.assertionId === e.assertionId) as Evaluated;
            assert.deepEqual({ ...e, supersededBy: null }, { ...alone, supersededBy: null }, e.assertionId);
          }
        });
      });
    }
  }

  for (const victim of BOTH) {
    const survivor = survivorOf(victim);
    test(`BUG: ${survivor} declared ESTABLISHED is INV-03, which it could not be while the conflict was hidden`, () => {
      const b = retiredBy(victim, { subject: NEXT_BLOCK, observationIds: [], value: null });
      b.assertions = b.assertions.map((a) => (a.id === survivor ? { ...a, declared: { supportState: "ESTABLISHED" as const } } : a));
      assert.deepEqual(violations(b), [`${survivor} INV-03 CONFLICT_SATISFIES_ESTABLISHED`]);
    });
  }

  describe("what ends the standing of a retired assertion and what does not end its disagreement", () => {
    test("CONTROL: both disagreeing assertions retired by one evidenced assertion leave nothing to disagree: both are SUPERSEDED and in no conflict, and the assertion that replaces them reads as if alone", () => {
      const b = supersede(rivals(), ["a-rival", "a-newer"], ["a-balance", "a-newer"]);
      for (const id of BOTH) {
        assert.equal(byId(b, id).supportState, "SUPERSEDED", id);
        assert.deepEqual(byId(b, id).conflictsWith, [], id);
      }
      assert.equal(byId(b, "a-newer").supportState, "ESTABLISHED");
      assert.deepEqual(byId(b, "a-newer").conflictsWith, []);
      assert.equal(readinessFor(b, "a-newer").classification, "CRITERIA_MET");
      assert.deepEqual(violations(b), []);
    });

    test("CONTROL: a reading with no rival, retired by a later one, is SUPERSEDED and in no conflict: the designed use", () => {
      const b = supersede(balances("a-newer"), ["a-balance", "a-newer"]);
      assert.equal(byId(b, "a-balance").supportState, "SUPERSEDED");
      assert.deepEqual(byId(b, "a-balance").conflictsWith, []);
      assert.equal(byId(b, "a-newer").supportState, "ESTABLISHED");
      assert.deepEqual(violations(b), []);
    });

    test("CONTROL: naming the live assertion as the successor is the explicit way to say that it replaces the retired one: it reads as if alone, and the retired one points at it", () => {
      const b = rivals();
      b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, assertedAt: EVALUATED_AT } : a));
      const named = supersede(b, ["a-balance", "a-rival"]);
      assert.equal(byId(named, "a-balance").supportState, "SUPERSEDED");
      assert.equal(byId(named, "a-balance").supersededBy, "a-rival");
      assert.deepEqual(byId(named, "a-balance").conflictsWith, []);
      assert.equal(byId(named, "a-rival").supportState, "ESTABLISHED");
      assert.deepEqual(byId(named, "a-rival").conflictsWith, []);
      assert.equal(readinessFor(named, "a-rival").classification, "CRITERIA_MET");
      assert.deepEqual(violations(named), []);
    });

    test("CONTROL: a successor reached through a chain of records counts as a successor: naming the live assertion at the end of the chain says the same", () => {
      const b = rivals();
      b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, assertedAt: "2026-10-23T12:00:31Z" } : a));
      const chain = supersede(b, ["a-balance", "a-newer"], ["a-newer", "a-rival"]);
      assert.equal(byId(chain, "a-rival").supportState, "ESTABLISHED", "a-rival is the end of the chain from a-balance");
      assert.deepEqual(byId(chain, "a-rival").conflictsWith, []);
      assert.deepEqual(byId(chain, "a-balance").conflictsWith, []);
    });

    test("CONTROL: a retired assertion that no observation supports dissents from nothing: its value is its own, and the live one reads as if alone", () => {
      const junk: Partial<Assertion>[] = [{ value: amount("7") }, { observationIds: [] }, { observationIds: ["obs-ghost"] }];
      for (const over of junk) {
        const b = supersede(rivals(), ["a-balance", "a-newer"]);
        b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, ...over } : a));
        assert.equal(byId(b, "a-rival").supportState, "ESTABLISHED", JSON.stringify(over));
        assert.deepEqual(byId(b, "a-rival").conflictsWith, [], JSON.stringify(over));
        assert.deepEqual(byId(b, "a-balance").conflictsWith, [], JSON.stringify(over));
      }
    });

    test("CONTROL: a live assertion with no evidence of its own is not one the retired assertion disagrees with: nothing is linked", () => {
      const bare: Partial<Assertion>[] = [{ observationIds: [], value: null }, { observationIds: [] }, { observationIds: ["obs-ghost"] }];
      for (const over of bare) {
        const b = supersede(rivals(), ["a-balance", "a-newer"]);
        b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, ...over } : a));
        assert.deepEqual(byId(b, "a-rival").conflictsWith, [], JSON.stringify(over));
        assert.deepEqual(byId(b, "a-balance").conflictsWith, [], JSON.stringify(over));
      }
    });

    test("CONTROL: live assertions that already disagree are in conflict already: the retired one is not added to it", () => {
      const b = retiredBy("a-balance", { observationIds: ["obs-balance"], value: amount("1500000") });
      // a-succ (1,500,000, citing a-balance's observation) retires a-balance and disagrees with a-rival: the live group a-rival, a-succ is in conflict
      // without the retired a-balance, which is linked to neither.
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-succ"]);
      assert.deepEqual(byId(b, "a-succ").conflictsWith, ["a-rival"]);
      assert.deepEqual(byId(b, "a-balance").conflictsWith, []);
    });

    test("CONTROL: a pair that a declared conflict already links keeps its cause, and nothing else is added to it", () => {
      const b = supersede(rivals(), ["a-rival", "a-newer"]);
      b.conflicts = [{ id: "c-1", assertionIds: ["a-balance", "a-rival"], reason: "VALUE_DISAGREEMENT" }];
      const survivor = byId(b, "a-balance");
      assert.equal(survivor.supportState, "CONFLICTING");
      assert.deepEqual(survivor.conflictsWith, ["a-rival"]);
      assert.ok(survivor.limitations.includes("CONFLICT_DECLARED"), survivor.limitations.join());
      assert.ok(!survivor.limitations.includes("CONFLICT_DETECTED"), "the declared cause is the first, and stays");
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"]);
    });

    test("CONTROL: a retired assertion that reads what the live one reads dissents from nothing: they are not in conflict", () => {
      const b = golden();
      b.observations.push(balanceObservation({ id: "obs-balance-dup" }));
      b.assertions.push(balanceAssertion({ id: "a-balance-dup", observationIds: ["obs-balance-dup"] }));
      b.assertions.push(balanceAssertion({ id: "a-next", subject: NEXT_BLOCK, observationIds: [], value: null, assertedAt: EVALUATED_AT }));
      const retired = supersede(b, ["a-balance-dup", "a-next"]);
      assert.equal(byId(retired, "a-balance-dup").supportState, "SUPERSEDED");
      assert.deepEqual(byId(retired, "a-balance-dup").conflictsWith, []);
      assert.equal(byId(retired, "a-balance").supportState, "ESTABLISHED");
      assert.deepEqual(byId(retired, "a-balance").conflictsWith, []);
    });

    test("CONTROL: a pair that a declared conflict already links leaves nothing to add: a live assertion with no evidence stays out of it", () => {
      const b = supersede(rivals(), ["a-rival", "a-newer"]);
      b.assertions.push(balanceAssertion({ id: "a-twin", observationIds: [], value: amount("1500000") }));
      b.conflicts = [{ id: "c-1", assertionIds: ["a-balance", "a-rival"], reason: "VALUE_DISAGREEMENT" }];
      assert.deepEqual(byId(b, "a-twin").conflictsWith, [], "a-twin has no evidence, and the one that has is linked already");
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"]);
    });

    test("BUG: weak evidence is evidence: a live assertion that one provider reports is still the partner of a retired one that disagrees", () => {
      const b = supersede(rivals(), ["a-balance", "a-newer"]);
      b.observations = b.observations.map((o) => (o.id === "obs-rival" ? { ...o, sourceId: "src-prov-a", origin: "PROVIDER_OBSERVED" as const } : o));
      b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, origin: "PROVIDER_OBSERVED" as const } : a));
      assert.equal(byId(b, "a-rival").supportState, "CONFLICTING");
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"]);
    });
    describe("how much evidence is evidence", () => {
      /** golden(), and two CURRENT balances of one block that disagree, the first retired by a later one: the observations are as old or as empty as `over` says. */
      const currentPair = (retiredObs: Partial<Observation>, liveObs: Partial<Observation>, retiredOver: Partial<Assertion> = {}, liveOver: Partial<Assertion> = {}): Bundle => {
        const b = golden();
        b.observations.push(balanceObservation({ id: "obs-t", payload: amount("1400000"), ...retiredObs }), balanceObservation({ id: "obs-p", payload: amount("1500000"), ...liveObs }));
        b.assertions.push(
          balanceAssertion({ id: "a-cur-t", temporality: "CURRENT", observationIds: ["obs-t"], value: amount("1400000"), ...retiredOver }),
          balanceAssertion({ id: "a-cur-p", temporality: "CURRENT", observationIds: ["obs-p"], value: amount("1500000"), ...liveOver }),
          balanceAssertion({ id: "a-cur-n", temporality: "CURRENT", subject: NEXT_BLOCK, observationIds: [], value: null, assertedAt: EVALUATED_AT }),
        );
        return supersede(b, ["a-cur-t", "a-cur-n"]);
      };
      const OLD = { observedAt: "2026-10-22T00:00:00Z" };
      const NO_RESULT = { result: "NO_RESULT" as const, payload: {} };

      test("BUG: a stale reading is still evidence: a retired one and a live one that only STALE evidence supports stay in conflict", () => {
        const b = currentPair(OLD, OLD);
        assert.equal(byId(b, "a-cur-p").supportState, "CONFLICTING");
        assert.deepEqual(byId(b, "a-cur-p").conflictsWith, ["a-cur-t"]);
        assert.deepEqual(byId(b, "a-cur-t").conflictsWith, ["a-cur-p"]);
      });

      test("CONTROL: a reading that only a NO_RESULT supports is no evidence, retired or live", () => {
        for (const [label, b] of [["retired", currentPair(NO_RESULT, OLD, { value: null })], ["live", currentPair(OLD, NO_RESULT, {}, { value: null })]] as const) {
          assert.deepEqual(byId(b, "a-cur-t").conflictsWith, [], label);
          assert.deepEqual(byId(b, "a-cur-p").conflictsWith, [], label);
        }
      });

      test("CONTROL: a live assertion whose own observations disagree has no evidence taken whole: it is not the partner", () => {
        const b = supersede(rivals(), ["a-balance", "a-newer"]);
        b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, observationIds: ["obs-rival", "obs-balance"] } : a));
        assert.deepEqual(byId(b, "a-rival").conflictsWith, []);
        assert.deepEqual(byId(b, "a-balance").conflictsWith, []);
      });

      test("CONTROL: a claim that may not be derived has no derivation to rest on: the retired one dissents from nothing", () => {
        const b = supersede(rivals(), ["a-balance", "a-newer"]);
        b.derivations.push({ id: "d-bal", ...USD_RULE, inputAssertionIds: ["a-price"], outputAssertionId: "a-balance" });
        b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, derivationId: "d-bal" } : a));
        assert.deepEqual(byId(b, "a-rival").conflictsWith, []);
      });

      test("BUG: a derived assertion with one input that resolves and one that does not has evidence of its own", () => {
        const b = golden();
        addUsd(b, "a-usd-t", ["a-balance", "a-ghost"], [...USD_LIMITATIONS]);
        addUsd(b, "a-usd-p", ["a-balance", "a-price"], [...USD_LIMITATIONS], { value: { usdScaled18: "2000200000000000000", rounding: "FLOOR_SCALED_18" } });
        addUsd(b, "a-usd-s", ["a-balance", "a-price"], [...USD_LIMITATIONS], { subject: NEXT_BLOCK, assertedAt: "2026-10-23T12:00:31Z" });
        const kept = supersede(b, ["a-usd-t", "a-usd-s"]);
        assert.deepEqual(byId(kept, "a-usd-t").conflictsWith, ["a-usd-p"]);
      });
    });
    test("BUG: a record that cannot be valid names no successor: the assertion it names is compared with the retired one like any other", () => {
      // s-1 retires a-rival with a-newer. s-2 names a-balance, which is not later than a-rival, so it is faulty and replaces nothing.
      const b = supersede(rivals(), ["a-rival", "a-newer"], ["a-rival", "a-balance"]);
      assert.ok(violations(b).includes("a-rival INV-12 SUPERSESSION_NOT_FORWARD_IN_TIME"), violations(b).join());
      assert.equal(byId(b, "a-balance").supportState, "CONFLICTING");
      assert.deepEqual(byId(b, "a-balance").conflictsWith, ["a-rival"]);
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance"]);
    });

    test("BUG: a retired assertion that cites an observation that does not exist is reported once for it, and what its other observation supports stays in conflict", () => {
      const b = supersede(rivals(), ["a-balance", "a-newer"]);
      b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: ["obs-ghost", "obs-balance"] } : a));
      assert.equal(byId(b, "a-rival").supportState, "CONFLICTING");
      assert.deepEqual(violations(b).filter((v) => v.startsWith("a-balance ")), ["a-balance INV-00 DANGLING_REFERENCE"]);
      const found = evaluateBundle(BundleSchema.parse(b), EVALUATED_AT).violations.filter((v) => v.assertionId === "a-balance");
      assert.equal(found.length, 1, "the read that finds what its observations support adds nothing of its own: " + JSON.stringify(found));
    });

    test("BUG: among live assertions the one with evidence of its own is the partner, however many without it are listed before it", () => {
      const b = supersede(rivals(), ["a-balance", "a-newer"]);
      b.assertions.unshift(balanceAssertion({ id: "a-bare", observationIds: [], value: amount("1400000") }));
      assert.equal(byId(b, "a-rival").supportState, "CONFLICTING");
      assert.deepEqual(byId(b, "a-rival").conflictsWith, ["a-balance", "a-bare"]);
      assert.deepEqual(byId(b, "a-bare").conflictsWith, ["a-balance", "a-rival"], "the group is linked with the live assertion that has no evidence too");
    });

    describe("a derived assertion", () => {
      const NEXT_USD = { subject: NEXT_BLOCK, assertedAt: "2026-10-23T12:00:31Z" };
      /** golden(), and two USD values of its block that disagree, the first retired by a later USD value of the next block. */
      const usdPair = (over: Partial<Assertion> = {}, partner: Partial<Assertion> = {}): Bundle => {
        const b = golden();
        addUsd(b, "a-usd-t", ["a-balance", "a-price"], [...USD_LIMITATIONS], over);
        addUsd(b, "a-usd-p", ["a-balance", "a-price"], [...USD_LIMITATIONS], { value: { usdScaled18: "2000200000000000000", rounding: "FLOOR_SCALED_18" }, ...partner });
        addUsd(b, "a-usd-s", ["a-balance", "a-price"], [...USD_LIMITATIONS], NEXT_USD);
        return supersede(b, ["a-usd-t", "a-usd-s"]);
      };

      test("BUG: has evidence of its own where its derivation resolves and an input does, so a retired one stays in conflict with a live one that is not its successor", () => {
        const b = usdPair();
        assert.equal(byId(b, "a-usd-t").supportState, "SUPERSEDED");
        assert.deepEqual(byId(b, "a-usd-t").conflictsWith, ["a-usd-p"]);
        assert.equal(byId(b, "a-usd-p").supportState, "CONFLICTING");
        assert.deepEqual(byId(b, "a-usd-p").conflictsWith, ["a-usd-t"]);
      });

      test("CONTROL: has none where its derivation does not resolve, does not name it as its output, or has no input that resolves: it neither dissents nor is dissented from", () => {
        for (const [label, retired, live] of [
          ["the retired one's derivation resolves to nothing", { derivationId: "d-missing" }, {}],
          ["the live one's derivation resolves to nothing", {}, { derivationId: "d-missing" }],
        ] as const) {
          const b = usdPair(retired, live);
          assert.deepEqual(byId(b, "a-usd-t").conflictsWith, [], label);
          assert.deepEqual(byId(b, "a-usd-p").conflictsWith, [], label);
        }
        for (const [label, id] of [["the retired one", "a-usd-t"], ["the live one", "a-usd-p"]] as const) {
          const b = usdPair();
          b.derivations = b.derivations.map((d) => (d.outputAssertionId === id ? { ...d, inputAssertionIds: ["a-ghost-1", "a-ghost-2"] } : d));
          assert.deepEqual(byId(b, "a-usd-t").conflictsWith, [], `inputs of ${label} resolve to nothing`);
          assert.deepEqual(byId(b, "a-usd-p").conflictsWith, [], `inputs of ${label} resolve to nothing`);
        }
        const other = usdPair();
        other.derivations = other.derivations.map((d) => (d.outputAssertionId === "a-usd-t" ? { ...d, outputAssertionId: "a-usd-p" } : d));
        assert.deepEqual(byId(other, "a-usd-t").conflictsWith, [], "a derivation that names another assertion as its output is no evidence for this one");
      });
    });

    test("BUG: a correction that retires only the wrong reading leaves the other in conflict with it, until it is retired too", () => {
      const only = retiredBy("a-rival", { observationIds: ["obs-succ"], value: amount("1500000") }, [balanceObservation({ id: "obs-succ", payload: amount("1500000") })]);
      assert.equal(byId(only, "a-balance").supportState, "CONFLICTING", "a-balance agrees with the correction but is not its successor");
      assert.deepEqual(byId(only, "a-rival").conflictsWith, ["a-balance", "a-succ"]);
      const both = supersede(only, ["a-rival", "a-succ"], ["a-balance", "a-succ"]);
      assert.equal(byId(both, "a-succ").supportState, "ESTABLISHED", "retiring both leaves one reading");
      for (const id of BOTH) assert.deepEqual(byId(both, id).conflictsWith, [], id);
      assert.equal(readinessFor(both, "a-succ").classification, "CRITERIA_MET");
    });
  });

  describe("over every successor shape, what is compared is what the contract says", () => {
    const lower = (v: unknown): string => String(v).toLowerCase();
    const groupOf = (a: Assertion): string => [a.temporality, ...["chainId", "token", "holder", "blockNumber", "blockHash"].map((k) => lower(a.subject[k]))].join("|");
    const identityOf = (a: Assertion): string => ["chainId", "token", "holder"].map((k) => lower(a.subject[k])).join("|");
    const valueOf = (a: Assertion): string => (a.value === null || a.value === undefined ? "null" : `${String(a.value["balanceAtomic"])}|${String(a.value["decimals"])}`);
    /** Written from the contract for this file's own count: whether a record is well formed. */
    const wellFormed = (b: Bundle, s: Supersession): boolean => {
      const older = b.assertions.find((a) => a.id === s.supersededAssertionId);
      const newer = b.assertions.find((a) => a.id === s.supersedingAssertionId);
      if (older === undefined || newer === undefined || older === newer || older.claimType !== newer.claimType) return false;
      return identityOf(older) === identityOf(newer) && Date.parse(newer.assertedAt) > Date.parse(older.assertedAt);
    };
    /** What an assertion's observations give it, read by the engine on a bundle with no record and no other assertion: the engine's own answer about its evidence. */
    const readAlone = (b: Bundle, a: Assertion, observationIds: readonly string[]): string => {
      const alone: Bundle = { ...clone(b), assertions: [{ ...clone(a), observationIds: [...observationIds] }], supersessions: [], conflicts: [], derivations: [] };
      return byId(alone, a.id).supportState;
    };
    const atLeastStale = (state: string): boolean => WEAKEST_FIRST.indexOf(state) >= WEAKEST_FIRST.indexOf("STALE");
    const edgesOf = (b: Bundle): string[] =>
      inspect(b).assertions
        .flatMap((e) => e.conflictsWith.map((o) => `${e.assertionId}>${o}`))
        .sort();
    /** The conflicts the contract gives: the live assertions of a group that disagree are linked, and a retired assertion that something supports stays linked with live ones that agree and are not its successors. */
    const expectedEdges = (b: Bundle): string[] => {
      const balances = b.assertions.filter((a) => a.claimType === "TOKEN_BALANCE_AT_BLOCK");
      const retired = new Set(b.supersessions?.filter((s) => wellFormed(b, s)).map((s) => s.supersededAssertionId));
      const successorsOf = (id: string): Set<string> => {
        const seen = new Set<string>();
        const todo = (b.supersessions ?? []).filter((s) => wellFormed(b, s) && s.supersededAssertionId === id).map((s) => s.supersedingAssertionId);
        for (let x = todo.pop(); x !== undefined; x = todo.pop()) {
          if (seen.has(x)) continue;
          seen.add(x);
          todo.push(...(b.supersessions ?? []).filter((s) => wellFormed(b, s) && s.supersededAssertionId === x).map((s) => s.supersedingAssertionId));
        }
        return seen;
      };
      const edges = new Set<string>();
      const clique = (ids: readonly string[]): void => {
        for (const x of ids) for (const y of ids) if (x !== y) edges.add(`${x}>${y}`);
      };
      for (const key of new Set(balances.map(groupOf))) {
        const members = balances.filter((a) => groupOf(a) === key);
        const live = members.filter((a) => !retired.has(a.id));
        if (new Set(live.map(valueOf)).size > 1) clique(live.map((a) => a.id));
        else if (live.length > 0) {
          const dissenters = members.filter(
            (t) =>
              retired.has(t.id) &&
              [...new Set(t.observationIds)].some((o) => atLeastStale(readAlone(b, t, [o]))) &&
              live.some((p) => !successorsOf(t.id).has(p.id) && valueOf(p) !== valueOf(t) && atLeastStale(readAlone(b, p, p.observationIds))),
          );
          if (dissenters.length > 0) clique([...live, ...dissenters].map((a) => a.id));
        }
      }
      return [...edges].sort();
    };

    interface Variation {
      victim: Victim;
      block: "same" | "later";
      temporality: "PINNED" | "CURRENT";
      evidence: "none" | "cites the survivor" | "fresh" | "provider" | "copy";
      value: "none" | "survivor's" | "retired's";
      records: "T>S" | "T>S and P>S" | "T>S and S>S2";
      forward: boolean;
      pill: boolean;
    }
    const worlds = (): Variation[] => {
      const out: Variation[] = [];
      for (const victim of BOTH)
        for (const block of ["same", "later"] as const)
          for (const temporality of ["PINNED", "CURRENT"] as const)
            for (const evidence of ["none", "cites the survivor", "fresh", "provider", "copy"] as const)
              for (const value of ["none", "survivor's", "retired's"] as const)
                for (const records of ["T>S", "T>S and P>S", "T>S and S>S2"] as const)
                  for (const forward of [true, false])
                    for (const pill of [false, true]) out.push({ victim, block, temporality, evidence, value, records, forward, pill });
      return out;
    };
    const build = (w: Variation): Bundle => {
      const survivor = survivorOf(w.victim);
      const b = rivals();
      const subject = w.block === "same" ? balanceSubject() : NEXT_BLOCK;
      const atomic = w.value === "none" ? null : w.value === "survivor's" ? READING[survivor].atomic : READING[w.victim].atomic;
      const observations: Observation[] = [];
      let observationIds: string[] = [];
      if (w.evidence === "cites the survivor") observationIds = [READING[survivor].obs];
      else if (w.evidence === "fresh") observationIds = ["obs-succ"];
      else if (w.evidence === "provider") observationIds = ["obs-succ"];
      else if (w.evidence === "copy") observationIds = [READING[survivor].obs, "obs-succ"];
      if (w.evidence === "fresh" || w.evidence === "copy") observations.push(balanceObservation({ id: "obs-succ", subject, payload: amount(w.evidence === "copy" ? READING[survivor].atomic : (atomic ?? "1")) }));
      if (w.evidence === "provider") observations.push(balanceObservation({ id: "obs-succ", sourceId: "src-prov-a", origin: "PROVIDER_OBSERVED", subject, payload: amount(atomic ?? "1") }));
      b.observations.push(...observations);
      b.assertions.push(
        balanceAssertion({ id: "a-succ", subject, temporality: w.temporality, observationIds, value: atomic === null ? null : amount(atomic), assertedAt: EVALUATED_AT, ...(w.evidence === "provider" ? { origin: "PROVIDER_OBSERVED" as const } : {}) }),
      );
      if (w.pill) b.assertions = b.assertions.map((a) => (a.id === w.victim ? { ...a, observationIds: [READING[w.victim].obs, READING[survivor].obs] } : a));
      const pairs: [string, string][] = [[w.victim, "a-succ"]];
      if (w.records === "T>S and P>S") pairs.push([survivor, "a-succ"]);
      if (w.records === "T>S and S>S2") {
        b.assertions.push(balanceAssertion({ id: "a-succ-2", subject: BLOCK_AFTER, observationIds: [], value: null, assertedAt: "2026-10-23T12:00:31Z" }));
        pairs.push(["a-succ", "a-succ-2"]);
      }
      const out = supersede(b, ...pairs);
      // A record asserted earlier than what it supersedes is not forward in time: a faulty record, which hides nothing and retires nothing.
      if (!w.forward) out.assertions = out.assertions.map((a) => (a.id === "a-succ" ? { ...a, assertedAt: "2026-10-23T11:00:00Z" } : a));
      return out;
    };

    test("BUG: over every combination of block, temporality, evidence, value and records of the successor, the conflicts are the contract's", () => {
      let kept = 0;
      let cleared = 0;
      for (const w of worlds()) {
        const b = build(w);
        const expected = expectedEdges(b);
        assert.deepEqual(edgesOf(b), expected, JSON.stringify(w));
        if (expected.some((e) => e.startsWith(`${w.victim}>`))) kept++;
        else cleared++;
      }
      // The population is not trivial: the retired assertion stays linked in a good many of them, and in a good many it does not.
      assert.ok(kept >= 200, `${String(kept)} worlds keep a disagreement`);
      assert.ok(cleared >= 200, `${String(cleared)} worlds do not`);
    });

    test("BUG: the answers do not depend on the order of the records or of the assertions", () => {
      for (const w of worlds().filter((x) => x.records === "T>S and S>S2" && x.forward && !x.pill && x.value !== "none" && x.temporality === "PINNED")) {
        const b = build(w);
        const answer = (x: Bundle): string => JSON.stringify([inspect(x).assertions.map((e) => [e.assertionId, e.supportState, e.limitations, e.conflictsWith, e.supersededBy]), violations(x)]);
        const first = answer(b);
        for (const x of everySupersessionOrder(b)) assert.equal(answer(x), first, `${JSON.stringify(w)} ${supersessionIds(x)}`);
        for (const x of eachListedFirst(b)) assert.equal(answer(x), first, `${JSON.stringify(w)} ${listing(x)}`);
      }
    });
  });

  describe("WallPrint", () => {
    const snapshot = (bundle: Bundle, focalAssertionId: string): ReturnType<typeof buildWallPrintSnapshot> => buildWallPrintSnapshot({ id: "rec-order", bundle: clone(bundle), evaluatedAt: EVALUATED_AT, focalAssertionId });
    const refused = (bundle: Bundle, focal: string): string[] => {
      try {
        snapshot(bundle, focal);
        return [];
      } catch (e) {
        assert.ok(e instanceof WallPrintError, String(e));
        return e.findings.map((f) => `${f.code} ${f.path}`);
      }
    };

    test("BUG: a record about the survivor carries the conflict the retirement leaves, lists the retired assertion, and replays as REPRODUCED", () => {
      for (const victim of BOTH) {
        const survivor = survivorOf(victim);
        const b = retiredBy(victim, { subject: NEXT_BLOCK, observationIds: [], value: null });
        const r = snapshot(b, survivor);
        const claim = r.claims.find((c) => c.assertionId === survivor);
        assert.equal(claim?.supportState, "CONFLICTING", victim);
        assert.deepEqual(claim?.conflictsWith, [victim], victim);
        assert.ok(claim?.limitations.includes("CONFLICT_DETECTED"), victim);
        assert.deepEqual(r.conflicts, [{ assertionIds: [survivor, victim].sort(), cause: "CONFLICT_DETECTED" }], victim);
        const retired = r.claims.find((c) => c.assertionId === victim);
        assert.equal(retired?.supportState, "SUPERSEDED", victim);
        assert.deepEqual(retired?.conflictsWith, [survivor], victim);
        const evidence = createEvidenceStore();
        evidence.put(clone(b));
        assert.equal(replayWallPrint(r, { evidence }).outcome, "REPRODUCED", victim);
      }
    });

    test("BUG: a derived claim over a reading that is in conflict is refused by the builder, whether the conflict is plain or left by a retirement: the same refusal, which is fail-closed", () => {
      const over = (b: Bundle): Bundle => {
        addUsd(b, "a-usd", ["a-balance", "a-price"], [...USD_LIMITATIONS, "CONFLICT_DETECTED"]);
        return b;
      };
      const plain = refused(over(rivals()), "a-usd");
      assert.ok(plain.length > 0, "a derived claim over a plain conflict is refused");
      assert.deepEqual(refused(over(supersede(rivals(), ["a-rival", "a-newer"])), "a-usd"), plain);
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

describe("what a supersession record does not do, which the specification and the threat model say", () => {
  const classificationIn = (b: Bundle, balanceId: string): string => (readiness(b, "a-identity", balanceId) as { classification: string }).classification;
  /** rivals(), and a later balance of the same holder and token, asserted later, with no source and no value: a successor that carries nothing. */
  const withAnEmptySuccessor = (): Bundle => {
    const b = rivals();
    b.assertions.push(balanceAssertion({ id: "a-empty", subject: balanceSubject({ blockNumber: "21000009", blockHash: `0x${"cd".repeat(31)}09` }), observationIds: [], value: null, assertedAt: EVALUATED_AT }));
    return b;
  };
  /** A balance with no source, and a USD value derived from it: each has no basis. */
  const sourceless = (): Bundle => {
    const b = golden();
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: [] } : a));
    addUsd(b, "a-usd", ["a-balance", "a-price"], [...USD_LIMITATIONS, "NO_SOURCE"]);
    return b;
  };

  test("BUG: a record that can be valid retires its target whatever its superseding assertion carries, and the disagreement it leaves stays: with no source and no value, the rival still reads CONFLICTING and readiness is not met (THREAT_MODEL.md, residual risks)", () => {
    const plain = withAnEmptySuccessor();
    assert.equal(byId(plain, "a-rival").supportState, "CONFLICTING", "without the record the two disagree");
    const kept = supersede(plain, ["a-balance", "a-empty"]);
    assert.equal(byId(kept, "a-balance").supportState, "SUPERSEDED");
    assert.equal(byId(kept, "a-empty").supportState, "NOT_ESTABLISHED");
    const rival = byId(kept, "a-rival");
    assert.equal(rival.supportState, "CONFLICTING");
    assert.deepEqual(rival.conflictsWith, ["a-balance"]);
    assert.deepEqual(violations(kept), [], "it is a conflict, which is not a violation");
    assert.equal(classificationIn(kept, "a-rival"), "NOT_ESTABLISHED");
  });

  test("BUG: nor does it matter whether the superseding assertion has evidence: one that cites the rival's own reading retires its target, and the rival is still in conflict with it", () => {
    const b = rivals();
    b.assertions.push(balanceAssertion({ id: "a-agrees", observationIds: ["obs-rival"], value: { balanceAtomic: "1400000", decimals: "6" }, assertedAt: EVALUATED_AT }));
    const kept = supersede(b, ["a-balance", "a-agrees"]);
    assert.equal(byId(kept, "a-balance").supportState, "SUPERSEDED");
    assert.equal(byId(kept, "a-rival").supportState, "CONFLICTING");
    assert.deepEqual(byId(kept, "a-rival").conflictsWith, ["a-agrees", "a-balance"], "the superseding assertion is of the same block, so the group is linked with it");
    assert.deepEqual(violations(kept), [], "it is a conflict, which is not a violation");
    assert.equal(classificationIn(kept, "a-rival"), "NOT_ESTABLISHED");
  });

  /** FAULTY_SUCCESSORS name, for a-balance: nothing, itself, another claim, a later assertion of another holder, an earlier assertion of the same claim. */
  const FAULTY_SUCCESSORS = ["a-ghost", "a-balance", "a-identity", "a-other", "a-older"] as const;

  test("BUG: a record that cannot be valid never raises what it names: an assertion with no basis stays NOT_ESTABLISHED, and so does a value derived from it, and the record is still reported", () => {
    assert.deepEqual([byId(sourceless(), "a-balance").supportState, byId(sourceless(), "a-usd").supportState], ["NOT_ESTABLISHED", "NOT_ESTABLISHED"]);
    for (const to of ["a-ghost", "a-balance", "a-identity"]) {
      const b = supersede(sourceless(), ["a-balance", to]);
      assert.deepEqual([byId(b, "a-balance").supportState, byId(b, "a-usd").supportState], ["NOT_ESTABLISHED", "NOT_ESTABLISHED"], to);
      assert.ok(byId(b, "a-balance").limitations.includes("SUPERSEDED"), `${to}: it still carries the record's limitation`);
      assert.equal(byId(b, "a-balance").supersededBy, to);
      assert.ok(violations(b).some((v) => v.startsWith("a-balance INV-12")), `${to}: the record is reported`);
    }
  });

  test("BUG: nor does it hide a conflict from its target, or from a value derived from its target: they read CONFLICTING as they do with no record", () => {
    const world = (): Bundle => {
      const b = rivals();
      addUsd(b, "a-usd", ["a-balance", "a-price"], [...USD_LIMITATIONS, "CONFLICT_DETECTED"]);
      return b;
    };
    const states = (b: Bundle): string[] => ["a-balance", "a-rival", "a-usd"].map((id) => byId(b, id).supportState);
    assert.deepEqual(states(world()), ["CONFLICTING", "CONFLICTING", "CONFLICTING"], "with no record");
    for (const to of FAULTY_SUCCESSORS) {
      const b = supersede(world(), ["a-balance", to]);
      assert.deepEqual(states(b), ["CONFLICTING", "CONFLICTING", "CONFLICTING"], to);
      const target = byId(b, "a-balance");
      assert.equal(target.supersededBy, to, to);
      assert.deepEqual(target.conflictsWith, ["a-rival"], to);
      assert.ok(target.limitations.includes("SUPERSEDED") && target.limitations.includes("CONFLICT_DETECTED"), `${to}: ${target.limitations.join()}`);
      assert.ok(byId(b, "a-usd").limitations.includes("CONFLICT_DETECTED"), `${to}: the value derived from it keeps the conflict`);
    }
  });

  test("CONTROL: it lowers an assertion that has a basis and is in no conflict to SUPERSEDED, as CNF-006 says, and a value derived from it counts it as STALE", () => {
    const healthy = (): Bundle => {
      const b = golden();
      addUsd(b, "a-usd", ["a-balance", "a-price"], [...USD_LIMITATIONS]);
      return b;
    };
    assert.deepEqual([byId(healthy(), "a-balance").supportState, byId(healthy(), "a-usd").supportState], ["ESTABLISHED", "SUPPORTED"]);
    for (const to of ["a-ghost", "a-balance", "a-identity"]) {
      const b = supersede(healthy(), ["a-balance", to]);
      assert.deepEqual([byId(b, "a-balance").supportState, byId(b, "a-usd").supportState], ["SUPERSEDED", "STALE"], to);
    }
  });

  test("BUG: readiness is no more favourable at any criterion: a balance with no basis that a record that cannot be valid names is still superseded for C5, though it no longer reads SUPERSEDED", () => {
    interface Result {
      classification: string;
      criteria: { id: string; outcome: string; reason: string }[];
    }
    const c5Of = (r: Result): (string | undefined)[] => {
      const c = r.criteria.find((x) => x.id === "C5");
      return [c?.outcome, c?.reason];
    };
    const without = readiness(sourceless(), "a-identity", "a-balance") as Result;
    assert.deepEqual(c5Of(without), ["MET", "NO_CONFLICT"], "control: with no record, nothing is superseded or in conflict");
    const named = readiness(supersede(sourceless(), ["a-balance", "a-ghost"]), "a-identity", "a-balance") as Result;
    assert.deepEqual(c5Of(named), ["INDETERMINATE", "CONFLICT_OR_SUPERSESSION"]);
    assert.equal(named.classification, "NOT_ESTABLISHED");
  });

  test("CHARACTERIZATION: a record that can be valid marks an assertion whatever state it had: one it retires with no basis reads SUPERSEDED, above NOT_ESTABLISHED in the strength order, and a value derived from it STALE", () => {
    const b = balances("a-newer");
    b.assertions = b.assertions.map((a) => (a.id === "a-balance" ? { ...a, observationIds: [] } : a));
    addUsd(b, "a-usd", ["a-balance", "a-price"], [...USD_LIMITATIONS, "NO_SOURCE"]);
    assert.deepEqual([byId(b, "a-balance").supportState, byId(b, "a-usd").supportState], ["NOT_ESTABLISHED", "NOT_ESTABLISHED"]);
    const retired = supersede(b, ["a-balance", "a-newer"]);
    assert.deepEqual([byId(retired, "a-balance").supportState, byId(retired, "a-usd").supportState], ["SUPERSEDED", "STALE"]);
  });

  test("CHARACTERIZATION: an assertion a record that cannot be valid leaves in conflict reads as it does in a visible conflict, whatever state it had, and a CONFLICTING it declared no longer exceeds that", () => {
    const declaresConflicting = (): Bundle => {
      const b = rivals();
      b.assertions = b.assertions.map((a) => (a.id === "a-rival" ? { ...a, observationIds: [], value: null, declared: { supportState: "CONFLICTING" as const } } : a));
      return b;
    };
    const reading = (b: Bundle): string[] => [byId(b, "a-rival").supportState, ...violations(b).filter((v) => v.startsWith("a-rival "))];
    const visible = declaresConflicting();
    assert.deepEqual(reading(visible), ["CONFLICTING"], "in a visible conflict a CONFLICTING it declares is what it reads");
    for (const to of ["a-ghost", "a-balance", "a-identity", "a-other"]) assert.deepEqual(reading(supersede(declaresConflicting(), ["a-balance", to])), reading(visible), to);
  });

  test("BUG: INV-12 reports a chain that comes back on itself and an assertion superseded twice, and neither stops a record that can be valid from retiring: what retires is the three faults, and what the retired one dissents from stays in conflict with it", () => {
    const cycle = supersede(rivals(), ["a-rival", "a-newer"], ["a-newer", "a-rival"]);
    assert.ok(violations(cycle).some((v) => v.includes("SUPERSESSION_CYCLE")));
    assert.equal(byId(cycle, "a-rival").supportState, "SUPERSEDED");
    assert.equal(byId(cycle, "a-balance").supportState, "CONFLICTING", "a-rival is retired by the record that can be valid, and a-balance is not its successor");
    const twice = supersede(rivals(), ["a-rival", "a-newer"], ["a-rival", "a-newer"]);
    assert.ok(violations(twice).some((v) => v.includes("SUPERSEDED_MULTIPLE_TIMES")));
    assert.equal(byId(twice, "a-balance").supportState, "CONFLICTING");
  });
});

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

  test("BUG: a price of another token or chain is a mismatch of its own, though the arithmetic gives the declared value: the rule reads a balance and a price of one token on one chain", () => {
    const elsewhere = (over: Record<string, string>): Bundle => {
      const b = golden();
      addPriceReading(b, "a-price-other", "1.0001", "PINNED");
      b.observations = b.observations.map((o) => (o.id.startsWith("obs-a-price-other") ? { ...o, subject: { ...o.subject, ...over } } : o));
      b.assertions = b.assertions.map((a) => (a.id === "a-price-other" ? { ...a, subject: { ...a.subject, ...over } } : a));
      return b;
    };
    const mismatches = (b: Bundle, inputs: readonly string[]): string[] => violations(usdOver(clone(b), inputs, USD_OF.firstBalanceFirstPrice)).filter((v) => v.endsWith("RECOMPUTATION_MISMATCH"));
    assert.deepEqual(mismatches(elsewhere({}), ["a-balance", "a-price-other"]), [], "control: the same price of the balance's own token and chain");
    for (const [label, over] of [["token", { token: `0x${"77".repeat(20)}` }], ["chain", { chainId: "10" }]] as const) {
      for (const inputs of permutations(["a-balance", "a-price-other"])) assert.deepEqual(mismatches(elsewhere(over), inputs), MISMATCH, `${label}: ${inputs.join()}`);
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

describe("what trace_provenance reports as issues follows the records it reaches", () => {
  const issuesOf = (b: Bundle, id: string): string[] => trace(b, id).issues.map((i) => `${i.code} ${i.id ?? "-"}`);
  /** USD values over each other in a ring, each with a complete set of inputs. */
  const ringOf = (...names: readonly string[]): Bundle => {
    const b = golden();
    names.forEach((id, i) => addUsd(b, id, ["a-balance", "a-price", names[(i + 1) % names.length] as string]));
    return b;
  };
  const withObservations = (b: Bundle, id: string, observationIds: readonly string[]): Bundle => ({ ...b, assertions: b.assertions.map((a) => (a.id === id ? { ...a, observationIds: [...observationIds] } : a)) });
  /** Every list in the bundle in another order, and the lists inside its records. */
  const shuffledEverywhere = (b: Bundle, rand: () => number): Bundle => {
    const moved = shuffled(b, rand);
    return {
      ...moved,
      assertions: moved.assertions.map((a) => ({ ...a, observationIds: shuffle(a.observationIds, rand) })),
      derivations: moved.derivations.map((d) => ({ ...d, inputAssertionIds: shuffle(d.inputAssertionIds, rand) })),
    };
  };

  /** What a walk from a target should report, written from the contract for this file's own count: the engine is not asked. */
  function walkedIssues(b: Bundle, target: string): string[] {
    const one = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => {
      const found = list.filter((r) => r.id === id);
      return found.length === 1 ? found[0] : undefined;
    };
    if (one(b.assertions, target) === undefined) return ["TARGET_NOT_FOUND -"];
    const edges = new Map<string, string[]>();
    // A record that resolves to nothing is told apart by its kind as well as its id: a source and an observation may share an id.
    const missing = new Set<string>();
    const miss = (kind: "assertion" | "observation" | "source" | "derivation", id: string): void => {
      missing.add(`${id}\u0000${kind}`);
    };
    const pending = [target];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const a = edges.has(id) ? undefined : one(b.assertions, id);
      if (a === undefined) continue;
      const out: string[] = [];
      edges.set(id, out);
      for (const oid of a.observationIds) {
        const o = one(b.observations, oid);
        if (o === undefined) miss("observation", oid);
        else if (one(b.sources, o.sourceId) === undefined) miss("source", o.sourceId);
      }
      if (a.derivationId !== undefined) {
        const d = one(b.derivations, a.derivationId);
        if (d === undefined) miss("derivation", a.derivationId);
        else {
          for (const dep of d.inputAssertionIds) {
            if (one(b.assertions, dep) === undefined) miss("assertion", dep);
            else out.push(dep);
          }
        }
      }
      for (const s of b.supersessions ?? []) if (s.supersedingAssertionId === id && one(b.assertions, s.supersededAssertionId) !== undefined) out.push(s.supersededAssertionId);
      pending.push(...out);
    }
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>();
      const todo = [...(edges.get(from) ?? [])];
      for (let m = todo.pop(); m !== undefined; m = todo.pop()) {
        if (seen.has(m)) continue;
        seen.add(m);
        todo.push(...(edges.get(m) ?? []));
      }
      return seen;
    };
    const reaches = new Map([...edges.keys()].map((id) => [id, reach(id)] as const));
    const cyclic = [...edges.keys()].filter((id) => reaches.get(id)?.has(id) === true);
    const smallest = new Set(cyclic.map((id) => cyclic.filter((m) => reaches.get(id)?.has(m) === true && reaches.get(m)?.has(id) === true).sort()[0] as string));
    return [...[...missing].sort().map((entry) => `DANGLING_REFERENCE ${entry.slice(0, entry.indexOf("\u0000"))}`), ...[...smallest].sort().map((id) => `DEPENDENCY_CYCLE ${id}`)];
  }

  test("CONTROL: an id that resolves to nothing is one issue", () => {
    assert.deepEqual(issuesOf(withObservations(golden(), "a-balance", ["obs-balance", "obs-missing"]), "a-balance"), ["DANGLING_REFERENCE obs-missing"]);
  });

  test("BUG: an id that several records or one list name is one issue, however many name it", () => {
    const b = withObservations(withObservations(golden(), "a-balance", ["obs-balance", "obs-gone", "obs-gone"]), "a-price", ["obs-price-a", "obs-price-b", "obs-gone"]);
    addUsd(b, "a-usd", ["a-balance", "a-price", "a-gone-input", "a-gone-input"], USD_LIMITATIONS);
    assert.deepEqual(issuesOf(b, "a-usd"), ["DANGLING_REFERENCE a-gone-input", "DANGLING_REFERENCE obs-gone"]);
  });

  test("BUG: ids that resolve to nothing come in order of code unit, not in the order they are listed or walked", () => {
    for (const listed of [["obs-z", "obs-a", "obs-m"], ["obs-m", "obs-z", "obs-a"], ["Z-obs", "a-obs"]]) {
      assert.deepEqual(issuesOf(withObservations(golden(), "a-balance", ["obs-balance", ...listed]), "a-balance"), [...listed].sort().map((id) => `DANGLING_REFERENCE ${id}`), listed.join());
    }
  });

  test("BUG: a source that resolves to nothing is reported by its id, once, whatever number of readings name it", () => {
    const b = golden();
    b.observations = b.observations.map((o) => (o.id === "obs-price-a" || o.id === "obs-price-b" ? { ...o, sourceId: "src-gone" } : o));
    assert.deepEqual(issuesOf(b, "a-price"), ["DANGLING_REFERENCE src-gone"]);
  });

  describe("a record that resolves to nothing is told apart by its kind as well as its id", () => {
    /** A source, an observation, an assertion and a derivation that resolve to nothing, spelled by this function of their kind. */
    const fourMissing = (spell: (kind: "source" | "observation" | "assertion" | "derivation") => string): Bundle => {
      const b = golden();
      b.observations.push({ ...balanceObservation({ id: "obs-y" }), sourceId: spell("source") });
      b.derivations.push({ id: "d-t", ...USD_RULE, inputAssertionIds: ["a-balance", "a-price", spell("assertion"), "a-u"], outputAssertionId: "t" });
      b.assertions.push({ ...balanceAssertion({ id: "t", observationIds: ["obs-y", spell("observation")] }), derivationId: "d-t" });
      b.assertions.push({ ...balanceAssertion({ id: "a-u", observationIds: [] }), derivationId: spell("derivation") });
      return b;
    };

    test("BUG: a source, an observation, an assertion and a derivation that resolve to nothing and are spelled alike are four issues, not one", () => {
      assert.deepEqual(issuesOf(fourMissing(() => "x"), "t"), ["DANGLING_REFERENCE x", "DANGLING_REFERENCE x", "DANGLING_REFERENCE x", "DANGLING_REFERENCE x"]);
    });

    test("BUG: the same four are four however they are spelled: the count follows the records, not whether a spelling is shared", () => {
      assert.deepEqual(issuesOf(fourMissing((kind) => `${kind}-gone`), "t"), ["assertion-gone", "derivation-gone", "observation-gone", "source-gone"].map((id) => `DANGLING_REFERENCE ${id}`));
      assert.equal(issuesOf(fourMissing((kind) => (kind === "source" || kind === "observation" ? "x" : `${kind}-gone`)), "t").length, 4);
      assert.equal(issuesOf(fourMissing((kind) => (kind === "assertion" ? "assertion-gone" : "x")), "t").length, 4);
    });

    test("CONTROL: two missing records of the same kind and id are one: the id is named by several records, and it is one record", () => {
      const b = golden();
      b.observations.push({ ...balanceObservation({ id: "obs-y" }), sourceId: "x" }, { ...balanceObservation({ id: "obs-z" }), sourceId: "x" });
      b.assertions.push(balanceAssertion({ id: "t", observationIds: ["obs-y", "obs-z"] }));
      assert.deepEqual(issuesOf(b, "t"), ["DANGLING_REFERENCE x"]);
    });
  });

  test("BUG: a dependency cycle is one issue naming its smallest id, whichever member the walk enters", () => {
    const b = ringOf("n-b", "n-a", "n-c");
    for (const target of ["n-a", "n-b", "n-c"]) assert.deepEqual(issuesOf(b, target), ["DEPENDENCY_CYCLE n-a"], target);
  });

  test("CONTROL: the issue names one member of a cycle, and every member stays in the lineage and among the PROV entities", () => {
    const b = ringOf("n-b", "n-a", "n-c");
    for (const target of ["n-a", "n-b", "n-c"]) {
      const t = trace(b, target);
      assert.deepEqual(t.lineage.filter((l) => l.kind === "assertion" && l.id.startsWith("n-")).map((l) => l.id).sort(), ["n-a", "n-b", "n-c"], target);
      for (const id of ["n-a", "n-b", "n-c"]) assert.ok(`ww:assertion/${id}` in t.prov.entity, `${id} from ${target}`);
    }
  });

  test("BUG: a claim over a cycle reports it once, however the claim lists its inputs", () => {
    for (const inputs of permutations(["a-balance", "a-price", "n-c"])) {
      const b = ringOf("n-b", "n-a", "n-c");
      addUsd(b, "x-over", inputs, USD_LIMITATIONS);
      assert.deepEqual(issuesOf(b, "x-over"), ["DEPENDENCY_CYCLE n-a"], inputs.join());
    }
  });

  test("BUG: a dense cycle is one issue, not one for each way back into it", () => {
    const names = Array.from({ length: 16 }, (_, i) => `n-${String(i).padStart(2, "0")}`);
    const b = golden();
    names.forEach((id, i) => addUsd(b, id, ["a-balance", "a-price", ...names.filter((_, j) => j !== i)]));
    for (const target of names) assert.deepEqual(issuesOf(b, target), ["DEPENDENCY_CYCLE n-00"], target);
  });

  test("BUG: two cycles are two issues, in order of their smallest ids, whichever is listed or reached first", () => {
    const b = ringOf("b-1", "b-2");
    addUsd(b, "a-1", ["a-balance", "a-price", "a-2"]);
    addUsd(b, "a-2", ["a-balance", "a-price", "a-1"]);
    for (const inputs of permutations(["a-balance", "a-price", "b-1", "a-1"])) {
      const c = clone(b);
      addUsd(c, "x-over", inputs, USD_LIMITATIONS);
      assert.deepEqual(issuesOf(c, "x-over"), ["DEPENDENCY_CYCLE a-1", "DEPENDENCY_CYCLE b-1"], inputs.join());
    }
  });

  test("CONTROL: a claim that is its own input is a cycle of one", () => {
    const b = golden();
    addUsd(b, "a-self", ["a-balance", "a-price", "a-self"]);
    assert.deepEqual(issuesOf(b, "a-self"), ["DEPENDENCY_CYCLE a-self"]);
  });

  test("BUG: a cycle made of supersessions alone is one issue naming its smallest id, whichever member the walk enters", () => {
    const b = supersede(balances("a-b2"), ["a-balance", "a-b2"], ["a-b2", "a-balance"]);
    for (const target of ["a-balance", "a-b2"]) assert.deepEqual(issuesOf(b, target), ["DEPENDENCY_CYCLE a-b2"], target);
  });

  test("CONTROL: an assertion reached two ways is no cycle", () => {
    const b = golden();
    addUsd(b, "a-usd-1", ["a-balance", "a-price"], USD_LIMITATIONS);
    addUsd(b, "a-usd-2", ["a-balance", "a-price", "a-usd-1"], USD_LIMITATIONS);
    assert.deepEqual(issuesOf(b, "a-usd-2"), []);
  });

  test("BUG: what resolves to nothing comes first and the cycles after it, each in order", () => {
    const b = ringOf("n-b", "n-a");
    addUsd(b, "x-over", ["a-balance", "a-price", "n-b", "z-gone", "a-gone"], USD_LIMITATIONS);
    assert.deepEqual(issuesOf(b, "x-over"), ["DANGLING_REFERENCE a-gone", "DANGLING_REFERENCE z-gone", "DEPENDENCY_CYCLE n-a"]);
  });

  test("BUG: a cycle is the same one whichever way its ids are spelled: the count does not follow the spelling", () => {
    for (const nameOf of [ascending, descending]) assert.equal(trace(atTheCap(nameOf, "first-listed-first"), "t").issues.length, 1, nameOf(0));
  });

  test("BUG: no listing of any record, or of a list inside one, moves an issue", () => {
    const rand = mulberry32(20261105);
    const names = Array.from({ length: 12 }, (_, i) => `n-${String(i).padStart(2, "0")}`);
    const b = golden();
    names.forEach((id, i) => addUsd(b, id, ["a-balance", "a-price", names[(i + 1) % names.length] as string, names[(i + 5) % names.length] as string, "g-gone"]));
    addUsd(b, "m-self", ["a-balance", "a-price", "m-self", "n-03"]);
    for (const target of [...names, "m-self"]) {
      const listed = issuesOf(b, target);
      // Twelve claims in one strongly connected ring (each reads the next and the fifth after), each naming a missing id; and one that reads itself and the ring.
      assert.deepEqual(listed, target === "m-self" ? ["DANGLING_REFERENCE g-gone", "DEPENDENCY_CYCLE m-self", "DEPENDENCY_CYCLE n-00"] : ["DANGLING_REFERENCE g-gone", "DEPENDENCY_CYCLE n-00"], target);
      for (let k = 0; k < 6; k++) assert.deepEqual(issuesOf(shuffledEverywhere(b, rand), target), listed, `${target} shuffled ${String(k)}`);
    }
  });

  test("BUG: over free graphs of claims, every trace reports each record that resolves to nothing once and each cycle once, however any list is ordered", () => {
    const rand = mulberry32(20261105);
    let traces = 0;
    let withCycle = 0;
    let withDangling = 0;
    /**
     * The same ids that resolve to nothing named by several records and twice in one list, so the graphs hold what the rule counts once; and
     * one spelling for the missing records of every kind (an observation, a source, an assertion, a derivation), so the graphs hold records
     * of different kinds that share an id, which the rule counts apart.
     */
    const withGhosts = (b: Bundle): Bundle => {
      const ghost = (): string => `gone-${String(Math.floor(rand() * 3))}`;
      return {
        ...b,
        observations: b.observations.map((o) => (rand() < 0.1 ? { ...o, sourceId: ghost() } : o)),
        assertions: b.assertions.map((a) => {
          const named = rand() < 0.2 ? { ...a, observationIds: [...a.observationIds, ghost(), ghost()] } : a;
          return named.derivationId === undefined && rand() < 0.1 ? { ...named, derivationId: ghost() } : named;
        }),
        derivations: b.derivations.map((d) => (rand() < 0.2 ? { ...d, inputAssertionIds: [...d.inputAssertionIds, ghost()] } : d)),
      };
    };
    for (let n = 0; n < 200; n++) {
      const b = withGhosts(randomGraph(rand));
      for (const id of [...new Set(b.assertions.map((a) => a.id)), "no-such-target"].sort()) {
        const expected = walkedIssues(b, id);
        assert.deepEqual(issuesOf(b, id), expected, `graph ${String(n)}, target ${id}: ${JSON.stringify(b)}`);
        for (let k = 0; k < 2; k++) assert.deepEqual(issuesOf(shuffledEverywhere(b, rand), id), expected, `graph ${String(n)}, target ${id}, shuffle ${String(k)}`);
        traces++;
        if (expected.some((x) => x.startsWith("DEPENDENCY_CYCLE"))) withCycle++;
        if (expected.some((x) => x.startsWith("DANGLING_REFERENCE"))) withDangling++;
      }
    }
    // The graphs are not trivial: many traces reach a cycle, and many a reference to nothing.
    assert.ok(withCycle >= 300, `${String(withCycle)} of ${String(traces)} traces reach a cycle`);
    assert.ok(withDangling >= 600, `${String(withDangling)} of ${String(traces)} traces reach an id that resolves to nothing`);
  });

  test("CONTROL: the cycle a trace reports is one the evaluation reports on every member: the two tools agree", () => {
    const b = ringOf("n-b", "n-a", "n-c");
    const onCycle = inspect(b).assertions.filter((e) => e.limitations.includes("DEPENDENCY_CYCLE")).map((e) => e.assertionId).sort();
    assert.deepEqual(onCycle, ["n-a", "n-b", "n-c"]);
    assert.ok(onCycle.includes(trace(b, "n-c").issues[0]?.id ?? ""));
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

  test("BUG: walletwall://schemas/claims says what trace_provenance reports as issues, and what a record may carry", () => {
    assert.equal(
      rules()["provenanceIssues"],
      "trace_provenance reports each record that resolves to nothing among those the assertions it walks cite, an observation they rest on, the source of an observation, the derivation they name and the assertions it takes as inputs, once, as DANGLING_REFERENCE naming its id, then each dependency cycle in the graph it walks once, as DEPENDENCY_CYCLE naming its smallest id, each in order of code unit. Two such records of different kinds that share an id are two identical entries. How many it reports follows the records it reaches, never where the walk enters them, how they are listed or how their ids are spelled. Every member of a cycle stays in lineage and in the PROV relations. WallPrint refuses a record whose trace reports more than 640, and does not truncate it.",
    );
  });

  test("BUG: walletwall://schemas/claims says what a dependency cycle reads, lifecycle included", () => {
    assert.equal(rules()["dependencyCycles"], "A derived assertion that depends on itself, directly or through others, has no basis: each assertion on the cycle reports DEPENDENCY_CYCLE, is NOT_ESTABLISHED unless a well-formed supersession or a conflict overrides that, and retains every limitation any of them reports.");
  });

  test("BUG: walletwall://schemas/claims says what overlapping supersessions read", () => {
    assert.equal(
      rules()["supersessions"],
      "An assertion that a well-formed record supersedes, once or more than once, is SUPERSEDED. supersededBy names the smallest of the other assertions its records name that resolve, otherwise the assertion itself if a record names it, otherwise the smallest id named, whichever record comes first. check_invariants reports INV-12 SUPERSEDED_MULTIPLE_TIMES for more than one record that names another assertion, SUPERSESSION_REFERENCE_INVALID for a record that names nothing or its own assertion, SUPERSESSION_CLAIM_IDENTITY_MISMATCH for one whose assertions are not about the same claim, SUPERSESSION_NOT_FORWARD_IN_TIME for one whose superseding assertion is not later, and SUPERSESSION_CYCLE for a chain that comes back on itself by any of them. Only a record that names two different assertions that resolve, of one claim identity, the superseding one asserted later, takes an assertion out of conflict detection. An assertion that only other records supersede still carries SUPERSEDED and its supersededBy and stays among those compared, and reads the weaker of what it computes, a conflict included, and SUPERSEDED, so a record that cannot be valid never raises what it names and cannot hide a conflict from it or from what is derived from it. A record that can be valid is the author's claim that the later assertion replaces the earlier, taken as made: it ends the standing of the earlier assertion, and nothing asks whether the later assertion has evidence of its own. It does not end a disagreement the earlier assertion was part of. A superseded assertion that one of its own observations supports, and that reads another value than the live assertions of its group, which agree with one another and of which one has evidence of its own and is not a successor of it, stays compared with them: all of them read CONFLICTING, with evidence or without, and it keeps reading SUPERSEDED and lists them in conflictsWith, as a declared conflict leaves it. A successor is an assertion a record that can be valid names as replacing it, directly or through a chain of records. The group is linked whole, a successor in it included, and the disagreement ends when the live assertion that is not a successor is named as one (a record that can be valid needs it asserted later) or is superseded too.",
    );
  });
});

describe("the specification says what a faulty supersession does", () => {
  const flat = (file: string): string => readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");

  test("BUG: spec/EVIDENCE_PROFILE.md says only a well-formed record takes an assertion out of conflict detection, and what a faulty one leaves", () => {
    assert.ok(
      flat("spec/EVIDENCE_PROFILE.md").includes(
        "A supersession record is well-formed when it names two different assertions that resolve, of one claim identity, the superseding one asserted later. Only a well-formed record takes an assertion out of the comparison of its group, and only it makes the assertion read `SUPERSEDED` whatever state it had: it is the author's claim that the later assertion replaces the earlier, taken as made, and nothing asks whether the later assertion has evidence of its own. It ends the standing of the earlier assertion, not a disagreement the earlier assertion was part of: a superseded assertion that one of its own observations supports (STALE or better, each of its observations read alone, so a citation added to contradict the others does not take its evidence away), and that reads another value than the live assertions of its group, which agree with one another and of which one has evidence of its own (a derived assertion has it where its derivation resolves and one of its inputs resolves) and is not a successor of it, stays compared with them. The group is linked as a group that disagrees is: all the live assertions of the group, whatever they carry, read `CONFLICTING` with `CONFLICT_DETECTED`, and the superseded one keeps reading `SUPERSEDED` and lists them in `conflictsWith`, as a declared conflict already leaves it. A pair that a declared conflict already links is left as it is. A successor is an assertion a well-formed record names as replacing it, directly or through a chain of well-formed records. The group is linked whole, a successor in it included, and the disagreement ends when the live assertion that is not a successor is named as one (a well-formed record needs it asserted later) or is superseded too (the residual risks in `THREAT_MODEL.md` say what an author can still do). An assertion that only faulty records supersede (records `check_invariants` reports as `SUPERSESSION_REFERENCE_INVALID`, `SUPERSESSION_CLAIM_IDENTITY_MISMATCH` or `SUPERSESSION_NOT_FORWARD_IN_TIME`) carries the `SUPERSEDED` limitation and its `supersededBy`, stays among those compared, and reads the weaker of what it computes, a conflict included, and `SUPERSEDED`: a record that cannot be valid never raises what it names, and hides no conflict from it or from what is derived from it. An assertion in a conflict reads `CONFLICTING` whatever state it had: a fall from any state that was a basis and, from `NOT_ESTABLISHED`, a step up the strength order of `SUPPORT_STATES.md` that is no gain in basis, after which a `CONFLICTING` the author declared no longer exceeds the computed state. No readiness answer is more favourable.",
      ),
    );
  });

  // The same sentences the published rules say, in the files a reader reads first: an assertion that only faulty records name is not "superseded"
  // in the sense of the strength order (it can read NOT_ESTABLISHED or CONFLICTING), so none of them may say a supersession or a superseded one
  // without saying which.
  test("BUG: spec/EVIDENCE_PROFILE.md says an assertion a well-formed record supersedes is SUPERSEDED, not one any record names", () => {
    assert.ok(
      flat("spec/EVIDENCE_PROFILE.md").includes(
        "Mark superseded assertions; detect declared and value-disagreement conflicts among the assertions that no well-formed supersession retires, and keep the disagreement that a retired assertion that something supports leaves. An assertion that a well-formed record supersedes, once or more than once, is `SUPERSEDED`. `supersededBy` names the smallest id, by code unit, among the other assertions its records name that resolve;",
      ),
    );
  });

  test("BUG: spec/EVIDENCE_PROFILE.md says what a dependency cycle reads, and that only a well-formed supersession or a conflict overrides it", () => {
    const text = flat("spec/EVIDENCE_PROFILE.md");
    assert.ok(text.includes("Each reads the others on it as inputs with no basis: `NOT_ESTABLISHED` unless a well-formed supersession or a conflict overrides that, with `DEPENDENCY_CYCLE`, unknown finality, and unknown freshness unless `PINNED`."));
    assert.ok(text.includes("except that its own support is `NOT_ESTABLISHED` whatever those inputs read, and a well-formed supersession and a conflict override that as they override any state."));
  });

  test("BUG: spec/AUTHORITY_MODEL.md says a derived claim on a dependency cycle is NOT_ESTABLISHED unless a well-formed supersession or a conflict overrides that", () => {
    assert.ok(flat("spec/AUTHORITY_MODEL.md").includes("on a dependency cycle, which has no basis, it is `NOT_ESTABLISHED` unless a well-formed supersession or a conflict overrides that. It inherits every dependency limitation."));
  });

  test("BUG: spec/EVIDENCE_PROFILE.md defines a conflict among the assertions no well-formed supersession retires, and names the codes INV-12 reports", () => {
    const text = flat("spec/EVIDENCE_PROFILE.md");
    assert.ok(text.includes("detected by the engine when two assertions about the same claim identity, neither retired by a well-formed supersession (section 8), carry different values. A retired assertion that something supports also stays in conflict with live assertions that agree with one another and are not its successors (section 8)."));
    assert.ok(text.includes("one whose two assertions are not about the same claim as `SUPERSESSION_CLAIM_IDENTITY_MISMATCH`, one whose superseding assertion is not later as `SUPERSESSION_NOT_FORWARD_IN_TIME`"));
  });

  test("BUG: spec/EVIDENCE_PROFILE.md says what a list inside one record moves, and what it does not, and how a derived value is recomputed", () => {
    const text = flat("spec/EVIDENCE_PROFILE.md");
    assert.ok(text.includes("A list inside one record is part of that record, and this does not cover it. It moves no state, limitation or violation, because a derived value is recomputed under every reading of its inputs, but it is what `trace_provenance` walks and what `dependencies` echo, in that order."));
    assert.ok(text.includes("A derived value that recomputation does not reproduce is reported here as `RECOMPUTATION_MISMATCH`: the rule is applied to every balance with every price among the inputs of a USD value, and to every identity with every balance among those of a readiness claim, and one reading that gives another value is a mismatch."));
  });

  test("BUG: spec/EVIDENCE_PROFILE.md says what the issues of a provenance trace are, and what they follow", () => {
    assert.ok(
      flat("spec/EVIDENCE_PROFILE.md").includes(
        "Its issues are one for each record that resolves to nothing among those the assertions it walks cite (an observation they rest on, the source of an observation, the derivation they name, the assertions that derivation takes as inputs), as `DANGLING_REFERENCE` naming its id (two of different kinds that share an id give two identical entries), then one for each cycle of the graph it walks, a set of assertions that all reach one another or one that names itself, as `DEPENDENCY_CYCLE` naming its smallest id by code unit. How many it reports follows the records it reaches, never where the walk entered them, how they are listed or how their ids are spelled. Every member of a cycle stays in `lineage` and in the PROV relations.",
      ),
    );
  });

  test("BUG: spec/WALLPRINT.md says when a bundle is refused for its provenance issues, and that a record is never truncated", () => {
    assert.ok(
      flat("spec/WALLPRINT.md").includes(
        "A record carries at most 640 provenance issues. A trace reports each record that resolves to nothing once and each cycle once, so a bundle is refused for it (`TOO_MANY` on `provenance.issues` when a record is built, `REBUILD_REFUSED` when one is replayed) only when the records that resolve to nothing, with its cycles, number more than 640: never because of how its records are listed, how its ids are spelled or how dense a cycle is. A record is never truncated to fit.",
      ),
    );
  });

  test("BUG: spec/SUPPORT_STATES.md says a faulty record still marks the assertion and does not take it out of conflict detection", () => {
    assert.ok(flat("spec/SUPPORT_STATES.md").includes("A record that can be valid marks an assertion whatever state it had: one with no basis reads `SUPERSEDED`, above `NOT_ESTABLISHED` in the strength order below. A faulty record, one that names nothing, the assertion itself, another claim or an assertion that is not later, marks it only if that lowers it, and does not take it out of conflict detection: an assertion that would otherwise read `NOT_ESTABLISHED`, `CONFLICTING` or `UNKNOWN` reads that still, and carries the `SUPERSEDED` limitation either way. A record that can be valid ends the standing of the assertion, not a disagreement it was part of: where the assertion has a reading that something supports and live assertions that agree with one another read another value, one of which has evidence of its own and is not a successor of the assertion, it keeps reading `SUPERSEDED` and lists them in `conflictsWith`, and they read `CONFLICTING` (`EVIDENCE_PROFILE.md`, section 8)."));
  });

  test("BUG: THREAT_MODEL.md says a record that fails the checks takes nothing out of conflict detection, and cites the vectors", () => {
    const text = flat("THREAT_MODEL.md");
    assert.ok(text.includes("and a record that fails them, or names nothing, takes nothing out of conflict detection and raises nothing, so it cannot hide a conflict (a record that can be valid ends the standing of what it supersedes, and a disagreement it was part of unless the live assertion is its successor or is superseded too: see the residual risks);"));
    assert.ok(text.includes("`CNF-005..009`, `CNF-013..015`, `CNF-017..048`"));
  });

  test("BUG: spec/VERSIONING.md says a change in how a bundle is read, with no schema change, is made without a version change, and names the retirement", () => {
    assert.ok(
      flat("spec/VERSIONING.md").includes(
        "During `0.x` a change to how a bundle is read, with no change to its schema, is made without changing `wwepVersion`, and is visible in the changed served text (`security/tool-manifest.json`) and in the conformance corpus. A supersession that ends the standing of an assertion but not a disagreement it was part of (`EVIDENCE_PROFILE.md`, section 8, step 3) is one: a bundle that read as settled can read as in conflict, and a WallPrint record built before it replays as `MISMATCH` rather than `REPRODUCED`, or as `UNREPLAYABLE` where a derived claim sits downstream of the conflict (the builder refuses those, as it refuses a derived claim over any conflict).",
      ),
    );
  });

  test("BUG: conformance/README.md says the conflict vectors cover the supersessions that end the standing of an assertion and not a disagreement it was part of", () => {
    assert.ok(flat("conformance/README.md").includes("supersessions that cannot be valid and cannot hide a conflict, supersessions that end the standing of an assertion and not a disagreement it was part of, overlapping supersessions in either record order"));
  });
  test("BUG: THREAT_MODEL.md names, among the residual risks, that a record that can be valid is taken as made, and what that leaves open", () => {
    assert.ok(
      flat("THREAT_MODEL.md").includes(
        "A supersession record is the author's claim that a later assertion replaces an earlier one, and the engine takes it as made: it retires the earlier assertion, and nothing asks whether the later assertion has evidence of its own. It does not end a disagreement the earlier assertion was part of: a retired assertion that something supports stays compared with live assertions that agree with one another and are not its successors, so they read `CONFLICTING` and the conflict reaches `inspect_evidence`, `assess_vault_readiness` and WallPrint (a record that main built over it replays as `MISMATCH`, or is refused where a derived claim sits downstream of the conflict, as the builder refuses a derived claim over any conflict), whatever the later assertion carries (T9). What is left is what the engine cannot see. An author can name the live assertion as the successor (if it was asserted later), which says that it replaces the retired one and shows as `supersededBy`; can supersede every assertion that disagrees; can leave a contradicting assertion, or the observation behind it, out of the bundle, or cite it only from assertions that are not live; and can supply an observation that reads as evidence, because the engine evaluates what is presented against the published policies and verifies none of it. A record that cannot be valid hides nothing (T9).",
      ),
    );
  });
});

/**
 * 64 USD values on one dense cycle, each reading the next and up to twelve before it, and a balance that supersedes the first and the
 * last. Walking in from the first used to find 690 DEPENDENCY_CYCLE issues, more than a record may carry, and from the last far fewer.
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

/** A USD value t over leaf assertions that rest on this many distinct observation ids that do not exist, 32 to a leaf: so many ids resolve to nothing. */
function flood(distinct: number, nameOf: (i: number) => string = (i) => `ghost-${String(i).padStart(4, "0")}`): Bundle {
  const b = golden();
  const leaves = Math.ceil(distinct / 32);
  const leaf = (l: number): string => `leaf-${String(l).padStart(2, "0")}`;
  for (let l = 0; l < leaves; l++) {
    b.assertions.push(balanceAssertion({ id: leaf(l), observationIds: Array.from({ length: Math.min(32, distinct - l * 32) }, (_, k) => nameOf(l * 32 + k)), assertedAt: EVALUATED_AT }));
  }
  b.derivations.push({ id: "d-t", ruleId: "wwdr.usd-value", rulesVersion: "0.1.0-draft", inputAssertionIds: Array.from({ length: leaves }, (_, l) => leaf(l)), outputAssertionId: "t" });
  b.assertions.push({ id: "t", claimType: "TOKEN_USD_VALUE", origin: "WALLETWALL_DERIVED", temporality: "PINNED", subject: balanceSubject(), value: USD_VALUE, observationIds: [], derivationId: "d-t", assertedAt: EVALUATED_AT });
  return b;
}
/** The same, with every leaf resting on the same 32 ids: many mentions of few ids. */
function sharedFlood(leaves: number): Bundle {
  const b = flood(32);
  for (let l = 1; l < leaves; l++) b.assertions.push(balanceAssertion({ id: `leaf-${String(l).padStart(2, "0")}`, observationIds: Array.from({ length: 32 }, (_, k) => `ghost-${String(k).padStart(4, "0")}`), assertedAt: EVALUATED_AT }));
  b.derivations = b.derivations.map((d) => ({ ...d, inputAssertionIds: Array.from({ length: leaves }, (_, l) => `leaf-${String(l).padStart(2, "0")}`) }));
  return b;
}
/** flood(distinct), and one more leaf resting on a real observation whose source resolves to nothing, spelled as given: one more missing record, of another kind. */
function floodWithAMissingSource(distinct: number, source: string): Bundle {
  const b = flood(distinct);
  b.observations.push({ ...balanceObservation({ id: "obs-src" }), sourceId: source });
  b.assertions.push(balanceAssertion({ id: "leaf-src", observationIds: ["obs-src"], assertedAt: EVALUATED_AT }));
  b.derivations = b.derivations.map((d) => ({ ...d, inputAssertionIds: [...d.inputAssertionIds, "leaf-src"] }));
  return b;
}

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
    const cycleOnce = [{ code: "DEPENDENCY_CYCLE", id: "n-00" }];

    test("BUG: whether a record builds follows no listing and no spelling: the dense cycle is one issue, so it builds, and replays", () => {
      for (const nameOf of [ascending, descending]) {
        for (const order of ["first-listed-first", "last-listed-first"] as const) {
          const b = atTheCap(nameOf, order);
          assert.deepEqual(trace(b, "t").issues, cycleOnce, `${nameOf(0)} ${order}`);
          assert.deepEqual(refusal(b, "t"), [], `${nameOf(0)} ${order}`);
          const evidence = createEvidenceStore();
          evidence.put(clone(b));
          assert.equal(replayWallPrint(snapshot(b, "t"), { evidence }).outcome, "REPRODUCED", `${nameOf(0)} ${order}`);
          assert.deepEqual(snapshot(b, "t").provenance.issues, cycleOnce, `${nameOf(0)} ${order}`);
        }
      }
    });

    test("BUG: a record that carries the issues an older walk counted, one per back edge, replays as MISMATCH in provenance, not as UNREPLAYABLE", () => {
      const b = atTheCap(ascending, "last-listed-first");
      assert.deepEqual(refusal(b, "t"), [], "the record builds");
      const built = snapshot(b, "t");
      const counted = Array.from({ length: 63 }, (_, i) => ({ code: "DEPENDENCY_CYCLE" as const, id: ascending(i + 1) }));
      const older = { ...wallPrintPayload(built), provenance: { ...built.provenance, issues: counted } };
      const evidence = createEvidenceStore();
      evidence.put(clone(b));
      const r = replayWallPrint(JSON.parse(JSON.stringify({ ...older, digest: wallPrintDigest(older) })), { evidence });
      assert.deepEqual([r.outcome, r.reasons, r.mismatches], ["MISMATCH", ["DIGEST_MISMATCH", "PROVENANCE_MISMATCH"], ["provenance"]]);
    });

    describe("a flood of ids that resolve to nothing is refused explicitly, never truncated, and by how many there are", () => {
      test("CONTROL: 640 distinct ids that resolve to nothing: the record builds, and carries every one", () => {
        const b = flood(640);
        assert.equal(trace(b, "t").issues.length, 640);
        assert.deepEqual(refusal(b, "t"), []);
        assert.equal(snapshot(b, "t").provenance.issues.length, 640);
      });

      test("CONTROL: 641: it is refused, with the one finding that says why, not cut to fit, and a replay of a record over such evidence says it was refused", () => {
        const b = flood(641);
        assert.equal(trace(b, "t").issues.length, 641, "the trace itself reports all of them");
        assert.deepEqual(refusal(b, "t"), ["TOO_MANY provenance.issues"]);
        // A record of the 640 that names the 641 as its evidence: its own inputs cannot be rebuilt, which replay says in one word.
        const evidence = createEvidenceStore();
        const bundleDigest = evidence.put(clone(b));
        const built = snapshot(flood(640), "t");
        const forged = { ...wallPrintPayload(built), evidence: { ...built.evidence, bundleDigest } };
        const r = replayWallPrint(JSON.parse(JSON.stringify({ ...forged, digest: wallPrintDigest(forged) })), { evidence });
        assert.deepEqual([r.outcome, r.reasons, r.recomputedDigest], ["UNREPLAYABLE", ["REBUILD_REFUSED"], null]);
      });

      test("CONTROL: the count and the refusal are the same however the ids are spelled and listed", () => {
        for (const nameOf of [(i: number) => `g-${String(i).padStart(4, "0")}`, (i: number) => `z${String(9999 - i)}`, (i: number) => `${i % 2 === 0 ? "A" : "b"}-${String(i)}`]) {
          assert.equal(trace(flood(640, nameOf), "t").issues.length, 640);
          assert.deepEqual(refusal(flood(640, nameOf), "t"), []);
          assert.deepEqual(refusal(flood(641, nameOf), "t"), ["TOO_MANY provenance.issues"]);
        }
      });

      test("BUG: nor does it follow a spelling shared across kinds: 639 missing observations and a missing source build, 640 and one are refused, whether the source is spelled like one of them or not", () => {
        for (const source of ["ghost-0000", "src-gone"]) {
          assert.equal(trace(floodWithAMissingSource(639, source), "t").issues.length, 640, source);
          assert.deepEqual(refusal(floodWithAMissingSource(639, source), "t"), [], source);
          assert.equal(trace(floodWithAMissingSource(640, source), "t").issues.length, 641, source);
          assert.deepEqual(refusal(floodWithAMissingSource(640, source), "t"), ["TOO_MANY provenance.issues"], source);
        }
      });

      test("BUG: an id named by many records counts once: 672 mentions of 32 ids is 32 issues, and the record builds", () => {
        const b = sharedFlood(21);
        assert.equal(trace(b, "t").issues.length, 32);
        assert.deepEqual(refusal(b, "t"), []);
        assert.equal(snapshot(b, "t").provenance.issues.length, 32);
      });
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
