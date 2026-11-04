# Threat model

Scope: the local MCP server (`packages/mcp`, shipped as `plugin/server/walletwall-mcp.mjs`), the WalletWall canvas extension, the optional user-run HTTP adapter (`scripts/claude-mcp-http.ts`, not shipped), the plugin manifest, and the repository's build and CI. Status: draft, unreviewed.

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

optional, user-run, off unless --enable:
   user's own MCP tunnel ── loopback HTTP + bearer token ── walletwall MCP contract (same six tools)
```

The model and Copilot client are untrusted with respect to input shape: the server validates everything. The server trusts neither tool arguments nor the evidence inside them.

Four actors are kept apart (details in `SECURITY.md`, "Hostile local owner"): a remote caller with no credentials (nothing is reachable); a local program that does not hold the adapter token or canvas key, such as a web page or another user's process (refused); a hostile program running as the same account (out of scope); and a hostile owner of the machine or account (out of scope).

## Threats and responses

| # | Threat | Response | Evidence |
| --- | --- | --- | --- |
| T1 | Query/wallet exfiltration by this code | No network or fs capability; static bans, runtime guard, OS sandbox job; no server/HTTP code in the shipped bundle | `PRIV-001..016` |
| T2 | Persistent query/wallet storage or fingerprinting | Nothing written; no randomness/identity API called | `PRIV-005..010` |
| T3 | Credentials leaked | None accepted or read; canary-credential test | `PRIV-011` |
| T4 | Malicious or malformed tool arguments (oversize, deep nesting, prototype pollution, type confusion) | Closed schemas, bounds, forbidden-key pre-check (refused, not stripped; the schema parser independently never assigns `__proto__`), no JSON numbers | `ADV-001..007`, `mcp.test.ts`, `open-maps.test.ts` |
| T5 | Dependency-graph abuse (cycles, dangling refs, derivation tampering) | A dependency cycle is found from the records and read the same from every side, so record order decides nothing; dangling refs reported; recomputation of derived values | `ADV-008..013`, `ADV-018..019` |
| T6 | Authority laundering (provider presented as chain authority, derived value presented as upstream, duplicate or non-independent sources counted twice) | Claim-specific policies; origin/source-kind checks; independence groups with collapse; weakest-member propagation; invariants INV-06..09, INV-13 | `AUT-*`, `EVD-005/006` |
| T7 | Spoofed token (symbol reuse, wrong decimals, look-alike address) | Identity requires issuer attestation matched to registry authority; symbol never identity; registry mismatch is `NOT_ESTABLISHED` | `EVD-002..004`, `AUT-008` |
| T8 | Staleness/finality abuse | Explicit evaluation time; stale never satisfies current; finality required for `ESTABLISHED` | `FRS-*` |
| T9 | Silent rewrite of history | Supersession records with identity and time-ordering checks, and a record that fails them, or names nothing, takes nothing out of conflict detection, so it cannot hide a conflict (a record that can be valid is the author's claim, taken as made: see the residual risks); a reused assertion, source, observation or derivation ID names no record and refuses the bundle | `CNF-005..009`, `CNF-013..015`, `CNF-017..036` |
| T10 | Numeric corruption (float precision, overflow, malformed strings) | String atomic units, BigInt, canonical form, uint256 bound, JCS rejects numbers | `EVD-010*`, `quantity.test.ts` |
| T11 | Tool poisoning / contract drift (description or schema changed to manipulate the model) | Static definitions; manifest + canonical SHA-256 pinned; CI diff gate; description linter | `manifest.test.ts` |
| T12 | Prompt injection via echoed fields | Tool output is data, not instruction authority. Output-safe text charset (no brackets, quotes, newlines); results built from fixed fields; caller text echoed only as caller-chosen identifiers and two named provenance attributes (`ww:retrievedVia`, `ww:rulesVersion`); unknown map keys and values never returned; server instructions and all four skills say returned content is data; no detector is claimed. **Residual risk remains**: plain-text instruction-like words are legal text and a model may still follow them | `ADV-005`, `sandbox/prompt-injection.test.ts`, `privacy/prompt-injection-runtime.test.ts` |
| T13 | Supply-chain compromise of dependencies or build | Exact version pins, lockfile install (`npm ci`), reproducible bundle check, `npm audit`, minimal direct deps; **no provenance attestation yet** | CI |
| T14 | Malicious `node` on `PATH` or tampered install directory | Out of scope; documented | — |
| T15 | Misleading user-facing claims | Banned-phrase check; states described as evidence sufficiency; non-implications listed in every readiness result | `plugin-validator`, `BOUNDARIES.md` |
| T16 | Deleting data the project does not own (broad temp-folder cleanup) | One owned temp root and run directory with ownership marker, containment and link checks; no pattern deletion anywhere; regression tests and repository scan | `owned-temp.test.ts` |
| T17 | Local web page or process reaching the canvas listener (DNS rebinding, port guessing, cross-origin read or forged select request) | Loopback-only bind (checked in the OS socket table), unguessable per-instance path key, exact `Host` check, foreign `Origin` and non-JSON bodies refused on the one state-changing route, no CORS header, CSP allowing only the page's own origin, escaped rendering of every value, four routes only | `canvas/explorer.test.ts`, `canvas/hardening.test.ts`, `PRIV-017` |
| T18 | Hostile local owner or compromised runtime (`NODE_OPTIONS=--inspect`, preload flags, replaced `node` or bundle file, another program running as the same account) | **Out of scope, documented.** WalletWall assumes the local operating-system account and process environment are relied upon; someone who already controls that account or process can inspect or alter local tool traffic and code, and WalletWall does not attempt to detect or resist that. This does not mean WalletWall can inspect other people's computers. No flag blacklist is attempted. The canvas starts the MCP child with `PATH` (and `SystemRoot`) only. The bundle hash is published for comparison | `SECURITY.md` (Hostile local owner), `PRIV-019` |
| T19 | Hostile pull request from a public fork (workflow or dependency change that runs with write access, secrets or publish credentials) | Only `push` to `main` and `pull_request` triggers, read-only token, no secrets, every action pinned to a commit SHA, no artifact or cache publishing, CODEOWNERS on workflows, manifests and policies, fork-approval policy in `docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md` | `repo/workflows.test.ts` |
| T20 | Copy of an address that differs from the one shown (shortened, re-cased or re-checksummed value on the clipboard) | Addresses are printed in full in every detail and list; a piece on The Wall may show a shortened face, but its accessible name and its detail carry the full value, and both copy controls (Copy, Copy chain + address) copy the text of the full value, never a shortened one | `canvas/hardening.test.ts` |
| T21 | Meaning smuggled through the open maps `subject`, `value` and `payload` (an extra key that changes a state, is forwarded into a reusable result, or reaches a prototype) | Bounded maps (16 entries, key and value patterns, scalars only); evaluation reads only the claim type's contract keys; an unknown key never changes a state and never raises support; it is covered by the record digest by design and read by `check_invariants` as a tripwire that can only add a violation; the suggested readiness assertion carries only its five contract subject keys; diagnostics report unknown key names as `*`; `__proto__`, `constructor` and `prototype` refused | `sandbox/open-maps.test.ts` |
| T22 | Local process or web page reaching the optional HTTP adapter (no token, DNS rebinding, foreign `Origin`, wrong method, oversized or malformed body, token guessing or leakage) | Not shipped; off unless `--enable`; loopback-only bind with no external-bind mode (`0.0.0.0`, `::` and every other address refused); per-process bearer token, 256 bits from the OS CSPRNG, compared in constant time, never persisted, logged, echoed or taken from the environment; exact `Host`, same-origin `Origin`, one `POST /mcp` route, JSON only, 512 KiB body cap; every refusal is a fixed body. A hostile program running as the same account is out of scope (T18) | `transport/http.test.ts`, `mutation/local-adapter-mutation.ts` |

## Residual risks and honest gaps

- A caller can supply fabricated evidence. The engine can say the fabricated evidence is well-formed and policy-sufficient; it cannot detect that a `CHAIN_OBSERVED` reading was invented (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached). Live provider retrieval with cross-checking is deferred.
- A supersession record is the author's claim that a later assertion replaces an earlier one, and the engine takes it as made: nothing asks whether the later assertion has evidence of its own. A record that names two different assertions of one claim identity, the later asserted later, therefore still takes its target out of conflict detection when the later assertion has no source and no value, so an author who supplies two readings that disagree can retire one with an empty successor, and `inspect_evidence`, `check_invariants` and `assess_vault_readiness` then read the other as if it stood alone. A record that cannot be valid hides nothing (T9). Measured and not yet closed: what a successor must carry, and what becomes of the conflicts of an assertion it retires, are open design questions.
- The registry carries point-in-time verification only (`REGISTRY_VERIFIED_POINT_IN_TIME`): five records were checked on 2026-10-24 against issuer/protocol publications and finalized chain state. Proxy upgrades, issuer actions or later changes after that date are not observed.
- Authority policies are WalletWall-authored drafts with no outside review.
- EIP-55 checksum validation is not implemented.
- The in-process guard cannot observe native code; the OS sandbox covers this only for the CI Linux runner.
- The Copilot client and model provider see all inputs and outputs.
- No third-party security review has occurred.
