import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SIGNATURE_STATUSES } from "../../src/wallprint/attestation-vocabulary.ts";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { checkpointDigest, type CheckpointEnvelope } from "../../src/wallprint/checkpoint.ts";
import {
  ANCHOR_REASONS,
  ANCHOR_STATUSES,
  CHECKPOINT_DOES_NOT_ESTABLISH,
  CHECKPOINT_ESTABLISHES,
  CHECKPOINT_LIMITATIONS,
  CHECKPOINT_PARSE_STATUSES,
  CROSS_BINDING_REASONS,
  CROSS_BINDING_STATUSES,
  GOVERNANCE_AUTHORIZATION,
  GOVERNANCE_KEY_KNOWLEDGE,
  IDENTITY_REASONS,
  IDENTITY_STATUSES,
  LOG_CHAIN_STATUSES,
  LOG_REASONS,
  LOG_STATE_STATUSES,
  SIGNER_REASONS,
} from "../../src/wallprint/checkpoint-vocabulary.ts";
import { checkpointAnchors, verifyCheckpoint, type CheckpointContext, type CheckpointVerification } from "../../src/wallprint/checkpoint-verify.ts";
import { WHO, assessmentTargetOf, attest, digestOfEnvelope, flipLast, goldenRecord, ledgerOf, pinOf } from "../support/wallprint-attestations.ts";
import {
  GOV,
  INVALID_ROOT,
  PRIMARY_ROOT,
  ROTATED_ROOT,
  alternateLedger,
  checkpointFor,
  checkpointStatement,
  divergedRegistry,
  fillerDigest,
  honestLedger,
  ledgerOfSlots,
  scenario,
  scenarioLedger,
  scenarioRegistry,
  signCheckpointStatement,
  tamperedLedger,
  tamperedRegistry,
  trustRootOf,
  verifyUnderCheckpoint,
} from "../support/wallprint-checkpoints.ts";

const R = scenarioRegistry();
const L = scenarioLedger();
const c5_12 = checkpointFor(R.slice(0, 5), L.slice(0, 12));
const committed = (e: CheckpointEnvelope) => ({ registry: e.statement.registry, acceptanceLedger: e.statement.acceptanceLedger });
const base = (over: CheckpointContext = {}): CheckpointContext => ({ trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: L.slice(0, 12), ...over });
const run = (e: unknown, over: CheckpointContext = {}): CheckpointVerification => verifyCheckpoint(e, base(over));
const anchored = (r: CheckpointVerification): boolean => checkpointAnchors(r) !== null;

