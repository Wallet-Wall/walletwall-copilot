import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { committedStateOf, type CommittedState } from "../../src/wallprint/checkpoint.ts";
import { checkpointAnchors, verifyCheckpoint } from "../../src/wallprint/checkpoint-verify.ts";
import { authorizationDigest, bootstrapDigest } from "../../src/wallprint/governance.ts";
import { deriveCheckpointTrustRoot, governedCheckpointAnchors, heldGovernanceState, verifyGovernance, verifyGovernedCheckpoint } from "../../src/wallprint/governance-verify.ts";
import { GOVERNANCE_LIMITS } from "../../src/wallprint/governance-vocabulary.ts";
import { checkpointFor, scenarioRegistry } from "../support/wallprint-checkpoints.ts";
import { GK, GOV_REGISTRY, authorizationFor, bootstrapFor, chainOf, checkpointBy, committedAt, govLedger, governed, governedContext, publicKeyOf } from "../support/wallprint-governance.ts";

/**
 * Rotation, retirement and reliance. Generations are 1..N, each naming the digest of the one it supersedes; a key's standing is what the NEXT
 * authorization says about it; and a checkpoint by a superseded key is relied upon only inside the state the root named.
 */
const root = bootstrapFor();
const rootDigest = bootstrapDigest(root);
const retained = committedAt(6);
const c1 = chainOf([{ key: GK.op1 }]);
const c12 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: retained }]);
const c123 = chainOf([...[{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED" as const, previousRetainedThrough: retained }], { key: GK.op3, previousStanding: "COMPROMISED" as const, previousRetainedThrough: null }]);
const at = <T,>(list: readonly T[], i: number): T => list[i] as T;
const run = (authorizations: unknown, over: Record<string, unknown> = {}) => verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true, expectedBootstrapDigest: rootDigest, ...over });
const held = (chain: readonly Parameters<typeof authorizationDigest>[0][], generation: number): { generation: string; authorizationDigest: string } => ({ generation: String(generation), authorizationDigest: authorizationDigest(at(chain, generation - 1)) });

describe("rotation: generation 1 to 2", () => {
  test("generation 2 supersedes generation 1: the first key is RETIRED, the second is CURRENT, and the state advances", () => {
    const r = run(c12, { held: held(c1, 1) });
    assert.equal(r.chain.status, "VALID");
    assert.equal(r.chain.headGeneration, "2");
    assert.deepEqual(r.keys.map((k) => [k.generation, k.keyId, k.standing]), [["1", GK.op1.keyId, "RETIRED"], ["2", GK.op2.keyId, "CURRENT"]]);
    assert.equal(r.held.status, "ADVANCES_HELD");
    assert.deepEqual(r.keys[0]?.retainedThrough, retained);
    assert.equal(r.keys[1]?.retainedThrough, null);
  });

  test("a retired key stays historically identifiable: its id, material, grant, generation and authorization digest are still listed", () => {
    const r = run(c12);
    const old = r.keys[0];
    assert.equal(old?.keyId, GK.op1.keyId);
    assert.equal(old?.publicKey, publicKeyOf(GK.op1));
    assert.deepEqual(old?.purposes, ["REGISTRY_LEDGER_CHECKPOINT"]);
    assert.equal(old?.authorizationDigest, authorizationDigest(at(c12, 0)));
  });

  test("the trust root derived from the state holds the current key only: the retired key is not in it", () => {
    const derived = deriveCheckpointTrustRoot(run(c12));
    assert.deepEqual(derived?.keys.map((k) => k.keyId), [GK.op2.keyId]);
    assert.deepEqual(deriveCheckpointTrustRoot(run(c1))?.keys.map((k) => k.keyId), [GK.op1.keyId]);
  });

  test("it feeds the unchanged section 23 verifier: a checkpoint by the current key verifies under the derived root, one by the retired key does not", () => {
    const derived = deriveCheckpointTrustRoot(run(c12));
    const logs = { keyRegistry: GOV_REGISTRY, acceptanceLedger: govLedger(9) };
    assert.equal(verifyCheckpoint(checkpointBy(GK.op2, 9), { trustRoot: derived, ...logs }).signer.authorization, "AUTHORIZED");
    const old = verifyCheckpoint(checkpointBy(GK.op1, 9), { trustRoot: derived, ...logs });
    assert.equal(old.signature.status, "VALID");
    assert.equal(old.signer.authorization, "NOT_AUTHORIZED");
    assert.deepEqual(old.signer.reasons, ["SIGNER_UNKNOWN"]);
    assert.notEqual(checkpointAnchors(verifyCheckpoint(checkpointBy(GK.op2, 9), { trustRoot: derived, ...logs })), null);
    assert.equal(checkpointAnchors(old), null);
  });

  test("new checkpoints require the new key: after rotation the retired key's checkpoint beyond what the root retained is not relied upon, though its signature stays valid", () => {
    const late = governed(checkpointBy(GK.op1, 9), c12, 9);
    assert.equal(late.checkpoint.signature.status, "VALID");
    assert.equal(late.reliance.status, "NOT_RELIED_UPON");
    assert.equal(late.reliance.keyStanding, "RETIRED");
    assert.deepEqual(late.reliance.reasons, ["CHECKPOINT_BEYOND_RETAINED_STATE"]);
    assert.equal(late.checkpoint.signer.authorization, "NOT_AUTHORIZED");
    assert.equal(governedCheckpointAnchors(late), null);
    const fresh = governed(checkpointBy(GK.op2, 9), c12, 9);
    assert.equal(fresh.reliance.status, "RELIED_UPON");
    assert.notEqual(governedCheckpointAnchors(fresh), null);
  });

  test("a checkpoint that names an authorized key id with another key's material is not relied upon, though its own signature is valid", () => {
    const forged = checkpointFor(GOV_REGISTRY, govLedger(6), { keyId: GK.op1.keyId, n: GK.attacker.n });
    const r = governed(forged, c1, 6);
    assert.equal(r.checkpoint.signature.status, "VALID");
    assert.equal(r.reliance.status, "NOT_RELIED_UPON");
    assert.deepEqual(r.reliance.reasons, ["SIGNER_KEY_MATERIAL_MISMATCH"]);
    assert.equal(governedCheckpointAnchors(r), null);
    assert.equal(governed(checkpointBy(GK.op1, 6), c1, 6).reliance.status, "RELIED_UPON");
  });
});

describe("rotation: what the retained state means", () => {
  const withRetained = (kept: CommittedState | null) => chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: kept }]);

  test("inside the retained counts the retired key is still relied upon, with a limitation that says only the prefix is", () => {
    for (const count of [1, 4, 5, 6]) {
      const r = governed(checkpointBy(GK.op1, count), withRetained(retained), count);
      assert.equal(r.reliance.status, "RELIED_UPON", String(count));
      assert.deepEqual(r.reliance.limitations, ["SUPERSEDED_KEY_RETAINED_PREFIX_ONLY"]);
      assert.equal(r.reliance.authorizedAtGeneration, "1");
    }
  });

  test("beyond the retained counts it is not: either log past its retained count is beyond", () => {
    for (const count of [7, 8, 9]) assert.deepEqual(governed(checkpointBy(GK.op1, count), withRetained(retained), count).reliance.reasons, ["CHECKPOINT_BEYOND_RETAINED_STATE"], String(count));
    const registryBeyond = checkpointFor(scenarioRegistry(5), govLedger(4), GK.op1);
    assert.deepEqual(governed(registryBeyond, withRetained(retained), 4).reliance.reasons, ["CHECKPOINT_BEYOND_RETAINED_STATE"], "a fifth registry version is past the retained four");
  });

  test("a retained state of nothing retains nothing: even the earliest checkpoint of the retired key is not relied upon", () => {
    for (const count of [1, 4]) assert.deepEqual(governed(checkpointBy(GK.op1, count), withRetained(null), count).reliance.reasons, ["KEY_SUPERSEDED_NOT_RETAINED"]);
  });

  test("at exactly the retained count the heads must be exactly the retained heads: a retired key cannot sign another history at the last state the root reviewed", () => {
    const kept = committedAt(6);
    const fork = checkpointFor(GOV_REGISTRY, govLedger(5).concat(govLedger(6).slice(5, 6).map((e) => ({ ...e, entryDigest: "f".repeat(64) }))), GK.op1);
    const r = governed(fork, withRetained(kept), 6);
    assert.deepEqual(r.reliance.reasons, ["CHECKPOINT_HEAD_DIFFERS_AT_RETAINED_STATE"]);
    assert.equal(r.reliance.status, "NOT_RELIED_UPON");
    const wrongRegistryHead: CommittedState = { ...kept, registry: { ...kept.registry, headDigest: "e".repeat(64) } };
    assert.deepEqual(governed(checkpointBy(GK.op1, 6), withRetained(wrongRegistryHead), 6).reliance.reasons, ["CHECKPOINT_HEAD_DIFFERS_AT_RETAINED_STATE"]);
  });

  test("the retained state is signed: it cannot be widened after the fact", () => {
    const widened = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: committedAt(9) }]);
    const forged = [at(c12, 0), { ...at(widened, 1), signature: at(c12, 1).signature }];
    assert.deepEqual(run(forged).chain.reasons, ["SIGNATURE_MISMATCH"]);
  });

  test("a retired key's grant is still checked: a checkpoint for a purpose it was never granted is not relied upon", () => {
    const grant = authorizationFor({ generation: "1", key: GK.op1 });
    assert.deepEqual(grant.statement.authorizedKey.purposes, ["REGISTRY_LEDGER_CHECKPOINT"]);
    assert.equal(governed(checkpointBy(GK.op1, 6), c12, 6).reliance.status, "RELIED_UPON");
  });
});

