# Authority model (WWEP 0.1 draft)

Authority is **claim-specific**. There is no global ranking such as `chain > issuer > provider`. Each claim type has
an `AuthorityPolicy` in `packages/mcp/authority-policies/policies.json`. A policy names which origin classes may
*establish* the claim, which may only *corroborate* it, and the finality, freshness and dependency requirements.

## Transport is not authority

`source.transport.retrievedVia` records how bytes arrived. It never confers authority. A balance read through a
provider's RPC is `CHAIN_OBSERVED` from a `CHAIN_STATE` source with `retrievedVia` set to the provider; the authority
is canonical finalized chain state. A value that a provider reports about itself (a price, a label) is
`PROVIDER_OBSERVED` from a `PROVIDER_ENDPOINT` source, and the provider is not an authority for chain state.

## Policies in 0.1

| Claim type | Authority | May establish | May only corroborate | Finality | Max age (CURRENT) |
| --- | --- | --- | --- | --- | --- |
| `ASSET_IDENTITY` | Issuer or protocol publication whose `authorityId` equals the registry `authorityId` for that deployment | `AUTHORITY_ATTESTED` | `CHAIN_OBSERVED`, `PROVIDER_OBSERVED` (capped at `PARTIAL`) | n/a | 30 days |
| `TOKEN_BALANCE_AT_BLOCK` | Canonical finalized chain state at the identified block | `CHAIN_OBSERVED` | `PROVIDER_OBSERVED` (capped at `SUPPORTED`) | required for `ESTABLISHED` | 120 s |
| `TOKEN_USD_PRICE` | None. A market price has no canonical authority | nothing | `PROVIDER_OBSERVED`, `CHAIN_OBSERVED` (capped at `SUPPORTED`) | n/a | 300 s |
| `TOKEN_USD_VALUE` | WalletWall rule `wwdr.usd-value` | derived only | n/a | inherited | inherited |
| `VAULT_TECHNICAL_READINESS` | WalletWall rule `wwvr.vault-technical-readiness`, only for that classification | derived only | n/a | inherited | inherited |

A stablecoin symbol never establishes identity. An on-chain `symbol()` reading is spoofable and can only corroborate.

## Independence

Corroboration counts **distinct independence groups**. Observations from the same source and group with identical
content count once (`DUPLICATE_EVIDENCE_COLLAPSED`). Sources that do not declare an `independenceGroup` all fall in
one group named `unspecified`, so several provider endpoints do not become independent merely by being listed.
Corroboration can raise support to at most `SUPPORTED` and never to `ESTABLISHED`.

## Derived claims

A derived assertion has origin `WALLETWALL_DERIVED`. Its authority is WalletWall's published rule, scoped to the
derived claim only; it never relabels the authority of its inputs, and always carries
`WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY`. Its support is the weakest of its dependencies. It inherits every
dependency limitation.

## Conflicts

Conflicts are never auto-resolved by ranking sources. They produce `CONFLICTING`, which propagates to dependents as
`CONFLICTING`, and downstream classifications such as readiness resolve to `NOT_ESTABLISHED`.

## Registry

The registry is WalletWall data. A registry lookup alone is `WALLETWALL_DERIVED` and reported `PARTIAL`, because no
issuer attestation was presented. Registry 0.2.0 records were verified point-in-time (2026-10-24) against issuer or protocol publications and finalized chain state; only `AUTHORITY_ATTESTED` records are loaded, and a record that cannot be verified is excluded from the factual registry (`NOT_ESTABLISHED`). A registry match is still a WalletWall-derived lookup, not a live attestation.