describe("checkpoint verification: separate dimensions, never a generic verdict", () => {
  const r = run(c5_12);

  test("the result has exactly the documented dimensions and no verdict field at any depth", () => {
    assert.deepEqual(Object.keys(r).sort(), [
      "acceptanceLedger", "algorithm", "anchor", "checkpointDigest", "committed", "crossBinding", "doesNotEstablish", "establishes", "identity", "limitations", "parse", "parseProblem",
      "purpose", "registry", "signature", "signer", "signerKeyId", "verificationVersion",
    ]);
    const names: string[] = [];
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        names.push(k);
        walk(x);
      }
    };
    walk(r);
    for (const verdict of ["verified", "valid", "ok", "trusted", "authentic", "authenticated", "success", "passed", "accepted", "verdict", "score", "count", "confidence"]) assert.equal(names.includes(verdict), false, verdict);
    for (const v of Object.values(r)) assert.notEqual(typeof v, "boolean", "no top-level boolean");
  });

  test("every dimension value and every reason is drawn from the closed vocabulary", () => {
    const results: CheckpointVerification[] = [
      r,
      run({ ...c5_12, signature: flipLast(c5_12.signature) }),
      run(c5_12, { trustRoot: null }),
      run(c5_12, { trustRoot: INVALID_ROOT }),
      run(c5_12, { keyRegistry: R.slice(0, 4), acceptanceLedger: L.slice(0, 13) }),
      run(c5_12, { keyRegistry: tamperedRegistry(3), acceptanceLedger: tamperedLedger() }),
      run(c5_12, { anchor: committed(c5_12), expectedDigest: "nope" }),
      run(c5_12, { anchor: { nope: 1 } }),
      run(c5_12, { keyRegistry: undefined, acceptanceLedger: undefined }),
      run("not json"),
    ];
    for (const x of results) {
      assert.ok((CHECKPOINT_PARSE_STATUSES as readonly string[]).includes(x.parse));
      assert.ok((SIGNATURE_STATUSES as readonly string[]).includes(x.signature.status));
      assert.ok(GOVERNANCE_KEY_KNOWLEDGE.includes(x.signer.key));
      assert.ok(GOVERNANCE_AUTHORIZATION.includes(x.signer.authorization));
      for (const log of [x.registry, x.acceptanceLedger]) {
        assert.ok(LOG_CHAIN_STATUSES.includes(log.chain));
        assert.ok(LOG_STATE_STATUSES.includes(log.state));
        for (const reason of log.reasons) assert.ok((LOG_REASONS as readonly string[]).includes(reason), reason);
      }
      assert.ok(CROSS_BINDING_STATUSES.includes(x.crossBinding.status));
      assert.ok(ANCHOR_STATUSES.includes(x.anchor.status));
      assert.ok(IDENTITY_STATUSES.includes(x.identity.status));
      for (const reason of x.signer.reasons) assert.ok((SIGNER_REASONS as readonly string[]).includes(reason), reason);
      for (const reason of x.crossBinding.reasons) assert.ok((CROSS_BINDING_REASONS as readonly string[]).includes(reason), reason);
      for (const reason of x.anchor.reasons) assert.ok((ANCHOR_REASONS as readonly string[]).includes(reason), reason);
      for (const reason of x.identity.reasons) assert.ok((IDENTITY_REASONS as readonly string[]).includes(reason), reason);
      for (const l of x.limitations) assert.ok((CHECKPOINT_LIMITATIONS as readonly string[]).includes(l), l);
      assert.deepEqual([...x.limitations], [...new Set(x.limitations)].sort(), "limitations are sorted and unique");
    }
  });

  test("a genuine, authorized, exactly matching, unanchored checkpoint says so in each dimension and states its limitation", () => {
    assert.equal(r.parse, "PARSED");
    assert.deepEqual(r.signature, { status: "VALID", reasons: [] });
    assert.deepEqual(r.signer, { key: "KNOWN", authorization: "AUTHORIZED", reasons: [] });
    assert.deepEqual({ ...r.registry }, { chain: "VALID", state: "MATCHED", committed: "5", supplied: "5", uncovered: "0", reasons: [] });
    assert.deepEqual({ ...r.acceptanceLedger }, { chain: "VALID", state: "MATCHED", committed: "12", supplied: "12", uncovered: "0", reasons: [] });
    assert.deepEqual(r.crossBinding, { status: "CONSISTENT", reasons: [] });
    assert.deepEqual(r.anchor, { status: "NO_ANCHOR", reasons: [] });
    assert.deepEqual([...r.limitations], ["CHECKPOINT_UNANCHORED"]);
    assert.equal(r.checkpointDigest, checkpointDigest(c5_12));
    assert.deepEqual(r.committed, committed(c5_12));
  });

  test("it states what it establishes and, fixed, what it never does: no claim, no attestation, no assessor, no latest state, no time", () => {
    assert.equal(r.establishes, CHECKPOINT_ESTABLISHES);
    assert.deepEqual([...r.doesNotEstablish], [...CHECKPOINT_DOES_NOT_ESTABLISH]);
    const text = r.doesNotEstablish.join(" | ");
    for (const must of ["factual truth", "attestation", "correct, independent or authoritative", "latest state", "after the committed heads", "when the checkpoint was signed", "production key set"]) assert.ok(text.includes(must), must);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.signature) && Object.isFrozen(r.doesNotEstablish));
    assert.deepEqual(run("not json").doesNotEstablish, r.doesNotEstablish, "even a refused input carries the fixed denial");
  });

  test("it is a pure function: the same inputs give the same output, and no input is changed", () => {
    const registry = structuredClone(R.slice(0, 5));
    const ledger = structuredClone(L.slice(0, 12));
    const envelope = structuredClone(c5_12);
    const root = structuredClone(PRIMARY_ROOT);
    const frozen = (v: unknown): unknown => (v !== null && typeof v === "object" ? (Object.values(v).forEach(frozen), Object.freeze(v)) : v);
    [registry, ledger, envelope, root].forEach(frozen);
    const a = verifyCheckpoint(envelope, { trustRoot: root, keyRegistry: registry, acceptanceLedger: ledger });
    const b = verifyCheckpoint(envelope, { trustRoot: root, keyRegistry: registry, acceptanceLedger: ledger });
    assert.deepEqual(a, b);
    assert.deepEqual(a, r);
  });

  test("hostile input never throws and never earns an anchor: junk in every position of the checkpoint and of the context", () => {
    const junk: unknown[] = [null, 0, -1, 1e308, "", "x".repeat(300), [], [[]], {}, { a: { b: { c: 1 } } }, true, "0".repeat(64), "ED25519", "REGISTRY_LEDGER_CHECKPOINT", "5", "12", "synthetic-governance-1"];
    let seed = 20260101;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const paths = [["type"], ["checkpointVersion"], ["statement"], ["signature"], ["statement", "purpose"], ["statement", "signer"], ["statement", "signer", "keyId"], ["statement", "signer", "algorithm"], ["statement", "signer", "publicKey"], ["statement", "registry"], ["statement", "registry", "headVersion"], ["statement", "registry", "headDigest"], ["statement", "acceptanceLedger"], ["statement", "acceptanceLedger", "entryCount"], ["statement", "acceptanceLedger", "headDigest"]];
    assert.equal(anchored(run(c5_12)), true, "the unmutated checkpoint is fully authenticated, so the context is a fully valid one");
    for (let i = 0; i < 400; i++) {
      const doc = structuredClone(c5_12) as unknown as Record<string, unknown>;
      const path = paths[next() % paths.length] ?? [];
      const value = junk[next() % junk.length];
      let cursor = doc;
      for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
      const last = path[path.length - 1] ?? "";
      if (JSON.stringify(cursor[last]) === JSON.stringify(value)) continue;
      cursor[last] = value;
      let result: CheckpointVerification | undefined;
      assert.doesNotThrow(() => {
        result = run(doc);
      }, path.join("."));
      assert.equal(result !== undefined && anchored(result), false, `${path.join(".")} = ${JSON.stringify(value)}`);
    }
    for (const bad of junk) {
      for (const key of ["trustRoot", "keyRegistry", "acceptanceLedger", "anchor", "expectedDigest", "allowExtension"] as const) {
        assert.doesNotThrow(() => verifyCheckpoint(c5_12, { ...base(), [key]: bad }), key);
      }
      assert.doesNotThrow(() => verifyCheckpoint(bad, base()));
    }
  });

  test("no reason or field echoes caller text: hostile strings in the checkpoint, the anchor, the identifier and the logs appear nowhere in the result", () => {
    const needle = "ATTACKER-CONTROLLED-TEXT-7731";
    const hostile = verifyCheckpoint({ ...c5_12, statement: { ...c5_12.statement, signer: { ...c5_12.statement.signer, keyId: needle } } }, { ...base(), expectedDigest: needle, anchor: { registry: needle }, keyRegistry: [needle], acceptanceLedger: [needle] });
    assert.equal(JSON.stringify(hostile).includes(needle), false);
    assert.equal(JSON.stringify(run({ ...c5_12, type: needle })).includes(needle), false);
  });
});

