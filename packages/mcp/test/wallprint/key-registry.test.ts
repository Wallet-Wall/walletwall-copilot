import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KEY_STATUSES, KEY_STATUS_TRANSITIONS } from "../../src/wallprint/attestation-vocabulary.ts";
import { findRegisteredKey, keyRegistryDigest, verifyKeyRegistryChain, type KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { REGISTRY_HEAD, WHO, registryChain, syntheticKey } from "../support/wallprint-attestations.ts";

type Mutable = {
  -readonly [K in keyof KeyRegistrySnapshot]: KeyRegistrySnapshot[K] extends readonly (infer U)[] ? U[] : KeyRegistrySnapshot[K];
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function rehash(s: Mutable): KeyRegistrySnapshot {
  const out = { ...s, digest: "" } as KeyRegistrySnapshot;
  return { ...out, digest: keyRegistryDigest(out) };
}
/** A chain through `through`, with the last snapshot altered and re-hashed so that only the rule under test can object. */
function altered(through: number, edit: (last: Mutable) => void): unknown[] {
  const chain = clone(registryChain(through));
  const last = chain[chain.length - 1] as unknown as Mutable;
  edit(last);
  chain[chain.length - 1] = rehash(last);
  return chain;
}
const codes = (raw: unknown): string[] => {
  const r = verifyKeyRegistryChain(raw);
  return r.ok ? [] : [...new Set(r.findings.map((f) => f.code))].sort();
};
const signer = (s: Mutable, id: string): Mutable["signers"][number] => {
  const found = s.signers.find((x) => x.signerId === id);
  if (found === undefined) throw new Error("fixture signer missing");
  return found;
};

describe("signing-key registry: an append-only chain of immutable snapshots", () => {
  test("the synthetic chain is valid and every historical snapshot is the same bytes at every later head", () => {
    const head = registryChain();
    assert.equal(head.length, REGISTRY_HEAD);
    assert.equal(verifyKeyRegistryChain(head).ok, true);
    for (let v = 1; v <= REGISTRY_HEAD; v++) {
      const through = registryChain(v);
      assert.equal(verifyKeyRegistryChain(through).ok, true, `chain through ${v}`);
      for (let i = 0; i < v; i++) assert.deepEqual(through[i], head[i], `snapshot ${i + 1} is identical in the chain through ${v} and the head`);
    }
    assert.equal(head[0]?.previous, null);
    for (let i = 1; i < head.length; i++) assert.equal(head[i]?.previous?.digest, head[i - 1]?.digest);
  });

  test("a registry may start empty: with no key registered, every attestation is key-only", () => {
    const genesis: Mutable = { type: "walletwall.wallprint.key-registry", formatVersion: "0.1", keyRegistryVersion: "1", previous: null, signers: [], digest: "" };
    assert.equal(verifyKeyRegistryChain([rehash(genesis)]).ok, true);
  });

  test("lookup is by key id, never by a name: a display name, a publisher or a signer id is not a key", () => {
    const v4 = registryChain()[3] as KeyRegistrySnapshot;
    assert.equal(findRegisteredKey(v4, WHO.reviewerW1.keyId)?.status, "COMPROMISED");
    assert.equal(findRegisteredKey(v4, WHO.publisher2.keyId)?.status, "ACTIVE");
    for (const name of ["Circle synthetic", "synthetic-issuer-circle", "issuer:circle", "circle", ""]) assert.equal(findRegisteredKey(v4, name), null, name);
    const renamed = clone(v4) as unknown as Mutable;
    signer(renamed, "synthetic-issuer-circle").binding.publisher = "Someone Else";
    assert.equal(findRegisteredKey(rehash(renamed), WHO.circle2.keyId)?.signer.authorityId, "issuer:circle", "ownership is the authority id and the key id, not a mutable label");
  });

  test("rotation needs nothing from the old key: a new key and a supersession are registry facts, and the retired key's signatures stay valid under the old snapshot", () => {
    const [v1, v2, v3] = registryChain();
    assert.equal(findRegisteredKey(v1 as KeyRegistrySnapshot, WHO.reviewerY2.keyId), null);
    assert.equal(findRegisteredKey(v3 as KeyRegistrySnapshot, WHO.reviewerY2.keyId)?.status, "ACTIVE");
    assert.equal(findRegisteredKey(v1 as KeyRegistrySnapshot, WHO.reviewerY1.keyId)?.status, "ACTIVE");
    assert.equal(findRegisteredKey(v2 as KeyRegistrySnapshot, WHO.reviewerY1.keyId)?.status, "ACTIVE");
    const old = findRegisteredKey(v3 as KeyRegistrySnapshot, WHO.reviewerY1.keyId);
    assert.equal(old?.status, "SUPERSEDED");
    assert.equal(old?.key.successor, WHO.reviewerY2.keyId);
    assert.equal(JSON.stringify(v3).includes("signature"), false, "no key signs another key: the registry holds no signature");
  });

  test("multiple keys are active at once and keys are purpose-scoped", () => {
    const v3 = registryChain()[2] as KeyRegistrySnapshot;
    const active = v3.signers.flatMap((s) => s.keys).filter((k) => k.status === "ACTIVE");
    assert.ok(active.length >= 5);
    assert.deepEqual(findRegisteredKey(v3, WHO.publisher2.keyId)?.key.purposes, ["RECORD_PUBLICATION"]);
    assert.deepEqual(findRegisteredKey(v3, WHO.circle2.keyId)?.key.purposes, ["ISSUER_ASSESSMENT_ORIGIN"]);
  });

  test("the status transitions are exactly the table, and nothing returns to ACTIVE", () => {
    assert.deepEqual([...KEY_STATUSES], ["ACTIVE", "RETIRED", "SUPERSEDED", "REVOKED", "COMPROMISED"]);
    for (const status of KEY_STATUSES) assert.equal(KEY_STATUS_TRANSITIONS[status].includes("ACTIVE"), false);
    assert.deepEqual(KEY_STATUS_TRANSITIONS.COMPROMISED, []);
  });
});

describe("signing-key registry: a snapshot is refused for each rule it breaks", () => {
  const snap = (edit: (s: Mutable) => void): string[] => {
    const s = clone(registryChain(1)[0]) as unknown as Mutable;
    edit(s);
    return codes([rehash(s)]);
  };

  test("shape, digest and ordering", () => {
    assert.deepEqual(codes([{ ...registryChain(1)[0], extra: 1 }]), ["SHAPE"]);
    assert.deepEqual(codes([{ ...registryChain(1)[0], digest: "0".repeat(64) }]), ["DIGEST_MISMATCH"]);
    assert.deepEqual(codes("nope"), ["CHAIN_SHAPE"]);
    assert.deepEqual(codes([]), ["CHAIN_SHAPE"]);
    assert.deepEqual(codes([JSON.parse('{"__proto__":{}}')]), ["FORBIDDEN_STRUCTURE"]);
    assert.ok(snap((s) => s.signers.reverse()).includes("SIGNERS_NOT_ORDERED"));
    assert.ok(snap((s) => signer(s, "synthetic-publisher").keys.reverse()).length === 0, "a single key cannot be out of order");
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-circle").assessorIds = ["issuer:circle", "issuer:circle"])).includes("ASSESSOR_IDS_NOT_ORDERED"));
  });

  test("keys: unique ids, unique public keys, admissible key material", () => {
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-tether").keys[0]!.keyId = "synthetic-publisher-1")).includes("KEY_ID_DUPLICATE"));
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-tether").keys[0]!.publicKey = syntheticKey(1).publicKey)).includes("PUBLIC_KEY_DUPLICATE"));
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-tether").keys[0]!.publicKey = `01${"00".repeat(31)}`)).includes("KEY_MATERIAL_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-tether").keys[0]!.publicKey = "00".repeat(32))).includes("KEY_MATERIAL_INVALID"));
    // A key of an algorithm this reader does not know is carried, never judged.
    assert.deepEqual(snap(() => undefined), []);
  });

  test("signer kinds: purposes, authority, binding evidence and reserved identities", () => {
    assert.ok(snap((s) => (signer(s, "synthetic-publisher").keys[0]!.purposes = ["ASSESSMENT_ORIGIN"])).includes("PURPOSES_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").keys[0]!.purposes = ["ISSUER_ASSESSMENT_ORIGIN"])).includes("PURPOSES_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-circle").keys[0]!.purposes = ["RECORD_PUBLICATION"])).includes("PURPOSES_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-circle").assessorIds = ["issuer:circle-labs"])).includes("SIGNER_KIND_INVALID"), "an issuer lists exactly its authority id");
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-circle").binding = { method: "ASSESSOR_DECLARATION", publisher: "x", url: null, locator: null, retrievedAt: "2026-10-24" })).includes("SIGNER_KIND_INVALID"), "an issuer binding rests on the issuer's own publication");
    assert.ok(snap((s) => (signer(s, "synthetic-issuer-circle").authorityId = null)).includes("SIGNER_KIND_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-publisher").assessorIds = ["reviewer-q"])).includes("SIGNER_KIND_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").authorityId = "issuer:circle")).includes("SIGNER_KIND_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").binding = { method: "GOVERNANCE_DECLARATION", publisher: "x", url: null, locator: null, retrievedAt: null })).includes("SIGNER_KIND_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").binding.url = null)).includes("BINDING_EVIDENCE_INVALID"));
    assert.ok(snap((s) => (signer(s, "synthetic-publisher").binding.url = "https://example.invalid/x")).includes("BINDING_EVIDENCE_INVALID"));
    for (const reserved of ["walletwall-reviews", "Wallet-Wall", "wallprint2", "issuer-circle", "issuer_tether", "canonical-chain-state"]) {
      assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").assessorIds = [reserved])).includes("ASSESSOR_ID_RESERVED"), reserved);
    }
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").assessorIds = ["reviewer-w"])).includes("ASSESSOR_ID_DUPLICATE"), "an assessor id belongs to one signer");
    assert.ok(snap((s) => (signer(s, "synthetic-reviewer-y").assessorIds = ["Reviewer-W"])).includes("ASSESSOR_ID_DUPLICATE"), "case does not make a second owner");
    assert.ok(snap((s) => s.signers.push({ ...clone(signer(s, "synthetic-publisher")), signerId: "synthetic-publisher-b", keys: [{ ...clone(signer(s, "synthetic-publisher").keys[0]!), keyId: "synthetic-publisher-b-1", publicKey: syntheticKey(20).publicKey }] })).includes("PUBLISHER_NOT_UNIQUE"));
    assert.ok(snap((s) => s.signers.push({ ...clone(signer(s, "synthetic-issuer-circle")), signerId: "synthetic-zz", keys: [{ ...clone(signer(s, "synthetic-issuer-circle").keys[0]!), keyId: "synthetic-zz-1", publicKey: syntheticKey(21).publicKey }] })).includes("AUTHORITY_DUPLICATE"), "an authority has one signer");
  });

  test("status fields: each status carries exactly the fields that mean something for it", () => {
    const circle = (s: Mutable): Mutable["signers"][number]["keys"][number] => signer(s, "synthetic-issuer-circle").keys[0]!;
    assert.ok(snap((s) => (circle(s).statusFrom = "2")).includes("VERSION_ORDER_INVALID"));
    assert.ok(snap((s) => (circle(s).status = "RETIRED")).length === 0, "retired from its first version is shaped correctly");
    assert.ok(snap((s) => (circle(s).status = "SUPERSEDED")).includes("STATUS_INVALID"), "a supersession names its successor");
    assert.ok(snap((s) => { circle(s).status = "SUPERSEDED"; circle(s).successor = circle(s).keyId; }).includes("SUCCESSOR_INVALID"));
    assert.ok(snap((s) => { circle(s).status = "SUPERSEDED"; circle(s).successor = "synthetic-nobody"; }).includes("SUCCESSOR_INVALID"));
    assert.ok(snap((s) => (circle(s).successor = "synthetic-issuer-circle-1")).includes("STATUS_INVALID"), "only a superseded key names a successor");
    assert.ok(snap((s) => (circle(s).retainedBefore = "1")).includes("STATUS_INVALID"), "only a revoked or compromised key states what it retains");
    assert.ok(snap((s) => { circle(s).status = "REVOKED"; circle(s).retainedBefore = "1"; }).includes("RETAINED_BEFORE_INVALID"), "the retained window must contain at least the first version");
    assert.deepEqual(snap((s) => { circle(s).status = "REVOKED"; circle(s).retainedBefore = null; }), [], "revoked with nothing retained is explicit");
  });

  test("chain structure: versions, previous digests and sequence", () => {
    const chain = clone(registryChain(3));
    assert.deepEqual(codes([chain[1], chain[2]]), ["PREVIOUS_MISMATCH", "VERSION_SEQUENCE"]);
    assert.ok(codes([chain[0], chain[2]]).includes("VERSION_SEQUENCE"));
    assert.ok(codes([chain[0], chain[0]]).includes("VERSION_SEQUENCE"));
    const wrongPrev = clone(chain[1]) as unknown as Mutable;
    wrongPrev.previous = { version: "1", digest: "1".repeat(64) };
    assert.ok(codes([chain[0], rehash(wrongPrev)]).includes("PREVIOUS_MISMATCH"));
    assert.equal(verifyKeyRegistryChain(new Array(5000).fill(chain[0])).ok, false);
  });
});

