import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bytesToHex, ed25519KeyProblem, hexToBytes, verifyEd25519 } from "../../src/wallprint/ed25519.ts";
import { WHO, attest, flipLast, goldenRecord, assessmentTargetOf, syntheticKey } from "../support/wallprint-attestations.ts";
import { attestationPreimage } from "../../src/wallprint/attestation.ts";

/**
 * The verifier's cryptographic floor: RFC 8032 known answers, the public-key admission the platform primitives do not
 * perform, and parity with the Web Crypto API a browser would use.
 */
const RFC8032_1 = { pub: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", msg: "", sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" };
const RFC8032_2 = { pub: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", msg: "72", sig: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00" };

// The eight points of order dividing 8, in canonical encoding, plus their sign-bit variants.
const SMALL_ORDER = [
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
];

// An independent, minimal affine implementation, used only to build a key that has a torsion component.
const P = 2n ** 255n - 19n;
const md = (a: bigint): bigint => ((a % P) + P) % P;
const pw = (b: bigint, e: bigint): bigint => {
  let r = 1n;
  let x = md(b);
  for (let k = e; k > 0n; k >>= 1n) {
    if (k & 1n) r = (r * x) % P;
    x = (x * x) % P;
  }
  return r;
};
const D = md(-121665n * pw(121666n, P - 2n));
const decode = (hex: string): [bigint, bigint] => {
  const b = hexToBytes(hex);
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i] ?? 0);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  const x2 = md(md(y * y - 1n) * pw(md(D * y * y + 1n), P - 2n));
  let x = pw(x2, (P + 3n) / 8n);
  if (md(x * x - x2) !== 0n) x = md(x * pw(2n, (P - 1n) / 4n));
  if ((x & 1n) !== sign) x = md(P - x);
  return [x, y];
};
const add = ([x1, y1]: [bigint, bigint], [x2, y2]: [bigint, bigint]): [bigint, bigint] => {
  const t = md(D * x1 * x2 * y1 * y2);
  return [md((x1 * y2 + x2 * y1) * pw(1n + t, P - 2n)), md((y1 * y2 + x1 * x2) * pw(md(1n - t), P - 2n))];
};
const encode = ([x, y]: [bigint, bigint]): string => {
  const out = new Uint8Array(32);
  let v = y | ((x & 1n) << 255n);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytesToHex(out);
};

describe("Ed25519 verification floor", () => {
  test("RFC 8032 known answers verify, and one flipped bit does not", () => {
    for (const v of [RFC8032_1, RFC8032_2]) {
      assert.deepEqual(verifyEd25519(v.pub, hexToBytes(v.msg), v.sig), { valid: true });
      assert.deepEqual(verifyEd25519(v.pub, hexToBytes(v.msg), flipLast(v.sig)), { valid: false, reason: "SIGNATURE_MISMATCH" });
      assert.deepEqual(verifyEd25519(v.pub, new TextEncoder().encode("other"), v.sig), { valid: false, reason: "SIGNATURE_MISMATCH" });
    }
  });

  test("every small-order public key is refused, which closes the universal-forgery hole the platform primitives leave open", () => {
    for (const key of SMALL_ORDER) assert.equal(ed25519KeyProblem(key), "KEY_SMALL_ORDER", key);
    // For the identity point, signature (R = identity, S = 0) verifies for every message on Node and in Web Crypto; the admission refuses it first.
    const forged = `01${"00".repeat(31)}${"00".repeat(32)}`;
    assert.deepEqual(verifyEd25519(SMALL_ORDER[0] ?? "", new TextEncoder().encode("any message at all"), forged), { valid: false, reason: "KEY_SMALL_ORDER" });
  });

  test("a non-canonical, off-curve or wrongly sized key is refused with its own reason", () => {
    assert.equal(ed25519KeyProblem(`eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f`), "KEY_NON_CANONICAL");
    assert.equal(ed25519KeyProblem("ff".repeat(32)), "KEY_NON_CANONICAL");
    assert.equal(ed25519KeyProblem("00"), "KEY_LENGTH_INVALID");
    assert.equal(ed25519KeyProblem("A".repeat(64)), "KEY_LENGTH_INVALID");
    assert.equal(ed25519KeyProblem(`02${"00".repeat(31)}`), "KEY_NOT_ON_CURVE");
    assert.equal(ed25519KeyProblem(`03${"00".repeat(31)}`), "KEY_TORSION", "an arbitrary on-curve point almost always carries a torsion component");
  });

  test("a key with a torsion component is refused: honest keys have none, and verifiers disagree about keys that do", () => {
    const base = decode("58" + "66".repeat(31));
    const t8 = decode("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05");
    const mixed = encode(add(base, t8));
    assert.notEqual(mixed, "58" + "66".repeat(31));
    assert.equal(ed25519KeyProblem(mixed), "KEY_TORSION");
    assert.equal(ed25519KeyProblem("58" + "66".repeat(31)), null, "the base point itself is admitted");
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) assert.equal(ed25519KeyProblem(syntheticKey(n).publicKey), null);
  });

  test("a wrong-sized or non-hex signature is refused before any cryptography", () => {
    const { publicKey } = syntheticKey(1);
    assert.deepEqual(verifyEd25519(publicKey, new Uint8Array(), "00".repeat(63)), { valid: false, reason: "SIGNATURE_LENGTH_INVALID" });
    assert.deepEqual(verifyEd25519(publicKey, new Uint8Array(), "zz".repeat(64)), { valid: false, reason: "SIGNATURE_LENGTH_INVALID" });
    assert.deepEqual(verifyEd25519(publicKey, new Uint8Array(), "00".repeat(64)), { valid: false, reason: "SIGNATURE_MISMATCH" });
  });

  test("the Web Crypto API a browser would use gives the same answer on a real attestation: Node and the browser primitive agree", async () => {
    const golden = goldenRecord();
    const envelope = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(golden, "reviewer-y"));
    const message = attestationPreimage(envelope.statement);
    const key = await globalThis.crypto.subtle.importKey("raw", hexToBytes(envelope.statement.signer.publicKey), { name: "Ed25519" }, false, ["verify"]);
    assert.equal(await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, hexToBytes(envelope.signature), message), true);
    assert.deepEqual(verifyEd25519(envelope.statement.signer.publicKey, message, envelope.signature), { valid: true });
    const altered = new Uint8Array(message);
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
    assert.equal(await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, hexToBytes(envelope.signature), altered), false);
    assert.equal(verifyEd25519(envelope.statement.signer.publicKey, altered, envelope.signature).valid, false);
  });

  test("signing is deterministic for the reference signer, so a regenerated vector file equals the committed one", () => {
    const golden = goldenRecord();
    const target = assessmentTargetOf(golden, "reviewer-y");
    assert.equal(attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, target).signature, attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, target).signature);
  });
});
