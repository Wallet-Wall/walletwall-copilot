import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { verifyAttestation } from "../../src/wallprint/attestation-verify.ts";
import { verifyCheckpoint, checkpointAnchors, type CheckpointVerification } from "../../src/wallprint/checkpoint-verify.ts";
import { ROOT } from "../support/harness.ts";
import { goldenRecord } from "../support/wallprint-attestations.ts";
import { PRIMARY_ROOT, INVALID_ROOT, buildCheckpointVectorFile, checkpointVectorSpecs, formatVectorFile, runVector, type CheckpointVectorSpec } from "../support/wallprint-checkpoints.ts";

const VECTORS = "packages/mcp/test/wallprint/fixtures/wallprint-checkpoint-vectors-0.1.json";
const text = readFileSync(`${ROOT}${VECTORS}`, "utf8").replace(/\r\n/g, "\n");
const specs = checkpointVectorSpecs();

interface FileVector {
  id: string;
  checkpoint: unknown;
  trustRoot: "primary" | "invalid" | null;
  registry: { of: string; through: number } | null;
  ledger: { of: string; through: number } | null;
  allowExtension: boolean;
  anchor: unknown;
  expectedDigest: string | null;
  attestation?: { envelope: unknown; record: "golden" | "renamed-policy" };
  signedBytes?: { domainTag: string; preimage: string };
  expected: Record<string, unknown>;
  expectedAttestation?: Record<string, unknown>;
}
interface VectorFile {
  type: string;
  synthetic: boolean;
  notice: string;
  keys: { n: number; seedLabel: string; publicKey: string }[];
  trustRoots: Record<string, unknown>;
  registries: Record<string, unknown[]>;
  ledgers: Record<string, unknown[]>;
  vectors: FileVector[];
}
const file = JSON.parse(text) as VectorFile;
const strip = <T extends { establishes: string; doesNotEstablish: readonly string[] }>(r: T): unknown => {
  const { establishes: _e, doesNotEstablish: _d, ...rest } = r;
  return JSON.parse(JSON.stringify(rest));
};
const reasonsOf = (r: CheckpointVerification): string[] => [...r.signature.reasons, ...r.signer.reasons, ...r.registry.reasons, ...r.acceptanceLedger.reasons, ...r.crossBinding.reasons, ...r.anchor.reasons, ...r.identity.reasons];

describe("checkpoint vectors: the committed file", () => {
  test("regenerating from the synthetic seeds reproduces the committed file byte for byte (Ed25519 signing is deterministic)", () => {
    assert.equal(text, `${formatVectorFile(buildCheckpointVectorFile())}\n`);
  });

  test("it is labelled synthetic, holds only labelled public seeds and public keys, and no key material shaped like a private key", () => {
    assert.equal(file.type, "walletwall.wallprint.trust-checkpoint-vectors");
    assert.equal(file.synthetic, true);
    assert.match(file.notice, /^SYNTHETIC NON-PRODUCTION FIXTURE/);
    assert.ok(file.keys.length >= 5);
    for (const k of file.keys) {
      assert.match(k.seedLabel, /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/);
      assert.match(k.publicKey, /^[0-9a-f]{64}$/);
    }
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|MC4CAQAwBQYDK2Vw|302e020100300506032b6570/);
  });

  test("an independent reader of the file reaches the committed results from the file's own registries, ledgers, root and checkpoint", () => {
    assert.deepEqual(file.trustRoots, { primary: PRIMARY_ROOT, invalid: INVALID_ROOT });
    assert.equal(new Set(file.vectors.map((v) => v.id)).size, file.vectors.length, "the file's vector ids are unique");
    const resolve = (source: Record<string, unknown[]>, ref: { of: string; through: number } | null): unknown[] | undefined => (ref === null ? undefined : (source[ref.of] ?? []).slice(0, ref.through));
    const records = { golden: goldenRecord(), "renamed-policy": goldenRecord({ policy: "reviewer-y-review-b" }) } as const;
    for (const v of file.vectors) {
      const registry = resolve(file.registries, v.registry);
      const ledger = resolve(file.ledgers, v.ledger);
      const result = verifyCheckpoint(v.checkpoint, {
        ...(v.trustRoot === null ? {} : { trustRoot: file.trustRoots[v.trustRoot] }),
        ...(registry === undefined ? {} : { keyRegistry: registry }),
        ...(ledger === undefined ? {} : { acceptanceLedger: ledger }),
        ...(v.allowExtension ? { allowExtension: true } : {}),
        ...(v.anchor === null ? {} : { anchor: v.anchor }),
        ...(v.expectedDigest === null ? {} : { expectedDigest: v.expectedDigest }),
      });
      assert.deepEqual(strip(result), v.expected, v.id);
      if (v.attestation !== undefined) {
        const anchors = checkpointAnchors(result);
        const attestation = verifyAttestation(v.attestation.envelope, {
          record: records[v.attestation.record],
          keyRegistry: registry ?? [],
          ...(anchors === null ? {} : { trustAnchor: anchors.trustAnchor }),
          acceptance: { ledger: ledger ?? [], anchor: anchors?.acceptanceAnchor ?? null },
        });
        assert.deepEqual(strip(attestation), v.expectedAttestation, v.id);
      } else assert.equal(v.expectedAttestation, undefined, v.id);
    }
  });

  test("every vector shows its exact signed bytes when it parses: the domain tag, a 0x00 boundary and the canonical statement", () => {
    const signed = file.vectors.filter((v) => v.signedBytes !== undefined);
    assert.ok(signed.length >= 30);
    for (const v of signed) {
      assert.equal(v.signedBytes?.domainTag, "walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint", v.id);
      assert.ok(v.signedBytes?.preimage.startsWith(`${v.signedBytes.domainTag}\u0000{`), v.id);
    }
    for (const v of file.vectors.filter((x) => x.signedBytes === undefined)) assert.equal(v.expected.parse !== "PARSED", true, `${v.id}: only an unparsable checkpoint has no signed bytes`);
  });
});

