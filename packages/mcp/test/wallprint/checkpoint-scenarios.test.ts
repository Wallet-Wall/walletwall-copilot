import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { verifyAttestation, type AttestationVerification } from "../../src/wallprint/attestation-verify.ts";
import type { AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import { committedStateOf } from "../../src/wallprint/checkpoint.ts";
import { checkpointAnchors, verifyCheckpoint, type CheckpointVerification } from "../../src/wallprint/checkpoint-verify.ts";
import type { KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { WHO, assessmentTargetOf, attest, digestOfEnvelope, goldenRecord } from "../support/wallprint-attestations.ts";
import {
  PRIMARY_ROOT,
  SCENARIO_COMPROMISED_KEY,
  appendRegistry,
  checkpointFor,
  compromiseKey,
  ledgerOfSlots,
  scenario,
  scenarioRegistry,
  supersedeKey,
  verifyUnderCheckpoint,
  type LedgerSlot,
} from "../support/wallprint-checkpoints.ts";
import { registryChain } from "../support/wallprint-attestations.ts";

/**
 * The residual concern #29 left open (T18, follow-up 10): the key registry and the acceptance ledger are separate unsigned logs
 * with no ordering between them, so an entry appended after a key's status changed could name an old registry version. The
 * checkpoint gives the verifier an authenticated cut. These tests construct the scenario step by step and check mechanically which
 * ledger entries are inside the authenticated prefix and which are later.
 *
 *   1. key K is ACTIVE.            2. attestation A is accepted.           3. checkpoint C binds registry R and ledger prefix L.
 *   4. K becomes COMPROMISED or SUPERSEDED.      5. an attacker appends a fake "old" acceptance behind the current state.
 */
const OLD = registryChain(4);

interface World {
  registry: KeyRegistrySnapshot[];
  ledger: AcceptanceEntry[];
  /** Attestations of the compromised key: three genuine ones accepted before the checkpoint, three forged afterwards. */
  genuine: ReturnType<typeof attest>[];
  forged: ReturnType<typeof attest>[];
}

const policies = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `reviewer-y-review-${prefix}${i}`);
const sign = (policy: string): ReturnType<typeof attest> => attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(goldenRecord({ policy }), "reviewer-y"));
const recordFor = (policy: string): ReturnType<typeof goldenRecord> => goldenRecord({ policy });

/** Twelve entries accepted while the key was ACTIVE (entries 10 to 12 are the key's, under registry version 4), then three forged entries naming version 4. */
function world(registry: KeyRegistrySnapshot[]): World {
  const genuine = policies("g", 3).map(sign);
  const forged = policies("f", 3).map(sign);
  const at: Record<number, LedgerSlot> = {};
  genuine.forEach((e, i) => (at[9 + i] = { digest: digestOfEnvelope(e), version: 4 }));
  forged.forEach((e, i) => (at[12 + i] = { digest: digestOfEnvelope(e), version: 4 }));
  return { registry, ledger: ledgerOfSlots(15, registry, at), genuine, forged };
}

const judge = (w: World, checkpoint: CheckpointVerification | null, attestation: ReturnType<typeof attest>, policy: string): AttestationVerification =>
  checkpoint === null
    ? verifyAttestation(attestation, { record: recordFor(policy), keyRegistry: w.registry, acceptance: { ledger: w.ledger, anchor: null } })
    : verifyUnderCheckpoint(attestation, recordFor(policy), checkpoint, { keyRegistry: w.registry, ledger: w.ledger });

const taken = (registryVersions: number, ledgerEntries: number, w: World): CheckpointVerification =>
  verifyCheckpoint(checkpointFor(w.registry.slice(0, registryVersions), w.ledger.slice(0, ledgerEntries)), {
    trustRoot: PRIMARY_ROOT,
    keyRegistry: w.registry,
    acceptanceLedger: w.ledger,
    allowExtension: true,
  });

