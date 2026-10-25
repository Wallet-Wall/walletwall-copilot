# Skills

WalletWall skill source of truth lives inside `plugin/skills/` so GitHub Copilot and Claude share one methodology tree without duplicate logic.

The product-facing priority is **WalletWall Vault**:

- `plugin/skills/vault-readiness/SKILL.md` — primary Vault migration/readiness workflow.
- `plugin/skills/walletwall-evidence-audit/SKILL.md` — supporting claim decomposition and evidence classification.
- `plugin/skills/walletwall-authority/SKILL.md` — supporting authority, provenance and independence analysis.
- `plugin/skills/walletwall-evidence/SKILL.md` — shared WalletWall evidence workflow.

The Claude plugin metadata lives in `plugin/.claude-plugin/plugin.json`; its local MCP config lives in `plugin/.mcp.json`. GitHub Copilot keeps `plugin/plugin.json` and `plugin/mcp.json`. Both local host envelopes launch the same `plugin/server/walletwall-mcp.mjs` file.

Do not create a second runtime or second skill copy merely for host-specific packaging. Host metadata may differ; evidence semantics must not drift.

The hosted Vault Guardian path is separate from this local distribution lane and uses the remote Streamable HTTP transport. Local Claude distribution remains stdio/local/offline/read-only.

Skill rules: never claim truth or guarantee merely because evidence is presented; always surface limitations and conflicts; never turn missing into zero/false; never convert quantity to USD without price evidence; preserve authority/provenance distinctions; never ask for keys; never sign, broadcast, custody, trade, or identify the person behind a wallet.
