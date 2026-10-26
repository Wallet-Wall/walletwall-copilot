import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { WallPrintError, type Finding } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { findReservedAssuranceTerms, findSecretLike } from "../../src/wallprint/language.ts";
import {
  buildPublicDisclosure,
  comparePublication,
  CONSTRUCTION_KINDS,
  DISCLOSURE_TYPE,
  extendStanding,
  isPublishableId,
  PUBLICATION_INDEX_TYPE,
  PUBLICATION_STATEMENT,
  PUBLICATION_VERSION,
  publicationFindings,
  privacyFindings,
  publicationIndex,
  PUBLISHABLE_ID_RE,
  RECORD_INDEX_TYPE,
  recordStanding,
  storeGraphFindings,
  verifyPublicDisclosure,
  verifyStanding,
  type RecordStanding,
  type DisclosureExport,
} from "../../src/wallprint/publication.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord, verifyWallPrintDigest, wallPrintPayload, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { RESOLVER_ROUTE } from "../../src/wallprint/reference.ts";
import { buildWallPrintDisclosures, type DisclosureFixture, type DisclosureRecord } from "../support/wallprint-disclosures.ts";
import { baseInput, COMMIT_AT, DISCLOSE_AT, LATER_AT } from "./support.ts";

/**
 * Publication: the deliberate step that turns one canonical disclosure (as the engine exported it) into an immutable public
 * artifact plus mutable standing metadata. It admits nothing the engine would not, re-checks every carried result against
 * the record, refuses anything credential-, path-, address- or environment-shaped outside the record's own content, and
 * produces bytes that are a pure function of the export: the same disclosure publishes to the same bytes, forever.
 */

const FIXTURES = buildWallPrintDisclosures();
const BASE = ["https:", "//", "walletwall.org"].join("");
const PUBLISHED_AT = "2026-10-26T18:00:00.000Z";

const exportOf = (fixture: DisclosureFixture, r: DisclosureRecord): DisclosureExport =>
  structuredClone({ title: fixture.title, construction: fixture.scenario, registry: fixture.registry, ...r });
const allExports = (): [string, DisclosureExport][] => Object.entries(FIXTURES).flatMap(([name, f]) => f.records.map((r): [string, DisclosureExport] => [`${name}/${r.id}`, exportOf(f, r)]));
const publishable = (): [string, DisclosureExport][] => allExports().filter(([, e]) => e.validation.ok);
const one = (): DisclosureExport => exportOf(FIXTURES["corrected"]!, FIXTURES["corrected"]!.records[1]!);
const codes = (findings: Finding[]): string[] => [...new Set(findings.map((f) => f.code))].sort();
const paths = (findings: Finding[]): string[] => [...new Set(findings.map((f) => f.path))].sort();
const patch = (e: DisclosureExport, fn: (x: Record<string, unknown>) => void): DisclosureExport => {
  const copy = structuredClone(e) as unknown as Record<string, unknown>;
  fn(copy);
  return copy as unknown as DisclosureExport;
};

/** A one-record export built directly from a history, so a lifecycle can be extended later in the test. */
function historyExport(withdraw: boolean): DisclosureExport {
  const record = buildWallPrintSnapshot(baseInput({ id: "wp-standing-v1" }));
  const h = createWallPrintHistory();
  h.commit(record, { at: COMMIT_AT });
  h.disclose(record.id, { at: DISCLOSE_AT });
  if (withdraw) h.withdraw(record.id, { at: LATER_AT, reason: "Re-evaluation requested." });
  const view = h.view(record.id)!;
  const store = createEvidenceStore();
  return structuredClone({
    title: "A standing test record.",
    construction: null,
    registry: { asset: null, chain: null },
    id: record.id,
    record,
    canonical: canonicalize(wallPrintPayload(record)),
    validation: { ok: true, findings: [] },
    digest: verifyWallPrintDigest(record),
    lifecycle: { state: view.lifecycle.state, events: [...view.lifecycle.events] },
    supersedes: view.supersedes,
    supersededBy: view.supersededBy,
    lineage: view.lineage,
    diff: null,
    receipt: { issued: null, verification: null },
    replay: replayWallPrint(record, { evidence: store }),
  });
}

describe("the publication contract: fixed types, versions and the boundary statement", () => {
  test("type tags and version are fixed; publishable ids are the record grammar without path-hostile characters", () => {
    assert.equal(DISCLOSURE_TYPE, "walletwall.wallprint.disclosure");
    assert.equal(RECORD_INDEX_TYPE, "walletwall.wallprint.record-index");
    assert.equal(PUBLICATION_INDEX_TYPE, "walletwall.wallprint.publication-index");
    assert.equal(PUBLICATION_VERSION, "0.1");
    assert.deepEqual([...CONSTRUCTION_KINDS], ["ENGINE_BUILT", "COMMITTED_ELSEWHERE", "ALTERED_AFTER_COMMIT", "VERIFICATION_NOT_CARRIED"]);
    for (const id of ["wp-identity-corrected-v1", "abc", "a_b-c", "0x1"]) assert.ok(PUBLISHABLE_ID_RE.test(id), id);
    for (const id of ["wp:x", "wp.x", "ab", "WP-x", "-wp", "wp/x", "wp x", "a".repeat(65), ""]) assert.ok(!PUBLISHABLE_ID_RE.test(id), id);
  });

  test("the public page's boundary statement is fixed, names no verdict and uses no reserved assurance term", () => {
    assert.equal(PUBLICATION_STATEMENT, "This page resolves a published WallPrint disclosure. Publication and resolution do not establish factual truth, safety, solvency, compliance, or investment merit.");
    assert.deepEqual(findReservedAssuranceTerms(PUBLICATION_STATEMENT), []);
    assert.ok(!/\b(verified|certified|trusted|authentic\w*|guarantee\w*|genuine|tamper\w*|seal|badge)\b/i.test(PUBLICATION_STATEMENT));
  });
});

