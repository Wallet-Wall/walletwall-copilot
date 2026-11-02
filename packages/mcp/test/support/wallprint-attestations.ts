import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { canonicalize } from "../../src/canonical.ts";
import { attestationDigest, attestationPreimage, assessmentTarget, parseAttestation, recordTarget, type AttestationEnvelope, type AttestationStatement, type AttestationTarget } from "../../src/wallprint/attestation.ts";
import { acceptanceEntryDigest, type AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import type { AttestationPurpose } from "../../src/wallprint/attestation-vocabulary.ts";
import { verifyAttestation, verifyAttestations, type AcceptancePin, type AttestationVerification, type VerificationContext } from "../../src/wallprint/attestation-verify.ts";
import { keyRegistryDigest, type KeyRegistrySnapshot, type RegisteredKey, type RegisteredSigner } from "../../src/wallprint/key-registry.ts";
import { buildWallPrintSnapshot, type AssessmentRecord, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { baseInput, issuerAssessment, reviewerAssessment } from "../wallprint/support.ts";

/**
 * Synthetic WallPrint attestation fixtures. EVERY KEY HERE IS A TEST KEY: its private seed is a public ASCII label
 * ("SYNTHETIC-NON-PRODUCTION-KEY-001"), so anyone can sign as it and it speaks for nobody. Signing exists only in this
 * test support; the engine modules (packages/mcp/src) hold no signing code and no private key.
 */

export const SYNTHETIC_NOTICE = "SYNTHETIC NON-PRODUCTION FIXTURE. Every key here derives from a public ASCII seed and speaks for nobody. Do not trust, import, register or publish these keys.";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX_LENGTH = 12;

export const seedLabel = (n: number): string => `SYNTHETIC-NON-PRODUCTION-KEY-${String(n).padStart(3, "0")}`;

export interface SyntheticKey {
  n: number;
  seedLabel: string;
  publicKey: string;
  privateKey: KeyObject;
}

const keys = new Map<number, SyntheticKey>();
export function syntheticKey(n: number): SyntheticKey {
  const cached = keys.get(n);
  if (cached !== undefined) return cached;
  const label = seedLabel(n);
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(label, "utf8")]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX_LENGTH).toString("hex");
  const made = { n, seedLabel: label, publicKey, privateKey };
  keys.set(n, made);
  return made;
}

export interface Signer {
  signerId: string;
  keyId: string;
  n: number;
}

export function statementFor(purpose: AttestationPurpose, who: Signer, target: AttestationTarget, over: { algorithm?: string } = {}): AttestationStatement {
  return { attestationVersion: "0.1", purpose, signer: { signerId: who.signerId, keyId: who.keyId, algorithm: over.algorithm ?? "ED25519", publicKey: syntheticKey(who.n).publicKey }, target };
}

export function envelopeFor(statement: AttestationStatement, signature: string): AttestationEnvelope {
  return { type: "walletwall.wallprint.attestation", attestationVersion: statement.attestationVersion, statement, signature };
}

/** Sign a statement's exact preimage with a synthetic key. The only signing in the repository. */
export function signStatement(statement: AttestationStatement, n: number): AttestationEnvelope {
  return envelopeFor(statement, sign(null, attestationPreimage(statement), syntheticKey(n).privateKey).toString("hex"));
}

export function attest(purpose: AttestationPurpose, who: Signer, target: AttestationTarget): AttestationEnvelope {
  return signStatement(statementFor(purpose, who, target), who.n);
}

// ─── the synthetic signers ───────────────────────────────────────────────────

