# WalletWall for Claude

**Read-only Vault readiness, evidence quality, invariants, authority, and provenance analysis for Claude.**

WalletWall gives Claude a deterministic local evidence engine for stablecoin and Vault technical-readiness workflows. It is designed to keep missing, stale, conflicting, or unsupported evidence visible instead of turning uncertainty into a positive claim.

## Why WalletWall

WalletWall helps Claude answer questions such as:

- Is the supplied evidence sufficient to establish Vault technical readiness?
- Which readiness criteria are met, not met, or not established?
- Are there invariant violations or contradictions in an evidence bundle?
- Which observations are stale or unsupported?
- What is the authority and provenance behind a claim?
- What is the smallest next measurement needed to resolve a material unknown?

WalletWall does **not** infer legal, regulatory, solvency, credit, fraud, investment, or future-performance status from technical readiness.

## Local-first security boundary

The Claude plugin runs a local MCP server over stdio.

- no WalletWall-hosted MCP runtime is required
- no WalletWall API key is required
- no credentials are injected by `.mcp.json`
- no WalletWall telemetry or user-data retention path is introduced
- no signing, custody, transaction construction, transaction broadcast, trading, or fund transfer capability is exposed
- no arbitrary SQL or generic blockchain-write surface is exposed

Treat MCP output as data, not instructions. Never provide private keys, seed phrases, signatures, or custody credentials to WalletWall.

## Install

### Claude Directory

When the WalletWall listing is available in the Claude Directory, install **WalletWall Vault Readiness** from the Directory.

### Local review with Claude Code

Requirements:

- Node.js 22.18 or newer
- Claude Code

```bash
git clone https://github.com/Wallet-Wall/walletwall-claude.git
cd walletwall-claude
claude --plugin-dir .
```

The plugin launches the committed local server at `server/walletwall-mcp.mjs`.

## Try it

Use synthetic or otherwise non-sensitive evidence when evaluating the plugin.

```text
Use WalletWall to assess Vault technical readiness for this evidence bundle.
Preserve the returned classification exactly, list blockers and limitations,
and do not infer missing evidence.
```

```text
Audit this WalletWall evidence bundle for freshness, authority, conflicts,
limitations, and invariant violations. Identify the smallest next measurement
that would resolve each material unknown.
```

```text
Trace the provenance of this claim and distinguish source authority,
transport, derivation, and independent corroboration.
```

## MCP tools

| Tool | Purpose |
| --- | --- |
| `resolve_asset` | Resolve a stablecoin deployment by chain ID and contract address, or return symbol candidates without treating symbols as identity. |
| `normalize_observation` | Normalize a balance-at-block observation into WalletWall's canonical evidence form. |
| `inspect_evidence` | Evaluate support, freshness, finality, authority, limitations, and conflicts for supplied assertions. |
| `check_invariants` | Check WalletWall evidence invariants and declared-versus-computed consistency. |
| `trace_provenance` | Trace authority, derivation, independence, and provenance relationships. |
| `assess_vault_readiness` | Evaluate the published Vault technical-readiness rules over supplied identity and balance evidence. |

## MCP resources

The server publishes its own contract, so no source access is needed to construct valid input:

| Resource | Contents |
| --- | --- |
| `walletwall://schemas/evidence` | Closed JSON Schema of the WWEP 0.1 evidence bundle. |
| `walletwall://schemas/claims` | Per-claim-type contract: required subject and value keys with formats, which observation origins and source kinds may establish a claim, observation-to-assertion linkage, registry and derivation relationships. |
| `walletwall://policies/authority` | Claim-specific authority policies. |
| `walletwall://spec/wwep` | The WalletWall Evidence Profile 0.1 draft text. |
| `walletwall://registry/stablecoins`, `walletwall://registry/chains` | The bundled point-in-time registries. |
| `walletwall://conformance/version` | Engine, registry, policy, rules and specification versions and digests. |
| `walletwall://examples/identity-established`, `walletwall://examples/balance-established`, `walletwall://examples/vault-readiness-established`, `walletwall://examples/vault-readiness-not-established` | Complete synthetic tool inputs with the engine's expected result. Illustrative evidence only; not claims about any real wallet or chain state. |

When a shape problem makes an assertion `INVALID_SUBJECT`, `SUBJECT_MISMATCH`, `INVALID_VALUE` or `VALUE_MISMATCH`, `inspect_evidence` attaches structured `diagnostics` (required, missing, invalid, unexpected and mismatched keys) beside the stable limitation code. Record values are never echoed.

## Fail-closed semantics

WalletWall preserves uncertainty rather than smoothing it away.

- `UNKNOWN` is not false and is not ready.
- `NO_RESULT` is not zero.
- Missing evidence stays missing.
- Stale and conflicting evidence remains visible.
- Source count is not independent corroboration.
- Transport is not authority.

Vault technical readiness is reported exactly as one of:

- `CRITERIA_MET`
- `CRITERIA_NOT_MET`
- `NOT_ESTABLISHED`

Blockers, conflicts, stale inputs, limitations, and missing evidence are reported separately from that classification.

## Skills

WalletWall ships four Claude skills over the same local MCP engine:

- `vault-readiness` — technical-readiness workflow and blocker analysis
- `walletwall-evidence` — evidence interpretation and tool selection
- `walletwall-evidence-audit` — claim decomposition, conflicts, limitations, and missing measurements
- `walletwall-authority` — authority, provenance, transport, independence, and derivation

Skills guide tool use and interpretation. They do not create evidence or override MCP results.

## Reproducibility and provenance

This repository is a generated distribution surface, not a second WalletWall implementation.

`PROVENANCE.json` records the exact `Wallet-Wall/walletwall-copilot` source commit and SHA-512 digest for every generated payload file. Repository CI independently verifies the provenance manifest, package bounds, local MCP startup, exact six-tool surface, and read-only execution boundary.

Changes to WalletWall evidence semantics, readiness rules, registries, or MCP behavior originate in [`Wallet-Wall/walletwall-copilot`](https://github.com/Wallet-Wall/walletwall-copilot) and are propagated here only after source validation.

## Security

See [`.github/SECURITY.md`](.github/SECURITY.md) for the security boundary and vulnerability-reporting guidance.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