describe("admission: every engine-built disclosure publishes; an altered copy never does", () => {
  test("every valid fixture record is publishable and the altered-after-commit copy is refused as an invalid record", () => {
    const refused = allExports().filter(([, e]) => publicationFindings(e).length > 0);
    assert.deepEqual(
      refused.map(([k]) => k),
      ["receipt-mismatch/wp-identity-altered-v1"],
    );
    const f = publicationFindings(refused[0]![1]);
    assert.ok(codes(f).includes("INVALID_RECORD"), JSON.stringify(f));
    assert.ok(!JSON.stringify(f).includes("wp-identity-altered"), "findings never carry caller values");
    assert.ok(publishable().length >= 12, "at least twelve records publish");
  });

  test("a record id with a colon or a dot is a valid record but not a publishable one: one path segment on every filesystem", () => {
    for (const id of ["wp:identity-v1", "wp.identity.v1"]) {
      const record = buildWallPrintSnapshot(baseInput({ id }));
      const e = patch(historyExport(false), (x) => {
        x["id"] = id;
        x["record"] = record;
        x["canonical"] = canonicalize(wallPrintPayload(record));
        x["digest"] = verifyWallPrintDigest(record);
        const life = x["lifecycle"] as { events: { recordId: string; recordDigest: string }[] };
        for (const ev of life.events) {
          ev.recordId = id;
          ev.recordDigest = record.digest;
        }
      });
      const f = publicationFindings(e);
      assert.ok(codes(f).includes("PUBLICATION_ID"), `${id}: ${JSON.stringify(codes(f))}`);
      assert.ok(paths(f).includes("id"));
    }
  });

  test("a Windows reserved device name is a valid record id but never a publishable one: no directory on any filesystem may fail to exist", () => {
    for (const id of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"]) {
      assert.ok(PUBLISHABLE_ID_RE.test(id), `${id} has the publishable shape`);
      assert.equal(isPublishableId(id), false, id);
      const record = buildWallPrintSnapshot(baseInput({ id }));
      const e = patch(historyExport(false), (x) => {
        x["id"] = id;
        x["record"] = record;
        x["canonical"] = canonicalize(wallPrintPayload(record));
        x["digest"] = verifyWallPrintDigest(record);
      });
      assert.ok(codes(publicationFindings(e)).includes("PUBLICATION_ID"), id);
    }
    for (const id of ["wp-identity-corrected-v1", "con1", "com0", "lpt10", "console", "nulls", "auxiliary"]) assert.equal(isPublishableId(id), true, id);
    for (const id of ["wp:x", "WP-x", "ab", "", "a".repeat(65)]) assert.equal(isPublishableId(id), false, id);
    assert.equal(isPublishableId(42), false);
  });

  test("a non-object, an array, a prototype key and an unknown field are refused", () => {
    for (const bad of [null, undefined, 42, "x", []]) assert.ok(publicationFindings(bad).length > 0, String(bad));
    assert.ok(codes(publicationFindings(patch(one(), (x) => { x["sessionId"] = "abc"; }))).includes("UNKNOWN_FIELD"));
    assert.ok(codes(publicationFindings(patch(one(), (x) => { (x["registry"] as Record<string, unknown>)["userId"] = "u"; }))).includes("UNKNOWN_FIELD"));
    assert.ok(publicationFindings(JSON.parse('{"__proto__":{"x":1},"title":"t"}')).length > 0);
  });
});

