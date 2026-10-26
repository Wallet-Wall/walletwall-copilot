import { canonicalize } from "../../src/canonical.ts";
import { findAsset, findChain } from "../../src/registry.ts";
import type { Bundle } from "../../src/schemas.ts";
import { diffWallPrints, type WallPrintDiff } from "../../src/wallprint/diff.ts";
import type { Finding } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory, type LifecycleEvent, type Lineage, type SuccessorRef, type WallPrintHistory } from "../../src/wallprint/history.ts";
import { RECEIPT_DOES_NOT_ESTABLISH, RECEIPT_ESTABLISHES, verifyReceipt, wallPrintReceipt, type ReceiptVerification, type WallPrintReceipt } from "../../src/wallprint/receipt.ts";
import {
  buildWallPrintSnapshot,
  validateWallPrintRecord,
  verifyWallPrintDigest,
  wallPrintDigest,
  wallPrintPayload,
  type DigestVerification,
  type ExternalAssessmentInput,
  type SnapshotInput,
  type Supersedes,
  type WallPrintRecord,
} from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint, type EvidenceStore, type ReplayResult } from "../../src/wallprint/replay.ts";
import {
  ASSESSOR_ROLES,
  DIFF_CATEGORIES,
  LIFECYCLE_STATES,
  REPLAY_OUTCOMES,
  REPLAY_REASONS,
  UNREPLAYABLE_REASONS,
  WALLPRINT_CANONICALIZATION,
  WALLPRINT_DIGEST_ALGORITHM,
  WALLPRINT_INVARIANTS,
  WALLPRINT_PRINCIPLE,
  WALLPRINT_VERSION,
  type LifecycleState,
} from "../../src/wallprint/vocabulary.ts";
import { SUPPORT_STATES, FRESHNESS_STATES, FINALITY_STATES } from "../../src/schemas.ts";
import { readinessWorld } from "../wallprint/support.ts";
import { EVALUATED_AT, OBSERVED_AT, clone, golden, replaceObservation } from "./builders.ts";
import { CASES } from "./cases.ts";

/**
 * The WallPrint disclosure fixtures: deterministic, synthetic lineages produced by the canonical WallPrint engine
 * (packages/mcp/src/wallprint). Every verdict in a fixture is an engine output: the record (buildWallPrintSnapshot),
 * the lifecycle events and lineage (createWallPrintHistory), the digest check (verifyWallPrintDigest), the validation
 * findings (validateWallPrintRecord), the receipt and its verification (wallPrintReceipt, verifyReceipt), the replay result
 * (replayWallPrint) and the semantic diff against the predecessor (diffWallPrints). The hand-written parts are the
 * synthetic inputs (which evidence world, which attributed assessments, which lifecycle actions at which literal instant),
 * a one-sentence title for humans, and, in exactly two adversarial scenarios, one deliberately changed field: a record
 * "committed elsewhere" (changed and re-digested before commit) and a copy "altered after commit" (changed without
 * re-digesting). Each fixture declares its construction in `scenario`, and the page prints it. The disclosure UI renders
 * these outputs and decides nothing.
 *
 * Nothing here describes a real wallet: the evidence is the engine's synthetic world (src/examples.ts). No clock is read.
 *
 *   WalletWall isn't always right. WallPrint keeps the record.
 */

export interface DisclosureRecord {
  id: string;
  /** The record as disclosed. In the receipt-mismatch fixture it is an altered copy of the committed record. */
  record: WallPrintRecord;
  /** The digest preimage: the record without `digest`, in RFC 8785 form (the engine's canonicalizer). */
  canonical: string;
  validation: { ok: boolean; findings: Finding[] };
  digest: DigestVerification;
  lifecycle: { state: LifecycleState; events: LifecycleEvent[] };
  supersedes: Supersedes | null;
  supersededBy: SuccessorRef | null;
  lineage: Lineage;
  /** diffWallPrints(predecessor, this record) when the record supersedes or corrects one; null otherwise. */
  diff: WallPrintDiff | null;
  /** The receipt issued at disclosure (null when none was issued) and its verification against the disclosed record. */
  receipt: { issued: WallPrintReceipt | null; verification: ReceiptVerification | null };
  replay: ReplayResult;
}

export interface DisclosureRegistry {
  asset: { symbol: string; name: string; issuerName: string; authorityId: string } | null;
  chain: { chainId: string; name: string } | null;
}

