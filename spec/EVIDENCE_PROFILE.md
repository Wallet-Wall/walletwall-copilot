# WalletWall Evidence Profile 0.1 (WWEP 0.1) — DRAFT

Status: **draft, pre-release**. This is a WalletWall-defined profile. It is **not** an industry standard,
has not been reviewed outside WalletWall, and makes no claim of interoperability beyond the W3C PROV alignment
described in section 9.

Key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119 / RFC 8174 when in capitals.

## 1. Purpose and non-purpose

WWEP defines a structured record of *what evidence was presented, from where, with what authority, and with what
limits*, and a deterministic procedure that classifies how well that evidence supports a claim.

WWEP **does not** establish that upstream evidence is true. Every state defined here describes the *sufficiency of
presented evidence under a published policy*. A state such as `ESTABLISHED` means "the presented evidence satisfies
the policy for this claim type", never "this is verified truth". WWEP also says nothing about arbitrary natural
language prose produced later by a language model.

## 2. Versions

| Identifier | Value | Meaning |
| --- | --- | --- |
| `EvidenceProfileVersion` | `0.1` | The profile version in every bundle (`wwepVersion`). |
| `RegistryVersion` | `0.2.0` | Version of the bundled asset and chain registry. Record-level, point-in-time verification (see `DATA_SOURCES.md`). |
| `RulesVersion` | `0.1.0-draft` | Version of the derivation rules (`wwdr.usd-value`, `wwvr.vault-technical-readiness`). |

A bundle MUST declare `wwepVersion: "0.1"`. Any other value MUST be rejected. See `VERSIONING.md`.

## 3. Evidence-origin classes

Every observation and assertion has exactly one origin class.

| Origin | Meaning |
| --- | --- |
| `CHAIN_OBSERVED` | A value read from canonical chain state at an identified block. The transport used to read it (RPC, indexer, local node) is recorded separately and carries no authority. |
| `AUTHORITY_ATTESTED` | A statement published by the issuer or protocol that is the appropriate authority for the claim. |
| `PROVIDER_OBSERVED` | A value that a third-party provider reports on its own behalf (price feed, labeling, indexed analytics). |
| `USER_SUPPLIED` | A value supplied by the person using the tool. |
| `WALLETWALL_DERIVED` | A value computed by a published WalletWall rule from other assertions. |

Each origin corresponds to a fixed set of source kinds (`CHAIN_OBSERVED`→`CHAIN_STATE`,
`AUTHORITY_ATTESTED`→`ISSUER_PUBLICATION`, `PROVIDER_OBSERVED`→`PROVIDER_ENDPOINT`, `USER_SUPPLIED`→`USER_INPUT`,
`WALLETWALL_DERIVED`→`WALLETWALL_RULES`). An observation whose source kind does not match its origin MUST NOT
qualify as evidence of that origin (limitation `ORIGIN_SOURCE_KIND_MISMATCH`, invariant INV-13).

## 4. Data model

All evidence-critical values are strings. JSON numbers MUST NOT appear in evidence objects. Quantities are
canonical atomic-unit decimal strings (section 7). Every object is closed: unknown properties are rejected. The one
exception is the bounded open maps `subject`, `value` and `payload`, which accept keys outside the claim contract and
keep them in the record's digest; the claim contract says how they are treated.

- **Source** — `{id, kind, authorityId?, transport?{retrievedVia}, independenceGroup?}`. Where evidence came from.
  `transport.retrievedVia` is metadata only.
- **Observation** — `{id, sourceId, origin, observedAt, finality, result, subject, payload}`. One reading.
  `result` is `VALUE`, `NO_RESULT` or `ERROR`. `NO_RESULT` and `ERROR` carry no value.
- **Assertion** — `{id, claimType, origin, temporality, subject, value|null, observationIds, derivationId?,
  assertedAt, limitations?, declared?}`. A claim about a subject, backed by observations or by a derivation.
  `temporality` is `CURRENT` (must be fresh) or `PINNED` (a historical point such as a block).
  `declared` lets an author state the support, freshness, finality and corroboration they *believe* apply; the
  engine never trusts it and reports any excess as a violation.
