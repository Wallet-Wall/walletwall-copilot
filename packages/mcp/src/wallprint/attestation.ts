import { z } from "zod";
import { canonicalize, evidenceDigest } from "../canonical.ts";
import { ID_RE, hasForbiddenStructure } from "../schemas.ts";
import {
  ATTESTATION_LIMITS,
  ATTESTATION_PURPOSES,
  ATTESTATION_TYPE,
  ATTESTATION_VERSIONS,
  DOMAIN_TAGS,
  PURPOSE_TARGET_KIND,
  type AttestationPurpose,
} from "./attestation-vocabulary.ts";
import { AssessmentRecordSchema, HEX64_RE, RECORD_ID_RE, type AssessmentRecord } from "./record.ts";
import { parseStrictJson } from "./strict-json.ts";
import { WALLPRINT_CANONICALIZATION, WALLPRINT_DIGEST_ALGORITHM, WALLPRINT_VERSIONS, type WallPrintVersion } from "./vocabulary.ts";

/**
 * The detached WallPrint attestation: an envelope around one typed, domain-separated statement. A detached attestation
 * never enters a committed record and never changes its digest. Design: spec/WALLPRINT_ATTESTATIONS.md.
 *
 * Every field of the envelope is either signed (everything inside `statement`) or a parse selector that must equal its
 * signed twin (`attestationVersion`) or the signature itself. There is no unsigned metadata.
 *
 * Pure: no clock, no I/O, no randomness. Nothing here signs anything.
 */

const Hex64 = z.string().regex(HEX64_RE);
const SIGNER_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const ALGORITHM_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const KEY_HEX_RE = /^(?:[0-9a-f]{2}){1,2048}$/;
const SIGNATURE_HEX_RE = /^(?:[0-9a-f]{2}){1,4096}$/;

export const SignerIdSchema = z.string().regex(SIGNER_ID_RE);
export const AlgorithmSchema = z.string().regex(ALGORITHM_RE);
export const PublicKeyHexSchema = z.string().regex(KEY_HEX_RE);

export const RecordTargetSchema = z.strictObject({
  kind: z.literal("WALLPRINT_RECORD"),
  wallprintVersion: z.enum(WALLPRINT_VERSIONS),
  recordId: z.string().regex(RECORD_ID_RE),
  canonicalization: z.literal(WALLPRINT_CANONICALIZATION),
  digestAlgorithm: z.literal(WALLPRINT_DIGEST_ALGORITHM),
  digest: Hex64,
});
export type RecordTarget = z.infer<typeof RecordTargetSchema>;

export const AssessmentTargetSchema = z.strictObject({
  kind: z.literal("WALLPRINT_ASSESSMENT"),
  wallprintVersion: z.enum(WALLPRINT_VERSIONS),
  bundleDigest: Hex64,
  focalAssertionId: z.string().regex(ID_RE),
  assessment: AssessmentRecordSchema,
});
export type AssessmentTarget = z.infer<typeof AssessmentTargetSchema>;

export type AttestationTarget = RecordTarget | AssessmentTarget;

export const AttestationStatementSchema = z.strictObject({
  attestationVersion: z.enum(ATTESTATION_VERSIONS),
  purpose: z.enum(ATTESTATION_PURPOSES),
  signer: z.strictObject({ signerId: SignerIdSchema, keyId: SignerIdSchema, algorithm: AlgorithmSchema, publicKey: PublicKeyHexSchema }),
  target: z.discriminatedUnion("kind", [RecordTargetSchema, AssessmentTargetSchema]),
});
export type AttestationStatement = z.infer<typeof AttestationStatementSchema>;

export const AttestationEnvelopeSchema = z.strictObject({
  type: z.literal(ATTESTATION_TYPE),
  attestationVersion: z.enum(ATTESTATION_VERSIONS),
  statement: AttestationStatementSchema,
  signature: z.string().regex(SIGNATURE_HEX_RE),
});
export type AttestationEnvelope = z.infer<typeof AttestationEnvelopeSchema>;

const encoder = new TextEncoder();

/**
 * The exact bytes that are signed: `UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))`. The tag is chosen by the
 * statement's purpose, and the statement names the purpose too, the signer, the key, the algorithm and the whole target.
 * Nothing is signed that the reader cannot see, and no digest is signed without the context that gives it meaning.
 */
export function attestationPreimage(statement: AttestationStatement): Uint8Array {
  const tag = encoder.encode(DOMAIN_TAGS[statement.purpose]);
  const body = encoder.encode(canonicalize(statement));
  const out = new Uint8Array(tag.length + 1 + body.length);
  out.set(tag, 0);
  out.set(body, tag.length + 1);
  return out;
}

