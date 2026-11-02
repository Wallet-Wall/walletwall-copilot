import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { acceptanceEntryDigest, type AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import { verifyAttestation, verifyAttestations, type AttestationVerification } from "../../src/wallprint/attestation-verify.ts";
import { keyRegistryDigest, type KeyRegistrySnapshot } from "../../src/wallprint/key-registry.ts";
import { ROOT } from "../support/harness.ts";
import {
  WHO,
  anchorOf,
  assessmentTargetOf,
  attest,
  buildVectorFile,
  digestOfEnvelope,
  formatVectorFile,
  goldenRecord,
  ledgerAnchor,
  ledgerOf,
  pinOf,
  pinnedContext,
  recordTarget,
  registryChain,
  runSetVector,
  runVector,
  setVectorContext,
  setVectorInputs,
  syntheticKey,
  vectorContext,
  vectorLedger,
  vectorSpecs,
} from "../support/wallprint-attestations.ts";

const VECTORS = "packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json";
const byId = new Map(vectorSpecs().map((s) => [s.id, s]));
const run = (id: string): AttestationVerification => {
  const spec = byId.get(id);
  if (spec === undefined) throw new Error(`no vector ${id}`);
  return runVector(spec);
};

describe("attestation vectors: the stated expectation of every vector holds", () => {
  test("every vector's id is unique, and every vector's parse, signature, target, origin and basis are what the design says", () => {
    const specs = vectorSpecs();
    assert.equal(new Set(specs.map((s) => s.id)).size, specs.length, "vector ids are unique");
    assert.ok(specs.length >= 30);
    for (const spec of specs) {
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
    const golden = goldenRecord();
    const asReviewer = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(golden, "reviewer-y"));
    assert.notEqual(verifyAttestation(asReviewer, pinnedContext(asReviewer, 3)).origin, "BOUND_ISSUER_AUTHORITY");
  });

  test("the external assessor firewall: a registered binding is stronger than a key alone, and the assessor's own say-so registers nothing", () => {
    const r = run("17-valid-assessor-attestation");
    assert.equal(r.origin, "BOUND_ASSESSOR");
    assert.equal(r.atAcceptance.bindingMethod, "ASSESSOR_PUBLICATION");
    assert.deepEqual(r.limitations, []);
    assert.equal(run("02-valid-signature-unknown-key").origin, "KEY_ONLY");
    // A key the assessor merely declared has no registry entry, so it is the unregistered case, whatever it says about itself.
    assert.equal(run("02-valid-signature-unknown-key").atAcceptance.evaluation, "UNAVAILABLE");
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
    const asAssessment = attest("ASSESSMENT_ORIGIN", WHO.publisher2, assessmentTargetOf(golden, "reviewer-y"));
    assert.notEqual(verifyAttestation(asAssessment, pinnedContext(asAssessment, 2)).origin, "BOUND_ASSESSOR", "a WalletWall publication key does not become an assessor's key");
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
    for (const spec of vectorSpecs().filter((s) => s.acceptedUnder !== null && s.record !== null && s.pinDigestOf === undefined)) {
      const pin = spec.acceptedUnder ?? 1;
      const base = runVector(spec).atAcceptance;
      for (const through of [pin, 4, 5].filter((t) => t >= pin)) {
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

describe("attestation vectors: the acceptance pin is bound to one attestation and cannot be supplied by the presenter", () => {
  const forged = attest("ASSESSMENT_ORIGIN", WHO.reviewerW1, assessmentTargetOf(goldenRecord(), "reviewer-w"));
  const chain = registryChain();

  test("a compromised key's new statement has no ledger entry, so the old registry version it would need is never consulted", () => {
    // reviewer-w's key is COMPROMISED in the head and retained only for acceptances before version 2. Another attestation's genuine
    // version-1 entry is in the ledger; the forged statement is a different digest and is not named by it.
    const genuine = attest("ASSESSMENT_ORIGIN", WHO.reviewerR1, assessmentTargetOf(goldenRecord(), "reviewer-r"));
    const ledger = ledgerOf([{ digest: digestOfEnvelope(genuine), pin: pinOf(chain, 1) }]);
    const r = verifyAttestation(forged, { record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } });
    assert.equal(r.acceptance.status, "NOT_PINNED");
    assert.equal(r.origin, "KEY_ONLY");
    assert.equal(r.current.standing, "WITHDRAWN");
    assert.equal(verifyAttestation(genuine, { record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } }).acceptance.status, "PINNED");
  });

  test("a ledger entry back-dated behind an earlier one, an edited entry, a dropped entry, a twice-accepted attestation and an invalid ledger are all refused: no pin is taken", () => {
    const a = attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(goldenRecord()));
    const b = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(goldenRecord(), "reviewer-y"));
    const ledger = ledgerOf([
      { digest: digestOfEnvelope(a), pin: pinOf(chain, 2) },
      { digest: digestOfEnvelope(b), pin: pinOf(chain, 3) },
    ]);
    const ctx = (l: unknown, anchor: { seq: string; digest: string } | null = null) => ({ record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger: l, anchor } });
    assert.equal(verifyAttestation(b, ctx(ledger, ledgerAnchor(ledger))).acceptance.status, "PINNED");
    const ledgerVersions = (versions: [number, number]): AcceptanceEntry[] => ledgerOf([{ digest: digestOfEnvelope(a), pin: pinOf(chain, versions[0]) }, { digest: digestOfEnvelope(b), pin: pinOf(chain, versions[1]) }]);
    const decreasing = ledgerVersions([3, 2]);
    assert.ok(verifyAttestation(b, ctx(decreasing)).limitations.includes("ACCEPTANCE_INDEX_INVALID"), "registry versions never decrease along the ledger");
    const edited = JSON.parse(JSON.stringify(ledger)) as AcceptanceEntry[];
    (edited[1] as { acceptedUnder: { keyRegistryVersion: string } }).acceptedUnder.keyRegistryVersion = "1";
    assert.ok(verifyAttestation(b, ctx(edited)).limitations.includes("ACCEPTANCE_INDEX_INVALID"), "an edited entry breaks its own digest");
    const rewritten = JSON.parse(JSON.stringify(edited)) as AcceptanceEntry[];
    const e1 = rewritten[1] as Record<string, unknown> & { acceptedUnder: { keyRegistryDigest: string } };
    e1["acceptedUnder"] = pinOf(chain, 1);
    e1["entryDigest"] = acceptanceEntryDigest(e1 as unknown as AcceptanceEntry);
    assert.ok(verifyAttestation(b, ctx(rewritten)).limitations.includes("ACCEPTANCE_INDEX_INVALID"), "back-dating the last entry below its predecessor is refused");
    assert.ok(verifyAttestation(b, ctx([ledger[1]])).limitations.includes("ACCEPTANCE_INDEX_INVALID"), "a dropped entry breaks the chain from its start");
    assert.ok(verifyAttestation(b, ctx(ledgerOf([{ digest: digestOfEnvelope(a), pin: pinOf(chain, 2) }, { digest: digestOfEnvelope(a), pin: pinOf(chain, 3) }]))).limitations.includes("ACCEPTANCE_INDEX_INVALID"), "an attestation is accepted once");
    assert.ok(verifyAttestation(b, ctx("nope")).limitations.includes("ACCEPTANCE_INDEX_INVALID"));
    assert.equal(verifyAttestation(b, ctx(decreasing)).acceptance.status, "NOT_PINNED");
  });

  test("an anchor the caller already holds detects a ledger rewritten behind it, and an unanchored ledger says so", () => {
    const a = attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(goldenRecord()));
    const ledger = ledgerOf([{ digest: digestOfEnvelope(a), pin: pinOf(chain, 2) }]);
    const anchor = ledgerAnchor(ledger);
    const ctx = (l: unknown, an: { seq: string; digest: string } | null) => ({ record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger: l, anchor: an } });
    assert.equal(verifyAttestation(a, ctx(ledger, anchor)).acceptance.status, "PINNED");
    const other = ledgerOf([{ digest: digestOfEnvelope(a), pin: pinOf(chain, 1) }]);
    const r = verifyAttestation(a, ctx(other, anchor));
    assert.ok(r.limitations.includes("ACCEPTANCE_ANCHOR_MISMATCH"));
    assert.equal(r.acceptance.status, "NOT_PINNED");
    assert.ok(verifyAttestation(a, ctx(ledger, null)).limitations.includes("ACCEPTANCE_UNANCHORED"));
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
    const rolledBack = verify({ keyRegistry: registryChain(3), trustAnchor: anchorOf(chain) });
    assert.deepEqual(rolledBack.current.reasons, ["KEY_REGISTRY_ANCHOR_MISMATCH"]);
    assert.deepEqual(rolledBack.atAcceptance.reasons, ["KEY_REGISTRY_ANCHOR_MISMATCH"]);
    assert.equal(rolledBack.origin, "KEY_ONLY");
    const v3 = JSON.parse(JSON.stringify(registryChain(3)[2])) as Record<string, unknown> & { signers: unknown[] };
    const attacker = { signerId: "synthetic-zz-attacker", kind: "EXTERNAL_ASSESSOR", authorityId: null, assessorIds: ["reviewer-zz"], binding: { method: "ASSESSOR_PUBLICATION", publisher: "Attacker", url: "https://example.invalid/x", locator: "row", retrievedAt: "2026-10-24" }, keys: [{ keyId: "synthetic-zz-attacker-1", algorithm: "ED25519", publicKey: syntheticKey(40).publicKey, purposes: ["ASSESSMENT_ORIGIN"], status: "ACTIVE", addedIn: "4", statusFrom: "4", successor: null, retainedBefore: null }] };
    const altHead = { ...v3, keyRegistryVersion: "4", previous: { version: "3", digest: v3["digest"] }, signers: [...v3.signers, attacker], digest: "" } as unknown as KeyRegistrySnapshot;
    const alternative = [...registryChain(3), { ...altHead, digest: keyRegistryDigest(altHead) }];
    const substituted = verify({ keyRegistry: alternative, trustAnchor: anchorOf(chain) });
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
    const chain = registryChain();
    const ledger = ledgerOf([{ digest: digestOfEnvelope(spec.envelope), pin: { keyRegistryVersion: "9", keyRegistryDigest: "0".repeat(64) } }]);
    assert.equal(verify({ acceptance: { ledger, anchor: ledgerAnchor(ledger) }, keyRegistry: chain }).atAcceptance.reasons[0], "KEY_REGISTRY_VERSION_MISSING");
  });

  test("an unanchored chain is reported as only self-consistent", () => {
    assert.deepEqual(run("24-unanchored-registry").limitations, ["KEY_REGISTRY_UNANCHORED"]);
  });
});

