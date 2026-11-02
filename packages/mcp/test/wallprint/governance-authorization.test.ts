import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest } from "../../src/canonical.ts";
import { domainSeparatedPreimage } from "../../src/wallprint/attestation.ts";
import { DOMAIN_TAGS } from "../../src/wallprint/attestation-vocabulary.ts";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { CHECKPOINT_DOMAIN_TAGS } from "../../src/wallprint/checkpoint-vocabulary.ts";
import { authorizationDigest, authorizationPreimage, bootstrapDigest, parseAuthorization } from "../../src/wallprint/governance.ts";
import { deriveCheckpointTrustRoot, verifyGovernance } from "../../src/wallprint/governance-verify.ts";
import { AUTHORIZATION_DOMAIN_TAGS, GOVERNANCE_LIMITS, NOT_GRANTABLE_PURPOSES, OPERATIONAL_KEY_PURPOSES } from "../../src/wallprint/governance-vocabulary.ts";
import { SYNTHETIC_NOTICE, WHO, attest, goldenRecord, registryChain } from "../support/wallprint-attestations.ts";
import { recordTarget } from "../../src/wallprint/attestation.ts";
import {
  GK,
  altered,
  authorizationFor,
  bootstrapFor,
  chainOf,
  checkpointBy,
  envelopeOf,
  governed,
  publicKeyOf,
  signAuthorization,
  signAuthorizationUnder,
  statementFor,
  wrongSignature,
} from "../support/wallprint-governance.ts";

/**
 * Root-to-operational-key authorization: a detached statement, signed by the pinned root over `tag || 0x00 || RFC 8785(statement)`.
 * Every field is signed, every grant is explicit, and a signature for one purpose is not a signature for another.
 */
const root = bootstrapFor();
const rootDigest = bootstrapDigest(root);
const a1 = authorizationFor({ generation: "1", key: GK.op1 });
const run = (authorizations: unknown, over: Record<string, unknown> = {}) => verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true, expectedBootstrapDigest: rootDigest, ...over });
const reasons = (authorizations: unknown, over: Record<string, unknown> = {}): string[] => run(authorizations, over).chain.reasons;

describe("authorization: the exact signed bytes and the domain tag", () => {
  const statement = a1.statement;
  const encoder = new TextEncoder();

  test("the signed bytes are UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement)), exactly", () => {
    const expected = Uint8Array.from([...encoder.encode(AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION), 0, ...encoder.encode(canonicalize(statement))]);
    assert.deepEqual(authorizationPreimage(statement), expected);
    assert.equal(AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, "walletwall.wallprint.governance-authorization/0.1/checkpoint-key-authorization");
  });

  test("it is the one shared construction, not a second convention: the same function builds every WallPrint preimage", () => {
    assert.deepEqual(authorizationPreimage(statement), domainSeparatedPreimage(AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, statement));
    const preimage = authorizationPreimage(statement);
    assert.equal(preimage.indexOf(0), AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION.length, "the first 0x00 is the one boundary");
    assert.equal(new TextDecoder().decode(preimage.subarray(0, 1)), "w", "the preimage is not JSON: it starts with a letter");
    assert.doesNotThrow(() => canonicalize(statement), "every value is a string, a null or an array of strings: no JSON numbers");
  });

  test("the tag is ASCII with no 0x00, differs from every attestation tag and the checkpoint tag, and is a prefix of none and has none as a prefix", () => {
    const tag = AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION;
    assert.match(tag, /^[\x20-\x7e]+$/);
    assert.ok(!tag.includes("\u0000"));
    for (const other of [...Object.values(DOMAIN_TAGS), ...Object.values(CHECKPOINT_DOMAIN_TAGS)]) {
      assert.notEqual(tag, other);
      assert.ok(!other.startsWith(tag) && !tag.startsWith(other), other);
      assert.ok(!(other + "\u0000").startsWith(tag + "\u0000"));
    }
  });

  test("every field of the statement is inside the signed bytes: changing any one changes them", () => {
    const withSupersedes = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: null }])[1]!.statement;
    const base = authorizationPreimage(withSupersedes);
    const edits: ((s: typeof withSupersedes) => void)[] = [
      (s) => void (s.authorizationVersion = "9.9" as never),
      (s) => void (s.root.keyId = "synthetic-governance-root-009"),
      (s) => void (s.root.algorithm = "OTHER_ALG"),
      (s) => void (s.root.publicKey = publicKeyOf(GK.op1)),
      (s) => void (s.rootEpoch = "2"),
      (s) => void (s.generation = "3"),
      (s) => void (s.authorizedKey.keyId = "synthetic-checkpoint-signer-009"),
      (s) => void (s.authorizedKey.algorithm = "OTHER_ALG"),
      (s) => void (s.authorizedKey.publicKey = publicKeyOf(GK.op3)),
      (s) => void (s.authorizedKey.purposes = ["STANDING_HEAD"]),
      (s) => void (s.supersedes = null),
      (s) => void (s.supersedes && (s.supersedes.standing = "COMPROMISED")),
      (s) => void (s.supersedes && (s.supersedes.authorizationDigest = rootDigest)),
      (s) => void (s.supersedes && (s.supersedes.retainedThrough = { registry: { headVersion: "1", headDigest: rootDigest }, acceptanceLedger: { entryCount: "0", headDigest: null } })),
    ];
    for (const [i, edit] of edits.entries()) {
      const copy = structuredClone(withSupersedes);
      edit(copy);
      assert.notDeepEqual(authorizationPreimage(copy), base, `edit ${i}`);
    }
  });

  test("the digest is the engine's evidenceDigest of the envelope: an address, never signed, and the next authorization names it", () => {
    assert.equal(authorizationDigest(a1), evidenceDigest(a1));
    const [first, second] = chainOf([{ key: GK.op1 }, { key: GK.op2 }]);
    assert.equal(second?.statement.supersedes?.authorizationDigest, authorizationDigest(first as never));
    assert.notEqual(authorizationDigest(wrongSignature(a1)), authorizationDigest(a1));
    assert.notDeepEqual(authorizationPreimage(a1.statement), new TextEncoder().encode(authorizationDigest(a1)), "a digest is never what is signed");
  });
});

