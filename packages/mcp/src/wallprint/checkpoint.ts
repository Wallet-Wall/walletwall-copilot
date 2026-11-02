import { z } from "zod";
import { evidenceDigest } from "../canonical.ts";
import { hasForbiddenStructure } from "../schemas.ts";
import type { AcceptanceEntry } from "./acceptance-ledger.ts";
import { ATTESTATION_LIMITS, SUPPORTED_ALGORITHMS } from "./attestation-vocabulary.ts";
import { AlgorithmSchema, PublicKeyHexSchema, SignerIdSchema, domainSeparatedPreimage } from "./attestation.ts";
import {
  CHECKPOINT_DOMAIN_TAGS,
  CHECKPOINT_LIMITS,
  CHECKPOINT_PURPOSES,
  CHECKPOINT_TYPE,
  CHECKPOINT_VERSIONS,
  GOVERNANCE_KEY_PURPOSES,
  GOVERNANCE_TRUST_ROOT_FORMAT_VERSION,
  GOVERNANCE_TRUST_ROOT_TYPE,
} from "./checkpoint-vocabulary.ts";
import { ed25519KeyProblem } from "./ed25519.ts";
import { finding, type Finding } from "./errors.ts";
import type { KeyRegistrySnapshot } from "./key-registry.ts";
import { HEX64_RE } from "./record.ts";
import { parseStrictJson } from "./strict-json.ts";

/**
 * The detached WallPrint trust checkpoint: one signed statement that commits a signing-key registry head and an
 * acceptance-ledger head TOGETHER. It exists because the two logs are each hash-chained but unsigned and have no ordering
 * against each other (spec/WALLPRINT_ATTESTATIONS.md, sections 11 and 23). It authenticates which registry state and which
 * ledger prefix were committed as one governance statement. It certifies no claim, no attestation and no assessor.
 *
 * A checkpoint is detached from the WallPrint record and from every attestation: no record, receipt, reference, digest or
 * attestation byte changes. Every field of the statement is signed; the envelope has no unsigned metadata but the signature.
 * The signer's key is never trusted because the checkpoint names it: authorization comes only from a governance trust root the
 * verifier is handed explicitly (checkpoint-verify.ts). This lane ships no root and no production key.
 *
 * Pure: no clock, no I/O, no randomness. Nothing here signs anything.
 */

const Hex64 = z.string().regex(HEX64_RE);
const RegistryVersion = z.string().regex(/^[1-9][0-9]{0,5}$/).refine((v) => Number(v) <= ATTESTATION_LIMITS.maxRegistryVersions);
const EntryCount = z.string().regex(/^(?:0|[1-9][0-9]{0,6})$/).refine((v) => Number(v) <= ATTESTATION_LIMITS.maxLedgerEntries);
const SIGNATURE_HEX_RE = /^(?:[0-9a-f]{2}){1,4096}$/;

/** The registry state a checkpoint commits: how many snapshots (versions are 1..N, so N is both) and the head snapshot's own digest. */
export const RegistryHeadSchema = z.strictObject({ headVersion: RegistryVersion, headDigest: Hex64 });
/** The ledger prefix a checkpoint commits: how many entries and the last committed entry's digest, which is null exactly when there are none. */
export const LedgerHeadSchema = z.strictObject({ entryCount: EntryCount, headDigest: Hex64.nullable() }).refine((l) => (l.entryCount === "0") === (l.headDigest === null));

/** The state a checkpoint commits. Also what a verifier holds as its anchor: the committed state of a checkpoint it already relies on. */
export const CommittedStateSchema = z.strictObject({ registry: RegistryHeadSchema, acceptanceLedger: LedgerHeadSchema });
export type CommittedState = z.infer<typeof CommittedStateSchema>;

export const CheckpointStatementSchema = z.strictObject({
  checkpointVersion: z.enum(CHECKPOINT_VERSIONS),
  purpose: z.enum(CHECKPOINT_PURPOSES),
  signer: z.strictObject({ keyId: SignerIdSchema, algorithm: AlgorithmSchema, publicKey: PublicKeyHexSchema }),
  registry: RegistryHeadSchema,
  acceptanceLedger: LedgerHeadSchema,
});
export type CheckpointStatement = z.infer<typeof CheckpointStatementSchema>;

export const CheckpointEnvelopeSchema = z.strictObject({
  type: z.literal(CHECKPOINT_TYPE),
  checkpointVersion: z.enum(CHECKPOINT_VERSIONS),
  statement: CheckpointStatementSchema,
  signature: z.string().regex(SIGNATURE_HEX_RE),
});
export type CheckpointEnvelope = z.infer<typeof CheckpointEnvelopeSchema>;

/**
 * The exact bytes that are signed: `UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))`, the same construction as an
 * attestation (attestation.ts, `domainSeparatedPreimage`). The statement carries the version, the purpose, the signer's key,
 * both heads and both counts; nothing is signed that the reader cannot see, and a digest is never signed alone.
 */
export const checkpointPreimage = (statement: CheckpointStatement): Uint8Array => domainSeparatedPreimage(CHECKPOINT_DOMAIN_TAGS[statement.purpose], statement);

/** The identity of one checkpoint artifact: SHA-256 over the RFC 8785 form of the envelope (the engine's `evidenceDigest`; no new digest site). Never signed; only an address. */
export const checkpointDigest = (envelope: CheckpointEnvelope): string => evidenceDigest(envelope);

