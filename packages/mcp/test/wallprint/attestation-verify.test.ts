import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { verifyAttestation, verifyAttestations, type AttestationVerification } from "../../src/wallprint/attestation-verify.ts";
import { keyRegistryDigest, type KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { ROOT } from "../support/harness.ts";
import { WHO, anchorOf, assessmentTargetOf, attest, buildVectorFile, formatVectorFile, goldenRecord, pinOf, recordTarget, registryChain, runSetVector, runVector, setVectorInputs, syntheticKey, vectorContext, vectorSpecs } from "../support/wallprint-attestations.ts";

const VECTORS = "packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json";
const byId = new Map(vectorSpecs().map((s) => [s.id, s]));
const run = (id: string): AttestationVerification => {
  const spec = byId.get(id);
  if (spec === undefined) throw new Error(`no vector ${id}`);
  return runVector(spec);
};

describe("attestation vectors: the stated expectation of every vector holds", () => {
  test("every vector's parse, signature, target, origin and basis are what the design says", () => {
    assert.ok(vectorSpecs().length >= 30);
    for (const spec of vectorSpecs()) {
      const r = runVector(spec);
      const e = spec.expect;
      if (e.parse !== undefined) assert.equal(r.parse, e.parse, spec.id);
      if (e.signature !== undefined) assert.equal(r.signature.status, e.signature, spec.id);
      if (e.target !== undefined) assert.equal(r.target.status, e.target, spec.id);
      if (e.origin !== undefined) assert.equal(r.origin, e.origin, spec.id);
      if (e.originBasis !== undefined) assert.equal(r.originBasis, e.originBasis, spec.id);
    }
  });

  test("the fifteen design cases are all present", () => {
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"]) assert.ok(vectorSpecs().some((s) => s.id.startsWith(`${n}`)), n);
    assert.ok(runSetVector().length >= 4, "15: multiple signatures");
  });

  test("a valid signature does not authenticate by itself: unknown key, wrong purpose and wrong issuer are key-only", () => {
    for (const id of ["02-valid-signature-unknown-key", "03-known-key-wrong-purpose", "04-issuer-key-bound-to-another-issuer", "20-key-label-says-circle", "07b-algorithm-differs-from-registry"]) {
      const r = run(id);
      assert.equal(r.signature.status, "VALID", id);
      assert.equal(r.origin, "KEY_ONLY", id);
    }
    assert.deepEqual(run("02-valid-signature-unknown-key").current.reasons, ["KEY_UNKNOWN"]);
    assert.equal(run("02-valid-signature-unknown-key").current.key, "UNKNOWN");
    assert.deepEqual(run("03-known-key-wrong-purpose").atAcceptance.reasons, ["ASSESSOR_NOT_BOUND", "PURPOSE_NOT_GRANTED", "SIGNER_KIND_MISMATCH"]);
    assert.deepEqual(run("04-issuer-key-bound-to-another-issuer").atAcceptance.reasons, ["ISSUER_AUTHORITY_MISMATCH"]);
    assert.equal(run("07b-algorithm-differs-from-registry").atAcceptance.key, "MATERIAL_MISMATCH");
  });

  test("the issuer firewall: any one failed condition prevents issuer origin", () => {
    const ok = run("16-valid-issuer-attestation");
    assert.equal(ok.origin, "BOUND_ISSUER_AUTHORITY");
    assert.equal(ok.atAcceptance.signerKind, "ISSUER_AUTHORITY");
    assert.equal(ok.atAcceptance.bindingMethod, "ISSUER_PUBLICATION");
    for (const id of [
      "04-issuer-key-bound-to-another-issuer", // the key is bound to another authority
      "18-issuer-attestation-without-record-context", // the attribution to the focal authority is not evaluated
      "19-assessor-key-signs-an-issuer-role-assessment", // an assessor key, an assessor purpose, an issuer-role statement
      "20-key-label-says-circle", // a label, not a binding
      "10c-compromised-issuer-key-at-the-boundary", // a bound key whose standing is withdrawn
      "05-invalid-signature", // the signature does not verify
    ]) assert.notEqual(run(id).origin, "BOUND_ISSUER_AUTHORITY", id);
    assert.equal(run("18-issuer-attestation-without-record-context").atAcceptance.binding, "NOT_EVALUATED");
    assert.ok(run("18-issuer-attestation-without-record-context").atAcceptance.reasons.includes("ISSUER_ATTRIBUTION_NOT_EVALUATED"));
    // An ISSUER-role assessment attributed to a non-authority, or a signer that merely says it is the issuer, never reaches issuer origin.
    const chain = registryChain();
    const golden = goldenRecord();
    const asReviewer = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(golden, "reviewer-y"));
    assert.notEqual(verifyAttestation(asReviewer, { record: golden, keyRegistry: chain, trustAnchor: anchorOf(chain), acceptedUnder: pinOf(chain, 3) }).origin, "BOUND_ISSUER_AUTHORITY");
  });

  test("the external assessor firewall: bound is weaker than nothing named and stronger than a key alone, and a self-declared binding says so", () => {
    assert.equal(run("17-valid-assessor-attestation").origin, "BOUND_ASSESSOR");
    assert.equal(run("17-valid-assessor-attestation").atAcceptance.bindingMethod, "ASSESSOR_PUBLICATION");
    assert.deepEqual(run("17-valid-assessor-attestation").limitations, []);
    const declared = run("21-self-declared-binding");
    assert.equal(declared.origin, "BOUND_ASSESSOR");
    assert.deepEqual(declared.limitations, ["BINDING_METHOD_ASSESSOR_DECLARATION"]);
    assert.equal(run("02-valid-signature-unknown-key").origin, "KEY_ONLY");
  });

  test("WalletWall speaks only through the publication attestation: its own assessment is never a target, and publication endorses nothing else", () => {
    const r = run("22-walletwall-assessment-is-not-attestable");
    assert.equal(r.origin, "NONE");
    assert.deepEqual(r.target.reasons, ["WALLETWALL_ASSESSMENT_NOT_ATTESTABLE"]);
    const publication = run("01-walletwall-publication-valid");
    assert.equal(publication.origin, "BOUND_WALLETWALL_PUBLISHER");
    assert.ok(publication.doesNotEstablish.includes("that any other assessment in the record is endorsed"));
    assert.ok(publication.doesNotEstablish.includes("that WalletWall certifies, guarantees or endorses the record"));
    const golden = goldenRecord();
    const chain = registryChain();
    const asAssessment = attest("ASSESSMENT_ORIGIN", WHO.publisher2, assessmentTargetOf(golden, "reviewer-y"));
    assert.notEqual(verifyAttestation(asAssessment, { record: golden, keyRegistry: chain, trustAnchor: anchorOf(chain), acceptedUnder: pinOf(chain, 2) }).origin, "BOUND_ASSESSOR", "a WalletWall publication key does not become an assessor's key");
  });
});

