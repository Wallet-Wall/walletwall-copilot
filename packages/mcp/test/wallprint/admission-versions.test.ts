import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { canonicalize } from "../../src/canonical.ts";
import { ADMISSION_RULES, admissionRulesFor, foldIdentity, identitySkeleton, identityWords, inReservedPolicyNamespace, readsAsReservedIdentity, reservedAuthorityIds, reservedAuthoritySkeletons } from "../../src/wallprint/admission.ts";
import { ASSETS, EXCLUDED_ASSETS, allPolicies, type Asset } from "../../src/registry.ts";
import { diffWallPrints } from "../../src/wallprint/diff.ts";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { createWallPrintHistory } from "../../src/wallprint/history.ts";
import { isReservedIdentity, isReservedPolicyId } from "../../src/wallprint/language.ts";
import { REFERENCE_TARGETS, encodeReference, encodeReferenceEnvelope, parseReference, referenceOf, resolveReference } from "../../src/wallprint/reference.ts";
import { verifyReceipt, wallPrintReceipt } from "../../src/wallprint/receipt.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord, verifyWallPrintDigest, wallPrintDigest, wallPrintPayload, type SnapshotInput, type WallPrintRecord } from "../../src/wallprint/record.ts";
import { createEvidenceStore, replayWallPrint } from "../../src/wallprint/replay.ts";
import { RESERVED_IDENTITY_STEMS, RESERVED_POLICY_NAMESPACES, WALLPRINT_VERSION, WALLPRINT_VERSIONS, type WallPrintVersion } from "../../src/wallprint/vocabulary.ts";
import { ADMIT, ADMISSION_CASES, assessmentOf, findingKey, type AdmissionCase, type Outcome } from "./admission-cases.ts";
import { SEPS_ID, SEPS_POLICY, prng, sample } from "./admission-fuzz.ts";
import { COMMIT_AT, LATER_AT, LATER_SNAPSHOT_AT, baseInput, golden, issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * WallPrint 0.2's admission rules, pinned as semantic tables and properties, and held against 0.1's. The table of
 * admission-cases.ts is the 0.1 characterization; here a row's 0.2 outcome is derived from its own tag, so "0.2 changes
 * exactly the rows marked as known gaps, and nothing else" is a test, not a hope.
 */
const IDENTITY = ["ASSESSOR_IDENTITY_RESERVED@assessor"] as const;
const NAMESPACE = ["RESERVED_POLICY_NAMESPACE@policy"] as const;

/** The 0.2 outcome of a row: a 0.1 known gap is refused with its family's finding; every other row is what it was. */
function expected02(c: AdmissionCase): Outcome {
  if (c.v01 !== ADMIT || !c.why.startsWith("known gap")) return c.v01;
  return c.family === "policy" ? [...NAMESPACE] : [...IDENTITY];
}

function outcomeOf(c: AdmissionCase, version: WallPrintVersion): Outcome {
  try {
    const record = buildWallPrintSnapshot(baseInput({ assessments: [assessmentOf(c)], wallprintVersion: version }));
    assert.equal(record.wallprintVersion, version);
    assert.equal(validateWallPrintRecord(record).ok, true);
    return ADMIT;
  } catch (e) {
    assert.ok(e instanceof WallPrintError);
    return e.findings.map(findingKey);
  }
}

describe("WallPrint versions and the admission table", () => {
  test("two versions are read; the current one is 0.2; each has exactly one row of rules and the table is frozen", () => {
    assert.deepEqual([...WALLPRINT_VERSIONS], ["0.1", "0.2"]);
    assert.equal(WALLPRINT_VERSION, "0.2");
    assert.deepEqual(Object.keys(ADMISSION_RULES).sort(), [...WALLPRINT_VERSIONS]);
    assert.ok(Object.isFrozen(ADMISSION_RULES) && Object.isFrozen(ADMISSION_RULES["0.1"]) && Object.isFrozen(ADMISSION_RULES["0.2"]));
    for (const v of WALLPRINT_VERSIONS) assert.equal(admissionRulesFor(v).version, v);
    assert.throws(() => admissionRulesFor("0.3" as never), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_INPUT");
  });

  test("0.1's rules are the language.ts rules, untouched; the stems and namespaces are the contract's", () => {
    assert.equal(ADMISSION_RULES["0.1"].readsAsReservedIdentity, isReservedIdentity);
    assert.equal(ADMISSION_RULES["0.1"].inReservedPolicyNamespace, isReservedPolicyId);
    assert.deepEqual([...RESERVED_IDENTITY_STEMS], ["walletwall", "wallprint"]);
    assert.deepEqual([...RESERVED_POLICY_NAMESPACES], ["wwap", "wwdr", "wwvr"]);
  });

  test("the reserved authority identities are literals frozen with each version, and today they are exactly the registry's and the engine's: a registry change that moves this is a conscious one", () => {
    assert.deepEqual(reservedAuthoritySkeletons(), ["canonicalchainstate", "issuercircle", "issuerpublication", "issuertether", "protocolsky"]);
    const registryIds = [...ASSETS, ...EXCLUDED_ASSETS].map((a) => a.authorityId);
    const engineIds = allPolicies().filter((p) => p.authority.kind !== "NONE").map((p) => p.authority.authorityId);
    assert.deepEqual([...new Set(registryIds)].sort(), [...reservedAuthorityIds("0.1")].sort(), "0.1 reserves exactly the registry's deployment authorities, as written when 0.1 was committed");
    const live = [...new Set([...registryIds, ...engineIds])].filter((id) => !readsAsReservedIdentity(id)).sort();
    assert.deepEqual(live, [...reservedAuthorityIds("0.2")].sort(), "0.2 reserves the registry's and the engine's authorities (walletwall-rules is reserved as an identity, none is no authority). If this fails the registry or the policies gained an authority: protect it in the next WallPrint version, do not edit this list");
    assert.ok(Object.isFrozen(reservedAuthorityIds("0.1")) && Object.isFrozen(reservedAuthorityIds("0.2")));
  });

  test("a registry that gains an authority reinterprets no committed record: the rules read no mutable source", () => {
    const supplied = reviewerAssessment({ assessor: "issuer:future", policy: "future-review" });
    const before = buildWallPrintSnapshot(baseInput({ assessments: [supplied], wallprintVersion: "0.1" }));
    const before02 = buildWallPrintSnapshot(baseInput({ assessments: [supplied], wallprintVersion: "0.2" }));
    const template = ASSETS[0] as Asset;
    (ASSETS as Asset[]).push({ ...template, authorityId: "issuer:future" });
    try {
      assert.equal(validateWallPrintRecord(before).ok, true, "a 0.1 record stays valid");
      assert.equal(validateWallPrintRecord(before02).ok, true, "so does a 0.2 record: the new authority is protected by the next version, not retroactively by this one");
      assert.equal(ADMISSION_RULES["0.1"].collidesWithAuthorityIdentity("issuer:future"), false);
      assert.equal(ADMISSION_RULES["0.2"].collidesWithAuthorityIdentity("issuer-future"), false);
    } finally {
      (ASSETS as Asset[]).pop();
    }
    assert.equal(ASSETS.some((a) => a.authorityId === "issuer:future"), false);
  });

  test("the 0.1 stems and namespaces are literals of the 0.1 rule, not the vocabulary lists: editing a list cannot reinterpret 0.1", () => {
    assert.ok(Object.isFrozen(RESERVED_IDENTITY_STEMS) && Object.isFrozen(RESERVED_POLICY_NAMESPACES));
    assert.equal(isReservedIdentity("wallet-wall"), true);
    assert.equal(isReservedPolicyId("wwap/x"), true);
  });

  test("an unsupported version is refused when building, as an input problem", () => {
    assert.throws(
      () => buildWallPrintSnapshot({ ...baseInput(), wallprintVersion: "0.3" } as never),
      (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_INPUT" && e.findings.some((f) => f.path === "wallprintVersion"),
    );
  });
});

describe("one admission table, two versions: 0.2 changes exactly the 0.1 known gaps", () => {
  test("the table has both kinds of row, so 'exactly' has two sides", () => {
    const gaps = ADMISSION_CASES.filter((c) => c.v01 === ADMIT && c.why.startsWith("known gap"));
    assert.ok(gaps.length > 40);
    assert.ok(ADMISSION_CASES.filter((c) => c.v01 === ADMIT && !c.why.startsWith("known gap")).length > 40, "near misses that stay admitted");
  });

  for (const c of ADMISSION_CASES) {
    test(`${c.family}: ${c.role} ${JSON.stringify(c.assessor)} under ${JSON.stringify(c.policy)}`, () => {
      assert.deepEqual(outcomeOf(c, "0.1"), c.v01, "0.1 is as characterized");
      assert.deepEqual(outcomeOf(c, "0.2"), expected02(c), "0.2 is 0.1 except for the known gaps");
    });
  }
});

describe("the model: fold, words, skeleton", () => {
  test("fold is ASCII A-Z only: no Unicode normalization, no confusable folding", () => {
    assert.equal(foldIdentity("WalletWALL-1"), "walletwall-1");
    for (const s of ["\u0130", "\u017f", "\u212a", "\u00c0\u00c9", "\uff57alletwall"]) assert.equal(foldIdentity(s), s, "non-ASCII is left exactly as it is");
    assert.equal(readsAsReservedIdentity("\uff57alletwall"), false, "a fullwidth look-alike is not folded to a stem");
    assert.equal(readsAsReservedIdentity("wa11et-wall"), false, "a digit for a letter is not folded either");
  });

  test("words split on . _ : - / runs; the skeleton joins them", () => {
    assert.deepEqual(identityWords("Wallet--Wall.._x/Y"), ["wallet", "wall", "x", "y"]);
    assert.deepEqual(identityWords("-_-"), []);
    assert.equal(identitySkeleton("Issuer:Circle"), "issuercircle");
    for (const s of ["issuer:circle", "issuer-circle", "issuer_circle", "issuer.circle", "ISSUER--CIRCLE", "issuer-:circle", "issuercircle"]) assert.equal(identitySkeleton(s), "issuercircle", s);
    for (const s of ["issuer:circle2", "circle", "issuer", "issuer:circle-labs"]) assert.notEqual(identitySkeleton(s), "issuercircle", s);
  });

  test("the model never rewrites what was supplied: the admitted assessor is recorded exactly as stated", () => {
    for (const assessor of ["Reviewer.Y", "REVIEWER_Y", "reviewer:y", "Reviewer--Y"]) {
      const supplied = reviewerAssessment({ assessor, policy: "p-asis" });
      const record = buildWallPrintSnapshot(baseInput({ assessments: [supplied] }));
      const stored = record.assessments.find((a) => a.policy === "p-asis");
      assert.equal(stored?.assessor, assessor, "stored as supplied, not folded and not skeletonized");
      assert.equal(stored?.policy, "p-asis");
    }
    const a = buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment({ assessor: "reviewer-y" })] }));
    const b = buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment({ assessor: "Reviewer.Y" })] }));
    assert.notEqual(a.digest, b.digest, "two spellings are two assessors: nothing folds them into one");
    const both = buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment({ assessor: "reviewer-y" }), reviewerAssessment({ assessor: "reviewer.y" })] }));
    assert.equal(both.assessments.filter((x) => x.assessorRole === "INDEPENDENT_REVIEWER").length, 2, "spelling variants of one name stay separate attributions, never merged and never a count of parties");
  });

  test("the input is never mutated by admission, accepted or refused", () => {
    const refused = [reviewerAssessment({ assessor: "issuer-circle" })];
    const frozen = structuredClone(refused);
    assert.throws(() => buildWallPrintSnapshot(baseInput({ assessments: refused, wallprintVersion: "0.2" })));
    assert.deepEqual(refused, frozen);
  });
});

