import { z } from "zod";
import { hasForbiddenStructure, parseBundleStrict, type Bundle } from "../schemas.ts";
import { finding, type Finding } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { ExternalAssessmentInputSchema, externalAssessmentAdmissionFindings, issuesToFindings, secretFindings, type ExternalAssessmentInput } from "./record.ts";
import { parseStrictJson, type StrictJsonProblem } from "./strict-json.ts";
import { WALLPRINT_LIMITS } from "./vocabulary.ts";

/**
 * External assessor import: untrusted serialized assessment → the existing WallPrint external assessment input.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 *
 * WallPrint 0.1 already records attributed external assessments (record.ts: `buildWallPrintSnapshot({ assessments })`,
 * `validateWallPrintRecord`). What it lacked is a boundary for assessments that arrive as TEXT from someone else: bytes
 * with no size bound, JSON that may name a key twice, an envelope nobody had defined. This module is that boundary and
 * nothing more. It defines no second assessment model and no second rule set: it reads one closed envelope, hands the
 * assessment to the SAME schema and the SAME attribution rules the builder applies (`ExternalAssessmentInputSchema`,
 * `externalAssessmentAdmissionFindings`), and returns the existing `ExternalAssessmentInput`, unchanged, for the caller
 * to pass to `buildWallPrintSnapshot`, which applies every rule again and whose output `validateWallPrintRecord` checks.
 *
 *   import format (one assessment per envelope; its own version, not the WallPrint version)
 *     { "assessmentImportVersion": "0.1", "externalAssessment": { assessor, assessorRole, assessment, statement?, policy,
 *                                                                  policyVersion, assessedAt, evidenceRefs, limitations? } }
 *
 * IMPORTED means only that the input passed the structural and attribution admission rules and is recorded as the named
 * assessor stated it. It does not mean the conclusion is true, that WalletWall agrees, or that the assessor is who the
 * input says: the identity is attribution, not authentication (no signature, key, certificate or DID exists in this
 * lane). The importer cannot change a claim's support, freshness, finality, authority, corroboration, conflicts,
 * violations, provenance or readiness: it never evaluates a bundle and never returns anything but assessments.
 *
 *   external != trusted                       assessor identity != issuer identity
 *   external != verified                      assessment agreement != independent corroboration
 *   assessment != evidence state              absence of assessment != failed assessment
 *   assessment != authority                   digest integrity != factual truth
 *
 * Pure and deterministic: no clock, no generated id, no network, no file access, no credentials. The same bytes and the
 * same context give the same result. It never throws and never echoes caller text; a refusal carries a fixed reason and
 * findings made of fixed codes and fixed paths. Atomic: one refused input refuses the whole set, nothing is dropped,
 * merged or last-write-wins. Importing commits, discloses, corrects, supersedes, withdraws and publishes nothing: the
 * disclosure lifecycle (history.ts) is a separate dimension that begins when a caller commits a record.
 *
 * No import receipt is returned. The caller holds the bytes, an identical import re-derives the identical assessment,
 * and a digest of the input computed here would be one more SHA-256 site under security/integrity-policy.json for no
 * audit value the caller cannot get by hashing what it passed in. A durable store, if one is built, is where a digest of
 * the original input belongs.
 *
 * Nothing here is imported by main.ts, server.ts or tools.ts, and it is not a tool, a resource, an endpoint or a UI.
 */

/** The import envelope's own version. It versions this input format, not the WallPrint record (WALLPRINT_VERSION). */
export const ASSESSOR_IMPORT_VERSION = "0.1";

/**
 * The largest input accepted, in bytes. The longest envelope the schema admits is about 5 KiB (32 evidence references,
 * 32 limitation codes and the bounded text fields); the rest is room for whitespace. Larger input is refused unread.
 */
export const ASSESSOR_IMPORT_MAX_BYTES = 16 * 1024;

/** The deepest nesting the closed shape implies: envelope, assessment, and its two lists. */
export const ASSESSOR_IMPORT_MAX_DEPTH = 3;

/** Inputs per call: the builder's own cap on external assessments, so an imported set never exceeds what a record can hold. */
export const ASSESSOR_IMPORT_MAX_INPUTS = WALLPRINT_LIMITS.externalAssessments;

export const ASSESSOR_IMPORT_STATUSES = ["IMPORTED", "REFUSED"] as const;
export type AssessorImportStatus = (typeof ASSESSOR_IMPORT_STATUSES)[number];

/** Why an import was refused, a closed list. Finer codes (which rule, which field) are in the findings. */
export const ASSESSOR_IMPORT_REFUSALS = [
  "INVALID_INPUT",
  "TOO_MANY",
  "TOO_LARGE",
  "NOT_UTF8",
  "MALFORMED_JSON",
  "DUPLICATE_KEY",
  "TOO_DEEP",
  "FORBIDDEN_STRUCTURE",
  "UNSUPPORTED_VERSION",
  "INVALID_ENVELOPE",
  "SUSPECTED_SECRET",
  "INVALID_CONTEXT",
  "ATTRIBUTION_REFUSED",
] as const;
export type AssessorImportRefusal = (typeof ASSESSOR_IMPORT_REFUSALS)[number];