- **Derivation** — `{id, ruleId, rulesVersion, inputAssertionIds, outputAssertionId}`. A WalletWall rule applied to
  assertions. Derivations take assertions only, never raw observations. A derived assertion is about what its inputs
  are about: its `subject` MUST match every input's `subject` on the subject keys their claim types share, where an
  identity's `address` compares as the `token`.
- **EvidenceDependency** — the directed edge `assertion → input` induced by a derivation's `inputAssertionIds` (and
  by an assertion's `observationIds`). Dependencies are computed, not stored separately.
- **Authority** — the entity or state that may establish a claim type, e.g. `canonical-chain-state`,
  `issuer-publication`, `walletwall-rules`.
- **AuthorityPolicy** — the per-claim-type rules for authority, corroboration, finality, freshness and required
  dependencies (`authority-policies/policies.json`, see `AUTHORITY_MODEL.md`).
- **ClaimContract** — the per-claim-type subject and value shape (required keys and their formats), the observation
  origins and source kinds that may establish or corroborate the claim, and the observation-to-assertion linkage. An
  assertion's `subject` and each supporting observation's `subject` share one shape; an assertion's `value` and each
  supporting observation's `payload` share one shape. The engine serves the contract as `walletwall://schemas/claims`.
- **SupportState**, **FreshnessState**, **FinalityState** — section 5.
- **Conflict** — `{id, assertionIds, reason}` declared by an author, or detected by the engine when two assertions
  about the same claim identity, neither retired by a well-formed supersession (section 8), carry different values.
  Conflicts are never auto-resolved.
- **Limitation** — a code from a closed enumeration attached to a result that explains why it is weaker than it
  might look (for example `TRANSPORT_FIDELITY_NOT_VERIFIED`, `NOT_FINALIZED`, `REGISTRY_VERIFIED_POINT_IN_TIME`).
- **Supersession** — `{id, supersededAssertionId, supersedingAssertionId, effectiveAt, reason}`. A newer assertion
  replaces an older one; the older assertion stays in the bundle and is reported `SUPERSEDED`.
- **RegistryVersion**, **RulesVersion**, **EvidenceProfileVersion** — section 2.

A source, observation, assertion or derivation id MUST be unique among the records of its kind (section 8).

## 5. States

Exact semantics are in `SUPPORT_STATES.md`. Summary:

- Support: `ESTABLISHED`, `SUPPORTED`, `PARTIAL`, `CONFLICTING`, `STALE`, `SUPERSEDED`, `UNKNOWN`, `NOT_ESTABLISHED`.
- Freshness: `CURRENT`, `STALE`, `PINNED`, `UNKNOWN_FRESHNESS`.
- Finality: `FINALIZED`, `UNFINALIZED`, `UNKNOWN_FINALITY`; `null` when finality does not apply to the claim type.

When states are combined across dependencies the **weakest** member wins, in this order from strongest to weakest:
`ESTABLISHED > SUPPORTED > PARTIAL > STALE > SUPERSEDED > UNKNOWN > CONFLICTING > NOT_ESTABLISHED`.

## 6. Mandatory evidence invariants

These are enforced by `check_invariants` and by executable conformance tests. Each has an identifier.

1. **INV-01** `NO_SOURCE → NO_FACT`. An assertion with no observation and no derivation MUST NOT carry a value or be
   presented as `PARTIAL` or stronger.
