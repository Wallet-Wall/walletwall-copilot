import { createPublicKey, verify } from "node:crypto";
import { ALGORITHM_SIZES, type SignatureReason } from "./attestation-vocabulary.ts";

/**
 * Ed25519 verification for WallPrint attestations (RFC 8032, pure Ed25519 over the message; no pre-hash).
 *
 * The platform primitives (Node's `crypto.verify` and the browser's Web Crypto `verify`) are used as they are, with one
 * addition the design requires: a public key is admitted before any signature is checked. Measured on this repository's
 * Node (24.16, OpenSSL 3.5): both Node and Web Crypto accept a signature made by the identity point's encoding over ANY
 * message, so a key that is not admitted would let anyone "sign" anything. A key is admitted only when it is a canonical
 * encoding of a point on the curve that has neither a small-order component nor any torsion at all, and a signature's R is
 * held to the same standard (`verifyEd25519`), so cofactored and cofactorless verifiers have no torsion left to disagree about
 * in the key or in R; S is checked below the group order explicitly.
 *
 * Pure: no clock, no I/O, no randomness, no signing (nothing here can produce a signature). The curve arithmetic is
 * arbitrary-precision and not constant-time; it only ever handles public values.
 */

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const mod = (a: bigint): bigint => ((a % P) + P) % P;

function pow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

const inv = (a: bigint): bigint => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const D2 = mod(2n * D);
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

interface Point {
  x: bigint;
  y: bigint;
  z: bigint;
  t: bigint;
}

const IDENTITY: Point = { x: 0n, y: 1n, z: 1n, t: 0n };

/** Unified twisted Edwards addition in extended coordinates (a = -1, add-2008-hwcd-3); complete for this curve. */
function add(p: Point, q: Point): Point {
  const a = mod((p.y - p.x) * (q.y - q.x));
  const b = mod((p.y + p.x) * (q.y + q.x));
  const c = mod(p.t * D2 * q.t);
  const d = mod(2n * p.z * q.z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) };
}

function multiply(point: Point, scalar: bigint): Point {
  let result = IDENTITY;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if ((k & 1n) === 1n) result = add(result, addend);
    addend = add(addend, addend);
    k >>= 1n;
  }
  return result;
}

const isIdentity = (p: Point): boolean => p.x === 0n && mod(p.y - p.z) === 0n;

const HEX_RE = /^(?:[0-9a-f]{2})*$/;

export function hexToBytes(hex: string): Uint8Array {
  if (!HEX_RE.test(hex)) throw new RangeError("not lower-case hexadecimal");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

type KeyProblem = Extract<SignatureReason, "KEY_LENGTH_INVALID" | "KEY_NON_CANONICAL" | "KEY_NOT_ON_CURVE" | "KEY_SMALL_ORDER" | "KEY_TORSION">;

const KEY_PROBLEMS = new Map<string, KeyProblem | null>();

/** Is this lower-case hex a public key a verifier may use? Returns the first reason it is not. Pure, so a small bounded cache is safe. */
export function ed25519KeyProblem(publicKeyHex: string): KeyProblem | null {
  const known = KEY_PROBLEMS.get(publicKeyHex);
  if (known !== undefined) return known;
  const problem = computeKeyProblem(publicKeyHex);
  if (KEY_PROBLEMS.size >= 256) KEY_PROBLEMS.clear();
  KEY_PROBLEMS.set(publicKeyHex, problem);
  return problem;
}

function computeKeyProblem(publicKeyHex: string): KeyProblem | null {
  if (publicKeyHex.length !== ALGORITHM_SIZES.ED25519.publicKeyHex || !HEX_RE.test(publicKeyHex)) return "KEY_LENGTH_INVALID";
  const bytes = hexToBytes(publicKeyHex);
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i] ?? 0);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return "KEY_NON_CANONICAL";
  const y2 = mod(y * y);
  const x2 = mod(mod(y2 - 1n) * inv(mod(D * y2 + 1n)));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return "KEY_NOT_ON_CURVE";
  if (x === 0n && sign === 1n) return "KEY_NON_CANONICAL";
  if ((x & 1n) !== sign) x = mod(P - x);
  const point: Point = { x, y, z: 1n, t: mod(x * y) };
  if (isIdentity(multiply(point, 8n))) return "KEY_SMALL_ORDER";
  if (!isIdentity(multiply(point, L))) return "KEY_TORSION";
  return null;
}

const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

/** The platform's raw Ed25519 verification, injectable so a runtime without it (or a browser's Web Crypto) is the same decision procedure. */
export interface Ed25519Primitive {
  verify(publicKeyHex: string, message: Uint8Array, signature: Uint8Array): boolean;
}

const nodePrimitive: Ed25519Primitive = {
  verify(publicKeyHex, message, signature) {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, hexToBytes(publicKeyHex)]), format: "der", type: "spki" });
    return verify(null, message, key, signature);
  },
};

export type Ed25519Result =
  | { valid: true }
  | { valid: false; reason: Extract<SignatureReason, "KEY_LENGTH_INVALID" | "KEY_NON_CANONICAL" | "KEY_NOT_ON_CURVE" | "KEY_SMALL_ORDER" | "KEY_TORSION" | "SIGNATURE_LENGTH_INVALID" | "SIGNATURE_R_INADMISSIBLE" | "SIGNATURE_S_NON_CANONICAL" | "SIGNATURE_MISMATCH" | "RUNTIME_UNSUPPORTED"> };

/**
 * Verify one Ed25519 signature over `message`, strictly: the public key and the signature's R are canonical, on the curve
 * and in the prime-order subgroup, and S is below the group order, before the platform primitive is asked. An honest
 * signature always passes these (R = [r]B has no torsion), so they cost nothing, and a signature the key holder crafted with a
 * torsion component in R, which cofactored and cofactorless verifiers disagree about, is refused outright.
 *
 * Never throws. An inadmissible key or a malformed signature is a fixed reason. A runtime that cannot run the primitive is
 * `RUNTIME_UNSUPPORTED`, which the caller reports as not checked: it is not a finding about the signature.
 */
export function verifyEd25519(publicKeyHex: string, message: Uint8Array, signatureHex: string, primitive: Ed25519Primitive = nodePrimitive): Ed25519Result {
  const problem = ed25519KeyProblem(publicKeyHex);
  if (problem !== null) return { valid: false, reason: problem };
  if (signatureHex.length !== ALGORITHM_SIZES.ED25519.signatureHex || !HEX_RE.test(signatureHex)) return { valid: false, reason: "SIGNATURE_LENGTH_INVALID" };
  const bytes = hexToBytes(signatureHex);
  let s = 0n;
  for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(bytes[i] ?? 0);
  if (s >= L) return { valid: false, reason: "SIGNATURE_S_NON_CANONICAL" };
  if (computeKeyProblem(signatureHex.slice(0, 64)) !== null) return { valid: false, reason: "SIGNATURE_R_INADMISSIBLE" };
  try {
    return primitive.verify(publicKeyHex, message, bytes) ? { valid: true } : { valid: false, reason: "SIGNATURE_MISMATCH" };
  } catch {
    return { valid: false, reason: "RUNTIME_UNSUPPORTED" };
  }
}
