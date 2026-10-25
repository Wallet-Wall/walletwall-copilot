---
name: vault-readiness
description: Evaluate WalletWall Vault migration readiness for a wallet, asset, chain, and target path by checking identity, state, eligibility, compatibility, ingress requirements, permissions, and evidence quality without collapsing missing measurements into a ready/not-ready guess. Use for Vault readiness audits, migration questions, stablecoin readiness, ingress checks, allowance or prerequisite analysis, and evidence-backed READY/NOT READY/INDETERMINATE determinations.
---

# Vault Readiness

Use this skill when the question is whether a wallet or asset is ready for a WalletWall Vault migration or ingress path.

## Core rule

Do not collapse these states:

```text
asset exists
≠
asset is eligible
≠
migration path exists
≠
wallet can execute path
≠
wallet is currently ready
```

Each transition requires evidence.

## Required dimensions

Evaluate the dimensions applicable to the requested path.

### 1. Subject identity

Establish:

- wallet or subject identifier
- chain/network
- asset identifier
- canonical token identity where relevant
- target Vault or protocol component
- intended migration/ingress path

Do not silently substitute a different chain, token wrapper, bridged representation, or contract.

### 2. Asset state

Establish the state needed for the operation, such as:

- balance or position
- token decimals when relevant to interpretation
- ownership/custody state when relevant
- current block/time freshness

A token being recognized is not proof the wallet holds a usable amount.

### 3. Eligibility

Check whether the asset and chain are accepted by the applicable Vault path.

Distinguish:

- canonical eligibility
- hygiene/spam filtering
- provider discovery
- economic suitability
- actual protocol support

Do not infer eligibility from popularity or provider coverage.

### 4. Path existence

Establish that an ingress or migration path actually exists for the specified subject and target.

Evidence may include:

- supported route definition
- contract/interface support
- release evidence
- executable path tests
- protocol configuration

Documentation describing a future path is not proof that it is available now.

### 5. Compatibility

Check prerequisites such as:

- chain compatibility
- contract compatibility
- token behavior required by the route
- target restrictions
- route-specific constraints

Only evaluate constraints relevant to the actual path.

### 6. Permissions and executable prerequisites

Where relevant, establish current:

- allowance/approval
- authorization
- signer capability
- account state
- transaction prerequisites
- route-specific parameters

Do not assume permission because a route exists.

### 7. Executability

Determine whether the wallet can execute the path now.

Prefer evidence such as:

- deterministic call results
- simulation
- route validation
- applicable invariant execution
- transaction preflight evidence

Do not execute transactions or request signing as part of this audit unless the user is explicitly in a separate authorized action flow. This skill is for readiness analysis.

### 8. Evidence quality

For each material readiness fact, inspect:

- source authority
- freshness
- sample/coverage
- value state
- agreement/conflict
- invariant status
- provenance

Missing evidence is not a negative balance, zero allowance, unsupported asset, or failed route unless a source actually establishes that state.

## Readiness classifications

Use one of:

- `READY`
  - Every material prerequisite for the specified path is currently established.

- `NOT_READY`
  - At least one material prerequisite is authoritatively established as unsatisfied.

- `PARTIALLY_ESTABLISHED`
  - Several prerequisites are established, but one or more material requirements remain unresolved.

- `INDETERMINATE`
  - Available evidence cannot support either READY or NOT_READY.

When helpful, include the underlying evidence-audit classification for individual prerequisites.

## Fail-closed rule

If a prerequisite is required and its state is unknown, do not mark the subject READY.

Unknown is not equivalent to failed. Report `INDETERMINATE` or `PARTIALLY_ESTABLISHED` depending on what is known.

## Recommended output

```text
VAULT READINESS AUDIT

Subject
- wallet:
- chain:
- asset:
- target:
- path:

Conclusion
- classification:
- as-of:

Established
- ...

Unsatisfied
- ...

Not established
- ...

Contradictions
- ...

Next measurement
- ...
```

For complex cases, add a prerequisite table:

| prerequisite | state | evidence | authority | freshness |
|---|---|---|---|---|

Use `unknown` when evidence does not establish a value.

## Next-measurement rule

When readiness is not established, recommend the smallest measurement that resolves the blocking uncertainty.

Examples:

- read current allowance
- verify canonical token identity
- inspect route support for the target revision
- execute a read-only call
- obtain a simulation
- retrieve a missing release or invariant result

Do not recommend unnecessary broad research when one direct measurement will answer the question.

## Tool discipline

Prefer WalletWall/Canvas MCP tools for WalletWall readiness evidence.

Use repository/CI evidence to establish implementation and release behavior.

Use upstream chain/protocol authority for current external facts when needed.

Never turn narrative documentation into current wallet state.

Never mutate a wallet, submit a transaction, request a signature, or change production state as part of this skill.
