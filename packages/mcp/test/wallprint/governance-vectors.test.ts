import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { authorizationPreimage, bootstrapDigest } from "../../src/wallprint/governance.ts";
import { scanCeremonyFile } from "../../src/wallprint/governance-secret-scan.ts";
import { verifyCeremonyTranscript } from "../../src/wallprint/governance-transcript.ts";
import { assessBootstrapPin, assessRootReset, verifyGovernance, verifyGovernedCheckpoint } from "../../src/wallprint/governance-verify.ts";
import { AUTHORIZATION_DOMAIN_TAGS, GOVERNANCE_CEREMONY_POLICY } from "../../src/wallprint/governance-vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { seedLabel } from "../support/wallprint-attestations.ts";
import { buildGovernanceVectorFile, governanceVectorSpecs, runGovernanceVector, type VectorKind } from "../support/wallprint-governance-vectors.ts";
import { GOV_KEYS, governanceSummary, governedSummary, pinSummary, publicKeyOf, resetSummaryOf, transcriptSummary, formatVectorFile } from "../support/wallprint-governance.ts";

const VECTORS = "packages/mcp/test/wallprint/fixtures/wallprint-governance-ceremony-vectors-0.1.json";
const text = readFileSync(`${ROOT}${VECTORS}`, "utf8").replace(/\r\n/g, "\n");

interface FileVector {
  id: string;
  kind: VectorKind;
  description: string;
  input: Record<string, unknown>;
  signedBytes?: { domainTag: string; expectedDomainTag: string; preimage: string };
  expected: Record<string, unknown>;
}
interface VectorFile {
  type: string;
  version: string;
  synthetic: boolean;
  notice: string;
  policy: unknown;
  keys: { n: number; label: string; keyId: string; seedLabel: string; publicKey: string }[];
  registries: Record<string, unknown[]>;
  ledgers: Record<string, unknown[]>;
  vectors: FileVector[];
  rehearsal: { steps: { step: number; name: string; facts: unknown }[]; artifacts: { bootstrap1: unknown; chain1: unknown[] } };
}
const file = JSON.parse(text) as VectorFile;
const specs = governanceVectorSpecs();

/** Every key the expectation names must match; arrays must match element for element and in length. */
function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e));
  if (expected !== null && typeof expected === "object") return actual !== null && typeof actual === "object" && Object.entries(expected).every(([k, e]) => matches((actual as Record<string, unknown>)[k], e));
  return actual === expected;
}

/** The replay a reader of the file alone would do: its own logs, its own inputs, the public verifiers. */
function replay(v: FileVector): unknown {
  const at = <T,>(key: string): T => v.input[key] as T;
  switch (v.kind) {
    case "bootstrap":
    case "chain":
      return governanceSummary(verifyGovernance(at<unknown>("context")));
    case "checkpoint": {
      const ledgerRef = at<{ of: string; through: number }>("ledger");
      const registryRef = at<{ of: string; through: number }>("registry");
      return governedSummary(
        verifyGovernedCheckpoint(at<unknown>("checkpoint"), {
          ...at<Record<string, unknown>>("context"),
          keyRegistry: (file.registries[registryRef.of] ?? []).slice(0, registryRef.through),
          acceptanceLedger: (file.ledgers[ledgerRef.of] ?? []).slice(0, ledgerRef.through),
        }),
      );
    }
    case "pin":
      return pinSummary(assessBootstrapPin(at<unknown>("candidate"), at<unknown>("confirmations"), { allowSynthetic: at<unknown>("allowSynthetic") === true }));
    case "reset":
      return resetSummaryOf(assessRootReset(at<unknown>("pinned"), at<unknown>("candidate"), at<unknown>("confirmations"), { allowSynthetic: at<unknown>("allowSynthetic") === true }));
    case "transcript":
      return transcriptSummary(verifyCeremonyTranscript(at<unknown>("transcript"), at<unknown>("context")));
  }
}