describe("checkpoint vectors: what each one is for", () => {
  const holds = (spec: CheckpointVectorSpec): void => {
    const { checkpoint: r, attestation } = runVector(spec);
    const e = spec.expect;
    const eq = (name: string, got: unknown, want: unknown): void => {
      if (want !== undefined) assert.equal(got, want, `${spec.id} ${name}`);
    };
    eq("parse", r.parse, e.parse);
    eq("signature", r.signature.status, e.signature);
    eq("signer", r.signer.authorization, e.signer);
    eq("key", r.signer.key, e.key);
    eq("registry", r.registry.state, e.registry?.state);
    eq("registry.uncovered", r.registry.uncovered, e.registry?.uncovered);
    eq("ledger", r.acceptanceLedger.state, e.ledger?.state);
    eq("ledger.uncovered", r.acceptanceLedger.uncovered, e.ledger?.uncovered);
    eq("crossBinding", r.crossBinding.status, e.crossBinding);
    eq("anchor", r.anchor.status, e.anchor);
    eq("identity", r.identity.status, e.identity);
    for (const reason of e.reasons ?? []) assert.ok(reasonsOf(r).includes(reason), `${spec.id} reason ${reason}`);
    eq("anchors", checkpointAnchors(r) === null ? "NONE" : "AUTHENTICATED", e.anchors);
    if (e.attestation !== undefined) {
      eq("attestation.origin", attestation?.origin, e.attestation.origin);
      eq("attestation.originBasis", attestation?.originBasis, e.attestation.originBasis);
      eq("attestation.standing", attestation?.current.standing, e.attestation.standing);
    }
  };

  test("every vector shows the facts it exists to show", () => {
    for (const spec of specs) holds(spec);
  });

  test("the committed file names the cases the lane required, each under its own id", () => {
    const ids = new Set(file.vectors.map((v) => v.id));
    assert.deepEqual([...ids], specs.map((s) => s.id), "the file holds exactly the specs, in order");
    const required: [string, string[]][] = [
      ["valid checkpoint", ["cp-01-"]],
      ["wrong signature", ["cp-02-"]],
      ["unknown governance key", ["cp-03a-", "cp-03b-", "cp-03c-"]],
      ["known key, wrong purpose", ["cp-04-"]],
      ["registry head mismatch", ["cp-05-"]],
      ["ledger head mismatch", ["cp-06-"]],
      ["registry count mismatch", ["cp-07a-", "cp-07b-"]],
      ["ledger count mismatch", ["cp-08a-", "cp-08b-"]],
      ["registry chain tampered", ["cp-09-"]],
      ["ledger chain tampered", ["cp-10-"]],
      ["ledger entry references a registry version beyond the checkpoint", ["cp-11a-", "cp-11b-"]],
      ["old checkpoint still cryptographically valid", ["cp-12-"]],
      ["rollback relative to a newer trusted anchor", ["cp-13a-", "cp-13b-", "cp-13c-", "cp-13e-"]],
      ["post-checkpoint ledger append not covered", ["cp-14-"]],
      ["post-checkpoint registry append not covered", ["cp-15-"]],
      ["compromised-key history where an earlier checkpointed acceptance retains standing", ["cp-16-"]],
      ["fake back-dated acceptance appended after compromise is outside the older checkpoint", ["cp-17-", "cp-22a-"]],
      ["cross-purpose signature replay fails", ["cp-18a-", "cp-18b-", "cp-18c-"]],
      ["statement byte mutation fails", ["cp-19a-", "cp-19b-"]],
      ["duplicate or malformed identifier or linkage", ["cp-20a-", "cp-20b-", "cp-20c-", "cp-20d-", "cp-20e-"]],
    ];
    for (const [what, prefixes] of required) for (const p of prefixes) assert.ok([...ids].some((id) => id.startsWith(p)), `${what}: ${p}`);
    assert.ok(file.vectors.length >= 45, `${file.vectors.length} vectors`);
  });

  test("the vectors cover each result dimension with each of its non-trivial values, so a mutant that collapses a dimension is seen", () => {
    const seen = (pick: (r: CheckpointVerification) => string): Set<string> => new Set(specs.map((s) => pick(runVector(s).checkpoint)));
    assert.deepEqual([...seen((r) => r.signature.status)].sort(), ["INVALID", "NOT_CHECKED", "VALID"]);
    assert.deepEqual([...seen((r) => r.signer.authorization)].sort(), ["AUTHORIZED", "NOT_AUTHORIZED", "NOT_EVALUATED"]);
    assert.deepEqual([...seen((r) => r.signer.key)].sort(), ["KNOWN", "MATERIAL_MISMATCH", "NOT_EVALUATED", "UNKNOWN"]);
    assert.deepEqual([...seen((r) => r.registry.state)].sort(), ["EXTENDED", "MATCHED", "MISMATCHED", "NOT_EVALUATED"]);
    assert.deepEqual([...seen((r) => r.acceptanceLedger.state)].sort(), ["EXTENDED", "MATCHED", "MISMATCHED", "NOT_EVALUATED"]);
    assert.deepEqual([...seen((r) => r.crossBinding.status)].sort(), ["CONSISTENT", "INCONSISTENT", "NOT_EVALUATED"]);
    assert.deepEqual([...seen((r) => r.anchor.status)].sort(), ["ADVANCES_ANCHOR", "AT_ANCHOR", "BEHIND_ANCHOR", "FORKED_FROM_ANCHOR", "NOT_EVALUATED", "NO_ANCHOR"]);
    assert.deepEqual([...seen((r) => r.identity.status)].sort(), ["MATCHED", "MISMATCHED", "NOT_COMPARED"]);
    assert.deepEqual([...seen((r) => r.parse)].sort(), ["MALFORMED", "PARSED", "UNSUPPORTED_VERSION"]);
    assert.deepEqual([...new Set(specs.flatMap((s) => [runVector(s).checkpoint.registry.reasons, runVector(s).checkpoint.acceptanceLedger.reasons].flat()))].sort(), [
      "LEDGER_CHAIN_INVALID", "LEDGER_EXTENDED_BEYOND_CHECKPOINT", "LEDGER_HEAD_MISMATCH", "LEDGER_TRUNCATED", "REGISTRY_CHAIN_INVALID", "REGISTRY_EXTENDED_BEYOND_CHECKPOINT", "REGISTRY_HEAD_MISMATCH", "REGISTRY_TRUNCATED",
    ]);
  });

  test("the vectors that exist to refuse never produce an anchor, and exactly the authenticated ones do", () => {
    const authenticated = specs.filter((s) => checkpointAnchors(runVector(s).checkpoint) !== null).map((s) => s.id);
    assert.deepEqual(authenticated, specs.filter((s) => s.expect.anchors === "AUTHENTICATED").map((s) => s.id));
    assert.ok(authenticated.includes("cp-01-valid-checkpoint"));
    for (const refused of ["cp-02-wrong-signature", "cp-03a-unknown-governance-key", "cp-04-known-key-wrong-purpose", "cp-05-registry-head-mismatch", "cp-09-registry-chain-tampered", "cp-11a-ledger-entry-references-a-future-registry-version", "cp-13a-rollback-behind-a-newer-anchor"]) {
      assert.equal(authenticated.includes(refused), false, refused);
    }
  });

  test("the two attestation vectors that run through the checkpoint: the checkpointed acceptance keeps its standing and the appended one does not", () => {
    const byId = new Map(specs.map((s) => [s.id, runVector(s)]));
    const kept = byId.get("cp-16-compromised-key-earlier-checkpointed-acceptance-keeps-its-standing")?.attestation;
    const lost = byId.get("cp-17-backdated-acceptance-after-the-compromise-is-outside-the-older-checkpoint")?.attestation;
    assert.deepEqual([kept?.origin, kept?.current.keyStatus, kept?.current.standing], ["BOUND_ASSESSOR", "COMPROMISED", "HELD"]);
    assert.deepEqual([lost?.origin, lost?.current.keyStatus, lost?.current.standing], ["KEY_ONLY", "COMPROMISED", "WITHDRAWN"]);
  });
});
