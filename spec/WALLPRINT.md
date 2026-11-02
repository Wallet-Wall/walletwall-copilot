# WallPrint 0.2 on WWEP 0.1 — DRAFT

Status: **draft, pre-release**. WallPrint is a WalletWall-defined disclosure record built on the WalletWall Evidence
Profile (WWEP 0.1, `EVIDENCE_PROFILE.md`). It is not an industry standard and has not been reviewed outside WalletWall.
Two WallPrint contract versions exist and both are read by this engine: **0.1**, under which every record committed
before 0.2 was built and which stays valid under its own rules, and **0.2**, the current version, which differs from 0.1
in exactly one thing: the external-assessor admission rules ("Admission rules by version" below). The record shape, the
canonical form, the digest, the lifecycle and every other rule are the same in both.
This module is the domain contract and its tests. The canvas renders a fixture-backed disclosure view of these records
(`canvas/README.md`, items 11 to 15) that adds no presentation field to the record and computes nothing, and prints
each record's portable reference (a locator: record id, committed digest, WallPrint version) as text and as a locally
drawn QR code. A public HTTPS resolver ("Public resolver" below) serves deliberately published disclosures as static
files and proves their bytes before showing them; it is a locator, not an authority. A local, pure external assessor
import boundary exists in the engine ("External assessor import" below); there is no public or remote assessor import
endpoint, no hosted compute, no chain write and no signature system.

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

`buildWallPrintSnapshot({ id, bundle, evaluatedAt, focalAssertionId, assessments?, supersedes?, wallprintVersion? })` is a pure function
of its inputs (no clock, no I/O, no generated identifiers). `wallprintVersion` names the contract the record is built
under and defaults to the current one; replay passes the record's own. It parses the WWEP bundle with the closed schema,
evaluates it with `evaluateBundle`, checks the invariants, traces provenance for the focal assertion, and emits:

