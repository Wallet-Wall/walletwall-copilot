# WalletWall Claude distribution

WalletWall uses one evidence/readiness implementation across supported hosts. Claude distribution adds host metadata and methodology skills; it does not introduce a second evidence engine, a second readiness model, or a WalletWall-hosted dependency.

## Two packaging surfaces, one engine

The repository intentionally has two Claude-related shapes.

### Local development package

`plugin/` remains the multi-host development/release package used to prove that Copilot and Claude launch the same WalletWall MCP implementation:

```text
packages/mcp
     |
     | deterministic source/runtime
     v
plugin/server/walletwall-mcp.mjs
     |
     +-- GitHub Copilot: plugin/mcp.json
     +-- Claude Code/Cowork: plugin/.mcp.json
```

Claude and Copilot use different host envelopes:

- Copilot: `${PLUGIN_ROOT}/server/walletwall-mcp.mjs`
- Claude: `${CLAUDE_PLUGIN_ROOT}/server/walletwall-mcp.mjs`

Repository tests fail if those relative server paths diverge.

### Claude Directory artifact

`npm run build:claude-directory` emits `dist/claude-directory/`, a root-ready package intended to populate the dedicated public `Wallet-Wall/walletwall-claude` distribution repository.

```text
dist/claude-directory/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── LICENSE
├── README.md
├── PROVENANCE.json
├── server/
│   ├── walletwall-mcp.mjs
│   ├── modules/
│   ├── vendor/
│   └── chunks/
└── skills/
    ├── walletwall-evidence/
    ├── walletwall-evidence-audit/
    ├── walletwall-authority/
    └── vault-readiness/
```

The Directory artifact is generated from the same WalletWall source but is deliberately split into readable ESM modules. This keeps the Claude review surface inspectable and prevents a single large bundled file from becoming the Directory security-review boundary.

The builder fails closed if:

- the artifact exceeds 512 files;
- any non-image/font file exceeds 256 KiB;
- the build itself cannot resolve the approved local MCP runtime dependencies.

`dist/` is generated output and is not committed to this source repository. The dedicated Claude distribution repository should contain only a reviewed generated artifact, not a hand-maintained fork.

## Claude skills

The added skills are methodology only:

- `vault-readiness` — drives the published WalletWall readiness workflow and preserves `CRITERIA_MET`, `CRITERIA_NOT_MET`, and `NOT_ESTABLISHED` exactly.
- `walletwall-evidence-audit` — decomposes claims, surfaces limitations/conflicts, and identifies the next missing measurement.
- `walletwall-authority` — separates authority, provenance, transport, independence, and derivation.
- `walletwall-evidence` — remains the general WalletWall evidence guide.

Skills may guide tool selection and interpretation. They do not create evidence, override MCP results, or change readiness semantics.

## Runtime boundary

The local Claude path remains:

- local stdio;
- read-only;
- credential-free;
- telemetry-free;
- free of WalletWall-hosted inference or MCP execution;
- unable to sign, custody, broadcast, trade, or mutate a wallet.

The optional Streamable HTTP / Cloud Run transport is a separate deployment surface. It is not required for Claude Code or Cowork local-plugin use and must not be silently substituted for the local stdio path.

## Release and Directory gates

A Claude distribution change is not publish-ready until:

1. `.claude-plugin/plugin.json` is valid, minimal, and explicitly versioned.
2. `.mcp.json` exposes exactly one local `walletwall` server.
3. Claude and Copilot local development configs resolve to the same WalletWall MCP implementation.
4. No Claude config injects credentials, shell commands, hosted inference, or a second runtime.
5. All four WalletWall skills are packaged and pass repository structure checks.
6. `npm run verify:claude-directory` passes on Linux and Windows.
7. The root-ready Directory artifact stays within the 512-file and 256-KiB non-media-file limits.
8. SHA-512 plugin manifest/artifact records for the multi-host `plugin/` package are regenerated intentionally when that package changes.
9. Linux `verify`, Windows `verify-windows`, and `offline-sandbox` pass.
10. A real Claude Code or Cowork smoke confirms the exact reviewed package starts and exposes all six WalletWall MCP tools.
11. `claude plugin validate .` passes from the root of the dedicated Directory repository.
12. `claude plugin eval .` is run before Directory submission and the result is reviewed rather than treated as an automatic approval.

## Manual Claude smoke

For the source-tree development package:

```bash
claude --plugin-dir ./plugin
```

For the generated Directory artifact:

```bash
npm run build:claude-directory
claude --plugin-dir ./dist/claude-directory
```

In either case, verify that the `walletwall` MCP server exposes:

- `resolve_asset`
- `normalize_observation`
- `inspect_evidence`
- `check_invariants`
- `trace_provenance`
- `assess_vault_readiness`

Then run one synthetic readiness case and confirm:

- no WalletWall backend is contacted;
- no credentials are requested;
- no persistent user data is created by WalletWall;
- limitations/conflicts remain visible;
- readiness wording is returned exactly rather than simplified to `ready`/`not ready`.

Record the Claude host version, Node version, reviewed source commit SHA, generated-artifact provenance, discovered tool count, and observed result before publishing a Claude-facing release.

## Dedicated Directory repository

The intended public submission repository is `Wallet-Wall/walletwall-claude`. It is a distribution repository, not an independent source of truth.

Its root should be replaced atomically from one reviewed `dist/claude-directory/` build. `PROVENANCE.json` records the WalletWall source repository and source commit used to produce the package. Changes to evidence semantics, readiness rules, registries, or MCP behavior must originate in `walletwall-copilot` and pass its conformance/security gates before being propagated.

## Future hosted Guardian

Claude Managed Agent / hosted Guardian access is a separate lane. It may use the hardened Streamable HTTP transport only after MCP authentication, quotas, production ingress, and the narrow Vault read plane are independently reviewed. Local Claude distribution does not depend on that work.
