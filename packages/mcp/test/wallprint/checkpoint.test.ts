import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evidenceDigest } from "../../src/canonical.ts";
import { DOMAIN_TAGS } from "../../src/wallprint/attestation-vocabulary.ts";
import { attestationPreimage, domainSeparatedPreimage, parseAttestation } from "../../src/wallprint/attestation.ts";
import {
  CheckpointStatementSchema,
  checkpointDigest,
  checkpointPreimage,
  committedStateOf,
  governanceTrustRootFindings,
  parseCheckpoint,
  parseGovernanceTrustRoot,
  type CheckpointEnvelope,
} from "../../src/wallprint/checkpoint.ts";
import { CHECKPOINT_DOMAIN_TAGS, CHECKPOINT_LIMITS } from "../../src/wallprint/checkpoint-vocabulary.ts";
import { verifyCheckpoint } from "../../src/wallprint/checkpoint-verify.ts";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { GOV, PRIMARY_ROOT, ROTATED_ROOT, checkpointFor, checkpointStatement, scenarioLedger, scenarioRegistry, signCheckpointStatement, signUnderTag, trustRootOf } from "../support/wallprint-checkpoints.ts";
import { WHO, attest, assessmentTargetOf, goldenRecord, flipLast, syntheticKey } from "../support/wallprint-attestations.ts";

const R = scenarioRegistry();
const L = scenarioLedger();
const cp = checkpointFor(R.slice(0, 5), L.slice(0, 12));
const context = { trustRoot: PRIMARY_ROOT, keyRegistry: R.slice(0, 5), acceptanceLedger: L.slice(0, 12) };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const d = (c: string): string => c.repeat(64);

describe("checkpoint: the statement carries exactly the fields that have a verification purpose", () => {
  test("the statement and the envelope have exactly these fields, and nothing else: no timestamp, label, comment, id, link or status", () => {
    assert.deepEqual(Object.keys(cp).sort(), ["checkpointVersion", "signature", "statement", "type"]);
    assert.deepEqual(Object.keys(cp.statement).sort(), ["acceptanceLedger", "checkpointVersion", "purpose", "registry", "signer"]);
    assert.deepEqual(Object.keys(cp.statement.signer).sort(), ["algorithm", "keyId", "publicKey"]);
    assert.deepEqual(Object.keys(cp.statement.registry).sort(), ["headDigest", "headVersion"]);
    assert.deepEqual(Object.keys(cp.statement.acceptanceLedger).sort(), ["entryCount", "headDigest"]);
    assert.equal(cp.statement.checkpointVersion, "0.1");
    assert.equal(cp.statement.purpose, "REGISTRY_LEDGER_CHECKPOINT");
    assert.equal(cp.statement.registry.headVersion, "5");
    assert.equal(cp.statement.registry.headDigest, R[4]?.digest);
    assert.equal(cp.statement.acceptanceLedger.entryCount, "12");
    assert.equal(cp.statement.acceptanceLedger.headDigest, L[11]?.entryDigest);
  });

  test("every value is a string or null: there are no JSON numbers, as everywhere in WallPrint", () => {
    const walk = (v: unknown): void => {
      if (v !== null && typeof v === "object") for (const x of Object.values(v)) walk(x);
      else assert.ok(v === null || typeof v === "string", String(v));
    };
    walk(cp);
  });

  test("an unknown field anywhere is refused, never dropped", () => {
    for (const extra of ["timestamp", "signedAt", "label", "comment", "id", "previous", "status", "note"]) {
      const top = { ...cp, [extra]: "x" };
      const inner = { ...cp, statement: { ...cp.statement, [extra]: "x" } };
      const signer = { ...cp, statement: { ...cp.statement, signer: { ...cp.statement.signer, [extra]: "x" } } };
      const registry = { ...cp, statement: { ...cp.statement, registry: { ...cp.statement.registry, [extra]: "x" } } };
      const ledger = { ...cp, statement: { ...cp.statement, acceptanceLedger: { ...cp.statement.acceptanceLedger, [extra]: "x" } } };
      for (const bad of [top, inner, signer, registry, ledger]) assert.equal(parseCheckpoint(bad).ok, false, extra);
    }
  });

  test("counts and heads are held to their grammar: no leading zero, no sign, no number, a null head only for an empty ledger", () => {
    const withCounts = (registry: unknown, acceptanceLedger: unknown) => CheckpointStatementSchema.safeParse({ ...cp.statement, registry, acceptanceLedger }).success;
    const good = cp.statement;
    assert.equal(withCounts(good.registry, good.acceptanceLedger), true);
    for (const headVersion of ["0", "05", "-1", "+1", "1.0", "", "4097", 5, null]) assert.equal(withCounts({ ...good.registry, headVersion }, good.acceptanceLedger), false, String(headVersion));
    for (const entryCount of ["00", "01", "-1", "", "100001", 12, null]) assert.equal(withCounts(good.registry, { ...good.acceptanceLedger, entryCount }), false, String(entryCount));
    assert.equal(withCounts(good.registry, { entryCount: "0", headDigest: null }), true, "an empty ledger has a null head");
    assert.equal(withCounts(good.registry, { entryCount: "0", headDigest: d("a") }), false, "an empty ledger cannot have a head");
    assert.equal(withCounts(good.registry, { entryCount: "3", headDigest: null }), false, "a ledger with entries must have a head");
    for (const headDigest of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), null]) assert.equal(withCounts({ ...good.registry, headDigest }, good.acceptanceLedger), false, String(headDigest));
  });

  test("committedStateOf commits the number of entries and the last digest of each log, and nothing else", () => {
    const state = committedStateOf(R.slice(0, 5), L.slice(0, 12));
    assert.deepEqual(state, { registry: { headVersion: "5", headDigest: R[4]?.digest }, acceptanceLedger: { entryCount: "12", headDigest: L[11]?.entryDigest } });
    assert.deepEqual(committedStateOf(R.slice(0, 1), []).acceptanceLedger, { entryCount: "0", headDigest: null });
  });
});

