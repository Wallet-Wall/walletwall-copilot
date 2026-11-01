import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { SUPPORT_STATES, type Bundle } from "../../src/schemas.ts";
import { WALLPRINT_VERSION } from "../../src/wallprint/vocabulary.ts";
import { importExternalAssessments, type AssessorImportContext, type AssessorImportResult } from "../../src/wallprint/assessor-import.ts";
import { ExternalAssessmentInputSchema, buildWallPrintSnapshot, wallPrintDigest, wallPrintPayload, type SnapshotInput, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { ATTRIBUTION_CASES } from "./assessor-cases.ts";
import { baseInput, clone, golden, issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * Mutation check for the import boundary and the authority firewall: a contract the real implementation satisfies and
 * each realistic broken implementation violates. A mutant is the real importer or builder wrapped so that it commits one
 * specific mistake; each must fail at least the checks named for it. (The same mistakes were also made in the sources
 * themselves and run against the whole test suite; the result is recorded in the pull request.)
 */
type ImportFn = (inputs: readonly (string | Uint8Array)[], ctx: AssessorImportContext) => AssessorImportResult;
type BuildFn = (input: SnapshotInput) => WallPrintRecord;

const env = (a: unknown): string => JSON.stringify({ assessmentImportVersion: "0.1", externalAssessment: a });
const ctx = (bundle: Bundle = golden(), focalAssertionId = "a-identity"): AssessorImportContext => ({ bundle: clone(bundle), focalAssertionId, wallprintVersion: WALLPRINT_VERSION });
const text = (b: string | Uint8Array): string => (typeof b === "string" ? b : Buffer.from(b).toString("utf8"));
const unregistered = ATTRIBUTION_CASES.find((c) => c.bundle !== undefined)?.bundle as Bundle;

interface Check {
  id: string;
  holds: (imp: ImportFn, build: BuildFn) => boolean;
}

const refuses = (imp: ImportFn, inputs: string[], c: AssessorImportContext = ctx()): boolean => imp(inputs, c).status === "REFUSED";

const CHECKS: readonly Check[] = [
  { id: "imports a valid assessment exactly as stated", holds: (imp) => { const stated = reviewerAssessment({ statement: "As stated.", assessment: "SUPPORTED" }); const r = imp([env(stated)], ctx()); return r.status === "IMPORTED" && canonicalize(r.assessments[0]) === canonicalize(stated); } },
  { id: "refuses a caller-supplied WALLETWALL role", holds: (imp) => refuses(imp, [env(reviewerAssessment({ assessorRole: "WALLETWALL" }))]) },
  { id: "refuses a WalletWall-looking identity", holds: (imp) => refuses(imp, [env(reviewerAssessment({ assessor: "wallet-wall" }))]) },
  { id: "refuses a reserved policy namespace", holds: (imp) => refuses(imp, [env(reviewerAssessment({ policy: "wwap/asset-identity/0.1" }))]) },
  { id: "refuses an ISSUER that is not the registry authority", holds: (imp) => refuses(imp, [env(issuerAssessment({ assessor: "issuer:tether" }))]) },
  { id: "refuses an ISSUER on an unregistered subject", holds: (imp) => refuses(imp, [env(issuerAssessment())], ctx(unregistered)) },
  { id: "refuses a dangling evidence reference", holds: (imp) => refuses(imp, [env(reviewerAssessment({ evidenceRefs: ["obs-missing"] }))]) },
  { id: "refuses an unknown field instead of dropping it", holds: (imp) => refuses(imp, [env({ ...reviewerAssessment(), rank: "1" })]) },
  { id: "refuses a duplicate assessor and policy (no last write wins)", holds: (imp) => refuses(imp, [env(reviewerAssessment()), env(reviewerAssessment({ assessment: "OTHER_CODE" }))]) },
  { id: "refuses a case-variant duplicate", holds: (imp) => refuses(imp, [env(reviewerAssessment()), env(reviewerAssessment({ assessor: "REVIEWER-Y", policy: "REVIEWER-Y-REVIEW" }))]) },
  { id: "refuses the whole set when one item is invalid", holds: (imp) => { const r = imp([env(reviewerAssessment()), env(reviewerAssessment({ assessor: "reviewer-z", policy: "z", assessorRole: "WALLETWALL" }))], ctx()); return r.status === "REFUSED"; } },
  { id: "refuses a repeated JSON key", holds: (imp) => refuses(imp, [env(reviewerAssessment({ assessment: "NOT_AVAILABLE" })).replace('"assessment":"NOT_AVAILABLE"', '"assessment":"NOT_AVAILABLE","assessment":"CONFIRMED"')]) },
  { id: "refuses a prototype key", holds: (imp) => refuses(imp, [env(reviewerAssessment()).replace(/^\{/, '{"__proto__":{"x":"y"},')]) },
  { id: "refuses oversized input", holds: (imp) => refuses(imp, [`${env(reviewerAssessment())}${" ".repeat(20_000)}`]) },
  { id: "refuses a credential-shaped statement", holds: (imp) => refuses(imp, [env(reviewerAssessment({ statement: "token: abcdefghijkl" }))]) },
  {
    id: "an external SUPPORTED never becomes a claim's support",
    holds: (imp, build) => {
      const bundle = clone(golden());
      bundle.observations = bundle.observations.map((o) => (o.id === "obs-balance" ? { ...o, payload: { balanceAtomic: "1500001", decimals: "6" } } : o));
      const r = imp([env(reviewerAssessment({ assessment: "SUPPORTED", evidenceRefs: ["obs-balance"] }))], ctx(bundle, "a-balance"));
      if (r.status !== "IMPORTED") return false;
      const record = build(baseInput({ bundle, focalAssertionId: "a-balance", assessments: [...r.assessments] }));
      return record.claims.find((c) => c.assertionId === "a-balance")?.supportState === "NOT_ESTABLISHED";
    },
  },
  {
    id: "assessor agreement adds no corroboration and no authority",
    holds: (imp, build) => {
      const bundle = clone(golden());
      bundle.sources = bundle.sources.map((s) => (s.kind === "PROVIDER_ENDPOINT" ? { id: s.id, kind: s.kind, transport: s.transport! } : s));
      const r = imp([env(issuerAssessment({ assessment: "SUPPORTED" })), env(reviewerAssessment({ assessment: "SUPPORTED" })), env(reviewerAssessment({ assessor: "reviewer-z", policy: "z", assessment: "SUPPORTED" }))], ctx(bundle));
      if (r.status !== "IMPORTED") return false;
      const withImport = build(baseInput({ bundle, assessments: [...r.assessments] }));
      const without = build(baseInput({ bundle, assessments: [] }));
      return JSON.stringify(withImport.claims) === JSON.stringify(without.claims);
    },
  },
];

const failures = (imp: ImportFn, build: BuildFn): string[] => CHECKS.filter((c) => !c.holds(imp, build)).map((c) => c.id);
const REAL_IMPORT: ImportFn = importExternalAssessments;
const REAL_BUILD: BuildFn = buildWallPrintSnapshot;

/** Re-read the inputs ignoring all attribution, as a lax importer would. */
const lenient = (inputs: readonly (string | Uint8Array)[]): AssessorImportResult => ({
  status: "IMPORTED",
  assessments: inputs.map((i) => ExternalAssessmentInputSchema.parse((JSON.parse(text(i)) as { externalAssessment: unknown }).externalAssessment)),
});

/** A lax importer: when the real one refuses only for the named codes, import anyway. */
const ignoring = (codes: string[]): ImportFn => (inputs, c) => {
  const r = REAL_IMPORT(inputs, c);
  return r.status === "REFUSED" && r.findings.length > 0 && r.findings.every((f) => codes.includes(f.code)) ? lenient(inputs) : r;
};

const viaText = (rewrite: (t: string) => string): ImportFn => (inputs, c) => REAL_IMPORT(inputs.map((i) => rewrite(text(i))), c);

const patchRecord = (record: WallPrintRecord, patch: (p: ReturnType<typeof wallPrintPayload>) => void): WallPrintRecord => {
  const payload = structuredClone(wallPrintPayload(record));
  patch(payload);
  return { ...payload, digest: wallPrintDigest(payload) };
};

interface Mutant {
  name: string;
  caughtBy: string[];
  imp?: ImportFn;
  build?: BuildFn;
}

const MUTANTS: readonly Mutant[] = [
  { name: "allows the WALLETWALL role", imp: ignoring(["ASSESSOR_IDENTITY_RESERVED"]), caughtBy: ["refuses a caller-supplied WALLETWALL role", "refuses a WalletWall-looking identity"] },
  { name: "accepts a reserved WalletWall policy namespace", imp: ignoring(["RESERVED_POLICY_NAMESPACE"]), caughtBy: ["refuses a reserved policy namespace"] },
  { name: "accepts an unmatched ISSUER", imp: ignoring(["ISSUER_AUTHORITY_MISMATCH", "ISSUER_NOT_IN_REGISTRY"]), caughtBy: ["refuses an ISSUER that is not the registry authority", "refuses an ISSUER on an unregistered subject"] },
  { name: "accepts a dangling evidence reference", imp: ignoring(["UNKNOWN_EVIDENCE_REFERENCE"]), caughtBy: ["refuses a dangling evidence reference"] },
  { name: "accepts a credential-shaped statement", imp: ignoring(["SUSPECTED_SECRET"]), caughtBy: ["refuses a credential-shaped statement"] },
  {
    name: "drops unknown fields instead of refusing them",
    imp: viaText((t) => {
      const o = JSON.parse(t) as { assessmentImportVersion: string; externalAssessment: Record<string, unknown> };
      const known = new Set(Object.keys(ExternalAssessmentInputSchema.shape));
      return JSON.stringify({ assessmentImportVersion: o.assessmentImportVersion, externalAssessment: Object.fromEntries(Object.entries(o.externalAssessment).filter(([k]) => known.has(k))) });
    }),
    caughtBy: ["refuses an unknown field instead of dropping it"],
  },
  {
    name: "last write wins for a duplicate assessor and policy",
    imp: (inputs, c) => {
      const keyOf = (t: string): string => { const a = (JSON.parse(t) as { externalAssessment: { assessor: string; policy: string } }).externalAssessment; return `${a.assessor.toLowerCase()}|${a.policy.toLowerCase()}`; };
      const last = new Map(inputs.map((i) => [keyOf(text(i)), i] as const));
      return REAL_IMPORT([...last.values()], c);
    },
    caughtBy: ["refuses a duplicate assessor and policy (no last write wins)", "refuses a case-variant duplicate"],
  },
  {
    name: "swallows an invalid item of a batch and imports the rest",
    imp: (inputs, c) => ({ status: "IMPORTED", assessments: inputs.flatMap((i) => { const r = REAL_IMPORT([i], c); return r.status === "IMPORTED" ? r.assessments : []; }) }),
    caughtBy: ["refuses the whole set when one item is invalid", "refuses a caller-supplied WALLETWALL role"],
  },
  { name: "lets the last of a repeated JSON key win", imp: viaText((t) => JSON.stringify(JSON.parse(t))), caughtBy: ["refuses a repeated JSON key"] },
  { name: "ignores prototype keys", imp: viaText((t) => JSON.stringify(JSON.parse(t, (k, v: unknown) => (k === "__proto__" ? undefined : v)))), caughtBy: ["refuses a prototype key"] },
  { name: "has no input size bound", imp: viaText((t) => t.trimEnd()), caughtBy: ["refuses oversized input"] },
  {
    name: "translates an external SUPPORTED into claim support",
    build: (input) => {
      const record = REAL_BUILD(input);
      const said = record.assessments.find((a) => a.assessorRole !== "WALLETWALL" && (SUPPORT_STATES as readonly string[]).includes(a.assessment));
      return said === undefined ? record : patchRecord(record, (p) => { for (const c of p.claims) if (c.assertionId === record.subject.focalAssertionId) c.supportState = said.assessment as typeof c.supportState; });
    },
    caughtBy: ["an external SUPPORTED never becomes a claim's support"],
  },
  {
    name: "increments independent corroboration for assessor agreement",
    build: (input) => {
      const record = REAL_BUILD(input);
      const n = record.assessments.filter((a) => a.assessorRole !== "WALLETWALL").length;
      return n === 0 ? record : patchRecord(record, (p) => { for (const c of p.claims) if (c.independentCorroboration !== null) c.independentCorroboration = String(Number(c.independentCorroboration) + n); });
    },
    caughtBy: ["assessor agreement adds no corroboration and no authority"],
  },
  {
    name: "lets an external issuer satisfy the engine's authority",
    build: (input) => {
      const record = REAL_BUILD(input);
      return record.assessments.every((a) => a.assessorRole !== "ISSUER") ? record : patchRecord(record, (p) => { for (const c of p.claims) c.authority = { authorityId: "issuer-publication", kind: "ISSUER_PUBLICATION", satisfied: true }; });
    },
    caughtBy: ["assessor agreement adds no corroboration and no authority"],
  },
];

describe("mutation check: the contract holds for the real implementation and fails for each realistic mistake", () => {
  test("the real importer and builder satisfy every check", () => {
    assert.deepEqual(failures(REAL_IMPORT, REAL_BUILD), []);
  });

  for (const m of MUTANTS) {
    test(`caught: ${m.name}`, () => {
      const failed = failures(m.imp ?? REAL_IMPORT, m.build ?? REAL_BUILD);
      assert.ok(failed.length > 0, `mutant survived: ${m.name}`);
      for (const id of m.caughtBy) assert.ok(failed.includes(id), `expected "${id}" to catch "${m.name}"; failed: ${JSON.stringify(failed)}`);
    });
  }

  test("every check is exercised by at least one mutant, so none of them is decoration", () => {
    const named = new Set(MUTANTS.flatMap((m) => m.caughtBy));
    const unused = CHECKS.map((c) => c.id).filter((id) => !named.has(id) && id !== "imports a valid assessment exactly as stated");
    assert.deepEqual(unused, []);
  });
});