export const WHO = {
  publisher1: { signerId: "synthetic-publisher", keyId: "synthetic-publisher-1", n: 1 },
  publisher2: { signerId: "synthetic-publisher", keyId: "synthetic-publisher-2", n: 2 },
  circle1: { signerId: "synthetic-issuer-circle", keyId: "synthetic-issuer-circle-1", n: 3 },
  circle2: { signerId: "synthetic-issuer-circle", keyId: "synthetic-issuer-circle-2", n: 9 },
  tether1: { signerId: "synthetic-issuer-tether", keyId: "synthetic-issuer-tether-1", n: 4 },
  reviewerY1: { signerId: "synthetic-reviewer-y", keyId: "synthetic-reviewer-y-1", n: 5 },
  reviewerY2: { signerId: "synthetic-reviewer-y", keyId: "synthetic-reviewer-y-2", n: 10 },
  reviewerW1: { signerId: "synthetic-reviewer-w", keyId: "synthetic-reviewer-w-1", n: 6 },
  reviewerR1: { signerId: "synthetic-reviewer-r", keyId: "synthetic-reviewer-r-1", n: 11 },
  future1: { signerId: "synthetic-future", keyId: "synthetic-future-1", n: 12 },
  unregistered: { signerId: "synthetic-reviewer-y", keyId: "synthetic-unregistered-1", n: 8 },
  lookalike: { signerId: "synthetic-circle", keyId: "synthetic-circle-label", n: 8 },
} as const satisfies Record<string, Signer>;

interface KeySpec {
  who: Signer;
  purposes: AttestationPurpose[];
  addedIn: number;
  algorithm?: string;
  timeline?: { from: number; status: RegisteredKey["status"]; successor?: string; retainedBefore?: number | null }[];
}
interface SignerSpec {
  signerId: string;
  kind: RegisteredSigner["kind"];
  authorityId: string | null;
  assessorIds: string[];
  binding: RegisteredSigner["binding"];
  keys: KeySpec[];
}

const GOVERNANCE = { method: "GOVERNANCE_DECLARATION", publisher: "WalletWall governance synthetic", url: null, locator: null, retrievedAt: null } as const;
const published = (method: "ISSUER_PUBLICATION" | "ASSESSOR_PUBLICATION", publisher: string): RegisteredSigner["binding"] => ({ method, publisher, url: "https://example.invalid/synthetic/keys", locator: "Synthetic fixture row", retrievedAt: "2026-10-24" });

const ROSTER: SignerSpec[] = [
  { signerId: "synthetic-publisher", kind: "WALLETWALL_PUBLISHER", authorityId: null, assessorIds: [], binding: GOVERNANCE, keys: [
    { who: WHO.publisher1, purposes: ["RECORD_PUBLICATION"], addedIn: 1, timeline: [{ from: 2, status: "SUPERSEDED", successor: "synthetic-publisher-2" }] },
    { who: WHO.publisher2, purposes: ["RECORD_PUBLICATION"], addedIn: 2 },
  ] },
  { signerId: "synthetic-issuer-circle", kind: "ISSUER_AUTHORITY", authorityId: "issuer:circle", assessorIds: ["issuer:circle"], binding: published("ISSUER_PUBLICATION", "Circle synthetic"), keys: [
    { who: WHO.circle1, purposes: ["ISSUER_ASSESSMENT_ORIGIN"], addedIn: 1, timeline: [{ from: 4, status: "COMPROMISED", retainedBefore: 3 }] },
    { who: WHO.circle2, purposes: ["ISSUER_ASSESSMENT_ORIGIN"], addedIn: 3 },
  ] },
  { signerId: "synthetic-issuer-tether", kind: "ISSUER_AUTHORITY", authorityId: "issuer:tether", assessorIds: ["issuer:tether"], binding: published("ISSUER_PUBLICATION", "Tether synthetic"), keys: [
    { who: WHO.tether1, purposes: ["ISSUER_ASSESSMENT_ORIGIN"], addedIn: 1 },
  ] },
  { signerId: "synthetic-reviewer-y", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["reviewer-y"], binding: published("ASSESSOR_PUBLICATION", "Reviewer Y synthetic"), keys: [
    { who: WHO.reviewerY1, purposes: ["ASSESSMENT_ORIGIN"], addedIn: 1, timeline: [{ from: 3, status: "SUPERSEDED", successor: "synthetic-reviewer-y-2" }] },
    { who: WHO.reviewerY2, purposes: ["ASSESSMENT_ORIGIN"], addedIn: 3 },
  ] },
  { signerId: "synthetic-reviewer-w", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["reviewer-w"], binding: published("ASSESSOR_PUBLICATION", "Reviewer W synthetic"), keys: [
    { who: WHO.reviewerW1, purposes: ["ASSESSMENT_ORIGIN"], addedIn: 1, timeline: [{ from: 3, status: "REVOKED", retainedBefore: 3 }, { from: 4, status: "COMPROMISED", retainedBefore: 2 }] },
  ] },
  { signerId: "synthetic-reviewer-r", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["reviewer-r"], binding: published("ASSESSOR_PUBLICATION", "Reviewer R synthetic"), keys: [
    { who: WHO.reviewerR1, purposes: ["ASSESSMENT_ORIGIN"], addedIn: 1, timeline: [{ from: 3, status: "RETIRED" }] },
  ] },
  { signerId: "synthetic-future", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["future-q"], binding: published("ASSESSOR_PUBLICATION", "Future Q synthetic"), keys: [
    { who: WHO.future1, purposes: ["ASSESSMENT_ORIGIN"], addedIn: 1, algorithm: "ML_DSA_65" },
  ] },
];

