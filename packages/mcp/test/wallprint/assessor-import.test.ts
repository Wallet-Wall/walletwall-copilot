import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { evaluateBundle } from "../../src/evaluate.ts";
import { assessReadiness } from "../../src/readiness.ts";
import { RESOURCES } from "../../src/resources.ts";
import { LIMITATION_CODES, type Bundle } from "../../src/schemas.ts";
import { TOOLS } from "../../src/tools.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import {
  ASSESSOR_IMPORT_DOES_NOT_ESTABLISH,
  ASSESSOR_IMPORT_INVARIANTS,
  ASSESSOR_IMPORT_MAX_BYTES,
  ASSESSOR_IMPORT_MAX_INPUTS,
  ASSESSOR_IMPORT_REFUSALS,
  ASSESSOR_IMPORT_STATUSES,
  ASSESSOR_IMPORT_VERSION,
  importExternalAssessments,
  type AssessorImportContext,
  type AssessorImportRefusal,
  type AssessorImportResult,
} from "../../src/wallprint/assessor-import.ts";
import { diffWallPrints } from "../../src/wallprint/diff.ts";
import { findReservedAssuranceTerms } from "../../src/wallprint/language.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { ExternalAssessmentInputSchema, buildWallPrintSnapshot, validateWallPrintRecord, type ExternalAssessmentInput, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { verifyReceipt, wallPrintReceipt } from "../../src/wallprint/receipt.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { WALLETWALL_ASSESSOR_ID, WALLPRINT_INVARIANTS, WALLPRINT_LIMITS, WALLPRINT_VERSION } from "../../src/wallprint/vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { replaceObservation } from "../support/builders.ts";
import { ATTRIBUTION_CASES } from "./assessor-cases.ts";
import { COMMIT_AT, baseInput, clone, golden, issuerAssessment, readinessWorld, reviewerAssessment } from "./support.ts";

/**
 * The external assessor import boundary: untrusted serialized assessment → the existing WallPrint external assessment
 * input. Every test here pins one of: the format and its bounds, the rules shared with the builder, the hostile-input
 * refusals, determinism, the end-to-end path through the existing builder, validator, receipt, history, replay and diff,
 * or the authority firewall (an imported assessment is recorded attribution and changes no evidence state).
 */

const envelope = (assessment: unknown, over: Record<string, unknown> = {}): string => JSON.stringify({ assessmentImportVersion: ASSESSOR_IMPORT_VERSION, externalAssessment: assessment, ...over });
const context = (bundle: unknown = golden(), focalAssertionId = "a-identity"): AssessorImportContext => ({ bundle: clone(bundle), focalAssertionId });

function imported(result: AssessorImportResult): readonly ExternalAssessmentInput[] {
  assert.equal(result.status, "IMPORTED", JSON.stringify(result));
  return result.status === "IMPORTED" ? result.assessments : [];
}

function refused(result: AssessorImportResult, reason: AssessorImportRefusal, code?: string, pathPart?: string): void {
  assert.equal(result.status, "REFUSED", "expected a refusal");
  if (result.status !== "REFUSED") return;
  assert.equal(result.reason, reason, JSON.stringify(result.findings));
  assert.ok(result.findings.length > 0, "a refusal carries findings");
  if (code !== undefined) assert.ok(result.findings.some((f) => f.code === code && (pathPart === undefined || f.path.includes(pathPart))), `expected ${code}${pathPart ? ` at ${pathPart}` : ""}; got ${JSON.stringify(result.findings)}`);
  else if (pathPart !== undefined) assert.ok(result.findings.some((f) => f.path.includes(pathPart)), `expected a finding at ${pathPart}; got ${JSON.stringify(result.findings)}`);
}

const assessmentsOf = (result: AssessorImportResult): ExternalAssessmentInput[] => [...imported(result)];
const walletWallEntry = (r: WallPrintRecord) => r.assessments.find((a) => a.assessorRole === "WALLETWALL");

describe("assessor import: the format, its version and its bounds", () => {
  test("the import format has its own version; the WallPrint record version and limits are untouched", () => {
    assert.equal(ASSESSOR_IMPORT_VERSION, "0.1");
    assert.equal(WALLPRINT_VERSION, "0.1");
    assert.equal(ASSESSOR_IMPORT_MAX_INPUTS, WALLPRINT_LIMITS.externalAssessments, "a set that imports is always recordable");
    assert.deepEqual([...ASSESSOR_IMPORT_STATUSES], ["IMPORTED", "REFUSED"]);
  });

  test("the result vocabulary never says verified, trusted, approved or certified", () => {
    for (const word of [...ASSESSOR_IMPORT_STATUSES, ...ASSESSOR_IMPORT_REFUSALS]) assert.deepEqual(findReservedAssuranceTerms(word), [], word);
    const ok = importExternalAssessments([envelope(reviewerAssessment())], context());
    assert.deepEqual(Object.keys(ok).sort(), ["assessments", "status"], "an import returns assessments and nothing else: no score, no trust, no verdict, no digest of its own");
    for (const a of imported(ok)) assert.deepEqual(Object.keys(a).sort(), Object.keys(reviewerAssessment()).sort(), "each is the existing external assessment input");
  });

  test("the importer states what an import does not establish, and the invariants of the firewall", () => {
    const flat = ASSESSOR_IMPORT_DOES_NOT_ESTABLISH.join(" ");
    for (const s of ["is true", "is who the input says", "endorses", "support, freshness, finality, authority, corroboration, conflicts or readiness", "corroborate"]) assert.ok(flat.includes(s), s);
    for (const inv of ["external != trusted", "external != verified", "assessment != evidence state", "assessment != authority", "assessor agreement != independent corroboration", "assessor identity != issuer identity", "digest integrity != factual truth", "absence of assessment != failed assessment"]) {
      assert.ok(ASSESSOR_IMPORT_INVARIANTS.includes(inv), inv);
    }
    assert.ok(WALLPRINT_INVARIANTS.includes("assessor agreement != independent corroboration"), "the record-level invariant the importer relies on is still in force");
  });

  test("the largest envelope the closed schema admits fits the byte bound with room for whitespace", () => {
    const longest = [...LIMITATION_CODES].sort((a, b) => b.length - a.length)[0] as string;
    const worst = {
      assessor: "a".repeat(64),
      assessorRole: "INDEPENDENT_REVIEWER",
      assessment: "A".repeat(48),
      statement: "s".repeat(128),
      policy: "p".repeat(96),
      policyVersion: "v".repeat(64),
      assessedAt: "2026-10-23T12:00:00.000Z",
      evidenceRefs: Array.from({ length: 32 }, () => "x".repeat(64)),
      limitations: Array.from({ length: 32 }, () => longest),
    };
    assert.equal(ExternalAssessmentInputSchema.safeParse(worst).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify({ assessmentImportVersion: "0.1", externalAssessment: worst }, null, 2)) < ASSESSOR_IMPORT_MAX_BYTES / 2);
  });

  test("input at exactly the byte bound is read; one byte more is refused unread, as bytes or as text", () => {
    const base = envelope(reviewerAssessment());
    const padded = base + " ".repeat(ASSESSOR_IMPORT_MAX_BYTES - Buffer.byteLength(base));
    assert.equal(Buffer.byteLength(padded), ASSESSOR_IMPORT_MAX_BYTES);
    assert.equal(imported(importExternalAssessments([padded], context())).length, 1);
    assert.equal(imported(importExternalAssessments([Buffer.from(padded)], context())).length, 1);
    refused(importExternalAssessments([`${padded} `], context()), "TOO_LARGE", "TOO_LARGE", "inputs[0]");
    refused(importExternalAssessments([Buffer.from(`${padded} `)], context()), "TOO_LARGE", "TOO_LARGE", "inputs[0]");
    refused(importExternalAssessments([Buffer.alloc(ASSESSOR_IMPORT_MAX_BYTES * 64, 0x20)], context()), "TOO_LARGE");
  });

  test("at most the builder's cap of external assessments per call, and exactly that many import and build", () => {
    const many = (n: number): string[] => Array.from({ length: n }, (_, i) => envelope(reviewerAssessment({ assessor: `reviewer-${i}`, policy: `review-${i}` })));
    const ok = importExternalAssessments(many(ASSESSOR_IMPORT_MAX_INPUTS), context());
    assert.equal(imported(ok).length, 32);
    assert.equal(buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(ok) })).assessments.length, 33);
    refused(importExternalAssessments(many(ASSESSOR_IMPORT_MAX_INPUTS + 1), context()), "TOO_MANY", "TOO_MANY", "inputs");
  });
});

