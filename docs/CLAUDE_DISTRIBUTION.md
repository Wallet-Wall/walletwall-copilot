# WalletWall Claude distribution

WalletWall reuses the same local, offline, read-only MCP runtime across its supported host envelopes. The Claude distribution does not introduce a second MCP implementation, telemetry, credentials, signing, custody, transaction execution, or a second evidence engine.

## Product scope

The first product-facing Claude workflow is **WalletWall Vault readiness**.

- `vault-readiness` is the primary user-facing skill.
- `walletwall-evidence-audit` supports claim decomposition and evidence classification.
- `walletwall-authority` supports authority, provenance, independence and conflict analysis.
- `walletwall-evidence` remains the shared WalletWall evidence workflow.

These skills are methodology around the same deterministic MCP engine; they are not separate products or runtimes.

## Distribution surfaces

| Surface | Vault capability | MCP path |
| --- | --- | --- |
| Claude Cowork / Claude Code local plugin | Vault skills + local WalletWall MCP | local stdio |
| Claude Desktop Extension | WalletWall MCPB | local stdio |
| GitHub Copilot plugin | WalletWall skills + canvas + local MCP | local stdio |
| WalletWall Vault Guardian / managed agent | Vault Guardian against hosted WalletWall MCP | remote Streamable HTTP, separate lane |

## One runtime, multiple envelopes

```text
packages/mcp
     |
     | deterministic bundle
     v
plugin/server/walletwall-mcp.mjs
     |
     +-- GitHub Copilot: plugin/mcp.json
     +-- Claude local plugin: plugin/.mcp.json
     +-- MCPB/Desktop Extension: walletwall.mcpb

hosted Vault Guardian
     |
     +-- remote Streamable HTTP transport from the Cloud Run lane
```

The Claude local plugin does not carry a second server copy. `plugin/.mcp.json` launches the exact `plugin/server/walletwall-mcp.mjs` file already shipped by the Copilot plugin.

## Claude plugin layout

```text
plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── plugin.json
├── mcp.json
├── server/
│   └── walletwall-mcp.mjs
└── skills/
    ├── vault-readiness/
    ├── walletwall-evidence/
    ├── walletwall-evidence-audit/
    └── walletwall-authority/
```

Claude uses `${CLAUDE_PLUGIN_ROOT}` for portable plugin-relative paths. GitHub Copilot uses `${PLUGIN_ROOT}`. Both local envelopes resolve to the same server file.

## Runtime boundary

The local Claude MCP runtime remains:

- stdio-only;
- local and offline;
- read-only;
- credential-free;
- free of telemetry and query persistence;
- unable to sign, custody, broadcast, trade, or mutate a wallet.

The hosted Vault Guardian path is separate. It uses the remote Streamable HTTP transport and must pass its own authentication, ingress, cost-control and Vault read-model reviews before production exposure.

## Validation gates

A Claude distribution change is not release-ready until:

1. `plugin/.claude-plugin/plugin.json` parses and preserves its own Claude packaging version domain.
2. `plugin/.mcp.json` exposes exactly one local stdio server named `walletwall`.
3. Claude and Copilot configs point to the same `plugin/server/walletwall-mcp.mjs` file.
4. Vault readiness and the two supporting methodology skills are discoverable from `plugin/skills/`.
5. Existing bundle, privacy, sandbox and MCPB checks remain green.
6. The plugin manifest and deterministic plugin-artifact hash are regenerated intentionally when the plugin file set changes.
7. A local-host smoke confirms all six WalletWall MCP tools are discoverable.

## Manual smoke matrix

Verify these six tools:

- `resolve_asset`
- `normalize_observation`
- `inspect_evidence`
- `check_invariants`
- `trace_provenance`
- `assess_vault_readiness`

Record the host, plugin revision, Node version, tool count, and whether any network, credentials, WalletWall backend, signing, or transaction path was required.

## Version domains

Claude packaging versioning is independent from the MCP engine, WWEP, registry, authority policy, GitHub Copilot plugin version, and hosted Vault transport. A packaging change does not imply a semantic engine or evidence-policy change.
