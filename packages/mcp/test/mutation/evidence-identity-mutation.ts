import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mutation check for the evidence engine's identity, record-order and temporal rules and the adapter's timeouts. Each mutant is one realistic
 * broken implementation, applied to the real source by exact, unique text patches; the named suites must fail for it (it is
 * KILLED), and the failing test titles are printed so that a kill can be read, not assumed. The sources are restored afterwards
 * on a normal exit, a failure or an interrupt. A mutant that survives is a hole in the tests, and fails the run.
 *
 *   npm run test:evidence-identity-mutation                  every mutant
 *   npm run test:evidence-identity-mutation -- --only=9,26   just those mutants
 *
 * It rewrites files in the working tree while it runs, so it is a developer / review tool, not part of `npm test` (it is
 * not a `*.test.ts` file). RUN IT ALONE: another run, or a test run in the same tree, would see the mutants.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC = "packages/mcp/src";
const ENGINE_SUITES = ["sandbox/evidence-identity", "sandbox/reused-record-ids", "sandbox/record-order", "sandbox/conformance", "sandbox/adversarial", "sandbox/engine", "sandbox/mutation", "wallprint/identity"].map((n) => `packages/mcp/test/${n}.test.ts`);
const ADAPTER_SUITES = ["packages/mcp/test/transport/http-timeouts.test.ts"];

interface Patch {
  file: string;
  find: string;
  replace: string;
}
interface Mutant {
  id: number;
  name: string;
  patches: Patch[];
  suites: readonly string[];
}

const P = (file: string, find: string, replace: string): Patch => ({ file: `${SRC}/${file}`, find, replace });
const M = (id: number, name: string, ...patches: Patch[]): Mutant => ({ id, name, patches, suites: ENGINE_SUITES });

const INDEX_AMBIGUOUS = "  const ambiguousAssertions = takeReused(index.assertions, bundle.assertions);\n";
const READINESS_REFUSAL = "  if (reusedIdCode !== null) {\n";
const WHOLE_BUNDLE_REFUSAL = '    if (idx.reusedIdCode !== null) support = "NOT_ESTABLISHED";\n';
const READINESS_INDEX = "const { assertions: aById, reusedIdCode } = indexEvidence(bundle);";
const REUSED_CODES = '    [ambiguousAssertions.size, "DUPLICATE_ASSERTION_ID"],\n    [reusedSources.size, "DUPLICATE_SOURCE_ID"],\n    [reusedObservations.size, "DUPLICATE_OBSERVATION_ID"],\n    [reusedDerivations.size, "DUPLICATE_DERIVATION_ID"],\n';
const ADMISSION_INDEX_RULE = "    if (m.has(it.id)) {\n      dups.push({";
const TAKE_SOURCES = "  const reusedSources = takeReused(index.sources, bundle.sources);\n";
const TAKE_OBSERVATIONS = "  const reusedObservations = takeReused(index.observations, bundle.observations);\n";
const TAKE_DERIVATIONS = "  const reusedDerivations = takeReused(index.derivations, bundle.derivations);\n";
const COUNTED_SOURCES = '    [reusedSources.size, "DUPLICATE_SOURCE_ID"],\n';
const REUSED_LIST = "  const reused: readonly [number, string][] = [\n";
const SOURCE_LOOP = "  for (const s of bundle.sources) {\n";
const OBSERVATION_LOOP = "  for (const o of bundle.observations) {\n";
const SUPERSESSION_CHECKS = "  const supersededIds = new Set<string>();\n";
const USD_RECOMPUTATION = '  if (a.claimType === "TOKEN_USD_VALUE") {\n    const bal';
const INV_10 = "      if (deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {";
const DEPENDENCY_SUPERSEDED = '      if (dep.supportState === "SUPERSEDED") {\n';
const CYCLE_READ = '    core.limitations.add("DEPENDENCY_CYCLE");\n';
const READ_PINNED = '    if (a.temporality === "PINNED") core.freshness = "PINNED";\n';
const ENTER_CYCLE = "    if (onCycle(a.id)) return evalCycle(a);\n";
const READ_INPUT = "      deps.push(onSameCycle(a.id, id) ? readOnCycle(dep) : evalAssertion(dep));\n";
const CYCLE_STATE = '    core.support = onCycle(a.id) ? "NOT_ESTABLISHED" : support;\n';
const CYCLE_FRESHNESS = '      const freshness = core.freshness === "PINNED" && retained.has("OBSERVATION_FROM_FUTURE") ? "UNKNOWN_FRESHNESS" : core.freshness;\n';
const CYCLE_FINISH = "      finish(m, policy, { ...core, freshness, limitations: retained }, false);\n";
const CYCLE_RETAINED = "    const retained = new Set(members.flatMap(({ core }) => [...core.limitations]));\n";
const CLOSURE_EDGES = 'return a !== undefined && d?.outputAssertionId === a.id && getPolicy(a.claimType)?.derived === true ? d.inputAssertionIds.filter((id) => idx.assertions.has(id)) : [];';
const CLOSURE_CALL = "  const dependsOn = dependencyClosure(idx);\n";
const SAME_CYCLE = "  const onSameCycle = (a: string, b: string): boolean => dependsOn.get(a)?.has(b) === true && dependsOn.get(b)?.has(a) === true;\n";
const FINALITIES = "    const finalities = deps.map((x) => x.finalityState).filter((x): x is FinalityState => x !== null);\n";
const DEP_FRESH = "    const depFresh = deps.map((x) => x.freshnessState);\n";
const RANK = "  const rank = (superseded: string, by: string): number => (by === superseded ? 1 : idx.assertions.has(by) ? 0 : 2);\n";
const SUPERSEDED_BY = "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && by < named)) supersededBy.set(superseded, by);\n";
const SUCCESSORS = "  for (const s of bundle.supersessions ?? []) successors.set(s.supersededAssertionId, [...(successors.get(s.supersededAssertionId) ?? []), s.supersedingAssertionId]);\n";
const FOLLOW_SUCCESSORS = "    const found = (successors.get(id) ?? []).some(reachesCycle);\n";
const CYCLE_START = '    if (reachesCycle(start)) push("INV-12", "SUPERSESSION_CYCLE", start);\n';
const ENDS_CLEANLY = "    if (!found) endsCleanly.add(id);\n";
const MULTIPLE = '    if (supersededIds.has(oldA.id)) push("INV-12", "SUPERSEDED_MULTIPLE_TIMES", oldA.id);\n    supersededIds.add(oldA.id);\n';
const WALK_ORDER = "  const supersessions = [...(bundle.supersessions ?? [])].sort((x, y) => (x.supersededAssertionId < y.supersededAssertionId ? -1 : x.supersededAssertionId > y.supersededAssertionId ? 1 : 0));\n";
const SUPERSEDED_INPUT = '      if (dep.supportState === "SUPERSEDED") {\n        supports.push("STALE");\n        anyStale = true;\n        lim.add("DEPENDENCY_SUPERSEDED");\n      } else {\n        supports.push(dep.supportState);\n      }\n';
const FUTURE_FOR_PINNED = '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n';
const CONFLICT_GROUPING = "    if (retired.has(a.id)) continue;\n";
const REFERENCE_INVALID = '    if (oldA === undefined || faults.includes("SUPERSESSION_REFERENCE_INVALID")) {\n      push("INV-12", "SUPERSESSION_REFERENCE_INVALID", s.supersededAssertionId);\n      continue;\n    }\n';
/** Which records may take an assertion out of conflict detection, and what makes a record faulty; evaluation and check_invariants both read the one rule. */
const RETIRED_RULE = "  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).length === 0) retired.add(s.supersededAssertionId);\n";
const SUPERSEDED_LOOP = "  for (const { supersededAssertionId: superseded, supersedingAssertionId: by } of bundle.supersessions ?? []) {\n";
const FAULTS_CALL = "    const faults = supersessionFaults(idx, s);\n";
const TIME_RULE = '  if (Date.parse(newer.assertedAt) <= Date.parse(older.assertedAt)) faults.push("SUPERSESSION_NOT_FORWARD_IN_TIME");\n';
const FAULTY_SENTENCE = " Only a record with none of those faults takes an assertion out of conflict detection: an assertion that a faulty record supersedes still reads SUPERSEDED but stays among those compared, so a record that cannot be valid cannot hide a conflict.";
/** The retained limitations with one kind left out, for a member that did not report it itself. */
const retainedWithout = (...left: readonly string[]): Patch[] => [
  P("evaluate.ts", CYCLE_RETAINED, `    const retained = new Set(members.flatMap(({ core }) => [...core.limitations].filter((l) => ![${left.map((l) => `"${l}"`).join(", ")}].includes(l))));\n`),
  P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness, limitations: new Set([...retained, ...core.limitations]) }, false);\n"),
];
/** The engine as it was: a cycle read from wherever evaluation enters it, the first assertion on it reading the others in full. */
const ENTERED_WHEREVER = [
  P("evaluate.ts", "  const memo = new Map<string, AssertionEvaluation>();\n", "  const memo = new Map<string, AssertionEvaluation>();\n  const inProgress = new Set<string>();\n"),
  P("evaluate.ts", ENTER_CYCLE, "    if (inProgress.has(a.id)) return readOnCycle(a);\n    inProgress.add(a.id);\n"),
  P("evaluate.ts", "    return finish(a, policy, core, false);\n  };\n\n  /**\n   * A dependency cycle", "    inProgress.delete(a.id);\n    return finish(a, policy, core, false);\n  };\n\n  /**\n   * A dependency cycle"),
  P("evaluate.ts", READ_INPUT, "      deps.push(evalAssertion(dep));\n"),
  P("evaluate.ts", CYCLE_STATE, "    core.support = support;\n"),
  P("evaluate.ts", READ_PINNED, ""),
];
/** A loop over one record per id, the one that sorts last in the given direction: still a record winning, chosen by content instead of by position. */
const recordChosenByContent = (name: string, list: string, direction: 1 | -1): string => `  for (const ${name} of [...new Map([...bundle.${list}].sort((x, y) => (canonicalize(x) > canonicalize(y) ? ${String(direction)} : ${String(-direction)})).map((r) => [r.id, r])).values()]) {\n`;

/** The three other id kinds, by what the source calls them, and what the engine's references to them read. */
const OTHER_KINDS = [
  { kind: "source", first: 100, table: "sources", reused: "reusedSources", record: "Source", code: "DUPLICATE_SOURCE_ID", cited: "(id) => bundle.observations.some((o) => o.sourceId === id)", label: "SOURCE" },
  { kind: "observation", first: 120, table: "observations", reused: "reusedObservations", record: "Observation", code: "DUPLICATE_OBSERVATION_ID", cited: "(id) => bundle.assertions.some((a) => a.observationIds.includes(id))", label: "OBSERVATION" },
  { kind: "derivation", first: 140, table: "derivations", reused: "reusedDerivations", record: "Bundle[\"derivations\"][number]", code: "DUPLICATE_DERIVATION_ID", cited: "(id) => bundle.assertions.some((a) => a.derivationId === id)", label: "DERIVATION" },
] as const;

