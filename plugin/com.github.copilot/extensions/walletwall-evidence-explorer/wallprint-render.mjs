// WallPrint disclosure view: the canonical WallPrint record, rendered as an editorial disclosure document.
//
//   WalletWall isn't always right. WallPrint keeps the record.
//
// Pure functions: a serialized disclosure fixture (engine outputs: record, lifecycle events, lineage, receipt
// verification, replay result, semantic diff) in, escaped HTML out. The hierarchy is
//
//   WWEP / WallPrint record -> fixture / serialized view input -> view model -> DOM
//
// and never the other way round. Rules this file must keep:
//  - It decides no evidence state, authority, freshness, finality, corroboration, conflict, lifecycle state, WalletWall
//    assessment, assessor independence, replay result or digest validity. It prints what the engine recorded.
//  - A value outside the engine's enumerations is shown as "not recognised", never as a state.
//  - Absence is shown as absence: no result is not zero, unknown is not false, no assessment is not a failed assessment.
//  - Assessor disagreement stays visible; no consensus, verdict, badge or seal is synthesized.
//  - Correction, supersession and withdrawal keep the earlier record visible and addressable.
//  - Receipt and replay results are printed with their boundary: digest integrity is not factual truth, and
//    UNREPLAYABLE is not INCORRECT.
//  - Identifiers, digests and timestamps are printed in full, as recorded, in monospace, with a copy control.
//  - The portable reference and its QR code are a locator (record id, committed digest, WallPrint version), printed as a
//    registration block beside its exact text and never as a seal: they establish nothing about the record's claims.
import { esc } from "./wall.mjs";
import { encodeQr, qrPathData } from "./wallprint-qr.mjs";
import { REFERENCE_DOES_NOT_ESTABLISH, REFERENCE_IDENTIFIES, REFERENCE_TARGETS, REFERENCE_VERSION, encodeReference, encodeReferenceEnvelope, tryReference } from "./wallprint-reference.mjs";

export const ASSESSOR_ROLE_LABELS = {
  WALLETWALL: "WalletWall",
  ISSUER: "Issuer",
  UPSTREAM_AUTHORITY: "Upstream authority",
  INDEPENDENT_REVIEWER: "Independent reviewer",
  OTHER: "Other",
};

/**
 * The sections a local jump may focus inside one record, in the order the controls appear. Each target is rendered with
 * `data-wp-target="<key>" id="wp-sec-<key>-<record id>"`, so the same vocabulary can address a section later without
 * any URL existing in this lane.
 */
export const WALLPRINT_SECTIONS = ["receipt", "replay", "history", "assessments", "provenance"];
export const SECTION_LABELS = { receipt: "Receipt", replay: "Replay", history: "History", assessments: "Assessments", provenance: "Provenance" };
/** The words for a portable reference's target: the jump sections plus the record itself. */
const TARGET_LABELS = { record: "Record", ...SECTION_LABELS };

/**
 * How each resolution outcome of a portable reference is told. UNAVAILABLE is not invalid: the store does not hold the
 * record. DIGEST_MISMATCH says which digests differ and never which record is right. A malformed or unsupported reference
 * is described by its fixed problem code; no part of the text is shown. None of these is a statement about the facts.
 */
export const REFERENCE_PRESENTATION = {
  RESOLVED: "The record this reference names is held here; the digest it carries and the digest the engine recorded for its canonical bytes both equal the digest the reference carries. What that establishes is only that: which record, which bytes, as the engine recorded them.",
  UNAVAILABLE: "No record with this id is held in this disclosure store. The reference is well formed and names a record and a digest; the record it names is not available here. Unavailable is not invalid, and this says nothing about the record or its claims.",
  /** More than one bundled record carries the id: nothing can be resolved, and nothing is said about either record. */
  UNAVAILABLE_AMBIGUOUS: "More than one record held in this disclosure store carries this id, so the reference resolves to none of them. Nothing is said about any of those records or their claims.",
  NOT_COMPARED: "The record this reference names is held here, but this disclosure carries no digest, or no engine-computed digest, for it, so the reference's digest was compared with nothing. Nothing is said to match or to differ.",
  DIGEST_MISMATCH: "The resolved record does not match the digest carried by this reference.",
  MALFORMED_REFERENCE: "The text is not a WallPrint portable reference in the form this document reads. Nothing was resolved and no part of the text is shown.",
  UNSUPPORTED_VERSION: "The reference declares a reference or WallPrint version this document does not read. Nothing was resolved.",
};
/** The fixed problem codes a failed parse can carry, in words. Anything else is "not recognised". */
export const REFERENCE_PROBLEM_LABELS = {
  text: "not a non-empty text",
  length: "longer than any reference can be",
  characters: "contains a character no reference contains (space, percent, hash, control, non-ASCII or punctuation outside the grammar)",
  scheme: "does not begin with walletwall://wallprint/",
  query: "the parameters are not reference, wallprint, digest and an optional target, once each, in that order",
  envelope: "not a reference envelope: the type tag or the fixed keys differ",
  reference: "the reference version",
  wallprint: "the WallPrint version",
  recordId: "the record id is not a lower-case record id of 3 to 64 characters",
  digest: "the digest is not 64 lower-case hexadecimal characters",
  target: "the target is not one of record, receipt, replay, history, assessments, provenance",
};

export const CLAIM_LABELS = {
  ASSET_IDENTITY: "Asset identity",
  TOKEN_BALANCE_AT_BLOCK: "Token balance at block",
  TOKEN_USD_PRICE: "Token USD price",
  TOKEN_USD_VALUE: "Token USD value",
  VAULT_TECHNICAL_READINESS: "Vault technical readiness",
};

/**
 * What each lifecycle event is. Lifecycle is disclosure metadata, never an evidence state, and an event says nothing
 * about the bytes disclosed here: whether they are the committed bytes is the digest and receipt checks' question.
 */
export const LIFECYCLE_HINTS = {
  COMMITTED: "The record's canonical bytes were committed to the history.",
  DISCLOSED: "The committed record was disclosed. Whether the bytes disclosed here are the committed bytes is what the digest and receipt checks under Verify say.",
  CORRECTED: "A later record corrects this one and binds this record's committed digest. The history appends this event; it does not rewrite the record.",
  SUPERSEDED: "A later record supersedes this one and binds this record's committed digest. The history appends this event; it does not rewrite the record.",
  WITHDRAWN: "Withdrawn with a stated reason. The record stays addressable; withdrawal is not deletion.",
};

export const REPLAY_OUTCOME_HINTS = {
  REPRODUCED: "This engine re-derived the record from its referenced evidence and the versions in force and produced the same bytes.",
  MISMATCH: "This engine re-derived the record and produced different bytes in the sections named below.",
  UNREPLAYABLE: "A required historical input is unavailable to this engine or refused, so nothing was recomputed. UNREPLAYABLE is not INCORRECT.",
};

export const REPLAY_REASON_LABELS = {
  WWEP_VERSION_MISMATCH: "The record was committed under another WWEP version.",
  MISSING_POLICY_VERSION: "The policies version or digest the record names is not the one this engine has.",
  MISSING_REGISTRY_VERSION: "The registry version or digest the record names is not the one this engine has.",
  MISSING_RULE_VERSION: "The rules version the record names is not the one this engine has.",
  MISSING_EVIDENCE: "The referenced evidence bundle is not in the evidence store. It is not filled in.",
  EVIDENCE_DIGEST_MISMATCH: "The store returned evidence that does not digest to the record's bundle digest.",
  RECORD_INVALID: "The record itself does not validate, so there is nothing to replay.",
  REBUILD_REFUSED: "This engine's admission rules refuse to rebuild the record from its own inputs.",
  DIGEST_MISMATCH: "The recomputed record digest differs from the committed digest.",
  SUBJECT_MISMATCH: "The recomputed subject differs.",
  SNAPSHOT_MISMATCH: "The recomputed snapshot time differs.",
  EVIDENCE_MISMATCH: "The recomputed evidence references differ.",
  CLAIM_MISMATCH: "The recomputed claims differ.",
  ASSESSMENT_MISMATCH: "The recomputed assessments differ.",
  PROVENANCE_MISMATCH: "The recomputed provenance differs.",
  LIMITATION_MISMATCH: "The recomputed limitations differ.",
  CONFLICT_MISMATCH: "The recomputed conflicts differ.",
  VIOLATION_MISMATCH: "The recomputed invariant violations differ.",
  POLICY_VERSION_MISMATCH: "The recomputed policy versions differ.",
  RULE_VERSION_MISMATCH: "The recomputed rule versions differ.",
  VERSION_MISMATCH: "The recomputed versions differ.",
};

export const RECEIPT_REASON_LABELS = {
  RECEIPT_INVALID: "The receipt is not a well-formed WallPrint receipt.",
  RECORD_INVALID: "The disclosed record does not validate, so the receipt cannot be checked against it.",
  RECORD_ID_MISMATCH: "The receipt names a different record id.",
  DIGEST_MISMATCH: "The receipt's digest is not the digest of the disclosed record.",
  BUNDLE_DIGEST_MISMATCH: "The receipt's evidence bundle digest differs from the record's.",
  VERSION_MISMATCH: "The receipt's versions differ from the record's.",
};

export const DIFF_CATEGORY_LABELS = {
  record: "Record",
  subject: "Subject",
  snapshot: "Snapshot",
  claims: "Claims",
  evidence: "Evidence",
  assessments: "Assessments",
  limitations: "Limitations",
  conflicts: "Conflicts",
  violations: "Invariant violations",
  policyVersions: "Policies",
  ruleVersions: "Rules",
  versions: "Versions",
  provenance: "Provenance",
  lifecycle: "Lifecycle link",
};

/** The four questions the Verify section answers, one per check. They are not interchangeable and are never combined. */
export const CHECK_QUESTIONS = {
  record: "Is this a structurally valid WallPrint record?",
  digest: "Do these canonical bytes produce the embedded digest?",
  receipt: "Does the disclosed record match the committed record?",
  replay: "Can the historical evaluation be reproduced under the recorded context?",
};

/** The record validation as presented: a 1:1 label of the engine's `ok` boolean, absence said as absence. */
export const RECORD_PRESENTATION = {
  VALID: "Every rule the builder applies holds for the disclosed record.",
  INVALID: "The disclosed record does not validate. Findings, as the engine reported them:",
  NOT_CARRIED: "No validation result is carried in this disclosure. Nothing was checked here.",
  UNRECOGNISED: "The carried validation result is not in a form this document recognises. No result is shown.",
};

