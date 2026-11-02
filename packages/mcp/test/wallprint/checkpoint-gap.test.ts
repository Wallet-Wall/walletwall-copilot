import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { verifyAcceptanceLedger, type AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import { AttestationStatementSchema } from "../../src/wallprint/attestation.ts";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { KeyRegistrySnapshotSchema, keyRegistryDigest, verifyKeyRegistryChain, type KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { WHO, anchorOf, attest, assessmentTargetOf, digestOfEnvelope, goldenRecord, ledgerAnchor, ledgerOf, pinOf, registryChain } from "../support/wallprint-attestations.ts";

/**
 * The gap the signed checkpoint closes, stated with the code as it was before the checkpoint existed (these tests use only
 * the #29 modules and still hold: the checkpoint is a layer above them, so the old APIs are unchanged).
 *
 * The gap is exactly one thing: there is NO AUTHENTICATED CROSS-BINDING between the signing-key registry and the acceptance
 * ledger. Each log is internally hash-chained and each verifies on its own. Nothing signed commits to both heads together,
 * so a verifier cannot establish that "ledger head L was accepted against registry head R" as one statement by anyone. This
 * is not the claim that history is forgeable in every context: a verifier that holds the right anchors from a channel it
 * relies on is protected, and #29 says so. What is missing is a statement that authenticates the pairing and the anchors.
 */
const chain = registryChain();
const d = (i: number): string => i.toString(16).padStart(64, "0");
const filler = (count: number, startAt = 1): AcceptanceEntry[] =>
  ledgerOf(Array.from({ length: count }, (_, i) => ({ digest: d(startAt + i), pin: pinOf(chain, 1 + Math.min(3, Math.floor(i / 3))) })));

/** A different, fully valid registry chain: the same shape and rules, one binding text changed in every snapshot. */
function alternateChain(source: readonly KeyRegistrySnapshot[]): KeyRegistrySnapshot[] {
  const out: KeyRegistrySnapshot[] = [];
  for (const snapshot of source) {
    const prev = out[out.length - 1];
    const signers = snapshot.signers.map((s) => (s.kind === "WALLETWALL_PUBLISHER" ? { ...s, binding: { ...s.binding, publisher: "WalletWall governance synthetic alternate" } } : s));
    const body = { ...snapshot, signers, previous: prev === undefined ? null : { version: prev.keyRegistryVersion, digest: prev.digest } };
    out.push({ ...body, digest: keyRegistryDigest(body) });
  }
  return out;
}

describe("checkpoint gap (characterization): two logs, each valid alone, with no authenticated cross-binding", () => {
  const ledger = filler(12);

  test("the registry chain verifies on its own, without any ledger", () => {
    const r = verifyKeyRegistryChain(chain);
    assert.equal(r.ok, true);
  });

  test("the acceptance ledger verifies on its own, without any registry", () => {
    const r = verifyAcceptanceLedger(ledger);
    assert.equal(r.ok, true);
    assert.equal(ledger.length, 12);
  });

  test("neither log commits to the other's head: a snapshot has no ledger field, an entry carries only its own per-entry registry pin", () => {
    assert.deepEqual(Object.keys(KeyRegistrySnapshotSchema.shape).sort(), ["digest", "formatVersion", "keyRegistryVersion", "previous", "signers", "type"]);
    assert.deepEqual(Object.keys(ledger[0] ?? {}).sort(), ["acceptedUnder", "attestationDigest", "entryDigest", "previousEntryDigest", "seq"]);
    assert.deepEqual(Object.keys(ledger[0]?.acceptedUnder ?? {}).sort(), ["keyRegistryDigest", "keyRegistryVersion"]);
  });

  test("the one signed statement shape names neither head: nothing signed binds the two logs together", () => {
    assert.deepEqual(Object.keys(AttestationStatementSchema.shape).sort(), ["attestationVersion", "purpose", "signer", "target"]);
  });

  test("mix and match: a ledger pinned to one valid registry still verifies as a ledger beside a different valid registry", () => {
    const other = alternateChain(chain);
    assert.equal(verifyKeyRegistryChain(other).ok, true, "the alternate chain is itself a valid chain");
    assert.notEqual(other[3]?.digest, chain[3]?.digest, "and it is a different registry history");
    assert.equal(verifyAcceptanceLedger(ledger).ok, true, "the ledger, pinned to the first chain's digests, is unaffected: it is read without any registry");
    const pinned = ledger.some((e) => e.acceptedUnder.keyRegistryDigest === chain[(Number(e.acceptedUnder.keyRegistryVersion)) - 1]?.digest);
    assert.equal(pinned, true);
    assert.equal(ledger.some((e) => e.acceptedUnder.keyRegistryDigest === other[(Number(e.acceptedUnder.keyRegistryVersion)) - 1]?.digest), false);
  });

  test("a ledger entry that names a registry version past the registry head is accepted as a ledger", () => {
    const beyond = ledgerOf([{ digest: d(1), pin: pinOf(chain, 1) }, { digest: d(2), pin: { keyRegistryVersion: "99", keyRegistryDigest: d(9) } }]);
    assert.equal(verifyAcceptanceLedger(beyond).ok, true, "no pair-level check relates the entries' registry versions to the registry's head");
    assert.equal(verifyKeyRegistryChain(chain).ok, true);
  });

  test("extending a valid ledger by one entry gives another independently valid ledger: nothing signed says which one was published", () => {
    const longer = filler(13);
    assert.equal(verifyAcceptanceLedger(longer).ok, true);
    assert.equal(longer[11]?.entryDigest, ledger[11]?.entryDigest, "the first twelve entries are byte-identical, so a prefix cannot be told from the whole");
    assert.notEqual(longer[12]?.entryDigest, undefined);
  });

  test("the anchors the attestation verifier takes are plain caller-held values: whichever prefix the caller names is the prefix that is covered", () => {
    const golden = goldenRecord();
    const envelope = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(golden, "reviewer-y"));
    const digest = digestOfEnvelope(envelope);
    const withEntry = (anchorAt: number): ReturnType<typeof verifyAttestation> => {
      const entries = ledgerOf([{ digest: d(1), pin: pinOf(chain, 3) }, { digest, pin: pinOf(chain, 3) }]);
      const anchor = anchorAt === 0 ? ledgerAnchor(entries.slice(0, 1)) : ledgerAnchor(entries);
      return verifyAttestation(envelope, { record: golden, keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger: entries, anchor } });
    };
    assert.equal(withEntry(1).acceptance.status, "PINNED");
    assert.equal(withEntry(0).acceptance.status, "PINNED");
    assert.equal(withEntry(1).limitations.includes("ACCEPTANCE_ANCHOR_MISMATCH"), false, "an anchor is accepted if it names an entry of the ledger the caller holds; nothing says who published that ledger");
  });
});
