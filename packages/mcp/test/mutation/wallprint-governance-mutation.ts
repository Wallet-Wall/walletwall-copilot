import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mutation check for the governance key-ceremony verifier, policy, transcript validator and secret scanner. Each mutant is one realistic broken
 * implementation (or a few edits that together make one), applied to the real source by exact, unique text patches; the governance suites must
 * fail for it (it is KILLED), run one file at a time so the report says which suites noticed. The sources are restored afterwards, whatever
 * happens. A mutant that survives is a hole in the tests, and fails the run. A mutant that only the regeneration suites (vectors, rehearsal)
 * noticed is reported as such: it was caught by "the output changed", not by a test that says why that is wrong.
 *
 *   npm run test:wallprint-governance-mutation                  every mutant
 *   npm run test:wallprint-governance-mutation -- --only=3,16   just those mutants
 *   npm run test:wallprint-governance-mutation -- --check       only check that every patch text is present and unique (no test runs)
 *
 * It rewrites files in the working tree while it runs, so it is a developer / review tool, not part of `npm test` (it is not a `*.test.ts` file).
 * RUN IT ALONE: nothing else (a test run, an editor, another agent, a second copy of this script) may read or write the tree while it runs, or the
 * mutants leak into that work and a restore can capture a mutant as the "original".
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC = "packages/mcp/src/wallprint";
const TEST = "packages/mcp/test/wallprint";
const SUITES = ["governance-bootstrap", "governance-authorization", "governance-rotation", "governance-recovery", "governance-compromise", "governance-transcript", "governance-secret-scan", "governance-isolation", "governance-vectors", "governance-rehearsal"].map((name) => `${TEST}/${name}.test.ts`);
const REGENERATION_ONLY = new Set(["governance-vectors", "governance-rehearsal"]);

interface Patch {
  file: string;
  find: string;
  replace: string;
}
interface Mutant {
  id: number;
  name: string;
  patches: Patch[];
}

const P = (file: string, find: string, replace: string): Patch => ({ file: file.includes("/") || file.startsWith(".") || file === "package.json" ? file : `${SRC}/${file}`, find, replace });
const M = (id: number, name: string, ...patches: Patch[]): Mutant => ({ id, name, patches });

const VERIFY = "governance-verify.ts";
const GOV = "governance.ts";
const VOCAB = "governance-vocabulary.ts";
const TRANSCRIPT = "governance-transcript.ts";
const SCAN = "governance-secret-scan.ts";

const ONE_PURPOSE_LINE = '  if (!key.purposes.every((p) => (OPERATIONAL_KEY_PURPOSES as readonly string[]).includes(p))) reasons.push("PURPOSE_NOT_PERMITTED");';
const SIGNATURE_LINE = "  const signature = verifyEd25519(root.publicKey, authorizationPreimage(statement), envelope.signature);";
const ROOT_MISMATCH_LINE = '  if (statement.root.keyId !== root.keyId || statement.root.algorithm !== root.algorithm || statement.root.publicKey !== root.publicKey) return { envelope, check: { reasons: ["ROOT_MISMATCH"] } };';
const HELD_CAPABILITY = 'if (typeof v !== "object" || v === null || !issued.has(v) || !established(v)) return null;';

