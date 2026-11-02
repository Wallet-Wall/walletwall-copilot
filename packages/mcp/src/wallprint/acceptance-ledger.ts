import { z } from "zod";
import { evidenceDigest } from "../canonical.ts";
import { hasForbiddenStructure } from "../schemas.ts";
import { ATTESTATION_LIMITS } from "./attestation-vocabulary.ts";
import { finding, type Finding } from "./errors.ts";
import { HEX64_RE } from "./record.ts";

/**
 * The acceptance ledger: an append-only, hash-chained list that records, for each attestation the store accepted, the
 * attestation's digest and the key registry version and digest it was judged under. It is what turns "the version the
 * store says it used" into a record bound to one attestation, in a sequence a rewrite has to break.
 *
 *   - An entry names the attestation by digest, so a pin cannot be presented for an attestation it was not recorded for.
 *   - Entries chain by digest, so an edit, a reorder or a drop breaks every later entry.
 *   - Registry versions never decrease along the ledger, so an entry cannot be back-dated past an earlier one without
 *     re-chaining what follows, which a verifier holding a later head (`anchor`) detects.
 *   - An attestation is accepted at most once.
 *
 * What it does not do: nothing signs it. A party that controls the store can still write a whole new ledger, and can append
 * entries after any anchor, so the ledger's authenticity rests on the channel it arrives over and on an anchor the verifier
 * already holds (spec/WALLPRINT_ATTESTATIONS.md, sections 11 and 16). The verifier must read it from the same trusted
 * channel as the key registry, never from whoever presents the attestation.
 *
 * Pure: no clock, no I/O. There is no instant in an entry: order is the sequence number.
 */

const Hex64 = z.string().regex(HEX64_RE);
const Version = z.string().regex(/^[1-9][0-9]{0,5}$/);
const Seq = z.string().regex(/^[1-9][0-9]{0,6}$/);

export const AcceptanceEntrySchema = z.strictObject({
  seq: Seq,
  attestationDigest: Hex64,
  acceptedUnder: z.strictObject({ keyRegistryVersion: Version, keyRegistryDigest: Hex64 }),
  previousEntryDigest: Hex64.nullable(),
  entryDigest: Hex64,
});
export type AcceptanceEntry = Readonly<z.infer<typeof AcceptanceEntrySchema>>;

/** SHA-256 over the RFC 8785 form of an entry without its own `entryDigest` (the engine's `evidenceDigest`). */
export function acceptanceEntryDigest(entry: Omit<AcceptanceEntry, "entryDigest"> | AcceptanceEntry): string {
  const { entryDigest: _entryDigest, ...rest } = entry as AcceptanceEntry;
  return evidenceDigest(rest);
}

export type AcceptanceLedgerResult = { ok: true; entries: readonly AcceptanceEntry[] } | { ok: false; findings: Finding[] };

/** Verify a whole ledger, entries 1..N in order. A ledger that fails is not read: no pin is taken from it. */
export function verifyAcceptanceLedger(raw: unknown): AcceptanceLedgerResult {
  if (!Array.isArray(raw) || raw.length > ATTESTATION_LIMITS.maxLedgerEntries) return { ok: false, findings: [finding("LEDGER_SHAPE", "")] };
  // Entry by entry: the structure guard caps the nodes of one value, and a whole ledger of a few thousand entries would exceed it.
  if (raw.some((item: unknown) => hasForbiddenStructure(item))) return { ok: false, findings: [finding("FORBIDDEN_STRUCTURE", "")] };
  const findings: Finding[] = [];
  const entries: AcceptanceEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, i) => {
    const parsed = AcceptanceEntrySchema.safeParse(item);
    if (!parsed.success) {
      findings.push(finding("SHAPE", `entries[${i}]`));
      return;
    }
    const e = parsed.data;
    const prev = entries[i - 1];
    if (e.seq !== String(i + 1)) findings.push(finding("SEQUENCE", `entries[${i}].seq`));
    if (e.previousEntryDigest !== (prev?.entryDigest ?? null)) findings.push(finding("PREVIOUS_MISMATCH", `entries[${i}].previousEntryDigest`));
    if (e.entryDigest !== acceptanceEntryDigest(e)) findings.push(finding("DIGEST_MISMATCH", `entries[${i}].entryDigest`));
    if (prev !== undefined && Number(e.acceptedUnder.keyRegistryVersion) < Number(prev.acceptedUnder.keyRegistryVersion)) findings.push(finding("VERSION_DECREASED", `entries[${i}].acceptedUnder`));
    if (seen.has(e.attestationDigest)) findings.push(finding("ACCEPTED_TWICE", `entries[${i}].attestationDigest`));
    seen.add(e.attestationDigest);
    entries.push(e);
  });
  return findings.length === 0 && entries.length === raw.length ? { ok: true, entries } : { ok: false, findings };
}

/** The one entry that names this attestation, or null. */
export const acceptanceFor = (entries: readonly AcceptanceEntry[], attestationDigest: string): AcceptanceEntry | null => entries.find((e) => e.attestationDigest === attestationDigest) ?? null;
