# Contributing to WalletWall

WalletWall is a local, read-only Copilot plugin and MCP server for inspecting stablecoin identity, source lineage, conflicts and vault readiness. It is pre-release. Thank you for helping make it more correct, more private and easier to use.

## Before you start

- **Licensing.** This repository is licensed under the Apache License 2.0 (`LICENSE`). By submitting a contribution you agree that it is licensed under the same terms (Apache-2.0, section 5), and you confirm that you have the right to submit it. Contributions do not transfer or grant rights to the WalletWall name or marks (`TRADEMARKS.md`).
- **Security.** Never report a vulnerability in a public issue, discussion or pull request. Follow `SECURITY.md`.
- **Privacy of examples.** Wallet addresses can identify people. Use synthetic fixtures (for example `0x1234567890123456789012345678901234567890`) in tests, issues and screenshots. Never paste real user wallets, queries, Copilot conversations, logs, local paths or credentials.

## Welcome contributions

- Registry corrections and source or authority updates, with the publisher URL, the exact locator and the date you checked it (see `docs/REGISTRY_SOURCES.md`).
- Conformance vectors, adversarial tests and mutation tests (`conformance/`, `packages/mcp/test`).
- Privacy and security tests.
- Canvas usability and accessibility.
- Documentation, including clearer limits and non-claims.

## Out of scope (will not be accepted)

- Custody, key or seed-phrase handling.
- Signing, transaction construction, broadcasting, swapping or trading.
- Arbitrary remote execution, arbitrary HTTP, RPC or SQL access from the engine.
- Identifying or enriching natural persons behind wallets.
- Investment advice, or claims of regulatory compliance, certification, "truth" or guaranteed accuracy.
- Telemetry, accounts, hosted APIs or any WalletWall backend.

## Changes that get heightened review

A maintainer who owns the area must approve these (see `.github/CODEOWNERS`; GitHub requests the review automatically). Say in the pull request which of them you touch and why:

- WWEP semantics, authority policies, support, freshness or finality states, readiness rules (`spec/`, `packages/mcp/authority-policies/`, `packages/mcp/src/`).
- Any new or changed MCP tool, tool description or schema (`security/tool-manifest.json` must be regenerated with `npm run gen:manifest` and the diff reviewed).
- Registry records and authority attributions (`packages/mcp/registry/`).
- Networking, persistence, credentials, environment access, process execution, telemetry or the canvas listener.
- Anything under `plugin/`, `.github/workflows/`, `security/`, `scripts/`, dependency manifests and lockfiles.
- Privacy and security wording in `README.md`, `PRIVACY.md`, `SECURITY.md`, `BOUNDARIES.md`, `THREAT_MODEL.md` and `DATA_SOURCES.md`.

## Develop

Requires Node.js 22.18 or newer (tested on 24).

```text
npm ci
npm run verify
```

After changing a file under `plugin/` run `npm run gen:plugin-manifest` and `npm run gen:plugin-artifact`; after changing the bundle, tools or registry also run `npm run build:bundle` and `npm run gen:manifest`; after changing a bundled dependency run `npm run gen:notices`. `npm run verify` checks that all generated files are current.

## Pull requests

- Keep each pull request to one concern and add a regression test for any behaviour you fix.
- CI for a pull request from a fork runs without secrets and with a read-only token. For first-time contributors a maintainer must approve the run.
- Do not add dependencies without a reason in the pull request: every runtime dependency is part of the supply chain. New install scripts, native modules, network libraries and dynamic downloads are not accepted.
