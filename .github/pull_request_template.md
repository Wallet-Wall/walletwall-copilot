## What and why

<!-- One concern per pull request. Link an issue if there is one. -->

## Sensitive areas touched

<!-- Tick everything that applies. These get heightened review (see CONTRIBUTING.md and .github/CODEOWNERS). -->

- [ ] WWEP semantics, authority policy, support / freshness / finality states, readiness rules
- [ ] An MCP tool, tool description or schema (`security/tool-manifest.json` regenerated and the diff reviewed)
- [ ] Registry records or authority attributions (source URL, locator and check date included)
- [ ] Networking, persistence, credentials, environment access, process execution, telemetry or the canvas listener
- [ ] `.github/workflows/`, `plugin/`, `security/`, `scripts/`, dependencies or lockfile
- [ ] Privacy or security wording in the documentation
- [ ] None of the above

## Checks

- [ ] `npm run verify` passes locally
- [ ] I added or updated a regression test for any behaviour change
- [ ] No real wallet addresses, queries, conversations, logs, local paths or credentials are in this change (use synthetic fixtures)
- [ ] I have the right to submit this change under the repository license