describe("checkpoint verification: the signer is authorized only by the explicit trust root", () => {
  test("a key the root authorizes for this purpose is authorized; a second key added by rotation is too; the first still is", () => {
    assert.equal(run(c5_12).signer.authorization, "AUTHORIZED");
    const second = checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.root2);
    assert.equal(run(second).signer.authorization, "NOT_AUTHORIZED", "the primary root does not list the second key");
    assert.equal(run(second, { trustRoot: ROTATED_ROOT }).signer.authorization, "AUTHORIZED");
    assert.equal(run(c5_12, { trustRoot: ROTATED_ROOT }).signer.authorization, "AUTHORIZED");
  });

  test("a valid signature by a key the root does not list authorizes nothing: signature and authorization are separate dimensions", () => {
    const rogue = checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.rogue);
    const r = run(rogue);
    assert.equal(r.signature.status, "VALID");
    assert.deepEqual(r.signer, { key: "UNKNOWN", authorization: "NOT_AUTHORIZED", reasons: ["SIGNER_UNKNOWN"] });
    assert.equal(anchored(r), false);
  });

  test("an authorized key with an invalid signature is an invalid signature: authorization does not rescue it", () => {
    const r = run({ ...c5_12, signature: flipLast(c5_12.signature) });
    assert.equal(r.signer.authorization, "AUTHORIZED");
    assert.equal(r.signature.status, "INVALID");
    assert.equal(anchored(r), false);
  });

  test("a checkpoint cannot make its key trusted by naming it: the root's own key material must match the statement's, id for id", () => {
    const selfNamed = signCheckpointStatement(checkpointStatement(committed(c5_12), GOV.root1, { publicKeyOf: GOV.rogue }), GOV.rogue.n);
    const r = run(selfNamed);
    assert.equal(r.signature.status, "VALID");
    assert.deepEqual(r.signer, { key: "MATERIAL_MISMATCH", authorization: "NOT_AUTHORIZED", reasons: ["SIGNER_KEY_MATERIAL_MISMATCH"] });
    const sameKeyOtherId = signCheckpointStatement(checkpointStatement(committed(c5_12), { keyId: "synthetic-governance-alias", n: GOV.root1.n }), GOV.root1.n);
    assert.equal(run(sameKeyOtherId).signer.key, "UNKNOWN", "the root's key under a name the root does not list is not the root's key");
  });

  test("the registry being checkpointed cannot authorize the signer of its own checkpoint: its WalletWall publication key is not a governance key", () => {
    const publication = { keyId: WHO.publisher2.keyId, n: WHO.publisher2.n };
    const signed = signCheckpointStatement(checkpointStatement(committed(c5_12), publication), publication.n);
    const r = run(signed);
    assert.equal(r.signature.status, "VALID");
    assert.equal(r.signer.key, "UNKNOWN");
    assert.equal(r.signer.authorization, "NOT_AUTHORIZED");
    assert.ok(R[4]?.signers.some((s) => s.keys.some((k) => k.keyId === publication.keyId && k.status === "ACTIVE")), "the registry does list it as an active publication key");
    assert.equal(anchored(r), false);
  });

  test("a key authorized for another purpose is known and not authorized for this one", () => {
    const standing = checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.standing);
    const r = run(standing);
    assert.equal(r.signature.status, "VALID");
    assert.deepEqual(r.signer, { key: "KNOWN", authorization: "NOT_AUTHORIZED", reasons: ["PURPOSE_NOT_GRANTED"] });
    assert.equal(anchored(r), false);
  });

  test("a different root authorizes a different set: the root is the verifier's input, and removing a key removes its authority", () => {
    const onlyStanding = trustRootOf({ who: GOV.standing, purposes: ["STANDING_HEAD"] });
    assert.equal(run(c5_12, { trustRoot: onlyStanding }).signer.key, "UNKNOWN");
    const moved = trustRootOf({ who: GOV.rogue, purposes: ["REGISTRY_LEDGER_CHECKPOINT"] });
    assert.equal(run(checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.rogue), { trustRoot: moved }).signer.authorization, "AUTHORIZED");
  });

  test("with no root, or an invalid one, nothing is authorized and the verifier says it did not evaluate; it never falls back to a default", () => {
    for (const [root, reason] of [[undefined, "TRUST_ROOT_NOT_SUPPLIED"], [null, "TRUST_ROOT_NOT_SUPPLIED"], [INVALID_ROOT, "TRUST_ROOT_INVALID"], [{}, "TRUST_ROOT_INVALID"], ["root", "TRUST_ROOT_INVALID"], [PRIMARY_ROOT.keys, "TRUST_ROOT_INVALID"]] as const) {
      const r = verifyCheckpoint(c5_12, { ...base(), ...(root === undefined ? { trustRoot: undefined } : { trustRoot: root }) });
      assert.deepEqual(r.signer, { key: "NOT_EVALUATED", authorization: "NOT_EVALUATED", reasons: [reason] }, String(reason));
      assert.equal(anchored(r), false);
    }
    assert.equal(verifyCheckpoint(c5_12).signer.authorization, "NOT_EVALUATED", "no context at all");
  });
});

