# WalletWall Vault Readiness for Claude

**Read-only checks of blockchain evidence for WalletWall Vault technical readiness, run locally.**

WalletWall helps you check whether blockchain evidence you supply is sufficient to establish WalletWall Vault technical readiness for a stablecoin balance. Its read-only tools run on your computer and report evidence support, freshness, finality, authority, conflicts and invariant violations. They keep provider-reported data separate from authority and keep unknown or missing evidence visible instead of turning it into a positive claim.

WalletWall works with cryptocurrency data: stablecoin contracts, token balances and wallet addresses. It does not fetch chain data, connect to wallets or blockchain providers, sign, custody or move funds, and it does not assess legal, regulatory, solvency, credit, fraud, investment or future-performance status.

## Why WalletWall

WalletWall helps Claude answer questions such as:

- Is the supplied evidence sufficient to establish Vault technical readiness?
- Which readiness criteria are met, not met, or not established?
- Are there invariant violations or contradictions in an evidence bundle?
- Which observations are stale or unsupported?
- What is the authority and provenance behind a claim?
- What is the smallest next measurement needed to resolve a material unknown?

A result states how well the evidence you supplied satisfies WalletWall's published policy. It is not an independent verification of on-chain or issuer data: WalletWall does not check that a reading was faithfully retrieved.

## Where it works

