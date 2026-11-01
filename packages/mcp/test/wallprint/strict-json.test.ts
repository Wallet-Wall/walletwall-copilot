import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseStrictJson } from "../../src/wallprint/strict-json.ts";

/**
 * The strict JSON reader is held to JSON.parse as an oracle: it accepts exactly the texts JSON.parse accepts, except
 * those that name an object key twice, which it refuses by design. It has no other behaviour.
 */
const value = (text: string, depth = 8): unknown => {
  const r = parseStrictJson(text, depth);
  assert.equal(r.ok, true, text);
  return r.ok ? r.value : undefined;
};
const problem = (text: string, depth = 8): string | null => {
  const r = parseStrictJson(text, depth);
  return r.ok ? null : r.problem;
};
const plain = (v: unknown): string => JSON.stringify(v);

const VALID = [
  "{}",
  "[]",
  '""',
  "0",
  "-0",
  "1.5e-7",
  "1E+3",
  "true",
  "false",
  "null",
  ' \t\r\n{ "a" : [ 1 , 2 , { "b" : null } ] , "c" : "d" } \n',
  '{"a":"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\u0041\\ud83d\\ude00"}',
  '{"emoji":"😀","é":"ü"}',
  '["a",["b",["c"]]]',
  '{"k1":1,"k2":{"k3":[true,false,null,"x",-1,0.25]}}',
];

describe("strict JSON reader: it reads what JSON.parse reads", () => {
  test("a corpus of valid texts parses to the same value as JSON.parse", () => {
    for (const text of VALID) assert.equal(plain(value(text)), plain(JSON.parse(text)), text);
  });

  test("objects have no prototype and own every key, including __proto__", () => {
    const parsed = value('{"__proto__":{"x":1},"constructor":2,"prototype":3}') as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(parsed), null);
    assert.deepEqual(Object.getOwnPropertyNames(parsed).sort(), ["__proto__", "constructor", "prototype"]);
    assert.equal(({} as { x?: number }).x, undefined);
  });

  test("single-character edits of valid texts are accepted or refused exactly as JSON.parse does, except for duplicate keys", () => {
    const base = '{"a":"x\\ny","b":[1,-2.5e3,true,null],"c":{"d":"\\u00e9"}}';
    const probes = ['"', "\\", "{", "}", "[", "]", ",", ":", "0", "1", "-", ".", "e", "t", "n", "'", " ", "\n", "\u0000", "\ufeff", "/", "a", "b", "u"];
    let compared = 0;
    let duplicates = 0;
    const check = (text: string): void => {
      compared++;
      let oracle: "ok" | "bad";
      try {
        JSON.parse(text);
        oracle = "ok";
      } catch {
        oracle = "bad";
      }
      const ours = parseStrictJson(text, 16);
      if (oracle === "bad") return assert.equal(ours.ok, false, `JSON.parse refuses, so must we: ${JSON.stringify(text)}`);
      if (ours.ok) return assert.equal(plain(ours.value), plain(JSON.parse(text)), `same value as JSON.parse: ${JSON.stringify(text)}`);
      assert.equal(ours.problem, "DUPLICATE_KEY", `JSON.parse accepts; the only reason to refuse is a repeated key: ${JSON.stringify(text)}`);
      duplicates++;
    };
    for (let i = 0; i <= base.length; i++) {
      for (const p of probes) {
        check(base.slice(0, i) + p + base.slice(i));
        if (i < base.length) check(base.slice(0, i) + p + base.slice(i + 1));
      }
      if (i < base.length) check(base.slice(0, i) + base.slice(i + 1));
    }
    assert.ok(compared > 2000, "the edit corpus is large enough to mean something");
    assert.ok(duplicates > 0, "the corpus does produce repeated keys, and they are the only difference");
  });

  test("RFC 8259 corners: leading zeros, bare words, trailing commas, comments, raw control characters and a BOM are refused", () => {
    for (const text of ["01", "+1", ".5", "1.", "1e", "NaN", "Infinity", "undefined", "tru", "[1,]", '{"a":1,}', "[,1]", '{"a" 1}', "{a:1}", "'a'", '"a', '"\\u12"', '"\\u12g4"', '"\\q"', '"\t"', "// c\n1", "/* c */1", "1 2", "[1 2]", "", "   ", "\ufeff{}", "{}x", '{"a":1}{"b":2}']) {
      assert.equal(problem(text), "SYNTAX", JSON.stringify(text));
    }
  });
});

describe("strict JSON reader: a repeated key is refused, not resolved", () => {
  test("at any level, with equal or different values", () => {
    assert.equal(problem('{"a":1,"a":1}'), "DUPLICATE_KEY");
    assert.equal(problem('{"a":1,"a":2}'), "DUPLICATE_KEY");
    assert.equal(problem('{"x":{"a":1,"b":2,"a":3}}'), "DUPLICATE_KEY");
    assert.equal(problem('[{"a":1},{"a":2,"a":3}]'), "DUPLICATE_KEY");
    assert.equal(problem('{"":1,"":2}'), "DUPLICATE_KEY");
  });

  test("keys are compared after escapes are decoded", () => {
    assert.equal(problem('{"a":1,"\\u0061":2}'), "DUPLICATE_KEY");
    assert.equal(problem('{"\\u005f_proto__":1,"__proto__":2}'), "DUPLICATE_KEY");
    assert.equal(problem('{"a\\/b":1,"a/b":2}'), "DUPLICATE_KEY");
    assert.equal(problem('{"\\ud83d\\ude00":1,"😀":2}'), "DUPLICATE_KEY");
  });

  test("the same key in different objects is not a repeat, and keys that differ only in case are different keys", () => {
    assert.equal(plain(value('{"a":{"a":1},"b":{"a":2},"A":3}')), '{"a":{"a":1},"b":{"a":2},"A":3}');
  });

  test("a __proto__ key written twice is a repeat, and written once is an ordinary key", () => {
    assert.equal(problem('{"__proto__":1,"__proto__":2}'), "DUPLICATE_KEY");
    assert.equal(problem('{"__proto__":1}'), null);
  });
});

describe("strict JSON reader: nesting is bounded by the caller", () => {
  test("a text nested exactly to the bound parses; one level more is TOO_DEEP", () => {
    assert.equal(problem('{"a":[1]}', 2), null);
    assert.equal(problem('{"a":[[1]]}', 2), "TOO_DEEP");
    assert.equal(problem("[[[1]]]", 3), null);
    assert.equal(problem("[[[[1]]]]", 3), "TOO_DEEP");
    assert.equal(problem("1", 0), null, "a scalar needs no nesting");
    assert.equal(problem("{}", 0), "TOO_DEEP");
  });

  test("a hostile depth never overflows the stack: it is refused at the bound", () => {
    assert.equal(problem("[".repeat(100_000), 3), "TOO_DEEP");
    assert.equal(problem('{"a":'.repeat(100_000), 3), "TOO_DEEP");
  });

  test("it never throws and never echoes input", () => {
    for (const text of ["\u0000", "{", '{"a"', "[1,", '"\\', "\ud800", '{"\ud800":1}']) {
      const r = parseStrictJson(text, 3);
      assert.deepEqual(Object.keys(r).sort(), r.ok ? ["ok", "value"] : ["ok", "problem"]);
    }
  });
});