describe("the documented limits of 0.2 are pinned, not accidents", () => {
  const residual = ["wallet-wallofficial", "officialwalletwall", "thewalletwall", "wa11et-wall", "wallet-wallpaper", "print-wall", "wall-printers", "wall-e", "firewall-print-shop", "stonewall"];
  for (const id of residual) {
    test(`${id} stays admissible as an assessor under 0.2 (a stem buried in or ending inside a word, a homoglyph, or the wrong order)`, () => {
      assert.equal(readsAsReservedIdentity(id), false);
      const record = buildWallPrintSnapshot(baseInput({ assessments: [reviewerAssessment({ assessor: id })], wallprintVersion: "0.2" }));
      assert.equal(record.assessments.some((a) => a.assessor === id), true);
    });
  }
  test("a decorated authority is not the authority (no decoration for authority identities), and 'none' is not an authority", () => {
    for (const id of ["issuer:circle2", "issuer:circle-labs", "circle", "none", "issuer", "tether", "chain-state"]) {
      assert.equal(ADMISSION_RULES["0.2"].collidesWithAuthorityIdentity(id), false, id);
    }
  });
  test("a word that begins with a stem is refused even when innocent: the documented cost of closing 'walletwallofficial'", () => {
    for (const id of ["wallprinters", "wallprints", "walletwallofficial", "walletwallpapers"]) assert.equal(readsAsReservedIdentity(id), true, id);
  });
  test("a policy that merely mentions a WalletWall name later in its id is the assessor's own policy", () => {
    for (const id of ["acme/walletwall-review", "acme/wwap/x", "reviewer-y-wwdr", "firewall-print-shop/x"]) assert.equal(inReservedPolicyNamespace(id), false, id);
  });
});

