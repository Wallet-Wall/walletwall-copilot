# Public discovery readiness

Status: **prepared, nothing submitted.** This record covers the pass that cleaned stale pre-public naming, checked Agent Plugins 1.0 conformance, and prepared (but did not send) the artifacts for GitHub discovery paths. Date: 2026-10-24 (UTC). It is not a certification and makes no claim about how any registry or catalog will treat WalletWall.

## Baseline

| Item | Value |
| --- | --- |
| Repository / visibility | `Wallet-Wall/walletwallrus-copilot`, PUBLIC |
| Baseline `main` | `8feaa92c1dc9b0d0fcf421e41c70a515de6d8561` (tree `8c68dfadfc4b46a6feb491ad0c87f0828e0383b4`), clean working tree |
| Plugin version | `0.2.0` (`plugin/plugin.json`) |
| MCP engine version | `0.1.0` (`packages/mcp/src/version.ts`; npm workspace `@walletwall/mcp`, `private: true`, not published) |
| Marketplace name before / after | the former `-private` name, then `walletwall` |
| Copilot CLI used for install checks | 1.0.103 |

## What changed

| Change | Why |
| --- | --- |
| `.github/plugin/marketplace.json`: name `walletwall`; description "Public WalletWall Agent Plugin source and local MCP integration." | The old name and "not published anywhere" wording were stale after the public flip. The wording claims no acceptance by any marketplace. |
| `README.md` install command `copilot plugin install walletwall@walletwall` | Matches the active marketplace. |
| `evals/run-agent-evals.ts` reads the marketplace name from `marketplace.json` | The harness can no longer drift from the manifest. |
| `package.json` description and `SECURITY.md` ("private phase") | Stale pre-public wording. |
| "Historical record" banners on `docs/DESKTOP_INSTALL_PROOF.md`, `docs/PUBLIC_RELEASE_AUDIT.md`, `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md` | They keep the old name because it was the real identity then. |
| `evals/results/*.json` untouched | Recorded evidence is immutable. |
| New test `packages/mcp/test/repo/discovery-readiness.test.ts` | Old name forbidden in active files, allowed only in banner-labelled history and recorded results. |

No plugin, MCP, canvas or lockfile file changed, so every artifact hash is unchanged (below).

### Classification of the earlier stale-name search

| Class | Files |
| --- | --- |
| ACTIVE_CONFIGURATION (fixed) | `.github/plugin/marketplace.json`, `evals/run-agent-evals.ts` |
| ACTIVE_DOCUMENTATION (fixed) | `README.md`, `package.json` description, `SECURITY.md` |
| HISTORICAL_EVIDENCE (kept, labelled) | `docs/DESKTOP_INSTALL_PROOF.md`, `docs/PUBLIC_RELEASE_AUDIT.md`, `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md`, `evals/results/2026-10-24-run-1..4.json` |
| TEST_FIXTURE | none |
| Kept as true statements | README "Status: Pre-release" (WWEP is a 0.1 draft) and "Nothing here has been published to npm ... or a Copilot marketplace"; `packages/mcp/package.json` "Not published." |

## Install command, as tested

Isolated `COPILOT_HOME`, Copilot CLI 1.0.103, from this checkout:

```text
copilot plugin marketplace add <path to this checkout>   ->  Marketplace "walletwall" added successfully.
copilot plugin install walletwall@walletwall             ->  Plugin "walletwall" installed successfully. Installed 1 skill.
copilot plugin list --json                               ->  { name: "walletwall", marketplace: "walletwall", version: "0.2.0", enabled: true, source: "live" }
```

The CLI help documents `copilot plugin marketplace add <source>` with `owner/repo` for GitHub. That form was **not** run: it would register the repository's `main`, which carries the old name until this change is merged. Re-check `copilot plugin marketplace add Wallet-Wall/walletwallrus-copilot` after merge before documenting it.

## Agent Plugins 1.0 conformance

Checked against the live schemas `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` and `mcp.schema.json` (JSON Schema validation of `plugin/plugin.json` and `plugin/mcp.json`: 0 errors) and the repository's structural validator.

| Area | Result | Note |
| --- | --- | --- |
| Plugin manifest | PASS | Only schema-listed fields; `$schema` is the 1.0.0 plugin schema |
| Plugin name `walletwall` | PASS | Lowercase, within 64 characters, no `--` or `..` |
| Version `0.2.0` | PASS | Equals the marketplace entry and `metadata.version` |
| Skills | PASS | `skills/walletwall-evidence/SKILL.md` at the fixed location |
| MCP configuration | PASS | `mcp.json` with `$schema`; one stdio server, `command: node`, no `env`, no URL |
| Relative paths | PASS | Marketplace `source: "./plugin"`; launch path uses `${PLUGIN_ROOT}` |
| Copilot-specific canvas | PASS | `com.github.copilot/extensions/walletwall-evidence-explorer/` loaded in Copilot Desktop (`docs/DESKTOP_INSTALL_PROOF.md`) |
| `extensions` key in `plugin.json` | NON_BLOCKING_DIFFERENCE | Optional client-specific data; not needed because the canvas is found by directory |
| Marketplace schema | NON_BLOCKING_DIFFERENCE | The Agent Plugins spec publishes no marketplace schema (the URL returns 404); the marketplace file is a Copilot CLI convention, validated by the CLI install above |
| Submission blockers | none found | |

