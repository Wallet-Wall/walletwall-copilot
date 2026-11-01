import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { findSecretLike } from "../../src/wallprint/language.ts";
import { buildWallPrintSnapshot } from "../../src/wallprint/record.ts";
import {
  encodeReference,
  isResolverBase,
  parseHttpsUrl,
  parseReference,
  parseResolverPath,
  REFERENCE_MAX_LENGTH,
  REFERENCE_PREFIX,
  REFERENCE_TARGETS,
  referenceOf,
  RESOLVER_ROUTE,
  toHttpsUrl,
  toResolverPath,
} from "../../src/wallprint/reference.ts";
import { baseInput } from "./support.ts";

/**
 * The public HTTPS form of a portable reference: the same locator under a resolver base. It is a representation of the
 * reference, never a second identity: the mapping is a prefix substitution (`walletwall://wallprint/` <-> `<base>/wallprint/`),
 * so it is deterministic, lossless and carries the reference's own versions. Parsing is as strict as the reference's own.
 */

const record = buildWallPrintSnapshot(baseInput({ wallprintVersion: "0.1" }));
// Assembled at run time so the engine's own "no URL literal in src" scan has nothing to find in this test's intent either.
const BASE = ["https:", "//", "walletwall.org"].join("");
const ref = referenceOf(record);

describe("resolver base: exactly one spelling of an HTTPS origin", () => {
  test("accepts a bare https origin with a dotted DNS host and nothing else", () => {
    assert.equal(isResolverBase(BASE), true);
    assert.equal(isResolverBase(["https:", "//", "disclosures.example"].join("")), true);
    assert.equal(isResolverBase(["https:", "//", "a-b.c-d.example"].join("")), true);
  });

  test("refuses every other spelling: scheme, slash, port, userinfo, case, path, query, fragment, IP, single label, IDN, whitespace, non-string", () => {
    const bad: unknown[] = [
      ["http:", "//", "walletwall.org"].join(""),
      `${BASE}/`,
      `${BASE}:443`,
      `${BASE}:8443`,
      ["https:", "//", "user", "@", "walletwall.org"].join(""),
      ["https:", "//", "user:pw", "@", "walletwall.org"].join(""),
      ["https:", "//", "WalletWall.org"].join(""),
      ["HTTPS:", "//", "walletwall.org"].join(""),
      `${BASE}/wallprint`,
      `${BASE}?x=1`,
      `${BASE}#f`,
      ["https:", "//", "93.184.216.34"].join(""),
      ["https:", "//", "localhost"].join(""),
      ["https:", "//", "w\u00e4llet.org"].join(""),
      ["https:", "//", "xn--wllet-5qa.org"].join(""),
      ` ${BASE}`,
      `${BASE} `,
      "walletwall.org",
      "//walletwall.org",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      42,
      { origin: BASE },
    ];
    for (const b of bad) assert.equal(isResolverBase(b), false, String(b));
  });
});

