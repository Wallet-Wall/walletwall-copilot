import { acceptanceEntryDigest, type AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import { domainSeparatedPreimage } from "../../src/wallprint/attestation.ts";
import { DOMAIN_TAGS } from "../../src/wallprint/attestation-vocabulary.ts";
import { verifyAttestation, type AttestationVerification } from "../../src/wallprint/attestation-verify.ts";
import { checkpointDigest, checkpointPreimage, committedStateOf, parseCheckpoint, type CheckpointEnvelope, type CheckpointStatement, type CommittedState, type GovernanceTrustRoot } from "../../src/wallprint/checkpoint.ts";
import { CHECKPOINT_TYPE, GOVERNANCE_TRUST_ROOT_FORMAT_VERSION, GOVERNANCE_TRUST_ROOT_TYPE, type GovernanceKeyPurpose } from "../../src/wallprint/checkpoint-vocabulary.ts";
import { checkpointAnchors, verifyCheckpoint, type CheckpointContext, type CheckpointVerification } from "../../src/wallprint/checkpoint-verify.ts";
import { keyRegistryDigest, verifyKeyRegistryChain, type KeyRegistrySnapshot, type RegisteredSigner } from "../../src/wallprint/key-registry.ts";
import { SYNTHETIC_NOTICE, WHO, assessmentTargetOf, attest, digestOfEnvelope, flipLast, formatVectorFile, goldenRecord, ledgerOf, pinOf, registryChain, seedLabel, signPreimage, syntheticKey } from "./wallprint-attestations.ts";

/**
 * Synthetic trust-checkpoint fixtures. EVERY KEY HERE IS A TEST KEY: its private seed is a public ASCII label
 * ("SYNTHETIC-NON-PRODUCTION-KEY-021"), so anyone can sign as it and it speaks for nobody. There is no production governance
 * key, no production trust root and no ceremony in this repository. Signing is delegated to wallprint-attestations.ts
 * (`signPreimage`), the one place the repository signs anything; the engine modules hold no signing code.
 */

// ─── the synthetic governance keys and trust roots ───────────────────────────

export interface GovSigner {
  keyId: string;
  n: number;
}

export const GOV = {
  root1: { keyId: "synthetic-governance-1", n: 21 },
  root2: { keyId: "synthetic-governance-2", n: 24 },
  /** In the primary root, but authorized only for the deferred STANDING_HEAD purpose. */
  standing: { keyId: "synthetic-governance-standing", n: 22 },
  /** In no root. */
  rogue: { keyId: "synthetic-governance-rogue", n: 23 },
} as const satisfies Record<string, GovSigner>;

export function trustRootOf(...entries: { who: GovSigner; purposes: GovernanceKeyPurpose[] }[]): GovernanceTrustRoot {
  const keys = entries
    .map(({ who, purposes }) => ({ keyId: who.keyId, algorithm: "ED25519", publicKey: syntheticKey(who.n).publicKey, purposes }))
    .sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
  return { type: GOVERNANCE_TRUST_ROOT_TYPE, formatVersion: GOVERNANCE_TRUST_ROOT_FORMAT_VERSION, keys };
}

export const PRIMARY_ROOT: GovernanceTrustRoot = trustRootOf({ who: GOV.root1, purposes: ["REGISTRY_LEDGER_CHECKPOINT"] }, { who: GOV.standing, purposes: ["STANDING_HEAD"] });
/** The primary root after a rotation: a second checkpoint key added beside the first. */
export const ROTATED_ROOT: GovernanceTrustRoot = trustRootOf({ who: GOV.root1, purposes: ["REGISTRY_LEDGER_CHECKPOINT"] }, { who: GOV.root2, purposes: ["REGISTRY_LEDGER_CHECKPOINT"] }, { who: GOV.standing, purposes: ["STANDING_HEAD"] });
/** Not a trust root: the keys are not in order. */
export const INVALID_ROOT = { ...PRIMARY_ROOT, keys: [...PRIMARY_ROOT.keys].reverse() };

// ─── statements, envelopes, signing ──────────────────────────────────────────

export function checkpointStatement(state: CommittedState, who: GovSigner = GOV.root1, over: { algorithm?: string; publicKeyOf?: GovSigner } = {}): CheckpointStatement {
  return {
    checkpointVersion: "0.1",
    purpose: "REGISTRY_LEDGER_CHECKPOINT",
    signer: { keyId: who.keyId, algorithm: over.algorithm ?? "ED25519", publicKey: syntheticKey((over.publicKeyOf ?? who).n).publicKey },
    registry: state.registry,
    acceptanceLedger: state.acceptanceLedger,
  };
}

export const checkpointEnvelope = (statement: CheckpointStatement, signature: string): CheckpointEnvelope => ({ type: CHECKPOINT_TYPE, checkpointVersion: statement.checkpointVersion, statement, signature });

/** Sign a checkpoint statement's exact preimage with a synthetic key. */
export const signCheckpointStatement = (statement: CheckpointStatement, n: number): CheckpointEnvelope => checkpointEnvelope(statement, signPreimage(checkpointPreimage(statement), n));

/** An honest checkpoint over a registry chain and a ledger, signed by a synthetic governance key. */
export function checkpointFor(chain: readonly KeyRegistrySnapshot[], ledger: readonly AcceptanceEntry[], who: GovSigner = GOV.root1): CheckpointEnvelope {
  return signCheckpointStatement(checkpointStatement(committedStateOf(chain, ledger), who), who.n);
}

/** A signature over the checkpoint statement's canonical JSON under another domain, or none: for replay tests. */
export const signUnderTag = (statement: CheckpointStatement, tag: string | null, n: number): string => {
  const bytes = tag === null ? new TextEncoder().encode(JSON.stringify(statement)) : domainSeparatedPreimage(tag, statement);
  return signPreimage(bytes, n);
};
export const ATTESTATION_TAG = DOMAIN_TAGS.RECORD_PUBLICATION;

// ─── the synthetic registry and ledger ───────────────────────────────────────

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fail = (what: string, chain: unknown): never => {
  const r = verifyKeyRegistryChain(chain);
  throw new Error(`fixture ${what} is not a valid chain: ${r.ok ? "" : r.findings.map((f) => f.code).join(",")}`);
};

/** Append one registry version, changing the signers by `edit`. The result is checked: a fixture can never be a chain the verifier refuses. */
export function appendRegistry(chain: readonly KeyRegistrySnapshot[], edit: (signers: RegisteredSigner[], version: number) => RegisteredSigner[]): KeyRegistrySnapshot[] {
  const head = chain[chain.length - 1];
  if (head === undefined) throw new Error("fixture registry is empty");
  const version = chain.length + 1;
  const body = {
    type: head.type,
    formatVersion: head.formatVersion,
    keyRegistryVersion: String(version),
    previous: { version: head.keyRegistryVersion, digest: head.digest },
    signers: edit(clone(head.signers), version),
  };
  const out = [...chain, { ...body, digest: keyRegistryDigest({ ...body, digest: "" }) }];
  return verifyKeyRegistryChain(out).ok ? out : fail("append", out);
}

const changeKey = (keyId: string, change: (key: RegisteredSigner["keys"][number], version: number) => void) => (signers: RegisteredSigner[], version: number): RegisteredSigner[] => {
  for (const s of signers) for (const k of s.keys) if (k.keyId === keyId) change(k, version);
  return signers;
};

export const compromiseKey = (keyId: string, retainedBefore: number | null) =>
  changeKey(keyId, (k, version) => {
    k.status = "COMPROMISED";
    k.statusFrom = String(version);
    k.retainedBefore = retainedBefore === null ? null : String(retainedBefore);
  });

export const retireKey = (keyId: string) =>
  changeKey(keyId, (k, version) => {
    k.status = "RETIRED";
    k.statusFrom = String(version);
  });

/** Supersede a key by a new one added in the same version, in the same signer. */
export const supersedeKey = (keyId: string, successor: { keyId: string; n: number }) => (signers: RegisteredSigner[], version: number): RegisteredSigner[] => {
  for (const s of signers) {
    const old = s.keys.find((k) => k.keyId === keyId);
    if (old === undefined) continue;
    s.keys.push({ keyId: successor.keyId, algorithm: "ED25519", publicKey: syntheticKey(successor.n).publicKey, purposes: old.purposes, status: "ACTIVE", addedIn: String(version), statusFrom: String(version), successor: null, retainedBefore: null });
    s.keys.sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
    old.status = "SUPERSEDED";
    old.statusFrom = String(version);
    old.successor = successor.keyId;
  }
  return signers;
};

const registries = new Map<string, KeyRegistrySnapshot[]>();
const memo = (key: string, build: () => KeyRegistrySnapshot[]): KeyRegistrySnapshot[] => {
  const cached = registries.get(key);
  if (cached !== undefined) return cached;
  const built = build();
  registries.set(key, built);
  return built;
};

/**
 * Six registry versions. 1 to 4 are the #29 roster. In 5 the assessor key `synthetic-reviewer-y-2` is found compromised, retaining
 * what was accepted before version 5. In 6 the WalletWall publication key is retired.
 */
export const SCENARIO_COMPROMISED_KEY = "synthetic-reviewer-y-2";
export const scenarioRegistry = (through = 6): KeyRegistrySnapshot[] =>
  memo("scenario", () => appendRegistry(appendRegistry(registryChain(4), compromiseKey(SCENARIO_COMPROMISED_KEY, 5)), retireKey("synthetic-publisher-2"))).slice(0, through);

/** The same first four versions, then a different, equally valid history: a compromise that retains less, and a different sixth version. */
export const divergedRegistry = (through = 6): KeyRegistrySnapshot[] =>
  memo("diverged", () => appendRegistry(appendRegistry(registryChain(4), compromiseKey(SCENARIO_COMPROMISED_KEY, 4)), retireKey("synthetic-publisher-2"))).slice(0, through);

/** A different valid registry from version 1 on (one binding text changed in every snapshot). */
export function alternateRegistry(through = 6): KeyRegistrySnapshot[] {
  return memo("alternate", () => {
    const out: KeyRegistrySnapshot[] = [];
    for (const snapshot of scenarioRegistry()) {
      const prev = out[out.length - 1];
      const signers = snapshot.signers.map((s) => (s.kind === "WALLETWALL_PUBLISHER" ? { ...s, binding: { ...s.binding, publisher: "WalletWall governance synthetic alternate" } } : s));
      const body = { ...snapshot, signers, previous: prev === undefined ? null : { version: prev.keyRegistryVersion, digest: prev.digest } };
      out.push({ ...body, digest: keyRegistryDigest(body) });
    }
    return verifyKeyRegistryChain(out).ok ? out : fail("alternate", out);
  }).slice(0, through);
}

/** A registry whose third snapshot was edited after it was published, without recomputing its digest: not a chain. */
export function tamperedRegistry(through = 5): KeyRegistrySnapshot[] {
  const out = clone(scenarioRegistry(through));
  const third = out[2];
  if (third === undefined) throw new Error("fixture registry too short");
  out[2] = { ...third, signers: third.signers.map((s) => (s.kind === "WALLETWALL_PUBLISHER" ? { ...s, binding: { ...s.binding, publisher: "Edited after publication" } } : s)) };
  return out;
}

// ─── the synthetic ledger and its two real attestations ──────────────────────

/** A distinct 64-hex stand-in for an attestation digest in a filler entry. */
export const fillerDigest = (i: number): string => (i + 1).toString(16).padStart(64, "0");

export interface LedgerSlot {
  digest: string;
  version: number;
}

const defaultVersion = (i: number): number => Math.min(4, 1 + Math.floor(i / 3));

/** A valid ledger of `count` entries, each pinned to the digest of the registry version it names; `at` replaces a slot (by zero-based index). */
export function ledgerOfSlots(count: number, chain: readonly KeyRegistrySnapshot[] = scenarioRegistry(), at: Readonly<Record<number, LedgerSlot>> = {}): AcceptanceEntry[] {
  return ledgerOf(Array.from({ length: count }, (_, i) => {
    const slot = at[i] ?? { digest: fillerDigest(i), version: defaultVersion(i) };
    return { digest: slot.digest, pin: pinOf(chain, slot.version) };
  }));
}

export interface Scenario {
  /** A genuine statement by the assessor key `synthetic-reviewer-y-2`, accepted as entry 12 under registry version 4, while the key was ACTIVE. */
  genuine: ReturnType<typeof attest>;
  /** A statement by the same key about the same reviewer under another policy, signed after the key was found compromised, appended as entry 13 and naming version 4. */
  backdated: ReturnType<typeof attest>;
  slots: Record<number, LedgerSlot>;
}

export const BACKDATED_POLICY = "reviewer-y-review-b";

let scenarioMemo: Scenario | null = null;
export function scenario(): Scenario {
  if (scenarioMemo !== null) return scenarioMemo;
  const genuine = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(goldenRecord(), "reviewer-y"));
  const backdated = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(goldenRecord({ policy: BACKDATED_POLICY }), "reviewer-y"));
  scenarioMemo = { genuine, backdated, slots: { 11: { digest: digestOfEnvelope(genuine), version: 4 }, 12: { digest: digestOfEnvelope(backdated), version: 4 } } };
  return scenarioMemo;
}

