import { hasForbiddenStructure } from "../schemas.ts";
import { verifyAcceptanceLedger, type AcceptanceEntry } from "./acceptance-ledger.ts";
import { SUPPORTED_ALGORITHMS, type SignatureReason, type SignatureStatus } from "./attestation-vocabulary.ts";
import {
  CHECKPOINT_DOES_NOT_ESTABLISH,
  CHECKPOINT_ESTABLISHES,
  CHECKPOINT_VERIFICATION_VERSION,
  type CheckpointPurpose,
} from "./checkpoint-vocabulary.ts";
import { CommittedStateSchema, checkpointDigest, checkpointPreimage, parseCheckpoint, parseGovernanceTrustRoot, type CheckpointEnvelope, type CheckpointStatement, type CommittedState } from "./checkpoint.ts";
import { verifyEd25519 } from "./ed25519.ts";
import { deepFreeze } from "./freeze.ts";
import { verifyKeyRegistryChain, type KeyRegistrySnapshot } from "./key-registry.ts";

/**
 * Trust-checkpoint verification: a pure function from one detached checkpoint and the inputs the caller holds to a structured
 * result of separate dimensions. There is no `verified` flag. The result says what was checked and what that does and does not
 * authenticate; it never says a record, an attestation or an assessor is right.
 *
 *   signature       did this key sign exactly these bytes?                           (cryptography only; needs no root)
 *   signer          is that key one the supplied governance trust root authorizes    (never the checkpoint's own claim)
 *                   for this purpose?
 *   registry        is the supplied signing-key registry the state that was          (chain valid; heads and count)
 *                   committed: exactly it, or it with more after?
 *   acceptanceLedger  the same for the acceptance ledger prefix
 *   crossBinding    do the committed ledger entries name only registry versions      (the ordering rule)
 *                   that exist in the committed registry state, with its digests?
 *   anchor          relative to a checkpoint state the caller already relies on:     (rollback)
 *                   the same, a successor, older, or a fork?
 *
 * A dimension whose input is missing is reported as not supplied or not evaluated, never defaulted. Never throws; no fixed-code
 * reason echoes caller text. Nothing here reads a clock, a file, the network or the environment.
 */

export interface CheckpointContext {
  /** The governance keys the verifier accepts a checkpoint from, and for what. Explicit, from the verifier's own channel; never read from the checkpoint or the registry. */
  trustRoot?: unknown;
  /** The whole signing-key registry chain, versions 1..N, ascending. */
  keyRegistry?: unknown;
  /** The acceptance ledger, entries 1..M, ascending (an empty array is a valid, empty ledger). */
  acceptanceLedger?: unknown;
  /**
   * Whether the supplied chain and ledger may run past what the checkpoint committed. By default they must be exactly the committed state:
   * more than was committed is refused as a different state claiming to be this checkpoint. When true, the committed state must still be
   * an exact prefix, and everything after it is reported as not covered, never as authenticated.
   */
  allowExtension?: boolean;
  /** The committed state of a checkpoint the caller already relies on (a previous result's `committed`). Without one nothing says this checkpoint is not an older one. */
  anchor?: unknown;
  /** The identifier the checkpoint was published or pinned under (`checkpointDigest`); the reader recomputes it, so a mislabelled artifact is caught. */
  expectedDigest?: unknown;
}

export interface LogDimension {
  chain: "VALID" | "INVALID" | "NOT_SUPPLIED";
  state: "MATCHED" | "EXTENDED" | "MISMATCHED" | "NOT_EVALUATED";
  /** The number of entries the checkpoint committed (registry versions, or ledger entries). */
  committed: string | null;
  /** The number of entries in the supplied log when it is a valid chain. */
  supplied: string | null;
  /** How many supplied entries lie past the committed prefix. The checkpoint says nothing about them. */
  uncovered: string | null;
  reasons: string[];
}