2. **INV-02** `STALE` MUST NOT satisfy `CURRENT`.
3. **INV-03** `CONFLICTING` MUST NOT satisfy `ESTABLISHED`.
4. **INV-04** `NO_RESULT` MUST NOT become `ZERO`.
5. **INV-05** `UNKNOWN` MUST NOT become `FALSE`.
6. **INV-06** `WALLETWALL_DERIVED` MUST NOT masquerade as upstream authority.
7. **INV-07** Processing evidence MUST NOT increase the authority of its inputs.
8. **INV-08** Duplicate evidence MUST NOT increase independent corroboration.
9. **INV-09** Multiple provider endpoints MUST NOT automatically imply independent authority.
10. **INV-10** Derived results retain the limitations of their dependencies.
11. **INV-11** Token quantity MUST NOT silently become USD value without explicit price evidence.
12. **INV-12** Historical assertions are superseded, never silently rewritten. A reused assertion id is reported here
    as `DUPLICATE_ASSERTION_ID`, an assertion superseded by more than one record that names another assertion as
    `SUPERSEDED_MULTIPLE_TIMES`, a record that names nothing or its own assertion as `SUPERSESSION_REFERENCE_INVALID`,
    one whose two assertions are not about the same claim as `SUPERSESSION_CLAIM_IDENTITY_MISMATCH`, one whose superseding
    assertion is not later as `SUPERSESSION_NOT_FORWARD_IN_TIME`, and a chain of supersessions that comes back on itself by
    any of them as `SUPERSESSION_CYCLE`.
13. **INV-13** Source transport and source authority are separate concepts. `retrievedVia = Alchemy` does not imply
    `authority = Alchemy` for Ethereum state.

**INV-00** (engine rule) — declared states MUST NOT exceed states computed by the published rules. A derived assertion
whose subject differs from its inputs is reported here as `SUBJECT_MISMATCH`, and one whose subject fails the claim
contract as `INVALID_SUBJECT`. A reused source, observation or derivation id is reported here as `DUPLICATE_SOURCE_ID`,
`DUPLICATE_OBSERVATION_ID` or `DUPLICATE_DERIVATION_ID`, against no assertion. A derived value that recomputation does
not reproduce is reported here as `RECOMPUTATION_MISMATCH`: the rule is applied to every balance with every price among
the inputs of a USD value, and to every identity with every balance among those of a readiness claim, and one reading
that gives another value is a mismatch.

## 7. Canonicalization and digests

Evidence objects are serialized with the **RFC 8785 JSON Canonicalization Scheme** and hashed with **SHA-256**.
`JSON.stringify` output MUST NOT be hashed. The implementation additionally rejects lone surrogates (I-JSON),
non-plain objects and every JSON number in evidence objects.

Evidence-critical quantities are canonical atomic-unit decimal strings matching `^(0|[1-9][0-9]{0,77})$` and not
exceeding `2^256 − 1`. Decimals are strings matching `^(0|[1-9][0-9]?)$` and at most 36. Arithmetic uses `BigInt`.
Decimal renderings are exact and unrounded. JavaScript `Number` MUST NOT hold a token balance.

Two digests are defined for an observation: the **evidence digest** (canonical form of the whole observation) and the
**content digest** (canonical form of `{result, subject, payload}`), used to detect duplicate evidence.

## 8. Evaluation

Evaluation is a pure function of `(bundle, evaluatedAt, registry, policies, rules)`. The evaluation time is an
explicit input; the engine never reads a clock. The order of the records in any list of a bundle the schema accepts
changes no answer of `inspect_evidence`, `check_invariants`, `assess_vault_readiness` or `trace_provenance`; only
`bundleDigest`, a digest of the records as listed, follows it. A list inside one record is part of that record, and this
does not cover it. It moves no state, limitation or violation, because a derived value is recomputed under every reading
of its inputs, but it is what `trace_provenance` walks and what `dependencies` echo, in that order. Procedure and
per-claim policies are in `AUTHORITY_MODEL.md` and `SUPPORT_STATES.md`. In outline:

