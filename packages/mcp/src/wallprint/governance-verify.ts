import { SUPPORTED_ALGORITHMS, type SignatureReason } from "./attestation-vocabulary.ts";
import { parseCheckpoint, type CheckpointParseResult, type CommittedState, type GovernanceTrustRoot } from "./checkpoint.ts";
import { GOVERNANCE_KEY_PURPOSES, GOVERNANCE_TRUST_ROOT_FORMAT_VERSION, GOVERNANCE_TRUST_ROOT_TYPE, type GovernanceKeyPurpose } from "./checkpoint-vocabulary.ts";
import { verifyCheckpoint, checkpointAnchors, type CheckpointAnchors, type CheckpointContext, type CheckpointVerification } from "./checkpoint-verify.ts";
import { ed25519KeyProblem, verifyEd25519 } from "./ed25519.ts";
import { deepFreeze } from "./freeze.ts";
import {
  ConfirmationSchema,
  HeldGovernanceStateSchema,
  PinnedRootSchema,
  authorizationDigest,
  authorizationPreimage,
  bootstrapDigest,
  formatFingerprint,
  parseAuthorization,
  parseBootstrap,
  type AuthorizationEnvelope,
  type GovernanceBootstrap,
} from "./governance.ts";
import {
  GOVERNANCE_DOES_NOT_ESTABLISH,
  GOVERNANCE_ESTABLISHES,
  GOVERNANCE_LIMITS,
  GOVERNANCE_VERIFICATION_VERSION,
  MINIMUM_INDEPENDENT_ORIGINS,
  OPERATIONAL_KEY_PURPOSES,
  ROOT_PURPOSES,
  SYNTHETIC_KEY_ID_PREFIX,
  type KeyStanding,
} from "./governance-vocabulary.ts";
import { HEX64_RE } from "./record.ts";

/**
 * Governance verification: pure functions from the public bootstrap a caller pins, the root-signed authorizations, and the state the caller
 * already holds, to structured results of separate dimensions. There is no `verified` flag and no trust score.
 *
 *   bootstrap     is it a well-formed public root, and did the caller pin it?          (the caller's own fingerprint, never the checkpoint's)
 *   chain         did that root, and only that root, sign each authorization, with      (signature under the PINNED key; generations
 *                 consecutive generations, each naming the one it supersedes?            1..N; no key reused; purposes inside the policy)
 *   held          relative to a governance state the caller already relies on:          (rollback, fork)
 *                 the same, a successor, older, or a fork?
 *   reliance      is THIS checkpoint's signer a key the root authorized, and is the     (current key; or a superseded key only through
 *                 checkpoint inside the state governance still stands behind?            the state the root named)
 *
 * The checkpoint verifier of spec section 23 is not changed and not reimplemented: a governance state is turned into the explicit trust root
 * it already takes, containing only keys the root authorized and the caller may still rely on, and `verifyCheckpoint` runs under it.
 *
 * A verifier never learns its first trusted key from the checkpoint it is verifying: the bootstrap is a separate input, and an unpinned one is
 * reported (`BOOTSTRAP_UNPINNED`). Never throws, for any argument; no fixed-code reason echoes caller text. Nothing here reads a clock, a file,
 * the network or the environment, and nothing here can sign.
 */

export interface GovernanceContext {
  /** The public root bootstrap, from the verifier's own channel. Never read from a checkpoint or an authorization. */
  bootstrap?: unknown;
  /** The root-signed authorizations, generations 1..N in order. */
  authorizations?: unknown;
  /** The fingerprint (`bootstrapDigest`) the caller read through channels it relies upon. Without one the bootstrap is reported unpinned. */
  expectedBootstrapDigest?: unknown;
  /** The lowest root epoch the caller accepts: how a reset to a newer root is enforced and an older root refused. */
  minRootEpoch?: unknown;
  /** The newest governance state the caller already relies on (`heldGovernanceState`). Without one nothing says this is not an older state. */
  held?: unknown;
  /** Rehearsal only: accept key ids that begin with `synthetic-`. A production verifier never sets it. */
  allowSynthetic?: boolean;
}

export interface GovernanceKeyEntry {
  generation: string;
  keyId: string;
  algorithm: string;
  publicKey: string;
  purposes: string[];
  standing: KeyStanding;
  /** The last checkpoint state the root stands behind for a superseded key (null: none, or the key is current). */
  retainedThrough: CommittedState | null;
  authorizationDigest: string;
}