describe("checkpoint verification: the supplied registry and ledger must be the committed state", () => {
  test("R5 + L12 authenticates R5 + L12 and nothing else: R6 + L12 and R5 + L13 are each refused as a different state", () => {
    assert.equal(anchored(run(c5_12)), true);
    const registryLonger = run(c5_12, { keyRegistry: R.slice(0, 6) });
    assert.equal(registryLonger.registry.state, "MISMATCHED");
    assert.deepEqual(registryLonger.registry.reasons, ["REGISTRY_EXTENDED_BEYOND_CHECKPOINT"]);
    assert.equal(anchored(registryLonger), false);
    const ledgerLonger = run(c5_12, { acceptanceLedger: L.slice(0, 13) });
    assert.equal(ledgerLonger.acceptanceLedger.state, "MISMATCHED");
    assert.deepEqual(ledgerLonger.acceptanceLedger.reasons, ["LEDGER_EXTENDED_BEYOND_CHECKPOINT"]);
    assert.equal(anchored(ledgerLonger), false);
    const both = run(c5_12, { keyRegistry: R.slice(0, 6), acceptanceLedger: L.slice(0, 13) });
    assert.equal(anchored(both), false);
  });

  test("with extension allowed, the committed state must still be an exact prefix, and what follows is reported as not covered, never as authenticated", () => {
    const r = run(c5_12, { keyRegistry: R.slice(0, 6), acceptanceLedger: L.slice(0, 14), allowExtension: true });
    assert.equal(r.registry.state, "EXTENDED");
    assert.equal(r.registry.uncovered, "1");
    assert.equal(r.acceptanceLedger.state, "EXTENDED");
    assert.equal(r.acceptanceLedger.uncovered, "2");
    assert.deepEqual([...r.limitations], ["CHECKPOINT_UNANCHORED", "LEDGER_EXTENDED_BEYOND_CHECKPOINT", "REGISTRY_EXTENDED_BEYOND_CHECKPOINT"]);
    assert.deepEqual(checkpointAnchors(r), { trustAnchor: { version: "5", digest: R[4]?.digest }, acceptanceAnchor: { seq: "12", digest: L[11]?.entryDigest } }, "the anchors stay the committed R5 and L12, not the supplied R6 and L14");
    const diverged = run(c5_12, { keyRegistry: divergedRegistry(6), allowExtension: true });
    assert.deepEqual(diverged.registry.reasons, ["REGISTRY_HEAD_MISMATCH"], "extension is allowed only past the committed head, not instead of it");
  });

  test("truncation is refused whatever the mode, and a truncated log is not the committed one even when its own chain is valid", () => {
    for (const allowExtension of [false, true]) {
      const registry = run(c5_12, { keyRegistry: R.slice(0, 4), allowExtension });
      assert.deepEqual([registry.registry.chain, registry.registry.state, registry.registry.reasons], ["VALID", "MISMATCHED", ["REGISTRY_TRUNCATED"]]);
      const ledger = run(c5_12, { acceptanceLedger: L.slice(0, 11), allowExtension });
      assert.deepEqual([ledger.acceptanceLedger.chain, ledger.acceptanceLedger.state, ledger.acceptanceLedger.reasons], ["VALID", "MISMATCHED", ["LEDGER_TRUNCATED"]]);
      assert.equal(anchored(registry) || anchored(ledger), false);
    }
    assert.equal(run(c5_12, { acceptanceLedger: [] }).acceptanceLedger.reasons[0], "LEDGER_TRUNCATED");
  });

  test("a rewritten log is refused: same length with a different head, a re-chained substitute, a reordered or dropped entry, a different history", () => {
    assert.deepEqual(run(c5_12, { acceptanceLedger: alternateLedger(12) }).acceptanceLedger.reasons, ["LEDGER_HEAD_MISMATCH"]);
    assert.deepEqual(run(c5_12, { keyRegistry: divergedRegistry(5) }).registry.reasons, ["REGISTRY_HEAD_MISMATCH"]);
    const swapped = [...L.slice(0, 12)];
    [swapped[3], swapped[4]] = [swapped[4] as (typeof swapped)[number], swapped[3] as (typeof swapped)[number]];
    assert.deepEqual(run(c5_12, { acceptanceLedger: swapped }).acceptanceLedger.reasons, ["LEDGER_CHAIN_INVALID"]);
    assert.deepEqual(run(c5_12, { acceptanceLedger: [...L.slice(0, 5), ...L.slice(6, 12)] }).acceptanceLedger.reasons, ["LEDGER_CHAIN_INVALID"]);
    assert.deepEqual(run(c5_12, { keyRegistry: [R[0], R[2], R[1], R[3], R[4]] }).registry.reasons, ["REGISTRY_CHAIN_INVALID"]);
    assert.deepEqual(run(c5_12, { keyRegistry: [R[0], R[1], R[3], R[4]] }).registry.reasons, ["REGISTRY_CHAIN_INVALID"]);
    const rechained = ledgerOfSlots(12, R, { 5: { digest: fillerDigest(900), version: 2 }, 11: scenarioSlot(11) });
    assert.deepEqual(run(c5_12, { acceptanceLedger: rechained }).acceptanceLedger.reasons, ["LEDGER_HEAD_MISMATCH"]);
  });

  test("a log that is not a valid chain is not compared at all, and the other log is still judged on its own", () => {
    const registry = run(c5_12, { keyRegistry: tamperedRegistry(3) });
    assert.deepEqual([registry.registry.chain, registry.registry.state, registry.registry.reasons], ["INVALID", "NOT_EVALUATED", ["REGISTRY_CHAIN_INVALID"]]);
    assert.equal(registry.acceptanceLedger.state, "MATCHED");
    assert.deepEqual(registry.crossBinding, { status: "NOT_EVALUATED", reasons: ["STATE_NOT_ESTABLISHED"] });
    const ledger = run(c5_12, { acceptanceLedger: tamperedLedger() });
    assert.deepEqual([ledger.acceptanceLedger.chain, ledger.acceptanceLedger.state, ledger.acceptanceLedger.reasons], ["INVALID", "NOT_EVALUATED", ["LEDGER_CHAIN_INVALID"]]);
    assert.equal(ledger.registry.state, "MATCHED");
    for (const junk of ["x", 5, {}, [{}], [null]]) {
      assert.equal(run(c5_12, { keyRegistry: junk }).registry.chain, "INVALID");
      assert.equal(run(c5_12, { acceptanceLedger: junk }).acceptanceLedger.chain, "INVALID");
    }
  });

  test("a log that is not supplied is reported as not supplied, never assumed to match", () => {
    const r = verifyCheckpoint(c5_12, { trustRoot: PRIMARY_ROOT });
    assert.deepEqual([r.registry.chain, r.registry.state, r.registry.reasons], ["NOT_SUPPLIED", "NOT_EVALUATED", ["REGISTRY_NOT_SUPPLIED"]]);
    assert.deepEqual([r.acceptanceLedger.chain, r.acceptanceLedger.state, r.acceptanceLedger.reasons], ["NOT_SUPPLIED", "NOT_EVALUATED", ["LEDGER_NOT_SUPPLIED"]]);
    assert.equal(anchored(r), false);
  });

  test("the registry and the ledger are judged together: a matching registry beside a rewritten ledger is not enough, and the reverse", () => {
    const mixed = run(c5_12, { keyRegistry: divergedRegistry(5), acceptanceLedger: L.slice(0, 12) });
    assert.equal(mixed.acceptanceLedger.state, "MATCHED");
    assert.equal(mixed.registry.state, "MISMATCHED");
    assert.equal(anchored(mixed), false);
    const other = run(c5_12, { acceptanceLedger: alternateLedger(12) });
    assert.equal(other.registry.state, "MATCHED");
    assert.equal(anchored(other), false);
  });

  test("an empty ledger can be committed: zero entries, no head, and any entry beyond it is not covered", () => {
    const empty = checkpointFor(R.slice(0, 1), []);
    const r = verifyCheckpoint(empty, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 1), acceptanceLedger: [] });
    assert.equal(r.acceptanceLedger.state, "MATCHED");
    assert.equal(anchored(r), true);
    assert.equal(checkpointAnchors(r)?.acceptanceAnchor, null, "an empty prefix covers nothing, so there is no ledger anchor");
    const grown = verifyCheckpoint(empty, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 1), acceptanceLedger: L.slice(0, 1) });
    assert.deepEqual(grown.acceptanceLedger.reasons, ["LEDGER_EXTENDED_BEYOND_CHECKPOINT"]);
  });
});