/** The digest check as presented: self-consistency of the disclosed bytes with the digest they carry, nothing more. */
export const DIGEST_PRESENTATION = {
  MATCH: "The embedded digest is the SHA-256 of the disclosed canonical record. The bytes are self-consistent with the digest they carry; whether they are the committed bytes is the receipt's question.",
  MISMATCH: "The embedded digest is not the SHA-256 of the disclosed canonical record. The bytes or the digest changed after the other. This says nothing about which, and nothing about the facts.",
  NOT_COMPUTABLE: "The disclosed record could not be canonicalized, so no digest was computed and nothing was compared.",
  NO_DIGEST: "The disclosed record carries no digest to check.",
  NOT_CARRIED: "No digest check is carried in this disclosure. Nothing was computed here.",
  UNRECOGNISED: "The carried digest check is not in a form this document recognises. No result is shown.",
};

/**
 * The receipt as presented: a 1:1 label of the engine's `matches` boolean, absence when no receipt was issued, absence of
 * the check itself when a receipt exists but no verification result is carried, and "not recognised" for anything else.
 * Never a verdict the engine did not give, and never a statement about the facts inside the record.
 */
export const RECEIPT_PRESENTATION = {
  MATCH: "The disclosed canonical record matches the committed record.",
  MISMATCH: "The disclosed record does not match the commitment this receipt represents. The engine's reasons are listed below; they describe bytes, not facts.",
  /** `matches: false` returned before any comparison (RECEIPT_INVALID, RECORD_INVALID): nothing was compared, so nothing is said not to match. */
  MISMATCH_UNCOMPARED: "The engine reports matches: false without comparing: the receipt or the record is not in a checkable form, so no comparison with the commitment was made. The reasons are listed below; they describe form, not facts.",
  UNAVAILABLE: "No receipt is carried for this record. Absence is not failure.",
  UNCHECKED: "A receipt is carried, but no verification result is available in this disclosure. No check was run here.",
  UNRECOGNISED: "The carried verification result is not in a form this document recognises. No result is shown.",
};

// ─── verification projections ───────────────────────────────────────────────
// Each projection maps one engine result onto a fixed presentation word, 1:1. Absence (null or undefined) is "not
// carried" or UNAVAILABLE; a value that is not the engine's shape, or is internally inconsistent, is UNRECOGNISED. Nothing
// here recomputes a digest, a validation or a replay: a projection reads booleans and enumerations the engine wrote.

export const RECEIPT_STATES = ["MATCH", "MISMATCH", "UNAVAILABLE", "UNCHECKED"];
const UNRECOGNISED = "UNRECOGNISED";
const NOT_CARRIED = "NOT_CARRIED";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const absent = (v) => v === null || v === undefined;

/** `{ issued, verification }` -> MATCH | MISMATCH | UNAVAILABLE | UNCHECKED | UNRECOGNISED. A match is `matches: true` with no reason; a mismatch is `matches: false` with at least one. */
export function receiptStatusOf(receipt) {
  if (absent(receipt)) return "UNAVAILABLE";
  if (!isObj(receipt)) return UNRECOGNISED;
  const v = receipt.verification;
  if (absent(receipt.issued)) return absent(v) ? "UNAVAILABLE" : UNRECOGNISED;
  if (!isObj(receipt.issued)) return UNRECOGNISED;
  if (absent(v)) return "UNCHECKED";
  if (!isObj(v) || typeof v.matches !== "boolean" || !Array.isArray(v.reasons)) return UNRECOGNISED;
  if (v.matches) return v.reasons.length === 0 ? "MATCH" : UNRECOGNISED;
  return v.reasons.length > 0 ? "MISMATCH" : UNRECOGNISED;
}

/** `{ ok, findings }` -> VALID | INVALID | NOT_CARRIED | UNRECOGNISED. VALID has no finding; INVALID has at least one. */
export function recordStatusOf(validation) {
  if (absent(validation)) return NOT_CARRIED;
  if (!isObj(validation) || typeof validation.ok !== "boolean" || !Array.isArray(validation.findings)) return UNRECOGNISED;
  if (validation.ok) return validation.findings.length === 0 ? "VALID" : UNRECOGNISED;
  return validation.findings.length > 0 ? "INVALID" : UNRECOGNISED;
}

/**
 * `{ hasDigest, matches, computedDigest }` -> MATCH | MISMATCH | NOT_COMPUTABLE | NO_DIGEST | NOT_CARRIED | UNRECOGNISED.
 * A match carries the digest it matched; a mismatch carries the digest it compared; `matches: false` with no computed
 * digest is the engine saying the record could not be canonicalized, which compared nothing.
 */
export function digestStatusOf(digest) {
  if (absent(digest)) return NOT_CARRIED;
  if (!isObj(digest) || typeof digest.hasDigest !== "boolean" || typeof digest.matches !== "boolean") return UNRECOGNISED;
  if (!digest.hasDigest) return digest.matches ? UNRECOGNISED : "NO_DIGEST";
  const computed = typeof digest.computedDigest === "string" && digest.computedDigest !== "";
  if (digest.matches) return computed ? "MATCH" : UNRECOGNISED;
  return computed ? "MISMATCH" : "NOT_COMPUTABLE";
}

/**
 * `{ outcome, reasons, recomputedDigest, mismatches }` -> the engine's outcome when it is one the vocabulary names AND
 * the other fields agree with it (replay.ts): REPRODUCED carries a recomputed digest and no reason or section; MISMATCH
 * carries a recomputed digest, reasons and sections; UNREPLAYABLE carries reasons only (from the vocabulary's
 * unreplayable reasons when given), no digest and no section. Anything else is NOT_CARRIED (absent) or UNRECOGNISED.
 */
export function replayStatusOf(replay, outcomes, unreplayableReasons) {
  if (absent(replay)) return NOT_CARRIED;
  if (!isObj(replay) || typeof replay.outcome !== "string") return UNRECOGNISED;
  const outcome = replay.outcome;
  if (!(Array.isArray(outcomes) ? outcomes : []).includes(outcome)) return UNRECOGNISED;
  if (!Array.isArray(replay.reasons) || !Array.isArray(replay.mismatches)) return UNRECOGNISED;
  const digest = typeof replay.recomputedDigest === "string" && replay.recomputedDigest !== "";
  if (outcome === "REPRODUCED") return replay.reasons.length === 0 && replay.mismatches.length === 0 && digest ? outcome : UNRECOGNISED;
  if (outcome === "MISMATCH") return replay.reasons.length > 0 && replay.mismatches.length > 0 && digest ? outcome : UNRECOGNISED;
  if (outcome === "UNREPLAYABLE") {
    if (replay.recomputedDigest !== null || replay.mismatches.length !== 0 || replay.reasons.length === 0) return UNRECOGNISED;
    if (Array.isArray(unreplayableReasons) && !replay.reasons.every((x) => unreplayableReasons.includes(x))) return UNRECOGNISED;
    return outcome;
  }
  return outcome;
}

/** Results that mean "no result": neutral, never an attention mark. Absence is not failure. */
const NEUTRAL_RESULTS = ["UNAVAILABLE", "UNCHECKED", "NOT_CARRIED", "NO_DIGEST", "UNREPLAYABLE"];

/** The compact status mark of a check: the chip component, with the result written in words and never colour alone. */
function resultChip(status) {
  if (status === NOT_CARRIED) return '<span class="chip" data-state="NA">not carried</span>';
  if (status === UNRECOGNISED) return '<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span>';
  if (status === "NO_DIGEST") return '<span class="chip" data-state="NO_DIGEST">no digest</span>';
  if (status === "NOT_COMPUTABLE") return '<span class="chip" data-attention="true" data-state="NOT_COMPUTABLE">not computable</span>';
  return chip(status, [status], NEUTRAL_RESULTS.includes(status) ? false : undefined);
}

/**
 * The replay outcome chip: the engine's word when the result is recognised; an outcome outside the vocabulary is shown
 * with its value; an in-vocabulary outcome whose fields contradict it is "not recognised" without the word, so an
 * inconsistent result never reads as calm; absence is absence.
 */
function replayChip(m, vocabulary) {
  if (m.replayStatus === NOT_CARRIED) return '<span class="chip" data-state="NA">not carried</span>';
  const outcome = isObj(m.replay) ? m.replay.outcome : null;
  if (typeof outcome !== "string") return '<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span>';
  if (m.replayStatus === UNRECOGNISED && list(vocabulary.replayOutcomes).includes(outcome)) return '<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span>';
  return chip(outcome, vocabulary.replayOutcomes, outcome === "UNREPLAYABLE" ? false : undefined);
}

/** How a synthetic fixture was constructed, printed on its fixture line so an adversarial scenario is never mistaken for an engine-built one. */
export const SCENARIO_LABELS = {
  ENGINE_BUILT: "every record of this lineage was built by the engine from its synthetic evidence",
  COMMITTED_ELSEWHERE: "this record was built by the engine, then one field was changed and the record re-digested before commit, as a record from another engine would be",
  ALTERED_AFTER_COMMIT: "this record was built and committed by the engine; the copy disclosed here was changed afterwards without re-digesting",
  VERIFICATION_NOT_CARRIED: "every record of this lineage was built by the engine and its receipt was issued by the engine; the receipt's verification result was left out of this disclosure, so no check result is carried",
};

const ATTENTION_FREE = ["ESTABLISHED", "SUPPORTED", "CURRENT", "PINNED", "FINALIZED", "COMMITTED", "DISCLOSED", "REPRODUCED", "MATCH", "VALID"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : null);
const ADDRESS_KEYS = new Set(["address", "token", "holder"]);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A label from a fixed table, only for a key the table itself names: a prototype key or an unknown code gets nothing. */
const lookup = (table, key) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

/** Characters that steer display without being visible: C0 controls, DEL, the bidirectional marks, embeddings, overrides and isolates. */
function controlCount(value) {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127 || c === 8206 || c === 8207 || (c >= 8234 && c <= 8238) || (c >= 8294 && c <= 8297)) n++;
  }
  return n;
}

/**
 * Disclosure currency, read from a recognised lifecycle state only: CORRECTED, SUPERSEDED and WITHDRAWN records are not
 * the current record; an absent or unrecognised state asserts nothing either way.
 */
function currency(m, vocabulary) {
  const state = m.lifecycle.state;
  const known = typeof state === "string" && list(vocabulary.lifecycleStates).includes(state);
  return { state, known, superseded: known && (state === "CORRECTED" || state === "SUPERSEDED" || state === "WITHDRAWN") };
}

function chip(value, allowed, attentionOverride) {
  if (value === null || value === undefined) return '<span class="chip" data-state="NA">N/A</span>';
  if (!allowed.includes(value)) {
    // The chip is cut for the eye; a longer value is also printed in full beside it, so two unrecognised values never read the same.
    const s = String(value);
    return `<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised: ${esc(s.slice(0, 24))}</span>${s.length > 24 ? ` <code class="wp-unrecognised">${esc(s)}</code>` : ""}`;
  }
  const attention = attentionOverride === undefined ? !ATTENTION_FREE.includes(value) : attentionOverride;
  return `<span class="chip" data-state="${esc(value)}"${attention ? ' data-attention="true"' : ""}>${esc(value)}</span>`;
}