| Field | Source |
| --- | --- |
| `wallprintVersion` | `0.2` for a record built today, `0.1` for a historical record (WallPrint contract version, digest-covered, selects the admission rules; see Versioning) |
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
  for the registered USDC deployments), spelled exactly as the registry spells it; an unregistered subject admits no issuer
  assessment; and a registry authority identity may not be used under any other role (0.1: in any letter case; 0.2: in
  any spelling that differs only by case or separators, and the engine's own authority ids too).
- No external assessor may use an identity that reads as WalletWall or WallPrint, nor a policy id in a WalletWall policy
  or rule namespace. What "reads as" and "in" mean is the version's admission rule, in "Admission rules by version" below.
- Evidence references must name bundle items; one assessor assesses once per policy, assessor ids compared
  case-insensitively.
- A record with no external assessment is valid. `NOT_AVAILABLE` is recorded as said. Absence of assessment is not
  a failed assessment.

Three assessors may disagree (`SUPPORTED` / `CONFIRMED` / `NOT_AVAILABLE`); all three remain, and no field anywhere
holds an overall or consensus verdict.

## Admission rules by version

Admission decides only whether a name or a policy id may be attributed to an external assessor at all, because some are
not the assessor's to claim: WalletWall's own identity, WalletWall's own policy and rule namespaces, and an authority the
registry or the engine names. It proves nothing about who an assessor is, and it never rewrites what the assessor
supplied: a refused spelling is refused, an admitted one is recorded exactly as stated (`issuer-circle` is never stored
as `issuer:circle`). The rules are part of the contract, so they belong to the WallPrint version: one table,
`ADMISSION_RULES` (`packages/mcp/src/wallprint/admission.ts`), selected by `wallprintVersion`, is applied by the builder,
by `validateWallPrintRecord` (so by history, receipt, diff, replay and publication, which all trust it) and by the import
boundary, through one function (`externalAssessmentFindings`). Nothing else holds a copy of a rule.

**0.1** (frozen, `language.ts`): an identity is reserved when some run of whole separator-delimited words, joined, equals
`walletwall` or `wallprint`; a policy is reserved when it begins with the literal `wwap`, `wwdr` or `wwvr` followed by a
separator or the end; a registry authority is reserved under a role other than `ISSUER` when it equals the assessor id
after lower-casing. It admits several spellings of the same identity (the gaps listed under Known limitations).

**0.2** answers the same three questions with one model of "the same spelling". It compares skeletons and rewrites
nothing.

| Term | Definition |
| --- | --- |
| fold | ASCII `A-Z` to `a-z`. Nothing else: no Unicode normalization (assessor and policy ids are ASCII by construction), no confusable or leet folding, no edit distance, no phonetics. |
| separators | `.` `_` `:` `-` and `/`, the punctuation the id grammars admit (`/` only in a policy id). A run of separators is one separator. A *word* is a maximal run between separators. |
| skeleton | the words joined without separators. |

1. **Identity.** An assessor id reads as WalletWall or WallPrint (stems `walletwall`, `wallprint`) when (a) some run of
   whole words spells a stem, optionally followed by a number (`wallet-wall`, `wall.print`, `wallet-wall2`,
   `wall-print-2024`), or (b) some word *begins* with a stem (`walletwall2`, `walletwallprint`, `wallprinters`): a stem
   fused with more letters is the reserved name with decoration, the omitted-separator spelling of `walletwall-official`.
   A stem buried inside a word is not a reading of the stem (`firewall-print-shop`, `stonewall`, `officialwalletwall`), and
   neither is one that would have to end inside a later word (`wallet-wallpaper`): the separators the assessor supplied are
   the only word boundaries WalletWall has, and it does not segment words without a lexicon. Order matters:
   `print-wall` is not `wallprint`.
2. **Policy namespace.** A policy id is in a WalletWall namespace only at its start: the leading words spell `wwap`,
   `wwdr` or `wwvr` (separators allowed anywhere inside: `ww-ap`, `WW.DR`) followed by an optional number that belongs to
   the namespace (`wwap2`), or the leading words read as WalletWall or WallPrint by rule 1 (`walletwall-policy`,
   `wallet-wall/review`). The namespace ends at the next separator or the end of the id, so `wwapi`, `wwapp`, `wwdrive`,
   `ww-api` and `wwap2x` are not in it, and neither is `acme/wwap/x` or `acme/walletwall-review`, which merely mention one.
3. **Authority.** Under every role other than `ISSUER`, an assessor id whose skeleton equals the skeleton of a registry
   deployment authority (`issuer:circle`, `issuer:tether`, `protocol:sky`) or of an engine authority
   (`canonical-chain-state`, `issuer-publication`; `walletwall-rules` is reserved by rule 1, and `none` names the absence of an
   authority, not an authority) is refused: `issuer-circle`, `issuer_circle`, `issuer.circle`, `ISSUER-CIRCLE` and
   `issuercircle` are the registry authority under another role. The reserved authorities are a literal list frozen with the
   version (the same three deployment authorities for 0.1, spelled exactly), not a read of the live registry. Whole-skeleton equality only: `issuer:circle-labs`,
   `circle` and `issuer:acme` are not the registry authority. An `ISSUER` must still be spelled exactly as the registry
   spells its authority (the spelling `issuer-circle` under `ISSUER` is `ISSUER_AUTHORITY_MISMATCH`). Role comes from the
   registry and the contract, never from a name that looks like an issuer's: `issuer-acme` is an ordinary name under any
   role but `ISSUER`, and is refused under `ISSUER`.

0.2 is strictly stricter than 0.1: whatever 0.1 refuses, 0.2 refuses (`admission-versions.test.ts` pins it over a seeded
fuzz). Findings keep their 0.1 codes (`ASSESSOR_IDENTITY_RESERVED`, `RESERVED_POLICY_NAMESPACE`) and paths.

**Unchanged in every version.** One assessor assesses once per policy, compared case-insensitively. Spelling variants of
one name (`reviewer-y`, `reviewer.y`) remain different assessors, deliberately: folding them would be inventing identity
resolution, which needs authentication. So the rules protect reserved identities, namespaces and authority roles and
nothing more, and no number of assessors, spellings or agreeing assessments is authority:

```text
assessor agreement != independent corroboration
assessor count != authority
assessor identity != issuer identity
attribution != authentication
```

**Which version applies.** A record is judged by the version it carries, for ever: `validateWallPrintRecord` selects the rules
from `wallprintVersion`, replay rebuilds a record under its own version, and a record committed under 0.1 is never rewritten,
re-digested or reinterpreted because 0.2 is stricter (`admission-characterization.test.ts` and the committed 0.1 corpus pin
it). A new record is built under the current version unless the caller names one. The version label is not authenticated
(nothing signs a record), so 0.1 stays buildable only by naming it, and a consumer that requires the 0.2 rules requires
`wallprintVersion` `0.2`; a 0.1 record is what it always was.

## External assessor import

An external assessment arrives from someone else, often as text. `buildWallPrintSnapshot({ assessments })` already
records attributed external assessments and `validateWallPrintRecord` already enforces the attribution rules above; what
the engine lacked was a boundary for assessments that arrive as untrusted serialized input. `importExternalAssessments`
(`packages/mcp/src/wallprint/assessor-import.ts`, with the strict reader `strict-json.ts`) is that boundary and nothing
more: it reads one closed envelope per assessment and returns the existing `ExternalAssessmentInput`, unchanged, for the
caller to pass to `buildWallPrintSnapshot`. It defines no second assessment model and no second rule set.

```text
{ "assessmentImportVersion": "0.1",
  "externalAssessment": { "assessor", "assessorRole", "assessment", "statement"?, "policy", "policyVersion",
                          "assessedAt", "evidenceRefs", "limitations"? } }
```

The inner field names, types and bounds are `ExternalAssessmentInputSchema`'s. The envelope adds only its own version and
the wrapper: no score, trust level, confidence, rank, approval, certification, issuer-endorsement flag, verified flag,
consensus or signature field exists, and an unknown field is refused, never dropped. The import format is versioned
independently as `assessmentImportVersion` `0.1` (`ASSESSOR_IMPORT_VERSION`). The admission rules moved WallPrint from 0.1 to 0.2 and
the envelope did not move, because the serialization is identical: the envelope version describes the interface shape, the WallPrint
version describes the record and its admission semantics, and an imported assessment becomes exactly the structure a natively
supplied one has, digested the same way (`assessor-import.test.ts`). What the importer does need to know is which admission rules it
is checking against, so the caller names the target: see "Target version" below.

**Input boundary.** `importExternalAssessments(inputs, { bundle, focalAssertionId, wallprintVersion })` takes UTF-8 bytes or text (text is
taken as its UTF-8 encoding) and the bundle and focal assertion the assessments are about. Each input is at most 16 KiB
(`ASSESSOR_IMPORT_MAX_BYTES`, refused unread when larger), at most 32 inputs per call (the builder's own cap), and is read
by a strict JSON reader that refuses malformed UTF-8, a byte-order mark, any text JSON does not allow, nesting deeper
than the closed shape and, because `JSON.parse` would keep the last of two equal keys, a repeated key (compared after
escapes are decoded). The importer then refuses an own `__proto__`, `constructor` or `prototype` key (the reader builds
prototype-less objects, so such a key is inert until it is refused). The envelope is then parsed with the closed schema;
credential-shaped text is refused in every slot.

**Attribution.** The assessments pass the same rules a native caller-supplied assessment passes, by the same code
(`externalAssessmentAdmissionFindings` in `record.ts`, which `buildWallPrintSnapshot` calls too, and which reaches
`externalAssessmentFindings` in `admission.ts`, the one place the rules live): no `WALLETWALL`
role, no identity that reads as WalletWall or WallPrint, no policy in a WalletWall namespace, an `ISSUER`
only for the focal deployment's registry authority (and never on an unregistered subject), a registry authority identity
under no other role, every evidence reference naming an item of the bundle, and one assessor assessing once per policy,
case-insensitively; each as the target version's rules say. Duplicates fail closed, a byte-identical repeat included: there is no overwrite, no last-write-wins
and no merge. The caller then passes the list to `buildWallPrintSnapshot`, which applies every rule again to the whole
list, and `validateWallPrintRecord` checks the record.

**Target version.** `wallprintVersion` is required in the import context and is never defaulted to whatever the engine builds today:
an unsupported or missing value refuses the call as `INVALID_CONTEXT` before any input is read. The same bytes, the same bundle context
and the same target version give the same result, and for every version the import admits exactly what `buildWallPrintSnapshot` admits for
the same assessment, bundle, focal assertion and version (`admission-parity.test.ts` runs a seeded differential across both). A caller
imports for a version and builds under the same one. `IMPORTED` speaks for the assessments: the bundle's own
preconditions for building a record (a focal subject that carries its identity keys, unique ids) remain the builder's, so
the builder may still refuse a bundle the importer accepted as context.

**Result and failure.** `{ status: "IMPORTED", assessments }` carries, per input and in input order, the assessment exactly
as stated, ready to pass to `buildWallPrintSnapshot`. No import receipt or digest of the input is returned: the caller holds
the bytes, an identical import re-derives the identical assessment, and a digest computed in the engine would add a
SHA-256 site that `security/integrity-policy.json` gates, for no audit value the caller cannot get by hashing what it
passed in; a durable store, if one is built, is where a digest of the original input belongs.
`{ status: "REFUSED", reason, findings }` carries one reason from a closed list
(`ASSESSOR_IMPORT_REFUSALS`) and findings made of fixed codes and fixed paths; it never echoes caller text. The reason is
the first refused input's, in input order; the findings name every refused input (at most eight each, so one input cannot
crowd out another). Import is atomic: one refused input refuses the set, and nothing is dropped, rewritten, summarized,
inferred or "fixed". Zero inputs import nothing and succeed, given a usable context, because absence of assessment is not
a failed assessment. The importer never throws: a hole in the list, or an element that cannot be inspected, is a refused
input, never a skipped one.

**What `IMPORTED` means.** Only that the input passed the structural and attribution admission rules and is recorded as
the named assessor stated it. An imported assessment may say `CERTIFIED` or `VERIFIED`; that is the assessor's attributed
statement, and WalletWall's own entry is still generated from the engine's support state. It does not mean the conclusion
is true, that WalletWall agrees, or that the assessor is who the input says: the identity is attribution, not
authentication. No signature, key, certificate, DID, wallet signature or chain anchor exists in this lane; signing and
issuer attestation remain a later trust-model lane.

```text
external != trusted                        assessor identity != issuer identity
external != verified                       assessor agreement != independent corroboration
assessment != evidence state               absence of assessment != failed assessment
assessment != authority                    digest integrity != factual truth
```

**Authority firewall.** The importer never evaluates a bundle and returns nothing but assessments, so an imported
assessment cannot change a claim's support, freshness, finality, authority, corroboration, independence groups,
conflicts, violations, provenance or readiness: an external `SUPPORTED` does not turn a `NOT_ESTABLISHED` claim into
`SUPPORTED`, an external issuer's `CONFIRMED` does not touch the engine's authority state, and two agreeing assessors
count as zero independent corroboration. The tests pin each (`assessor-import.test.ts`, `assessor-import-mutation.test.ts`).

**Independent of the lifecycle.** Importing builds, commits, discloses, corrects, supersedes, withdraws and publishes
nothing. Assessment import and the disclosure lifecycle are separate dimensions; a caller may later build and commit a
record that contains the imported assessments through the existing mechanisms.

**Local only.** The importer is a pure function: no clock, no generated identifier, no network, no file access, no
credential, no environment. It is not an MCP tool or resource (the six tools and eleven resources are unchanged), not an
HTTP endpoint, not part of the public resolver (which stays a static, read-only locator with no write route), and not in
the shipped MCP bundle. The canvas renders recorded assessments and has no paste, upload or import control: it computes
no canonical WallPrint semantics, so a control for it is a separate follow-up that would call the engine, never the
other way round.

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
The rebuild runs under the admission rules of the record's own `wallprintVersion`, so a historical 0.1 record is judged
by 0.1 and reproduces, never by a stricter version it was not committed under.
It is `UNREPLAYABLE` (`WWEP_VERSION_MISMATCH`, `MISSING_POLICY_VERSION`, `MISSING_REGISTRY_VERSION`,
`MISSING_RULE_VERSION`, `MISSING_EVIDENCE`, `EVIDENCE_DIGEST_MISMATCH`, `RECORD_INVALID`, `REBUILD_REFUSED`) whenever
a required historical input is not the committed one, the record is invalid, the store fails, or the admission rules of the
record's version refuse to rebuild from the record's own inputs; then nothing is recomputed: replay never evaluates
historical evidence under present-day policy and never fills in evidence. The rule versions a bundle's derivations
declare are evidence (the engine flags them with `RULES_VERSION_MISMATCH`) and do not gate replay; only the engine's
own rules version does, and the policies digest pins the rules table. A `MISMATCH` carries `DIGEST_MISMATCH` plus one
reason per differing top-level section (`SUBJECT_MISMATCH`, `SNAPSHOT_MISMATCH`, `EVIDENCE_MISMATCH`,
`CLAIM_MISMATCH`, `ASSESSMENT_MISMATCH`, `PROVENANCE_MISMATCH`, `LIMITATION_MISMATCH`, `CONFLICT_MISMATCH`,
`VIOLATION_MISMATCH`, `POLICY_VERSION_MISMATCH`, `RULE_VERSION_MISMATCH`, `VERSION_MISMATCH`).

**UNREPLAYABLE is not INCORRECT.** An unreplayable result carries no content-mismatch reason and no recomputed digest.

## Diff

`diffWallPrints(a, b)` returns `{ changed, changes }` with one entry per semantic change in the categories record
(the digest, present whenever the two records differ at all, and `wallprintVersion` when the two were committed under
different contract versions: a 0.1 record and a 0.2 record are never one semantic record, even when nothing else differs), subject, snapshot, claims, evidence, assessments,
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

## Portable reference

A portable reference (`packages/mcp/src/wallprint/reference.ts`) is a locator for one committed record. It answers
which record (the record id), which bytes (the committed digest), which WallPrint contract version the record was
committed under, and optionally which section of the disclosure to open (`record`, `receipt`, `replay`, `history`,
`assessments`, `provenance`). It answers nothing else: not whether any claim is true, not whether the asset is safe, not
whether an issuer endorsed the record, not who committed it (`REFERENCE_DOES_NOT_ESTABLISH`). **A reference is a locator,
not authority.** It carries no signature, names no signer, and becomes no more authoritative by being printed, shared or
scanned. `REFERENCE_IDENTIFIES` states the boundary a resolver must repeat: "This reference identifies the WallPrint
record and digest. Resolution depends on a compatible WalletWall disclosure store or resolver."

One value, two deterministic serializations (fixed field names, fixed order, fixed versions, no clock, no generated
id, no path, no credential, no UI state), with `REFERENCE_VERSION` `0.1` versioned independently of the record:

```text
walletwall://wallprint/<recordId>?reference=0.1&wallprint=<wallprintVersion>&digest=<hex64>[&target=<target>]
{"digest":"…","recordId":"…","target":"receipt","type":"walletwall.wallprint.reference","version":"0.1","wallprintVersion":"0.1"}
```

The text form is what a QR code encodes and what Copy puts on the clipboard; the envelope form is the structured
export, in RFC 8785 key order (equal to the engine's `canonicalize()` of the envelope, pinned by test). The envelope is
a locator envelope, never a second record format: it carries no record content. `encodeReference` and
`encodeReferenceEnvelope` are deterministic; `referenceOf(record, target?)` builds the reference from a record's own
`id`, `digest` and `wallprintVersion`, and `tryReference` does the same without throwing. Each form has exactly one
admitted spelling on input as well: the envelope text must be the canonical text its own fields encode to (no
whitespace, no reordered or repeated key), so one value never has two spellings in either direction.

`parseReference(text)` reads either form, strictly, and never throws: the exact scheme and host, the exact parameter
order, no duplicate or unknown parameter, no percent-encoding, no fragment, no character outside
`[A-Za-z0-9:/?&=._-]` (the envelope adds JSON punctuation and never a backslash or whitespace), no case folding of ids
or digests, versions in their one spelling (no leading zero), a target only from the closed table, a record id that is
not address-shaped (`0x` + 40 hex), not credential-shaped and free of the reserved assurance terms (a resolver may print
an unavailable id back, so it must never read as an address, a secret or a verdict), and at most 320 characters. A failed
parse reports a fixed outcome, `MALFORMED_REFERENCE` or `UNSUPPORTED_VERSION` (a reference version, or a WallPrint
version, this engine does not resolve), with a fixed problem code naming the part that failed, and never any part of the
input. The version is checked first, deliberately: a reference that leads with an unsupported version is reported as
such before its id or digest is read, because nothing is assumed about that version's grammar.

`resolveReference(reference, found)` compares, and decides nothing else. The store looks the record up by id, any
committed version (a corrected, superseded or withdrawn record is as valid a target as the current one; nothing
redirects an old reference to the current record), and supplies the digest the record carries and the digest the engine
computed over its bytes (`verifyWallPrintDigest`). The outcomes are distinct failure modes: `UNAVAILABLE` (no record
with that id is available here; not invalid, not false), `NOT_COMPARED` (the store carries no digest, or no computed
digest, for the record, so the reference's digest was compared with nothing; absence is absence, never a mismatch),
`DIGEST_MISMATCH` (both digests were compared and the resolved record does not match the digest carried by the
reference; every digest is reported and which record is the committed one is not decided), and `RESOLVED` (the record
carries the reference's digest and the engine computed that digest over its bytes). `REFERENCE_OUTCOMES` lists the six.

The canvas prints every disclosed record's reference, derived from the record id and the committed digest its
`COMMITTED` lifecycle event recorded (never from a bundle digest, and not at all when no committed identity is carried),
draws the QR code locally from that text (`canvas/README.md`, item 15), and opens a reference through its `reference`
input against the bundled lineages. The codec the canvas runs is this module, bundled unchanged by
`scripts/gen-wallprint-reference.ts` (checked by `npm run verify:wallprint-reference`).

## Public resolver

**A resolver locates a disclosure. It does not make that disclosure authoritative.** WalletWall's public resolver gives
a portable reference a stable HTTPS form on the canonical product domain and resolves it to the exact published record
and digest. Every public page carries the principle and this sentence: *This page resolves a published WallPrint
disclosure. Publication and resolution do not establish factual truth, safety, solvency, compliance, or investment
merit.* (`PUBLICATION_STATEMENT`, `publication-vocabulary.ts`).

**The HTTPS form** (`reference.ts`: `toHttpsUrl`, `parseHttpsUrl`, `toResolverPath`, `parseResolverPath`,
`isResolverBase`) is a representation of the reference, not a second identity: the text form with its scheme and host
replaced by a resolver base and the route, a prefix substitution that is deterministic and lossless and carries the
reference's own versions:

```text
<resolverBase>/wallprint/<recordId>?reference=0.1&wallprint=<wallprintVersion>&digest=<hex64>[&target=<target>]
```

A resolver base is exactly one spelling of an HTTPS origin (WHATWG origin equality: no path, query, fragment, userinfo,
port, upper-case letter, IP literal, single label or punycode label). No base is named in the engine; the canonical
public domain is a publication setting (`index.json`, `resolverBase`), and the public QR code encodes the HTTPS form
while the canonical `walletwall:` reference is printed beside it as the same locator. Parsing an HTTPS URL is the text
form's own strict grammar after the substitution is undone, plus one fixed problem code, `resolver`, for a path not under
the base and route. No percent-decoding, no case folding, no fragment, no duplicate or unknown parameter, no target
outside the closed table, and nothing from the URL is ever echoed.

**Publication** (`publication.ts`, `scripts/wallprint-publish.ts`) is deliberate, never ambient: nothing becomes public
because it was generated. One export of one record, exactly as the engine produced it (record, canonical preimage,
validation, digest check, lifecycle ledger, lineage, receipt and verification, replay, diff), is admitted only when the
record validates, its canonical preimage digests to its digest, every carried engine result agrees with the record, the
record id is one path segment on every filesystem (`[a-z0-9][a-z0-9_-]{2,63}`, and no Windows reserved device name:
`isPublishableId`), and the privacy gate finds nothing credential-, path-, address-, environment- or control-shaped,
no e-mail or IP address, no URL and (outside the record's own content) no host name or wallet address, and no
private-metadata key name; the closed schemas admit no other field. The store is also checked as a graph
(`storeGraphFindings`): standings that name each other must bind each other, a predecessor published beside its
successor must already name it, one record per id, at most one successor per predecessor. The result is an **immutable public disclosure**, a pure
function of the export serialized in RFC 8785 form and identified by record id and digest: the same disclosure always
publishes to the same bytes, different bytes under the same id and digest are a conflict and never overwrite, and the
bytes carry no lifecycle standing, no successor, no lineage and no instant, because those change after commit. Beside it
the record's **standing** (lifecycle ledger, successor, lineage, publication instants) only ever extends: events append,
a successor is set once, the lineage grows at its end, the first publication instant of a digest is kept; a rewritten
history is refused. A corrected, superseded or withdrawn record stays published at its own URL and nothing redirects it
to a successor; its standing names the successor, and the page links to it as a choice.

**The store** is static files under the route, served by the existing product deployment with no compute:
`records/<id>/<digest>.json` (immutable bytes, short revalidating caching, because a host's rule for the path also
answers the 404 of an artifact not yet published), `records/<id>/index.json` (the standing,
short caching), `index.json` (the publication index: base, route, one small entry per publication, short caching). The
page (`packages/wallprint-web`) fetches exactly the standing and one artifact of the record named, same origin, without
credentials, refusing redirects, and proves the bytes itself: the artifact is one canonical-form JSON object of the fixed
fields for that record id, its canonical preimage is in canonical form (the browser canonicalizer is pinned against the
engine's over every published record) and names the same id and version, the results carried beside it (validation,
digest check, receipt and verification, replay, diff, supersedes) are consistent with it as the publication contract
requires, and the SHA-256 of the preimage is compared with the artifact's digest and the URL's through
`resolveReference`. The standing is then checked against its own hash-chained ledger by the engine's history rules
(`lib/ledger.ts`) and against the proved record and digest; a standing that fails is not read. Only then is the record
rendered, by the canvas's own renderer in public mode (`canvas/README.md`, item 16).

**What the digest covers.** The URL's digest covers the record's canonical bytes and nothing else. The title, the
registry's point-in-time names and the engine's receipt, replay and diff results travel beside the record in the
published artifact as they were recorded at publication; the page checks that they are consistent with the record and
says, on every resolved page, that the digest does not cover them. The standing is the store's index; it is checked
against its own ledger, and nothing signs it, so an authentic but stale ledger and a well-formed extension appended by
whoever controls the store are both printed as the index records them. Binding these to an identity is a signing
question for a later lane.

**Outcomes** are the codec's six plus one, never collapsed: `RESOLVED`; `UNAVAILABLE` (no standing for that record id:
"Record unavailable", not invalid, not false); `DIGEST_MISMATCH` (the record is published under other bytes, or the
artifact fails its own digest check, which is flagged; every digest is printed, no record content is shown, the published
version is offered only as an explicit link); `NOT_COMPARED` (the artifact is not a disclosure the page reads; nothing was
compared, nothing is shown); `MALFORMED_REFERENCE` and `UNSUPPORTED_VERSION` (the store is never asked); and
`UNREACHABLE` (the store could not be read, or its standing for the record is not one the page reads; nothing is said
about the record). A page never repairs what it reads, never redirects, never renders what it did not prove, stores
nothing in the browser, reads no clock and carries no analytics. A copy served from another origin than the resolver
base says so, naming the base and never the serving origin; the bare route is a landing sentence; an unforeseen failure
ends in a fixed sentence written as text.

**What it is not.** The resolver does not recompute evidence state, authority, receipt or replay semantics, assessor
independence or factual correctness: it prints the engine's recorded results as published. Resolution is an integrity
check, not a signature: a digest match proves bytes, not who published them or whether any claim is true. There is no
public write endpoint, no search endpoint, no signing, and no public or remote assessor import (the engine's local
import boundary, "External assessor import" above, is not reachable from the resolver). Record ids are intentionally public, and the
publication index lists them: enumeration of deliberately published disclosures is not a leak. The deployment of the
store on the product domain is described in `docs/WALLPRINT_PUBLIC_RESOLVER.md`; the engine repository holds the
publisher, the page and the published store, and no hosted runtime. Modules: `packages/mcp/src/wallprint/publication.ts`,
`packages/mcp/src/wallprint/publication-vocabulary.ts`, `packages/wallprint-web/lib/*.ts`, `packages/wallprint-web/browser/page.ts`,
`scripts/wallprint-publish.ts`, `scripts/build-wallprint-public.ts`; tests `publication.test.ts`, `public-url.test.ts`,
`packages/wallprint-web/test/*.test.ts`, `packages/mcp/test/canvas/wallprint-public.test.ts`.

## Versioning

`WALLPRINT_VERSION` is `0.2` (the version a new record is built under) and `WALLPRINT_VERSIONS` is `["0.1", "0.2"]`, the
versions this engine reads. WallPrint is versioned independently from the application, from WWEP (`wwepVersion`), from the
registry and rules versions and from the MCP and plugin surfaces (`VERSIONING.md`). A change to the record shape, the
canonical form, the lifecycle table or the admission rules is a WallPrint version change, and a version already issued is
never edited: a record carries the version it was committed under, digest-covered, and is judged by that version's rules for
ever. 0.2 is the admission-rule change (the registry-authority spellings, the fused and numbered WalletWall / WallPrint
names and the reserved policy namespaces 0.1 admitted; "Admission rules by version"); it changes no field, no canonical form
and no other rule. The four mechanisms that could have carried it were checked, and only the first fits: a new
`wallprintVersion` selects admission rules and is already digest-covered; silently tightening 0.1 would make a committed 0.1
record that this engine could validly produce (`wp-historical-0-1-gaps`, `fixtures/wallprint-0.1-admission-gaps.json`)
invalid, which the history, receipt, diff, replay and publication paths would then refuse; the WWEP policies, registry and
rules versions are recorded evidence versions (replay gates on them) and move for evidence reasons, not for how a name is
spelled; and a new record field would itself be a record-shape change, so a WallPrint version change.

What a version change does and does not touch: a 0.2 record has a different digest from the same content under 0.1,
because the version is covered; no 0.1 record, receipt, reference, published artifact or fixture is rewritten, re-digested
or reinterpreted (the pinned 0.1 fixture digest is unchanged); a portable reference names the version its record was committed
under and keeps it; `record id` and `digest` already locate one record, and one record id carries one digest in a store, so a
0.2 record under an id a 0.1 record holds is a conflict and never an overwrite, exactly as before; a 0.2 record may correct or
supersede a 0.1 record (a successor is judged by its own version), and the diff between them names the version. The external
assessor import envelope has its own version, `assessmentImportVersion` `0.1`: it versions the serialization, which no
admission rule changes, so adding 0.2 did not move it; a change to the envelope's fields or limits is an import format version
change, and one that changes what a record may hold is a WallPrint version change as well.

## The disclosure UI (fixture-backed)

The canvas's WallPrint view renders these sections from the contract without adding presentation fields to it:
Subject (`record.subject`); Current WalletWall assessment (the `WALLETWALL` entry); Why WalletWall says this
(authority, freshness, finality, corroboration, conflicts, limitations and violations from the focal claim);
Assessments (one row per assessor, never merged); Record (`view.lifecycle.events`); Provenance (`record.provenance`
and the `evidence` references); Corrections & supersessions (`view.supersedes`, `view.supersededBy`, `lineage`,
`diffWallPrints`); Verify (four separate questions, each a 1:1 projection of one engine result and never combined: Record from
`validateWallPrintRecord`, Digest from `verifyWallPrintDigest`, Receipt from `verifyReceipt`, Replay from
`replayWallPrint`; then a registration readout, the portable reference with its QR code, and the canonical payload).
Opened through a portable reference (`{ "reference": "…" }`), the view shows the record the reference named, whichever
version of its lineage that is, with the resolution printed above it, or the outcome alone when nothing resolved
(`UNAVAILABLE` is told as "Record unavailable", never as invalid, with the id and digest printed back as written and
not repeated in the agent summary; a malformed reference is described by its problem code and never echoed). Its input
is `wallprint-fixtures.mjs`,
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
- An imported assessor is identified because the input says who it is and passes the attribution rules above. That is
  attribution, not authentication: nothing proves the named assessor wrote the input, and an `ISSUER` entry shows that the
  name matches the registry authority, not that the issuer made the statement. Signing and issuer attestation are a later
  trust-model lane.
- Because identity is a name, one party can appear under several spellings (`reviewer-y`, `reviewer.y`), each its own
  assessor, so a consumer must never count assessors as independent parties. The 0.2 rules close the spellings of
  *reserved* identities, namespaces and authority roles; they do not, and cannot without authentication, tell two spellings
  of an ordinary name apart from two parties.
- The 0.1 attribution rules (a token-run rule for WalletWall and WallPrint identities, an exact case-folded match for registry
  authority identities, a literal-prefix policy rule) admit some spellings, for native and imported assessments alike, and
  stay as they are for every record committed under 0.1: a registry authority spelling variant under another role
  (`issuer-circle`), a name that fuses or extends a stem (`walletwallprint`, `walletwall2`), an engine authority id as an
  `UPSTREAM_AUTHORITY` assessor (`canonical-chain-state`), and a policy that only begins with a stem or splits the reserved
  prefix (`walletwall-policy`, `wwap2`, `ww-ap/review`). None of them reaches an evidence state. 0.2 refuses all of them
  (`admission-versions.test.ts`, `assessor-cases.ts`), and a 0.1 record carrying one stays valid, replayable, receipted,
  referenceable and diffable under 0.1.
- The 0.2 rules are bounded, not exhaustive. They fold case and separators and nothing else, so a homoglyph or leet spelling
  with a digit for a letter (`wa11et-wall`), a stem buried inside a longer word (`officialwalletwall`, the same class as
  `firewall-print-shop`), a stem that ends inside a later word (`wallet-wallofficial`) and a decorated authority
  (`issuer:circle2`) remain admissible, and a word that begins with a stem is refused even when innocent (`wallprinters`).
  Closing more would need a lexicon or fuzzy matching, which WalletWall deliberately does not do, and would refuse legitimate
  names (`wallet-wallpaper`).
- The reserved authority identities are literals frozen with each version (`AUTHORITY_IDS_V01`, `AUTHORITY_IDS_V02`), not
  read from the live registry, so a registry that gains an authority reinterprets no committed record: a 0.1 or 0.2 record
  with a reviewer named `issuer:future` stays valid the day the registry names that authority. The cost is that a new
  registry authority is not protected until the next WallPrint version; `admission-versions.test.ts` compares each list
  with the registry's and the engine's authorities and fails when they differ, so the decision is made on purpose. The
  `ISSUER` check still asks the registry which authority attributes the focal deployment, because that is what an issuer
  assessment is about; every record pins its registry version and digest, and replay refuses a different one
  (`MISSING_REGISTRY_VERSION`).
- The WallPrint version a record carries is not authenticated: nothing signs a record, so anyone who can present a record
  can label it 0.1. A 0.1 record is judged by 0.1's rules, which are the rules it was committed under; a consumer that wants
  the 0.2 rules requires `wallprintVersion` 0.2.
- The reserved policy namespace under 0.1 is the prefix `wwap`, `wwdr` or `wwvr` followed by a separator (or the end), in any
  letter case (`assessor-cases.ts` pins it); 0.2's namespace rule is "Admission rules by version".
- An import rejects a repeat of the same assessor and policy even when the two inputs are byte-identical; it never merges
  or de-duplicates. A caller that holds assessments from several sources passes them all to `buildWallPrintSnapshot`,
  which applies the one-assessor-one-policy rule to the whole list.
- The record is not an MCP tool or resource in this lane; `main.ts`, `server.ts` and `tools.ts` do not import it, so
  the shipped bundle and manifests are unchanged.
- A claim whose `CONFLICTING` state is propagated from a dependency (a derived readiness claim over two conflicting
  balances, conformance `CNF-004`) carries no `conflictsWith` entry and no `OBSERVATION_DISAGREEMENT` limitation, so
  `validateWallPrintRecord` refuses the record with `CONFLICTS_MISMATCH` on that claim: such an evaluation is not
  recordable in WallPrint (0.1 or 0.2). Found by the disclosure UI lane and reported here; admitting it is a contract decision
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
- A portable reference resolves against a compatible WalletWall disclosure store: the canvas's bundled lineages, or
  WalletWall's public resolver for records that were deliberately published ("Public resolver"). The canvas has no
  stable URL (its listener is a per-instance loopback port and path key, which a reference never encodes), so its QR
  code carries the `walletwall:` text, which nothing registers a handler for; the public page's QR code carries the HTTPS
  form of the same reference. A record that was never published resolves nowhere public, and publication is a deliberate
  act, never ambient. The public store's immutable artifact carries the engine's receipt, replay and diff results as
  published; re-publishing a record with different results is a conflict, not an update, and a later lane may add a
  versioned result record if that is wanted.
- The public page proves bytes (canonical form and SHA-256) and does not re-run the engine's record validation; a
  published artifact that validated at publication is rendered as published. Admitting a record is the publisher's act.
  The results carried beside the record (receipt, replay, diff) and the standing are checked for consistency with the
  record, not re-derived: a replay outcome changed together with its fields, or a well-formed ledger extension, cannot
  be told apart from the engine's own without a signature, and the page says the digest does not cover them.
- `UNAVAILABLE` depends on the host answering 404 for a record whose standing is not published. A host that answers
  200 with another page for every unknown path turns every unpublished record into "Store unreachable" (never into a
  record, and never into "invalid"); `docs/WALLPRINT_PUBLIC_RESOLVER.md` states the host requirement.
- A reference identifies a record by id and committed digest and nothing else; it is not a signature, and a digest match
  on resolution proves bytes, not who committed them or whether any claim is true. Signing, attestation keys and any
  trust model are a separate decision; `DIGEST_MISMATCH` is reported as an integrity finding and never as forgery.
- Reference version `0.1` and WallPrint versions `0.1` and `0.2` resolve: a reference keeps the WallPrint version its record
  was committed under. A reference to any other version is `UNSUPPORTED_VERSION`; nothing is guessed about its grammar.
- A self-contained reference (the record's canonical payload inside the code) is deliberately not offered: a record is
  tens of kilobytes, a copy goes stale while the reference does not, and the payload is already printed and copyable in
  the disclosure document. The reference-only form is the only form.
- Opening a reference in the canvas is an agent action (`set_bundle` with `reference`), since the page accepts no typed
  input under its CSP; the page itself offers Copy, not Open.

## Prototype reconciliation

An earlier design spike in the application repository (`feat/wallprint-contract`, not published) was compared against
WWEP before this lane was written. Reused: the immutable canonical record, the append-only hash-chained history with
predecessor-digest binding, assessor disagreement, the assurance-language guard, lowercase record ids, the chain
verifier's digest, transition and time checks, and the hardening tests. Dropped because WWEP already provides them:
hand-rolled strict-shape and prototype-key checks (`strictObject`, `hasForbiddenStructure`), reserved-word scanning of
codes (every code here is a closed WWEP enum), a WallPrint-local authority count and a WallPrint-local
`ESTABLISHED` rule (the engine's `independentCorroboration` and policy semantics are recorded instead), a
`0x`-prefixed digest and a safe-integer allowance (WWEP digests are bare hex and every evidence number is a string).