describe("authorization: what the root signs, and what fails", () => {
  test("the root authorizes the checkpoint key: the chain verifies and the key is current with exactly the checkpoint grant", () => {
    const r = run([a1]);
    assert.equal(r.chain.status, "VALID");
    assert.deepEqual(r.keys.map((k) => [k.keyId, k.standing, k.purposes]), [[GK.op1.keyId, "CURRENT", ["REGISTRY_LEDGER_CHECKPOINT"]]]);
    assert.deepEqual([...OPERATIONAL_KEY_PURPOSES], ["REGISTRY_LEDGER_CHECKPOINT"]);
  });

  test("the authorization works through the normal checkpoint verifier: the derived trust root is the existing explicit root, holding the one current key", () => {
    const g = run([a1]);
    const derived = deriveCheckpointTrustRoot(g);
    assert.deepEqual(derived, { type: "walletwall.wallprint.governance-trust-root", formatVersion: "0.1", keys: [{ keyId: GK.op1.keyId, algorithm: "ED25519", publicKey: publicKeyOf(GK.op1), purposes: ["REGISTRY_LEDGER_CHECKPOINT"] }] });
    const r = governed(checkpointBy(GK.op1, 6), [a1], 6);
    assert.equal(r.checkpoint.signature.status, "VALID");
    assert.equal(r.checkpoint.signer.authorization, "AUTHORIZED");
    assert.equal(r.reliance.status, "RELIED_UPON");
  });

  test("the wrong root fails: signed by another key, or naming another root, or authorizing under another epoch", () => {
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1 }, GK.root2.n)]), ["SIGNATURE_MISMATCH"]);
    assert.deepEqual(reasons([authorizationFor({ root: GK.root2, generation: "1", key: GK.op1 })]), ["ROOT_MISMATCH"]);
    assert.deepEqual(reasons([authorizationFor({ root: GK.root2, generation: "1", key: GK.op1, rootEpoch: "2" })]), ["ROOT_MISMATCH"]);
    assert.deepEqual(reasons([authorizationFor({ rootEpoch: "2", generation: "1", key: GK.op1 })]), ["ROOT_EPOCH_MISMATCH"]);
    const named = altered(a1, (s) => void (s.root.publicKey = publicKeyOf(GK.root2)));
    assert.deepEqual(reasons([named]), ["ROOT_MISMATCH"]);
    assert.deepEqual(reasons([wrongSignature(a1)]), ["SIGNATURE_MISMATCH"]);
    assert.deepEqual(reasons([{ ...a1, signature: "00".repeat(63) }]), ["SIGNATURE_LENGTH_INVALID"]);
  });

  test("an altered authorized public key, purpose, generation, key id, algorithm, epoch or standing fails: the signature covers all of them", () => {
    const edits: [string, (s: typeof a1.statement) => void, string][] = [
      ["authorized public key", (s) => void (s.authorizedKey.publicKey = publicKeyOf(GK.attacker)), "SIGNATURE_MISMATCH"],
      ["authorized key id", (s) => void (s.authorizedKey.keyId = "synthetic-checkpoint-signer-009"), "SIGNATURE_MISMATCH"],
      ["purpose", (s) => void (s.authorizedKey.purposes = ["REGISTRY_LEDGER_CHECKPOINT", "STANDING_HEAD"]), "SIGNATURE_MISMATCH"],
      ["generation", (s) => void (s.generation = "2"), "SIGNATURE_MISMATCH"],
      ["authorized algorithm", (s) => void (s.authorizedKey.algorithm = "ED448"), "SIGNATURE_MISMATCH"],
      ["supersedes", (s) => void (s.supersedes = { authorizationDigest: rootDigest, standing: "RETIRED", retainedThrough: null }), "SIGNATURE_MISMATCH"],
      ["root epoch", (s) => void (s.rootEpoch = "2"), "ROOT_EPOCH_MISMATCH"],
    ];
    for (const [what, edit, reason] of edits) assert.deepEqual(reasons([altered(a1, edit)]), [reason], what);

    const chain = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: null }]);
    const flipStanding = altered(chain[1] as never, (s) => void (s.supersedes && (s.supersedes.standing = "COMPROMISED")));
    assert.deepEqual(reasons([chain[0], flipStanding]), ["SIGNATURE_MISMATCH"], "the root's decision about the old key cannot be rewritten after signing");
  });

  test("a replay under another domain fails: the checkpoint tag, each attestation tag, bare JSON, a near-miss tag, a missing boundary, a wrong version", () => {
    const tags: (string | null)[] = [
      CHECKPOINT_DOMAIN_TAGS.REGISTRY_LEDGER_CHECKPOINT,
      ...Object.values(DOMAIN_TAGS),
      null,
      "walletwall.wallprint.governance-authorization/0.2/checkpoint-key-authorization",
      "walletwall.wallprint.governance-authorization/0.1/checkpoint-key-authorization ",
      "walletwall.wallprint.governance-authorization/0.1",
      "",
    ];
    for (const tag of tags) assert.deepEqual(reasons([signAuthorizationUnder(a1.statement, tag, GK.root1.n)]), ["SIGNATURE_MISMATCH"], String(tag));
    const noBoundary = new Uint8Array([...new TextEncoder().encode(AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION), ...new TextEncoder().encode(canonicalize(a1.statement))]);
    assert.notDeepEqual(noBoundary, authorizationPreimage(a1.statement));
    assert.deepEqual(reasons([signAuthorizationUnder(a1.statement, AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, GK.root1.n)]), [], "the construction signs and verifies under its own tag");
  });

  test("conversely, an authorization signature is no checkpoint signature and no attestation signature", () => {
    const signedAuthorization = a1.signature;
    assert.notEqual(signedAuthorization, "");
    const checkpoint = checkpointBy(GK.root1, 6);
    const asCheckpoint = { ...checkpoint, signature: signedAuthorization };
    const r = governed(asCheckpoint, [a1], 6);
    assert.notEqual(r.checkpoint.signature.status, "VALID");
    assert.notEqual(r.reliance.status, "RELIED_UPON");
  });

  test("the envelope is a closed schema: unknown fields, a wrong type, a version mismatch, a bad signature encoding and size are refused, never dropped", () => {
    const text = JSON.stringify(a1);
    assert.equal(parseAuthorization(text).ok, true);
    for (const bad of [{ ...a1, extra: 1 }, { ...a1, type: "walletwall.wallprint.attestation" }, { ...a1, signature: "ABCD" }, { ...a1, signature: "" }, { ...a1, statement: { ...a1.statement, label: "x" } }, { ...a1, statement: { ...a1.statement, authorizedKey: { ...a1.statement.authorizedKey, privateKey: "x" } } }, { ...a1, statement: { ...a1.statement, purpose: "RECORD_PUBLICATION" } }]) {
      assert.equal(parseAuthorization(bad).ok, false, JSON.stringify(bad).slice(0, 60));
      assert.deepEqual(reasons([bad]), ["AUTHORIZATION_MALFORMED"]);
    }
    assert.deepEqual(parseAuthorization({ ...a1, authorizationVersion: "9.9" }), { ok: false, problem: "SHAPE", unsupportedVersion: true });
    assert.deepEqual(reasons([{ ...a1, authorizationVersion: "9.9" }]), ["AUTHORIZATION_VERSION_UNSUPPORTED"]);
    assert.deepEqual(parseAuthorization({ ...a1, statement: { ...a1.statement, authorizationVersion: "0.1" }, authorizationVersion: "0.1" }).ok, true);
    assert.equal(parseAuthorization(text.replace('"generation":"1"', '"generation":"1","generation":"2"')).ok, false, "a repeated key is refused");
    assert.deepEqual(parseAuthorization("x".repeat(GOVERNANCE_LIMITS.maxAuthorizationBytes + 1)), { ok: false, problem: "BODY_TOO_LARGE", unsupportedVersion: false });
    for (const hostile of [null, 1, [], "{", new Uint8Array([0xff])]) assert.equal(parseAuthorization(hostile).ok, false);
  });
});

