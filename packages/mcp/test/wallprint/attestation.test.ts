import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { ATTESTATION_PURPOSES, DOMAIN_TAGS, ORIGIN_STATEMENTS, ATTESTATION_DOES_NOT_ESTABLISH, ATTESTATION_ESTABLISHES, PURPOSE_SIGNER_KIND, PURPOSE_TARGET_KIND, SIGNER_KIND_PURPOSES } from "../../src/wallprint/attestation-vocabulary.ts";
import {
  assessmentTargetKey,
  attestationDigest,
  attestationPreimage,
  parseAttestation,
  recordTarget,
  statementFindings,
  targetKeyOf,
  type AttestationEnvelope,
} from "../../src/wallprint/attestation.ts";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { verifyEd25519 } from "../../src/wallprint/ed25519.ts";
import { findReservedAssuranceTerms } from "../../src/wallprint/language.ts";
import { verifyReceipt, wallPrintReceipt } from "../../src/wallprint/receipt.ts";
import { WallPrintRecordSchema, validateWallPrintRecord, wallPrintDigest } from "../../src/wallprint/record.ts";
import { WHO, assessmentTargetOf, attest, goldenRecord, pinnedContext, statementFor, syntheticKey } from "../support/wallprint-attestations.ts";

const golden = goldenRecord();
const recT = recordTarget(golden);
const reviewerT = assessmentTargetOf(golden, "reviewer-y");
const valid = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT);
const publication = attest("RECORD_PUBLICATION", WHO.publisher2, recT);