export const ASSESSOR_IMPORT_ESTABLISHES = "The input passed WallPrint's structural and attribution admission rules and is recorded as the named assessor stated it.";

/** What an import does NOT establish. */
export const ASSESSOR_IMPORT_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "that the assessment is true",
  "that the assessor is who the input says it is",
  "that WalletWall endorses, agrees with or relies on the assessment",
  "any change to a claim's support, freshness, finality, authority, corroboration, conflicts or readiness",
  "that two assessments agree or corroborate each other",
]);

export const ASSESSOR_IMPORT_INVARIANTS: readonly string[] = Object.freeze([
  "external != trusted",
  "external != verified",
  "assessment != evidence state",
  "assessment != authority",
  "assessor agreement != independent corroboration",
  "assessor identity != issuer identity",
  "digest integrity != factual truth",
  "absence of assessment != failed assessment",
]);

export type AssessorImportResult =
  /** The existing external assessment inputs, one per input in input order, exactly as stated: nothing rewritten, summarized, translated or inferred. Frozen. */
  | { readonly status: "IMPORTED"; readonly assessments: readonly ExternalAssessmentInput[] }
  | { readonly status: "REFUSED"; readonly reason: AssessorImportRefusal; readonly findings: readonly Finding[] };

/** One serialized envelope: UTF-8 bytes, or text (taken as its UTF-8 encoding). */
export type AssessorImportInput = string | Uint8Array;

/** What the assessments are about: the WWEP bundle and the focal assertion a record would be built for. Untrusted too; it is parsed with the engine's closed schema. */
export interface AssessorImportContext {
  readonly bundle: unknown;
  readonly focalAssertionId: string;
}

const EnvelopeSchema = z.strictObject({
  assessmentImportVersion: z.literal(ASSESSOR_IMPORT_VERSION),
  externalAssessment: ExternalAssessmentInputSchema,
});

/** Findings kept per refused input, so one input with many problems cannot crowd out another input's refusal; the whole list is bounded by inputs times this. */
const MAX_FINDINGS_PER_INPUT = 8;
const MAX_FINDINGS = ASSESSOR_IMPORT_MAX_INPUTS * MAX_FINDINGS_PER_INPUT;
const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();

type Parsed = { ok: true; assessment: ExternalAssessmentInput } | { ok: false; reason: AssessorImportRefusal; findings: Finding[] };

const refuse = (reason: AssessorImportRefusal, path: string): Parsed => ({ ok: false, reason, findings: [finding(reason, path)] });

const JSON_PROBLEMS: Readonly<Record<StrictJsonProblem, AssessorImportRefusal>> = { SYNTAX: "MALFORMED_JSON", DUPLICATE_KEY: "DUPLICATE_KEY", TOO_DEEP: "TOO_DEEP" };

/** One input to one assessment, or the fixed reason it is refused. Everything that does not need the bundle. Never throws: an input that cannot even be inspected is INVALID_INPUT. */
function readEnvelope(input: unknown, at: string): Parsed {
  try {
    const read = readEnvelopeUnguarded(input, at);
    return read.ok ? read : { ...read, findings: read.findings.slice(0, MAX_FINDINGS_PER_INPUT) };
  } catch {
    return refuse("INVALID_INPUT", at);
  }
}

function readEnvelopeUnguarded(input: unknown, at: string): Parsed {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    // A UTF-16 code unit encodes to at least one byte, so a longer string is over the bound without encoding it.
    if (input.length > ASSESSOR_IMPORT_MAX_BYTES) return refuse("TOO_LARGE", at);
    bytes = ENCODER.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else return refuse("INVALID_INPUT", at);
  if (bytes.byteLength > ASSESSOR_IMPORT_MAX_BYTES) return refuse("TOO_LARGE", at);

  let text: string;
  try {
    text = DECODER.decode(bytes);
  } catch {
    return refuse("NOT_UTF8", at);
  }

  const json = parseStrictJson(text, ASSESSOR_IMPORT_MAX_DEPTH);
  if (!json.ok) return refuse(JSON_PROBLEMS[json.problem], at);
  if (hasForbiddenStructure(json.value)) return refuse("FORBIDDEN_STRUCTURE", at);

  const version = (json.value as { assessmentImportVersion?: unknown } | null)?.assessmentImportVersion;
  if (typeof version === "string" && version !== ASSESSOR_IMPORT_VERSION) return refuse("UNSUPPORTED_VERSION", `${at}.assessmentImportVersion`);

  const envelope = EnvelopeSchema.safeParse(json.value);
  if (!envelope.success) return { ok: false, reason: "INVALID_ENVELOPE", findings: issuesToFindings(envelope.error).map((f) => finding(f.code, f.path === "" ? at : `${at}.${f.path}`)) };

  // Credential-shaped text is refused in every slot of the assessment, not only the free-text ones the builder pre-checks.
  const secrets = secretFindings(envelope.data.externalAssessment, `${at}.externalAssessment`);
  if (secrets.length > 0) return { ok: false, reason: "SUSPECTED_SECRET", findings: secrets };

  return { ok: true, assessment: envelope.data.externalAssessment };
}