describe("assessor import: positive cases, recorded as stated", () => {
  test("an independent reviewer's assessment imports unchanged and appears unchanged in a WallPrint", () => {
    const stated = reviewerAssessment({ assessment: "SUPPORTED_WITH_NOTES", statement: "Reviewed the issuer page and the chain state.", evidenceRefs: ["obs-identity", "a-identity"], limitations: ["REGISTRY_VERIFIED_POINT_IN_TIME"] });
    const result = importExternalAssessments([envelope(stated)], context());
    const [only] = imported(result);
    assert.deepEqual(only, stated, "the importer returns the assessment exactly as stated");
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    const entry = record.assessments.find((a) => a.assessor === "reviewer-y");
    assert.deepEqual(entry, {
      assessor: "reviewer-y",
      assessorRole: "INDEPENDENT_REVIEWER",
      assessment: "SUPPORTED_WITH_NOTES",
      statement: "Reviewed the issuer page and the chain state.",
      policy: "reviewer-y-review",
      policyVersion: "1",
      assessedAt: stated.assessedAt,
      evidenceRefs: ["a-identity", "obs-identity"],
      limitations: ["REGISTRY_VERIFIED_POINT_IN_TIME"],
    });
    assert.deepEqual(validateWallPrintRecord(record), { ok: true, record });
  });

  test("an assurance-like statement is kept as the assessor's own words and never becomes WalletWall's claim", () => {
    const result = importExternalAssessments([envelope(reviewerAssessment({ assessment: "CERTIFIED", statement: "Verified safe and audited by the reviewer." }))], context());
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    const theirs = record.assessments.find((a) => a.assessor === "reviewer-y");
    assert.equal(theirs?.assessment, "CERTIFIED");
    assert.equal(theirs?.statement, "Verified safe and audited by the reviewer.");
    assert.equal(theirs?.assessorRole, "INDEPENDENT_REVIEWER");
    const ours = walletWallEntry(record);
    assert.equal(ours?.assessor, WALLETWALL_ASSESSOR_ID);
    assert.equal(ours?.assessment, "ESTABLISHED", "WalletWall's entry is the engine's support state");
    assert.equal(ours?.statement, null);
    assert.deepEqual(findReservedAssuranceTerms(JSON.stringify(ours)), []);
    assert.deepEqual(record.claims.map((c) => c.supportState), buildWallPrintSnapshot(baseInput({ assessments: [] })).claims.map((c) => c.supportState));
  });

  test("a valid issuer assessment for a registered focal deployment imports and is recorded under the registry authority", () => {
    const result = importExternalAssessments([envelope(issuerAssessment())], context());
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    const issuer = record.assessments.find((a) => a.assessorRole === "ISSUER");
    assert.equal(issuer?.assessor, "issuer:circle");
    assert.equal(issuer?.assessment, "CONFIRMED");
    assert.equal(walletWallEntry(record)?.assessment, "ESTABLISHED");
  });

  test("no external assessment remains valid: importing nothing succeeds, and absence is not a failed assessment", () => {
    const result = importExternalAssessments([], context());
    assert.deepEqual(result, { status: "IMPORTED", assessments: [] });
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    assert.deepEqual(record.assessments.map((a) => a.assessorRole), ["WALLETWALL"]);
    assert.deepEqual(validateWallPrintRecord(record), { ok: true, record });
  });

  test("two assessors under different policies may disagree and both stay, attributed, with no consensus anywhere", () => {
    const result = importExternalAssessments(
      [envelope(issuerAssessment({ assessment: "CONFIRMED" })), envelope(reviewerAssessment({ assessment: "NOT_CONFIRMED" })), envelope(reviewerAssessment({ policy: "second-opinion", assessment: "SUPPORTED" }))],
      context(),
    );
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    assert.deepEqual(
      record.assessments.map((a) => [a.assessor, a.policy, a.assessment]),
      [
        ["issuer:circle", "issuer-attestation", "CONFIRMED"],
        ["reviewer-y", "reviewer-y-review", "NOT_CONFIRMED"],
        ["reviewer-y", "second-opinion", "SUPPORTED"],
        [WALLETWALL_ASSESSOR_ID, "wwap/asset-identity/0.1", "ESTABLISHED"],
      ],
    );
    for (const k of Object.keys(record)) assert.doesNotMatch(k, /consensus|overall|verdict|assurance|status|trust|score/i);
  });

  test("the same bytes and context give the same result, whether given as text or as its UTF-8 bytes", () => {
    const text = envelope(reviewerAssessment());
    const a = importExternalAssessments([text], context());
    const b = importExternalAssessments([text], context());
    const c = importExternalAssessments([Buffer.from(text, "utf8")], context());
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test("a different spelling of the same assessment is the same assessment and the same record", () => {
    const stated = reviewerAssessment({ evidenceRefs: ["obs-identity"] });
    const compact = envelope(stated);
    const pretty = JSON.stringify({ externalAssessment: stated, assessmentImportVersion: "0.1" }, null, 2);
    const a = importExternalAssessments([compact], context());
    const b = importExternalAssessments([pretty], context());
    assert.deepEqual(assessmentsOf(a), assessmentsOf(b));
    assert.equal(buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(a) })).digest, buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(b) })).digest);
  });

  test("results come back in input order and the builder's own canonical ordering decides the record's order", () => {
    const first = envelope(reviewerAssessment({ assessor: "zeta-reviewer", policy: "p-1" }));
    const second = envelope(reviewerAssessment({ assessor: "alpha-reviewer", policy: "p-2" }));
    const forward = importExternalAssessments([first, second], context());
    assert.deepEqual(assessmentsOf(forward).map((a) => a.assessor), ["zeta-reviewer", "alpha-reviewer"]);
    const reverse = importExternalAssessments([second, first], context());
    assert.equal(buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(forward) })).digest, buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(reverse) })).digest);
  });

  test("the import is a snapshot: frozen, independent of later changes to the input bytes or the bundle, and it never touches the context", () => {
    const bytes = Buffer.from(envelope(reviewerAssessment()), "utf8");
    const ctx = context();
    const before = structuredClone(ctx);
    const result = importExternalAssessments([bytes], ctx);
    const [only] = imported(result);
    assert.ok(only !== undefined && Object.isFrozen(result) && Object.isFrozen(only) && Object.isFrozen(only.evidenceRefs));
    bytes.fill(0x20);
    assert.equal(only.assessor, "reviewer-y");
    assert.deepEqual(ctx, before);
  });

  test("an imported assessment digests exactly like the same assessment supplied natively: the record's digest semantics are unchanged", () => {
    const native = [issuerAssessment(), reviewerAssessment()];
    const viaImport = importExternalAssessments(native.map((a) => envelope(a)), context());
    assert.equal(buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(viaImport) })).digest, buildWallPrintSnapshot(baseInput({ assessments: native })).digest);
  });
});