export interface CheckpointVerification {
  verificationVersion: string;
  parse: "PARSED" | "MALFORMED" | "UNSUPPORTED_VERSION";
  parseProblem: string | null;
  checkpointDigest: string | null;
  purpose: CheckpointPurpose | null;
  signerKeyId: string | null;
  algorithm: string | null;
  /**
   * What the parsed statement SAYS it commits, for any checkpoint that parsed, including one whose signature or signer failed. It is
   * authenticated only if `checkpointAnchors(result)` is non-null; hold `checkpointAnchors(result).committed`, never this field alone, as an anchor.
   */
  committed: CommittedState | null;
  identity: { status: "MATCHED" | "MISMATCHED" | "NOT_COMPARED"; reasons: string[] };
  signature: { status: SignatureStatus; reasons: SignatureReason[] };
  signer: { key: "KNOWN" | "UNKNOWN" | "MATERIAL_MISMATCH" | "NOT_EVALUATED"; authorization: "AUTHORIZED" | "NOT_AUTHORIZED" | "NOT_EVALUATED"; reasons: string[] };
  registry: LogDimension;
  acceptanceLedger: LogDimension;
  crossBinding: { status: "CONSISTENT" | "INCONSISTENT" | "NOT_EVALUATED"; reasons: string[] };
  anchor: { status: "NO_ANCHOR" | "AT_ANCHOR" | "ADVANCES_ANCHOR" | "BEHIND_ANCHOR" | "FORKED_FROM_ANCHOR" | "ANCHOR_INVALID" | "NOT_EVALUATED"; reasons: string[] };
  limitations: string[];
  establishes: string;
  doesNotEstablish: readonly string[];
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (list: readonly string[]): string[] => [...new Set(list)].sort(ordinal);
const compare = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

const notEvaluatedLog = (reasons: readonly string[], chain: LogDimension["chain"], committed: string | null): LogDimension => ({
  chain,
  state: "NOT_EVALUATED",
  committed,
  supplied: null,
  uncovered: null,
  reasons: uniqueSorted(reasons),
});

function checkSignature(statement: CheckpointStatement, signature: string): { status: SignatureStatus; reasons: SignatureReason[] } {
  const { algorithm, publicKey } = statement.signer;
  if (!(SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm)) return { status: "NOT_CHECKED", reasons: ["ALGORITHM_UNSUPPORTED"] };
  const result = verifyEd25519(publicKey, checkpointPreimage(statement), signature);
  if (result.valid) return { status: "VALID", reasons: [] };
  return result.reason === "RUNTIME_UNSUPPORTED" ? { status: "NOT_CHECKED", reasons: ["RUNTIME_UNSUPPORTED"] } : { status: "INVALID", reasons: [result.reason] };
}

function assessSigner(statement: CheckpointStatement, trustRoot: unknown): CheckpointVerification["signer"] {
  if (trustRoot === undefined || trustRoot === null) return { key: "NOT_EVALUATED", authorization: "NOT_EVALUATED", reasons: ["TRUST_ROOT_NOT_SUPPLIED"] };
  const parsed = parseGovernanceTrustRoot(trustRoot);
  if (!parsed.ok) return { key: "NOT_EVALUATED", authorization: "NOT_EVALUATED", reasons: ["TRUST_ROOT_INVALID"] };
  const found = parsed.root.keys.find((k) => k.keyId === statement.signer.keyId);
  if (found === undefined) return { key: "UNKNOWN", authorization: "NOT_AUTHORIZED", reasons: ["SIGNER_UNKNOWN"] };
  if (found.algorithm !== statement.signer.algorithm || found.publicKey !== statement.signer.publicKey) return { key: "MATERIAL_MISMATCH", authorization: "NOT_AUTHORIZED", reasons: ["SIGNER_KEY_MATERIAL_MISMATCH"] };
  if (!found.purposes.some((p) => p === statement.purpose)) return { key: "KNOWN", authorization: "NOT_AUTHORIZED", reasons: ["PURPOSE_NOT_GRANTED"] };
  return { key: "KNOWN", authorization: "AUTHORIZED", reasons: [] };
}

type Supplied<T> = { kind: "NOT_SUPPLIED" } | { kind: "INVALID" } | { kind: "VALID"; items: readonly T[] };

const suppliedRegistry = (raw: unknown): Supplied<KeyRegistrySnapshot> => {
  if (raw === undefined || raw === null) return { kind: "NOT_SUPPLIED" };
  const chain = verifyKeyRegistryChain(raw);
  return chain.ok ? { kind: "VALID", items: chain.chain } : { kind: "INVALID" };
};

const suppliedLedger = (raw: unknown): Supplied<AcceptanceEntry> => {
  if (raw === undefined || raw === null) return { kind: "NOT_SUPPLIED" };
  const ledger = verifyAcceptanceLedger(raw);
  return ledger.ok ? { kind: "VALID", items: ledger.entries } : { kind: "INVALID" };
};

interface LogCodes {
  notSupplied: string;
  invalid: string;
  truncated: string;
  headMismatch: string;
  extended: string;
}

/** Compare one supplied log with the prefix the checkpoint committed: the head at the committed position must be the committed head. */
function logDimension<T>(supplied: Supplied<T>, committedCount: number, committedHead: string | null, headAt: (items: readonly T[], count: number) => string | null, allowExtension: boolean, codes: LogCodes): LogDimension {
  if (supplied.kind === "NOT_SUPPLIED") return notEvaluatedLog([codes.notSupplied], "NOT_SUPPLIED", String(committedCount));
  if (supplied.kind === "INVALID") return notEvaluatedLog([codes.invalid], "INVALID", String(committedCount));
  const length = supplied.items.length;
  const base = { chain: "VALID" as const, committed: String(committedCount), supplied: String(length) };
  if (length < committedCount) return { ...base, state: "MISMATCHED", uncovered: "0", reasons: [codes.truncated] };
  if (headAt(supplied.items, committedCount) !== committedHead) return { ...base, state: "MISMATCHED", uncovered: String(length - committedCount), reasons: [codes.headMismatch] };
  if (length === committedCount) return { ...base, state: "MATCHED", uncovered: "0", reasons: [] };
  return allowExtension
    ? { ...base, state: "EXTENDED", uncovered: String(length - committedCount), reasons: [] }
    : { ...base, state: "MISMATCHED", uncovered: String(length - committedCount), reasons: [codes.extended] };
}

const registryHeadAt = (items: readonly KeyRegistrySnapshot[], count: number): string | null => items[count - 1]?.digest ?? null;
const ledgerHeadAt = (items: readonly AcceptanceEntry[], count: number): string | null => (count === 0 ? null : (items[count - 1]?.entryDigest ?? null));

const usable = (d: LogDimension): boolean => d.chain === "VALID" && (d.state === "MATCHED" || d.state === "EXTENDED");

/**
 * The ordering rule. The committed ledger prefix may name only registry versions that exist in the committed registry state, and the
 * digest it records for each must be that version's own digest in the supplied chain. A checkpoint over a combination that cannot
 * have existed (an entry accepted under a registry version past the committed head) is refused as inconsistent.
 *
 * Against an anchor the checkpoint advances, one more rule: a checkpoint is signed over the registry and ledger exactly as they stand,
 * and the registry only grows, so an entry appended after the anchored prefix was accepted when the registry head was at least the
 * anchored head. An entry since the anchor that names an older registry version was written without regard to the registry as it
 * stood, which is what a back-dated acceptance looks like. This rule needs the caller's anchor and the publication convention above;
 * it cannot see a back-dated entry that names a version at or after the anchored head, which is why an anchor taken before a
 * compromise was recorded leaves that window open (spec/WALLPRINT_ATTESTATIONS.md, section 23).
 */
function crossBinding(
  registry: Supplied<KeyRegistrySnapshot>,
  ledger: Supplied<AcceptanceEntry>,
  dims: { registry: LogDimension; ledger: LogDimension },
  committed: CommittedState,
  anchored: { anchor: CommittedState; advances: boolean } | null,
): CheckpointVerification["crossBinding"] {
  if (registry.kind !== "VALID" || ledger.kind !== "VALID" || !usable(dims.registry) || !usable(dims.ledger)) return { status: "NOT_EVALUATED", reasons: ["STATE_NOT_ESTABLISHED"] };
  const registryCount = Number(committed.registry.headVersion);
  const ledgerCount = Number(committed.acceptanceLedger.entryCount);
  const reasons: string[] = [];
  for (const entry of ledger.items.slice(0, ledgerCount)) {
    const version = Number(entry.acceptedUnder.keyRegistryVersion);
    if (version > registryCount) reasons.push("LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION");
    else if (registry.items[version - 1]?.digest !== entry.acceptedUnder.keyRegistryDigest) reasons.push("LEDGER_REGISTRY_DIGEST_MISMATCH");
  }
  if (anchored !== null && anchored.advances) {
    const anchoredHead = Number(anchored.anchor.registry.headVersion);
    for (const entry of ledger.items.slice(Number(anchored.anchor.acceptanceLedger.entryCount), ledgerCount)) {
      if (Number(entry.acceptedUnder.keyRegistryVersion) < anchoredHead) reasons.push("LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD");
    }
  }
  return reasons.length === 0 ? { status: "CONSISTENT", reasons: [] } : { status: "INCONSISTENT", reasons: uniqueSorted(reasons) };
}

type AnchorInput = { kind: "NONE" } | { kind: "INVALID" } | { kind: "HELD"; anchor: CommittedState };

function readAnchor(raw: unknown): AnchorInput {
  if (raw === undefined || raw === null) return { kind: "NONE" };
  const parsed = hasForbiddenStructure(raw) ? null : CommittedStateSchema.safeParse(raw);
  return parsed === null || !parsed.success ? { kind: "INVALID" } : { kind: "HELD", anchor: parsed.data };
}

/** Is this checkpoint the caller's anchored state, a successor of it, older than it, or a fork of it? Counts decide order; the supplied logs prove continuity. */
function assessAnchor(committed: CommittedState, held: AnchorInput, registry: Supplied<KeyRegistrySnapshot>, ledger: Supplied<AcceptanceEntry>, dims: { registry: LogDimension; ledger: LogDimension }): CheckpointVerification["anchor"] {
  if (held.kind === "NONE") return { status: "NO_ANCHOR", reasons: [] };
  if (held.kind === "INVALID") return { status: "ANCHOR_INVALID", reasons: ["ANCHOR_MALFORMED"] };
  const anchor = held.anchor;
  const registryOrder = compare(Number(committed.registry.headVersion), Number(anchor.registry.headVersion));
  const ledgerOrder = compare(Number(committed.acceptanceLedger.entryCount), Number(anchor.acceptanceLedger.entryCount));
  const forks: CheckpointVerification["anchor"] = { status: "FORKED_FROM_ANCHOR", reasons: ["CHECKPOINT_FORKS_FROM_ANCHOR"] };
  if ((registryOrder < 0 && ledgerOrder > 0) || (registryOrder > 0 && ledgerOrder < 0)) return forks;
  if (registryOrder < 0 || ledgerOrder < 0) return { status: "BEHIND_ANCHOR", reasons: ["CHECKPOINT_BEHIND_ANCHOR"] };
  if (registryOrder === 0 && committed.registry.headDigest !== anchor.registry.headDigest) return forks;
  if (ledgerOrder === 0 && committed.acceptanceLedger.headDigest !== anchor.acceptanceLedger.headDigest) return forks;
  if (registryOrder === 0 && ledgerOrder === 0) return { status: "AT_ANCHOR", reasons: [] };
  if (registry.kind !== "VALID" || ledger.kind !== "VALID" || !usable(dims.registry) || !usable(dims.ledger)) return { status: "NOT_EVALUATED", reasons: ["ANCHOR_CONTINUITY_NOT_CHECKED"] };
  const registryHeld = registryHeadAt(registry.items, Number(anchor.registry.headVersion)) === anchor.registry.headDigest;
  const ledgerHeld = ledgerHeadAt(ledger.items, Number(anchor.acceptanceLedger.entryCount)) === anchor.acceptanceLedger.headDigest;
  return registryHeld && ledgerHeld ? { status: "ADVANCES_ANCHOR", reasons: [] } : forks;
}

function emptyResult(parse: "MALFORMED" | "UNSUPPORTED_VERSION", problem: string): CheckpointVerification {
  return {
    verificationVersion: CHECKPOINT_VERIFICATION_VERSION,
    parse,
    parseProblem: problem,
    checkpointDigest: null,
    purpose: null,
    signerKeyId: null,
    algorithm: null,
    committed: null,
    identity: { status: "NOT_COMPARED", reasons: [] },
    signature: { status: "NOT_CHECKED", reasons: [] },
    signer: { key: "NOT_EVALUATED", authorization: "NOT_EVALUATED", reasons: [] },
    registry: notEvaluatedLog([], "NOT_SUPPLIED", null),
    acceptanceLedger: notEvaluatedLog([], "NOT_SUPPLIED", null),
    crossBinding: { status: "NOT_EVALUATED", reasons: ["STATE_NOT_ESTABLISHED"] },
    anchor: { status: "NOT_EVALUATED", reasons: [] },
    limitations: [],
    establishes: CHECKPOINT_ESTABLISHES,
    doesNotEstablish: CHECKPOINT_DOES_NOT_ESTABLISH,
  };
}

function verifyParsed(envelope: CheckpointEnvelope, context: CheckpointContext): CheckpointVerification {
  const { statement } = envelope;
  const digest = checkpointDigest(envelope);
  const committed: CommittedState = { registry: statement.registry, acceptanceLedger: statement.acceptanceLedger };

  const identity: CheckpointVerification["identity"] =
    context.expectedDigest === undefined || context.expectedDigest === null
      ? { status: "NOT_COMPARED", reasons: [] }
      : context.expectedDigest === digest
        ? { status: "MATCHED", reasons: [] }
        : { status: "MISMATCHED", reasons: ["CHECKPOINT_DIGEST_MISMATCH"] };

  const signature = checkSignature(statement, envelope.signature);
  const signer = assessSigner(statement, context.trustRoot);

  const allowExtension = context.allowExtension === true;
  const registrySupplied = suppliedRegistry(context.keyRegistry);
  const ledgerSupplied = suppliedLedger(context.acceptanceLedger);
  const registry = logDimension(registrySupplied, Number(committed.registry.headVersion), committed.registry.headDigest, registryHeadAt, allowExtension, {
    notSupplied: "REGISTRY_NOT_SUPPLIED",
    invalid: "REGISTRY_CHAIN_INVALID",
    truncated: "REGISTRY_TRUNCATED",
    headMismatch: "REGISTRY_HEAD_MISMATCH",
    extended: "REGISTRY_EXTENDED_BEYOND_CHECKPOINT",
  });
  const acceptanceLedger = logDimension(ledgerSupplied, Number(committed.acceptanceLedger.entryCount), committed.acceptanceLedger.headDigest, ledgerHeadAt, allowExtension, {
    notSupplied: "LEDGER_NOT_SUPPLIED",
    invalid: "LEDGER_CHAIN_INVALID",
    truncated: "LEDGER_TRUNCATED",
    headMismatch: "LEDGER_HEAD_MISMATCH",
    extended: "LEDGER_EXTENDED_BEYOND_CHECKPOINT",
  });
  const dims = { registry, ledger: acceptanceLedger };
  const held = readAnchor(context.anchor);
  const anchor = assessAnchor(committed, held, registrySupplied, ledgerSupplied, dims);
  const cross = crossBinding(registrySupplied, ledgerSupplied, dims, committed, held.kind === "HELD" ? { anchor: held.anchor, advances: anchor.status === "ADVANCES_ANCHOR" } : null);

  const limitations: string[] = [];
  if (anchor.status === "NO_ANCHOR" || anchor.status === "ANCHOR_INVALID") limitations.push("CHECKPOINT_UNANCHORED");
  if (registry.state === "EXTENDED") limitations.push("REGISTRY_EXTENDED_BEYOND_CHECKPOINT");
  if (acceptanceLedger.state === "EXTENDED") limitations.push("LEDGER_EXTENDED_BEYOND_CHECKPOINT");

  return deepFreeze({
    verificationVersion: CHECKPOINT_VERIFICATION_VERSION,
    parse: "PARSED",
    parseProblem: null,
    checkpointDigest: digest,
    purpose: statement.purpose,
    signerKeyId: statement.signer.keyId,
    algorithm: statement.signer.algorithm,
    committed,
    identity,
    signature,
    signer,
    registry,
    acceptanceLedger,
    crossBinding: cross,
    anchor,
    limitations: uniqueSorted(limitations),
    establishes: CHECKPOINT_ESTABLISHES,
    doesNotEstablish: CHECKPOINT_DOES_NOT_ESTABLISH,
  });
}

/** Verify one checkpoint. See the module comment for the dimensions; spec/WALLPRINT_ATTESTATIONS.md, section 23, for their meaning. */
export function verifyCheckpoint(input: unknown, context?: CheckpointContext | null): CheckpointVerification {
  try {
    const parsed = parseCheckpoint(input);
    if (!parsed.ok) return issue(deepFreeze(emptyResult(parsed.unsupportedVersion ? "UNSUPPORTED_VERSION" : "MALFORMED", parsed.problem)));
    return issue(verifyParsed(parsed.envelope, contextOf(context)));
  } catch {
    // Input that cannot even be read (a throwing getter, a revoked proxy) is refused, never evaluated and never an exception.
    return issue(deepFreeze(emptyResult("MALFORMED", "SHAPE")));
  }
}

const contextOf = (raw: unknown): CheckpointContext => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {});