export interface GovernanceVerification {
  verificationVersion: string;
  bootstrap: {
    parse: "PARSED" | "MALFORMED" | "UNSUPPORTED_VERSION" | "NOT_SUPPLIED";
    digest: string | null;
    fingerprintText: string | null;
    rootEpoch: string | null;
    rootKeyId: string | null;
    pin: "PINNED" | "UNPINNED" | "MISMATCHED" | "NOT_EVALUATED";
    epoch: "ACCEPTED" | "BELOW_MINIMUM" | "NOT_EVALUATED";
    reasons: string[];
  };
  chain: { status: "VALID" | "INVALID" | "NOT_CHECKED" | "NOT_SUPPLIED" | "NOT_EVALUATED"; count: string | null; headGeneration: string | null; failedAt: number | null; reasons: string[] };
  held: { status: "NO_HELD_STATE" | "AT_HELD" | "ADVANCES_HELD" | "BEHIND_HELD" | "FORKED_FROM_HELD" | "HELD_INVALID" | "NOT_EVALUATED"; reasons: string[] };
  /** Every authorized key, in generation order, only when the whole state is usable; empty otherwise. Exactly one is `CURRENT`. */
  keys: GovernanceKeyEntry[];
  limitations: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (list: readonly string[]): string[] => [...new Set(list)].sort(ordinal);
const strictlyAscending = (list: readonly string[]): boolean => list.every((v, i) => i === 0 || ordinal(list[i - 1] ?? "", v) < 0);
const supported = (algorithm: string): boolean => (SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm);
const isSynthetic = (keyId: string): boolean => keyId.startsWith(SYNTHETIC_KEY_ID_PREFIX);
const withinPolicy = (purposes: readonly string[], allowed: readonly string[]): boolean => purposes.length > 0 && strictlyAscending(purposes) && purposes.every((p) => allowed.includes(p));
const contextOf = (raw: unknown): GovernanceContext => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {});

// ─── the bootstrap ───────────────────────────────────────────────────────────

/** Why a parsed bootstrap cannot be a root, whatever the caller pinned. Fixed codes. */
function bootstrapProblems(artifact: GovernanceBootstrap, allowSynthetic: boolean): string[] {
  const out: string[] = [];
  if (!supported(artifact.root.algorithm)) out.push("BOOTSTRAP_ALGORITHM_UNSUPPORTED");
  else if (ed25519KeyProblem(artifact.root.publicKey) !== null) out.push("BOOTSTRAP_KEY_INADMISSIBLE");
  if (!withinPolicy(artifact.root.purposes, ROOT_PURPOSES)) out.push("BOOTSTRAP_PURPOSE_NOT_PERMITTED");
  if (isSynthetic(artifact.root.keyId) && !allowSynthetic) out.push("SYNTHETIC_KEY_REFUSED");
  return out;
}

const emptyBootstrap = (parse: GovernanceVerification["bootstrap"]["parse"], reasons: string[]): GovernanceVerification["bootstrap"] => ({
  parse,
  digest: null,
  fingerprintText: null,
  rootEpoch: null,
  rootKeyId: null,
  pin: "NOT_EVALUATED",
  epoch: "NOT_EVALUATED",
  reasons,
});

function assessBootstrap(context: GovernanceContext): { dimension: GovernanceVerification["bootstrap"]; artifact: GovernanceBootstrap | null } {
  const raw = context.bootstrap;
  if (raw === undefined || raw === null) return { dimension: emptyBootstrap("NOT_SUPPLIED", ["BOOTSTRAP_NOT_SUPPLIED"]), artifact: null };
  const parsed = parseBootstrap(raw);
  if (!parsed.ok) return { dimension: emptyBootstrap(parsed.unsupportedVersion ? "UNSUPPORTED_VERSION" : "MALFORMED", [parsed.unsupportedVersion ? "BOOTSTRAP_VERSION_UNSUPPORTED" : "BOOTSTRAP_MALFORMED"]), artifact: null };
  const artifact = parsed.artifact;
  const digest = bootstrapDigest(artifact);
  const reasons = bootstrapProblems(artifact, context.allowSynthetic === true);

  let pin: GovernanceVerification["bootstrap"]["pin"] = "UNPINNED";
  const expected = context.expectedBootstrapDigest;
  if (expected !== undefined && expected !== null) {
    if (typeof expected !== "string" || !HEX64_RE.test(expected)) {
      pin = "NOT_EVALUATED";
      reasons.push("BOOTSTRAP_DIGEST_PIN_MALFORMED");
    } else if (expected === digest) pin = "PINNED";
    else {
      pin = "MISMATCHED";
      reasons.push("BOOTSTRAP_DIGEST_MISMATCH");
    }
  }

  let epoch: GovernanceVerification["bootstrap"]["epoch"] = "NOT_EVALUATED";
  const floor = context.minRootEpoch;
  if (floor !== undefined && floor !== null) {
    if (typeof floor !== "string" || !/^[1-9][0-9]{0,3}$/.test(floor)) reasons.push("MINIMUM_EPOCH_MALFORMED");
    else if (Number(artifact.rootEpoch) < Number(floor)) {
      epoch = "BELOW_MINIMUM";
      reasons.push("BOOTSTRAP_EPOCH_BELOW_MINIMUM");
    } else epoch = "ACCEPTED";
  }
  return { dimension: { parse: "PARSED", digest, fingerprintText: formatFingerprint(digest), rootEpoch: artifact.rootEpoch, rootKeyId: artifact.root.keyId, pin, epoch, reasons: uniqueSorted(reasons) }, artifact };
}

