import { z } from "zod";
import { DOES_NOT_ESTABLISH } from "../readiness.ts";
import { SAFE_TEXT_RE, hasForbiddenStructure } from "../schemas.ts";
import { WallPrintError } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { HEX64_RE, RECORD_ID_RE, validateWallPrintRecord, wallPrintDigest } from "./record.ts";
import { WALLPRINT_CANONICALIZATION, WALLPRINT_DIGEST_ALGORITHM, WALLPRINT_VERSION } from "./vocabulary.ts";

/**
 * Receipt boundary.
 *
 *   WallPrint = the disclosure record.
 *   Receipt   = proof that a disclosed canonical record matches its committed bytes.
 *
 * A receipt exposes only what a later Receipt lane needs: the record id, the canonicalization identifier, the digest
 * algorithm, the digest, the evidence bundle digest and the versions in force. No signature system exists in this
 * lane; a receipt is not a signature and names no signer.
 *
 *   receipt integrity != factual truth
 */

export const RECEIPT_ESTABLISHES = "The disclosed canonical record matches its committed bytes.";

/** What a matching receipt does NOT establish. Extends the engine's readiness non-claims with the disclosure ones. */
export const RECEIPT_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "factual truth",
  ...DOES_NOT_ESTABLISH,
  "safety",
  "issuer endorsement",
]);

const Hex64 = z.string().regex(HEX64_RE);
const SafeText64 = z.string().regex(SAFE_TEXT_RE).max(64);

export const WallPrintReceiptSchema = z.strictObject({
  wallprintVersion: z.literal(WALLPRINT_VERSION),
  recordId: z.string().regex(RECORD_ID_RE),
  canonicalization: z.literal(WALLPRINT_CANONICALIZATION),
  digestAlgorithm: z.literal(WALLPRINT_DIGEST_ALGORITHM),
  digest: Hex64,
  bundleDigest: Hex64,
  versions: z.strictObject({ wwep: SafeText64, registry: SafeText64, policies: SafeText64, rules: SafeText64 }),
});
export type WallPrintReceipt = Readonly<z.infer<typeof WallPrintReceiptSchema>>;

/** Why a receipt does not prove a record's bytes, in the order verifyReceipt reports them (sorted). A closed list. */
export const RECEIPT_REASONS = ["BUNDLE_DIGEST_MISMATCH", "DIGEST_MISMATCH", "RECEIPT_INVALID", "RECORD_ID_MISMATCH", "RECORD_INVALID", "VERSION_MISMATCH"] as const;
export type ReceiptReason = (typeof RECEIPT_REASONS)[number];

export interface ReceiptVerification {
  /** Byte integrity only. */
  matches: boolean;
  reasons: ReceiptReason[];
}

/** Issue the receipt for a valid record. Throws WallPrintError("INVALID_RECORD") otherwise. */
export function wallPrintReceipt(raw: unknown): WallPrintReceipt {
  const v = validateWallPrintRecord(raw);
  if (!v.ok) throw new WallPrintError("INVALID_RECORD", v.findings);
  const r = v.record;
  return deepFreeze({
    wallprintVersion: WALLPRINT_VERSION,
    recordId: r.id,
    canonicalization: WALLPRINT_CANONICALIZATION,
    digestAlgorithm: WALLPRINT_DIGEST_ALGORITHM,
    digest: r.digest,
    bundleDigest: r.evidence.bundleDigest,
    versions: { wwep: r.versions.wwep, registry: r.versions.registry, policies: r.versions.policies, rules: r.versions.rules },
  });
}

/** Does this receipt prove this record's bytes? Never throws. */
export function verifyReceipt(rawReceipt: unknown, rawRecord: unknown): ReceiptVerification {
  if (hasForbiddenStructure(rawReceipt)) return { matches: false, reasons: ["RECEIPT_INVALID"] };
  const receipt = WallPrintReceiptSchema.safeParse(rawReceipt);
  if (!receipt.success) return { matches: false, reasons: ["RECEIPT_INVALID"] };
  const record = validateWallPrintRecord(rawRecord);
  if (!record.ok) return { matches: false, reasons: ["RECORD_INVALID"] };
  const r = record.record;
  const reasons: ReceiptReason[] = [];
  if (receipt.data.recordId !== r.id) reasons.push("RECORD_ID_MISMATCH");
  if (receipt.data.digest !== r.digest || receipt.data.digest !== wallPrintDigest(r)) reasons.push("DIGEST_MISMATCH");
  if (receipt.data.bundleDigest !== r.evidence.bundleDigest) reasons.push("BUNDLE_DIGEST_MISMATCH");
  const v = receipt.data.versions;
  if (v.wwep !== r.versions.wwep || v.registry !== r.versions.registry || v.policies !== r.versions.policies || v.rules !== r.versions.rules) reasons.push("VERSION_MISMATCH");
  reasons.sort();
  return { matches: reasons.length === 0, reasons };
}
