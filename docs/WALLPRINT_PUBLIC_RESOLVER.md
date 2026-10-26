# WallPrint public resolver

> WalletWall isn't always right. WallPrint keeps the record.
> A resolver locates a disclosure. It does not make that disclosure authoritative.

The public resolver gives a WallPrint portable reference a stable HTTPS form on WalletWall's product domain and resolves
it to the exact published record and digest, then renders the disclosure with the same WallPrint document the canvas
shows. It is static files and one page script: no server code, no database, no write endpoint, no signing. The contract
is in `spec/WALLPRINT.md` ("Public resolver"); this page is the deployment and operations view.

## Shape

```text
WallPrint record (walletwall-copilot engine)
    ↓  deliberate publication            scripts/wallprint-publish.ts
immutable public disclosure + standing   packages/wallprint-web/publication/
    ↓  static build                      scripts/build-wallprint-public.ts
dist/wallprint-public/wallprint/         shell, hashed script and stylesheet, fonts, mark, store
    ↓  copied into the product deployment (sirmrdrgod/walletwall, public/wallprint)
https://walletwall.org/wallprint/<recordId>?reference=0.1&wallprint=0.1&digest=<hex64>[&target=<section>]
    ↓  the page fetches two static files and proves the bytes
RESOLVED · UNAVAILABLE · DIGEST_MISMATCH · NOT_COMPARED · MALFORMED_REFERENCE · UNSUPPORTED_VERSION · UNREACHABLE
```

The canonical reference stays `walletwall://wallprint/<recordId>?reference=0.1&wallprint=0.1&digest=<hex64>[&target=…]`.
The HTTPS form is that text with `walletwall://wallprint/` replaced by `<resolverBase>/wallprint/`: deterministic,
lossless, and versioned by the reference's own grammar (`toHttpsUrl` / `parseHttpsUrl` in `reference.ts`). The public
page's QR code encodes the HTTPS form so any camera opens it; the `walletwall:` reference is printed beside it as the
same locator. The canvas's QR code still encodes the `walletwall:` text, because the plugin names no endpoint.

## Canonical public domain

Reconnaissance (2026-10-26): WalletWall runs exactly one Vercel project, `walletwall`, which serves `walletwall.org`
and every product subdomain; `walletwall.app` and `walletwall.space` redirect to `.org`. The resolver therefore lives
at `https://walletwall.org/wallprint/`, served by the existing product deployment. No new domain, project or
subdomain is created. The base is a publication setting (`packages/wallprint-web/publication/index.json`,
`resolverBase`), never a literal in engine code; the build writes it into the shell, and the page admits it only through
the codec's `isResolverBase` check.

## The store

| Path (under `/wallprint/`) | What | Mutability | Cache |
| --- | --- | --- | --- |
| `records/<id>/<digest>.json` | the immutable public disclosure: RFC 8785 bytes of the artifact (type, version, record id, digest, canonical preimage, title, construction, registry names, validation, digest check, receipt, replay, diff, supersedes) | written once; identical bytes are idempotent, different bytes are a conflict | `public, max-age=31536000, immutable` |
| `records/<id>/index.json` | the record's standing: publications (digest, WallPrint version, instant), lifecycle ledger, supersedes, successor, lineage | append-only; a rewritten history is refused | `public, max-age=300, must-revalidate` |
| `index.json` | the publication index: resolver base, route, one small entry per publication (id, digest, version, instant, lifecycle state, successor, predecessor) | regenerated from the standings | `public, max-age=300, must-revalidate` |
| `index.html` | the one page shell every record URL is rewritten to | rebuilt with each release | `public, max-age=300, must-revalidate` |
| `wallprint.<hash>.js`, `wallprint.<hash>.css`, `fonts/<name>.<hash>.woff2`, `brand/mark.<hash>.png` | the content-hashed script, stylesheet, self-hosted OFL fonts and mark: every name changes when its bytes change | a new name per change | `public, max-age=31536000, immutable` |
| `fonts/OFL-*.txt` | the font licence texts | as published by the font projects | host default |

