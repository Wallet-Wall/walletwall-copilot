import { z } from "zod";
import { hasForbiddenStructure } from "../schemas.ts";
import { SignerIdSchema } from "./attestation.ts";
import { deepFreeze } from "./freeze.ts";
import { authorizationDigest, bootstrapDigest, parseAuthorization, parseBootstrap, type AuthorizationEnvelope } from "./governance.ts";
import { scanCeremonyFile, scanCeremonyJson, type SecretFinding } from "./governance-secret-scan.ts";
import {
  BACKUP_MINIMUMS,
  CEREMONY_KINDS,
  CEREMONY_MODES,
  CEREMONY_ROLES,
  CEREMONY_SEQUENCES,
  CHECKLIST_ITEMS,
  EVENT_CHECKLIST,
  GOVERNANCE_FORMAT_VERSIONS,
  GOVERNANCE_LIMITS,
  GOVERNANCE_TRANSCRIPT_TYPE,
  GOVERNANCE_VERIFICATION_VERSION,
  SYNTHETIC_CEREMONY_ID_PREFIX,
  SYNTHETIC_KEY_ID_PREFIX,
  TRANSCRIPT_DOES_NOT_ESTABLISH,
  TRANSCRIPT_ESTABLISHES,
  type CeremonyEvent,
  type CeremonyKind,
  type CeremonyMode,
} from "./governance-vocabulary.ts";
import { HEX64_RE } from "./record.ts";
import { parseStrictJson } from "./strict-json.ts";

/**
 * The ceremony transcript: a structured, closed record of what the participants of a governance key ceremony attest happened, safe to commit
 * publicly when it holds only public data. It is not raw terminal output and cannot carry any: every field is a fixed enumeration, a token, a
 * date, a count, a commit id or a digest, and every digest a transcript records must equal the digest of a public artifact the verifier is
 * also handed, so there is no slot in which a 32-byte secret could sit unchecked.
 *
 * It is evidence for human review, not proof. It records what two participants attest; a compromised machine or a lying participant produces
 * an identical transcript. What makes a key authorized is the root's signature, verified elsewhere; what makes a transcript useful is that it
 * is complete, ordered, attested by both roles, consistent with the public artifacts, and free of secret-looking material.
 *
 * Pure: no clock, no I/O, no randomness. Never throws; no fixed-code reason echoes caller text.
 */

const Token = SignerIdSchema;
const Decimal = z.string().regex(/^(?:0|[1-9][0-9]{0,3})$/);
const Hex64 = z.string().regex(HEX64_RE);
const Hex40 = z.string().regex(/^[0-9a-f]{40}$/);
const Seq = z.string().regex(/^[1-9][0-9]?$/);
const Generation = z.string().regex(/^[1-9][0-9]{0,2}$/);
const Version = z.string().regex(/^[a-z0-9][a-z0-9._+-]{0,31}$/);
const By = z.array(z.enum(CEREMONY_ROLES)).min(1).max(CEREMONY_ROLES.length);
const Attests = z.array(z.enum(CHECKLIST_ITEMS)).max(CHECKLIST_ITEMS.length);

const base = { seq: Seq, by: By, attests: Attests };
const plain = <E extends CeremonyEvent>(event: E) => z.strictObject({ event: z.literal(event), ...base });
const digestRef = z.strictObject({ bootstrapDigest: Hex64 });

export const TranscriptEventSchema = z.discriminatedUnion("event", [
  plain("CEREMONY_OPENED"),
  plain("ROLES_ACKNOWLEDGED"),
  plain("TOOLING_VERIFIED"),
  plain("NETWORK_CONFIRMED_OFFLINE"),
  z.strictObject({ event: z.literal("ROOT_PUBLIC_KEY_RECORDED"), ...base, ref: digestRef }),
  z.strictObject({
    event: z.literal("BACKUP_CREATED"),
    ...base,
    ref: z.strictObject({ mediaCopies: Decimal, mediaLocations: Decimal, passphraseEnvelopes: Decimal, passphraseLocations: Decimal }),
  }),
  z.strictObject({ event: z.literal("BACKUP_RECOVERY_TESTED"), ...base, ref: digestRef }),
  z.strictObject({ event: z.literal("ROOT_KEY_RESTORED"), ...base, ref: digestRef }),
  z.strictObject({ event: z.literal("OPERATIONAL_KEY_AUTHORIZED"), ...base, ref: z.strictObject({ generation: Generation, authorizationDigest: Hex64 }) }),
  plain("WORKING_SECRET_REMOVED"),
  plain("CEREMONY_CLOSED"),
]);
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;