/**
 * How the fixture's records were constructed. ENGINE_BUILT: every record came out of buildWallPrintSnapshot unchanged.
 * COMMITTED_ELSEWHERE: one field of an engine-built payload was changed and the record re-digested before commit, as a
 * record from another engine would be. ALTERED_AFTER_COMMIT: the committed record is engine-built; the disclosed copy was
 * changed afterwards without re-digesting. `patched` names the changed paths. The page prints this on the fixture line.
 */
export interface DisclosureScenario {
  kind: "ENGINE_BUILT" | "COMMITTED_ELSEWHERE" | "ALTERED_AFTER_COMMIT";
  patched: string[];
}

export interface DisclosureFixture {
  title: string;
  /** The record shown first; every record of the lineage stays addressable. */
  focus: string;
  scenario: DisclosureScenario;
  /** The bundled registry's point-in-time record for the focal subject, looked up at generation time. */
  registry: DisclosureRegistry;
  /** Lineage order: root first, current last. */
  records: DisclosureRecord[];
}

export type DisclosureFixtures = Record<string, DisclosureFixture>;

/** The engine's vocabulary and boundary statements, exported with the fixtures so the page quotes them verbatim. */
export interface WallPrintVocabulary {
  version: string;
  canonicalization: string;
  digestAlgorithm: string;
  principle: string;
  invariants: string[];
  supportStates: string[];
  freshnessStates: string[];
  finalityStates: string[];
  lifecycleStates: string[];
  assessorRoles: string[];
  replayOutcomes: string[];
  replayReasons: string[];
  unreplayableReasons: string[];
  diffCategories: string[];
  receipt: { establishes: string; doesNotEstablish: string[] };
}

export function wallPrintVocabulary(): WallPrintVocabulary {
  return plain({
    version: WALLPRINT_VERSION,
    canonicalization: WALLPRINT_CANONICALIZATION,
    digestAlgorithm: WALLPRINT_DIGEST_ALGORITHM,
    principle: WALLPRINT_PRINCIPLE,
    invariants: [...WALLPRINT_INVARIANTS],
    supportStates: [...SUPPORT_STATES],
    freshnessStates: [...FRESHNESS_STATES],
    finalityStates: [...FINALITY_STATES],
    lifecycleStates: [...LIFECYCLE_STATES],
    assessorRoles: [...ASSESSOR_ROLES],
    replayOutcomes: [...REPLAY_OUTCOMES],
    replayReasons: [...REPLAY_REASONS],
    unreplayableReasons: [...UNREPLAYABLE_REASONS],
    diffCategories: [...DIFF_CATEGORIES],
    receipt: { establishes: RECEIPT_ESTABLISHES, doesNotEstablish: [...RECEIPT_DOES_NOT_ESTABLISH] },
  });
}

// Literal instants. WWEP evaluation times are spelled as the engine accepts them; lifecycle times are canonical instants.
export const SNAPSHOT_AT = EVALUATED_AT;
export const LATER_SNAPSHOT_AT = "2026-10-24T11:00:00Z";
export const COMMIT_AT = "2026-10-23T12:10:00.000Z";
export const DISCLOSE_AT = "2026-10-23T12:20:00.000Z";
export const LATER_COMMIT_AT = "2026-10-24T12:00:00.000Z";
export const LATER_DISCLOSE_AT = "2026-10-24T12:30:00.000Z";
export const WITHDRAW_AT = "2026-10-25T09:00:00.000Z";

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ─── synthetic worlds ────────────────────────────────────────────────────────

/** The golden world with the chain balance observation reported UNFINALIZED: the balance is SUPPORTED (NOT_FINALIZED). */
function unfinalizedBalanceWorld(): Bundle {
  return replaceObservation(golden(), "obs-balance", { finality: "UNFINALIZED" });
}

/** The golden world with the issuer source naming an authority id that is not the registry authority: the identity is PARTIAL. */
function wrongIssuerWorld(): Bundle {
  const b = golden();
  b.sources = b.sources.map((s) => (s.id === "src-issuer" ? { ...s, authorityId: "issuer:circle-labs" } : s));
  return b;
}

/**
 * The conformance corpus's CNF-002: two assertions about the same claim identity carry different values, both are
 * CONFLICTING (CONFLICT_DETECTED) and no source ranking resolves them. (CNF-004, where the conflict propagates to a
 * derived readiness claim, is not recordable in WallPrint 0.1: the propagated claim carries no `conflictsWith` and the
 * record validator refuses it with CONFLICTS_MISMATCH. Reported, not patched here.)
 */
function conflictingEvidenceWorld(): Bundle {
  const c = CASES.find((x) => x.id === "CNF-002");
  if (c === undefined) throw new Error("conformance case CNF-002 not found");
  return structuredClone(c.bundle as Bundle);
}