describe("attestation vectors: historical key state is never reinterpreted under present-day state", () => {
  test("a key superseded, retired or compromised later keeps the decision made under the registry version it was accepted under, and today's status is reported beside it", () => {
    const old = run("13-historical-key-valid-under-old-registry-version");
    assert.equal(old.atAcceptance.keyStatus, "ACTIVE");
    assert.equal(old.atAcceptance.keyRegistryVersion, "1");
    assert.equal(old.current.keyStatus, "SUPERSEDED");
    assert.equal(old.current.keyRegistryVersion, "4");
    assert.equal(old.origin, "BOUND_WALLETWALL_PUBLISHER");
    assert.equal(old.originBasis, "ACCEPTANCE");
    assert.deepEqual(old.limitations, ["KEY_NOT_ACTIVE_NOW"]);
    assert.equal(run("14-assessor-key-superseded-today").current.keyStatus, "SUPERSEDED");
    const compromised = run("10d-compromised-issuer-key-retained");
    assert.equal(compromised.signature.status, "VALID", "a later compromise does not change what the signature cryptographically is");
    assert.equal(compromised.current.keyStatus, "COMPROMISED");
    assert.equal(compromised.current.standing, "HELD");
    assert.equal(compromised.origin, "BOUND_ISSUER_AUTHORITY");
  });

  test("compromise and revocation are policy over a valid signature: the signature stays valid and the standing is withdrawn only outside the retained window", () => {
    for (const id of ["10b-compromised-outside-retained-window", "10c-compromised-issuer-key-at-the-boundary", "10e-withdrawn-key-no-acceptance-record"]) {
      const r = run(id);
      assert.equal(r.signature.status, "VALID", id);
      assert.equal(r.current.standing, "WITHDRAWN", id);
      assert.equal(r.origin, "KEY_ONLY", id);
    }
    assert.ok(run("10b-compromised-outside-retained-window").current.reasons.includes("WITHDRAWN_AFTER_ACCEPTANCE"));
    assert.ok(run("10e-withdrawn-key-no-acceptance-record").current.reasons.includes("WITHDRAWN_ACCEPTANCE_UNKNOWN"));
    assert.equal(run("10a-compromised-inside-retained-window").current.standing, "HELD");
  });

  test("a retired key was not authorized after its retirement, and was before it", () => {
    assert.equal(run("09a-retired-key-before-retirement").atAcceptance.authorization, "AUTHORIZED");
    assert.equal(run("09b-retired-key-accepted-after-retirement").atAcceptance.authorization, "NOT_AUTHORIZED");
    assert.deepEqual(run("09b-retired-key-accepted-after-retirement").atAcceptance.reasons, ["KEY_RETIRED"]);
  });

  test("the acceptance-time result is a pure function of the pinned snapshot: appending later versions, or truncating after the pin, changes nothing about it", () => {
    for (const spec of vectorSpecs().filter((s) => s.acceptedUnder !== null && s.record !== null)) {
      const pin = spec.acceptedUnder ?? 1;
      const base = runVector(spec).atAcceptance;
      for (const through of [pin, pin + 1, 4, 5].filter((t) => t >= pin)) {
        const chain = registryChain(through);
        const r = verifyAttestation(spec.envelope, { ...vectorContext(spec, chain), ...(spec.anchored ? { trustAnchor: anchorOf(chain) } : {}) });
        assert.deepEqual(r.atAcceptance, base, `${spec.id} through ${through}`);
      }
    }
  });

  test("no acceptance record means no historical decision: present-day state is used and labelled as such, never passed off as the acceptance-time state", () => {
    const r = run("25-active-key-no-acceptance-record");
    assert.equal(r.acceptance.status, "NOT_PINNED");
    assert.equal(r.atAcceptance.evaluation, "UNAVAILABLE");
    assert.equal(r.originBasis, "CURRENT");
    assert.deepEqual(r.limitations, ["ACCEPTANCE_NOT_PINNED"]);
  });
});

