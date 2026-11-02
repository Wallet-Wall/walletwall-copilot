import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ATTESTATION_INVARIANTS,
  ATTESTATION_LIMITS,
  ATTESTATION_PURPOSES,
  ATTESTATION_VERSION,
  BINDING_METHODS,
  DOMAIN_TAGS,
  KEY_REGISTRY_FORMAT_VERSION,
  KEY_STATUSES,
  ORIGINS,
  SIGNER_KINDS,
  SUPPORTED_ALGORITHMS,
  TARGET_KINDS,
  VERIFICATION_LIMITATIONS,
} from "../../src/wallprint/attestation-vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { vectorSpecs } from "../support/wallprint-attestations.ts";

/**
 * Structural guard for spec/WALLPRINT_ATTESTATIONS.md: the sections the design lane was asked to define, the exact names
 * the verifier uses, the boundary statements, and the modules, tests and vectors it points at. The repository's
 * public-claims scan (public-release.test.ts) already covers prohibited wording for every spec/*.md file.
 */
const DOC = "spec/WALLPRINT_ATTESTATIONS.md";
const doc = readFileSync(`${ROOT}${DOC}`, "utf8").replace(/\r\n/g, "\n");
const flat = doc.replace(/\s+/g, " ");

describe("WallPrint attestations specification", () => {
  test("defines every required section", () => {
    for (const heading of [
      "## 1. The question, and the short answer",
      "## 2. What WallPrint proves today (the inventory)",
      "## 3. Goals and non-goals",
      "## 4. Objects",
      "## 5. What gets signed",
      "## 6. The three signing uses",
      "## 7. The statement, the envelope and the exact signed bytes",
      "## 8. The signing-key registry",
      "## 9. Rotation",
      "## 10. Revocation and compromise",
      "## 11. Historical verification and replay",
      "## 12. The verification result",
      "## 13. Algorithm policy",
      "## 14. The post-quantum boundary",
      "## 15. Interaction with receipts, references, the resolver, import, lifecycle",
      "## 16. Publication and storage (design; nothing is published by this lane)",
      "## 17. Threat model",
      "## 18. Versioning",
      "## 19. The prototype and the vectors",
      "## 20. Stop conditions, evaluated",
      "## 21. Unresolved design risks and follow-ups",
      "## 22. Decision record",
    ]) assert.ok(doc.includes(heading), heading);
  });

  test("states the distinctions that never collapse, verbatim, and the two this lane adds", () => {
    for (const inv of ATTESTATION_INVARIANTS) assert.ok(doc.includes(inv), inv);
    assert.ok(flat.includes("the holder of the private key for a particular public key signed exactly these bytes"));
    assert.ok(flat.includes("**No signature system is shipped by this lane.**"));
    assert.ok(flat.includes("There is no `verified` flag."));
  });

  test("names every purpose, target kind, signer kind, status, binding method, origin level, algorithm and domain tag the verifier uses", () => {
    for (const name of [...ATTESTATION_PURPOSES, ...TARGET_KINDS, ...SIGNER_KINDS, ...KEY_STATUSES, ...BINDING_METHODS, ...ORIGINS.filter((o) => o !== "NONE"), ...SUPPORTED_ALGORITHMS]) {
      assert.ok(doc.includes(`\`${name}\``), name);
    }
    assert.ok(doc.includes("`NONE`"));
    for (const tag of Object.values(DOMAIN_TAGS)) assert.ok(doc.includes(`\`${tag}\``), tag);
    assert.ok(doc.includes("UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))"));
    for (const code of VERIFICATION_LIMITATIONS) assert.ok(doc.includes(code), code);
    assert.ok(doc.includes(`"attestationVersion": "${ATTESTATION_VERSION}"`) && doc.includes(`"formatVersion": "${KEY_REGISTRY_FORMAT_VERSION}"`));
    assert.ok(flat.includes(`${ATTESTATION_LIMITS.maxEnvelopeBytes / 1024} KiB`));
  });

  test("answers the questions it was asked: no timestamp, detached not in-record, separate registry, rotation without the old key, compromise is policy over a valid signature", () => {
    for (const s of [
      "There is no `signedAt`",
      "A signature field in the canonical record would be circular",
      "WallPrint stays `0.2`",
      "Separate from the evidence registry, on purpose.",
      "The previous key does not sign the new key.",
      "a valid historical signature from a later-compromised key remains **cryptographically valid**",
      "Revocation latency is real.",
      "An anchor protects the past, not the future",
      "No issuer publishes a WallPrint signing key today",
      "Is it useful beyond the digest",
      "Ed25519, fixed for attestation format 0.1",
      "UNREPLAYABLE != INCORRECT",
    ]) assert.ok(flat.includes(s), s);
    for (const option of ["| 1. Record digest |", "| 2. An individual assessment digest |", "| 3. A separate typed statement |", "| 4. Combination |"]) assert.ok(doc.includes(option), option);
    for (const t of Array.from({ length: 25 }, (_, i) => `| T${i + 1} |`)) assert.ok(doc.includes(t), t);
  });

  test("keeps the contract versions it does not move", () => {
    assert.ok(flat.includes("WallPrint stays `0.2`"));
    for (const s of ["The record shape, canonical form, digest, receipt, reference grammar, lifecycle table and admission rules are unchanged", "no contract bump is justified"]) assert.ok(flat.includes(s), s);
  });

  test("every vector it cites exists in the committed file, and the file names the cases the design required", () => {
    const ids = new Set(vectorSpecs().map((v) => v.id));
    for (const cited of doc.match(/`\d{2}[a-e]?-[a-z0-9-]+`/g) ?? []) assert.ok(ids.has(cited.slice(1, -1)), cited);
    const file = JSON.parse(readFileSync(`${ROOT}packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json`, "utf8")) as { vectors: { id: string }[] };
    assert.deepEqual(file.vectors.map((v) => v.id), vectorSpecs().map((v) => v.id));
  });

  test("the modules, tests, fixtures and scripts it names exist", () => {
    for (const p of [
      "packages/mcp/src/wallprint/attestation-vocabulary.ts",
      "packages/mcp/src/wallprint/attestation.ts",
      "packages/mcp/src/wallprint/key-registry.ts",
      "packages/mcp/src/wallprint/ed25519.ts",
      "packages/mcp/src/wallprint/attestation-verify.ts",
      "packages/mcp/src/wallprint/acceptance-ledger.ts",
      "packages/mcp/test/wallprint/acceptance-ledger.test.ts",
      "packages/mcp/test/wallprint/attestation-ed25519.test.ts",
      "packages/mcp/test/wallprint/attestation.test.ts",
      "packages/mcp/test/wallprint/key-registry.test.ts",
      "packages/mcp/test/wallprint/attestation-verify.test.ts",
      "packages/mcp/test/wallprint/attestation-isolation.test.ts",
      "packages/mcp/test/wallprint/attestation-spec-doc.test.ts",
      "packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json",
      "scripts/gen-wallprint-attestation-vectors.ts",
    ]) {
      assert.ok(existsSync(`${ROOT}${p}`), p);
      assert.ok(doc.includes(p.split("/").pop() ?? p) || p.endsWith("fixtures/wallprint-attestation-vectors-0.1.json") || p.endsWith("attestation-spec-doc.test.ts") || p.endsWith("attestation-vocabulary.ts") || p.endsWith("gen-wallprint-attestation-vectors.ts"), p);
    }
  });

  test("is cited from the WallPrint contract and the resolver document, which still say no signature system exists", () => {
    const wallprint = readFileSync(`${ROOT}spec/WALLPRINT.md`, "utf8").replace(/\s+/g, " ");
    const resolver = readFileSync(`${ROOT}docs/WALLPRINT_PUBLIC_RESOLVER.md`, "utf8").replace(/\s+/g, " ");
    assert.ok(wallprint.includes("WALLPRINT_ATTESTATIONS.md") && /no signature system/.test(wallprint) && /nothing signs a record/.test(wallprint));
    assert.ok(resolver.includes("spec/WALLPRINT_ATTESTATIONS.md") && /no signature, no key/.test(resolver));
  });

  test("uses no generic assurance claim for itself: it names the dimension each time, and never certifies", () => {
    assert.ok(!/\bWallPrint verified\b|\bissuer verified\b|\btrusted record\b/i.test(flat));
    assert.ok(flat.includes("Never a generic green \"Verified\" badge"));
  });
});