describe("authorization: keys, grants and privilege separation", () => {
  test("the root key is never an operational key, and a key authorized once is never authorized again", () => {
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.root1 })]), ["AUTHORIZED_KEY_IS_ROOT_KEY"]);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: { ...GK.op1, keyId: GK.root1.keyId } })]), ["AUTHORIZED_KEY_IS_ROOT_KEY"]);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: { ...GK.op1, n: GK.root1.n } })]), ["AUTHORIZED_KEY_IS_ROOT_KEY"], "the same material under a new name is the same key");
    const reused = [...chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED" }])];
    const back = authorizationFor({ generation: "3", key: GK.op1, supersedes: { authorizationDigest: authorizationDigest(reused[1] as never), standing: "RETIRED", retainedThrough: null } });
    assert.deepEqual(reasons([...reused, back]), ["AUTHORIZED_KEY_REUSED"]);
    const renamed = authorizationFor({ generation: "3", key: { ...GK.op3, n: GK.op1.n }, supersedes: { authorizationDigest: authorizationDigest(reused[1] as never), standing: "RETIRED", retainedThrough: null } });
    assert.deepEqual(reasons([...reused, renamed]), ["AUTHORIZED_KEY_REUSED"], "reuse is by key material, not by name");
  });

  test("grants are explicit and narrow: only the checkpoint purpose; no attestation purpose, no reserved purpose, no root purpose, no unordered or empty list", () => {
    for (const purpose of NOT_GRANTABLE_PURPOSES) assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: [purpose] })]), ["PURPOSE_NOT_PERMITTED"], purpose);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: ["CHECKPOINT_KEY_AUTHORIZATION"] })]), ["PURPOSE_NOT_PERMITTED"], "an operational key cannot be granted the root's purpose");
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: ["RECORD_PUBLICATION", "REGISTRY_LEDGER_CHECKPOINT"] })]), ["PURPOSE_NOT_PERMITTED"]);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: ["REGISTRY_LEDGER_CHECKPOINT", "REGISTRY_LEDGER_CHECKPOINT"] })]), ["PURPOSES_NOT_ORDERED"]);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: ["WALLETWALL_ANYTHING"] })]), ["PURPOSE_NOT_PERMITTED"]);
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, purposes: [] })]), ["AUTHORIZATION_MALFORMED"]);
  });

  test("the algorithm and the key material are admitted: an unsupported algorithm, an inadmissible key, a synthetic key outside a rehearsal", () => {
    assert.deepEqual(reasons([authorizationFor({ generation: "1", key: GK.op1, algorithm: "ED448" })]), ["AUTHORIZED_KEY_ALGORITHM_UNSUPPORTED"]);
    const identity = altered(a1, () => undefined);
    const forged = signAuthorization({ ...identity.statement, authorizedKey: { ...identity.statement.authorizedKey, publicKey: `01${"00".repeat(31)}` } }, GK.root1.n);
    assert.deepEqual(reasons([forged]), ["AUTHORIZED_KEY_INADMISSIBLE"]);
    assert.deepEqual(run([a1], { allowSynthetic: false }).bootstrap.reasons, ["SYNTHETIC_KEY_REFUSED"]);
    const production = bootstrapFor({ ...GK.root1, keyId: "walletwall-governance-root-1" });
    const productionRoot = envelopeOf(statementFor({ root: { ...GK.root1, keyId: "walletwall-governance-root-1" }, generation: "1", key: GK.op1 }), "");
    const signed = signAuthorization(productionRoot.statement, GK.root1.n);
    const r = verifyGovernance({ bootstrap: production, authorizations: [signed] });
    assert.deepEqual(r.chain.reasons, ["SYNTHETIC_KEY_REFUSED"], "a production root may not authorize a synthetic operational key");
  });

  test("an operational key cannot authorize a new root, a new operational key, or itself: it holds no authorization power", () => {
    const chain = chainOf([{ key: GK.op1 }]);
    const byOperational = authorizationFor({ generation: "2", key: GK.op2, supersedes: { authorizationDigest: authorizationDigest(chain[0] as never), standing: "RETIRED", retainedThrough: null } }, GK.op1.n);
    assert.deepEqual(reasons([...chain, byOperational]), ["SIGNATURE_MISMATCH"]);
    const asRoot = authorizationFor({ root: GK.op1, generation: "2", key: GK.op2, supersedes: { authorizationDigest: authorizationDigest(chain[0] as never), standing: "RETIRED", retainedThrough: null } });
    assert.deepEqual(reasons([...chain, asRoot]), ["ROOT_MISMATCH"]);
    const grantsRootPurpose = authorizationFor({ generation: "1", key: GK.op1, purposes: ["CHECKPOINT_KEY_AUTHORIZATION"] });
    assert.deepEqual(reasons([grantsRootPurpose]), ["PURPOSE_NOT_PERMITTED"]);
    const newRoot = bootstrapFor(GK.op1, { rootEpoch: "2" });
    assert.equal(verifyGovernance({ bootstrap: newRoot, allowSynthetic: true, expectedBootstrapDigest: rootDigest }).bootstrap.pin, "MISMATCHED", "naming a key as a root does not make it the pinned root");
    assert.equal(governed(checkpointBy(GK.op1, 6), chain, 6).reliance.status, "RELIED_UPON");
  });

  test("an operational key's authority is the checkpoint purpose only: it signs no WallPrint attestation as WalletWall, and a record signed by it earns origin KEY_ONLY, not a bound publisher", () => {
    const record = goldenRecord();
    const forged = attest("RECORD_PUBLICATION", { signerId: "synthetic-publisher", keyId: GK.op1.keyId, n: GK.op1.n }, recordTarget(record));
    const result = verifyAttestation(forged, { record, keyRegistry: registryChain() });
    assert.equal(result.signature.status, "VALID", "the signature is cryptographically valid");
    assert.equal(result.origin, "KEY_ONLY", "but nothing binds the key to the WalletWall publisher: the registry never lists an operational checkpoint key");
    assert.notEqual(result.origin, "BOUND_WALLETWALL_PUBLISHER");
    assert.notEqual(WHO.publisher1.n, GK.op1.n);
    assert.ok(SYNTHETIC_NOTICE.startsWith("SYNTHETIC NON-PRODUCTION FIXTURE"));
  });

  test("the authorization says nothing about truth: a governance-authorized key's checkpoint still carries the fixed denials, and no result field claims verification", () => {
    const r = governed(checkpointBy(GK.op1, 6), [a1], 6);
    assert.ok(r.checkpoint.doesNotEstablish.some((s) => /factual truth/.test(s)));
    assert.ok(r.governance.doesNotEstablish.some((s) => /factual truth/.test(s)));
    assert.ok(r.governance.doesNotEstablish.some((s) => /uncompromised/.test(s)));
    assert.match(r.governance.establishes, /^Only when the bootstrap was pinned out of band/);
    assert.doesNotMatch(JSON.stringify(r.governance), /"(?:verified|trusted|certified|endorsed)"/i);
  });
});
