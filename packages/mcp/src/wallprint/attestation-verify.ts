import { canonicalize } from "../canonical.ts";
import {
  ATTESTATION_DOES_NOT_ESTABLISH,
  ATTESTATION_ESTABLISHES,
  ATTESTATION_LIMITS,
  PURPOSE_ORIGIN,
  PURPOSE_SIGNER_KIND,
  SUPPORTED_ALGORITHMS,
  VERIFICATION_VERSION,
  type AttestationPurpose,
  type AuthorizationStatus,
  type BindingMethod,
  type BindingStatus,
  type KeyStatus,
  type Origin,
  type SignatureReason,
  type SignatureStatus,
  type SignerKind,
  type StandingStatus,
  type TargetStatus,
} from "./attestation-vocabulary.ts";
import { acceptanceFor, verifyAcceptanceLedger, type AcceptanceLedgerResult } from "./acceptance-ledger.ts";
import {
  attestationDigest,
  attestationPreimage,
  parseAttestation,
  recordTarget,
  statementFindings,
  targetKeyOf,
  type AttestationEnvelope,
  type AttestationStatement,
} from "./attestation.ts";
import { verifyEd25519 } from "./ed25519.ts";
import { deepFreeze } from "./freeze.ts";
import { findRegisteredKey, verifyKeyRegistryChain, type ChainResult, type KeyRegistrySnapshot } from "./key-registry.ts";
import { validateWallPrintRecord, type WallPrintRecord } from "./record.ts";

/**
 * Attestation verification: a pure function from one detached attestation and the historical inputs the caller holds to
 * a structured result of separate dimensions. There is no `verified` flag. The result says what was checked, under which
 * key registry version, and what that does and does not authenticate; it never says a statement is true.
 *
 *   signature      did this key sign exactly these bytes?                       (cryptography only; needs no registry)
 *   target         is the statement about the record / assessment in hand?      (needs the record)
 *   atAcceptance   what did the key registry say when the store accepted it?    (needs the pinned registry version)
 *   current        what does the key registry say now?                          (needs the registry chain's head)
 *   origin         the one narrow classification those dimensions support
 *
 * A dimension whose input is missing is reported as unavailable or not evaluated, never defaulted to present-day state.
 * Never throws; no fixed-code reason echoes caller text.
 */

export interface AcceptancePin {
  keyRegistryVersion: string;
  keyRegistryDigest: string;
}

export interface VerificationContext {
  /** The WallPrint record the attestation is presented with, if any. It is validated before it is compared. */
  record?: unknown;
  /** The whole key registry chain, versions 1..N, ascending. */
  keyRegistry?: unknown;
  /** A registry head the caller already trusts (version and digest). Without one the chain is only self-consistent. */
  trustAnchor?: { version: string; digest: string } | null;
  /**
   * The store's acceptance ledger, read from the same trusted channel as the key registry (never from whoever presents the
   * attestation), and an optional entry the caller already trusts. The pin is looked up here BY ATTESTATION DIGEST; there is
   * no way to supply a pin for an attestation the ledger does not name. Without a ledger entry no historical decision is made.
   */
  acceptance?: { ledger: unknown; anchor?: { seq: string; digest: string } | null } | null;
}

export interface KeyAssessment {
  evaluation: "EVALUATED" | "UNAVAILABLE";
  keyRegistryVersion: string | null;
  keyRegistryDigest: string | null;
  key: "KNOWN" | "UNKNOWN" | "MATERIAL_MISMATCH" | null;
  keyStatus: KeyStatus | null;
  signerKind: SignerKind | null;
  bindingMethod: BindingMethod | null;
  binding: BindingStatus;
  authorization: AuthorizationStatus;
  standing: StandingStatus;
  reasons: string[];
}

