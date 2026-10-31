import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CACHE_IMMUTABLE, CACHE_SHORT, hostConfig, PUBLIC_CSP, shellHtml } from "../lib/host-config.ts";

/**
 * What the host must serve for the public resolver, as data: the rewrites that send /wallprint/<id> to the one shell,
 * the cache rules (immutable only for content-hashed assets, whose names change when their bytes do; record JSON is
 * revalidated), and the page's security headers.
 * The rules are scoped to /wallprint and carry no site-wide setting, so merging them into the product's configuration
 * changes nothing outside the route. Sources are read as anchored regular expressions; a test below holds every source
 * to the subset where that reading and Vercel's path-to-regexp agree.
 */

const config = hostConfig();
const matches = (source: string, path: string): boolean => new RegExp(`^${source}$`).test(path);
/**
 * Vercel compiles a source with path-to-regexp, which agrees with the anchored-regex reading above only on a subset:
 * path characters and escaped dots outside parentheses, parenthesized patterns, and a ?, * or + after a pattern that no
 * "/" precedes (path-to-regexp makes a preceding "/" optional or repeated along with the pattern). A source outside it,
 * such as a named parameter (:path*), a brace group or a bare modifier, could match on the host and not in these tests.
 */
const inRegexSubset = (source: string): boolean => {
  const shape = source.replace(/\((?:[^()\\]|\\.)*\)/g, "()");
  return /^(?:[A-Za-z0-9/_-]|\\\.|\(\)[?*+]?)*$/.test(shape) && !/\/\(\)[?*+]/.test(shape);
};
const headersFor = (path: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rule of config.headers) if (matches(rule.source, path)) for (const h of rule.headers) out[h.key] = h.value;
  return out;
};
const HEX64 = "0".repeat(63) + "1";
const BASE = ["https:", "//", "walletwall.org"].join("");

describe("the host configuration is scoped to the route", () => {
  test("only rewrites and headers, no site-wide key (cleanUrls, trailingSlash, redirects) that would change the product outside /wallprint", () => {
    assert.deepEqual(Object.keys(config).sort(), ["headers", "rewrites"]);
  });

  test("every source is in the subset where these tests and Vercel's path-to-regexp agree, so the tests see what the host matches", () => {
    for (const { source } of [...config.rewrites, ...config.headers]) assert.ok(inRegexSubset(source), source);
    for (const outside of ["/wallprint/records/:path*", "/wallprint/:id", "/wallprint/records/{x}", "/wallprint/*", "/wallprint/records/(.*)?", "/wallprint/index.json"]) {
      assert.ok(!inRegexSubset(outside), `${outside} is outside the subset`);
    }
  });

  test("every rewrite sends a /wallprint path to the one shell, and only record-shaped paths are rewritten", () => {
    for (const r of config.rewrites) {
      assert.ok(r.source === "/wallprint" || r.source.startsWith("/wallprint/"), r.source);
      assert.equal(r.destination, "/wallprint/index.html");
    }
    const rewritten = (p: string): boolean => config.rewrites.some((r) => matches(r.source, p));
    for (const p of ["/wallprint", "/wallprint/", "/wallprint/wp-identity-corrected-v1"]) assert.ok(rewritten(p), p);
    for (const p of ["/wallprint/records/wp-x/index.json", `/wallprint/records/wp-x/${HEX64}.json`, "/wallprint/index.json", "/wallprint/WP-X", "/wallprint/a/b", "/whale-watcher", "/", "/wallprint/wp-x.json"]) assert.ok(!rewritten(p), p);
  });

  test("hashed assets remain immutable: the content-hashed script, stylesheet, fonts and mark, and nothing whose name does not change with its bytes", () => {
    for (const p of ["/wallprint/wallprint.0123456789abcdef.js", "/wallprint/wallprint.0123456789abcdef.css", "/wallprint/fonts/sora-latin-wght-normal.0123456789abcdef.woff2", "/wallprint/brand/mark.0123456789abcdef.png"]) {
      assert.equal(headersFor(p)["Cache-Control"], CACHE_IMMUTABLE, p);
    }
    for (const p of ["/wallprint/records/wp-x/index.json", `/wallprint/records/wp-x/${HEX64}.json`, "/wallprint/index.json", "/wallprint/index.html", "/wallprint", "/wallprint/wp-identity-corrected-v1"]) assert.equal(headersFor(p)["Cache-Control"], CACHE_SHORT, p);
    for (const p of ["/wallprint/fonts/sora-latin-wght-normal.woff2", "/wallprint/brand/mark.png", "/wallprint/fonts/OFL-Sora.txt", "/wallprint/wallprint.js"]) assert.notEqual(headersFor(p)["Cache-Control"], CACHE_IMMUTABLE, `${p}: a name that does not change with its bytes is never immutable`);
    assert.equal(CACHE_IMMUTABLE, "public, max-age=31536000, immutable");
    assert.equal(CACHE_SHORT, "public, max-age=300, must-revalidate");
  });

  test("every path under the route gets the page's CSP with frame-ancestors, nosniff, no referrer, no framing; the security rule is the last rule", () => {
    for (const p of ["/wallprint", "/wallprint/", "/wallprint/wp-x", `/wallprint/records/wp-x/${HEX64}.json`, "/wallprint/wallprint.0123456789abcdef.js"]) {
      const h = headersFor(p);
      assert.equal(h["Content-Security-Policy"], `${PUBLIC_CSP}; frame-ancestors 'none'`, p);
      assert.equal(h["X-Content-Type-Options"], "nosniff");
      assert.equal(h["Referrer-Policy"], "no-referrer");
      assert.equal(h["X-Frame-Options"], "DENY");
    }
    const last = config.headers[config.headers.length - 1]!;
    assert.ok(last.headers.some((h) => h.key === "Content-Security-Policy"), "placed last, so it is the route's word on the policy");
    assert.ok(!PUBLIC_CSP.includes("unsafe-inline") && !PUBLIC_CSP.includes("unsafe-eval") && !/https?:/.test(PUBLIC_CSP));
    for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(PUBLIC_CSP.includes(directive), directive);
  });
});

