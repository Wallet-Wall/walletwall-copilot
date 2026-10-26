import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateBundle } from "../../src/evaluate.ts";
import { checkInvariants } from "../../src/invariants.ts";
import { sameSubjectIdentity, subjectIdentity, subjectIdentityKeys } from "../../src/wallprint/identity.ts";
import { EVALUATED_AT, OBSERVED_AT, USDC, clone, golden, identityAssertion } from "../support/builders.ts";

/**
 * WallPrint subject identity is computed in exactly one place (src/wallprint/identity.ts) and it REPRODUCES the
 * engine's current behaviour: conflict grouping (evaluate.ts) and supersession identity (invariants.ts) compare the
 * exact subject strings, while observation-to-assertion matching folds case for address-like keys (claims.ts).
 * This lane records that behaviour; it does not change it. Case normalisation is a later, explicit semantic decision
 * and must be made here and nowhere else.
 */
const UPPER_USDC = USDC.toUpperCase().replace("0X", "0x");

describe("WallPrint subject identity: one module, current engine behaviour, no silent case change", () => {
  test("the identity key is the policy's subject keys in canonical form, independent of insertion order", () => {
    const a = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC });
    const b = subjectIdentity("ASSET_IDENTITY", { address: USDC, chainId: "1" });
    assert.equal(a, b);
    assert.equal(a, '{"address":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","chainId":"1"}');
    assert.deepEqual(subjectIdentityKeys("ASSET_IDENTITY"), ["chainId", "address"]);
  });

  test("keys outside the policy's subject keys do not change the identity", () => {
    const a = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC });
    const b = subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC, note: "ignored" });
    assert.equal(a, b);
  });

  test("a subject missing a required key has no identity (null), never a partial one", () => {
    assert.equal(subjectIdentity("ASSET_IDENTITY", { chainId: "1" }), null);
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1" }, { chainId: "1" }), false);
  });

  test("REGRESSION (address case): two subjects differing only in hex case are DIFFERENT identities today", () => {
    assert.notEqual(subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }), subjectIdentity("ASSET_IDENTITY", { chainId: "1", address: UPPER_USDC }));
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }, { chainId: "1", address: UPPER_USDC }), false);
  });

  test("REGRESSION (address case): the engine does not group case-variant assertions as a conflict, and WallPrint identity agrees", () => {
    const b = clone(golden());
    // Same claim, same temporality, same chain; the address differs only by case; the values disagree.
    b.assertions.push(identityAssertion({ id: "a-identity-upper", subject: { chainId: "1", address: UPPER_USDC }, value: { symbol: "USDX", decimals: "6", issuerAuthorityId: "issuer:circle" }, observationIds: ["obs-identity"] }));
    const ev = evaluateBundle(b, EVALUATED_AT);
    const lower = ev.assertions.find((e) => e.assertionId === "a-identity");
    const upper = ev.assertions.find((e) => e.assertionId === "a-identity-upper");
    assert.ok(lower && upper);
    assert.deepEqual(lower.conflictsWith, [], "exact-string grouping: no conflict detected across a case difference");
    assert.deepEqual(upper.conflictsWith, []);
    assert.notEqual(upper.supportState, "CONFLICTING");
    assert.equal(sameSubjectIdentity("ASSET_IDENTITY", { chainId: "1", address: USDC }, { chainId: "1", address: UPPER_USDC }), false);
  });

  test("REGRESSION (address case): a supersession across a case difference is reported as an identity mismatch by INV-12", () => {
    const b = clone(golden());
    b.assertions.push(identityAssertion({ id: "a-identity-upper", subject: { chainId: "1", address: UPPER_USDC }, assertedAt: EVALUATED_AT }));
    b.supersessions = [{ id: "s-1", supersededAssertionId: "a-identity", supersedingAssertionId: "a-identity-upper", effectiveAt: EVALUATED_AT, reason: "CORRECTED" }];
    const ev = evaluateBundle(b, EVALUATED_AT);
    const violations = checkInvariants(b, ev);
    assert.ok(violations.some((v) => v.invariant === "INV-12" && v.code === "SUPERSESSION_CLAIM_IDENTITY_MISMATCH"), JSON.stringify(violations));
  });

  test("REGRESSION (address case): observation-to-assertion matching DOES fold case (the engine's one case-insensitive seam)", () => {
    const b = clone(golden());
    b.assertions = b.assertions.map((a) => (a.id === "a-identity" ? { ...a, subject: { chainId: "1", address: UPPER_USDC } } : a));
    const ev = evaluateBundle(b, EVALUATED_AT);
    const e = ev.assertions.find((x) => x.assertionId === "a-identity");
    assert.ok(e);
    assert.ok(!e.limitations.includes("SUBJECT_MISMATCH"), "the observation still supports the assertion despite the case difference");
    assert.equal(OBSERVED_AT < EVALUATED_AT, true);
  });
});
