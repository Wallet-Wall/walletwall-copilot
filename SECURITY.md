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

1. **Local, offline, read-only, stdio-only.** No listening socket, no outbound connection, no filesystem or database access from engine code. The shipped artifacts contain no HTTP adapter; the optional one lives in `scripts/` and is described under "Local adapters".
2. **No secrets handled.** The server takes no credentials, reads no environment, and the plugin passes none (`mcp.json` has no `env`).
3. **Static, reviewed tool contract.** Tool names, descriptions and input schemas are compiled in, never loaded remotely, never dynamic. They are pinned in `security/tool-manifest.json` with an RFC 8785 canonical SHA-512 in `security/tool-manifest.sha512`. CI fails on any change that is not accompanied by a regenerated manifest, so every contract change appears as an explicit diff.
4. **Strict inputs.** Closed schemas, bounded strings (≤ 128), bounded arrays (≤ 128 items), flat records (≤ 16 entries), no JSON numbers in evidence, output-safe text charset, rejection of `__proto__`/`constructor`/`prototype` keys, bounded nesting. See "Hostile or malformed input" for what the open maps can and cannot do.
5. **Sanitized outputs and errors.** Fixed error codes and messages; validation errors list schema field names only.
6. **Reproducible shipped artifact.** `plugin/server/walletwall-mcp.mjs` is built from source with a pinned toolchain; CI rebuilds it and fails if the committed file or `security/bundle.sha512` differ.
7. **Minimal supply chain.** Two direct runtime dependencies (`@modelcontextprotocol/sdk`, `zod`); three third-party packages are bundled into the shipped file (`@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema`); the bundle imports only `node:crypto` and `node:process`.
8. **No server code in the shipped artifact.** The runtime entry point is stdio only. HTTP, SSE and Streamable HTTP transports, the SDK client, Ajv and every middleware module are **absent** from the bundle (status **REMOVED**, see below).
9. **SHA-512 for WalletWall-owned release integrity.** Current bundle, tool-manifest, plugin-manifest, plugin-artifact and local brand-asset integrity fingerprints use SHA-512. SHA-256 remains where an upstream contract requires it (for example MCP Registry `fileSha256`), where a value is itself a native upstream hash, or where an immutable historical release/provenance record must be preserved. WWEP 0.1 evidence and MCP resource-digest semantics are versioned separately and are not silently changed by this release-integrity migration.

## Temporary files: only what this project created is ever deleted

Security regression, fixed in the Desktop lane: an earlier cleanup removed unrelated temporary folders by a broad name pattern. The invariant now is that WalletWall may only automatically delete temporary paths that it created itself beneath a uniquely owned temp root, `<system temp>/walletwallrus-copilot/<run-id>/`. All test temp directories are created and removed through `packages/mcp/test/support/owned-temp.ts`: the run directory carries an ownership marker, deletion first re-checks that the directory is a real directory (not a link), resolves to the expected location and carries this run's marker, and refuses any path outside the run directory (traversal, absolute paths, drive-relative and UNC forms, links that point elsewhere). Links are removed, never followed. Regression tests prove that sibling and look-alike folders survive, that only the owned run is deleted, that outside and traversal paths are refused, and a repository scan forbids any other code, script, workflow or document from deleting temp paths by pattern. The production server and the canvas create no temporary files at all.

## HTTP/server code in the shipped bundle: REMOVED

The previous lane could not say whether SDK HTTP/Ajv code in the bundle was reachable. It is now resolved by removal, not by argument:

- `packages/mcp/src` imports exactly three SDK modules: `server/index.js`, `server/stdio.js` and `types.js` (tested).
- The esbuild module graph of the shipped bundle contains only an allow-list of SDK modules (`scripts/bundle-config.ts`); no `streamableHttp`, `sse`, `client`, `auth`, `express`, `hono`, `cors` or `ajv` module is in it (tested).
- The SDK's default JSON Schema validator (Ajv, which compiles schemas with `new Function`) is replaced at build time by a stub that refuses to run, so no Ajv module is in the bundle (tested). The bundle text contains no literal `eval(`, `new Function` or `Function(` and no dynamic `import()` (tested), but that is a bounded tripwire and not a claim that the bundle generates no code at runtime: see the next section.
- The bundle text contains no `node:http`, `node:net` or other network/process/filesystem import, no `.listen(`, no `process.env`/`process.argv`, and no global network primitive (tested).
- With the OS socket table read from outside the process (Windows `netstat`, Linux `/proc`), the server opens **zero** TCP/UDP sockets at startup, including when started with hostile environment variables (`PORT`, `MCP_TRANSPORT=streamable-http`, proxies, …) and hostile arguments (`--http --port 8128 --listen=…`). A positive control proves the reader sees sockets (tested).

