import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest } from "../../src/canonical.ts";
import { bootstrapDigest, formatFingerprint, parseBootstrap } from "../../src/wallprint/governance.ts";
import { assessBootstrapPin, verifyGovernance, verifyGovernedCheckpoint } from "../../src/wallprint/governance-verify.ts";
import { GOVERNANCE_FORMAT_VERSION, GOVERNANCE_LIMITS, ROOT_PURPOSES } from "../../src/wallprint/governance-vocabulary.ts";
import { GK, authorizationFor, bootstrapFor, chainOf, checkpointBy, publicKeyOf, governedContext, governed } from "../support/wallprint-governance.ts";

/**
 * The public bootstrap: what a verifier pins. A well-formed, closed, public-only object whose digest is its fingerprint; never a key a
 * checkpoint or an authorization names about itself.
 */
const root = bootstrapFor();
const digest = bootstrapDigest(root);
const verify = (bootstrap: unknown, over: Record<string, unknown> = {}) => verifyGovernance({ bootstrap, allowSynthetic: true, ...over });
const withRoot = (over: Record<string, unknown>): Record<string, unknown> => ({ ...root, root: { ...root.root, ...over } });

describe("bootstrap: acceptance and refusal", () => {
  test("a valid root artifact is accepted: well-formed, parsed, no reasons", () => {
    const r = verify(root);
    assert.equal(r.bootstrap.parse, "PARSED");
    assert.deepEqual(r.bootstrap.reasons, []);
    assert.equal(r.bootstrap.rootKeyId, GK.root1.keyId);
    assert.equal(r.bootstrap.rootEpoch, "1");
    assert.equal(r.bootstrap.digest, digest);
  });

  test("an unknown field is refused, at the top and inside the root entry: there is no slot for anything but public material", () => {
    for (const bad of [{ ...root, label: "x" }, withRoot({ label: "x" }), { ...root, status: "ACTIVE" }, withRoot({ validFrom: "2026-01-01" })]) {
      const r = verify(bad);
      assert.equal(r.bootstrap.parse, "MALFORMED");
      assert.deepEqual(r.bootstrap.reasons, ["BOOTSTRAP_MALFORMED"]);
      assert.deepEqual(r.keys, []);
    }
  });

  test("a field that would carry a private key, a seed or a passphrase is refused as an unknown field, never read", () => {
    for (const field of ["privateKey", "seed", "secretKey", "passphrase", "mnemonic"]) {
      const r = verify(withRoot({ [field]: "ab".repeat(32) }));
      assert.equal(r.bootstrap.parse, "MALFORMED", field);
    }
  });

  test("a malformed or inadmissible public key is refused: wrong length, not hex, off the curve, small order, the identity point", () => {
    for (const publicKey of ["ab".repeat(31), "ab".repeat(33), "zz".repeat(32), "00".repeat(32), `01${"00".repeat(31)}`, "ff".repeat(32)]) {
      const r = verify(withRoot({ publicKey }));
      assert.ok(r.bootstrap.reasons.length > 0, publicKey);
      assert.ok(r.bootstrap.parse === "MALFORMED" || r.bootstrap.reasons.includes("BOOTSTRAP_KEY_INADMISSIBLE"), publicKey);
      assert.deepEqual(r.keys, []);
    }
  });

  test("an unsupported algorithm is refused", () => {
    for (const algorithm of ["RSA_PSS", "ECDSA_P256", "NONE", "ML_DSA_65"]) assert.deepEqual(verify(withRoot({ algorithm })).bootstrap.reasons, ["BOOTSTRAP_ALGORITHM_UNSUPPORTED"], algorithm);
    assert.equal(verify(withRoot({ algorithm: "ed25519" })).bootstrap.parse, "MALFORMED", "the algorithm token is upper case");
  });

  test("a root with the wrong purpose is refused: the root authorizes checkpoint keys and nothing else", () => {
    for (const purposes of [["REGISTRY_LEDGER_CHECKPOINT"], ["RECORD_PUBLICATION"], ["ASSESSMENT_ORIGIN"], ["ISSUER_ASSESSMENT_ORIGIN"], ["STANDING_HEAD"], ["CHECKPOINT_KEY_AUTHORIZATION", "REGISTRY_LEDGER_CHECKPOINT"], ["REGISTRY_LEDGER_CHECKPOINT", "CHECKPOINT_KEY_AUTHORIZATION"]]) {
      const r = verify(withRoot({ purposes }));
      assert.deepEqual(r.bootstrap.reasons, ["BOOTSTRAP_PURPOSE_NOT_PERMITTED"], purposes.join());
    }
    assert.equal(verify(withRoot({ purposes: [] })).bootstrap.parse, "MALFORMED");
    assert.deepEqual([...ROOT_PURPOSES], ["CHECKPOINT_KEY_AUTHORIZATION"]);
  });

  test("an operational key cannot bootstrap itself: an authorization signed by the key it authorizes, or naming itself as the root, is refused under the pinned root", () => {
    const op = GK.op1;
    for (const forged of [authorizationFor({ root: op, generation: "1", key: op }), authorizationFor({ generation: "1", key: op }, op.n)]) {
      const r = verifyGovernance({ bootstrap: root, authorizations: [forged], allowSynthetic: true });
      assert.equal(r.chain.status, "INVALID");
      assert.deepEqual(r.keys, []);
    }
    const asBootstrap = verify(bootstrapFor(op));
    assert.equal(asBootstrap.bootstrap.parse, "PARSED", "a key can be written as a root; being pinned is what makes it one");
    assert.equal(asBootstrap.bootstrap.pin, "UNPINNED");
    assert.deepEqual(asBootstrap.limitations, [], "an unusable state carries no limitation list");
    const wrongPin = verify(bootstrapFor(op), { expectedBootstrapDigest: digest });
    assert.deepEqual(wrongPin.bootstrap.reasons, ["BOOTSTRAP_DIGEST_MISMATCH"]);
  });

  test("a bootstrap is never taken from the checkpoint being verified: a checkpoint is not a bootstrap, and smuggled fields on a checkpoint are refused", () => {
    const checkpoint = checkpointBy(GK.op1, 6);
    const asBootstrap = verifyGovernedCheckpoint(checkpoint, { bootstrap: checkpoint, authorizations: chainOf([{ key: GK.op1 }]), allowSynthetic: true });
    assert.equal(asBootstrap.governance.bootstrap.parse, "MALFORMED");
    assert.equal(asBootstrap.reliance.status, "NOT_EVALUATED");
    assert.equal(asBootstrap.checkpoint.signer.authorization, "NOT_EVALUATED");
    assert.deepEqual(asBootstrap.checkpoint.signer.reasons, ["TRUST_ROOT_NOT_SUPPLIED"]);

    const smuggled = { ...checkpoint, bootstrap: root, trustRoot: { keys: [] } };
    const r = verifyGovernedCheckpoint(smuggled, governedContext(chainOf([{ key: GK.op1 }]), 6));
    assert.equal(r.checkpoint.parse, "MALFORMED");
    assert.equal(r.reliance.status, "NOT_EVALUATED");

    const bare = verifyGovernedCheckpoint(checkpoint, { allowSynthetic: true });
    assert.equal(bare.governance.bootstrap.parse, "NOT_SUPPLIED");
    assert.equal(bare.checkpoint.signer.authorization, "NOT_EVALUATED", "with no bootstrap there is no authority, whatever the checkpoint names");
  });
});

