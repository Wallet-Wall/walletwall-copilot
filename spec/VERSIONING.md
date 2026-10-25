# Versioning (WWEP 0.1 draft)

Three independent protocol/data version identifiers apply.

| Identifier | Current | Changes when |
| --- | --- | --- |
| `EvidenceProfileVersion` (`wwepVersion`) | `0.1` | The bundle schema, state semantics, invariants or canonicalization change. |
| `RegistryVersion` | `0.2.0` | Registry or chain data changes. |
| `RulesVersion` | `0.1.0-draft` | A derivation rule (`wwdr.usd-value`, `wwvr.vault-technical-readiness`) changes. |

The authority policies carry their own `policiesVersion` (`0.1.0-draft`) and are reported with the other versions.

Release integrity is versioned independently from WWEP. `security/integrity-policy.json` carries `policyVersion: "1"`; `security/plugin-manifest.json` carries its own `manifestVersion`. These are release/security formats, not evidence-profile versions.

## Rules

- During `0.x` anything may change, but every change to a tool contract (name, description, input schema, annotations)
  or to a served resource MUST be visible as a diff in `security/tool-manifest.json` and a new
  `security/tool-manifest.sha512`. CI fails otherwise.
- WalletWall-owned current release-integrity records use the algorithm selected by the validated integrity policy; policy
  version 1 permits only SHA-512. SHA-256 remains only where an upstream contract explicitly requires it, such as the MCP
  Registry package field `fileSha256`, where the value is itself an upstream/native hash, or in immutable historical/provenance records.
- Changing the current WalletWall integrity algorithm, the meaning of a current digest record, or the structure of the
  exception taxonomy requires an explicit `integrity-policy.json` `policyVersion` change and corresponding loader/tests.
  Do not silently reinterpret policy version 1.
- Changing the digest field structure in `security/plugin-manifest.json` requires a `manifestVersion` change. Existing
  release manifests remain interpreted according to the version they were published with; they are never rewritten to
  resemble a newer integrity format.
- Current integrity and historical provenance occupy separate namespaces. Current records live at the policy-selected
  `security/*.sha512` paths; release-specific historical records live under `security/history/<version>/`.
- WWEP 0.1 `evidenceDigest()` remains SHA-256. Changing evidence canonicalization/digest semantics requires an explicit
  evidence-profile version change rather than a silent release-integrity migration.
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