describe("attestation vectors: the key registry's own integrity", () => {
  const spec = byId.get("01-walletwall-publication-valid")!;
  const verify = (ctx: Record<string, unknown>): AttestationVerification => verifyAttestation(spec.envelope, { ...vectorContext(spec), ...ctx });

  test("a registry substituted for the pinned one (the digest differs) makes the acceptance-time decision unavailable, not guessed", () => {
    const r = run("23-registry-substituted");
    assert.equal(r.atAcceptance.evaluation, "UNAVAILABLE");
    assert.deepEqual(r.atAcceptance.reasons, ["KEY_REGISTRY_DIGEST_MISMATCH"]);
    assert.equal(r.origin, "KEY_ONLY");
  });

  test("a registry rolled back behind the caller's anchor, or a different registry at the anchor's version, is refused outright", () => {
    const chain = registryChain();
    const rolledBack = verify({ keyRegistry: registryChain(3), trustAnchor: anchorOf(chain), acceptedUnder: pinOf(chain, 2) });
    assert.deepEqual(rolledBack.current.reasons, ["KEY_REGISTRY_ANCHOR_MISMATCH"]);
    assert.deepEqual(rolledBack.atAcceptance.reasons, ["KEY_REGISTRY_ANCHOR_MISMATCH"]);
    assert.equal(rolledBack.origin, "KEY_ONLY");
    const v3 = JSON.parse(JSON.stringify(registryChain(3)[2])) as Record<string, unknown> & { signers: unknown[] };
    const attacker = { signerId: "synthetic-zz-attacker", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["reviewer-zz"], binding: { method: "ASSESSOR_DECLARATION", publisher: "Attacker", url: null, locator: null, retrievedAt: "2026-10-24" }, keys: [{ keyId: "synthetic-zz-attacker-1", algorithm: "ED25519", publicKey: syntheticKey(40).publicKey, purposes: ["ASSESSMENT_ORIGIN"], status: "ACTIVE", addedIn: "4", statusFrom: "4", successor: null, retainedBefore: null }] };
    const altHead = { ...v3, keyRegistryVersion: "4", previous: { version: "3", digest: v3["digest"] }, signers: [...v3.signers, attacker], digest: "" } as unknown as KeyRegistrySnapshot;
    const alternative = [...registryChain(3), { ...altHead, digest: keyRegistryDigest(altHead) }];
    const substituted = verify({ keyRegistry: alternative, trustAnchor: anchorOf(chain), acceptedUnder: pinOf(chain, 2) });
    assert.deepEqual(substituted.current.reasons, ["KEY_REGISTRY_ANCHOR_MISMATCH"], "a well-formed chain that is not the anchored one is refused");
    assert.equal(substituted.origin, "KEY_ONLY");
  });

  test("a chain that is not a valid chain is not a registry; a missing chain is unavailable, not unknown", () => {
    const tampered = JSON.parse(JSON.stringify(registryChain())) as { signers: { signerId: string; keys: { status: string }[] }[] }[];
    tampered[1]!.signers.find((s) => s.signerId === "synthetic-publisher")!.keys[0]!.status = "ACTIVE";
    const r = verify({ keyRegistry: tampered });
    assert.deepEqual(r.current.reasons, ["KEY_REGISTRY_CHAIN_INVALID"]);
    assert.equal(r.origin, "KEY_ONLY");
    const missing = verifyAttestation(spec.envelope, { record: goldenRecord() });
    assert.deepEqual(missing.current.reasons, ["KEY_REGISTRY_NOT_SUPPLIED"]);
    assert.equal(missing.current.key, null, "unavailable is not unknown");
    assert.equal(missing.signature.status, "VALID", "the signature needs no registry");
    assert.equal(verify({ acceptedUnder: { keyRegistryVersion: "9", keyRegistryDigest: "0".repeat(64) } }).atAcceptance.reasons[0], "KEY_REGISTRY_VERSION_MISSING");
  });

  test("an unanchored chain is reported as only self-consistent", () => {
    assert.deepEqual(run("24-unanchored-registry").limitations, ["KEY_REGISTRY_UNANCHORED"]);
  });
});