describe("attestation: the exact signed bytes and domain separation", () => {
  test("the signed bytes are UTF-8(tag) || 0x00 || UTF-8(RFC 8785(statement)), with one closed tag per purpose", () => {
    for (const envelope of [publication, valid]) {
      const bytes = attestationPreimage(envelope.statement);
      const tag = DOMAIN_TAGS[envelope.statement.purpose];
      const boundary = bytes.indexOf(0);
      assert.equal(boundary, tag.length, "the first 0x00 is the one boundary");
      assert.equal(new TextDecoder().decode(bytes.subarray(0, boundary)), tag);
      assert.equal(new TextDecoder().decode(bytes.subarray(boundary + 1)), canonicalize(envelope.statement));
      assert.equal(bytes.indexOf(0, boundary + 1), -1, "no other 0x00: canonical JSON escapes control characters");
    }
    const tags = Object.values(DOMAIN_TAGS);
    assert.equal(new Set(tags).size, ATTESTATION_PURPOSES.length, "one distinct tag per purpose");
    for (const tag of tags) assert.match(tag, /^walletwall\.wallprint\.attestation\/0\.1\/[a-z-]+$/);
  });

  test("the preimage is not JSON, so a signature over it is never a signature over a JSON-signing protocol's input", () => {
    const text = new TextDecoder().decode(attestationPreimage(publication.statement));
    assert.throws(() => JSON.parse(text));
    assert.equal(text.startsWith("{"), false);
  });

  test("the same statement under another purpose's tag does not verify: a tag swap is a different message", () => {
    const body = new TextEncoder().encode(canonicalize(publication.statement));
    const swapped = new Uint8Array([...new TextEncoder().encode(DOMAIN_TAGS.ASSESSMENT_ORIGIN), 0, ...body]);
    const honest = attestationPreimage(publication.statement);
    assert.deepEqual(verifyEd25519(publication.statement.signer.publicKey, honest, publication.signature), { valid: true });
    assert.deepEqual(verifyEd25519(publication.statement.signer.publicKey, swapped, publication.signature), { valid: false, reason: "SIGNATURE_MISMATCH" });
    // Even with the tag held fixed, the statement names its purpose, so a purpose edit changes the bytes too.
    const edited = attestationPreimage({ ...publication.statement, purpose: "ASSESSMENT_ORIGIN" });
    assert.notDeepEqual([...edited], [...honest]);
  });

  test("every signed field is bound: no edit of any statement value, and no change to the signature, leaves a valid signature", () => {
    const original = JSON.parse(JSON.stringify(valid)) as AttestationEnvelope;
    const paths: (string | number)[][] = [];
    const arrays: (string | number)[][] = [];
    const walk = (node: unknown, path: (string | number)[]): void => {
      if (typeof node === "string" || node === null) paths.push(path);
      else if (Array.isArray(node)) {
        arrays.push(path);
        node.forEach((v, i) => walk(v, [...path, i]));
      } else if (typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
    };
    walk(original.statement, ["statement"]);
    walk(original.signature, ["signature"]);
    assert.ok(paths.length >= 15);
    assert.ok(arrays.length >= 2, "the assessment's list fields are covered too");
    const locate = (copy: Record<string, unknown>, path: (string | number)[]): Record<string | number, unknown> => {
      let node: Record<string | number, unknown> = copy;
      for (const seg of path) node = node[seg] as Record<string | number, unknown>;
      return node;
    };
    const edit = (path: (string | number)[], mutate: (s: string) => string): unknown => {
      const copy = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
      const parent = locate(copy, path.slice(0, -1));
      const last = path[path.length - 1] as string | number;
      parent[last] = mutate(typeof parent[last] === "string" ? parent[last] : "");
      return copy;
    };
    for (const path of paths) {
      for (const mutate of [(s: string) => `${s}x`, (s: string) => s.slice(0, -1), (s: string) => (s === "" ? "x" : `${s.slice(0, -1)}${s.endsWith("0") ? "1" : "0"}`)]) {
        const result = verifyAttestation(edit(path, mutate), {});
        assert.notEqual(result.signature.status, "VALID", path.join("."));
      }
    }
    for (const path of arrays) {
      const copy = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
      (locate(copy, path) as unknown as unknown[]).push("obs-identity");
      assert.notEqual(verifyAttestation(copy, {}).signature.status, "VALID", path.join("."));
    }
    // The mutants above often stop parsing, which proves the shape, not the signature. These stay well-formed, so it is the
    // signature that must refuse each one: every field that carries meaning is inside the signed bytes.
    const alternatives: [(string | number)[], unknown][] = [
      [["statement", "purpose"], "ISSUER_ASSESSMENT_ORIGIN"],
      [["statement", "signer", "signerId"], "synthetic-other"],
      [["statement", "signer", "keyId"], "synthetic-reviewer-y-9"],
      [["statement", "signer", "publicKey"], syntheticKey(2).publicKey],
      [["statement", "target", "wallprintVersion"], "0.1"],
      [["statement", "target", "bundleDigest"], "0".repeat(64)],
      [["statement", "target", "focalAssertionId"], "a-balance"],
      [["statement", "target", "assessment", "assessor"], "reviewer-q"],
      [["statement", "target", "assessment", "assessorRole"], "OTHER"],
      [["statement", "target", "assessment", "assessment"], "CONFIRMED"],
      [["statement", "target", "assessment", "statement"], "Another statement."],
      [["statement", "target", "assessment", "policy"], "reviewer-y-review-b"],
      [["statement", "target", "assessment", "policyVersion"], "2"],
      [["statement", "target", "assessment", "assessedAt"], "2026-10-23T12:00:01Z"],
      [["statement", "target", "assessment", "evidenceRefs"], ["obs-identity"]],
      [["statement", "target", "assessment", "limitations"], ["TRANSPORT_FIDELITY_NOT_VERIFIED"]],
    ];
    for (const [path, value] of alternatives) {
      const copy = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
      locate(copy, path.slice(0, -1))[path[path.length - 1] as string] = value;
      const r = verifyAttestation(copy, {});
      assert.equal(r.parse, "PARSED", path.join("."));
      assert.equal(r.signature.status, "INVALID", path.join("."));
    }
    const otherAlgorithm = JSON.parse(JSON.stringify(original)) as AttestationEnvelope;
    otherAlgorithm.statement.signer.algorithm = "ED25519B";
    assert.equal(verifyAttestation(otherAlgorithm, {}).signature.status, "NOT_CHECKED", "an unsupported algorithm is never valid");
    // Unsigned additions are refused, never ignored.
    for (const where of [[], ["statement"], ["statement", "signer"], ["statement", "target"], ["statement", "target", "assessment"]]) {
      const copy = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
      let node = copy;
      for (const seg of where) node = node[seg] as Record<string, unknown>;
      node["note"] = "unsigned";
      assert.equal(verifyAttestation(copy, {}).parse, "MALFORMED", where.join("."));
    }
  });

  test("the envelope has no unsigned metadata: its only fields are the type, the version selector, the statement and the signature", () => {
    assert.deepEqual(Object.keys(valid).sort(), ["attestationVersion", "signature", "statement", "type"]);
    assert.equal(valid.attestationVersion, valid.statement.attestationVersion);
    assert.equal(parseAttestation({ ...valid, attestationVersion: "0.1", statement: { ...valid.statement, attestationVersion: "0.1" } }).ok, true);
    assert.deepEqual(Object.keys(valid.statement).sort(), ["attestationVersion", "purpose", "signer", "target"]);
    assert.deepEqual(Object.keys(valid.statement.signer).sort(), ["algorithm", "keyId", "publicKey", "signerId"]);
    for (const key of JSON.stringify(valid).match(/"[A-Za-z]+":/g) ?? []) assert.doesNotMatch(key, /signedAt|timestamp|clock|createdAt|publishedAt|nonce/i, "no wall-clock or ambient field exists in an attestation");
  });
});

describe("attestation: what is signed", () => {
  test("a record attestation signs exactly the identity a receipt carries, and the receipt stays unsigned and unchanged", () => {
    const receipt = wallPrintReceipt(golden);
    assert.deepEqual(recT, { kind: "WALLPRINT_RECORD", wallprintVersion: receipt.wallprintVersion, recordId: receipt.recordId, canonicalization: receipt.canonicalization, digestAlgorithm: receipt.digestAlgorithm, digest: receipt.digest });
    assert.deepEqual(Object.keys(receipt).sort(), ["bundleDigest", "canonicalization", "digest", "digestAlgorithm", "recordId", "versions", "wallprintVersion"], "the receipt gained no signature field");
    assert.deepEqual(verifyReceipt(receipt, golden), { matches: true, reasons: [] });
  });

  test("attestations never touch the record: same record, same digest, and the closed record shape has no slot for one", () => {
    const before = wallPrintDigest(golden);
    attest("RECORD_PUBLICATION", WHO.publisher2, recT);
    assert.equal(wallPrintDigest(golden), before);
    for (const field of ["attestations", "signature", "signatures", "attestation"]) {
      assert.equal(WallPrintRecordSchema.safeParse({ ...golden, [field]: [] }).success, false, field);
      assert.equal(validateWallPrintRecord({ ...golden, [field]: "x" }).ok, false, field);
    }
  });

  test("an assessment attestation signs the assessment as recorded, in its bundle and focal-assertion context, and not the record", () => {
    assert.equal(reviewerT.bundleDigest, golden.evidence.bundleDigest);
    assert.equal(reviewerT.focalAssertionId, golden.subject.focalAssertionId);
    assert.equal(canonicalize(reviewerT.assessment), canonicalize(golden.assessments.find((a) => a.assessor === "reviewer-y")));
    assert.equal(JSON.stringify(valid).includes(golden.digest), false, "the record digest is not in an assessment attestation");
    const successor = goldenRecord({ id: "wp-attest-successor" });
    assert.notEqual(successor.digest, golden.digest);
    assert.equal(assessmentTargetKey(assessmentTargetOf(successor, "reviewer-y")), assessmentTargetKey(reviewerT), "the same assessment about the same evidence has one target key, whatever record carries it");
    assert.equal(verifyAttestation(valid, { record: successor }).target.status, "MATCHED", "found by derivation from the successor's own content, never copied forward");
    assert.equal(verifyAttestation(publication, { record: successor }).target.status, "MISMATCHED", "a record attestation is never carried to a successor");
  });

  test("a statement with the wrong target kind or role for its purpose can never authenticate it", () => {
    assert.deepEqual(statementFindings(statementFor("ASSESSMENT_ORIGIN", WHO.reviewerY2, recT)), ["PURPOSE_TARGET_MISMATCH"]);
    assert.deepEqual(statementFindings(statementFor("RECORD_PUBLICATION", WHO.publisher2, reviewerT)), ["PURPOSE_TARGET_MISMATCH"]);
    assert.deepEqual(statementFindings(statementFor("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(golden, "issuer:circle"))), ["PURPOSE_ROLE_MISMATCH"]);
    assert.deepEqual(statementFindings(statementFor("ISSUER_ASSESSMENT_ORIGIN", WHO.circle2, reviewerT)), ["PURPOSE_ROLE_MISMATCH"]);
    assert.deepEqual(statementFindings(statementFor("ASSESSMENT_ORIGIN", WHO.publisher2, assessmentTargetOf(golden, "walletwall-rules"))), ["WALLETWALL_ASSESSMENT_NOT_ATTESTABLE"]);
    assert.deepEqual(statementFindings(statementFor("ISSUER_ASSESSMENT_ORIGIN", WHO.circle2, assessmentTargetOf(golden, "issuer:circle"))), []);
  });

  test("target keys address attestations: a record's own digest, or the digest of an assessment target; both are index keys, never signed", () => {
    assert.equal(targetKeyOf(recT), golden.digest);
    const key = targetKeyOf(reviewerT);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, targetKeyOf({ ...reviewerT, wallprintVersion: "0.1" }));
    assert.notEqual(key, targetKeyOf({ ...reviewerT, focalAssertionId: "a-other" }));
    assert.notEqual(key, targetKeyOf({ ...reviewerT, assessment: { ...reviewerT.assessment, policy: "other" } }));
    assert.match(attestationDigest(valid), /^[0-9a-f]{64}$/);
    assert.equal(attestationDigest(valid), attestationDigest(JSON.parse(JSON.stringify(valid)) as AttestationEnvelope));
  });

  test("the vocabulary tables agree with each other: one target kind and one signer kind per purpose, and a signer kind's purposes are its own", () => {
    for (const purpose of ATTESTATION_PURPOSES) {
      assert.ok(SIGNER_KIND_PURPOSES[PURPOSE_SIGNER_KIND[purpose]].includes(purpose));
      assert.ok(["WALLPRINT_RECORD", "WALLPRINT_ASSESSMENT"].includes(PURPOSE_TARGET_KIND[purpose]));
    }
    for (const [kind, purposes] of Object.entries(SIGNER_KIND_PURPOSES)) for (const p of purposes) assert.equal(PURPOSE_SIGNER_KIND[p], kind);
  });
});

describe("attestation: reading untrusted input", () => {
  const text = JSON.stringify(valid);
  test("strict JSON: a repeated key, a byte-order mark, a deep nest, an oversize body and malformed UTF-8 are refused with fixed codes", () => {
    assert.deepEqual(parseAttestation(text.replace('"type":', '"type":"x","type":')), { ok: false, problem: "DUPLICATE_KEY", unsupportedVersion: false });
    assert.deepEqual(parseAttestation(`\uFEFF${text}`), { ok: false, problem: "SYNTAX", unsupportedVersion: false });
    assert.deepEqual(parseAttestation(new Uint8Array([0xff, 0xfe, 0x7b])), { ok: false, problem: "SYNTAX", unsupportedVersion: false });
    assert.deepEqual(parseAttestation("[".repeat(40) + "]".repeat(40)), { ok: false, problem: "TOO_DEEP", unsupportedVersion: false });
    assert.deepEqual(parseAttestation(" ".repeat(20_000) + text), { ok: false, problem: "BODY_TOO_LARGE", unsupportedVersion: false });
    assert.equal(parseAttestation(text).ok, true);
    assert.equal(parseAttestation(new TextEncoder().encode(text)).ok, true);
  });

  test("a prototype key, an unknown version and a version that disagrees with its signed twin are refused", () => {
    assert.equal(parseAttestation(text.replace('"type":', '"__proto__":{},"type":')).ok, false);
    assert.deepEqual(parseAttestation({ ...valid, attestationVersion: "9.9" }), { ok: false, problem: "SHAPE", unsupportedVersion: true });
    assert.equal(verifyAttestation({ ...valid, attestationVersion: "9.9" }).parse, "UNSUPPORTED_VERSION");
    const disagree = parseAttestation({ ...valid, attestationVersion: "0.1", statement: { ...valid.statement, attestationVersion: "0.1" } });
    assert.equal(disagree.ok, true);
    assert.equal(parseAttestation(JSON.stringify({ ...valid, statement: { ...valid.statement, attestationVersion: "0.2" } })).ok, false);
  });

  test("a malformed attestation never echoes any of its text and never throws", () => {
    const marker = "ECHO-CANARY-7f3a";
    const hostile = [null, undefined, 1, true, [], {}, "x", marker, { type: marker }, { ...valid, signature: marker }, { ...valid, statement: marker }, { ...valid, statement: { ...valid.statement, purpose: marker } }, JSON.parse(`{"${marker}": 1}`)];
    for (const input of hostile) {
      const result = verifyAttestation(input, { record: marker, keyRegistry: marker, trustAnchor: { version: marker, digest: marker }, acceptance: { ledger: marker, anchor: { seq: marker, digest: marker } } });
      assert.equal(JSON.stringify(result).includes(marker), false);
      assert.equal(result.origin, "NONE");
    }
  });
});

describe("attestation: the language it speaks", () => {
  test("no fixed sentence uses a reserved assurance term, and every origin level has one that states the authenticated dimension", () => {
    for (const sentence of [ATTESTATION_ESTABLISHES, ...ATTESTATION_DOES_NOT_ESTABLISH, ...Object.values(ORIGIN_STATEMENTS)]) assert.deepEqual(findReservedAssuranceTerms(sentence), [], sentence);
    for (const origin of ["KEY_ONLY", "BOUND_ASSESSOR", "BOUND_ISSUER_AUTHORITY", "BOUND_WALLETWALL_PUBLISHER"] as const) assert.match(ORIGIN_STATEMENTS[origin], /signed/);
    for (const origin of ["BOUND_ASSESSOR", "BOUND_ISSUER_AUTHORITY"] as const) assert.match(ORIGIN_STATEMENTS[origin], /authenticates the origin of the attributed statement; it does not show .*statement is correct/);
    assert.match(ORIGIN_STATEMENTS.BOUND_WALLETWALL_PUBLISHER, /not a certification/);
  });

  test("a verification result has no flag named for a verdict, and carries what it does not establish", () => {
    const result = verifyAttestation(publication, pinnedContext(publication, 2));
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          names.push(k);
          walk(v);
        }
      }
    };
    walk(result);
    for (const name of names) assert.doesNotMatch(name, /^(verified|valid|trusted|trust|certified|safe|ok|passed|score|confidence|rank|count|signatures|majority)$/i, name);
    assert.ok(result.doesNotEstablish.includes("factual truth of the attributed statement"));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.atAcceptance));
  });
});