describe("assessor import: the attribution rules are the builder's rules, row by row", () => {
  const toBuilderPath = (p: string): string => p.replace(/^inputs\[(\d+)\]\.externalAssessment/, "assessments[$1]");
  for (const c of ATTRIBUTION_CASES) {
    test(c.name, () => {
      const result = importExternalAssessments(c.assessments.map((a) => envelope(a)), context(c.bundle ?? golden()));
      if (c.expected === "BUILT") {
        const record = buildWallPrintSnapshot(baseInput({ ...(c.bundle === undefined ? {} : { bundle: c.bundle }), assessments: assessmentsOf(result) }));
        assert.equal(validateWallPrintRecord(record).ok, true);
        return;
      }
      const expected = c.expected.findings;
      const onlySecrets = expected.every((f) => f.code === "SUSPECTED_SECRET");
      const reason: AssessorImportRefusal = c.expected.error === "INVALID_INPUT" ? "INVALID_ENVELOPE" : onlySecrets ? "SUSPECTED_SECRET" : "ATTRIBUTION_REFUSED";
      refused(result, reason);
      if (result.status === "REFUSED") assert.deepEqual(result.findings.map((f) => ({ code: f.code, path: toBuilderPath(f.path) })), expected);
    });
  }

  test("an import the importer admits is never refused by the builder for attribution; the builder re-applies every rule to the whole list", () => {
    const admitted = assessmentsOf(importExternalAssessments([envelope(reviewerAssessment())], context()));
    assert.throws(() => buildWallPrintSnapshot(baseInput({ assessments: [...admitted, reviewerAssessment({ assessor: "REVIEWER-Y", policy: "Reviewer-Y-Review" })] })), (e: unknown) => (e as { findings?: { code: string }[] }).findings?.some((f) => f.code === "DUPLICATE_ASSESSMENT") === true);
  });
});

