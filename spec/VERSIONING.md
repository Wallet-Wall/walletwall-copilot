# Versioning (WWEP 0.1 draft)

Three independent version identifiers apply.

| Identifier | Current | Changes when |
| --- | --- | --- |
| `EvidenceProfileVersion` (`wwepVersion`) | `0.1` | The bundle schema, state semantics, invariants or canonicalization change. |
| `RegistryVersion` | `0.2.0` | Registry or chain data changes. |
| `RulesVersion` | `0.1.0-draft` | A derivation rule (`wwdr.usd-value`, `wwvr.vault-technical-readiness`) changes. |

The authority policies carry their own `policiesVersion` (`0.1.0-draft`) and are reported with the other versions.

## Rules

- During `0.x` anything may change, but every change to a tool contract (name, description, input schema, annotations)
  or to a served resource MUST be visible as a diff in `security/tool-manifest.json` and a new
  `security/tool-manifest.sha256`. CI fails otherwise.
- A bundle whose `wwepVersion` differs from the engine's is rejected, not coerced.
- A bundle whose `registryVersion` or `rulesVersion` differs from the engine's is evaluated with the engine's data
  and reported with `REGISTRY_VERSION_MISMATCH` / `RULES_VERSION_MISMATCH` where it applies. A derivation that names
  an unknown rule or rules version is capped at `PARTIAL` (`RULES_UNKNOWN` / `RULES_VERSION_MISMATCH`).
- Historical assertions are superseded, never rewritten. A new registry or rules version produces new assertions that
  supersede old ones; it does not edit them.
- `1.0` will not be declared until the registry has been independently reviewed and the specification has had review
  outside WalletWall.

## Not an industry standard

WWEP is a WalletWall profile. Version numbers do not imply adoption by any standards body.