function scenarioSlot(i: number): { digest: string; version: number } {
  const slot = scenario().slots[i];
  if (slot === undefined) throw new Error("fixture slot missing");
  return slot;
}

describe("checkpoint verification: the ordering rule between the ledger and the registry", () => {
  test("a committed entry that names a registry version past the committed head is refused: the combination cannot have existed", () => {
    const future = ledgerOf([{ digest: fillerDigest(0), pin: pinOf(R, 1) }, { digest: fillerDigest(1), pin: pinOf(R, 4) }]);
    const cp = checkpointFor(R.slice(0, 3), future);
    const r = verifyCheckpoint(cp, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 3), acceptanceLedger: future });
    assert.equal(r.registry.state, "MATCHED");
    assert.equal(r.acceptanceLedger.state, "MATCHED");
    assert.deepEqual(r.crossBinding, { status: "INCONSISTENT", reasons: ["LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION"] });
    assert.equal(anchored(r), false);
  });

  test("a committed entry whose recorded registry digest is not that version's digest in the committed registry is refused", () => {
    const other = divergedRegistry(5);
    const ledger = ledgerOf([{ digest: fillerDigest(0), pin: pinOf(R, 1) }, { digest: fillerDigest(1), pin: pinOf(other, 5) }]);
    const cp = checkpointFor(R.slice(0, 5), ledger);
    const r = verifyCheckpoint(cp, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: ledger });
    assert.deepEqual(r.crossBinding, { status: "INCONSISTENT", reasons: ["LEDGER_REGISTRY_DIGEST_MISMATCH"] });
    assert.equal(anchored(r), false);
  });

  test("a referenced historical version must exist in the supplied chain with its own digest: every version 1 to N is checkable", () => {
    for (let version = 1; version <= 6; version++) {
      const ledger = ledgerOf([{ digest: fillerDigest(version), pin: pinOf(R, version) }]);
      const cp = checkpointFor(R, ledger);
      const r = verifyCheckpoint(cp, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: ledger });
      assert.equal(r.crossBinding.status, "CONSISTENT", `version ${version}`);
    }
  });

  test("only the committed prefix is judged: an entry past it that names a later registry version is not evaluated and not covered", () => {
    const beyond = ledgerOfSlots(14, R, { 12: { digest: fillerDigest(12), version: 6 }, 13: { digest: fillerDigest(13), version: 6 } });
    const cp = checkpointFor(R.slice(0, 5), beyond.slice(0, 12));
    const r = verifyCheckpoint(cp, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: beyond, allowExtension: true });
    assert.equal(r.crossBinding.status, "CONSISTENT");
    assert.equal(r.acceptanceLedger.uncovered, "2");
    assert.deepEqual(checkpointAnchors(r)?.acceptanceAnchor, { seq: "12", digest: beyond[11]?.entryDigest });
  });

  test("against an anchor it advances, an entry appended since the anchor must name the anchored registry head or later", () => {
    const anchor = committed(c5_12);
    const polluted = checkpointFor(R, L.slice(0, 13));
    const r = verifyCheckpoint(polluted, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: L.slice(0, 13), anchor });
    assert.equal(r.anchor.status, "ADVANCES_ANCHOR");
    assert.deepEqual(r.crossBinding, { status: "INCONSISTENT", reasons: ["LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD"] });
    assert.equal(anchored(r), false);
    const honest = honestLedger();
    const ok = verifyCheckpoint(checkpointFor(R, honest), { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: honest, anchor });
    assert.deepEqual([ok.anchor.status, ok.crossBinding.status], ["ADVANCES_ANCHOR", "CONSISTENT"]);
    assert.equal(anchored(ok), true);
  });

  test("the since-the-anchor rule is only about entries after the anchored prefix, and only when the checkpoint advances the anchor", () => {
    const anchor = committed(c5_12);
    const atAnchor = verifyCheckpoint(c5_12, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: L.slice(0, 12), anchor });
    assert.deepEqual([atAnchor.anchor.status, atAnchor.crossBinding.status], ["AT_ANCHOR", "CONSISTENT"], "entries 1 to 12 name versions 1 to 4, older than the anchored head 5, and are inside the anchored prefix");
    const noAnchor = verifyCheckpoint(checkpointFor(R, L.slice(0, 13)), { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: L.slice(0, 13) });
    assert.equal(noAnchor.crossBinding.status, "CONSISTENT", "without an anchor there is nothing to be older than");
    const earlier = verifyCheckpoint(checkpointFor(R, L.slice(0, 13)), { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: L.slice(0, 13), anchor: committed(checkpointFor(R.slice(0, 4), L.slice(0, 12))) });
    assert.equal(earlier.crossBinding.status, "CONSISTENT", "an entry naming exactly the anchored head is allowed: the rule cannot see a back-dating that stays at or after the anchored head");
  });
});

