# Boundaries

What WalletWall does, and the things it must never do. These are enforced by architecture and tests, not by disclaimers: the forbidden capabilities **do not exist** in the code, the tool surface or the plugin.

## Allowed

- Inspect evidence that the caller supplies.
- Identify supported assets by chain ID and contract address from the bundled registry.
- Reproduce deterministic calculations (canonical digests, exact decimal rendering, USD valuation from explicit price evidence, technical-readiness classification).
- Trace provenance.
- Expose limitations, conflicts, staleness, finality and supersession.
- Evaluate WalletWall's published `VAULT_TECHNICAL_READINESS` rules.

## Forbidden

| Forbidden | How its absence is enforced |
| --- | --- |
| Custody; accepting or transmitting funds | No tool, no network, no key material. Manifest test fails if a tool name matches transfer/send/approve. |
| Private-key or seed-phrase handling; signing | No crypto-signing code; skill instructs refusal; no tool accepts such fields (strict schemas). |
| Broadcasting; transaction construction | No network, no RPC; no transaction schema exists. |
| Swap, trade or execution routing | No such tool; manifest test. |
| Issuing or redeeming stablecoins | No such capability. |
| Personalized investment recommendations | Tool outputs are classifications with stated non-implications; skill forbids advice. |
| Legal or regulatory certification; AML/KYC/OFAC certification | No such claim type exists; wording guard in plugin description test. |
| Natural-person deanonymization or enrichment | No such data or tool; registry holds issuers only; static scan (`PRIV-013`). |
| Guaranteeing that upstream evidence is true | States describe evidence sufficiency under policy only (`spec/EVIDENCE_PROFILE.md` §1); `TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached to chain readings. |
| Guaranteeing that arbitrary LLM prose is correct | No `verify_response` or free-text verifier. Only structured evidence and assertions are evaluated. |
| Arbitrary RPC, HTTP fetch or SQL | The server imports no network or database module; lint and tests enforce it. |
| Writing files, persisting queries or caching wallets | The server imports no filesystem module; the canvas extension imports none either (lint and tests); privacy suite enforces zero writes on the whole plugin path. |
| Serving anything over HTTP from the MCP runtime | HTTP, SSE and Streamable HTTP transport code is removed from the shipped bundle (`PRIV-015`); zero sockets at startup (`PRIV-016`). The only listener is the WalletWall canvas, loopback-only, because the Copilot app embeds canvases from loopback URLs. |
| Natural-person identification or reuse of copied third-party content | The registry holds issuers' public contract addresses only; no personal data and no copied third-party text (`docs/REGISTRY_SOURCES.md`). |
| Deleting anything outside a directory this project created | All temp cleanup goes through one helper that deletes only `<temp>/walletwallrus-copilot/<run-id>/` after an ownership check; no glob or name pattern ever selects a path to delete (security regression tests). |

## Readiness terminology

The product exposes `VAULT_TECHNICAL_READINESS` with values `CRITERIA_MET`, `CRITERIA_NOT_MET`, `NOT_ESTABLISHED`. It does **not** establish investment merit, solvency, creditworthiness, legal status, regulatory compliance, absence of fraud, or future performance. A generic "READY" value is never emitted.

## Claims this project will not make

"truth engine", "verified truth", "guaranteed accurate", "99.9% accurate", "compliance-grade", "regulator-approved", "tamper-proof", "100% private", "nothing leaves the machine", "NIST certified", "anonymous", "secure". A test rejects such phrases in the plugin description and in the public documentation except where a document is denying the claim. Passing tests does not make the implementation secure, private, accurate or compliant; see `THREAT_MODEL.md` and the handoff statement of what is proven and what is not.