/** An exact value: full, monospace, selectable, with a copy control that copies exactly the printed text. Absence is said. */
function exact(value, label) {
  if (typeof value !== "string" || value === "") return '<span class="muted">not carried</span>';
  // A value is printed and copied exactly as carried. Characters that steer display (controls, bidirectional marks) are
  // counted and said beside it, so a reversed or spoofed rendering is never silent; the stylesheet isolates the run.
  const n = controlCount(value);
  const note = n ? ` <span class="wp-controls muted small">contains ${n} control or direction character${n === 1 ? "" : "s"}, shown as carried</span>` : "";
  return `<span class="wp-copyable"><code class="wp-exact">${esc(value)}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full ${esc(label)}">Copy</button>${note}</span>`;
}

/** The link between a successor and its predecessor, in words, only for the kinds the engine names. */
function linkVerb(kind, past) {
  if (kind === "CORRECTION") return past ? "corrected" : "corrects";
  if (kind === "SUPERSESSION") return past ? "superseded" : "supersedes";
  return past ? "linked (kind not recognised)" : "links to (kind not recognised)";
}

const instant = (value) => (typeof value === "string" ? `<time datetime="${esc(value)}"><code>${esc(value)}</code></time>` : '<span class="muted">not stated</span>');

/** An address, exactly as recorded, with the chain beside it; the copy controls are the canvas's own (client.mjs). */
function address(key, value, chainId) {
  const stated = typeof chainId === "string" && chainId !== "";
  const context = stated ? `chain ID ${esc(chainId)}` : "chain not stated";
  const withChain = stated ? `<button type="button" class="copy" data-copy-chain-address aria-label="Copy the chain ID and the full ${esc(key)} value (${context})">Copy chain + address</button>` : "";
  return `<span class="addr" data-chain="${stated ? esc(chainId) : ""}"><code class="addr-full">${esc(value)}</code><span class="addr-ctx muted small">${context}</span><button type="button" class="copy" data-copy-address aria-label="Copy the full ${esc(key)} value (${context})">Copy</button>${withChain}</span>`;
}

/** A flat record (subject, value, identity) as a definition list; addresses get the address treatment. */
function flat(rec, chainId) {
  if (rec === null || rec === undefined) return '<span class="muted">none</span>';
  if (!isObject(rec)) return `<code>${esc(rec)}</code>`;
  const entries = Object.entries(rec);
  if (entries.length === 0) return '<span class="muted">empty</span>';
  const chain = chainId ?? str(rec.chainId) ?? undefined;
  return `<dl class="kv wp-kv">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${typeof v === "string" && (ADDRESS_KEYS.has(k) || EVM_ADDRESS.test(v)) ? address(k, v, chain) : isObject(v) ? flat(v, chain) : `<code>${esc(v)}</code>`}</dd></div>`).join("")}</dl>`;
}

function codes(values, labels) {
  const xs = list(values);
  if (xs.length === 0) return null;
  return `<ul class="limits wp-codes">${xs.map((c) => `<li><code>${esc(c)}</code>${labels && lookup(labels, c) ? ` <span class="muted">${esc(lookup(labels, c))}</span>` : ""}</li>`).join("")}</ul>`;
}

// ─── view model ──────────────────────────────────────────────────────────────

/**
 * Projects one disclosure record into what the document prints. Every field is copied or labelled; nothing is derived
 * beyond "is this value one the engine's vocabulary names" and "do the recorded assessment codes differ".
 */
export function recordViewModel(entry, index, fixture, vocabulary) {
  const rec = isObject(entry.record) ? entry.record : {};
  const subject = isObject(rec.subject) ? rec.subject : {};
  const claims = list(rec.claims);
  const focal = claims.find((c) => isObject(c) && c.assertionId === subject.focalAssertionId) ?? null;
  const assessments = list(rec.assessments).filter(isObject);
  const walletwall = assessments.find((a) => a.assessorRole === "WALLETWALL") ?? null;
  const versions = isObject(rec.versions) ? rec.versions : {};
  const evidence = isObject(rec.evidence) ? rec.evidence : {};
  const items = list(evidence.items).filter(isObject);
  const provenance = isObject(rec.provenance) ? rec.provenance : {};
  const lineage = list(provenance.lineage).filter(isObject);
  const lifecycle = isObject(entry.lifecycle) ? entry.lifecycle : { state: null, events: [] };
  const events = list(lifecycle.events).filter(isObject);
  const registry = isObject(fixture.registry) ? fixture.registry : { asset: null, chain: null };
  const identity = isObject(subject.identity) ? subject.identity : {};
  const chainId = str(identity.chainId);
  const symbolPresented = focal && isObject(focal.value) ? str(focal.value.symbol) : null;
  const claimType = str(subject.claimType);
  const claimLabel = lookup(CLAIM_LABELS, claimType) ?? (claimType === null ? "Claim" : `not recognised: ${claimType.slice(0, 24)}`);
  const chainName = registry.chain ? str(registry.chain.name) : null;
  const chainIds = isObject(entry.lineage) ? list(entry.lineage.chain).map(String) : [];
  const position = chainIds.indexOf(String(entry.id));
  const replay = isObject(entry.replay) ? entry.replay : { outcome: null, reasons: [], recomputedDigest: null, mismatches: [] };
  const receipt = isObject(entry.receipt) ? entry.receipt : { issued: null, verification: null };
  // Absence is absence: a missing digest check or validation result is "not carried", never a failed check.
  const digest = isObject(entry.digest) ? entry.digest : null;
  const validation = isObject(entry.validation) ? entry.validation : null;
  const verification = isObject(receipt.verification) ? receipt.verification : null;
  // The four verification results, each a 1:1 projection of the engine's output (see the projections above): nothing is
  // recomputed, absence stays absence, and a result the document does not recognise is shown as such, never as MATCH.
  const receiptStatus = receiptStatusOf(entry.receipt);
  // The title is what the record carries: the presented symbol for an identity claim, the claim type otherwise. The
  // registry's point-in-time names are a labelled subtitle, never the title.
  const title = claimType === "ASSET_IDENTITY" && symbolPresented !== null ? symbolPresented : claimLabel;
  return {
    id: str(rec.id) ?? str(entry.id) ?? "",
    index,
    // Version labels follow the recorded lineage order, root first; the array position is only a fallback.
    total: chainIds.length > 0 ? chainIds.length : list(fixture.records).length,
    version: `v${(position >= 0 ? position : index) + 1}`,
    focused: entry.id === fixture.focus,
    title,
    claimLabel,
    claimType,
    temporality: str(subject.temporality),
    focalAssertionId: str(subject.focalAssertionId),
    identity,
    chainId,
    chainName,
    symbolPresented,
    registry,
    snapshotAt: str(rec.snapshotAt),
    assessment: { code: walletwall ? str(walletwall.assessment) : null, known: walletwall !== null && vocabulary.supportStates.includes(walletwall.assessment) },
    focal,
    conflicts: list(rec.conflicts).filter(isObject),
    violations: list(rec.violations).filter(isObject),
    limitationsUnion: list(rec.limitations),
    lifecycle: { state: str(lifecycle.state), events, rows: vocabulary.lifecycleStates.map((state) => ({ state, event: events.find((e) => e.state === state) ?? null })) },
    assessments,
    stages: [
      { key: "source", title: "Source", entries: items.filter((i) => i.kind === "SOURCE").map((i) => ({ id: String(i.id), sub: "referenced by digest" })), note: "The record references each source by id and digest. Which source reported which observation stays in the evidence bundle, not in the record." },
      { key: "observation", title: "Observation", entries: lineage.filter((l) => l.kind === "observation").map((l) => ({ id: String(l.id), sub: `depth ${String(l.depth)}` })), note: null },
      { key: "assertion", title: "Assertion", entries: lineage.filter((l) => l.kind === "assertion").map((l) => ({ id: String(l.id), sub: l.id === provenance.target ? "focal claim" : `depth ${String(l.depth)}` })), note: null },
      { key: "derivation", title: "Derivation", entries: items.filter((i) => i.kind === "DERIVATION").map((i) => ({ id: String(i.id), sub: "referenced by digest" })), note: null },
      { key: "assessment", title: "Assessment", entries: assessments.map((a) => ({ id: String(a.assessor), sub: String(a.assessment) })), note: null },
    ],
    provenanceIssues: list(provenance.issues).filter(isObject),
    ruleVersions: isObject(rec.ruleVersions) ? rec.ruleVersions : {},
    policyVersions: isObject(rec.policyVersions) ? rec.policyVersions : {},
    versions,
    evidenceCounts: ["SOURCE", "OBSERVATION", "ASSERTION", "DERIVATION"].map((kind) => ({ kind, count: items.filter((i) => i.kind === kind).length })),
    bundleDigest: str(evidence.bundleDigest),
    digestEmbedded: str(rec.digest),
    digest,
    validation,
    receipt: { issued: isObject(receipt.issued) ? receipt.issued : null, verification },
    receiptStatus,
    recordStatus: recordStatusOf(entry.validation),
    digestStatus: digestStatusOf(entry.digest),
    replayStatus: replayStatusOf(entry.replay, vocabulary.replayOutcomes, vocabulary.unreplayableReasons),
    replay,
    supersedes: isObject(entry.supersedes) ? entry.supersedes : null,
    supersededBy: isObject(entry.supersededBy) ? entry.supersededBy : null,
    lineageChain: chainIds,
    diff: isObject(entry.diff) ? entry.diff : null,
    canonical: str(entry.canonical),
    wallprintVersion: str(rec.wallprintVersion),
    canonicalization: str(rec.canonicalization),
    digestAlgorithm: str(rec.digestAlgorithm),
    reference: committedReference(entry, rec, events),
  };
}

/**
 * The portable reference of a record: its id, the digest its COMMITTED lifecycle event recorded (the committed digest,
 * from the engine's ledger, not the disclosed copy's own field) and its WallPrint version. A disclosure that carries no
 * committed identity for this record gets no reference and no QR code: the prerequisite is named instead. Nothing here
 * is computed beyond reading the three recorded values; the codec refuses them unless each has its fixed shape.
 */
function committedReference(entry, rec, events) {
  const committed = events.find((e) => e.state === "COMMITTED") ?? null;
  if (committed === null || committed.recordId !== entry.id || str(rec.id) !== entry.id) return null;
  return tryReference({ recordId: committed.recordId, digest: committed.recordDigest, wallprintVersion: rec.wallprintVersion });
}

export function wallPrintViewModel(name, fixture, vocabulary, focus = null) {
  const records = list(fixture.records).filter(isObject);
  const models = records.map((entry, i) => recordViewModel(entry, i, { ...fixture, focus: typeof focus === "string" ? focus : fixture.focus }, vocabulary));
  // A focus that names no record would hide every article: the first record is shown instead, and the view says which.
  const first = models[0];
  if (first !== undefined && !models.some((m) => m.focused)) first.focused = true;
  const scenario = isObject(fixture.scenario) ? fixture.scenario : null;
  return {
    name,
    title: str(fixture.title) ?? "",
    focus: models.find((m) => m.focused)?.id ?? null,
    registry: isObject(fixture.registry) ? fixture.registry : { asset: null, chain: null },
    scenario: scenario === null ? null : { kind: str(scenario.kind), patched: list(scenario.patched).map(String), label: lookup(SCENARIO_LABELS, str(scenario.kind)) ?? null },
    records: models,
  };
}

// ─── rendering ───────────────────────────────────────────────────────────────

function head(m, vocabulary, labels) {
  const asset = m.registry.asset;
  const chain = `${asset ? `${esc(asset.symbol)} ${esc(asset.name)} <span class="muted">(registry record, point in time)</span> · ` : ""}${m.chainName ? `${esc(m.chainName)} <span class="muted">(registry name, point in time) · chain ID <code>${esc(m.chainId)}</code></span>` : m.chainId ? `chain ID <code>${esc(m.chainId)}</code>` : '<span class="muted">chain not stated</span>'}`;
  const assessment = m.assessment.code === null ? '<span class="chip" data-state="NA" data-attention="true">no WalletWall assessment recorded</span>' : m.assessment.known ? `<span class="wp-assessment-word" data-state="${esc(m.assessment.code)}"${ATTENTION_FREE.includes(m.assessment.code) ? "" : ' data-attention="true"'}>${esc(m.assessment.code)}</span>` : `<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised: ${esc(m.assessment.code.slice(0, 24))}</span>`;
  const hint = m.assessment.known ? lookup(labels.SUPPORT_HINTS, m.assessment.code) ?? "" : "";
  // A record that is no longer the current disclosure says so beside its assessment: lifecycle is disclosure metadata and
  // changes no evidence state, but a reader must never take a corrected, superseded or withdrawn record for the current one.
  // Every event that takes the record out of currency is named: the successor link and, separately, a withdrawal. Only a
  // recognised CORRECTED, SUPERSEDED or WITHDRAWN state says "not current"; absence or an unrecognised value asserts nothing.
  const linked = m.lifecycle.events.find((e) => e.ref !== null && isObject(e.ref)) ?? null;
  const withdrawn = m.lifecycle.events.find((e) => e.state === "WITHDRAWN") ?? null;
  const life = currency(m, vocabulary);
  const standing = life.superseded
    ? `<p class="note wp-standing" data-attention="true">This record's lifecycle is <code>${esc(life.state)}</code>${linked ? ` (${esc(linkVerb(linked.ref.kind, true))} by <code>${esc(linked.ref.id)}</code>${linked.reason ? `: <span class="wp-reason-inline">${esc(linked.reason)}</span>` : ""})` : ""}${withdrawn ? `${linked ? "; withdrawn" : ""}${withdrawn.reason ? `: <span class="wp-reason-inline">${esc(withdrawn.reason)}</span>` : ""}` : ""}. The assessment above is what this record carried at its snapshot; a lifecycle state is disclosure metadata and changes no evidence state.</p>`
    : "";
  const eyebrow = life.superseded ? "WalletWall assessment as recorded (not the current record)" : life.known ? "Current WalletWall assessment" : life.state === null ? "WalletWall assessment as recorded (lifecycle not carried)" : "WalletWall assessment as recorded (lifecycle not recognised)";
  return `<header class="wp-head">
<div class="wp-head-top"><svg class="wp-reg wp-rise" data-wp-step="0" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="6.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></svg><p class="wp-eyebrow wp-rise" data-wp-step="0">WallPrint · disclosure record</p><p class="wp-id wp-rise" data-wp-step="0"><span class="ww-sr">WallPrint id </span>${exact(m.id, "WallPrint id")}<span class="wp-version-of muted small">${esc(m.version)} of ${esc(String(m.total))}</span></p></div>
<div class="wp-identity wp-rise" data-wp-step="1"><h2 id="wp-h-${esc(m.id)}" class="wp-title">${esc(m.title)}</h2><p class="wp-subtitle">${esc(m.claimLabel)}${m.temporality ? ` · <code>${esc(m.temporality)}</code>` : ""} · ${chain}</p>${m.symbolPresented && m.registry.asset && m.symbolPresented !== m.registry.asset.symbol ? `<p class="note" data-attention="true">The symbol as presented, <code>${esc(m.symbolPresented)}</code>, differs from the registry symbol <code>${esc(m.registry.asset.symbol)}</code>. A symbol is not an identity.</p>` : ""}<div class="wp-subject-record"><p class="wp-eyebrow">Subject identity, as recorded</p>${flat(m.identity, m.chainId ?? undefined)}</div></div>
<div class="wp-current wp-rise" data-wp-step="2"><p class="wp-eyebrow">${eyebrow}</p><p class="wp-assessment">${assessment}</p>${hint ? `<p class="wp-assessment-hint">${esc(hint)}</p>` : ""}<p class="wp-principle">${esc(vocabulary.principle)}</p><p class="wp-status-line"><span class="wp-eyebrow-inline">Lifecycle</span> ${chip(m.lifecycle.state, vocabulary.lifecycleStates)} <span class="wp-eyebrow-inline">Snapshot</span> ${instant(m.snapshotAt)}</p>${standing}</div>
${jump(m)}
</header>`;
}