describe("checkpoint: the exact signed bytes", () => {
  const tag = "walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint";

  test("the bytes are UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement)), spelled out", () => {
    assert.equal(CHECKPOINT_DOMAIN_TAGS.REGISTRY_LEDGER_CHECKPOINT, tag);
    const body = Buffer.from(JSON.stringify(sortedClone(cp.statement)), "utf8");
    const expected = Buffer.concat([Buffer.from(tag, "ascii"), Buffer.from([0]), body]);
    assert.deepEqual(Buffer.from(checkpointPreimage(cp.statement)), expected);
    assert.equal(Buffer.from(checkpointPreimage(cp.statement)).indexOf(0), tag.length, "the first 0x00 is the one boundary");
  });

  test("the preimage is not JSON, and it is the same construction as an attestation's, through one shared function", () => {
    const bytes = Buffer.from(checkpointPreimage(cp.statement)).toString("utf8");
    assert.throws(() => JSON.parse(bytes));
    assert.deepEqual(checkpointPreimage(cp.statement), domainSeparatedPreimage(tag, cp.statement));
    const target = assessmentTargetOf(goldenRecord(), "reviewer-y");
    const envelope = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, target);
    const parsed = parseAttestation(envelope);
    assert.ok(parsed.ok);
    assert.deepEqual(attestationPreimage(parsed.envelope.statement), domainSeparatedPreimage(DOMAIN_TAGS.ASSESSMENT_ORIGIN, parsed.envelope.statement));
  });

  test("the checkpoint tag differs from every attestation tag and is a prefix of none, so no preimage of one is a preimage of the other", () => {
    for (const other of Object.values(DOMAIN_TAGS)) {
      assert.notEqual(other, tag);
      assert.equal(other.startsWith(`${tag}\u0000`), false);
      assert.equal(tag.startsWith(`${other}\u0000`), false);
    }
    assert.equal(tag.includes("\u0000"), false);
  });

  test("the preimage is a function of every field: changing any one field changes it", () => {
    const base = Buffer.from(checkpointPreimage(cp.statement)).toString("hex");
    const variants = [
      { ...cp.statement, signer: { ...cp.statement.signer, keyId: "synthetic-governance-2" } },
      { ...cp.statement, signer: { ...cp.statement.signer, algorithm: "ED448" } },
      { ...cp.statement, signer: { ...cp.statement.signer, publicKey: syntheticKey(23).publicKey } },
      { ...cp.statement, registry: { ...cp.statement.registry, headVersion: "6" } },
      { ...cp.statement, registry: { ...cp.statement.registry, headDigest: flipLast(cp.statement.registry.headDigest) } },
      { ...cp.statement, acceptanceLedger: { ...cp.statement.acceptanceLedger, entryCount: "13" } },
      { ...cp.statement, acceptanceLedger: { ...cp.statement.acceptanceLedger, headDigest: d("c") } },
    ];
    for (const v of variants) assert.notEqual(Buffer.from(checkpointPreimage(v)).toString("hex"), base);
  });

  test("the preimage does not depend on property order: the canonical form is RFC 8785", () => {
    const reordered = { acceptanceLedger: cp.statement.acceptanceLedger, registry: cp.statement.registry, signer: cp.statement.signer, purpose: cp.statement.purpose, checkpointVersion: cp.statement.checkpointVersion };
    assert.deepEqual(checkpointPreimage(reordered), checkpointPreimage(cp.statement));
  });
});

