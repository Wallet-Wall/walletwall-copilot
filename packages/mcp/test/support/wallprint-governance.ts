import { createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { evidenceDigest } from "../../src/canonical.ts";
import { domainSeparatedPreimage } from "../../src/wallprint/attestation.ts";
import { DOMAIN_TAGS } from "../../src/wallprint/attestation-vocabulary.ts";
import { committedStateOf, type CommittedState } from "../../src/wallprint/checkpoint.ts";
import { CHECKPOINT_DOMAIN_TAGS } from "../../src/wallprint/checkpoint-vocabulary.ts";
import { checkpointAnchors, type CheckpointVerification } from "../../src/wallprint/checkpoint-verify.ts";
import {
  authorizationDigest,
  authorizationPreimage,
  bootstrapDigest,
  formatFingerprint,
  type AuthorizationEnvelope,
  type AuthorizationStatement,
  type GovernanceBootstrap,
  type Supersedes,
} from "../../src/wallprint/governance.ts";
import { scanCeremonyFile } from "../../src/wallprint/governance-secret-scan.ts";
import { verifyCeremonyTranscript, type CeremonyTranscript, type ToolingEntry, type TranscriptVerification } from "../../src/wallprint/governance-transcript.ts";
import {
  assessBootstrapPin,
  assessRootReset,
  governedCheckpointAnchors,
  heldGovernanceState,
  verifyGovernance,
  verifyGovernedCheckpoint,
  type GovernanceVerification,
  type GovernedCheckpointVerification,
} from "../../src/wallprint/governance-verify.ts";
import {
  AUTHORIZATION_DOMAIN_TAGS,
  CEREMONY_SEQUENCES,
  EVENT_CHECKLIST,
  GOVERNANCE_BOOTSTRAP_TYPE,
  GOVERNANCE_AUTHORIZATION_TYPE,
  GOVERNANCE_CEREMONY_POLICY,
  GOVERNANCE_TRANSCRIPT_TYPE,
  type CeremonyKind,
  type CeremonyMode,
  type SupersededStanding,
} from "../../src/wallprint/governance-vocabulary.ts";
import type { KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { SYNTHETIC_NOTICE, formatVectorFile, flipLast, seedLabel, signPreimage, syntheticKey } from "./wallprint-attestations.ts";
import { checkpointFor, ledgerOfSlots, scenarioRegistry } from "./wallprint-checkpoints.ts";

export { SYNTHETIC_NOTICE, formatVectorFile };

/**
 * Synthetic governance key-ceremony fixtures. EVERY KEY HERE IS A TEST KEY: its private seed is a public ASCII label
 * ("SYNTHETIC-NON-PRODUCTION-KEY-041"), so anyone can sign as it and it speaks for nobody. Signing is delegated to wallprint-attestations.ts
 * (`signPreimage`), the one place the repository signs anything; the engine modules hold no signing code, and no production root, production
 * operational key, ceremony script or backup exists in this repository. The "backup" below seals a PUBLIC synthetic label under a PUBLIC
 * synthetic passphrase, so the rehearsal can exercise recovery and its failures; it is a model of the procedure, not the production tooling.
 */

// ─── the synthetic governance keys ───────────────────────────────────────────

export interface GovKey {
  keyId: string;
  n: number;
  /** The unmistakable display label. The actual seed is `seedLabel(n)`, also public. */
  label: string;
}

export const GK = {
  root1: { keyId: "synthetic-governance-root-001", n: 41, label: "SYNTHETIC-NON-PRODUCTION-GOVERNANCE-ROOT-001" },
  root2: { keyId: "synthetic-governance-root-002", n: 42, label: "SYNTHETIC-NON-PRODUCTION-GOVERNANCE-ROOT-002" },
  op1: { keyId: "synthetic-checkpoint-signer-001", n: 43, label: "SYNTHETIC-NON-PRODUCTION-CHECKPOINT-SIGNER-001" },
  op2: { keyId: "synthetic-checkpoint-signer-002", n: 44, label: "SYNTHETIC-NON-PRODUCTION-CHECKPOINT-SIGNER-002" },
  op3: { keyId: "synthetic-checkpoint-signer-003", n: 45, label: "SYNTHETIC-NON-PRODUCTION-CHECKPOINT-SIGNER-003" },
  op4: { keyId: "synthetic-checkpoint-signer-004", n: 46, label: "SYNTHETIC-NON-PRODUCTION-CHECKPOINT-SIGNER-004" },
  /** The key an attacker who holds the compromised root authorizes in the root-compromise scenario. */
  attacker: { keyId: "synthetic-attacker-signer-001", n: 47, label: "SYNTHETIC-NON-PRODUCTION-ATTACKER-SIGNER-001" },
  /** The operational key of the new root lineage after a trust reset. */
  op5: { keyId: "synthetic-checkpoint-signer-005", n: 48, label: "SYNTHETIC-NON-PRODUCTION-CHECKPOINT-SIGNER-005" },
  /** A third root, for a second reset. */
  root3: { keyId: "synthetic-governance-root-003", n: 49, label: "SYNTHETIC-NON-PRODUCTION-GOVERNANCE-ROOT-003" },
} as const satisfies Record<string, GovKey>;

export const publicKeyOf = (key: { n: number }): string => syntheticKey(key.n).publicKey;
export const GOV_KEYS: readonly GovKey[] = Object.values(GK);

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ─── bootstraps, statements, envelopes ───────────────────────────────────────

export interface BootstrapOver {
  rootEpoch?: string;
  purposes?: string[];
  algorithm?: string;
  /** The key material of another synthetic key under this key id. */
  materialOf?: { n: number };
}

export function bootstrapFor(root: GovKey = GK.root1, over: BootstrapOver = {}): GovernanceBootstrap {
  return {
    type: GOVERNANCE_BOOTSTRAP_TYPE,
    formatVersion: "0.1",
    rootEpoch: over.rootEpoch ?? "1",
    root: { keyId: root.keyId, algorithm: over.algorithm ?? "ED25519", publicKey: publicKeyOf(over.materialOf ?? root), purposes: over.purposes ?? ["CHECKPOINT_KEY_AUTHORIZATION"] },
  };
}

export interface AuthorizationSpec {
  root?: GovKey;
  rootEpoch?: string;
  generation: string;
  key: GovKey;
  purposes?: string[];
  algorithm?: string;
  materialOf?: { n: number };
  supersedes?: Supersedes | null;
}

export function statementFor(spec: AuthorizationSpec): AuthorizationStatement {
  const root = spec.root ?? GK.root1;
  return {
    authorizationVersion: "0.1",
    purpose: "CHECKPOINT_KEY_AUTHORIZATION",
    root: { keyId: root.keyId, algorithm: "ED25519", publicKey: publicKeyOf(root) },
    rootEpoch: spec.rootEpoch ?? "1",
    generation: spec.generation,
    authorizedKey: { keyId: spec.key.keyId, algorithm: spec.algorithm ?? "ED25519", publicKey: publicKeyOf(spec.materialOf ?? spec.key), purposes: spec.purposes ?? ["REGISTRY_LEDGER_CHECKPOINT"] },
    supersedes: spec.supersedes ?? null,
  };
}

export const envelopeOf = (statement: AuthorizationStatement, signature: string): AuthorizationEnvelope => ({ type: GOVERNANCE_AUTHORIZATION_TYPE, authorizationVersion: statement.authorizationVersion, statement, signature });

/** Sign a statement's exact preimage with a synthetic key. */
export const signAuthorization = (statement: AuthorizationStatement, n: number): AuthorizationEnvelope => envelopeOf(statement, signPreimage(authorizationPreimage(statement), n));

/** A signature over the statement under another domain tag (or none, plain canonical-less JSON): for replay tests. */
export const signAuthorizationUnder = (statement: AuthorizationStatement, tag: string | null, n: number): AuthorizationEnvelope =>
  envelopeOf(statement, signPreimage(tag === null ? new TextEncoder().encode(JSON.stringify(statement)) : domainSeparatedPreimage(tag, statement), n));

/** An authorization signed by the named root (by default the statement's own root key). */
export const authorizationFor = (spec: AuthorizationSpec, signerN?: number): AuthorizationEnvelope => signAuthorization(statementFor(spec), signerN ?? (spec.root ?? GK.root1).n);

export interface ChainStep {
  key: GovKey;
  /** What the root says about the PREVIOUS key (ignored for the first step). */
  previousStanding?: SupersededStanding;
  previousRetainedAt?: CommittedState | null;
}

/** An honest chain: generations 1..N, each naming the digest of the one before it. */
export function chainOf(steps: readonly ChainStep[], root: GovKey = GK.root1, rootEpoch = "1"): AuthorizationEnvelope[] {
  const out: AuthorizationEnvelope[] = [];
  steps.forEach((step, i) => {
    const previous = out[i - 1];
    const supersedes: Supersedes | null = previous === undefined ? null : { authorizationDigest: authorizationDigest(previous), standing: step.previousStanding ?? "RETIRED", retainedAt: step.previousRetainedAt ?? null };
    out.push(authorizationFor({ root, rootEpoch, generation: String(i + 1), key: step.key, supersedes }));
  });
  return out;
}

/** Alter a signed authorization's statement without re-signing it. */
export function altered(envelope: AuthorizationEnvelope, edit: (statement: AuthorizationStatement) => void): AuthorizationEnvelope {
  const copy = clone(envelope);
  edit(copy.statement);
  return copy;
}

/** The same envelope with the last character of its signature flipped. */
export const wrongSignature = (envelope: AuthorizationEnvelope): AuthorizationEnvelope => ({ ...envelope, signature: flipLast(envelope.signature) });

// ─── the synthetic registry, ledger and checkpoints a governance state is judged against ─────────────

export const GOV_REGISTRY: KeyRegistrySnapshot[] = scenarioRegistry(4);
export const GOV_LEDGER_MAX = 9;
export const govLedger = (count: number): ReturnType<typeof ledgerOfSlots> => ledgerOfSlots(count, GOV_REGISTRY);
export const committedAt = (ledgerCount: number): CommittedState => committedStateOf(GOV_REGISTRY, govLedger(ledgerCount));

/** An honest checkpoint over the synthetic registry (4 versions) and the first `ledgerCount` ledger entries, signed by the named operational key. */
export const checkpointBy = (key: GovKey, ledgerCount: number): ReturnType<typeof checkpointFor> => checkpointFor(GOV_REGISTRY, govLedger(ledgerCount), key);

export interface GovernedOver {
  expectBootstrapPin?: boolean;
  held?: unknown;
  minRootEpoch?: string;
  allowSynthetic?: boolean;
  bootstrap?: unknown;
  ledgerCount?: number;
  anchor?: unknown;
}

/** The context a governed verification takes: the pinned bootstrap, the chain, and the synthetic logs the checkpoint commits. */
export function governedContext(chain: readonly AuthorizationEnvelope[], ledgerCount: number, over: GovernedOver = {}): Record<string, unknown> {
  const bootstrap = over.bootstrap ?? bootstrapFor();
  const parsedDigest = bootstrapDigest(bootstrap as GovernanceBootstrap);
  return {
    bootstrap,
    authorizations: chain,
    allowSynthetic: over.allowSynthetic ?? true,
    ...(over.expectBootstrapPin === false ? {} : { expectedBootstrapDigest: parsedDigest }),
    ...(over.held === undefined ? {} : { held: over.held }),
    ...(over.minRootEpoch === undefined ? {} : { minRootEpoch: over.minRootEpoch }),
    keyRegistry: GOV_REGISTRY,
    acceptanceLedger: govLedger(over.ledgerCount ?? ledgerCount),
    ...(over.anchor === undefined ? {} : { anchor: over.anchor }),
  };
}

export const governed = (checkpoint: unknown, chain: readonly AuthorizationEnvelope[], ledgerCount: number, over: GovernedOver = {}): GovernedCheckpointVerification => verifyGovernedCheckpoint(checkpoint, governedContext(chain, ledgerCount, over));

/** The compact projection of a governed result that vectors and the rehearsal record. */
export function governedSummary(r: GovernedCheckpointVerification): Record<string, unknown> {
  const c: CheckpointVerification = r.checkpoint;
  return {
    governance: { chain: r.governance.chain.status, held: r.governance.held.status, limitations: r.governance.limitations },
    reliance: { status: r.reliance.status, keyStanding: r.reliance.keyStanding, authorizedAtGeneration: r.reliance.authorizedAtGeneration, reasons: r.reliance.reasons, limitations: r.reliance.limitations },
    checkpoint: { signature: c.signature.status, key: c.signer.key, authorization: c.signer.authorization, signerReasons: c.signer.reasons, registry: c.registry.state, ledger: c.acceptanceLedger.state, crossBinding: c.crossBinding.status, anchor: c.anchor.status },
    anchors: governedCheckpointAnchors(r) === null ? "NONE" : "AUTHENTICATED",
  };
}

export function governanceSummary(g: GovernanceVerification): Record<string, unknown> {
  return {
    bootstrap: { parse: g.bootstrap.parse, pin: g.bootstrap.pin, epoch: g.bootstrap.epoch, reasons: g.bootstrap.reasons },
    chain: { status: g.chain.status, count: g.chain.count, failedAt: g.chain.failedAt, reasons: g.chain.reasons },
    held: { status: g.held.status, reasons: g.held.reasons },
    keys: g.keys.map((k) => ({ generation: k.generation, keyId: k.keyId, standing: k.standing })),
    limitations: g.limitations,
  };
}

// ─── the synthetic backup model ──────────────────────────────────────────────

/**
 * A model of an encrypted backup, for the rehearsal only: the PUBLIC synthetic seed label sealed under a PUBLIC synthetic passphrase with
 * scrypt and AES-256-GCM, so that recovery with the wrong passphrase, a damaged copy or the wrong key's backup fails for a real reason.
 * The salt and nonce are fixed because every input is public and synthetic; a production backup is made with audited external tooling
 * (docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md), never with this.
 */
export const SYNTHETIC_PASSPHRASE = "SYNTHETIC-NON-PRODUCTION-PASSPHRASE-001";
const SALT = Buffer.from("SYNTHETIC-NON-PRODUCTION-SALT-01", "utf8");
const NONCE = Buffer.from("SYNTHETIC-NP1", "utf8").subarray(0, 12);
const SEED_LABEL_RE = /^SYNTHETIC-NON-PRODUCTION-KEY-(\d{3})$/;

export interface SealedBackup {
  data: Buffer;
  tag: Buffer;
}

const backupKey = (passphrase: string): Buffer => scryptSync(passphrase, SALT, 32, { N: 1024 });

export function sealBackup(key: { n: number }, passphrase: string = SYNTHETIC_PASSPHRASE): SealedBackup {
  const cipher = createCipheriv("aes-256-gcm", backupKey(passphrase), NONCE);
  const data = Buffer.concat([cipher.update(seedLabel(key.n), "utf8"), cipher.final()]);
  return { data, tag: cipher.getAuthTag() };
}

export class BackupRecoveryError extends Error {
  readonly reason: "AUTHENTICATION_FAILED" | "NOT_A_SYNTHETIC_SEED" | "NO_BACKUP";
  constructor(reason: BackupRecoveryError["reason"]) {
    super(`backup recovery refused: ${reason}`);
    this.reason = reason;
  }
}

/** Recover the synthetic key's index from a sealed backup, or refuse for a fixed reason. */
export function recoverFromBackup(backup: SealedBackup | undefined, passphrase: string = SYNTHETIC_PASSPHRASE): { n: number; publicKey: string } {
  if (backup === undefined) throw new BackupRecoveryError("NO_BACKUP");
  let plain: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", backupKey(passphrase), NONCE);
    decipher.setAuthTag(backup.tag);
    plain = Buffer.concat([decipher.update(backup.data), decipher.final()]).toString("utf8");
  } catch {
    throw new BackupRecoveryError("AUTHENTICATION_FAILED");
  }
  const match = SEED_LABEL_RE.exec(plain);
  if (match === null) throw new BackupRecoveryError("NOT_A_SYNTHETIC_SEED");
  const n = Number(match[1]);
  return { n, publicKey: syntheticKey(n).publicKey };
}

/** The working copy of a key on the ceremony machine: usable until it is removed, then unusable until recovered from a backup. */
export class SyntheticWorkingCopy {
  #n: number | null;
  constructor(n: number) {
    this.#n = n;
  }
  get present(): boolean {
    return this.#n !== null;
  }
  get publicKey(): string | null {
    return this.#n === null ? null : syntheticKey(this.#n).publicKey;
  }
  signPreimageWith(preimage: Uint8Array): string {
    if (this.#n === null) throw new Error("WORKING_COPY_REMOVED");
    return signPreimage(preimage, this.#n);
  }
  remove(): void {
    this.#n = null;
  }
}

// ─── ceremony transcripts ────────────────────────────────────────────────────

const syntheticDigest = (what: string): string => evidenceDigest({ synthetic: what });

export const SYNTHETIC_TOOLING: readonly ToolingEntry[] = [
  { name: "synthetic-ceremony-image", version: "0.0.1", digest: syntheticDigest("ceremony-image") },
  { name: "synthetic-ceremony-script", version: "0.0.1", digest: syntheticDigest("ceremony-script") },
];

export interface TranscriptSpec {
  ceremonyId: string;
  kind: CeremonyKind;
  bootstrap: GovernanceBootstrap;
  authorizations: readonly AuthorizationEnvelope[];
  mode?: CeremonyMode;
  date?: string;
}

export function transcriptFor(spec: TranscriptSpec): CeremonyTranscript {
  const digest = bootstrapDigest(spec.bootstrap);
  const events: Record<string, unknown>[] = [];
  for (const event of CEREMONY_SEQUENCES[spec.kind]) {
    const base = { event, by: ["OPERATOR", "WITNESS"], attests: [...EVENT_CHECKLIST[event]] };
    if (event === "ROOT_PUBLIC_KEY_RECORDED" || event === "ROOT_KEY_RESTORED") events.push({ ...base, ref: { bootstrapDigest: digest } });
    else if (event === "BACKUP_RECOVERY_TESTED") events.push({ ...base, ref: { bootstrapDigest: digest, copiesDrilled: "3" } });
    else if (event === "BACKUP_CREATED") events.push({ ...base, ref: { mediaCopies: "3", mediaLocations: "2", passphraseEnvelopes: "2", passphraseLocations: "2" } });
    else if (event === "OPERATIONAL_KEY_AUTHORIZED") for (const a of spec.authorizations) events.push({ ...base, ref: { generation: a.statement.generation, authorizationDigest: authorizationDigest(a) } });
    else events.push(base);
  }
  return {
    type: GOVERNANCE_TRANSCRIPT_TYPE,
    formatVersion: "0.1",
    ceremonyId: spec.ceremonyId,
    mode: spec.mode ?? "SYNTHETIC_REHEARSAL",
    kind: spec.kind,
    date: spec.date ?? "2026-11-01",
    sourceCommit: "8f8f4f1c5b692a7faba5ea8d2dad791871e04d01",
    tooling: SYNTHETIC_TOOLING.map((t) => ({ ...t })),
    participants: [
      { role: "OPERATOR", participantId: "synthetic-operator-001" },
      { role: "WITNESS", participantId: "synthetic-witness-001" },
    ],
    events: events.map((e, i) => ({ ...e, seq: String(i + 1) })) as CeremonyTranscript["events"],
  };
}

export const verifyTranscriptFor = (transcript: unknown, bootstrap: GovernanceBootstrap, authorizations: readonly AuthorizationEnvelope[], withTooling = true): TranscriptVerification =>
  verifyCeremonyTranscript(transcript, { bootstrap, authorizations, ...(withTooling ? { expectedTooling: SYNTHETIC_TOOLING } : {}) });

export function transcriptSummary(r: TranscriptVerification): Record<string, unknown> {
  return { parse: r.parse, structure: r.structure, artifacts: r.artifacts, tooling: r.tooling, secrets: r.secrets.status, reasons: r.reasons, limitations: r.limitations };
}

// ─── the rehearsal ───────────────────────────────────────────────────────────

export interface RehearsalStep {
  step: number;
  name: string;
  facts: Record<string, unknown>;
}

export interface Rehearsal {
  steps: RehearsalStep[];
  artifacts: {
    bootstrap1: GovernanceBootstrap;
    bootstrap2: GovernanceBootstrap;
    chain1: AuthorizationEnvelope[];
    chain2: AuthorizationEnvelope[];
    checkpoints: Record<string, unknown>;
    transcripts: Record<string, CeremonyTranscript>;
  };
}

const confirmations = (digest: string, origins: readonly string[]): { origin: string; digest: string }[] => origins.map((origin) => ({ origin, digest }));
const verifyChain = (bootstrap: GovernanceBootstrap, chain: readonly AuthorizationEnvelope[], over: Record<string, unknown> = {}): GovernanceVerification =>
  verifyGovernance({ bootstrap, authorizations: chain, allowSynthetic: true, expectedBootstrapDigest: bootstrapDigest(bootstrap), ...over });

/**
 * The full synthetic rehearsal, step by step. Everything is deterministic and in memory; nothing is written, and every key is a public
 * synthetic seed. It records, for each of the fifteen steps the lane required, what the verifiers said.
 */
export function rehearse(): Rehearsal {
  const steps: RehearsalStep[] = [];
  const record = (name: string, facts: Record<string, unknown>): void => void steps.push({ step: steps.length + 1, name, facts });

  // 1. isolated environment: modelled by the tooling list and the offline confirmation in the transcripts below
  record("isolated environment", { mode: "SYNTHETIC_REHEARSAL", tooling: SYNTHETIC_TOOLING.map((t) => `${t.name}@${t.version}`), network: "NETWORK_CONFIRMED_OFFLINE is an attested event in every transcript", persistentStorage: "none: every artifact below is in memory" });

  // 2. synthetic root generation
  const rootCopy = new SyntheticWorkingCopy(GK.root1.n);
  record("synthetic root generation", { rootKeyId: GK.root1.keyId, label: GK.root1.label, publicKey: rootCopy.publicKey, workingCopyPresent: String(rootCopy.present) });

  // 3. public root artifact
  const bootstrap1 = bootstrapFor(GK.root1);
  const digest1 = bootstrapDigest(bootstrap1);
  const pinned1 = verifyChain(bootstrap1, []);
  record("public root artifact", { rootEpoch: bootstrap1.rootEpoch, digest: digest1, fingerprint: formatFingerprint(digest1), pin: pinned1.bootstrap.pin, bootstrapReasons: pinned1.bootstrap.reasons, chain: pinned1.chain.status });

  // 4. backup creation: three sealed copies; the working copy is still present
  const backups = [sealBackup(GK.root1), sealBackup(GK.root1), sealBackup(GK.root1)];
  record("backup creation", { copies: String(backups.length), format: "sealed synthetic seed label (scrypt + AES-256-GCM, public synthetic passphrase)", workingCopyPresent: String(rootCopy.present) });

  // 5. operational key generation
  record("operational key generation", { keyId: GK.op1.keyId, label: GK.op1.label, publicKey: publicKeyOf(GK.op1), distinctFromRoot: String(publicKeyOf(GK.op1) !== publicKeyOf(GK.root1)) });

  // 6. root authorization of the operational key (generation 1), signed with the working copy
  const a1 = envelopeOf(statementFor({ generation: "1", key: GK.op1 }), rootCopy.signPreimageWith(authorizationPreimage(statementFor({ generation: "1", key: GK.op1 }))));
  const g1 = verifyChain(bootstrap1, [a1]);
  record("root authorization of the operational key", { generation: a1.statement.generation, authorizationDigest: authorizationDigest(a1), signedBytesDomainTag: AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, chain: g1.chain.status, keys: g1.keys.map((k) => `${k.keyId}:${k.standing}`) });

  // 7. the operational key signs a synthetic checkpoint; 8. it is verified using only the synthetic public bootstrap
  const c1a = checkpointBy(GK.op1, 4);
  const c1b = checkpointBy(GK.op1, 6);
  const v1a = governed(c1a, [a1], 4);
  const v1b = governed(c1b, [a1], 6);
  record("operational key signs a synthetic checkpoint", { committedRegistryVersions: "4", committedLedgerEntries: ["4", "6"], signer: GK.op1.keyId });
  record("checkpoint verified with only the public bootstrap", { first: governedSummary(v1a), second: governedSummary(v1b), heldAfter: heldGovernanceState(v1b.governance)?.held ?? "NONE" });

  // 9. routine operational-key rotation: the root names the last state op1 signed and retires it
  const retained = committedAt(6);
  const chain12 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedAt: retained }]);
  const g2 = verifyChain(bootstrap1, chain12, { held: heldGovernanceState(v1b.governance)?.held });
  const c2 = checkpointBy(GK.op2, 9);
  record("operational key rotation (generation 1 to 2)", {
    chain: g2.chain.status,
    held: g2.held.status,
    keys: g2.keys.map((k) => `${k.generation}:${k.keyId}:${k.standing}`),
    retainedAt: retained,
    oldCheckpointBeforeRetained: governedSummary(governed(c1a, chain12, 4)),
    oldCheckpointAtRetained: governedSummary(governed(c1b, chain12, 6)),
    newCheckpointByNewKey: governedSummary(governed(c2, chain12, 9)),
  });

  // 10. retirement: the old key signs another checkpoint after rotation, and it is no longer relied upon
  const lateOld = checkpointBy(GK.op1, 9);
  record("old-key retirement", { signatureStillValid: governed(lateOld, chain12, 9).checkpoint.signature.status, lateCheckpointByRetiredKey: governedSummary(governed(lateOld, chain12, 9)), staleChainAgainstHeld: governanceSummary(verifyChain(bootstrap1, [a1], { held: heldGovernanceState(g2)?.held })) });

  // 11. root recovery from backup: remove the working copy, recover, and prove the same public key and fingerprint
  rootCopy.remove();
  const removedSigning = ((): string => {
    try {
      rootCopy.signPreimageWith(new Uint8Array([1]));
      return "UNEXPECTEDLY_SIGNED";
    } catch {
      return "WORKING_COPY_REMOVED";
    }
  })();
  const recovered = recoverFromBackup(backups[1]);
  const recoveredCopy = new SyntheticWorkingCopy(recovered.n);
  const wrongPassphrase = ((): string => {
    try {
      recoverFromBackup(backups[0], "SYNTHETIC-NON-PRODUCTION-PASSPHRASE-002");
      return "UNEXPECTEDLY_RECOVERED";
    } catch (e) {
      return e instanceof BackupRecoveryError ? e.reason : "OTHER";
    }
  })();
  const wrongBackup = recoverFromBackup(sealBackup(GK.root2));
  const recoveredBootstrap = bootstrapFor({ ...GK.root1, n: recovered.n });
  record("root recovery from backup", {
    afterRemoval: removedSigning,
    recoveredPublicKeyEqualsOriginal: String(recovered.publicKey === publicKeyOf(GK.root1)),
    recoveredBootstrapDigestEqualsOriginal: String(bootstrapDigest(recoveredBootstrap) === digest1),
    wrongPassphrase,
    wrongBackupPublicKeyEqualsOriginal: String(wrongBackup.publicKey === publicKeyOf(GK.root1)),
    noBackup: ((): string => {
      try {
        recoverFromBackup(undefined);
        return "UNEXPECTEDLY_RECOVERED";
      } catch (e) {
        return e instanceof BackupRecoveryError ? e.reason : "OTHER";
      }
    })(),
  });

  // 12. replacement operational authorization after op2 is believed compromised, signed with the RECOVERED root
  const gen3 = statementFor({ generation: "3", key: GK.op3, supersedes: { authorizationDigest: authorizationDigest(chain12[1] as AuthorizationEnvelope), standing: "COMPROMISED", retainedAt: null } });
  const a3 = envelopeOf(gen3, recoveredCopy.signPreimageWith(authorizationPreimage(gen3)));
  const chain123 = [...chain12, a3];
  const g3 = verifyChain(bootstrap1, chain123, { held: heldGovernanceState(g2)?.held });
  const c3 = checkpointBy(GK.op3, 9);
  record("replacement operational authorization (generation 3)", {
    signedByRecoveredRoot: "true",
    chain: g3.chain.status,
    held: g3.held.status,
    keys: g3.keys.map((k) => `${k.generation}:${k.keyId}:${k.standing}`),
    compromisedKeyCheckpoint: governedSummary(governed(c2, chain123, 9)),
    retiredKeyEarlyCheckpoint: governedSummary(governed(c1a, chain123, 4)),
    newCheckpoint: governedSummary(governed(c3, chain123, 9)),
    rollbackToGeneration2WhenHoldingGeneration3: governanceSummary(verifyChain(bootstrap1, chain12, { held: heldGovernanceState(g3)?.held })),
  });

  // 13. root loss: every backup and the working copy are gone
  recoveredCopy.remove();
  const lostBackups: SealedBackup[] = [];
  const noRecovery = ((): string => {
    try {
      recoverFromBackup(lostBackups[0]);
      return "UNEXPECTEDLY_RECOVERED";
    } catch (e) {
      return e instanceof BackupRecoveryError ? e.reason : "OTHER";
    }
  })();
  const bootstrap2 = bootstrapFor(GK.root2, { rootEpoch: "2" });
  const digest2 = bootstrapDigest(bootstrap2);
  const chain2 = chainOf([{ key: GK.op5 }], GK.root2, "2");
  const reset = assessRootReset({ rootEpoch: "1", rootPublicKey: publicKeyOf(GK.root1), bootstrapDigest: digest1 }, bootstrap2, confirmations(digest2, ["GITHUB", "WALLETWALL_WEBSITE"]), { allowSynthetic: true });
  const c5 = checkpointBy(GK.op5, 9);
  record("root-loss scenario", {
    recovery: noRecovery,
    existingStateStillVerifies: governedSummary(governed(c3, chain123, 9)),
    newAuthorizationPossibleWithoutRoot: "false: no key to sign generation 4",
    consumerRecourse: "explicit bootstrap to a new root (epoch 2)",
    reset: { status: reset.status, newRootEpoch: reset.newRootEpoch, consumerAction: reset.consumerAction, reasons: reset.reasons },
    oldCheckpointUnderNewRoot: governedSummary(governed(c3, chain2, 9, { bootstrap: bootstrap2, minRootEpoch: "2" })),
    newCheckpointUnderNewRoot: governedSummary(governed(c5, chain2, 9, { bootstrap: bootstrap2, minRootEpoch: "2" })),
  });

  // 14. root compromise: whoever holds the root key signs a valid generation 4 for a key of their choosing
  const a4Attacker = authorizationFor({ generation: "4", key: GK.attacker, supersedes: { authorizationDigest: authorizationDigest(a3), standing: "RETIRED", retainedAt: committedAt(9) } });
  const a4Defender = authorizationFor({ generation: "4", key: GK.op4, supersedes: { authorizationDigest: authorizationDigest(a3), standing: "COMPROMISED", retainedAt: null } });
  const attackerChain = [...chain123, a4Attacker];
  const defenderChain = [...chain123, a4Defender];
  const cAttacker = checkpointBy(GK.attacker, 9);
  const holdsGen3 = heldGovernanceState(g3)?.held;
  const holdsDefender = heldGovernanceState(verifyChain(bootstrap1, defenderChain))?.held;
  record("root-compromise scenario", {
    attackerChainUnderOldBootstrap: governanceSummary(verifyChain(bootstrap1, attackerChain, { held: holdsGen3 })),
    defenderChainUnderOldBootstrap: governanceSummary(verifyChain(bootstrap1, defenderChain, { held: holdsGen3 })),
    attackerCheckpointRelied: governedSummary(governed(cAttacker, attackerChain, 9)),
    attackerChainAgainstDefenderHeldState: governanceSummary(verifyChain(bootstrap1, attackerChain, { held: holdsDefender })),
    selfHeal: "no: both chains are signed by the same root key and verify; nothing in the old root separates them",
    attackerChainUnderResetFloor: governanceSummary(verifyChain(bootstrap1, attackerChain, { minRootEpoch: "2" })),
  });

  // 15. trust reset: an out-of-band move to the new root, judged by assessRootReset
  const pinnedOld = { rootEpoch: "1", rootPublicKey: publicKeyOf(GK.root1), bootstrapDigest: digest1 };
  const resetSummary = (r: ReturnType<typeof assessRootReset>): Record<string, unknown> => ({ status: r.status, reasons: r.reasons, consumerAction: r.consumerAction });
  record("trust reset", {
    twoOrigins: resetSummary(reset),
    oneOrigin: resetSummary(assessRootReset(pinnedOld, bootstrap2, confirmations(digest2, ["GITHUB"]), { allowSynthetic: true })),
    githubTwice: resetSummary(assessRootReset(pinnedOld, bootstrap2, confirmations(digest2, ["GITHUB", "GITHUB"]), { allowSynthetic: true })),
    sameRootKey: resetSummary(assessRootReset(pinnedOld, bootstrapFor(GK.root1, { rootEpoch: "2" }), confirmations(bootstrapDigest(bootstrapFor(GK.root1, { rootEpoch: "2" })), ["GITHUB", "WALLETWALL_WEBSITE"]), { allowSynthetic: true })),
    newChainUnderNewRoot: governanceSummary(verifyChain(bootstrap2, chain2, { minRootEpoch: "2" })),
    oldBootstrapAfterReset: governanceSummary(verifyChain(bootstrap1, chain123, { minRootEpoch: "2" })),
    historicalCheckpointSignature: governed(c3, chain2, 9, { bootstrap: bootstrap2, minRootEpoch: "2" }).checkpoint.signature.status,
    historicalCheckpointReliance: governed(c3, chain2, 9, { bootstrap: bootstrap2, minRootEpoch: "2" }).reliance.status,
  });

  // the ceremonies that would have produced these artifacts, as transcripts
  const t1 = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-001", kind: "ROOT_BOOTSTRAP", bootstrap: bootstrap1, authorizations: [a1] });
  const t2 = transcriptFor({ ceremonyId: "synthetic-rehearsal-rotation-001", kind: "OPERATIONAL_KEY_ACTION", bootstrap: bootstrap1, authorizations: [chain12[1] as AuthorizationEnvelope] });
  const t3 = transcriptFor({ ceremonyId: "synthetic-rehearsal-replacement-001", kind: "OPERATIONAL_KEY_ACTION", bootstrap: bootstrap1, authorizations: [a3] });
  record("ceremony transcripts", {
    rootBootstrap: transcriptSummary(verifyTranscriptFor(t1, bootstrap1, [a1])),
    rotation: transcriptSummary(verifyTranscriptFor(t2, bootstrap1, [chain12[1] as AuthorizationEnvelope])),
    replacement: transcriptSummary(verifyTranscriptFor(t3, bootstrap1, [a3])),
    secretScan: { rootBootstrap: scanCeremonyFile("t1.json", JSON.stringify(t1)).length, rotation: scanCeremonyFile("t2.json", JSON.stringify(t2)).length, replacement: scanCeremonyFile("t3.json", JSON.stringify(t3)).length },
  });

  return {
    steps,
    artifacts: {
      bootstrap1,
      bootstrap2,
      chain1: chain123,
      chain2,
      checkpoints: { c1a, c1b, c2, c3, c5, anchorsOfFirstCheckpoint: checkpointAnchors(v1a.checkpoint) },
      transcripts: { rootBootstrap: t1, rotation: t2, replacement: t3 },
    },
  };
}

/** Pin assessment projection used by vectors. */
export const pinSummary = (r: ReturnType<typeof assessBootstrapPin>): Record<string, unknown> => ({ status: r.status, origins: r.origins, reasons: r.reasons });
export const resetSummaryOf = (r: ReturnType<typeof assessRootReset>): Record<string, unknown> => ({ status: r.status, newRootEpoch: r.newRootEpoch, consumerAction: r.consumerAction, reasons: r.reasons });

export { DOMAIN_TAGS, CHECKPOINT_DOMAIN_TAGS, GOVERNANCE_CEREMONY_POLICY, SYNTHETIC_TOOLING as TOOLING };