1. Reject any bundle that fails the closed schema.
2. Refuse structural ambiguity. A reused assertion id names no record, whichever record comes first, so nothing depends
   on record order: every assertion in the bundle is `NOT_ESTABLISHED`, the reused id itself with `NO_SOURCE`; a reference
   to it resolves to nothing; every readiness criterion is `INDETERMINATE` (`DUPLICATE_ASSERTION_ID`), so readiness is
   `NOT_ESTABLISHED`; `trace_provenance` finds no such target; `check_invariants` reports INV-12. A reused source,
   observation or derivation id is refused the same way, even when its records are identical: every assertion in the
   bundle is `NOT_ESTABLISHED`; a reference to it resolves to nothing, exactly as if no such record existed, so an assertion
   that reads it reports `DANGLING_REFERENCE` or `DERIVATION_MISSING` and `trace_provenance` reports `DANGLING_REFERENCE`;
   every readiness criterion is `INDETERMINATE`, with the first of `DUPLICATE_ASSERTION_ID`, `DUPLICATE_SOURCE_ID`,
   `DUPLICATE_OBSERVATION_ID` and `DUPLICATE_DERIVATION_ID` that applies as its reason; `check_invariants` reports INV-00,
   and still reports what each record presents (`TRANSPORT_AS_AUTHORITY`, `ORIGIN_SOURCE_KIND_MISMATCH`, or a source it
   cannot resolve), whichever comes first. An assertion with no path to the reused id keeps its own freshness, finality,
   authority and limitations, with one exception that a reused assertion id shares: a derived claim reads a superseded
   input as `NOT_ESTABLISHED`, not as superseded, so it inherits `SUPERSEDED` but does not report `DEPENDENCY_SUPERSEDED`,
   and its freshness is worked out as if the input were not superseded. An id is unique within its kind, so a source and
   an observation may share one. Nothing resolves through a conflict or supersession id.
3. Mark superseded assertions; detect declared and value-disagreement conflicts among the assertions that no well-formed
   supersession retires. An assertion superseded more than once is `SUPERSEDED`. `supersededBy` names the smallest id, by
   code unit, among the other assertions its records name that resolve; if there is none, the assertion itself if a record
   names it; otherwise the smallest of the ids, which resolve to nothing. A supersession record is well-formed when it names
   two different assertions that resolve, of one claim identity, the superseding one asserted later. Only a well-formed
   record takes an assertion out of conflict detection, because only then does a later assertion carry the claim forward. An
   assertion that a faulty record supersedes (one `check_invariants` reports as `SUPERSESSION_REFERENCE_INVALID`,
   `SUPERSESSION_CLAIM_IDENTITY_MISMATCH` or `SUPERSESSION_NOT_FORWARD_IN_TIME`) still reads `SUPERSEDED`, and stays among
   those compared, so a record that cannot be valid cannot hide a conflict. This only ever adds a conflict: an assertion it
   changes reads `CONFLICTING`, a fall from any state that was a basis and no gain for one that was not (`NOT_ESTABLISHED`),
   and no readiness answer is more favourable.
4. For each assertion, evaluate directly (observations) or by derivation (dependencies, recursively). A derived
   assertion whose subject fails the claim contract is `NOT_ESTABLISHED` with `INVALID_SUBJECT`, and one whose subject
   differs from any input's on a shared subject key is `NOT_ESTABLISHED` with `SUBJECT_MISMATCH`. A derived assertion that
   depends on itself, directly or through others, is on a dependency cycle. For evaluation, only an input that resolves, of a
   derivation that names the assertion as its output, for a claim type that may be derived, makes a dependency. A cycle has
   no basis and is read the same from every side: no assertion on it is read in full by another on it. Each reads the
   others on it as inputs with no basis: `NOT_ESTABLISHED` unless superseded or conflicting, with `DEPENDENCY_CYCLE`,
   unknown finality, and unknown freshness unless `PINNED`. It is otherwise evaluated as usual, except that its own support
   is `NOT_ESTABLISHED` whatever those inputs read, and supersession and conflict override that as they override any state.
   Each retains every limitation any of them reports, so the assertions on a cycle report the same limitations (INV-10),
   though not always the same freshness, finality or authority, and a `PINNED` one that retains `OBSERVATION_FROM_FUTURE`
   reports `UNKNOWN_FRESHNESS`. An assertion that depends on a cycle without being on it is evaluated as usual, over those
   assertions as they read.