describe("checkpoint verification: rollback is judged against an anchor the caller holds, and an old checkpoint is not an invalid one", () => {
  const c4_9 = checkpointFor(R.slice(0, 4), L.slice(0, 9));
  const held = committed(c5_12);

  test("an older checkpoint is cryptographically valid and authorized, and reported as behind the anchor; it is not authenticated as current", () => {
    const r = verifyCheckpoint(c4_9, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 4), acceptanceLedger: L.slice(0, 9), anchor: held });
    assert.equal(r.signature.status, "VALID");
    assert.equal(r.signer.authorization, "AUTHORIZED");
    assert.equal(r.registry.state, "MATCHED");
    assert.deepEqual(r.anchor, { status: "BEHIND_ANCHOR", reasons: ["CHECKPOINT_BEHIND_ANCHOR"] });
    assert.equal(anchored(r), false);
  });

  test("behind on either log is behind: one equal and one older, and the older state does not become current by matching the other log", () => {
    const registryOnly = checkpointFor(R.slice(0, 4), L.slice(0, 12));
    assert.equal(verifyCheckpoint(registryOnly, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 4), acceptanceLedger: L.slice(0, 12), anchor: held }).anchor.status, "BEHIND_ANCHOR");
    const ledgerOnly = checkpointFor(R.slice(0, 5), L.slice(0, 9));
    assert.equal(verifyCheckpoint(ledgerOnly, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: L.slice(0, 9), anchor: held }).anchor.status, "BEHIND_ANCHOR");
  });

  test("rollback is detected from counts alone, with no logs supplied: the checkpoint says its own counts", () => {
    const r = verifyCheckpoint(c4_9, { trustRoot: PRIMARY_ROOT, anchor: held });
    assert.equal(r.anchor.status, "BEHIND_ANCHOR");
    assert.equal(anchored(r), false);
  });

  test("the anchor's own state is AT the anchor; a state that adds to it is an advance, but only if the supplied logs contain the anchored heads", () => {
    assert.equal(run(c5_12, { anchor: held }).anchor.status, "AT_ANCHOR");
    const honest = honestLedger();
    const next = checkpointFor(R, honest);
    const advance = verifyCheckpoint(next, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: honest, anchor: held });
    assert.deepEqual(advance.anchor, { status: "ADVANCES_ANCHOR", reasons: [] });
    assert.equal(anchored(advance), true);
    const noLogs = verifyCheckpoint(next, { trustRoot: PRIMARY_ROOT, anchor: held });
    assert.deepEqual(noLogs.anchor, { status: "NOT_EVALUATED", reasons: ["ANCHOR_CONTINUITY_NOT_CHECKED"] });
    assert.equal(anchored(noLogs), false);
  });

  test("a fork is not an advance: the same counts with another head, ahead on one log and behind on the other, or a later state on another history", () => {
    const forked = checkpointFor(divergedRegistry(5), L.slice(0, 12));
    assert.equal(verifyCheckpoint(forked, { trustRoot: PRIMARY_ROOT, keyRegistry: divergedRegistry(5), acceptanceLedger: L.slice(0, 12), anchor: held }).anchor.status, "FORKED_FROM_ANCHOR");
    const ledgerForked = checkpointFor(R.slice(0, 5), alternateLedger(12));
    assert.equal(verifyCheckpoint(ledgerForked, { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: alternateLedger(12), anchor: held }).anchor.status, "FORKED_FROM_ANCHOR");
    const crossing = checkpointFor(R, L.slice(0, 9));
    assert.equal(verifyCheckpoint(crossing, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: L.slice(0, 9), anchor: held }).anchor.status, "FORKED_FROM_ANCHOR");
    const elsewhere = checkpointFor(divergedRegistry(6), L);
    const e = verifyCheckpoint(elsewhere, { trustRoot: PRIMARY_ROOT, keyRegistry: divergedRegistry(6), acceptanceLedger: L, anchor: held });
    assert.deepEqual(e.anchor, { status: "FORKED_FROM_ANCHOR", reasons: ["CHECKPOINT_FORKS_FROM_ANCHOR"] });
    assert.equal(anchored(e), false);
  });

  test("an anchor must be exactly a committed state; anything else is an invalid anchor, and the checkpoint is not authenticated against it", () => {
    for (const bad of [{}, "x", 5, [held], { ...held, extra: 1 }, { registry: held.registry }, { ...held, registry: { ...held.registry, headVersion: 5 } }, { ...held, acceptanceLedger: { entryCount: "0", headDigest: "ab".repeat(32) } }, JSON.parse('{"__proto__":{}}')]) {
      const r = run(c5_12, { anchor: bad });
      assert.deepEqual(r.anchor, { status: "ANCHOR_INVALID", reasons: ["ANCHOR_MALFORMED"] }, JSON.stringify(bad));
      assert.ok(r.limitations.includes("CHECKPOINT_UNANCHORED"));
      assert.equal(anchored(r), false);
    }
  });

  test("a previous result's committed state is a usable anchor: hold it, and a later verification is judged against it", () => {
    const first = run(c5_12);
    const honest = honestLedger();
    const later = verifyCheckpoint(checkpointFor(R, honest), { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: honest, anchor: first.committed });
    assert.equal(later.anchor.status, "ADVANCES_ANCHOR");
    assert.equal(run(c5_12, { anchor: later.committed }).anchor.status, "BEHIND_ANCHOR", "and the earlier checkpoint is now behind what the caller holds");
  });

  test("an old checkpoint that is cryptographically valid keeps saying exactly what it committed, and nothing about what came after", () => {
    const r = verifyCheckpoint(c4_9, { trustRoot: PRIMARY_ROOT, keyRegistry: R, acceptanceLedger: L, allowExtension: true });
    assert.equal(r.signature.status, "VALID");
    assert.equal(r.registry.uncovered, "2");
    assert.equal(r.acceptanceLedger.uncovered, "5");
    assert.deepEqual(checkpointAnchors(r)?.trustAnchor, { version: "4", digest: R[3]?.digest });
    assert.deepEqual(checkpointAnchors(r)?.acceptanceAnchor, { seq: "9", digest: L[8]?.entryDigest });
  });
});

