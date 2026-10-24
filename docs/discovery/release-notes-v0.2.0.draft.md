# WalletWall 0.2.0 (draft release notes, not published)

First public release of the WalletWall Agent Plugin source and local MCP integration.

WalletWall is a local, read-only Copilot plugin and MCP server for inspecting stablecoin identity, source lineage, conflicts and vault-readiness signals. It evaluates structured WWEP 0.1 evidence that you supply. It does not sign, custody, trade, broadcast transactions, provide investment advice or certify regulatory compliance.

## Install

```text
copilot plugin marketplace add <path to a checkout of this tag>
copilot plugin install walletwall@walletwall
```

Requires `node` on `PATH` (Node.js 22.18 or newer).

## Contents

| Asset | SHA-256 |
| --- | --- |
| `walletwall-plugin.tar` | `681c26e235ddea608c3db4536b093277368906633e81b3e77eda0d09396f61fc` |
| `walletwall-mcp-0.1.0.tgz` | `1f9a76626da1c68c69d88e1ffeeb9ac56d9fade49540f2322760598b91160b16` |
| `walletwall-mcp.mjs` | `3f30bd32314e196db7f7d1cee5558ac1d9f36aec2191ecb836e6e6a1014332a1` |

Reproduce from the tagged commit with the commands in `docs/PUBLIC_RELEASE_AUDIT.md` ("Release hashes and how to reproduce them").

## What this release does not include

No signed artifacts, provenance attestations or SBOM. Not published to npm, a Copilot marketplace, the MCP Registry or Agent Finder.

## License and security

Apache-2.0 (`LICENSE`). Report vulnerabilities privately: see `SECURITY.md`.