// ─── attributed assessments (inputs, recorded as stated) ─────────────────────

const issuerConfirmed = (): ExternalAssessmentInput => ({
  assessor: "issuer:circle",
  assessorRole: "ISSUER",
  assessment: "CONFIRMED",
  statement: "Deployment confirmed for the stated period.",
  policy: "issuer-attestation",
  policyVersion: "2026-Q3",
  assessedAt: OBSERVED_AT,
  evidenceRefs: ["obs-identity"],
  limitations: [],
});

const reviewerNotAvailable = (): ExternalAssessmentInput => ({
  assessor: "reviewer-y",
  assessorRole: "INDEPENDENT_REVIEWER",
  assessment: "NOT_AVAILABLE",
  policy: "reviewer-y-review",
  policyVersion: "1",
  assessedAt: OBSERVED_AT,
  evidenceRefs: [],
  limitations: [],
});

const reviewerConflicting = (): ExternalAssessmentInput => ({
  ...reviewerNotAvailable(),
  assessment: "CONFLICTING",
  statement: "Reviewer observed contract metadata that differs from the issuer publication.",
  evidenceRefs: ["obs-identity"],
});

// ─── assembly ────────────────────────────────────────────────────────────────

interface Built {
  record: WallPrintRecord;
  bundle: Bundle;
  receipt: WallPrintReceipt | null;
}

function snapshot(input: SnapshotInput): WallPrintRecord {
  return buildWallPrintSnapshot(input);
}

/** A record "committed elsewhere": the payload patched, then re-digested, so it validates but this engine did not produce it. */
function committedElsewhere(record: WallPrintRecord, patch: (payload: ReturnType<typeof wallPrintPayload>) => void): WallPrintRecord {
  const payload = structuredClone(wallPrintPayload(record));
  patch(payload);
  return { ...payload, digest: wallPrintDigest(payload) };
}

function registryFor(record: WallPrintRecord): DisclosureRegistry {
  const focal = record.claims.find((c) => c.assertionId === record.subject.focalAssertionId);
  const chainId = focal?.subject["chainId"];
  const address = focal?.subject["address"] ?? focal?.subject["token"];
  const asset = typeof chainId === "string" && typeof address === "string" ? findAsset(chainId, address) : undefined;
  const chain = typeof chainId === "string" ? findChain(chainId) : undefined;
  return {
    asset: asset ? { symbol: asset.symbol, name: asset.name, issuerName: asset.issuerName, authorityId: asset.authorityId } : null,
    chain: chain ? { chainId: chain.chainId, name: chain.name } : null,
  };
}

/** Everything the engine says about one disclosed record, assembled from the history, the receipt and the evidence store. */
function disclosureRecord(history: WallPrintHistory, committedId: string, disclosed: WallPrintRecord, receipt: WallPrintReceipt | null, store: EvidenceStore, predecessor: WallPrintRecord | null): DisclosureRecord {
  const view = history.view(committedId);
  if (view === null) throw new Error(`record ${committedId} is not committed`);
  const validation = validateWallPrintRecord(disclosed);
  return plain({
    id: disclosed.id,
    record: disclosed,
    canonical: canonicalize(wallPrintPayload(disclosed)),
    validation: validation.ok ? { ok: true, findings: [] } : { ok: false, findings: validation.findings },
    digest: verifyWallPrintDigest(disclosed),
    lifecycle: { state: view.lifecycle.state, events: [...view.lifecycle.events] },
    supersedes: view.supersedes,
    supersededBy: view.supersededBy,
    lineage: view.lineage,
    diff: predecessor === null || !validation.ok ? null : diffWallPrints(predecessor, disclosed),
    receipt: { issued: receipt, verification: receipt === null ? null : verifyReceipt(receipt, disclosed) },
    replay: replayWallPrint(disclosed, { evidence: store }),
  });
}

interface Step {
  record: WallPrintRecord;
  bundle: Bundle;
  commitAt: string;
  discloseAt: string | null;
  withdraw: { at: string; reason: string } | null;
  /** The record as disclosed, when it differs from the committed bytes (the receipt-mismatch fixture). */
  disclosedAs?: WallPrintRecord;
  /** false: the evidence store never held this record's bundle (the unreplayable fixture). */
  retainEvidence?: boolean;
}