describe("rotation: generation monotonicity, stale state and forks", () => {
  test("a stale generation cannot supersede newer state: a chain that stops below the generation the caller holds is behind it, never current", () => {
    const r = run(c12, { held: held(c123, 3) });
    assert.equal(r.chain.status, "VALID", "the chain is internally valid");
    assert.equal(r.held.status, "BEHIND_HELD");
    assert.deepEqual(r.held.reasons, ["GOVERNANCE_ROLLED_BACK_BELOW_HELD_GENERATION"]);
    assert.deepEqual(r.keys, [], "a rolled-back state lists no key as current");
    assert.equal(deriveCheckpointTrustRoot(r), null);
    assert.equal(heldGovernanceState(r), null);
    const rolled = governed(checkpointBy(GK.op2, 9), c12, 9, { held: held(c123, 3) });
    assert.equal(rolled.reliance.status, "NOT_EVALUATED");
    assert.deepEqual(rolled.reliance.reasons, ["GOVERNANCE_STATE_NOT_USABLE"]);
    assert.equal(rolled.checkpoint.signer.authorization, "NOT_EVALUATED");
    assert.equal(governedCheckpointAnchors(rolled), null);
  });

  test("a different history at the held generation is a fork, refused for the same reason", () => {
    const alt = chainOf([{ key: GK.op1 }, { key: GK.op4, previousStanding: "RETIRED", previousRetainedThrough: null }]);
    const r = run(alt, { held: held(c12, 2) });
    assert.equal(r.held.status, "FORKED_FROM_HELD");
    assert.deepEqual(r.held.reasons, ["GOVERNANCE_FORKS_FROM_HELD_STATE"]);
    assert.deepEqual(r.keys, []);
    assert.equal(heldGovernanceState(r), null);
  });

  test("a successor advances, the same state is at the held state, and neither is refused", () => {
    assert.equal(run(c123, { held: held(c12, 2) }).held.status, "ADVANCES_HELD");
    assert.equal(run(c123, { held: held(c123, 3) }).held.status, "AT_HELD");
    assert.equal(run(c123).held.status, "NO_HELD_STATE");
    assert.ok(run(c123).limitations.includes("GOVERNANCE_STATE_UNHELD"));
    assert.ok(!run(c123, { held: held(c123, 3) }).limitations.includes("GOVERNANCE_STATE_UNHELD"));
  });

  test("the state to hold next comes only from a verified, usable result: the head generation and the digest of that authorization", () => {
    const r = run(c123);
    const next = heldGovernanceState(r);
    assert.deepEqual(next?.held, { generation: "3", authorizationDigest: authorizationDigest(at(c123, 2)) });
    assert.equal(next?.rootEpoch, "1");
    assert.equal(next?.bootstrapDigest, rootDigest);
    assert.equal(next?.currentness, "NO_HELD_STATE");
    assert.equal(run(c123, { held: next?.held }).held.status, "AT_HELD");
    assert.equal(run(c12, { held: next?.held }).held.status, "BEHIND_HELD");
  });

  test("a held state that is malformed refuses the whole state: it is never ignored", () => {
    for (const bad of [{ generation: "3" }, { generation: 3, authorizationDigest: rootDigest }, { generation: "0", authorizationDigest: rootDigest }, "3", [], { generation: "3", authorizationDigest: rootDigest, extra: 1 }]) {
      const r = run(c123, { held: bad });
      assert.equal(r.held.status, "HELD_INVALID");
      assert.deepEqual(r.held.reasons, ["HELD_STATE_MALFORMED"]);
      assert.deepEqual(r.keys, []);
    }
  });

  test("generations are 1..N with nothing missing, repeated or reordered: a gap, a duplicate, a swap and an empty chain are refused", () => {
    const a1 = at(c123, 0);
    const a2 = at(c123, 1);
    const a3 = at(c123, 2);
    assert.deepEqual(run([a1, a3]).chain.reasons, ["GENERATION_NOT_CONSECUTIVE", "SUPERSEDES_DIGEST_MISMATCH"]);
    assert.ok(run([a1, a1]).chain.reasons.includes("GENERATION_NOT_CONSECUTIVE"));
    assert.deepEqual(run([a2, a1]).chain.reasons, ["GENERATION_NOT_CONSECUTIVE", "SUPERSEDES_UNEXPECTED"]);
    assert.equal(run([a3]).chain.status, "INVALID");
    assert.equal(run([a1, a2, a2]).chain.status, "INVALID");
    assert.deepEqual(run([]).chain, { status: "NOT_SUPPLIED", count: null, headGeneration: null, failedAt: null, reasons: ["AUTHORIZATIONS_EMPTY"] });
    assert.deepEqual(run(undefined).chain.reasons, ["AUTHORIZATIONS_NOT_SUPPLIED"]);
    assert.deepEqual(run({}).chain.reasons, ["AUTHORIZATION_MALFORMED"]);
    assert.deepEqual(run(new Array<unknown>(GOVERNANCE_LIMITS.maxAuthorizations + 1).fill(a1)).chain.reasons, ["TOO_MANY_AUTHORIZATIONS"]);
  });

  test("an authorization must name exactly the one before it: the digest, and only for a later generation", () => {
    assert.deepEqual(run([at(c1, 0), authorizationFor({ generation: "2", key: GK.op2, supersedes: { authorizationDigest: rootDigest, standing: "RETIRED", retainedThrough: null } })]).chain.reasons, ["SUPERSEDES_DIGEST_MISMATCH"]);
    assert.deepEqual(run([at(c1, 0), authorizationFor({ generation: "2", key: GK.op2 })]).chain.reasons, ["SUPERSEDES_MISSING"]);
    assert.deepEqual(run([authorizationFor({ generation: "1", key: GK.op1, supersedes: { authorizationDigest: rootDigest, standing: "RETIRED", retainedThrough: null } })]).chain.reasons, ["SUPERSEDES_UNEXPECTED"]);
    assert.equal(run([at(c1, 0), authorizationFor({ generation: "2", key: GK.op2, supersedes: { authorizationDigest: authorizationDigest(at(c1, 0)), standing: "RETIRED", retainedThrough: null } })]).chain.status, "VALID");
  });

  test("a failing chain fails whole: the failing position is named and no key is listed or derived from the part that passed", () => {
    const r = run([at(c123, 0), at(c123, 1), { ...at(c123, 2), signature: "00".repeat(64) }]);
    assert.equal(r.chain.status, "INVALID");
    assert.equal(r.chain.failedAt, 2);
    assert.deepEqual(r.keys, []);
    assert.equal(deriveCheckpointTrustRoot(r), null);
  });
});

