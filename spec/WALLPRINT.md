# WallPrint 0.1 on WWEP 0.1 — DRAFT

Status: **draft, pre-release**. WallPrint is a WalletWall-defined disclosure record built on the WalletWall Evidence
Profile (WWEP 0.1, `EVIDENCE_PROFILE.md`). It is not an industry standard and has not been reviewed outside WalletWall.
This module is the domain contract and its tests. The canvas renders a fixture-backed disclosure view of these records
(`canvas/README.md`, items 11 to 14) that adds no presentation field to the record and computes nothing. There is no
QR code, no external assessor import, no hosted service, no chain write and no signature system.

## Principle

**WalletWall isn't always right. WallPrint keeps the record.**

WallPrint preserves the evidence, assessments, limitations, conflicts, corrections, and supersessions needed to
understand how a WalletWall conclusion was reached and how it changed.

## What WallPrint is not

WallPrint does not claim audit certification or immutable truth. A WallPrint is not, and nothing in the contract lets
it become, any of: truth certification, safety certification, solvency verification, regulatory compliance, issuer
endorsement, investment advice, or an audit opinion.

## Integrity statement

A valid WallPrint digest demonstrates that a disclosed canonical record matches its committed record. It does not, by
itself, demonstrate that every factual claim in that record is correct.

## Assessment statement

An assessment records what a named assessor concluded under a named policy at a particular time. Multiple
assessments may disagree. WallPrint preserves disagreement rather than manufacturing consensus.

## Three dimensions that never collapse

| Dimension | Vocabulary | Owner |
| --- | --- | --- |
| Evidence state | `ESTABLISHED` `SUPPORTED` `PARTIAL` `CONFLICTING` `STALE` `SUPERSEDED` `UNKNOWN` `NOT_ESTABLISHED` | WWEP `SupportState` (`schemas.ts`, `SUPPORT_STATES.md`), computed by `evaluate.ts`. WallPrint defines no evidence state of its own. |
| Disclosure lifecycle | `COMMITTED` `DISCLOSED` `CORRECTED` `SUPERSEDED` `WITHDRAWN` | WallPrint history (`packages/mcp/src/wallprint/history.ts`). Metadata about the record; it never upgrades or downgrades an evidence state. |
| Assessments | one attributed entry per named assessor and policy | WallPrint record (`packages/mcp/src/wallprint/record.ts`). WalletWall's own entry is generated from the engine; external entries are recorded as stated. |

`evidenceState: SUPPORTED` with `lifecycle: DISCLOSED` is valid. So is `ESTABLISHED` with `DISCLOSED`. Disclosing a
record changes nothing inside it (`history.test.ts`).

Lifecycle transitions: `COMMITTED` to `DISCLOSED`, `CORRECTED`, `SUPERSEDED` or `WITHDRAWN`; `DISCLOSED` to
`CORRECTED`, `SUPERSEDED` or `WITHDRAWN`; `CORRECTED` and `SUPERSEDED` only to `WITHDRAWN`; `WITHDRAWN` is terminal.
A record has at most one successor, so a history never branches and cannot cycle.

## The record

`buildWallPrintSnapshot({ id, bundle, evaluatedAt, focalAssertionId, assessments?, supersedes? })` is a pure function
of its inputs (no clock, no I/O, no generated identifiers). It parses the WWEP bundle with the closed schema,
evaluates it with `evaluateBundle`, checks the invariants, traces provenance for the focal assertion, and emits:

| Field | Source |
| --- | --- |
| `wallprintVersion` | `0.1` (WallPrint contract version, see Versioning) |
| `id` | caller-supplied, lower-case token so case variants of one id cannot coexist |
| `subject` | focal assertion id, claim type, temporality, and the exact-string identity under the policy's subject keys (`identity.ts`) |
| `snapshotAt` | the WWEP `evaluatedAt`, recorded as evaluated |
| `evidence` | the bundle's evidence digest and one `{kind, id, digest}` reference per source, observation, assertion and derivation; payloads stay in the bundle |
| `claims` | every assertion with the evaluation the engine computed for it: support, freshness, finality, authority, limitations, diagnostics, corroboration count, conflicts, supersession, dependencies, digest |
| `assessments` | WalletWall's generated assessment plus the caller's attributed external assessments, sorted by assessor and policy |
| `provenance` | the engine's lineage for the focal assertion |
| `limitations` | the sorted union of every claim's limitation codes |
| `conflicts` | declared and detected conflicts and observation disagreements, as the engine reported them; never resolved |
| `violations` | `check_invariants` output |
| `policyVersions` / `ruleVersions` / `versions` | the published policy, rule and registry versions and digests in force |
| `supersedes` | `null` or `{ id, digest, kind, reason }` binding the predecessor's digest; `kind` is `CORRECTION` or `SUPERSESSION`; a correction requires a reason |
| `canonicalization` / `digestAlgorithm` / `digest` | `RFC8785`, `SHA-256`, the digest |