describe("checkpoint verification: the identifier a checkpoint is published under is recomputed", () => {
  test("a name that is the envelope's digest matches; any other name is a mismatch; none is not compared", () => {
    assert.equal(run(c5_12).identity.status, "NOT_COMPARED");
    assert.equal(run(c5_12, { expectedDigest: checkpointDigest(c5_12) }).identity.status, "MATCHED");
    const wrong = run(c5_12, { expectedDigest: "ab".repeat(32) });
    assert.deepEqual(wrong.identity, { status: "MISMATCHED", reasons: ["CHECKPOINT_DIGEST_MISMATCH"] });
    assert.equal(anchored(wrong), false);
    for (const bad of ["", 5, {}, checkpointDigest(c5_12).toUpperCase()]) assert.equal(run(c5_12, { expectedDigest: bad }).identity.status, "MISMATCHED");
  });

  test("two checkpoints of the same state by the same key have the same identity, and a different signature is a different artifact", () => {
    const again = checkpointFor(R.slice(0, 5), L.slice(0, 12));
    assert.equal(checkpointDigest(again), checkpointDigest(c5_12), "Ed25519 signing is deterministic");
    assert.notEqual(checkpointDigest(checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.root2)), checkpointDigest(c5_12));
    assert.notEqual(checkpointDigest(checkpointFor(R.slice(0, 6), L.slice(0, 12))), checkpointDigest(c5_12));
  });
});