describe("the immutable artifact: a pure function of the export, canonical bytes, digest-bound", () => {
  test("building twice gives identical bytes, the bytes are the RFC 8785 form of the artifact, and the artifact carries exactly the fixed fields", () => {
    const e = one();
    const a = buildPublicDisclosure(e);
    const b = buildPublicDisclosure(structuredClone(e));
    assert.equal(a.bytes, b.bytes, "deterministic");
    assert.equal(a.bytes, canonicalize(a.artifact), "canonical bytes");
    assert.deepEqual(Object.keys(a.artifact).sort(), ["canonical", "construction", "diff", "digest", "digestCheck", "receipt", "recordId", "registry", "replay", "supersedes", "title", "type", "validation", "version", "wallprintVersion"]);
    assert.equal(a.artifact.type, DISCLOSURE_TYPE);
    assert.equal(a.artifact.version, PUBLICATION_VERSION);
    assert.equal(a.artifact.recordId, e.id);
    assert.equal(a.artifact.digest, e.record.digest);
    assert.equal(a.artifact.wallprintVersion, e.record.wallprintVersion);
    assert.equal(a.artifact.canonical, e.canonical);
    assert.equal(a.artifact.title, e.title);
    assert.deepEqual(a.artifact.construction, e.construction);
    assert.deepEqual(a.artifact.registry, e.registry);
    assert.deepEqual(a.artifact.validation, e.validation);
    assert.deepEqual(a.artifact.digestCheck, e.digest);
    assert.deepEqual(a.artifact.receipt, e.receipt);
    assert.deepEqual(a.artifact.replay, e.replay);
    assert.deepEqual(a.artifact.diff, e.diff);
    assert.deepEqual(a.artifact.supersedes, e.supersedes);
    assert.ok(Object.isFrozen(a.artifact));
  });

  test("the immutable bytes carry no lifecycle standing, no successor, no lineage and no instant of publication: those are index metadata", () => {
    const { bytes } = buildPublicDisclosure(one());
    for (const k of ["lifecycle", "supersededBy", "lineage", "publishedAt", "generatedAt", "resolverBase", "url"]) assert.ok(!bytes.includes(`"${k}":`), k);
    assert.ok(!/https?:|\\\\|%[0-9A-F]{2}/.test(bytes));
  });

  test("the artifact's record is the export's record, byte for byte: the canonical preimage parses back to it and digests to its digest", () => {
    for (const [k, e] of publishable()) {
      const { artifact, bytes } = buildPublicDisclosure(e);
      const v = verifyPublicDisclosure(bytes);
      assert.ok(v.ok, `${k}: ${v.ok ? "" : JSON.stringify(v.findings)}`);
      if (!v.ok) continue;
      assert.deepEqual(v.record, e.record, k);
      assert.deepEqual(v.artifact, artifact, k);
      assert.equal(v.record.digest, artifact.digest);
      assert.ok(validateWallPrintRecord(v.record).ok);
    }
  });

  test("building a refused export throws INVALID_PUBLICATION with the findings and never a caller value", () => {
    const altered = allExports().find(([k]) => k === "receipt-mismatch/wp-identity-altered-v1")![1];
    assert.throws(
      () => buildPublicDisclosure(altered),
      (err: unknown) => err instanceof WallPrintError && err.code === "INVALID_PUBLICATION" && err.findings.length > 0 && !err.message.includes("wp-identity"),
    );
  });

  test("comparing bytes: identical is idempotent, anything else is a conflict", () => {
    const { bytes } = buildPublicDisclosure(one());
    assert.equal(comparePublication(bytes, bytes), "IDENTICAL");
    assert.equal(comparePublication(bytes, `${bytes} `), "CONFLICT");
    assert.equal(comparePublication(bytes, bytes.replace('"title":"', '"title":"x')), "CONFLICT");
    assert.equal(comparePublication(`${bytes}\n`, bytes), "CONFLICT");
  });
});

