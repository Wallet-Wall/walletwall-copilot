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
canonical atomic-unit decimal strings (section 7). Every object is closed: unknown properties are rejected.

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
  assertions. Derivations take assertions only, never raw observations.
- **EvidenceDependency** — the directed edge `assertion → input` induced by a derivation's `inputAssertionIds` (and
  by an assertion's `observationIds`). Dependencies are computed, not stored separately.
- **Authority** — the entity or state that may establish a claim type, e.g. `canonical-chain-state`,
  `issuer-publication`, `walletwall-rules`.
- **AuthorityPolicy** — the per-claim-type rules for authority, corroboration, finality, freshness and required
  dependencies (`authority-policies/policies.json`, see `AUTHORITY_MODEL.md`).
- **SupportState**, **FreshnessState**, **FinalityState** — section 5.
- **Conflict** — `{id, assertionIds, reason}` declared by an author, or detected by the engine when two
  non-superseded assertions about the same claim identity carry different values. Conflicts are never auto-resolved.
- **Limitation** — a code from a closed enumeration attached to a result that explains why it is weaker than it
  might look (for example `TRANSPORT_FIDELITY_NOT_VERIFIED`, `NOT_FINALIZED`, `REGISTRY_VERIFIED_POINT_IN_TIME`).
- **Supersession** — `{id, supersededAssertionId, supersedingAssertionId, effectiveAt, reason}`. A newer assertion
  replaces an older one; the older assertion stays in the bundle and is reported `SUPERSEDED`.
- **RegistryVersion**, **RulesVersion**, **EvidenceProfileVersion** — section 2.

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
12. **INV-12** Historical assertions are superseded, never silently rewritten.
13. **INV-13** Source transport and source authority are separate concepts. `retrievedVia = Alchemy` does not imply
    `authority = Alchemy` for Ethereum state.

**INV-00** (engine rule) — declared states MUST NOT exceed states computed by the published rules.

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
explicit input; the engine never reads a clock. Procedure and per-claim policies are in `AUTHORITY_MODEL.md` and
`SUPPORT_STATES.md`. In outline:

1. Reject any bundle that fails the closed schema.
2. Mark superseded assertions; detect declared and value-disagreement conflicts among non-superseded assertions.
3. For each assertion, evaluate directly (observations) or by derivation (dependencies, recursively).
4. Cap and combine states by the weakest-member rule; apply freshness and finality; attach limitations.
5. Independently check the invariants and report violations without mutating results.

## 9. Provenance alignment

`trace_provenance` emits a graph shaped like W3C PROV-JSON: observations and assertions are `entity`, derivations are
`activity`, sources and the WalletWall rule engine are `agent`; relations use `wasDerivedFrom`, `wasAttributedTo`,
`wasGeneratedBy`, `used` and `wasRevisionOf` (supersession). The mapping is a profile of PROV, not a full
implementation, and the namespace `urn:walletwall:wwep:0.1:` is an identifier that is never dereferenced.

## 10. Readiness terminology

WWEP defines `VAULT_TECHNICAL_READINESS`, never a generic `READY`. Its values are `CRITERIA_MET`,
`CRITERIA_NOT_MET` and `NOT_ESTABLISHED`. It does **not** establish investment merit, solvency, creditworthiness,
legal status, regulatory compliance, absence of fraud, or future performance.

## 11. Known limitations of 0.1

- Evidence is evaluated as presented. The engine cannot verify that a `CHAIN_OBSERVED` reading was faithfully
  retrieved (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached).
- Registry content is verified only at a point in time (`REGISTRY_VERIFIED_POINT_IN_TIME`); later changes to a contract are not observed.
- Address checksums (EIP-55) are not verified; addresses are compared case-insensitively.
- No live providers exist; all evidence is supplied by the caller.
- Only five claim types are defined: `ASSET_IDENTITY`, `TOKEN_BALANCE_AT_BLOCK`, `TOKEN_USD_PRICE`,
  `TOKEN_USD_VALUE`, `VAULT_TECHNICAL_READINESS`.