/** Local section controls: one real button per section of this record, each naming its server-rendered target. */
function jump(m) {
  // A jump moves focus; it controls nothing, so the target is named by a data attribute rather than aria-controls.
  return `<nav class="wp-jump wp-rise" data-wp-step="2" aria-label="Go to a section of this record">${WALLPRINT_SECTIONS.map((key) => `<button type="button" data-wp-jump="${key}" data-wp-for="wp-sec-${key}-${esc(m.id)}">${SECTION_LABELS[key]}</button>`).join("")}</nav>`;
}

function why(m, vocabulary, labels) {
  const f = m.focal;
  if (f === null) return `<section class="wp-why wp-rise" data-wp-step="3" aria-labelledby="wp-why-${esc(m.id)}"><h3 id="wp-why-${esc(m.id)}">Why WalletWall says this</h3><p class="note" data-attention="true">The record's focal assertion id matches none of the claims it carries. Nothing is shown in its place.</p></section>`;
  const fact = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const auth = isObject(f.authority) ? f.authority : null;
  const focalConflicts = list(f.conflictsWith);
  const conflicts = m.conflicts.map((c) => `<li><code>${esc(c.cause)}</code> between ${list(c.assertionIds).map((id) => `<code>${esc(id)}</code>`).join(", ")}</li>`);
  const limitations = codes(f.limitations, labels.LIMITATION_LABELS);
  const others = m.limitationsUnion.filter((l) => !list(f.limitations).includes(l));
  const violations = m.violations.map((v) => `<li><code>${esc(v.invariant)}</code> <code>${esc(v.code)}</code>${v.assertionId ? ` on <code>${esc(v.assertionId)}</code>` : ""}</li>`);
  const diagnostics = list(f.diagnostics).filter(isObject).map((d) => `<li><code>${esc(d.limitation)}</code> in <code>${esc(d.record)}</code>${d.observationId ? ` (observation <code>${esc(d.observationId)}</code>)` : ""}${list(d.missingKeys).length ? ` · missing ${list(d.missingKeys).map((k) => `<code>${esc(k)}</code>`).join(", ")}` : ""}${list(d.mismatchedKeys).length ? ` · mismatched ${list(d.mismatchedKeys).map((k) => `<code>${esc(k)}</code>`).join(", ")}` : ""}</li>`);
  return `<section class="wp-why wp-rise" data-wp-step="3" aria-labelledby="wp-why-${esc(m.id)}"><h3 id="wp-why-${esc(m.id)}">Why WalletWall says this</h3>
<p class="muted small">Explanatory views over the record's focal claim <code>${esc(f.assertionId)}</code>, exactly as the engine evaluated it. Nothing here is recomputed.</p>
<dl class="states wp-facts">
${fact("Support", `${chip(f.supportState, vocabulary.supportStates)}${vocabulary.supportStates.includes(f.supportState) && labels.SUPPORT_HINTS[f.supportState] ? ` <span class="muted small">${esc(labels.SUPPORT_HINTS[f.supportState])}</span>` : ""}`)}
${fact("Source authority", auth ? `<code>${esc(auth.kind)}</code> · <code>${esc(auth.authorityId)}</code> · requirement ${auth.satisfied === true ? "satisfied" : auth.satisfied === false ? "not satisfied" : "not stated"}` : '<span class="muted">no authority defined for this claim type</span>')}
${fact("Freshness", `${chip(f.freshnessState, vocabulary.freshnessStates)}${vocabulary.freshnessStates.includes(f.freshnessState) && labels.FRESHNESS_HINTS[f.freshnessState] ? ` <span class="muted small">${esc(labels.FRESHNESS_HINTS[f.freshnessState])}</span>` : ""}`)}
${fact("Finality", f.finalityState === null ? '<span class="chip" data-state="NA">N/A</span> <span class="muted small">does not apply to this claim type</span>' : `${chip(f.finalityState, vocabulary.finalityStates)}${vocabulary.finalityStates.includes(f.finalityState) && labels.FINALITY_HINTS[f.finalityState] ? ` <span class="muted small">${esc(labels.FINALITY_HINTS[f.finalityState])}</span>` : ""}`)}
${fact("Independent corroboration", f.independentCorroboration === null || f.independentCorroboration === undefined ? '<span class="muted">not recorded for this claim</span>' : `<code>${esc(f.independentCorroboration)}</code> <span class="muted small">distinct independence groups counted by the engine; provider multiplicity is not independent corroboration</span>`)}
${fact("Conflicts", conflicts.length ? `<ul class="limits wp-codes">${conflicts.join("")}</ul><p class="muted small">Conflicts are recorded, never resolved: no side is ranked above the other.</p>` : `<span class="muted">none reported</span>${focalConflicts.length ? ` <span class="muted small">(focal claim conflicts with ${focalConflicts.map((id) => `<code>${esc(id)}</code>`).join(", ")})</span>` : ""}`)}
${fact("Superseded by", f.supersededBy ? `<code>${esc(f.supersededBy)}</code>` : '<span class="muted">not superseded within the bundle</span>')}
${fact("Policy", f.policyId ? `<code>${esc(f.policyId)}</code>` : '<span class="muted">none</span>')}
</dl>
<div class="wp-limitations"><h4>Limitations</h4>${limitations ?? '<p class="muted">No limitation codes were returned for the focal claim.</p>'}${others.length ? `<p class="muted small">Other claims in this record also carry: ${others.map((l) => `<code>${esc(l)}</code>`).join(", ")}.</p>` : ""}<p class="muted small">Limitations qualify every state above. They are never hidden.</p></div>
${diagnostics.length ? `<div class="wp-diagnostics"><h4>Diagnostics</h4><ul class="limits wp-codes">${diagnostics.join("")}</ul></div>` : ""}
<div class="wp-violations"><h4>Invariant violations</h4>${violations.length ? `<ul class="limits wp-codes">${violations.join("")}</ul>` : '<p class="muted">None recorded.</p>'}</div>
</section>`;
}