export const CeremonyTranscriptSchema = z.strictObject({
  type: z.literal(GOVERNANCE_TRANSCRIPT_TYPE),
  formatVersion: z.enum(GOVERNANCE_FORMAT_VERSIONS),
  ceremonyId: Token,
  mode: z.enum(CEREMONY_MODES),
  kind: z.enum(CEREMONY_KINDS),
  date: z.string().regex(/^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/),
  sourceCommit: Hex40,
  tooling: z.array(z.strictObject({ name: Token, version: Version, digest: Hex64 })).min(1).max(GOVERNANCE_LIMITS.maxTooling),
  participants: z.array(z.strictObject({ role: z.enum(CEREMONY_ROLES), participantId: Token })).min(2).max(4),
  events: z.array(TranscriptEventSchema).min(1).max(GOVERNANCE_LIMITS.maxTranscriptEvents),
});
export type CeremonyTranscript = z.infer<typeof CeremonyTranscriptSchema>;

export interface ToolingEntry {
  name: string;
  version: string;
  digest: string;
}

export interface TranscriptContext {
  /** The public bootstrap this ceremony produced or restored. Every digest the transcript records for it must equal its digest. */
  bootstrap?: unknown;
  /** The authorizations this ceremony signed, in order. The authorization events must match them one for one. */
  authorizations?: unknown;
  /** The published list of tooling digests (name, version, digest) the transcript's own list must equal. Without it the digests are reported as not cross-checked. */
  expectedTooling?: unknown;
}

