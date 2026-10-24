# Support, freshness and finality states (WWEP 0.1 draft)

All states describe **evidence sufficiency under published policy**. None asserts that upstream data is true.

## SupportState

| State | Exact semantics |
| --- | --- |
| `ESTABLISHED` | At least one observation from an origin the policy names as authoritative, from a source of the matching kind and authority ID, agreeing with the asserted value, with finality satisfied where required, fresh where `CURRENT`, with no conflict, and (if derived) every dependency `ESTABLISHED`. |
| `SUPPORTED` | Meets the policy except for authority or finality: either an authoritative observation that is not finalized where finality is required, or corroboration by at least `minIndependentCorroboration` independent groups without an authoritative observation, subject to the policy cap. |
| `PARTIAL` | Some usable evidence exists but it is insufficient: a single or non-independent provider, user-supplied only, asset outside the registry, chain outside the registry, unknown rules version, unknown freshness for a current claim, or a pinned dependency used for a current claim. |
| `CONFLICTING` | Observations or assertions about the same claim identity disagree, or a conflict is declared. Never `ESTABLISHED`. |
| `STALE` | A `CURRENT`-temporality claim whose newest observation is older than the policy maximum age, or whose dependency was superseded. A stale result never satisfies `CURRENT`. |
| `SUPERSEDED` | A supersession record replaces this assertion with a later assertion about the same claim identity. The old assertion remains in the bundle. |
| `UNKNOWN` | Sources were consulted but produced only `NO_RESULT` or `ERROR`. Not `FALSE`, not zero. |
| `NOT_ESTABLISHED` | No admissible basis: no source, wrong subject or value, invalid values, registry mismatch, missing required dependency, derivation not permitted, or a cycle. |

Strength order for combining dependencies, strongest to weakest:
`ESTABLISHED > SUPPORTED > PARTIAL > STALE > SUPERSEDED > UNKNOWN > CONFLICTING > NOT_ESTABLISHED`.
A superseded dependency counts as `STALE` for its dependents (limitation `DEPENDENCY_SUPERSEDED`).

## FreshnessState

| State | Semantics |
| --- | --- |
| `CURRENT` | `CURRENT`-temporality claim; newest observation is no older than the policy maximum age and not in the future. |
| `STALE` | `CURRENT`-temporality claim older than the maximum age. |
| `PINNED` | `PINNED`-temporality claim about a specific point (for example a block). Recency is not required. |
| `UNKNOWN_FRESHNESS` | No maximum age, an observation timestamp later than the evaluation time, or a current claim that depends on pinned evidence. |

## FinalityState

| State | Semantics |
| --- | --- |
| `FINALIZED` | All relied-upon observations state finalized finality. |
| `UNFINALIZED` | At least one relied-upon observation states it is not finalized. |
| `UNKNOWN_FINALITY` | Finality was not stated for at least one observation and none states `UNFINALIZED`. |
| `null` | Finality does not apply to this claim type (for example issuer identity or price). |

When observations disagree, the least final value is reported.

## Evaluation order within one direct assertion

1. No observation → `NOT_ESTABLISHED` (`NO_SOURCE`).
2. Only `NO_RESULT` / `ERROR` → `UNKNOWN`.
3. Subject invalid or mismatched, values invalid → `NOT_ESTABLISHED`.
4. Observations disagree → `CONFLICTING`.
5. Asserted value differs from observed value → `NOT_ESTABLISHED` (`VALUE_MISMATCH`).
6. Registry checks (identity, decimals) → `NOT_ESTABLISHED` on mismatch.
7. Authority, corroboration and finality → `ESTABLISHED` / `SUPPORTED` / `PARTIAL`.
8. Freshness for `CURRENT` claims → may lower to `STALE` or `PARTIAL`.
9. Lifecycle: supersession overrides to `SUPERSEDED`; conflict overrides to `CONFLICTING`.

## Vault technical readiness

`VAULT_TECHNICAL_READINESS` is evaluated by rules `wwvr.vault-technical-readiness` `0.1.0-draft` over an identity
assertion and a balance assertion. Criteria: C1 identity established in registry and by issuer authority; C2 balance
established at a finalized block; C3 same chain and token; C4 decimals agree; C5 no conflict or supersession;
C6 current inputs fresh. Any definite failure gives `CRITERIA_NOT_MET`; otherwise any indeterminate criterion gives
`NOT_ESTABLISHED`; otherwise `CRITERIA_MET`. It does not establish investment merit, solvency, creditworthiness,
legal status, regulatory compliance, absence of fraud, or future performance.