// ─── the authorization chain ─────────────────────────────────────────────────

type ChainDimension = GovernanceVerification["chain"];
type OneCheck = { reasons: string[] } | { runtimeUnsupported: true };

interface ChainSeen {
  keyIds: Set<string>;
  publicKeys: Set<string>;
}

const chainResult = (status: ChainDimension["status"], reasons: string[], failedAt: number | null = null, count: string | null = null, headGeneration: string | null = null): ChainDimension => ({ status, count, headGeneration, failedAt, reasons: uniqueSorted(reasons) });

/** Check one authorization against the pinned bootstrap and the chain before it. Reasons are fixed codes; the first group found is returned. */
function checkOne(index: number, raw: unknown, previous: { digest: string } | null, seen: ChainSeen, bootstrap: GovernanceBootstrap, allowSynthetic: boolean): { envelope: AuthorizationEnvelope | null; check: OneCheck } {
  const parsed = parseAuthorization(raw);
  if (!parsed.ok) return { envelope: null, check: { reasons: [parsed.unsupportedVersion ? "AUTHORIZATION_VERSION_UNSUPPORTED" : "AUTHORIZATION_MALFORMED"] } };
  const envelope = parsed.envelope;
  const { statement } = envelope;
  const root = bootstrap.root;
  if (statement.root.keyId !== root.keyId || statement.root.algorithm !== root.algorithm || statement.root.publicKey !== root.publicKey) return { envelope, check: { reasons: ["ROOT_MISMATCH"] } };
  if (statement.rootEpoch !== bootstrap.rootEpoch) return { envelope, check: { reasons: ["ROOT_EPOCH_MISMATCH"] } };

  const signature = verifyEd25519(root.publicKey, authorizationPreimage(statement), envelope.signature);
  if (!signature.valid) return { envelope, check: signature.reason === "RUNTIME_UNSUPPORTED" ? { runtimeUnsupported: true } : { reasons: [signature.reason satisfies SignatureReason] } };

  const reasons: string[] = [];
  if (statement.generation !== String(index + 1)) reasons.push("GENERATION_NOT_CONSECUTIVE");
  if (previous === null) {
    if (statement.supersedes !== null) reasons.push("SUPERSEDES_UNEXPECTED");
  } else if (statement.supersedes === null) reasons.push("SUPERSEDES_MISSING");
  else if (statement.supersedes.authorizationDigest !== previous.digest) reasons.push("SUPERSEDES_DIGEST_MISMATCH");

  const key = statement.authorizedKey;
  if (!supported(key.algorithm)) reasons.push("AUTHORIZED_KEY_ALGORITHM_UNSUPPORTED");
  else if (ed25519KeyProblem(key.publicKey) !== null) reasons.push("AUTHORIZED_KEY_INADMISSIBLE");
  if (key.keyId === root.keyId || key.publicKey === root.publicKey) reasons.push("AUTHORIZED_KEY_IS_ROOT_KEY");
  else if (seen.keyIds.has(key.keyId) || seen.publicKeys.has(key.publicKey)) reasons.push("AUTHORIZED_KEY_REUSED");
  if (!strictlyAscending(key.purposes)) reasons.push("PURPOSES_NOT_ORDERED");
  if (!key.purposes.every((p) => (OPERATIONAL_KEY_PURPOSES as readonly string[]).includes(p))) reasons.push("PURPOSE_NOT_PERMITTED");
  if (isSynthetic(key.keyId) && !allowSynthetic) reasons.push("SYNTHETIC_KEY_REFUSED");
  return { envelope, check: { reasons } };
}