export interface TranscriptVerification {
  verificationVersion: string;
  parse: "PARSED" | "MALFORMED" | "UNSUPPORTED_VERSION";
  ceremony: { id: string | null; mode: CeremonyMode | null; kind: CeremonyKind | null };
  structure: { status: "COMPLETE" | "INCOMPLETE" | "NOT_EVALUATED"; reasons: string[] };
  artifacts: { status: "CONSISTENT" | "INCONSISTENT" | "NOT_EVALUATED"; reasons: string[] };
  tooling: { status: "MATCHED" | "MISMATCHED" | "NOT_COMPARED"; reasons: string[] };
  secrets: { status: "CLEAN" | "SUSPECTED"; findings: SecretFinding[] };
  /** Every reason from every dimension, sorted. Empty means no problem was found, which is not a claim that the ceremony happened. */
  reasons: string[];
  limitations: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (list: readonly string[]): string[] => [...new Set(list)].sort(ordinal);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && uniqueSorted(a).join("|") === uniqueSorted(b).join("|") && new Set(a).size === a.length;

const ToolingListSchema = z.array(z.strictObject({ name: Token, version: Version, digest: Hex64 })).max(GOVERNANCE_LIMITS.maxTooling);

const emptyResult = (parse: TranscriptVerification["parse"], secrets: SecretFinding[], mode: CeremonyMode | null = null): TranscriptVerification =>
  deepFreeze({
    verificationVersion: GOVERNANCE_VERIFICATION_VERSION,
    parse,
    ceremony: { id: null, mode, kind: null },
    structure: { status: "NOT_EVALUATED", reasons: [] },
    artifacts: { status: "NOT_EVALUATED", reasons: [] },
    tooling: { status: "NOT_COMPARED", reasons: [] },
    secrets: { status: secrets.length === 0 ? "CLEAN" : "SUSPECTED", findings: secrets },
    reasons: uniqueSorted([parse === "UNSUPPORTED_VERSION" ? "TRANSCRIPT_VERSION_UNSUPPORTED" : "TRANSCRIPT_MALFORMED", ...(secrets.length === 0 ? [] : ["SECRET_MATERIAL_SUSPECTED"])]),
    limitations: [],
    establishes: TRANSCRIPT_ESTABLISHES,
    doesNotEstablish: TRANSCRIPT_DOES_NOT_ESTABLISH,
  });

/** The event names with consecutive authorization events collapsed to one, the form the ceremony sequences are written in. */
const collapsed = (events: readonly CeremonyEvent[]): CeremonyEvent[] => events.filter((e, i) => !(e === "OPERATIONAL_KEY_AUTHORIZED" && events[i - 1] === "OPERATIONAL_KEY_AUTHORIZED"));

function structureReasons(t: CeremonyTranscript): string[] {
  const out: string[] = [];
  if ((t.mode === "SYNTHETIC_REHEARSAL") !== t.ceremonyId.startsWith(SYNTHETIC_CEREMONY_ID_PREFIX)) out.push("CEREMONY_ID_MODE_MISMATCH");

  const operators = t.participants.filter((p) => p.role === "OPERATOR").length;
  const witnesses = t.participants.filter((p) => p.role === "WITNESS").length;
  if (operators !== 1 || witnesses < 1 || new Set(t.participants.map((p) => p.participantId)).size !== t.participants.length) out.push("PARTICIPANTS_INVALID");

  const names = t.events.map((e) => e.event);
  const expected = CEREMONY_SEQUENCES[t.kind];
  if (t.events.some((e, i) => e.seq !== String(i + 1))) out.push("EVENT_ORDER_INVALID");
  if (collapsed(names).join("|") !== expected.join("|")) out.push(expected.every((e) => names.includes(e)) ? "EVENT_ORDER_INVALID" : "EVENT_REQUIRED_MISSING");

  for (const e of t.events) {
    if (!sameSet(e.by, CEREMONY_ROLES)) out.push("ONE_ATTESTER_ONLY");
    if (!sameSet(e.attests, EVENT_CHECKLIST[e.event])) out.push("CHECKLIST_INCOMPLETE");
    if (e.event === "BACKUP_CREATED") {
      const r = e.ref;
      if (
        Number(r.mediaCopies) < BACKUP_MINIMUMS.mediaCopies ||
        Number(r.mediaLocations) < BACKUP_MINIMUMS.mediaLocations ||
        Number(r.passphraseEnvelopes) < BACKUP_MINIMUMS.passphraseEnvelopes ||
        Number(r.passphraseLocations) < BACKUP_MINIMUMS.passphraseLocations
      ) out.push("BACKUP_BELOW_MINIMUM");
    }
  }
  return out;
}

function artifactReasons(t: CeremonyTranscript, context: TranscriptContext): { status: "CONSISTENT" | "INCONSISTENT" | "NOT_EVALUATED"; reasons: string[]; limitations: string[] } {
  const reasons: string[] = [];
  const limitations: string[] = [];
  const keyIds: string[] = [];
  let compared = false;

  if (context.bootstrap === undefined || context.bootstrap === null) limitations.push("ARTIFACTS_NOT_CROSS_CHECKED");
  else {
    compared = true;
    const bootstrap = parseBootstrap(context.bootstrap);
    if (!bootstrap.ok) reasons.push("ARTIFACT_DIGEST_MISMATCH");
    else {
      keyIds.push(bootstrap.artifact.root.keyId);
      const digest = bootstrapDigest(bootstrap.artifact);
      for (const e of t.events) if ((e.event === "ROOT_PUBLIC_KEY_RECORDED" || e.event === "BACKUP_RECOVERY_TESTED" || e.event === "ROOT_KEY_RESTORED") && e.ref.bootstrapDigest !== digest) reasons.push("ARTIFACT_DIGEST_MISMATCH");
    }
  }

  const authorizing = t.events.filter((e): e is Extract<TranscriptEvent, { event: "OPERATIONAL_KEY_AUTHORIZED" }> => e.event === "OPERATIONAL_KEY_AUTHORIZED");
  if (context.authorizations === undefined || context.authorizations === null) {
    if (!limitations.includes("ARTIFACTS_NOT_CROSS_CHECKED")) limitations.push("ARTIFACTS_NOT_CROSS_CHECKED");
  } else {
    compared = true;
    const raw = context.authorizations;
    const parsed = Array.isArray(raw) ? raw.map((r) => parseAuthorization(r)) : [];
    const envelopes = parsed.flatMap((p) => (p.ok ? [p.envelope] : []));
    if (!Array.isArray(raw) || envelopes.length !== parsed.length) reasons.push("ARTIFACT_DIGEST_MISMATCH");
    else {
      const first = envelopes[0];
      if (envelopes.length !== authorizing.length || (first !== undefined && (t.kind === "ROOT_BOOTSTRAP") !== (first.statement.generation === "1"))) reasons.push("OPERATIONAL_KEY_EVENTS_MISMATCH");
      envelopes.forEach((envelope: AuthorizationEnvelope, i) => {
        keyIds.push(envelope.statement.authorizedKey.keyId);
        const event = authorizing[i];
        if (event === undefined) return;
        if (event.ref.generation !== envelope.statement.generation) reasons.push("OPERATIONAL_KEY_EVENTS_MISMATCH");
        if (event.ref.authorizationDigest !== authorizationDigest(envelope)) reasons.push("ARTIFACT_DIGEST_MISMATCH");
      });
    }
  }

  if (keyIds.length > 0) {
    const synthetic = keyIds.filter((k) => k.startsWith(SYNTHETIC_KEY_ID_PREFIX)).length;
    if (t.mode === "SYNTHETIC_REHEARSAL" && synthetic !== keyIds.length) reasons.push("SYNTHETIC_MODE_WITH_NON_SYNTHETIC_KEY");
    if (t.mode === "LIVE" && synthetic > 0) reasons.push("LIVE_MODE_WITH_SYNTHETIC_KEY");
  }
  return { status: !compared ? "NOT_EVALUATED" : reasons.length === 0 ? "CONSISTENT" : "INCONSISTENT", reasons: uniqueSorted(reasons), limitations };
}

function toolingReasons(t: CeremonyTranscript, raw: unknown): { status: "MATCHED" | "MISMATCHED" | "NOT_COMPARED"; reasons: string[] } {
  if (raw === undefined || raw === null) return { status: "NOT_COMPARED", reasons: [] };
  const expected = ToolingListSchema.safeParse(raw);
  if (!expected.success) return { status: "MISMATCHED", reasons: ["TOOLING_MISMATCH"] };
  const key = (x: ToolingEntry): string => `${x.name}|${x.version}|${x.digest}`;
  return sameSet(t.tooling.map(key), expected.data.map(key)) ? { status: "MATCHED", reasons: [] } : { status: "MISMATCHED", reasons: ["TOOLING_MISMATCH"] };
}

const contextOf = (raw: unknown): TranscriptContext => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {});