describe("governance ceremony vectors: the committed file", () => {
  test("regenerating from the synthetic seeds reproduces the committed file byte for byte (Ed25519 signing is deterministic)", () => {
    assert.equal(text, `${formatVectorFile(buildGovernanceVectorFile())}\n`);
  });

  test("it is labelled synthetic, holds only labelled public seeds and public keys, and no key material shaped like a private key", () => {
    assert.equal(file.type, "walletwall.wallprint.governance-ceremony-vectors");
    assert.equal(file.synthetic, true);
    assert.match(file.notice, /^SYNTHETIC NON-PRODUCTION FIXTURE/);
    assert.deepEqual(file.policy, JSON.parse(JSON.stringify(GOVERNANCE_CEREMONY_POLICY)));
    assert.equal(file.keys.length, GOV_KEYS.length);
    for (const k of file.keys) {
      assert.match(k.label, /^SYNTHETIC-NON-PRODUCTION-[A-Z0-9-]+$/);
      assert.match(k.keyId, /^synthetic-/);
      assert.match(k.seedLabel, /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/);
      assert.equal(k.seedLabel, seedLabel(k.n));
      assert.equal(k.publicKey, publicKeyOf(k));
    }
    assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|MC4CAQAwBQYDK2Vw|302e020100300506032b6570/);
    assert.deepEqual(scanCeremonyFile(VECTORS, text), [], "the committed ceremony fixture trips none of the secret rules");
  });

  test("an independent reader of the file reaches the committed results from the file's own logs, inputs and the public verifiers", () => {
    assert.equal(new Set(file.vectors.map((v) => v.id)).size, file.vectors.length, "vector ids are unique");
    assert.deepEqual(file.vectors.map((v) => v.id), specs.map((s) => s.id));
    for (const v of file.vectors) assert.deepEqual(JSON.parse(JSON.stringify(replay(v))), v.expected, v.id);
  });

  test("every vector shows what it says it shows", () => {
    for (const spec of specs) assert.ok(matches(JSON.parse(JSON.stringify(runGovernanceVector(spec))), spec.expect), `${spec.id}: ${JSON.stringify(runGovernanceVector(spec))}`);
  });

  test("the file covers every required family: bootstrap, authorization, rotation, rollback, reliance, pinning, reset and transcripts", () => {
    const kinds = new Set(file.vectors.map((v) => v.kind));
    for (const kind of ["bootstrap", "chain", "checkpoint", "pin", "reset", "transcript"]) assert.ok(kinds.has(kind as VectorKind), kind);
    const families = new Set(file.vectors.map((v) => v.id.slice(0, 5)));
    for (const family of ["gv-01", "gv-10", "gv-20", "gv-30", "gv-40", "gv-41", "gv-50"]) assert.ok(families.has(family), family);
  });

  test("the exact signed bytes of every authorization vector are recorded: tag, 0x00, canonical statement, under the authorization's own tag", () => {
    const withBytes = file.vectors.filter((v) => v.signedBytes !== undefined);
    assert.ok(withBytes.length >= 3);
    for (const v of withBytes) {
      const bytes = v.signedBytes as NonNullable<FileVector["signedBytes"]>;
      assert.equal(bytes.domainTag, AUTHORIZATION_DOMAIN_TAGS.CHECKPOINT_KEY_AUTHORIZATION);
      assert.equal(bytes.expectedDomainTag, bytes.domainTag);
      assert.ok(bytes.preimage.startsWith(`${bytes.domainTag}\u0000{`), v.id);
      const spec = specs.find((s) => s.id === v.id);
      assert.ok(spec?.signedStatement !== undefined);
      assert.equal(bytes.preimage, new TextDecoder().decode(authorizationPreimage(spec.signedStatement)));
    }
  });

  test("the rehearsal record covers the fifteen steps the lane required, in order, and its bootstrap is the one its chain verifies under", () => {
    const names = file.rehearsal.steps.map((s) => s.name);
    assert.deepEqual(names.slice(0, 15), [
      "isolated environment",
      "synthetic root generation",
      "public root artifact",
      "backup creation",
      "operational key generation",
      "root authorization of the operational key",
      "operational key signs a synthetic checkpoint",
      "checkpoint verified with only the public bootstrap",
      "operational key rotation (generation 1 to 2)",
      "old-key retirement",
      "root recovery from backup",
      "replacement operational authorization (generation 3)",
      "root-loss scenario",
      "root-compromise scenario",
      "trust reset",
    ]);
    const result = verifyGovernance({ bootstrap: file.rehearsal.artifacts.bootstrap1, authorizations: file.rehearsal.artifacts.chain1, allowSynthetic: true, expectedBootstrapDigest: bootstrapDigest(file.rehearsal.artifacts.bootstrap1 as never) });
    assert.equal(result.chain.status, "VALID");
    assert.equal(result.bootstrap.pin, "PINNED");
  });
});
