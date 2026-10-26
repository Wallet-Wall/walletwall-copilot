# Plugin-path privacy review (Copilot plugin + MCP + Canvas)

Status: **TESTED** for WalletWall-controlled code on Windows and Linux. This is not a privacy certification and says nothing about GitHub's products.

## The boundary (read this first)

> WalletWall-controlled code does not transmit query data to WalletWall infrastructure and does not persist WalletWall query history.

It does **not** mean "nothing leaves the machine". GitHub Copilot, the model provider and the Copilot app process the conversation, tool inputs and tool outputs under GitHub's own product behavior. When an agent passes an evidence bundle (which may contain a wallet address) to a WalletWall tool or to the WalletWall canvas, that content is part of the Copilot conversation. WalletWall cannot see, limit or delete it.

## WalletWall-controlled components

| Component | What it is | Network | Disk | Process |
| --- | --- | --- | --- | --- |
| MCP server `plugin/server/walletwall-mcp.mjs` | stdio JSON-RPC, started by Copilot | none | none | none |
| WalletWall canvas extension | Node process started by Copilot, one canvas | **one loopback (`127.0.0.1`) listener per open canvas instance** | none | starts the bundled MCP server per request |
| WalletWall canvas page | served by that listener, rendered in the Copilot app | its own loopback origin only (CSP `connect-src 'self'`); fonts and brand images are embedded `data:` URIs (CSP `font-src data:`, `img-src data:`), so no font, image or CDN request is made | no browser storage | n/a |
| Skill, manifests | text files | n/a | n/a | n/a |

The canvas listener is a documented, necessary exception: the Copilot app only embeds loopback URLs for extension canvases. It is bound to `127.0.0.1` on an OS-chosen port (confirmed in the operating system's socket table, never `0.0.0.0` or IPv6, unreachable on LAN addresses), requires an unguessable per-instance path key and a matching `Host` header, serves exactly four routes, refuses a foreign `Origin` and non-JSON bodies on its one state-changing route, and is closed when the canvas closes. A closed instance leaves nothing behind: a new instance with the same id starts empty with a new key and port. See `packages/mcp/test/canvas/hardening.test.ts`.

## Requirement by requirement

| Requirement | Evidence | Level |
| --- | --- | --- |
| 0 telemetry / analytics events | no telemetry or analytics package in the production tree (`PRIV-004`); canvas source scanned for telemetry products, tracking calls and identifiers (`PRIV-017`, `PRIV-019`) | TESTED |
| 0 persistent wallet/query writes | strict guard on the MCP child reports zero filesystem writes; canvas-profile guard on the Explorer reports zero; cwd, HOME, TMP, APPDATA and XDG directories are empty after open, select, replace and close (`PRIV-018`) | TESTED |
| 0 WalletWall backend requests | canvas-profile guard blocks and records every non-loopback connection and every DNS lookup other than the literal `127.0.0.1`; counts are zero (`PRIV-018`); no WalletWall endpoint literal in plugin files (`PRIV-017`) | TESTED |
| 0 WalletWall user IDs / device IDs | no randomness or identity API in the MCP child (`PRIV-007/008`); in the Explorer the only random values are `crypto.randomBytes` for the URL path key and the CSP nonce, never persisted or transmitted; no `os` identity API, no identifier fields (`PRIV-018`, `PRIV-019`) | TESTED |
| Canvas local/session storage | page script has no storage, cookie, IndexedDB or service-worker use (`PRIV-017`); a real browser loaded the page served by a Desktop session: `localStorage` 0, `sessionStorage` 0, no cookies, 0 IndexedDB databases | TESTED (browser check was a one-off, not in CI) |
| Temp files | none created by WalletWall code; test temp directories are created only under the owned `walletwallrus-copilot` root and only those are deleted | TESTED |
| Plugin cache written by WalletWall code | none: the plugin is loaded live; the server never writes to `PLUGIN_DATA`; the guard blocks writes | TESTED |
| Logs written by WalletWall code | none: MCP stderr stays empty in normal operation; the extension never writes to stdout/stderr or files | TESTED |
| Crash-report integrations | none; the MCP prints one fixed line on a fatal error; no uploader | TESTED (`PRIV-012`) |
| Network calls from WalletWall code | MCP: zero (`PRIV-001/003/014`, OS socket table in `PRIV-016`); Explorer: loopback only (`PRIV-018`); the Explorer spawns only the bundled MCP server | TESTED |
| Portable reference and QR code | generated locally from a record id and its committed digest (`wallprint-qr.mjs`, no library, no remote image service); the canvas's code encodes the `walletwall:` reference and no wallet address, web or local URL, session, key, query or record content, and its text is scanned by the credential guard; a reference opened through the canvas is parsed strictly and never echoed into the page or the agent's summary (`wallprint-reference.test.ts`, `wallprint-qr.test.ts`). The plugin names no endpoint (`PRIV-017`); the HTTPS form exists only on WalletWall's public resolver page outside the plugin (`packages/wallprint-web`), whose resolver base is a publication setting | TESTED |

## How the combined path is measured

`packages/mcp/test/support/canvas-driver.ts` runs the real extension logic exactly as the app does (open a canvas, select, replace the bundle, close) while a guard (`WW_GUARD_PROFILE=canvas`) records and blocks: non-loopback network use, DNS other than the `127.0.0.1` literal, filesystem writes, spawns other than the bundled MCP server, machine-identity APIs. The driver also plays the iframe over loopback HTTP and an SSE stream. Every MCP server the canvas starts is itself run under the strict guard and its report is captured. A positive control proves the canvas profile blocks what it should and allows only the one loopback listener. A unique canary wallet address and canary credentials are searched for, with common hashes, in every file and diagnostic.

## What is not proven

- What the Copilot app, GitHub or the model provider records or retains, including the evidence bundles and wallet addresses an agent passes to WalletWall tools or to the canvas.
- How the Copilot app embeds, caches or logs the canvas iframe.
- Node.js runtime switches that WalletWall code does not control (for example `NODE_OPTIONS=--inspect`).
- Native-code and syscall-level behavior outside the in-process guard; platforms other than Windows and Linux CI.