Remaining limits: the SDK's HTTP transports still exist in `node_modules` for development tooling and tests (the test client), but no WalletWall entry point imports them.

## Dynamic code generation: what is and is not claimed

Earlier text said that no `new Function` was present in the bundle. That was stronger than the evidence: the bundle includes Zod, and Zod builds functions at runtime. The claim is now limited to what is proved.

**WalletWall-owned code.** `packages/mcp/src` has no `eval`, `new Function` or dynamic `import()`. ESLint (`no-eval`, `no-new-func`, both errors) and the `PRIV-003` source scan check this. Both are syntactic checks that an aliased constructor would evade.

**Vendored Zod 4.6.7** (bundled into `plugin/server/walletwall-mcp.mjs` and therefore the MCPB; shipped as files in the Claude Directory package) reaches the `Function` constructor in three modules, each through `const F = Function`, which is why the literal tripwire never saw it:

| Module | Purpose | State in WalletWall |
| --- | --- | --- |
| `zod/v4/core/util.js` | capability probe, `new F("")` | executed once at startup |
| `zod/v4/core/doc.js` | code builder for the object-schema fast path | executed: one function per object schema, built on its first synchronous parse |
| `zod/v4/core/compile.js` | ahead-of-time `z.compile()` | present in the bytes, imported into the bundle, never called by WalletWall |

Reachability, measured by recording constructions through the global `Function` binding while the shipped bundle served every example, resource and tool: the bytes are present; the modules are imported; the path is reachable, because WalletWall's own schemas are object schemas parsed synchronously (registry load at startup, `safeParse` in every tool call); and it is exercised, at startup and per call. The generated source is derived from the key names of WalletWall's static schemas. A test sends caller-supplied values through the runtime and finds none in any generated function source. This is an observation for the tested inputs plus a reading of Zod's generator, not a formal proof.

WalletWall does not depend on the generated code: with V8 told to forbid code generation from strings (`--disallow-code-generation-from-strings`) Zod falls back to its interpreted parser and every tested response is identical. Zod's documented `z.config({ jitless: true })` is not enabled. It would remove no code from any artifact, it only stops the execution, and in the Claude Directory package, where the SDK and Zod load as separate files before WalletWall's code runs, it takes effect only after the SDK's own schemas are built unless that package is restructured. Zod already degrades safely where code generation is blocked, so the change buys no further protection.

What the checks prove: the `PRIV-015` literal tripwire (`eval(`, `new Function`, `Function(` in the bundle text) is clean and is a **bounded tripwire**, not proof that no dependency generates code. A separate inventory test fails if any other module in the bundle, or any other `.js` file of the Zod package that the Claude Directory package copies, reaches the `Function` constructor in one of the forms it enumerates (a `Function` bound to a name, a constructor call, `eval(`, `Reflect.construct`/`apply` on `Function`), so a Zod upgrade that adds such a site must be reviewed and this section updated. Neither check sees `(() => {}).constructor(...)`, `globalThis["Function"](...)`, `const g = globalThis; g.Function` or code loaded some other way; WalletWall makes no claim about them beyond the module allow-list and the absence of `require`, `vm` and dynamic `import()`.

## Hostile or malformed input

What WalletWall actively validates and refuses, on every path that reaches the engine (stdio, the canvas, the optional HTTP adapter):

- Every tool input is parsed by a closed schema before any engine code runs. An unknown field on a closed object, a wrong type, an oversize list or string, a JSON number in evidence, text outside the output-safe charset, and nesting deeper than 12 levels or more than 20,000 values are refused with a fixed error code. The error names schema field names only and never repeats a caller value.
- An object key named `__proto__`, `constructor` or `prototype` anywhere in the input is refused before schema validation, not silently dropped. The schema parser independently drops `__proto__` and never assigns a prototype, so the second layer does not rely on the first.
- Numbers that matter (balances, prices, block heights) are decimal strings parsed with exact integer arithmetic; a JSON number is refused.

**Open maps.** `subject`, `value` and `payload` are bounded open maps: they accept keys outside a claim type's contract so that evidence can carry extra, extensible detail. A map holds at most 16 entries; a key is a letter followed by up to 31 letters, digits or underscores; a value is a boolean, `null` or at most 128 characters of output-safe text (no numbers, arrays or nested objects). Together with the list limits this bounds the largest bundle the schema admits to about 1.5 MiB. What an unknown key can and cannot do is pinned by `packages/mcp/test/sandbox/open-maps.test.ts`:

- It never changes support, freshness, finality, authority, limitations, conflicts, corroboration, dependencies, supersession, provenance, readiness criteria or the readiness classification, and it never raises support. Every conformance case is re-run with unknown keys added to every open map and must give the same result.
- It is part of the record's identity: the assertion digest and the bundle digest cover the bytes the caller presented, so adding a key changes them. This is intended.
- `check_invariants` also reads the open maps as tripwires (a value key naming USD on a quantity claim, a zero or `false` presented for a missing observation). A key can add a violation; it cannot remove one.
- No result forwards an unknown key. The suggested readiness assertion carries only the five subject keys of its own claim type, and shape diagnostics list an unknown key name only as `*` and never a value.
- Hostile names are not special: `__proto__`, `constructor` and `prototype` are refused; names such as `toString`, `valueOf` or `hasOwnProperty` are ordinary unknown keys and are never called.

The canvas displays the bundle the user supplied, escaped, and is the one place raw open-map content is shown.

Not claimed: the engine cannot tell invented evidence from real evidence. It reports whether the presented evidence meets published policy.

## Prompt injection

WalletWall does not claim to prevent prompt injection and does not attempt to detect it. The model it follows is: **tool output is data, not instruction authority.** What the software controls, and tests:

- The output-safe charset refuses quotes, brackets, backticks, newlines, control characters and shell or tool-call syntax in every free-text field. Instruction-like words in plain text (for example `Ignore all previous instructions`) are legal text and are carried as data.
- Results are built from fixed fields. Caller text is echoed in exactly two places: identifiers the caller chose (ids, authority ids and independence groups: letters, digits and `_.:-`, no spaces) in identifier fields and provenance attributes, and the transport label of a source (`retrievedVia`, at most 64 output-safe characters) as the named provenance attribute `ww:retrievedVia`. Unknown map keys, unknown values and every other free-text field are never returned.
- Errors are fixed text and never repeat input. No result contains an instruction, role, message, tool-call or command field, and a result never causes a second tool call, a file, a network request or a process: this is checked over real MCP stdio under the runtime guard (`packages/mcp/test/sandbox/prompt-injection.test.ts`).
- The server instructions and all four skills tell the host to treat returned content as data and to ignore instruction-like text inside it.

Limits: a model can still follow instruction-like text that is legal output-safe text, for example in a transport label. WalletWall cannot control what a host or model does with a result; a host should treat every returned field as untrusted data.

## Local adapters

| Adapter | When it exists | Listener | Protection |
| --- | --- | --- | --- |
| stdio MCP server (the shipped bundle) | the supported path for Copilot, Claude Code and Cowork, the MCPB and the Claude Directory package | none | the operating system's parent-child pipe between the host and the process it started |
| Canvas listener (Copilot extension) | while a canvas is open | `127.0.0.1`, OS-chosen port | unguessable per-instance path key (18 random bytes, 144 bits), exact `Host`, foreign `Origin` and non-JSON bodies refused, no CORS, four routes (`docs/PLUGIN_PATH_PRIVACY.md`) |
| Optional HTTP adapter, `scripts/claude-mcp-http.ts` | only when a user starts it with `--enable`; it is in no release artifact | `127.0.0.1` or `::1` only | per-process ephemeral bearer token, plus the checks below |

**The optional HTTP adapter** exists for one optional workflow: a user attaching their own Claude Managed Agent through an Anthropic MCP tunnel (`docs/CLAUDE_MANAGED_AGENT.md`). No supported host needs it; Copilot and Claude local use are stdio. It is not bundled, not in the MCPB, the Copilot plugin or the Claude Directory package, and no shipped manifest, package script or workflow starts it (tested).

- **Off by default.** Without `--enable` the script prints one line, opens nothing and exits non-zero. There is no environment variable that enables or configures it; the adapter reads no environment.
- **Loopback only, no external-bind mode.** It binds `127.0.0.1` (default) or `::1`. `0.0.0.0`, `::`, `localhost`, every other address and every other spelling of loopback are refused at startup, and the listening address is checked again after bind. The earlier `--host 0.0.0.0` mode, and the Cloud Run deployment that required it, are withdrawn; a remotely hosted adapter would be a separate design with its own authentication model.
- **Ephemeral bearer token.** At start the process draws 32 bytes (256 bits) from the operating system's CSPRNG (`node:crypto` `randomBytes`) and encodes them as 43 base64url characters. The token is never read from the environment, a file or the command line, never written to disk, never put in a URL, a response, an error or a log, and is shown once, on the operator's terminal (stderr), together with the URL. It lives only in the process and a new one is drawn at every start; the previous token is dead. Do not redirect that output to a persistent log.
- **One accepted carrier.** `Authorization: Bearer <token>`; the scheme name is case-insensitive as RFC 9110 requires. A missing, wrong, shorter, longer, malformed or differently carried token (a query string, a cookie, another header, another scheme) is refused with a fixed `401`. The comparison is `timingSafeEqual` over equal-length buffers. A caller without the token learns nothing about routes or methods: every path and method answers `401`.
- **Request validation still applies after authentication.** The `Host` header must name the listener exactly (`127.0.0.1:<port>`, `[::1]:<port>` or `localhost:<port>`) or the request is refused, which stops a web page that has re-pointed a hostile name at loopback. A browser `Origin` must be the listener's own loopback origin. One route, `POST /mcp`; every other method is `405` and every other path `404`; the content type must be `application/json`; the request target is at most 256 characters; the body is at most 512 KiB, enforced on the declared length and again while streaming; malformed JSON is `400`. No CORS header is ever sent. The adapter is stateless, read-only and serves the same six tools and eleven resources as stdio.