describe("bootstrap: identity, determinism and pinning", () => {
  test("the digest is deterministic, canonical and independent of key order: the engine's evidenceDigest over RFC 8785", () => {
    const shuffled = { root: { purposes: [...root.root.purposes], publicKey: root.root.publicKey, algorithm: root.root.algorithm, keyId: root.root.keyId }, rootEpoch: root.rootEpoch, formatVersion: root.formatVersion, type: root.type };
    assert.equal(canonicalize(shuffled), canonicalize(root));
    assert.equal(bootstrapDigest(root), evidenceDigest(root));
    assert.equal(bootstrapDigest(parseOk(JSON.stringify(shuffled))), digest);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.notEqual(bootstrapDigest(bootstrapFor(GK.root1, { rootEpoch: "2" })), digest, "the epoch is inside the fingerprint");
    assert.notEqual(bootstrapDigest(bootstrapFor(GK.root2)), digest);
  });

  test("the fingerprint people compare is the digest in eight groups of eight, reversibly", () => {
    const fingerprint = formatFingerprint(digest);
    assert.match(fingerprint, /^(?:[0-9a-f]{8}-){7}[0-9a-f]{8}$/);
    assert.equal(fingerprint.replaceAll("-", ""), digest);
  });

  test("it reads strict JSON only: a repeated key, a byte-order mark, malformed text, nesting and size are refused", () => {
    const text = JSON.stringify(root);
    assert.equal(parseBootstrap(text).ok, true);
    assert.equal(parseBootstrap(new TextEncoder().encode(text)).ok, true);
    for (const bad of [text.replace('"rootEpoch":"1"', '"rootEpoch":"1","rootEpoch":"2"'), `\uFEFF${text}`, text.slice(0, -1), text + "x", "null", "[]", '{"__proto__":{}}']) assert.equal(parseBootstrap(bad).ok, false, bad.slice(0, 30));
    assert.deepEqual(parseBootstrap("x".repeat(GOVERNANCE_LIMITS.maxBootstrapBytes + 1)), { ok: false, problem: "BODY_TOO_LARGE", unsupportedVersion: false });
    assert.equal(parseBootstrap(new Uint8Array([0xff, 0xfe])).ok, false);
  });

  test("a version this verifier does not speak is reported, not read", () => {
    const r = verify({ ...root, formatVersion: "9.9" });
    assert.equal(r.bootstrap.parse, "UNSUPPORTED_VERSION");
    assert.deepEqual(r.bootstrap.reasons, ["BOOTSTRAP_VERSION_UNSUPPORTED"]);
    assert.equal(GOVERNANCE_FORMAT_VERSION, "0.1");
  });

  test("pinning: the caller's own fingerprint decides. Pinned, unpinned and mismatched are different states, and unpinned is reported as a limitation", () => {
    const authorizations = chainOf([{ key: GK.op1 }]);
    const pinned = verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true, expectedBootstrapDigest: digest });
    assert.equal(pinned.bootstrap.pin, "PINNED");
    assert.ok(!pinned.limitations.includes("BOOTSTRAP_UNPINNED"));
    const unpinned = verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true });
    assert.equal(unpinned.bootstrap.pin, "UNPINNED");
    assert.ok(unpinned.limitations.includes("BOOTSTRAP_UNPINNED"));
    assert.equal(unpinned.chain.status, "VALID", "unpinned is a limitation, not a refusal: the result says what the caller did not do");
    const mismatched = verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true, expectedBootstrapDigest: digest.replace(/^./, (c) => (c === "0" ? "1" : "0")) });
    assert.equal(mismatched.bootstrap.pin, "MISMATCHED");
    assert.deepEqual(mismatched.bootstrap.reasons, ["BOOTSTRAP_DIGEST_MISMATCH"]);
    assert.deepEqual(mismatched.keys, [], "a root that is not the one pinned authorizes nothing");
    assert.deepEqual(verifyGovernance({ bootstrap: root, authorizations, allowSynthetic: true, expectedBootstrapDigest: "nope" }).bootstrap.reasons, ["BOOTSTRAP_DIGEST_PIN_MALFORMED"]);
  });

  test("an altered public bootstrap artifact is not the pinned one: any edit moves the fingerprint", () => {
    const edits: Record<string, unknown>[] = [
      { ...root, rootEpoch: "2" },
      withRoot({ keyId: "synthetic-governance-root-999" }),
      withRoot({ publicKey: publicKeyOf(GK.op1) }),
      withRoot({ purposes: ["CHECKPOINT_KEY_AUTHORIZATION", "STANDING_HEAD"] }),
    ];
    for (const edited of edits) {
      const r = verifyGovernance({ bootstrap: edited, allowSynthetic: true, expectedBootstrapDigest: digest });
      assert.equal(r.bootstrap.pin, "MISMATCHED", JSON.stringify(edited).slice(0, 60));
      assert.deepEqual(r.keys, []);
    }
  });

  test("a production verifier refuses a synthetic key id; the rehearsal says so on purpose", () => {
    assert.deepEqual(verifyGovernance({ bootstrap: root }).bootstrap.reasons, ["SYNTHETIC_KEY_REFUSED"]);
    assert.deepEqual(verifyGovernance({ bootstrap: root, allowSynthetic: false }).bootstrap.reasons, ["SYNTHETIC_KEY_REFUSED"]);
    assert.deepEqual(verifyGovernance({ bootstrap: root, allowSynthetic: true }).bootstrap.reasons, []);
    const production = { ...root, root: { ...root.root, keyId: "walletwall-governance-root-1" } };
    assert.deepEqual(verifyGovernance({ bootstrap: production }).bootstrap.reasons, []);
  });

  test("the epoch floor: a root below the caller's minimum epoch is refused, so an older root cannot return after a reset", () => {
    assert.equal(verify(root, { minRootEpoch: "1" }).bootstrap.epoch, "ACCEPTED");
    const refused = verify(root, { minRootEpoch: "2" });
    assert.equal(refused.bootstrap.epoch, "BELOW_MINIMUM");
    assert.deepEqual(refused.bootstrap.reasons, ["BOOTSTRAP_EPOCH_BELOW_MINIMUM"]);
    assert.equal(verify(bootstrapFor(GK.root2, { rootEpoch: "2" }), { minRootEpoch: "2" }).bootstrap.epoch, "ACCEPTED");
    assert.deepEqual(verify(root, { minRootEpoch: "0" }).bootstrap.reasons, ["MINIMUM_EPOCH_MALFORMED"]);
    assert.deepEqual(verify(root, { minRootEpoch: 2 }).bootstrap.reasons, ["MINIMUM_EPOCH_MALFORMED"]);
  });

  test("it never throws and echoes nothing, for any argument", () => {
    const hostile: unknown[] = [undefined, null, 0, "", "x", [], [[]], {}, { bootstrap: new Proxy({}, { get: () => { throw new Error("x"); } }) }, new Proxy({}, { get: () => { throw new Error("secret-ish-text"); } }), Object.create(null), () => 1, Symbol("s"), 10n];
    for (const context of hostile) {
      const r = verifyGovernance(context);
      assert.notEqual(r.bootstrap.parse, "PARSED");
      assert.doesNotMatch(JSON.stringify(r), /secret-ish-text|Error/);
      assert.deepEqual(r.keys, []);
    }
    for (const input of hostile) assert.equal(parseBootstrap(input).ok, false);
    const throwing = { get bootstrap(): never { throw new Error("secret-ish-text"); } };
    const r = verifyGovernance(throwing);
    assert.equal(r.bootstrap.parse, "MALFORMED");
    assert.doesNotMatch(JSON.stringify(r), /secret-ish-text/);
  });

  test("there is no `verified` flag, no boolean verdict and no score: the result is dimensions", () => {
    const r = verifyGovernance({ bootstrap: root, authorizations: chainOf([{ key: GK.op1 }]), allowSynthetic: true, expectedBootstrapDigest: digest });
    for (const key of Object.keys(r)) assert.doesNotMatch(key, /verified|valid|trusted|score|ok$/i, key);
    const flat = JSON.stringify(r);
    assert.doesNotMatch(flat, /"(?:verified|trusted|ok|score)":/);
    assert.ok(r.doesNotEstablish.some((s) => /production root/.test(s)));
    assert.ok(r.doesNotEstablish.some((s) => /ceremony took place/.test(s)));
  });
});