/** The scenario ledger: fillers, the genuine acceptance as entry 12, the back-dated one as entry 13. */
export const scenarioLedger = (count = 14): AcceptanceEntry[] => ledgerOfSlots(count, scenarioRegistry(), scenario().slots);

/** The honest continuation of the same twelve entries: later entries are accepted under the registry heads that exist by then (5 and 6). */
export const honestLedger = (count = 14): AcceptanceEntry[] =>
  ledgerOfSlots(count, scenarioRegistry(), { 11: { digest: digestOfEnvelope(scenario().genuine), version: 4 }, 12: { digest: fillerDigest(12), version: 5 }, 13: { digest: fillerDigest(13), version: 6 } });

/** The same twelve-entry prefix shape with entry 12 naming a different attestation: another valid ledger with another head. */
export const alternateLedger = (count = 12): AcceptanceEntry[] => ledgerOfSlots(count, scenarioRegistry(), { 11: { digest: fillerDigest(500), version: 4 } });

/** A ledger edited after it was published, without recomputing entry digests: not a ledger. */
export function tamperedLedger(count = 12): AcceptanceEntry[] {
  const out = clone(scenarioLedger(count));
  const eighth = out[7];
  if (eighth === undefined) throw new Error("fixture ledger too short");
  out[7] = { ...eighth, acceptedUnder: { ...eighth.acceptedUnder, keyRegistryVersion: "1" } };
  return out;
}