/** The state a (verified) registry chain and acceptance ledger commit as they stand: the number of entries and the last digest of each. A checkpoint is built over this. */
export function committedStateOf(chain: readonly KeyRegistrySnapshot[], ledger: readonly AcceptanceEntry[]): CommittedState {
  return {
    registry: { headVersion: String(chain.length), headDigest: chain[chain.length - 1]?.digest ?? "" },
    acceptanceLedger: { entryCount: String(ledger.length), headDigest: ledger[ledger.length - 1]?.entryDigest ?? null },
  };
}

export type CheckpointParseProblem = "BODY_TOO_LARGE" | "DUPLICATE_KEY" | "FORBIDDEN_STRUCTURE" | "SHAPE" | "SYNTAX" | "TOO_DEEP" | "VERSION_MISMATCH";
export type CheckpointParseResult = { ok: true; envelope: CheckpointEnvelope } | { ok: false; problem: CheckpointParseProblem; unsupportedVersion: boolean };

const refuse = (problem: CheckpointParseProblem, unsupportedVersion = false): CheckpointParseResult => ({ ok: false, problem, unsupportedVersion });
const encoder = new TextEncoder();

/** Read one checkpoint from text, bytes or an already parsed value. Closed schema, strict JSON, never throws, never echoes input. */
export function parseCheckpoint(input: unknown): CheckpointParseResult {
  let value: unknown = input;
  if (typeof input === "string" || input instanceof Uint8Array) {
    let text: string;
    try {
      text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return refuse("SYNTAX");
    }
    if (encoder.encode(text).length > CHECKPOINT_LIMITS.maxEnvelopeBytes) return refuse("BODY_TOO_LARGE");
    const read = parseStrictJson(text, CHECKPOINT_LIMITS.maxJsonDepth);
    if (!read.ok) return refuse(read.problem);
    value = read.value;
  }
  if (hasForbiddenStructure(value)) return refuse("FORBIDDEN_STRUCTURE");
  const version = (value as { checkpointVersion?: unknown } | null)?.checkpointVersion;
  if (typeof version === "string" && !(CHECKPOINT_VERSIONS as readonly string[]).includes(version)) return refuse("SHAPE", true);
  const parsed = CheckpointEnvelopeSchema.safeParse(value);
  if (!parsed.success) return refuse("SHAPE");
  if (parsed.data.checkpointVersion !== parsed.data.statement.checkpointVersion) return refuse("VERSION_MISMATCH");
  return { ok: true, envelope: parsed.data };
}

// ─── the governance trust root ───────────────────────────────────────────────

export const GovernanceKeySchema = z.strictObject({
  keyId: SignerIdSchema,
  algorithm: AlgorithmSchema,
  publicKey: PublicKeyHexSchema,
  purposes: z.array(z.enum(GOVERNANCE_KEY_PURPOSES)).min(1).max(GOVERNANCE_KEY_PURPOSES.length),
});
export type GovernanceKey = z.infer<typeof GovernanceKeySchema>;

/**
 * The explicit set of governance keys a verifier is willing to accept a checkpoint from, and what each is authorized for. It is
 * supplied by the caller, never read from a checkpoint, from the signing-key registry the checkpoint authenticates (that would be
 * circular: whoever controls the registry would authorize their own checkpoint key) or from a default in this repository. It has
 * no status or history: a key stops being accepted when the caller stops supplying it. Production bootstrap, rotation and
 * revocation of governance keys belong to the governance key ceremony lane, which this lane does not perform.
 */
export const GovernanceTrustRootSchema = z.strictObject({
  type: z.literal(GOVERNANCE_TRUST_ROOT_TYPE),
  formatVersion: z.literal(GOVERNANCE_TRUST_ROOT_FORMAT_VERSION),
  keys: z.array(GovernanceKeySchema).min(1).max(CHECKPOINT_LIMITS.maxTrustRootKeys),
});
export type GovernanceTrustRoot = Readonly<z.infer<typeof GovernanceTrustRootSchema>>;

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const strictlyAscending = (list: readonly string[]): boolean => list.every((v, i) => i === 0 || ordinal(list[i - 1] ?? "", v) < 0);

/** Shape and consistency findings for a trust root. Fixed codes; paths are fixed field names and indices. */
export function governanceTrustRootFindings(raw: unknown): Finding[] {
  if (hasForbiddenStructure(raw)) return [finding("FORBIDDEN_STRUCTURE", "")];
  const parsed = GovernanceTrustRootSchema.safeParse(raw);
  if (!parsed.success) return [finding("SHAPE", "")];
  const out: Finding[] = [];
  const root = parsed.data;
  if (!strictlyAscending(root.keys.map((k) => k.keyId))) out.push(finding("KEYS_NOT_ORDERED", "keys"));
  const publicKeys = new Set<string>();
  root.keys.forEach((key, i) => {
    const at = `keys[${i}]`;
    if (publicKeys.has(key.publicKey)) out.push(finding("PUBLIC_KEY_DUPLICATE", `${at}.publicKey`));
    publicKeys.add(key.publicKey);
    if ((SUPPORTED_ALGORITHMS as readonly string[]).includes(key.algorithm) && ed25519KeyProblem(key.publicKey) !== null) out.push(finding("KEY_MATERIAL_INVALID", `${at}.publicKey`));
    if (!strictlyAscending(key.purposes)) out.push(finding("PURPOSES_INVALID", `${at}.purposes`));
  });
  return out;
}

export type GovernanceTrustRootResult = { ok: true; root: GovernanceTrustRoot } | { ok: false; findings: Finding[] };

export function parseGovernanceTrustRoot(raw: unknown): GovernanceTrustRootResult {
  const findings = governanceTrustRootFindings(raw);
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, root: GovernanceTrustRootSchema.parse(raw) };
}