/** Read the input as text-or-value and scan it for secret-looking material BEFORE any schema decides anything, so a refused transcript still reports a secret in it. */
function scanInput(input: unknown): { value: unknown; findings: SecretFinding[] } {
  if (typeof input === "string" || input instanceof Uint8Array) {
    let text: string;
    try {
      text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return { value: undefined, findings: [] };
    }
    if (new TextEncoder().encode(text).length > GOVERNANCE_LIMITS.maxTranscriptBytes) return { value: undefined, findings: [] };
    const read = parseStrictJson(text, GOVERNANCE_LIMITS.maxJsonDepth);
    return { value: read.ok ? read.value : undefined, findings: scanCeremonyFile("transcript.json", text) };
  }
  return { value: input, findings: hasForbiddenStructure(input) ? [] : scanCeremonyJson(input) };
}

/**
 * Check a completed ceremony transcript: closed schema, ordered events for its kind, both roles attesting every event, the exact checklist
 * for every event, the backup floor, a mode that agrees with the keys, digests that equal the supplied public artifacts', and no
 * secret-looking material anywhere. Never throws.
 */
export function verifyCeremonyTranscript(input: unknown, rawContext?: unknown): TranscriptVerification {
  try {
    const context = contextOf(rawContext);
    const { value, findings } = scanInput(input);
    if (value === undefined || hasForbiddenStructure(value)) return emptyResult("MALFORMED", findings);
    const version = (value as Record<string, unknown> | null)?.["formatVersion"];
    if (typeof version === "string" && !(GOVERNANCE_FORMAT_VERSIONS as readonly string[]).includes(version)) return emptyResult("UNSUPPORTED_VERSION", findings);
    const parsed = CeremonyTranscriptSchema.safeParse(value);
    if (!parsed.success) return emptyResult("MALFORMED", findings);
    const t = parsed.data;

    const structure = structureReasons(t);
    const artifacts = artifactReasons(t, context);
    const tooling = toolingReasons(t, context.expectedTooling);
    const limitations = [...artifacts.limitations, ...(tooling.status === "NOT_COMPARED" ? ["TOOLING_NOT_CROSS_CHECKED"] : [])];
    const secrets: TranscriptVerification["secrets"] = { status: findings.length === 0 ? "CLEAN" : "SUSPECTED", findings };

    return deepFreeze({
      verificationVersion: GOVERNANCE_VERIFICATION_VERSION,
      parse: "PARSED",
      ceremony: { id: t.ceremonyId, mode: t.mode, kind: t.kind },
      structure: { status: structure.length === 0 ? "COMPLETE" : "INCOMPLETE", reasons: uniqueSorted(structure) },
      artifacts: { status: artifacts.status, reasons: artifacts.reasons },
      tooling,
      secrets,
      reasons: uniqueSorted([...structure, ...artifacts.reasons, ...tooling.reasons, ...(findings.length === 0 ? [] : ["SECRET_MATERIAL_SUSPECTED"])]),
      limitations: uniqueSorted(limitations),
      establishes: TRANSCRIPT_ESTABLISHES,
      doesNotEstablish: TRANSCRIPT_DOES_NOT_ESTABLISH,
    });
  } catch {
    return emptyResult("MALFORMED", []);
  }
}
