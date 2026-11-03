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
const ENGINE_SUITES = ["sandbox/evidence-identity", "sandbox/conformance", "sandbox/adversarial", "sandbox/engine", "sandbox/mutation", "wallprint/identity"].map((n) => `packages/mcp/test/${n}.test.ts`);
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

const INDEX_AMBIGUOUS = "  const ambiguousAssertions = new Map([...byId].filter(([, records]) => records.length > 1));\n  for (const id of ambiguousAssertions.keys()) index.assertions.delete(id);\n";
const READINESS_REFUSAL = "  if (ambiguousAssertions.size > 0) {\n";
const WHOLE_BUNDLE_REFUSAL = '    if (idx.ambiguousAssertions.size > 0) support = "NOT_ESTABLISHED";\n';
const CASE_RULE = "typeof value === \"string\" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;";
const TIMED_OUT = 'const timedOut = error.code === "ERR_HTTP_REQUEST_TIMEOUT";';

const MUTANTS: readonly Mutant[] = [
  M(1, "skip the derived subject comparison", P("evaluate.ts", "    if (mismatchedKeys.size > 0) {\n", "    if ((mismatchedKeys.size as number) < 0) {\n")),
  M(2, "compare the holder case-sensitively", P("subject.ts", CASE_RULE, 'typeof value === "string" && key !== "holder" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;')),
  M(3, "compare the token address case-sensitively", P("subject.ts", CASE_RULE, 'typeof value === "string" && key !== "token" && CASE_INSENSITIVE_SUBJECT_KEYS.has(key) ? value.toLowerCase() : value;')),
  M(4, "the first record of a reused assertion id wins", P("evaluate.ts", INDEX_AMBIGUOUS, "  const ambiguousAssertions = new Map<string, Assertion[]>();\n")),
  M(5, "the last record of a reused assertion id wins", P("evaluate.ts", INDEX_AMBIGUOUS, "  const ambiguousAssertions = new Map<string, Assertion[]>();\n  for (const a of bundle.assertions) index.assertions.set(a.id, a);\n")),
  M(6, "a reused id is recorded by the invariant, and readiness and support stay positive", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, ""), P("readiness.ts", READINESS_REFUSAL, "  if ((ambiguousAssertions.size as number) < 0) {\n")),
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
  M(23, "readiness runs its criteria next to a reused id", P("readiness.ts", READINESS_REFUSAL, "  if ((ambiguousAssertions.size as number) < 0) {\n")),
  M(24, "every subject key folds, not only those the vocabulary marks", P("subject.ts", CASE_RULE, 'typeof value === "string" ? value.toLowerCase() : value;')),
  M(25, "the reused id itself keeps first-record support: the refused entry is not added", P("evaluate.ts", "const results = [...[...idx.assertions.values()].map(evalAssertion), ...[...idx.ambiguousAssertions.values()].map(evalAmbiguous)].sort(", "const results = [...idx.assertions.values()].map(evalAssertion).sort(")),
  { id: 26, name: "a timed-out client that never closes its side stays attached: the socket is ended, not destroyed", patches: [{ file: "scripts/claude-mcp-http.ts", find: TIMED_OUT, replace: "const timedOut = false;" }], suites: ADAPTER_SUITES },
  M(27, "the evidence index is used for WallPrint admission as well: a correction to evaluation moves historical admission", P("wallprint/record.ts", "  const idx = indexBundle(bundle);\n  const focal = idx.assertions.get(focalAssertionId);", "  const idx = indexEvidence(bundle);\n  const focal = idx.assertions.get(focalAssertionId);"), P("wallprint/record.ts", 'import { evaluateBundle, indexBundle, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";', 'import { evaluateBundle, indexBundle, indexEvidence, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";')),
  M(28, "the WallPrint builder reads the evidence index: its refusal of a reused focal id changes reason", P("wallprint/record.ts", "  const idx = indexBundle(bundle);\n  const focalAssertion = idx.assertions.get(focalAssertionId);", "  const idx = indexEvidence(bundle);\n  const focalAssertion = idx.assertions.get(focalAssertionId);"), P("wallprint/record.ts", 'import { evaluateBundle, indexBundle, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";', 'import { evaluateBundle, indexBundle, indexEvidence, pick, type AssertionEvaluation, type Evaluation } from "../evaluate.ts";')),
  M(29, "readiness reads the plain index: its subject and decimals come from the first record of a reused id", P("readiness.ts", "const { assertions: aById, ambiguousAssertions } = indexEvidence(bundle);", "const { assertions: aById } = indexBundle(bundle);\n  const ambiguousAssertions = new Map<string, Assertion[]>();"), P("readiness.ts", 'import { evaluateBundle, indexEvidence, weakest, type AssertionEvaluation, type Evaluation } from "./evaluate.ts";', 'import { evaluateBundle, indexBundle, weakest, type AssertionEvaluation, type Evaluation } from "./evaluate.ts";')),
  M(30, "provenance reads the plain index: it traces the first record of a reused id", P("provenance.ts", "const idx = indexEvidence(bundle);", "const idx = indexBundle(bundle);"), P("provenance.ts", 'import { indexEvidence } from "./evaluate.ts";', 'import { indexBundle } from "./evaluate.ts";')),
  M(31, "invariants read the plain index: recomputation reads the first record of a reused id", P("invariants.ts", "const idx = indexEvidence(bundle);", "const idx = { ...indexBundle(bundle), ambiguousAssertions: new Map<string, Assertion[]>() };"), P("invariants.ts", "  indexEvidence,\n", "  indexBundle,\n")),
  M(32, "a derived subject is not checked against the claim contract", P("evaluate.ts", "    if (!subjectValid(a.subject, policy.subjectKeys)) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(", "    if (policy.subjectKeys.length < 0) {\n      lim.add(\"INVALID_SUBJECT\");\n      core.diagnostics.push({\n        limitation: \"INVALID_SUBJECT\",\n        record: \"ASSERTION_SUBJECT\",\n        observationId: null,\n        ...diagnoseRecord(a.subject, SUBJECT_KEY_RULES, policy.subjectKeys),\n        mismatchedKeys: [],\n      });\n      violations.push(")),
  M(33, "a derived claim over a future PINNED input still reports PINNED freshness", P("evaluate.ts", '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n', "    if (deps.length < 0) {\n")),
  M(34, "the future check reads only the authoritative readings", P("evaluate.ts", "    for (const o of valueObs) newest = Math.max(newest, Date.parse(o.observedAt));\n", "    for (const o of qualified.length > 0 ? qualified : valueObs) newest = Math.max(newest, Date.parse(o.observedAt));\n")),
  M(35, "a null subject value groups with a missing key", P("subject.ts", "    if (v === undefined) return canonicalize(null);\n", "    if (v === undefined || v === null) return canonicalize(null);\n")),
  M(36, "a superseded or conflicting assertion keeps its state next to a reused id", P("evaluate.ts", WHOLE_BUNDLE_REFUSAL, '    if (idx.ambiguousAssertions.size > 0 && sup === null && conflicts.length === 0) support = "NOT_ESTABLISHED";\n')),
  M(37, "readiness stops comparing chains", P("readiness.ts", 'const sameChain = idA.subject["chainId"] === balA.subject["chainId"];', "const sameChain = true;")),
  { id: 38, name: "every client error destroys the socket: a refused request with unread bytes loses its response", patches: [{ file: "scripts/claude-mcp-http.ts", find: TIMED_OUT, replace: "const timedOut = true;" }], suites: ADAPTER_SUITES },
  { id: 40, name: "a connection already ended is left alone when it times out: a malformed request's client holds its descriptor", patches: [{ file: "scripts/claude-mcp-http.ts", find: "    } else if (timedOut) {\n      socket.destroy();\n    }\n", replace: "    }\n" }], suites: ADAPTER_SUITES },
  { id: 41, name: "a timed-out client that has stopped reading stays attached: the socket waits on a write that cannot finish", patches: [{ file: "scripts/claude-mcp-http.ts", find: "      if (timedOut && socket.writableLength > 0) socket.destroy();\n", replace: "" }], suites: ADAPTER_SUITES },
  M(39, "the future rule also takes over a CURRENT derived claim's freshness", P("evaluate.ts", '    if (a.temporality === "PINNED" && deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n', '    if (deps.some((x) => x.limitations.includes("OBSERVATION_FROM_FUTURE"))) {\n')),
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