/** The identity of one attestation artifact: SHA-256 over the RFC 8785 form of the envelope (the engine's `evidenceDigest`). Never signed; only an address. */
export const attestationDigest = (envelope: AttestationEnvelope): string => evidenceDigest(envelope);

/** The target of a RECORD_PUBLICATION attestation: exactly the identity a receipt carries. */
export function recordTarget(record: { wallprintVersion: WallPrintVersion; id: string; digest: string }): RecordTarget {
  return {
    kind: "WALLPRINT_RECORD",
    wallprintVersion: record.wallprintVersion,
    recordId: record.id,
    canonicalization: WALLPRINT_CANONICALIZATION,
    digestAlgorithm: WALLPRINT_DIGEST_ALGORITHM,
    digest: record.digest,
  };
}

/** The target of an assessment attestation: the assessment as the record holds it, in the context it was made about. */
export function assessmentTarget(
  record: { wallprintVersion: WallPrintVersion; evidence: { bundleDigest: string }; subject: { focalAssertionId: string } },
  assessment: AssessmentRecord,
): AssessmentTarget {
  return { kind: "WALLPRINT_ASSESSMENT", wallprintVersion: record.wallprintVersion, bundleDigest: record.evidence.bundleDigest, focalAssertionId: record.subject.focalAssertionId, assessment };
}

/** The store address of an assessment's attestations: SHA-256 over the RFC 8785 form of its target. An index key, never a signed value. */
export const assessmentTargetKey = (target: AssessmentTarget): string => evidenceDigest(target);

/** The store address of a target: a record's own digest, or an assessment target's key. */
export const targetKeyOf = (target: AttestationTarget): string => (target.kind === "WALLPRINT_RECORD" ? target.digest : assessmentTargetKey(target));

/** Why a statement can never authenticate its target, whatever its signature says. Fixed codes. */
export function statementFindings(statement: AttestationStatement): ("PURPOSE_ROLE_MISMATCH" | "PURPOSE_TARGET_MISMATCH" | "WALLETWALL_ASSESSMENT_NOT_ATTESTABLE")[] {
  const out: ("PURPOSE_ROLE_MISMATCH" | "PURPOSE_TARGET_MISMATCH" | "WALLETWALL_ASSESSMENT_NOT_ATTESTABLE")[] = [];
  const purpose: AttestationPurpose = statement.purpose;
  if (statement.target.kind !== PURPOSE_TARGET_KIND[purpose]) {
    out.push("PURPOSE_TARGET_MISMATCH");
    return out;
  }
  if (statement.target.kind === "WALLPRINT_ASSESSMENT") {
    const role = statement.target.assessment.assessorRole;
    if (role === "WALLETWALL") out.push("WALLETWALL_ASSESSMENT_NOT_ATTESTABLE");
    else if ((purpose === "ISSUER_ASSESSMENT_ORIGIN") !== (role === "ISSUER")) out.push("PURPOSE_ROLE_MISMATCH");
  }
  return out;
}

export type ParseProblem = "BODY_TOO_LARGE" | "DUPLICATE_KEY" | "FORBIDDEN_STRUCTURE" | "SHAPE" | "SYNTAX" | "TOO_DEEP" | "VERSION_MISMATCH";
export type ParseResult = { ok: true; envelope: AttestationEnvelope } | { ok: false; problem: ParseProblem; unsupportedVersion: boolean };

const refuse = (problem: ParseProblem, unsupportedVersion = false): ParseResult => ({ ok: false, problem, unsupportedVersion });

/** Read one attestation from text, bytes or an already parsed value. Closed schema, strict JSON, never throws, never echoes input. */
export function parseAttestation(input: unknown): ParseResult {
  let value: unknown = input;
  if (typeof input === "string" || input instanceof Uint8Array) {
    let text: string;
    try {
      text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return refuse("SYNTAX");
    }
    if (encoder.encode(text).length > ATTESTATION_LIMITS.maxEnvelopeBytes) return refuse("BODY_TOO_LARGE");
    const read = parseStrictJson(text, ATTESTATION_LIMITS.maxJsonDepth);
    if (!read.ok) return refuse(read.problem);
    value = read.value;
  }
  if (hasForbiddenStructure(value)) return refuse("FORBIDDEN_STRUCTURE");
  const version = (value as { attestationVersion?: unknown } | null)?.attestationVersion;
  if (typeof version === "string" && !(ATTESTATION_VERSIONS as readonly string[]).includes(version)) return refuse("SHAPE", true);
  const parsed = AttestationEnvelopeSchema.safeParse(value);
  if (!parsed.success) return refuse("SHAPE");
  if (parsed.data.attestationVersion !== parsed.data.statement.attestationVersion) return refuse("VERSION_MISMATCH");
  return { ok: true, envelope: parsed.data };
}
