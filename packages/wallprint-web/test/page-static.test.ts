import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Static proofs over the public resolver's source: the page talks to its own origin only, follows no redirect, stores
 * nothing, reads no clock, generates no identifier, names no host, evaluates no code, and writes markup through exactly
 * one sink (the renderer's escaped output). The library never fetches: the page injects the store.
 */

const here = decodeURIComponent(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const files = (sub: string): [string, string][] => readdirSync(join(here, sub)).filter((f) => f.endsWith(".ts")).map((f): [string, string] => [`${sub}/${f}`, strip(read(join(here, sub, f)))]);
const page = strip(read(join(here, "browser", "page.ts")));
const lib = files("lib");
const all = [["browser/page.ts", page] as [string, string], ...lib];

describe("the public resolver's source", () => {
  test("no module names a host, reads a clock, generates an identifier, persists anything, evaluates code or mentions telemetry", () => {
    for (const [name, code] of all) {
      assert.ok(!/https?:\/\//.test(code), `${name}: a URL literal`);
      assert.ok(!/walletwall\.(com|io|xyz|app|dev|org)|vercel\.app|googleapis\.com|upstash/i.test(code), `${name}: names a host`);
      assert.ok(!/Date\.now|new Date\(|Math\.random|randomUUID|crypto\.getRandomValues|hostname|navigator\.userAgent|userInfo/.test(code), `${name}: clock or identity`);
      assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|serviceWorker|BroadcastChannel|postMessage|sendBeacon/.test(code), `${name}: persistence or messaging`);
      assert.ok(!/\beval\s*\(|new\s+Function\b|\bimport\s*\(|importScripts|document\.write|setAttribute\(\s*["']style|srcdoc|javascript:/.test(code), `${name}: code evaluation or a style sink`);
      assert.ok(!/(sentry|posthog|mixpanel|amplitude|appinsights|bugsnag|datadog|telemetry|analytics|crashpad)/i.test(code), `${name}: telemetry`);
      assert.ok(!/location\.(assign|replace|href\s*=)|window\.open|history\.(push|replace)State|<meta[^>]*refresh/i.test(code), `${name}: a redirect primitive`);
      assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(code), `${name}: a network primitive other than fetch`);
      assert.ok(!/from\s+["']node:|require\(/.test(code), `${name}: a Node module`);
    }
  });

  test("the library never fetches and never touches the DOM; the page fetches same-origin only, without credentials, refusing redirects", () => {
    for (const [name, code] of lib) {
      assert.ok(!/\bfetch\s*\(|\bdocument\b|\bwindow\b|\blocation\b|innerHTML/.test(code), `${name}: the library is DOM-free and store-injected`);
    }
    const fetches = [...page.matchAll(/fetch\(([\s\S]*?)\)\s*;/g)];
    assert.equal(fetches.length, 1, "exactly one fetch call");
    const call = fetches[0]![1]!;
    assert.ok(call.startsWith("path,"), "the path comes from the resolver's fixed store paths");
    for (const opt of ['mode: "same-origin"', 'credentials: "omit"', 'redirect: "error"', 'referrerPolicy: "no-referrer"', 'method: "GET"']) assert.ok(call.includes(opt), opt);
    assert.equal((page.match(/\.innerHTML\s*=/g) ?? []).length, 1, "one markup sink: the renderer's output");
    assert.ok(!/innerHTML\s*\+=|insertAdjacentHTML|outerHTML/.test(page));
    assert.ok(page.includes("location.pathname") && page.includes("location.search") && !page.includes("location.hash"), "the path and query are read; the fragment never is");
  });

  test("the page renders through the canvas renderer and the public view module only, and installs the canvas's own client script", () => {
    assert.ok(page.includes("renderWallPrint(view, LABELS)") && page.includes("renderReferenceOutcome(view)"));
    assert.ok(page.includes("publicView(resolution, base, WALLPRINT_VOCABULARY, { servedFrom: location.origin, landing })"));
    assert.ok(page.includes("resolvePublic(`${location.pathname}${location.search}`, store)"));
    assert.ok(page.includes("wallPrintClient();"));
    assert.ok(page.includes('app.dataset["resolverBase"]'), "the resolver base is read from the shell, never from code");
  });

  test("a failure while resolving or rendering ends in a fixed sentence written as text, never an endless spinner and never markup", () => {
    assert.ok(/try\s*\{[\s\S]*resolvePublic[\s\S]*\}\s*catch\s*\{/.test(page), "the whole resolution and rendering is inside one try");
    assert.ok(page.includes("app.textContent = PAGE_FAILURE;"));
    assert.ok(/const PAGE_FAILURE = "This page could not show a result for this address\. Nothing is shown in its place\.";/.test(page));
  });
});
