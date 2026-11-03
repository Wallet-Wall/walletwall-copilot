# Claude Managed Agent bridge

WalletWall's shipped GitHub Copilot and Claude MCP runtime remains local, offline, read-only and **stdio-only**.

This optional adapter exposes the same `createServer()` tool/resource contract (six tools, eleven resources) over a Streamable HTTP endpoint on the user's own machine, so a user can attach their own Claude Managed Agent through an Anthropic MCP tunnel. No supported host needs it: Copilot, Claude Code and Cowork, the MCPB and the Claude Directory package all use stdio.

## Boundary

The bridge lives outside the `packages/mcp` publish surface at `scripts/claude-mcp-http.ts`. It reuses `packages/mcp/src/server.ts` but is not part of the MCP package file list and is not bundled into `plugin/server/walletwall-mcp.mjs`, the MCPB, the Copilot plugin or the Claude Directory package. No shipped manifest, package script or workflow starts it (tested in `packages/mcp/test/transport/http.test.ts`).

The existing runtime therefore keeps its current properties: no listening socket, no outbound network access, no credentials, no persistence, and stdio transport only.

## Security model

The adapter is deliberately small:

- **Off unless enabled.** Without `--enable` it prints one line, opens nothing and exits non-zero. No environment variable enables or configures it; it reads no environment.
- **Loopback only.** It binds `127.0.0.1` (default) or `::1`. There is no external-bind mode: `0.0.0.0`, `::`, `localhost` and every other address are refused at startup.
- **Per-process bearer token.** At start it draws 32 bytes (256 bits) from the operating system's CSPRNG (`randomBytes` from `node:crypto`) and encodes them as 43 base64url characters. The token is never read from the environment, a file or the command line, never written to disk, never put in a URL, response, error or log, and is not reused: a new process has a new token and the old one is dead. It is printed once, on your terminal (stderr), next to the URL.
- **One way to present it.** `Authorization: Bearer <token>` (the scheme name is case-insensitive). A missing, wrong, shorter, longer or malformed token, another scheme, or the token in a query string, cookie or other header is refused with a fixed `401`. The comparison is constant-time. A caller without the token learns nothing about routes or methods.
- **Request validation still applies.** The `Host` header must name the listener exactly (`127.0.0.1:<port>`, `[::1]:<port>` or `localhost:<port>`); a browser `Origin` must be the listener's own loopback origin; one route, `POST /mcp`, JSON only, request target at most 256 characters, body at most 512 KiB (checked on the declared length and while streaming). Every other method is `405`, every other path `404`, malformed JSON `400`. No CORS header is sent, so a web page cannot read a response.
- **Stateless and read-only.** Every POST gets a fresh MCP server and transport; no session ID is issued. It adds no outbound network access, no file access, no signing and no state.

What this protects against, and what it does not:

| Actor | Result |
| --- | --- |
| Remote caller with no credentials | Cannot reach it: it listens on loopback only |
| Local program or web page without the token (another user's process, a page re-pointing a hostile name at loopback) | Refused: `Host`, `Origin` and token checks |
| Hostile program running as the same operating-system account | Out of scope: it can read this terminal, the process and its memory |
| Hostile owner of the machine or account | Out of scope |

WalletWall assumes the local operating-system account and process environment are relied upon. Someone who already controls that account or process can inspect or alter local tool traffic and code, and the adapter does not attempt to detect or resist that. This does not mean WalletWall can inspect other people's computers: the adapter never connects anywhere. See `SECURITY.md`, "Local adapters" and "Hostile local owner".

Run it in a terminal you control. If you redirect or capture its output into a log, the token is in that log.

## Run from a source checkout

Requires Node.js 22.18 or newer.

```text
node scripts/claude-mcp-http.ts --enable --port 8787
```

The endpoint is `http://127.0.0.1:8787/mcp`. The URL and the token are printed to stderr:

```text
walletwall-mcp-http: streamable-http http://127.0.0.1:8787/mcp
walletwall-mcp-http: bearer-token <the token>
```

For tests or ephemeral local allocation, port `0` is also accepted; the selected URL is printed.

## Connect to a Claude Managed Agent

Use the user's own Anthropic MCP tunnel and route it to the local WalletWall endpoint, configured to send `Authorization: Bearer <token>` with the token this process printed. Then attach that tunnel as an MCP server in the user's Managed Agent configuration. Restarting the adapter issues a new token, so the tunnel's header must be updated.

The tunnel and Claude session belong to that user's Anthropic workspace. WalletWall does not host a public MCP endpoint and does not proxy inference.

## Compatibility change

Earlier versions of this adapter started without `--enable`, required no authentication, accepted `--host 0.0.0.0`, read the `PORT` environment variable and answered an unauthenticated `GET /health`. All of that is removed. Clients must now send the token, a start without `--enable` does nothing, and there is no health route. The Cloud Run deployment that depended on `--host 0.0.0.0` is withdrawn: a remotely hosted adapter would need its own architecture and hosted authentication model and is not part of this adapter.

## Cost model

```text
Claude inference/session  -> user's Anthropic workspace
WalletWall HTTP bridge    -> user's machine
WalletWall MCP evaluation -> user's machine
WalletWall hosted runtime -> none
```

The bridge is optional. GitHub Copilot continues to use the bundled stdio transport.