describe("assessor import: hostile serialized input is refused with a fixed reason", () => {
  const good = reviewerAssessment();
  const raw = (...parts: (string | number[])[]): Buffer => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p))));

  test("malformed JSON in every shape is MALFORMED_JSON", () => {
    const valid = envelope(good);
    for (const text of ["", " ", "{", "}", "[]]", valid.slice(0, -1), `${valid},`, `${valid} x`, valid.replace(/"/g, "'"), `/* c */${valid}`, `${valid.slice(0, -1)},}`, '{"a":01}', '{"a":NaN}', '{"a":.5}', '{"a":"\\x"}', '{"a":"line\nbreak"}', '{"a":tru}', "\u0000", `\ufeff${valid}`]) {
      refused(importExternalAssessments([text], context()), "MALFORMED_JSON");
    }
  });

  test("invalid UTF-8 is refused as bytes before any parsing: stray, truncated and overlong sequences and encoded surrogates", () => {
    const head = '{"assessmentImportVersion":"0.1","externalAssessment":{"assessor":"';
    for (const bad of [[0xff], [0xc3], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80]]) {
      refused(importExternalAssessments([raw(head, bad, '"}}')], context()), "NOT_UTF8", "NOT_UTF8", "inputs[0]");
    }
    assert.equal(importExternalAssessments([raw(head, [0xc3, 0xa9], '"}}')], context()).status, "REFUSED", "valid UTF-8 outside the assessor charset is refused by the schema, not the decoder");
    refused(importExternalAssessments([raw(head, [0xc3, 0xa9], '"}}')], context()), "INVALID_ENVELOPE");
  });

  test("a duplicate JSON key is refused, not resolved: JSON.parse would have kept the last", () => {
    const text = envelope(good).replace('"assessor":"reviewer-y"', '"assessor":"reviewer-y","assessor":"issuer:circle"');
    assert.equal((JSON.parse(text) as { externalAssessment: { assessor: string } }).externalAssessment.assessor, "issuer:circle", "the hazard: plain JSON.parse silently takes the last value");
    refused(importExternalAssessments([text], context()), "DUPLICATE_KEY", "DUPLICATE_KEY", "inputs[0]");
    refused(importExternalAssessments([`{"assessmentImportVersion":"0.1","assessmentImportVersion":"0.1","externalAssessment":${JSON.stringify(good)}}`], context()), "DUPLICATE_KEY");
    refused(importExternalAssessments([envelope(good).replace('"assessor":"reviewer-y"', '"assessor":"reviewer-y","assessor":"reviewer-y"')], context()), "DUPLICATE_KEY");
    refused(importExternalAssessments([envelope(good).replace('"assessor":"reviewer-y"', '"assessor":"reviewer-y","\\u0061ssessor":"issuer:circle"')], context()), "DUPLICATE_KEY");
    refused(importExternalAssessments([envelope(good).replace('"policy":"reviewer-y-review"', '"policy":"a","policy":"b"')], context()), "DUPLICATE_KEY");
  });

  test("prototype-pollution keys are refused wherever they appear, and nothing is polluted", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const inner = `{"assessmentImportVersion":"0.1","externalAssessment":${JSON.stringify(good).replace(/^\{/, `{"${key}":{"polluted":"yes"},`)}}`;
      const outer = `{"${key}":{"polluted":"yes"},"assessmentImportVersion":"0.1","externalAssessment":${JSON.stringify(good)}}`;
      refused(importExternalAssessments([inner], context()), "FORBIDDEN_STRUCTURE");
      refused(importExternalAssessments([outer], context()), "FORBIDDEN_STRUCTURE");
    }
    refused(importExternalAssessments([envelope(good).replace(/^\{/, '{"\\u005f_proto__":{"polluted":"yes"},')], context()), "FORBIDDEN_STRUCTURE");
    assert.equal(({} as { polluted?: string }).polluted, undefined);
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
  });

  test("nesting deeper than the closed shape is refused as TOO_DEEP", () => {
    refused(importExternalAssessments([envelope({ ...good, evidenceRefs: [["obs-identity"]] })], context()), "TOO_DEEP");
    refused(importExternalAssessments([`${"[".repeat(5000)}${"]".repeat(5000)}`], context()), "TOO_DEEP");
    refused(importExternalAssessments([`{"a":${"{\"a\":".repeat(200)}1${"}".repeat(200)}}`], context()), "TOO_DEEP");
  });

  test("a value of the wrong JSON type in any field is refused, never coerced", () => {
    const scalars = ["assessor", "assessorRole", "assessment", "statement", "policy", "policyVersion", "assessedAt"] as const;
    const lists = ["evidenceRefs", "limitations"] as const;
    for (const field of scalars) {
      for (const wrong of [1, true, null, {}, ["x"]]) refused(importExternalAssessments([envelope({ ...good, [field]: wrong })], context()), "INVALID_ENVELOPE", undefined, `inputs[0].externalAssessment.${field}`);
    }
    for (const field of lists) {
      for (const wrong of [1, true, null, {}, "obs-identity"]) refused(importExternalAssessments([envelope({ ...good, [field]: wrong })], context()), "INVALID_ENVELOPE", undefined, `inputs[0].externalAssessment.${field}`);
      for (const wrong of [1, true, null]) refused(importExternalAssessments([envelope({ ...good, [field]: [wrong] })], context()), "INVALID_ENVELOPE", undefined, `inputs[0].externalAssessment.${field}[0]`);
    }
    refused(importExternalAssessments([envelope(good, { assessmentImportVersion: 0.1 })], context()), "INVALID_ENVELOPE");
  });

  test("a time that is not a real instant is refused", () => {
    for (const assessedAt of ["2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-23", "2026-10-23T25:00:00Z", "2026-10-23T12:00:00+02:00", "2026-10-23 12:00:00Z", ""]) {
      refused(importExternalAssessments([envelope(reviewerAssessment({ assessedAt }))], context()), "INVALID_ENVELOPE", undefined, "assessedAt");
    }
  });

  test("an unsupported or missing import version, and the envelope's own shape, are refused", () => {
    refused(importExternalAssessments([envelope(good, { assessmentImportVersion: "0.2" })], context()), "UNSUPPORTED_VERSION", "UNSUPPORTED_VERSION", "assessmentImportVersion");
    refused(importExternalAssessments([envelope(good, { assessmentImportVersion: "1" })], context()), "UNSUPPORTED_VERSION");
    refused(importExternalAssessments([JSON.stringify({ externalAssessment: good })], context()), "INVALID_ENVELOPE");
    refused(importExternalAssessments([JSON.stringify({ assessmentImportVersion: "0.1" })], context()), "INVALID_ENVELOPE");
    refused(importExternalAssessments([JSON.stringify(good)], context()), "INVALID_ENVELOPE", "UNKNOWN_FIELD");
    refused(importExternalAssessments([JSON.stringify([envelope(good)])], context()), "INVALID_ENVELOPE");
    refused(importExternalAssessments(['"x"', "null", "7", "true"], context()), "INVALID_ENVELOPE");
  });

  test("a WallPrint record, or any other WalletWall document, is not an assessment envelope", () => {
    const record = buildWallPrintSnapshot(baseInput());
    const result = importExternalAssessments([JSON.stringify(record)], context());
    assert.equal(result.status, "REFUSED");
    refused(importExternalAssessments([JSON.stringify({ type: "walletwall.wallprint.reference", version: "0.1" })], context()), "INVALID_ENVELOPE");
    refused(importExternalAssessments([JSON.stringify({ wallprintVersion: "0.1", id: "wp-x", assessments: [] })], context()), "INVALID_ENVELOPE");
  });

  test("no field can carry a score, a trust level, a verdict, an approval or a signature: unknown fields are refused at both levels", () => {
    for (const field of ["score", "trustLevel", "confidence", "consensus", "rank", "overall", "overallVerdict", "approved", "certified", "verified", "endorsedByIssuer", "authority", "supportState", "signature", "publicKey", "did"]) {
      refused(importExternalAssessments([envelope({ ...good, [field]: "x" })], context()), "INVALID_ENVELOPE", "UNKNOWN_FIELD", "inputs[0].externalAssessment");
      refused(importExternalAssessments([envelope(good, { [field]: "x" })], context()), "INVALID_ENVELOPE", "UNKNOWN_FIELD");
      refused(importExternalAssessments([envelope(good, { [field]: true })], context()), "INVALID_ENVELOPE", "UNKNOWN_FIELD");
    }
  });

  test("an unknown field is refused, never dropped: no input that would lose a field imports", () => {
    const result = importExternalAssessments([envelope({ ...good, note: "kept?" })], context());
    refused(result, "INVALID_ENVELOPE", "UNKNOWN_FIELD");
    assert.ok(!("assessments" in result));
  });

  test("inputs that are not text or bytes, and a call that is not a list, are refused", () => {
    for (const bad of [1, null, undefined, {}, [], true, new ArrayBuffer(8), new Uint16Array(4), Symbol("s")]) {
      refused(importExternalAssessments([bad as never], context()), "INVALID_INPUT", "INVALID_INPUT", "inputs[0]");
    }
    refused(importExternalAssessments(envelope(good) as never, context()), "INVALID_INPUT", "INVALID_INPUT", "inputs");
    refused(importExternalAssessments(null as never, context()), "INVALID_INPUT");
  });

  test("a context that cannot be used refuses the call before any input is read", () => {
    const garbage = ["not json", Buffer.from([0xff])];
    refused(importExternalAssessments(garbage, context({ wwepVersion: "0.2", sources: [], observations: [], assertions: [], derivations: [] })), "INVALID_CONTEXT", "INVALID_BUNDLE", "context.bundle");
    refused(importExternalAssessments(garbage, context(golden(), "a-nobody")), "INVALID_CONTEXT", "UNKNOWN_FOCAL_ASSERTION", "context.focalAssertionId");
    refused(importExternalAssessments(garbage, { bundle: golden(), focalAssertionId: 7 as never }), "INVALID_CONTEXT", "INVALID_ID");
    refused(importExternalAssessments(garbage, null as never), "INVALID_CONTEXT");
    refused(importExternalAssessments(garbage, { bundle: JSON.parse('{"__proto__":{"x":1}}') as never, focalAssertionId: "a-identity" }), "INVALID_CONTEXT");
  });

  test("credential-shaped text is refused in every slot, and a refusal never echoes what it refused", () => {
    const secret = "sk_live_ABCDEFGHIJKL";
    for (const [field, value] of [["statement", `token: ${secret}`], ["assessor", secret], ["policy", secret], ["policyVersion", `password=${secret}`], ["assessment", secret.toUpperCase()]] as const) {
      const result = importExternalAssessments([envelope({ ...good, [field]: value })], context());
      assert.equal(result.status, "REFUSED", field);
      assert.ok(!JSON.stringify(result).toLowerCase().includes("abcdefghijkl"), `${field}: the refusal must not echo the credential`);
    }
    refused(importExternalAssessments([envelope({ ...good, statement: "Bearer abcdefghijklmnop" })], context()), "SUSPECTED_SECRET", "SUSPECTED_SECRET", "externalAssessment.statement");
  });

  test("a refusal is fixed-form: reasons from the closed list, findings of fixed codes and paths, no caller text", () => {
    const marker = "ZZ-caller-marker-ZZ";
    const attempts: unknown[] = [
      envelope({ ...good, assessor: marker, assessorRole: "WALLETWALL" }),
      envelope({ ...good, [marker]: "x" }),
      envelope({ ...good, assessment: marker }),
      envelope(good).replace('"externalAssessment"', `"${marker}"`),
      `{"${marker}":1,"${marker}":2}`,
      `{"__proto__":"${marker}"}`,
      `[${marker}`,
      envelope({ ...good, policy: `wwap/${marker}` }),
      envelope({ ...good, evidenceRefs: [marker] }),
      Buffer.from([0xff]),
    ];
    for (const a of attempts) {
      const result = importExternalAssessments([a as string], context());
      assert.equal(result.status, "REFUSED");
      if (result.status !== "REFUSED") continue;
      assert.ok((ASSESSOR_IMPORT_REFUSALS as readonly string[]).includes(result.reason));
      assert.ok(!JSON.stringify(result).includes(marker), "a refusal never echoes caller text");
      for (const f of result.findings) assert.match(f.path, /^(inputs(\[\d+\](\.[A-Za-z]+(\[\d+\])?)*)?|context(\.[A-Za-z]+)?)$|^inputs\[\d+\]\.externalAssessment(\.[A-Za-z]+(\[\d+\])?)*$/, f.path);
    }
  });
});