// ─── seeded properties ───────────────────────────────────────────────────────

describe("properties over a seeded sample of spellings (separator, case, suffix, namespace decoration)", () => {
  const N = 6000;
  const rand = prng(0x5eed_0002);
  const ids = Array.from({ length: N }, () => sample(rand, SEPS_ID));
  const policies = Array.from({ length: N }, () => sample(rand, SEPS_POLICY));

  test("0.2 is strictly stricter than 0.1: whatever 0.1 refuses, 0.2 refuses (identity, policy namespace and authority)", () => {
    let widened = 0;
    for (const s of ids) {
      if (ADMISSION_RULES["0.1"].readsAsReservedIdentity(s) && !ADMISSION_RULES["0.2"].readsAsReservedIdentity(s)) assert.fail(`identity ${s}`);
      if (ADMISSION_RULES["0.1"].collidesWithAuthorityIdentity(s) && !ADMISSION_RULES["0.2"].collidesWithAuthorityIdentity(s)) assert.fail(`authority ${s}`);
      if (ADMISSION_RULES["0.2"].readsAsReservedIdentity(s) && !ADMISSION_RULES["0.1"].readsAsReservedIdentity(s)) widened++;
    }
    for (const s of policies) {
      if (ADMISSION_RULES["0.1"].inReservedPolicyNamespace(s) && !ADMISSION_RULES["0.2"].inReservedPolicyNamespace(s)) assert.fail(`policy ${s}`);
      if (ADMISSION_RULES["0.2"].inReservedPolicyNamespace(s) && !ADMISSION_RULES["0.1"].inReservedPolicyNamespace(s)) widened++;
    }
    assert.ok(widened > 50, "the sample actually exercises the spellings 0.2 closes");
  });

  test("0.2 is invariant under letter case and under swapping one separator for another; 0.1 is not (that is the gap)", () => {
    const swap = (s: string, seps: readonly string[], r: () => number): string => s.replace(/[._:/-]/g, () => seps[Math.floor(r() * seps.length)] as string);
    const r = prng(7);
    for (const s of ids) {
      const t = swap(s, SEPS_ID, r);
      const cased = r() < 0.5 ? t.toUpperCase() : t.toLowerCase();
      for (const f of [readsAsReservedIdentity, (x: string) => ADMISSION_RULES["0.2"].collidesWithAuthorityIdentity(x)]) assert.equal(f(s), f(cased), `${s} vs ${cased}`);
    }
    for (const s of policies) {
      const t = swap(s, SEPS_POLICY, r);
      assert.equal(inReservedPolicyNamespace(s), inReservedPolicyNamespace(r() < 0.5 ? t.toUpperCase() : t), s);
    }
    assert.equal(ADMISSION_RULES["0.1"].collidesWithAuthorityIdentity("issuer:circle"), true);
    assert.equal(ADMISSION_RULES["0.1"].collidesWithAuthorityIdentity("issuer-circle"), false, "0.1 is not separator-invariant for authorities");
    assert.equal(ADMISSION_RULES["0.2"].collidesWithAuthorityIdentity("issuer-circle"), true);
  });

  test("a reserved reading survives decoration with whole extra words on either side, as 0.1 already held", () => {
    const r = prng(11);
    for (let i = 0; i < 2000; i++) {
      const stem = (["wallet-wall", "wall.print", "walletwall", "wallprint", "Wallet_Wall", "WALL:PRINT"] as const)[Math.floor(r() * 6)] as string;
      const decorated = `${sample(r, SEPS_ID)}-${stem}-${sample(r, SEPS_ID)}`;
      assert.equal(readsAsReservedIdentity(decorated), true, decorated);
      assert.equal(isReservedIdentity(decorated), true, decorated);
    }
  });

  test("a stem is never found inside a word the assessor wrote as one: vocabularies of harmless words are never reserved, whatever the separators", () => {
    const harmless = ["fire", "firewall", "stone", "stonewall", "wallpaper", "print", "printer", "wallet", "wallets", "wallace", "walnut", "api", "acme", "reviewer"];
    const r = prng(13);
    for (let i = 0; i < 4000; i++) {
      const n = 1 + Math.floor(r() * 4);
      const s = Array.from({ length: n }, () => harmless[Math.floor(r() * harmless.length)] as string).join(SEPS_ID[Math.floor(r() * 4)]);
      assert.equal(readsAsReservedIdentity(s), false, s);
    }
  });
});