An artifact's name is its record's digest, which covers the canonical record; the other bytes in that file (title,
registry names, carried engine results) are kept fixed by the publisher's no-overwrite rule (different bytes under the
same id and digest are a conflict), which is what makes immutable caching of the whole file correct.

Record ids are the WallPrint grammar restricted to one path segment on every filesystem and URL
(`[a-z0-9][a-z0-9_-]{2,63}`, and no Windows reserved device name such as `con` or `nul`); a record with another id is
valid but not publishable. Ids are intentionally public and
the index lists them: publication is deliberate, so enumeration of what was published is not a leak, and no
security-through-obscurity token is added. Each record id has exactly one committed digest, so each record directory
holds one artifact.

Lifecycle standing lives in the standing document, not in the immutable bytes: when a record is later corrected,
superseded or withdrawn, the publisher extends its standing (the ledger appends, the successor is set once) and the
artifact is untouched. A corrected or withdrawn record stays resolvable at its own URL and is never redirected; the
page prints its standing and links to the successor as a choice.

## Publication

```bash
npm run wallprint:publish -- --export <disclosure-export.json> --published-at 2026-10-26T18:00:00.000Z --resolver-base https://walletwall.org
npm run verify:wallprint-publication
```

The export is one record exactly as the engine exported it (the fixture builder's `DisclosureRecord` plus title,
construction and registry names). Publication admits it only when the record validates, its canonical preimage digests to
its digest, every carried engine result (validation, digest check, receipt verification, replay, diff, lifecycle ledger,
lineage) agrees with the record, and the privacy gate finds nothing credential-, path-, environment- or
control-shaped, no e-mail or IP address, no URL, no host name or wallet address outside the record's own content and no
private-metadata key name. The closed schemas admit no other field. The store must also stay a consistent graph: a
published successor binds the predecessor that names it, and publishing a successor publishes the predecessor's
extended standing with it. Nothing is written unless every export publishes (or is an expected refusal), no conflict
exists and the graph is consistent. There is no public write path: publication runs in the repository, by the owner, and reaches the
deployment through the ordinary release of the product site.

The committed store holds the engine-built synthetic lineages (`npm run wallprint:publish -- --from-fixtures …`),
published at `2026-10-26T18:00:00.000Z`; the altered-after-commit copy (`wp-identity-altered-v1`) was refused, as it must
be. Whether synthetic disclosures should remain published on the production domain is an owner decision before the
host wiring ships; removing them before the first production release is not a withdrawal of anything that was ever
live.

## The page

`packages/wallprint-web/browser/page.ts`, bundled by esbuild into one inert script (allow-listed inputs, no Node module,
no clock, no identifier, no persistence, no code evaluation, no host name, one same-origin `fetch` with
`credentials: "omit"` and `redirect: "error"`, one markup sink). It reads the page's own path and query (never the
fragment), parses them with the canonical codec, fetches the standing and one artifact, and proves the bytes: one
canonical-form JSON object of the fixed fields for that record id, whose canonical preimage is itself in canonical form
(the browser canonicalizer, `lib/canonical-form.ts`, is pinned against the engine's over every published record),
whose carried results (validation, digest check, receipt and verification, replay, diff, supersedes) are consistent with
it, and whose SHA-256 (`lib/digest.ts`, Web Crypto) is compared with the artifact's digest and the URL's through the
codec's `resolveReference`. The standing is then checked against its own hash-chained ledger by the engine's history
rules (`lib/ledger.ts`) and against the proved record and digest. Only `RESOLVED` renders record content; the renderer is the canvas's `wallprint-render.mjs` in
public mode (`canvas/README.md`, item 16), so Receipt, Replay, history, assessments, provenance, the portable reference
and the QR code are the same instrument. Section deep links use the reference's closed `target` table and the client's
allow-listed focus; an unknown target is refused by the parser before anything is fetched.

Every resolved page says what the digest covers: the record's canonical bytes, and not the title, the registry names or
the engine's receipt, replay and diff results carried beside it, which are only checked for consistency; the standing is
the store's index, and nothing signs it. A copy served from another origin than the resolver base (a mirror, a preview
deployment, a local build) says so, naming the base and never the serving origin. The bare route `/wallprint` is a
landing sentence. An unforeseen failure ends in a fixed sentence written as text, never an endless "Resolving...".

