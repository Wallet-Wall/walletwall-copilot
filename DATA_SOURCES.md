# Data sources

All data is bundled at build time. Nothing is fetched at runtime.

## Registry (`packages/mcp/registry/`)

Registry version **0.2.0**, status **`VERIFIED_POINT_IN_TIME`**. Verified on **2026-10-24** (UTC). It is a bundled point-in-time snapshot, not live or current-chain data. Per-record claim, authority, source, locator, verification date, stored fields, redistribution basis and attribution: `docs/REGISTRY_SOURCES.md`. Each record carries its own `verification` block; the engine loads a record into the factual registry **only if its identity is `AUTHORITY_ATTESTED`**. A record that cannot be verified is `NOT_ESTABLISHED` (or `FIXTURE_ONLY`) and is excluded from lookups and cross-checks. All five records below verified; none was removed.

Every registry-derived result carries the limitation `REGISTRY_VERIFIED_POINT_IN_TIME`: the registry is a snapshot, not a live view, and verification says nothing about safety, solvency or later contract changes.

| Asset | Chain | Address | Identity fact (class) | Identity source | Decimals fact (class) |
| --- | --- | --- | --- | --- | --- |
| USDC | Ethereum (1) | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `AUTHORITY_ATTESTED` (issuer: Circle) | Circle, USDC contract addresses, Mainnet table, row Ethereum | 6, `CHAIN_OBSERVED` (finalized block 26259206) |
| USDC | Base (8453) | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `AUTHORITY_ATTESTED` (issuer: Circle) | Same page, row Base | 6, `CHAIN_OBSERVED` (finalized block 53007918) |
| USDC | Arbitrum One (42161) | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` | `AUTHORITY_ATTESTED` (issuer: Circle) | Same page, row Arbitrum | 6, `CHAIN_OBSERVED` (finalized block 517700527) |
| USDT | Ethereum (1) | `0xdac17f958d2ee523a2206206994597c13d831ec7` | `AUTHORITY_ATTESTED` (issuer: Tether) | Tether, Supported Protocols, Ethereum Network, USDT contract address | 6, `CHAIN_OBSERVED` (finalized block 26259206) |
| DAI | Ethereum (1) | `0x6b175474e89094c44da98b954eedeac495271d0f` | `AUTHORITY_ATTESTED` (protocol: Sky/Maker) | Sky Ecosystem chainlog, key `MCD_DAI` | 18, `CHAIN_OBSERVED` (finalized block 26259206) |

Sources: `https://developers.circle.com/stablecoins/usdc-contract-addresses`, `https://tether.to/en/supported-protocols/`, `https://chainlog.sky.money/api/mainnet/active.json`. Each record stores the exact address string the authority published (`publishedAddress`, checksum case preserved) and the engine asserts it equals the stored lowercase address.

How each class was established:

- **`AUTHORITY_ATTESTED`**: the issuer or protocol's own publication was read and names exactly this address on this chain. A symbol or name was never used as identity evidence; symbol and name read from the contract were not recorded as evidence.
- **`CHAIN_OBSERVED`** (decimals): `eth_call decimals()` against the address at a **finalized** block via a public RPC endpoint (Ethereum: `ethereum-rpc.publicnode.com`; Base: `mainnet.base.org`; Arbitrum: `arb1.arbitrum.io`), with the block number, block hash and block timestamp recorded in the record. This one-off observation was made by the maintainer's tooling and is **not** part of the shipped product; the runtime still contacts no node.
- **Fixture / test-only**: none in the registry. Tests use these real records as inputs but all wallet addresses, block hashes and amounts in tests are synthetic.

Chains (Ethereum, Base, Arbitrum One): the chain ID was observed with `eth_chainId` (`CHAIN_OBSERVED`, a provider observation). The finality-model label is descriptive only; the engine does not verify finality, it reads the finality state that the evidence declares.

Addresses are stored lowercase. EIP-55 checksums are not verified by the engine.
## Authority policies (`packages/mcp/authority-policies/policies.json`)

WalletWall-authored draft policies for five claim types. See `spec/AUTHORITY_MODEL.md`. They have not been reviewed outside WalletWall.

## Evidence

Supplied by the caller in each request. The engine does not contact chain nodes, issuers, indexers or price providers. In this lane there are **no live providers**.

## Test fixtures

All wallet addresses, block hashes and amounts in tests and conformance cases are synthetic. No real user or wallet data is stored in this repository.

## Third-party software bundled into the shipped file

`@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema` (the list is printed by `npm run build:bundle`). Their license texts ship with the plugin in `plugin/THIRD_PARTY_NOTICES.md`, generated from the bundle's module graph and checked in CI (`npm run verify:notices`). See `docs/DEPENDENCY_POLICY.md`.
