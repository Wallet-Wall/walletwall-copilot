# @walletwall/wallprint-web

The public WallPrint resolver: a static page that locates a deliberately published disclosure by URL, proves its bytes
and renders it with the canvas's own WallPrint renderer. Not published to npm; built by `scripts/build-wallprint-public.ts`
into `dist/wallprint-public` and copied into the product deployment (`docs/WALLPRINT_PUBLIC_RESOLVER.md`).

- `lib/` is DOM-free and store-injected: `canonical-form.ts` (RFC 8785, pinned against the engine), `digest.ts` (SHA-256
  through Web Crypto), `shape.ts`, `standing.ts` and `artifact.ts` (strict readers of the two published documents),
  `resolve.ts` (seven outcomes, two fixed fetches, no redirect), `view.ts` (the renderer's input in public mode).
- `browser/page.ts` is the only DOM module: same-origin fetch without credentials, refusing redirects; one markup sink.
- `publication/` is the committed store: `records/<id>/<digest>.json` (immutable), `records/<id>/index.json` (standing),
  `index.json` (publication index). Written only by `npm run wallprint:publish`.
- `test/` runs under `npm test`; `tsconfig.json` adds the DOM library for the page module.

Contract: `spec/WALLPRINT.md`, "Public resolver". Principle: WalletWall isn't always right. WallPrint keeps the record.
A resolver locates a disclosure. It does not make that disclosure authoritative.