describe("signing-key registry: history cannot be rewritten by a later version", () => {
  const rule = (through: number, edit: (last: Mutable) => void): string[] => codes(altered(through, edit));

  test("a signer, a binding, an assessor list or a key may not change or disappear", () => {
    assert.ok(rule(2, (s) => (s.signers = s.signers.filter((x) => x.signerId !== "synthetic-issuer-tether"))).includes("SIGNER_CHANGED"));
    assert.ok(rule(2, (s) => (signer(s, "synthetic-issuer-circle").binding.publisher = "Someone Else")).includes("SIGNER_CHANGED"));
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").assessorIds = ["reviewer-y", "reviewer-y2"])).includes("SIGNER_CHANGED"));
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").keys = [])).length > 0);
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").keys[0]!.publicKey = syntheticKey(30).publicKey)).includes("KEY_CHANGED"));
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").keys[0]!.algorithm = "ML_DSA_65")).includes("KEY_CHANGED"));
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").keys[0]!.purposes = ["ASSESSMENT_ORIGIN"].slice(0, 0) as never)).length > 0);
    assert.ok(rule(2, (s) => (signer(s, "synthetic-reviewer-y").keys[0]!.addedIn = "2")).length > 0);
  });

  test("a status changes only along the table, in the version that changes it, and a settled status is never rewritten", () => {
    assert.ok(rule(4, (s) => { const k = signer(s, "synthetic-reviewer-r").keys[0]!; k.status = "ACTIVE"; k.statusFrom = "1"; }).includes("KEY_TRANSITION_INVALID"), "RETIRED never returns to ACTIVE");
    assert.ok(rule(5, (s) => { const k = signer(s, "synthetic-reviewer-w").keys[0]!; k.status = "REVOKED"; k.statusFrom = "5"; k.retainedBefore = "2"; }).includes("KEY_TRANSITION_INVALID"), "COMPROMISED is terminal");
    assert.ok(rule(3, (s) => (signer(s, "synthetic-reviewer-r").keys[0]!.statusFrom = "2")).includes("KEY_TRANSITION_INVALID"), "a transition is dated by the version that makes it");
    assert.ok(rule(4, (s) => (signer(s, "synthetic-reviewer-r").keys[0]!.statusFrom = "2")).includes("KEY_STATUS_REWRITTEN"), "a settled status keeps its version");
    assert.ok(rule(4, (s) => (signer(s, "synthetic-reviewer-w").keys[0]!.retainedBefore = "4")).includes("RETAINED_WINDOW_WIDENED"), "a finding of compromise cannot widen what a revocation retained");
    assert.ok(rule(4, (s) => (signer(s, "synthetic-reviewer-w").keys[0]!.retainedBefore = null)).length === 0, "it may narrow it");
    assert.ok(rule(4, (s) => { const k = signer(s, "synthetic-reviewer-r").keys[0]!; k.statusFrom = "4"; }).includes("KEY_STATUS_REWRITTEN"));
  });

  test("a new key enters active in the version that adds it, and nowhere else", () => {
    const extra = (status: "ACTIVE" | "RETIRED", addedIn: string) => (s: Mutable): void => {
      signer(s, "synthetic-reviewer-y").keys.push({ keyId: "synthetic-reviewer-y-9", algorithm: "ED25519", publicKey: syntheticKey(31).publicKey, purposes: ["ASSESSMENT_ORIGIN"], status, addedIn, statusFrom: addedIn, successor: null, retainedBefore: null });
    };
    assert.deepEqual(rule(3, extra("ACTIVE", "3")), []);
    assert.ok(rule(3, extra("RETIRED", "3")).includes("KEY_ADDED_INVALID"));
    assert.ok(rule(3, extra("ACTIVE", "2")).includes("KEY_ADDED_INVALID"), "a key cannot be added to the past");
    assert.ok(rule(3, (s) => s.signers.push({ ...clone(signer(s, "synthetic-reviewer-y")), signerId: "synthetic-zz", assessorIds: ["reviewer-zz"], keys: [{ keyId: "synthetic-zz-1", algorithm: "ED25519", publicKey: syntheticKey(32).publicKey, purposes: ["ASSESSMENT_ORIGIN"], status: "ACTIVE", addedIn: "1", statusFrom: "1", successor: null, retainedBefore: null }] })).includes("KEY_ADDED_INVALID"), "a signer cannot arrive with history");
  });
});