/**
 * A capability, not state: the results this module itself returned. `checkpointAnchors` accepts only those, so a plain object that merely
 * has the right shape (built by hand, or revived from JSON that crossed a boundary) mints no anchors. It is never read by the verifier,
 * so it cannot change what `verifyCheckpoint` returns for any input.
 */
const issued = new WeakSet<object>();
const issue = (result: CheckpointVerification): CheckpointVerification => {
  issued.add(result);
  return result;
};

/**
 * The anchors a checkpoint authenticates, in the shapes `verifyAttestation` takes: the registry head (`trustAnchor`) and the last
 * covered ledger entry (`acceptance.anchor`, null for an empty prefix). They come from the SIGNED statement, never from the supplied
 * logs, and only when every dimension holds: the signature is valid, the signer is authorized by the supplied root, both logs are
 * valid and are the committed state (or extend it), the ordering rule is met, and the checkpoint is not older than, or a fork of, an
 * anchor the caller holds. Otherwise null. This is not a verdict about any attestation: it only says which prefix is authenticated.
 *
 * What travels with the anchors, so a consumer cannot mistake them for more than they are: `currentness` says whether the caller held an
 * anchor at all (`NO_ANCHOR`: nothing says this is not an older checkpoint); `uncovered` and `limitations` say how much of the supplied
 * registry and ledger lies past the committed state, which this checkpoint does not authenticate; `committed` is the state to hold as
 * the caller's next anchor (the only authenticated way to obtain one).
 */