Every value is a string, boolean or null. Counts and depths are decimal strings. The record holds no lifecycle state,
no `supersededBy` link, no overall verdict and no observation payload. Unknown fields are rejected anywhere, as is an
own `__proto__` key.

**Validation parity.** `validateWallPrintRecord` is what the history, the receipt, the diff and replay trust, so it
re-applies every rule the builder applies: the closed shape and constants, the digest over the preimage, every
reference resolving inside the record, strictly ordered collections (a repeated key is a duplicate), conflicts that
agree with the claims' `conflictsWith`, provenance targeting the focal claim, policy versions consistent with the
record's policies version, the WalletWall assessment equal in every field to what the focal claim generates, the
external attribution rules below, the supersedes rules, and no credential-shaped text in any string slot. A record
from anywhere is admitted only if this engine could have produced it from its own parts. Record caps derive from the
engine's maxima, so every engine-valid evaluation is recordable, including many-way conflicts and long violation lists.

## Digest boundary

The preimage is the record with only `digest` removed, serialized with the engine's RFC 8785 canonicalizer
(`canonical.ts`, JSON numbers refused) and hashed with SHA-256 through `evidenceDigest`. `JSON.stringify` output is
never hashed. Covered: version, subject, snapshot time, claims, assessments, evidence references, provenance,
limitations, conflicts, violations, policy and rule versions, version digests, and the supersession link. Excluded by
construction: UI state, process ids, local paths, cache keys, the current time, secrets and credentials, none of which
has a slot. Collections are sets keyed by id and stored in ordinal order; the provenance lineage is the one intentionally
ordered sequence and is stored as produced.

Same semantic inputs, same evidence, same policies, same rules and same assessments give the same canonical payload
and the same digest (`record.test.ts`). Two WWEP spellings of one instant (`…:30Z`, `…:30.000Z`) are two records,
because the engine accepts both and WallPrint records the evaluation time as evaluated; lifecycle event times, which
WallPrint owns, accept canonical millisecond spelling only.

## History

`createWallPrintHistory()` is an in-memory, append-only ledger. Every lifecycle change is an event
`{ seq, recordId, recordDigest, state, at, reason, ref, previousEventDigest, eventDigest }` hash-chained per record.
`verifyLifecycleChain` checks sequence, links, each event's own digest, one record and one digest throughout, forward
time, a `COMMITTED` start and table transitions, so edits, reorders, drops and correctly re-hashed forgeries are all
detected.

**Correction.** A new record with `supersedes.kind = CORRECTION` and a reason. The predecessor gets a `CORRECTED`
event whose `ref` names the successor; its content, digest, timestamps and earlier events are untouched.

**Supersession.** The same mechanics with `kind = SUPERSESSION`; the predecessor becomes `SUPERSEDED`. `view(old)`
reports `supersededBy`, `view(new).record.supersedes` reports the predecessor, and `lineage(id)` resolves root,
current, predecessor, successor and the full chain.

**Withdrawal.** A `WITHDRAWN` event with a reason. Record identity, canonical payload, digest, assessments and
timestamps stay addressable through `get`, `list` and `view`. Withdrawal is not deletion.

**Graph validation.** `validateHistoryGraph(records)` refuses duplicate ids, self-links, dangling `supersedes`,
digest mismatches, subject mismatches, backward snapshots, multiple successors and cycles. The ledger enforces the same
rules on commit, plus: a canonical event time not before the snapshot, a predecessor that exists with the bound digest,
and an allowed transition.