const sortedClone = (v: unknown): unknown => (v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortedClone(x)])) : v);

describe("checkpoint: the signature covers every field and only this domain", () => {
  test("a genuine checkpoint verifies, and each field edited after signing breaks the signature (and only the signature)", () => {
    assert.equal(verifyCheckpoint(cp, context).signature.status, "VALID");
    const edits: [string, (e: CheckpointEnvelope) => unknown][] = [
      ["registry.headVersion", (e) => ({ ...e, statement: { ...e.statement, registry: { ...e.statement.registry, headVersion: "6" } } })],
      ["registry.headDigest", (e) => ({ ...e, statement: { ...e.statement, registry: { ...e.statement.registry, headDigest: flipLast(e.statement.registry.headDigest) } } })],
      ["acceptanceLedger.entryCount", (e) => ({ ...e, statement: { ...e.statement, acceptanceLedger: { ...e.statement.acceptanceLedger, entryCount: "13" } } })],
      ["acceptanceLedger.headDigest", (e) => ({ ...e, statement: { ...e.statement, acceptanceLedger: { ...e.statement.acceptanceLedger, headDigest: flipLast(e.statement.acceptanceLedger.headDigest ?? "") } } })],
      ["signer.keyId", (e) => ({ ...e, statement: { ...e.statement, signer: { ...e.statement.signer, keyId: "synthetic-governance-2" } } })],
    ];
    for (const [field, edit] of edits) {
      const r = verifyCheckpoint(edit(cp), context);
      assert.equal(r.parse, "PARSED", field);
      assert.equal(r.signature.status, "INVALID", field);
      assert.deepEqual(r.signature.reasons, ["SIGNATURE_MISMATCH"], field);
    }
  });

  test("swapping in another key's public key breaks the signature: a signature cannot be re-presented under a different key", () => {
    const r = verifyCheckpoint({ ...cp, statement: { ...cp.statement, signer: { ...cp.statement.signer, publicKey: syntheticKey(GOV.rogue.n).publicKey } } }, context);
    assert.equal(r.signature.status, "INVALID");
  });

  test("a signature made under another domain tag, or none, is not a checkpoint signature", () => {
    for (const tag of [...Object.values(DOMAIN_TAGS), "walletwall.wallprint.trust-checkpoint/0.1/standing-head", "walletwall.wallprint.trust-checkpoint/0.2/registry-ledger-checkpoint", null]) {
      const forged = { ...cp, signature: signUnderTag(cp.statement, tag, GOV.root1.n) };
      assert.equal(verifyCheckpoint(forged, context).signature.status, "INVALID", String(tag));
    }
    assert.equal(verifyCheckpoint({ ...cp, signature: signUnderTag(cp.statement, CHECKPOINT_DOMAIN_TAGS.REGISTRY_LEDGER_CHECKPOINT, GOV.root1.n) }, context).signature.status, "VALID", "the control: the right tag verifies");
  });

  test("an attestation signature is not a checkpoint signature, and a checkpoint signature is not an attestation signature", () => {
    const record = goldenRecord();
    const attestation = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(record, "reviewer-y"));
    assert.equal(verifyCheckpoint({ ...cp, signature: attestation.signature }, context).signature.status, "INVALID");
    const reversed = verifyAttestation({ ...attestation, signature: cp.signature }, { record });
    assert.equal(reversed.signature.status, "INVALID");
    const asEnvelope = parseAttestation({ type: cp.type, attestationVersion: "0.1", statement: cp.statement, signature: cp.signature });
    assert.equal(asEnvelope.ok, false, "a checkpoint is not an attestation envelope");
    assert.equal(verifyCheckpoint(attestation, context).parse, "MALFORMED", "an attestation is not a checkpoint");
  });

  test("an unsupported algorithm is not checked (never valid, never invalid); there is no negotiation and no `none`", () => {
    for (const algorithm of ["ML_DSA_65", "NONE", "RSA_PSS", "ECDSA_P256", "ED448"]) {
      const forged = signCheckpointStatement(checkpointStatement({ registry: cp.statement.registry, acceptanceLedger: cp.statement.acceptanceLedger }, GOV.root1, { algorithm }), GOV.root1.n);
      const r = verifyCheckpoint(forged, context);
      assert.equal(r.signature.status, "NOT_CHECKED", algorithm);
      assert.deepEqual(r.signature.reasons, ["ALGORITHM_UNSUPPORTED"]);
      assert.equal(r.signer.authorization, "NOT_AUTHORIZED", "and it does not match the root's key either");
    }
  });

  test("malformed Ed25519 material is refused by the same strict admission as an attestation: key, R and S", () => {
    const sig = cp.signature;
    const L_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
    const s = BigInt(`0x${Buffer.from(Buffer.from(sig, "hex").subarray(32)).reverse().toString("hex")}`);
    const nonCanonicalS = `${sig.slice(0, 64)}${Buffer.from((s + L_ORDER).toString(16).padStart(64, "0"), "hex").reverse().toString("hex")}`;
    const smallOrderR = `01${"00".repeat(31)}${sig.slice(64)}`;
    const reasons = (signature: string): string[] => verifyCheckpoint({ ...cp, signature }, context).signature.reasons;
    assert.deepEqual(reasons(nonCanonicalS), ["SIGNATURE_S_NON_CANONICAL"]);
    assert.deepEqual(reasons(smallOrderR), ["SIGNATURE_R_INADMISSIBLE"]);
    assert.deepEqual(reasons(sig.slice(0, 126)), ["SIGNATURE_LENGTH_INVALID"]);
    const identityKey = `01${"00".repeat(31)}`;
    const keyed = (publicKey: string) => verifyCheckpoint({ ...cp, statement: { ...cp.statement, signer: { ...cp.statement.signer, publicKey } } }, context).signature;
    assert.deepEqual(keyed(identityKey).reasons, ["KEY_SMALL_ORDER"], "the identity point as a key would 'verify' any message on the platform primitive");
    assert.deepEqual(keyed("ab".repeat(31)).reasons, ["KEY_LENGTH_INVALID"]);
    assert.deepEqual(keyed("ff".repeat(32)).reasons.length, 1);
  });
});