function assessChain(context: GovernanceContext, bootstrap: GovernanceBootstrap): { dimension: ChainDimension; envelopes: AuthorizationEnvelope[] } {
  const raw = context.authorizations;
  const none = (dimension: ChainDimension): { dimension: ChainDimension; envelopes: AuthorizationEnvelope[] } => ({ dimension, envelopes: [] });
  if (raw === undefined || raw === null) return none(chainResult("NOT_SUPPLIED", ["AUTHORIZATIONS_NOT_SUPPLIED"]));
  if (!Array.isArray(raw)) return none(chainResult("INVALID", ["AUTHORIZATION_MALFORMED"]));
  if (raw.length === 0) return none(chainResult("NOT_SUPPLIED", ["AUTHORIZATIONS_EMPTY"]));
  if (raw.length > GOVERNANCE_LIMITS.maxAuthorizations) return none(chainResult("INVALID", ["TOO_MANY_AUTHORIZATIONS"]));

  const seen: ChainSeen = { keyIds: new Set(), publicKeys: new Set() };
  const envelopes: AuthorizationEnvelope[] = [];
  let previous: { digest: string } | null = null;
  for (let i = 0; i < raw.length; i++) {
    const { envelope, check } = checkOne(i, raw[i], previous, seen, bootstrap, context.allowSynthetic === true);
    if ("runtimeUnsupported" in check) return none(chainResult("NOT_CHECKED", ["RUNTIME_UNSUPPORTED"], i));
    if (check.reasons.length > 0 || envelope === null) return none(chainResult("INVALID", check.reasons, i));
    envelopes.push(envelope);
    seen.keyIds.add(envelope.statement.authorizedKey.keyId);
    seen.publicKeys.add(envelope.statement.authorizedKey.publicKey);
    previous = { digest: authorizationDigest(envelope) };
  }
  return { dimension: chainResult("VALID", [], null, String(envelopes.length), String(envelopes.length)), envelopes };
}

/** The keys of a valid chain, in generation order. A key's standing is what the NEXT authorization says about it; the last key is current. */
function keysOf(envelopes: readonly AuthorizationEnvelope[]): GovernanceKeyEntry[] {
  return envelopes.map((envelope, i) => {
    const next = envelopes[i + 1];
    const key = envelope.statement.authorizedKey;
    const supersedes = next?.statement.supersedes ?? null;
    const standing: KeyStanding = next === undefined ? "CURRENT" : (supersedes?.standing ?? "COMPROMISED");
    return {
      generation: envelope.statement.generation,
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      purposes: [...key.purposes],
      standing,
      retainedThrough: next === undefined ? null : (supersedes?.retainedThrough ?? null),
      authorizationDigest: authorizationDigest(envelope),
    };
  });
}

// ─── the held state ──────────────────────────────────────────────────────────

function assessHeld(context: GovernanceContext, keys: readonly GovernanceKeyEntry[], chainValid: boolean): GovernanceVerification["held"] {
  const raw = context.held;
  if (raw === undefined || raw === null) return { status: chainValid ? "NO_HELD_STATE" : "NOT_EVALUATED", reasons: [] };
  const parsed = HeldGovernanceStateSchema.safeParse(raw);
  if (!parsed.success) return { status: "HELD_INVALID", reasons: ["HELD_STATE_MALFORMED"] };
  if (!chainValid) return { status: "NOT_EVALUATED", reasons: [] };
  const held = parsed.data;
  const heldGeneration = Number(held.generation);
  if (keys.length < heldGeneration) return { status: "BEHIND_HELD", reasons: ["GOVERNANCE_ROLLED_BACK_BELOW_HELD_GENERATION"] };
  if (keys[heldGeneration - 1]?.authorizationDigest !== held.authorizationDigest) return { status: "FORKED_FROM_HELD", reasons: ["GOVERNANCE_FORKS_FROM_HELD_STATE"] };
  return { status: keys.length === heldGeneration ? "AT_HELD" : "ADVANCES_HELD", reasons: [] };
}

const heldUsable = (held: GovernanceVerification["held"]): boolean => held.status === "NO_HELD_STATE" || held.status === "AT_HELD" || held.status === "ADVANCES_HELD";

/** Every dimension holds: a well-formed, admitted, non-synthetic-unless-rehearsing bootstrap that was not mismatched or below the floor, a valid chain, and a held state that is not behind or forked. */
function usable(result: GovernanceVerification): boolean {
  return result.bootstrap.parse === "PARSED" && result.bootstrap.reasons.length === 0 && result.chain.status === "VALID" && heldUsable(result.held);
}

const issued = new WeakSet<object>();
const issue = (result: GovernanceVerification): GovernanceVerification => {
  issued.add(result);
  return result;
};

function emptyResult(bootstrap: GovernanceVerification["bootstrap"]): GovernanceVerification {
  return {
    verificationVersion: GOVERNANCE_VERIFICATION_VERSION,
    bootstrap,
    chain: chainResult("NOT_EVALUATED", []),
    held: { status: "NOT_EVALUATED", reasons: [] },
    keys: [],
    limitations: [],
    establishes: GOVERNANCE_ESTABLISHES,
    doesNotEstablish: GOVERNANCE_DOES_NOT_ESTABLISH,
  };
}