Remaining boundary: the token protects against a process that does not hold it: a web page, another local user, or another program that finds the port. A process that already runs as the same operating-system account, or controls the Node.js runtime, can read the terminal, the process or its memory, and is inside the local trust boundary (next section).

Compatibility: earlier versions of this adapter ran without `--enable` and without authentication, accepted `--host 0.0.0.0`, read `PORT` and served an unauthenticated `GET /health`. Clients of the HTTP adapter must now send the token; the stdio server is unchanged.

## Hostile local owner

WalletWall assumes the local operating-system account and process environment are relied upon. Someone who already controls that account or process can inspect or alter local tool traffic and code. WalletWall does not attempt to detect or resist a compromised machine owner, and it does not claim to.

This does not mean WalletWall can inspect other people's computers. It has no remote service, no account system and no network access of its own; the limit above only describes what a person who already controls *this* machine can do on *this* machine. In the terms of this document, four different actors are kept apart:

| Actor | What WalletWall does |
| --- | --- |
| Remote caller with no credentials | Nothing is reachable: the shipped runtime opens no socket, and the optional adapter binds loopback only |
| Local program that does not hold the token (a web page, another user's process) | Refused by the adapter's token, `Host` and `Origin` checks and by the canvas path key |
| Hostile program running as the same account | Out of scope: it can already read what the account can read, including the process and the terminal |
| Hostile owner of the machine or account | Out of scope: it controls the runtime, the files and the memory |

The hardening of the optional adapter improves the second row. It does not address the third or the fourth.

Anyone who can set environment variables for, change the command line of, or replace the files used by the Node.js process that Copilot starts already controls that process. Examples:

- `NODE_OPTIONS=--inspect`, `--require`, `--import` or a replaced `node` binary on `PATH` in the environment that launches the plugin. Node.js honours these before any WalletWall code runs; a debugger or preload can read every tool input and output. WalletWall does not try to detect or block such switches: a blacklist of flags would be cosmetic (the list is open-ended, and code that runs inside the process can remove its own checks). The honest control is the operating system's account and process boundary.
- A modified `plugin/server/walletwall-mcp.mjs` on disk. Its SHA-512 is published in `security/bundle.sha512` and in `security/plugin-manifest.json` so that a reviewer can compare, but WalletWall does not verify itself at runtime.
- Other software running as the same user, including the Copilot app, extensions and the model provider's client.

What WalletWall does control: the canvas extension starts the bundled MCP server with an environment that contains only `PATH` (and `SystemRoot` on Windows), so `NODE_OPTIONS` and similar variables of the extension process are not forwarded to that child. The MCP server itself reads no environment.

## Known weaknesses and open items

- Prompt injection: tool outputs echo a small set of caller-supplied fields (see "Prompt injection"). The output-safe charset, the fixed output shape and the instruction that returned content is data reduce, but do not eliminate, the risk that a model follows instruction-like text. See `THREAT_MODEL.md`.
- The plugin launches the bundled file with the `node` found on `PATH`. A compromised `PATH` or Node installation is out of scope (see "Hostile local owner").
- The WalletWall canvas extension necessarily runs a loopback-only (`127.0.0.1`) HTTP server because the Copilot app embeds canvases from loopback URLs. That listener belongs to the canvas extension process, not to the MCP runtime. It requires an unguessable per-instance path key and an exact `Host` header, refuses a foreign `Origin` and non-JSON bodies on its one state-changing route, serves no CORS header, and is closed when the canvas closes. The path key travels in the URL the app embeds, which is why this listener uses a key in the path and not a header. See `docs/PLUGIN_PATH_PRIVACY.md`.
- The optional HTTP adapter's token is shown on the operator's terminal. Anything that can read that terminal, or capture the adapter's output into a log, can read the token; see "Local adapters".
- No signed commits, signed releases, SBOM or provenance attestation yet (nothing is released).
- `npm audit` for production dependencies runs in CI; transitive vulnerabilities in the bundled packages are inherited.