describe("checkpoint: reading it from text is strict and bounded", () => {
  const text = JSON.stringify(cp);

  test("a well-formed envelope is read from text, bytes and a parsed value alike, and the identity does not depend on spelling", () => {
    const a = parseCheckpoint(text);
    const b = parseCheckpoint(Buffer.from(text, "utf8"));
    const c = parseCheckpoint(clone(cp));
    for (const r of [a, b, c]) assert.ok(r.ok);
    assert.equal(a.ok && checkpointDigest(a.envelope), checkpointDigest(cp));
    const reordered = JSON.stringify({ signature: cp.signature, statement: cp.statement, checkpointVersion: cp.checkpointVersion, type: cp.type });
    const r = parseCheckpoint(reordered);
    assert.ok(r.ok);
    assert.equal(checkpointDigest(r.envelope), checkpointDigest(cp));
  });

  test("a repeated key, a byte-order mark, malformed UTF-8, a prototype key, deep nesting and oversize input are each refused with a fixed code", () => {
    const problem = (input: unknown): string => {
      const r = parseCheckpoint(input);
      return r.ok ? "OK" : r.problem;
    };
    assert.equal(problem(text.replace('"type":', '"type":"walletwall.wallprint.trust-checkpoint","type":')), "DUPLICATE_KEY");
    assert.equal(problem(`\uFEFF${text}`), "SYNTAX");
    assert.equal(problem(Buffer.from([0xff, 0xfe, 0xfd])), "SYNTAX");
    assert.equal(problem(text.replace(/^\{/, '{"__proto__":{"x":"y"},')), "FORBIDDEN_STRUCTURE");
    assert.equal(problem(`${"[".repeat(CHECKPOINT_LIMITS.maxJsonDepth + 2)}${"]".repeat(CHECKPOINT_LIMITS.maxJsonDepth + 2)}`), "TOO_DEEP");
    assert.equal(problem(`${text}${" ".repeat(CHECKPOINT_LIMITS.maxEnvelopeBytes)}`), "BODY_TOO_LARGE");
    assert.equal(problem("not json"), "SYNTAX");
    assert.equal(problem(42), "SHAPE");
    assert.equal(problem(null), "SHAPE");
  });

  test("an unsupported version is reported as such before its grammar is read; a mismatched twin is not accepted", () => {
    const unsupported = parseCheckpoint({ ...cp, checkpointVersion: "9.9" });
    assert.equal(unsupported.ok, false);
    assert.equal(!unsupported.ok && unsupported.unsupportedVersion, true);
    assert.equal(verifyCheckpoint({ ...cp, checkpointVersion: "9.9" }, context).parse, "UNSUPPORTED_VERSION");
    assert.equal(verifyCheckpoint({ ...cp, statement: { ...cp.statement, checkpointVersion: "0.2" } }, context).parse, "MALFORMED");
  });

  test("the checkpoint's identity is the engine's digest of its envelope: 64 lower-case hex, no new digest construction, and it changes with the signature", () => {
    const id = checkpointDigest(cp);
    assert.match(id, /^[0-9a-f]{64}$/);
    assert.equal(id, evidenceDigest(cp));
    assert.notEqual(checkpointDigest({ ...cp, signature: flipLast(cp.signature) }), id);
  });
});

describe("governance trust root: explicit, ordered, admitted", () => {
  const codes = (raw: unknown): string[] => [...new Set(governanceTrustRootFindings(raw).map((f) => f.code))].sort();

  test("the synthetic roots are valid, and a root is only what its caller supplies: there is no default", () => {
    assert.deepEqual(codes(PRIMARY_ROOT), []);
    assert.deepEqual(codes(ROTATED_ROOT), []);
    assert.equal(parseGovernanceTrustRoot(PRIMARY_ROOT).ok, true);
  });

  test("each rule a root breaks has its own code: order, duplicate key material, inadmissible key, purposes, shape", () => {
    const keys = clone(PRIMARY_ROOT.keys);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [...keys].reverse() }), ["KEYS_NOT_ORDERED"]);
    const first = keys[0];
    const second = keys[1];
    assert.ok(first && second);
    assert.ok(codes({ ...PRIMARY_ROOT, keys: [first, { ...second, publicKey: first.publicKey }] }).includes("PUBLIC_KEY_DUPLICATE"));
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [{ ...first, publicKey: `01${"00".repeat(31)}` }, second] }), ["KEY_MATERIAL_INVALID"]);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [{ ...first, purposes: ["STANDING_HEAD", "REGISTRY_LEDGER_CHECKPOINT"] }, second] }), ["PURPOSES_INVALID"]);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [{ ...first, purposes: ["SIGN_ANYTHING"] }, second] }), ["SHAPE"]);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [] }), ["SHAPE"]);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: [{ ...first, extra: "x" }, second] }), ["SHAPE"]);
    assert.deepEqual(codes({ ...PRIMARY_ROOT, type: "something-else" }), ["SHAPE"]);
    assert.deepEqual(codes(JSON.parse('{"__proto__":{}}')), ["FORBIDDEN_STRUCTURE"]);
    const many = Array.from({ length: CHECKPOINT_LIMITS.maxTrustRootKeys + 1 }, (_, i) => ({ ...first, keyId: `synthetic-governance-${String(i).padStart(2, "0")}`, publicKey: syntheticKey(40 + i).publicKey }));
    assert.deepEqual(codes({ ...PRIMARY_ROOT, keys: many }), ["SHAPE"]);
  });

  test("a trust root has no status, no validity interval and no history: a key stays accepted only while the caller keeps supplying it", () => {
    for (const key of PRIMARY_ROOT.keys) assert.deepEqual(Object.keys(key).sort(), ["algorithm", "keyId", "publicKey", "purposes"]);
    assert.deepEqual(Object.keys(PRIMARY_ROOT).sort(), ["formatVersion", "keys", "type"]);
    const withoutRoot1 = trustRootOf({ who: GOV.standing, purposes: ["STANDING_HEAD"] });
    assert.equal(verifyCheckpoint(cp, { ...context, trustRoot: withoutRoot1 }).signer.key, "UNKNOWN");
  });
});
