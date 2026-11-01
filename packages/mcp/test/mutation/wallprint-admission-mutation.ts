import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mutation check for WallPrint's versioned admission rules. Each mutant is one realistic broken implementation, applied
 * to the real source by an exact, unique text patch; the admission, import, record, replay, receipt, reference and diff
 * suites must fail for it (it is KILLED), run one file at a time so the report says which suites noticed. The sources are
 * restored afterwards, whatever happens. A mutant that survives is a hole in the tests, and fails the run.
 *
 *   npm run test:wallprint-admission-mutation
 *
 * It rewrites files in the working tree while it runs, so it is a developer / review tool, not part of `npm test` (it is
 * not a `*.test.ts` file, and lives under the test tree so that no script, canvas or plugin file refers to the importer).
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC = "packages/mcp/src/wallprint";
const TEST = "packages/mcp/test/wallprint";
const SUITES = [
  "admission-versions",
  "admission-parity",
  "admission-characterization",
  "assessor-attribution",
  "assessor-import",
  "assessor-import-mutation",
  "record",
  "replay",
  "receipt",
  "reference",
  "diff",
  "hardening",
].map((name) => `${TEST}/${name}.test.ts`);

interface Mutant {
  id: number;
  name: string;
  file: string;
  find: string;
  replace: string;
}

const M = (id: number, name: string, file: string, find: string, replace: string): Mutant => ({ id, name, file: `${SRC}/${file}`, find, replace });

const MUTANTS: readonly Mutant[] = [
  M(1, "remove separator folding", "admission.ts", "const SEPARATORS = /[._:/-]+/;", "const SEPARATORS = /(?!)/;"),
  M(2, "make the comparison case-sensitive", "admission.ts", 'export const foldIdentity = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));', "export const foldIdentity = (s: string): string => s;"),
  M(3, "allow the concatenated walletwallprint (a stem fused with more letters)", "admission.ts", "STEMS.some((s) => first.startsWith(s)) || wordsSpellStem(words, from)", "STEMS.some((s) => first === s) || wordsSpellStem(words, from)"),
  M(4, "allow a numeric reserved suffix on a stem spelled across words (wallet-wall2)", "admission.ts", "const DIGITS = /^[0-9]*$/;", "const DIGITS = /^$/;"),
  M(5, "allow a numeric reserved policy namespace suffix (wwap2)", "admission.ts", "[0-9]*$`);", "$`);"),
  M(6, "compare a registry authority only by exact spelling", "admission.ts", "AUTHORITY_SKELETONS.has(identitySkeleton(assessor))", "REGISTRY_AUTHORITY_IDS_V01.has(assessor.toLowerCase())"),
  M(7, "permit the equivalent issuer spelling as INDEPENDENT_REVIEWER", "admission.ts", "} else if (rules.collidesWithAuthorityIdentity(a.assessor)) {", '} else if (a.assessorRole !== "INDEPENDENT_REVIEWER" && rules.collidesWithAuthorityIdentity(a.assessor)) {'),
  M(8, "permit the equivalent issuer spelling as UPSTREAM_AUTHORITY", "admission.ts", "} else if (rules.collidesWithAuthorityIdentity(a.assessor)) {", '} else if (a.assessorRole !== "UPSTREAM_AUTHORITY" && rules.collidesWithAuthorityIdentity(a.assessor)) {'),
  M(9, "permit the equivalent issuer spelling as OTHER", "admission.ts", "} else if (rules.collidesWithAuthorityIdentity(a.assessor)) {", '} else if (a.assessorRole !== "OTHER" && rules.collidesWithAuthorityIdentity(a.assessor)) {'),
  M(10, "permit a reserved policy separator variant (ww-ap)", "admission.ts", "for (const word of words) {\n    run += word;", "for (const word of words.slice(0, 1)) {\n    run += word;"),
  M(11, 'turn the identity rule into a broad "wall" substring ban', "admission.ts", "return words.some((_, i) => readsAsStemFrom(words, i));", 'return foldIdentity(id).includes("wall");'),
  M(12, "find a stem anywhere inside a word (substring), not only at its start", "admission.ts", "STEMS.some((s) => first.startsWith(s)) || wordsSpellStem(words, from)", "STEMS.some((s) => first.includes(s)) || wordsSpellStem(words, from)"),
  M(13, "apply the new rules retroactively: the validator always uses the current version", "record.ts", "externalAssessmentFindings(r.wallprintVersion, externals.map", "externalAssessmentFindings(WALLPRINT_VERSION, externals.map"),
  M(14, "apply the new rules retroactively: the 0.1 row of the table is the 0.2 rules", "admission.ts", 'Object.freeze({ "0.1": RULES_V01, "0.2": RULES_V02 })', 'Object.freeze({ "0.1": RULES_V02, "0.2": RULES_V02 })'),
  M(15, "replay rebuilds a historical record under today's rules", "replay.ts", "      wallprintVersion: record.wallprintVersion,\n", ""),
  M(16, "the importer uses the new rules while the native builder uses the version it was given", "assessor-import.ts", "resolved.focalAssertionId, resolved.wallprintVersion, (i) =>", 'resolved.focalAssertionId, "0.2", (i) =>'),
  M(17, "the importer ignores the target version in its context check", "assessor-import.ts", 'if (!(WALLPRINT_VERSIONS as readonly string[]).includes(wallprintVersion)) return [finding("UNSUPPORTED_VERSION", "context.wallprintVersion")];', ""),
  M(18, "the builder builds old records by default (the importer and the builder disagree on the current version)", "record.ts", "parsedInput.data.wallprintVersion ?? WALLPRINT_VERSION", 'parsedInput.data.wallprintVersion ?? "0.1"'),
  M(19, "normalize the assessor id in the stored record", "record.ts", "    assessor: a.assessor,\n    assessorRole: a.assessorRole,\n    assessment: a.assessment,", "    assessor: a.assessor.toLowerCase(),\n    assessorRole: a.assessorRole,\n    assessment: a.assessment,"),
  M(20, "assessor agreement increments corroboration", "record.ts", "    return claimRecord(e, a?.subject ?? {}, a?.value ?? null);\n  });", "    const c = claimRecord(e, a?.subject ?? {}, a?.value ?? null);\n    return e.assertionId === focalAssertionId && c.independentCorroboration !== null ? { ...c, independentCorroboration: String(Number(c.independentCorroboration) + externals.length) } : c;\n  });"),
  M(21, "fold spelling variants into one assessor (invented identity resolution) in the duplicate check", "admission.ts", "const key = `${a.assessor.toLowerCase()}|${a.policy.toLowerCase()}`;", "const key = `${identitySkeleton(a.assessor)}|${a.policy.toLowerCase()}`;"),
  M(22, "accept an equivalent spelling of the registry authority under the ISSUER role (role promotion by spelling)", "admission.ts", "else if (a.assessor !== registryAuthority)", "else if (identitySkeleton(a.assessor) !== identitySkeleton(registryAuthority))"),
  M(23, "infer an authority from an issuer-looking name (heuristic, not the registry)", "admission.ts", "(assessor: string): boolean => AUTHORITY_SKELETONS.has(identitySkeleton(assessor)),", '(assessor: string): boolean => AUTHORITY_SKELETONS.has(identitySkeleton(assessor)) || identityWords(assessor)[0] === "issuer",'),
  M(24, "the receipt names the current version, not its record's", "receipt.ts", "wallprintVersion: r.wallprintVersion,", 'wallprintVersion: "0.2",'),
  M(25, "receipt verification ignores the version", "receipt.ts", '  if (receipt.data.wallprintVersion !== r.wallprintVersion) reasons.push("VERSION_MISMATCH");\n', ""),
  M(26, "the diff does not name the version", "diff.ts", '  c.add("record", "wallprintVersion", a.wallprintVersion, b.wallprintVersion);\n', ""),
  M(27, "a portable reference resolves only the current version", "reference.ts", "Object.freeze([...WALLPRINT_VERSIONS])", 'Object.freeze(["0.2"])'),
  M(28, "0.2 is 0.1 (the new version changes nothing)", "admission.ts", 'Object.freeze({ "0.1": RULES_V01, "0.2": RULES_V02 })', 'Object.freeze({ "0.1": RULES_V01, "0.2": RULES_V01 })'),
];

