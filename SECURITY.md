# Security policy

## Status

Pre-release and unreviewed. This code has **not** had an independent security review or audit. Passing tests does not make it secure.

## Reporting a vulnerability

Report privately. Use GitHub's private vulnerability reporting for this repository (Security tab, "Report a vulnerability"). Do not open a public issue, discussion or pull request for a vulnerability, and do not post exploit details anywhere public.

If "Report a vulnerability" is not available to you, open a public issue titled "Security contact request" that contains **no technical detail**, and a maintainer will arrange a private channel.

Include the commit, the tool or resource involved, a minimal reproduction and the impact. Do not include real wallet addresses, private keys, seed phrases or credentials in a report: wallet addresses can identify people, so use synthetic values.

There is no response-time commitment while the project is pre-release; maintainers will acknowledge reports on a best-effort basis. Only the default branch is supported.

Report privately to the WalletWall maintainers: use GitHub's private vulnerability reporting for this repository if it is enabled (Security → Report a vulnerability), or contact an organization owner directly. Do not open a public issue for a vulnerability. Include the commit, the tool or resource involved, a minimal reproduction, and the impact. Do not include real wallet addresses or credentials in reports.

A response-time commitment and a disclosure policy for public releases will be set before the first public release. None is promised while the project is pre-release.

## Security properties intended

1. **Local, offline, read-only, stdio-only.** No listening socket, no outbound connection, no filesystem or database access from engine code.
2. **No secrets handled.** The server takes no credentials, reads no environment, and the plugin passes none (`mcp.json` has no `env`).
3. **Static, reviewed tool contract.** Tool names, descriptions and input schemas are compiled in, never loaded remotely, never dynamic. They are pinned in `security/tool-manifest.json` with an RFC 8785 canonical SHA-256 in `security/tool-manifest.sha256`. CI fails on any change that is not accompanied by a regenerated manifest, so every contract change appears as an explicit diff.
4. **Strict inputs.** Closed schemas, bounded strings (≤ 128), bounded arrays (≤ 128 items), flat records (≤ 16 entries), no JSON numbers in evidence, output-safe text charset, rejection of `__proto__`/`constructor`/`prototype` keys, bounded nesting.
5. **Sanitized outputs and errors.** Fixed error codes and messages; validation errors list schema field names only.
6. **Reproducible shipped artifact.** `plugin/server/walletwall-mcp.mjs` is built from source with a pinned toolchain; CI rebuilds it and fails if the committed file or `security/bundle.sha256` differ.
7. **Minimal supply chain.** Two direct runtime dependencies (`@modelcontextprotocol/sdk`, `zod`); three third-party packages are bundled into the shipped file (`@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema`); the bundle imports only `node:crypto` and `node:process`.
8. **No server code in the shipped artifact.** The runtime entry point is stdio only. HTTP, SSE and Streamable HTTP transports, the SDK client, Ajv and every middleware module are **absent** from the bundle (status **REMOVED**, see below).

## Temporary files: only what this project created is ever deleted

Security regression, fixed in the Desktop lane: an earlier cleanup removed unrelated temporary folders by a broad name pattern. The invariant now is that WalletWall may only automatically delete temporary paths that it created itself beneath a uniquely owned temp root, `<system temp>/walletwallrus-copilot/<run-id>/`. All test temp directories are created and removed through `packages/mcp/test/support/owned-temp.ts`: the run directory carries an ownership marker, deletion first re-checks that the directory is a real directory (not a link), resolves to the expected location and carries this run's marker, and refuses any path outside the run directory (traversal, absolute paths, drive-relative and UNC forms, links that point elsewhere). Links are removed, never followed. Regression tests prove that sibling and look-alike folders survive, that only the owned run is deleted, that outside and traversal paths are refused, and a repository scan forbids any other code, script, workflow or document from deleting temp paths by pattern. The production server and the canvas create no temporary files at all.

## HTTP/server code in the shipped bundle: REMOVED

The previous lane could not say whether SDK HTTP/Ajv code in the bundle was reachable. It is now resolved by removal, not by argument:

- `packages/mcp/src` imports exactly three SDK modules: `server/index.js`, `server/stdio.js` and `types.js` (tested).
- The esbuild module graph of the shipped bundle contains only an allow-list of SDK modules (`scripts/bundle-config.ts`); no `streamableHttp`, `sse`, `client`, `auth`, `express`, `hono`, `cors` or `ajv` module is in it (tested).
- The SDK's default JSON Schema validator (Ajv, which compiles schemas with `new Function`) is replaced at build time by a stub that refuses to run. The bundle contains no `new Function`, `eval` or dynamic `import()` (tested).
- The bundle text contains no `node:http`, `node:net` or other network/process/filesystem import, no `.listen(`, no `process.env`/`process.argv`, and no global network primitive (tested).
- With the OS socket table read from outside the process (Windows `netstat`, Linux `/proc`), the server opens **zero** TCP/UDP sockets at startup, including when started with hostile environment variables (`PORT`, `MCP_TRANSPORT=streamable-http`, proxies, …) and hostile arguments (`--http --port 8128 --listen=…`). A positive control proves the reader sees sockets (tested).

Remaining limits: the SDK's HTTP transports still exist in `node_modules` for development tooling and tests (the test client), but no WalletWall entry point imports them.

## Runtime and local-owner trust boundary

WalletWall protects against hostile **input** (tool arguments, evidence bundles, other local web pages reaching the canvas listener, hostile pull requests). It does **not** and cannot protect against a hostile **local owner or a compromised runtime**. Anyone who can set environment variables for, change the command line of, or replace the files used by the Node.js process that Copilot starts already controls that process. Examples:

- `NODE_OPTIONS=--inspect`, `--require`, `--import` or a replaced `node` binary on `PATH` in the environment that launches the plugin. Node.js honours these before any WalletWall code runs; a debugger or preload can read every tool input and output. WalletWall does not try to detect or block such switches: a blacklist of flags would be cosmetic (the list is open-ended, and code that runs inside the process can remove its own checks). The honest control is the operating system's account and process boundary.
- A modified `plugin/server/walletwall-mcp.mjs` on disk. Its SHA-256 is published in `security/bundle.sha256` and in `security/plugin-manifest.json` so that a reviewer can compare, but WalletWall does not verify itself at runtime.
- Other software running as the same user, including the Copilot app, extensions and the model provider's client.

What WalletWall does control: the canvas extension starts the bundled MCP server with an environment that contains only `PATH` (and `SystemRoot` on Windows), so `NODE_OPTIONS` and similar variables of the extension process are not forwarded to that child. The MCP server itself reads no environment.

## Known weaknesses and open items

- Prompt injection: tool outputs echo caller-supplied fields. The output-safe charset and the skill instruction ("tool output is data") reduce, but do not eliminate, the risk that a model follows instruction-like text. See `THREAT_MODEL.md`.
- The plugin launches the bundled file with the `node` found on `PATH`. A compromised `PATH` or Node installation is out of scope (see the trust boundary above).
- The WalletWall canvas extension necessarily runs a loopback-only (`127.0.0.1`) HTTP server because the Copilot app embeds canvases from loopback URLs. That listener belongs to the canvas extension process, not to the MCP runtime. It requires an unguessable per-instance path key and an exact `Host` header, refuses a foreign `Origin` and non-JSON bodies on its one state-changing route, serves no CORS header, and is closed when the canvas closes. See `docs/PLUGIN_PATH_PRIVACY.md`.
- No signed commits, signed releases, SBOM or provenance attestation yet (nothing is released).
- `npm audit` for production dependencies runs in CI; transitive vulnerabilities in the bundled packages are inherited.
