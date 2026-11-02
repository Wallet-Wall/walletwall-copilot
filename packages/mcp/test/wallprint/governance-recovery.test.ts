import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bootstrapDigest } from "../../src/wallprint/governance.ts";
import { verifyGovernance } from "../../src/wallprint/governance-verify.ts";
import {
  BackupRecoveryError,
  GK,
  SYNTHETIC_PASSPHRASE,
  SyntheticWorkingCopy,
  authorizationFor,
  bootstrapFor,
  chainOf,
  checkpointBy,
  envelopeOf,
  governed,
  publicKeyOf,
  recoverFromBackup,
  rehearse,
  sealBackup,
  statementFor,
  transcriptFor,
  verifyTranscriptFor,
} from "../support/wallprint-governance.ts";
import { authorizationDigest, authorizationPreimage } from "../../src/wallprint/governance.ts";

/**
 * Recovery of the synthetic root from a synthetic backup. The "backup" seals a public synthetic label under a public synthetic passphrase,
 * so that every failure here has a real cause; the production backup is made with audited external tooling and is never in this repository.
 */
const root = bootstrapFor(GK.root1);
const rootDigest = bootstrapDigest(root);
const refusal = (fn: () => unknown): string => {
  try {
    fn();
    return "NOT_REFUSED";
  } catch (e) {
    return e instanceof BackupRecoveryError ? e.reason : "OTHER";
  }
};

describe("recovery: the synthetic root comes back from a backup, and only from the right one", () => {
  test("a recovered root has the same public key, hence the same bootstrap artifact and the same fingerprint", () => {
    const recovered = recoverFromBackup(sealBackup(GK.root1));
    assert.equal(recovered.n, GK.root1.n);
    assert.equal(recovered.publicKey, publicKeyOf(GK.root1));
    assert.equal(bootstrapDigest(bootstrapFor({ ...GK.root1, n: recovered.n })), rootDigest);
  });

  test("every copy recovers independently, and losing one loses nothing", () => {
    const copies = [sealBackup(GK.root1), sealBackup(GK.root1), sealBackup(GK.root1)];
    for (const survivors of [copies, copies.slice(1), copies.slice(2)]) assert.equal(recoverFromBackup(survivors[0]).publicKey, publicKeyOf(GK.root1));
  });

  test("the wrong recovery key fails: a wrong passphrase, a damaged blob, a damaged tag, a truncated blob and no backup are each refused for a fixed reason", () => {
    const backup = sealBackup(GK.root1);
    assert.equal(refusal(() => recoverFromBackup(backup, "SYNTHETIC-NON-PRODUCTION-PASSPHRASE-002")), "AUTHENTICATION_FAILED");
    assert.equal(refusal(() => recoverFromBackup(backup, "")), "AUTHENTICATION_FAILED");
    assert.equal(refusal(() => recoverFromBackup({ ...backup, data: Buffer.from(backup.data.map((b, i) => (i === 0 ? b ^ 1 : b))) })), "AUTHENTICATION_FAILED");
    assert.equal(refusal(() => recoverFromBackup({ ...backup, tag: Buffer.from(backup.tag.map((b, i) => (i === 0 ? b ^ 1 : b))) })), "AUTHENTICATION_FAILED");
    assert.equal(refusal(() => recoverFromBackup({ ...backup, data: backup.data.subarray(0, 8) })), "AUTHENTICATION_FAILED");
    assert.equal(refusal(() => recoverFromBackup(undefined)), "NO_BACKUP");
    assert.equal(refusal(() => recoverFromBackup(backup, SYNTHETIC_PASSPHRASE)), "NOT_REFUSED");
  });

  test("the wrong backup fails the comparison that matters: another key's backup recovers, but its public key is not the original's and its fingerprint is not the pinned one", () => {
    const other = recoverFromBackup(sealBackup(GK.root2));
    assert.notEqual(other.publicKey, publicKeyOf(GK.root1));
    assert.notEqual(bootstrapDigest(bootstrapFor({ ...GK.root1, n: other.n })), rootDigest);
    const attempt = verifyGovernance({ bootstrap: bootstrapFor({ ...GK.root1, n: other.n }), allowSynthetic: true, expectedBootstrapDigest: rootDigest });
    assert.equal(attempt.bootstrap.pin, "MISMATCHED");
    const forged = authorizationFor({ generation: "1", key: GK.op1 }, other.n);
    assert.deepEqual(verifyGovernance({ bootstrap: root, authorizations: [forged], allowSynthetic: true }).chain.reasons, ["SIGNATURE_MISMATCH"], "what the wrong key signs is not the pinned root's");
  });
});

