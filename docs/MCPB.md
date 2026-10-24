# WalletWall MCPB and MCP Registry metadata

The WalletWall MCP server is also packaged as an MCPB (MCP Bundle) so the official MCP Registry can list it. The package changes no runtime behavior: it contains the same single-file server that ships inside the plugin, started the same way (`node`, stdio, no arguments, no environment).

| Item | Value |
| --- | --- |
| Package | `walletwall.mcpb`, a deterministic stored ZIP built by `scripts/pack-mcpb.ts` |
| Recorded hash | `security/mcpb.sha256` (checked by `npm run verify:mcpb` and CI on Linux and Windows) |
| Manifest | `mcpb/manifest.json` (MCPB manifest 0.3) |
| Registry metadata | `server.json` (schema 2025-12-11), name `io.github.Wallet-Wall/walletwall` |
| Transport | stdio only; no remote URL, no environment variable, no credential |

## Contents

Exactly four files, nothing else:

```text
manifest.json
server/walletwall-mcp.mjs        byte-identical to plugin/server/walletwall-mcp.mjs
LICENSE
THIRD_PARTY_NOTICES.md           the plugin notices without the canvas font section
```

No canvas, skill, evals, documents, `.git`, `node_modules` or development files.

## Reproduce

```text
npm run verify:mcpb                                       # recorded hash, cross-checked against Git objects at HEAD
node scripts/pack-mcpb.ts --out walletwall.mcpb --ref <commit>
```

Entries are stored (not compressed), sorted by path, with a fixed timestamp and mode, so the bytes do not depend on the machine, operating system, zlib version or checkout settings. `server.json` carries the same SHA-256 as `fileSha256`; the repository tests fail if they disagree.

## Registry listing

Published to the official MCP Registry on 2026-10-24 (UTC) from the `v0.2.0` tag with `mcp-publisher publish server.json`, authenticated for the `Wallet-Wall` organization namespace (a fine-grained token with organization Members read-only; the token was not stored). Query: `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Wallet-Wall/walletwall`. The registry did not validate `fileSha256`; MCP clients do.

## What this is not

Publishing server metadata to a registry is discovery, not endorsement or certification. The registry hosts metadata only; the artifact is the GitHub Release asset named in `server.json`. The MCPB is not signed.