function recordBox(m) {
  const rows = m.lifecycle.rows.map(({ state, event }) => {
    const reached = event !== null;
    const attention = reached && !ATTENTION_FREE.includes(state);
    const detail = reached ? `${instant(event.at)}${event.reason ? `<span class="wp-reason">${esc(event.reason)}</span>` : ""}${event.ref && isObject(event.ref) ? `<span class="wp-ref muted small">by <code>${esc(event.ref.id)}</code> (${esc(event.ref.kind)})</span>` : ""}` : '<span class="muted small">not reached</span>';
    return `<li class="wp-ledger-row" data-reached="${reached}"${attention ? ' data-attention="true"' : ""}><span class="wp-dot" aria-hidden="true">${reached ? "●" : "○"}</span><span class="wp-ledger-state"><code>${esc(state)}</code><span class="ww-sr">${reached ? " reached" : " not reached"}</span></span><span class="wp-ledger-detail">${detail}</span><span class="wp-ledger-hint muted small">${esc(lookup(LIFECYCLE_HINTS, state) ?? "")}</span></li>`;
  });
  const chain = m.lifecycle.events.map((e) => `<li><code>${esc(e.seq)}</code> <code>${esc(e.state)}</code> at ${instant(e.at)} · event digest <code>${esc(e.eventDigest)}</code>${e.previousEventDigest ? ` · previous <code>${esc(e.previousEventDigest)}</code>` : " · first event"}</li>`);
  return `<section class="wp-recordbox wp-rise" data-wp-step="3" aria-labelledby="wp-rec-${esc(m.id)}"><h3 id="wp-rec-${esc(m.id)}">Record</h3>
<p class="muted small">Disclosure lifecycle, appended to the record's history. It is metadata about the record and never changes an evidence state.</p>
<ol class="wp-ledger" aria-label="Disclosure lifecycle">${rows.join("")}</ol>
<dl class="states wp-facts"><div><dt>Digest</dt><dd>${m.digestEmbedded ? exact(m.digestEmbedded, "record digest") : '<span class="muted">none</span>'}</dd></div><div><dt>Policy version</dt><dd>${m.versions.policies ? `<code>${esc(m.versions.policies)}</code>` : '<span class="muted">not stated</span>'}</dd></div><div><dt>WallPrint version</dt><dd>${m.wallprintVersion ? `<code>${esc(m.wallprintVersion)}</code>` : '<span class="muted">not stated</span>'}</dd></div></dl>
<details class="wp-more"><summary>Hash-chained events (${chain.length})</summary><ul class="limits wp-codes">${chain.join("") || '<li class="muted">none</li>'}</ul></details>
</section>`;
}

function assessmentsTable(m, vocabulary) {
  const rows = m.assessments.map((a) => {
    const role = lookup(ASSESSOR_ROLE_LABELS, a.assessorRole) ?? `not recognised: ${String(a.assessorRole).slice(0, 24)}`;
    const walletwall = a.assessorRole === "WALLETWALL";
    const code = walletwall ? chip(a.assessment, vocabulary.supportStates) : `<code class="wp-attributed" data-attributed="true">${esc(a.assessment)}</code> <span class="muted small">as stated</span>`;
    const lims = list(a.limitations);
    return `<tr role="row"><th role="rowheader" scope="row"><code>${esc(a.assessor)}</code></th><td role="cell" data-label="Role">${esc(role)}</td><td role="cell" data-label="Assessment">${code}</td><td role="cell" data-label="Policy"><code>${esc(a.policy)}</code></td><td role="cell" data-label="Policy version"><code>${esc(a.policyVersion)}</code></td><td role="cell" data-label="Assessed">${instant(a.assessedAt)}</td><td role="cell" data-label="Limitations">${lims.length ? lims.map((l) => `<code>${esc(l)}</code>`).join(" ") : '<span class="muted">none</span>'}</td><td role="cell" data-label="Statement">${typeof a.statement === "string" ? `<q class="wp-attributed" data-attributed="true">${esc(a.statement)}</q>` : '<span class="muted">no statement</span>'}</td></tr>`;
  });
  return `<section class="wp-assessments wp-rise" data-wp-step="4" aria-labelledby="wp-as-${esc(m.id)}" data-wp-target="assessments" id="wp-sec-assessments-${esc(m.id)}"><h3 id="wp-as-${esc(m.id)}">Assessments</h3>
<p class="muted small">One row per named assessor and policy, as recorded. WalletWall's row is the focal claim's evaluated support state; every other row is an attributed statement, recorded verbatim. Absence of an assessment is not a failed assessment.</p>
<div class="ww-table-wrap"><table class="wp-table" role="table" aria-label="Assessments"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Assessor</th><th role="columnheader" scope="col">Role</th><th role="columnheader" scope="col">Assessment</th><th role="columnheader" scope="col">Policy</th><th role="columnheader" scope="col">Policy version</th><th role="columnheader" scope="col">Assessed</th><th role="columnheader" scope="col">Limitations</th><th role="columnheader" scope="col">Statement</th></tr></thead><tbody role="rowgroup">${rows.join("") || '<tr role="row"><td role="cell" colspan="8" class="muted">No assessment recorded.</td></tr>'}</tbody></table></div>
<p class="wp-assessments-note">${m.assessments.length === 1 ? "One assessment is recorded: WalletWall's own." : `${esc(String(m.assessments.length))} assessments are recorded, each under its own policy and in its own vocabulary.`} WallPrint compares none of them, ranks none above another and computes no consensus. Agreement between assessors is not independent corroboration of the evidence.</p>
</section>`;
}

function provenanceChain(m) {
  const stages = m.stages.map((s, i) => `<li class="wp-stage" data-stage="${esc(s.key)}" data-present="${s.entries.length > 0}"><span class="wp-stage-mark" aria-hidden="true"></span><span class="wp-stage-title">${esc(s.title)}</span>${s.entries.length ? `<ul class="wp-stage-entries">${s.entries.map((e) => `<li><code>${esc(e.id)}</code> <span class="muted small">${esc(e.sub)}</span></li>`).join("")}</ul>` : '<p class="wp-stage-empty muted small">none in this record</p>'}${s.note ? `<p class="wp-stage-note muted small">${esc(s.note)}</p>` : ""}${i < m.stages.length - 1 ? '<span class="ww-sr">, then </span>' : ""}</li>`);
  const issues = m.provenanceIssues.map((i) => `<li><code>${esc(i.code)}</code>${i.id ? ` <code>${esc(i.id)}</code>` : ""}</li>`);
  return `<section class="wp-provenance wp-rise" data-wp-step="4" aria-labelledby="wp-prov-${esc(m.id)}" data-wp-target="provenance" id="wp-sec-provenance-${esc(m.id)}"><h3 id="wp-prov-${esc(m.id)}">Provenance</h3>
<p class="muted small">The lineage the engine traced for the focal claim <code>${esc(m.focalAssertionId ?? "")}</code>, with the evidence references the record carries. A stage the record does not carry is shown empty, never filled in.</p>
<ol class="wp-chain" aria-label="Provenance chain, from source to assessment">${stages.join("")}</ol>
${issues.length ? `<div class="note" data-attention="true"><p>Provenance is incomplete:</p><ul class="limits wp-codes">${issues.join("")}</ul></div>` : ""}
</section>`;
}

function diffGroups(m, vocabulary) {
  if (m.diff === null) return "";
  const changes = list(m.diff.changes).filter(isObject);
  if (!m.diff.changed || changes.length === 0) return '<p class="muted small">The semantic diff against the predecessor is empty.</p>';
  const groups = vocabulary.diffCategories.map((category) => ({ category, changes: changes.filter((c) => c.category === category) })).filter((g) => g.changes.length > 0);
  const cell = (v) => (v === null || v === undefined ? '<span class="muted">absent</span>' : `<code>${esc(v)}</code>`);
  return `<div class="wp-diff"><h4>What changed, by category</h4><p class="muted small">The engine's semantic diff against the predecessor: record data only, grouped by category. It is not a text diff.</p>${groups
    .map(
      (g) =>
        `<details class="wp-diff-group wp-more" open><summary>${esc(DIFF_CATEGORY_LABELS[g.category] ?? g.category)} <span class="muted">(${g.changes.length})</span></summary><div class="ww-table-wrap"><table class="wp-table" role="table" aria-label="${esc(DIFF_CATEGORY_LABELS[g.category] ?? g.category)} changes"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Path</th><th role="columnheader" scope="col">Before</th><th role="columnheader" scope="col">After</th><th role="columnheader" scope="col">Reason</th></tr></thead><tbody role="rowgroup">${g.changes
          .map((c) => `<tr role="row"><th role="rowheader" scope="row"><code>${esc(c.path)}</code></th><td role="cell" data-label="Before">${cell(c.before)}</td><td role="cell" data-label="After">${cell(c.after)}</td><td role="cell" data-label="Reason">${c.reason ? `<code>${esc(c.reason)}</code>` : '<span class="muted">—</span>'}</td></tr>`)
          .join("")}</tbody></table></div></details>`,
    )
    .join("")}</div>`;
}

function history(m, vm, vocabulary) {
  const byId = new Map(vm.records.map((r) => [r.id, r]));
  const chain = m.lineageChain.length ? m.lineageChain : [m.id];
  const nodes = chain.map((id, i) => {
    const r = byId.get(id);
    const current = id === m.id;
    const link = r && r.supersedes ? r.supersedes : null;
    const state = r ? r.lifecycle.state : null;
    const sr = link ? ` ${esc(linkVerb(link.kind, false))} ${esc(link.id)}` : i === 0 ? " root record" : "";
    return `<li class="wp-lineage-node" data-current="${current}"${link ? ` data-link="${esc(link.kind)}"` : ""}>${link ? `<span class="wp-lineage-arrow" aria-hidden="true"></span>` : ""}<button type="button" class="wp-version" data-wp-version="${esc(id)}"${current ? ' aria-current="true"' : ""}><span class="wp-version-label">${esc(r ? r.version : id)}</span><span class="ww-sr">${sr}, lifecycle </span>${state ? chip(state, vocabulary.lifecycleStates) : '<span class="chip" data-state="NA">unknown</span>'}<span class="wp-version-id"><code>${esc(id)}</code></span></button>${link ? `<p class="wp-link"><code>${esc(link.kind)}</code>${link.reason ? ` <span class="wp-reason">${esc(link.reason)}</span>` : ' <span class="muted small">no reason stated</span>'}</p>` : ""}</li>`;
  });
  const own = m.supersedes ? `<p>This record <strong>${esc(linkVerb(m.supersedes.kind, false))}</strong> <code>${esc(m.supersedes.id)}</code> and binds that record's committed digest <code>${esc(m.supersedes.digest)}</code>${m.supersedes.reason ? `. Stated reason: <span class="wp-reason-inline">${esc(m.supersedes.reason)}</span>` : "."} The earlier record stays committed and selectable above.</p>` : "";
  const by = m.supersededBy ? `<p data-attention="true" class="note">This record was <strong>${esc(linkVerb(m.supersededBy.kind, true))}</strong> by <code>${esc(m.supersededBy.id)}</code> (successor digest <code>${esc(m.supersededBy.digest)}</code>). The history appended that event to this record; it did not rewrite or remove the record. Whether the bytes shown here are its committed bytes is checked under Verify.</p>` : "";
  return `<section class="wp-history wp-rise" data-wp-step="4" aria-labelledby="wp-hist-${esc(m.id)}" data-wp-target="history" id="wp-sec-history-${esc(m.id)}"><h3 id="wp-hist-${esc(m.id)}">Corrections and supersessions</h3>
${chain.length > 1 ? '<p class="muted small">Every version of this lineage stays visible and selectable. A correction or supersession is a new record that binds the predecessor by digest; the predecessor is never edited or deleted.</p>' : '<p class="muted small">No correction or supersession is recorded for this lineage.</p>'}
<ol class="wp-lineage" aria-label="Lineage, root first">${nodes.join("")}</ol>
${own}${by}${diffGroups(m, vocabulary)}
</section>`;
}