describe("attestation vectors: several attestations, one deterministic order, no count", () => {
  test("the order does not depend on the input order, and an exact duplicate is flagged and never counted", () => {
    const chain = registryChain();
    const inputs = setVectorInputs(chain);
    const expected = runSetVector(chain).map((r) => `${r.purpose}|${r.keyId}|${r.attestationDigest}|${r.limitations.join(",")}`);
    const shared = { record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain) };
    const permutations = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 3, 0, 4, 2]];
    for (const order of permutations) {
      const results = verifyAttestations(order.map((i) => inputs[i]!), shared).map((r) => `${r.purpose}|${r.keyId}|${r.attestationDigest}|${r.limitations.join(",")}`);
      assert.deepEqual(results, expected, order.join());
    }
    const results = runSetVector(chain);
    assert.deepEqual(results.map((r) => r.purpose), ["ASSESSMENT_ORIGIN", "ISSUER_ASSESSMENT_ORIGIN", "RECORD_PUBLICATION", "RECORD_PUBLICATION", "RECORD_PUBLICATION"]);
    assert.equal(results.filter((r) => r.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION")).length, 1);
    assert.equal(results.filter((r) => r.origin !== "KEY_ONLY" && r.origin !== "NONE").length, 5, "each is judged alone; the duplicate adds nothing");
    for (const r of results) assert.equal("count" in r, false);
  });

  test("the same signer with two keys, or two purposes, is two independent statements, never a sum", () => {
    const chain = registryChain();
    const golden = goldenRecord();
    const results = verifyAttestations(
      [
        { attestation: attest("RECORD_PUBLICATION", WHO.publisher1, recordTarget(golden)), acceptedUnder: pinOf(chain, 1) },
        { attestation: attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(golden)), acceptedUnder: pinOf(chain, 2) },
      ],
      { record: golden, keyRegistry: chain, trustAnchor: anchorOf(chain) },
    );
    assert.equal(results.length, 2);
    assert.equal(results.every((r) => !r.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION")), true);
    assert.deepEqual(results.map((r) => r.signerId), ["synthetic-publisher", "synthetic-publisher"]);
  });

  test("unparsable inputs come last in input order and are reported, never dropped", () => {
    const chain = registryChain();
    const results = verifyAttestations([{ attestation: "not json" }, ...setVectorInputs(chain).slice(0, 1), { attestation: 42 }], { record: goldenRecord(), keyRegistry: chain });
    assert.deepEqual(results.map((r) => r.parse), ["PARSED", "MALFORMED", "MALFORMED"]);
  });
});