describe("the HTTPS form is a prefix substitution of the canonical reference", () => {
  test("the resolver path is the reference text with its scheme and host replaced by the route", () => {
    assert.equal(RESOLVER_ROUTE, "/wallprint/");
    assert.equal(toResolverPath(ref), `/wallprint/${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}`);
    assert.equal(toResolverPath(ref), RESOLVER_ROUTE + encodeReference(ref).slice(REFERENCE_PREFIX.length));
    assert.equal(toResolverPath(referenceOf(record, "receipt")), `/wallprint/${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}&target=receipt`);
  });

  test("the HTTPS URL is the base plus the resolver path, deterministic, with no percent-encoding, fragment or whitespace", () => {
    const url = toHttpsUrl(ref, BASE);
    assert.equal(url, `${BASE}/wallprint/${record.id}?reference=0.1&wallprint=0.1&digest=${record.digest}`);
    assert.equal(url, toHttpsUrl(referenceOf(record), BASE), "deterministic");
    assert.equal(toHttpsUrl(referenceOf(record, "history"), BASE), `${url}&target=history`);
    assert.ok(!/%|#|\s/.test(url));
    assert.equal(findSecretLike(url), null);
  });

  test("the URL refuses an invalid base with a fixed finding and never names the base", () => {
    for (const b of [`${BASE}/`, ["http:", "//", "walletwall.org"].join(""), "", null]) {
      assert.throws(
        () => toHttpsUrl(ref, b as string),
        (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_REFERENCE" && e.findings.some((f) => f.code === "INVALID_RESOLVER_BASE" && f.path === "resolverBase") && !e.message.includes("walletwall"),
        String(b),
      );
    }
  });

  test("the URL refuses an invalid reference exactly as the text form does", () => {
    assert.throws(() => toHttpsUrl({ ...ref, digest: "x" }, BASE), (e: unknown) => e instanceof WallPrintError && e.code === "INVALID_REFERENCE");
  });

  test("parse(toHttpsUrl(reference)) is the reference, for every target, and the text form survives the round trip unchanged", () => {
    for (const target of [null, ...REFERENCE_TARGETS]) {
      const r = referenceOf(record, target);
      const parsed = parseHttpsUrl(toHttpsUrl(r, BASE), BASE);
      assert.ok(parsed.ok, String(target));
      assert.deepEqual(parsed.reference, r);
      assert.equal(encodeReference(parsed.reference), encodeReference(r), "lossless");
      const viaPath = parseResolverPath(toResolverPath(r));
      assert.ok(viaPath.ok && encodeReference(viaPath.reference) === encodeReference(r));
    }
  });

  test("a canonical reference and its HTTPS form name the same record: parsing either gives one value", () => {
    const fromText = parseReference(encodeReference(ref));
    const fromUrl = parseHttpsUrl(toHttpsUrl(ref, BASE), BASE);
    assert.ok(fromText.ok && fromUrl.ok);
    assert.deepEqual(fromUrl.reference, fromText.reference);
  });
});

describe("parsing the HTTPS form fails closed, by the reference's own rules", () => {
  const url = toHttpsUrl(ref, BASE);
  const expectBad = (input: unknown, problem: string, outcome = "MALFORMED_REFERENCE", base: unknown = BASE): void => {
    const p = parseHttpsUrl(input, base);
    assert.equal(p.ok, false, String(input));
    if (!p.ok) {
      assert.equal(p.outcome, outcome, String(input));
      assert.equal(p.problem, problem, String(input));
      assert.ok(!JSON.stringify(p).includes(record.id) && !JSON.stringify(p).includes(record.digest), "never echoes the input");
    }
  };

  test("another host, a look-alike host, a different scheme, a protocol-relative URL or a bare path is not this resolver's URL", () => {
    expectBad(url.replace(BASE, ["https:", "//", "walletwall.org.example"].join("")), "resolver");
    expectBad(url.replace(BASE, ["https:", "//", "evil.example"].join("")), "resolver");
    expectBad(url.replace(BASE, ["https:", "//", "walletwall.org", "@", "evil.example"].join("")), "resolver");
    expectBad(url.replace("https:", "http:"), "resolver");
    expectBad(url.replace("https:", "HTTPS:"), "resolver");
    expectBad(url.replace("https:", "javascript:"), "resolver");
    expectBad(url.slice("https:".length), "resolver");
    expectBad(url.slice(BASE.length), "resolver");
    expectBad(url.replace("/wallprint/", "/WallPrint/"), "resolver");
    expectBad(url.replace("/wallprint/", "/wallprint"), "resolver");
    expectBad(url.replace("/wallprint/", "//wallprint/"), "resolver");
  });

  test("an invalid base refuses every URL, including a correct one", () => {
    expectBad(url, "resolver", "MALFORMED_REFERENCE", `${BASE}/`);
    expectBad(url, "resolver", "MALFORMED_REFERENCE", "");
    expectBad(url, "resolver", "MALFORMED_REFERENCE", null);
  });

  test("path traversal, a second path segment or an empty id is refused as a record id, never resolved", () => {
    expectBad(url.replace(`/wallprint/${record.id}`, "/wallprint/../index.json"), "recordId");
    expectBad(url.replace(`/wallprint/${record.id}`, `/wallprint/${record.id}/../x`), "recordId");
    expectBad(url.replace(`/wallprint/${record.id}`, `/wallprint//${record.id}`), "recordId");
    expectBad(url.replace(`/wallprint/${record.id}`, "/wallprint/"), "recordId");
    // A plain word under the route is a well-formed record id (the static layout keeps published files under `records/<id>/`,
    // so no id can name a resolver file); whether such a record is published is the store's answer, never the parser's.
    const word = parseHttpsUrl(url.replace(`/wallprint/${record.id}`, "/wallprint/records"), BASE);
    assert.ok(word.ok && word.reference.recordId === "records");
  });

  test("percent-encoding, a fragment, whitespace, unicode, bidi or control characters are refused before anything is read", () => {
    expectBad(url.replace(record.id, `${record.id}%2e%2e`), "characters");
    expectBad(`${url}#target=receipt`, "characters");
    expectBad(`${url} `, "characters");
    expectBad(url.replace(record.id, `${record.id}\u202e`), "characters");
    expectBad(url.replace(record.id, `${record.id}\u0000`), "characters");
    expectBad(url.replace(record.id, `${record.id}\u200b`), "characters");
    expectBad(url.replace("digest=", "digest=\u0661"), "characters");
    expectBad(url.replace(record.id, `wp-\u00e9`), "characters");
  });

  test("a duplicated, reordered, missing, unknown or injected query parameter is refused", () => {
    expectBad(`${url}&digest=${record.digest}`, "query");
    expectBad(`${url}&target=receipt&target=replay`, "query");
    expectBad(url.replace("reference=0.1&wallprint=0.1", "wallprint=0.1&reference=0.1"), "query");
    expectBad(url.replace("&wallprint=0.1", ""), "query");
    expectBad(`${url}&redirect=${["https:", "//", "evil.example"].join("")}`, "query");
    expectBad(`${url}&next=/`, "query");
    expectBad(`${url}&target=receipt&x=1`, "query");
  });

  test("a target outside the closed table is refused, never used as a selector", () => {
    for (const t of ["Receipt", "RECEIPT", "receipt.", "record-", "assessments2", "__proto__", "constructor", "body", "script"]) expectBad(`${url}&target=${t}`, "target");
  });

  test("a malformed or upper-case digest, an address-shaped id and a credential-shaped id are refused", () => {
    expectBad(url.replace(record.digest, record.digest.toUpperCase()), "digest");
    expectBad(url.replace(record.digest, record.digest.slice(1)), "digest");
    expectBad(url.replace(record.digest, `0x${record.digest.slice(2)}`), "digest");
    expectBad(url.replace(record.id, `0x${"a".repeat(40)}`), "recordId");
    expectBad(url.replace(record.id, "ghp_" + "a".repeat(36)), "recordId");
  });

  test("an unsupported reference or WallPrint version is told as such, and nothing is guessed about its grammar", () => {
    expectBad(url.replace("reference=0.1", "reference=0.2"), "reference", "UNSUPPORTED_VERSION");
    expectBad(url.replace("wallprint=0.1", "wallprint=1.0"), "wallprint", "UNSUPPORTED_VERSION");
  });

  test("an oversized URL is refused by length before its characters are read", () => {
    const long = `${BASE}/wallprint/${"a".repeat(REFERENCE_MAX_LENGTH + 1)}?reference=0.1&wallprint=0.1&digest=${record.digest}`;
    expectBad(long, "length");
    expectBad(`${url}${"&target=receipt".repeat(40)}`, "length");
  });

  test("a non-string or empty input is refused as text", () => {
    expectBad(undefined, "text");
    expectBad(null, "text");
    expectBad(42, "text");
    expectBad("", "text");
    expectBad({ href: url }, "text");
  });

  test("the resolver path parser refuses a path not under the route and otherwise behaves exactly like the URL parser", () => {
    for (const p of ["/", "/index.json", "/records/x", "wallprint/x", "/wallprintx/y", `/wallprint${"?x"}`]) {
      const r = parseResolverPath(p);
      assert.equal(r.ok, false, p);
      if (!r.ok) assert.equal(r.problem, "resolver", p);
    }
    const a = parseResolverPath(`${toResolverPath(ref)}%00`);
    assert.ok(!a.ok && a.problem === "characters");
    const b = parseResolverPath(42);
    assert.ok(!b.ok && b.problem === "text");
  });
});