The shell carries `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self';
font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'` as a meta tag (so the policy holds whatever the
host's header precedence), and the host serves the same policy with `frame-ancestors 'none'`, `nosniff`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a Permissions-Policy. The page loads no analytics and no
third-party resource; a record id or digest in the URL is therefore never sent anywhere but the same-origin store.

## Host integration (the product repository, a separate change)

Copy `dist/wallprint-public/wallprint/` to the product repository's `public/wallprint/` (Vite copies `public/` to the
build verbatim) and merge the `rewrites` and `headers` of `dist/wallprint-public/vercel.json` into the product's
`vercel.json`. The generated rules are defined and tested in `packages/wallprint-web/lib/host-config.ts`; every one is
scoped to `/wallprint` and none is a site-wide setting (no `cleanUrls`, `trailingSlash` or `redirects`), so nothing
outside the route changes. Requirements:

- the three rewrites (`/wallprint`, `/wallprint/`, `/wallprint/<record id>` to `/wallprint/index.html`) come **before**
  the SPA catch-all rewrite (rewrites apply in order; the catch-all would otherwise render the product's landing page);
- the header rules come **after** the product's own `/(.*)` header rule, so that for `/wallprint` paths the route's
  Content-Security-Policy is the one served (the shell also carries the same policy as a meta tag, so the document is
  held to it either way); check it on a preview deployment with `curl -sI` on a record URL and an artifact URL;
- a missing file under `/wallprint/records/` must answer **404**. The product's SPA catch-all excludes `.json` paths
  today, so it does; keep it that way. A host that answers 200 with another page for an unknown JSON path turns every
  unpublished record into "Store unreachable" instead of "Record unavailable" (never into a record).

Static files win over rewrites, so the store's JSON files are served directly; `/wallprint/<id>` has no file and is
rewritten to the shell. The product's existing `test/product-subdomain-navigation.test.mjs` pins the `/api` and SPA
rewrites and must keep passing; the new rules do not touch them. The product's `@vercel/analytics` lives in the SPA shell,
not in this page, so viewing a disclosure records no page view there. Vercel's own request logs are the host's
operational logs and retain no query history on WalletWall's side.

Preview deployments of the product repository exercise the real routing; production promotion and DNS are owner acts.

## Cost

Static delivery only: no function, no database, no standing compute. One record is one artifact of roughly 5 to 11 KB
plus a standing of about 1 KB; the committed store of 13 synthetic records is about 130 KB. A page view fetches the shell
(short cache), the hashed script (about 167 KB, immutable) and stylesheet (about 68 KB, immutable), four fonts (about
100 KB, immutable) and two small JSON files; every repeat view of the same record is served from caches. Marginal cost per
record is storage and bandwidth in the product deployment's existing plan; no new service is introduced.

## What it is not

The resolver recomputes no evidence state, authority, receipt or replay semantics, assessor independence or factual
correctness: it prints the engine's recorded results as published. A digest match proves bytes, not who published them
or whether any claim is true; there is no signature, no key, no DID, no chain anchor and no issuer attestation. There is
no public write endpoint, no search endpoint and no assessor import. `UNAVAILABLE` is not invalid, `DIGEST_MISMATCH` is
not forgery, `UNREACHABLE` says nothing about the record.

## Verification

- `npm run verify:wallprint-publication`: every artifact proves itself, every standing verifies and names exactly its
  artifact, the index is byte for byte what the standings regenerate.
- `npm run verify:wallprint-public`: the site builds into an owned temporary directory and the bundle is inert and
  bounded.
- Tests: `packages/mcp/test/wallprint/publication.test.ts`, `public-url.test.ts`, `packages/mcp/test/canvas/wallprint-public.test.ts`,
  `packages/wallprint-web/test/*.test.ts` (canonical parity, the resolve state machine, the committed store, the page's
  static proofs, and independent decoding of every drawn QR code with jsQR, a development-only dependency).