function evaluate(context: GovernanceContext): GovernanceVerification {
  const { dimension: bootstrap, artifact } = assessBootstrap(context);
  if (artifact === null) return emptyResult(bootstrap);
  const bootstrapOk = bootstrap.reasons.length === 0;
  if (!bootstrapOk) {
    const result = emptyResult(bootstrap);
    result.held = assessHeld(context, [], false);
    return result;
  }
  const { dimension: chain, envelopes } = assessChain(context, artifact);
  const keys = chain.status === "VALID" ? keysOf(envelopes) : [];
  const held = assessHeld(context, keys, chain.status === "VALID");
  const result: GovernanceVerification = { ...emptyResult(bootstrap), chain, held, keys: [], limitations: [] };
  if (!usable(result)) return result;
  const limitations: string[] = [];
  if (bootstrap.pin !== "PINNED") limitations.push("BOOTSTRAP_UNPINNED");
  if (held.status === "NO_HELD_STATE") limitations.push("GOVERNANCE_STATE_UNHELD");
  return { ...result, keys, limitations: uniqueSorted(limitations) };
}

/** Verify a pinned bootstrap and the root's authorizations. See the module comment for the dimensions; spec section 24 for their meaning. */
export function verifyGovernance(rawContext?: unknown): GovernanceVerification {
  try {
    return issue(deepFreeze(evaluate(contextOf(rawContext))));
  } catch {
    // Input that cannot even be read (a throwing getter, a revoked proxy) is refused, never evaluated and never an exception.
    return issue(deepFreeze(emptyResult(emptyBootstrap("MALFORMED", ["BOOTSTRAP_MALFORMED"]))));
  }
}

/**
 * The governance state to hold as the caller's next, and the only authenticated way to obtain one: the head generation, the digest of that
 * authorization, and the root it belongs to. It accepts only a result `verifyGovernance` itself returned and only a usable one, so a
 * fabricated "everything passed" result mints no state.
 */
export interface HeldGovernance {
  held: { generation: string; authorizationDigest: string };
  rootEpoch: string;
  bootstrapDigest: string;
  currentness: "NO_HELD_STATE" | "AT_HELD" | "ADVANCES_HELD";
  limitations: readonly string[];
}

export function heldGovernanceState(verification: GovernanceVerification): HeldGovernance | null {
  const v = verification;
  if (typeof v !== "object" || v === null || !issued.has(v) || !usable(v)) return null;
  const head = v.keys[v.keys.length - 1];
  if (head === undefined || v.bootstrap.rootEpoch === null || v.bootstrap.digest === null) return null;
  const currentness = v.held.status;
  if (currentness !== "NO_HELD_STATE" && currentness !== "AT_HELD" && currentness !== "ADVANCES_HELD") return null;
  return deepFreeze({ held: { generation: head.generation, authorizationDigest: head.authorizationDigest }, rootEpoch: v.bootstrap.rootEpoch, bootstrapDigest: v.bootstrap.digest, currentness, limitations: [...v.limitations] });
}

// ─── the explicit trust root, and reliance on one checkpoint ─────────────────

const asGovernancePurposes = (purposes: readonly string[]): GovernanceKeyPurpose[] => purposes.filter((p): p is GovernanceKeyPurpose => (GOVERNANCE_KEY_PURPOSES as readonly string[]).includes(p));

function rootOf(entries: readonly GovernanceKeyEntry[]): GovernanceTrustRoot {
  const keys = [...entries].sort((a, b) => ordinal(a.keyId, b.keyId)).map((k) => ({ keyId: k.keyId, algorithm: k.algorithm, publicKey: k.publicKey, purposes: asGovernancePurposes(k.purposes) }));
  return { type: GOVERNANCE_TRUST_ROOT_TYPE, formatVersion: GOVERNANCE_TRUST_ROOT_FORMAT_VERSION, keys };
}

/**
 * The trust root of spec section 23.4 that a usable governance state yields: exactly the one key that is CURRENT, with the purposes the root
 * granted it. `verifyCheckpoint` takes it unchanged. Null for anything that is not a usable result `verifyGovernance` itself returned.
 */
export function deriveCheckpointTrustRoot(verification: GovernanceVerification): GovernanceTrustRoot | null {
  const v = verification;
  if (typeof v !== "object" || v === null || !issued.has(v) || !usable(v)) return null;
  const current = v.keys.find((k) => k.standing === "CURRENT");
  return current === undefined ? null : rootOf([current]);
}

export interface Reliance {
  status: "RELIED_UPON" | "NOT_RELIED_UPON" | "NOT_EVALUATED";
  keyStanding: "CURRENT" | "RETIRED" | "COMPROMISED" | "UNKNOWN" | "NOT_EVALUATED";
  /** The generation at which the root authorized the checkpoint's signer key, when it did. */
  authorizedAtGeneration: string | null;
  reasons: string[];
  limitations: string[];
}

