import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { scanCeremonyFile, scanCeremonyJson, scanCeremonyText } from "../../src/wallprint/governance-secret-scan.ts";
import { SECRET_SCAN_CODES } from "../../src/wallprint/governance-vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { rehearse } from "../support/wallprint-governance.ts";

/**
 * The secret scanner: narrow, named patterns for secret-looking material in ceremony outputs, fixtures and documents. A tripwire, not a proof,
 * and a scanner that can never itself be the leak: a finding is a code and a position, never the matched text.
 */
const PEM = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
const PEM_ENCRYPTED = ["-----BEGIN ENCRYPTED ", "PRIVATE KEY-----"].join("");
const PEM_OPENSSH = ["-----BEGIN OPENSSH ", "PRIVATE KEY-----"].join("");
const PKCS8_HEX = ["302e0201", "00300506032b6570", "04220420"].join("");
const PKCS8_B64 = ["MC4CAQAw", "BQYDK2Vw", "BCIEI"].join("");
const AGE = ["AGE-SECRET-KEY-1", "QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"].join("");
const SEED_HEX = "a1".repeat(32);
const codes = (findings: ReturnType<typeof scanCeremonyText>): string[] => findings.map((f) => f.code);

describe("secret scan: what it catches", () => {
  test("a PEM private-key header of any kind: plain, encrypted, OpenSSH, PGP", () => {
    for (const header of [PEM, PEM_ENCRYPTED, PEM_OPENSSH, ["-----BEGIN PGP ", "PRIVATE KEY BLOCK-----"].join(""), ["-----BEGIN RSA ", "PRIVATE KEY-----"].join("")]) assert.deepEqual(codes(scanCeremonyText(`before\n${header}\nafter`)), ["PEM_PRIVATE_KEY_BLOCK"], header);
    assert.deepEqual(scanCeremonyText(`ok\nok\n${PEM}`), [{ code: "PEM_PRIVATE_KEY_BLOCK", at: "line 3" }]);
  });

  test("the Ed25519 PKCS#8 header, in hex and in base64: the raw private-key fixture shape", () => {
    assert.deepEqual(codes(scanCeremonyText(`key = ${PKCS8_HEX}${"ab".repeat(32)}`)), ["PKCS8_ED25519_HEADER"]);
    assert.deepEqual(codes(scanCeremonyText(`${PKCS8_B64}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)), ["PKCS8_ED25519_HEADER"]);
  });

  test("an age secret key, a 64-hex value beside a secret word, and a seed phrase", () => {
    assert.deepEqual(codes(scanCeremonyText(AGE)), ["AGE_SECRET_IDENTITY"]);
    for (const line of [`seed ${SEED_HEX}`, `the private key is ${SEED_HEX}`, `private_key=${SEED_HEX}`, `entropy: ${SEED_HEX}`, `signing key ${SEED_HEX}`]) assert.ok(codes(scanCeremonyText(line)).includes("SEED_HEX_NEAR_SECRET_WORD"), line);
    assert.ok(codes(scanCeremonyText("seed phrase: abandon ability able about above absent absorb abstract absurd abuse access accident")).includes("SEED_PHRASE_SHAPE"));
    assert.ok(codes(scanCeremonyText("recovery phrase = abandon ability able about above absent absorb abstract absurd abuse access accident")).includes("SEED_PHRASE_SHAPE"));
  });

  test("an environment-secret name and a CI secret reference", () => {
    for (const line of ["export WALLETWALL_ROOT_KEY=abc", "GOVERNANCE_SIGNING_KEY: x", "CHECKPOINT_SEED=1", "PRIVATE_KEY=x", "SIGNING_KEY", "env: { WALLPRINT_GOVERNANCE_PASSPHRASE: x }", "MNEMONIC"]) assert.ok(codes(scanCeremonyText(line)).includes("ENV_SECRET_NAME"), line);
    assert.deepEqual(codes(scanCeremonyText("token: ${{ secrets.SIGNING }}")).includes("CI_SECRET_REFERENCE"), true);
  });

  test("a secret-bearing assignment: a private key, secret key, seed phrase, passphrase or entropy given a value", () => {
    for (const line of ['"privateKey": "abcdefgh12345678"', "secret_key = abcdefgh12345678", "passphrase: correcthorsebattery", "mnemonic=abandonabilityable", "entropy = 00112233445566778899"]) assert.ok(codes(scanCeremonyText(line)).includes("SECRET_VALUE_ASSIGNMENT"), line);
  });

  test("a JSON file: every field name that could hold a secret, at every depth, and every string value", () => {
    for (const field of ["privateKey", "private_key", "PrivateSeed", "secretKey", "seed", "seedPhrase", "mnemonic", "passphrase", "password", "entropy", "signing-key", "backupBlob", "encryptedKey", "recoveryPhrase", "d"]) {
      const shown = /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(field) ? field : "[key 0]";
      assert.deepEqual(scanCeremonyJson({ a: { b: [{ [field]: "x" }] } }), [{ code: "SECRET_FIELD_NAME", at: `a.b[0].${shown}` }], field);
    }
    assert.deepEqual(scanCeremonyJson({ note: PEM }), [{ code: "PEM_PRIVATE_KEY_BLOCK", at: "note" }]);
    assert.deepEqual(scanCeremonyJson({ list: ["abandon ability able about above absent absorb abstract absurd abuse access accident"] }), [{ code: "SEED_PHRASE_SHAPE", at: "list[0]" }]);
    assert.deepEqual(scanCeremonyFile("x.json", JSON.stringify({ privateKey: "x" })).map((f) => f.code), ["SECRET_VALUE_ASSIGNMENT", "SECRET_FIELD_NAME"].filter((c) => c === "SECRET_FIELD_NAME" || scanCeremonyText(JSON.stringify({ privateKey: "x" })).length > 0));
  });

  test("a value too deep to scan is reported, not passed: nesting beyond the walker's depth fails closed, in an object and in a file", () => {
    let nested: unknown = { seed: "x" };
    for (let i = 0; i < 20; i++) nested = { level: nested };
    assert.deepEqual(codes(scanCeremonyJson(nested)), ["SCAN_DEPTH_EXCEEDED"]);
    assert.deepEqual(codes(scanCeremonyFile("x.json", JSON.stringify(nested))), ["SCAN_DEPTH_EXCEEDED"]);
    let shallow: unknown = { seed: "x" };
    for (let i = 0; i < 10; i++) shallow = { level: shallow };
    assert.deepEqual(codes(scanCeremonyJson(shallow)), ["SECRET_FIELD_NAME"], "within the depth the field is still found");
  });

  test("a secret used as a field name is not echoed back in the finding's path: only short identifiers are shown, anything else is a position", () => {
    const asKey = "f".repeat(64);
    const findings = scanCeremonyJson({ [asKey]: { seed: "x" }, ok: { "weird key with spaces": { password: "y" } } });
    const text = JSON.stringify(findings);
    assert.ok(!text.includes(asKey));
    assert.ok(!text.includes("weird key"));
    assert.deepEqual(findings.map((f) => f.at), ["[key 0].seed", "ok.[key 0].password"]);
  });

  test("a hostile JSON file cannot hide behind a parse failure: a repeated key falls back to the text rules", () => {
    const text = `{"a": 1, "a": 2, "note": "${PEM}"}`;
    assert.ok(codes(scanCeremonyFile("x.json", text)).includes("PEM_PRIVATE_KEY_BLOCK"));
    assert.deepEqual(scanCeremonyFile("x.json", `{"seed": "x", "seed": "y"}`).map((f) => f.code).includes("SECRET_FIELD_NAME"), false, "a repeated key is not parsed as JSON; only the text rules run");
  });

  test("the codes are the declared vocabulary: every rule reports a declared code, and every declared code has a case here", () => {
    const seen = new Set([
      ...scanCeremonyText([PEM, PKCS8_HEX, AGE, `seed ${SEED_HEX}`, "export WALLETWALL_ROOT_KEY=abc", "${{ secrets.X }}", "privateKey: abcdefgh12345678", "mnemonic: abandon ability able about above absent absorb abstract absurd abuse access accident"].join("\n")).map((f) => f.code),
      ...scanCeremonyJson({ seed: "x" }).map((f) => f.code),
      ...scanCeremonyJson({ a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: 1 } } } } } } } } } } } } } } } } } }).map((f) => f.code),
    ]);
    assert.deepEqual([...seen].sort(), [...SECRET_SCAN_CODES].sort());
  });
});

describe("secret scan: what it must not flag, and what it must not leak", () => {
  test("ordinary ceremony text, public keys and digests are not secrets, even though they are 64 hex characters", () => {
    const public64 = "05aa683dbc70c4b02595d74628c55512b6027cfbd85080826b1d96628d2f72c3";
    for (const line of [
      `root public key ${public64}`,
      `fingerprint ${public64.match(/.{8}/g)?.join("-")}`,
      `"publicKey": "${public64}"`,
      `"bootstrapDigest": "${public64}"`,
      "CHECKPOINT_KEY_AUTHORIZATION, REGISTRY_LEDGER_CHECKPOINT, ROOT_PUBLIC_KEY_RECORDED, OPERATIONAL_KEY_DISTINCT_FROM_ROOT, PASSPHRASE_STORED_APART_FROM_MEDIA",
      "The operator records the public key and the witness compares the fingerprint aloud.",
      "seedLabel: SYNTHETIC-NON-PRODUCTION-KEY-041",
      "no seed, no private key, no passphrase is ever written here",
      "SYNTHETIC / NON-PRODUCTION",
    ]) assert.deepEqual(scanCeremonyText(line), [], line);
    assert.deepEqual(scanCeremonyJson({ publicKey: public64, bootstrapDigest: public64, seedLabel: "SYNTHETIC-NON-PRODUCTION-KEY-041", keyId: "synthetic-governance-root-001" }), []);
  });

  test("a finding is a code and a position and never the matched text: nothing the scanner returns contains the secret", () => {
    const secret = `${SEED_HEX}`;
    const text = `line one\nseed ${secret}\n${PEM}\n"passphrase": "correcthorsebattery"`;
    const findings = scanCeremonyFile("x.txt", text);
    assert.ok(findings.length >= 3);
    const flat = JSON.stringify(findings);
    for (const leak of [secret, "correcthorsebattery", PEM, "-----BEGIN"]) assert.ok(!flat.includes(leak), leak);
    for (const f of findings) assert.deepEqual(Object.keys(f).sort(), ["at", "code"]);
    assert.ok(findings.every((f) => /^line \d+$/.test(f.at)));
  });

  test("it never throws and reads only what it is given", () => {
    for (const text of ["", "\u0000", "x".repeat(200_000), "\r\n\r\n", "{{{{", "[".repeat(5000)]) {
      assert.doesNotThrow(() => scanCeremonyText(text));
      assert.doesNotThrow(() => scanCeremonyFile("x.json", text));
    }
    const deep: unknown = JSON.parse(`${"[".repeat(15)}1${"]".repeat(15)}`);
    assert.doesNotThrow(() => scanCeremonyJson(deep));
    assert.doesNotThrow(() => scanCeremonyJson(null));
  });
});

describe("secret scan: the repository", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const text = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
  const isText = (p: string): boolean => /\.(?:ts|mjs|md|json|yml|yaml|txt|sh|ps1|cmd|bat)$/.test(p) && !p.startsWith("plugin/server/") && p !== "package-lock.json";

  test("the committed ceremony documents and fixtures trip none of the secret rules", () => {
    const ceremony = tracked.filter((p) => /governance|ceremony|WALLPRINT_ATTESTATIONS\.md/i.test(p) && /\.(?:md|json)$/.test(p));
    assert.ok(ceremony.length >= 2, ceremony.join());
    for (const p of ceremony) assert.deepEqual(scanCeremonyFile(p, text(p)), [], p);
  });

  test("a PEM private-key header or the Ed25519 PKCS#8 header appears in no tracked file except the approved synthetic-test support and the scanner's own source and tests", () => {
    const approved = new Set([
      "packages/mcp/test/support/wallprint-attestations.ts",
      "packages/mcp/src/wallprint/governance-secret-scan.ts",
      "packages/mcp/test/wallprint/governance-secret-scan.test.ts",
    ]);
    const hits: string[] = [];
    for (const p of tracked.filter(isText)) {
      if (p === "packages/mcp/test/repo/public-release.test.ts" || approved.has(p)) continue;
      for (const f of scanCeremonyText(text(p))) if (f.code === "PEM_PRIVATE_KEY_BLOCK" || f.code === "PKCS8_ED25519_HEADER" || f.code === "AGE_SECRET_IDENTITY") hits.push(`${p}: ${f.code} ${f.at}`);
    }
    assert.deepEqual(hits, []);
  });

  test("the approved synthetic key-construction file holds a public ASCII-label seed and nothing shaped like a real key: its only header is the PKCS#8 prefix the label is appended to", () => {
    const support = text("packages/mcp/test/support/wallprint-attestations.ts");
    assert.deepEqual(scanCeremonyText(support).map((f) => f.code).filter((c) => c === "PKCS8_ED25519_HEADER" || c === "PEM_PRIVATE_KEY_BLOCK" || c === "AGE_SECRET_IDENTITY"), ["PKCS8_ED25519_HEADER"]);
    assert.match(support, /SYNTHETIC-NON-PRODUCTION-KEY-/);
    assert.doesNotMatch(support, /[0-9a-f]{64}/);
  });

  test("no environment-secret name or CI secret reference appears in any workflow or script, and none in the ceremony tooling", () => {
    const hits: string[] = [];
    for (const p of tracked.filter((x) => x.startsWith(".github/") || x.startsWith("scripts/") || x === "package.json")) {
      for (const f of scanCeremonyText(text(p))) if (f.code === "ENV_SECRET_NAME" || f.code === "CI_SECRET_REFERENCE") hits.push(`${p}: ${f.code} ${f.at}`);
    }
    assert.deepEqual(hits, []);
  });

  test("the rehearsal's own output, serialized as it would be published, carries no secret-looking material", () => {
    const published = JSON.stringify(rehearse(), null, 1);
    assert.deepEqual(scanCeremonyFile("rehearsal.json", published), []);
  });
});