export interface CheckpointAnchors {
  trustAnchor: { version: string; digest: string };
  acceptanceAnchor: { seq: string; digest: string } | null;
  committed: CommittedState;
  currentness: "NO_ANCHOR" | "AT_ANCHOR" | "ADVANCES_ANCHOR";
  uncovered: { registryVersions: string; ledgerEntries: string };
  limitations: readonly string[];
}

export function checkpointAnchors(verification: CheckpointVerification): CheckpointAnchors | null {
  const v = verification;
  if (typeof v !== "object" || v === null || !issued.has(v)) return null;
  if (v.parse !== "PARSED" || v.committed === null) return null;
  if (v.signature.status !== "VALID" || v.signer.authorization !== "AUTHORIZED") return null;
  if (v.identity.status === "MISMATCHED") return null;
  if (!usable(v.registry) || !usable(v.acceptanceLedger) || v.crossBinding.status !== "CONSISTENT") return null;
  const currentness = v.anchor.status;
  if (currentness !== "NO_ANCHOR" && currentness !== "AT_ANCHOR" && currentness !== "ADVANCES_ANCHOR") return null;
  const { registry, acceptanceLedger } = v.committed;
  return deepFreeze({
    trustAnchor: { version: registry.headVersion, digest: registry.headDigest },
    acceptanceAnchor: acceptanceLedger.headDigest === null ? null : { seq: acceptanceLedger.entryCount, digest: acceptanceLedger.headDigest },
    committed: v.committed,
    currentness,
    uncovered: { registryVersions: v.registry.uncovered ?? "0", ledgerEntries: v.acceptanceLedger.uncovered ?? "0" },
    limitations: [...v.limitations],
  });
}