## MCP metadata

| Field | Value |
| --- | --- |
| Server name / key | `walletwall-mcp` (engine id), `walletwall` (MCP server key in `plugin/mcp.json`) |
| Display name | WalletWall MCP |
| Version | 0.1.0 |
| Transport / runtime | stdio only; Node.js >= 22.18 |
| Run command | `node ${PLUGIN_ROOT}/server/walletwall-mcp.mjs` (the bundled single file) |
| Install command | `copilot plugin install walletwall@walletwall` |
| Distribution | Source repository and a single-file bundle inside the plugin. No npm, PyPI, NuGet, OCI or MCPB artifact exists |
| License | Apache-2.0 |
| Repository / docs | `https://github.com/Wallet-Wall/walletwallrus-copilot` |

It stays local stdio. No remote HTTPS endpoint, authentication or backend is proposed.

## Current submission routes (researched 2026-10-24)

| Question | Finding | Source | Confidence |
| --- | --- | --- | --- |
| A. Official MCP Registry mechanism | `mcp-publisher login github` then `mcp-publisher publish` with a `server.json`; not a pull request to the registry repo. GitHub auth requires the name `io.github.<owner>/<server>` (for example `io.github.Wallet-Wall/walletwall-mcp`) | `https://modelcontextprotocol.io/registry/authentication`, `https://github.com/modelcontextprotocol/registry` | Verified |
| D/E. Package identity | A `server.json` needs `packages[]` (`registryType`, `identifier`, `version`, `transport`) or a public `remotes[]`. Private servers are not supported. npm needs `mcpName` in a **published** package; PyPI, NuGet and OCI have their own proofs; `mcpb` accepts a GitHub Release artifact whose URL contains "mcp" plus `fileSha256` | `https://modelcontextprotocol.io/registry/package-types` | Verified |
| Local stdio eligible | Yes: `transport.type: "stdio"` is a first-class case | same | Verified |
| B. GitHub MCP Registry | `https://github.com/mcp` lists about 600 servers. The GitHub blog says to publish to the official registry and then email GitHub's partnerships team (address given in the post) to request inclusion. No current doc found describing automatic ingestion or acceptance criteria | `https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/` | Partly verified; blog age unknown |
| C. Auto-import from another registry | `agentfinder-catalog` imports GitHub's catalog (`https://api.mcp.github.com/.well-known/ai-catalog.json`) hourly and "does not query the general public MCP registry". Whether GitHub's catalog itself imports the official registry is not documented | `https://github.com/github/agentfinder-catalog` README | Unverified |

**WalletWall eligibility: conditional.** Stdio is eligible, but there is no public package artifact. The only package route that does not need npm is an `mcpb` artifact attached to a GitHub Release. That needs a new MCPB bundle (a format and toolchain not yet evaluated here) and a `fileSha256`. The other routes need a publish step that is out of scope. Record this as a dependency; nothing was built or published.

## Agent Finder route (`github/agentfinder-catalog`, researched 2026-10-24)

| Item | Finding |
| --- | --- |
| Plugin | One JSON file per resource at `catalog/<publisher>/<name>.json`; the publisher directory matches the owner (existing directories are lowercase). Pull request, then `python3 scripts/generate_ai_catalog.py` and `--check`; CI regenerates `ai-catalog.json` |
| Plugin media type | `application/vnd.github.copilot-plugin` for a Copilot manifest (`application/vnd.anthropic.claude-plugin+json` only for `.claude-plugin/plugin.json`). `url` is the manifest URL and `metadata.repoPath` its path, as in existing entries |
| MCP | Prefer the entry imported from the GitHub MCP Registry; do not add a contributor-managed MCP entry for a server that is already imported. Raw descriptor URLs are not supported by the MCP reference resolver |
| Skill | One entry per skill file; a skill bundled in a plugin would duplicate the plugin's content |
| Tags | `canvas-only` tags are only for plugins that do nothing without the canvas. WalletWall also ships a skill and an MCP server, so it must not use them |
| Digests | The contributor does not supply content digests; the service computes materialization digests. The only contributor-supplied digest is the icon `sha256` |
| Source and provenance | A public, resolvable URL. Entries point at `main`; the service pins revisions itself |
| Icon | Optional (see below) |
| Duplicate MCP entries | Discouraged by the catalog's CONTRIBUTING guide |

**Recommended set: plugin only.** One entry gives users the plugin with its skill, MCP server and canvas. A separate skill entry would duplicate it. A separate MCP entry needs a public package artifact first (above), and if one is later published to the registry the registry entry must be the only MCP entry. Draft entry: `docs/discovery/agent-finder-catalog-entry.draft.json`. Descriptions avoid compliance, advice, custody, transaction and "truth" claims.