describe("recovery: removing the working copy, recovering it, and using it exactly as before", () => {
  test("a removed working copy cannot sign; a recovered one can; the original is not needed", () => {
    const working = new SyntheticWorkingCopy(GK.root1.n);
    assert.equal(working.present, true);
    working.remove();
    assert.equal(working.present, false);
    assert.equal(working.publicKey, null);
    assert.throws(() => working.signPreimageWith(new Uint8Array([1])), /WORKING_COPY_REMOVED/);
    const recovered = new SyntheticWorkingCopy(recoverFromBackup(sealBackup(GK.root1)).n);
    assert.equal(recovered.publicKey, publicKeyOf(GK.root1));
    assert.equal(recovered.signPreimageWith(new Uint8Array([1])).length, 128);
  });

  test("the recovered root authorizes exactly as the original did: the same bytes (Ed25519 is deterministic), the same chain, the same verification", () => {
    const original = new SyntheticWorkingCopy(GK.root1.n);
    const statement = statementFor({ generation: "1", key: GK.op1 });
    const byOriginal = envelopeOf(statement, original.signPreimageWith(authorizationPreimage(statement)));
    original.remove();
    const recovered = new SyntheticWorkingCopy(recoverFromBackup(sealBackup(GK.root1)).n);
    const byRecovered = envelopeOf(statement, recovered.signPreimageWith(authorizationPreimage(statement)));
    assert.deepEqual(byRecovered, byOriginal);
    assert.equal(authorizationDigest(byRecovered), authorizationDigest(byOriginal));
    const first = chainOf([{ key: GK.op1 }])[0];
    assert.deepEqual(first, byOriginal);
    const next = statementFor({ generation: "2", key: GK.op2, supersedes: { authorizationDigest: authorizationDigest(byOriginal), standing: "RETIRED", retainedThrough: null } });
    const second = envelopeOf(next, recovered.signPreimageWith(authorizationPreimage(next)));
    const r = verifyGovernance({ bootstrap: root, authorizations: [byOriginal, second], allowSynthetic: true, expectedBootstrapDigest: rootDigest });
    assert.equal(r.chain.status, "VALID", "a generation signed after recovery extends a chain begun before it");
    assert.deepEqual(r.keys.map((k) => k.standing), ["RETIRED", "CURRENT"]);
    assert.equal(governed(checkpointBy(GK.op2, 9), [byOriginal, second], 9).reliance.status, "RELIED_UPON");
  });

  test("the transcript of a restore records the pinned bootstrap's digest, and a restore to another root does not match", () => {
    const chain = chainOf([{ key: GK.op1 }, { key: GK.op2 }]);
    const t = transcriptFor({ ceremonyId: "synthetic-rehearsal-rotation-001", kind: "OPERATIONAL_KEY_ACTION", bootstrap: root, authorizations: [chain[1] as never] });
    assert.deepEqual(verifyTranscriptFor(t, root, [chain[1] as never]).reasons, []);
    const wrong = verifyTranscriptFor(t, bootstrapFor(GK.root2), [chain[1] as never]);
    assert.ok(wrong.reasons.includes("ARTIFACT_DIGEST_MISMATCH"));
  });
});

describe("recovery: when it cannot happen", () => {
  test("with every backup lost, recovery is refused, nothing can sign generation N+1, and no other key can stand in for the root", () => {
    assert.equal(refusal(() => recoverFromBackup([][0])), "NO_BACKUP");
    const chain = chainOf([{ key: GK.op1 }, { key: GK.op2 }]);
    const stand = authorizationFor({ generation: "3", key: GK.op3, supersedes: { authorizationDigest: authorizationDigest(chain[1] as never), standing: "RETIRED", retainedThrough: null } }, GK.op2.n);
    assert.deepEqual(verifyGovernance({ bootstrap: root, authorizations: [...chain, stand], allowSynthetic: true }).chain.reasons, ["SIGNATURE_MISMATCH"]);
  });

  test("with the root lost, what was signed stays cryptographically valid and relied upon under the pinned root; only new authorization is impossible", () => {
    const chain = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: null }]);
    const r = governed(checkpointBy(GK.op2, 9), chain, 9);
    assert.equal(r.checkpoint.signature.status, "VALID");
    assert.equal(r.reliance.status, "RELIED_UPON");
    assert.ok(r.governance.limitations.includes("GOVERNANCE_STATE_UNHELD"));
  });

  test("the rehearsal's recovery step reports what the verifiers saw", () => {
    const step = rehearse().steps.find((s) => s.name === "root recovery from backup")?.facts as Record<string, string>;
    assert.equal(step["afterRemoval"], "WORKING_COPY_REMOVED");
    assert.equal(step["recoveredPublicKeyEqualsOriginal"], "true");
    assert.equal(step["recoveredBootstrapDigestEqualsOriginal"], "true");
    assert.equal(step["wrongPassphrase"], "AUTHENTICATION_FAILED");
    assert.equal(step["wrongBackupPublicKeyEqualsOriginal"], "false");
    assert.equal(step["noBackup"], "NO_BACKUP");
  });
});
