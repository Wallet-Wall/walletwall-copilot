import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import {
  RESERVED_ASSURANCE_TERMS,
  RESERVED_IDENTITY_STEMS,
  assertWalletWallText,
  findReservedAssuranceTerms,
  findSecretLike,
  isReservedAssuranceCode,
  isReservedIdentity,
  isReservedPolicyId,
} from "../../src/wallprint/language.ts";

/**
 * WallPrint must not manufacture assurance. The guard applies to WalletWall-AUTHORED text (lifecycle reasons, any
 * WalletWall statement); an external assessor's attributed statement is recorded verbatim and never rewritten.
 * Polarity is not parsed: "not verified" is refused like "verified", so WalletWall says it in codes.
 */
describe("WallPrint assurance-language guard", () => {
  test("the reserved terms are the nine WP0 terms and the list is frozen", () => {
    assert.deepEqual([...RESERVED_ASSURANCE_TERMS], ["VERIFIED", "CERTIFIED", "SAFE", "SOLVENT", "COMPLIANT", "AUDITED", "APPROVED", "TRUSTED", "INVESTMENT-GRADE"]);
    assert.ok(Object.isFrozen(RESERVED_ASSURANCE_TERMS));
  });

  test("whole words are matched case-insensitively and reported in canonical spelling", () => {
    assert.deepEqual(findReservedAssuranceTerms("Verified by WalletWall."), ["VERIFIED"]);
    assert.deepEqual(findReservedAssuranceTerms("this wallet is SAFE and solvent"), ["SAFE", "SOLVENT"]);
    for (const s of ["investment-grade", "INVESTMENT_GRADE", "investment grade"]) assert.deepEqual(findReservedAssuranceTerms(s), ["INVESTMENT-GRADE"], s);
  });

  test("substrings of longer words do not fire; negation is not parsed", () => {
    assert.deepEqual(findReservedAssuranceTerms("unverified safety approval compliance"), []);
    assert.deepEqual(findReservedAssuranceTerms("not verified"), ["VERIFIED"]);
    assert.deepEqual(findReservedAssuranceTerms(null), []);
  });

  test("codes are compared exactly and case-insensitively, including the underscore spelling", () => {
    assert.equal(isReservedAssuranceCode("CERTIFIED"), true);
    assert.equal(isReservedAssuranceCode("investment_grade"), true);
    assert.equal(isReservedAssuranceCode("SUPPORTED"), false);
    assert.equal(isReservedAssuranceCode("CONFIRMED"), false);
  });

  test("assertWalletWallText throws a fixed-message WallPrintError that names the path but never echoes the text", () => {
    assert.throws(
      () => assertWalletWallText("This address is certified safe.", "lifecycle.reason"),
      (e: unknown) => e instanceof WallPrintError && e.code === "MANUFACTURED_ASSURANCE" && e.findings[0]?.path === "lifecycle.reason" && !e.message.includes("certified"),
    );
    assert.doesNotThrow(() => assertWalletWallText("Recounted after a provider pagination fix.", "lifecycle.reason"));
  });

  test("reserved identity stems catch WalletWall and WallPrint look-alikes as token runs, not as substrings", () => {
    assert.deepEqual([...RESERVED_IDENTITY_STEMS], ["walletwall", "wallprint"]);
    for (const id of ["walletwall", "wallet-wall", "wallet.wall", "wallet_wall", "WalletWall:audit", "the-walletwall-desk", "wall-print", "wallprint", "wall:print:desk"]) assert.equal(isReservedIdentity(id), true, id);
    for (const id of ["issuer:circle", "protocol:sky", "reviewer-y", "walle-twal", "firewall-print-shop", "stonewall-printing", "seawall.print", "walletwallet"]) assert.equal(isReservedIdentity(id), false, id);
    assert.equal(isReservedIdentity(null), false);
  });

  test("WalletWall policy and rule namespaces are reserved in any case or separator spelling", () => {
    for (const p of ["wwap/asset-identity/0.1", "WWAP/asset-identity/0.1", "wwap.asset-identity", "wwdr.usd-value", "WWDR:usd", "wwvr/x", "wwap"]) assert.equal(isReservedPolicyId(p), true, p);
    for (const p of ["issuer-attestation", "reviewer-y-review", "wwapx", "my-wwap", "ww/other"]) assert.equal(isReservedPolicyId(p), false, p);
  });

  test("secret-like text is refused: bearer tokens, key blocks, known key prefixes, key=value assignments", () => {
    // Token-shaped strings are assembled at run time so no tracked file holds one (public-release hygiene scan).
    const bearer = `Bearer ${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    assert.equal(findSecretLike(`Authorization: ${bearer}`), "SUSPECTED_SECRET");
    assert.equal(findSecretLike(["-----BEGIN", "PRIVATE", "KEY-----"].join(" ")), "SUSPECTED_SECRET");
    assert.equal(findSecretLike("api_key=abcdefghijklmnop"), "SUSPECTED_SECRET");
    assert.equal(findSecretLike("Recounted after a provider pagination fix."), null);
    assert.throws(() => assertWalletWallText("token: abcdefghijklmnopqrstuvwxyz", "lifecycle.reason"), (e: unknown) => e instanceof WallPrintError && e.code === "SUSPECTED_SECRET");
  });
});