/**
 * Import serialized external assessments about one focal assertion, atomically.
 *
 * `IMPORTED` carries one assessment per input, in input order, each exactly as stated. `REFUSED` carries a fixed reason and
 * findings; nothing is partially imported. The reason is that of the first refused input in input order; the findings
 * name every refused input (at most eight each). Zero inputs import nothing and succeed, given a usable context: the
 * absence of an assessment is not a failed one. A hole in the list, or an element that cannot be inspected, is a refused
 * input, never a skipped one.
 *
 * `IMPORTED` speaks for the assessments. The context's own preconditions for building a record (a focal subject that
 * carries its identity keys, unique ids) are the builder's to check: `buildWallPrintSnapshot` may still refuse a bundle
 * this function accepted as context.
 *
 * Pass the assessments, with any others the caller holds, to `buildWallPrintSnapshot`; the builder applies every rule
 * again (including that one assessor assesses once per policy across the whole list) and `validateWallPrintRecord` checks
 * the record. Importing builds, commits, discloses and publishes nothing.
 */
export function importExternalAssessments(inputs: readonly AssessorImportInput[], context: AssessorImportContext): AssessorImportResult {
  try {
    return importAll(inputs, context);
  } catch {
    return { status: "REFUSED", reason: "INVALID_INPUT", findings: [finding("INVALID_INPUT", "inputs")] };
  }
}

function importAll(inputs: readonly AssessorImportInput[], context: AssessorImportContext): AssessorImportResult {
  if (!Array.isArray(inputs)) return { status: "REFUSED", reason: "INVALID_INPUT", findings: [finding("INVALID_INPUT", "inputs")] };
  if (inputs.length > ASSESSOR_IMPORT_MAX_INPUTS) return { status: "REFUSED", reason: "TOO_MANY", findings: [finding("TOO_MANY", "inputs")] };

  const resolved = resolveContext(context);
  if (!("bundle" in resolved)) return { status: "REFUSED", reason: "INVALID_CONTEXT", findings: resolved };

  // Array.from visits every index, so a hole in a sparse list is an undefined input (refused) rather than a skipped one.
  const parsed = Array.from(inputs, (input, i) => readEnvelope(input, `inputs[${i}]`));
  const failed = parsed.filter((p): p is Extract<Parsed, { ok: false }> => !p.ok);
  const first = failed[0];
  if (first !== undefined) return { status: "REFUSED", reason: first.reason, findings: failed.flatMap((p) => p.findings).slice(0, MAX_FINDINGS) };

  const accepted = parsed.flatMap((p) => (p.ok ? [p.assessment] : []));
  const attribution = externalAssessmentAdmissionFindings(accepted, resolved.bundle, resolved.focalAssertionId, (i) => `inputs[${i}].externalAssessment`);
  if (attribution.length > 0) return { status: "REFUSED", reason: "ATTRIBUTION_REFUSED", findings: attribution.slice(0, MAX_FINDINGS) };

  return deepFreeze({ status: "IMPORTED" as const, assessments: accepted });
}

/** The parsed bundle and focal assertion the assessments are about, or the findings that say the context cannot be used (so no input is read). */
function resolveContext(context: unknown): { bundle: Bundle; focalAssertionId: string } | Finding[] {
  try {
    if (context === null || typeof context !== "object") return [finding("INVALID_CONTEXT", "context")];
    const { bundle, focalAssertionId } = context as { bundle?: unknown; focalAssertionId?: unknown };
    if (typeof focalAssertionId !== "string") return [finding("INVALID_ID", "context.focalAssertionId")];
    const parsed = parseBundleStrict(bundle);
    if (!parsed.success) return [finding("INVALID_BUNDLE", "context.bundle")];
    // With nothing to check, the admission rules still say whether the focal assertion exists in the bundle.
    if (externalAssessmentAdmissionFindings([], parsed.data, focalAssertionId).length > 0) return [finding("UNKNOWN_FOCAL_ASSERTION", "context.focalAssertionId")];
    return { bundle: parsed.data, focalAssertionId };
  } catch {
    return [finding("INVALID_CONTEXT", "context")];
  }
}