/**
 * Verify: four separate questions (record, digest, receipt, replay), each answered only by the engine's recorded result,
 * then the registration readout (every identifier, digest, version and instant, exact and copyable) and the derivation
 * chain from the canonical payload to the commitment comparison. The questions are never combined into one state.
 */
function verify(m, vm, vocabulary) {
  const fact = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const notStated = '<span class="muted">not stated</span>';
  const code = (v) => (typeof v === "string" && v !== "" ? `<code>${esc(v)}</code>` : notStated);
  const map = (o) => {
    const entries = Object.entries(isObject(o) ? o : {});
    return entries.length ? `<ul class="limits wp-codes">${entries.map(([k, v]) => `<li><code>${esc(k)}</code> <code>${esc(v)}</code></li>`).join("")}</ul>` : '<span class="muted">none</span>';
  };
  const check = (key, no, title, status, chipHtml, meaning, body, extra = "") => `<li class="wp-check${key === "receipt" ? " wp-receipt" : key === "replay" ? " wp-replay" : ""}" data-check="${key}" ${key === "receipt" ? `data-receipt="${esc(status)}" data-wp-target="receipt" id="wp-sec-receipt-${esc(m.id)}"` : key === "replay" ? `data-replay="${esc(status)}" data-wp-target="replay" id="wp-sec-replay-${esc(m.id)}"` : `data-result="${esc(status)}"`}${extra}><h4 id="wp-ck-${key}-${esc(m.id)}"><span class="wp-check-no" aria-hidden="true">${no}</span>${title}</h4><p class="wp-check-q">${CHECK_QUESTIONS[key]}</p><p class="wp-check-a">${chipHtml} <span class="wp-check-meaning">${esc(meaning)}</span></p>${body}</li>`;

  // 1. Record: is this a structurally valid WallPrint record? The engine's validation result, or its absence.
  const findings = isObject(m.validation) ? list(m.validation.findings).filter(isObject).map((f) => `<li><code>${esc(f.code)}</code> at <code>${esc(f.path === "" ? "(record)" : f.path)}</code></li>`) : [];
  const recordCheck = check("record", "1", "Record", m.recordStatus, resultChip(m.recordStatus), lookup(RECORD_PRESENTATION, m.recordStatus) ?? "", m.recordStatus === "INVALID" ? `<ul class="limits wp-codes">${findings.join("")}</ul>` : "");

  // 2. Digest: do these canonical bytes produce the embedded digest? Self-consistency only; the receipt asks about commitment.
  const d = m.digest;
  const embedded = m.digestEmbedded ? exact(m.digestEmbedded, "record digest") : '<span class="muted">none</span>';
  const computed = isObject(d) && typeof d.computedDigest === "string" && d.computedDigest !== "" ? exact(d.computedDigest, "computed digest") : d === null ? '<span class="muted">not carried</span>' : '<span class="muted">could not be computed</span>';
  const digestFields = `<dl class="states wp-facts wp-check-fields"><div><dt>Embedded digest</dt><dd>${embedded}</dd></div><div><dt>Computed digest</dt><dd>${computed}</dd></div></dl>`;
  const digestCheck = check("digest", "2", "Digest", m.digestStatus, resultChip(m.digestStatus), lookup(DIGEST_PRESENTATION, m.digestStatus) ?? "", digestFields);

  // 3. Receipt: does the disclosed record match the committed record? The engine's verification, its fields, the boundary,
  //    and the other versions' receipts of this lineage, listed and never merged.
  const issued = m.receipt.issued;
  const rv = m.receipt.verification;
  const compared = m.receiptStatus === "MISMATCH" || m.receiptStatus === "MATCH";
  const receiptReasons = compared && rv ? codes(rv.reasons, RECEIPT_REASON_LABELS) : null;
  // `matches: false` returned before any comparison (the receipt or the record is not checkable) is told as not compared.
  const uncompared = m.receiptStatus === "MISMATCH" && list(rv && rv.reasons).every((x) => x === "RECORD_INVALID" || x === "RECEIPT_INVALID");
  const receiptMeaning = uncompared ? RECEIPT_PRESENTATION.MISMATCH_UNCOMPARED : lookup(RECEIPT_PRESENTATION, m.receiptStatus) ?? "";
  // The engine's own boolean is printed only when the result is one the document recognises; an inconsistent result never
  // leaks its optimistic half.
  const engineResult = compared ? `<code>matches: ${rv.matches ? "true" : "false"}</code>` : m.receiptStatus === UNRECOGNISED ? '<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span> <span class="muted small">the carried result is not in the engine&#39;s shape and is not shown</span>' : '<span class="muted">not carried</span>';
  const receiptFields = issued
    ? `<dl class="states wp-facts wp-receipt-fields"><div><dt>Receipt for record</dt><dd>${exact(str(issued.recordId), "receipt record id")}</dd></div><div><dt>Commitment digest (receipt)</dt><dd>${exact(str(issued.digest), "receipt digest")}</dd></div><div><dt>Embedded digest (record)</dt><dd>${embedded}</dd></div><div><dt>Receipt bundle digest</dt><dd>${exact(str(issued.bundleDigest), "receipt bundle digest")}</dd></div><div><dt>Receipt versions</dt><dd>${map(issued.versions)}</dd></div>${
        m.supersedes ? `<div><dt>Predecessor digest bound</dt><dd>${exact(str(m.supersedes.digest), "predecessor digest")} <span class="muted small">the committed digest of <code>${esc(m.supersedes.id)}</code>, bound by this record</span></dd></div>` : ""
      }<div><dt>Engine result</dt><dd>${engineResult}</dd></div></dl>`
    : '<p class="muted small">No receipt fields to show.</p>';
  const life = currency(m, vocabulary);
  const standing = issued && life.superseded ? `<p class="note wp-receipt-standing" data-attention="true">This receipt belongs to a record whose lifecycle is <code>${esc(life.state)}</code>: not the current record. A later version does not replace this commitment, and a withdrawal does not erase it.</p>` : "";
  const byId = new Map(vm.records.map((r) => [r.id, r]));
  const others = (m.lineageChain.length ? m.lineageChain.map((id) => byId.get(id)).filter((r) => r !== undefined) : vm.records).filter((r) => r.id !== m.id);
  const lineageReceipts = others.length
    ? `<div class="wp-receipt-lineage"><p class="wp-eyebrow">Receipts across this lineage</p><ul class="limits wp-codes">${others
        .map((r) => `<li><span class="wp-version-label">${esc(r.version)}</span> <code>${esc(r.id)}</code> · lifecycle ${chip(r.lifecycle.state, vocabulary.lifecycleStates)} · receipt ${resultChip(r.receiptStatus)} · <button type="button" class="wp-version-inline" data-wp-version="${esc(r.id)}" data-wp-then="receipt">Show ${esc(r.version)} receipt</button></li>`)
        .join("")}</ul><p class="muted small">Each version carries its own receipt; the receipts listed here belong to those versions and are never merged into this one.</p></div>`
    : "";
  // The boundary is a definition of what a match would mean, prefixed so that on a mismatch it never reads as an assertion.
  const boundary = `<p class="wp-boundary"><strong>What a matching receipt establishes:</strong> ${esc(vocabulary.receipt.establishes)} A matching receipt demonstrates consistency between this disclosed record and its commitment. A matching receipt does not establish ${list(vocabulary.receipt.doesNotEstablish).map((x) => esc(x)).join(", ")}.</p>`;
  const receiptCheck = check("receipt", "3", "Receipt", m.receiptStatus, resultChip(m.receiptStatus), receiptMeaning, `${standing}${receiptReasons ?? ""}${receiptFields}${lineageReceipts}${boundary}`);

  // 4. Replay: can the historical evaluation be reproduced under the recorded context? The engine's outcome and reasons.
  const r = m.replay;
  const outcome = str(r.outcome);
  const replayHint = m.replayStatus === NOT_CARRIED ? "No replay result is recorded." : m.replayStatus === UNRECOGNISED ? "The carried replay result is not in a form this document recognises. No result is shown." : lookup(REPLAY_OUTCOME_HINTS, outcome) ?? "";
  // A recognised result prints its reasons and fields; an inconsistent or absent one prints nothing in their place.
  const replayBody =
    m.replayStatus === UNRECOGNISED || m.replayStatus === NOT_CARRIED
      ? '<p class="muted small">The carried replay fields are not shown.</p>'
      : `${list(r.reasons).length ? `<p class="muted small">Reasons, as the engine reported them:</p>${codes(r.reasons, REPLAY_REASON_LABELS)}` : ""}<dl class="states wp-facts wp-check-fields"><div><dt>Recomputed digest</dt><dd>${typeof r.recomputedDigest === "string" && r.recomputedDigest !== "" ? exact(r.recomputedDigest, "recomputed digest") : '<span class="muted">nothing was recomputed</span>'}</dd></div><div><dt>Sections that differ</dt><dd>${list(r.mismatches).length ? list(r.mismatches).map((s) => `<code>${esc(s)}</code>`).join(" ") : '<span class="muted">none</span>'}</dd></div></dl>${m.replayStatus === "UNREPLAYABLE" ? '<p class="wp-boundary"><strong>UNREPLAYABLE is not INCORRECT.</strong> Missing historical inputs are reported, never filled in, and present-day policy is never substituted.</p>' : ""}`;
  const replayCheck = check("replay", "4", "Replay", m.replayStatus, replayChip(m, vocabulary), replayHint, replayBody);

  // Registration: everything the record carries that identifies it, exactly as recorded.
  const eventAt = (state) => {
    const e = m.lifecycle.events.find((x) => x.state === state);
    return e ? instant(e.at) : '<span class="muted">not reached</span>';
  };
  const withdrawn = m.lifecycle.events.find((x) => x.state === "WITHDRAWN");
  const registration = `<div class="wp-registration"><h4>Registration</h4><p class="muted small">The identifiers, digests, versions and instants this record carries, exactly as recorded, each with an exact-value copy control.</p><dl class="states wp-facts wp-verify-grid">
${fact("WallPrint ID", exact(m.id, "WallPrint id"))}
${fact("WallPrint version", code(m.wallprintVersion))}
${fact("Canonicalization", m.canonicalization ? `<code>${esc(m.canonicalization)}</code> <span class="muted small">RFC 8785 JSON Canonicalization Scheme</span>` : notStated)}
${fact("Digest algorithm", code(m.digestAlgorithm))}
${fact("WWEP version", code(m.versions.wwep))}
${fact("Registry", `${code(m.versions.registry)}${m.versions.registryDigest ? `<br>digest ${exact(m.versions.registryDigest, "registry digest")}` : ""}`)}
${fact("Policies", `${code(m.versions.policies)}${m.versions.policiesDigest ? `<br>digest ${exact(m.versions.policiesDigest, "policies digest")}` : ""}`)}
${fact("Rules (engine)", code(m.versions.rules))}
${fact("Policy versions", map(m.policyVersions))}
${fact("Rule versions (declared by the evidence)", map(m.ruleVersions))}
${fact("Evidence bundle digest", m.bundleDigest ? exact(m.bundleDigest, "evidence bundle digest") : '<span class="muted">none</span>')}
${fact("Evidence references", m.evidenceCounts.map((c) => `<code>${esc(c.kind)}</code> ${esc(String(c.count))}`).join(" · "))}
${fact("Snapshot", instant(m.snapshotAt))}
${fact("Committed", eventAt("COMMITTED"))}
${fact("Disclosed", eventAt("DISCLOSED"))}
${withdrawn ? fact("Withdrawn", instant(withdrawn.at)) : ""}
</dl></div>`;

  // Derivation: payload -> RFC 8785 -> canonical bytes -> SHA-256 -> digest -> receipt comparison. The raw payload is an
  // advanced fold inside the first step; every value is the engine's.
  const rawFold = `<details class="wp-more wp-raw"><summary>Raw canonical payload (advanced)</summary><p class="muted small">The digest preimage in RFC 8785 form, as the engine serialized it: the record without its own <code>digest</code>. Shown exactly; not reformatted.</p>${m.canonical ? `<div class="wp-copyable wp-raw-body"><code class="wp-raw-text">${esc(m.canonical)}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full canonical payload">Copy</button></div>` : '<p class="muted">not carried by this fixture</p>'}</details>`;
  const step = (key, title, body) => `<li class="wp-step" data-step="${key}"><span class="wp-step-title">${title}</span>${body}</li>`;
  const derivation = `<div class="wp-derivation"><h4>From payload to commitment</h4><p class="muted small">How the digest is derived from the record, and how the receipt relates to it. Every value is the engine's; nothing is recomputed here.</p><ol class="wp-steps" aria-label="Derivation, from payload to commitment">
${step("payload", "Canonical payload", `<p class="muted small">The record without its own <code>digest</code>: the digest preimage.</p>${rawFold}`)}
${step("canonical", "Canonicalization", `<p>${code(m.canonicalization)} <span class="muted small">RFC 8785 JSON Canonicalization Scheme produces the canonical bytes.</span></p>`)}
${step("hash", "Digest algorithm", `<p>${code(m.digestAlgorithm)} <span class="muted small">over the canonical bytes.</span></p>`)}
${step("digest", "Digest", `<dl class="states wp-facts wp-check-fields"><div><dt>Embedded</dt><dd>${embedded}</dd></div><div><dt>Computed</dt><dd>${computed}</dd></div></dl><p class="wp-check-a">${resultChip(m.digestStatus)} <span class="muted small">the Digest check above</span></p>`)}
${step("receipt", "Receipt", issued ? `<dl class="states wp-facts wp-check-fields"><div><dt>Commitment digest (receipt)</dt><dd>${exact(str(issued.digest), "receipt digest")}</dd></div></dl><p class="wp-check-a">${resultChip(m.receiptStatus)} <span class="muted small">the Receipt check above: the receipt's digest against the embedded digest, together with the bundle digest and the versions</span></p>` : '<p class="muted">No receipt is carried in this disclosure, so nothing here represents the commitment to compare against.</p>')}
</ol></div>`;

  return `<section class="wp-verify wp-rise" data-wp-step="5" aria-labelledby="wp-ver-${esc(m.id)}"><h3 id="wp-ver-${esc(m.id)}">Verify</h3>
<p class="wp-boundary"><strong>Digest match = record integrity. Digest match &ne; factual correctness.</strong> A matching digest shows that the disclosed bytes are the bytes their embedded digest covers. Whether they are the committed bytes is the receipt's question; whether any claim in them is true is neither.</p>
<p class="muted small wp-verify-intro">Four separate questions, each answered only by the engine's recorded result. They are not interchangeable, and this document never combines them into one state.</p>
<ol class="wp-checks" aria-label="Verification: four separate questions">
${recordCheck}
${digestCheck}
${receiptCheck}
${replayCheck}
</ol>
<p class="wp-independent">Receipt and replay are separate questions: a matching receipt beside a replay mismatch, or beside an unreplayable record, is a consistent result. This document never combines them into one state.</p>
${registration}
${portable(m)}
${derivation}
</section>`;
}

/**
 * Portable reference: the record's locator (id, committed digest, WallPrint version) in its one fixed text form, printed
 * exactly with a copy control, and the same text as a QR code drawn locally from it. The block is a registration block
 * of the plate: a hairline frame, the ink on the paper, the words "Scan" and "Copy reference"; no seal, no mark of
 * approval, no colour of success. A reader who cannot scan loses nothing: the text is the reference. Without a committed
 * record identity (no COMMITTED event naming this record and its digest) there is no reference and no code, and the
 * prerequisite is named.
 */
function portable(m) {
  const ref = m.reference;
  const intro = `<p class="muted small">A locator for this record: its id, its committed digest and the WallPrint version, in one fixed form. The code and the text beside it carry exactly the same reference. ${esc(REFERENCE_IDENTIFIES)}</p>`;
  const boundary = `<p class="wp-boundary"><strong>A reference is a locator, not authority.</strong> It names which record and which bytes; it does not establish ${list(REFERENCE_DOES_NOT_ESTABLISH)
    .map((x) => esc(x))
    .join(", ")}. It is not a signature. The code encodes no web address and no local address: it is a <code>walletwall:</code> locator that no app registers a handler for, so scanning it opens nothing by itself; opening it needs a compatible WalletWall disclosure store, such as this panel's bundled lineages. No public resolver exists in this release.</p>`;
  if (ref === null) {
    return `<div class="wp-portable" data-wp-reference="unavailable"><h4>Portable reference</h4>${intro}<p class="note">No portable reference for this record: this disclosure carries no committed record identity for it (a COMMITTED lifecycle event naming this record with its committed digest, and a WallPrint version). A reference needs exactly those three values. No code is drawn in its place.</p>${boundary}</div>`;
  }
  const text = encodeReference(ref);
  const code = encodeQr(text);
  const { extent, d } = qrPathData(code);
  const textId = `wp-pr-${esc(m.id)}`;
  const svg = `<svg class="wp-qr-code" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="QR code. It encodes the portable reference printed beside it and nothing else." aria-describedby="${textId}" shape-rendering="crispEdges" data-qr-version="${esc(String(code.version))}" data-qr-modules="${esc(String(code.size))}" data-qr-ec="${esc(code.ecLevel)}"><rect class="wp-qr-quiet" width="${extent}" height="${extent}"/><path class="wp-qr-dark" d="${d}"/></svg>`;
  const sections = REFERENCE_TARGETS.filter((t) => t !== "record").map((t) => `<li><span class="wp-eyebrow-inline">${esc(TARGET_LABELS[t])}</span> ${exact(encodeReference({ ...ref, target: t }), `portable reference to the ${TARGET_LABELS[t]} section`)}</li>`);
  return `<div class="wp-portable" data-wp-reference="available" data-wp-reference-target="none"><h4>Portable reference</h4>${intro}
<div class="wp-portable-block">
<div class="wp-qr">${svg}<p class="wp-qr-caption">Scan · Copy reference</p><p class="muted small wp-qr-meta">QR version ${esc(String(code.version))}, ${esc(String(code.size))} modules, error correction ${esc(code.ecLevel)}, quiet zone 4</p></div>
<div class="wp-portable-text">
<dl class="states wp-facts wp-portable-fields">
<div><dt>Reference</dt><dd><span class="wp-copyable"><code class="wp-exact" id="${textId}">${esc(text)}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full portable reference">Copy reference</button></span></dd></div>
<div><dt>Record</dt><dd>${exact(ref.recordId, "WallPrint id")}</dd></div>
<div><dt>Committed digest</dt><dd>${exact(ref.digest, "committed digest")} <span class="muted small">from the COMMITTED event of the lifecycle ledger</span></dd></div>
<div><dt>Encodes</dt><dd>the record id, the committed digest, WallPrint version <code>${esc(ref.wallprintVersion)}</code> and reference format <code>${esc(REFERENCE_VERSION)}</code>; no section target, no web or local address, no wallet address, no key, no record content</dd></div>
</dl>
${boundary}
<details class="wp-more wp-portable-sections"><summary>Section references and the envelope</summary><p class="muted small">The same reference pointing at one section of this record, and the reference as a JSON envelope (RFC 8785 key order). Each is exact and copyable; none is a different reference.</p><ul class="limits wp-codes wp-portable-targets">${sections.join("")}</ul><p class="muted small">Envelope:</p>${exact(encodeReferenceEnvelope(ref), "reference envelope")}</details>
</div>
</div>
</div>`;
}