function run(file: string): Promise<{ file: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", file], { cwd: root, stdio: "ignore" });
    child.on("close", (code) => resolve({ file, ok: code === 0 }));
    child.on("error", () => resolve({ file, ok: false }));
  });
}

async function suites(): Promise<{ file: string; ok: boolean }[]> {
  const out: { file: string; ok: boolean }[] = [];
  for (let i = 0; i < SUITES.length; i += 6) out.push(...(await Promise.all(SUITES.slice(i, i + 6).map(run))));
  return out;
}

const original = new Map<string, string>();
const restore = (): void => {
  for (const [file, text] of original) writeFileSync(join(root, file), text);
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

try {
  const baseline = await suites();
  const red = baseline.filter((r) => !r.ok);
  if (red.length > 0) {
    console.error(`baseline is not green: ${red.map((r) => r.file).join(", ")}`);
    process.exit(2);
  }
  console.log(`baseline green: ${SUITES.length} suites`);

  let survivors = 0;
  for (const m of MUTANTS) {
    const path = join(root, m.file);
    const text = original.get(m.file) ?? readFileSync(path, "utf8");
    original.set(m.file, text);
    const at = text.indexOf(m.find);
    if (at < 0 || text.indexOf(m.find, at + 1) >= 0) {
      console.error(`mutant ${m.id}: the patch text is not unique in ${m.file}`);
      survivors++;
      continue;
    }
    writeFileSync(path, text.slice(0, at) + m.replace + text.slice(at + m.find.length));
    try {
      const killers = (await suites()).filter((r) => !r.ok).map((r) => r.file.replace(`${TEST}/`, "").replace(".test.ts", ""));
      if (killers.length === 0) survivors++;
      console.log(`${killers.length > 0 ? "KILLED  " : "SURVIVED"} #${m.id} ${m.name}${killers.length > 0 ? `  <- ${killers.join(", ")}` : ""}`);
    } finally {
      writeFileSync(path, text);
    }
  }
  console.log(`${MUTANTS.length - survivors} of ${MUTANTS.length} mutants killed`);
  if (survivors > 0) process.exitCode = 1;
} finally {
  restore();
}