const noReliance = (status: Reliance["status"], keyStanding: Reliance["keyStanding"], generation: string | null, reasons: string[], limitations: string[] = []): Reliance => ({ status, keyStanding, authorizedAtGeneration: generation, reasons, limitations });

/** Is this checkpoint committed state beyond the state the root stood behind? Either log past its retained count is beyond. */
const beyondRetained = (committed: CommittedState, kept: CommittedState): boolean =>
  Number(committed.registry.headVersion) > Number(kept.registry.headVersion) || Number(committed.acceptanceLedger.entryCount) > Number(kept.acceptanceLedger.entryCount);

/** At exactly the retained count the head must be exactly the retained head: a retired key cannot sign another history at the last state the root reviewed. */
const headDiffersAtRetained = (committed: CommittedState, kept: CommittedState): boolean =>
  (committed.registry.headVersion === kept.registry.headVersion && committed.registry.headDigest !== kept.registry.headDigest) ||
  (committed.acceptanceLedger.entryCount === kept.acceptanceLedger.entryCount && committed.acceptanceLedger.headDigest !== kept.acceptanceLedger.headDigest);

/** `parseCheckpoint` never echoes input, but input that cannot even be read (a throwing getter) must not escape as an exception from here. */
function readCheckpoint(raw: unknown): CheckpointParseResult {
  try {
    return parseCheckpoint(raw);
  } catch {
    return { ok: false, problem: "SHAPE", unsupportedVersion: false };
  }
}

function assessReliance(governance: GovernanceVerification, parsed: CheckpointParseResult): Reliance {
  if (!usable(governance)) return noReliance("NOT_EVALUATED", "NOT_EVALUATED", null, ["GOVERNANCE_STATE_NOT_USABLE"]);
  if (!parsed.ok) return noReliance("NOT_EVALUATED", "NOT_EVALUATED", null, ["CHECKPOINT_NOT_PARSED"]);
  const { statement } = parsed.envelope;
  const entry = governance.keys.find((k) => k.keyId === statement.signer.keyId);
  if (entry === undefined) return noReliance("NOT_RELIED_UPON", "UNKNOWN", null, ["SIGNER_NOT_AUTHORIZED_BY_ROOT"]);
  if (entry.algorithm !== statement.signer.algorithm || entry.publicKey !== statement.signer.publicKey) return noReliance("NOT_RELIED_UPON", "UNKNOWN", null, ["SIGNER_KEY_MATERIAL_MISMATCH"]);
  if (entry.standing === "CURRENT") return noReliance("RELIED_UPON", "CURRENT", entry.generation, []);
  const kept = entry.retainedThrough;
  if (kept === null) return noReliance("NOT_RELIED_UPON", entry.standing, entry.generation, ["KEY_SUPERSEDED_NOT_RETAINED"]);
  const committed: CommittedState = { registry: statement.registry, acceptanceLedger: statement.acceptanceLedger };
  if (beyondRetained(committed, kept)) return noReliance("NOT_RELIED_UPON", entry.standing, entry.generation, ["CHECKPOINT_BEYOND_RETAINED_STATE"]);
  if (headDiffersAtRetained(committed, kept)) return noReliance("NOT_RELIED_UPON", entry.standing, entry.generation, ["CHECKPOINT_HEAD_DIFFERS_AT_RETAINED_STATE"]);
  return noReliance("RELIED_UPON", entry.standing, entry.generation, [], ["SUPERSEDED_KEY_RETAINED_PREFIX_ONLY"]);
}

export interface GovernedCheckpointContext extends GovernanceContext {
  /** Forwarded unchanged to `verifyCheckpoint`: the registry chain, the acceptance ledger, extension, the checkpoint anchor and the published identifier. */
  keyRegistry?: unknown;
  acceptanceLedger?: unknown;
  allowExtension?: boolean;
  anchor?: unknown;
  expectedDigest?: unknown;
}

export interface GovernedCheckpointVerification {
  governance: GovernanceVerification;
  reliance: Reliance;
  /** The unchanged section 23 result, produced under the trust root derived from the governance state, never from the checkpoint. */
  checkpoint: CheckpointVerification;
}

const issuedGoverned = new WeakSet<object>();

/**
 * Verify one checkpoint under a governance state. The signature is judged by `verifyCheckpoint` exactly as before (it stays VALID for a
 * superseded or compromised key: cryptographic validity never depends on standing); what the governance state adds is whether the signer is
 * a key the root authorized and the caller may still rely on, for this checkpoint's committed state (`reliance`). A key the caller may not
 * rely on is left out of the derived root, so `verifyCheckpoint` reports its signer as not authorized and mints no anchors.
 */