5. Cap and combine states by the weakest-member rule; apply freshness and finality; attach limitations. A reading with a
   value dated after `evaluatedAt` is `OBSERVATION_FROM_FUTURE` with `UNKNOWN_FRESHNESS` and at most `PARTIAL` support,
   whether the claim is `CURRENT` or `PINNED`. A claim derived from it inherits the limitation and the cap, and a `PINNED`
   one reports `UNKNOWN_FRESHNESS`: `PINNED` means a historical point, not a reading from after the evaluation time. An
   assertion already refused on its subject or value, or whose readings disagree, keeps that state and does not reach this check.
6. Independently check the invariants and report violations without mutating results.

A shape failure is an evaluation state, not a schema rejection: an assertion whose subject or value, or whose supporting
observation's subject or payload, does not meet the claim contract is reported `NOT_ESTABLISHED` with the limitation
`INVALID_SUBJECT`, `SUBJECT_MISMATCH`, `INVALID_VALUE` or `VALUE_MISMATCH`. On the assertion that fails, each such
limitation carries a structured `diagnostics` entry naming the record checked, the required keys and the missing, invalid,
unexpected or mismatched keys; an assertion that inherits or retains the limitation from another carries none.
Diagnostics are deterministic and bounded (one entry per distinct observation), never include record values (only
observation ids already present in the evaluation), and report key names outside the contract vocabulary as `*`. The
limitation codes are the stable machine-facing reason; diagnostics only explain them.

## 9. Provenance alignment

`trace_provenance` emits a graph shaped like W3C PROV-JSON: observations and assertions are `entity`, derivations are
`activity`, sources and the WalletWall rule engine are `agent`; relations use `wasDerivedFrom`, `wasAttributedTo`,
`wasGeneratedBy`, `used` and `wasRevisionOf` (supersession). The mapping is a profile of PROV, not a full
implementation, and the namespace `urn:walletwall:wwep:0.1:` is an identifier that is never dereferenced. It walks every
derivation an assertion names and what the assertion supersedes, so it can report `DEPENDENCY_CYCLE` for a loop evaluation
does not follow. What one assertion supersedes is walked in order of the superseded id, by code unit.

## 10. Readiness terminology

WWEP defines `VAULT_TECHNICAL_READINESS`, never a generic `READY`. Its values are `CRITERIA_MET`,
`CRITERIA_NOT_MET` and `NOT_ESTABLISHED`. It does **not** establish investment merit, solvency, creditworthiness,
legal status, regulatory compliance, absence of fraud, or future performance.

## 11. Known limitations of 0.1

- Evidence is evaluated as presented. The engine cannot verify that a `CHAIN_OBSERVED` reading was faithfully
  retrieved (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached).
- Registry content is verified only at a point in time (`REGISTRY_VERIFIED_POINT_IN_TIME`); later changes to a contract are not observed.
- Address checksums (EIP-55) are not verified. Addresses and block hashes are compared case-insensitively wherever
  subject identity is compared: observation to assertion, conflict grouping, supersession identity, derived claim to
  input, and the readiness and USD rules. Comparison is not rewriting: records, digests and suggested assertions keep the
  spelling supplied, and values are never folded.
- `blockHash` is part of a balance claim's subject, so two readings at one height with different hashes are two
  fork-specific claims, not a conflict. Whether WWEP should model state at canonical height N or state in exact block H
  is an open authority and finality decision.
- No live providers exist; all evidence is supplied by the caller.
- Only five claim types are defined: `ASSET_IDENTITY`, `TOKEN_BALANCE_AT_BLOCK`, `TOKEN_USD_PRICE`,
  `TOKEN_USD_VALUE`, `VAULT_TECHNICAL_READINESS`.