export const REGISTRY_HEAD = 4;

function keyAt(spec: KeySpec, version: number): RegisteredKey | null {
  if (version < spec.addedIn) return null;
  const event = [...(spec.timeline ?? [])].reverse().find((e) => e.from <= version);
  return {
    keyId: spec.who.keyId,
    algorithm: spec.algorithm ?? "ED25519",
    publicKey: syntheticKey(spec.who.n).publicKey,
    purposes: spec.purposes,
    status: event?.status ?? "ACTIVE",
    addedIn: String(spec.addedIn),
    statusFrom: String(event?.from ?? spec.addedIn),
    successor: event?.successor ?? null,
    retainedBefore: event?.retainedBefore === undefined || event.retainedBefore === null ? null : String(event.retainedBefore),
  };
}

const chains = new Map<number, KeyRegistrySnapshot[]>();
export function registryChain(through = REGISTRY_HEAD): KeyRegistrySnapshot[] {
  const cached = chains.get(through);
  if (cached !== undefined) return cached;
  const chain = buildChain(through);
  chains.set(through, chain);
  return chain;
}

function buildChain(through: number): KeyRegistrySnapshot[] {
  const chain: KeyRegistrySnapshot[] = [];
  for (let version = 1; version <= through; version++) {
    const signers: RegisteredSigner[] = ROSTER.map((s) => ({
      signerId: s.signerId,
      kind: s.kind,
      authorityId: s.authorityId,
      assessorIds: s.assessorIds,
      binding: s.binding,
      keys: s.keys.map((k) => keyAt(k, version)).filter((k): k is RegisteredKey => k !== null).sort((a, b) => (a.keyId < b.keyId ? -1 : 1)),
    })).filter((s) => s.keys.length > 0).sort((a, b) => (a.signerId < b.signerId ? -1 : 1));
    const prev = chain[version - 2];
    const body = { type: "walletwall.wallprint.key-registry" as const, formatVersion: "0.1" as const, keyRegistryVersion: String(version), previous: prev === undefined ? null : { version: prev.keyRegistryVersion, digest: prev.digest }, signers };
    chain.push({ ...body, digest: keyRegistryDigest({ ...body, digest: "" }) });
  }
  return chain;
}

export const pinOf = (chain: readonly KeyRegistrySnapshot[], version: number): AcceptancePin => ({ keyRegistryVersion: String(version), keyRegistryDigest: chain[version - 1]?.digest ?? "" });