describe("checkpoint anchors: a prefix is authenticated, not an attestation", () => {
  test("the anchors come from the signed statement, in the shapes the attestation verifier takes, and it accepts them", () => {
    const anchors = checkpointAnchors(run(c5_12));
    assert.deepEqual(anchors, { trustAnchor: { version: "5", digest: R[4]?.digest }, acceptanceAnchor: { seq: "12", digest: L[11]?.entryDigest } });
    const genuine = scenario().genuine;
    const r = verifyAttestation(genuine, { record: goldenRecord(), keyRegistry: R, ...(anchors === null ? {} : { trustAnchor: anchors.trustAnchor }), acceptance: { ledger: L, anchor: anchors?.acceptanceAnchor ?? null } });
    assert.equal(r.limitations.includes("ACCEPTANCE_ANCHOR_MISMATCH"), false);
    assert.equal(r.current.reasons.includes("KEY_REGISTRY_ANCHOR_MISMATCH"), false);
    assert.equal(r.acceptance.status, "PINNED");
  });

  test("every failing dimension withholds the anchors, one at a time", () => {
    const cases: [string, CheckpointVerification][] = [
      ["signature", run({ ...c5_12, signature: flipLast(c5_12.signature) })],
      ["signer", run(c5_12, { trustRoot: trustRootOf({ who: GOV.standing, purposes: ["STANDING_HEAD"] }) })],
      ["registry", run(c5_12, { keyRegistry: divergedRegistry(5) })],
      ["ledger", run(c5_12, { acceptanceLedger: alternateLedger(12) })],
      ["identity", run(c5_12, { expectedDigest: "ab".repeat(32) })],
      ["anchor", run(c5_12, { anchor: { x: 1 } })],
      ["parse", run("not json")],
    ];
    for (const [name, r] of cases) assert.equal(checkpointAnchors(r), null, name);
    assert.notEqual(checkpointAnchors(run(c5_12)), null);
  });

  test("a covered ledger entry gives an attestation no origin it did not earn: an unregistered key stays key-only and a bad signature stays invalid, though both sit inside the authenticated prefix", () => {
    const golden = goldenRecord();
    const target = assessmentTargetOf(golden, "reviewer-y");
    const genuine = scenario().genuine;
    const unregistered = attest("ASSESSMENT_ORIGIN", WHO.unregistered, target);
    const badSignature = { ...genuine, signature: flipLast(genuine.signature) };
    const ledger = ledgerOfSlots(12, R, {
      6: { digest: digestOfEnvelope(unregistered), version: 3 },
      7: { digest: digestOfEnvelope(badSignature), version: 3 },
      11: { digest: digestOfEnvelope(genuine), version: 4 },
    });
    const cp = verifyCheckpoint(checkpointFor(R.slice(0, 5), ledger), { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: ledger });
    assert.notEqual(checkpointAnchors(cp), null, "the whole prefix, all three entries, is authenticated");
    const under = (envelope: unknown): ReturnType<typeof verifyUnderCheckpoint> => verifyUnderCheckpoint(envelope, golden, cp, { keyRegistry: R.slice(0, 5), ledger });
    assert.equal(under(genuine).origin, "BOUND_ASSESSOR", "the control: the genuine attestation earns what it earns");
    const key = under(unregistered);
    assert.deepEqual([key.acceptance.status, key.origin], ["PINNED", "KEY_ONLY"], "accepted, pinned and covered, and still not bound to anyone");
    const bad = under(badSignature);
    assert.deepEqual([bad.signature.status, bad.origin], ["INVALID", "NONE"]);
    const withRecord = under(genuine);
    assert.equal(withRecord.target.status, "MATCHED");
    assert.equal(verifyUnderCheckpoint(genuine, null, cp, { keyRegistry: R.slice(0, 5), ledger }).target.status, "NOT_COMPARED", "and the checkpoint does not stand in for the record");
  });
});