describe("assessor import: atomic, with no overwrite and no partial import", () => {
  test("one invalid input refuses the whole set: nothing is dropped, nothing is imported", () => {
    const result = importExternalAssessments([envelope(issuerAssessment()), envelope({ ...reviewerAssessment(), assessorRole: "WALLETWALL" }), envelope(reviewerAssessment({ assessor: "reviewer-z", policy: "z-review" }))], context());
    refused(result, "ATTRIBUTION_REFUSED", "ASSESSOR_IDENTITY_RESERVED", "inputs[1].externalAssessment.assessorRole");
    assert.ok(!("assessments" in result));
    const malformed = importExternalAssessments([envelope(issuerAssessment()), "not json", envelope(reviewerAssessment())], context());
    refused(malformed, "MALFORMED_JSON", "MALFORMED_JSON", "inputs[1]");
    assert.ok(!("assessments" in malformed));
  });

  test("every refused input in a set is reported with its own index, at most once each, in order", () => {
    const result = importExternalAssessments(["x", envelope(reviewerAssessment()), "y"], context());
    assert.equal(result.status, "REFUSED");
    if (result.status !== "REFUSED") return;
    assert.deepEqual(result.findings.map((f) => f.path), ["inputs[0]", "inputs[2]"]);
  });

  test("the same assessor and policy twice is refused, with no last-write-wins and no first-write-wins", () => {
    const first = envelope(reviewerAssessment({ assessment: "SUPPORTED" }));
    const second = envelope(reviewerAssessment({ assessment: "NOT_SUPPORTED" }));
    refused(importExternalAssessments([first, second], context()), "ATTRIBUTION_REFUSED", "DUPLICATE_ASSESSMENT", "inputs[1].externalAssessment");
    refused(importExternalAssessments([second, first], context()), "ATTRIBUTION_REFUSED", "DUPLICATE_ASSESSMENT", "inputs[1].externalAssessment");
  });

  test("a case variant of the same assessor and policy is the same identity and is refused", () => {
    refused(
      importExternalAssessments([envelope(reviewerAssessment()), envelope(reviewerAssessment({ assessor: "REVIEWER-Y", policy: "Reviewer-Y-Review" }))], context()),
      "ATTRIBUTION_REFUSED",
      "DUPLICATE_ASSESSMENT",
    );
  });

  test("a byte-identical repeat is also refused: an import is not idempotent merging", () => {
    const same = envelope(reviewerAssessment());
    refused(importExternalAssessments([same, same], context()), "ATTRIBUTION_REFUSED", "DUPLICATE_ASSESSMENT", "inputs[1]");
  });

  test("one assessor under two policies, and two assessors under one policy, are different identities and both import", () => {
    const result = importExternalAssessments(
      [envelope(reviewerAssessment()), envelope(reviewerAssessment({ policy: "another-policy" })), envelope(reviewerAssessment({ assessor: "reviewer-z" }))],
      context(),
    );
    assert.equal(imported(result).length, 3);
    assert.equal(buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) })).assessments.length, 4);
  });
});

describe("assessor import: hostile in-process input lists are refused, never skipped and never thrown", () => {
  const one = envelope(reviewerAssessment());
  const two = envelope(reviewerAssessment({ assessor: "reviewer-z", policy: "z-review" }));

  test("a hole in the list is a refused input, not a dropped one", () => {
    const sparse = Object.assign([one], { 2: two }) as unknown as string[];
    refused(importExternalAssessments(sparse, context()), "INVALID_INPUT", "INVALID_INPUT", "inputs[1]");
    const short = Object.assign([one], { length: 3 }) as unknown as string[];
    const result = importExternalAssessments(short, context());
    refused(result, "INVALID_INPUT");
    assert.deepEqual(result.status === "REFUSED" ? result.findings.map((f) => f.path) : [], ["inputs[1]", "inputs[2]"]);
    refused(importExternalAssessments(new Array<string>(3), context()), "INVALID_INPUT");
  });

  test("an element, a list or a byte view whose accessors throw is a refusal, not an exception", () => {
    const view = new Uint8Array(4);
    Object.defineProperty(view, "byteLength", { get: () => { throw new Error("hostile"); } });
    refused(importExternalAssessments([view], context()), "INVALID_INPUT", "INVALID_INPUT", "inputs[0]");
    const hostileElement = [{ get byteLength(): number { throw new Error("hostile"); } }] as unknown as string[];
    refused(importExternalAssessments(hostileElement, context()), "INVALID_INPUT", "INVALID_INPUT", "inputs[0]");
    const hostileList = new Proxy([one], { get: (t, k) => { if (k === "length") throw new Error("hostile"); return Reflect.get(t, k) as unknown; } });
    refused(importExternalAssessments(hostileList, context()), "INVALID_INPUT", "INVALID_INPUT", "inputs");
    const throwingGetter = Object.defineProperty([one], 0, { get: () => { throw new Error("hostile"); } });
    refused(importExternalAssessments(throwingGetter, context()), "INVALID_INPUT");
  });

  test("a refused input never hides another: findings are capped per input, so each refused input is named", () => {
    const manyProblems = envelope({ ...reviewerAssessment(), limitations: Array.from({ length: 32 }, () => "NOT_A_CODE") });
    const secret = envelope(reviewerAssessment({ assessor: "reviewer-z", policy: "z-review", statement: "token: abcdefghijkl" }));
    const result = importExternalAssessments([manyProblems, secret], context());
    refused(result, "INVALID_ENVELOPE", "INVALID_ENUM", "inputs[0]");
    if (result.status !== "REFUSED") return;
    assert.equal(result.findings.filter((f) => f.path.startsWith("inputs[0]")).length, 8, "one input's findings are capped");
    refused(importExternalAssessments([manyProblems, envelope(reviewerAssessment({ assessor: "reviewer-z", policy: "z-review", assessorRole: "WALLETWALL" }))], context()), "INVALID_ENVELOPE");
    const both = importExternalAssessments([envelope({ ...reviewerAssessment(), limitations: ["NOT_A_CODE"] }), "not json"], context());
    assert.deepEqual(both.status === "REFUSED" ? both.findings.map((f) => f.path) : [], ["inputs[0].externalAssessment.limitations[0]", "inputs[1]"]);
    assert.equal(both.status === "REFUSED" ? both.reason : "", "INVALID_ENVELOPE", "the reason is the first refused input's, in input order; the findings name every refused input");
  });
});