describe("bootstrap pinning: distribution is a policy, not a signature", () => {
  const second = bootstrapFor(GK.root2, { rootEpoch: "2" });
  const secondDigest = bootstrapDigest(second);
  const confirm = (origins: string[], d = secondDigest): { origin: string; digest: string }[] => origins.map((origin) => ({ origin, digest: d }));
  const pin = (confirmations: unknown, candidate: unknown = second) => assessBootstrapPin(candidate, confirmations, { allowSynthetic: true });

  test("two distinct origins confirming the same fingerprint may pin; one origin, however often it repeats, may not (GitHub alone is not an independent trust root)", () => {
    assert.equal(pin(confirm(["GITHUB", "WALLETWALL_WEBSITE"])).status, "PIN_ACCEPTED");
    assert.equal(pin(confirm(["VERIFIER_RELEASE_BUNDLE", "PRINTED_OR_IN_PERSON", "THIRD_PARTY_PUBLICATION"])).status, "PIN_ACCEPTED");
    for (const origins of [["GITHUB"], ["GITHUB", "GITHUB"], ["GITHUB", "GITHUB", "GITHUB"], []]) {
      const r = pin(confirm(origins));
      assert.equal(r.status, "PIN_REFUSED", origins.join());
      assert.deepEqual(r.reasons, ["INSUFFICIENT_INDEPENDENT_ORIGINS"]);
    }
  });

  test("a confirmation of another digest does not count and is reported; an unknown origin, an extra field or a non-array is refused", () => {
    const mixed = pin([...confirm(["GITHUB"]), { origin: "WALLETWALL_WEBSITE", digest }]);
    assert.deepEqual(mixed.reasons, ["CONFIRMATION_DIGEST_MISMATCH", "INSUFFICIENT_INDEPENDENT_ORIGINS"]);
    for (const bad of [[{ origin: "A_FRIEND", digest: secondDigest }], [{ origin: "GITHUB", digest: secondDigest, signature: "00" }], "GITHUB", null, [{ origin: "GITHUB" }]]) {
      assert.ok(pin(bad).reasons.includes("CONFIRMATIONS_MALFORMED"), JSON.stringify(bad));
    }
    assert.deepEqual(pin(confirm(["GITHUB", "WALLETWALL_WEBSITE"]), { type: "x" }).reasons, ["CANDIDATE_MALFORMED"]);
  });

  test("the verdict names its origins, never claims they are independent in fact, and refuses a synthetic key outside a rehearsal", () => {
    const r = pin(confirm(["WALLETWALL_WEBSITE", "GITHUB"]));
    assert.deepEqual(r.origins, ["GITHUB", "WALLETWALL_WEBSITE"]);
    assert.equal(r.digest, secondDigest);
    assert.ok(r.doesNotEstablish.some((s) => /one origin/.test(s)));
    assert.deepEqual(assessBootstrapPin(second, confirm(["GITHUB", "WALLETWALL_WEBSITE"])).reasons, ["SYNTHETIC_KEY_REFUSED"]);
    for (const hostile of [undefined, null, 1, { get x(): never { throw new Error("y"); } }]) assert.equal(assessBootstrapPin(hostile, hostile).status, "PIN_REFUSED");
  });

  test("a signature is not an input: the pin assessment has no parameter through which the previous root's endorsement could stand in for a confirmation", () => {
    const endorsed = authorizationFor({ generation: "1", key: GK.op1 });
    const r = assessBootstrapPin(second, [{ origin: "GITHUB", digest: secondDigest, signature: endorsed.signature }], { allowSynthetic: true });
    assert.equal(r.status, "PIN_REFUSED");
    assert.ok(r.reasons.includes("CONFIRMATIONS_MALFORMED"));
  });

  test("a governed checkpoint verification pins nothing by itself and reports the limitation", () => {
    const r = governed(checkpointBy(GK.op1, 6), chainOf([{ key: GK.op1 }]), 6, { expectBootstrapPin: false });
    assert.ok(r.governance.limitations.includes("BOOTSTRAP_UNPINNED"));
    assert.equal(r.reliance.status, "RELIED_UPON", "an unpinned bootstrap is a limitation the reader sees, not a hidden failure");
  });
});

const parseOk = (text: string): ReturnType<typeof bootstrapFor> => {
  const parsed = parseBootstrap(text);
  assert.ok(parsed.ok);
  return parsed.artifact;
};