export function verifyGovernedCheckpoint(checkpoint: unknown, rawContext?: unknown): GovernedCheckpointVerification {
  const context = contextOf(rawContext) as GovernedCheckpointContext;
  const governance = verifyGovernance(context);
  const parsed = readCheckpoint(checkpoint);
  const reliance = assessReliance(governance, parsed);

  let trustRoot: GovernanceTrustRoot | undefined;
  if (usable(governance)) {
    const current = governance.keys.find((k) => k.standing === "CURRENT");
    const signer = reliance.status === "RELIED_UPON" && parsed.ok ? governance.keys.find((k) => k.keyId === parsed.envelope.statement.signer.keyId) : undefined;
    const entries = [current, signer].filter((k): k is GovernanceKeyEntry => k !== undefined);
    if (entries.length > 0) trustRoot = rootOf([...new Map(entries.map((k) => [k.keyId, k])).values()]);
  }

  const forwarded: CheckpointContext = {};
  if (trustRoot !== undefined) forwarded.trustRoot = trustRoot;
  if (context.keyRegistry !== undefined) forwarded.keyRegistry = context.keyRegistry;
  if (context.acceptanceLedger !== undefined) forwarded.acceptanceLedger = context.acceptanceLedger;
  if (context.allowExtension !== undefined) forwarded.allowExtension = context.allowExtension;
  if (context.anchor !== undefined) forwarded.anchor = context.anchor;
  if (context.expectedDigest !== undefined) forwarded.expectedDigest = context.expectedDigest;

  const result: GovernedCheckpointVerification = { governance, reliance: deepFreeze(reliance), checkpoint: verifyCheckpoint(checkpoint, forwarded) };
  issuedGoverned.add(result);
  return Object.freeze(result);
}

/**
 * The anchors of section 23, given only when governance also relies on the signer: a usable governance state, a signer that is the current key
 * or a superseded one inside the state the root named, and every dimension of `checkpointAnchors`. Only a result `verifyGovernedCheckpoint`
 * itself returned is accepted.
 */
export function governedCheckpointAnchors(result: GovernedCheckpointVerification): CheckpointAnchors | null {
  if (typeof result !== "object" || result === null || !issuedGoverned.has(result)) return null;
  if (result.reliance.status !== "RELIED_UPON" || !usable(result.governance)) return null;
  return checkpointAnchors(result.checkpoint);
}

// ─── pinning a bootstrap, and resetting to a new root ────────────────────────

export interface PinAssessment {
  status: "PIN_ACCEPTED" | "PIN_REFUSED";
  digest: string | null;
  fingerprintText: string | null;
  /** The distinct origins that confirmed this digest. Two confirmations from one origin are one origin. */
  origins: string[];
  reasons: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const PIN_ESTABLISHES =
  "That the candidate is a well-formed public root whose digest the caller reports having read, identically, from at least two distinct origins. A pin is the caller's decision, made through channels the caller relies upon; it is not a signature.";
const PIN_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "that the origins the caller named are independent in fact: a GitHub release, a GitHub-hosted document and a GitHub-hosted verifier release are one origin, and the caller classifies them",
  "that any origin is WalletWall's, or that the root private key is held by WalletWall",
  "that the root key is uncompromised",
]);

function assessPin(rawCandidate: unknown, rawConfirmations: unknown, allowSynthetic: boolean): PinAssessment {
  const refuse = (reasons: string[], digest: string | null = null, origins: string[] = []): PinAssessment => ({
    status: "PIN_REFUSED",
    digest,
    fingerprintText: digest === null ? null : formatFingerprint(digest),
    origins,
    reasons: uniqueSorted(reasons),
    establishes: PIN_ESTABLISHES,
    doesNotEstablish: PIN_DOES_NOT_ESTABLISH,
  });
  const parsed = parseBootstrap(rawCandidate);
  if (!parsed.ok) return refuse(["CANDIDATE_MALFORMED"]);
  const digest = bootstrapDigest(parsed.artifact);
  const reasons = bootstrapProblems(parsed.artifact, allowSynthetic);
  if (!Array.isArray(rawConfirmations) || rawConfirmations.length > GOVERNANCE_LIMITS.maxConfirmations) return refuse([...reasons, "CONFIRMATIONS_MALFORMED"], digest);
  const origins = new Set<string>();
  for (const raw of rawConfirmations) {
    const confirmation = ConfirmationSchema.safeParse(raw);
    if (!confirmation.success) return refuse([...reasons, "CONFIRMATIONS_MALFORMED"], digest);
    if (confirmation.data.digest !== digest) reasons.push("CONFIRMATION_DIGEST_MISMATCH");
    else origins.add(confirmation.data.origin);
  }
  if (origins.size < MINIMUM_INDEPENDENT_ORIGINS) reasons.push("INSUFFICIENT_INDEPENDENT_ORIGINS");
  const list = uniqueSorted([...origins]);
  return reasons.length === 0 ? { status: "PIN_ACCEPTED", digest, fingerprintText: formatFingerprint(digest), origins: list, reasons: [], establishes: PIN_ESTABLISHES, doesNotEstablish: PIN_DOES_NOT_ESTABLISH } : refuse(reasons, digest, list);
}

