import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { rehearse } from "../support/wallprint-governance.ts";

/**
 * The full synthetic rehearsal: fifteen steps, from an isolated environment to a trust reset, with unmistakably non-production keys. Every
 * assertion is about what the verifiers said; none of it generates a key.
 */
const rehearsal = rehearse();
const step = (name: string): Record<string, unknown> => rehearsal.steps.find((s) => s.name === name)?.facts ?? {};
const get = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);

describe("rehearsal: the fifteen steps", () => {
  test("the steps are in the required order, and every key is labelled synthetic and non-production", () => {
    assert.deepEqual(rehearsal.steps.slice(0, 15).map((s) => s.step), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(rehearsal.steps[0]?.name, "isolated environment");
    assert.equal(rehearsal.steps[14]?.name, "trust reset");
    const text = JSON.stringify(rehearsal);
    for (const key of [step("synthetic root generation")["label"], step("operational key generation")["label"]]) assert.match(String(key), /^SYNTHETIC-NON-PRODUCTION-/);
    assert.match(String(step("synthetic root generation")["rootKeyId"]), /^synthetic-/);
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|"privateKey"|"seed"|"secretKey"|"passphrase"/);
  });

  test("1 to 3: an isolated environment, a synthetic root, a public root artifact that is pinned by its own fingerprint", () => {
    assert.equal(step("isolated environment")["mode"], "SYNTHETIC_REHEARSAL");
    assert.equal(step("synthetic root generation")["workingCopyPresent"], "true");
    const artifact = step("public root artifact");
    assert.equal(artifact["pin"], "PINNED");
    assert.deepEqual(artifact["bootstrapReasons"], []);
    assert.match(String(artifact["fingerprint"]), /^(?:[0-9a-f]{8}-){7}[0-9a-f]{8}$/);
  });

  test("4 to 6: three backups, an operational key distinct from the root, and a root authorization that verifies", () => {
    assert.equal(step("backup creation")["copies"], "3");
    assert.equal(step("operational key generation")["distinctFromRoot"], "true");
    const authorization = step("root authorization of the operational key");
    assert.equal(authorization["generation"], "1");
    assert.equal(authorization["chain"], "VALID");
    assert.equal(authorization["signedBytesDomainTag"], "walletwall.wallprint.governance-authorization/0.1/checkpoint-key-authorization");
  });

  test("7 and 8: the operational key signs a checkpoint, and it verifies using only the public bootstrap and the root's authorization", () => {
    const verified = step("checkpoint verified with only the public bootstrap");
    for (const which of ["first", "second"]) {
      assert.equal(get(verified, which, "reliance", "status"), "RELIED_UPON", which);
      assert.equal(get(verified, which, "checkpoint", "signature"), "VALID");
      assert.equal(get(verified, which, "checkpoint", "authorization"), "AUTHORIZED");
      assert.equal(get(verified, which, "anchors"), "AUTHENTICATED");
    }
  });

  test("9 and 10: rotation retires the old key, which keeps what the root retained and loses everything after; the new key is relied upon", () => {
    const rotation = step("operational key rotation (generation 1 to 2)");
    assert.equal(rotation["chain"], "VALID");
    assert.equal(rotation["held"], "ADVANCES_HELD");
    assert.deepEqual(rotation["keys"], ["1:synthetic-checkpoint-signer-001:RETIRED", "2:synthetic-checkpoint-signer-002:CURRENT"]);
    assert.equal(get(rotation, "oldCheckpointWithinRetained", "reliance", "status"), "RELIED_UPON");
    assert.equal(get(rotation, "oldCheckpointAtRetained", "reliance", "status"), "RELIED_UPON");
    assert.equal(get(rotation, "newCheckpointByNewKey", "reliance", "keyStanding"), "CURRENT");
    const retirement = step("old-key retirement");
    assert.equal(retirement["signatureStillValid"], "VALID");
    assert.equal(get(retirement, "lateCheckpointByRetiredKey", "reliance", "status"), "NOT_RELIED_UPON");
    assert.deepEqual(get(retirement, "lateCheckpointByRetiredKey", "reliance", "reasons"), ["CHECKPOINT_BEYOND_RETAINED_STATE"]);
    assert.equal(get(retirement, "staleChainAgainstHeld", "held", "status"), "BEHIND_HELD");
  });

  test("11 and 12: the root comes back from its backup with the same public key, and the recovered root signs the replacement after a compromise", () => {
    const recovery = step("root recovery from backup");
    assert.equal(recovery["recoveredPublicKeyEqualsOriginal"], "true");
    assert.equal(recovery["recoveredBootstrapDigestEqualsOriginal"], "true");
    assert.equal(recovery["wrongPassphrase"], "AUTHENTICATION_FAILED");
    assert.equal(recovery["wrongBackupPublicKeyEqualsOriginal"], "false");
    const replacement = step("replacement operational authorization (generation 3)");
    assert.equal(replacement["signedByRecoveredRoot"], "true");
    assert.deepEqual(replacement["keys"], ["1:synthetic-checkpoint-signer-001:RETIRED", "2:synthetic-checkpoint-signer-002:COMPROMISED", "3:synthetic-checkpoint-signer-003:CURRENT"]);
    assert.equal(get(replacement, "compromisedKeyCheckpoint", "checkpoint", "signature"), "VALID");
    assert.equal(get(replacement, "compromisedKeyCheckpoint", "reliance", "status"), "NOT_RELIED_UPON");
    assert.equal(get(replacement, "newCheckpoint", "reliance", "status"), "RELIED_UPON");
    assert.equal(get(replacement, "rollbackToGeneration2WhenHoldingGeneration3", "held", "status"), "BEHIND_HELD");
  });

  test("13: with the root lost, what exists still verifies, nothing new can be authorized, and the only way forward is an explicit bootstrap to a new root", () => {
    const loss = step("root-loss scenario");
    assert.equal(loss["recovery"], "NO_BACKUP");
    assert.equal(get(loss, "existingStateStillVerifies", "reliance", "status"), "RELIED_UPON");
    assert.match(String(loss["newAuthorizationPossibleWithoutRoot"]), /^false/);
    assert.equal(get(loss, "reset", "status"), "RESET_ACCEPTED");
    assert.equal(get(loss, "oldCheckpointUnderNewRoot", "checkpoint", "signature"), "VALID");
    assert.equal(get(loss, "oldCheckpointUnderNewRoot", "reliance", "status"), "NOT_RELIED_UPON");
    assert.equal(get(loss, "newCheckpointUnderNewRoot", "reliance", "status"), "RELIED_UPON");
  });

  test("14: with the root compromised, the attacker's chain and the defender's both verify under the old root, and only a verifier that held one side can tell them apart", () => {
    const compromise = step("root-compromise scenario");
    assert.equal(get(compromise, "attackerChainUnderOldBootstrap", "chain", "status"), "VALID");
    assert.equal(get(compromise, "defenderChainUnderOldBootstrap", "chain", "status"), "VALID");
    assert.equal(get(compromise, "attackerCheckpointRelied", "reliance", "status"), "RELIED_UPON");
    assert.equal(get(compromise, "attackerChainAgainstDefenderHeldState", "held", "status"), "FORKED_FROM_HELD");
    assert.match(String(compromise["selfHeal"]), /^no:/);
    assert.deepEqual(get(compromise, "attackerChainUnderResetFloor", "bootstrap", "reasons"), ["BOOTSTRAP_EPOCH_BELOW_MINIMUM"]);
  });

  test("15: the trust reset is accepted only out of band, the old root is refused after it, and history keeps a valid signature with no reliance", () => {
    const reset = step("trust reset");
    assert.equal(get(reset, "twoOrigins", "status"), "RESET_ACCEPTED");
    assert.equal(get(reset, "oneOrigin", "status"), "RESET_REFUSED");
    assert.equal(get(reset, "githubTwice", "status"), "RESET_REFUSED");
    assert.deepEqual(get(reset, "sameRootKey", "reasons"), ["ROOT_KEY_UNCHANGED"]);
    assert.equal(get(reset, "newChainUnderNewRoot", "chain", "status"), "VALID");
    assert.equal(get(reset, "oldBootstrapAfterReset", "bootstrap", "epoch"), "BELOW_MINIMUM");
    assert.equal(reset["historicalCheckpointSignature"], "VALID");
    assert.equal(reset["historicalCheckpointReliance"], "NOT_RELIED_UPON");
  });

  test("the three ceremonies that would have produced these artifacts have complete transcripts with no secret-looking material", () => {
    const transcripts = step("ceremony transcripts");
    for (const which of ["rootBootstrap", "rotation", "replacement"]) {
      assert.deepEqual(get(transcripts, which, "reasons"), [], which);
      assert.equal(get(transcripts, which, "structure", "status"), "COMPLETE");
      assert.equal(get(transcripts, which, "artifacts", "status"), "CONSISTENT");
      assert.equal(get(transcripts, which, "secrets"), "CLEAN");
    }
    assert.deepEqual(transcripts["secretScan"], { rootBootstrap: 0, rotation: 0, replacement: 0 });
  });

  test("it is deterministic: a second run is byte-identical, so the committed record can be regenerated and compared", () => {
    assert.equal(JSON.stringify(rehearse()), JSON.stringify(rehearsal));
  });
});

describe("rehearsal: the command", () => {
  test("npm run rehearse:wallprint-governance-ceremony prints the steps, exits 0, and says no production key was generated and no production secret written", () => {
    const out = execFileSync(process.execPath, ["scripts/rehearse-wallprint-governance-ceremony.ts"], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /^SYNTHETIC \/ NON-PRODUCTION: governance key-ceremony rehearsal/);
    for (const name of ["synthetic root generation", "operational key rotation", "root-loss scenario", "root-compromise scenario", "trust reset"]) assert.ok(out.includes(name), name);
    assert.match(out, /production keys generated: NO\s+production secrets written: NO/);
    assert.match(out, /secret-looking findings: 0/);
    const json = JSON.parse(execFileSync(process.execPath, ["scripts/rehearse-wallprint-governance-ceremony.ts", "--json"], { cwd: ROOT, encoding: "utf8" })) as { synthetic: boolean; problems: string[]; steps: unknown[] };
    assert.equal(json.synthetic, true);
    assert.deepEqual(json.problems, []);
    assert.ok(json.steps.length >= 15);
  });
});