/**
 * The resolution readout printed above the lineage when the document was opened from a portable reference: which
 * record it named, whether the digests agree, and which section it asked for. A mismatch is an integrity finding that
 * decides nothing about which record is right; both digests are printed for the reader.
 */
function referenceReadout(view) {
  const r = isObject(view.reference) ? view.reference : null;
  if (r === null) return "";
  const res = isObject(r.resolution) ? r.resolution : null;
  const outcome = str(r.outcome);
  const target = str(r.target);
  const targetWord = target !== null && Object.hasOwn(TARGET_LABELS, target) ? TARGET_LABELS[target] : null;
  const named = `<dl class="states wp-facts wp-reference-fields"><div><dt>Record named</dt><dd>${exact(str(r.recordId), "referenced record id")}</dd></div><div><dt>Digest carried</dt><dd>${exact(str(r.digest), "reference digest")}</dd></div><div><dt>Section</dt><dd>${targetWord ? esc(targetWord) : '<span class="muted">none: the record itself</span>'}</dd></div></dl>`;
  if (outcome === "RESOLVED") {
    return `<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="RESOLVED" role="status"><p class="wp-eyebrow">Opened from a portable reference</p><p class="wp-reference-line">${chip("RESOLVED", ["RESOLVED"], false)} <span class="wp-check-meaning">${esc(REFERENCE_PRESENTATION.RESOLVED)}</span></p>${named}<p class="muted small">The record is shown below as recorded, with its own lifecycle; a reference to an earlier version opens that version, never the lineage's current one in its place.</p></div>`;
  }
  const digests = `<dl class="states wp-facts wp-reference-fields"><div><dt>Digest carried by the reference</dt><dd>${exact(str(r.digest), "reference digest")}</dd></div><div><dt>Digest the record carries</dt><dd>${res && typeof res.embeddedDigest === "string" ? exact(res.embeddedDigest, "embedded digest") : '<span class="muted">none carried</span>'}</dd></div><div><dt>Digest the engine computed</dt><dd>${res && typeof res.computedDigest === "string" ? exact(res.computedDigest, "computed digest") : '<span class="muted">not carried: nothing was computed here</span>'}</dd></div></dl>`;
  if (outcome === "DIGEST_MISMATCH") {
    return `<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="DIGEST_MISMATCH" role="alert"><p class="wp-eyebrow">Opened from a portable reference</p><p class="wp-reference-line">${chip("DIGEST_MISMATCH", ["DIGEST_MISMATCH"])} <span class="wp-check-meaning">${esc(REFERENCE_PRESENTATION.DIGEST_MISMATCH)}</span></p>${digests}<p class="muted small">This document does not decide which bytes are the committed ones; it shows the record it found, as recorded, and the Verify section below carries the engine's own checks for it. The record named: ${exact(str(r.recordId), "referenced record id")}${targetWord ? `; section asked for: ${esc(targetWord)} (not opened, because the digests differ)` : ""}.</p></div>`;
  }
  // Absence is absence: a disclosure that carries no digest to compare against gets the plate's quiet edge, no alarm.
  if (outcome === "NOT_COMPARED") {
    return `<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="NOT_COMPARED" role="status"><p class="wp-eyebrow">Opened from a portable reference</p><p class="wp-reference-line">${chip("NOT_COMPARED", ["NOT_COMPARED"], false)} <span class="wp-check-meaning">${esc(REFERENCE_PRESENTATION.NOT_COMPARED)}</span></p>${digests}<p class="muted small">The record is shown below as recorded; the Verify section carries whatever checks this disclosure does carry. The record named: ${exact(str(r.recordId), "referenced record id")}${targetWord ? `; section asked for: ${esc(targetWord)} (not opened, because the digests were not compared)` : ""}.</p></div>`;
  }
  return `<div class="wp-reference-result wp-rise" data-wp-step="0" data-outcome="UNRECOGNISED" role="status"><p class="wp-eyebrow">Opened from a portable reference</p><p class="wp-reference-line"><span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span> <span class="wp-check-meaning">The carried resolution outcome is not one this document recognises. No result is shown.</span></p></div>`;
}