/** Fourteen broken implementations of one kind: a record wins, the refusal is half applied or miscounted, or a surface or the admission boundary reads the wrong index. */
const otherKindMutants = ({ kind, first, table, reused, record, code, cited, label }: (typeof OTHER_KINDS)[number]): Mutant[] => {
  const take = `  const ${reused} = takeReused(index.${table}, bundle.${table});\n`;
  const counted = `    [${reused}.size, "${code}"],\n`;
  const last = `for (const r of bundle.${table}) index.${table}.set(r.id, r);\n`;
  const plainIn = (surface: string): Patch => P(surface, "const idx = indexEvidence(bundle);", `const idx = { ...indexEvidence(bundle), ${table}: indexBundle(bundle).${table} };`);
  return [
    M(first, `the first record of a reused ${kind} id wins`, P("evaluate.ts", take, `  const ${reused} = new Map<string, ${record}[]>();\n`)),
    M(first + 1, `the last record of a reused ${kind} id wins`, P("evaluate.ts", take, `  const ${reused} = new Map<string, ${record}[]>();\n  ${last}`)),
    M(first + 2, `a reused ${kind} id leaves its table but does not stop the bundle`, P("evaluate.ts", counted, "")),
    M(first + 3, `a reused ${kind} id stops the bundle but the engine still reads its first record`, P("evaluate.ts", take, `  const ${reused} = takeReused(new Map(index.${table}), bundle.${table});\n`)),
    M(first + 4, `a reused ${kind} id stops the bundle but the engine still reads its last record`, P("evaluate.ts", take, `  const ${reused} = takeReused(new Map(index.${table}), bundle.${table});\n  ${last}`)),
    M(first + 5, `a reused ${kind} id stops the bundle only when something cites it`, P("evaluate.ts", counted, `    [[...${reused}.keys()].filter(${cited}).length, "${code}"],\n`)),
    M(first + 6, `provenance reads the first record of a reused ${kind} id`, plainIn("provenance.ts"), P("provenance.ts", 'import { indexEvidence } from "./evaluate.ts";', 'import { indexBundle, indexEvidence } from "./evaluate.ts";')),
    M(first + 7, `invariants read the first record of a reused ${kind} id`, plainIn("invariants.ts"), P("invariants.ts", "  indexEvidence,\n", "  indexBundle,\n  indexEvidence,\n")),
    M(first + 8, `the plain index takes a reused ${kind} id out: the correction moves what WallPrint admission reads`, P("evaluate.ts", ADMISSION_INDEX_RULE, `    if (m.has(it.id)) {\n      if (kind === "${label}") m.delete(it.id);\n      dups.push({`)),
    M(first + 9, `the plain index keeps the last record of a reused ${kind} id: the correction moves what WallPrint admission reads`, P("evaluate.ts", ADMISSION_INDEX_RULE, `    if (m.has(it.id)) {\n      if (kind === "${label}") m.set(it.id, it);\n      dups.push({`)),
    M(first + 10, `a reused ${kind} id stays readable once an assertion id is reused too`, P("evaluate.ts", take, `  const ${reused} = ambiguousAssertions.size > 0 ? new Map<string, ${record}[]>() : takeReused(index.${table}, bundle.${table});\n`)),
    M(first + 11, `identical records of a reused ${kind} id are tolerated`, P("evaluate.ts", take, `  const ${reused} = new Map([...takeReused(new Map(index.${table}), bundle.${table})].filter(([, sharing]) => new Set(sharing.map((r) => canonicalize(r))).size > 1));\n  for (const id of ${reused}.keys()) index.${table}.delete(id);\n`)),
    M(first + 12, `three records of a ${kind} id are not a reuse`, P("evaluate.ts", take, `  const ${reused} = new Map([...takeReused(new Map(index.${table}), bundle.${table})].filter(([, sharing]) => sharing.length === 2));\n  for (const id of ${reused}.keys()) index.${table}.delete(id);\n`)),
    M(first + 13, `two different reused ${kind} ids cancel out`, P("evaluate.ts", counted, `    [${reused}.size === 1 ? 1 : 0, "${code}"],\n`)),
  ];
};
const CASE_RULE = "typeof value === \"string\" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;";
const TIMED_OUT = 'const timedOut = error.code === "ERR_HTTP_REQUEST_TIMEOUT";';