// ─── cross-version: a historical 0.1 record under the new engine ─────────────

interface Corpus {
  input: Omit<SnapshotInput, "bundle">;
  record: WallPrintRecord;
}
const corpus = JSON.parse(readFileSync(new URL("./fixtures/wallprint-0.1-admission-gaps.json", import.meta.url), "utf8")) as Corpus;
const CORPUS_DIGEST = "6d4a1304a9e904a8b097bce63e44dcef1e6a4df0c671955ea22ea183e712f25c";

/** The same payload under another contract version, honestly re-digested: what a record "committed under 0.2" with these assessors would be. */
function relabelled(record: WallPrintRecord, version: WallPrintVersion): WallPrintRecord {
  const payload = { ...structuredClone(wallPrintPayload(record)), wallprintVersion: version };
  return { ...payload, digest: wallPrintDigest(payload) };
}

describe("historical 0.1 records keep their meaning under the engine that also reads 0.2", () => {
  test("the committed corpus record is byte-for-byte what 0.1 produced: its digest is the one recorded before 0.2 existed", () => {
    assert.equal(corpus.record.digest, CORPUS_DIGEST);
    assert.equal(corpus.record.wallprintVersion, "0.1");
    assert.deepEqual(verifyWallPrintDigest(corpus.record), { hasDigest: true, matches: true, computedDigest: CORPUS_DIGEST });
    const rebuilt = buildWallPrintSnapshot({ ...corpus.input, bundle: golden(), wallprintVersion: "0.1" });
    assert.equal(canonicalize(rebuilt), canonicalize(corpus.record));
  });

  test("it stays valid under 0.1, with every assessor and policy the 0.2 rules refuse still in it as stated", () => {
    assert.equal(validateWallPrintRecord(corpus.record).ok, true);
    const stated = new Set(corpus.record.assessments.flatMap((a) => [a.assessor, a.policy]));
    for (const s of ["issuer-circle", "issuer_circle", "canonical-chain-state", "walletwallprint", "walletwall2", "walletwall-policy", "wwap2", "ww-ap/review"]) assert.ok(stated.has(s), s);
  });

  test("the same assessments are refused when a NEW record is built under 0.2, and admitted when built under 0.1", () => {
    const externals = corpus.input.assessments ?? [];
    assert.doesNotThrow(() => buildWallPrintSnapshot({ ...corpus.input, bundle: golden(), wallprintVersion: "0.1" }));
    assert.doesNotThrow(() => buildWallPrintSnapshot({ ...corpus.input, bundle: golden(), assessments: externals.filter((a) => ["issuer:circle", "firewall-print-shop"].includes(a.assessor)), wallprintVersion: "0.2" }));
    try {
      buildWallPrintSnapshot({ ...corpus.input, bundle: golden(), wallprintVersion: "0.2" });
      assert.fail("0.2 must refuse the gap spellings");
    } catch (e) {
      assert.ok(e instanceof WallPrintError && e.code === "INVALID_RECORD");
      const refusedAt = new Set(e.findings.map((f) => `${f.code}:${f.path}`));
      const index = (assessor: string): number => externals.findIndex((a) => a.assessor === assessor);
      for (const [assessor, field, code] of [
        ["issuer-circle", "assessor", "ASSESSOR_IDENTITY_RESERVED"],
        ["issuer_circle", "assessor", "ASSESSOR_IDENTITY_RESERVED"],
        ["canonical-chain-state", "assessor", "ASSESSOR_IDENTITY_RESERVED"],
        ["walletwallprint", "assessor", "ASSESSOR_IDENTITY_RESERVED"],
        ["walletwall2", "assessor", "ASSESSOR_IDENTITY_RESERVED"],
        ["reviewer-z", "policy", "RESERVED_POLICY_NAMESPACE"],
        ["reviewer-w", "policy", "RESERVED_POLICY_NAMESPACE"],
        ["reviewer-v", "policy", "RESERVED_POLICY_NAMESPACE"],
      ] as const) assert.ok(refusedAt.has(`${code}:assessments[${index(assessor)}].${field}`), `${assessor} ${field}`);
      assert.ok(![...refusedAt].some((k) => k.includes(`assessments[${index("firewall-print-shop")}]`) || k.includes(`assessments[${index("issuer:circle")}]`)), "the legitimate near miss and the registry ISSUER are not refused");
    }
  });

  test("relabelling the same payload as 0.2 is a different record that 0.2 refuses; relabelling without re-digesting is a digest mismatch", () => {
    const asNew = validateWallPrintRecord(relabelled(corpus.record, "0.2"));
    assert.equal(asNew.ok, false);
    assert.ok(!asNew.ok && asNew.findings.some((f) => f.code === "ASSESSOR_IDENTITY_RESERVED") && asNew.findings.some((f) => f.code === "RESERVED_POLICY_NAMESPACE"));
    assert.notEqual(relabelled(corpus.record, "0.2").digest, corpus.record.digest, "the version is digest-covered");
    const lazy = validateWallPrintRecord({ ...corpus.record, wallprintVersion: "0.2" });
    assert.ok(!lazy.ok && lazy.findings.some((f) => f.code === "DIGEST_MISMATCH"));
    assert.equal(validateWallPrintRecord(corpus.record).ok, true, "the original is untouched by judging a relabelled copy");
  });

  test("replay rebuilds a 0.1 record under 0.1: REPRODUCED with the digest it was committed with, never REBUILD_REFUSED by a stricter version", () => {
    const evidence = createEvidenceStore();
    evidence.put(golden());
    const result = replayWallPrint(corpus.record, { evidence });
    assert.deepEqual({ ...result }, { outcome: "REPRODUCED", reasons: [], recomputedDigest: CORPUS_DIGEST, mismatches: [] });
    const gone = replayWallPrint(corpus.record, { evidence: createEvidenceStore() });
    assert.equal(gone.outcome, "UNREPLAYABLE");
    assert.deepEqual(gone.reasons, ["MISSING_EVIDENCE"], "unreplayable for the evidence it lacks, not for the admission rules of another version");
  });

  test("the receipt of a historical record is digest-based and unchanged: it names 0.1, verifies, and fails against any other record", () => {
    const receipt = wallPrintReceipt(corpus.record);
    assert.equal(receipt.wallprintVersion, "0.1");
    assert.equal(receipt.digest, CORPUS_DIGEST);
    assert.deepEqual(verifyReceipt(receipt, corpus.record), { matches: true, reasons: [] });
    const current = buildWallPrintSnapshot(baseInput({ id: corpus.record.id, assessments: [] }));
    assert.equal(wallPrintReceipt(current).wallprintVersion, "0.2");
    assert.deepEqual(verifyReceipt(receipt, current), { matches: false, reasons: ["DIGEST_MISMATCH", "VERSION_MISMATCH"] });
    const versionOnly = { ...receipt, wallprintVersion: "0.2" as const };
    assert.deepEqual(verifyReceipt(versionOnly, corpus.record), { matches: false, reasons: ["VERSION_MISMATCH"] }, "a receipt that names the wrong version of a record it otherwise matches is not a match");
  });

  test("a portable reference keeps the version it names, in every form, and resolves whichever version its record was committed under", () => {
    const current = buildWallPrintSnapshot(baseInput({ id: "wp-current-ref" }));
    for (const record of [corpus.record, current]) {
      const ref = referenceOf(record);
      assert.equal(ref.wallprintVersion, record.wallprintVersion);
      const text = encodeReference(ref);
      assert.ok(text.includes(`&wallprint=${record.wallprintVersion}&`));
      const parsed = parseReference(text);
      assert.ok(parsed.ok && parsed.reference.wallprintVersion === record.wallprintVersion && parsed.reference.digest === record.digest);
      const env = parseReference(encodeReferenceEnvelope(referenceOf(record, "receipt")));
      assert.ok(env.ok && env.reference.wallprintVersion === record.wallprintVersion && env.reference.target === "receipt");
      for (const t of REFERENCE_TARGETS) assert.ok(parseReference(encodeReference(referenceOf(record, t))).ok);
      const found = { recordId: record.id, embeddedDigest: record.digest, computedDigest: verifyWallPrintDigest(record).computedDigest };
      assert.equal(resolveReference(ref, found).outcome, "RESOLVED");
    }
    const asked = referenceOf(corpus.record);
    const ofCurrent = { recordId: corpus.record.id, embeddedDigest: current.digest, computedDigest: current.digest };
    assert.equal(resolveReference(asked, ofCurrent).outcome, "DIGEST_MISMATCH", "a 0.1 reference never resolves to a 0.2 record under the same id: the digests differ and nothing is guessed");
    assert.equal(parseReference(encodeReference(asked).replace("wallprint=0.1", "wallprint=0.3")).ok, false);
  });

  test("diffing a 0.1 record against a 0.2 record never fabricates equivalence, even when nothing else differs", () => {
    const base = buildWallPrintSnapshot(baseInput({ id: "wp-same-content", assessments: [], wallprintVersion: "0.1" }));
    const next = buildWallPrintSnapshot(baseInput({ id: "wp-same-content", assessments: [], wallprintVersion: "0.2" }));
    const diff = diffWallPrints(base, next);
    assert.equal(diff.changed, true);
    assert.deepEqual(diff.changes.map((c) => `${c.category}:${c.path}`), ["record:digest", "record:wallprintVersion"]);
    const v = diff.changes.find((c) => c.path === "wallprintVersion");
    assert.deepEqual([v?.before, v?.after], ["0.1", "0.2"]);
    assert.deepEqual(diffWallPrints(base, base), { changed: false, changes: [] }, "same version, same content: still no change");
  });

  test("history is append-only across versions: a 0.2 correction supersedes a 0.1 record, the 0.1 record is untouched and stays addressable", () => {
    const h = createWallPrintHistory();
    h.commit(corpus.record, { at: COMMIT_AT });
    const successor = buildWallPrintSnapshot(baseInput({ id: "wp-historical-0-1-gaps-v2", evaluatedAt: LATER_SNAPSHOT_AT, assessments: [issuerAssessment(), reviewerAssessment({ assessor: "firewall-print-shop", policy: "near-miss-review" })], supersedes: { id: corpus.record.id, digest: corpus.record.digest, kind: "CORRECTION", reason: "Re-stated under the current admission rules." } }));
    assert.equal(successor.wallprintVersion, "0.2");
    h.commit(successor, { at: LATER_AT });
    assert.equal(h.get(corpus.record.id)?.digest, CORPUS_DIGEST, "the predecessor's committed bytes are exactly what they were");
    assert.equal(h.get(corpus.record.id)?.wallprintVersion, "0.1");
    assert.equal(h.view(corpus.record.id)?.lifecycle.state, "CORRECTED");
    assert.equal(h.view(successor.id)?.supersedes?.digest, CORPUS_DIGEST);
    const diff = diffWallPrints(corpus.record, successor);
    assert.ok(diff.changes.some((c) => c.category === "record" && c.path === "wallprintVersion"));
    assert.ok(diff.changes.some((c) => c.category === "assessments"), "the assessor changes are named, not hidden by the version change");
  });
});
