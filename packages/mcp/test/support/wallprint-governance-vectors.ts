import { authorizationDigest, bootstrapDigest, authorizationPreimage, type AuthorizationEnvelope, type AuthorizationStatement } from "../../src/wallprint/governance.ts";
import { verifyCeremonyTranscript } from "../../src/wallprint/governance-transcript.ts";
import { assessBootstrapPin, assessRootReset, verifyGovernance, verifyGovernedCheckpoint } from "../../src/wallprint/governance-verify.ts";
import { AUTHORIZATION_DOMAIN_TAGS, GOVERNANCE_CEREMONY_POLICY } from "../../src/wallprint/governance-vocabulary.ts";
import type { AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import type { KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { CHECKPOINT_DOMAIN_TAGS } from "../../src/wallprint/checkpoint-vocabulary.ts";
import { DOMAIN_TAGS } from "../../src/wallprint/attestation-vocabulary.ts";
import { SYNTHETIC_NOTICE, seedLabel } from "./wallprint-attestations.ts";
import { checkpointFor, fillerDigest, ledgerOfSlots } from "./wallprint-checkpoints.ts";
import {
  GK,
  GOV_KEYS,
  GOV_REGISTRY,
  SYNTHETIC_TOOLING,
  altered,
  authorizationFor,
  bootstrapFor,
  chainOf,
  checkpointBy,
  committedAt,
  govLedger,
  governanceSummary,
  governedSummary,
  pinSummary,
  publicKeyOf,
  rehearse,
  resetSummaryOf,
  signAuthorizationUnder,
  transcriptFor,
  transcriptSummary,
  wrongSignature,
} from "./wallprint-governance.ts";

/**
 * The governance ceremony vectors: deterministic, synthetic, data-only cases an independent verifier can replay from the file alone. Every
 * key is a test key derived from a public ASCII seed; the file is a regression record and an interoperability aid, never a trust root.
 * Ed25519 signing is deterministic, so a regeneration equals the committed file byte for byte.
 */

export { formatVectorFile } from "./wallprint-governance.ts";

export type VectorKind = "bootstrap" | "chain" | "checkpoint" | "pin" | "reset" | "transcript";

export interface GovernanceVectorSpec {
  id: string;
  description: string;
  kind: VectorKind;
  /** Everything the verifier is handed, inline: no reference to anything outside the file except the named logs of a checkpoint vector. */
  input: Record<string, unknown>;
  /** The statement whose exact signed bytes the file records, when the vector is about one authorization. */
  signedStatement?: AuthorizationStatement;
  /** Facts the vector exists to show, checked as a partial match on the result projection (the file records the whole projection). */
  expect: Record<string, unknown>;
}

export const VECTOR_LEDGERS: Record<string, AcceptanceEntry[]> = {
  ledger: govLedger(9),
  /** The same first five entries, then a different sixth: a ledger whose six-entry head differs from `ledger`'s. */
  alternate: ledgerOfSlots(6, GOV_REGISTRY, { 5: { digest: fillerDigest(500), version: 2 } }),
};
export const VECTOR_REGISTRIES: Record<string, KeyRegistrySnapshot[]> = { base: GOV_REGISTRY };

const root1 = bootstrapFor(GK.root1);
const rootDigest = bootstrapDigest(root1);
const root2 = bootstrapFor(GK.root2, { rootEpoch: "2" });
const root2Digest = bootstrapDigest(root2);

const retained6 = committedAt(6);
const a1 = chainOf([{ key: GK.op1 }]);
const c12 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: retained6 }]);
const c123 = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedThrough: retained6 }, { key: GK.op3, previousStanding: "COMPROMISED", previousRetainedThrough: null }]);
const c12Alt = chainOf([{ key: GK.op1 }, { key: GK.op4, previousStanding: "RETIRED", previousRetainedThrough: null }]);
const chain2 = chainOf([{ key: GK.op5 }], GK.root2, "2");
const first = (list: readonly AuthorizationEnvelope[], i = 0): AuthorizationEnvelope => list[i] as AuthorizationEnvelope;

const held = (envelope: AuthorizationEnvelope): { generation: string; authorizationDigest: string } => ({ generation: envelope.statement.generation, authorizationDigest: authorizationDigest(envelope) });