/** Runs one lineage through a fresh history and evidence store, in order, and assembles the fixture. */
function lineage(title: string, steps: Step[], scenario: DisclosureScenario = { kind: "ENGINE_BUILT", patched: [] }, focusIndex = steps.length - 1): DisclosureFixture {
  const history = createWallPrintHistory();
  const store = createEvidenceStore();
  const built: Built[] = [];
  for (const s of steps) {
    history.commit(s.record, { at: s.commitAt });
    let receipt: WallPrintReceipt | null = null;
    if (s.discloseAt !== null) {
      history.disclose(s.record.id, { at: s.discloseAt });
      receipt = wallPrintReceipt(s.record);
    }
    if (s.withdraw !== null) history.withdraw(s.record.id, s.withdraw);
    if (s.retainEvidence !== false) store.put(s.bundle);
    built.push({ record: s.record, bundle: s.bundle, receipt });
  }
  const records = steps.map((s, i) => disclosureRecord(history, s.record.id, s.disclosedAs ?? s.record, built[i]?.receipt ?? null, store, i === 0 ? null : (steps[i - 1]?.record ?? null)));
  const focus = steps[focusIndex]?.record.id;
  if (focus === undefined) throw new Error("empty lineage");
  return { title, focus, scenario, registry: registryFor(steps[focusIndex]!.record), records };
}

// ─── the fixtures ────────────────────────────────────────────────────────────

export const WALLPRINT_FIXTURE_NAMES = [
  "current-supported",
  "conflicting-assessors",
  "corrected",
  "superseded",
  "withdrawn",
  "unreplayable",
  "receipt-valid",
  "receipt-mismatch",
  "replay-mismatch",
  "conflicting-evidence",
] as const;
export type WallPrintFixtureName = (typeof WALLPRINT_FIXTURE_NAMES)[number];