describe("assessor import: IMPORTED speaks for the assessments; the builder keeps its own bundle preconditions", () => {
  test("a bundle whose focal subject lacks its identity keys is accepted as context and refused by the builder, so callers always build", () => {
    const bundle = clone(golden());
    bundle.assertions = bundle.assertions.map((a) => (a.id === "a-identity" ? { ...a, subject: { chainId: "1" } } : a));
    const result = importExternalAssessments([envelope(reviewerAssessment())], context(bundle));
    assert.equal(result.status, "IMPORTED");
    assert.throws(
      () => buildWallPrintSnapshot(baseInput({ bundle, assessments: assessmentsOf(result) })),
      (e: unknown) => e instanceof WallPrintError && e.findings.some((f) => f.code === "INVALID_FOCAL_SUBJECT"),
    );
  });
});

describe("assessor import: the importer and the builder agree on every set a seeded generator can produce", () => {
  /** A deterministic generator (no clock, no Math.random): the same 2000 sets on every run. */
  const lcg = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  };
  const POOLS = {
    assessor: ["reviewer-y", "reviewer-z", "Reviewer-Y", "issuer:circle", "Issuer:Circle", "issuer:tether", "wallet-wall", "wall.print", "walletwall-rules", "firewall-print-shop", "canonical-chain-state", "issuer-circle", "a"],
    assessorRole: ["INDEPENDENT_REVIEWER", "WALLETWALL", "ISSUER", "UPSTREAM_AUTHORITY", "OTHER", "ROLE_NOT_IN_VOCABULARY"],
    policy: ["p1", "P1", "reviewer-y-review", "issuer-attestation", "wwap/x", "WWDR.y", "wwvr-z", "ww-ap/q"],
    assessment: ["CONFIRMED", "SUPPORTED", "NOT_AVAILABLE", "SK_LIVE_ABCDEFGHIJ", "lower"],
    statement: [undefined, "Fine.", "token: abcdefghijkl", "Verified and certified."],
    evidenceRefs: [[], ["obs-identity"], ["a-identity", "obs-identity"], ["obs-missing"], ["src-chain", "src-issuer"]],
    limitations: [undefined, [], ["REGISTRY_VERIFIED_POINT_IN_TIME"], ["NOT_A_CODE"]],
    assessedAt: [reviewerAssessment().assessedAt, "2026-10-23T11:00:00Z", "not a time"],
  } as const;

  test("2000 generated sets: the importer admits a set exactly when the builder builds a record from it", () => {
    const next = lcg(20261101);
    // The first entry of every pool is the valid one; half the sets lean on it so that admitted sets are common, not rare.
    const pick = <T>(xs: readonly T[], lean: boolean): T => (lean && next() < 0.8 ? (xs[0] as T) : (xs[Math.floor(next() * xs.length)] as T));
    let admitted = 0;
    for (let n = 0; n < 2000; n++) {
      const lean = n % 2 === 0;
      const size = 1 + Math.floor(next() * 3);
      const set = Array.from({ length: size }, () => {
        const a: Record<string, unknown> = { assessor: pick(POOLS.assessor, lean), assessorRole: pick(POOLS.assessorRole, lean), assessment: pick(POOLS.assessment, lean), policy: pick(POOLS.policy, lean), policyVersion: "1", assessedAt: pick(POOLS.assessedAt, lean), evidenceRefs: pick(POOLS.evidenceRefs, lean) };
        const statement = pick(POOLS.statement, lean);
        const limitations = pick(POOLS.limitations, lean);
        if (statement !== undefined) a["statement"] = statement;
        if (limitations !== undefined) a["limitations"] = limitations;
        return a;
      });
      const imported = importExternalAssessments(set.map((a) => envelope(a)), context()).status === "IMPORTED";
      let built = true;
      try {
        buildWallPrintSnapshot(baseInput({ assessments: set as never }));
      } catch (e) {
        assert.ok(e instanceof WallPrintError, "the builder refuses with a WallPrintError");
        built = false;
      }
      assert.equal(imported, built, `importer and builder disagree on ${JSON.stringify(set)}`);
      if (imported) admitted++;
    }
    assert.ok(admitted > 50 && admitted < 1950, `the generator exercises both outcomes (admitted ${admitted} of 2000)`);
  });
});

describe("assessor import: end to end through the existing builder, validator, receipt, history, replay and diff", () => {
  const texts = [envelope(issuerAssessment()), envelope(reviewerAssessment({ assessment: "NOT_AVAILABLE" }))];

  test("untrusted bytes → importer → buildWallPrintSnapshot → validateWallPrintRecord → receipt → history → replay → diff, all valid", () => {
    const result = importExternalAssessments(texts.map((t) => Buffer.from(t, "utf8")), context());
    const input = baseInput({ assessments: assessmentsOf(result) });
    const record = buildWallPrintSnapshot(input);
    assert.deepEqual(validateWallPrintRecord(record), { ok: true, record });

    const receipt = wallPrintReceipt(record);
    assert.deepEqual(verifyReceipt(receipt, record), { matches: true, reasons: [] });

    const history = createWallPrintHistory();
    assert.deepEqual(history.list(), [], "importing and building commit nothing");
    history.commit(record, { at: COMMIT_AT });
    assert.equal(history.state(record.id), "COMMITTED");
    assert.equal(history.events(record.id).length, 1);

    const evidence = createEvidenceStore();
    evidence.put(golden());
    assert.deepEqual(replayWallPrint(record, { evidence }), { outcome: "REPRODUCED", reasons: [], recomputedDigest: record.digest, mismatches: [] });

    const without = buildWallPrintSnapshot(baseInput({ assessments: [] }));
    const diff = diffWallPrints(without, record);
    assert.equal(diff.changed, true);
    assert.deepEqual([...new Set(diff.changes.map((c) => c.category))].sort(), ["assessments", "record"], "an imported assessment moves the assessments and the digest, and nothing else");
  });

  test("a record built from an import is valid under the same rules as one built from native input, including after a round trip through JSON", () => {
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(importExternalAssessments(texts, context())) }));
    const again = validateWallPrintRecord(JSON.parse(JSON.stringify(record)));
    assert.deepEqual(again, { ok: true, record });
  });

  test("importing and building are not lifecycle: nothing is disclosed, corrected, superseded, withdrawn or published", () => {
    const history = createWallPrintHistory();
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(importExternalAssessments(texts, context())) }));
    assert.equal(history.has(record.id), false);
    assert.deepEqual(history.list(), []);
    assert.equal(record.supersedes, null);
    assert.deepEqual(Object.keys(record).filter((k) => /lifecycle|state|supersededBy|disclos|withdraw|publish/i.test(k)), []);
    history.commit(record, { at: COMMIT_AT });
    assert.equal(history.state(record.id), "COMMITTED", "a committed record starts at COMMITTED; DISCLOSED is a separate, explicit act");
  });

  test("the canonical record shape is the same with and without imported assessments", () => {
    const withImport = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(importExternalAssessments(texts, context())) }));
    const without = buildWallPrintSnapshot(baseInput({ assessments: [] }));
    assert.deepEqual(Object.keys(withImport), Object.keys(without));
    assert.deepEqual(Object.keys(withImport.assessments[0] ?? {}), Object.keys(without.assessments[0] ?? {}));
    assert.equal(withImport.wallprintVersion, "0.1");
  });
});