const ctx = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ bootstrap: root1, expectedBootstrapDigest: rootDigest, allowSynthetic: true, ...over });
const chainCtx = (authorizations: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ctx({ authorizations, ...over });

const withRoot = (over: Record<string, unknown>): Record<string, unknown> => ({ ...root1, ...over });
const rootField = (over: Record<string, unknown>): Record<string, unknown> => ({ ...root1, root: { ...root1.root, ...over } });

const V = (id: string, kind: VectorKind, description: string, input: Record<string, unknown>, expect: Record<string, unknown>, signedStatement?: AuthorizationStatement): GovernanceVectorSpec => ({
  id,
  kind,
  description,
  input,
  expect,
  ...(signedStatement === undefined ? {} : { signedStatement }),
});

const checkpointVector = (id: string, description: string, checkpoint: unknown, authorizations: unknown, ledger: { of: string; through: number }, over: Record<string, unknown>, expect: Record<string, unknown>): GovernanceVectorSpec =>
  V(id, "checkpoint", description, { checkpoint, context: chainCtx(authorizations, over), registry: { of: "base", through: 4 }, ledger }, expect);

const pinInput = (confirmations: unknown, candidate: unknown = root2): Record<string, unknown> => ({ candidate, confirmations, allowSynthetic: true });
const resetInput = (confirmations: unknown, candidate: unknown = root2): Record<string, unknown> => ({ pinned: { rootEpoch: "1", rootPublicKey: publicKeyOf(GK.root1), bootstrapDigest: rootDigest }, candidate, confirmations, allowSynthetic: true });
const origins = (digest: string, list: readonly string[]): { origin: string; digest: string }[] => list.map((origin) => ({ origin, digest }));

const t1 = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-001", kind: "ROOT_BOOTSTRAP", bootstrap: root1, authorizations: a1 });
const tctx = { bootstrap: root1, authorizations: a1, expectedTooling: SYNTHETIC_TOOLING };
const mutateTranscript = (edit: (t: typeof t1) => void): unknown => {
  const copy = structuredClone(t1);
  edit(copy);
  return copy;
};

export function governanceVectorSpecs(): GovernanceVectorSpec[] {
  const a1Env = first(a1);
  const noRoot = { ...root1 } as Record<string, unknown>;
  delete noRoot["root"];
  return [
    // ── the bootstrap ──
    V("gv-01-valid-bootstrap-pinned", "bootstrap", "A well-formed public root whose fingerprint the caller pinned.", { context: ctx() }, { bootstrap: { parse: "PARSED", pin: "PINNED", reasons: [] } }),
    V("gv-01b-valid-bootstrap-unpinned", "bootstrap", "The same root with no pinned fingerprint: accepted as well-formed, reported unpinned.", { context: { bootstrap: root1, allowSynthetic: true } }, { bootstrap: { parse: "PARSED", pin: "UNPINNED", reasons: [] } }),
    V("gv-02-unknown-field-refused", "bootstrap", "An unknown field is refused, never dropped: there is no slot for anything but public material.", { context: ctx({ bootstrap: withRoot({ label: "x" }) }) }, { bootstrap: { parse: "MALFORMED", reasons: ["BOOTSTRAP_MALFORMED"] } }),
    V("gv-02b-nested-unknown-field-refused", "bootstrap", "An unknown field inside the root entry is refused too.", { context: ctx({ bootstrap: rootField({ label: "x" }) }) }, { bootstrap: { parse: "MALFORMED" } }),
    V("gv-03-malformed-key-refused", "bootstrap", "A public key of the wrong length is not admitted.", { context: ctx({ bootstrap: rootField({ publicKey: "ab".repeat(31) }), expectedBootstrapDigest: undefined }) }, { bootstrap: { reasons: ["BOOTSTRAP_KEY_INADMISSIBLE"] } }),
    V("gv-03b-identity-point-key-refused", "bootstrap", "The identity point verifies any message on the platform primitive: it is never admitted as a root.", { context: ctx({ bootstrap: rootField({ publicKey: `01${"00".repeat(31)}` }), expectedBootstrapDigest: undefined }) }, { bootstrap: { reasons: ["BOOTSTRAP_KEY_INADMISSIBLE"] } }),
    V("gv-04-unsupported-algorithm-refused", "bootstrap", "A root of an algorithm this verifier does not support is not a root.", { context: ctx({ bootstrap: rootField({ algorithm: "RSA_PSS" }), expectedBootstrapDigest: undefined }) }, { bootstrap: { reasons: ["BOOTSTRAP_ALGORITHM_UNSUPPORTED"] } }),
    V("gv-05-root-granted-checkpoint-purpose-refused", "bootstrap", "A root may authorize keys and nothing else: granting it the checkpoint purpose makes it a signer of checkpoints.", { context: ctx({ bootstrap: rootField({ purposes: ["REGISTRY_LEDGER_CHECKPOINT"] }), expectedBootstrapDigest: undefined }) }, { bootstrap: { reasons: ["BOOTSTRAP_PURPOSE_NOT_PERMITTED"] } }),
    V("gv-05b-root-granted-attestation-purpose-refused", "bootstrap", "A root is never an attestation signer.", { context: ctx({ bootstrap: rootField({ purposes: ["RECORD_PUBLICATION"] }), expectedBootstrapDigest: undefined }) }, { bootstrap: { reasons: ["BOOTSTRAP_PURPOSE_NOT_PERMITTED"] } }),
    V("gv-06-pinned-fingerprint-mismatch", "bootstrap", "The artifact in hand is not the one whose fingerprint the caller pinned.", { context: ctx({ expectedBootstrapDigest: root2Digest }) }, { bootstrap: { pin: "MISMATCHED", reasons: ["BOOTSTRAP_DIGEST_MISMATCH"] } }),
    V("gv-07-epoch-below-the-floor", "bootstrap", "After a reset the caller raises the minimum epoch; the older root is refused.", { context: ctx({ minRootEpoch: "2" }) }, { bootstrap: { epoch: "BELOW_MINIMUM", reasons: ["BOOTSTRAP_EPOCH_BELOW_MINIMUM"] } }),
    V("gv-08-synthetic-key-refused-in-production-mode", "bootstrap", "A production verifier refuses any key id that begins with synthetic-.", { context: ctx({ allowSynthetic: false }) }, { bootstrap: { reasons: ["SYNTHETIC_KEY_REFUSED"] } }),
    V("gv-09-unsupported-format-version", "bootstrap", "A version this verifier does not speak is reported, not read.", { context: ctx({ bootstrap: withRoot({ formatVersion: "9.9" }) }) }, { bootstrap: { parse: "UNSUPPORTED_VERSION", reasons: ["BOOTSTRAP_VERSION_UNSUPPORTED"] } }),
    V("gv-09b-no-root-entry", "bootstrap", "A bootstrap with no root is refused.", { context: ctx({ bootstrap: noRoot }) }, { bootstrap: { parse: "MALFORMED" } }),
    V("gv-09c-no-bootstrap-supplied", "bootstrap", "Nothing is bootstrapped from anything else: with no bootstrap there is nothing to verify against.", { context: { authorizations: a1, allowSynthetic: true } }, { bootstrap: { parse: "NOT_SUPPLIED", reasons: ["BOOTSTRAP_NOT_SUPPLIED"] }, chain: { status: "NOT_EVALUATED" } }),

    // ── one authorization ──
    V("gv-10-valid-first-authorization", "chain", "The root authorizes the first operational key for the checkpoint purpose, generation 1.", { context: chainCtx(a1) }, { chain: { status: "VALID", count: "1" }, keys: [{ generation: "1", keyId: GK.op1.keyId, standing: "CURRENT" }] }, a1Env.statement),
    V("gv-11-signed-by-another-key", "chain", "A statement that names the root but was signed by another key.", { context: chainCtx([{ ...a1Env, signature: authorizationFor({ generation: "1", key: GK.op1 }, GK.root2.n).signature }]) }, { chain: { status: "INVALID", failedAt: 0, reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-11b-statement-names-another-root", "chain", "A statement that names a root other than the pinned one is refused before its signature is asked.", { context: chainCtx([authorizationFor({ root: GK.root2, generation: "1", key: GK.op1 })]) }, { chain: { status: "INVALID", reasons: ["ROOT_MISMATCH"] } }),
    V("gv-12-altered-authorized-key", "chain", "The authorized public key edited after signing.", { context: chainCtx([altered(a1Env, (s) => void (s.authorizedKey.publicKey = publicKeyOf(GK.op4)))]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-13-altered-purposes", "chain", "The granted purposes edited after signing.", { context: chainCtx([altered(a1Env, (s) => void (s.authorizedKey.purposes = ["REGISTRY_LEDGER_CHECKPOINT", "STANDING_HEAD"]))]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-14-altered-generation", "chain", "The generation edited after signing.", { context: chainCtx([altered(a1Env, (s) => void (s.generation = "2"))]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-14b-altered-root-epoch", "chain", "The root epoch edited after signing.", { context: chainCtx([altered(a1Env, (s) => void (s.rootEpoch = "2"))]) }, { chain: { status: "INVALID", reasons: ["ROOT_EPOCH_MISMATCH"] } }),
    V("gv-15a-replay-under-the-checkpoint-domain", "chain", "The statement signed under the checkpoint domain tag is not an authorization.", { context: chainCtx([signAuthorizationUnder(a1Env.statement, CHECKPOINT_DOMAIN_TAGS.REGISTRY_LEDGER_CHECKPOINT, GK.root1.n)]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-15b-replay-under-an-attestation-domain", "chain", "The statement signed under an attestation domain tag is not an authorization.", { context: chainCtx([signAuthorizationUnder(a1Env.statement, DOMAIN_TAGS.RECORD_PUBLICATION, GK.root1.n)]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-15c-signature-over-bare-json", "chain", "The statement signed as bare JSON, with no domain at all.", { context: chainCtx([signAuthorizationUnder(a1Env.statement, null, GK.root1.n)]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-16-self-signed-operational-key", "chain", "An operational key that names itself as the root and signs its own authorization bootstraps nothing: the pinned root is the only root.", { context: chainCtx([authorizationFor({ root: GK.op1, generation: "1", key: GK.op1 })]) }, { chain: { status: "INVALID", reasons: ["ROOT_MISMATCH"] } }),
    V("gv-16b-operational-key-signs-as-the-root", "chain", "A statement that names the real root but was signed by the operational key it authorizes.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.op1 }, GK.op1.n)]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),
    V("gv-17-authorized-key-is-the-root-key", "chain", "The root key may not also be the operational key.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.root1 })]) }, { chain: { status: "INVALID", reasons: ["AUTHORIZED_KEY_IS_ROOT_KEY"] } }),
    V("gv-18a-standing-head-is-not-grantable", "chain", "STANDING_HEAD is a reserved purpose: it is not grantable.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.op1, purposes: ["STANDING_HEAD"] })]) }, { chain: { status: "INVALID", reasons: ["PURPOSE_NOT_PERMITTED"] } }),
    V("gv-18b-attestation-purpose-is-not-grantable", "chain", "No attestation purpose is ever grantable to a governance key.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.op1, purposes: ["RECORD_PUBLICATION"] })]) }, { chain: { status: "INVALID", reasons: ["PURPOSE_NOT_PERMITTED"] } }),
    V("gv-18c-purposes-not-ordered", "chain", "Purposes are strictly ordered, like every list in the format.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.op1, purposes: ["REGISTRY_LEDGER_CHECKPOINT", "REGISTRY_LEDGER_CHECKPOINT"] })]) }, { chain: { status: "INVALID", reasons: ["PURPOSES_NOT_ORDERED"] } }),
    V("gv-19-authorization-of-another-root-epoch", "chain", "An authorization signed for epoch 2 cannot be replayed under the epoch 1 bootstrap, even by the same key.", { context: chainCtx([authorizationFor({ rootEpoch: "2", generation: "1", key: GK.op1 })]) }, { chain: { status: "INVALID", reasons: ["ROOT_EPOCH_MISMATCH"] } }),
    V("gv-19b-malformed-signature", "chain", "A signature that is not 64 bytes of hex.", { context: chainCtx([{ ...a1Env, signature: "00" }]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_LENGTH_INVALID"] } }),
    V("gv-19c-wrong-signature", "chain", "A signature with its last character changed.", { context: chainCtx([wrongSignature(a1Env)]) }, { chain: { status: "INVALID", reasons: ["SIGNATURE_MISMATCH"] } }),

    // ── a chain, rotation, rollback ──
    V("gv-20-rotation-generation-1-to-2", "chain", "Routine rotation: generation 2 retires the first key through the last state it signed and names the new one.", { context: chainCtx(c12) }, { chain: { status: "VALID", count: "2" }, keys: [{ generation: "1", keyId: GK.op1.keyId, standing: "RETIRED" }, { generation: "2", keyId: GK.op2.keyId, standing: "CURRENT" }] }, first(c12, 1).statement),
    V("gv-20b-replacement-after-compromise", "chain", "Generation 3 marks the second key compromised and retains nothing of it.", { context: chainCtx(c123) }, { chain: { status: "VALID", count: "3" }, keys: [{ generation: "1", keyId: GK.op1.keyId, standing: "RETIRED" }, { generation: "2", keyId: GK.op2.keyId, standing: "COMPROMISED" }, { generation: "3", keyId: GK.op3.keyId, standing: "CURRENT" }] }, first(c123, 2).statement),
    V("gv-21-generation-gap", "chain", "Generations must be 1..N with nothing missing.", { context: chainCtx([a1Env, authorizationFor({ generation: "3", key: GK.op2, supersedes: { authorizationDigest: authorizationDigest(a1Env), standing: "RETIRED", retainedThrough: null } })]) }, { chain: { status: "INVALID", failedAt: 1, reasons: ["GENERATION_NOT_CONSECUTIVE"] } }),
    V("gv-22-duplicate-generation", "chain", "The same generation twice is not an extension.", { context: chainCtx([a1Env, a1Env]) }, { chain: { status: "INVALID", failedAt: 1 } }),
    V("gv-23-supersedes-names-the-wrong-authorization", "chain", "Generation 2 must name the digest of generation 1.", { context: chainCtx([a1Env, authorizationFor({ generation: "2", key: GK.op2, supersedes: { authorizationDigest: rootDigest, standing: "RETIRED", retainedThrough: null } })]) }, { chain: { status: "INVALID", failedAt: 1, reasons: ["SUPERSEDES_DIGEST_MISMATCH"] } }),
    V("gv-23b-later-generation-without-supersedes", "chain", "A later generation that names no predecessor.", { context: chainCtx([a1Env, authorizationFor({ generation: "2", key: GK.op2 })]) }, { chain: { status: "INVALID", failedAt: 1, reasons: ["SUPERSEDES_MISSING"] } }),
    V("gv-23c-first-generation-names-a-predecessor", "chain", "Generation 1 has nothing to supersede.", { context: chainCtx([authorizationFor({ generation: "1", key: GK.op1, supersedes: { authorizationDigest: rootDigest, standing: "RETIRED", retainedThrough: null } })]) }, { chain: { status: "INVALID", failedAt: 0, reasons: ["SUPERSEDES_UNEXPECTED"] } }),
    V("gv-24-retired-key-cannot-return", "chain", "A key once superseded is never authorized again.", { context: chainCtx([...c12, authorizationFor({ generation: "3", key: GK.op1, supersedes: { authorizationDigest: authorizationDigest(first(c12, 1)), standing: "RETIRED", retainedThrough: null } })]) }, { chain: { status: "INVALID", failedAt: 2, reasons: ["AUTHORIZED_KEY_REUSED"] } }),
    V("gv-25-stale-chain-behind-held-state", "chain", "The caller holds generation 3; a chain that stops at generation 2 is older state, never current.", { context: chainCtx(c12, { held: held(first(c123, 2)) }) }, { held: { status: "BEHIND_HELD", reasons: ["GOVERNANCE_ROLLED_BACK_BELOW_HELD_GENERATION"] }, keys: [] }),
    V("gv-26-fork-from-held-state", "chain", "The caller holds one generation 2; a chain with a different generation 2 is a fork.", { context: chainCtx(c12Alt, { held: held(first(c12, 1)) }) }, { held: { status: "FORKED_FROM_HELD", reasons: ["GOVERNANCE_FORKS_FROM_HELD_STATE"] }, keys: [] }),
    V("gv-27-chain-advances-held-state", "chain", "The caller holds generation 2; generation 3 is a successor.", { context: chainCtx(c123, { held: held(first(c123, 1)) }) }, { held: { status: "ADVANCES_HELD" } }),
    V("gv-27b-chain-at-held-state", "chain", "The caller holds generation 3 and has generation 3.", { context: chainCtx(c123, { held: held(first(c123, 2)) }) }, { held: { status: "AT_HELD" } }),
    V("gv-27c-malformed-held-state", "chain", "A held state that is not a generation and a digest.", { context: chainCtx(c123, { held: { generation: "3" } }) }, { held: { status: "HELD_INVALID", reasons: ["HELD_STATE_MALFORMED"] }, keys: [] }),
    V("gv-27d-epoch-floor-refuses-the-whole-chain", "chain", "Below the minimum epoch nothing in the chain is evaluated.", { context: chainCtx(c123, { minRootEpoch: "2" }) }, { chain: { status: "NOT_EVALUATED" }, keys: [] }),

    // ── reliance on one checkpoint ──
    checkpointVector("gv-30-current-key-relied-upon", "A checkpoint by the current operational key: signature valid, signer authorized, reliance granted.", checkpointBy(GK.op1, 6), a1, { of: "ledger", through: 6 }, {}, { reliance: { status: "RELIED_UPON", keyStanding: "CURRENT" }, checkpoint: { signature: "VALID", authorization: "AUTHORIZED" }, anchors: "AUTHENTICATED" }),
    checkpointVector("gv-31-retired-key-within-the-retained-state", "After rotation, a checkpoint by the retired key at a state inside what the root stood behind is still relied upon.", checkpointBy(GK.op1, 4), c12, { of: "ledger", through: 4 }, {}, { reliance: { status: "RELIED_UPON", keyStanding: "RETIRED", limitations: ["SUPERSEDED_KEY_RETAINED_PREFIX_ONLY"] }, anchors: "AUTHENTICATED" }),
    checkpointVector("gv-31b-retired-key-at-the-retained-state", "A checkpoint at exactly the retained state, with exactly the retained heads.", checkpointBy(GK.op1, 6), c12, { of: "ledger", through: 6 }, {}, { reliance: { status: "RELIED_UPON", keyStanding: "RETIRED" } }),
    checkpointVector("gv-32-retired-key-beyond-the-retained-state", "A checkpoint by the retired key past what the root retained: the signature is valid and the signer is no longer relied upon. New checkpoints require the new key.", checkpointBy(GK.op1, 9), c12, { of: "ledger", through: 9 }, {}, { reliance: { status: "NOT_RELIED_UPON", reasons: ["CHECKPOINT_BEYOND_RETAINED_STATE"] }, checkpoint: { signature: "VALID", authorization: "NOT_AUTHORIZED" }, anchors: "NONE" }),
    checkpointVector("gv-33-retired-key-another-history-at-the-retained-state", "A checkpoint by the retired key at the retained count but over another history: it is not the state the root reviewed.", checkpointFor(GOV_REGISTRY, VECTOR_LEDGERS["alternate"] ?? [], GK.op1), c12, { of: "alternate", through: 6 }, {}, { reliance: { status: "NOT_RELIED_UPON", reasons: ["CHECKPOINT_HEAD_DIFFERS_AT_RETAINED_STATE"] }, anchors: "NONE" }),
    checkpointVector("gv-34-compromised-key-retains-nothing", "A checkpoint signed by a key the root marked compromised and retained nothing of: valid signature, no reliance.", checkpointBy(GK.op2, 9), c123, { of: "ledger", through: 9 }, {}, { reliance: { status: "NOT_RELIED_UPON", keyStanding: "COMPROMISED", reasons: ["KEY_SUPERSEDED_NOT_RETAINED"] }, checkpoint: { signature: "VALID" }, anchors: "NONE" }),
    checkpointVector("gv-35-the-replacement-key-signs", "After the replacement the new key's checkpoint is relied upon.", checkpointBy(GK.op3, 9), c123, { of: "ledger", through: 9 }, {}, { reliance: { status: "RELIED_UPON", keyStanding: "CURRENT", authorizedAtGeneration: "3" }, anchors: "AUTHENTICATED" }),
    checkpointVector("gv-36-signer-the-root-never-authorized", "A checkpoint by a key the root never authorized.", checkpointBy(GK.attacker, 6), a1, { of: "ledger", through: 6 }, {}, { reliance: { status: "NOT_RELIED_UPON", reasons: ["SIGNER_NOT_AUTHORIZED_BY_ROOT"] }, checkpoint: { signature: "VALID", authorization: "NOT_AUTHORIZED" }, anchors: "NONE" }),
    checkpointVector("gv-37-known-key-id-with-other-material", "A checkpoint that names an authorized key id with another key's material authorizes nothing.", checkpointFor(GOV_REGISTRY, govLedger(6), { keyId: GK.op1.keyId, n: GK.attacker.n }), a1, { of: "ledger", through: 6 }, {}, { reliance: { status: "NOT_RELIED_UPON", reasons: ["SIGNER_KEY_MATERIAL_MISMATCH"] }, anchors: "NONE" }),
    checkpointVector("gv-38-governance-state-not-usable", "With the bootstrap below the epoch floor nothing is relied upon and no trust root is derived.", checkpointBy(GK.op1, 6), a1, { of: "ledger", through: 6 }, { minRootEpoch: "2" }, { reliance: { status: "NOT_EVALUATED", reasons: ["GOVERNANCE_STATE_NOT_USABLE"] }, anchors: "NONE" }),
    checkpointVector("gv-39-rolled-back-chain-relies-on-nothing", "The caller holds generation 3; a stale chain with only the first key does not relieve the held state.", checkpointBy(GK.op1, 6), a1, { of: "ledger", through: 6 }, { held: held(first(c123, 2)) }, { governance: { held: "BEHIND_HELD" }, reliance: { status: "NOT_EVALUATED" }, anchors: "NONE" }),
    checkpointVector("gv-39b-the-old-root-after-a-reset", "Under the new root the old lineage's operational key is not authorized: the signature stays valid, the reliance does not.", checkpointBy(GK.op3, 9), chain2, { of: "ledger", through: 9 }, { bootstrap: root2, expectedBootstrapDigest: root2Digest, minRootEpoch: "2" }, { reliance: { status: "NOT_RELIED_UPON", reasons: ["SIGNER_NOT_AUTHORIZED_BY_ROOT"] }, checkpoint: { signature: "VALID" } }),
    checkpointVector("gv-39c-the-new-root-signs-a-new-checkpoint", "Under the new root its own operational key is relied upon.", checkpointBy(GK.op5, 9), chain2, { of: "ledger", through: 9 }, { bootstrap: root2, expectedBootstrapDigest: root2Digest, minRootEpoch: "2" }, { reliance: { status: "RELIED_UPON", keyStanding: "CURRENT" }, anchors: "AUTHENTICATED" }),

    // ── pinning and resetting ──
    V("gv-40-pin-two-origins", "pin", "Two distinct origins confirm the same fingerprint: the candidate may be pinned.", pinInput(origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"])), { status: "PIN_ACCEPTED", origins: ["GITHUB", "WALLETWALL_WEBSITE"], reasons: [] }),
    V("gv-40b-pin-one-origin", "pin", "One origin is not independent confirmation.", pinInput(origins(root2Digest, ["GITHUB"])), { status: "PIN_REFUSED", reasons: ["INSUFFICIENT_INDEPENDENT_ORIGINS"] }),
    V("gv-40c-pin-the-same-origin-twice", "pin", "Two confirmations from one origin are one origin: GitHub alone is not an independent trust root.", pinInput(origins(root2Digest, ["GITHUB", "GITHUB"])), { status: "PIN_REFUSED", reasons: ["INSUFFICIENT_INDEPENDENT_ORIGINS"] }),
    V("gv-40d-pin-a-confirmation-of-another-digest", "pin", "A confirmation of a different fingerprint does not count, and says so.", pinInput([...origins(root2Digest, ["GITHUB"]), { origin: "WALLETWALL_WEBSITE", digest: rootDigest }]), { status: "PIN_REFUSED", reasons: ["CONFIRMATION_DIGEST_MISMATCH", "INSUFFICIENT_INDEPENDENT_ORIGINS"] }),
    V("gv-40e-pin-no-confirmations", "pin", "No confirmation at all.", pinInput([]), { status: "PIN_REFUSED", reasons: ["INSUFFICIENT_INDEPENDENT_ORIGINS"] }),
    V("gv-40f-pin-a-malformed-candidate", "pin", "A candidate that is not a bootstrap.", pinInput(origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"]), { type: "x" }), { status: "PIN_REFUSED", reasons: ["CANDIDATE_MALFORMED"] }),
    V("gv-41-reset-accepted", "reset", "A higher epoch, a different root key and two distinct origins: the consumer may re-pin.", resetInput(origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"])), { status: "RESET_ACCEPTED", newRootEpoch: "2", consumerAction: "REPLACE_PINNED_BOOTSTRAP_AND_RAISE_MINIMUM_EPOCH" }),
    V("gv-41b-reset-epoch-not-greater", "reset", "A candidate at the pinned epoch is not a reset.", resetInput(origins(rootDigest, ["GITHUB", "WALLETWALL_WEBSITE"]), root1), { status: "RESET_REFUSED", reasons: ["EPOCH_NOT_GREATER", "ROOT_KEY_UNCHANGED"] }),
    V("gv-41c-reset-keeps-the-root-key", "reset", "A new epoch that keeps the compromised key is not a reset: root-signed replacement is not recovery.", resetInput(origins(bootstrapDigest(bootstrapFor(GK.root1, { rootEpoch: "2" })), ["GITHUB", "WALLETWALL_WEBSITE"]), bootstrapFor(GK.root1, { rootEpoch: "2" })), { status: "RESET_REFUSED", reasons: ["ROOT_KEY_UNCHANGED"] }),
    V("gv-41d-reset-unconfirmed", "reset", "A new root nobody confirmed out of band.", resetInput([]), { status: "RESET_REFUSED", reasons: ["INSUFFICIENT_INDEPENDENT_ORIGINS"] }),
    V("gv-41e-reset-malformed-pinned-state", "reset", "The root the consumer relies on is described wrongly.", { pinned: { rootEpoch: "1" }, candidate: root2, confirmations: origins(root2Digest, ["GITHUB", "WALLETWALL_WEBSITE"]), allowSynthetic: true }, { status: "RESET_REFUSED", reasons: ["PINNED_STATE_MALFORMED"] }),

    // ── transcripts ──
    V("gv-50-complete-root-bootstrap-transcript", "transcript", "A complete two-person root bootstrap transcript that matches its public artifacts and carries no secret slot.", { transcript: t1, context: tctx }, { parse: "PARSED", structure: { status: "COMPLETE" }, artifacts: { status: "CONSISTENT" }, tooling: { status: "MATCHED" }, secrets: "CLEAN", reasons: [] }),
    V("gv-50b-unknown-slot-refused", "transcript", "A transcript with a field the format does not define is refused: it has no free slot.", { transcript: mutateTranscript((t) => void Object.assign(t, { note: "x" })), context: tctx }, { parse: "MALFORMED", reasons: ["TRANSCRIPT_MALFORMED"] }),
    V("gv-50c-one-attester-only", "transcript", "An event attested by one role only.", { transcript: mutateTranscript((t) => void (t.events[4]!.by = ["OPERATOR"])), context: tctx }, { structure: { status: "INCOMPLETE", reasons: ["ONE_ATTESTER_ONLY"] } }),
    V("gv-50d-checklist-incomplete", "transcript", "An event whose checklist is not complete.", { transcript: mutateTranscript((t) => void (t.events[4]!.attests = ["KEY_FROM_OS_CSPRNG"])), context: tctx }, { structure: { status: "INCOMPLETE", reasons: ["CHECKLIST_INCOMPLETE"] } }),
    V("gv-50e-recorded-digest-is-not-the-artifacts", "transcript", "The root digest the transcript records is not the digest of the bootstrap supplied.", { transcript: t1, context: { ...tctx, bootstrap: root2 } }, { artifacts: { status: "INCONSISTENT", reasons: ["ARTIFACT_DIGEST_MISMATCH"] } }),
    V("gv-50f-backup-below-the-floor", "transcript", "A backup recorded below the policy floor.", { transcript: mutateTranscript((t) => void Object.assign((t.events[5] as { ref: Record<string, string> }).ref, { mediaCopies: "1" })), context: tctx }, { structure: { status: "INCOMPLETE", reasons: ["BACKUP_BELOW_MINIMUM"] } }),
    V("gv-50g-events-out-of-order", "transcript", "Events recorded out of order.", { transcript: mutateTranscript((t) => void t.events.splice(4, 2, t.events[5]!, t.events[4]!)), context: tctx }, { structure: { status: "INCOMPLETE" } }),
    V("gv-50h-live-mode-with-synthetic-keys", "transcript", "A live transcript may not name a synthetic key.", { transcript: mutateTranscript((t) => void Object.assign(t, { mode: "LIVE", ceremonyId: "walletwall-governance-root-live" })), context: tctx }, { artifacts: { status: "INCONSISTENT", reasons: ["LIVE_MODE_WITH_SYNTHETIC_KEY"] } }),
    V("gv-50i-tooling-differs-from-the-published-list", "transcript", "The tooling digests are not the published ones.", { transcript: t1, context: { ...tctx, expectedTooling: SYNTHETIC_TOOLING.slice(0, 1) } }, { tooling: { status: "MISMATCHED", reasons: ["TOOLING_MISMATCH"] } }),
    V("gv-50j-artifacts-not-cross-checked", "transcript", "With no artifacts supplied the transcript is checked for shape only, and says so.", { transcript: t1, context: { expectedTooling: SYNTHETIC_TOOLING } }, { artifacts: { status: "NOT_EVALUATED" }, limitations: ["ARTIFACTS_NOT_CROSS_CHECKED"] }),
  ];
}

/** Run one vector and project the result the file records. The projection holds only statuses, counts and fixed reason codes. */
export function runGovernanceVector(spec: GovernanceVectorSpec): Record<string, unknown> {
  const input = spec.input;
  const at = <T,>(key: string): T => input[key] as T;
  switch (spec.kind) {
    case "bootstrap":
    case "chain":
      return governanceSummary(verifyGovernance(at<unknown>("context")));
    case "checkpoint": {
      const ledgerRef = at<{ of: string; through: number }>("ledger");
      const registryRef = at<{ of: string; through: number }>("registry");
      const ledger = (VECTOR_LEDGERS[ledgerRef.of] ?? []).slice(0, ledgerRef.through);
      const registry = (VECTOR_REGISTRIES[registryRef.of] ?? []).slice(0, registryRef.through);
      return governedSummary(verifyGovernedCheckpoint(at<unknown>("checkpoint"), { ...at<Record<string, unknown>>("context"), keyRegistry: registry, acceptanceLedger: ledger }));
    }
    case "pin":
      return pinSummary(assessBootstrapPin(at<unknown>("candidate"), at<unknown>("confirmations"), { allowSynthetic: at<unknown>("allowSynthetic") === true }));
    case "reset":
      return resetSummaryOf(assessRootReset(at<unknown>("pinned"), at<unknown>("candidate"), at<unknown>("confirmations"), { allowSynthetic: at<unknown>("allowSynthetic") === true }));
    case "transcript":
      return transcriptSummary(verifyCeremonyTranscript(at<unknown>("transcript"), at<unknown>("context")));
  }
}

const tagOf = (statement: AuthorizationStatement): string => new TextDecoder().decode(authorizationPreimage(statement)).split("\u0000")[0] ?? "";

/** The committed file's content: deterministic, so a regeneration must equal the file byte for byte. */
export function buildGovernanceVectorFile(): unknown {
  const rehearsal = rehearse();
  return {
    type: "walletwall.wallprint.governance-ceremony-vectors",
    version: "0.1",
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    policy: GOVERNANCE_CEREMONY_POLICY,
    keys: GOV_KEYS.map((k) => ({ n: k.n, label: k.label, keyId: k.keyId, seedLabel: seedLabel(k.n), publicKey: publicKeyOf(k) })),
    registries: VECTOR_REGISTRIES,
    ledgers: VECTOR_LEDGERS,
    vectors: governanceVectorSpecs().map((spec) => ({
      id: spec.id,
      kind: spec.kind,
      description: spec.description,
      input: spec.input,
      ...(spec.signedStatement === undefined ? {} : { signedBytes: { domainTag: tagOf(spec.signedStatement), expectedDomainTag: AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION, preimage: new TextDecoder().decode(authorizationPreimage(spec.signedStatement)) } }),
      expected: runGovernanceVector(spec),
    })),
    rehearsal: { steps: rehearsal.steps, artifacts: rehearsal.artifacts },
  };
}
