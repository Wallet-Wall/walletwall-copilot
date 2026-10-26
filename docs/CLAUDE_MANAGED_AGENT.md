# Claude Managed Agent bridge

WalletWall's shipped GitHub Copilot MCP runtime remains local, offline, read-only and **stdio-only**.

This optional adapter exposes the same `createServer()` tool/resource contract over a loopback-only Streamable HTTP endpoint so a user can attach their own Claude Managed Agent through an Anthropic MCP tunnel.

## Boundary

The bridge lives outside the `packages/mcp` publish surface at `scripts/claude-mcp-http.ts`. It reuses `packages/mcp/src/server.ts` but is not part of the MCP package file list and is not bundled into `plugin/server/walletwall-mcp.mjs`.

The existing Copilot runtime therefore keeps its current security properties: no listening socket, no outbound network access, no credentials, no persistence, and stdio transport only.

The optional bridge:

- binds only to `127.0.0.1`;
- exposes only `/mcp`;
- accepts POST requests only;
- accepts JSON request bodies only;
- caps request bodies at 1 MiB;
- emits no CORS allow-origin header;
- rejects foreign browser Origins;
- reads no environment variables;
- stores no credentials;
- adds no outbound network access to the WalletWall evidence engine;
- reuses the same six WalletWall tools and eleven static resources.

## Run from a source checkout

Requires Node.js 22.18 or newer.

```text
node scripts/claude-mcp-http.ts --port 8787
```

The endpoint is:

```text
http://127.0.0.1:8787/mcp
```

For tests or ephemeral local allocation, port `0` is also accepted; the selected URL is printed to stderr.

## Connect to a Claude Managed Agent

Use the user's own Anthropic MCP tunnel and route it to the local WalletWall endpoint. Then attach that tunnel as an MCP server in the user's Managed Agent configuration.

The tunnel and Claude session belong to that user's Anthropic workspace. WalletWall does not host a public MCP endpoint and does not proxy inference.

## Cost model

```text
Claude inference/session  -> user's Anthropic workspace
WalletWall HTTP bridge    -> user's machine
WalletWall MCP evaluation -> user's machine
WalletWall hosted runtime -> none
```

The bridge is optional. GitHub Copilot continues to use the bundled stdio transport.