## Assessors

An assessment carries assessor identity, role (`WALLETWALL`, `ISSUER`, `UPSTREAM_AUTHORITY`, `INDEPENDENT_REVIEWER`,
`OTHER`), the assessment code as stated, an optional statement, policy, policy version, assessment time, evidence
references into the bundle and WWEP limitation codes.

- The `WALLETWALL` assessment is never caller-supplied. It is generated from the focal claim's computed support
  state, attributed to `walletwall-rules` under the focal claim's policy id and `policiesVersion`, and a record whose
  WalletWall assessment differs from its focal claim is invalid.
- An `ISSUER` assessment must be attributed to the registry `authorityId` of the focal deployment (`issuer:circle`
  for the registered USDC deployments); an unregistered subject admits no issuer assessment; and a registry authority
  identity, in any letter case, may not be used under any other role.
- No external assessor may use an identity that reads as WalletWall or WallPrint (a run of separator-delimited tokens
  joining to the stem, so `wallet-wall` and `wall.print` are refused while `firewall-print-shop` is not), nor a policy
  id in the `wwap`, `wwdr` or `wwvr` namespaces in any case or separator spelling.
- Evidence references must name bundle items; one assessor assesses once per policy, assessor ids compared
  case-insensitively.
- A record with no external assessment is valid. `NOT_AVAILABLE` is recorded as said. Absence of assessment is not
  a failed assessment.

Three assessors may disagree (`SUPPORTED` / `CONFIRMED` / `NOT_AVAILABLE`); all three remain, and no field anywhere
holds an overall or consensus verdict.

## Assurance-language guard

WallPrint itself never uses `VERIFIED`, `CERTIFIED`, `SAFE`, `SOLVENT`, `COMPLIANT`, `AUDITED`, `APPROVED`,
`TRUSTED` or `INVESTMENT-GRADE`: WalletWall's verdict is a WWEP support state, and WalletWall-authored text (lifecycle
and correction reasons) may not contain them. Polarity is not parsed. An external assessor's attributed statement is
recorded verbatim ("Assessor X asserted CERTIFIED"); the one thing refused in every string slot of a record, attributed
or not, identifier or text, is credential-shaped content (key blocks, bearer tokens, known key prefixes, key-value
assignments).

## Authority firewall

WallPrint records and never recomputes the engine's authority judgements (`AUTHORITY_MODEL.md`, invariants INV-00 to
INV-13): corroboration is the engine's count of distinct independence groups, so two provider endpoints in one group
count once; a declared state never exceeds the computed state and the INV-00 violation is part of the record; a
WalletWall-derived claim keeps `WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY`. The explicit invariants:

```text
transport != authority
provider multiplicity != independent corroboration
provider agreement != independent authority
assessor agreement != independent corroboration
WalletWall-derived != upstream authority
absence of assessment != failed assessment
UNKNOWN != FALSE
NO_RESULT != ZERO
digest integrity != factual truth
```

## Address identity