export function buildWallPrintDisclosures(): DisclosureFixtures {
  const out: DisclosureFixtures = {};

  {
    const bundle = unfinalizedBalanceWorld();
    const record = snapshot({ id: "wp-balance-pinned-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-balance", assessments: [reviewerNotAvailable()], supersedes: null });
    out["current-supported"] = lineage("A disclosed record of a pinned synthetic USDC balance whose chain observation is not finalized: WalletWall says SUPPORTED, the independent reviewer recorded NOT_AVAILABLE, the receipt matches and replay reproduces the record.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
    ]);
  }

  {
    const bundle = golden();
    const record = snapshot({ id: "wp-identity-assessed-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed(), reviewerConflicting()], supersedes: null });
    out["conflicting-assessors"] = lineage("Three assessors disagree about the synthetic USDC identity: WalletWall says ESTABLISHED, the issuer recorded CONFIRMED, an independent reviewer recorded CONFLICTING. All three stay; no consensus is computed.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
    ]);
  }

  {
    const v1Bundle = wrongIssuerWorld();
    const v1 = snapshot({ id: "wp-identity-corrected-v1", bundle: clone(v1Bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed(), reviewerNotAvailable()], supersedes: null });
    const v2Bundle = golden();
    const v2 = snapshot({
      id: "wp-identity-corrected-v2",
      bundle: clone(v2Bundle),
      evaluatedAt: SNAPSHOT_AT,
      focalAssertionId: "a-identity",
      assessments: [issuerConfirmed(), reviewerNotAvailable()],
      supersedes: { id: v1.id, digest: v1.digest, kind: "CORRECTION", reason: "Issuer authority metadata corrected: the issuer source named a non-registry authority id." },
    });
    out["corrected"] = lineage("A correction: version 1 recorded the synthetic USDC identity as PARTIAL because the issuer source named a non-registry authority id; version 2 corrects the evidence and records ESTABLISHED. Version 1 stays on the record as CORRECTED.", [
      { record: v1, bundle: v1Bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
      { record: v2, bundle: v2Bundle, commitAt: LATER_COMMIT_AT, discloseAt: LATER_DISCLOSE_AT, withdraw: null },
    ]);
  }

  {
    const bundle = golden();
    const v1 = snapshot({ id: "wp-identity-superseded-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed()], supersedes: null });
    const v2 = snapshot({
      id: "wp-identity-superseded-v2",
      bundle: clone(bundle),
      evaluatedAt: LATER_SNAPSHOT_AT,
      focalAssertionId: "a-identity",
      assessments: [issuerConfirmed()],
      supersedes: { id: v1.id, digest: v1.digest, kind: "SUPERSESSION", reason: "Re-evaluated on a later snapshot with the same evidence." },
    });
    out["superseded"] = lineage("A supersession: the same synthetic evidence re-evaluated on a later snapshot. The identity stays ESTABLISHED while the provider price claim turns STALE; version 1 stays on the record as SUPERSEDED.", [
      { record: v1, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
      { record: v2, bundle, commitAt: LATER_COMMIT_AT, discloseAt: LATER_DISCLOSE_AT, withdraw: null },
    ]);
  }

  {
    const bundle = golden();
    const record = snapshot({ id: "wp-identity-withdrawn-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed()], supersedes: null });
    out["withdrawn"] = lineage("A withdrawn record: disclosed, then withdrawn with a stated reason. Its content, digest, assessments and receipt stay inspectable; withdrawal is a lifecycle event, not a deletion and not an evidence state.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: { at: WITHDRAW_AT, reason: "Issuer publication retracted on 2026-10-25. Record withdrawn pending re-evaluation." } },
    ]);
  }

  {
    const bundle = golden();
    const record = snapshot({ id: "wp-identity-unreplayable-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed(), reviewerNotAvailable()], supersedes: null });
    out["unreplayable"] = lineage("A committed record whose historical evidence bundle was not retained and for which no receipt was issued: replay is UNREPLAYABLE (MISSING_EVIDENCE), nothing is recomputed and nothing is filled in. UNREPLAYABLE is not INCORRECT.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: null, withdraw: null, retainEvidence: false },
    ]);
  }

  {
    const bundle = readinessWorld();
    const record = snapshot({ id: "wp-readiness-receipt-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "readiness-result", assessments: [], supersedes: null });
    out["receipt-valid"] = lineage("A disclosed vault technical readiness record with a derivation in its provenance and no external assessor: the receipt matches the committed bytes and replay reproduces the record. A matching receipt proves bytes, not facts.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
    ]);
  }

  {
    const bundle = golden();
    const committed = snapshot({ id: "wp-identity-altered-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed(), reviewerNotAvailable()], supersedes: null });
    // The disclosed copy was edited after commit: one attributed statement was added. Its embedded digest no longer covers its bytes.
    const altered = structuredClone(committed) as { assessments: { assessor: string; statement: string | null }[] };
    const reviewer = altered.assessments.find((a) => a.assessor === "reviewer-y");
    if (reviewer === undefined) throw new Error("reviewer assessment missing");
    reviewer.statement = "Review completed.";
    out["receipt-mismatch"] = lineage(
      "A disclosed copy whose bytes were changed after commit: the embedded digest does not cover the disclosed canonical record, the receipt does not match, and replay is UNREPLAYABLE (RECORD_INVALID). Digest mismatch is a record-integrity finding, not a statement about the facts.",
      [{ record: committed, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null, disclosedAs: altered as unknown as WallPrintRecord }],
      { kind: "ALTERED_AFTER_COMMIT", patched: ["assessments[reviewer-y].statement"] },
    );
  }

  {
    const bundle = golden();
    const produced = snapshot({ id: "wp-identity-elsewhere-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-identity", assessments: [issuerConfirmed()], supersedes: null });
    // Committed elsewhere: the record says the provider price claim is PARTIAL; this engine computes SUPPORTED from the same evidence.
    const record = committedElsewhere(produced, (p) => {
      const price = p.claims.find((c) => c.assertionId === "a-price");
      if (price === undefined) throw new Error("price claim missing");
      price.supportState = "PARTIAL";
    });
    out["replay-mismatch"] = lineage(
      "A valid record committed elsewhere whose price claim reads PARTIAL where this engine computes SUPPORTED from the same evidence: the receipt matches the committed bytes, yet replay is a MISMATCH naming the claims section. Receipt integrity is not factual correctness.",
      [{ record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null }],
      { kind: "COMMITTED_ELSEWHERE", patched: ["claims[a-price].supportState"] },
    );
  }

  {
    const bundle = conflictingEvidenceWorld();
    const record = snapshot({ id: "wp-balance-conflicting-v1", bundle: clone(bundle), evaluatedAt: SNAPSHOT_AT, focalAssertionId: "a-balance", assessments: [reviewerNotAvailable()], supersedes: null });
    out["conflicting-evidence"] = lineage("A disclosed record whose focal balance claim is CONFLICTING: two assertions about the same claim identity carry different values. The conflict is recorded between the claims and never resolved; no side is ranked above the other.", [
      { record, bundle, commitAt: COMMIT_AT, discloseAt: DISCLOSE_AT, withdraw: null },
    ]);
  }

  for (const name of WALLPRINT_FIXTURE_NAMES) if (!(name in out)) throw new Error(`fixture ${name} was not built`);
  return out;
}
