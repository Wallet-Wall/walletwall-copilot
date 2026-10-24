# Threat model

Scope: the local MCP server (`packages/mcp`, shipped as `plugin/server/walletwall-mcp.mjs`), the WalletWall canvas extension, the plugin manifest, and the repository's build and CI. Status: draft, unreviewed.

## Assets

1. Confidentiality of wallet addresses and queries a user types into Copilot.
2. Integrity of evidence classifications (a wrong `ESTABLISHED` is the worst outcome).
3. Integrity of the tool contract the model sees (names, descriptions, schemas).
4. Integrity of the shipped artifact.
5. The user's machine (no new local attack surface is intended).

## Trust boundaries

```text
User ─ Copilot client ─ model provider           (outside this repo)
              │ stdio (JSON-RPC)
        walletwall MCP server (this repo)        (no network, no disk writes, no env)
```

The model and Copilot client are untrusted with respect to input shape: the server validates everything. The server trusts neither tool arguments nor the evidence inside them.

## Threats and responses

| # | Threat | Response | Evidence |
| --- | --- | --- | --- |
| T1 | Query/wallet exfiltration by this code | No network or fs capability; static bans, runtime guard, OS sandbox job; no server/HTTP code in the shipped bundle | `PRIV-001..016` |
| T2 | Persistent query/wallet storage or fingerprinting | Nothing written; no randomness/identity API called | `PRIV-005..010` |
| T3 | Credentials leaked | None accepted or read; canary-credential test | `PRIV-011` |
| T4 | Malicious or malformed tool arguments (oversize, deep nesting, prototype pollution, type confusion) | Closed schemas, bounds, forbidden-key pre-check, no JSON numbers | `ADV-001..007`, `mcp.test.ts` |
| T5 | Dependency-graph abuse (cycles, dangling refs, derivation tampering) | Memoized evaluation with cycle detection; dangling refs reported; recomputation of derived values | `ADV-008..013` |
| T6 | Authority laundering (provider presented as chain authority, derived value presented as upstream, duplicate or non-independent sources counted twice) | Claim-specific policies; origin/source-kind checks; independence groups with collapse; weakest-member propagation; invariants INV-06..09, INV-13 | `AUT-*`, `EVD-005/006` |
| T7 | Spoofed token (symbol reuse, wrong decimals, look-alike address) | Identity requires issuer attestation matched to registry authority; symbol never identity; registry mismatch is `NOT_ESTABLISHED` | `EVD-002..004`, `AUT-008` |
| T8 | Staleness/finality abuse | Explicit evaluation time; stale never satisfies current; finality required for `ESTABLISHED` | `FRS-*` |
| T9 | Silent rewrite of history | Supersession records with identity and time-ordering checks; duplicate IDs flagged | `CNF-005..009` |
| T10 | Numeric corruption (float precision, overflow, malformed strings) | String atomic units, BigInt, canonical form, uint256 bound, JCS rejects numbers | `EVD-010*`, `quantity.test.ts` |
| T11 | Tool poisoning / contract drift (description or schema changed to manipulate the model) | Static definitions; manifest + canonical SHA-256 pinned; CI diff gate; description linter | `manifest.test.ts` |
| T12 | Prompt injection via echoed fields | Output-safe text charset (no brackets, quotes, newlines); skill says tool output is data; **residual risk remains** | `ADV-005` |
| T13 | Supply-chain compromise of dependencies or build | Exact version pins, lockfile install (`npm ci`), reproducible bundle check, `npm audit`, minimal direct deps; **no provenance attestation yet** | CI |
| T14 | Malicious `node` on `PATH` or tampered install directory | Out of scope; documented | — |
| T15 | Misleading user-facing claims | Banned-phrase check; states described as evidence sufficiency; non-implications listed in every readiness result | `plugin-validator`, `BOUNDARIES.md` |
| T16 | Deleting data the project does not own (broad temp-folder cleanup) | One owned temp root and run directory with ownership marker, containment and link checks; no pattern deletion anywhere; regression tests and repository scan | `owned-temp.test.ts` |
| T17 | Local web page or process reaching the canvas listener (DNS rebinding, port guessing, cross-origin read or forged select request) | Loopback-only bind (checked in the OS socket table), unguessable per-instance path key, exact `Host` check, foreign `Origin` and non-JSON bodies refused on the one state-changing route, no CORS header, CSP allowing only the page's own origin, escaped rendering of every value, four routes only | `canvas/explorer.test.ts`, `canvas/hardening.test.ts`, `PRIV-017` |
| T18 | Hostile local owner or compromised runtime (`NODE_OPTIONS=--inspect`, preload flags, replaced `node` or bundle file) | **Out of scope, documented.** WalletWall protects against hostile input, not against whoever controls the process that runs it; no flag blacklist is attempted. The canvas starts the MCP child with `PATH` (and `SystemRoot`) only. The bundle hash is published for comparison | `SECURITY.md` (runtime and local-owner trust boundary), `PRIV-019` |
| T19 | Hostile pull request from a public fork (workflow or dependency change that runs with write access, secrets or publish credentials) | Only `push` to `main` and `pull_request` triggers, read-only token, no secrets, every action pinned to a commit SHA, no artifact or cache publishing, CODEOWNERS on workflows, manifests and policies, fork-approval policy in `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md` | `repo/workflows.test.ts` |
| T20 | Copy of an address that differs from the one shown (shortened, re-cased or re-checksummed value on the clipboard) | Addresses are printed in full in every detail and list; a piece on The Wall may show a shortened face, but its accessible name and its detail carry the full value, and both copy controls (Copy, Copy chain + address) copy the text of the full value, never a shortened one | `canvas/hardening.test.ts` |

## Residual risks and honest gaps

- A caller can supply fabricated evidence. The engine can say the fabricated evidence is well-formed and policy-sufficient; it cannot detect that a `CHAIN_OBSERVED` reading was invented (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached). Live provider retrieval with cross-checking is deferred.
- The registry carries point-in-time verification only (`REGISTRY_VERIFIED_POINT_IN_TIME`): five records were checked on 2026-10-24 against issuer/protocol publications and finalized chain state. Proxy upgrades, issuer actions or later changes after that date are not observed.
- Authority policies are WalletWall-authored drafts with no outside review.
- EIP-55 checksum validation is not implemented.
- The in-process guard cannot observe native code; the OS sandbox covers this only for the CI Linux runner.
- The Copilot client and model provider see all inputs and outputs.
- No third-party security review has occurred.