/** An acceptance ledger of the given acceptances, in order: each entry chained to the one before. */
export function ledgerOf(accepted: readonly { digest: string; pin: AcceptancePin }[]): AcceptanceEntry[] {
  const out: AcceptanceEntry[] = [];
  accepted.forEach((a, i) => {
    const body = { seq: String(i + 1), attestationDigest: a.digest, acceptedUnder: a.pin, previousEntryDigest: out[i - 1]?.entryDigest ?? null };
    out.push({ ...body, entryDigest: acceptanceEntryDigest({ ...body, entryDigest: "" }) });
  });
  return out;
}
export const ledgerAnchor = (ledger: readonly AcceptanceEntry[]): { seq: string; digest: string } => ({ seq: String(ledger.length), digest: ledger[ledger.length - 1]?.entryDigest ?? "" });
export const digestOfEnvelope = (envelope: unknown): string => {
  const parsed = parseAttestation(envelope);
  return parsed.ok ? attestationDigest(parsed.envelope) : "0".repeat(64);
};
/** The one-entry ledger a vector carries (or two, with a filler first when the entry lies after the caller's anchor), or null when the vector has no acceptance record. */
export function vectorLedger(spec: { envelope: unknown; acceptedUnder: number | null; pinDigestOf?: number; afterAnchor?: boolean }, chain: readonly KeyRegistrySnapshot[]): AcceptanceEntry[] | null {
  if (spec.acceptedUnder === null) return null;
  const pin = { ...pinOf(chain, spec.acceptedUnder), ...(spec.pinDigestOf === undefined ? {} : { keyRegistryDigest: pinOf(chain, spec.pinDigestOf).keyRegistryDigest }) };
  const filler = spec.afterAnchor === true ? [{ digest: "ab".repeat(32), pin: pinOf(chain, 1) }] : [];
  return ledgerOf([...filler, { digest: digestOfEnvelope(spec.envelope), pin }]);
}
/** The anchor a vector's verifier holds: the ledger's last entry, or the filler before the vector's own entry. */
export const vectorLedgerAnchor = (spec: { afterAnchor?: boolean }, ledger: readonly AcceptanceEntry[]): { seq: string; digest: string } =>
  spec.afterAnchor === true ? { seq: "1", digest: ledger[0]?.entryDigest ?? "" } : ledgerAnchor(ledger);
export const anchorOf = (chain: readonly KeyRegistrySnapshot[]): { version: string; digest: string } => {
  const head = chain[chain.length - 1];
  return { version: head?.keyRegistryVersion ?? "", digest: head?.digest ?? "" };
};

// ─── the synthetic records ───────────────────────────────────────────────────

const extra = (assessor: string, role: "INDEPENDENT_REVIEWER" | "OTHER", assessment: string): ReturnType<typeof reviewerAssessment> =>
  reviewerAssessment({ assessor, assessorRole: role, assessment, policy: `${assessor}-review`, statement: `Synthetic statement by ${assessor}.` });

const records = new Map<string, WallPrintRecord>();
export function goldenRecord(over: { id?: string; policy?: string } = {}): WallPrintRecord {
  const cacheKey = `${over.id ?? ""}|${over.policy ?? ""}`;
  const cached = records.get(cacheKey);
  if (cached !== undefined) return cached;
  const built = buildGolden(over);
  records.set(cacheKey, built);
  return built;
}

function buildGolden(over: { id?: string; policy?: string }): WallPrintRecord {
  const reviewer = reviewerAssessment({ assessment: "SUPPORTED", statement: "Synthetic statement by reviewer-y.", ...(over.policy === undefined ? {} : { policy: over.policy }) });
  return buildWallPrintSnapshot(
    baseInput({
      id: over.id ?? "wp-attest-golden",
      assessments: [issuerAssessment(), reviewer, extra("reviewer-w", "INDEPENDENT_REVIEWER", "SUPPORTED"), extra("reviewer-r", "OTHER", "CONFIRMED"), extra("future-q", "OTHER", "SUPPORTED")],
    }),
  );
}

export const assessmentOf = (record: WallPrintRecord, assessor: string): AssessmentRecord => {
  const found = record.assessments.find((a) => a.assessor === assessor);
  if (found === undefined) throw new Error("fixture assessor missing");
  return found;
};
export const assessmentTargetOf = (record: WallPrintRecord, assessor: string): ReturnType<typeof assessmentTarget> => assessmentTarget(record, assessmentOf(record, assessor));
export { recordTarget, canonicalize };

// ─── the vectors ─────────────────────────────────────────────────────────────