/**
 * The view when a portable reference resolved to no record here: the fixed outcome and its problem code in words,
 * nothing of the text, no record, no state. UNAVAILABLE is said as unavailable, never as invalid.
 */
export function renderReferenceOutcome(view) {
  const r = isObject(view.reference) ? view.reference : {};
  const outcome = str(r.outcome);
  const known = outcome !== null && ["UNAVAILABLE", "MALFORMED_REFERENCE", "UNSUPPORTED_VERSION"].includes(outcome);
  const problem = str(r.problem);
  const problemWord = problem !== null && Object.hasOwn(REFERENCE_PROBLEM_LABELS, problem) ? REFERENCE_PROBLEM_LABELS[problem] : null;
  const title = outcome === "UNAVAILABLE" ? "Record unavailable" : outcome === "MALFORMED_REFERENCE" ? "Malformed reference" : outcome === "UNSUPPORTED_VERSION" ? "Unsupported version" : "Reference not opened";
  // The id and digest an unavailable reference names are the reader's own input, printed back as written so the reader
  // can see which record was asked for; they are labelled as such and are not the store's values.
  const body = known
    ? `<p class="wp-reference-line">${chip(outcome, [outcome], outcome === "UNAVAILABLE" ? false : undefined)} <span class="wp-check-meaning">${esc(outcome === "UNAVAILABLE" && problem === "ambiguous" ? REFERENCE_PRESENTATION.UNAVAILABLE_AMBIGUOUS : REFERENCE_PRESENTATION[outcome])}</span></p>${
        outcome === "UNAVAILABLE"
          ? `<dl class="states wp-facts wp-reference-fields"><div><dt>Record named, as written in the reference</dt><dd>${exact(str(r.recordId), "referenced record id")}</dd></div><div><dt>Digest carried, as written in the reference</dt><dd>${exact(str(r.digest), "reference digest")}</dd></div></dl><p class="muted small">${esc(REFERENCE_IDENTIFIES)} This panel resolves references against its bundled disclosure lineages only.</p>`
          : `<p class="muted small">Problem: <code>${esc(problem ?? "")}</code>${problemWord ? ` (${esc(problemWord)}${problem === "reference" || problem === "wallprint" ? (outcome === "UNSUPPORTED_VERSION" ? " is not one this document reads" : " is not a version") : ""})` : problem === null ? "" : " (not recognised)"}. A reference is read exactly as written: no case folding, no percent-decoding, no reordering of its parameters.</p>`
      }`
    : '<p class="wp-reference-line"><span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised</span> <span class="wp-check-meaning">The carried outcome is not one this document recognises. No result is shown.</span></p>';
  return `<div class="ww-summary"><header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1><span class="ww-lens-badge" title="A portable WallPrint reference">WallPrint</span></div><p class="ww-rail-asset"><span class="ww-rail-symbol">WallPrint</span><span class="ww-rail-sep" aria-hidden="true">·</span><span class="ww-rail-chain">portable reference</span></p></header></div>
<section class="wp" data-wp-reference-outcome="${esc(outcome ?? "")}" aria-label="Portable reference outcome">
<div class="wp-plate">
<p class="wp-fixture muted small">Opened from a portable reference. Source: <code>${esc(view.source ?? "")}</code>.</p>
<div class="wp-reference-result" data-outcome="${esc(known ? outcome : "UNRECOGNISED")}" role="${outcome === "UNAVAILABLE" ? "status" : "alert"}"><p class="wp-eyebrow">Portable reference</p><h2 class="wp-title">${esc(title)}</h2>${body}</div>
${renderWallPrintList(view.wallprints)}
<p class="muted small wp-foot">A portable reference locates a record; it decides no state, no authority, no verdict, and this page shows no record it did not resolve.</p>
</div>
</section>`;
}

function invariants(vocabulary) {
  return `<details class="wp-more wp-invariants"><summary>WallPrint invariants</summary><ul class="limits wp-codes">${vocabulary.invariants.map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ul></details>`;
}

function article(m, vm, vocabulary, labels) {
  const life = currency(m, vocabulary);
  return `<article class="wp-record" data-record-id="${esc(m.id)}" data-version="${esc(m.version)}"${life.known ? ` data-lifecycle="${esc(life.state)}"` : ""}${m.focused ? "" : " hidden"} aria-labelledby="wp-h-${esc(m.id)}" tabindex="-1">
${head(m, vocabulary, labels)}
<div class="wp-columns">${why(m, vocabulary, labels)}${recordBox(m)}</div>
${assessmentsTable(m, vocabulary)}
${provenanceChain(m)}
${history(m, vm, vocabulary)}
${verify(m, vm, vocabulary)}
</article>`;
}

/**
 * The WallPrint view fragment. `view.disclosure` is one serialized fixture; `view.vocabulary` is the engine's exported
 * vocabulary; `labels` are the canvas's state hints and limitation descriptions (render.mjs), so the two views say the
 * same things about the same codes.
 */
export function renderWallPrint(view, labels) {
  // Opened from a reference, the record in view is the one the reference named; a section is opened only after a
  // successful resolution with matching digests, and only one of the fixed targets (the client refuses anything else).
  const vm = wallPrintViewModel(view.fixture, view.disclosure, view.vocabulary, str(view.focus));
  const open = isObject(view.reference) && view.reference.outcome === "RESOLVED" && typeof view.target === "string" && Object.hasOwn(TARGET_LABELS, view.target) ? view.target : null;
  const asset = vm.registry.asset;
  const headerAsset = `<p class="ww-rail-asset"><span class="ww-rail-symbol">${esc(asset ? asset.symbol : "WallPrint")}</span><span class="ww-rail-sep" aria-hidden="true">·</span><span class="ww-rail-chain">${vm.registry.chain ? `chain ${esc(vm.registry.chain.chainId)}` : "disclosure record"}</span></p>`;
  const records = vm.records.map((m) => article(m, vm, view.vocabulary, labels)).join("\n");
  return `<div class="ww-summary"><header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1><span class="ww-lens-badge" title="A fixture-backed disclosure record">WallPrint</span></div>${headerAsset}</header></div>
<section class="wp" data-wp-fixture="${esc(vm.name)}" data-wp-focus="${esc(vm.focus ?? "")}"${open ? ` data-wp-open="${esc(open)}"` : ""} aria-label="WallPrint disclosure">
<div class="wp-plate">
<p class="wp-fixture muted small">Synthetic fixture <code>${esc(vm.name)}</code>: ${esc(vm.title)} Source: <code>${esc(view.source ?? "")}</code>.${vm.scenario ? ` <span class="wp-scenario" data-scenario="${esc(vm.scenario.kind ?? "")}">Construction: ${vm.scenario.label ? esc(vm.scenario.label) : `not recognised: ${esc(String(vm.scenario.kind).slice(0, 24))}`}${vm.scenario.patched.length ? ` (changed: ${vm.scenario.patched.map((p) => `<code>${esc(p)}</code>`).join(", ")})` : ""}.</span>` : ""}</p>
${referenceReadout(view)}
${records}
${invariants(view.vocabulary)}
<p class="muted small wp-foot">This page renders the canonical WallPrint record and the engine's receipt, replay and diff results for it. It decides no state, no authority, no verdict.</p>
</div>
</section>`;
}

/** The empty state's list of WallPrint fixtures. */
export function renderWallPrintList(wallprints) {
  const items = list(wallprints).filter(isObject).map((f) => `<li><code>${esc(f.name)}</code> <span class="muted">${esc(f.title)}</span></li>`);
  if (items.length === 0) return "";
  return `<p class="note">Or open a fixture-backed WallPrint disclosure record (<code>wallprint</code>):</p><ul class="limits">${items.join("")}</ul>`;
}
