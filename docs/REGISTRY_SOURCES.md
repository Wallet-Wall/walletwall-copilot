# Registry sources and redistribution basis

Registry version **0.2.0**, status **`VERIFIED_POINT_IN_TIME`**, verified **2026-10-24 (UTC)**. The registry is a **bundled snapshot, not live or current-chain data**: nothing is fetched at runtime, and a contract can change after the verification date (for example by a proxy upgrade or an issuer action). Every registry-derived result carries the limitation `REGISTRY_VERIFIED_POINT_IN_TIME`.

## What a record is

A registry record is a **WalletWall-authored factual assertion**: "according to this publisher, at this locator, on this date, this address on this chain is this asset", plus WalletWall's own classification of the authority and a chain observation of `decimals()`. It is not a copy of anyone's page.

| Stored by WalletWall | Origin |
| --- | --- |
| `symbol`, `name`, `issuerName`, `authorityId`, `chainId`, `decimals` | factual identifiers; `authorityId` is a WalletWall classification (`issuer:circle`, `issuer:tether`, `protocol:sky`) |
| `address` (lowercase) and `publishedAddress` (verbatim) | the address string the publisher lists. An address is a fact, not creative expression. The verbatim string is kept only to preserve its checksum casing |
| `verification.identity.url`, `locator`, `publisher`, `retrievedAt` | a pointer (URL plus a short description of where on the page) and the date it was read |
| `verification.decimals` | a public chain observation: block number, block hash and timestamp, method `eth_call decimals()`, observed value |

**Not stored:** page text, tables, screenshots, logos, documentation prose, terms or any other publisher content beyond the short facts above. A test (`repo/public-release.test.ts`) bounds the length of every string in the registry (except its descriptive `note`) so that prose cannot be added unnoticed, and requires every record to be listed in this document.

## Records

| # | Claim | Authority class | Source (publisher, URL, locator) | Verified | Chain observation |
| --- | --- | --- | --- | --- | --- |
| 1 | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` on Ethereum (1) is USDC, 6 decimals | `AUTHORITY_ATTESTED`, `issuer:circle` | Circle, `https://developers.circle.com/stablecoins/usdc-contract-addresses`, Mainnet table, row Ethereum | 2026-10-24 | finalized block 26259206 |
| 2 | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` on Base (8453) is USDC, 6 decimals | `AUTHORITY_ATTESTED`, `issuer:circle` | Circle, same page, Mainnet table, row Base | 2026-10-24 | finalized block 53007918 |
| 3 | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` on Arbitrum One (42161) is USDC, 6 decimals | `AUTHORITY_ATTESTED`, `issuer:circle` | Circle, same page, Mainnet table, row Arbitrum | 2026-10-24 | finalized block 517700527 |
| 4 | `0xdac17f958d2ee523a2206206994597c13d831ec7` on Ethereum (1) is USDT, 6 decimals | `AUTHORITY_ATTESTED`, `issuer:tether` | Tether, `https://tether.to/en/supported-protocols/`, ERC20 Token via Ethereum Blockchain, Ethereum Network, USDT contract address | 2026-10-24 | finalized block 26259206 |
| 5 | `0x6b175474e89094c44da98b954eedeac495271d0f` on Ethereum (1) is DAI, 18 decimals | `AUTHORITY_ATTESTED`, `protocol:sky` | Sky Ecosystem chainlog, `https://chainlog.sky.money/api/mainnet/active.json`, key MCD_DAI | 2026-10-24 | finalized block 26259206 |

Chains (Ethereum 1, Base 8453, Arbitrum One 42161): the chain ID was observed with `eth_chainId` from a public RPC endpoint on 2026-10-24. That is a provider observation and says nothing about authority; the finality-model label is a descriptive WalletWall note.

## Redistribution basis and attribution

| Item | Basis | Attribution |
| --- | --- | --- |
| Addresses, symbols, decimals, block numbers and hashes | facts about public blockchains and public issuer statements; no database or text of the publisher is copied | not legally required for facts; WalletWall nevertheless names the publisher and URL in every record and returns them in `resolve_asset` results |
| URL and locator | a reference, not content | the URL itself is the attribution |
| Authority classification, point-in-time limitation, verification metadata | WalletWall-authored | WalletWall |
| Names and marks (Circle, USDC, Tether, USDT, Sky, Maker, DAI, Ethereum, Base, Arbitrum) | used only to identify the thing, nominatively | see `TRADEMARKS.md`: no affiliation or endorsement is claimed |

Limits of this basis, stated plainly:

- The terms of use of the three publisher websites and of the chainlog data were **not individually reviewed by counsel**. The basis is that WalletWall stores only facts and pointers. If a publisher objects, the record can be removed or reduced to a pointer without changing the engine.
- The registry says what a publication listed on the verification date. It does not say the issuer, protocol or contract is safe, solvent, compliant or unchanged.
- The one-off RPC observations were made by the maintainer's tooling against public endpoints; they are **not** part of the product, which contacts no node.

## Changing the registry

Registry changes get heightened review (`.github/CODEOWNERS`). A new or changed record needs the publisher URL, the exact locator, the verbatim published address, the retrieval date and a finalized `decimals()` observation, and must pass `registry.test.ts`. Do not add copied text. Do not call the registry live.
