import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { findSecretLike } from "../../src/wallprint/language.ts";
import { buildWallPrintSnapshot, HEX64_RE as RECORD_HEX64_RE, RECORD_ID_RE as RECORD_RECORD_ID_RE, verifyWallPrintDigest, wallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../src/wallprint/record.ts";
import {
  encodeReference,
  encodeReferenceEnvelope,
  parseReference,
  parseReferenceEnvelope,
  REFERENCE_DOES_NOT_ESTABLISH,
  REFERENCE_ENVELOPE_TYPE,
  REFERENCE_IDENTIFIES,
  REFERENCE_MAX_LENGTH,
  REFERENCE_OUTCOMES,
  REFERENCE_PREFIX,
  REFERENCE_TARGETS,
  REFERENCE_VERSION,
  referenceEnvelope,
  referenceFindings,
  referenceOf,
  resolveReference,
  SUPPORTED_WALLPRINT_VERSIONS,
  tryReference,
  type FoundRecord,
} from "../../src/wallprint/reference.ts";
import { HEX64_RE, RECORD_ID_RE, WALLPRINT_VERSIONS } from "../../src/wallprint/vocabulary.ts";
import { baseInput, COMMIT_AT, DISCLOSE_AT, issuerAssessment, LATER2_AT, LATER_AT, LATER_SNAPSHOT_AT } from "./support.ts";

/**
 * The portable reference is a locator for one committed record: which record, which bytes, which contract version and,
 * optionally, which section. It is not authority. Encoding is deterministic, parsing is strict and fails closed, and a
 * reference to a corrected, superseded or withdrawn record stays a valid reference to that record.
 */

const record = buildWallPrintSnapshot(baseInput({ wallprintVersion: "0.1" }));
const facts = (r: WallPrintRecord): FoundRecord => ({ recordId: r.id, embeddedDigest: r.digest, computedDigest: verifyWallPrintDigest(r).computedDigest });
const text = (over: Partial<Record<"id" | "reference" | "wallprint" | "digest" | "target", string>> = {}, withTarget = false): string =>
  `walletwall://wallprint/${over.id ?? record.id}?reference=${over.reference ?? "0.1"}&wallprint=${over.wallprint ?? "0.1"}&digest=${over.digest ?? record.digest}${withTarget || over.target !== undefined ? `&target=${over.target ?? "receipt"}` : ""}`;

describe("the portable reference: a locator, deterministic in both forms", () => {
  test("the record's reference carries exactly its id, digest and WallPrint version, a version of its own and no target; the shapes are the record's own", () => {
    const ref = referenceOf(record);
    assert.deepEqual(ref, { version: "0.1", wallprintVersion: "0.1", recordId: record.id, digest: record.digest, target: null });
    assert.ok(Object.isFrozen(ref));
    assert.equal(REFERENCE_VERSION, "0.1");
    assert.deepEqual([...SUPPORTED_WALLPRINT_VERSIONS], [...WALLPRINT_VERSIONS], "a reference can name any version a record can carry");
    assert.equal(RECORD_ID_RE, RECORD_RECORD_ID_RE, "one definition of the record id shape");
    assert.equal(HEX64_RE, RECORD_HEX64_RE, "one definition of the digest shape");
    for (const k of Object.keys(ref)) assert.doesNotMatch(k, /true|truth|verified|valid|safe|certified|trust|status|signature|issuer|locator|url/i, k);
    assert.deepEqual([...REFERENCE_TARGETS], ["record", "receipt", "replay", "history", "assessments", "provenance"]);
    assert.deepEqual([...REFERENCE_OUTCOMES], ["RESOLVED", "UNAVAILABLE", "NOT_COMPARED", "DIGEST_MISMATCH", "MALFORMED_REFERENCE", "UNSUPPORTED_VERSION"]);
  });

  test("the text form is one fixed string: scheme, record id, then reference version, WallPrint version, digest and the optional target, in that order", () => {
    const ref = referenceOf(record);
    const encoded = encodeReference(ref);
    assert.equal(encoded, `walletwall://wallprint/${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}`);
    assert.equal(encoded, encodeReference(referenceOf(record)), "deterministic");
    assert.equal(encodeReference(referenceOf(record, "receipt")), `${encoded}&target=receipt`);
    assert.ok(encoded.startsWith(REFERENCE_PREFIX));
    assert.ok(!/https?:|localhost|127\.0\.0\.1|[A-Z]:\\|\/Users\/|\/home\/|%|#|\s/.test(encoded), "no URL, host, path, percent-encoding, fragment or whitespace");
    assert.equal(findSecretLike(encoded), null);
    assert.equal(findSecretLike(encodeReferenceEnvelope(ref)), null);
  });

  test("parse(encode(reference)) is the reference, exactly, for every target and for the envelope form; ids and digests are never normalised", () => {
    for (const target of [null, ...REFERENCE_TARGETS]) {
      const ref = referenceOf(record, target);
      const back = parseReference(encodeReference(ref));
      assert.deepEqual(back, { ok: true, reference: ref });
      const env = parseReference(encodeReferenceEnvelope(ref));
      assert.deepEqual(env, { ok: true, reference: ref });
      assert.deepEqual(parseReferenceEnvelope(JSON.parse(encodeReferenceEnvelope(ref))), { ok: true, reference: ref });
      assert.ok(back.ok);
      assert.equal(encodeReference(back.reference), encodeReference(ref), "text -> parse -> text is the identity");
    }
  });

  test("the envelope is the locator fields plus a type tag, in RFC 8785 form equal to the engine's canonicalizer; it is not a record", () => {
    const ref = referenceOf(record, "replay");
    const envelope = referenceEnvelope(ref);
    assert.deepEqual(envelope, { type: REFERENCE_ENVELOPE_TYPE, version: "0.1", wallprintVersion: "0.1", recordId: record.id, digest: record.digest, target: "replay" });
    assert.equal(encodeReferenceEnvelope(ref), canonicalize(envelope));
    assert.equal(encodeReferenceEnvelope(ref), `{"digest":"${record.digest}","recordId":"${record.id}","target":"replay","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`);
    assert.equal(encodeReferenceEnvelope(referenceOf(record)), canonicalize(referenceEnvelope(referenceOf(record))));
    assert.ok(!("target" in referenceEnvelope(referenceOf(record))), "an absent target is absent, not null, in the envelope");
    for (const k of ["claims", "assessments", "evidence", "snapshotAt", "subject", "provenance"]) assert.ok(!(k in envelope), `${k}: the envelope carries no record content`);
  });

  test("the longest text of either form fits the length cap; the cap refuses longer input before any parsing", () => {
    const longest = { ...referenceOf(record, "assessments"), recordId: "a".repeat(64) };
    assert.ok(encodeReference(longest).length <= REFERENCE_MAX_LENGTH);
    assert.ok(encodeReferenceEnvelope(longest).length <= REFERENCE_MAX_LENGTH);
    assert.deepEqual(parseReference(`${encodeReference(longest)}${"&".repeat(REFERENCE_MAX_LENGTH)}`), { ok: false, outcome: "MALFORMED_REFERENCE", problem: "length" });
  });

  test("tryReference returns null and referenceOf / encodeReference throw INVALID_REFERENCE for a part without its fixed shape; nothing is coerced", () => {
    assert.equal(tryReference({ recordId: "WP-UPPER", digest: record.digest, wallprintVersion: "0.1" }), null);
    assert.equal(tryReference({ recordId: record.id, digest: record.digest.toUpperCase(), wallprintVersion: "0.1" }), null);
    assert.equal(tryReference({ recordId: record.id, digest: record.digest, wallprintVersion: "0.3" }), null);
    assert.equal(tryReference({ recordId: record.id, digest: record.digest, wallprintVersion: "0.1" }, "summary"), null);
    assert.equal(tryReference({ recordId: 7, digest: null, wallprintVersion: undefined }), null);
    assert.equal(tryReference({ recordId: `0x${"cd".repeat(20)}`, digest: record.digest, wallprintVersion: "0.1" }), null, "an address is an identity, never a record id");
    assert.equal(tryReference({ recordId: "wp-certified-v1", digest: record.digest, wallprintVersion: "0.1" }), null, "no reserved assurance term in an id");
    assert.deepEqual(referenceFindings({ ...referenceOf(record), recordId: "wp-trusted-v1" }).map((f) => f.code), ["MANUFACTURED_ASSURANCE"]);
    assert.deepEqual(referenceFindings({ ...referenceOf(record), recordId: `0x${"cd".repeat(20)}` }).map((f) => f.code), ["INVALID_ID"]);
    assert.throws(() => referenceOf({ id: "x", digest: record.digest, wallprintVersion: "0.1" }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_REFERENCE" && e.findings.some((f) => f.code === "INVALID_ID" && f.path === "recordId"));
    assert.throws(() => encodeReference({ ...referenceOf(record), digest: "0x" + "a".repeat(62) }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_REFERENCE");
    assert.throws(() => encodeReferenceEnvelope({ ...referenceOf(record), target: "verified" as never }), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_REFERENCE");
    assert.deepEqual(referenceFindings({ ...referenceOf(record), extra: true }).map((f) => f.code), ["UNKNOWN_FIELD"]);
    assert.deepEqual(referenceFindings("walletwall://wallprint/x").map((f) => f.code), ["INVALID_TYPE"]);
  });
});

describe("strict parsing: the four outcomes are distinct, fail closed, and never echo the input", () => {
  const cases: [string, unknown, string, string][] = [
    ["not a string", 42, "MALFORMED_REFERENCE", "text"],
    ["empty", "", "MALFORMED_REFERENCE", "text"],
    ["an https URL", `https://walletwall.org/wallprint/${record.id}?digest=${record.digest}`, "MALFORMED_REFERENCE", "scheme"],
    ["a javascript: payload", "javascript:alert(1)", "MALFORMED_REFERENCE", "characters"],
    ["a file: payload", "file:///etc/passwd", "MALFORMED_REFERENCE", "scheme"],
    ["a data: payload", "data:text/html,<script>1</script>", "MALFORMED_REFERENCE", "characters"],
    ["a localhost URL", `http://localhost:3000/wallprint/${record.id}`, "MALFORMED_REFERENCE", "scheme"],
    ["a loopback URL", `http://127.0.0.1:8080/x/?digest=${record.digest}`, "MALFORMED_REFERENCE", "scheme"],
    ["an upper-case scheme", text().replace("walletwall://", "WALLETWALL://"), "MALFORMED_REFERENCE", "scheme"],
    ["a different host", text().replace("://wallprint/", "://wallprints/"), "MALFORMED_REFERENCE", "scheme"],
    ["an authority with credentials", text().replace("://wallprint/", "://user:pw@wallprint/"), "MALFORMED_REFERENCE", "characters"],
    ["no query", `walletwall://wallprint/${record.id}`, "MALFORMED_REFERENCE", "query"],
    ["parameters out of order", `walletwall://wallprint/${record.id}?digest=${record.digest}&reference=0.1&wallprint=0.1`, "MALFORMED_REFERENCE", "query"],
    ["a duplicated parameter", `${text()}&digest=${record.digest}`, "MALFORMED_REFERENCE", "query"],
    ["a duplicated target", `${text({}, true)}&target=replay`, "MALFORMED_REFERENCE", "query"],
    ["an extra parameter", `${text()}&redirect=walletwall://wallprint/other`, "MALFORMED_REFERENCE", "query"],
    ["a parameter without a value", `${text()}&target`, "MALFORMED_REFERENCE", "query"],
    ["a value with an equals sign", text({ target: "receipt=1" }), "MALFORMED_REFERENCE", "query"],
    ["a trailing ampersand", `${text()}&`, "MALFORMED_REFERENCE", "query"],
    ["a fragment", `${text()}#receipt`, "MALFORMED_REFERENCE", "characters"],
    ["percent-encoding", text({ id: "wp%2Dgolden-identity" }), "MALFORMED_REFERENCE", "characters"],
    ["malformed percent-encoding", text({ id: "wp%zz" }), "MALFORMED_REFERENCE", "characters"],
    ["a space", text({ id: "wp golden" }), "MALFORMED_REFERENCE", "characters"],
    ["a plus sign", text({ id: "wp+golden" }), "MALFORMED_REFERENCE", "characters"],
    ["a control character", text({ id: "wp-golden\u0000" }), "MALFORMED_REFERENCE", "characters"],
    ["a newline", `${text()}\n`, "MALFORMED_REFERENCE", "characters"],
    ["a bidi override", text({ id: "wp-‮golden" }), "MALFORMED_REFERENCE", "characters"],
    ["a zero-width joiner", text({ id: "wp-‍golden" }), "MALFORMED_REFERENCE", "characters"],
    ["HTML in the id", text({ id: "<script>alert(1)</script>" }), "MALFORMED_REFERENCE", "characters"],
    ["a quote in the digest", text({ digest: `${record.digest.slice(0, 63)}"` }), "MALFORMED_REFERENCE", "characters"],
    ["path traversal", `walletwall://wallprint/../../${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}`, "MALFORMED_REFERENCE", "recordId"],
    ["a nested path", `walletwall://wallprint/lineage/${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}`, "MALFORMED_REFERENCE", "recordId"],
    ["an empty id", text({ id: "" }), "MALFORMED_REFERENCE", "recordId"],
    ["an upper-case id (case ambiguity)", text({ id: record.id.toUpperCase() }), "MALFORMED_REFERENCE", "recordId"],
    ["a 65-character id", text({ id: "a".repeat(65) }), "MALFORMED_REFERENCE", "recordId"],
    ["a two-character id", text({ id: "ab" }), "MALFORMED_REFERENCE", "recordId"],
    ["a short digest", text({ digest: record.digest.slice(0, 63) }), "MALFORMED_REFERENCE", "digest"],
    ["a long digest", text({ digest: `${record.digest}0` }), "MALFORMED_REFERENCE", "digest"],
    ["an upper-case digest (case ambiguity)", text({ digest: record.digest.toUpperCase() }), "MALFORMED_REFERENCE", "digest"],
    ["a 0x-prefixed digest", text({ digest: `0x${record.digest.slice(2)}` }), "MALFORMED_REFERENCE", "digest"],
    ["an empty digest", text({ digest: "" }), "MALFORMED_REFERENCE", "digest"],
    ["an unknown target", text({ target: "summary" }), "MALFORMED_REFERENCE", "target"],
    ["a DOM id as target", text({ target: "wp-sec-receipt-wp-golden-identity" }), "MALFORMED_REFERENCE", "target"],
    ["a selector as target", text({ target: "body" }), "MALFORMED_REFERENCE", "target"],
    ["an upper-case target", text({ target: "RECEIPT" }), "MALFORMED_REFERENCE", "target"],
    ["an empty target", text({ target: "" }), "MALFORMED_REFERENCE", "target"],
    ["a reference version that is not a version", text({ reference: "latest" }), "MALFORMED_REFERENCE", "reference"],
    ["an unsupported reference version", text({ reference: "0.2" }), "UNSUPPORTED_VERSION", "reference"],
    ["an unsupported reference version with a different grammar after it", `walletwall://wallprint/${record.id}?reference=1.0&id=${record.id}`, "UNSUPPORTED_VERSION", "reference"],
    ["a WallPrint version that is not a version", text({ wallprint: "0.1.0" }), "MALFORMED_REFERENCE", "wallprint"],
    ["an unsupported WallPrint version", text({ wallprint: "0.3" }), "UNSUPPORTED_VERSION", "wallprint"],
    ["a credential-shaped id", text({ id: "sk_live_" + "abcdefghijklmnop" }), "MALFORMED_REFERENCE", "recordId"],
    ["an address-shaped id", text({ id: `0x${"ab".repeat(20)}` }), "MALFORMED_REFERENCE", "recordId"],
    ["an id carrying a reserved assurance term", text({ id: "wp-verified-record-v1" }), "MALFORMED_REFERENCE", "recordId"],
    ["an id carrying a hyphenated reserved assurance term", text({ id: "investment-grade-wp" }), "MALFORMED_REFERENCE", "recordId"],
    ["a reference version with a leading zero", text({ reference: "00.1" }), "MALFORMED_REFERENCE", "reference"],
    ["a WallPrint version with a leading zero in its minor", text({ wallprint: "0.01" }), "MALFORMED_REFERENCE", "wallprint"],
    ["a WallPrint version ten (a version, not this one)", text({ wallprint: "0.10" }), "UNSUPPORTED_VERSION", "wallprint"],
    ["a pretty-printed envelope (only the canonical text is admitted)", `{ "digest": "${record.digest}", "recordId": "${record.id}", "type": "walletwall.wallprint.reference", "version": "0.1", "wallprintVersion": "0.1" }`, "MALFORMED_REFERENCE", "characters"],
    ["an envelope with its keys reordered", `{"recordId":"${record.id}","digest":"${record.digest}","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with a wrong type", `{"digest":"${record.digest}","recordId":"${record.id}","type":"walletwall.wallprint.record","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with an extra key", `{"digest":"${record.digest}","recordId":"${record.id}","trusted":"true","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with a missing key", `{"digest":"${record.digest}","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope that names a key twice (JSON.parse would keep the last)", `{"digest":"${"0".repeat(64)}","digest":"${record.digest}","recordId":"${record.id}","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope that names the target twice", `{"digest":"${record.digest}","recordId":"${record.id}","target":"replay","target":"receipt","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with a prototype key", `{"__proto__":{"x":1},"digest":"${record.digest}","recordId":"${record.id}","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with a non-string value", `{"digest":"${record.digest}","recordId":"${record.id}","target":null,"type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope with a JSON escape", `{"digest":"${record.digest}","recordId":"\\u0077p-golden-identity","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "characters"],
    ["an envelope that is not JSON", `{"digest":"${record.digest}"`, "MALFORMED_REFERENCE", "envelope"],
    ["an envelope that is an array", `["walletwall.wallprint.reference"]`, "MALFORMED_REFERENCE", "characters"],
    ["an envelope with an unknown target", `{"digest":"${record.digest}","recordId":"${record.id}","target":"summary","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}`, "MALFORMED_REFERENCE", "target"],
    ["an envelope with an unsupported version", `{"digest":"${record.digest}","recordId":"${record.id}","type":"walletwall.wallprint.reference","version":"0.9","wallprintVersion":"0.1"}`, "UNSUPPORTED_VERSION", "reference"],
    ["an envelope with an unsupported WallPrint version", `{"digest":"${record.digest}","recordId":"${record.id}","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"1.0"}`, "UNSUPPORTED_VERSION", "wallprint"],
  ];

  for (const [name, input, outcome, problem] of cases) {
    test(`${name} -> ${outcome} (${problem})`, () => {
      const result = parseReference(input);
      assert.deepEqual(result, { ok: false, outcome, problem });
      // Nothing of the input survives in the result: a fixed outcome and a fixed problem code only. The grammar's own
      // words (parameter and envelope names) are fixed tokens, not input, and a problem code may name one of them.
      const printed = JSON.stringify(result);
      const grammar = new Set(["walletwall", "wallprint", "reference", "digest", "target", "type", "version", "wallprintVersion", "recordId", "walletwall.wallprint.reference"]);
      if (typeof input === "string") for (const piece of input.split(/[?&=/:"{},]/).filter((p) => p.length >= 4 && !grammar.has(p))) assert.ok(!printed.includes(piece), `${name}: result echoes ${piece}`);
    });
  }

  test("every outcome and problem code is a fixed token from a closed set", () => {
    const problems = new Set<string>();
    for (const [, input] of cases) {
      const r = parseReference(input);
      if (!r.ok) {
        assert.ok(["MALFORMED_REFERENCE", "UNSUPPORTED_VERSION"].includes(r.outcome));
        problems.add(r.problem);
      }
    }
    for (const p of problems) assert.match(p, /^[a-zA-Z]+$/);
    assert.ok(problems.size >= 9, `problems seen: ${[...problems].join(", ")}`);
  });

  test("a parsed reference is frozen, so a consumer cannot turn a locator into something else after the fact", () => {
    const r = parseReference(text({}, true));
    assert.ok(r.ok && Object.isFrozen(r.reference));
  });
});

describe("resolution: which record, which bytes; never which record is right", () => {
  test("a store that holds nothing for the id is UNAVAILABLE, as is one that returns a different record; neither says invalid or false", () => {
    const ref = referenceOf(record, "receipt");
    assert.deepEqual(resolveReference(ref, null), { outcome: "UNAVAILABLE", recordId: record.id });
    const other = buildWallPrintSnapshot(baseInput({ id: "wp-other" }));
    assert.deepEqual(resolveReference(ref, facts(other)), { outcome: "UNAVAILABLE", recordId: record.id });
    assert.ok(!/invalid|false|untrusted/i.test(JSON.stringify(resolveReference(ref, null))));
  });

  test("the record that carries the digest and whose bytes produce it is RESOLVED, with the target carried through", () => {
    for (const target of [null, ...REFERENCE_TARGETS]) assert.deepEqual(resolveReference(referenceOf(record, target), facts(record)), { outcome: "RESOLVED", recordId: record.id, digest: record.digest, target });
  });

  test("a resolved record that does not match the reference's digest is DIGEST_MISMATCH, with every digest reported and no verdict about which is right", () => {
    const ref = referenceOf(record);
    // A copy altered after commit: the embedded digest still matches the reference, the bytes no longer produce it.
    const altered = { ...record, snapshotAt: "2026-10-23T12:00:31Z" };
    const r1 = resolveReference(ref, facts(altered));
    assert.deepEqual(r1, { outcome: "DIGEST_MISMATCH", recordId: record.id, referenceDigest: record.digest, embeddedDigest: record.digest, computedDigest: wallPrintDigest(altered) });
    // A record re-digested elsewhere under the same id: both digests differ from the reference.
    const payload = structuredClone(wallPrintPayload(record));
    payload.snapshotAt = "2026-10-23T12:00:31Z";
    const elsewhere = { ...payload, digest: wallPrintDigest(payload) };
    const r2 = resolveReference(ref, facts(elsewhere));
    assert.equal(r2.outcome, "DIGEST_MISMATCH");
    assert.ok(r2.outcome === "DIGEST_MISMATCH" && r2.embeddedDigest === elsewhere.digest && r2.computedDigest === elsewhere.digest && r2.referenceDigest === record.digest);
    for (const r of [r1, r2]) assert.ok(!/forged|fake|fraud|malicious|tamper|invalid|false/i.test(JSON.stringify(r)), "no verdict wording in the resolution");
  });

  test("a store that carries no digest, or no computed digest, for the record is NOT_COMPARED: nothing was compared, so nothing is called a mismatch and nothing is resolved", () => {
    const ref = referenceOf(record);
    // Even when the embedded digest equals the reference's, an absent computed digest means the bytes were not checked.
    assert.deepEqual(resolveReference(ref, { recordId: record.id, embeddedDigest: record.digest, computedDigest: null }), { outcome: "NOT_COMPARED", recordId: record.id, referenceDigest: record.digest, embeddedDigest: record.digest, computedDigest: null });
    assert.deepEqual(resolveReference(ref, { recordId: record.id, embeddedDigest: null, computedDigest: record.digest }), { outcome: "NOT_COMPARED", recordId: record.id, referenceDigest: record.digest, embeddedDigest: null, computedDigest: record.digest });
    assert.deepEqual(resolveReference(ref, { recordId: record.id, embeddedDigest: null, computedDigest: null }), { outcome: "NOT_COMPARED", recordId: record.id, referenceDigest: record.digest, embeddedDigest: null, computedDigest: null });
    // A malformed digest from the store is absent, never compared as equal and never called a mismatch.
    assert.equal(resolveReference(ref, { recordId: record.id, embeddedDigest: record.digest.toUpperCase(), computedDigest: record.digest }).outcome, "NOT_COMPARED");
    assert.equal(resolveReference(ref, { recordId: record.id, embeddedDigest: record.digest, computedDigest: "0x" + "a".repeat(62) }).outcome, "NOT_COMPARED");
  });

  test("a reference to a corrected predecessor, a superseded predecessor or a withdrawn record resolves to that record, not to the current one", () => {
    const v1 = buildWallPrintSnapshot(baseInput({ id: "wp-lineage-v1" }));
    const v2 = buildWallPrintSnapshot(baseInput({ id: "wp-lineage-v2", evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: v1.id, digest: v1.digest, kind: "CORRECTION", reason: "Issuer source corrected." } }));
    const s1 = buildWallPrintSnapshot(baseInput({ id: "wp-super-v1", assessments: [issuerAssessment()] }));
    const s2 = buildWallPrintSnapshot(baseInput({ id: "wp-super-v2", assessments: [issuerAssessment()], evaluatedAt: LATER_SNAPSHOT_AT, supersedes: { id: s1.id, digest: s1.digest, kind: "SUPERSESSION", reason: null } }));
    const w = buildWallPrintSnapshot(baseInput({ id: "wp-withdrawn" }));
    const h = createWallPrintHistory();
    h.commit(v1, { at: COMMIT_AT });
    h.disclose(v1.id, { at: DISCLOSE_AT });
    h.commit(v2, { at: LATER_AT });
    h.commit(s1, { at: COMMIT_AT });
    h.commit(s2, { at: LATER_AT });
    h.commit(w, { at: COMMIT_AT });
    h.withdraw(w.id, { at: LATER2_AT, reason: "Issuer publication retracted." });
    const lookup = (id: string): FoundRecord | null => {
      const view = h.view(id);
      return view === null ? null : facts(view.record);
    };
    for (const [old, current, state] of [
      [v1, v2, "CORRECTED"],
      [s1, s2, "SUPERSEDED"],
    ] as const) {
      const ref = referenceOf(old, "receipt");
      const parsed = parseReference(encodeReference(ref));
      assert.ok(parsed.ok);
      const r = resolveReference(parsed.reference, lookup(parsed.reference.recordId));
      assert.deepEqual(r, { outcome: "RESOLVED", recordId: old.id, digest: old.digest, target: "receipt" }, state);
      assert.equal(h.view(old.id)?.lifecycle.state, state, "the historical record keeps its lifecycle; the reference does not pretend it is current");
      assert.notEqual(r.outcome === "RESOLVED" && r.recordId, current.id, "nothing redirects an old reference to the current record");
      // The current record's reference is a different reference with a different digest; neither resolves to the other.
      assert.deepEqual(resolveReference(referenceOf(current), lookup(old.id)), { outcome: "UNAVAILABLE", recordId: current.id });
    }
    const wr = resolveReference(referenceOf(w, "history"), lookup(w.id));
    assert.deepEqual(wr, { outcome: "RESOLVED", recordId: w.id, digest: w.digest, target: "history" });
    assert.equal(h.view(w.id)?.lifecycle.state, "WITHDRAWN");
  });
});

describe("the boundary: a locator, not authority", () => {
  test("the statement of what a reference identifies and does not establish is fixed, and names no assurance", () => {
    assert.equal(REFERENCE_IDENTIFIES, "This reference identifies the WallPrint record and digest. Resolution depends on a compatible WalletWall disclosure store or resolver.");
    assert.ok(REFERENCE_DOES_NOT_ESTABLISH.includes("that any claim in the record is true") && REFERENCE_DOES_NOT_ESTABLISH.includes("the safety of the asset") && REFERENCE_DOES_NOT_ESTABLISH.includes("issuer endorsement of the record"));
    assert.ok(Object.isFrozen(REFERENCE_DOES_NOT_ESTABLISH));
    // The reserved assurance terms never appear, in any polarity, in WalletWall-authored reference prose.
    for (const s of [REFERENCE_IDENTIFIES, ...REFERENCE_DOES_NOT_ESTABLISH]) assert.ok(!/\b(verified|certified|safe|solvent|compliant|audited|approved|trusted|investment[- ]grade|authentic|guarantee)\b/i.test(s), s);
  });

  test("neither form carries a clock reading, a generated id, a path, an environment value, a credential or a URL", () => {
    const ref = referenceOf(record, "provenance");
    for (const s of [encodeReference(ref), encodeReferenceEnvelope(ref)]) {
      assert.ok(!/20\d\d-\d\d-\d\dT|Date|uuid|[A-Za-z]:\\|\/tmp\/|\$\{|process|https?:\/\//.test(s), s);
      assert.equal(findSecretLike(s), null);
      assert.ok(s.split(record.digest).length === 2, "the digest appears exactly once");
    }
  });
});