export interface AttestationVerification {
  verificationVersion: string;
  parse: "PARSED" | "MALFORMED" | "UNSUPPORTED_VERSION";
  parseProblem: string | null;
  attestationDigest: string | null;
  purpose: AttestationPurpose | null;
  signerId: string | null;
  keyId: string | null;
  algorithm: string | null;
  signature: { status: SignatureStatus; reasons: SignatureReason[] };
  target: { status: TargetStatus; reasons: string[] };
  acceptance: { status: "PINNED" | "NOT_PINNED"; keyRegistryVersion: string | null };
  atAcceptance: KeyAssessment;
  current: KeyAssessment;
  origin: Origin;
  originBasis: "ACCEPTANCE" | "CURRENT" | "NONE";
  limitations: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (list: readonly string[]): string[] => [...new Set(list)].sort(ordinal);

const unavailable = (reasons: readonly string[]): KeyAssessment => ({
  evaluation: "UNAVAILABLE",
  keyRegistryVersion: null,
  keyRegistryDigest: null,
  key: null,
  keyStatus: null,
  signerKind: null,
  bindingMethod: null,
  binding: "NOT_EVALUATED",
  authorization: "NOT_EVALUATED",
  standing: "NOT_EVALUATED",
  reasons: uniqueSorted(reasons),
});

const STATUS_REASON: Readonly<Record<KeyStatus, string | null>> = { ACTIVE: null, RETIRED: "KEY_RETIRED", SUPERSEDED: "KEY_SUPERSEDED", REVOKED: "KEY_REVOKED", COMPROMISED: "KEY_COMPROMISED" };

function checkSignature(statement: AttestationStatement, signature: string): { status: SignatureStatus; reasons: SignatureReason[] } {
  const { algorithm, publicKey } = statement.signer;
  if (!(SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm)) return { status: "NOT_CHECKED", reasons: ["ALGORITHM_UNSUPPORTED"] };
  const result = verifyEd25519(publicKey, attestationPreimage(statement), signature);
  if (result.valid) return { status: "VALID", reasons: [] };
  return result.reason === "RUNTIME_UNSUPPORTED" ? { status: "NOT_CHECKED", reasons: ["RUNTIME_UNSUPPORTED"] } : { status: "INVALID", reasons: [result.reason] };
}

function compareTarget(statement: AttestationStatement, record: WallPrintRecord | null): { status: TargetStatus; reasons: string[] } {
  const structural: string[] = statementFindings(statement);
  if (structural.length > 0) return { status: "MISMATCHED", reasons: uniqueSorted(structural) };
  if (record === null) return { status: "NOT_COMPARED", reasons: [] };
  const reasons: string[] = [];
  const t = statement.target;
  if (t.wallprintVersion !== record.wallprintVersion) reasons.push("VERSION_MISMATCH");
  if (t.kind === "WALLPRINT_RECORD") {
    const own = recordTarget(record);
    if (t.recordId !== own.recordId) reasons.push("RECORD_ID_MISMATCH");
    if (t.digest !== own.digest) reasons.push("DIGEST_MISMATCH");
  } else {
    if (t.bundleDigest !== record.evidence.bundleDigest) reasons.push("BUNDLE_DIGEST_MISMATCH");
    if (t.focalAssertionId !== record.subject.focalAssertionId) reasons.push("FOCAL_ASSERTION_MISMATCH");
    const held = record.assessments.find((a) => a.assessor === t.assessment.assessor && a.policy === t.assessment.policy);
    if (held === undefined) reasons.push("ASSESSMENT_NOT_IN_RECORD");
    else if (canonicalize(held) !== canonicalize(t.assessment)) reasons.push("ASSESSMENT_MISMATCH");
  }
  return reasons.length === 0 ? { status: "MATCHED", reasons: [] } : { status: "MISMATCHED", reasons: uniqueSorted(reasons) };
}

function assessKey(snapshot: KeyRegistrySnapshot, statement: AttestationStatement, issuerEvaluable: boolean, mode: "ACCEPTANCE" | "CURRENT", acceptance: { version: string | null; covered: boolean }): KeyAssessment {
  const base = { evaluation: "EVALUATED" as const, keyRegistryVersion: snapshot.keyRegistryVersion, keyRegistryDigest: snapshot.digest };
  const found = findRegisteredKey(snapshot, statement.signer.keyId);
  if (found === null) return { ...base, key: "UNKNOWN", keyStatus: null, signerKind: null, bindingMethod: null, binding: "UNBOUND", authorization: "NOT_AUTHORIZED", standing: "NOT_EVALUATED", reasons: ["KEY_UNKNOWN"] };
  const { signer, key } = found;
  if (key.algorithm !== statement.signer.algorithm || key.publicKey !== statement.signer.publicKey) {
    return { ...base, key: "MATERIAL_MISMATCH", keyStatus: null, signerKind: null, bindingMethod: null, binding: "UNBOUND", authorization: "NOT_AUTHORIZED", standing: "NOT_EVALUATED", reasons: ["KEY_MATERIAL_MISMATCH"] };
  }
  const reasons: string[] = [];
  const purpose = statement.purpose;
  let binding: BindingStatus = "BOUND";
  if (signer.signerId !== statement.signer.signerId) {
    binding = "UNBOUND";
    reasons.push("SIGNER_ID_MISMATCH");
  }
  if (signer.kind !== PURPOSE_SIGNER_KIND[purpose]) {
    binding = "UNBOUND";
    reasons.push("SIGNER_KIND_MISMATCH");
  }
  if (statement.target.kind === "WALLPRINT_ASSESSMENT") {
    const assessor = statement.target.assessment.assessor;
    if (purpose === "ISSUER_ASSESSMENT_ORIGIN") {
      if (signer.authorityId !== assessor) {
        binding = "UNBOUND";
        reasons.push("ISSUER_AUTHORITY_MISMATCH");
      } else if (!issuerEvaluable && binding === "BOUND") {
        binding = "NOT_EVALUATED";
        reasons.push("ISSUER_ATTRIBUTION_NOT_EVALUATED");
      }
    } else if (!signer.assessorIds.includes(assessor)) {
      binding = "UNBOUND";
      reasons.push("ASSESSOR_NOT_BOUND");
    }
  }
  const granted = key.purposes.includes(purpose);
  if (!granted) reasons.push("PURPOSE_NOT_GRANTED");
  const statusReason = STATUS_REASON[key.status];
  if (statusReason !== null) reasons.push(statusReason);
  const authorization: AuthorizationStatus = granted && key.status === "ACTIVE" ? "AUTHORIZED" : "NOT_AUTHORIZED";

  let standing: StandingStatus;
  if (mode === "ACCEPTANCE") standing = authorization === "AUTHORIZED" ? "HELD" : "NOT_EVALUATED";
  else if (key.status === "ACTIVE" || key.status === "RETIRED" || key.status === "SUPERSEDED") standing = "HELD";
  else if (acceptance.version === null) {
    standing = "WITHDRAWN";
    reasons.push("WITHDRAWN_ACCEPTANCE_UNKNOWN");
  } else if (!acceptance.covered) {
    // The ledger and the registry are separate unsigned logs with no cross-ordering, so an entry appended after the prefix the
    // caller holds an anchor for could have been written after the status change with an older version. Not trusted for a withdrawn key.
    standing = "WITHDRAWN";
    reasons.push("WITHDRAWN_ACCEPTANCE_UNANCHORED");
  } else if (key.retainedBefore !== null && Number(acceptance.version) >= Number(key.addedIn) && Number(acceptance.version) < Number(key.retainedBefore)) standing = "HELD";
  else {
    standing = "WITHDRAWN";
    reasons.push("WITHDRAWN_AFTER_ACCEPTANCE");
  }
  return { ...base, key: "KNOWN", keyStatus: key.status, signerKind: signer.kind, bindingMethod: found.bindingMethod, binding, authorization, standing, reasons: uniqueSorted(reasons) };
}

function emptyResult(parse: "MALFORMED" | "UNSUPPORTED_VERSION", problem: string): AttestationVerification {
  return {
    verificationVersion: VERIFICATION_VERSION,
    parse,
    parseProblem: problem,
    attestationDigest: null,
    purpose: null,
    signerId: null,
    keyId: null,
    algorithm: null,
    signature: { status: "NOT_CHECKED", reasons: [] },
    target: { status: "NOT_COMPARED", reasons: [] },
    acceptance: { status: "NOT_PINNED", keyRegistryVersion: null },
    atAcceptance: unavailable([]),
    current: unavailable([]),
    origin: "NONE",
    originBasis: "NONE",
    limitations: [],
    establishes: ATTESTATION_ESTABLISHES,
    doesNotEstablish: ATTESTATION_DOES_NOT_ESTABLISH,
  };
}

interface Prepared {
  record: WallPrintRecord | null;
  recordInvalid: boolean;
  chain: ChainResult | null;
  anchor: { version: string; digest: string } | null;
  ledger: AcceptanceLedgerResult | null;
  ledgerAnchor: { seq: string; digest: string } | null;
}

/** The inputs every attestation of a set shares, checked once: the record is validated, the registry chain and the acceptance ledger verified. */
function prepare(context: VerificationContext): Prepared {
  let record: WallPrintRecord | null = null;
  let recordInvalid = false;
  if (context.record !== undefined) {
    const validated = validateWallPrintRecord(context.record);
    if (validated.ok) record = validated.record;
    else recordInvalid = true;
  }
  return {
    record,
    recordInvalid,
    chain: context.keyRegistry === undefined ? null : verifyKeyRegistryChain(context.keyRegistry),
    anchor: context.trustAnchor ?? null,
    ledger: context.acceptance === undefined || context.acceptance === null ? null : verifyAcceptanceLedger(context.acceptance.ledger),
    ledgerAnchor: context.acceptance?.anchor ?? null,
  };
}

function verifyParsed(envelope: AttestationEnvelope, prepared: Prepared): AttestationVerification {
  const { statement } = envelope;
  const digest = attestationDigest(envelope);
  const limitations: string[] = [];

  const signature = checkSignature(statement, envelope.signature);

  const record = prepared.record;
  if (prepared.recordInvalid) limitations.push("RECORD_INVALID");
  const target = compareTarget(statement, record);
  if (target.status === "NOT_COMPARED") limitations.push("TARGET_NOT_COMPARED");

  let pin: AcceptancePin | null = null;
  let pinCovered = false;
  if (prepared.ledger !== null) {
    const ledger = prepared.ledger;
    const anchor = prepared.ledgerAnchor;
    if (!ledger.ok) limitations.push("ACCEPTANCE_INDEX_INVALID");
    else if (anchor !== null && !ledger.entries.some((e) => e.seq === anchor.seq && e.entryDigest === anchor.digest)) limitations.push("ACCEPTANCE_ANCHOR_MISMATCH");
    else {
      if (anchor === null) limitations.push("ACCEPTANCE_UNANCHORED");
      const entry = acceptanceFor(ledger.entries, digest);
      pin = entry?.acceptedUnder ?? null;
      pinCovered = entry !== null && anchor !== null && Number(entry.seq) <= Number(anchor.seq);
    }
  }
  const acceptance = pin === null ? ({ status: "NOT_PINNED", keyRegistryVersion: null } as const) : ({ status: "PINNED", keyRegistryVersion: pin.keyRegistryVersion } as const);
  if (pin === null) limitations.push("ACCEPTANCE_NOT_PINNED");

  let atAcceptance = unavailable(pin === null ? [] : ["KEY_REGISTRY_NOT_SUPPLIED"]);
  let current = unavailable(["KEY_REGISTRY_NOT_SUPPLIED"]);
  if (prepared.chain !== null) {
    const chain = prepared.chain;
    if (!chain.ok) {
      atAcceptance = unavailable(pin === null ? [] : ["KEY_REGISTRY_CHAIN_INVALID"]);
      current = unavailable(["KEY_REGISTRY_CHAIN_INVALID"]);
    } else {
      const anchor = prepared.anchor;
      const anchored = anchor === null ? null : chain.chain.find((s) => s.keyRegistryVersion === anchor.version);
      if (anchor !== null && (anchored === undefined || anchored === null || anchored.digest !== anchor.digest)) {
        atAcceptance = unavailable(pin === null ? [] : ["KEY_REGISTRY_ANCHOR_MISMATCH"]);
        current = unavailable(["KEY_REGISTRY_ANCHOR_MISMATCH"]);
      } else {
        if (anchor === null) limitations.push("KEY_REGISTRY_UNANCHORED");
        const issuerEvaluable = target.status === "MATCHED" && statement.target.kind === "WALLPRINT_ASSESSMENT" && record !== null;
        const head = chain.chain[chain.chain.length - 1];
        if (head !== undefined) current = assessKey(head, statement, issuerEvaluable, "CURRENT", { version: pin?.keyRegistryVersion ?? null, covered: pinCovered });
        if (pin !== null) {
          const snapshot = chain.chain.find((s) => s.keyRegistryVersion === pin.keyRegistryVersion);
          if (snapshot === undefined) atAcceptance = unavailable(["KEY_REGISTRY_VERSION_MISSING"]);
          else if (snapshot.digest !== pin.keyRegistryDigest) atAcceptance = unavailable(["KEY_REGISTRY_DIGEST_MISMATCH"]);
          else atAcceptance = assessKey(snapshot, statement, issuerEvaluable, "ACCEPTANCE", { version: pin.keyRegistryVersion, covered: pinCovered });
        }
      }
    }
  }
  if (current.keyStatus !== null && current.keyStatus !== "ACTIVE") limitations.push("KEY_NOT_ACTIVE_NOW");

  let origin: Origin = "NONE";
  let originBasis: "ACCEPTANCE" | "CURRENT" | "NONE" = "NONE";
  if (signature.status === "VALID" && target.status !== "MISMATCHED") {
    origin = "KEY_ONLY";
    const basis = pin === null ? current : atAcceptance;
    const basisName = pin === null ? "CURRENT" : "ACCEPTANCE";
    const bound = basis.evaluation === "EVALUATED" && basis.binding === "BOUND" && basis.authorization === "AUTHORIZED" && basis.standing === "HELD";
    const retained = pin === null ? true : current.evaluation === "EVALUATED" && current.standing === "HELD";
    if (bound && retained) {
      origin = PURPOSE_ORIGIN[statement.purpose];
      originBasis = basisName;
    }
  }

  return deepFreeze({
    verificationVersion: VERIFICATION_VERSION,
    parse: "PARSED",
    parseProblem: null,
    attestationDigest: digest,
    purpose: statement.purpose,
    signerId: statement.signer.signerId,
    keyId: statement.signer.keyId,
    algorithm: statement.signer.algorithm,
    signature,
    target,
    acceptance,
    atAcceptance,
    current,
    origin,
    originBasis,
    limitations: uniqueSorted(limitations),
    establishes: ATTESTATION_ESTABLISHES,
    doesNotEstablish: ATTESTATION_DOES_NOT_ESTABLISH,
  });
}

/** Verify one attestation. See the module comment for the dimensions; spec/WALLPRINT_ATTESTATIONS.md for their meaning. */
export function verifyAttestation(input: unknown, context: VerificationContext = {}): AttestationVerification {
  const parsed = parseAttestation(input);
  if (!parsed.ok) return deepFreeze(emptyResult(parsed.unsupportedVersion ? "UNSUPPORTED_VERSION" : "MALFORMED", parsed.problem));
  return verifyParsed(parsed.envelope, prepare(context));
}

function orderKey(result: AttestationVerification, index: number): string {
  if (result.parse !== "PARSED") return `~${String(index).padStart(8, "0")}`;
  return `${result.purpose ?? ""}\u0000${result.signerId ?? ""}\u0000${result.keyId ?? ""}\u0000${result.attestationDigest ?? ""}`;
}

/** What "the same attestation" means: purpose, signer, key (with its algorithm and material) and target. Never the bytes. */
function duplicateKey(envelope: AttestationEnvelope): string {
  const s = envelope.statement;
  return [s.purpose, s.signer.signerId, s.signer.keyId, s.signer.algorithm, s.signer.publicKey, targetKeyOf(s.target)].join("\u0000");
}

/**
 * Verify a set of attestations about one target. The order is deterministic (purpose, signer, key, attestation digest;
 * unparsable inputs last in input order) and does not depend on input order: every pin comes from the shared ledger by
 * attestation digest. Of several VALID signatures for the same purpose, signer, key and target only the first is the
 * attestation; the rest are reported with `DUPLICATE_OF_EARLIER_ATTESTATION` and contribute nothing. An invalid or
 * unchecked twin is never the "first" and never makes a genuine attestation a duplicate. There is no count, no score and
 * no "majority": several signatures are several statements, and the number of them is not evidence.
 */
export function verifyAttestations(items: readonly unknown[], shared: VerificationContext = {}): AttestationVerification[] {
  const prepared = prepare(shared);
  const rows = items.slice(0, ATTESTATION_LIMITS.maxAttestationsPerSet).map((item, index) => {
    const parsed = parseAttestation(item);
    const result = parsed.ok ? verifyParsed(parsed.envelope, prepared) : deepFreeze(emptyResult(parsed.unsupportedVersion ? "UNSUPPORTED_VERSION" : "MALFORMED", parsed.problem));
    return { result, order: orderKey(result, index), duplicate: parsed.ok && result.signature.status === "VALID" ? duplicateKey(parsed.envelope) : null };
  });
  rows.sort((a, b) => ordinal(a.order, b.order));
  const seen = new Set<string>();
  return rows.map(({ result, duplicate }) => {
    if (duplicate === null) return result;
    if (!seen.has(duplicate)) {
      seen.add(duplicate);
      return result;
    }
    return deepFreeze({ ...result, limitations: uniqueSorted([...result.limitations, "DUPLICATE_OF_EARLIER_ATTESTATION"]) });
  });
}