Long description for forms that ask for one: "Inspect stablecoin identity, wallet state, source lineage, conflicts, and vault readiness through WalletWall MCP."

## Icon provenance

| Requirement (catalog `CONTRIBUTING.md`) | WalletWall |
| --- | --- |
| Static PNG, at most 256 KiB, 1 to 512 px | `canvas/brand/walletwall-brick-wallet-96.png`: PNG, 14,184 bytes, 96x96. PASS |
| Immutable URL | Must be `raw.githubusercontent.com/github/agentfinder-catalog/<40-hex-commit>/icons/<publisher>/<asset>.png`, so the asset has to be added to the catalog repository in an asset-only commit first. This is the one case where an upload elsewhere is required |
| SHA-256 | `179a4f9a1b74d0287b8199d5b6316f6b84c7840afbb7a1b4d90d1f43a9a54665` (matches `canvas/brand/brand-sources.json`) |
| Provenance | Derived by uniform downscale from `Wallet-Wall/walletwall-audio-visual-docs` `assets/brand/walletwall-brick-wallet.png` at `d013c06b...` (source SHA-256 `91926a2e...`) |
| Redistribution permission | Needs an explicit `approval` attestation written by the WalletWall owner. `TRADEMARKS.md` says the Apache-2.0 license does not grant rights to the marks, so the attestation is not assumed |
| Service support | The catalog says production declarations follow deployed `github/agentfinder#557` and `github/copilot-ecosystem#1625` |

Result: FINDING (not a defect): the asset is valid, but publication needs the owner's approval text and an asset-only commit in the catalog repository. Skip the icon in the first submission; it is optional. Draft: `docs/discovery/agent-finder-icon-declaration.draft.json` (placeholders intentionally fail validation).

## First public release plan (not created)

| Item | Value |
| --- | --- |
| Tag / title | `v0.2.0` / "WalletWall 0.2.0", matching `plugin.json`, the marketplace entry and `metadata.version`; no version bump is needed |
| Source commit | The merge commit of this pull request. This change touches no file under `plugin/` or `packages/mcp/`, so the hashes below are expected to hold; re-run the checks on that commit |
| Assets | `walletwall-plugin.tar` (`npm run pack:plugin -- <file>`), `walletwall-mcp-0.1.0.tgz` (`npm pack --workspace packages/mcp`), `walletwall-mcp.mjs`, and a `SHA256SUMS` file |
| Notes | Draft in `docs/discovery/release-notes-v0.2.0.draft.md` |
| Signing / attestation | **None.** Do not claim signed releases, provenance attestations or an SBOM; none exist. `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md` lists them as future work |
| License / security | Apache-2.0 (`LICENSE`), `SECURITY.md`, private vulnerability reporting enabled |

## Reproducibility

Rebuilt twice from the same commit; both builds are byte-identical and equal the recorded values.

| Artifact | SHA-256 |
| --- | --- |
| Tool manifest (`security/tool-manifest.json`, RFC 8785) | `2d2f857c2b0c8ef824a3bc59d52baef6895db0209f16830d4a5025800ca815ec` |
| Plugin manifest (`security/plugin-manifest.json`, RFC 8785) | `6554bf9696a8d95031fabcb3440dcc02fe24c042143af55611414d06146b121e` |
| MCP bundle (`plugin/server/walletwall-mcp.mjs`) | `3f30bd32314e196db7f7d1cee5558ac1d9f36aec2191ecb836e6e6a1014332a1` |
| Plugin artifact (`walletwall-plugin.tar`, 17 files) | `b3d4921ae45013940b1feca2e5c4645c5b638873001dc232b2ba4644f4c18290` |
| MCP artifact (`walletwall-mcp-0.1.0.tgz`) | `1f9a76626da1c68c69d88e1ffeeb9ac56d9fade49540f2322760598b91160b16` |

## Boundaries kept

No telemetry, write permission, remote HTTP MCP, authentication, WalletWall cloud service, GitHub App, signing, custody, transaction execution or new network call was added, and none is recommended to chase a trust tier. The privacy and sandbox suites still report 0 unexpected network calls and 0 persistent query writes. The recorded agent-eval harness needs a signed-in Copilot and a model provider, so it was not re-run; only its marketplace setup commands were checked, in an isolated `COPILOT_HOME`.

## Suggested order after merge

1. Re-run `npm run verify` and CI on the merge commit; confirm the five hashes above.
2. Create the `v0.2.0` release from that commit with the assets above.
3. Re-test `copilot plugin marketplace add Wallet-Wall/walletwallrus-copilot` and `copilot plugin install walletwall@walletwall`, then document the GitHub form.
4. Open the Agent Finder plugin-only catalog pull request from the draft entry.
5. Decide separately whether to build an `mcpb` artifact for the official MCP Registry.
