import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize } from "../../mcp/src/canonical.ts";
import { buildPublicDisclosure } from "../../mcp/src/wallprint/publication.ts";
import { canonicalForm } from "../lib/canonical-form.ts";
import { sha256Hex } from "../lib/digest.ts";
import { publishedExports } from "./support/store.ts";

/**
 * The browser's canonicalizer must be the engine's: RFC 8785 (UTF-16 key order, JSON string escapes, no whitespace),
 * numbers refused, lone surrogates and non-plain objects refused, deep nesting refused. It returns null instead of
 * throwing because the page fails closed on anything it cannot canonicalize. Parity is pinned against the engine over
 * every published record, every artifact, and the engine's own vectors.
 */

describe("canonical form parity with the engine", () => {
  test("every published record's preimage and every artifact canonicalize to exactly the engine's bytes", () => {
    for (const e of publishedExports()) {
      const payload: unknown = JSON.parse(e.canonical);
      assert.equal(canonicalForm(payload), canonicalize(payload), e.id);
      assert.equal(canonicalForm(payload), e.canonical, e.id);
      const { artifact, bytes } = buildPublicDisclosure(e);
      assert.equal(canonicalForm(artifact), bytes, e.id);
      assert.equal(canonicalForm(JSON.parse(bytes)), bytes, e.id);
    }
  });

  test("the engine's vectors: UTF-16 key order, insertion-order independence, nested escapes, scalars", () => {
    const keys = { "\u20ac": "1", a: "2", "\ud83d\ude00": "3", A: "4", "\u00e9": "5", "": "6", b: "7" };
    assert.equal(canonicalForm(keys), canonicalize(keys));
    assert.equal(canonicalForm({ b: "2", a: "1" }), '{"a":"1","b":"2"}');
    assert.equal(canonicalForm({ z: [true, null, "a\u0000\"\\"], a: {} }), '{"a":{},"z":[true,null,"a\\u0000\\"\\\\"]}');
    assert.equal(canonicalForm(null), "null");
    assert.equal(canonicalForm(true), "true");
    assert.equal(canonicalForm("x\u2028y"), canonicalize("x\u2028y"));
    assert.equal(canonicalForm([]), "[]");
    assert.equal(canonicalForm({}), "{}");
  });

  test("numbers, non-finite values, undefined, bigint, symbols, functions, lone surrogates, non-plain objects and deep nesting have no canonical form", () => {
    for (const v of [1, 0, -0, 1.5, [1], { n: 1 }, NaN, Infinity, undefined, 10n, Symbol("s"), () => 1, "\ud800", { "\udc00": "x" }, new Date(0), new Map(), Object.create({ inherited: "1" }), [undefined]]) {
      assert.equal(canonicalForm(v), null, String(typeof v === "symbol" ? "symbol" : v));
    }
    let deep: unknown = "x";
    for (let i = 0; i < 70; i++) deep = [deep];
    assert.equal(canonicalForm(deep), null);
    let ok: unknown = "x";
    for (let i = 0; i < 60; i++) ok = [ok];
    assert.equal(canonicalForm(ok), canonicalize(ok));
  });

  test("SHA-256 over UTF-8 matches the engine's known answer and the engine's digest of every published preimage", async () => {
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    for (const e of publishedExports()) assert.equal(await sha256Hex(e.canonical), e.record.digest, e.id);
  });
});
