import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CACHE_IMMUTABLE, CACHE_SHORT, hostConfig, PUBLIC_CSP, shellHtml } from "../lib/host-config.ts";

/**
 * What the host must serve for the public resolver, as data: the rewrites that send /wallprint/<id> to the one shell,
 * the cache rules (immutable only for bytes whose names change when they change), and the page's security headers.
 * The rules are scoped to /wallprint and carry no site-wide setting, so merging them into the product's configuration
 * changes nothing outside the route. Sources are tested as anchored regular expressions, which is how these plain-regex
 * Vercel sources behave (no named parameters are used).
 */

const config = hostConfig();
const matches = (source: string, path: string): boolean => new RegExp(`^${source}$`).test(path);
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

  test("every rewrite sends a /wallprint path to the one shell, and only record-shaped paths are rewritten", () => {
    for (const r of config.rewrites) {
      assert.ok(r.source === "/wallprint" || r.source.startsWith("/wallprint/"), r.source);
      assert.equal(r.destination, "/wallprint/index.html");
    }
    const rewritten = (p: string): boolean => config.rewrites.some((r) => matches(r.source, p));
    for (const p of ["/wallprint", "/wallprint/", "/wallprint/wp-identity-corrected-v1"]) assert.ok(rewritten(p), p);
    for (const p of ["/wallprint/records/wp-x/index.json", `/wallprint/records/wp-x/${HEX64}.json`, "/wallprint/index.json", "/wallprint/WP-X", "/wallprint/a/b", "/whale-watcher", "/", "/wallprint/wp-x.json"]) assert.ok(!rewritten(p), p);
  });

  test("immutable caching only for names that change when the bytes change: artifacts by digest, hashed script, stylesheet, fonts and mark", () => {
    for (const p of [`/wallprint/records/wp-x/${HEX64}.json`, "/wallprint/wallprint.0123456789abcdef.js", "/wallprint/wallprint.0123456789abcdef.css", "/wallprint/fonts/sora-latin-wght-normal.0123456789abcdef.woff2", "/wallprint/brand/mark.0123456789abcdef.png"]) {
      assert.equal(headersFor(p)["Cache-Control"], CACHE_IMMUTABLE, p);
    }
    for (const p of ["/wallprint/records/wp-x/index.json", "/wallprint/index.json", "/wallprint/index.html", "/wallprint", "/wallprint/wp-identity-corrected-v1"]) assert.equal(headersFor(p)["Cache-Control"], CACHE_SHORT, p);
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