/** A valid ledger whose last entry names registry version 4, to be committed beside a registry of only three versions. */
export const futureReferenceLedger = (): AcceptanceEntry[] => ledgerOfSlots(4, scenarioRegistry(), { 0: { digest: fillerDigest(0), version: 1 }, 1: { digest: fillerDigest(1), version: 2 }, 2: { digest: fillerDigest(2), version: 3 }, 3: { digest: fillerDigest(3), version: 4 } });

/** A valid ledger whose second entry names version 2 with the digest of another registry's version 2: it does not fit the committed registry. */
export function digestMismatchLedger(): AcceptanceEntry[] {
  return ledgerOf([{ digest: fillerDigest(0), pin: pinOf(scenarioRegistry(), 1) }, { digest: fillerDigest(1), pin: pinOf(alternateRegistry(), 2) }, { digest: fillerDigest(2), pin: pinOf(scenarioRegistry(), 3) }]);
}

/** Re-derive the entry chain after editing entries (used to build valid-but-different ledgers by hand). */
export const rehashed = (entries: readonly AcceptanceEntry[]): AcceptanceEntry[] => {
  const out: AcceptanceEntry[] = [];
  entries.forEach((e, i) => {
    const body = { ...e, seq: String(i + 1), previousEntryDigest: out[i - 1]?.entryDigest ?? null };
    out.push({ ...body, entryDigest: acceptanceEntryDigest(body) });
  });
  return out;
};

// ─── running a checkpoint, and using it with an attestation ──────────────────

export const runCheckpoint = (envelope: unknown, context: CheckpointContext): CheckpointVerification => verifyCheckpoint(envelope, context);

/** An attestation judged under the anchors a verified checkpoint authenticates (and under none, if the checkpoint authenticates nothing). */
export function verifyUnderCheckpoint(
  attestation: unknown,
  record: ReturnType<typeof goldenRecord> | null,
  checkpoint: CheckpointVerification,
  supplied: { keyRegistry: readonly KeyRegistrySnapshot[]; ledger: readonly AcceptanceEntry[] },
): AttestationVerification {
  const anchors = checkpointAnchors(checkpoint);
  return verifyAttestation(attestation, {
    ...(record === null ? {} : { record }),
    keyRegistry: supplied.keyRegistry,
    ...(anchors === null ? {} : { trustAnchor: anchors.trustAnchor }),
    acceptance: { ledger: supplied.ledger, anchor: anchors?.acceptanceAnchor ?? null },
  });
}