describe("attestation vectors: the committed file", () => {
  const text = readFileSync(`${ROOT}${VECTORS}`, "utf8").replace(/\r\n/g, "\n");

  test("regenerating from the synthetic seeds reproduces the committed file byte for byte (Ed25519 signing is deterministic)", () => {
    assert.equal(text, `${formatVectorFile(buildVectorFile())}\n`);
  });

  test("an independent reader of the committed file reaches the committed verdicts from the file's own registry, envelope and pin", () => {
    const file = JSON.parse(text) as {
      synthetic: boolean;
      notice: string;
      keyRegistry: unknown;
      vectors: { id: string; record: string | null; acceptedUnder: unknown; trustAnchor: unknown; envelope: unknown; expected: Record<string, unknown> }[];
    };
    assert.equal(file.synthetic, true);
    assert.match(file.notice, /^SYNTHETIC NON-PRODUCTION FIXTURE/);
    const records = { golden: goldenRecord(), other: goldenRecord({ id: "wp-attest-other" }), "renamed-policy": goldenRecord({ policy: "reviewer-y-review-b" }) } as const;
    for (const v of file.vectors) {
      const r = verifyAttestation(v.envelope, {
        ...(v.record === null ? {} : { record: records[v.record as keyof typeof records] }),
        keyRegistry: file.keyRegistry,
        ...(v.trustAnchor === null ? {} : { trustAnchor: v.trustAnchor as { version: string; digest: string } }),
        acceptedUnder: v.acceptedUnder as { keyRegistryVersion: string; keyRegistryDigest: string } | null,
      });
      const { establishes: _e, doesNotEstablish: _d, ...rest } = r;
      assert.deepEqual(JSON.parse(JSON.stringify(rest)), v.expected, v.id);
    }
  });

  test("every vector shows its exact signed bytes: the domain tag, a 0x00 boundary and the canonical statement", () => {
    const file = JSON.parse(text) as { vectors: { id: string; envelope: { statement?: unknown }; signedBytes?: { domainTag: string; preimage: string } }[] };
    for (const v of file.vectors.filter((x) => x.envelope.statement !== undefined)) {
      assert.ok(v.signedBytes, v.id);
      assert.ok(v.signedBytes.preimage.startsWith(`${v.signedBytes.domainTag}\u0000{`), v.id);
    }
  });
});

describe("attestation vectors: hostile input never throws", () => {
  test("random structure around a real attestation always yields a result and never a verdict it did not earn", () => {
    const base = JSON.parse(JSON.stringify(byId.get("17-valid-assessor-attestation")?.envelope)) as Record<string, unknown>;
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const junk: unknown[] = [null, 0, -1, 1e308, "", "x".repeat(300), [], [[]], {}, { a: { b: { c: 1 } } }, true, Symbol.iterator.toString()];
    const paths = ["type", "attestationVersion", "statement", "signature", "statement.purpose", "statement.signer", "statement.signer.keyId", "statement.target", "statement.target.assessment", "statement.target.assessment.evidenceRefs"];
    for (let i = 0; i < 300; i++) {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      const path = (paths[next() % paths.length] ?? "type").split(".");
      let node = copy;
      for (const seg of path.slice(0, -1)) node = node[seg] as Record<string, unknown>;
      node[path[path.length - 1] ?? "type"] = junk[next() % junk.length];
      const r = verifyAttestation(copy, { record: junk[next() % junk.length], keyRegistry: junk[next() % junk.length], trustAnchor: null, acceptedUnder: null });
      assert.notEqual(r.origin, "BOUND_ASSESSOR");
      assert.ok(Object.isFrozen(r));
    }
  });
});