export interface VectorSpec {
  id: string;
  description: string;
  envelope: unknown;
  record: "golden" | "other" | "renamed-policy" | null;
  acceptedUnder: number | null;
  /** The pin names `acceptedUnder` but carries the digest of this other version: a substituted registry. */
  pinDigestOf?: number;
  /** The entry lies after the ledger prefix the verifier holds an anchor for. */
  afterAnchor?: boolean;
  anchored: boolean;
  expect: Partial<Pick<AttestationVerification, "origin" | "originBasis" | "parse">> & { signature?: AttestationVerification["signature"]["status"]; target?: AttestationVerification["target"]["status"] };
}

export function flipLast(hex: string): string {
  const last = hex.slice(-1);
  return hex.slice(0, -1) + (last === "0" ? "1" : "0");
}

export function vectorSpecs(): VectorSpec[] {
  const golden = goldenRecord();
  const target = (assessor: string) => assessmentTargetOf(golden, assessor);
  const recT = recordTarget(golden);
  const publication = attest("RECORD_PUBLICATION", WHO.publisher2, recT);
  const reviewerT = target("reviewer-y");
  const circleT = target("issuer:circle");
  const out: VectorSpec[] = [];
  const add = (id: string, description: string, envelope: unknown, record: VectorSpec["record"], acceptedUnder: number | null, expect: VectorSpec["expect"], anchored = true, pinDigestOf?: number, afterAnchor = false): void => {
    out.push({ id, description, envelope, record, acceptedUnder, anchored, expect, ...(pinDigestOf === undefined ? {} : { pinDigestOf }), ...(afterAnchor ? { afterAnchor } : {}) });
  };

  add("01-walletwall-publication-valid", "valid signer, valid signature, purpose authorized: a WalletWall publication key signed this exact record digest, accepted under registry version 2", publication, "golden", 2, { signature: "VALID", target: "MATCHED", origin: "BOUND_WALLETWALL_PUBLISHER", originBasis: "ACCEPTANCE" });
  add("02-valid-signature-unknown-key", "valid signature from a key the registry does not know: this key signed an assessment claiming reviewer-y, nothing more", attest("ASSESSMENT_ORIGIN", WHO.unregistered, reviewerT), "golden", null, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("03-known-key-wrong-purpose", "a registered WalletWall publication key signs an assessment-origin statement: known key, purpose not granted, not an assessor", attest("ASSESSMENT_ORIGIN", WHO.publisher2, reviewerT), "golden", 2, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("04-issuer-key-bound-to-another-issuer", "an issuer key bound to issuer:tether signs the issuer:circle assessment", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.tether1, circleT), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  const bad = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT);
  add("05-invalid-signature", "one bit of the signature flipped", { ...bad, signature: flipLast(bad.signature) }, "golden", 3, { signature: "INVALID", origin: "NONE", originBasis: "NONE" });
  const other = goldenRecord({ id: "wp-attest-other" });
  add("06-target-digest-mismatch", "a valid publication attestation for a different record, presented with the golden record", attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(other)), "golden", 2, { signature: "VALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  const future = statementFor("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT, { algorithm: "ML_DSA_65" });
  add("07a-algorithm-unsupported", "the statement names an algorithm this verifier does not support: not checked, never valid and never invalid", envelopeOf(future, "00".repeat(64)), "golden", 3, { signature: "NOT_CHECKED", origin: "NONE", originBasis: "NONE" });
  add("07b-algorithm-differs-from-registry", "an Ed25519 statement under a key id the registry holds as ML_DSA_65: algorithm confusion, the registered key is not this key", attest("ASSESSMENT_ORIGIN", WHO.future1, target("future-q")), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("08a-malformed-signature-length", "a signature of the wrong length", { ...bad, signature: bad.signature.slice(0, 126) }, "golden", 3, { signature: "INVALID", origin: "NONE", originBasis: "NONE" });
  add("08b-malformed-signature-not-hex", "a signature that is not lower-case hexadecimal is not an attestation", { ...bad, signature: "Z".repeat(128) }, "golden", 3, { parse: "MALFORMED", origin: "NONE", originBasis: "NONE" });
  add("09a-retired-key-before-retirement", "a key retired in version 3, attestation accepted under version 1: the historical decision stands", attest("ASSESSMENT_ORIGIN", WHO.reviewerR1, target("reviewer-r")), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE" });
  add("09b-retired-key-accepted-after-retirement", "the same key, accepted under version 3, when it was already retired: it was not authorized then", attest("ASSESSMENT_ORIGIN", WHO.reviewerR1, target("reviewer-r")), "golden", 3, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("09c-retired-key-entry-after-the-held-anchor", "a key now retired, with a ledger entry naming an old registry version but lying after the ledger prefix the verifier holds an anchor for: the entry could have been written after the retirement", attest("ASSESSMENT_ORIGIN", WHO.reviewerR1, target("reviewer-r")), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" }, true, undefined, true);
  add("10a-compromised-inside-retained-window", "a key revoked then found compromised; accepted under version 1, inside the window the registry retained (before version 2)", attest("ASSESSMENT_ORIGIN", WHO.reviewerW1, target("reviewer-w")), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE" });
  add("10b-compromised-outside-retained-window", "the same key accepted under version 2, outside the retained window: standing withdrawn, the signature is still valid", attest("ASSESSMENT_ORIGIN", WHO.reviewerW1, target("reviewer-w")), "golden", 2, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("10c-compromised-issuer-key-at-the-boundary", "an issuer key compromised in version 4 with nothing retained from version 3 on, accepted under version 3", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.circle1, circleT), "golden", 3, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("10d-compromised-issuer-key-retained", "the same issuer key accepted under version 1, before the retained boundary", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.circle1, circleT), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "BOUND_ISSUER_AUTHORITY", originBasis: "ACCEPTANCE" });
  add("10e-withdrawn-key-no-acceptance-record", "a key now compromised, presented with no acceptance record: nothing shows it predates the compromise", attest("ASSESSMENT_ORIGIN", WHO.reviewerW1, target("reviewer-w")), "golden", null, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("10f-withdrawn-key-entry-after-the-held-anchor", "a key now compromised, with a ledger entry naming an old registry version but lying after the ledger prefix the verifier holds an anchor for: the entry could have been written after the compromise, so it earns no retained standing", attest("ASSESSMENT_ORIGIN", WHO.reviewerW1, target("reviewer-w")), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" }, true, undefined, true);
  const swapped = envelopeOf({ ...publication.statement, purpose: "ASSESSMENT_ORIGIN" }, publication.signature);
  add("11a-record-attestation-replayed-as-assessment-attestation", "a record-publication signature carried under the assessment-origin purpose", swapped, "golden", 2, { signature: "INVALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  const asAssessment = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT);
  add("11b-assessment-attestation-replayed-as-issuer-attestation", "an assessment-origin signature carried under the issuer purpose", envelopeOf({ ...asAssessment.statement, purpose: "ISSUER_ASSESSMENT_ORIGIN" }, asAssessment.signature), "golden", 3, { signature: "INVALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  add("12a-assessment-attestation-against-another-policy", "a valid attestation for policy reviewer-y-review, presented with a record whose reviewer-y assessment is under another policy", attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT), "renamed-policy", 3, { signature: "VALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  add("12b-attestation-across-wallprint-versions", "an attestation made for a WallPrint 0.1 record, presented with a 0.2 record", attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, { ...reviewerT, wallprintVersion: "0.1" }), "golden", 3, { signature: "VALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  add("13-historical-key-valid-under-old-registry-version", "a WalletWall key superseded in version 2, attestation accepted under version 1: bound at acceptance, not active now", attest("RECORD_PUBLICATION", WHO.publisher1, recT), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "BOUND_WALLETWALL_PUBLISHER", originBasis: "ACCEPTANCE" });
  add("14-assessor-key-superseded-today", "an assessor key superseded in version 3, attestation accepted under version 1", attest("ASSESSMENT_ORIGIN", WHO.reviewerY1, reviewerT), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE" });
  add("14b-superseded-key-entry-after-the-held-anchor", "the same superseded key, with a ledger entry naming version 1 but lying after the ledger prefix the verifier holds an anchor for: a post-supersession statement cannot be told from a genuine one", attest("ASSESSMENT_ORIGIN", WHO.reviewerY1, reviewerT), "golden", 1, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" }, true, undefined, true);
  add("16-valid-issuer-attestation", "all four issuer conditions hold: attributed to the registry authority, key bound to it, authorized for the purpose, signature verifies", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.circle2, circleT), "golden", 3, { signature: "VALID", target: "MATCHED", origin: "BOUND_ISSUER_AUTHORITY", originBasis: "ACCEPTANCE" });
  add("17-valid-assessor-attestation", "a key bound to the signer that lists reviewer-y signed the reviewer-y assessment", asAssessment, "golden", 3, { signature: "VALID", target: "MATCHED", origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE" });
  add("18-issuer-attestation-without-record-context", "a valid issuer attestation with no record: the attribution to the focal deployment's authority is not evaluated, so no issuer origin", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.circle2, circleT), null, 3, { signature: "VALID", target: "NOT_COMPARED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("19-assessor-key-signs-an-issuer-role-assessment", "an assessor key signs the ISSUER-role assessment under the assessor purpose", attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, circleT), "golden", 3, { signature: "VALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  add("20-key-label-says-circle", "an unregistered key whose signer id reads like an issuer signs the issuer assessment: a label is not a binding", attest("ISSUER_ASSESSMENT_ORIGIN", WHO.lookalike, circleT), "golden", null, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" });
  add("22-walletwall-assessment-is-not-attestable", "the WalletWall-generated assessment is never an attestation target: WalletWall speaks through the publication attestation", attest("ASSESSMENT_ORIGIN", WHO.publisher2, target("walletwall-rules")), "golden", 2, { signature: "VALID", target: "MISMATCHED", origin: "NONE", originBasis: "NONE" });
  add("23-registry-substituted", "the acceptance record names registry version 2 but carries another version's digest: the presented chain is not the registry that was pinned, so no historical decision is made", publication, "golden", 2, { signature: "VALID", target: "MATCHED", origin: "KEY_ONLY", originBasis: "NONE" }, true, 1);
  add("25-active-key-no-acceptance-record", "an active key presented with no acceptance record: bound under the current registry only, and the limitation says nothing was pinned", publication, "golden", null, { signature: "VALID", target: "MATCHED", origin: "BOUND_WALLETWALL_PUBLISHER", originBasis: "CURRENT" });
  add("24-unanchored-registry", "no trust anchor supplied: the chain is only self-consistent and the result says so", publication, "golden", 2, { signature: "VALID", target: "MATCHED", origin: "BOUND_WALLETWALL_PUBLISHER", originBasis: "ACCEPTANCE" }, false);
  return out;
}

function envelopeOf(statement: AttestationStatement, signature: string): AttestationEnvelope {
  return envelopeFor(statement, signature);
}

export function vectorContext(spec: VectorSpec, chain = registryChain()): VerificationContext {
  const records = { golden: goldenRecord(), other: goldenRecord({ id: "wp-attest-other" }), "renamed-policy": goldenRecord({ policy: "reviewer-y-review-b" }) };
  const ledger = vectorLedger(spec, chain);
  return {
    ...(spec.record === null ? {} : { record: records[spec.record] }),
    keyRegistry: chain,
    ...(spec.anchored ? { trustAnchor: anchorOf(chain) } : {}),
    ...(ledger === null ? {} : { acceptance: { ledger, anchor: vectorLedgerAnchor(spec, ledger) } }),
  };
}

export function runVector(spec: VectorSpec, chain = registryChain()): AttestationVerification {
  return verifyAttestation(spec.envelope, vectorContext(spec, chain));
}

/** A full, anchored context in which `envelope` was accepted under registry version `version`, for tests that need one attestation pinned. */
export function pinnedContext(envelope: unknown, version: number, record: WallPrintRecord | null = goldenRecord(), chain = registryChain()): VerificationContext {
  const ledger = ledgerOf([{ digest: digestOfEnvelope(envelope), pin: pinOf(chain, version) }]);
  return { ...(record === null ? {} : { record }), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } };
}

/** The set vector: several attestations about one record, shuffled on purpose, one exact duplicate. */
export function setVectorInputs(chain = registryChain()): AttestationEnvelope[] {
  const golden = goldenRecord();
  const reviewerT = assessmentTargetOf(golden, "reviewer-y");
  const circleT = assessmentTargetOf(golden, "issuer:circle");
  const pub = attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(golden));
  void chain;
  return [
    attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, reviewerT),
    pub,
    attest("ISSUER_ASSESSMENT_ORIGIN", WHO.circle2, circleT),
    pub,
    attest("RECORD_PUBLICATION", WHO.publisher1, recordTarget(golden)),
  ];
}

/** Everything the set shares: the record, the registry chain and its anchor, and one ledger naming each distinct attestation under the version it was accepted under, in version order. */
export function setVectorContext(chain = registryChain()): VerificationContext {
  const [reviewer, pub2, circle, , pub1] = setVectorInputs(chain);
  const ledger = ledgerOf([
    { digest: digestOfEnvelope(pub1), pin: pinOf(chain, 1) },
    { digest: digestOfEnvelope(pub2), pin: pinOf(chain, 2) },
    { digest: digestOfEnvelope(reviewer), pin: pinOf(chain, 3) },
    { digest: digestOfEnvelope(circle), pin: pinOf(chain, 3) },
  ]);
  return { record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } };
}

export function runSetVector(chain = registryChain()): AttestationVerification[] {
  return verifyAttestations(setVectorInputs(chain), setVectorContext(chain));
}

/** The committed file's text: structure expanded to the vector's own fields, each envelope, snapshot and expected result on one line, so a diff is reviewable. */
export function formatVectorFile(value: unknown, depth = 0): string {
  const pad = (n: number): string => "  ".repeat(n);
  if (value === null || typeof value !== "object" || depth >= 3) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => `${pad(depth + 1)}${formatVectorFile(v, depth + 1)}`).join(",\n")}\n${pad(depth)}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${formatVectorFile(v, depth + 1)}`).join(",\n")}\n${pad(depth)}}`;
}

/** The committed vector file's content: deterministic, so a regeneration must equal the file byte for byte. */
export function buildVectorFile(): unknown {
  const chain = registryChain();
  const golden = goldenRecord();
  const strip = (r: AttestationVerification): unknown => {
    const { establishes: _e, doesNotEstablish: _d, ...rest } = r;
    return rest;
  };
  return {
    type: "walletwall.wallprint.attestation-vectors",
    version: "0.1",
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    keys: [...new Set(Object.values(WHO).map((w) => w.n))].sort((a, b) => a - b).map((n) => ({ n, seedLabel: seedLabel(n), publicKey: syntheticKey(n).publicKey })),
    keyRegistry: chain,
    records: {
      golden: { id: golden.id, wallprintVersion: golden.wallprintVersion, digest: golden.digest, bundleDigest: golden.evidence.bundleDigest, focalAssertionId: golden.subject.focalAssertionId },
      other: { id: "wp-attest-other", digest: goldenRecord({ id: "wp-attest-other" }).digest },
      "renamed-policy": { id: golden.id, digest: goldenRecord({ policy: "reviewer-y-review-b" }).digest },
    },
    vectors: vectorSpecs().map((spec) => {
      const result = runVector(spec, chain);
      const env = spec.envelope as { statement?: AttestationStatement };
      return {
        id: spec.id,
        description: spec.description,
        record: spec.record,
        acceptance: ((): unknown => {
          const ledger = vectorLedger(spec, chain);
          return ledger === null ? null : { ledger, anchor: vectorLedgerAnchor(spec, ledger) };
        })(),
        trustAnchor: spec.anchored ? anchorOf(chain) : null,
        envelope: spec.envelope,
        ...(env.statement === undefined ? {} : { signedBytes: { domainTag: tagOf(env.statement), preimage: new TextDecoder().decode(attestationPreimage(env.statement)) } }),
        expected: strip(result),
      };
    }),
    set: { description: "five inputs in shuffled order, one an exact duplicate: the order is deterministic and the duplicate is flagged, never counted", acceptance: setVectorContext(chain).acceptance, expected: runSetVector(chain).map(strip) },
  };
}

function tagOf(statement: AttestationStatement): string {
  return new TextDecoder().decode(attestationPreimage(statement)).split("\u0000")[0] ?? "";
}