describe("back-dating after a key compromise: the checkpoint says which entries are inside the authenticated prefix", () => {
  const registry = scenarioRegistry(6);
  const w = world(registry);
  const checkpoint = taken(4, 12, w);

  test("setup: the key was ACTIVE when the checkpoint was taken, and the registry then recorded its compromise", () => {
    const key = (v: number): string | undefined => registry[v - 1]?.signers.flatMap((s) => s.keys).find((k) => k.keyId === SCENARIO_COMPROMISED_KEY)?.status;
    assert.deepEqual([4, 5].map(key), ["ACTIVE", "COMPROMISED"]);
    assert.equal(checkpoint.signature.status, "VALID");
    assert.equal(checkpoint.registry.state, "EXTENDED", "the registry has moved on past the checkpoint");
    assert.equal(checkpoint.acceptanceLedger.state, "EXTENDED", "and so has the ledger");
    assert.equal(checkpoint.acceptanceLedger.uncovered, "3");
  });

  test("entries 1 to 12 are inside the authenticated prefix and entries 13 to 15 are not: the cut is exactly the committed count", () => {
    const anchors = checkpointAnchors(checkpoint);
    assert.deepEqual(anchors?.acceptanceAnchor, { seq: "12", digest: w.ledger[11]?.entryDigest });
    assert.deepEqual(anchors?.trustAnchor, { version: "4", digest: registry[3]?.digest });
    w.genuine.forEach((e, i) => {
      const r = judge(w, checkpoint, e, `reviewer-y-review-g${i}`);
      assert.equal(r.acceptance.status, "PINNED");
      assert.equal(r.current.standing, "HELD", `genuine entry ${10 + i}`);
      assert.deepEqual([r.origin, r.originBasis], ["BOUND_ASSESSOR", "ACCEPTANCE"], `genuine entry ${10 + i}`);
    });
    w.forged.forEach((e, i) => {
      const r = judge(w, checkpoint, e, `reviewer-y-review-f${i}`);
      assert.equal(r.acceptance.status, "PINNED", "the ledger does name it and it names a registry version in which the key was ACTIVE");
      assert.equal(r.atAcceptance.standing, "HELD", "judged at the version it names, nothing is wrong with it");
      assert.equal(r.current.standing, "WITHDRAWN", `forged entry ${13 + i}`);
      assert.ok(r.current.reasons.includes("WITHDRAWN_ACCEPTANCE_UNANCHORED"), `forged entry ${13 + i}`);
      assert.deepEqual([r.origin, r.originBasis], ["KEY_ONLY", "NONE"], `forged entry ${13 + i}`);
    });
  });

  test("without the checkpoint no entry is inside any authenticated prefix: even the genuine acceptances lose their standing", () => {
    for (const [i, e] of w.genuine.entries()) {
      const r = judge(w, null, e, `reviewer-y-review-g${i}`);
      assert.equal(r.current.standing, "WITHDRAWN");
      assert.equal(r.origin, "KEY_ONLY");
      assert.ok(r.limitations.includes("ACCEPTANCE_UNANCHORED"));
    }
  });

  test("the retained window is still the registry's policy: a covered entry outside what the registry retained stays withdrawn, so checkpoint validity is not key standing", () => {
    const strict = appendRegistry(OLD, compromiseKey(SCENARIO_COMPROMISED_KEY, null));
    const sw = world(strict);
    const cp = taken(4, 12, sw);
    assert.notEqual(checkpointAnchors(cp), null);
    for (const [i, e] of sw.genuine.entries()) {
      const r = judge(sw, cp, e, `reviewer-y-review-g${i}`);
      assert.equal(r.acceptance.status, "PINNED");
      assert.equal(r.current.standing, "WITHDRAWN", "the registry retained nothing, and being checkpointed does not change that");
      assert.ok(r.current.reasons.includes("WITHDRAWN_AFTER_ACCEPTANCE"));
      assert.equal(r.origin, "KEY_ONLY");
    }
  });

  test("a superseded key behaves the same way: a checkpointed acceptance keeps its standing, a later appended one does not", () => {
    const next = { keyId: "synthetic-reviewer-y-3", n: 13 };
    const superseded = appendRegistry(OLD, supersedeKey(SCENARIO_COMPROMISED_KEY, next));
    const sw = world(superseded);
    const cp = taken(4, 12, sw);
    sw.genuine.forEach((e, i) => assert.deepEqual([judge(sw, cp, e, `reviewer-y-review-g${i}`).current.standing, judge(sw, cp, e, `reviewer-y-review-g${i}`).origin], ["HELD", "BOUND_ASSESSOR"]));
    sw.forged.forEach((e, i) => assert.deepEqual([judge(sw, cp, e, `reviewer-y-review-f${i}`).current.standing, judge(sw, cp, e, `reviewer-y-review-f${i}`).origin], ["WITHDRAWN", "KEY_ONLY"]));
    const key = superseded[4]?.signers.flatMap((s) => s.keys).find((k) => k.keyId === SCENARIO_COMPROMISED_KEY);
    assert.deepEqual([key?.status, key?.successor], ["SUPERSEDED", "synthetic-reviewer-y-3"]);
  });

  test("an old checkpoint authenticates nothing after its heads, whatever is appended: every ledger position is covered exactly when it is at or below the committed count", () => {
    for (const committed of [3, 8, 12, 13]) {
      const cp = taken(4, committed, w);
      const anchors = checkpointAnchors(cp);
      const seq = anchors?.acceptanceAnchor === null || anchors === null ? 0 : Number(anchors?.acceptanceAnchor?.seq);
      assert.equal(seq, committed);
      for (let position = 1; position <= w.ledger.length; position++) {
        const covered = position <= seq;
        const entry = w.ledger[position - 1];
        assert.ok(entry);
        const attested = [...w.genuine, ...w.forged].find((e) => digestOfEnvelope(e) === entry.attestationDigest);
        if (attested === undefined) continue;
        const policy = [...policies("g", 3), ...policies("f", 3)][[...w.genuine, ...w.forged].indexOf(attested)] ?? "";
        const r = judge(w, cp, attested, policy);
        const unanchoredWithdrawal = r.current.reasons.includes("WITHDRAWN_ACCEPTANCE_UNANCHORED");
        assert.equal(unanchoredWithdrawal, !covered, `position ${position} under a checkpoint of ${committed} entries`);
      }
    }
  });

  test("a registry extension after the checkpoint is not authenticated by it, and in exact mode the extended state is refused as a different one", () => {
    const exact = verifyCheckpoint(checkpointFor(registry.slice(0, 4), w.ledger.slice(0, 12)), { trustRoot: PRIMARY_ROOT, keyRegistry: registry, acceptanceLedger: w.ledger });
    assert.deepEqual([exact.registry.reasons, exact.acceptanceLedger.reasons], [["REGISTRY_EXTENDED_BEYOND_CHECKPOINT"], ["LEDGER_EXTENDED_BEYOND_CHECKPOINT"]]);
    assert.equal(checkpointAnchors(exact), null);
    assert.equal(checkpoint.registry.uncovered, "2");
    assert.ok(checkpoint.limitations.includes("REGISTRY_EXTENDED_BEYOND_CHECKPOINT"));
    assert.ok(checkpoint.limitations.includes("LEDGER_EXTENDED_BEYOND_CHECKPOINT"));
  });
});