/**
 * May a consumer pin this candidate bootstrap? A well-formed public root whose digest at least two DISTINCT origins confirm. The function has
 * no input through which a signature could stand in for a confirmation, and no way to treat the artifact's own channel as one origin more.
 */
export function assessBootstrapPin(candidate: unknown, confirmations: unknown, options?: { allowSynthetic?: boolean }): PinAssessment {
  try {
    return deepFreeze(assessPin(candidate, confirmations, options?.allowSynthetic === true));
  } catch {
    return deepFreeze({ status: "PIN_REFUSED", digest: null, fingerprintText: null, origins: [], reasons: ["CANDIDATE_MALFORMED"], establishes: PIN_ESTABLISHES, doesNotEstablish: PIN_DOES_NOT_ESTABLISH });
  }
}

export interface ResetAssessment {
  status: "RESET_ACCEPTED" | "RESET_REFUSED";
  newRootEpoch: string | null;
  newBootstrapDigest: string | null;
  /** What the consumer does on acceptance: replace the pinned bootstrap and raise the minimum epoch. Nothing here does it for them. */
  consumerAction: "REPLACE_PINNED_BOOTSTRAP_AND_RAISE_MINIMUM_EPOCH" | "NONE";
  reasons: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const RESET_ESTABLISHES =
  "That the candidate is a valid public root at a higher epoch than the root the caller relies on, with a different root key, confirmed by at least two distinct origins the caller named. Accepting is the caller's act of re-pinning.";
const RESET_DOES_NOT_ESTABLISH: readonly string[] = Object.freeze([
  "that the previous root was or was not compromised, or that the previous root approved this reset: no signature of the previous root is an input, and none would count",
  "that anything the previous root or its operational keys signed is wrong, or right: it stays cryptographically valid and is no longer authorized under the new root",
  ...PIN_DOES_NOT_ESTABLISH,
]);

/**
 * May a consumer move from the root it relies on to a new one? Only by an out-of-band trust reset: a higher epoch, a different root key and a
 * confirmed fingerprint. There is deliberately no parameter for a signature by the previous root: a compromised root can sign a successor of
 * its own choosing, so such a signature is evidence of nothing the reset needs.
 */
export function assessRootReset(pinned: unknown, candidate: unknown, confirmations: unknown, options?: { allowSynthetic?: boolean }): ResetAssessment {
  const refuse = (reasons: string[], epoch: string | null = null, digest: string | null = null): ResetAssessment => ({
    status: "RESET_REFUSED",
    newRootEpoch: epoch,
    newBootstrapDigest: digest,
    consumerAction: "NONE",
    reasons: uniqueSorted(reasons),
    establishes: RESET_ESTABLISHES,
    doesNotEstablish: RESET_DOES_NOT_ESTABLISH,
  });
  try {
    const current = PinnedRootSchema.safeParse(pinned);
    if (!current.success) return deepFreeze(refuse(["PINNED_STATE_MALFORMED"]));
    const pin = assessPin(candidate, confirmations, options?.allowSynthetic === true);
    const parsed = parseBootstrap(candidate);
    const reasons = [...pin.reasons];
    if (parsed.ok) {
      if (Number(parsed.artifact.rootEpoch) <= Number(current.data.rootEpoch)) reasons.push("EPOCH_NOT_GREATER");
      if (parsed.artifact.root.publicKey === current.data.rootPublicKey) reasons.push("ROOT_KEY_UNCHANGED");
    }
    if (reasons.length > 0 || !parsed.ok) return deepFreeze(refuse(reasons, parsed.ok ? parsed.artifact.rootEpoch : null, pin.digest));
    return deepFreeze({ status: "RESET_ACCEPTED", newRootEpoch: parsed.artifact.rootEpoch, newBootstrapDigest: pin.digest, consumerAction: "REPLACE_PINNED_BOOTSTRAP_AND_RAISE_MINIMUM_EPOCH", reasons: [], establishes: RESET_ESTABLISHES, doesNotEstablish: RESET_DOES_NOT_ESTABLISH });
  } catch {
    return deepFreeze(refuse(["CANDIDATE_MALFORMED"]));
  }
}