describe("authority firewall: an imported assessment is recorded attribution, never an evidence-engine input", () => {
  const FIREWALLED = ["wallprintVersion", "subject", "snapshotAt", "evidence", "claims", "provenance", "limitations", "conflicts", "violations", "policyVersions", "ruleVersions", "versions", "supersedes", "canonicalization", "digestAlgorithm"] as const;

  /** Everything except the assessor entries and the digest that covers them is byte-for-byte what the engine computed without any import. */
  function assertEngineOutputUnchanged(withImport: WallPrintRecord, without: WallPrintRecord): void {
    for (const k of FIREWALLED) assert.deepEqual(withImport[k], without[k], k);
    assert.deepEqual(walletWallEntry(withImport), walletWallEntry(without), "WalletWall's own assessment is engine-generated and unchanged");
    assert.notEqual(withImport.digest, without.digest, "the digest covers the assessments, so it moves with them and with nothing else");
  }

  const agree = (): string[] => [
    envelope(issuerAssessment({ assessment: "ESTABLISHED", statement: "Confirmed and verified by the issuer." })),
    envelope(reviewerAssessment({ assessment: "ESTABLISHED", statement: "Established and certified and safe." })),
  ];

  test("support, freshness, finality, authority, corroboration, conflicts, violations, readiness and provenance do not move", () => {
    const world = readinessWorld();
    const ctx = context(world, "readiness-result");
    const result = importExternalAssessments([envelope({ ...reviewerAssessment(), assessment: "ESTABLISHED", evidenceRefs: ["a-balance", "a-identity", "readiness-result"] })], ctx);
    const withImport = buildWallPrintSnapshot({ ...baseInput({ bundle: clone(world), focalAssertionId: "readiness-result" }), assessments: assessmentsOf(result) });
    const without = buildWallPrintSnapshot({ ...baseInput({ bundle: clone(world), focalAssertionId: "readiness-result" }), assessments: [] });
    assertEngineOutputUnchanged(withImport, without);
    const ev = evaluateBundle(world, withImport.snapshotAt);
    for (const c of withImport.claims) {
      const e = ev.assertions.find((x) => x.assertionId === c.assertionId);
      assert.equal(c.supportState, e?.supportState);
      assert.equal(c.freshnessState, e?.freshnessState);
      assert.equal(c.finalityState, e?.finalityState);
      assert.equal(c.independentCorroboration, e?.independentCorroboration === null ? null : String(e?.independentCorroboration));
    }
    assert.equal(assessReadiness(world, ev, "a-identity", "a-balance").classification, assessReadiness(clone(world), evaluateBundle(clone(world), withImport.snapshotAt), "a-identity", "a-balance").classification);
  });

  test("an external SUPPORTED or ESTABLISHED does not turn a NOT_ESTABLISHED claim into one: external assessment != WWEP evidence state", () => {
    const broken = replaceObservation(golden(), "obs-balance", { payload: { balanceAtomic: "1500001", decimals: "6" } });
    const without = buildWallPrintSnapshot(baseInput({ bundle: clone(broken), focalAssertionId: "a-balance", assessments: [] }));
    assert.equal(without.claims.find((c) => c.assertionId === "a-balance")?.supportState, "NOT_ESTABLISHED");
    for (const code of ["SUPPORTED", "ESTABLISHED", "CONFIRMED"]) {
      const result = importExternalAssessments([envelope({ ...reviewerAssessment(), assessment: code, statement: "Supported and established and confirmed.", evidenceRefs: ["a-balance", "obs-balance"] })], context(broken, "a-balance"));
      const withImport = buildWallPrintSnapshot(baseInput({ bundle: clone(broken), focalAssertionId: "a-balance", assessments: assessmentsOf(result) }));
      assert.equal(withImport.claims.find((c) => c.assertionId === "a-balance")?.supportState, "NOT_ESTABLISHED", code);
      assert.equal(walletWallEntry(withImport)?.assessment, "NOT_ESTABLISHED", code);
      assert.equal(withImport.assessments.find((a) => a.assessor === "reviewer-y")?.assessment, code, "the assessor's own word is recorded as said");
      assertEngineOutputUnchanged(withImport, without);
    }
  });

  test("an external issuer saying CONFIRMED does not alter the engine's authority state", () => {
    const without = buildWallPrintSnapshot(baseInput({ assessments: [] }));
    const result = importExternalAssessments([envelope(issuerAssessment({ assessment: "CONFIRMED", evidenceRefs: ["obs-identity", "src-issuer"] }))], context());
    const withImport = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(result) }));
    assert.deepEqual(withImport.claims.map((c) => c.authority), without.claims.map((c) => c.authority));
    assert.deepEqual(withImport.claims.map((c) => c.origin), without.claims.map((c) => c.origin));
    assertEngineOutputUnchanged(withImport, without);
  });

  test("assessor agreement is not independent corroboration: two agreeing assessors add no independence group", () => {
    const b = clone(golden());
    b.sources = b.sources.map((s) => (s.kind === "PROVIDER_ENDPOINT" ? { id: s.id, kind: s.kind, transport: s.transport! } : s));
    const prices = (r: WallPrintRecord) => r.claims.find((c) => c.assertionId === "a-price");
    const without = buildWallPrintSnapshot(baseInput({ bundle: clone(b), assessments: [] }));
    assert.equal(prices(without)?.independentCorroboration, "1");
    assert.equal(prices(without)?.supportState, "PARTIAL");
    const two = [
      envelope(reviewerAssessment({ assessor: "reviewer-a", policy: "policy-a", assessment: "SUPPORTED", evidenceRefs: ["obs-price-a", "obs-price-b"] })),
      envelope(reviewerAssessment({ assessor: "reviewer-b", policy: "policy-b", assessment: "SUPPORTED", evidenceRefs: ["obs-price-a", "obs-price-b"] })),
    ];
    const result = importExternalAssessments(two, context(b));
    const withImport = buildWallPrintSnapshot(baseInput({ bundle: clone(b), assessments: assessmentsOf(result) }));
    assert.equal(prices(withImport)?.independentCorroboration, "1");
    assert.equal(prices(withImport)?.supportState, "PARTIAL");
    assert.ok(prices(withImport)?.limitations.includes("INSUFFICIENT_INDEPENDENT_CORROBORATION"));
    assertEngineOutputUnchanged(withImport, without);
  });

  test("conflicts and invariant violations are neither resolved nor hidden by an imported assessment", () => {
    const conflicted = clone(golden());
    conflicted.assertions.push({ ...conflicted.assertions.find((a) => a.id === "a-price")!, id: "a-price-2", value: { priceUsd: "0.9" } });
    const exceeded: Bundle = clone(golden());
    exceeded.assertions = exceeded.assertions.map((a) => (a.id === "a-price" ? { ...a, declared: { supportState: "ESTABLISHED" as const } } : a));
    for (const bundle of [conflicted, exceeded]) {
      const without = buildWallPrintSnapshot(baseInput({ bundle: clone(bundle), assessments: [] }));
      const withImport = buildWallPrintSnapshot(baseInput({ bundle: clone(bundle), assessments: assessmentsOf(importExternalAssessments(agree(), context(bundle))) }));
      assertEngineOutputUnchanged(withImport, without);
    }
    const noConflict = buildWallPrintSnapshot(baseInput({ bundle: clone(conflicted), assessments: assessmentsOf(importExternalAssessments([envelope(reviewerAssessment({ assessment: "NO_CONFLICT" }))], context(conflicted))) }));
    assert.ok(noConflict.conflicts.length > 0, "an assessor saying there is no conflict does not remove the engine's conflict");
  });

  test("an external assessor cannot be WalletWall, cannot supply the WalletWall assessment and cannot overwrite it", () => {
    refused(importExternalAssessments([envelope({ ...reviewerAssessment(), assessor: WALLETWALL_ASSESSOR_ID })], context()), "ATTRIBUTION_REFUSED", "ASSESSOR_IDENTITY_RESERVED");
    refused(importExternalAssessments([envelope({ ...reviewerAssessment(), assessorRole: "WALLETWALL" })], context()), "ATTRIBUTION_REFUSED", "ASSESSOR_IDENTITY_RESERVED", "assessorRole");
    refused(importExternalAssessments([envelope({ ...reviewerAssessment(), policy: "wwap/asset-identity/0.1" })], context()), "ATTRIBUTION_REFUSED", "RESERVED_POLICY_NAMESPACE");
    const record = buildWallPrintSnapshot(baseInput({ assessments: assessmentsOf(importExternalAssessments(agree(), context())) }));
    assert.equal(record.assessments.filter((a) => a.assessorRole === "WALLETWALL").length, 1);
  });

  test("assessor identity is not issuer identity: the ISSUER role is bound to the focal deployment's registry authority", () => {
    refused(importExternalAssessments([envelope(issuerAssessment({ assessor: "issuer:someone-else" }))], context()), "ATTRIBUTION_REFUSED", "ISSUER_AUTHORITY_MISMATCH");
    refused(importExternalAssessments([envelope(reviewerAssessment({ assessor: "issuer:circle" }))], context()), "ATTRIBUTION_REFUSED", "ASSESSOR_IDENTITY_RESERVED");
    refused(importExternalAssessments([envelope(issuerAssessment())], context(ATTRIBUTION_CASES.find((c) => c.bundle !== undefined)?.bundle ?? golden())), "ATTRIBUTION_REFUSED", "ISSUER_NOT_IN_REGISTRY");
  });

  test("the importer never evaluates the bundle: the context is used only to check attribution", () => {
    const ctx = context(golden());
    const before = JSON.stringify(ctx);
    importExternalAssessments(agree(), ctx);
    assert.equal(JSON.stringify(ctx), before);
    const src = readFileSync(`${ROOT}packages/mcp/src/wallprint/assessor-import.ts`, "utf8");
    assert.ok(!/evaluateBundle|checkInvariants|traceProvenance|assessReadiness/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no evaluation code path");
  });
});