// ─── the vectors ─────────────────────────────────────────────────────────────

type Named<N extends string> = { of: N; through: number };
export type RegistryRef = Named<"scenario" | "diverged" | "tampered">;
export type LedgerRef = Named<"scenario" | "honest" | "alternate" | "tampered" | "futureReference" | "digestMismatch">;

export interface CheckpointVectorSpec {
  id: string;
  description: string;
  checkpoint: unknown;
  trustRoot: "primary" | "invalid" | null;
  registry: RegistryRef | null;
  ledger: LedgerRef | null;
  allowExtension: boolean;
  anchor: CommittedState | null;
  expectedDigest: string | null;
  /** An attestation judged under the anchors this checkpoint authenticates, against the supplied (possibly extended) logs. */
  attestation?: { envelope: unknown; record: "golden" | "renamed-policy" };
  /** Facts the vector exists to show; the committed file additionally records the whole result. */
  expect: {
    parse?: CheckpointVerification["parse"];
    signature?: CheckpointVerification["signature"]["status"];
    signer?: CheckpointVerification["signer"]["authorization"];
    key?: CheckpointVerification["signer"]["key"];
    registry?: LogStateExpectation;
    ledger?: LogStateExpectation;
    crossBinding?: CheckpointVerification["crossBinding"]["status"];
    anchor?: CheckpointVerification["anchor"]["status"];
    identity?: CheckpointVerification["identity"]["status"];
    reasons?: string[];
    anchors?: "AUTHENTICATED" | "NONE";
    attestation?: { origin: AttestationVerification["origin"]; originBasis: AttestationVerification["originBasis"]; standing: AttestationVerification["current"]["standing"] };
  };
}

interface LogStateExpectation {
  state: CheckpointVerification["registry"]["state"];
  uncovered?: string;
}

const REGISTRY_SOURCES: Readonly<Record<RegistryRef["of"], () => KeyRegistrySnapshot[]>> = {
  scenario: scenarioRegistry,
  diverged: divergedRegistry,
  tampered: () => tamperedRegistry(3),
};
const LEDGER_SOURCES: Readonly<Record<LedgerRef["of"], () => AcceptanceEntry[]>> = {
  scenario: scenarioLedger,
  honest: honestLedger,
  alternate: () => alternateLedger(12),
  tampered: () => tamperedLedger(12),
  futureReference: futureReferenceLedger,
  digestMismatch: digestMismatchLedger,
};
const ROOTS = { primary: PRIMARY_ROOT, invalid: INVALID_ROOT } as const;

export const resolveRegistry = (ref: RegistryRef | null): KeyRegistrySnapshot[] | undefined => (ref === null ? undefined : REGISTRY_SOURCES[ref.of]().slice(0, ref.through));
export const resolveLedger = (ref: LedgerRef | null): AcceptanceEntry[] | undefined => (ref === null ? undefined : LEDGER_SOURCES[ref.of]().slice(0, ref.through));

export function vectorContext(spec: CheckpointVectorSpec): CheckpointContext {
  const registry = resolveRegistry(spec.registry);
  const ledger = resolveLedger(spec.ledger);
  return {
    ...(spec.trustRoot === null ? {} : { trustRoot: ROOTS[spec.trustRoot] }),
    ...(registry === undefined ? {} : { keyRegistry: registry }),
    ...(ledger === undefined ? {} : { acceptanceLedger: ledger }),
    ...(spec.allowExtension ? { allowExtension: true } : {}),
    ...(spec.anchor === null ? {} : { anchor: spec.anchor }),
    ...(spec.expectedDigest === null ? {} : { expectedDigest: spec.expectedDigest }),
  };
}

export function runVector(spec: CheckpointVectorSpec): { checkpoint: CheckpointVerification; attestation: AttestationVerification | null } {
  const checkpoint = verifyCheckpoint(spec.checkpoint, vectorContext(spec));
  if (spec.attestation === undefined) return { checkpoint, attestation: null };
  const record = spec.attestation.record === "golden" ? goldenRecord() : goldenRecord({ policy: BACKDATED_POLICY });
  return { checkpoint, attestation: verifyUnderCheckpoint(spec.attestation.envelope, record, checkpoint, { keyRegistry: resolveRegistry(spec.registry) ?? [], ledger: resolveLedger(spec.ledger) ?? [] }) };
}

const committed = (envelope: CheckpointEnvelope): CommittedState => ({ registry: envelope.statement.registry, acceptanceLedger: envelope.statement.acceptanceLedger });