const MUTANTS: readonly Mutant[] = [
  M(1, "skip the derived subject comparison", P("evaluate.ts", "    if (mismatchedKeys.size > 0) {\n", "    if ((mismatchedKeys.size as number) < 0) {\n")),
  M(2, "compare the holder case-sensitively", P("subject.ts", CASE_RULE, 'typeof value === "string" && key !== "holder" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;')),
  M(3, "compare the token address case-sensitively", P("subject.ts", CASE_RULE, 'typeof value === "string" && key !== "token" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;')),
  M(4, "the first record of a reused assertion id wins", P("evaluate.ts", INDEX_AMBIGUOUS, "  const ambiguousAssertions = new Map<string, Assertion[]>();\n")),
  M(5, "the last record of a reused assertion id wins", P("evaluate.ts", INDEX_AMBIGUOUS, "  const ambiguousAssertions = new Map<string, Assertion[]>();\n  for (const a of bundle.assertions) index.assertions.set(a.id, a);\n")),
  M(6, "a reused id is recorded by the invariant, and readiness and support stay positive", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, ""), P("readiness.ts", READINESS_REFUSAL, "  if (reusedIdCode !== null && criteria.length < 0) {\n")),
  M(7, "skip the future check when PINNED", P("evaluate.ts", "    if (newest > evalMs) {\n", '    if (a.temporality !== "PINNED" && newest > evalMs) {\n')),
  M(8, "the future check treats the evaluation instant itself as the future", P("evaluate.ts", "    if (newest > evalMs) {\n", "    if (newest >= evalMs) {\n")),
  { id: 9, name: "restore Node's default 30-second connection sweep", patches: [{ file: "scripts/claude-mcp-http.ts", find: "createHttpServer({ connectionsCheckingInterval: CONNECTIONS_CHECKING_INTERVAL_MS }, (req, res) => {", replace: "createHttpServer((req, res) => {" }], suites: ADAPTER_SUITES },
  M(10, "the shared comparison is used by evaluation but not by readiness", P("readiness.ts", 'subjectKeyEqual("token", idAddr, balToken)', "idAddr === balToken")),
  M(11, "the shared comparison is used by readiness but not by conflict detection", P("evaluate.ts", "const subjectKey = policy ? subjectIdentityKey(a.subject, policy.subjectKeys) : canonicalize(a.subject);", "const subjectKey = canonicalize(policy ? pick(a.subject, policy.subjectKeys) : a.subject);")),
  M(12, "a derived mismatch warns and flags but stays established", P("evaluate.ts", '      violations.push({ invariant: "INV-00", code: "SUBJECT_MISMATCH", assertionId: a.id });\n      return core;\n', '      violations.push({ invariant: "INV-00", code: "SUBJECT_MISMATCH", assertionId: a.id });\n')),
  M(13, "a derived mismatch fails closed but no invariant reports it", P("evaluate.ts", '      violations.push({ invariant: "INV-00", code: "SUBJECT_MISMATCH", assertionId: a.id });\n', "")),
  M(14, "only the balance dependency is compared, not every input", P("evaluate.ts", "      for (const k of dependencySubjectMismatches(a.subject, policy.subjectKeys, dep.subject, getPolicy(dep.claimType)?.subjectKeys ?? [])) mismatchedKeys.add(k);\n", '      if (dep.claimType === "TOKEN_BALANCE_AT_BLOCK") for (const k of dependencySubjectMismatches(a.subject, policy.subjectKeys, dep.subject, getPolicy(dep.claimType)?.subjectKeys ?? [])) mismatchedKeys.add(k);\n')),
  M(15, "an identity's address is not compared as the token", P("claims.ts", '    sameAs: "token",\n', "")),
  M(16, "a subject key the claim omits escapes the comparison", P("subject.ts", 'if (typeof a !== "string" || typeof b !== "string" || !subjectKeyEqual(key, a, b)) mismatched.push(key);', 'if (typeof a === "string" && typeof b === "string" && !subjectKeyEqual(key, a, b)) mismatched.push(key);')),
  M(17, "supersession identity stays exact-string", P("invariants.ts", "const identityOf = (a: Assertion): string => (pol ? subjectIdentityKey(a.subject, pol.supersessionKeys) : canonicalize(a.subject));", "const identityOf = (a: Assertion): string => canonicalize(Object.fromEntries((pol?.supersessionKeys ?? []).map((k) => [k, a.subject[k] ?? null])));")),
  M(18, "the USD rule compares the token exactly", P("invariants.ts", 'subjectKeyEqual("token", String(bal.subject["token"]), String(price.subject["token"]))', 'bal.subject["token"] === price.subject["token"]')),
  M(19, "comparison rewrites the record: the suggested subject is folded", P("readiness.ts", "    subject: subjectBase,\n", '    subject: Object.fromEntries(Object.entries(subjectBase).map(([k, v]) => [k, typeof v === "string" ? v.toLowerCase() : v])),\n')),
  M(20, "readiness C6 still reports a future PINNED input as fresh", P("readiness.ts", '!e.limitations.includes("OBSERVATION_FROM_FUTURE") && ', "")),
  M(21, "a reused id is described by record order", P("evaluate.ts", "    const ordered = [...records].sort((x, y) => {\n      const [cx, cy] = [canonicalize(x), canonicalize(y)];\n      return cx < cy ? -1 : cx > cy ? 1 : 0;\n    });\n", "    const ordered = [...records];\n")),
  M(22, "unrelated assertions stay positive next to a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, "")),
  M(23, "readiness runs its criteria next to a reused id", P("readiness.ts", READINESS_REFUSAL, "  if (reusedIdCode !== null && criteria.length < 0) {\n")),
  M(24, "every subject key folds, not only those the vocabulary marks", P("subject.ts", CASE_RULE, 'typeof value === "string" ? value.toLowerCase() : value;')),
  M(25, "the reused id itself keeps first-record support: the refused entry is not added", P("evaluate.ts", "const results = [...[...idx.assertions.values()].map(evalAssertion), ...[...idx.ambiguousAssertions.values()].map(evalAmbiguous)].sort(", "const results = [...idx.assertions.values()].map(evalAssertion).sort(")),
  { id: 26, name: "a timed-out client that never closes its side stays attached: the socket is ended, not destroyed", patches: [{ file: "scripts/claude-mcp-http.ts", find: TIMED_OUT, replace: "const timedOut = false;" }], suites: ADAPTER_SUITES },
  M(27, "the evidence index is used for WallPrint admission as well: a correction to evaluation moves historical admission", P("wallprint/record.ts", "  const idx = indexBundle(bundle);\n  const focal = idx.assertions.get(focalAssertionId);", "  const idx = indexEvidence(bundle);\n  const focal = idx.assertions.get(focalAssertionId);"), P("wallprint/record.ts", 'import { evaluateBundle, indexBundle, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";', 'import { evaluateBundle, indexBundle, indexEvidence, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";')),
  M(28, "the WallPrint builder reads the evidence index: its refusal of a reused focal id changes reason", P("wallprint/record.ts", "  const idx = indexBundle(bundle);\n  const focalAssertion = idx.assertions.get(focalAssertionId);", "  const idx = indexEvidence(bundle);\n  const focalAssertion = idx.assertions.get(focalAssertionId);"), P("wallprint/record.ts", 'import { evaluateBundle, indexBundle, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";', 'import { evaluateBundle, indexBundle, indexEvidence, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";')),
  M(29, "readiness reads the plain index: its subject and decimals come from the first record of a reused id", P("readiness.ts", READINESS_INDEX, "const { assertions: aById } = indexBundle(bundle);\n  const { reusedIdCode } = indexEvidence(bundle);"), P("readiness.ts", 'import { evaluateBundle, indexEvidence, weakest, type AssertionEvaluation, type Evaluation } from "./evaluate.ts";', 'import { evaluateBundle, indexBundle, indexEvidence, weakest, type AssertionEvaluation, type Evaluation } from "./evaluate.ts";')),
  M(30, "provenance reads the plain index: it traces the first record of a reused id", P("provenance.ts", "const idx = indexEvidence(bundle);", "const idx = indexBundle(bundle);"), P("provenance.ts", 'import { indexEvidence } from "./evaluate.ts";', 'import { indexBundle } from "./evaluate.ts";')),
  M(31, "invariants read the plain index: recomputation reads the first record of a reused id", P("invariants.ts", "const idx = indexEvidence(bundle);", "const idx = { ...indexBundle(bundle), ambiguousAssertions: new Map<string, Assertion[]>(), reusedIdCode: null };"), P("invariants.ts", "  indexEvidence,\n", "  indexBundle,\n")),
  M(32, "a derived subject is not checked against the claim contract", P("evaluate.ts", "    if (!subjectValid(a.subject, policy.subjectKeys)) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(", "    if (policy.subjectKeys.length < 0) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(")),
  M(33, "a derived claim over a future PINNED input still reports PINNED freshness", P("evaluate.ts", '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n', "    if (deps.length < 0) {\n")),
  M(34, "the future check reads only the authoritative readings", P("evaluate.ts", "    for (const o of valueObs) newest = Math.max(newest, Date.parse(o.observedAt));\n", "    for (const o of qualified.length > 0 ? qualified : valueObs) newest = Math.max(newest, Date.parse(o.observedAt));\n")),
  M(35, "a null subject value groups with a missing key", P("subject.ts", "    if (v === undefined) return canonicalize(null);\n", "    if (v === undefined || v === null) return canonicalize(null);\n")),
  M(36, "a superseded or conflicting assertion keeps its state next to a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && sup === null && conflicts.length === 0) support = "NOT_ESTABLISHED";\n')),
  M(37, "readiness stops comparing chains", P("readiness.ts", 'const sameChain = idA.subject["chainId"] === balA.subject["chainId"];', "const sameChain = true;")),
  { id: 38, name: "every client error destroys the socket: a refused request with unread bytes loses its response", patches: [{ file: "scripts/claude-mcp-http.ts", find: TIMED_OUT, replace: "const timedOut = true;" }], suites: ADAPTER_SUITES },
  { id: 40, name: "a connection already ended is left alone when it times out: a malformed request's client holds its descriptor", patches: [{ file: "scripts/claude-mcp-http.ts", find: "    } else if (timedOut) {\n      socket.destroy();\n    }\n", replace: "    }\n" }], suites: ADAPTER_SUITES },
  { id: 41, name: "a timed-out client that has stopped reading stays attached: the socket waits on a write that cannot finish", patches: [{ file: "scripts/claude-mcp-http.ts", find: "      if (timedOut && socket.writableLength > 0) socket.destroy();\n", replace: "" }], suites: ADAPTER_SUITES },
  M(39, "the future rule also takes over a CURRENT derived claim's freshness", P("evaluate.ts", '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n', '    if (deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n')),
  ...OTHER_KINDS.flatMap(otherKindMutants),
  M(42, "readiness always gives the assertion id's reason", P("readiness.ts", 'add(id, "INDETERMINATE", reusedIdCode);', 'add(id, "INDETERMINATE", "DUPLICATE_ASSERTION_ID");')),
  M(43, "the reason no longer puts the assertion id first", P("evaluate.ts", REUSED_CODES, '    [reusedSources.size, "DUPLICATE_SOURCE_ID"],\n    [ambiguousAssertions.size, "DUPLICATE_ASSERTION_ID"],\n    [reusedObservations.size, "DUPLICATE_OBSERVATION_ID"],\n    [reusedDerivations.size, "DUPLICATE_DERIVATION_ID"],\n')),
  M(44, "the reason follows another order of the three kinds", P("evaluate.ts", REUSED_CODES, '    [ambiguousAssertions.size, "DUPLICATE_ASSERTION_ID"],\n    [reusedDerivations.size, "DUPLICATE_DERIVATION_ID"],\n    [reusedObservations.size, "DUPLICATE_OBSERVATION_ID"],\n    [reusedSources.size, "DUPLICATE_SOURCE_ID"],\n')),
  M(45, "ids are one namespace across kinds: a source and an observation may not share one", P("evaluate.ts", COUNTED_SOURCES, '    [new Set([...bundle.sources, ...bundle.observations].map((r) => r.id)).size < bundle.sources.length + bundle.observations.length ? 1 : 0, "DUPLICATE_SOURCE_ID"],\n')),
  M(46, "ids compare case-insensitively: another id's spelling reads as reuse", P("evaluate.ts", "  for (const r of records) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);\n", "  for (const r of records) byId.set(r.id.toLowerCase(), [...(byId.get(r.id.toLowerCase()) ?? []), r]);\n")),
  M(47, "a conflict id is treated as a reused record id", P("evaluate.ts", COUNTED_SOURCES, '    [new Map((bundle.conflicts ?? []).map((c) => [c.id, c])).size < (bundle.conflicts ?? []).length ? 1 : reusedSources.size, "DUPLICATE_SOURCE_ID"],\n')),
  M(48, "a supersession id is treated as a reused record id", P("evaluate.ts", COUNTED_SOURCES, '    [new Map((bundle.supersessions ?? []).map((s) => [s.id, s])).size < (bundle.supersessions ?? []).length ? 1 : reusedSources.size, "DUPLICATE_SOURCE_ID"],\n')),
  M(49, "an observation stays readable once a source id is reused", P("evaluate.ts", TAKE_OBSERVATIONS, "  const reusedObservations = reusedSources.size > 0 ? new Map<string, Observation[]>() : takeReused(index.observations, bundle.observations);\n")),
  M(50, "a derivation stays readable once a source id is reused", P("evaluate.ts", TAKE_DERIVATIONS, '  const reusedDerivations = reusedSources.size > 0 ? new Map<string, Bundle["derivations"][number][]>() : takeReused(index.derivations, bundle.derivations);\n')),
  M(51, "a derivation stays readable once an observation id is reused", P("evaluate.ts", TAKE_DERIVATIONS, '  const reusedDerivations = reusedObservations.size > 0 ? new Map<string, Bundle["derivations"][number][]>() : takeReused(index.derivations, bundle.derivations);\n')),
  M(52, "a source stays readable once an observation id is reused", P("evaluate.ts", TAKE_SOURCES, "  const reusedSources = new Set(bundle.observations.map((o) => o.id)).size < bundle.observations.length ? new Map<string, Source[]>() : takeReused(index.sources, bundle.sources);\n")),
  M(53, "a source stays readable once a derivation id is reused", P("evaluate.ts", TAKE_SOURCES, "  const reusedSources = new Set(bundle.derivations.map((d) => d.id)).size < bundle.derivations.length ? new Map<string, Source[]>() : takeReused(index.sources, bundle.sources);\n")),
  M(54, "an observation stays readable once a derivation id is reused", P("evaluate.ts", TAKE_OBSERVATIONS, "  const reusedObservations = new Set(bundle.derivations.map((d) => d.id)).size < bundle.derivations.length ? new Map<string, Observation[]>() : takeReused(index.observations, bundle.observations);\n")),
  M(55, "three records of an assertion id are not a reuse", P("evaluate.ts", INDEX_AMBIGUOUS, "  const ambiguousAssertions = new Map([...takeReused(new Map(index.assertions), bundle.assertions)].filter(([, sharing]) => sharing.length === 2));\n  for (const id of ambiguousAssertions.keys()) index.assertions.delete(id);\n")),
  M(56, "UNKNOWN stays beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && support !== "UNKNOWN") support = "NOT_ESTABLISHED";\n')),
  M(57, "STALE stays beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && support !== "STALE") support = "NOT_ESTABLISHED";\n')),
  M(58, "PARTIAL stays beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && support !== "PARTIAL") support = "NOT_ESTABLISHED";\n')),
  M(59, "SUPPORTED stays beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && support !== "SUPPORTED") support = "NOT_ESTABLISHED";\n')),
  M(60, "the refusal skips a transient result: a superseded reused assertion id reads SUPERSEDED", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && !transient) support = "NOT_ESTABLISHED";\n')),
  M(61, "a superseded derived claim keeps its state beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && !(a.derivationId !== undefined && sup !== null)) support = "NOT_ESTABLISHED";\n')),
  M(62, "a conflicting derived claim keeps its state beside a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.reusedIdCode !== null && !(a.derivationId !== undefined && conflicts.length > 0)) support = "NOT_ESTABLISHED";\n')),
  M(63, "a reused id is taken out of every kind's table: a record of another kind with that id stops resolving", P("evaluate.ts", REUSED_LIST, "  for (const id of [...reusedSources.keys(), ...reusedObservations.keys(), ...reusedDerivations.keys()]) {\n    index.sources.delete(id);\n    index.observations.delete(id);\n    index.derivations.delete(id);\n    index.assertions.delete(id);\n  }\n" + REUSED_LIST)),
  M(64, "a reused assertion id also takes out a source, observation or derivation of that id", P("evaluate.ts", REUSED_LIST, "  for (const id of ambiguousAssertions.keys()) {\n    index.sources.delete(id);\n    index.observations.delete(id);\n    index.derivations.delete(id);\n  }\n" + REUSED_LIST)),
  M(65, "check_invariants stops reading the records of a reused source", P("invariants.ts", SOURCE_LOOP, "  for (const s of idx.sources.values()) {\n")),
  M(66, "check_invariants stops reading the records of a reused observation", P("invariants.ts", OBSERVATION_LOOP, "  for (const o of idx.observations.values()) {\n")),
  M(67, "check_invariants reads only the first record of a reused source: record order decides a violation", P("invariants.ts", SOURCE_LOOP, "  for (const s of indexBundle(bundle).sources.values()) {\n"), P("invariants.ts", "  indexEvidence,\n", "  indexBundle,\n  indexEvidence,\n")),
  M(68, "check_invariants reads only the first record of a reused observation: record order decides a violation", P("invariants.ts", OBSERVATION_LOOP, "  for (const o of indexBundle(bundle).observations.values()) {\n"), P("invariants.ts", "  indexEvidence,\n", "  indexBundle,\n  indexEvidence,\n")),
  M(69, "USD recomputation is skipped beside a reused id", P("invariants.ts", '  if (a.claimType === "TOKEN_USD_VALUE") {\n    const bal', '  if (a.claimType === "TOKEN_USD_VALUE" && idx.reusedIdCode === null) {\n    const bal')),
  M(70, "supersession checks are skipped beside a reused id", P("invariants.ts", "  for (const s of bundle.supersessions ?? []) {\n    const oldA", "  for (const s of idx.reusedIdCode === null ? bundle.supersessions ?? [] : []) {\n    const oldA")),
  M(71, "INV-10 is skipped beside a reused id", P("invariants.ts", "      if (deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {", "      if (idx.reusedIdCode === null && deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {")),
  M(72, "INV-11 is skipped beside a reused id", P("invariants.ts", '      if (a.claimType === "TOKEN_USD_VALUE" && !deps.some((dep) => dep.claimType === "TOKEN_USD_PRICE")) {', '      if (a.claimType === "TOKEN_USD_VALUE" && idx.reusedIdCode === null && !deps.some((dep) => dep.claimType === "TOKEN_USD_PRICE")) {')),
  M(73, "a missing readiness input hides a reused id", P("readiness.ts", READINESS_REFUSAL, "  if (reusedIdCode !== null && idEval !== undefined && balEval !== undefined) {\n")),
  M(74, "a mistyped readiness input hides a reused id", P("readiness.ts", READINESS_REFUSAL, "  if (reusedIdCode !== null && typed) {\n")),
  M(75, "readiness refuses only for inputs with the published examples' names", P("readiness.ts", READINESS_REFUSAL, '  if (reusedIdCode !== null && identityAssertionId === "a-identity") {\n')),
  M(76, "readiness drops its inputs' limitations on refusal", P("readiness.ts", "  for (const e of [idEval, balEval]) if (e) for (const l of e.limitations) limitations.add(l);\n", "  if (reusedIdCode === null) for (const e of [idEval, balEval]) if (e) for (const l of e.limitations) limitations.add(l);\n")),
  M(77, "the suggested subject is blanked on refusal", P("readiness.ts", "  const subjectBase = readinessSubject(balA);\n", "  const subjectBase = reusedIdCode !== null ? {} : readinessSubject(balA);\n")),
  M(78, "the suggested temporality changes on refusal", P("readiness.ts", '    temporality: balancePinned ? "PINNED" : "CURRENT",\n', '    temporality: balancePinned && reusedIdCode === null ? "PINNED" : "CURRENT",\n')),
  M(79, "a cycle is not reported beside a reused id", P("evaluate.ts", CYCLE_READ, '    if (idx.reusedIdCode === null) core.limitations.add("DEPENDENCY_CYCLE");\n')),
  M(80, "SUPERSEDED is not reported beside a reused id", P("evaluate.ts", '      limitations.add("SUPERSEDED");\n', '      if (idx.reusedIdCode === null) limitations.add("SUPERSEDED");\n')),
  M(81, "a conflict's limitation is not reported beside a reused id", P("evaluate.ts", '      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n', '      if (idx.reusedIdCode === null) limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n')),
  M(82, "version limitations are not reported beside a reused id", P("evaluate.ts", "    for (const l of bundleLimitations) limitations.add(l);\n", "    if (idx.reusedIdCode === null) for (const l of bundleLimitations) limitations.add(l);\n")),
  M(83, "a declared conflict stops linking beside a reused id", P("evaluate.ts", '  for (const c of bundle.conflicts ?? []) link(c.assertionIds, "CONFLICT_DECLARED");\n', '  if (idx.reusedIdCode === null) for (const c of bundle.conflicts ?? []) link(c.assertionIds, "CONFLICT_DECLARED");\n')),
  M(84, "a detected conflict stops linking beside a reused id", P("evaluate.ts", '    if (values.size > 1) link(members.map((m) => m.id), "CONFLICT_DETECTED");\n', '    if (idx.reusedIdCode === null && values.size > 1) link(members.map((m) => m.id), "CONFLICT_DETECTED");\n')),
  M(85, "nothing of an assertion's own is kept beside a reused id", P("evaluate.ts", "    const policy = getPolicy(a.claimType);\n    let core: Core;\n    if (policy === undefined) {", "    const policy = getPolicy(a.claimType);\n    let core: Core;\n    if (idx.reusedIdCode !== null) {\n      core = emptyCore(policy);\n      return finish(a, policy, core, false);\n    }\n    if (policy === undefined) {")),
  M(86, "provenance reports a reused source once per trace, whatever reads it", P("provenance.ts", '      issues.push({ code: "DANGLING_REFERENCE", id: o.sourceId });\n', '      if (!issues.some((i) => i.id === o.sourceId)) issues.push({ code: "DANGLING_REFERENCE", id: o.sourceId });\n')),
  M(87, "provenance credits the rules for a reused derivation", P("provenance.ts", '        issues.push({ code: "DANGLING_REFERENCE", id: a.derivationId });\n', '        issues.push({ code: "DANGLING_REFERENCE", id: a.derivationId });\n        if (bundle.derivations.some((x) => x.id === a.derivationId)) prov.agent[`${NS}:agent/walletwall-rules`] = { "prov:type": "ww:WalletWallRules" };\n')),
  M(88, "provenance walks the inputs of the first record of a reused derivation, without showing the activity", P("provenance.ts", '        issues.push({ code: "DANGLING_REFERENCE", id: a.derivationId });\n', '        issues.push({ code: "DANGLING_REFERENCE", id: a.derivationId });\n        for (const dep of bundle.derivations.find((x) => x.id === a.derivationId)?.inputAssertionIds ?? []) walk(dep, depth + 1);\n')),
  M(89, "provenance attributes a reading to a reused source it does not show", P("provenance.ts", '      issues.push({ code: "DANGLING_REFERENCE", id: o.sourceId });\n', '      issues.push({ code: "DANGLING_REFERENCE", id: o.sourceId });\n      if (bundle.sources.some((x) => x.id === o.sourceId)) prov.wasAttributedTo[rel("attr")] = { "prov:entity": key, "prov:agent": `${NS}:source/${o.sourceId}` };\n')),
  M(90, "the published rule stops saying a reference resolves to nothing and that identical records count", P("claims.ts", "A reused id names no record, whichever comes first and even when the records are identical: a reference to it resolves to nothing, every assertion in the bundle is NOT_ESTABLISHED, readiness is NOT_ESTABLISHED and check_invariants reports", "A reused id names no record: check_invariants reports")),
  M(91, "check_invariants invents a dangling reference whenever an id is reused", P("invariants.ts", SUPERSESSION_CHECKS, '  if (idx.reusedIdCode !== null) push("INV-00", "DANGLING_REFERENCE", null);\n' + SUPERSESSION_CHECKS)),
  M(92, "check_invariants invents a violation for every assertion beside a reused id", P("invariants.ts", "    const declared = a.declared;\n", '    if (idx.reusedIdCode !== null) push("INV-01", "NO_SOURCE_PRESENTED_AS_FACT", a.id);\n    const declared = a.declared;\n')),
  M(93, "a declared state is compared only beside a reused id", P("invariants.ts", "    if (!specificSupportFlag && declared?.supportState !== undefined && SUPPORT_RANK", "    if (idx.reusedIdCode !== null && !specificSupportFlag && declared?.supportState !== undefined && SUPPORT_RANK")),
  M(94, "readiness runs its criteria for inputs under other names, so only the reason moves", P("readiness.ts", READINESS_REFUSAL, '  if (reusedIdCode !== null && !identityAssertionId.startsWith("my-")) {\n')),
  M(95, "check_invariants reads only the canonically smallest record of a reused source", P("invariants.ts", SOURCE_LOOP, recordChosenByContent("s", "sources", -1))),
  M(96, "check_invariants reads only the canonically largest record of a reused source", P("invariants.ts", SOURCE_LOOP, recordChosenByContent("s", "sources", 1))),
  M(97, "check_invariants reads only the canonically smallest record of a reused observation", P("invariants.ts", OBSERVATION_LOOP, recordChosenByContent("o", "observations", -1))),
  M(98, "check_invariants reads only the canonically largest record of a reused observation", P("invariants.ts", OBSERVATION_LOOP, recordChosenByContent("o", "observations", 1))),
  M(99, "replay calls a refused rebuild a mismatch", P("wallprint/replay.ts", '    return unreplayable(["REBUILD_REFUSED"]);\n', '    return { outcome: "MISMATCH", reasons: ["DIGEST_MISMATCH"], recomputedDigest: null, mismatches: [] };\n')),
  M(160, "USD recomputation is skipped beside a reused source id only", P("invariants.ts", USD_RECOMPUTATION, '  if (a.claimType === "TOKEN_USD_VALUE" && idx.reusedIdCode === "DUPLICATE_SOURCE_ID") return;\n' + USD_RECOMPUTATION)),
  M(161, "INV-10 is skipped beside a reused source id only", P("invariants.ts", INV_10, '      if (idx.reusedIdCode !== "DUPLICATE_SOURCE_ID" && deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {')),
  M(162, "USD recomputation is skipped beside a reused assertion id only", P("invariants.ts", USD_RECOMPUTATION, '  if (a.claimType === "TOKEN_USD_VALUE" && idx.ambiguousAssertions.size > 0) return;\n' + USD_RECOMPUTATION)),
  M(163, "INV-10 is skipped beside a reused assertion id only", P("invariants.ts", INV_10, "      if (idx.ambiguousAssertions.size === 0 && deps.some((dep) => dep.limitations.some((l) => !declaredLimits.has(l)))) {")),
  M(164, "readiness drops its inputs' limitations beside a reused assertion id only", P("readiness.ts", "  for (const e of [idEval, balEval]) if (e) for (const l of e.limitations) limitations.add(l);\n", '  if (reusedIdCode !== "DUPLICATE_ASSERTION_ID") for (const e of [idEval, balEval]) if (e) for (const l of e.limitations) limitations.add(l);\n')),
  M(165, "provenance loses the supersession edge beside a reused assertion id only", P("provenance.ts", "      if (s.supersedingAssertionId === id && idx.assertions.has(s.supersededAssertionId)) {\n", "      if (idx.ambiguousAssertions.size === 0 && s.supersedingAssertionId === id && idx.assertions.has(s.supersededAssertionId)) {\n")),
  M(166, "beside a reused assertion id alone a derived claim keeps reading a superseded input as superseded", P("evaluate.ts", DEPENDENCY_SUPERSEDED, '      if (dep.supportState === "SUPERSEDED" || (idx.ambiguousAssertions.size > 0 && dep.supersededBy !== null)) {\n')),
  M(167, "beside a reused observation id alone a derived claim keeps reading a superseded input as superseded", P("evaluate.ts", DEPENDENCY_SUPERSEDED, '      if (dep.supportState === "SUPERSEDED" || (idx.reusedIdCode === "DUPLICATE_OBSERVATION_ID" && dep.supersededBy !== null)) {\n')),
  M(168, "beside a reused derivation id alone a derived claim keeps reading a superseded input as superseded", P("evaluate.ts", DEPENDENCY_SUPERSEDED, '      if (dep.supportState === "SUPERSEDED" || (idx.reusedIdCode === "DUPLICATE_DERIVATION_ID" && dep.supersededBy !== null)) {\n')),
  M(170, "a cycle is read from wherever evaluation enters it", ...ENTERED_WHEREVER),
  M(171, "a cycle is entered at the smallest id: record order no longer decides, the spelling of the ids does", ...ENTERED_WHEREVER, P("evaluate.ts", "const results = [...[...idx.assertions.values()].map(evalAssertion),", "const results = [...[...idx.assertions.values()].sort((x, y) => (x.id < y.id ? -1 : 1)).map(evalAssertion),")),
  M(172, "the assertions on a cycle do not retain what the others report", P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness }, false);\n")),
  M(173, "only the assertion evaluation entered retains what the others report: entry order decides", P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness, limitations: m === entry ? retained : core.limitations }, false);\n")),
  M(174, "separate cycles retain each other's limitations", P("evaluate.ts", CYCLE_RETAINED, "    const retained = new Set([...idx.assertions.values()].filter((x) => onCycle(x.id)).flatMap((x) => [...evalDerived(x, getPolicy(x.claimType) as Policy).limitations]));\n")),
  M(175, "a claim over a cycle is NOT_ESTABLISHED whatever it reads: it is treated as on the cycle", P("evaluate.ts", CYCLE_STATE, '    core.support = [a.id, ...(dependsOn.get(a.id) ?? [])].some(onCycle) ? "NOT_ESTABLISHED" : support;\n')),
  M(176, "an assertion on a cycle keeps what its inputs give: over a superseded one it is STALE, over a conflicting one CONFLICTING", P("evaluate.ts", CYCLE_STATE, "    core.support = support;\n")),
  M(177, "a PINNED assertion that retains a reading from the future still reports PINNED", P("evaluate.ts", CYCLE_FRESHNESS, "      const freshness = core.freshness;\n")),
  M(178, "an assertion on a cycle has its authority not satisfied", P("evaluate.ts", CYCLE_STATE, CYCLE_STATE + "    if (onCycle(a.id)) core.authoritySatisfied = false;\n")),
  M(179, "an assertion on a cycle has unknown freshness whatever it reads", P("evaluate.ts", CYCLE_FRESHNESS, '      const freshness = "UNKNOWN_FRESHNESS" as const;\n')),
  M(180, "an assertion on a cycle leaves the others on it out of its finality: it can read FINALIZED", P("evaluate.ts", FINALITIES, "    const finalities = deps.filter((x) => !onSameCycle(a.id, x.assertionId)).map((x) => x.finalityState).filter((x): x is FinalityState => x !== null);\n")),
  M(181, "a claim that is its own input is no cycle", P("evaluate.ts", CLOSURE_EDGES, 'return a !== undefined && d?.outputAssertionId === a.id && getPolicy(a.claimType)?.derived === true ? d.inputAssertionIds.filter((id) => idx.assertions.has(id) && id !== a.id) : [];'), P("evaluate.ts", READ_INPUT, "      deps.push(id === a.id || onSameCycle(a.id, id) ? readOnCycle(dep) : evalAssertion(dep));\n"), P("evaluate.ts", CYCLE_STATE, "    core.support = support;\n")),
  M(182, "a derivation that does not name the claim as its output makes a dependency", P("evaluate.ts", CLOSURE_EDGES, 'return a !== undefined && d !== undefined && getPolicy(a.claimType)?.derived === true ? d.inputAssertionIds.filter((id) => idx.assertions.has(id)) : [];')),
  M(183, "a claim type that may not be derived makes a dependency", P("evaluate.ts", CLOSURE_EDGES, "return a !== undefined && d?.outputAssertionId === a.id ? d.inputAssertionIds.filter((id) => idx.assertions.has(id)) : [];")),
  M(184, "an assertion on a cycle drops what it reads from outside the cycle", P("evaluate.ts", "    for (const dep of deps) for (const l of dep.limitations) lim.add(l);\n", "    for (const dep of deps) if (!onCycle(a.id) || onSameCycle(a.id, dep.assertionId)) for (const l of dep.limitations) lim.add(l);\n")),
  M(185, "supersession does not override the state of an assertion on a cycle", P("evaluate.ts", "    if (sup !== null) {\n", "    if (sup !== null && !onCycle(a.id)) {\n")),
  M(186, "a conflict does not override the state of an assertion on a cycle", P("evaluate.ts", "    } else if (conflicts.length > 0) {\n", "    } else if (conflicts.length > 0 && !onCycle(a.id)) {\n")),
  M(187, "on a cycle a conflict outranks a supersession", P("evaluate.ts", '    if (sup !== null) {\n      support = "SUPERSEDED";\n      limitations.add("SUPERSEDED");\n    } else if (conflicts.length > 0) {\n      support = "CONFLICTING";\n      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n    }\n', '    if (conflicts.length > 0 && onCycle(a.id)) {\n      support = "CONFLICTING";\n      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n    } else if (sup !== null) {\n      support = "SUPERSEDED";\n      limitations.add("SUPERSEDED");\n    } else if (conflicts.length > 0) {\n      support = "CONFLICTING";\n      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n    }\n')),
  M(188, "a claim on a cycle superseded by an id that resolves to nothing is not SUPERSEDED", P("evaluate.ts", "    if (sup !== null) {\n", "    if (sup !== null && (idx.assertions.has(sup) || !onCycle(a.id))) {\n")),
  M(189, "DEPENDENCY_SUPERSEDED is not reported on a cycle", P("evaluate.ts", '        lim.add("DEPENDENCY_SUPERSEDED");\n', '        if (!onCycle(a.id)) lim.add("DEPENDENCY_SUPERSEDED");\n')),
  M(190, "an unknown rule is not reported on a cycle", P("evaluate.ts", "    if (!(policy.ruleId === d.ruleId && ruleKnown(d.ruleId, d.rulesVersion))) {\n", "    if (!onCycle(a.id) && !(policy.ruleId === d.ruleId && ruleKnown(d.ruleId, d.rulesVersion))) {\n")),
  M(191, "a missing required input is not reported on a cycle", P("evaluate.ts", "    for (const required of policy.requiredDependencyClaimTypes) {\n", "    for (const required of onCycle(a.id) ? [] : policy.requiredDependencyClaimTypes) {\n")),
  M(192, "a subject mismatch is not reported on a cycle", P("evaluate.ts", "    if (mismatchedKeys.size > 0) {\n", "    if (mismatchedKeys.size > 0 && !onCycle(a.id)) {\n")),
  M(193, "an invalid subject is not reported on a cycle", P("evaluate.ts", "    if (!subjectValid(a.subject, policy.subjectKeys)) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(", "    if (!onCycle(a.id) && !subjectValid(a.subject, policy.subjectKeys)) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(")),
  M(194, "a dangling input is not reported on a cycle", P("evaluate.ts", '        lim.add("DANGLING_REFERENCE");\n        violations.push({ invariant: "INV-00", code: "DANGLING_REFERENCE", assertionId: a.id });\n        continue;\n', '        if (!onCycle(a.id)) {\n          lim.add("DANGLING_REFERENCE");\n          violations.push({ invariant: "INV-00", code: "DANGLING_REFERENCE", assertionId: a.id });\n        }\n        continue;\n')),
  M(195, "no assertion on a cycle says so", P("evaluate.ts", CYCLE_READ, "")),
  M(196, "what one assertion reads of another on its cycle leaves out that one's lifecycle", P("evaluate.ts", READ_PINNED + "    return finish(a, policy, core, true);\n", READ_PINNED + '    return { ...finish(a, policy, core, true), supportState: "NOT_ESTABLISHED", limitations: ["DEPENDENCY_CYCLE"] };\n')),
  M(197, "a CURRENT claim on a cycle reads a PINNED one with unknown freshness: the pinned dependency goes unreported", P("evaluate.ts", READ_PINNED, "")),
  M(198, "a claim over a cycle reads the assertion on it as the others on the cycle do", P("evaluate.ts", READ_INPUT, "      deps.push(onSameCycle(a.id, id) || onCycle(id) ? readOnCycle(dep) : evalAssertion(dep));\n")),
  M(199, "a cycle that reads another is read as one with it: the same-cycle test goes one way only", P("evaluate.ts", SAME_CYCLE, "  const onSameCycle = (a: string, b: string): boolean => dependsOn.get(a)?.has(b) === true && dependsOn.get(a)?.has(a) === true && dependsOn.get(b)?.has(b) === true;\n")),
  M(200, "retention goes one hop: each assertion retains only what those it reads report", P("evaluate.ts", CYCLE_FINISH, "      const reads = idx.derivations.get(m.derivationId as string)?.inputAssertionIds ?? [];\n      finish(m, policy, { ...core, freshness, limitations: new Set([...core.limitations, ...members.filter((x) => reads.includes(x.m.id)).flatMap((x) => [...x.core.limitations])]) }, false);\n")),
  M(201, "each assertion on a cycle also takes the others' diagnostics", P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness, limitations: retained, diagnostics: members.flatMap((x) => x.core.diagnostics) }, false);\n")),
  M(202, "retention leaves out lifecycle limitations an assertion did not read itself", ...retainedWithout("SUPERSEDED", "CONFLICT_DECLARED", "CONFLICT_DETECTED")),
  M(203, "retention leaves out freshness limitations an assertion did not read itself", ...retainedWithout("STALE_EVIDENCE", "OBSERVATION_FROM_FUTURE", "PINNED_DEPENDENCY_FOR_CURRENT_CLAIM")),
  M(204, "retention leaves out an unknown rule an assertion did not report itself", ...retainedWithout("RULES_UNKNOWN", "RULES_VERSION_MISMATCH")),
  M(205, "retention leaves out DEPENDENCY_SUPERSEDED an assertion did not report itself", ...retainedWithout("DEPENDENCY_SUPERSEDED")),
  M(206, "the closure reads the first record of a reused derivation id: a reference to nothing still makes a cycle", P("evaluate.ts", CLOSURE_CALL, "  const dependsOn = dependencyClosure({ ...idx, derivations: indexBundle(bundle).derivations });\n")),
  M(207, "the closure reads the first record of a reused assertion id: a reference to nothing still makes a cycle", P("evaluate.ts", CLOSURE_CALL, "  const dependsOn = dependencyClosure({ ...idx, assertions: indexBundle(bundle).assertions });\n")),
  M(208, "a claim over a cycle leaves the cycle out of its finality", P("evaluate.ts", FINALITIES, "    const finalities = deps.filter((x) => !onCycle(x.assertionId) || onCycle(a.id)).map((x) => x.finalityState).filter((x): x is FinalityState => x !== null);\n")),
  M(209, "a CURRENT claim over a cycle leaves the cycle out of its freshness: it can read CURRENT", P("evaluate.ts", DEP_FRESH, "    const depFresh = deps.filter((x) => !onCycle(x.assertionId) || onCycle(a.id)).map((x) => x.freshnessState);\n")),
  M(210, "a CURRENT claim over a cycle caps at PARTIAL instead of NOT_ESTABLISHED", P("evaluate.ts", "    let support = weakest(supports);\n", '    let support = a.temporality === "CURRENT" && !onCycle(a.id) ? weakest(deps.filter((x) => !onCycle(x.assertionId)).map((x) => (x.supportState === "SUPERSEDED" ? "STALE" : x.supportState)).concat(deps.some((x) => onCycle(x.assertionId)) ? ["PARTIAL"] : [])) : weakest(supports);\n')),
  M(211, "an assertion on a cycle over an input with only NO_RESULT reads UNKNOWN", P("evaluate.ts", CYCLE_STATE, '    core.support = onCycle(a.id) ? (deps.some((x) => x.supportState === "UNKNOWN") ? "UNKNOWN" : "NOT_ESTABLISHED") : support;\n')),
  M(212, "an assertion on a cycle counts corroboration as zero, not as not applying", P("evaluate.ts", CYCLE_STATE, CYCLE_STATE + "    if (onCycle(a.id)) core.corroboration = 0;\n")),
  M(213, "a claim over a cycle reports UNFINALIZED if the cycle retained NOT_FINALIZED", P("evaluate.ts", FINALITIES, '    const finalities = deps.map((x) => (!onCycle(a.id) && onCycle(x.assertionId) && x.limitations.includes("NOT_FINALIZED") ? ("UNFINALIZED" as const) : x.finalityState)).filter((x): x is FinalityState => x !== null);\n')),
  M(214, "an assertion on a cycle reports UNFINALIZED whenever anything retained says NOT_FINALIZED", P("evaluate.ts", CYCLE_FINISH, '      finish(m, policy, { ...core, freshness, limitations: retained, finality: retained.has("NOT_FINALIZED") ? "UNFINALIZED" : core.finality }, false);\n')),
  M(215, "supersededBy keeps the first record", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined) supersededBy.set(superseded, by);\n")),
  M(216, "supersededBy keeps the last record", P("evaluate.ts", SUPERSEDED_BY, "    supersededBy.set(superseded, by);\n")),
  M(217, "supersededBy names the largest id", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && by > named)) supersededBy.set(superseded, by);\n")),
  M(218, "supersededBy compares ids by locale", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && by.localeCompare(named) < 0)) supersededBy.set(superseded, by);\n")),
  M(219, "supersededBy compares ids by length first", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && (by.length < named.length || (by.length === named.length && by < named)))) supersededBy.set(superseded, by);\n")),
  M(220, "supersededBy compares ids without case", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && by.toLowerCase() < named.toLowerCase())) supersededBy.set(superseded, by);\n")),
  M(221, "supersededBy names the record with the latest effectiveAt", P("evaluate.ts", SUPERSEDED_BY, '    const when = (x: string | undefined): string => (bundle.supersessions ?? []).find((s) => s.supersededAssertionId === superseded && s.supersedingAssertionId === x)?.effectiveAt ?? "";\n    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && (when(by) > when(named) || (when(by) === when(named) && by < named)))) supersededBy.set(superseded, by);\n')),
  M(222, "supersededBy names the assertion asserted latest", P("evaluate.ts", SUPERSEDED_BY, '    const when = (x: string): string => idx.assertions.get(x)?.assertedAt ?? "";\n    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && (when(by) > when(named) || (when(by) === when(named) && by < named)))) supersededBy.set(superseded, by);\n')),
  M(223, "supersededBy prefers an assertion of the same claim type", P("evaluate.ts", RANK, "  const rank = (superseded: string, by: string): number => (by === superseded ? 2 : idx.assertions.get(by)?.claimType === idx.assertions.get(superseded)?.claimType ? 0 : idx.assertions.has(by) ? 1 : 3);\n")),
  M(224, "an id that resolves to nothing can outrank another assertion, by how it is spelled", P("evaluate.ts", RANK, "  const rank = (superseded: string, by: string): number => (by === superseded ? 1 : 0);\n")),
  M(225, "the assertion itself ranks with the others", P("evaluate.ts", RANK, "  const rank = (superseded: string, by: string): number => (by === superseded ? 0 : idx.assertions.has(by) ? 0 : 2);\n")),
  M(226, "the assertion itself ranks with an id that resolves to nothing", P("evaluate.ts", RANK, "  const rank = (superseded: string, by: string): number => (by === superseded ? 2 : idx.assertions.has(by) ? 0 : 2);\n")),
  M(227, "a supersession of itself is ignored altogether: the assertion is not SUPERSEDED", P("evaluate.ts", SUPERSEDED_BY, "    if (by === superseded) continue;\n" + SUPERSEDED_BY)),
  M(228, "a supersession naming an id that resolves to nothing is ignored altogether: the assertion is not SUPERSEDED", P("evaluate.ts", SUPERSEDED_BY, "    if (by !== superseded && !idx.assertions.has(by)) continue;\n" + SUPERSEDED_BY)),
  M(229, "a supersession cycle reads the last record of each assertion", P("invariants.ts", SUCCESSORS, "  for (const s of bundle.supersessions ?? []) successors.set(s.supersededAssertionId, [s.supersedingAssertionId]);\n")),
  M(230, "a supersession cycle reads the first record of each assertion", P("invariants.ts", SUCCESSORS, "  for (const s of bundle.supersessions ?? []) if (!successors.has(s.supersededAssertionId)) successors.set(s.supersededAssertionId, [s.supersedingAssertionId]);\n")),
  M(231, "a supersession cycle follows only the smallest successor", P("invariants.ts", FOLLOW_SUCCESSORS, "    const found = [...(successors.get(id) ?? [])].sort().slice(0, 1).some(reachesCycle);\n")),
  M(232, "a supersession cycle follows only the largest successor", P("invariants.ts", FOLLOW_SUCCESSORS, "    const found = [...(successors.get(id) ?? [])].sort().slice(-1).some(reachesCycle);\n")),
  M(233, "an assertion reached twice reads as a supersession cycle", P("invariants.ts", "    if (endsCleanly.has(id)) return false;\n", "    if (endsCleanly.has(id)) return true;\n")),
  M(234, "only an assertion on a supersession cycle is reported, not one that reaches it", P("invariants.ts", CYCLE_START, '    const seen = new Set<string>();\n    const back = (x: string): boolean => (successors.get(x) ?? []).some((y) => y === start || (!seen.has(y) && Boolean(seen.add(y)) && back(y)));\n    if (back(start)) push("INV-12", "SUPERSESSION_CYCLE", start);\n')),
  M(235, "a supersession of itself is no cycle", P("invariants.ts", FOLLOW_SUCCESSORS, "    const found = (successors.get(id) ?? []).filter((x) => x !== id).some(reachesCycle);\n")),
  M(236, "a supersession naming an id that resolves to nothing is left out of a cycle", P("invariants.ts", SUCCESSORS, "  for (const s of bundle.supersessions ?? []) if (idx.assertions.has(s.supersededAssertionId) && idx.assertions.has(s.supersedingAssertionId)) successors.set(s.supersededAssertionId, [...(successors.get(s.supersededAssertionId) ?? []), s.supersedingAssertionId]);\n")),
  M(237, "a supersession chain is followed at most four steps: a long ring is no cycle", P("invariants.ts", "  const reachesCycle = (id: string): boolean => {\n", "  let hops = 0;\n  const reachesCycle = (id: string): boolean => {\n    if (hops > 3) return false;\n"), P("invariants.ts", FOLLOW_SUCCESSORS, "    hops++;\n    const found = (successors.get(id) ?? []).some(reachesCycle);\n    hops--;\n"), P("invariants.ts", ENDS_CLEANLY, "    if (!found && hops === 0) endsCleanly.add(id);\n")),
  M(238, "the walk remembers every assertion it has been to: a second start that reaches one cycle reads clean", P("invariants.ts", ENDS_CLEANLY, "    endsCleanly.add(id);\n")),
  M(239, "a start that resolves to nothing is not reported", P("invariants.ts", CYCLE_START, '    if (idx.assertions.has(start) && reachesCycle(start)) push("INV-12", "SUPERSESSION_CYCLE", start);\n')),
  M(240, "one report per cycle, at the smallest id", P("invariants.ts", "  for (const start of successors.keys()) {\n" + CYCLE_START + "  }\n", '  const flagged = [...successors.keys()].filter((s) => reachesCycle(s)).sort();\n  if (flagged[0] !== undefined) push("INV-12", "SUPERSESSION_CYCLE", flagged[0]);\n')),
  M(241, "SUPERSEDED_MULTIPLE_TIMES counts every record, valid or not", P("invariants.ts", SUPERSESSION_CHECKS, SUPERSESSION_CHECKS + '  const named = new Set<string>();\n  for (const s of bundle.supersessions ?? []) {\n    if (named.has(s.supersededAssertionId)) push("INV-12", "SUPERSEDED_MULTIPLE_TIMES", s.supersededAssertionId);\n    named.add(s.supersededAssertionId);\n  }\n')),
  M(242, "the same pair twice is not superseded more than once", P("invariants.ts", MULTIPLE, '    if (supersededIds.has(oldA.id) && (bundle.supersessions ?? []).filter((x) => x.supersededAssertionId === oldA.id).some((x) => x.supersedingAssertionId !== newA.id)) push("INV-12", "SUPERSEDED_MULTIPLE_TIMES", oldA.id);\n    supersededIds.add(oldA.id);\n')),
  M(243, "what one assertion supersedes is walked as listed", P("provenance.ts", WALK_ORDER, "  const supersessions = [...(bundle.supersessions ?? [])];\n")),
  M(244, "what one assertion supersedes is walked in reverse id order", P("provenance.ts", WALK_ORDER, "  const supersessions = [...(bundle.supersessions ?? [])].sort((x, y) => (x.supersededAssertionId < y.supersededAssertionId ? 1 : x.supersededAssertionId > y.supersededAssertionId ? -1 : 0));\n")),
  M(245, "what one assertion supersedes is walked by locale", P("provenance.ts", WALK_ORDER, "  const supersessions = [...(bundle.supersessions ?? [])].sort((x, y) => x.supersededAssertionId.localeCompare(y.supersededAssertionId));\n")),
  M(246, "what one assertion supersedes is sorted by the superseding id: those of one assertion stay as listed", P("provenance.ts", WALK_ORDER, "  const supersessions = [...(bundle.supersessions ?? [])].sort((x, y) => (x.supersedingAssertionId < y.supersedingAssertionId ? -1 : x.supersedingAssertionId > y.supersedingAssertionId ? 1 : 0));\n")),
  M(247, "provenance also walks a derivation's inputs in id order: every derived trace moves", P("provenance.ts", "        for (const dep of d.inputAssertionIds) {\n", "        for (const dep of [...d.inputAssertionIds].sort()) {\n")),
  M(248, "provenance also walks an assertion's observations in id order", P("provenance.ts", "    for (const oid of a.observationIds) {\n", "    for (const oid of [...a.observationIds].sort()) {\n")),
  M(249, "lineage reports the shortest depth of each assertion, not the walk's", P("provenance.ts", "  walk(assertionId, 0);\n  return { target: assertionId, lineage, prov, issues };\n", "  walk(assertionId, 0);\n  const best = new Map<string, number>();\n  const visit = (id: string, depth: number): void => {\n    if ((best.get(id) ?? Infinity) <= depth) return;\n    best.set(id, depth);\n    const a = idx.assertions.get(id);\n    if (a === undefined) return;\n    const d = a.derivationId === undefined ? undefined : idx.derivations.get(a.derivationId);\n    for (const dep of d?.inputAssertionIds ?? []) visit(dep, depth + 1);\n    for (const s of supersessions) if (s.supersedingAssertionId === id) visit(s.supersededAssertionId, depth + 1);\n  };\n  visit(assertionId, 0);\n  for (const l of lineage) if (l.kind === \"assertion\") l.depth = best.get(l.id) ?? l.depth;\n  return { target: assertionId, lineage, prov, issues };\n")),
  M(250, "the same pair twice loses a relation", P("provenance.ts", WALK_ORDER, "  const supersessions = [...new Map((bundle.supersessions ?? []).map((s) => [`${s.supersededAssertionId}|${s.supersedingAssertionId}`, s])).values()].sort((x, y) => (x.supersededAssertionId < y.supersededAssertionId ? -1 : x.supersededAssertionId > y.supersededAssertionId ? 1 : 0));\n")),
  M(251, "INV-10 does not ask for DEPENDENCY_CYCLE to be declared", P("invariants.ts", INV_10, '      if (deps.some((dep) => dep.limitations.some((l) => l !== "DEPENDENCY_CYCLE" && !declaredLimits.has(l)))) {')),
  M(252, "INV-10 does not ask for a cycle's lifecycle limitations to be declared", P("invariants.ts", INV_10, '      if (deps.some((dep) => dep.limitations.some((l) => !(dep.limitations.includes("DEPENDENCY_CYCLE") && (l === "SUPERSEDED" || l === "CONFLICT_DECLARED" || l === "CONFLICT_DETECTED" || l === "DEPENDENCY_SUPERSEDED")) && !declaredLimits.has(l)))) {')),
  M(253, "the digest of the bundle is taken over a sorted copy: it no longer follows the listing", P("evaluate.ts", "    bundleDigest: evidenceDigest(bundle),\n", "    bundleDigest: evidenceDigest({ ...bundle, assertions: [...bundle.assertions].sort((x, y) => (x.id < y.id ? -1 : 1)) }),\n")),
  M(254, "the published rule stops saying record order changes no answer", P("claims.ts", '      recordOrder: "The order of the records in any list of a bundle the schema accepts changes no answer of inspect_evidence, check_invariants, assess_vault_readiness or trace_provenance. Only bundleDigest follows it.",\n', "")),
  M(255, "the published rule stops saying what a dependency cycle reads", P("claims.ts", '      dependencyCycles: "A derived assertion that depends on itself, directly or through others, has no basis: each assertion on the cycle reports DEPENDENCY_CYCLE, is NOT_ESTABLISHED unless a supersession or conflict overrides that, and retains every limitation any of them reports.",\n', "")),
  M(256, "the published rule stops saying what overlapping supersessions read", P("claims.ts", '      supersessions: "An assertion superseded more than once is SUPERSEDED. supersededBy names the smallest of the other assertions its records name that resolve, otherwise the assertion itself if a record names it, otherwise the smallest id named, whichever record comes first. check_invariants reports INV-12 SUPERSEDED_MULTIPLE_TIMES for more than one record that names another assertion, SUPERSESSION_REFERENCE_INVALID for a record that names nothing or its own assertion, SUPERSESSION_CLAIM_IDENTITY_MISMATCH for one whose assertions are not about the same claim, SUPERSESSION_NOT_FORWARD_IN_TIME for one whose superseding assertion is not later, and SUPERSESSION_CYCLE for a chain that comes back on itself by any of them.' + FAULTY_SENTENCE + '",\n', "")),
  M(257, "a reused assertion id counts as resolving in the rank: it can outrank an assertion that does resolve", P("evaluate.ts", RANK, "  const plainIds = indexBundle(bundle).assertions;\n  const rank = (superseded: string, by: string): number => (by === superseded ? 1 : plainIds.has(by) ? 0 : 2);\n")),
  M(258, "among ids that resolve to nothing the first listed is named", P("evaluate.ts", SUPERSEDED_BY, "    if (named === undefined || rank(superseded, by) < rank(superseded, named) || (rank(superseded, by) === rank(superseded, named) && rank(superseded, by) !== 2 && by < named)) supersededBy.set(superseded, by);\n")),
  M(259, "an assertion superseded only by itself is not named: supersededBy is null but the state stays", P("evaluate.ts", "      supersededBy: sup,\n", "      supersededBy: sup === a.id ? null : sup,\n")),
  M(260, "an assertion superseded by itself leaves conflict detection", P("evaluate.ts", RETIRED_RULE, '  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_REFERENCE_INVALID" || s.supersededAssertionId !== s.supersedingAssertionId).length === 0) retired.add(s.supersededAssertionId);\n')),
  M(261, "an assertion superseded only by nothing leaves conflict detection", P("evaluate.ts", RETIRED_RULE, '  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_REFERENCE_INVALID" || idx.assertions.has(s.supersedingAssertionId)).length === 0) retired.add(s.supersededAssertionId);\n')),
  M(262, "an assertion on a cycle reads every other on it as PINNED, whatever its temporality", P("evaluate.ts", READ_PINNED, '    core.freshness = "PINNED";\n')),
  M(263, "the future takes over a CURRENT assertion's freshness on a cycle, even a stale one", P("evaluate.ts", CYCLE_FRESHNESS, '      const freshness = retained.has("OBSERVATION_FROM_FUTURE") ? "UNKNOWN_FRESHNESS" : core.freshness;\n')),
  M(264, "a PINNED assertion on a cycle that retains a stale input reports STALE", P("evaluate.ts", CYCLE_FRESHNESS, '      const freshness = core.freshness === "PINNED" && retained.has("OBSERVATION_FROM_FUTURE") ? "UNKNOWN_FRESHNESS" : core.freshness === "PINNED" && retained.has("STALE_EVIDENCE") ? "STALE" : core.freshness;\n')),
  M(265, "a CURRENT assertion on a cycle that retains a stale input reports STALE, reading none itself", P("evaluate.ts", CYCLE_FRESHNESS, '      const freshness = core.freshness === "PINNED" && retained.has("OBSERVATION_FROM_FUTURE") ? "UNKNOWN_FRESHNESS" : m.temporality === "CURRENT" && retained.has("STALE_EVIDENCE") ? "STALE" : core.freshness;\n')),
  M(266, "the assertions on a cycle share the least final thing any of them reads", P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness, limitations: retained, finality: weakestFinality(members.map((x) => x.core.finality).filter((x): x is FinalityState => x !== null)) }, false);\n")),
  M(267, "the authority of a refused assertion on a cycle is satisfied if another's is", P("evaluate.ts", CYCLE_FINISH, "      finish(m, policy, { ...core, freshness, limitations: retained, authoritySatisfied: members.some((x) => x.core.authoritySatisfied) }, false);\n")),
  M(268, "a CURRENT assertion on a cycle over a superseded one on it is not stale", P("evaluate.ts", SUPERSEDED_INPUT, '      if (dep.supportState === "SUPERSEDED") {\n        supports.push("STALE");\n        anyStale = anyStale || !onSameCycle(a.id, dep.assertionId);\n        lim.add("DEPENDENCY_SUPERSEDED");\n      } else {\n        supports.push(dep.supportState);\n      }\n')),
  M(269, "a claim that is its own input leaves itself out of its freshness and finality", P("evaluate.ts", DEP_FRESH, "    const depFresh = deps.filter((x) => x.assertionId !== a.id).map((x) => x.freshnessState);\n"), P("evaluate.ts", FINALITIES, "    const finalities = deps.filter((x) => x.assertionId !== a.id).map((x) => x.finalityState).filter((x): x is FinalityState => x !== null);\n")),
  M(270, "an assertion on a cycle reads the others with no finality: it reads the least final of what is outside, FINALIZED included", P("evaluate.ts", READ_PINNED, READ_PINNED + "    core.finality = null;\n")),
  M(271, "the authority of an assertion on a cycle is not satisfied when it reads a superseded one", P("evaluate.ts", CYCLE_STATE, CYCLE_STATE + '    if (onCycle(a.id) && deps.some((x) => x.supportState === "SUPERSEDED")) core.authoritySatisfied = false;\n')),
  M(272, "a PINNED claim over an assertion on a cycle that the future reached still reports PINNED", P("evaluate.ts", FUTURE_FOR_PINNED, '    if (a.temporality === "PINNED" && deps.filter((x) => !onCycle(x.assertionId) || onCycle(a.id)).some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n')),
  M(273, "a claim over a conflicting assertion on a cycle reads it as NOT_ESTABLISHED: the conflict stops propagating", P("evaluate.ts", SUPERSEDED_INPUT, '      if (dep.supportState === "SUPERSEDED") {\n        supports.push("STALE");\n        anyStale = true;\n        lim.add("DEPENDENCY_SUPERSEDED");\n      } else {\n        supports.push(!onCycle(a.id) && onCycle(dep.assertionId) && dep.supportState === "CONFLICTING" ? "NOT_ESTABLISHED" : dep.supportState);\n      }\n')),
  M(274, "a CURRENT claim over a stale assertion on a cycle reads its freshness as unknown", P("evaluate.ts", DEP_FRESH, '    const depFresh = deps.map((x) => (!onCycle(a.id) && onCycle(x.assertionId) && x.freshnessState === "STALE" ? "UNKNOWN_FRESHNESS" : x.freshnessState));\n')),
  M(275, "a claim over a cycle has its authority not satisfied", P("evaluate.ts", CYCLE_STATE, CYCLE_STATE + "    if (!onCycle(a.id) && deps.some((x) => onCycle(x.assertionId))) core.authoritySatisfied = false;\n")),
  M(276, "an assertion on a cycle reads another as PINNED only if it is neither superseded nor conflicting", P("evaluate.ts", READ_PINNED, '    if (a.temporality === "PINNED" && !supersededBy.has(a.id) && !conflictsWith.has(a.id)) core.freshness = "PINNED";\n')),
  M(277, "a CURRENT claim over a superseded assertion on a cycle is not stale", P("evaluate.ts", SUPERSEDED_INPUT, '      if (dep.supportState === "SUPERSEDED") {\n        supports.push("STALE");\n        anyStale = anyStale || onCycle(a.id) || !onCycle(dep.assertionId);\n        lim.add("DEPENDENCY_SUPERSEDED");\n      } else {\n        supports.push(dep.supportState);\n      }\n')),
  M(278, "on a cycle a pinned input outranks an unknown one", P("evaluate.ts", '    } else if (depFresh.includes("UNKNOWN_FRESHNESS")) {\n', '    } else if (depFresh.includes("UNKNOWN_FRESHNESS") && !(onCycle(a.id) && depFresh.includes("PINNED"))) {\n')),
  M(279, "a PINNED claim over a stale assertion on a cycle that retained the future still reports PINNED", P("evaluate.ts", FUTURE_FOR_PINNED, '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE") && (onCycle(a.id) || !onCycle(x.assertionId) || x.freshnessState === "UNKNOWN_FRESHNESS"))) {\n')),
  M(280, "a CURRENT claim over a PINNED assertion on a cycle reports the pinned dependency, whatever that assertion finally reads", P("evaluate.ts", DEP_FRESH, '    const depFresh = deps.map((x) => (onCycle(x.assertionId) && x.temporality === "PINNED" ? "PINNED" : x.freshnessState));\n')),
  M(281, "STALE_SATISFIES_CURRENT is skipped on a cycle", P("invariants.ts", '      if (a.temporality === "CURRENT" && e.freshnessState === "STALE") {\n', '      if (a.temporality === "CURRENT" && e.freshnessState === "STALE" && !e.limitations.includes("DEPENDENCY_CYCLE")) {\n')),
  M(282, "STALE_DECLARED_CURRENT is skipped on a cycle", P("invariants.ts", '    if (declared?.freshnessState === "CURRENT" && e.freshnessState === "STALE") {\n', '    if (declared?.freshnessState === "CURRENT" && e.freshnessState === "STALE" && !e.limitations.includes("DEPENDENCY_CYCLE")) {\n')),
  M(283, "CONFLICT_SATISFIES_ESTABLISHED is skipped on a cycle", P("invariants.ts", '    if (declared?.supportState === "ESTABLISHED" && e.supportState === "CONFLICTING") {\n', '    if (declared?.supportState === "ESTABLISHED" && e.supportState === "CONFLICTING" && !e.limitations.includes("DEPENDENCY_CYCLE")) {\n')),
  M(284, "DECLARED_FRESHNESS_EXCEEDS_COMPUTED is skipped on a cycle", P("invariants.ts", '    if (declared?.freshnessState === "CURRENT" && e.freshnessState !== "CURRENT" && e.freshnessState !== "STALE") {\n', '    if (declared?.freshnessState === "CURRENT" && e.freshnessState !== "CURRENT" && e.freshnessState !== "STALE" && !e.limitations.includes("DEPENDENCY_CYCLE")) {\n')),
  M(285, "USD_VALUE_WITHOUT_PRICE_EVIDENCE is skipped on a cycle", P("invariants.ts", '      if (a.claimType === "TOKEN_USD_VALUE" && !deps.some((dep) => dep.claimType === "TOKEN_USD_PRICE")) {\n', '      if (a.claimType === "TOKEN_USD_VALUE" && !e.limitations.includes("DEPENDENCY_CYCLE") && !deps.some((dep) => dep.claimType === "TOKEN_USD_PRICE")) {\n')),
  M(286, "a record naming nothing as the superseded id is not invalid", P("invariants.ts", REFERENCE_INVALID, '    if (oldA === undefined) continue;\n    if (faults.includes("SUPERSESSION_REFERENCE_INVALID")) {\n      push("INV-12", "SUPERSESSION_REFERENCE_INVALID", s.supersededAssertionId);\n      continue;\n    }\n')),
  M(287, "a supersession of itself is reported only as a cycle", P("invariants.ts", REFERENCE_INVALID, '    if (s.supersededAssertionId === s.supersedingAssertionId) continue;\n    if (oldA === undefined || faults.includes("SUPERSESSION_REFERENCE_INVALID")) {\n      push("INV-12", "SUPERSESSION_REFERENCE_INVALID", s.supersededAssertionId);\n      continue;\n    }\n')),
  M(288, "the published cycle rule is negated, keeping every phrase in it", P("claims.ts", "has no basis: each assertion on the cycle reports DEPENDENCY_CYCLE, is NOT_ESTABLISHED unless a supersession or conflict overrides that, and retains every limitation any of them reports.", "has a basis: no assertion on the cycle reports DEPENDENCY_CYCLE, none is NOT_ESTABLISHED unless a supersession or conflict overrides that, and none retains every limitation any of them reports.")),
  M(289, "the published order rule is weakened, keeping every phrase in it", P("claims.ts", "The order of the records in any list of a bundle the schema accepts changes no answer of inspect_evidence, check_invariants, assess_vault_readiness or trace_provenance. Only bundleDigest follows it.", "The order of the records in any list of a bundle the schema accepts changes no answer of trace_provenance, and may change any other. bundleDigest follows it.")),
  M(290, "only the target of a back edge of a depth-first walk counts as on the cycle", P("evaluate.ts", "  const onCycle = (id: string): boolean => dependsOn.get(id)?.has(id) === true;\n", '  const backTargets = new Set<string>();\n  {\n    const color = new Map<string, number>();\n    const direct = (id: string): string[] => {\n      const a = idx.assertions.get(id);\n      const d = a?.derivationId === undefined ? undefined : idx.derivations.get(a.derivationId);\n      return a !== undefined && d?.outputAssertionId === a.id && getPolicy(a.claimType)?.derived === true ? d.inputAssertionIds.filter((x) => idx.assertions.has(x)) : [];\n    };\n    const dfs = (id: string): void => {\n      color.set(id, 1);\n      for (const n of direct(id)) {\n        if (color.get(n) === 1) backTargets.add(n);\n        else if (!color.has(n)) dfs(n);\n      }\n      color.set(id, 2);\n    };\n    for (const id of idx.assertions.keys()) if (!color.has(id)) dfs(id);\n  }\n  const onCycle = (id: string): boolean => backTargets.has(id);\n')),
  M(291, "a superseded assertion makes no dependency: a supersession breaks the cycle", P("evaluate.ts", "function dependencyClosure(idx: EvidenceIndex): Map<string, Set<string>> {\n", "function dependencyClosure(idx: EvidenceIndex, superseded: ReadonlySet<string>): Map<string, Set<string>> {\n"), P("evaluate.ts", "? d.inputAssertionIds.filter((id) => idx.assertions.has(id)) : [];\n  };\n  const closure", "? d.inputAssertionIds.filter((id) => idx.assertions.has(id) && !superseded.has(id)) : [];\n  };\n  const closure"), P("evaluate.ts", CLOSURE_CALL, "  const dependsOn = dependencyClosure(idx, new Set(supersededBy.keys()));\n"), P("evaluate.ts", READ_INPUT, "      deps.push(onSameCycle(a.id, id) ? readOnCycle(dep) : memoOrStandIn(dep));\n"), P("evaluate.ts", "  const readOnCycle = (a: Assertion): AssertionEvaluation => {\n", "  const memoOrStandIn = (a: Assertion): AssertionEvaluation => (supersededBy.has(a.id) && !memo.has(a.id) ? readOnCycle(a) : evalAssertion(a));\n  const readOnCycle = (a: Assertion): AssertionEvaluation => {\n")),
  // A supersession that cannot be valid takes nothing out of conflict detection (292 to 306): the old rule, each way the new one can be half applied, and what is published about it.
  M(292, "any supersession record at all takes an assertion out of conflict detection, as it used to", P("evaluate.ts", RETIRED_RULE, "  for (const s of bundle.supersessions ?? []) retired.add(s.supersededAssertionId);\n")),
  M(293, "a record naming nothing as the superseding id takes the assertion out of conflict detection", P("evaluate.ts", RETIRED_RULE, '  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_REFERENCE_INVALID" || s.supersededAssertionId === s.supersedingAssertionId || idx.assertions.has(s.supersedingAssertionId)).length === 0) retired.add(s.supersededAssertionId);\n')),
  M(294, "a record naming another claim's assertion takes the assertion out of conflict detection", P("evaluate.ts", RETIRED_RULE, '  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_CLAIM_IDENTITY_MISMATCH").length === 0) retired.add(s.supersededAssertionId);\n')),
  M(295, "a record naming an assertion that is not later takes the assertion out of conflict detection", P("evaluate.ts", RETIRED_RULE, '  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_NOT_FORWARD_IN_TIME").length === 0) retired.add(s.supersededAssertionId);\n')),
  M(296, "an assertion asserted at the same instant counts as later", P("evaluate.ts", TIME_RULE, '  if (Date.parse(newer.assertedAt) < Date.parse(older.assertedAt)) faults.push("SUPERSESSION_NOT_FORWARD_IN_TIME");\n')),
  M(297, "a well-formed record takes the superseding assertion out of conflict detection instead", P("evaluate.ts", RETIRED_RULE, "  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).length === 0) retired.add(s.supersedingAssertionId);\n")),
  M(298, "an assertion leaves conflict detection only if every record that names it is well-formed", P("evaluate.ts", RETIRED_RULE, "  const faultedIds = new Set((bundle.supersessions ?? []).filter((s) => supersessionFaults(idx, s).length > 0).map((s) => s.supersededAssertionId));\n  for (const s of bundle.supersessions ?? []) if (supersessionFaults(idx, s).length === 0 && !faultedIds.has(s.supersededAssertionId)) retired.add(s.supersededAssertionId);\n")),
  M(299, "a faulty record no longer marks its assertion SUPERSEDED: it is read as no record", P("evaluate.ts", SUPERSEDED_LOOP, "  for (const { supersededAssertionId: superseded, supersedingAssertionId: by } of (bundle.supersessions ?? []).filter((r) => supersessionFaults(idx, r).length === 0)) {\n")),
  M(300, "check_invariants reports with its own copy of the rule, which lets another claim's assertion through", P("invariants.ts", FAULTS_CALL, '    const faults = supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_CLAIM_IDENTITY_MISMATCH");\n')),
  M(301, "check_invariants reports with its own copy of the rule, which lets an assertion that is not later through", P("invariants.ts", FAULTS_CALL, '    const faults = supersessionFaults(idx, s).filter((f) => f !== "SUPERSESSION_NOT_FORWARD_IN_TIME");\n')),
  M(302, "a record naming the same assertion twice is faulty only if the assertion resolves", P("evaluate.ts", '  if (older === undefined || newer === undefined || s.supersededAssertionId === s.supersedingAssertionId) return ["SUPERSESSION_REFERENCE_INVALID"];\n', '  if (older === undefined || newer === undefined) return ["SUPERSESSION_REFERENCE_INVALID"];\n')),
  M(303, "only a faulty record's superseded assertion is compared: the assertion it names stays out too", P("evaluate.ts", CONFLICT_GROUPING, "    if (retired.has(a.id) || supersededBy.get(a.id) === a.id) continue;\n")),
  M(304, "the published rule stops saying a faulty record hides no conflict", P("claims.ts", FAULTY_SENTENCE, "")),
  M(305, "the published rule says a faulty record can hide a conflict, keeping every phrase in it", P("claims.ts", "so a record that cannot be valid cannot hide a conflict.", "so a record that cannot be valid can hide a conflict.")),
  M(306, "the profile stops saying a faulty record stays among those compared", P("../../../spec/EVIDENCE_PROFILE.md", "still reads `SUPERSEDED`, and stays among\n   those compared, so a record that cannot be valid cannot hide a conflict.", "still reads `SUPERSEDED`, and is taken out of\n   those compared.")),
  M(169, "the transport rule fires on the mere presence of a reused source", P("invariants.ts", '      ((s.kind === "PROVIDER_ENDPOINT" && CANONICAL_AUTHORITY_PREFIXES.some((p) => s.authorityId?.startsWith(p))) ||\n', '      ((idx.sources.get(s.id) === undefined && CANONICAL_AUTHORITY_PREFIXES.some((p) => s.authorityId?.startsWith(p))) || (s.kind === "PROVIDER_ENDPOINT" && CANONICAL_AUTHORITY_PREFIXES.some((p) => s.authorityId?.startsWith(p))) ||\n')),
];