Subject identity is computed in one module, `packages/mcp/src/wallprint/identity.ts`, which reproduces the engine's
current behaviour: conflict grouping (`evaluate.ts`, the canonical key over the policy's `subjectKeys`) and
supersession identity (`invariants.ts`, `SUPERSESSION_CLAIM_IDENTITY_MISMATCH`) compare the exact subject strings,
while only observation-to-assertion matching folds case for address-like keys (`claims.ts`
`CASE_INSENSITIVE_SUBJECT_KEYS`). Two subjects differing only in hexadecimal address case are therefore two identities,
and WallPrint inherits that. `identity.test.ts` pins it. This lane does not normalise case; that remains an explicit
semantic decision to be made in `identity.ts` and nowhere else. Note that `EVIDENCE_PROFILE.md` section 11 says
addresses are compared case-insensitively, which describes only the observation-matching seam; it is reported here
rather than edited, because the spec text is embedded in the generated bundle and its hashes.

## Replay

`replayWallPrint(record, { evidence })` re-derives a record from the evidence store (keyed by bundle digest) and the
engine's registry, policies and rules, and returns `REPRODUCED`, `MISMATCH` or `UNREPLAYABLE` with sorted reasons.
It is `UNREPLAYABLE` (`WWEP_VERSION_MISMATCH`, `MISSING_POLICY_VERSION`, `MISSING_REGISTRY_VERSION`,
`MISSING_RULE_VERSION`, `MISSING_EVIDENCE`, `EVIDENCE_DIGEST_MISMATCH`, `RECORD_INVALID`, `REBUILD_REFUSED`) whenever
a required historical input is not the committed one, the record is invalid, the store fails, or this engine's
admission rules refuse to rebuild from the record's own inputs; then nothing is recomputed: replay never evaluates
historical evidence under present-day policy and never fills in evidence. The rule versions a bundle's derivations
declare are evidence (the engine flags them with `RULES_VERSION_MISMATCH`) and do not gate replay; only the engine's
own rules version does, and the policies digest pins the rules table. A `MISMATCH` carries `DIGEST_MISMATCH` plus one
reason per differing top-level section (`SUBJECT_MISMATCH`, `SNAPSHOT_MISMATCH`, `EVIDENCE_MISMATCH`,
`CLAIM_MISMATCH`, `ASSESSMENT_MISMATCH`, `PROVENANCE_MISMATCH`, `LIMITATION_MISMATCH`, `CONFLICT_MISMATCH`,
`VIOLATION_MISMATCH`, `POLICY_VERSION_MISMATCH`, `RULE_VERSION_MISMATCH`, `VERSION_MISMATCH`).

**UNREPLAYABLE is not INCORRECT.** An unreplayable result carries no content-mismatch reason and no recomputed digest.

## Diff

`diffWallPrints(a, b)` returns `{ changed, changes }` with one entry per semantic change in the categories record
(the digest, present whenever the two records differ at all), subject, snapshot, claims, evidence, assessments,
limitations, conflicts, violations, policyVersions, ruleVersions, versions, provenance and lifecycle (the predecessor
id, digest, kind and reason), each with a path, before and after values and, where it applies, a reason (`WEAKER` /
`STRONGER` by `SUPPORT_RANK` for a support-state change; the supersession kind for a lifecycle link). It carries record
data only; observation payloads are not in the record and cannot appear.

## Receipt boundary

WallPrint is the disclosure record. A receipt is proof that a disclosed canonical record matches its committed bytes.
`wallPrintReceipt(record)` exposes record id, canonicalization identifier, digest algorithm, digest, bundle digest and
versions; `verifyReceipt(receipt, record)` reports whether the bytes match. The receipt does not establish factual
truth, solvency, safety, regulatory compliance, issuer endorsement or investment merit (`RECEIPT_DOES_NOT_ESTABLISH`).
No signature system exists in this lane.

## Versioning

`WALLPRINT_VERSION` is `0.1` and is versioned independently from the application, from WWEP (`wwepVersion`), from the
registry and rules versions and from the MCP and plugin surfaces (`VERSIONING.md`). A change to the record shape, the
canonical form, the lifecycle table or the admission rules is a WallPrint version change.

## The disclosure UI (fixture-backed)

The canvas's WallPrint view renders these sections from the contract without adding presentation fields to it:
Subject (`record.subject`); Current WalletWall assessment (the `WALLETWALL` entry); Why WalletWall says this
(authority, freshness, finality, corroboration, conflicts, limitations and violations from the focal claim);
Assessments (one row per assessor, never merged); Record (`view.lifecycle.events`); Provenance (`record.provenance`
and the `evidence` references); Corrections & supersessions (`view.supersedes`, `view.supersededBy`, `lineage`,
`diffWallPrints`); Verify (four separate questions, each a 1:1 projection of one engine result and never combined: Record from
`validateWallPrintRecord`, Digest from `verifyWallPrintDigest`, Receipt from `verifyReceipt`, Replay from
`replayWallPrint`; then a registration readout and the canonical payload). Its input is `wallprint-fixtures.mjs`,
generated from this module by `scripts/gen-wallprint-fixtures.ts` through
`packages/mcp/test/support/wallprint-disclosures.ts`: synthetic lineages whose every verdict is an engine output. One
lineage carries its issued receipt without the verification result; the view shows that as unchecked, a
disclosure-layer state (`verifyReceipt` itself always returns a result). The page quotes the principle, the invariants
and the receipt boundary from the module's exports and decides nothing.

## Non-negotiable invariants

```text
WalletWall isn't always right. WallPrint keeps the record.
correction != mutation
supersession != deletion
withdrawal != deletion
assessor disagreement is preserved
assessor agreement != independent corroboration
provider multiplicity != independent authority
transport != authority
WalletWall-derived != upstream authority
digest integrity != factual truth
receipt integrity != factual truth
WallPrint lifecycle != WWEP evidence state
UNREPLAYABLE != INCORRECT
```

## Known limitations

- The history and the evidence store are in-memory; a durable store is a later lane and must preserve these rules.
- There is no signature: a digest proves bytes, not who committed them.
- Lifecycle reasons are output-safe text of at most 128 characters; the lexical guard blocks the reserved terms in
  any polarity, so WalletWall prose says things in codes.
- Two WWEP spellings of one evaluation instant give two record digests (inherited from `ISO_RE`).
- A record has at most one successor, so withdrawing a successor leaves the lineage's current record withdrawn: the
  predecessor cannot take a new successor or be re-disclosed, and a renewed disclosure starts a fresh root. Allowing a
  second successor after a withdrawal would reintroduce branching; the choice is left to a later lane.
- `UPSTREAM_AUTHORITY` assessors are bound only by the reserved-identity rules, not to a registry record, because the
  registry names issuer and protocol authorities only.
- The record is not an MCP tool or resource in this lane; `main.ts`, `server.ts` and `tools.ts` do not import it, so
  the shipped bundle and manifests are unchanged.
- A claim whose `CONFLICTING` state is propagated from a dependency (a derived readiness claim over two conflicting
  balances, conformance `CNF-004`) carries no `conflictsWith` entry and no `OBSERVATION_DISAGREEMENT` limitation, so
  `validateWallPrintRecord` refuses the record with `CONFLICTS_MISMATCH` on that claim: such an evaluation is not
  recordable in WallPrint 0.1. Found by the disclosure UI lane and reported here; admitting it is a contract decision
  (the conflict-consistency rule in `record.ts` would need a third cause for propagated conflicts), not a UI patch.
- A receipt carries no issuance instant and no identifier of its own; it is identified by its record id and digest. The
  disclosure view prints the disclosure instant from the lifecycle ledger and invents no receipt id. Whether a receipt
  should carry an issuance instant or a digest of its own is a contract decision for a later lane.
- `verifyReceipt` returns `matches: false` with `RECEIPT_INVALID` or `RECORD_INVALID` before any comparison, so an input
  it could not check and a compared non-match share one boolean, and the field comparisons are not run on an invalid
  record (the altered-copy fixture reports `RECORD_INVALID` alone although its digest also differs). The disclosure
  view tells that case as "not compared". Likewise `verifyWallPrintDigest` folds a canonicalization failure into
  `{ matches: false, computedDigest: null }`, which the view shows as "not computable". A tri-state or a `compared`
  flag is a contract decision, not a UI patch. Found by the Receipt verification UX lane's adversarial review.
- The disclosure view's input shape (a record with its digest check, validation, lifecycle, receipt and verification,
  replay and diff) is defined in `packages/mcp/test/support/wallprint-disclosures.ts`, and `ReplayResult` has a
  TypeScript interface but no runtime schema, so the view re-states their consistency rules in its own projections. A
  canonical runtime schema for both is a contract follow-up.

## Prototype reconciliation

An earlier design spike in the application repository (`feat/wallprint-contract`, not published) was compared against
WWEP before this lane was written. Reused: the immutable canonical record, the append-only hash-chained history with
predecessor-digest binding, assessor disagreement, the assurance-language guard, lowercase record ids, the chain
verifier's digest, transition and time checks, and the hardening tests. Dropped because WWEP already provides them:
hand-rolled strict-shape and prototype-key checks (`strictObject`, `hasForbiddenStructure`), reserved-word scanning of
codes (every code here is a closed WWEP enum), a WallPrint-local authority count and a WallPrint-local
`ESTABLISHED` rule (the engine's `independentCorroboration` and policy semantics are recorded instead), a
`0x`-prefixed digest and a safe-integer allowance (WWEP digests are bare hex and every evidence number is a string).
