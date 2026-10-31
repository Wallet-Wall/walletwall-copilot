import { RESOLVER_ROUTE, isResolverBase } from "../../mcp/src/wallprint/reference.ts";

/**
 * What the host serves for the public resolver, as data, so it can be tested before it is merged into the product's
 * deployment configuration: the rewrites that send `/wallprint/<record id>` to the one shell, the cache rules, the
 * page's security headers, and the shell itself.
 *
 * Every rule is scoped to the route and no site-wide setting is carried (no cleanUrls, trailingSlash or redirects), so
 * merging changes nothing outside `/wallprint`. Immutable caching is given only to the content-hashed script,
 * stylesheet, fonts and mark: a hashed name never serves different bytes. Their rule answers a 404 the same way;
 * docs/WALLPRINT_PUBLIC_RESOLVER.md says what a host does about that. Record JSON is revalidated (CACHE_SHORT), the
 * artifact by digest included: a host applies a path's header rule to whatever the path answers, a 404 included, and a
 * record URL goes from 404 to 200 when the record is published, so an immutable rule there would cache the 404 of a
 * not-yet-published artifact for a year in every browser and shared cache that saw it. The artifact's bytes stay fixed
 * by the publisher's no-overwrite rule, so revalidating an unchanged artifact costs a 304. The security rule
 * comes last among these rules; whether it is the route's word on the policy also depends on where the rules are merged
 * relative to the product's own `/(.*)` rule (docs/WALLPRINT_PUBLIC_RESOLVER.md says: after it). The shell carries the
 * same policy as a meta tag, so the document is held to it either way.
 */

export const PUBLIC_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_SHORT = "public, max-age=300, must-revalidate";

export interface HostHeader {
  key: string;
  value: string;
}
export interface HostRule {
  source: string;
  headers: HostHeader[];
}
export interface HostConfig {
  rewrites: { source: string; destination: string }[];
  headers: HostRule[];
}

const header = (key: string, value: string): HostHeader => ({ key, value });
const SHELL = `${RESOLVER_ROUTE}index.html`;
/** A record path under the route: the publishable record id grammar, nothing else. */
const RECORD_PATH = "/wallprint/([a-z0-9][a-z0-9_-]{2,63})";

export function hostConfig(): HostConfig {
  return {
    rewrites: [
      { source: "/wallprint", destination: SHELL },
      { source: "/wallprint/", destination: SHELL },
      { source: RECORD_PATH, destination: SHELL },
    ],
    headers: [
      { source: "/wallprint/records/([a-z0-9][a-z0-9_-]{2,63})/([0-9a-f]{64})\\.json", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint/records/([a-z0-9][a-z0-9_-]{2,63})/index\\.json", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint/index\\.json", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint/index\\.html", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint/", headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: RECORD_PATH, headers: [header("Cache-Control", CACHE_SHORT)] },
      { source: "/wallprint/wallprint\\.([0-9a-f]{16})\\.(js|css)", headers: [header("Cache-Control", CACHE_IMMUTABLE)] },
      { source: "/wallprint/fonts/([a-z0-9-]+)\\.([0-9a-f]{16})\\.woff2", headers: [header("Cache-Control", CACHE_IMMUTABLE)] },
      { source: "/wallprint/brand/mark\\.([0-9a-f]{16})\\.png", headers: [header("Cache-Control", CACHE_IMMUTABLE)] },
      {
        source: "/wallprint(/.*)?",
        headers: [
          header("Content-Security-Policy", `${PUBLIC_CSP}; frame-ancestors 'none'`),
          header("X-Content-Type-Options", "nosniff"),
          header("Referrer-Policy", "no-referrer"),
          header("X-Frame-Options", "DENY"),
          header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
          header("Cross-Origin-Opener-Policy", "same-origin"),
        ],
      },
    ],
  };
}

/** A file name the shell may reference under the route: letters, digits, dots and dashes, one optional `brand/` or `fonts/` directory. */
const ASSET_RE = /^(?:(?:brand|fonts)\/)?[a-z0-9][a-z0-9.-]{0,95}$/;
const attr = (s: string): string => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The one static shell every URL under the route is rewritten to. Throws when a name is not a file under the route or the base is not one HTTPS origin. */
export function shellHtml(assets: { js: string; css: string; mark: string; resolverBase: string }): string {
  for (const name of [assets.js, assets.css, assets.mark]) if (!ASSET_RE.test(name) || name.includes("..")) throw new Error("an asset name must be a file under the route");
  if (!isResolverBase(assets.resolverBase)) throw new Error("the resolver base must be exactly one HTTPS origin");
  const r = RESOLVER_ROUTE;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${PUBLIC_CSP}"><meta name="color-scheme" content="light"><title>WallPrint</title><link rel="icon" type="image/png" sizes="96x96" href="${r}${attr(assets.mark)}"><link rel="stylesheet" href="${r}${attr(assets.css)}"></head><body><main id="app" data-resolver-base="${attr(assets.resolverBase)}" data-route="${r}" data-motion="full"><noscript><p class="note">JavaScript is required: this page computes the SHA-256 of the published bytes before it shows them, so nothing unchecked is rendered.</p></noscript><p class="muted">Resolving...</p></main><p id="view-status" class="ww-sr" role="status" aria-live="polite"></p><p id="copy-status" class="copy-status" role="status" aria-live="polite"></p><script src="${r}${attr(assets.js)}" defer></script></body></html>\n`;
}