const MUTANTS: readonly Mutant[] = [
  // ── the fifteen the lane required ──
  M(1, "trust an operational key without the root's authorization: the signature is never checked", P(VERIFY, '  if (!signature.valid) return { envelope, check: signature.reason === "RUNTIME_UNSUPPORTED" ? { runtimeUnsupported: true } : { reasons: [signature.reason satisfies SignatureReason] } };', "")),
  M(2, "a checkpoint signer the root never authorized is relied upon", P(VERIFY, '  if (entry === undefined) return noReliance("NOT_RELIED_UPON", "UNKNOWN", null, ["SIGNER_NOT_AUTHORIZED_BY_ROOT"]);', '  if (entry === undefined) return noReliance("RELIED_UPON", "CURRENT", null, []);')),
  M(3, "accept a wrong authorization purpose: an operational key may be granted any purpose", P(VERIFY, ONE_PURPOSE_LINE, "")),
  M(4, "accept a wrong root purpose: a root may also hold the checkpoint purpose", P(VERIFY, '  if (!withinPolicy(artifact.root.purposes, ROOT_PURPOSES)) out.push("BOOTSTRAP_PURPOSE_NOT_PERMITTED");', "")),
  M(5, "ignore a key material mismatch: a checkpoint naming an authorized key id with another key's material is relied upon", P(VERIFY, "  if (entry.algorithm !== statement.signer.algorithm || entry.publicKey !== statement.signer.publicKey) return noReliance(", "  if (false) return noReliance(")),
  M(6, "ignore the root's public key in an authorization: a statement naming the root's id with another key's material is read as the root's", P(VERIFY, "statement.root.algorithm !== root.algorithm || statement.root.publicKey !== root.publicKey) return", "statement.root.algorithm !== root.algorithm) return")),
  M(7, "ignore the authorization generation", P(VERIFY, '  if (statement.generation !== String(index + 1)) reasons.push("GENERATION_NOT_CONSECUTIVE");', "")),
  M(8, "allow stale generation rollback: a chain below the held generation is not behind it", P(VERIFY, '  if (keys.length < heldGeneration) return { status: "BEHIND_HELD"', '  if (false) return { status: "BEHIND_HELD"')),
  M(9, "trust a self-signed root: the signature is checked under the key the statement names, and the named root is not compared with the pinned one", P(VERIFY, ROOT_MISMATCH_LINE, ""), P(VERIFY, SIGNATURE_LINE, "  const signature = verifyEd25519(statement.root.publicKey, authorizationPreimage(statement), envelope.signature);")),
  M(10, "let a compromised operational key authorize its replacement: a signature by any key authorized so far is accepted", P(VERIFY, SIGNATURE_LINE, "  const signature = [root.publicKey, ...seen.publicKeys].map((k) => verifyEd25519(k, authorizationPreimage(statement), envelope.signature)).find((r) => r.valid) ?? verifyEd25519(root.publicKey, authorizationPreimage(statement), envelope.signature);")),
  M(11, "let an operational key authorize a new root: it may be granted the root's own purpose", P(VERIFY, ONE_PURPOSE_LINE, '  if (!key.purposes.every((p) => (OPERATIONAL_KEY_PURPOSES as readonly string[]).includes(p) || p === "CHECKPOINT_KEY_AUTHORIZATION")) reasons.push("PURPOSE_NOT_PERMITTED");')),
  M(12, "allow an altered public bootstrap artifact: a fingerprint that is not the pinned one is not an error", P(VERIFY, '      reasons.push("BOOTSTRAP_DIGEST_MISMATCH");', "")),
  M(13, "accept the wrong domain tag: the authorization tag is an attestation tag", P(VOCAB, 'CHECKPOINT_KEY_AUTHORIZATION: "walletwall.wallprint.governance-authorization/0.1/checkpoint-key-authorization",', 'CHECKPOINT_KEY_AUTHORIZATION: "walletwall.wallprint.attestation/0.1/record-publication",')),
  M(14, "drop domain separation: sign the bare statement text", P(GOV, "export const authorizationPreimage = (statement: AuthorizationStatement): Uint8Array => domainSeparatedPreimage(AUTHORIZATION_DOMAIN_TAGS[statement.purpose], statement);", "export const authorizationPreimage = (statement: AuthorizationStatement): Uint8Array => new TextEncoder().encode(JSON.stringify(statement));")),
  M(15, "ignore a secret in a transcript read from text", P(TRANSCRIPT, 'return { value: read.ok ? read.value : undefined, findings: scanCeremonyFile("transcript.json", text) };', "return { value: read.ok ? read.value : undefined, findings: [] };")),
  M(16, "ignore a secret in a transcript read from an object", P(TRANSCRIPT, "return { value: input, findings: hasForbiddenStructure(input) ? [] : scanCeremonyJson(input) };", "return { value: input, findings: [] };")),
  M(17, "allow a private key in a public artifact: the bootstrap drops unknown fields instead of refusing them", P(GOV, "export const GovernanceBootstrapSchema = z.strictObject({", "export const GovernanceBootstrapSchema = z.object({")),
  M(18, "allow a private key in a public artifact: the authorization drops unknown fields", P(GOV, "export const AuthorizationStatementSchema = z.strictObject({", "export const AuthorizationStatementSchema = z.object({")),
  M(19, "allow a secret slot in a transcript: the transcript drops unknown fields", P(TRANSCRIPT, "export const CeremonyTranscriptSchema = z.strictObject({", "export const CeremonyTranscriptSchema = z.object({")),
  M(20, "treat root compromise as solved by a root-signed replacement: a reset that keeps the compromised root key", P(VERIFY, '      if (parsed.artifact.root.publicKey === current.data.rootPublicKey) reasons.push("ROOT_KEY_UNCHANGED");', "")),
  M(21, "treat root compromise as solved by the root's own channel: a reset with no independent confirmation", P(VERIFY, '  if (origins.size < MINIMUM_INDEPENDENT_ORIGINS) reasons.push("INSUFFICIENT_INDEPENDENT_ORIGINS");', "")),
  M(22, "a reset that is not at a higher epoch", P(VERIFY, '      if (Number(parsed.artifact.rootEpoch) <= Number(current.data.rootEpoch)) reasons.push("EPOCH_NOT_GREATER");', "")),
  M(23, "let a CI signing path exist: the workflow gains an identity-token permission", P(".github/workflows/ci.yml", "permissions:\n  contents: read\n", "permissions:\n  contents: read\n  id-token: write\n")),
  M(24, "let a CI signing path exist: a workflow step reads a repository secret", P(".github/workflows/ci.yml", "      - name: Typecheck\n        run: npm run typecheck", "      - name: Typecheck\n        env:\n          KEY: ${{ secrets.GOVERNANCE_ROOT }}\n        run: npm run typecheck")),
  M(25, "let a production-root command exist: an npm script creates the root", P("package.json", '    "rehearse:wallprint-governance-ceremony": "node scripts/rehearse-wallprint-governance-ceremony.ts",', '    "rehearse:wallprint-governance-ceremony": "node scripts/rehearse-wallprint-governance-ceremony.ts",\n    "create-walletwall-production-root": "node scripts/rehearse-wallprint-governance-ceremony.ts",')),
  M(26, "let governance authority imply factual truth: the result gains a `verified` flag", P(VERIFY, "    verificationVersion: GOVERNANCE_VERIFICATION_VERSION,\n    bootstrap,", "    verificationVersion: GOVERNANCE_VERIFICATION_VERSION,\n    verified: bootstrap.parse === \"PARSED\",\n    bootstrap,")),
  M(27, "let governance authority imply factual truth: the fixed denial of factual truth is dropped", P(VOCAB, '  "factual truth of any record, claim, attestation, assessor or issuer",\n', "")),
  M(28, "let governance authority imply factual truth: what a valid state establishes loses its pinning precondition", P(VOCAB, '"Only when the bootstrap was pinned out of band: the holder of the private key for the pinned root public key signed', '"The holder of the private key for the pinned root public key signed')),

  // ── the authorization chain ──
  M(30, "the root key may also be the operational key", P(VERIFY, '  if (key.keyId === root.keyId || key.publicKey === root.publicKey) reasons.push("AUTHORIZED_KEY_IS_ROOT_KEY");\n  else if (seen.keyIds.has(key.keyId) || seen.publicKeys.has(key.publicKey)) reasons.push("AUTHORIZED_KEY_REUSED");', '  if (seen.keyIds.has(key.keyId) || seen.publicKeys.has(key.publicKey)) reasons.push("AUTHORIZED_KEY_REUSED");')),
  M(31, "a superseded key may be authorized again", P(VERIFY, '  if (key.keyId === root.keyId || key.publicKey === root.publicKey) reasons.push("AUTHORIZED_KEY_IS_ROOT_KEY");\n  else if (seen.keyIds.has(key.keyId) || seen.publicKeys.has(key.publicKey)) reasons.push("AUTHORIZED_KEY_REUSED");', '  if (key.keyId === root.keyId || key.publicKey === root.publicKey) reasons.push("AUTHORIZED_KEY_IS_ROOT_KEY");')),
  M(32, "an authorization need not name the digest of the one it supersedes", P(VERIFY, '  else if (statement.supersedes.authorizationDigest !== previous.digest) reasons.push("SUPERSEDES_DIGEST_MISMATCH");', "")),
  M(33, "a later generation need not name a predecessor", P(VERIFY, '  } else if (statement.supersedes === null) reasons.push("SUPERSEDES_MISSING");\n  else if (', "  } else if (statement.supersedes === null) {\n    // not checked\n  } else if (")),
  M(34, "generation 1 may name a predecessor", P(VERIFY, '    if (statement.supersedes !== null) reasons.push("SUPERSEDES_UNEXPECTED");', "")),
  M(35, "the root epoch inside an authorization is not compared with the bootstrap's", P(VERIFY, '  if (statement.rootEpoch !== bootstrap.rootEpoch) return { envelope, check: { reasons: ["ROOT_EPOCH_MISMATCH"] } };', "")),
  M(36, "a granted purpose list may be unordered or repeat", P(VERIFY, '  if (!strictlyAscending(key.purposes)) reasons.push("PURPOSES_NOT_ORDERED");', "")),
  M(37, "an inadmissible operational key (the identity point) is accepted", P(VERIFY, '  else if (ed25519KeyProblem(key.publicKey) !== null) reasons.push("AUTHORIZED_KEY_INADMISSIBLE");', "")),
  M(38, "an inadmissible root key (the identity point) is accepted", P(VERIFY, '  else if (ed25519KeyProblem(artifact.root.publicKey) !== null) out.push("BOOTSTRAP_KEY_INADMISSIBLE");', "")),
  M(39, "an unsupported root algorithm is accepted", P(VERIFY, '  if (!supported(artifact.root.algorithm)) out.push("BOOTSTRAP_ALGORITHM_UNSUPPORTED");\n  else if (', '  if (false) out.push("BOOTSTRAP_ALGORITHM_UNSUPPORTED");\n  else if (')),
  M(40, "a synthetic root key id is accepted by a production verifier", P(VERIFY, '  if (isSynthetic(artifact.root.keyId) && !allowSynthetic) out.push("SYNTHETIC_KEY_REFUSED");', "")),
  M(41, "a synthetic operational key id is accepted by a production verifier", P(VERIFY, '  if (isSynthetic(key.keyId) && !allowSynthetic) reasons.push("SYNTHETIC_KEY_REFUSED");', "")),
  M(42, "an unbounded chain is accepted", P(VERIFY, '  if (raw.length > GOVERNANCE_LIMITS.maxAuthorizations) return none(chainResult("INVALID", ["TOO_MANY_AUTHORIZATIONS"]));', "")),
  M(43, "the epoch floor is ignored: a root below the caller's minimum epoch is accepted", P(VERIFY, "    else if (Number(artifact.rootEpoch) < Number(floor)) {", "    else if (false) {")),

  // ── held state and reliance ──
  M(50, "a fork from the held state is taken for an advance", P(VERIFY, "  if (keys[heldGeneration - 1]?.authorizationDigest !== held.authorizationDigest) return {", "  if (false) return {")),
  M(51, "a rolled-back or forked state still lists its keys", P(VERIFY, "  if (!usable(result)) return result;", "  if (false) return result;")),
  M(52, "the unpinned limitation is not reported", P(VERIFY, '  if (bootstrap.pin !== "PINNED") limitations.push("BOOTSTRAP_UNPINNED");', "")),
  M(53, "the unheld-state limitation is not reported", P(VERIFY, '  if (held.status === "NO_HELD_STATE") limitations.push("GOVERNANCE_STATE_UNHELD");', "")),
  M(54, "a compromised key is read as retired: the root's standing decision is ignored", P(VERIFY, '    const standing: KeyStanding = next === undefined ? "CURRENT" : (supersedes?.standing ?? "COMPROMISED");', '    const standing: KeyStanding = next === undefined ? "CURRENT" : "RETIRED";')),
  M(55, "the retained state the root named is ignored", P(VERIFY, "      retainedAt: next === undefined ? null : (supersedes?.retainedAt ?? null),", "      retainedAt: null,")),
  M(56, "any authorized key is relied upon, current or not", P(VERIFY, '  if (entry.standing === "CURRENT") return noReliance("RELIED_UPON", "CURRENT", entry.generation, []);', '  if (true) return noReliance("RELIED_UPON", entry.standing, entry.generation, []);')),
  M(57, "a superseded key with nothing retained is relied upon", P(VERIFY, '  if (kept === null) return noReliance("NOT_RELIED_UPON", entry.standing, entry.generation, ["KEY_SUPERSEDED_NOT_RETAINED"]);', '  if (kept === null) return noReliance("RELIED_UPON", entry.standing, entry.generation, []);')),
  M(58, "a checkpoint beyond the retained state is relied upon", P(VERIFY, "  if (beyondRetained(committed, kept)) return noReliance(", "  if (false) return noReliance(")),
  M(59, "another history at the retained state is relied upon", P(VERIFY, "  if (headDiffersAtRetained(committed, kept)) return noReliance(", "  if (false) return noReliance(")),
  M(60, "a checkpoint below the retained state is relied upon: a stolen retired key can sign another history there", P(VERIFY, "  if (beforeRetained(committed, kept)) return noReliance(", "  if (false) return noReliance(")),
  M(61, "a retained superseded key is not labelled as retained-state-only", P(VERIFY, 'return noReliance("RELIED_UPON", entry.standing, entry.generation, [], ["SUPERSEDED_KEY_RETAINED_STATE_ONLY"]);', 'return noReliance("RELIED_UPON", entry.standing, entry.generation, [], []);')),
  M(62, "the trust root derived from the state holds every authorized key, not only the current one", P(VERIFY, "  return current === undefined ? null : rootOf([current]);", "  return current === undefined ? null : rootOf(v.keys);")),
  M(63, "a signer the caller may not rely on is still put in the derived root", P(VERIFY, 'const signer = reliance.status === "RELIED_UPON" && parsed.ok ? governance.keys.find(', "const signer = parsed.ok ? governance.keys.find(")),
  M(64, "the state to hold next is minted for a fabricated result", P(VERIFY, `${HELD_CAPABILITY}\n  const head = v.keys[v.keys.length - 1];`, 'if (typeof v !== "object" || v === null || !established(v)) return null;\n  const head = v.keys[v.keys.length - 1];')),
  M(65, "a trust root is derived from a fabricated result", P(VERIFY, `${HELD_CAPABILITY}\n  const current = v.keys.find((k) => k.standing === "CURRENT");`, 'if (typeof v !== "object" || v === null || !established(v)) return null;\n  const current = v.keys.find((k) => k.standing === "CURRENT");')),
  M(66, "anchors are minted for a fabricated governed result", P(VERIFY, 'if (typeof result !== "object" || result === null || !issuedGoverned.has(result)) return null;', 'if (typeof result !== "object" || result === null) return null;')),
  M(68, "an unpinned bootstrap is relied upon", P(VERIFY, '  if (governance.bootstrap.pin !== "PINNED") return noReliance(', "  if (false) return noReliance(")),
  M(69, "a trust root is derived from an unpinned state", P(VERIFY, `!issued.has(v) || !established(v)) return null;\n  const current`, `!issued.has(v) || !usable(v)) return null;\n  const current`)),
  M(72, "a held state is minted from an unpinned state", P(VERIFY, `!issued.has(v) || !established(v)) return null;\n  const head`, `!issued.has(v) || !usable(v)) return null;\n  const head`)),
  M(73, "the derived trust root is handed to the section 23 verifier although the bootstrap is unpinned", P(VERIFY, `  if (established(governance)) {\n    const current`, `  if (usable(governance)) {\n    const current`)),
  M(74, "governed verification throws on input it cannot read", P(VERIFY, `  } catch {\n    // Input that cannot even be read (a throwing getter, a revoked proxy, a value that changes between reads) is refused, never evaluated and never an exception.`, `  } catch (e) {\n    if (e !== undefined) throw e;\n    // refused`)),
  M(75, "reliance is judged on one read of the checkpoint and the section 23 verifier is given another", P(VERIFY, "verifyCheckpoint(parsed.ok ? parsed.envelope : checkpoint, forwarded)", "verifyCheckpoint(checkpoint, forwarded)")),
  M(76, "a checkpoint that parsed differently the second time is verified anyway", P(VERIFY, '  if (!parsed.ok && verified.parse === "PARSED") throw new Error("the checkpoint changed between reads");', "")),
  M(78, "an accepted reset does not carry the retired root keys forward", P(VERIFY, "retiredRootPublicKeys: uniqueSorted([...(current.data.retiredRootPublicKeys ?? []), current.data.rootPublicKey]) };", "retiredRootPublicKeys: [] };")),
  M(77, "a reset may go back to a root key the caller retired", P(VERIFY, '      else if (current.data.retiredRootPublicKeys?.includes(parsed.artifact.root.publicKey) === true) reasons.push("ROOT_KEY_PREVIOUSLY_RETIRED");', "")),
  M(67, "a verifier that cannot read its input throws instead of refusing it", P(VERIFY, '    return issue(deepFreeze(emptyResult(emptyBootstrap("MALFORMED", ["BOOTSTRAP_MALFORMED"]))));', '    throw new Error("unreadable");')),

  // ── pinning and reset ──
  M(70, "one origin repeated is counted as independent confirmations", P(VERIFY, '  if (origins.size < MINIMUM_INDEPENDENT_ORIGINS) reasons.push("INSUFFICIENT_INDEPENDENT_ORIGINS");', '  if (rawConfirmations.length < MINIMUM_INDEPENDENT_ORIGINS) reasons.push("INSUFFICIENT_INDEPENDENT_ORIGINS");')),
  M(71, "a confirmation of another digest counts as a confirmation", P(VERIFY, '    if (confirmation.data.digest !== digest) reasons.push("CONFIRMATION_DIGEST_MISMATCH");', '    if (false) reasons.push("CONFIRMATION_DIGEST_MISMATCH");')),

  // ── the transcript ──
  M(80, "an event one participant alone attests is accepted", P(TRANSCRIPT, '    if (!sameSet(e.by, CEREMONY_ROLES)) out.push("ONE_ATTESTER_ONLY");', "")),
  M(81, "an incomplete or padded checklist is accepted", P(TRANSCRIPT, '    if (!sameSet(e.attests, EVENT_CHECKLIST[e.event])) out.push("CHECKLIST_INCOMPLETE");', "")),
  M(82, "a recorded bootstrap digest is not compared with the artifact", P(TRANSCRIPT, 'e.ref.bootstrapDigest !== digest) reasons.push("ARTIFACT_DIGEST_MISMATCH");', 'false) reasons.push("ARTIFACT_DIGEST_MISMATCH");')),
  M(83, "a recorded authorization digest is not compared with the artifact", P(TRANSCRIPT, '        if (event.ref.authorizationDigest !== authorizationDigest(envelope)) reasons.push("ARTIFACT_DIGEST_MISMATCH");', "")),
  M(84, "a backup below the floor is accepted", P(TRANSCRIPT, "Number(r.mediaCopies) < BACKUP_MINIMUMS.mediaCopies ||", "false ||")),
  M(85, "the event sequence of the ceremony kind is not checked", P(TRANSCRIPT, '  if (collapsed(names).join("|") !== expected.join("|")) out.push(', "  if (false) out.push(")),
  M(86, "event sequence numbers are not checked", P(TRANSCRIPT, '  if (t.events.some((e, i) => e.seq !== String(i + 1))) out.push("EVENT_ORDER_INVALID");', "")),
  M(87, "a live ceremony may name a synthetic key", P(TRANSCRIPT, '    if (t.mode === "LIVE" && synthetic > 0) reasons.push("LIVE_MODE_WITH_SYNTHETIC_KEY");', "")),
  M(88, "a rehearsal may name a production key", P(TRANSCRIPT, '    if (t.mode === "SYNTHETIC_REHEARSAL" && synthetic !== keyIds.length) reasons.push("SYNTHETIC_MODE_WITH_NON_SYNTHETIC_KEY");', "")),
  M(89, "one person may be both operator and witness", P(TRANSCRIPT, '  if (operators !== 1 || witnesses < 1 || new Set(t.participants.map((p) => p.participantId)).size !== t.participants.length) out.push("PARTICIPANTS_INVALID");', "")),
  M(90, "the ceremony id need not agree with the mode", P(TRANSCRIPT, '  if ((t.mode === "SYNTHETIC_REHEARSAL") !== t.ceremonyId.startsWith(SYNTHETIC_CEREMONY_ID_PREFIX)) out.push("CEREMONY_ID_MODE_MISMATCH");', "")),
  M(79, "a recovery drill of fewer copies than were made is accepted", P(TRANSCRIPT, 'if (made !== undefined && drilled !== undefined && Number(drilled.ref.copiesDrilled) < Number(made.ref.mediaCopies)) out.push("BACKUP_NOT_ALL_DRILLED");', "")),
  M(109, "the operational public key need not be compared with its device", P(VOCAB, '  OPERATIONAL_KEY_AUTHORIZED: ["AUTHORIZATION_SIGNED_OFFLINE", "OPERATIONAL_KEY_DISTINCT_FROM_ROOT", "OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE"],', '  OPERATIONAL_KEY_AUTHORIZED: ["AUTHORIZATION_SIGNED_OFFLINE", "OPERATIONAL_KEY_DISTINCT_FROM_ROOT"],')),
  M(92, "impossible backup counts are accepted", P(TRANSCRIPT, 'if (Number(r.mediaLocations) > Number(r.mediaCopies) || Number(r.passphraseLocations) > Number(r.passphraseEnvelopes)) out.push("BACKUP_COUNTS_IMPOSSIBLE");', "")),
  M(93, "authorizations signed by another root are accepted against a bootstrap", P(TRANSCRIPT, 'if (rootArtifact !== null && (envelope.statement.root.keyId !== rootArtifact.root.keyId || envelope.statement.root.publicKey !== rootArtifact.root.publicKey || envelope.statement.rootEpoch !== rootArtifact.rootEpoch)) reasons.push("AUTHORIZATION_ROOT_MISMATCH");', "")),
  M(94, "the root epoch of an authorization is not compared with the bootstrap's", P(TRANSCRIPT, "|| envelope.statement.rootEpoch !== rootArtifact.rootEpoch))", "))")),
  M(95, "the root key material of an authorization is not compared with the bootstrap's", P(TRANSCRIPT, "envelope.statement.root.publicKey !== rootArtifact.root.publicKey ||", "")),
  M(96, "the root key id of an authorization is not compared with the bootstrap's", P(TRANSCRIPT, "envelope.statement.root.keyId !== rootArtifact.root.keyId ||", "")),
  M(97, "a LIVE transcript need not be cross-checked", P(TRANSCRIPT, 'const liveGap = t.mode === "LIVE" && limitations.length > 0 ? ["LIVE_NOT_CROSS_CHECKED"] : [];', "const liveGap: string[] = [];")),
  M(98, "an identifier may be a long hex run", P(TRANSCRIPT, "\n  .refine((s) => !/[0-9a-f]{32}/.test(s))", "")),
  M(99, "an identifier may be long enough to carry a 32-byte secret", P(TRANSCRIPT, "/^[a-z0-9][a-z0-9._-]{2,39}$/", "/^[a-z0-9][a-z0-9._-]{2,63}$/")),
  M(91, "the tooling list is not compared with the published one", P(TRANSCRIPT, 'return sameSet(t.tooling.map(key), expected.data.map(key)) ? { status: "MATCHED", reasons: [] } :', 'return true ? { status: "MATCHED", reasons: [] } :')),

  // ── the scanner ──
  M(100, "a PEM private-key block is not found", P(SCAN, '  { code: "PEM_PRIVATE_KEY_BLOCK", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/ },', "")),
  M(101, "the Ed25519 PKCS#8 header is not found", P(SCAN, '  { code: "PKCS8_ED25519_HEADER", re: /302e0201' + '00300506032b657004220420|MC4CAQAw' + 'BQYDK2VwBCIEI/i },', "")),
  M(102, "a private-key field name in JSON is not found", P(SCAN, '  "privatekey",\n', "")),
  M(103, "no field name in JSON is checked", P(SCAN, '      if (SECRET_FIELD_NAMES.has(normaliseField(key))) out.push({ code: "SECRET_FIELD_NAME", at });', "")),
  M(104, "the scanner reports the line it matched", P(SCAN, "if (rule.re.test(line)) findings.push({ code: rule.code, at: `line ${i + 1}` });", "if (rule.re.test(line)) findings.push({ code: rule.code, at: line });")),
  M(105, "a 64-hex value beside a secret word is not found", P(SCAN, 'code: "SEED_HEX_NEAR_SECRET_WORD", re: /\\b(?:seed|priv|', 'code: "SEED_HEX_NEAR_SECRET_WORD", re: /(?!)\\b(?:seed|priv|')),

  M(106, "a value nested too deep to scan is passed as clean", P(SCAN, '    out.push({ code: "SCAN_DEPTH_EXCEEDED", at: path });\n', "")),
  M(107, "a JWK private scalar field is not found", P(SCAN, '  "d",\n  "privatekey",', '  "privatekey",')),
  M(113, "a .json file that does not parse strictly is not scanned for field names", P(SCAN, "read.ok ? scanCeremonyJson(read.value) : scanJsonKeyTokens(text)", "read.ok ? scanCeremonyJson(read.value) : []")),
  M(108, "a secret used as a field name is echoed back in the finding", P(SCAN, "(/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(key) ? key : `[key ${index}]`)", "key")),

  // ── isolation ──
  M(110, "a governance module draws randomness (key generation creeps in)", P(VOCAB, 'export const GOVERNANCE_FORMAT_VERSION = "0.1";', 'export const GOVERNANCE_FORMAT_VERSION = "0.1";\nexport const SEED_SOURCE = "random' + 'Bytes(32)";')),
  M(111, "a governance module ships a default root (a 32-byte literal)", P(VOCAB, 'export const GOVERNANCE_VERIFICATION_VERSION = "0.1";', 'export const GOVERNANCE_VERIFICATION_VERSION = "0.1";\nexport const DEFAULT_ROOT = "0000000000000000000000000000000000000000000000000000000000000001";')),
  M(112, "the public WallPrint barrel exports the ceremony verifier", P("index.ts", 'export { WallPrintError, finding } from "./errors.ts";', 'export { WallPrintError, finding } from "./errors.ts";\nexport { verifyGovernance } from "./governance-verify.ts";')),
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

const read = (file: string): string => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
const countOf = (text: string, find: string): number => (find === "" ? 0 : text.split(find).length - 1);

if (process.argv.includes("--check")) {
  let bad = 0;
  const ids = new Set<number>();
  for (const m of MUTANTS) {
    if (ids.has(m.id)) {
      console.error(`mutant ${m.id}: duplicate id`);
      bad++;
    }
    ids.add(m.id);
    for (const p of m.patches) {
      const n = countOf(read(p.file), p.find);
      if (n !== 1) {
        console.error(`mutant ${m.id}: patch text appears ${n} times in ${p.file}`);
        bad++;
      }
    }
  }
  console.log(`${MUTANTS.length} mutants, ${MUTANTS.reduce((n, m) => n + m.patches.length, 0)} patches checked${bad === 0 ? ": every patch text is present and unique" : ""}`);
  process.exit(bad === 0 ? 0 : 1);
}

const original = new Map<string, string>();
// One run at a time. The lock is overwritten, never deleted (the repository bans deleting outside its owned-temp helper): "HELD:<pid>" while a run is
// live, "FREE" after. A "HELD" whose process is gone is a run that died; its mutant may still be in the tree, which `git status` shows.
const lock = join(root, "node_modules", ".wallprint-governance-mutation.lock");
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
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}
process.on("uncaughtException", (error) => {
  restore();
  console.error(error);
  process.exit(1);
});

