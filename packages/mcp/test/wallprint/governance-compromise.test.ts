import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { authorizationDigest, bootstrapDigest } from "../../src/wallprint/governance.ts";
import { GOVERNANCE_DOES_NOT_ESTABLISH } from "../../src/wallprint/governance-vocabulary.ts";
import { assessRootReset, governedCheckpointAnchors, heldGovernanceState, verifyGovernance } from "../../src/wallprint/governance-verify.ts";
import { GK, authorizationFor, bootstrapFor, chainOf, checkpointBy, committedAt, governed, publicKeyOf } from "../support/wallprint-governance.ts";

/**
 * The two compromises. A compromised OPERATIONAL key is the easy case: the root replaces it. A compromised ROOT is the highest-severity event:
 * nothing the root signs can repair it, because the attacker signs the same way; only an out-of-band trust reset can. In both cases the
 * historical signatures stay cryptographically valid; what changes is whether they are relied upon.
 */
const root1 = bootstrapFor(GK.root1);
const root1Digest = bootstrapDigest(root1);
const root2 = bootstrapFor(GK.root2, { rootEpoch: "2" });
const root2Digest = bootstrapDigest(root2);
const retained6 = committedAt(6);
const c1 = chainOf([{ key: GK.op1 }]);
const c12 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedAt: retained6 }]);
const c123 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedAt: retained6 }, { key: GK.op3, previousStanding: "COMPROMISED", previousRetainedAt: null }]);
const chain2 = chainOf([{ key: GK.op5 }], GK.root2, "2");
const at = <T,>(list: readonly T[], i: number): T => list[i] as T;
const origins = (digest: string, list: readonly string[]): { origin: string; digest: string }[] => list.map((origin) => ({ origin, digest }));
const pinnedRoot1 = { rootEpoch: "1", rootPublicKey: publicKeyOf(GK.root1), bootstrapDigest: root1Digest };

describe("operational-key compromise: the root replaces the key", () => {
  test("the compromised key's checkpoints keep a valid signature and lose the reliance: the trust state changes, the cryptography does not", () => {
    const checkpoint = checkpointBy(GK.op2, 9);
    const before = governed(checkpoint, c12, 9);
    const after = governed(checkpoint, c123, 9);
    assert.equal(before.checkpoint.signature.status, "VALID");
    assert.equal(after.checkpoint.signature.status, "VALID");
    assert.equal(before.reliance.status, "RELIED_UPON");
    assert.equal(after.reliance.status, "NOT_RELIED_UPON");
    assert.equal(after.reliance.keyStanding, "COMPROMISED");
    assert.deepEqual(after.reliance.reasons, ["KEY_SUPERSEDED_NOT_RETAINED"]);
    assert.equal(after.checkpoint.signer.authorization, "NOT_AUTHORIZED");
    assert.equal(governedCheckpointAnchors(after), null);
  });

  test("the replacement key's checkpoints are relied upon; the earlier retired key keeps what it retained; nothing else changes", () => {
    assert.equal(governed(checkpointBy(GK.op3, 9), c123, 9).reliance.status, "RELIED_UPON");
    assert.equal(governed(checkpointBy(GK.op1, 6), c123, 6).reliance.status, "RELIED_UPON", "the retired key's retained state survives a later compromise of another key");
    assert.deepEqual(governed(checkpointBy(GK.op1, 4), c123, 4).reliance.reasons, ["CHECKPOINT_BEFORE_RETAINED_STATE"]);
    assert.equal(governed(checkpointBy(GK.op1, 9), c123, 9).reliance.status, "NOT_RELIED_UPON");
  });

  test("a compromised key cannot authorize its own replacement, a successor or a new root", () => {
    const stolen = GK.op2;
    const asSuccessor = authorizationFor({ generation: "3", key: GK.attacker, supersedes: { authorizationDigest: authorizationDigest(at(c12, 1)), standing: "RETIRED", retainedAt: committedAt(9) } }, stolen.n);
    assert.deepEqual(verifyGovernance({ bootstrap: root1, authorizations: [...c12, asSuccessor], allowSynthetic: true }).chain.reasons, ["SIGNATURE_MISMATCH"]);
    const asRoot = authorizationFor({ root: stolen, generation: "3", key: GK.attacker, supersedes: { authorizationDigest: authorizationDigest(at(c12, 1)), standing: "RETIRED", retainedAt: committedAt(9) } });
    assert.deepEqual(verifyGovernance({ bootstrap: root1, authorizations: [...c12, asRoot], allowSynthetic: true }).chain.reasons, ["ROOT_MISMATCH"]);
    const newRoot = verifyGovernance({ bootstrap: bootstrapFor(stolen, { rootEpoch: "2" }), allowSynthetic: true, expectedBootstrapDigest: root1Digest });
    assert.equal(newRoot.bootstrap.pin, "MISMATCHED");
    assert.equal(assessRootReset(pinnedRoot1, bootstrapFor(stolen, { rootEpoch: "2" }), [], { allowSynthetic: true }).status, "RESET_REFUSED");
  });

  test("the compromised key's checkpoint cannot be made to look old: past a retained state of nothing, no count or head is accepted", () => {
    for (const count of [1, 4, 6, 9]) assert.equal(governed(checkpointBy(GK.op2, count), c123, count).reliance.status, "NOT_RELIED_UPON", String(count));
  });

  test("a verifier that has not seen the replacement still relies on the compromised key: revocation latency is real and is reported, not hidden", () => {
    const stale = governed(checkpointBy(GK.op2, 9), c12, 9);
    assert.equal(stale.reliance.status, "RELIED_UPON");
    assert.ok(stale.governance.limitations.includes("GOVERNANCE_STATE_UNHELD"), "nothing says this is not an older governance state");
    assert.ok(GOVERNANCE_DOES_NOT_ESTABLISH.some((s) => /latest governance state/.test(s)));
    const holding = heldGovernanceState(verifyGovernance({ bootstrap: root1, authorizations: c123, allowSynthetic: true, expectedBootstrapDigest: root1Digest }));
    const fresh = governed(checkpointBy(GK.op2, 9), c12, 9, { held: holding?.held });
    assert.equal(fresh.reliance.status, "NOT_EVALUATED", "a verifier holding generation 3 refuses the generation-2 state instead of trusting it");
  });

  test("the same checkpoint is judged differently as the governance state advances, and its signature is VALID throughout", () => {
    const checkpoint = checkpointBy(GK.op2, 9);
    const states = [c12, c123].map((chain) => governed(checkpoint, chain, 9));
    assert.deepEqual(states.map((s) => s.checkpoint.signature.status), ["VALID", "VALID"]);
    assert.deepEqual(states.map((s) => s.reliance.status), ["RELIED_UPON", "NOT_RELIED_UPON"]);
    assert.deepEqual(states.map((s) => s.reliance.keyStanding), ["CURRENT", "COMPROMISED"]);
  });
});

