# Skills

Source of truth for Copilot skills lives **inside the plugin**, because Agent Plugins 1.0 discovers skills only from `skills/` at the plugin root:

- `plugin/skills/walletwall-evidence/SKILL.md`

This directory is intentionally not a second copy. Add further skills under `plugin/skills/<name>/` (name = directory, lowercase, hyphenated) and extend `packages/mcp/test/sandbox/plugin.test.ts` if they need new checks.

Skill rules: never claim truth or guarantee; always surface limitations and conflicts; never turn missing into zero/false; never convert quantity to USD without price evidence; use `VAULT_TECHNICAL_READINESS` wording; never ask for keys; never give investment advice or identify people.
