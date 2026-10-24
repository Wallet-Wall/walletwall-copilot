import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalize, evidenceDigest, sha256Hex } from "../../src/canonical.ts";
import { WwError } from "../../src/errors.ts";

describe("RFC 8785 canonicalization", () => {
  test("RFC 8785 section 3.2.2 number serialization", () => {
    const input = JSON.parse("[333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001]") as unknown;
    assert.equal(canonicalize(input, { numbers: "jcs" }), "[333333333.3333333,1e+30,4.5,0.002,1e-27]");
  });

  test("RFC 8785 section 3.2.3 property sorting uses UTF-16 code unit order", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
      "\n": "Newline",
    };
    const out = canonicalize(input);
    assert.equal(
      out,
      '{"\\n":"Newline","\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis",' +
        '"\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  test("output is independent of insertion order", () => {
    assert.equal(canonicalize({ b: "2", a: "1" }), '{"a":"1","b":"2"}');
    assert.equal(evidenceDigest({ b: "2", a: "1" }), evidenceDigest({ a: "1", b: "2" }));
  });

  test("nested structures and escapes", () => {
    assert.equal(canonicalize({ z: [true, null, "a\u0000\"\\"], a: {} }), '{"a":{},"z":[true,null,"a\\u0000\\"\\\\"]}');
  });

  test("SHA-256 known-answer", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("numbers are refused by default (evidence quantities are strings)", () => {
    assert.throws(() => canonicalize({ n: 1 }), (e) => e instanceof WwError && e.code === "CANONICALIZATION_FAILED");
    assert.throws(() => canonicalize([Number.MAX_SAFE_INTEGER + 2]));
  });

  test("non-finite numbers, undefined, bigint, functions, symbols are refused", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1, Symbol("x")]) {
      assert.throws(() => canonicalize(v, { numbers: "jcs" }));
    }
  });

  test("lone surrogates and non-plain objects are refused", () => {
    assert.throws(() => canonicalize("\ud800"));
    assert.throws(() => canonicalize({ "\udc00": "x" }));
    assert.throws(() => canonicalize(new Date(0)));
    assert.throws(() => canonicalize(new Map()));
    assert.throws(() => canonicalize(Object.create({ inherited: 1 })));
  });

  test("excessive nesting is refused", () => {
    let v: unknown = "x";
    for (let i = 0; i < 80; i++) v = [v];
    assert.throws(() => canonicalize(v));
  });

  test("errors never include the offending value", () => {
    try {
      canonicalize("\ud800secret-value");
      assert.fail("expected throw");
    } catch (e) {
      assert.ok(e instanceof WwError);
      assert.ok(!e.message.includes("secret-value"));
    }
  });
});
