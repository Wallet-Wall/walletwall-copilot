# Public release readiness audit

> **Historical record.** Written before the repository became public. It names the former marketplace `walletwall-private` (finding PR-016) because that was the real identity when the audit ran. PR-016 was resolved by renaming the marketplace to `walletwall` in the public discovery readiness change; the active name is in `.github/plugin/marketplace.json`.

Audit of `Wallet-Wall/walletwallrus-copilot` for a change from private to public visibility. Audited baseline: `main` at `c0ab03f2a2a5ce2184ee7eaacd1f7cbd9d5e57f1` (pull request #3 merged). Audit date: 2026-10-24 (UTC). This document records what was actually checked and measured; it is not a certification, and passing tests does not make the software secure, private or accurate.

> **Provenance.** This audit was written in the private development repository. Commit SHAs and pull request numbers cited in it refer to that repository and do not resolve in a repository that starts from a clean root commit. The reviewed object is the source tree, not the history.

## Status

| Question | Status |
| --- | --- |
| `EXISTING_REPOSITORY_PUBLIC_FLIP` (change the existing private repository to public) | **BLOCKED** |
| `CLEAN_ROOT_PUBLICATION_PATH` (publish from a new repository whose only commit is a clean root commit of the reviewed tree) | **ELIGIBLE_FOR_REVALIDATION** |

The audit verdict at the audited head was `PUBLIC_RELEASE_BLOCKED`. The existing repository is **not** safe to make public: its history, its pull request refs, its Actions history and an unreachable historical commit all remain, and deleting files from the current tree does not remove them. The approved path is a new repository with a clean root commit. That repository must be re-audited on its own before it is made public; nothing in this document certifies it in advance.

The repository was **not** made public by this audit, nothing was published to npm and nothing was submitted to a marketplace.

## Approved remediation of the blocking findings

| Finding | Resolution |
| --- | --- |
| PR-001 (license) | Resolved by **Apache-2.0**: the standard, unmodified text (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, checked by a test) is `LICENSE`, with identical copies in `plugin/` and `packages/mcp/` so that every distributed artifact carries it. Manifests and package metadata declare `Apache-2.0`. Brand guidance is kept separate in `TRADEMARKS.md`: the software license does not grant rights to the WalletWall name, logos or marks |
| PR-002 (local account name in historical files) | Will not be exposed publicly because the public repository will use a fresh Git root. The existing history is not rewritten and not filtered, and the existing repository stays private |
| PR-003 (unreachable historical commit with personal author metadata) | Will not be exposed publicly because the public repository will be a distinct Git object database with no inherited private history. No deletion of existing commits is requested |

The existing repository remains private and may later serve as the private development and archive repository.

## Baseline

| Item | Value |
| --- | --- |
| Repository / visibility | `Wallet-Wall/walletwallrus-copilot`, private |
| Default branch | `main` |
| Original baseline | `c0ab03f2a2a5ce2184ee7eaacd1f7cbd9d5e57f1` (the audit branch was created from exactly this commit) |
| Open pull requests at start | none (three closed or merged: #1, #2, #3) |
| Tags / releases | none |
| Plugin version | 0.2.0 |
| WWEP version | 0.1 |
| Registry version | 0.2.0 (`VERIFIED_POINT_IN_TIME`, verified 2026-10-24) |
| Authority policies / rules version | `0.1.0-draft` / `0.1.0-draft` |

## Results by area

| Area | Result | Notes |
| --- | --- | --- |
| Git history: credentials | PASS | Every reachable object and commit message of 15 commits, 3 pull-request refs and the local refs was scanned by pattern (GitHub, npm, cloud, JWT, Slack, bearer, PEM, URL credentials, database URLs, provider keys, signed URLs, webhook secrets, `.env`-style lines) and by high-entropy search. No credential found. Binary screenshots were reviewed visually and for embedded metadata |
| Git history and tree: personal data | **BLOCKED for the existing repository**; not exposed by the clean-root path | See PR-002 and PR-003. The current tree is clean. Wallet addresses: only the five public registry deployments and synthetic fixtures |
| Historical GitHub Actions | PASS | All 14 retained runs: logs downloaded and scanned (no secret, token, e-mail, personal path or wallet address). No artifacts. Four npm cache entries only. Not inspectable: logs of runs deleted before the audit |
| Fork and Actions security | PASS | Only `push` to `main` and `pull_request`; read-only token; no secrets, artifacts, self-hosted runner, `pull_request_target` or `workflow_run`; actions pinned to commit SHAs that were verified to be the tagged releases; no PR metadata interpolated into shell. Enforced by `repo/workflows.test.ts` |
| Public source boundary | PASS | Top-level tree is allow-listed by a test. One internal operations runbook was reduced to a public boundary note (PR-012). No source maps, backups, session files or private endpoints |
| Dependencies | PASS | See `docs/DEPENDENCY_POLICY.md`: lockfile committed, registry only `registry.npmjs.org`, one install script (development only), 0 known vulnerabilities, all 188 installed packages have verified signatures |
| Shipped artifacts | PASS | Candidate plugin and MCP artifacts built, inspected and hashed (below); reproducible |
| Canvas loopback | PASS | See "Canvas loopback security" |
| Address copy and select | PASS | Fixed in this audit (PR-009) |
| Registry redistribution | PASS | `docs/REGISTRY_SOURCES.md`. The publishers' terms were not reviewed by counsel (PR-018) |
| Naming | PASS | WalletWall / WalletWall / WalletWall MCP (PR-011) |
| Licensing and trademark | PASS | PR-001 resolved: Apache-2.0, unmodified. `TRADEMARKS.md` keeps the brand separate, asserts no registration and grants no brand rights |
| Privacy and documentation | PASS | Unsupported claims removed or denied; preferred statements added; enforced by `repo/public-release.test.ts` |
| F-02 | PASS | Regression added |
| F-03 | PASS | Regression added |
| Temp cleanup | PASS | 17 tests re-run: siblings and look-alikes survive, traversal, links and junctions refused, only the owned run is removed |
| Contribution and security governance | PASS | CODEOWNERS, CONTRIBUTING, pull request template, issue chooser, `SECURITY.md` |
| Repository settings | NOT_FULLY_INSPECTABLE | See PR-004 and PR-005 |
| Visibility-flip checklist | CREATED | `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md`, not executed |

## Findings

Severity counts as found: CRITICAL 0, HIGH 1, MEDIUM 6, LOW 9, INFO 6. "Fixed" means fixed in the audit pull request. The last column answers "does this block publishing the existing repository?"; the clean-root path is stated where it differs.

| ID | Severity | Where | Finding | Impact | Fix | Blocks publication |
| --- | --- | --- | --- | --- | --- | --- |
| PR-001 | HIGH | `LICENSE`, `plugin/plugin.json`, marketplace manifest | The license was a proprietary, private, pre-release notice that granted nothing and said a public license "has NOT been chosen" | Once public, nobody could lawfully use or contribute, and the notice would be false | **Resolved:** Apache-2.0, unmodified, with copies in the plugin and the MCP package; manifests updated; brand guidance separate | NO (resolved) |
| PR-002 | MEDIUM | `evals/results/*` in history from the Desktop-lane commit | Four recorded agent-eval results contained a local Windows account name inside a filesystem path | Personal data in the history of the existing repository | Removed from the tree and from the harness (fixed). History is not rewritten. **Will not be exposed publicly** because the public repository will use a fresh Git root | Existing repository: **YES**. Clean-root path: NO |
| PR-003 | MEDIUM | GitHub object store | A superseded, unreachable version of the first commit, carrying non-public personal author metadata, is still served by GitHub by SHA in the existing repository. No reachable commit has it | Personal data retrievable by anyone who learns the SHA | No deletion requested. **Will not be exposed publicly** because the public repository will be a distinct Git object database with no inherited private history | Existing repository: **YES**. Clean-root path: NO |
| PR-004 | MEDIUM | Repository settings | `main` protection requires `verify` and `offline-sandbox` but not `verify-windows`, requires no review, does not enforce for administrators; secret scanning, push protection and Dependabot alerts are disabled; private vulnerability reporting and fork-approval policy are unavailable while private | Controls must be set at the flip or contributor pull requests would meet weak protection | Set on the clean-root repository while it is private, and the rest at the visibility change (checklist steps 7 to 10) | NO (gated at the flip) |
| PR-005 | MEDIUM | Organization | Two-factor requirement is not enforced for the organization; organization-level Actions secrets and runner groups could not be read with the available token | Cannot show that no organization secret or runner is reachable from this repository | Organization owner enforces 2FA and confirms secret and runner scope (checklist step 5 and 8) | NO (verify before the flip) |
| PR-006 | MEDIUM | `plugin/server/walletwall-mcp.mjs` | The bundle is built without license comments, so the MIT/ISC notices of the three bundled packages did not accompany it | License obligation unmet when the plugin is distributed | `plugin/THIRD_PARTY_NOTICES.md`, generated and verified in CI (fixed) | NO |
| PR-007 | MEDIUM | Repository | No CODEOWNERS, contribution guide, pull request template or concrete private reporting route | No heightened review of protocol-sensitive paths; unclear where to report vulnerabilities | Added (fixed). A second code owner is still needed before enforcing code-owner review | NO |
| PR-008 | LOW | canvas `explorer.mjs` | The one state-changing route accepted any `Origin` and any body type; the `/view` fragment had no CSP | Defence in depth against a hostile local web page | Foreign `Origin` and non-JSON bodies refused; CSP added; tests (fixed) | NO |
| PR-009 | LOW | canvas `render.mjs` | No copy control; no chain shown beside addresses | Risk of mis-copying or mis-attributing an address | Full address, chain ID, Copy of the exact text; tests (fixed) | NO |
| PR-010 | LOW | `.github/dependabot.yml` | Ignores covered all future majors of two dependencies, with no review date | Permanent update blindness | Narrowed to the held versions with review dates; tested (fixed) | NO |
| PR-011 | LOW | plugin, marketplace, canvas, MCP, README | Public labels were "Evidence Explorer", an evidence-centric description and a "private" README | Inconsistent public naming | Renamed per the naming lock; tested (fixed) | NO |
| PR-012 | LOW | `docs/GITHUB_APP.md`, `SECURITY.md`, `spec/EVIDENCE_PROFILE.md` | Private-lane wording; the GitHub App note listed the organization's installed apps and a registration runbook | Internal operations detail in a public repository | Reduced to a boundary note; wording corrected (fixed) | NO |
| PR-013 | LOW | `packages/mcp/package.json` | An npm pack of the MCP package would have included its 36 test files | Unnecessary publication of tests | `files` allow-list; tested (fixed) | NO |
| PR-014 | LOW | `evals/run-agent-evals.ts` | The harness copied the plugin listing, including the local checkout path, into recorded results | Recurrence of PR-002 | Records `<local checkout>` (fixed) | NO |
| PR-015 | LOW | `plugin/skills/.../SKILL.md` | The skill did not say how to treat a peg-assumption dollar figure or an edited, rejected bundle (agent-eval findings F-02, F-03) | Model prose could blur hypothetical and established values | Two rules added; regressions added (fixed) | NO |
| PR-022 | LOW | `packages/mcp/test/repo/public-release.test.ts` | Found by re-auditing the first clean-root candidate: the personal-data hygiene test carried the local account name as a regular-expression literal, so the clean tree would have published the very name PR-002 keeps out. The scan that should have caught it excluded the test file itself | A fresh Git root does not help if the tree contains the data | Literal removed. The account name is now read at run time from the running machine and searched for in every tracked text file, including this test, the bundle and the lockfile (skipped on CI runners); mutation-tested. The first candidate repository was discarded and the clean root regenerated from the corrected tree (fixed) | NO |
| PR-016 | INFO | `.github/plugin/marketplace.json` | The marketplace is still named `walletwall-private` | Misleading once public, but renaming changes the install command and users' saved settings | Rename at the first marketplace publication | NO |
| PR-017 | INFO | Pull request #3 | Its title and text say "private, not for release" | Would become public with the existing repository | Not carried into the clean-root repository, which has no pull request history | NO |
| PR-018 | INFO | `docs/REGISTRY_SOURCES.md` | The terms of use of the Circle, Tether and Sky sources were not reviewed by counsel | Residual legal uncertainty; only facts and pointers are stored | Reduce to pointers on request | NO |
| PR-019 | INFO | `ci.yml` | The offline sandbox job uses the mutable image tag `node:24-slim` | The container has no network and no secrets; supply-chain only | Pin by digest and add the Docker ecosystem to Dependabot | NO |
| PR-020 | INFO | `packages/mcp/package.json` | `main` points at TypeScript source; the package is not publishable as is | Concerns the npm lane only | Build step before any npm publication | NO |
| PR-021 | INFO | Desktop | MCP resources are not exposed by the Desktop UI | Unchanged from the accepted baseline | None | NO |

## Canvas loopback security

The WalletWall canvas serves its page from one listener that the Copilot app embeds. Tests in `packages/mcp/test/canvas/` prove, on Windows (and in CI on Linux), that:

- The operating system's socket table shows exactly one new TCP listener per open canvas, bound to `127.0.0.1`; none after close. It is unreachable on IPv6 loopback and on every LAN address of the host.
- Only four method and route pairs exist (`GET /`, `GET /view`, `GET /events`, `POST /select`). Every other method, path trick, guessed key and wrong `Host` is refused.
- The state-changing route refuses a foreign or `null` `Origin` and any non-JSON body; hostile bodies change nothing and spawn nothing; the launcher receives only constructor options.
- State is per instance: after close nothing remains, a reopened instance is empty with a new key and port, and two sessions share nothing.
- No network call or storage API is used by the page, and the copy path makes no call at all.

Not proven, and not claimed: behaviour of the Copilot app's own embedding, and protection against a hostile local owner or runtime flags such as `NODE_OPTIONS=--inspect` (see `SECURITY.md`, "Runtime and local-owner trust boundary").

## Verification summary

Measured on the audited commit. Numbers are test counts, not accuracy percentages; no accuracy figure is claimed.

| Check | Result |
| --- | --- |
| Windows suite (`npm run verify`: typecheck, lint, generated-file checks, all tests) on Windows 11, Node.js 24.16.0 | 328 tests, 43 suites, 0 failures (baseline `c0ab03f`: 266 tests). On CI runners one test, the local-account-name check, is skipped by design |
| Linux suite and offline sandbox (CI: `verify`, `offline-sandbox`; Windows job `verify-windows`) | all three jobs of the audit pull request, see its checks |
| WWEP conformance corpus | 64 / 64 cases (adversarial 15, authority 13, conflict 9, evidence 18, freshness 9); 51 conformance tests |
| Adversarial | 15 / 15 |
| Mutation | 35 / 35 |
| Privacy (static, runtime guard, reachability, OS socket table) | 47 / 47 |
| Canvas (explorer, hardening, plugin-path privacy) | 40 / 40 |
| Temp-cleanup regression | 17 / 17 |
| F-02 and F-03 regressions | 12 / 12 |
| Repository hygiene, workflow security, claims, naming, license, governance | 34 / 34 |
| Agent evals (Copilot prose, not conformance; four recorded runs, 13-case corpus) | no hard overclaim; automated grader and manual verdicts in `docs/AGENT_EVALS.md`; not re-run in this audit |
| Unexpected WalletWall network calls (guard, plugin path) | 0 |
| Persistent query writes (cwd, HOME, TMP, APPDATA, XDG after open, select, replace, close) | 0 files |
| `npm audit` (production tree and full tree) | 0 vulnerabilities |

### Release hashes and how to reproduce them

The current values are the files in `security/` (`tool-manifest.sha256`, `plugin-manifest.sha256`, `bundle.sha256`, `plugin-artifact.sha256`); `npm run verify` and CI (on Linux and on Windows) fail if any of them no longer matches the tree. Reproduce them from a clean clone of the release commit:

```text
node scripts/gen-manifest.ts --check          # tool manifest
node scripts/gen-plugin-manifest.ts --check   # plugin manifest
node scripts/build-bundle.ts --check          # MCP bundle
node scripts/pack-plugin.ts --check           # plugin artifact: the recorded hash, cross-checked against Git objects
npm run pack:plugin -- <file>                 # writes the plugin artifact from the Git objects at HEAD
npm pack --workspace packages/mcp --pack-destination <dir>
```

**The plugin artifact is built by `scripts/pack-plugin.ts`, not by `git archive`.** It is a POSIX ustar archive of the tracked `plugin/` files (plugin root as archive root), ordered by path, with fixed header fields (mtime 2026-01-01T00:00:00Z, uid and gid 0, no owner names, mode 0644, or 0755 where Git records an executable), `/` separators, no directory entries, padded to 10240 bytes. A release build reads every file's bytes from the Git object database, so no checkout setting (such as `core.autocrlf`) can change them; the `--check` mode reads the working tree, normalises text exactly as Git stores it, and fails if that differs from the Git-object build. An earlier procedure, `git archive ... HEAD:plugin`, was **not** host-independent: archiving a subtree does not apply the root `.gitattributes`, so a Windows checkout with `core.autocrlf=true` wrote CRLF into every member. It must not be used.

For the final pre-public tree these give:

| Artifact | SHA-256 |
| --- | --- |
| Tool manifest (`security/tool-manifest.json`, RFC 8785 canonical form) | `2d2f857c2b0c8ef824a3bc59d52baef6895db0209f16830d4a5025800ca815ec` |
| Plugin manifest (`security/plugin-manifest.json`, canonical form) | `04a134798ef59b829b1bd090335bb9760b57a399ef7b0f4cd8d8ac6411e1bd71` |
| MCP server bundle (`plugin/server/walletwall-mcp.mjs`) | `3f30bd32314e196db7f7d1cee5558ac1d9f36aec2191ecb836e6e6a1014332a1` |
| Candidate plugin artifact (`scripts/pack-plugin.ts`; 17 files, contains `LICENSE`; identical on Windows and Linux) | `681c26e235ddea608c3db4536b093277368906633e81b3e77eda0d09396f61fc` |
| Candidate MCP artifact (`npm pack` of `packages/mcp`; 22 files: source, registry, policies, `LICENSE`; identical on Windows and Linux) | `1f9a76626da1c68c69d88e1ffeeb9ac56d9fade49540f2322760598b91160b16` |

Historical values, kept for the record only and **not** to be compared against: at the Apache-2.0 audit tree the plugin manifest was `86089b7a…` and a `git archive` plugin artifact built on a `core.autocrlf=true` host was `2081506c…`. The plugin manifest and artifact changed since then for the canvas design (The Wall, brand pack, fit-to-frame layout, favicon, guide wording) and the new packaging; the tool manifest, the bundle and the MCP artifact did not change.

Both artifacts were extracted and searched for `.env` files, `.git` data, session or worktree metadata, logs, backups, source maps, screenshots, local paths, e-mail addresses, tokens and private keys: none. The runtime is unchanged in kind: stdio only, no WalletWall backend, no telemetry, no persistent query storage, no generic network service (the one loopback listener belongs to the canvas, not the MCP runtime).

## Known limitations

- Support states describe how well presented evidence satisfies a published policy. They do not verify upstream data (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached to chain readings).
- The registry is a point-in-time snapshot of five deployments, not live data.
- The in-process privacy guard cannot see native code; the OS-level sandbox covers the Linux CI runner only.
- The Copilot app, GitHub and the model provider process prompts and tool data under their own policies.
- No independent security review, signed releases, SBOM or provenance attestation yet.
- The Desktop GUI click-through remains documented as not proven (`docs/DESKTOP_INSTALL_PROOF.md`).