describe("reliance: a result is a capability, not a shape", () => {
  const usable = run(c123);
  const result = governed(checkpointBy(GK.op3, 9), c123, 9);

  test("a fabricated, copied or JSON-revived governance result mints no held state and no trust root", () => {
    assert.notEqual(heldGovernanceState(usable), null);
    assert.notEqual(deriveCheckpointTrustRoot(usable), null);
    const copies: unknown[] = [{ ...usable }, JSON.parse(JSON.stringify(usable)), structuredClone(usable), Object.create(usable) as unknown, null, undefined, 1, "x", []];
    for (const copy of copies) {
      assert.equal(heldGovernanceState(copy as never), null);
      assert.equal(deriveCheckpointTrustRoot(copy as never), null);
    }
  });

  test("a fabricated, copied or revived governed result mints no anchors, whatever it says about reliance", () => {
    assert.notEqual(governedCheckpointAnchors(result), null);
    assert.deepEqual(governedCheckpointAnchors(result)?.committed, committedStateOf(GOV_REGISTRY, govLedger(9)));
    for (const copy of [{ ...result }, JSON.parse(JSON.stringify(result)), structuredClone(result), null, undefined, 1, {}]) assert.equal(governedCheckpointAnchors(copy as never), null);
    const forged = { ...result, reliance: { ...result.reliance, status: "RELIED_UPON" } };
    assert.equal(governedCheckpointAnchors(forged as never), null);
  });

  test("the anchors follow reliance: a checkpoint that is relied upon yields them, one that is not yields none, and neither changes the section 23 anchors function", () => {
    assert.equal(governedCheckpointAnchors(governed(checkpointBy(GK.op2, 9), c123, 9)), null, "the compromised key");
    assert.notEqual(governedCheckpointAnchors(governed(checkpointBy(GK.op1, 4), c123, 4)), null, "the retired key, inside what it retained");
    assert.equal(governedCheckpointAnchors(governed(checkpointBy(GK.op1, 9), c123, 9)), null, "the retired key, beyond it");
    assert.notEqual(checkpointAnchors(result.checkpoint), null);
  });

  test("an unusable governance state relies on nothing and derives nothing, for every way a state can be unusable", () => {
    const unusable: Record<string, unknown>[] = [
      { bootstrap: undefined },
      { bootstrap: { ...root, extra: 1 } },
      { expectedBootstrapDigest: "0".repeat(64) },
      { minRootEpoch: "2" },
      { held: held(c123, 3), authorizations: c12 },
      { authorizations: [] },
      { authorizations: [{ ...at(c123, 0), signature: "00".repeat(64) }] },
      { allowSynthetic: false },
    ];
    for (const over of unusable) {
      const r = verifyGovernedCheckpoint(checkpointBy(GK.op3, 9), { ...governedContext(c123, 9), ...over });
      assert.notEqual(r.reliance.status, "RELIED_UPON", JSON.stringify(over).slice(0, 60));
      assert.equal(governedCheckpointAnchors(r), null);
      assert.equal(deriveCheckpointTrustRoot(r.governance), null);
    }
  });
});