describe("registry and ledger evolution: later state needs a later checkpoint, and an old one is never refreshed", () => {
  const registry = scenarioRegistry(6);
  const w = world(registry);

  test("a checkpoint over the later state is a different artifact with its own identity; the earlier one is unchanged and still valid", () => {
    const first = checkpointFor(registry.slice(0, 4), w.ledger.slice(0, 12));
    const second = checkpointFor(registry.slice(0, 6), w.ledger.slice(0, 12));
    assert.notEqual(JSON.stringify(first), JSON.stringify(second));
    const again = verifyCheckpoint(first, { trustRoot: PRIMARY_ROOT, keyRegistry: registry.slice(0, 4), acceptanceLedger: w.ledger.slice(0, 12) });
    assert.equal(again.signature.status, "VALID");
    assert.deepEqual(first.statement.registry.headVersion, "4");
  });

  test("covering the forged entries takes a new checkpoint over a ledger that contains them: the anchored ordering rule then refuses it, because they name a version older than the anchored registry head", () => {
    const earlier = taken(5, 12, w);
    assert.notEqual(checkpointAnchors(earlier), null);
    const later = verifyCheckpoint(checkpointFor(registry, w.ledger.slice(0, 15)), {
      trustRoot: PRIMARY_ROOT,
      keyRegistry: registry,
      acceptanceLedger: w.ledger.slice(0, 15),
      anchor: checkpointAnchors(earlier)?.committed,
    });
    assert.equal(later.signature.status, "VALID");
    assert.equal(later.anchor.status, "ADVANCES_ANCHOR");
    assert.deepEqual(later.crossBinding, { status: "INCONSISTENT", reasons: ["LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD"] });
    assert.equal(checkpointAnchors(later), null, "so the forged entries do not become covered");
    const forgedUnder = judge(w, later, w.forged[0] as ReturnType<typeof attest>, "reviewer-y-review-f0");
    assert.equal(forgedUnder.current.standing, "WITHDRAWN");
  });

  test("the residual window is stated, not hidden: an anchor taken before the compromise was recorded cannot show an entry naming that older head to be back-dated", () => {
    const beforeCompromise = taken(4, 12, w);
    const later = verifyCheckpoint(checkpointFor(registry, w.ledger.slice(0, 15)), {
      trustRoot: PRIMARY_ROOT,
      keyRegistry: registry,
      acceptanceLedger: w.ledger.slice(0, 15),
      anchor: checkpointAnchors(beforeCompromise)?.committed,
    });
    assert.equal(later.crossBinding.status, "CONSISTENT");
    const forgedUnder = judge(w, later, w.forged[0] as ReturnType<typeof attest>, "reviewer-y-review-f0");
    assert.equal(forgedUnder.current.standing, "HELD", "this is the open window: governance signed over a ledger it had not reviewed, and the key's registry policy retained version 4");
    assert.equal(later.doesNotEstablish.some((s) => s.includes("rightly accepted")), true, "and the checkpoint says it does not establish that an entry was rightly accepted");
  });

  test("evolution is never silent: the committed counts only move forward, and a checkpoint whose counts move backward is reported behind the one held", () => {
    const states = [[2, 3], [4, 9], [4, 12], [5, 12], [6, 15]] as const;
    let held: CheckpointVerification["committed"] = null;
    for (const [r, l] of states) {
      const cp = verifyCheckpoint(checkpointFor(registry.slice(0, r), w.ledger.slice(0, l)), { trustRoot: PRIMARY_ROOT, keyRegistry: registry.slice(0, r), acceptanceLedger: w.ledger.slice(0, l), ...(held === null ? {} : { anchor: held }) });
      if (held !== null) assert.ok(["AT_ANCHOR", "ADVANCES_ANCHOR", "FORKED_FROM_ANCHOR"].includes(cp.anchor.status), `${r}/${l}: ${cp.anchor.status}`);
      held = checkpointAnchors(cp)?.committed ?? held;
    }
    const old = verifyCheckpoint(checkpointFor(registry.slice(0, 4), w.ledger.slice(0, 9)), { trustRoot: PRIMARY_ROOT, keyRegistry: registry.slice(0, 4), acceptanceLedger: w.ledger.slice(0, 9), anchor: held });
    assert.equal(old.anchor.status, "BEHIND_ANCHOR");
    assert.equal(old.signature.status, "VALID", "valid, authorized and older");
  });

  test("a checkpoint is a function of the logs it is built over: committedStateOf the same prefix is the same statement", () => {
    assert.deepEqual(committedStateOf(registry.slice(0, 4), w.ledger.slice(0, 12)), committedStateOf(registry.slice(0, 4), w.ledger.slice(0, 12)));
    assert.deepEqual(scenario().slots[11]?.version, 4);
  });
});
