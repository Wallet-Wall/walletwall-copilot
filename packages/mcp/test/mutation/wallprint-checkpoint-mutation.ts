import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mutation check for the signed registry/ledger checkpoint. Each mutant is one realistic broken implementation, applied to
 * the real source by an exact, unique, single-line text patch; the checkpoint, vector, scenario, attestation, ledger and isolation suites
 * must fail for it (it is KILLED), run one file at a time so the report says which suites noticed. The sources are restored
 * afterwards, whatever happens. A mutant that survives is a hole in the tests, and fails the run.
 *
 *   npm run test:wallprint-checkpoint-mutation
 *
 * It rewrites files in the working tree while it runs, so it is a developer / review tool, not part of `npm test` (it is not a
 * `*.test.ts` file, and lives under the test tree so that no script, canvas or plugin file refers to the verifier). RUN IT ALONE:
 * nothing else (a test run, an editor, another agent, a second copy of this script) may read or write the tree while it runs, or the
 * mutants leak into that work and a restore can capture a mutant as the "original".
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC = "packages/mcp/src/wallprint";
const TEST = "packages/mcp/test/wallprint";
const SUITES = ["checkpoint", "checkpoint-verify", "checkpoint-scenarios", "checkpoint-vectors", "attestation-isolation", "attestation-ed25519", "attestation", "attestation-verify", "acceptance-ledger"].map((name) => `${TEST}/${name}.test.ts`);

interface Mutant {
  id: number;
  name: string;
  file: string;
  find: string;
  replace: string;
}

const M = (id: number, name: string, file: string, find: string, replace: string): Mutant => ({ id, name, file: `${SRC}/${file}`, find, replace });

const PREIMAGE = "domainSeparatedPreimage(CHECKPOINT_DOMAIN_TAGS[statement.purpose], statement);";
const preimageOf = (value: string): string => `domainSeparatedPreimage(CHECKPOINT_DOMAIN_TAGS[statement.purpose], ${value});`;