describe("verification of published bytes fails closed on every corruption", () => {
  const { artifact, bytes } = buildPublicDisclosure(one());
  const expectFail = (input: unknown, code: string, path?: string): void => {
    const v = verifyPublicDisclosure(input);
    assert.equal(v.ok, false, `${code} expected`);
    if (!v.ok) {
      assert.ok(codes(v.findings).includes(code), `${code}: got ${JSON.stringify(v.findings)}`);
      if (path !== undefined) assert.ok(paths(v.findings).includes(path), `${path}: got ${JSON.stringify(v.findings)}`);
      assert.ok(!JSON.stringify(v.findings).includes(artifact.recordId), "never echoes");
    }
  };
  const withCanonical = (canonical: string): string => canonicalize({ ...artifact, canonical });
  const payload = JSON.parse(artifact.canonical) as Record<string, unknown>;

  test("one changed byte inside the canonical preimage: the digest no longer matches and nothing is admitted", () => {
    const flipped = artifact.canonical.replace('"snapshotAt":"2026', '"snapshotAt":"2025');
    assert.notEqual(flipped, artifact.canonical);
    expectFail(withCanonical(flipped), "DIGEST_MISMATCH", "canonical");
  });

  test("a preimage that parses to the same record in another spelling is not canonical and is refused", () => {
    const spaced = JSON.stringify(payload, null, 1);
    assert.deepEqual(JSON.parse(spaced), payload);
    expectFail(withCanonical(spaced), "NOT_CANONICAL", "canonical");
    const reordered = `{${Object.keys(payload)
      .reverse()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(payload[k])}`)
      .join(",")}}`;
    expectFail(withCanonical(reordered), "NOT_CANONICAL", "canonical");
  });

  test("artifact bytes that are not the artifact's own canonical form are refused, even when they parse to the same object", () => {
    expectFail(JSON.stringify(artifact, null, 2), "NOT_CANONICAL", "");
    expectFail(`${bytes}\n`, "NOT_CANONICAL", "");
    expectFail(bytes.replace('"type":"walletwall', '"type": "walletwall'), "NOT_CANONICAL", "");
  });

  test("a changed digest, record id or WallPrint version, an added field, a wrong type tag or version is refused", () => {
    expectFail(canonicalize({ ...artifact, digest: "0".repeat(64) }), "DIGEST_MISMATCH");
    expectFail(canonicalize({ ...artifact, recordId: "wp-other-v1" }), "ID_MISMATCH", "recordId");
    expectFail(canonicalize({ ...artifact, wallprintVersion: "0.2" }), "VERSION_MISMATCH", "wallprintVersion");
    expectFail(canonicalize({ ...artifact, extra: "x" }), "UNKNOWN_FIELD");
    expectFail(canonicalize({ ...artifact, type: "walletwall.wallprint.record" }), "INVALID_ENUM", "type");
    expectFail(canonicalize({ ...artifact, version: "0.2" }), "UNSUPPORTED_VERSION", "version");
  });

  test("a carried result that contradicts the record is refused: validation, digest check, receipt, replay, diff, supersedes", () => {
    expectFail(canonicalize({ ...artifact, validation: { ok: false, findings: [{ code: "X", path: "" }] } }), "VALIDATION_MISMATCH", "validation");
    expectFail(canonicalize({ ...artifact, digestCheck: { hasDigest: true, matches: false, computedDigest: artifact.digest } }), "DIGEST_CHECK_MISMATCH", "digestCheck");
    expectFail(canonicalize({ ...artifact, receipt: { issued: artifact.receipt.issued, verification: { matches: false, reasons: ["DIGEST_MISMATCH"] } } }), "RECEIPT_VERIFICATION_MISMATCH", "receipt.verification");
    expectFail(canonicalize({ ...artifact, receipt: { issued: { ...artifact.receipt.issued!, recordId: "wp-other-v1" }, verification: null } }), "RECEIPT_MISMATCH", "receipt.issued");
    expectFail(canonicalize({ ...artifact, receipt: { issued: null, verification: { matches: true, reasons: [] } } }), "RECEIPT_MISMATCH", "receipt");
    expectFail(canonicalize({ ...artifact, replay: { outcome: "REPRODUCED", reasons: ["MISSING_EVIDENCE"], recomputedDigest: artifact.digest, mismatches: [] } }), "REPLAY_INCONSISTENT", "replay");
    expectFail(canonicalize({ ...artifact, replay: { outcome: "REPRODUCED", reasons: [], recomputedDigest: "1".repeat(64), mismatches: [] } }), "REPLAY_INCONSISTENT", "replay");
    expectFail(canonicalize({ ...artifact, replay: { outcome: "UNREPLAYABLE", reasons: ["CLAIM_MISMATCH"], recomputedDigest: null, mismatches: [] } }), "REPLAY_INCONSISTENT", "replay");
    expectFail(canonicalize({ ...artifact, replay: { outcome: "VERIFIED", reasons: [], recomputedDigest: null, mismatches: [] } }), "INVALID_ENUM", "replay.outcome");
    expectFail(canonicalize({ ...artifact, diff: null }), "DIFF_MISMATCH", "diff");
    expectFail(canonicalize({ ...artifact, supersedes: null }), "SUPERSEDES_MISMATCH", "supersedes");
  });

  test("not text, not JSON, not an object, oversized or a prototype key: refused before anything is compared", () => {
    expectFail(undefined, "INVALID_TYPE");
    expectFail(42, "INVALID_TYPE");
    expectFail("", "MALFORMED");
    expectFail(bytes.slice(0, -5), "MALFORMED");
    expectFail("[]", "INVALID_TYPE");
    expectFail('{"__proto__":{"a":1}}', "INVALID_TYPE");
    expectFail(`${bytes.slice(0, -1)},"pad":"${"x".repeat(4 * 1024 * 1024)}"}`, "TOO_LARGE");
  });
});

describe("the privacy gate: nothing credential-, path-, address-, environment- or control-shaped leaves, outside the record's own content", () => {
  const gate = (fn: (x: Record<string, unknown>) => void): string[] => codes(publicationFindings(patch(one(), fn)));

  test("a credential-shaped title, a local path, an e-mail address, an IP address, a URL, an environment reference or a control character is refused with a fixed code", () => {
    assert.ok(gate((x) => { x["title"] = `Record ${"Bearer"} ${"abcdefghijklmnopqrstuvwxyz0123456789"}`; }).includes("SUSPECTED_SECRET"));
    assert.ok(gate((x) => { x["title"] = `Exported from ${"C:"}${"\\"}Users${"\\"}someone${"\\"}wallprint`; }).includes("LOCAL_PATH"));
    assert.ok(gate((x) => { x["title"] = `Exported from ${"/Users/"}someone/wallprint`; }).includes("LOCAL_PATH"));
    assert.ok(gate((x) => { x["title"] = `Exported from ${"/home/"}someone/wallprint`; }).includes("LOCAL_PATH"));
    assert.ok(gate((x) => { (x["registry"] as { asset: { name: string } }).asset.name = `someone${"@"}example.com`; }).includes("PERSONAL_DATA"));
    assert.ok(gate((x) => { x["title"] = `Served from ${"10.0"}.${"0.7"}`; }).includes("NETWORK_ADDRESS"));
    assert.ok(gate((x) => { x["title"] = `See ${"https:"}//example.com/x`; }).includes("URL_LITERAL"));
    assert.ok(gate((x) => { x["title"] = `Home is ${"$"}{HOME}`; }).includes("ENVIRONMENT_VALUE"));
    assert.ok(gate((x) => { x["title"] = `Home is %USERPROFILE%`; }).includes("ENVIRONMENT_VALUE"));
    assert.ok(gate((x) => { x["title"] = `A title${String.fromCharCode(0x202e)}`; }).includes("CONTROL_CHARACTERS"));
    assert.ok(gate((x) => { x["title"] = `A title${String.fromCharCode(0)}`; }).includes("CONTROL_CHARACTERS"));
  });

  test("the gate runs in linear time: a hostile long string costs milliseconds, never minutes", () => {
    const hostile = ["a".repeat(200_000), "a.".repeat(100_000), "a-a.".repeat(50_000), "a@".repeat(100_000), "a:".repeat(100_000), "0.".repeat(100_000), "0x".repeat(100_000), "%a".repeat(100_000)];
    for (const s of hostile) {
      const started = performance.now();
      privacyFindings({ title: s, canonical: s });
      const ms = performance.now() - started;
      assert.ok(ms < 1500, `${s.slice(0, 4)}... (${s.length} chars) took ${Math.round(ms)} ms`);
    }
  });

  test("a $NAME is an environment reference in WalletWall-authored text, but not inside the record's own content, where it may be a ticker", () => {
    assert.ok(codes(privacyFindings({ title: `Home is ${"$"}HOME` })).includes("ENVIRONMENT_VALUE"));
    assert.deepEqual(codes(privacyFindings({ record: { symbol: `${"$"}WIF` }, canonical: `{"symbol":"${"$"}WIF"}` })), []);
    assert.ok(codes(privacyFindings({ record: { x: `${"$"}{HOME}` } })).includes("ENVIRONMENT_VALUE"), "an interpolation is refused everywhere");
  });

  test("a bare double colon is not an address; a compressed IPv6 address with a hex group beside it is", () => {
    for (const text of ["a :: b", "::", "ratio :: 2"]) assert.deepEqual(codes(privacyFindings({ title: text })), [], text);
    assert.deepEqual(codes(privacyFindings({ canonical: '{"x":"::"}' })), []);
    for (const ip of [["", "", "1"].join(":"), ["fe80", "", ""].join(":"), ["fe80", "", "1"].join(":")]) assert.ok(codes(privacyFindings({ title: `at ${ip}` })).includes("NETWORK_ADDRESS"), ip);
  });

  test("the gaps a reviewer found are closed: forward-slash drive paths, mount and system roots, $VAR references, bare host names and IPv6 addresses", () => {
    for (const title of [`Exported from ${"D:"}/dev/x`, `Exported from ${"C:"}/Users`, `Built in ${"/opt/"}x`, `Built in ${"/mnt/"}c/x`, `Built in ${"/srv/"}x`, `Built in ${"/Volumes/"}disk`, `Built in ${"/private/"}var`]) {
      assert.ok(gate((x) => { x["title"] = title; }).includes("LOCAL_PATH"), title);
    }
    assert.ok(gate((x) => { x["title"] = `Home is ${"$"}HOME`; }).includes("ENVIRONMENT_VALUE"));
    assert.ok(gate((x) => { x["title"] = `Served by ${"walletwall"}.org`; }).includes("HOST_NAME"));
    assert.ok(gate((x) => { (x["registry"] as { asset: { name: string } }).asset.name = `issuer.${"example"}.com`; }).includes("HOST_NAME"));
    for (const ip of [["fe80", "", "1"].join(":"), ["2001", "db8", "85a3", "0", "0", "8a2e", "370", "7334"].join(":")]) {
      assert.ok(gate((x) => { x["title"] = `Served from ${ip}`; }).includes("NETWORK_ADDRESS"), ip);
    }
    // Ordinary prose and record vocabulary stay admissible: a time of day, a ratio, a dotted field path.
    assert.deepEqual(gate((x) => { x["title"] = "Snapshot at 12:10:00 on chain 1; ratio 3:2; field claims.value and receipt.verification"; }), []);
  });

  test("a WalletWall-authored title may not use a reserved assurance term, in any polarity, and must stay output-safe text", () => {
    assert.ok(gate((x) => { x["title"] = "A verified record"; }).includes("MANUFACTURED_ASSURANCE"));
    assert.ok(gate((x) => { x["title"] = "Not certified by anyone"; }).includes("MANUFACTURED_ASSURANCE"));
    assert.ok(gate((x) => { x["title"] = ""; }).includes("INVALID_FORMAT"));
    assert.ok(gate((x) => { x["title"] = "x".repeat(321); }).includes("INVALID_FORMAT"));
    assert.ok(gate((x) => { x["title"] = "A <b>title</b>"; }).includes("INVALID_FORMAT"));
    assert.ok(gate((x) => { x["title"] = 'A "quoted" title'; }).includes("INVALID_FORMAT"));
    assert.deepEqual(gate((x) => { x["title"] = "A title: with (brackets), semicolons; dots. and_underscores-dashes"; }), []);
  });

  test("a wallet address outside the record is refused; inside the record it is the disclosure's own content", () => {
    const addr = `0x${"a".repeat(40)}`;
    assert.ok(gate((x) => { x["title"] = `About ${addr}`; }).includes("ADDRESS_OUTSIDE_RECORD"));
    assert.ok(gate((x) => { (x["registry"] as { asset: { name: string } }).asset.name = addr; }).includes("ADDRESS_OUTSIDE_RECORD"));
    const e = one();
    assert.ok(JSON.stringify(e.record.subject.identity).includes("0x"), "the record itself carries its subject address");
    assert.deepEqual(publicationFindings(e), []);
  });

  test("a secret inside the record is refused by the record's own validation, so it never reaches publication", () => {
    const e = one();
    const secret = patch(e, (x) => {
      const rec = x["record"] as { assessments: { statement: string | null }[] };
      rec.assessments[1]!.statement = `${"api_key"}=${"abcdefghijklmnop"}`;
    });
    assert.ok(codes(publicationFindings(secret)).includes("INVALID_RECORD"));
  });

  test("the construction is one of the fixed kinds with fixed-shape paths, or null for a disclosure of a real evaluation", () => {
    assert.deepEqual(gate((x) => { x["construction"] = null; }), []);
    assert.ok(gate((x) => { x["construction"] = { kind: "REAL", patched: [] }; }).includes("INVALID_ENUM"));
    assert.ok(gate((x) => { x["construction"] = { kind: "ENGINE_BUILT", patched: ["claims[0].value; drop table"] }; }).includes("INVALID_FORMAT"));
    assert.ok(gate((x) => { x["construction"] = { kind: "ENGINE_BUILT" }; }).length > 0);
  });
});

