/**
 * A strict JSON text parser for untrusted input at a closed-schema boundary.
 *
 * `JSON.parse` keeps the last of two equal keys, so a text that names a key twice is read one way by a parser that
 * keeps the first and another by one that keeps the last. At a boundary that records who said what, that ambiguity is
 * refused instead of resolved: this parser reads RFC 8259 JSON and fails on a repeated key (compared after escapes are
 * decoded, so `"a"` and `"\u0061"` are one key), on nesting deeper than the caller's closed shape, and on anything the
 * grammar does not admit (a comment, a trailing comma, a single quote, a raw control character, a leading zero, a bare
 * word, text after the value). It never echoes any part of the input.
 *
 * Objects are built without a prototype, so a key named `__proto__` is an ordinary own key here and the caller can
 * refuse it by name; nothing is ever assigned through the prototype chain.
 *
 * Pure: no clock, no I/O, no dependencies.
 */

export type StrictJsonProblem = "SYNTAX" | "DUPLICATE_KEY" | "TOO_DEEP";

export type StrictJsonResult = { ok: true; value: unknown } | { ok: false; problem: StrictJsonProblem };

class Refusal extends Error {
  readonly problem: StrictJsonProblem;
  constructor(problem: StrictJsonProblem) {
    super("strict JSON refused the input");
    this.problem = problem;
  }
}

const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const HEX4_RE = /^[0-9a-fA-F]{4}$/;
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** Parse `text` as one JSON value, or report the one fixed problem that refused it. Never throws. `maxDepth` bounds nested objects and arrays. */
export function parseStrictJson(text: string, maxDepth: number): StrictJsonResult {
  let i = 0;

  const fail = (problem: StrictJsonProblem): never => {
    throw new Refusal(problem);
  };
  const skipWhitespace = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const expect = (ch: string): void => {
    if (text[i] !== ch) fail("SYNTAX");
    i++;
  };

  const readString = (): string => {
    expect('"');
    let out = "";
    for (;;) {
      if (i >= text.length) return fail("SYNTAX");
      const ch = text[i] as string;
      const code = ch.charCodeAt(0);
      if (ch === '"') {
        i++;
        return out;
      }
      if (code < 0x20) return fail("SYNTAX");
      if (ch !== "\\") {
        out += ch;
        i++;
        continue;
      }
      const esc = text[i + 1];
      if (esc === undefined) return fail("SYNTAX");
      if (esc === "u") {
        const hex = text.slice(i + 2, i + 6);
        if (!HEX4_RE.test(hex)) return fail("SYNTAX");
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else {
        const mapped = Object.hasOwn(ESCAPES, esc) ? ESCAPES[esc] : undefined;
        if (mapped === undefined) return fail("SYNTAX");
        out += mapped;
        i += 2;
      }
    }
  };

  const readValue = (depth: number): unknown => {
    skipWhitespace();
    const ch = text[i];
    if (ch === "{") {
      if (depth + 1 > maxDepth) return fail("TOO_DEEP");
      i++;
      const obj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      skipWhitespace();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        skipWhitespace();
        const key = readString();
        if (Object.hasOwn(obj, key)) return fail("DUPLICATE_KEY");
        skipWhitespace();
        expect(":");
        obj[key] = readValue(depth + 1);
        skipWhitespace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("}");
        return obj;
      }
    }
    if (ch === "[") {
      if (depth + 1 > maxDepth) return fail("TOO_DEEP");
      i++;
      const arr: unknown[] = [];
      skipWhitespace();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(readValue(depth + 1));
        skipWhitespace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("]");
        return arr;
      }
    }
    if (ch === '"') return readString();
    for (const [word, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return value;
      }
    }
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(text);
    if (m === null) return fail("SYNTAX");
    i += m[0].length;
    return Number(m[0]);
  };

  try {
    const value = readValue(0);
    skipWhitespace();
    if (i !== text.length) return { ok: false, problem: "SYNTAX" };
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, problem: e.problem };
    return { ok: false, problem: "SYNTAX" };
  }
}