describe("attestation vectors: several attestations, one deterministic order, no count", () => {
  test("the order does not depend on the input order, and an exact duplicate is flagged and never counted", () => {
    const chain = registryChain();
    const inputs = setVectorInputs(chain);
    const shared = setVectorContext(chain);
    const summary = (rs: AttestationVerification[]): string[] => rs.map((r) => `${r.purpose}|${r.keyId}|${r.attestationDigest}|${r.acceptance.keyRegistryVersion}|${r.origin}|${r.limitations.join(",")}`);
    const expected = summary(runSetVector(chain));
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 3, 0, 4, 2], [3, 1, 4, 2, 0]]) {
      assert.deepEqual(summary(verifyAttestations(order.map((i) => inputs[i]), shared)), expected, order.join());
    }
    const results = runSetVector(chain);
    assert.deepEqual(results.map((r) => r.purpose), ["ASSESSMENT_ORIGIN", "ISSUER_ASSESSMENT_ORIGIN", "RECORD_PUBLICATION", "RECORD_PUBLICATION", "RECORD_PUBLICATION"]);
    assert.equal(results.filter((r) => r.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION")).length, 1);
    assert.equal(results.every((r) => r.origin.startsWith("BOUND_")), true, "each is judged alone; the duplicate adds nothing");
    for (const r of results) assert.equal("count" in r, false);
  });

  test("a forged twin cannot make the genuine attestation a duplicate: only valid signatures are ever duplicates of each other", () => {
    const chain = registryChain();
    const genuine = attest("ASSESSMENT_ORIGIN", WHO.reviewerY2, assessmentTargetOf(goldenRecord(), "reviewer-y"));
    const ledger = ledgerOf([{ digest: digestOfEnvelope(genuine), pin: pinOf(chain, 3) }]);
    const ctx = { record: goldenRecord(), keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } };
    // Grind a corrupted copy until its digest sorts before the genuine one: it must still not displace it.
    let twin: unknown = null;
    for (let i = 0; i < 512 && twin === null; i++) {
      const candidate = { ...genuine, signature: genuine.signature.slice(0, -4) + i.toString(16).padStart(4, "0") };
      if (digestOfEnvelope(candidate) < digestOfEnvelope(genuine)) twin = candidate;
    }
    assert.ok(twin !== null, "found a twin that sorts first");
    for (const order of [[genuine, twin], [twin, genuine]]) {
      const results = verifyAttestations(order, ctx);
      const real = results.find((r) => r.signature.status === "VALID");
      assert.equal(real?.origin, "BOUND_ASSESSOR");
      assert.equal(real?.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION"), false);
      assert.equal(results.find((r) => r.signature.status === "INVALID")?.origin, "NONE");
    }
    // Same signer and key and target but another key material is not the same attestation either.
    const other = attest("ASSESSMENT_ORIGIN", { ...WHO.reviewerY2, n: 2 }, assessmentTargetOf(goldenRecord(), "reviewer-y"));
    const both = verifyAttestations([genuine, other], ctx);
    assert.equal(both.some((r) => r.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION")), false);
  });

  test("the same signer with two keys is two independent statements, never a sum", () => {
    const chain = registryChain();
    const golden = goldenRecord();
    const one = attest("RECORD_PUBLICATION", WHO.publisher1, recordTarget(golden));
    const two = attest("RECORD_PUBLICATION", WHO.publisher2, recordTarget(golden));
    const ledger = ledgerOf([{ digest: digestOfEnvelope(one), pin: pinOf(chain, 1) }, { digest: digestOfEnvelope(two), pin: pinOf(chain, 2) }]);
    const results = verifyAttestations([one, two], { record: golden, keyRegistry: chain, trustAnchor: anchorOf(chain), acceptance: { ledger, anchor: ledgerAnchor(ledger) } });
    assert.equal(results.length, 2);
    assert.equal(results.every((r) => !r.limitations.includes("DUPLICATE_OF_EARLIER_ATTESTATION")), true);
    assert.deepEqual(results.map((r) => r.signerId), ["synthetic-publisher", "synthetic-publisher"]);
  });

  test("unparsable inputs come last in input order and are reported, never dropped", () => {
    const chain = registryChain();
    const results = verifyAttestations(["not json", setVectorInputs(chain)[0], 42], { record: goldenRecord(), keyRegistry: chain });
    assert.deepEqual(results.map((r) => r.parse), ["PARSED", "MALFORMED", "MALFORMED"]);
  });
});

describe("attestation vectors: the committed file", () => {
  const text = readFileSync(`${ROOT}${VECTORS}`, "utf8").replace(/\r\n/g, "\n");

  test("regenerating from the synthetic seeds reproduces the committed file byte for byte (Ed25519 signing is deterministic)", () => {
    assert.equal(text, `${formatVectorFile(buildVectorFile())}\n`);
  });

  test("an independent reader of the committed file reaches the committed verdicts from the file's own registry, envelope and acceptance ledger", () => {
    const file = JSON.parse(text) as {
      synthetic: boolean;
      notice: string;
      keyRegistry: unknown;
      vectors: { id: string; record: string | null; acceptance: unknown; trustAnchor: unknown; envelope: unknown; expected: Record<string, unknown> }[];
    };
    assert.equal(file.synthetic, true);
    assert.match(file.notice, /^SYNTHETIC NON-PRODUCTION FIXTURE/);
    assert.equal(new Set(file.vectors.map((v) => v.id)).size, file.vectors.length, "the file's vector ids are unique");
    const records = { golden: goldenRecord(), other: goldenRecord({ id: "wp-attest-other" }), "renamed-policy": goldenRecord({ policy: "reviewer-y-review-b" }) } as const;
    for (const v of file.vectors) {
      const r = verifyAttestation(v.envelope, {
        ...(v.record === null ? {} : { record: records[v.record as keyof typeof records] }),
        keyRegistry: file.keyRegistry,
        ...(v.trustAnchor === null ? {} : { trustAnchor: v.trustAnchor as { version: string; digest: string } }),
        acceptance: v.acceptance as { ledger: unknown; anchor: { seq: string; digest: string } } | null,
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

  test("each vector's ledger names exactly its own attestation (or the vector has none)", () => {
    for (const spec of vectorSpecs()) {
      const ledger = vectorLedger(spec, registryChain());
      if (spec.acceptedUnder === null) assert.equal(ledger, null, spec.id);
      else assert.equal(ledger?.[0]?.attestationDigest, digestOfEnvelope(spec.envelope), spec.id);
    }
  });
});

describe("attestation vectors: hostile input never throws and never earns a verdict", () => {
  test("random structure inside a real attestation, checked against a fully valid context, is never more than key-only", () => {
    const original = byId.get("17-valid-assessor-attestation")!;
    const base = JSON.parse(JSON.stringify(original.envelope)) as Record<string, unknown>;
    const context = vectorContext(original);
    assert.equal(verifyAttestation(base, context).origin, "BOUND_ASSESSOR", "the unmutated envelope earns it, so the context is a fully valid one");
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const junk: unknown[] = [null, 0, -1, 1e308, "", "x".repeat(300), [], [[]], {}, { a: { b: { c: 1 } } }, true, "0".repeat(64), "ED25519", "reviewer-y"];
    const paths = ["type", "attestationVersion", "statement", "signature", "statement.purpose", "statement.signer", "statement.signer.keyId", "statement.signer.signerId", "statement.signer.publicKey", "statement.target", "statement.target.assessment", "statement.target.assessment.assessor", "statement.target.assessment.evidenceRefs", "statement.target.bundleDigest"];
    for (let i = 0; i < 300; i++) {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      const path = (paths[next() % paths.length] ?? "type").split(".");
      let node = copy;
      for (const seg of path.slice(0, -1)) node = node[seg] as Record<string, unknown>;
      const value = junk[next() % junk.length];
      if (JSON.stringify(node[path[path.length - 1] ?? "type"]) === JSON.stringify(value)) continue;
      node[path[path.length - 1] ?? "type"] = value;
      const r = verifyAttestation(copy, context);
      assert.ok(r.origin === "NONE" || r.origin === "KEY_ONLY", `${path.join(".")}: ${r.origin}`);
      assert.ok(Object.isFrozen(r));
    }
  });

  test("junk in every context slot never throws", () => {
    const base = byId.get("17-valid-assessor-attestation")!.envelope;
    const junk: unknown[] = [null, 0, "x", [], {}, [null], { a: 1 }, true];
    for (const a of junk) for (const b of junk) for (const c of junk) {
      const r = verifyAttestation(base, { record: a, keyRegistry: b, trustAnchor: null, acceptance: { ledger: c, anchor: null } });
      assert.equal(r.parse, "PARSED");
      assert.notEqual(r.origin, "BOUND_ASSESSOR");
    }
  });
});