describe("assessor import: it is a local, pure domain function, outside the shipped runtime and every public surface", () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
  const SRC = ["assessor-import.ts", "strict-json.ts"].map((f) => [f, strip(readFileSync(`${ROOT}packages/mcp/src/wallprint/${f}`, "utf8"))] as const);

  test("no clock, randomness, network, file access, environment, process or dynamic code", () => {
    for (const [name, src] of SRC) {
      assert.ok(!/\bDate\b|Math\.random|randomUUID|randomBytes|\bfetch\b|XMLHttpRequest|WebSocket|\bprocess\b|\beval\b|new Function|\bimport\s*\(|require\s*\(/.test(src), name);
      assert.ok(!/from\s*["']node:(fs|net|http|https|http2|dns|tls|child_process|os|vm|worker_threads|path|url)["']/.test(src), name);
    }
  });

  test("it imports only the engine's schema, sibling WallPrint modules and zod: no hashing, no node built-in", () => {
    const specs = new Set(SRC.flatMap(([, src]) => [...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1] as string)));
    assert.deepEqual(
      [...specs].sort(),
      ["../schemas.ts", "./errors.ts", "./freeze.ts", "./record.ts", "./strict-json.ts", "./vocabulary.ts", "zod"].sort(),
    );
  });

  test("the six MCP tools and eleven resources are unchanged, and the shipped runtime does not know the importer", () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ["resolve_asset", "normalize_observation", "inspect_evidence", "check_invariants", "trace_provenance", "assess_vault_readiness"]);
    assert.equal(RESOURCES.length, 11);
    for (const f of ["packages/mcp/src/main.ts", "packages/mcp/src/server.ts", "packages/mcp/src/tools.ts", "packages/mcp/src/resources.ts"]) {
      assert.ok(!/assessor-import|strict-json|importExternalAssessments/.test(readFileSync(`${ROOT}${f}`, "utf8")), `${f} must not import the importer`);
    }
    const bundle = readFileSync(`${ROOT}plugin/server/walletwall-mcp.mjs`, "utf8");
    assert.ok(!/assessmentImportVersion|importExternalAssessments|parseStrictJson|ASSESSOR_IMPORT/.test(bundle), "the shipped MCP bundle carries none of the importer");
  });

  test("no public surface reaches it: not the public resolver, the canvas or the plugin extension, and no write route is declared", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mjs|js|json)$/.test(name) && /assessor-import|importExternalAssessments|assessmentImportVersion/.test(readFileSync(p, "utf8"))) hits.push(p.slice(ROOT.length).replace(/\\/g, "/"));
      }
    };
    for (const d of ["packages/wallprint-web", "plugin", "canvas", "scripts"]) walk(`${ROOT}${d}`);
    assert.deepEqual(hits, [], "no resolver, canvas, plugin or script references the importer");
  });
});