/**
 * A host applies a path's header rule to whatever the path answers, a 404 included (Vercel does), and a record URL
 * legitimately goes from 404 to 200 when the record is published. So no rule that can match a path under
 * /wallprint/records/ may make a response long-lived or immutable: a year-long immutable 404 for a record published
 * later would keep that record unavailable in every browser and shared cache that saw the 404.
 */
describe("record JSON is revalidated, never cached long or immutable", () => {
  const store = JSON.parse(readFileSync(new URL("../publication/index.json", import.meta.url), "utf8")) as { records: { recordId: string; digest: string }[] };
  const published = store.records[0]!;
  const ids = [published.recordId, "wp-not-published-v1", "abc", "a".repeat(64)];
  const recordPaths = ids.flatMap((id) => ["index.json", `${published.digest}.json`, `${HEX64}.json`, `${"f".repeat(64)}.json`].map((f) => `/wallprint/records/${id}/${f}`));
  const isCacheHeader = (key: string): boolean => /cache-control$/i.test(key) || /^surrogate-control$/i.test(key);
  /**
   * The longest a cache may answer with a response before it asks the host again: its freshness (max-age, or s-maxage
   * for shared caches) plus any stale serving it allows (stale-while-revalidate, stale-if-error). Null when it names none.
   */
  const lifetime = (value: string): number | null => {
    const found = [...value.matchAll(/(?:^|,)\s*(max-age|s-maxage|stale-while-revalidate|stale-if-error)\s*=\s*"?(\d+)/gi)].map((m) => ({ name: m[1]!.toLowerCase(), seconds: Number(m[2]) }));
    if (!found.length) return null;
    const longest = (names: string[]): number => Math.max(0, ...found.filter((d) => names.includes(d.name)).map((d) => d.seconds));
    return longest(["max-age", "s-maxage"]) + longest(["stale-while-revalidate", "stale-if-error"]);
  };
  const rulesFor = (path: string) => config.headers.filter((r) => matches(r.source, path));

  test("a missing record artifact cannot receive long-lived immutable caching", () => {
    const missing = `/wallprint/records/wp-not-published-v1/${HEX64}.json`;
    assert.ok(!existsSync(new URL(`../publication/records/wp-not-published-v1/${HEX64}.json`, import.meta.url)), "the artifact really is not published");
    const headers = headersFor(missing);
    const cache = headers["Cache-Control"] ?? "";
    assert.ok(/must-revalidate/i.test(cache) && (lifetime(cache) ?? Infinity) <= 300, `${missing}: ${cache}`);
    for (const [key, value] of Object.entries(headers)) {
      if (isCacheHeader(key)) assert.ok(!/immutable/i.test(value) && (lifetime(value) ?? 0) <= 300, `${missing} ${key}: ${value}`);
    }
  });

  test("no rule matching /wallprint/records/** grants immutable", () => {
    for (const p of recordPaths) {
      for (const rule of rulesFor(p)) for (const h of rule.headers) assert.ok(!/immutable/i.test(h.value), `${rule.source} gives ${p} ${h.key}: ${h.value}`);
    }
  });

  test("no rule matching /wallprint/records/** grants a max-age or s-maxage above 300 seconds, stale serving included", () => {
    for (const p of recordPaths) {
      for (const rule of rulesFor(p)) for (const h of rule.headers) {
        if (isCacheHeader(h.key)) assert.ok((lifetime(h.value) ?? 0) <= 300, `${rule.source} gives ${p} ${h.key}: ${h.value}`);
      }
    }
  });

  test("an existing published record still receives the short, revalidating policy, artifact and standing alike", () => {
    const artifact = `/wallprint/records/${published.recordId}/${published.digest}.json`;
    const standing = `/wallprint/records/${published.recordId}/index.json`;
    assert.ok(existsSync(new URL(`../publication/records/${published.recordId}/${published.digest}.json`, import.meta.url)), "the record is in the committed store");
    assert.equal(headersFor(artifact)["Cache-Control"], CACHE_SHORT, artifact);
    assert.equal(headersFor(standing)["Cache-Control"], CACHE_SHORT, standing);
    assert.equal(headersFor(artifact)["Content-Security-Policy"], `${PUBLIC_CSP}; frame-ancestors 'none'`, "the route policy still applies");
  });
});

describe("the shell", () => {
  const html = shellHtml({ js: "wallprint.0123456789abcdef.js", css: "wallprint.0123456789abcdef.css", mark: "brand/mark.0123456789abcdef.png", resolverBase: BASE });

  test("carries the same CSP as a meta tag, loads one same-origin script and stylesheet, no inline script, no inline style", () => {
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${PUBLIC_CSP}">`));
    assert.equal((html.match(/<script\b/g) ?? []).length, 1);
    assert.ok(html.includes('<script src="/wallprint/wallprint.0123456789abcdef.js" defer></script>'));
    assert.ok(html.includes('<link rel="stylesheet" href="/wallprint/wallprint.0123456789abcdef.css">'));
    assert.ok(html.includes('href="/wallprint/brand/mark.0123456789abcdef.png"'));
    assert.ok(!/<script>|<style|\sstyle="|\son[a-z]+="/.test(html), "no inline script, style element, style attribute or event handler");
    assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  });

  test("names the resolver base for the share form, escaped, and refuses a base that is not one HTTPS origin", () => {
    assert.ok(html.includes(`data-resolver-base="${BASE}"`));
    for (const bad of [`${BASE}/`, ["http:", "//", "walletwall.org"].join(""), `${BASE}" onload="x`, ""]) {
      assert.throws(() => shellHtml({ js: "a.js", css: "a.css", mark: "brand/mark.png", resolverBase: bad }), /resolver base/, bad);
    }
  });

  test("asset names are file names under the route, never a URL or a path that leaves it", () => {
    for (const [js, css, mark] of [["../x.js", "a.css", "brand/m.png"], ["a.js", "//evil/a.css", "brand/m.png"], ["a.js", "a.css", "https:x"]] as const) {
      assert.throws(() => shellHtml({ js, css, mark, resolverBase: BASE }), /asset/);
    }
  });
});
