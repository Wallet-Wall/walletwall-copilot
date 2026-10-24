<!--
WalletWall MCP / Copilot PR template.
State what changed, what boundary it touches, and the exact evidence from the final commit.
Do not mark a check complete unless it actually ran.
-->

## What & why
<!-- Two or three sentences: what changed, why now, and the issue/PR/spec it builds on if applicable. -->

## Scope
- **Type:** <!-- MCP/runtime | plugin/canvas | WWEP/evidence | registry/authority | docs | CI/repo hygiene | tests-only -->
- **Files / areas changed:** <!-- concise groups, not every filename -->
- **Runtime behavior changed:** <!-- yes/no; if yes, explain user-visible or protocol behavior -->
- **Public contract changed:** <!-- yes/no; tools, resources, schemas, package/plugin surface -->

## Sensitive review routing
<!-- Check every sensitive area touched. -->
- [ ] WWEP semantics or authority policy
- [ ] MCP tool, tool description, schema, or resource contract
- [ ] Registry records or authority attributions
- [ ] Networking, persistence, credentials, environment access, process execution, telemetry, or a loopback listener
- [ ] `.github/workflows/`, plugin packaging, release artifacts, dependencies, or lockfile
- [ ] Privacy or security wording
- [ ] None of the above

## Boundary confirmations
- [ ] No wallet signing, custody, transaction broadcast, trading, or production write path introduced.
- [ ] No WalletWall-hosted inference, hosted MCP execution, telemetry, or per-user data-retention path introduced.
- [ ] The shipped Copilot MCP remains local, offline, read-only, and stdio-only unless explicitly changed above.
- [ ] The MCP tool/resource contract is unchanged, or the relevant manifests/hashes were regenerated and reviewed.
- [ ] Core engine code adds no outbound network, persistence, credential, or ambient-environment dependency.
- [ ] No secrets, real credentials, private keys, seed phrases, service-account material, or real user wallet data added.
- [ ] Tests use synthetic fixtures where wallet-like data is needed.
- [ ] Registry, authority, provenance, support, freshness, finality, and readiness claims remain source-backed and do not over-claim evidence.
- [ ] Privacy/security wording matches the implementation and tested boundary.

## Validation
<!-- Exact commands and results from the final commit. Use "not run" or "n/a" with a reason instead of leaving blanks. -->

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | |
| Lint | `npm run lint` | |
| Tests | `npm test` | |
| Full verification | `npm run verify` | |
| CI | required checks | |

- **Regression coverage:** <!-- new/updated tests for changed behavior, or n/a -->
- **Adversarial / negative cases:** <!-- malformed input, refused routes, hostile origin, invariant failure, etc. -->
- **Test-count delta:** <!-- before/after when material, otherwise n/a -->

## Reviewer focus
<!-- The 1–3 things a reviewer should scrutinize most closely. -->

## Residual risk / follow-ups
<!-- Remaining limits, deferred verification, compatibility concerns, or "none known". -->
