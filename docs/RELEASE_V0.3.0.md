# WalletWall v0.3.0 release record

Status: **release candidate preparation**. This record is for the WalletWall Agent Plugin 0.3.0 release lane created after PR #4 merged to `main` on 2026-10-24. It is not a certification.

## Release source

| Item | Value |
| --- | --- |
| Repository | `Wallet-Wall/walletwallrus-copilot` |
| Release base | `7011a332d02ce5acf1233106434eee338548e804` |
| Release base tree | `c0d21875a89d5404c2e4931254c7847667f5d7f0` |
| Release branch | `release/v0.3.0` |
| Intended tag | `v0.3.0` |
| Intended title | `WalletWall 0.3.0` |

The release branch is intentionally separate from the merged Canvas feature branch.

## Version domains

| Domain | Version | v0.3.0 action |
| --- | --- | --- |
| WalletWall Agent Plugin | `0.3.0` | **BUMP** |
| Marketplace entry | `0.3.0` | **BUMP** |
| WalletWall MCP engine | `0.1.0` | unchanged |
| WWEP / `EvidenceProfileVersion` | `0.1` | unchanged |
| bundled registry / `RegistryVersion` | `0.2.0` | unchanged |
| rules | `0.1.0-draft` | unchanged |
| policies | `0.1.0-draft` | unchanged |
| official MCP Registry package | `0.2.0` | unchanged unless MCP package inputs change |

The plugin release version and WWEP/MCP version domains are independent. A Canvas/UI release is not a reason to mutate registry data, rules, policies, engine identity or the standalone MCP package.

## Release content

v0.3.0 packages the merged post-v0.2.0 plugin work, including:

- responsive desktop/tablet/phone Canvas composition;
- native-SVG Coinstellation presentation adapter;
- technical-drawing evidence plate grammar;
- WalletWall matte palette and typography;
- shared human/agent assertion selection;
- Trace on the same graph using authoritative MCP provenance;
- the flattened detail rail and Wallprint integration.

The authoritative semantic boundary remains:

> WWEP/MCP decides what is true; Coinstellation decides where it goes, how it moves, and what gets emphasized.

## Adversarial release review

The pre-update review explicitly checked for the following release hazards:

1. **Version-domain conflation.** Rejected. `RegistryVersion`, WWEP, rules, policies and MCP engine remain unchanged.
2. **Fake MCP Registry synchronization.** Rejected. `server.json` and `mcpb/manifest.json` remain on the already-published v0.2.0 MCP package unless the package itself changes.
3. **Historical rewrite.** Rejected. v0.2.0 tag, release assets, checksums and historical audit/install records remain immutable.
4. **Premature release claims.** Root README continues to point at the actually published v0.2.0 release until v0.3.0 exists; no dead v0.3.0 release link is introduced in the release PR.
5. **Generated-hash bypass.** Rejected. Plugin manifest and artifact hashes must match the repository generators; CI is not weakened and no hash is invented merely to make checks green.
6. **Scope creep.** Rejected. No Canvas redesign, new backend, telemetry, auth, custody, signing, trading, arbitrary network/database access or unrelated refactor belongs in the release lane.

## Generated artifacts

The plugin manifest changes because the plugin version and active plugin README change. The following semantic/MCP hashes are expected to remain unchanged unless an unexpected diff is found:

- tool manifest;
- MCP server bundle;
- MCPB package;
- WWEP conformance corpus;
- registry data;
- authority policy and rules.

The release candidate must regenerate and verify:

```text
security/plugin-manifest.json
security/plugin-manifest.sha256
security/plugin-artifact.sha256
```

The deterministic release artifact is:

```text
walletwall-plugin.tar
```

Its release SHA-256 must equal `security/plugin-artifact.sha256` at the exact release commit.

## MCP Registry decision

Default action for v0.3.0:

```text
MCP_REGISTRY_ACTION: NO_PUBLISH_REQUIRED
```

Reason: the merged work changes the Copilot plugin/Canvas, not the standalone MCP package. The existing official registry entry `io.github.Wallet-Wall/walletwall` remains valid at package version `0.2.0` and continues to point at the v0.2.0 MCPB asset.

If any release-preparation diff changes the MCP server bundle, MCPB manifest/content, tool contract, served resources or runtime dependencies, this no-op decision is invalid and the MCP release impact must be reviewed separately before publication.

## Required verification before tag

All of the following must pass on the final release commit:

```text
npm ci
npm run verify
npm run audit:prod
npm run test:canvas
npm run test:privacy
npm run test:sandbox
npm run verify:plugin
npm run verify:plugin-manifest
npm run verify:plugin-artifact
npm run verify:mcpb
```

GitHub required checks on `main` / release PR:

```text
verify
verify-windows
offline-sandbox
```

Also required:

- deterministic plugin artifact rebuilt from the release commit;
- actual GitHub Copilot Desktop host smoke using synthetic fixtures;
- no Canvas clipping, broken fonts/images or shared-selection regression;
- stale-identity and conflicting-balances fixtures open in the real host;
- Trace stays on the same graph;
- no unexpected off-origin request, persistent query write or CSP weakening.

## Release assets

For a plugin-only v0.3.0 release, the minimum intended assets are:

```text
walletwall-plugin.tar
SHA256SUMS
```

Do not manufacture a `walletwall.mcpb` v0.3.0 solely to synchronize numbering. The standalone MCP artifacts remain associated with their real package release.

## Copilot discovery

After v0.3.0 is merged and published, prepare the existing plugin-only Agent Finder/Copilot catalog draft against the then-current upstream schema/rules. Submit the plugin once; do not separately duplicate its bundled skill or manually duplicate the official MCP Registry entry.

Icon publication is optional and should not block the first plugin submission. If the WalletWall mark is later added, preserve trademark controls and any upstream redistribution-attestation requirements.

## Stop conditions

Do not tag or publish v0.3.0 if any of these occurs:

- unexpected MCP server or MCPB byte change;
- unexpected WWEP/registry/rules/policy change;
- privacy or sandbox failure;
- weakened CSP or new network behavior;
- persistent write behavior;
- Linux or Windows required-check failure;
- live Copilot host smoke failure;
- non-reproducible plugin artifact;
- generated manifest/artifact hash mismatch.

## Release status

```text
PLUGIN_VERSION: 0.3.0
MCP_ENGINE: 0.1.0 / unchanged
WWEP: 0.1 / unchanged
REGISTRY_VERSION: 0.2.0 / unchanged
RULES_VERSION: 0.1.0-draft / unchanged
POLICIES_VERSION: 0.1.0-draft / unchanged
MCP_REGISTRY_PACKAGE: 0.2.0 / unchanged
TAG: NOT_CREATED
GITHUB_RELEASE: NOT_CREATED
COPILOT_CATALOG: NOT_SUBMITTED
```
