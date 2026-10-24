# WalletWall 0.3.0 (draft release notes)

WalletWall 0.3.0 introduces the Coinstellation Canvas: a responsive technical evidence plate for exploring sources, observations, claims, conflicts, provenance and vault technical readiness inside GitHub Copilot.

## Highlights

- **Coinstellation Canvas.** The Wall is now a deterministic technical plate rather than the earlier box-and-arrow flow. Strong geometry is reserved for semantic anchors; facts and context use lighter drafting notation.
- **One graph, shared selection.** Human assertion clicks and the agent's `select_assertion` action share the explorer's authoritative `selectedId`. Trace emphasizes the selected assertion's MCP-returned provenance on the same graph.
- **Responsive composition.** Desktop, tablet and phone layouts preserve the same evidence state, with a focused phone composition and bottom-sheet detail.
- **WalletWall visual system.** The Canvas uses WalletWall's terracotta, charcoal and warm technical-paper palette, Sora/Manrope/IBM Plex Mono typography, matte surfaces and a modern technical-drawing grammar.
- **Accessibility and motion.** Keyboard/focus behavior, touch targets, reduced-motion behavior and zoom checks are covered by the Canvas test and measurement suites.

## What did not change

This release does **not** change WWEP semantics, the MCP tool contract, authority policy, registry data, vault-readiness rules or the standalone MCP package.

- WWEP `EvidenceProfileVersion`: `0.1` (unchanged)
- bundled registry `RegistryVersion`: `0.2.0` (unchanged)
- rules / policies: `0.1.0-draft` (unchanged)
- WalletWall MCP engine: `0.1.0` (unchanged)
- official MCP Registry package: remains `io.github.Wallet-Wall/walletwall` version `0.2.0`

The MCP Registry version is intentionally not synchronized to the Copilot plugin version: this is a plugin/Canvas release and the standalone MCP package did not change.

## Privacy and security posture

WalletWall-controlled code remains local, read-only and stdio-based. This release adds no WalletWall backend, telemetry, query-history retention, custody, signing, transaction execution, arbitrary RPC/HTTP/SQL, investment advice or regulatory-compliance certification.

The Canvas remains loopback-only with the existing Host/Origin protections and CSP; no remote assets or new network behavior are introduced by this release.

## Install

After this release is published from `main`:

```text
copilot plugin marketplace add Wallet-Wall/walletwallrus-copilot
copilot plugin install walletwall@walletwall
```

Requires Node.js 22.18 or newer on `PATH`.

## Release boundary

`v0.2.0` remains immutable historical release evidence. WalletWall 0.3.0 is a new plugin release and does not rewrite the v0.2.0 tag, assets, checksums or audit facts.

No GitHub, Copilot marketplace, MCP Registry or third-party listing should be described as an endorsement, approval or certification.
