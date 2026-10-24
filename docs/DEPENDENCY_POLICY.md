# Dependency and supply-chain policy

Facts below were measured on the audited commit with `npm ci`, `npm ls`, `npm audit`, `npm audit signatures` and a scan of `package-lock.json`. Re-measure before a release.

## What users actually receive

The plugin ships one committed file, `plugin/server/walletwall-mcp.mjs`, built from source by `npm run build:bundle` and checked for reproducibility in CI (`npm run verify:bundle`, hash in `security/bundle.sha256`). It contains code from exactly three third-party packages, whose license texts are in `plugin/THIRD_PARTY_NOTICES.md` (`npm run verify:notices`):

| Bundled package | Version | License |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` (low-level server and stdio transport only) | 1.32.2 | MIT |
| `zod` | 4.6.7 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |

The bundle imports only `node:crypto` and `node:process`. Nothing is installed or downloaded when the plugin runs: there is no `node_modules` in the plugin, no auto-update and no dynamic `import()` or `eval`.

## Inventory

| Class | Count | Notes |
| --- | --- | --- |
| Direct runtime dependencies (`packages/mcp`) | 2 | `@modelcontextprotocol/sdk`, `zod` (exact versions) |
| Direct development dependencies | 6 | `@eslint/js`, `@types/node`, `esbuild`, `eslint`, `typescript`, `typescript-eslint` (exact versions) |
| Packages in the production install tree | 97 | The SDK's own dependencies. Most are HTTP-server libraries (`express`, `hono`, `cors`, `body-parser`, `eventsource`, `jose`, ...) that exist only because the SDK package declares them. **None is bundled or imported by WalletWall code** (`PRIV-015`: the bundle's module graph is checked against an allow-list) |
| Third-party lockfile entries | 213 (97 production tree, 116 development only) | `lockfileVersion` 3, committed; plus two workspace entries for `packages/mcp` |
| Install scripts | 1 | `esbuild` (development only). It verifies its platform binary; it does not run for plugin users |
| Native / platform-specific packages | 26 | The `@esbuild/*` binaries, optional, development only. Nothing native is shipped |
| Lockfile registry | `registry.npmjs.org` only | Every third-party entry has an `integrity` hash; no git, tarball-URL or other-registry source |
| Licenses in the tree | MIT, ISC, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0 | No copyleft in the production tree |

## Verified properties

| Property | How it is verified |
| --- | --- |
| Committed lockfile, install from lockfile | `npm ci` in every CI job |
| No unexpected registry | scan of `package-lock.json` (all `resolved` hosts are `registry.npmjs.org`) |
| No unsafe install script in what users receive | the plugin has no install step; the only install script in the tree is `esbuild` (dev) |
| No telemetry package | `privacy/static.test.ts` scans the production lockfile for telemetry, crash and fingerprint packages |
| No dynamic download, no auto-update | the shipped bundle contains no network primitive, `require`, `eval`, `new Function` or `import()` (`PRIV-015`) |
| No hidden HTTP transport | zero sockets at startup, read from the OS socket table (`PRIV-016`); no `streamableHttp`, `sse`, `client`, `auth`, `express`, `hono`, `cors` or `ajv` module in the bundle graph (`PRIV-015`) |
| Removed Ajv dynamic-code path stays absent | the SDK's Ajv validator is replaced at build time by a stub that refuses to run; the bundle contains no `new Function` (`scripts/bundle-config.ts`, `PRIV-015`) |
| Known vulnerabilities reviewed | `npm audit --omit=dev --audit-level=high` runs in CI (`npm run audit:prod`). On the audited commit `npm audit` reports 0 vulnerabilities for the production tree and for the full tree |
| Registry signatures and provenance | `npm audit signatures` on the audited commit: all 188 installed packages have verified registry signatures, 47 have verified provenance attestations |

## Held updates (Dependabot ignores)

Every ignore in `.github/dependabot.yml` is narrow (it names the held versions, not "all majors"), explained next to the entry and given a review date, so updates are not silently disabled forever.

| Dependency | Ignored | Why | Remove when | Review by |
| --- | --- | --- | --- | --- |
| `typescript` | `7.x` | `typescript-eslint` 8.x supports TypeScript `<6.1.0` and refuses TypeScript 7 at install (closed PR #1) | `typescript-eslint` supports TypeScript 7 | 2027-01-31 |
| `@types/node` | `25.x`, `26.x` | The type definitions must match the Node.js major that CI tests (24) | the CI Node.js major is raised | 2027-01-31, or whenever the CI Node.js major changes |

TypeScript 6.x and `@types/node` 24.x minor and patch updates, and any major published after the held ones, still open pull requests.

## Rules for dependency changes

- A new runtime dependency, or a new install script, native module, network-capable library or dynamic download, needs an explicit justification and maintainer approval (`package.json` and `package-lock.json` are code-owned).
- Versions are pinned exactly. After any change to a bundled package run `npm run build:bundle`, `npm run gen:notices`, `npm run gen:plugin-manifest` and `npm run gen:plugin-artifact`, and review the diff of `plugin/server/walletwall-mcp.mjs`.
- GitHub Actions are pinned to full commit SHAs (checked by `packages/mcp/test/repo/workflows.test.ts`); Dependabot proposes updates to them weekly.