describe("consistency: every carried engine result must agree with the record it accompanies", () => {
  const gate = (fn: (x: Record<string, unknown>) => void): string[] => codes(publicationFindings(patch(one(), fn)));

  test("the lifecycle must be a verified chain that names this record and digest and ends in the stated state", () => {
    assert.ok(gate((x) => { (x["lifecycle"] as { events: { recordDigest: string }[] }).events[0]!.recordDigest = "0".repeat(64); }).includes("LIFECYCLE_INVALID"));
    assert.ok(gate((x) => { (x["lifecycle"] as { state: string }).state = "WITHDRAWN"; }).includes("LIFECYCLE_INVALID"));
    assert.ok(gate((x) => { (x["lifecycle"] as { events: unknown[] }).events.pop(); }).includes("LIFECYCLE_INVALID"));
    assert.ok(gate((x) => { (x["lifecycle"] as { events: { eventDigest: string }[] }).events[1]!.eventDigest = "f".repeat(64); }).includes("LIFECYCLE_INVALID"));
  });

  test("supersededBy and lineage must match the record's own supersedes and the lifecycle's successor event", () => {
    assert.ok(gate((x) => { x["supersededBy"] = { id: "wp-identity-corrected-v3", digest: "a".repeat(64), kind: "CORRECTION" }; }).includes("STANDING_MISMATCH"));
    assert.ok(gate((x) => { (x["lineage"] as { predecessor: string | null }).predecessor = null; }).includes("LINEAGE_MISMATCH"));
    assert.ok(gate((x) => { (x["lineage"] as { chain: string[] }).chain = ["wp-identity-corrected-v2"]; }).includes("LINEAGE_MISMATCH"));
    assert.ok(gate((x) => { x["supersedes"] = null; }).includes("SUPERSEDES_MISMATCH"));
  });

  test("the predecessor's export carries its successor from the CORRECTED event, and a root record carries none", () => {
    const pred = exportOf(FIXTURES["corrected"]!, FIXTURES["corrected"]!.records[0]!);
    assert.deepEqual(publicationFindings(pred), []);
    assert.ok(codes(publicationFindings(patch(pred, (x) => { x["supersededBy"] = null; }))).includes("STANDING_MISMATCH"));
    const root = exportOf(FIXTURES["current-supported"]!, FIXTURES["current-supported"]!.records[0]!);
    assert.ok(codes(publicationFindings(patch(root, (x) => { x["supersededBy"] = { id: "wp-x-v2", digest: "a".repeat(64), kind: "SUPERSESSION" }; }))).includes("STANDING_MISMATCH"));
  });

  test("the canonical preimage must be the engine's canonical form of the record without its digest", () => {
    assert.ok(gate((x) => { x["canonical"] = JSON.stringify(wallPrintPayload((x["record"] as WallPrintRecord))); }).includes("CANONICAL_MISMATCH"));
    assert.ok(gate((x) => { x["canonical"] = (x["canonical"] as string).replace("2026", "2025"); }).includes("CANONICAL_MISMATCH"));
  });
});

