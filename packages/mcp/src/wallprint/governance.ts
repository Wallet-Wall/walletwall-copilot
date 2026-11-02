import { z } from "zod";
import { evidenceDigest } from "../canonical.ts";
import { hasForbiddenStructure } from "../schemas.ts";
import { AlgorithmSchema, PublicKeyHexSchema, SignerIdSchema, domainSeparatedPreimage } from "./attestation.ts";
import { CommittedStateSchema } from "./checkpoint.ts";
import {
  AUTHORIZATION_DOMAIN_TAGS,
  AUTHORIZATION_PURPOSES,
  CONFIRMATION_ORIGINS,
  GOVERNANCE_AUTHORIZATION_TYPE,
  GOVERNANCE_BOOTSTRAP_TYPE,
  GOVERNANCE_FORMAT_VERSIONS,
  GOVERNANCE_LIMITS,
  SUPERSEDED_STANDINGS,
} from "./governance-vocabulary.ts";
import { HEX64_RE } from "./record.ts";
import { parseStrictJson } from "./strict-json.ts";

/**
 * The public governance objects of the key ceremony: the root BOOTSTRAP a verifier pins, and the detached root-signed AUTHORIZATION that
 * names the one operational key allowed to sign checkpoints. Design: spec/WALLPRINT_ATTESTATIONS.md, section 24.
 *
 * Both are closed schemas of public material: an unknown field is refused, never dropped, so no slot exists in which a private key, a
 * seed, a passphrase or a label could ride. Every value is a string, a null or an array of strings (no JSON numbers, as everywhere in
 * WallPrint). The authorization is signed over `UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))` through the one shared
 * `domainSeparatedPreimage`, so there is no second encoding convention. Every field of the statement is signed; the envelope's other fields
 * are a fixed `type` literal and a version selector that must equal its signed twin.
 *
 * Pure: no clock, no I/O, no randomness. Nothing here signs anything.
 */

const Hex64 = z.string().regex(HEX64_RE);
const Epoch = z.string().regex(/^[1-9][0-9]{0,3}$/).refine((v) => Number(v) <= GOVERNANCE_LIMITS.maxEpoch);
const Generation = z.string().regex(/^[1-9][0-9]{0,2}$/).refine((v) => Number(v) <= GOVERNANCE_LIMITS.maxAuthorizations);
const PurposeToken = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const SIGNATURE_HEX_RE = /^(?:[0-9a-f]{2}){1,4096}$/;

// ─── the bootstrap ───────────────────────────────────────────────────────────

/**
 * The public root a verifier pins: one key id, one algorithm, one public key, the purposes the root may be used for, and the epoch of the
 * root lineage. The epoch increases only through an out-of-band trust reset (a new root); it is what stops an older root being accepted
 * again after a reset, and it is inside every authorization so an authorization cannot be replayed under another root. No status, no
 * history, no timestamp, no mutable trust state.
 */
export const GovernanceBootstrapSchema = z.strictObject({
  type: z.literal(GOVERNANCE_BOOTSTRAP_TYPE),
  formatVersion: z.enum(GOVERNANCE_FORMAT_VERSIONS),
  rootEpoch: Epoch,
  root: z.strictObject({ keyId: SignerIdSchema, algorithm: AlgorithmSchema, publicKey: PublicKeyHexSchema, purposes: z.array(PurposeToken).min(1).max(4) }),
});
export type GovernanceBootstrap = z.infer<typeof GovernanceBootstrapSchema>;

/** The identity of one bootstrap: SHA-256 over the RFC 8785 form of the artifact (the engine's `evidenceDigest`; no new digest site). Never signed; it is the fingerprint people compare. */
export const bootstrapDigest = (artifact: GovernanceBootstrap): string => evidenceDigest(artifact);

/** The same fingerprint grouped for reading aloud and comparing across channels: eight groups of eight lower-case hex characters. */
export const formatFingerprint = (digest: string): string => digest.match(/.{1,8}/g)?.join("-") ?? digest;

// ─── the authorization ───────────────────────────────────────────────────────

/** The root's decision about the key an authorization supersedes, and the last checkpoint state governance still stands behind for that key (null: none). */
export const SupersedesSchema = z.strictObject({
  authorizationDigest: Hex64,
  standing: z.enum(SUPERSEDED_STANDINGS),
  retainedAt: CommittedStateSchema.nullable(),
});
export type Supersedes = z.infer<typeof SupersedesSchema>;

export const AuthorizationStatementSchema = z.strictObject({
  authorizationVersion: z.enum(GOVERNANCE_FORMAT_VERSIONS),
  purpose: z.enum(AUTHORIZATION_PURPOSES),
  root: z.strictObject({ keyId: SignerIdSchema, algorithm: AlgorithmSchema, publicKey: PublicKeyHexSchema }),
  rootEpoch: Epoch,
  generation: Generation,
  authorizedKey: z.strictObject({ keyId: SignerIdSchema, algorithm: AlgorithmSchema, publicKey: PublicKeyHexSchema, purposes: z.array(PurposeToken).min(1).max(4) }),
  supersedes: SupersedesSchema.nullable(),
});
export type AuthorizationStatement = z.infer<typeof AuthorizationStatementSchema>;

export const AuthorizationEnvelopeSchema = z.strictObject({
  type: z.literal(GOVERNANCE_AUTHORIZATION_TYPE),
  authorizationVersion: z.enum(GOVERNANCE_FORMAT_VERSIONS),
  statement: AuthorizationStatementSchema,
  signature: z.string().regex(SIGNATURE_HEX_RE),
});
export type AuthorizationEnvelope = z.infer<typeof AuthorizationEnvelopeSchema>;