interface SuiteResult {
  file: string;
  ok: boolean;
  failed: string[];
  environment: string[];
}

const ENVIRONMENT_ERROR = /EBUSY|EPERM|EACCES|ECONNRESET|ENOSPC|EMFILE|too long|Permission denied/;

function run(file: string): Promise<SuiteResult> {
  return new Promise((resolve) => {
    // A mutant can make a test wait forever: a test that times out is a failure, so the mutant is killed, and the watchdog ends a run that outlives that.
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=60000", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const watchdog = setTimeout(() => child.kill(), 420_000);
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(watchdog);
      const failed = [...out.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1] ?? "").filter((t) => !t.endsWith(".test.ts"));
      const environment = out.split("\n").filter((l) => ENVIRONMENT_ERROR.test(l)).slice(0, 3);
      resolve({ file, ok: code === 0, failed, environment });
    });
    child.on("error", () => {
      clearTimeout(watchdog);
      resolve({ file, ok: false, failed: [], environment: ["spawn failed"] });
    });
  });
}

const suitesOf = async (files: readonly string[]): Promise<SuiteResult[]> => await Promise.all(files.map(run));

const original = new Map<string, string>();
// One run at a time. The lock is overwritten, never deleted (the repository bans deleting outside its owned-temp helper): "HELD:<pid>" while a run is
// live, "FREE" after. A "HELD" whose process is gone is a run that died; its mutant may still be in the tree, which `git status` shows.
const lock = join(root, "node_modules", ".evidence-identity-mutation.lock");
const holder = (): number | null => {
  try {
    const m = /^HELD:(\d+)$/.exec(readFileSync(lock, "utf8").trim());
    return m === null ? null : Number(m[1]);
  } catch {
    return null;
  }
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const restore = (): void => {
  for (const [file, text] of original) writeFileSync(join(root, file), text);
  writeFileSync(lock, "FREE");
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

const running = holder();
if (running !== null && running !== process.pid && alive(running)) {
  console.error(`another mutation run (pid ${String(running)}) is live. Run this alone: it rewrites sources in place.`);
  process.exit(3);
}
if (running !== null && !alive(running)) console.warn(`a previous run (pid ${String(running)}) did not finish: check that \`git status\` shows the sources clean.`);
writeFileSync(lock, `HELD:${String(process.pid)}`);

const only = new Set((process.argv.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length).split(",").filter((s) => s !== "").map(Number));
const chosen = only.size === 0 ? MUTANTS : MUTANTS.filter((m) => only.has(m.id));
const suiteSet = [...new Set(chosen.flatMap((m) => m.suites))];

try {
  const baseline = await suitesOf(suiteSet);
  const red = baseline.filter((r) => !r.ok);
  if (red.length > 0) {
    console.error(`baseline is not green: ${red.map((r) => `${r.file} [${r.failed.join("; ")}]`).join(", ")}`);
    process.exitCode = 2;
    throw new Error("baseline is not green");
  }
  console.log(`baseline green: ${String(suiteSet.length)} suites`);

  let survivors = 0;
  for (const m of chosen) {
    const applied: { path: string; text: string }[] = [];
    let patchable = true;
    for (const p of m.patches) {
      const path = join(root, p.file);
      const text = original.get(p.file) ?? readFileSync(path, "utf8");
      original.set(p.file, text);
      const current = applied.findLast((a) => a.path === path)?.text ?? readFileSync(path, "utf8");
      const at = current.indexOf(p.find);
      if (at < 0 || current.indexOf(p.find, at + 1) >= 0) {
        console.error(`mutant ${String(m.id)}: the patch text is not unique in ${p.file}`);
        patchable = false;
        break;
      }
      const next = current.slice(0, at) + p.replace + current.slice(at + p.find.length);
      writeFileSync(path, next);
      applied.push({ path, text: next });
    }
    try {
      if (!patchable) {
        survivors++;
        continue;
      }
      const results = await suitesOf(m.suites);
      const killers = results.filter((r) => !r.ok);
      const named = killers.flatMap((r) => r.failed);
      const environment = killers.flatMap((r) => r.environment);
      if (killers.length === 0 || named.length === 0) survivors++;
      console.log(`${killers.length > 0 && named.length > 0 ? "KILLED  " : "SURVIVED"} #${String(m.id)} ${m.name}`);
      for (const r of killers) console.log(`    ${r.file.replace("packages/mcp/test/", "").replace(".test.ts", "")}: ${String(r.failed.length)} failed, e.g. ${(r.failed[0] ?? "(no test title)").slice(0, 110)}`);
      if (environment.length > 0) console.log(`    AUDIT environment-looking lines: ${environment.join(" | ").slice(0, 200)}`);
    } finally {
      for (const p of m.patches) writeFileSync(join(root, p.file), original.get(p.file) ?? "");
    }
  }
  console.log(`${String(chosen.length - survivors)} of ${String(chosen.length)} mutants killed`);
  if (survivors > 0) process.exitCode = 1;
} finally {
  restore();
}
