# Privacy

Every wallet address and query is treated as sensitive, ephemeral input. This document describes the design and exactly what has and has not been demonstrated. It is not a promise about anything beyond what the code and tests show.

> WalletWall-controlled code does not retain MCP query history or transmit query data to WalletWall infrastructure. GitHub Copilot and the selected model provider may independently process prompts and tool data under their own policies.

> WalletWall reports what identified sources and authority policies support. A supported result does not guarantee that upstream information is correct.

Hashing an address is not anonymization, and WalletWall does not hash, store or index addresses at all. Real user-derived query content is never shipped in this repository: tests, fixtures and screenshots use synthetic addresses, and the registry holds issuers' public contract addresses only (`docs/REGISTRY_SOURCES.md`).

## Design

Lifecycle of a request:

```text
MCP request (stdio) → process memory → pure calculation → MCP response → references released
```

The server is a stateless function over its input. It has:

- no user ID, device ID, machine fingerprint or generated identifier (no randomness or OS-identity API is called)
- no telemetry, analytics, crash upload or remote configuration
- no persistent query history, evidence cache, wallet-address store or hashed-address store
- no logging (logging is disabled; stderr carries only a fixed fatal line if the process dies)
- no network access and no filesystem writes by the engine code (it imports no network or filesystem module; Node.js itself loads the bundle file at startup and honours its own standard environment variables such as `NODE_OPTIONS`)
- no reading of environment variables, working directory, HOME or temp directories by the engine code
- no WalletWall account, backend, GitHub App credential, OAuth, token or webhook

Errors are fixed-shape. Validation errors report only known schema field names and issue codes; they never echo caller-supplied values.

What a response necessarily contains: the data you sent, evaluated. Digests of evidence objects that contain an address are returned to you. Nothing is retained after the response.

## Enforcement

| Layer | Mechanism |
| --- | --- |
| Capability absence | ESLint `no-restricted-imports` bans fs, net, http(s), dns, tls, child_process, os, vm and others in `packages/mcp/src`; bans `fetch`, `process.env`, `Date.now`, `Math.random`. |
| Static tests | `privacy/static.test.ts` re-checks imports, URLs, randomness, clocks, env, logging; scans the production lockfile for telemetry/crash/fingerprint packages; asserts the shipped bundle imports only `node:crypto` and `node:process`. |
| Runtime guard | `privacy/runtime.test.ts` runs the real server over stdio, from source and from the shipped bundle, under a preload guard that blocks and records network, DNS, filesystem-write, process-spawn, randomness and machine-identity calls, with a unique canary address and canary credentials in a fresh isolated cwd/HOME/TMP/XDG environment. |
| Positive control | `privacy/guard.test.ts` proves the guard detects and blocks each forbidden operation, so a zero count is meaningful. |
| OS-level sandbox | CI job `offline-sandbox` runs the engine tests and an end-to-end stdio check in Docker with `--network none --read-only` and a read-only source mount. |
| No HTTP/server code shipped | `privacy/reachability.test.ts` (`PRIV-015`, `PRIV-016`): the esbuild module graph holds only the SDK stdio server; the bundle text has no network, listen, spawn, env, argv, eval or Function primitive; the OS socket table (Windows `netstat`, Linux `/proc`) shows zero sockets at startup, also with hostile environment variables and arguments. |
| WalletWall canvas and the combined path | `canvas/plugin-path.test.ts`, `canvas/explorer.test.ts` and `canvas/hardening.test.ts` (`PRIV-017`..`PRIV-019`): a canvas-profile guard records and blocks outbound network, non-loopback DNS, writes and foreign spawns; every MCP server the canvas starts runs under the strict guard; zero files; canary address and credentials absent; the OS socket table shows exactly one listener, on `127.0.0.1`. Details and limits: `docs/PLUGIN_PATH_PRIVACY.md`. |

Requirement matrix `PRIV-001`..`PRIV-019` with evidence levels: `conformance/privacy/PRIV-matrix.json`.

## Limits of what is demonstrated

- The runtime guard is an in-process instrument (monkey-patching Node APIs). It cannot see native add-ons or direct syscalls. The OS-level sandbox job in CI covers that for the Linux runner only.
- Tests run natively on Linux and Windows in CI and on the developer machine (Windows 11). Other platforms are not tested.
- The WalletWall canvas opens one loopback-only listener (the Copilot app only embeds loopback URLs). It is not part of the MCP runtime, writes nothing and contacts nothing else; the Copilot app, GitHub and the model provider still receive whatever the agent passes to it. WalletWall does not claim that nothing leaves the machine: that is outside what this repository can show for the Copilot product.
- The AI client (Copilot) sees every tool input and output; its own data handling is outside this repository and governed by GitHub's terms. Wallet addresses you put in a prompt are sent to the model provider by the client, not by this plugin.
- Node.js and the operating system may retain data outside this process's control (for example swap, crash dumps enabled by the operator, shell history of the launching tool). No claim is made about those.
- "No telemetry" is a statement about this repository's code and dependency tree at the tested commit. It is not a statement about Copilot, GitHub, Node.js or your OS.