/**
 * The exact bytes that are signed: `UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))`, the construction of every detached signature in
 * WallPrint. The statement names the version, the purpose, the root, the root epoch, the generation, the authorized key with its grants, and the
 * superseded authorization with its standing; nothing is signed that the reader cannot see, and a digest is never signed alone.
 */
export const authorizationPreimage = (statement: AuthorizationStatement): Uint8Array => domainSeparatedPreimage(AUTHORIZATION_DOMAIN_TAGS[statement.purpose], statement);

/** The identity of one authorization artifact: SHA-256 over the RFC 8785 form of the envelope (the engine's `evidenceDigest`). Never signed; the next authorization names it. */
export const authorizationDigest = (envelope: AuthorizationEnvelope): string => evidenceDigest(envelope);

// ─── the small inputs a verifier is handed ───────────────────────────────────

/** The newest governance state the caller already relies on: the generation and the digest of that authorization. */
export const HeldGovernanceStateSchema = z.strictObject({ generation: Generation, authorizationDigest: Hex64 });
export type HeldGovernanceState = z.infer<typeof HeldGovernanceStateSchema>;

/** One independent confirmation that a bootstrap digest is the one a party publishes: where it was read, and the digest read there. */
export const ConfirmationSchema = z.strictObject({ origin: z.enum(CONFIRMATION_ORIGINS), digest: Hex64 });
export type Confirmation = z.infer<typeof ConfirmationSchema>;

/** The root a consumer already relies on, as a reset is judged against it: its epoch, its root key and its fingerprint. */
/** The root a caller relies on, and optionally the root public keys it has already retired: a reset may not go back to one of them. */
export const PinnedRootSchema = z.strictObject({ rootEpoch: Epoch, rootPublicKey: PublicKeyHexSchema, bootstrapDigest: Hex64, retiredRootPublicKeys: z.array(PublicKeyHexSchema).max(16).optional() });
export type PinnedRoot = z.infer<typeof PinnedRootSchema>;

// ─── parsing ─────────────────────────────────────────────────────────────────

export type GovernanceParseProblem = "BODY_TOO_LARGE" | "DUPLICATE_KEY" | "FORBIDDEN_STRUCTURE" | "SHAPE" | "SYNTAX" | "TOO_DEEP" | "VERSION_MISMATCH";

export type BootstrapParseResult = { ok: true; artifact: GovernanceBootstrap } | { ok: false; problem: GovernanceParseProblem; unsupportedVersion: boolean };
export type AuthorizationParseResult = { ok: true; envelope: AuthorizationEnvelope } | { ok: false; problem: GovernanceParseProblem; unsupportedVersion: boolean };

const encoder = new TextEncoder();

type ReadResult = { ok: true; value: unknown } | { ok: false; problem: GovernanceParseProblem };

/** Read text, bytes or an already parsed value as one JSON value: strict JSON for text, bounded, never throwing, never echoing input. */
function readValue(input: unknown, maxBytes: number): ReadResult {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) return { ok: true, value: input };
  let text: string;
  try {
    text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    return { ok: false, problem: "SYNTAX" };
  }
  if (encoder.encode(text).length > maxBytes) return { ok: false, problem: "BODY_TOO_LARGE" };
  const read = parseStrictJson(text, GOVERNANCE_LIMITS.maxJsonDepth);
  return read.ok ? { ok: true, value: read.value } : { ok: false, problem: read.problem };
}

const unsupported = (value: unknown, key: string): boolean => {
  const version = (value as Record<string, unknown> | null)?.[key];
  return typeof version === "string" && !(GOVERNANCE_FORMAT_VERSIONS as readonly string[]).includes(version);
};

/** Read one bootstrap from text, bytes or an already parsed value. Closed schema, strict JSON, never throws, never echoes input. */
export function parseBootstrap(input: unknown): BootstrapParseResult {
  try {
    const read = readValue(input, GOVERNANCE_LIMITS.maxBootstrapBytes);
    if (!read.ok) return { ok: false, problem: read.problem, unsupportedVersion: false };
    if (hasForbiddenStructure(read.value)) return { ok: false, problem: "FORBIDDEN_STRUCTURE", unsupportedVersion: false };
    if (unsupported(read.value, "formatVersion")) return { ok: false, problem: "SHAPE", unsupportedVersion: true };
    const parsed = GovernanceBootstrapSchema.safeParse(read.value);
    return parsed.success ? { ok: true, artifact: parsed.data } : { ok: false, problem: "SHAPE", unsupportedVersion: false };
  } catch {
    return { ok: false, problem: "SHAPE", unsupportedVersion: false };
  }
}

/** Read one authorization from text, bytes or an already parsed value. Closed schema, strict JSON, never throws, never echoes input. */
export function parseAuthorization(input: unknown): AuthorizationParseResult {
  try {
    const read = readValue(input, GOVERNANCE_LIMITS.maxAuthorizationBytes);
    if (!read.ok) return { ok: false, problem: read.problem, unsupportedVersion: false };
    if (hasForbiddenStructure(read.value)) return { ok: false, problem: "FORBIDDEN_STRUCTURE", unsupportedVersion: false };
    if (unsupported(read.value, "authorizationVersion")) return { ok: false, problem: "SHAPE", unsupportedVersion: true };
    const parsed = AuthorizationEnvelopeSchema.safeParse(read.value);
    if (!parsed.success) return { ok: false, problem: "SHAPE", unsupportedVersion: false };
    if (parsed.data.authorizationVersion !== parsed.data.statement.authorizationVersion) return { ok: false, problem: "VERSION_MISMATCH", unsupportedVersion: false };
    return { ok: true, envelope: parsed.data };
  } catch {
    return { ok: false, problem: "SHAPE", unsupportedVersion: false };
  }
}