describe("root compromise: nothing signed by the root repairs it", () => {
  const attackerGen4 = authorizationFor({ generation: "4", key: GK.attacker, supersedes: { authorizationDigest: authorizationDigest(at(c123, 2)), standing: "RETIRED", retainedAt: committedAt(9) } });
  const defenderGen4 = authorizationFor({ generation: "4", key: GK.op4, supersedes: { authorizationDigest: authorizationDigest(at(c123, 2)), standing: "COMPROMISED", retainedAt: null } });
  const attacker = [...c123, attackerGen4];
  const defender = [...c123, defenderGen4];
  const run = (chain: unknown, over: Record<string, unknown> = {}) => verifyGovernance({ bootstrap: root1, authorizations: chain, allowSynthetic: true, expectedBootstrapDigest: root1Digest, ...over });

  test("whoever holds the root key signs a valid authorization: the attacker's chain verifies under the pinned root, exactly as the defender's does", () => {
    assert.equal(run(attacker).chain.status, "VALID");
    assert.equal(run(defender).chain.status, "VALID");
    assert.equal(run(attacker).keys.at(-1)?.keyId, GK.attacker.keyId);
    assert.equal(governed(checkpointBy(GK.attacker, 9), attacker, 9).reliance.status, "RELIED_UPON");
    assert.equal(governed(checkpointBy(GK.op4, 9), defender, 9).reliance.status, "RELIED_UPON");
  });

  test("a compromised root cannot self-heal: the root's own replacement is indistinguishable from the attacker's, and only a caller who held a state first can tell them apart, after the fact", () => {
    const heldDefender = heldGovernanceState(run(defender))?.held;
    const heldGen3 = heldGovernanceState(run(c123))?.held;
    assert.equal(run(attacker, { held: heldGen3 }).held.status, "ADVANCES_HELD");
    assert.equal(run(defender, { held: heldGen3 }).held.status, "ADVANCES_HELD");
    assert.equal(run(attacker, { held: heldDefender }).held.status, "FORKED_FROM_HELD", "equivocation is visible only to a verifier that already held one side");
    assert.equal(run(defender, { held: heldDefender }).held.status, "AT_HELD");
  });

  test("a reset may not go back to a root key the caller has retired, even at a higher epoch and with two origins", () => {
    const back = bootstrapFor(GK.root1, { rootEpoch: "3" });
    const confirmed = origins(bootstrapDigest(back), ["GITHUB", "WALLETWALL_WEBSITE"]);
    const pinnedRoot2 = { rootEpoch: "2", rootPublicKey: publicKeyOf(GK.root2), bootstrapDigest: root2Digest };
    assert.equal(assessRootReset(pinnedRoot2, back, confirmed, { allowSynthetic: true }).status, "RESET_ACCEPTED", "without the list the library cannot know the key was retired");
    const withRetired = assessRootReset({ ...pinnedRoot2, retiredRootPublicKeys: [publicKeyOf(GK.root1)] }, back, confirmed, { allowSynthetic: true });
    assert.equal(withRetired.status, "RESET_REFUSED");
    assert.deepEqual(withRetired.reasons, ["ROOT_KEY_PREVIOUSLY_RETIRED"]);
    assert.equal(assessRootReset({ ...pinnedRoot2, retiredRootPublicKeys: ["nope"] }, back, confirmed, { allowSynthetic: true }).reasons[0], "PINNED_STATE_MALFORMED");
  });

  test("a root-signed 'new root' is not a reset: a new epoch under the same key, or an authorization naming another root, or any signature offered as a confirmation, is refused", () => {
    const sameKey = bootstrapFor(GK.root1, { rootEpoch: "2" });
    const confirmed = origins(bootstrapDigest(sameKey), ["GITHUB", "WALLETWALL_WEBSITE"]);
    assert.deepEqual(assessRootReset(pinnedRoot1, sameKey, confirmed, { allowSynthetic: true }).reasons, ["ROOT_KEY_UNCHANGED"]);
    const named = authorizationFor({ root: GK.root2, rootEpoch: "2", generation: "1", key: GK.op5 });
    assert.deepEqual(verifyGovernance({ bootstrap: root1, authorizations: [named], allowSynthetic: true }).chain.reasons, ["ROOT_MISMATCH"]);
    const withSignature = [{ origin: "GITHUB", digest: root2Digest, signature: at(chain2, 0).signature }, { origin: "WALLETWALL_WEBSITE", digest: root2Digest }];
    assert.ok(assessRootReset(pinnedRoot1, root2, withSignature, { allowSynthetic: true }).reasons.includes("CONFIRMATIONS_MALFORMED"));
    assert.equal(assessRootReset(pinnedRoot1, root2, [], { allowSynthetic: true }).status, "RESET_REFUSED", "an artifact nobody confirmed is not a reset, however well it is signed");
  });

  test("the reset is an out-of-band act: a higher epoch, a different key and two distinct confirming origins; then the consumer replaces its pin and raises its floor", () => {
    const accepted = assessRootReset(pinnedRoot1, root2, origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"]), { allowSynthetic: true });
    assert.equal(accepted.status, "RESET_ACCEPTED");
    assert.equal(accepted.newRootEpoch, "2");
    assert.equal(accepted.newBootstrapDigest, root2Digest);
    assert.equal(accepted.consumerAction, "REPLACE_PINNED_BOOTSTRAP_AND_RAISE_MINIMUM_EPOCH");
    for (const [what, reasons, args] of [
      ["epoch not greater", ["EPOCH_NOT_GREATER", "ROOT_KEY_UNCHANGED"], [pinnedRoot1, root1, origins(root1Digest, ["GITHUB", "WALLETWALL_WEBSITE"])]],
      ["one origin", ["INSUFFICIENT_INDEPENDENT_ORIGINS"], [pinnedRoot1, root2, origins(root2Digest, ["GITHUB"])]],
      ["the same origin twice", ["INSUFFICIENT_INDEPENDENT_ORIGINS"], [pinnedRoot1, root2, origins(root2Digest, ["GITHUB", "GITHUB"])]],
      ["a confirmation of another digest", ["CONFIRMATION_DIGEST_MISMATCH", "INSUFFICIENT_INDEPENDENT_ORIGINS"], [pinnedRoot1, root2, [...origins(root2Digest, ["GITHUB"]), { origin: "WALLETWALL_WEBSITE", digest: root1Digest }]]],
      ["a malformed pinned state", ["PINNED_STATE_MALFORMED"], [{ rootEpoch: "1" }, root2, origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"])]],
    ] as [string, string[], [unknown, unknown, unknown]][]) {
      const r = assessRootReset(args[0], args[1], args[2], { allowSynthetic: true });
      assert.equal(r.status, "RESET_REFUSED", what);
      assert.deepEqual(r.reasons, reasons, what);
      assert.equal(r.consumerAction, "NONE");
    }
    assert.deepEqual(assessRootReset(pinnedRoot1, root2, origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"])).reasons, ["SYNTHETIC_KEY_REFUSED"], "a production consumer refuses a synthetic candidate");
    for (const hostile of [undefined, null, 1, { get x(): never { throw new Error("y"); } }]) assert.equal(assessRootReset(hostile, hostile, hostile).status, "RESET_REFUSED");
  });

  test("after the reset the attacker's authorizations are worthless: the old root is below the floor, and the new root refuses everything the old root signed", () => {
    assert.deepEqual(run(attacker, { minRootEpoch: "2" }).bootstrap.reasons, ["BOOTSTRAP_EPOCH_BELOW_MINIMUM"]);
    assert.deepEqual(run(attacker, { minRootEpoch: "2" }).keys, []);
    const underNew = verifyGovernance({ bootstrap: root2, authorizations: attacker, allowSynthetic: true, expectedBootstrapDigest: root2Digest, minRootEpoch: "2" });
    assert.equal(underNew.chain.status, "INVALID");
    assert.deepEqual(underNew.chain.reasons, ["ROOT_MISMATCH"]);
    assert.equal(verifyGovernance({ bootstrap: root2, authorizations: chain2, allowSynthetic: true, expectedBootstrapDigest: root2Digest, minRootEpoch: "2" }).chain.status, "VALID");
  });

  test("rollback to an old trusted root is refused: a consumer that has re-pinned does not accept the epoch-1 bootstrap again, even with a longer chain", () => {
    const r = run(attacker, { minRootEpoch: "2", held: heldGovernanceState(verifyGovernance({ bootstrap: root2, authorizations: chain2, allowSynthetic: true }))?.held });
    assert.equal(r.bootstrap.epoch, "BELOW_MINIMUM");
    assert.equal(r.chain.status, "NOT_EVALUATED");
    assert.equal(governed(checkpointBy(GK.attacker, 9), attacker, 9, { minRootEpoch: "2" }).reliance.status, "NOT_EVALUATED");
  });

  test("historical signatures stay cryptographically valid after a reset, and the trust state changes: nothing the old lineage signed is authorized under the new root", () => {
    for (const [key, count] of [[GK.op1, 4], [GK.op3, 9]] as const) {
      const r = governed(checkpointBy(key, count), chain2, count, { bootstrap: root2, minRootEpoch: "2" });
      assert.equal(r.checkpoint.signature.status, "VALID", key.keyId);
      assert.equal(r.reliance.status, "NOT_RELIED_UPON", key.keyId);
      assert.deepEqual(r.reliance.reasons, ["SIGNER_NOT_AUTHORIZED_BY_ROOT"]);
      assert.equal(governedCheckpointAnchors(r), null);
    }
    const fresh = governed(checkpointBy(GK.op5, 9), chain2, 9, { bootstrap: root2, minRootEpoch: "2" });
    assert.equal(fresh.reliance.status, "RELIED_UPON", "the new root re-establishes by authorizing a new key that signs a checkpoint over the logs as reviewed");
  });
});

describe("root loss: no magic recovery path", () => {
  test("existing signed checkpoints remain cryptographically valid and relied upon under the pinned root; new governance authorization requires a new root that consumers bootstrap explicitly", () => {
    const existing = governed(checkpointBy(GK.op3, 9), c123, 9);
    assert.equal(existing.checkpoint.signature.status, "VALID");
    assert.equal(existing.reliance.status, "RELIED_UPON");
    const reset = assessRootReset(pinnedRoot1, root2, origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"]), { allowSynthetic: true });
    assert.equal(reset.status, "RESET_ACCEPTED");
    assert.equal(governed(checkpointBy(GK.op3, 9), chain2, 9, { bootstrap: root2, minRootEpoch: "2" }).reliance.status, "NOT_RELIED_UPON");
  });

  test("there is no recovery path that preserves trust without an existing authorized key: a generation signed by anything else is refused", () => {
    for (const signer of [GK.op1, GK.op2, GK.op3, GK.root2, GK.attacker]) {
      const forged = authorizationFor({ generation: "4", key: GK.op4, supersedes: { authorizationDigest: authorizationDigest(at(c123, 2)), standing: "COMPROMISED", retainedAt: null } }, signer.n);
      assert.deepEqual(verifyGovernance({ bootstrap: root1, authorizations: [...c123, forged], allowSynthetic: true }).chain.reasons, ["SIGNATURE_MISMATCH"], signer.keyId);
    }
  });
});

describe("governance authority is not truth", () => {
  test("no governance result claims a record, an assessor, an issuer or a registry is right; every dimension is about a key and a state", () => {
    const r = governed(checkpointBy(GK.op3, 9), c123, 9);
    const text = JSON.stringify({ governance: r.governance, reliance: r.reliance });
    assert.doesNotMatch(text, /"(?:verified|trusted|certified|endorsed|truth|safe|solvent)"/i);
    for (const denial of [/factual truth/, /production root/, /ceremony took place/, /uncompromised/, /latest governance state/, /investment merit/]) assert.ok(r.governance.doesNotEstablish.some((s) => denial.test(s)), String(denial));
    assert.ok(c1.length === 1);
  });
});