export function checkpointVectorSpecs(): CheckpointVectorSpec[] {
  const R = scenarioRegistry();
  const L = scenarioLedger();
  const sc = scenario();
  const c5_12 = checkpointFor(R.slice(0, 5), L.slice(0, 12));
  const c4_12 = checkpointFor(R.slice(0, 4), L.slice(0, 12));
  const c4_9 = checkpointFor(R.slice(0, 4), L.slice(0, 9));
  const anchor5_12 = committed(c5_12);
  const out: CheckpointVectorSpec[] = [];
  const add = (id: string, description: string, checkpoint: unknown, o: Partial<Omit<CheckpointVectorSpec, "id" | "description" | "checkpoint" | "expect">> & { expect: CheckpointVectorSpec["expect"] }): void => {
    out.push({ id, description, checkpoint, trustRoot: "primary", registry: null, ledger: null, allowExtension: false, anchor: null, expectedDigest: null, ...o });
  };
  const at = (registry: number, ledger: number): Pick<CheckpointVectorSpec, "registry" | "ledger"> => ({ registry: { of: "scenario", through: registry }, ledger: { of: "scenario", through: ledger } });
  const resign = (statement: CheckpointStatement, n: number = GOV.root1.n): CheckpointEnvelope => signCheckpointStatement(statement, n);
  const stmt = (envelope: CheckpointEnvelope): CheckpointStatement => envelope.statement;
  const swapHead = (envelope: CheckpointEnvelope, headDigest: string): CheckpointEnvelope => ({ ...envelope, statement: { ...envelope.statement, registry: { ...envelope.statement.registry, headDigest } } });

  add("cp-01-valid-checkpoint", "an authorized governance key signed a checkpoint over registry version 5 and ledger entries 1 to 12; the supplied logs are exactly that state. Nothing says it is the latest, so it is unanchored", c5_12, { ...at(5, 12), expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "MATCHED" }, ledger: { state: "MATCHED" }, crossBinding: "CONSISTENT", anchor: "NO_ANCHOR", anchors: "AUTHENTICATED" } });
  add("cp-01b-valid-checkpoint-at-the-held-anchor", "the same checkpoint against an anchor the caller already relies on that commits the same state", c5_12, { ...at(5, 12), anchor: anchor5_12, expect: { signature: "VALID", signer: "AUTHORIZED", anchor: "AT_ANCHOR", anchors: "AUTHENTICATED" } });
  add("cp-01c-valid-checkpoint-over-an-empty-ledger", "a checkpoint over registry version 1 and an empty ledger: zero entries committed, head null", checkpointFor(R.slice(0, 1), []), { registry: { of: "scenario", through: 1 }, ledger: { of: "scenario", through: 0 }, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "MATCHED" }, ledger: { state: "MATCHED" }, crossBinding: "CONSISTENT", anchors: "AUTHENTICATED" } });
  add("cp-02-wrong-signature", "one bit of the signature flipped", { ...c5_12, signature: flipLast(c5_12.signature) }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });

  const rogue = checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.rogue);
  add("cp-03a-unknown-governance-key", "a valid signature by a key the trust root does not list: the signature is genuine and authorizes nothing", rogue, { ...at(5, 12), expect: { signature: "VALID", key: "UNKNOWN", signer: "NOT_AUTHORIZED", anchors: "NONE" } });
  const selfNamed = resign(checkpointStatement(committed(c5_12), GOV.root1, { publicKeyOf: GOV.rogue }), GOV.rogue.n);
  add("cp-03b-self-declared-key-material", "the statement names the root's key id but carries a different public key and is signed by that other key: a checkpoint cannot make itself trusted by naming a key", selfNamed, { ...at(5, 12), expect: { signature: "VALID", key: "MATERIAL_MISMATCH", signer: "NOT_AUTHORIZED", anchors: "NONE" } });
  const publisherSigned = resign(checkpointStatement(committed(c5_12), { keyId: WHO.publisher2.keyId, n: WHO.publisher2.n }), WHO.publisher2.n);
  add("cp-03c-registered-publication-key-is-not-a-governance-key", "the registry being checkpointed lists this key as the WalletWall publication key; the registry cannot authorize the signer of its own checkpoint, only the trust root can", publisherSigned, { ...at(5, 12), expect: { signature: "VALID", key: "UNKNOWN", signer: "NOT_AUTHORIZED", anchors: "NONE" } });
  add("cp-03d-no-trust-root-supplied", "no governance trust root: nothing is authorized, and the verifier says it did not evaluate rather than defaulting", c5_12, { ...at(5, 12), trustRoot: null, expect: { signature: "VALID", key: "NOT_EVALUATED", signer: "NOT_EVALUATED", reasons: ["TRUST_ROOT_NOT_SUPPLIED"], anchors: "NONE" } });
  add("cp-03e-invalid-trust-root", "a trust root that is not itself valid (keys out of order) authorizes nothing", c5_12, { ...at(5, 12), trustRoot: "invalid", expect: { signature: "VALID", key: "NOT_EVALUATED", signer: "NOT_EVALUATED", reasons: ["TRUST_ROOT_INVALID"], anchors: "NONE" } });
  add("cp-04-known-key-wrong-purpose", "a key the trust root lists, authorized only for the deferred STANDING_HEAD purpose, signs a registry/ledger checkpoint", checkpointFor(R.slice(0, 5), L.slice(0, 12), GOV.standing), { ...at(5, 12), expect: { signature: "VALID", key: "KNOWN", signer: "NOT_AUTHORIZED", reasons: ["PURPOSE_NOT_GRANTED"], anchors: "NONE" } });

  add("cp-05-registry-head-mismatch", "the supplied registry shares versions 1 to 4 with the committed one but its version 5 is a different valid history: the committed head is not in it", c5_12, { registry: { of: "diverged", through: 5 }, ledger: { of: "scenario", through: 12 }, expect: { signature: "VALID", registry: { state: "MISMATCHED" }, crossBinding: "NOT_EVALUATED", reasons: ["REGISTRY_HEAD_MISMATCH"], anchors: "NONE" } });
  add("cp-06-ledger-head-mismatch", "the supplied ledger has twelve valid entries but a different twelfth: its head is not the committed one", c5_12, { registry: { of: "scenario", through: 5 }, ledger: { of: "alternate", through: 12 }, expect: { signature: "VALID", ledger: { state: "MISMATCHED" }, crossBinding: "NOT_EVALUATED", reasons: ["LEDGER_HEAD_MISMATCH"], anchors: "NONE" } });
  add("cp-07a-registry-truncated", "the supplied registry stops at version 4 although version 5 was committed", c5_12, { ...at(4, 12), expect: { signature: "VALID", registry: { state: "MISMATCHED" }, reasons: ["REGISTRY_TRUNCATED"], anchors: "NONE" } });
  add("cp-07b-registry-extended-in-exact-mode", "the supplied registry has a sixth version, and the caller asked for exactly the committed state: a different state is not this checkpoint", c5_12, { ...at(6, 12), expect: { signature: "VALID", registry: { state: "MISMATCHED", uncovered: "1" }, reasons: ["REGISTRY_EXTENDED_BEYOND_CHECKPOINT"], anchors: "NONE" } });
  add("cp-08a-ledger-truncated", "the supplied ledger stops at entry 11 although twelve were committed", c5_12, { ...at(5, 11), expect: { signature: "VALID", ledger: { state: "MISMATCHED" }, reasons: ["LEDGER_TRUNCATED"], anchors: "NONE" } });
  add("cp-08b-ledger-extended-in-exact-mode", "the supplied ledger has a thirteenth entry, and the caller asked for exactly the committed state", c5_12, { ...at(5, 13), expect: { signature: "VALID", ledger: { state: "MISMATCHED", uncovered: "1" }, reasons: ["LEDGER_EXTENDED_BEYOND_CHECKPOINT"], anchors: "NONE" } });
  add("cp-09-registry-chain-tampered", "a snapshot of the supplied registry was edited after publication without recomputing its digest: not a chain, so no comparison is made", c5_12, { registry: { of: "tampered", through: 3 }, ledger: { of: "scenario", through: 12 }, expect: { signature: "VALID", registry: { state: "NOT_EVALUATED" }, reasons: ["REGISTRY_CHAIN_INVALID"], anchors: "NONE" } });
  add("cp-10-ledger-chain-tampered", "an entry of the supplied ledger was edited after publication without recomputing its digest: not a ledger", c5_12, { registry: { of: "scenario", through: 5 }, ledger: { of: "tampered", through: 12 }, expect: { signature: "VALID", ledger: { state: "NOT_EVALUATED" }, reasons: ["LEDGER_CHAIN_INVALID"], anchors: "NONE" } });

  const future = checkpointFor(R.slice(0, 3), futureReferenceLedger());
  add("cp-11a-ledger-entry-references-a-future-registry-version", "a checkpoint over registry version 3 and a ledger whose last entry was accepted under version 4: both heads match, and the combination cannot have existed", future, { registry: { of: "scenario", through: 3 }, ledger: { of: "futureReference", through: 4 }, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "MATCHED" }, ledger: { state: "MATCHED" }, crossBinding: "INCONSISTENT", reasons: ["LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION"], anchors: "NONE" } });
  const mismatch = checkpointFor(R.slice(0, 5), digestMismatchLedger());
  add("cp-11b-ledger-entry-names-a-registry-state-that-is-not-the-committed-one", "an entry names registry version 2 with another registry's digest for it: the ledger prefix does not fit the committed registry", mismatch, { registry: { of: "scenario", through: 5 }, ledger: { of: "digestMismatch", through: 3 }, expect: { signature: "VALID", crossBinding: "INCONSISTENT", reasons: ["LEDGER_REGISTRY_DIGEST_MISMATCH"], anchors: "NONE" } });

  add("cp-12-old-checkpoint-is-still-cryptographically-valid", "a checkpoint over registry version 4 and ledger entries 1 to 9, presented with a later state that extends it: valid, authorized, and silent about everything after its heads", c4_9, { ...at(6, 14), allowExtension: true, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "EXTENDED", uncovered: "2" }, ledger: { state: "EXTENDED", uncovered: "5" }, crossBinding: "CONSISTENT", anchor: "NO_ANCHOR", anchors: "AUTHENTICATED" } });
  add("cp-13a-rollback-behind-a-newer-anchor", "the same old checkpoint, exactly its own state, when the caller already relies on the newer checkpoint of vector 01: authentic, and older than what is held", c4_9, { ...at(4, 9), anchor: anchor5_12, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "MATCHED" }, ledger: { state: "MATCHED" }, anchor: "BEHIND_ANCHOR", anchors: "NONE" } });
  const forkedCp = checkpointFor(divergedRegistry(5), L.slice(0, 12));
  add("cp-13b-same-counts-different-history", "a checkpoint with the anchor's counts but a different registry head: not the state the caller relies on", forkedCp, { registry: { of: "diverged", through: 5 }, ledger: { of: "scenario", through: 12 }, anchor: anchor5_12, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "MATCHED" }, anchor: "FORKED_FROM_ANCHOR", anchors: "NONE" } });
  add("cp-13c-registry-ahead-ledger-behind", "a checkpoint ahead of the anchor on the registry and behind it on the ledger: logs only append, so no honest state is both", checkpointFor(R, L.slice(0, 9)), { ...at(6, 9), anchor: anchor5_12, expect: { signature: "VALID", anchor: "FORKED_FROM_ANCHOR", anchors: "NONE" } });
  add("cp-13d-successor-of-the-held-anchor", "a checkpoint over registry version 6 and ledger entries 1 to 14, whose logs contain the anchored state and whose later entries name the registry heads that existed by then: it advances what the caller holds", checkpointFor(R, honestLedger()), { registry: { of: "scenario", through: 6 }, ledger: { of: "honest", through: 14 }, anchor: anchor5_12, expect: { signature: "VALID", signer: "AUTHORIZED", crossBinding: "CONSISTENT", anchor: "ADVANCES_ANCHOR", anchors: "AUTHENTICATED" } });
  add("cp-13e-successor-on-another-history", "a checkpoint over a later state, but of a different history than the anchor's: the anchored registry head is not in it", checkpointFor(divergedRegistry(6), L), { registry: { of: "diverged", through: 6 }, ledger: { of: "scenario", through: 14 }, anchor: anchor5_12, expect: { signature: "VALID", signer: "AUTHORIZED", anchor: "FORKED_FROM_ANCHOR", anchors: "NONE" } });

  add("cp-14-ledger-append-after-the-checkpoint-is-not-covered", "the committed registry and a ledger with one entry more than was committed, accepted as an extension: the extra entry is reported as uncovered", c5_12, { ...at(5, 13), allowExtension: true, expect: { signature: "VALID", registry: { state: "MATCHED" }, ledger: { state: "EXTENDED", uncovered: "1" }, anchors: "AUTHENTICATED" } });
  add("cp-15-registry-append-after-the-checkpoint-is-not-covered", "a registry with one version more than was committed, accepted as an extension: the extra version is reported as uncovered", c5_12, { ...at(6, 12), allowExtension: true, expect: { signature: "VALID", registry: { state: "EXTENDED", uncovered: "1" }, ledger: { state: "MATCHED" }, anchors: "AUTHENTICATED" } });

  add("cp-16-compromised-key-earlier-checkpointed-acceptance-keeps-its-standing", "checkpoint over registry 4 and ledger entries 1 to 12, signed while the key was ACTIVE; later versions record the key as compromised (retaining what was accepted before version 5). The genuine acceptance is entry 12, inside the checkpoint: its standing is held", c4_12, { ...at(6, 13), allowExtension: true, attestation: { envelope: sc.genuine, record: "golden" }, expect: { signature: "VALID", signer: "AUTHORIZED", registry: { state: "EXTENDED", uncovered: "2" }, ledger: { state: "EXTENDED", uncovered: "1" }, anchors: "AUTHENTICATED", attestation: { origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE", standing: "HELD" } } });
  add("cp-17-backdated-acceptance-after-the-compromise-is-outside-the-older-checkpoint", "the same checkpoint and logs: a statement the compromised key signed later, appended as entry 13 and naming registry version 4, lies after the authenticated prefix, so it keeps no standing", c4_12, { ...at(6, 13), allowExtension: true, attestation: { envelope: sc.backdated, record: "renamed-policy" }, expect: { signature: "VALID", signer: "AUTHORIZED", ledger: { state: "EXTENDED", uncovered: "1" }, anchors: "AUTHENTICATED", attestation: { origin: "KEY_ONLY", originBasis: "NONE", standing: "WITHDRAWN" } } });

  const polluted = checkpointFor(R, L.slice(0, 13));
  add("cp-22a-entry-since-the-anchor-names-an-older-registry-head", "a later checkpoint over registry 6 and ledger entries 1 to 13, where entry 13 is the back-dated acceptance naming version 4, against an anchor whose registry head is 5: registry versions only grow, so an entry appended after that anchor cannot have been accepted under version 4. The checkpoint is refused as inconsistent, not authenticated", polluted, { ...at(6, 13), anchor: anchor5_12, attestation: { envelope: sc.backdated, record: "renamed-policy" }, expect: { signature: "VALID", signer: "AUTHORIZED", anchor: "ADVANCES_ANCHOR", crossBinding: "INCONSISTENT", reasons: ["LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD"], anchors: "NONE", attestation: { origin: "KEY_ONLY", originBasis: "NONE", standing: "WITHDRAWN" } } });
  add("cp-22b-residual-window-the-anchor-predates-the-compromise-record", "the same later checkpoint against an anchor taken while the registry head was still 4, before the compromise was recorded: entry 13 names version 4, which the anchor cannot show to be too old, so the checkpoint authenticates the ledger as it stands, including a back-dated entry. This is the stated residual: a checkpoint commits what governance signed over, it does not show each entry was rightly accepted", polluted, { ...at(6, 13), anchor: committed(c4_12), attestation: { envelope: sc.backdated, record: "renamed-policy" }, expect: { signature: "VALID", signer: "AUTHORIZED", anchor: "ADVANCES_ANCHOR", crossBinding: "CONSISTENT", anchors: "AUTHENTICATED", attestation: { origin: "BOUND_ASSESSOR", originBasis: "ACCEPTANCE", standing: "HELD" } } });

  const forgedStatement = stmt(c5_12);
  add("cp-18a-attestation-domain-replay", "a signature over the checkpoint statement made under an attestation domain tag, presented as the checkpoint signature", { ...c5_12, signature: signUnderTag(forgedStatement, ATTESTATION_TAG, GOV.root1.n) }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });
  add("cp-18b-signature-over-bare-json", "a signature over the statement's JSON with no domain tag at all", { ...c5_12, signature: signUnderTag(forgedStatement, null, GOV.root1.n) }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });
  add("cp-18c-attestation-signature-as-checkpoint-signature", "the signature of a genuine assessor attestation presented as the checkpoint's signature", { ...c5_12, signature: sc.genuine.signature }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });

  add("cp-19a-statement-mutation-registry-head", "the committed registry head digest changed by one hex digit after signing", swapHead(c5_12, flipLast(c5_12.statement.registry.headDigest)), { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });
  add("cp-19b-statement-mutation-ledger-count", "the committed ledger count changed from 12 to 13 after signing", { ...c5_12, statement: { ...c5_12.statement, acceptanceLedger: { ...c5_12.statement.acceptanceLedger, entryCount: "13" } } }, { ...at(5, 13), allowExtension: true, expect: { signature: "INVALID", reasons: ["SIGNATURE_MISMATCH"], anchors: "NONE" } });

  add("cp-20a-linkage-field-is-refused", "a previous-checkpoint link smuggled into the statement: this version has no linkage, and an unknown field is refused, never dropped", { ...c5_12, statement: { ...c5_12.statement, previous: { digest: "ab".repeat(32) } } }, { ...at(5, 12), expect: { parse: "MALFORMED", anchors: "NONE" } });
  add("cp-20b-published-name-is-not-the-digest", "the checkpoint was published under an identifier that is not the digest of its envelope", c5_12, { ...at(5, 12), expectedDigest: "ab".repeat(32), expect: { signature: "VALID", identity: "MISMATCHED", reasons: ["CHECKPOINT_DIGEST_MISMATCH"], anchors: "NONE" } });
  add("cp-20c-published-name-is-the-digest", "the identifier is exactly the digest of the envelope, recomputed by the reader", c5_12, { ...at(5, 12), expectedDigest: checkpointDigest(c5_12), expect: { signature: "VALID", identity: "MATCHED", anchors: "AUTHENTICATED" } });
  add("cp-20d-statement-version-is-unsupported", "the signed twin of the version selector names a version this verifier does not read: refused as malformed, never reinterpreted", { ...c5_12, checkpointVersion: "0.1", statement: { ...c5_12.statement, checkpointVersion: "0.2" } }, { ...at(5, 12), expect: { parse: "MALFORMED", anchors: "NONE" } });
  add("cp-20e-unsupported-version", "an envelope of a checkpoint version this verifier does not read", { ...c5_12, checkpointVersion: "0.2" }, { ...at(5, 12), expect: { parse: "UNSUPPORTED_VERSION", anchors: "NONE" } });

  add("cp-21a-unsupported-algorithm", "the statement names an algorithm this verifier does not support: not checked, never valid and never invalid", resign(checkpointStatement(committed(c5_12), GOV.root1, { algorithm: "ML_DSA_65" })), { ...at(5, 12), expect: { signature: "NOT_CHECKED", key: "MATERIAL_MISMATCH", reasons: ["ALGORITHM_UNSUPPORTED", "SIGNER_KEY_MATERIAL_MISMATCH"], anchors: "NONE" } });
  add("cp-21b-malformed-signature-length", "a signature of the wrong length", { ...c5_12, signature: c5_12.signature.slice(0, 126) }, { ...at(5, 12), expect: { signature: "INVALID", anchors: "NONE" } });
  add("cp-21c-malformed-public-key", "a public key of the wrong length inside the statement", resign({ ...c5_12.statement, signer: { ...c5_12.statement.signer, publicKey: c5_12.statement.signer.publicKey.slice(0, 62) } }), { ...at(5, 12), expect: { signature: "INVALID", key: "MATERIAL_MISMATCH", reasons: ["KEY_LENGTH_INVALID"], anchors: "NONE" } });
  const sNonCanonical = ((): string => {
    const L_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
    const bytes = Buffer.from(c5_12.signature, "hex");
    const s = BigInt(`0x${Buffer.from(bytes.subarray(32)).reverse().toString("hex")}`);
    const bumped = s + L_ORDER;
    return Buffer.concat([bytes.subarray(0, 32), Buffer.from(bumped.toString(16).padStart(64, "0"), "hex").reverse()]).toString("hex");
  })();
  add("cp-21d-signature-s-not-canonical", "S plus the group order: the same point equation, refused as non-canonical", { ...c5_12, signature: sNonCanonical }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_S_NON_CANONICAL"], anchors: "NONE" } });
  add("cp-21e-signature-r-small-order", "a signature whose R is the identity point's encoding: refused as inadmissible before any platform check", { ...c5_12, signature: `01${"00".repeat(31)}${c5_12.signature.slice(64)}` }, { ...at(5, 12), expect: { signature: "INVALID", reasons: ["SIGNATURE_R_INADMISSIBLE"], anchors: "NONE" } });
  add("cp-21f-signature-not-hex", "a signature that is not lower-case hexadecimal is not a checkpoint", { ...c5_12, signature: "Z".repeat(128) }, { ...at(5, 12), expect: { parse: "MALFORMED", anchors: "NONE" } });
  return out;
}

const strip = <T extends { establishes: string; doesNotEstablish: readonly string[] }>(r: T): Omit<T, "establishes" | "doesNotEstablish"> => {
  const { establishes: _e, doesNotEstablish: _d, ...rest } = r;
  return rest;
};

/** The committed file's content: deterministic (Ed25519 signing is), so a regeneration must equal the file byte for byte. */
export function buildCheckpointVectorFile(): unknown {
  const specs = checkpointVectorSpecs();
  const governanceKeys = Object.values(GOV).map((g) => g.n);
  const keys = [...new Set([...governanceKeys, WHO.publisher2.n])].sort((a, b) => a - b).map((n) => ({ n, seedLabel: seedLabel(n), publicKey: syntheticKey(n).publicKey }));
  return {
    type: "walletwall.wallprint.trust-checkpoint-vectors",
    version: "0.1",
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    keys,
    trustRoots: ROOTS,
    registries: Object.fromEntries((Object.keys(REGISTRY_SOURCES) as RegistryRef["of"][]).map((k) => [k, REGISTRY_SOURCES[k]()])),
    ledgers: Object.fromEntries((Object.keys(LEDGER_SOURCES) as LedgerRef["of"][]).map((k) => [k, LEDGER_SOURCES[k]()])),
    vectors: specs.map((spec) => {
      const { checkpoint, attestation } = runVector(spec);
      const parsed = parseCheckpoint(spec.checkpoint);
      return {
        id: spec.id,
        description: spec.description,
        checkpoint: spec.checkpoint,
        trustRoot: spec.trustRoot,
        registry: spec.registry,
        ledger: spec.ledger,
        allowExtension: spec.allowExtension,
        anchor: spec.anchor,
        expectedDigest: spec.expectedDigest,
        ...(spec.attestation === undefined ? {} : { attestation: spec.attestation }),
        ...(parsed.ok ? { signedBytes: signedBytesOf(parsed.envelope.statement) } : {}),
        expected: strip(checkpoint),
        ...(attestation === null ? {} : { expectedAttestation: strip(attestation) }),
      };
    }),
  };
}

function signedBytesOf(statement: CheckpointStatement): { domainTag: string; preimage: string } {
  const text = new TextDecoder().decode(checkpointPreimage(statement));
  return { domainTag: text.split("\u0000")[0] ?? "", preimage: text };
}

export { formatVectorFile };
