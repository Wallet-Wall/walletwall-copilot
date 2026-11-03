# Conformance corpus (WWEP 0.1 draft)

Each JSON file is one case: `{ id, category, claimCategory, description, evaluatedAt, bundle, expect }`.

| Directory | Cases | Focus |
| --- | --- | --- |
| `evidence/` | `EVD-*` | identity, spoofed symbols, duplicate/missing evidence, NO_RESULT vs ZERO, UNKNOWN vs FALSE, malformed numbers, decimal precision, quantity vs USD |
| `authority/` | `AUT-*` | claim-specific authority, transport vs authority, provider independence, authority escalation, derived limitations |
| `freshness/` | `FRS-*` | staleness, pinned vs current, future timestamps, finality |
| `conflict/` | `CNF-*` | observation and assertion conflicts, case-insensitive address identity, declared conflicts, reused assertion, source, observation and derivation ids, supersession integrity |
| `adversarial/` | `ADV-*` | schema abuse, bounds, prototype keys, cycles, dangling references, derivation and recomputation tampering, derived subject forgery |
| `privacy/` | `PRIV-matrix.json` | requirement-to-test matrix; the privacy tests themselves live in `packages/mcp/test/privacy` |

The case files are **generated** from `packages/mcp/test/support/cases.ts` (`node scripts/gen-conformance.ts`; CI runs `--check`). Expectations in that file are written by hand, not computed by the engine. The runner is `packages/mcp/test/support/runner.ts`; `npm run conformance:report` prints results **by claim category**. No single accuracy score exists and none should be derived.

A case passes only if every stated expectation holds. Expectations name support, freshness and finality states, corroboration counts, required or forbidden limitation codes, conflicts, supersession, required invariant violations (or none), and the readiness classification over the same bundle.

`CNF-016` is a characterization of current contract behaviour, not a statement that the behaviour is safe: two finalized readings at one height with different block hashes are two fork-specific claims. Whether WWEP models state at canonical height N or state in exact block H needs a separate authority and finality decision.

Mutation tests (`packages/mcp/test/sandbox/mutation.test.ts`) alter chain ID, contract address, decimals, amount, freshness, finality, authority and the dependency graph of a known-good bundle and require rejection, a violation, or a downgrade.

`npm run test:evidence-identity-mutation` mutates the engine's source instead: each broken implementation of subject identity, reused record ids, the future check or the adapter's timeout sweep must fail a named test. It rewrites files while it runs, so it is a developer and review tool, not part of `npm test`.