const MUTANTS: readonly Mutant[] = [
  // what is signed
  M(1, "drop domain separation: sign the bare statement text", "checkpoint.ts", PREIMAGE, "new TextEncoder().encode(JSON.stringify(statement));"),
  M(2, "omit the registry head digest from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("{ ...statement, registry: { headVersion: statement.registry.headVersion } }")),
  M(3, "omit the registry count (head version) from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("{ ...statement, registry: { headDigest: statement.registry.headDigest } }")),
  M(4, "omit the ledger head digest from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("{ ...statement, acceptanceLedger: { entryCount: statement.acceptanceLedger.entryCount } }")),
  M(5, "omit the ledger count from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("{ ...statement, acceptanceLedger: { headDigest: statement.acceptanceLedger.headDigest } }")),
  M(6, "omit the signer's public key from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("{ ...statement, signer: { keyId: statement.signer.keyId, algorithm: statement.signer.algorithm } }")),
  M(7, "omit the purpose from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("(({ purpose: _p, ...rest }) => rest)(statement)")),
  M(8, "omit the checkpoint version from the signed statement", "checkpoint.ts", PREIMAGE, preimageOf("(({ checkpointVersion: _v, ...rest }) => rest)(statement)")),
  M(9, "the checkpoint's domain tag is an attestation tag (no separation from attestations)", "checkpoint-vocabulary.ts", '"walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint",', '"walletwall.wallprint.attestation/0.1/record-publication",'),
  M(10, "the shared construction loses its 0x00 boundary (attestations and checkpoints alike)", "attestation.ts", "out.set(body, prefix.length + 1);", "out.set(body, prefix.length);"),
  M(11, "an unknown field is dropped instead of refused", "checkpoint.ts", "export const CheckpointStatementSchema = z.strictObject({", "export const CheckpointStatementSchema = z.object({"),
  // who may sign
  M(12, "trust the checkpoint's self-declared key when the root does not list it", "checkpoint-verify.ts", "const found = parsed.root.keys.find((k) => k.keyId === statement.signer.keyId);", "const found = parsed.root.keys.find((k) => k.keyId === statement.signer.keyId) ?? { keyId: statement.signer.keyId, algorithm: statement.signer.algorithm, publicKey: statement.signer.publicKey, purposes: [statement.purpose] };"),
  M(13, "authorize a root key whose material differs from the statement's", "checkpoint-verify.ts", "found.algorithm !== statement.signer.algorithm || found.publicKey !== statement.signer.publicKey", "false"),
  M(14, "accept a governance key that is authorized for another purpose", "checkpoint-verify.ts", "if (!found.purposes.some((p) => p === statement.purpose))", "if (false)"),
  M(15, "with no trust root supplied, treat the signer as authorized (a default root)", "checkpoint-verify.ts", 'return { key: "NOT_EVALUATED", authorization: "NOT_EVALUATED", reasons: ["TRUST_ROOT_NOT_SUPPLIED"] };', 'return { key: "KNOWN", authorization: "AUTHORIZED", reasons: [] };'),
  M(16, "an unsupported algorithm is run through the Ed25519 verifier instead of not being checked", "checkpoint-verify.ts", 'if (!(SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm)) return { status: "NOT_CHECKED", reasons: ["ALGORITHM_UNSUPPORTED"] };', ""),
  // the signature primitive
  M(17, "accept a malformed Ed25519 R (small order, torsion, off the curve)", "ed25519.ts", 'if (computeKeyProblem(signatureHex.slice(0, 64)) !== null) return { valid: false, reason: "SIGNATURE_R_INADMISSIBLE" };', ""),
  M(18, "accept a non-canonical Ed25519 S (at or above the group order)", "ed25519.ts", 'if (s >= L) return { valid: false, reason: "SIGNATURE_S_NON_CANONICAL" };', ""),
  M(19, "accept an inadmissible public key (the identity point verifies any message on the platform)", "ed25519.ts", "if (problem !== null) return { valid: false, reason: problem };", ""),
  // the supplied state
  M(20, "skip the registry chain verification", "checkpoint-verify.ts", "const chain = verifyKeyRegistryChain(raw);", 'const chain = { ok: Array.isArray(raw), chain: raw as KeyRegistrySnapshot[] } as ReturnType<typeof verifyKeyRegistryChain>;'),
  M(21, "skip the ledger chain verification", "checkpoint-verify.ts", "const ledger = verifyAcceptanceLedger(raw);", 'const ledger = { ok: Array.isArray(raw), entries: raw as AcceptanceEntry[] } as ReturnType<typeof verifyAcceptanceLedger>;'),
  M(22, "accept a head that is not the committed one (heads are not compared)", "checkpoint-verify.ts", "if (headAt(supplied.items, committedCount) !== committedHead)", "if (false)"),
  M(23, "accept a log shorter than the committed count (truncation)", "checkpoint-verify.ts", "if (length < committedCount) return", "if (false) return"),
  M(24, "accept a log longer than the committed state when exactness was asked for (a later append is covered)", "checkpoint-verify.ts", "const allowExtension = context.allowExtension === true;", "const allowExtension = true;"),
  M(25, "the ledger anchor names the supplied length, not the committed count (a later append is covered)", "checkpoint-verify.ts", "acceptanceAnchor: acceptanceLedger.headDigest === null ? null : { seq: acceptanceLedger.entryCount, digest: acceptanceLedger.headDigest },", 'acceptanceAnchor: acceptanceLedger.headDigest === null ? null : { seq: v.acceptanceLedger.supplied ?? acceptanceLedger.entryCount, digest: acceptanceLedger.headDigest },'),
  // ordering
  M(26, "allow a committed ledger entry to reference a registry version beyond the committed head", "checkpoint-verify.ts", 'if (version > registryCount) reasons.push("LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION");', ""),
  M(27, "do not check a referenced registry version's digest against the committed registry", "checkpoint-verify.ts", "else if (registry.items[version - 1]?.digest !== entry.acceptedUnder.keyRegistryDigest)", "else if (false)"),
  M(28, "drop the since-the-anchor ordering rule (entries after an anchor may name older registry heads)", "checkpoint-verify.ts", "if (Number(entry.acceptedUnder.keyRegistryVersion) < anchoredHead)", "if (false)"),
  // rollback
  M(29, "disable rollback detection (an older checkpoint is not behind the anchor)", "checkpoint-verify.ts", "if (registryOrder < 0 || ledgerOrder < 0)", "if (false)"),
  M(30, "the anchors are given even for a checkpoint that is behind or forked from the anchor", "checkpoint-verify.ts", 'if (v.anchor.status !== "NO_ANCHOR" && v.anchor.status !== "AT_ANCHOR" && v.anchor.status !== "ADVANCES_ANCHOR") return null;', ""),
  M(31, "a checkpoint with the anchor's counts but another head is taken for the anchor", "checkpoint-verify.ts", "if (registryOrder === 0 && committed.registry.headDigest !== anchor.registry.headDigest) return forks;", ""),
  // dimensions and overclaims
  M(32, "the anchors are given without a valid signature", "checkpoint-verify.ts", 'if (v.signature.status !== "VALID" || v.signer.authorization !== "AUTHORIZED") return null;', 'if (v.signer.authorization !== "AUTHORIZED") return null;'),
  M(33, "the anchors are given without an authorized signer", "checkpoint-verify.ts", 'if (v.signature.status !== "VALID" || v.signer.authorization !== "AUTHORIZED") return null;', 'if (v.signature.status !== "VALID") return null;'),
  M(34, "the anchors are given for an inconsistent registry/ledger combination", "checkpoint-verify.ts", 'if (!usable(v.registry) || !usable(v.acceptanceLedger) || v.crossBinding.status !== "CONSISTENT") return null;', "if (!usable(v.registry) || !usable(v.acceptanceLedger)) return null;"),
  M(35, "the identifier mismatch does not block the anchors", "checkpoint-verify.ts", 'if (v.identity.status === "MISMATCHED") return null;', ""),
  M(36, "the identifier is never compared with the digest", "checkpoint-verify.ts", ": context.expectedDigest === digest", ": true"),
  M(37, "the result gains a generic `verified` flag", "checkpoint-verify.ts", '    parse: "PARSED",', '    verified: signature.status === "VALID" && signer.authorization === "AUTHORIZED",\n    parse: "PARSED",'),
  M(38, "the fixed denial no longer says a checkpoint does not establish truth of an attestation", "checkpoint-vocabulary.ts", '  "factual truth of any WallPrint record, claim or attestation",', ""),
  M(39, "a covered acceptance keeps its standing whatever the registry retained (checkpoint validity read as key standing)", "attestation-verify.ts", 'else if (key.retainedBefore !== null && Number(acceptance.version) >= Number(key.addedIn) && Number(acceptance.version) < Number(key.retainedBefore)) standing = "HELD";', 'else if (true) standing = "HELD";'),
  // found by the independent review
  M(40, "checkpointAnchors accepts a fabricated or revived result (any object of the right shape)", "checkpoint-verify.ts", 'if (typeof v !== "object" || v === null || !issued.has(v)) return null;', 'if (typeof v !== "object" || v === null) return null;'),
  M(41, "a null, primitive or array context is not normalised", "checkpoint-verify.ts", 'const contextOf = (raw: unknown): CheckpointContext => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as CheckpointContext) : {});', "const contextOf = (raw: unknown): CheckpointContext => raw as CheckpointContext;"),
  M(42, "input that cannot be read throws instead of being refused", "checkpoint-verify.ts", '    return issue(deepFreeze(emptyResult("MALFORMED", "SHAPE")));', '    throw new Error("unreadable");'),
  M(43, "the anchors do not say whether the caller held an anchor", "checkpoint-verify.ts", "    currentness,", '    currentness: "AT_ANCHOR",'),
  M(44, "the anchors do not say what lies past the committed state", "checkpoint-verify.ts", 'uncovered: { registryVersions: v.registry.uncovered ?? "0", ledgerEntries: v.acceptanceLedger.uncovered ?? "0" },', 'uncovered: { registryVersions: "0", ledgerEntries: "0" },'),
  M(45, "an anchored ledger is not checked for continuity (a ledger fork is an advance)", "checkpoint-verify.ts", "const ledgerHeld = ledgerHeadAt(ledger.items, Number(anchor.acceptanceLedger.entryCount)) === anchor.acceptanceLedger.headDigest;", "const ledgerHeld = true;"),
  M(46, "an anchored registry is not checked for continuity (a registry fork is an advance)", "checkpoint-verify.ts", "const registryHeld = registryHeadAt(registry.items, Number(anchor.registry.headVersion)) === anchor.registry.headDigest;", "const registryHeld = true;"),
  M(47, "the since-the-anchor rule reads the uncovered tail as well as the committed prefix", "checkpoint-verify.ts", "for (const entry of ledger.items.slice(Number(anchored.anchor.acceptanceLedger.entryCount), ledgerCount)) {", "for (const entry of ledger.items.slice(Number(anchored.anchor.acceptanceLedger.entryCount))) {"),
  M(48, "what a checkpoint establishes loses its precondition", "checkpoint-vocabulary.ts", '"Only when the signature is VALID and the signer is AUTHORIZED: the holder of the private key', '"The holder of the private key'),
  M(49, "the ledger structure guard is applied to the whole array again (a ledger of a few thousand entries is refused)", "acceptance-ledger.ts", "if (raw.some((item: unknown) => hasForbiddenStructure(item)))", "if (hasForbiddenStructure(raw))"),
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
  for (let i = 0; i < SUITES.length; i += 4) out.push(...(await Promise.all(SUITES.slice(i, i + 4).map(run))));
  return out;
}

const original = new Map<string, string>();
const lock = join(root, "node_modules", ".wallprint-checkpoint-mutation.lock");
const restore = (): void => {
  for (const [file, text] of original) writeFileSync(join(root, file), text);
  rmSync(lock, { force: true });
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

if (existsSync(lock)) {
  console.error(`another mutation run holds ${lock}. Run this alone. Delete the file only if no run is active and \`git status\` shows the sources clean.`);
  process.exit(3);
}
writeFileSync(lock, String(process.pid));

try {
  const baseline = await suites();
  const red = baseline.filter((r) => !r.ok);
  if (red.length > 0) {
    console.error(`baseline is not green: ${red.map((r) => r.file).join(", ")}`);
    process.exitCode = 2;
  } else {
    console.log(`baseline green: ${SUITES.length} suites, ${MUTANTS.length} mutants`);

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
  }
} finally {
  restore();
}
