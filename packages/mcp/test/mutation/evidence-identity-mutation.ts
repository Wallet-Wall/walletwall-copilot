import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mutation check for the evidence engine's identity and temporal rules and the adapter's timeouts. Each mutant is one realistic
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
const ENGINE_SUITES = ["sandbox/evidence-identity", "sandbox/reused-record-ids", "sandbox/conformance", "sandbox/adversarial", "sandbox/engine", "sandbox/mutation", "wallprint/identity"].map((n) => `packages/mcp/test/${n}.test.ts`);
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
  M(79, "a cycle is not reported beside a reused id", P("evaluate.ts", '      core.limitations.add("DEPENDENCY_CYCLE");\n', '      if (idx.reusedIdCode === null) core.limitations.add("DEPENDENCY_CYCLE");\n')),
  M(80, "SUPERSEDED is not reported beside a reused id", P("evaluate.ts", '      limitations.add("SUPERSEDED");\n', '      if (idx.reusedIdCode === null) limitations.add("SUPERSEDED");\n')),
  M(81, "a conflict's limitation is not reported beside a reused id", P("evaluate.ts", '      limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n', '      if (idx.reusedIdCode === null) limitations.add(conflictCause.get(a.id) ?? "CONFLICT_DETECTED");\n')),
  M(82, "version limitations are not reported beside a reused id", P("evaluate.ts", "    for (const l of bundleLimitations) limitations.add(l);\n", "    if (idx.reusedIdCode === null) for (const l of bundleLimitations) limitations.add(l);\n")),
  M(83, "a declared conflict stops linking beside a reused id", P("evaluate.ts", '  for (const c of bundle.conflicts ?? []) link(c.assertionIds, "CONFLICT_DECLARED");\n', '  if (idx.reusedIdCode === null) for (const c of bundle.conflicts ?? []) link(c.assertionIds, "CONFLICT_DECLARED");\n')),
  M(84, "a detected conflict stops linking beside a reused id", P("evaluate.ts", '    if (values.size > 1) link(members.map((m) => m.id), "CONFLICT_DETECTED");\n', '    if (idx.reusedIdCode === null && values.size > 1) link(members.map((m) => m.id), "CONFLICT_DETECTED");\n')),
  M(85, "nothing of an assertion's own is kept beside a reused id", P("evaluate.ts", "    const policy = getPolicy(a.claimType);\n    let core: Core;\n    if (inProgress.has(a.id)) {", "    const policy = getPolicy(a.claimType);\n    let core: Core;\n    if (idx.reusedIdCode !== null) {\n      core = emptyCore(policy);\n      return finish(a, policy, core, false);\n    }\n    if (inProgress.has(a.id)) {")),
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
      const current = applied.find((a) => a.path === path)?.text ?? readFileSync(path, "utf8");
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
