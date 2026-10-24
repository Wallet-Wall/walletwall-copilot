# GitHub App boundary

WalletWall does not use a GitHub App.

| Item | State |
| --- | --- |
| App `WalletWallrus-Copilot` | **Not registered.** The name is reserved as a possible future identity; availability is only confirmed at registration |
| Permissions, webhooks, installations | none |
| Private key, client secret, webhook secret | none exist; none are stored in this repository |
| Runtime dependency on an App | **None.** The plugin, WalletWall MCP and the WalletWall canvas use no GitHub App, installation ID, token or OAuth |

## Boundary

```text
WalletWallrus-Copilot GitHub App   ≠   WalletWall MCP runtime
```

WalletWall MCP works with none of: a GitHub App installation, an installation ID, an App private key, OAuth, a GitHub API token, a webhook or any GitHub backend service. The plugin passes no environment to the server and the server reads none. Future GitHub-native features (for example pull request annotations) may use an App; version 0.1 does not.

## If an App is ever registered

It needs its own review before any change to this boundary: grant no speculative permissions, install narrowly, create no webhook infrastructure, never connect it to the MCP server, canvas or plugin, and never store its credentials in this repository.