const running = holder();
if (running !== null && running !== process.pid && alive(running)) {
  console.error(`another mutation run (pid ${running}) is live. Run this alone: it rewrites sources in place.`);
  process.exit(3);
}
if (running !== null && !alive(running)) console.warn(`a previous run (pid ${running}) did not finish: check that \`git status\` shows the sources clean.`);
writeFileSync(lock, `HELD:${process.pid}`);

const only = new Set((process.argv.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length).split(",").filter((s) => s !== "").map(Number));
const selected = only.size === 0 ? MUTANTS : MUTANTS.filter((m) => only.has(m.id));

try {
  const baseline = await suites();
  const red = baseline.filter((r) => !r.ok);
  if (red.length > 0) {
    console.error(`baseline is not green: ${red.map((r) => r.file).join(", ")}`);
    process.exitCode = 2;
  } else {
    console.log(`baseline green: ${SUITES.length} suites, ${selected.length} of ${MUTANTS.length} mutants`);

    let survivors = 0;
    let weak = 0;
    for (const m of selected) {
      const texts = new Map<string, string>();
      let applicable = true;
      for (const p of m.patches) {
        const text = texts.get(p.file) ?? original.get(p.file) ?? readFileSync(join(root, p.file), "utf8");
        original.set(p.file, original.get(p.file) ?? text);
        const at = text.indexOf(p.find);
        if (at < 0 || text.indexOf(p.find, at + 1) >= 0) {
          console.error(`mutant ${m.id}: the patch text is not unique in ${p.file}`);
          applicable = false;
          break;
        }
        texts.set(p.file, text.slice(0, at) + p.replace + text.slice(at + p.find.length));
      }
      if (!applicable) {
        survivors++;
        continue;
      }
      for (const [file, text] of texts) writeFileSync(join(root, file), text);
      try {
        const killers = (await suites()).filter((r) => !r.ok).map((r) => r.file.replace(`${TEST}/`, "").replace(".test.ts", ""));
        const onlyRegeneration = killers.length > 0 && killers.every((k) => REGENERATION_ONLY.has(k));
        if (killers.length === 0) survivors++;
        if (onlyRegeneration) weak++;
        console.log(`${killers.length === 0 ? "SURVIVED" : onlyRegeneration ? "KILLED* " : "KILLED  "} #${m.id} ${m.name}${killers.length > 0 ? `  <- ${killers.join(", ")}` : ""}`);
      } finally {
        for (const file of texts.keys()) writeFileSync(join(root, file), original.get(file) ?? "");
      }
    }
    console.log(`${selected.length - survivors} of ${selected.length} mutants killed${weak > 0 ? `; ${weak} only by a regeneration suite (marked *)` : ""}`);
    if (survivors > 0) process.exitCode = 1;
  }
} finally {
  restore();
}