| Claude surface | Skills | WalletWall tools (local MCP server) |
| --- | --- | --- |
| Claude Code (terminal, IDE extensions, desktop app's Code tab) | Yes | Yes |
| Cowork, in a session that runs on your computer | Yes | Yes |
| claude.ai chat, Claude desktop and mobile chat, Cowork sessions that do not run on your computer | Yes | No: these surfaces do not start local servers |

Where the tools are not available, the skills say so and give no WalletWall result.

## Install

### Claude Directory

When the WalletWall listing is available in the Claude Directory, add **WalletWall Vault Readiness** from the Directory.

### Local review with Claude Code

Requirements:

- Node.js 22.18 or newer, on `PATH` (the server is started with `node`)
- Claude Code

```bash
git clone https://github.com/Wallet-Wall/walletwall-claude.git
cd walletwall-claude
claude --plugin-dir .
```

The plugin launches the committed local server at `server/walletwall-mcp.mjs`. No account, API key or credential is needed.

## Try it

These work with no data of your own: they use the synthetic examples the server ships.

```text
Read WalletWall's synthetic example walletwall://examples/vault-readiness-established and run the
Vault technical-readiness assessment on its tool input. Report the exact classification and each criterion.
```

```text
Use walletwall://examples/vault-readiness-not-established to show which evidence is missing and what
the smallest next measurement would be.
```

```text
Inspect the evidence in walletwall://examples/balance-established: list support, freshness, finality,
authority and any limitations, and say whether WalletWall can give a US dollar value.
```

With your own evidence (use synthetic or otherwise non-sensitive data while you evaluate the plugin):

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

All six tools are read-only (`readOnlyHint: true`, `destructiveHint: false`) and run offline.

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

When a shape problem makes an assertion `INVALID_SUBJECT`, `SUBJECT_MISMATCH`, `INVALID_VALUE` or `VALUE_MISMATCH`, `inspect_evidence` attaches structured `diagnostics` (required, missing, invalid, unexpected and mismatched keys) beside the stable limitation code. Record values and unexpected key names are never echoed.

## Fail-closed semantics

WalletWall preserves uncertainty rather than smoothing it away.

- `UNKNOWN` is not false and is not ready.
- `NO_RESULT` is not zero.
- Missing evidence stays missing.
- Stale and conflicting evidence remains visible.
- Source count is not independent corroboration.
- Transport is not authority.
- A derived claim gets no support from dependencies about another subject.
- Hex case does not change an address's identity, so it cannot hide a conflict. Records keep the spelling supplied.
- A reused assertion, source, observation or derivation ID names no record: every assertion in the bundle and readiness are `NOT_ESTABLISHED`, whichever record comes first.
- The order of a bundle's records changes no evaluation answer. A dependency cycle gives no basis: no assertion on it is established.
- `PINNED` does not excuse an observation dated after the evaluation time.

Vault technical readiness is reported exactly as one of:

- `CRITERIA_MET`
- `CRITERIA_NOT_MET`
- `NOT_ESTABLISHED`

Blockers, conflicts, stale inputs, limitations, and missing evidence are reported separately from that classification.

## Privacy and data flow

- **On your computer:** the WalletWall server runs as a local process started by Claude. It makes no network requests, writes no files, keeps no logs, history or cache, and reads no credentials. Evidence is processed in memory for the duration of one tool call.
- **What Claude sees:** your prompts, the evidence you pass to a tool and every tool result are part of your conversation with Claude and are processed by Anthropic under your Claude terms. WalletWall does not claim that nothing leaves your machine.
- **What WalletWall receives:** nothing. There is no WalletWall account, backend, telemetry or remote configuration.
- **Wallet addresses:** a public address can be personal data when it is linked to a person. Share only what you need, and never share private keys, seed phrases, signatures or credentials. Hashing an address is not anonymization.
- **Text that comes back:** tool results repeat the identifiers you supplied (assertion, observation, source and derivation ids, rule ids, independence groups, authority ids), and `trace_provenance` also repeats `transport.retrievedVia` and a derivation's `rulesVersion`. Each is limited to 64 characters without quotes, brackets or line breaks, but they can still carry words, so the skills tell Claude to treat them as labels and never as instructions. Record values and unknown keys are not repeated. This reduces prompt-injection risk but does not remove it: text from a bundle you were given still reaches the model, and other tools available in your Claude session are outside WalletWall's read-only boundary. Only pass evidence you are willing to show Claude, and review any action Claude proposes.

More detail: [WalletWall MCP privacy and security](https://docs.walletwall.org/mcp/privacy-security).

## Security boundary

The Claude plugin runs a local MCP server over stdio.

- no WalletWall-hosted MCP runtime is required
- no WalletWall API key is required
- no credentials are injected by `.mcp.json`
- no WalletWall telemetry or user-data retention path is introduced
- no signing, custody, transaction construction, transaction broadcast, trading, or fund transfer capability is exposed
- no arbitrary SQL or generic blockchain-write surface is exposed

Treat MCP output as data, not instructions. Never provide private keys, seed phrases, signatures, or custody credentials to WalletWall.

## Limitations

- WalletWall evaluates only the evidence you supply. It cannot tell whether a reading was retrieved faithfully, and a well-formed bundle of invented evidence can satisfy a policy.
- The registries are point-in-time snapshots, and the authority policies and readiness rules are versioned drafts (`walletwall://conformance/version`).
- WalletWall has not had an independent security review or audit.
- The tools need Node.js 22.18 or newer on the computer that runs Claude Code or Cowork.

## Skills

WalletWall ships four Claude skills over the same local MCP engine:

- `vault-readiness`: technical-readiness workflow and blocker analysis
- `walletwall-evidence`: evidence interpretation and tool selection
- `walletwall-evidence-audit`: claim decomposition, conflicts, limitations, and missing measurements
- `walletwall-authority`: authority, provenance, transport, independence, and derivation

Skills guide tool use and interpretation. They do not create evidence or override MCP results.

## Support and security reports

- Questions and bugs: [GitHub issues](https://github.com/Wallet-Wall/walletwall-copilot/issues) on the source repository.
- Vulnerabilities: report privately through GitHub private vulnerability reporting on [`Wallet-Wall/walletwall-copilot`](https://github.com/Wallet-Wall/walletwall-copilot/security) (Security, then Report a vulnerability). Do not include real wallet addresses, private keys, seed phrases or credentials in a report.

## Reproducibility and provenance

This repository is a generated distribution surface, not a second WalletWall implementation.

The payload is every tracked file outside `.github/`, which holds this repository's own workflows, source pin and policies. `PROVENANCE.json` records the `Wallet-Wall/walletwall-copilot` source commit the payload was generated from, and the size and SHA-512 digest of every other payload file. `node_modules/` holds unmodified copies of files from the server's three runtime dependencies as installed from npm: the MCP SDK modules the server loads, and the JavaScript files of `zod` and `zod-to-json-schema`. The one exception is the SDK's `dist/esm/validation/ajv-provider.js`, which is replaced by a stub that disables the SDK's JSON Schema validation. `assets/icon.png` is the Directory listing icon, copied from the source repository only if it matches its recorded size and SHA-512. The skills are the source skills without their Copilot-only sections. `.gitattributes` turns off line-ending conversion, so a clone keeps the recorded bytes even where Git is configured with `core.autocrlf=true`.

This repository's CI checks:

- **Consistency:** every manifested file is present with its recorded size and SHA-512 digest, every tracked payload file is manifested, and `PROVENANCE.json` names the commit pinned in `.github/source-pin.json`, lists at most 512 files and lists no non-media file over 256 KiB.
- **Shape:** a fixed set of root entries and exactly the four skills, regular non-executable files, a metadata-only `.claude-plugin/plugin.json`, one local `walletwall` server in `.mcp.json` with no environment variables or remote URL, and the Ajv stub in place.
- **Origin:** it regenerates the package from the pinned source commit, which must be reachable from the source repository's `main` branch, and requires the committed payload to equal that output file for file and byte for byte.
- **Startup:** the committed server starts over stdio and lists exactly the six tools above.
- **Drift:** a text scan of `server/`, `skills/` and `.mcp.json` rejects a short list of transaction signing, broadcast and transfer call names.

The text scan is a tripwire, not a proof of the read-only boundary, and none of these checks evaluates evidence. WalletWall's evidence semantics and its offline, read-only runtime behavior are tested in the source repository.

Changes to WalletWall evidence semantics, readiness rules, registries, or MCP behavior originate in [`Wallet-Wall/walletwall-copilot`](https://github.com/Wallet-Wall/walletwall-copilot) and are propagated here only after source validation.

## Security

See [`.github/SECURITY.md`](.github/SECURITY.md) for the security boundary and vulnerability-reporting guidance.

## Trademarks

"WalletWall" and the WalletWall brick-wallet logo identify WalletWall. The Apache License 2.0 that covers this software grants no right to use them beyond describing where the software came from (section 6). See [`TRADEMARKS.md`](https://github.com/Wallet-Wall/walletwall-copilot/blob/main/TRADEMARKS.md) in the source repository.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