describe("standing: the mutable, append-only metadata beside the immutable bytes", () => {
  test("a record's standing carries its lifecycle, successor, lineage and publications, typed and versioned", () => {
    const e = one();
    const s = recordStanding(e, [{ digest: e.record.digest, wallprintVersion: e.record.wallprintVersion, publishedAt: PUBLISHED_AT }]);
    assert.deepEqual(Object.keys(s).sort(), ["lifecycle", "lineage", "publications", "recordId", "supersededBy", "supersedes", "type", "version"]);
    assert.deepEqual(s.supersedes, e.supersedes);
    assert.equal(s.type, RECORD_INDEX_TYPE);
    assert.equal(s.version, PUBLICATION_VERSION);
    assert.equal(s.recordId, e.id);
    assert.deepEqual(s.lifecycle, e.lifecycle);
    assert.deepEqual(s.supersededBy, e.supersededBy);
    assert.deepEqual(s.lineage, e.lineage);
    assert.deepEqual(s.publications, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    assert.throws(() => recordStanding(e, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: "2026-10-26T18:00:00Z" }]), (err: unknown) => err instanceof WallPrintError && err.code === "INVALID_PUBLICATION");
  });

  test("extending with the same standing changes nothing; a later lifecycle event appends and keeps the first publication instant", () => {
    const before = historyExport(false);
    const after = historyExport(true);
    const s1 = recordStanding(before, [{ digest: before.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    const same = extendStanding(s1, recordStanding(before, [{ digest: before.record.digest, wallprintVersion: "0.1", publishedAt: "2026-10-27T00:00:00.000Z" }]));
    assert.ok(same.ok && !same.changed);
    if (same.ok) assert.deepEqual(same.standing, s1, "the first publication instant is kept");
    const ext = extendStanding(s1, recordStanding(after, [{ digest: after.record.digest, wallprintVersion: "0.1", publishedAt: "2026-10-27T00:00:00.000Z" }]));
    assert.ok(ext.ok && ext.changed);
    if (ext.ok) {
      assert.equal(ext.standing.lifecycle.state, "WITHDRAWN");
      assert.equal(ext.standing.lifecycle.events.length, 3);
      assert.deepEqual(ext.standing.publications, s1.publications, "publication instant preserved");
    }
    const first = extendStanding(null, s1);
    assert.ok(first.ok && first.changed && (first.ok ? first.standing : null) === s1);
  });

  test("a rewritten history, a changed successor or a shortened lineage is refused: standing only ever extends", () => {
    const before = historyExport(false);
    const after = historyExport(true);
    const sBefore = recordStanding(before, [{ digest: before.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    const sAfter = recordStanding(after, [{ digest: after.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    const shorter = extendStanding(sAfter, sBefore);
    assert.ok(!shorter.ok && codes(shorter.ok ? [] : shorter.findings).includes("HISTORY_REWRITTEN"));
    const rewritten = extendStanding(sBefore, { ...sAfter, lifecycle: { ...sAfter.lifecycle, events: [sAfter.lifecycle.events[0]!, { ...sAfter.lifecycle.events[1]!, at: "2026-10-23T12:21:00.000Z" }, sAfter.lifecycle.events[2]!] } });
    assert.ok(!rewritten.ok && codes(rewritten.ok ? [] : rewritten.findings).includes("HISTORY_REWRITTEN"));
    const successor = extendStanding({ ...sBefore, supersededBy: { id: "wp-standing-v2", digest: "a".repeat(64), kind: "SUPERSESSION" } }, { ...sBefore, supersededBy: { id: "wp-standing-v3", digest: "b".repeat(64), kind: "SUPERSESSION" } });
    assert.ok(!successor.ok && codes(successor.ok ? [] : successor.findings).includes("STANDING_MISMATCH"));
    const lineage = extendStanding({ ...sBefore, lineage: { ...sBefore.lineage, chain: ["wp-standing-v0", "wp-standing-v1"], root: "wp-standing-v0", predecessor: "wp-standing-v0" } }, sBefore);
    assert.ok(!lineage.ok && codes(lineage.ok ? [] : lineage.findings).includes("LINEAGE_REWRITTEN"));
    const garbage = extendStanding({ type: RECORD_INDEX_TYPE }, sBefore);
    assert.ok(!garbage.ok && codes(garbage.ok ? [] : garbage.findings).includes("STANDING_INVALID"));
    const other = extendStanding({ ...sBefore, recordId: "wp-other-v1" }, sBefore);
    assert.ok(!other.ok && codes(other.ok ? [] : other.findings).includes("STANDING_MISMATCH"));
  });
});

describe("reading a standing as published", () => {
  test("a standing verifies by its closed shape, its ledger and one committed digest; a rewritten, foreign or mis-typed one is refused", () => {
    const e = one();
    const s = recordStanding(e, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    const ok = verifyStanding(JSON.parse(JSON.stringify(s)));
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual(ok.standing, s);
    for (const [label, bad, code] of [
      ["not an object", "x", "STANDING_INVALID"],
      ["array", [], "STANDING_INVALID"],
      ["missing field", { ...s, lineage: undefined }, "STANDING_INVALID"],
      ["extra field", { ...s, extra: "x" }, "STANDING_INVALID"],
      ["wrong type tag", { ...s, type: "walletwall.wallprint.disclosure" }, "STANDING_INVALID"],
      ["ledger rewritten", { ...s, lifecycle: { ...s.lifecycle, events: [{ ...s.lifecycle.events[0]!, eventDigest: "0".repeat(64) }, ...s.lifecycle.events.slice(1)] } }, "LIFECYCLE_INVALID"],
      ["state does not end the ledger", { ...s, lifecycle: { ...s.lifecycle, state: "WITHDRAWN" } }, "LIFECYCLE_INVALID"],
      ["a publication under another digest", { ...s, publications: [...s.publications, { digest: "f".repeat(64), wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }] }, "STANDING_MISMATCH"],
      ["a successor the ledger does not name", { ...s, supersededBy: { id: "wp-other-v1", digest: "a".repeat(64), kind: "CORRECTION" } }, "STANDING_MISMATCH"],
    ] as const) {
      const v = verifyStanding(bad);
      assert.ok(!v.ok, label);
      if (!v.ok) assert.ok(codes(v.findings).includes(code), `${label}: ${JSON.stringify(v.findings)}`);
    }
  });
});

describe("the store graph: standings that name each other must bind each other", () => {
  const standingOf = (e: DisclosureExport): RecordStanding => recordStanding(e, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
  const all = (): RecordStanding[] => publishable().map(([, e]) => standingOf(e));
  const corrected = FIXTURES["corrected"]!;
  const v1 = (): RecordStanding => standingOf(exportOf(corrected, corrected.records[0]!));
  const v2 = (): RecordStanding => standingOf(exportOf(corrected, corrected.records[1]!));
  const graph = (standings: RecordStanding[]): string[] => codes(storeGraphFindings(standings));

  test("every published fixture lineage is a consistent graph, and a lone record of a lineage is too", () => {
    assert.deepEqual(storeGraphFindings(all()), []);
    assert.deepEqual(graph([v1()]), [], "a predecessor whose successor is not published: the ledger names it, the link resolves to unavailable");
    assert.deepEqual(graph([v2()]), [], "a successor whose predecessor is not published");
  });

  test("a published successor must bind the predecessor that names it, by id, committed digest and kind", () => {
    const s1 = v1();
    assert.ok(graph([{ ...s1, supersededBy: { ...s1.supersededBy!, digest: "a".repeat(64) } }, v2()]).includes("SUCCESSOR_MISMATCH"));
    assert.ok(graph([{ ...s1, supersededBy: { ...s1.supersededBy!, kind: "SUPERSESSION" } }, v2()]).includes("SUCCESSOR_MISMATCH"));
    const s2 = v2();
    assert.ok(graph([s1, { ...s2, supersedes: { ...s2.supersedes!, digest: "a".repeat(64) } }]).includes("PREDECESSOR_MISMATCH"));
  });

  test("a predecessor published beside its successor must already name it: publishing a successor publishes the predecessor's extended standing too", () => {
    const s1 = v1();
    const stale = { ...s1, supersededBy: null, lifecycle: { state: "DISCLOSED" as const, events: s1.lifecycle.events.slice(0, 2) }, lineage: { ...s1.lineage, successor: null, current: s1.recordId, chain: [s1.recordId] } };
    assert.ok(graph([stale, v2()]).includes("STALE_PREDECESSOR"));
  });

  test("a predecessor that names another successor than the record superseding it is refused, published or not", () => {
    const s1 = v1();
    const other = { ...s1, supersededBy: { id: "wp-identity-corrected-v9", digest: "a".repeat(64), kind: "CORRECTION" as const } };
    assert.ok(graph([other, v2()]).includes("PREDECESSOR_NAMES_OTHER"));
  });

  test("two published records may not name the same successor: it could never be published to bind both", () => {
    const s1 = v1();
    const twin = { ...s1, recordId: "wp-identity-corrected-x1" };
    assert.ok(graph([s1, twin]).includes("MULTIPLE_PREDECESSORS"));
  });

  test("one record per id, and at most one successor per predecessor", () => {
    assert.ok(graph([v1(), v1()]).includes("DUPLICATE_RECORD_ID"));
    const s2 = v2();
    const twin = { ...s2, recordId: "wp-identity-corrected-v3", lifecycle: s2.lifecycle };
    assert.ok(graph([v1(), s2, twin]).includes("MULTIPLE_SUCCESSORS"));
  });
});

describe("the publication index: small, explicit, sorted, naming the resolver base and route", () => {
  test("entries carry id, digest, version, instant, lifecycle state, successor and predecessor, sorted by record id then instant then digest", () => {
    const standings = publishable().map(([, e]) => recordStanding(e, [{ digest: e.record.digest, wallprintVersion: e.record.wallprintVersion, publishedAt: PUBLISHED_AT }]));
    const byId = new Map(publishable().map(([, e]) => [e.id, e]));
    const index = publicationIndex(standings, BASE);
    assert.equal(index.type, PUBLICATION_INDEX_TYPE);
    assert.equal(index.version, PUBLICATION_VERSION);
    assert.equal(index.resolverBase, BASE);
    assert.equal(index.route, RESOLVER_ROUTE);
    assert.deepEqual(Object.keys(index).sort(), ["records", "resolverBase", "route", "type", "version"]);
    assert.equal(index.records.length, standings.length);
    const ids = index.records.map((r) => r.recordId);
    assert.deepEqual(ids, [...ids].sort());
    for (const r of index.records) {
      const e = byId.get(r.recordId)!;
      assert.deepEqual(r, {
        recordId: e.id,
        digest: e.record.digest,
        wallprintVersion: e.record.wallprintVersion,
        publishedAt: PUBLISHED_AT,
        lifecycle: e.lifecycle.state,
        successor: e.supersededBy,
        predecessor: e.supersedes === null ? null : { id: e.supersedes.id, digest: e.supersedes.digest },
      });
      assert.deepEqual(Object.keys(r).sort(), ["digest", "lifecycle", "predecessor", "publishedAt", "recordId", "successor", "wallprintVersion"]);
    }
    assert.ok(!JSON.stringify(index).includes('"canonical"'), "no record content in the index");
  });

  test("an invalid resolver base or a duplicate record id refuses the index", () => {
    const e = one();
    const s = recordStanding(e, [{ digest: e.record.digest, wallprintVersion: "0.1", publishedAt: PUBLISHED_AT }]);
    assert.throws(() => publicationIndex([s], `${BASE}/`), (err: unknown) => err instanceof WallPrintError && err.code === "INVALID_PUBLICATION");
    assert.throws(() => publicationIndex([s, s], BASE), (err: unknown) => err instanceof WallPrintError && err.code === "INVALID_PUBLICATION");
  });
});

describe("the gate speaks in codes: no finding ever carries a caller value", () => {
  test("every finding path is built from fixed field names and indices", () => {
    const hostile = patch(one(), (x) => {
      x["title"] = "x".repeat(400);
      x[`evil${"<script>"}`] = "y";
      (x["registry"] as { asset: { name: string } }).asset.name = ["someone", "@", "example.com"].join("");
    });
    for (const f of publicationFindings(hostile)) {
      assert.match(f.path, /^[A-Za-z0-9_.[\]]*$/, f.path);
      assert.match(f.code, /^[A-Z_]+$/, f.code);
      assert.ok(!f.path.includes("evil") && !f.path.includes("<"));
    }
    assert.equal(findSecretLike(JSON.stringify(publicationFindings(hostile))), null);
  });
});
