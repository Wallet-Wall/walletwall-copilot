# WallPrint attestations: the signing and issuer-attestation trust model — DRAFT

Status: **draft, design lane, pre-release.** This document defines what a WallPrint signature proves, who may sign what,
how a signer is bound to a key, how keys rotate and are revoked, and how verification treats historical records. It is
built on WallPrint 0.2 (`WALLPRINT.md`) and the WalletWall Evidence Profile (WWEP 0.1, `EVIDENCE_PROFILE.md`,
`AUTHORITY_MODEL.md`). It is not an industry standard and has not been reviewed outside WalletWall.

What exists in this lane: this specification, a pure verifier prototype
(`packages/mcp/src/wallprint/attestation-vocabulary.ts`, `attestation.ts`, `key-registry.ts`, `ed25519.ts`,
`attestation-verify.ts`) that is not imported by the shipped MCP runtime, and deterministic synthetic test vectors
(`packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json`). What does not exist: any signing
operation, any private key, any production key registry, any published attestation, any change to the record, the
digest, the receipt, the reference, the resolver or the MCP surface. **No signature system is shipped by this lane.**

A follow-up lane (section 23) adds one more object above the same logs: a **signed trust checkpoint** that commits the
signing-key registry head and the acceptance-ledger head together. It is implemented as a further pure verifier
(`checkpoint-vocabulary.ts`, `checkpoint.ts`, `checkpoint-verify.ts`) with its own synthetic vectors, is equally outside
the shipped runtime, and adds no signing operation, no private key and no production governance key.

## 1. The question, and the short answer

> What exactly does a WallPrint signature prove, who may sign what, how is a signer identity bound to a key, how are
> rotation and revocation handled, and how does verification interact with historical WallPrint records?

- A valid signature proves one thing: *the holder of the private key for a particular public key signed exactly these
  bytes.* Everything beyond that is a separately defined, separately reported binding.
- The thing signed is a small, typed, domain-separated **statement** in a **detached** envelope. The committed record
  and its digest never change. WalletWall signs "I published this record digest". An assessor or issuer signs "I made
  this assessment about this evidence", never the whole record.
- Who a key belongs to is a fact in a separate, versioned, append-only **signing-key registry**, controlled by
  WalletWall governance, never a claim a key or a display name makes about itself.
- Keys rotate and are revoked by appending a registry version. Revocation and compromise are *policy over a valid
  signature*: the signature stays cryptographically valid, and the registry states what standing earlier acceptances keep.
- A historical attestation is judged under the registry version it was accepted under, reported beside today's key
  status. Present-day state never silently rewrites the historical decision.
- Ed25519 now, named inside the signed statement, with post-quantum signatures deferred and able to coexist later.

```text
record integrity != signer authentication
signer authentication != assessor authority
assessor authority != factual truth
issuer signature != WalletWall endorsement
WalletWall signature != truth certification
signature validity != key currently trusted
key currently trusted != key was trusted historically
assessment agreement != corroboration
```

## 2. What WallPrint proves today (the inventory)

Nothing in WallPrint 0.2 authenticates anyone. The table states, for each trust surface, what it proves, what it does
not, whether any authentication exists, whether identity is only attributed text, and whether adding a signature would
change that surface's semantic contract.

| Surface | Proves today | Does not prove | Authentication today | Identity is only attributed text? | Would a signature change its contract? |
| --- | --- | --- | --- | --- | --- |
| Record digest (`wallPrintDigest`, SHA-256 over the RFC 8785 record without `digest`) | the disclosed canonical record equals its committed bytes | truth; who committed it; when; that a person or process in particular produced it; that the `wallprintVersion` label is authentic | none | there is no identity | No. A detached signature over the digest adds a layer outside it. A signature *inside* the record would (circular, and a record shape change). |
| Receipt (`wallPrintReceipt`) | record id, version, digest, bundle digest and versions agree with a record's bytes | `RECEIPT_DOES_NOT_ESTABLISH`: truth, safety, solvency, compliance, issuer endorsement; issuance time; who issued it | none; it has no identifier of its own | none | Yes, if the receipt itself were signed it would become a certificate. It stays unsigned; an attestation targets the same identity. |
| Portable reference | which record id, which digest, which WallPrint version, optionally which section | `REFERENCE_DOES_NOT_ESTABLISH`: validity, truth, endorsement, who committed | none | none | Yes. A signature in a URL or QR code would turn a locator into a credential. Refused. |
| Public resolver (static store plus one page) | the published artifact's bytes hash to the digest in the URL; the page re-proved the canonical form; carried results are consistent with the record | who published it; truth; that the standing is complete or unrewritten | transport only: the page was served from the resolver base over TLS; nothing is authenticated at the artifact | the "publisher" is whoever controls the store | The resolver's meaning does not change; a signature adds origin that survives a mirror, an archive or a host takeover (section 6). |
| Publication record (artifact, standing, index) | immutable bytes per id and digest; no overwrite; a standing whose ledger is hash-chained | authorship; that the ledger is complete or was not rewritten from its start; that the carried results are authentic (only that they are consistent); publication instants | none ("nothing signs it") | whoever controls the store | The standing is a different object from the artifact; signing one does not sign the other. |
| External assessment (an entry in `assessments`) | an attributed statement a named assessor concluded under a named policy at a stated time, admitted by the version's admission rules | that the named assessor wrote it; that the assessor is who the name says; that `assessedAt` is true; that it is correct | none. `attribution != authentication` | yes: `assessor` is a string | No. A signature authenticates the origin of the same object. There is no second assessment model. |
| Issuer role (`ISSUER`) | the attributed id equals the focal deployment's registry authority, spelled exactly (`ISSUER_AUTHORITY_MISMATCH` otherwise) | that the issuer made the statement; that the issuer endorses WalletWall or the record | none | yes: a string compared with the registry's | Only with an explicit key-to-authority binding (section 8). Without one a signature adds nothing to the issuer role. |
| Registry authority attribution (WWEP) | the registry (verified point-in-time) names `issuer:circle` as the authority attributing a deployment; an `AUTHORITY_ATTESTED` assertion's authority is checked against it | that any observation's origin label is authenticated (`TRANSPORT_FIDELITY_NOT_VERIFIED` is always attached) | none; `transport != authority` | the registry's own strings | A signature must never feed a WWEP evidence state. An assessment's signature changes no support, authority or corroboration. |
| Lifecycle history | a hash-chained, append-only ledger per record: no silent edit, reorder or drop within the chain | authorship; that the chain was not re-chained from its first event by whoever controls it | none | none | A signature over a ledger head is a different purpose (`STANDING_HEAD`), deferred (section 21). |

Facts the inventory surfaced, each of which shaped the design:

1. **An assessment has no digest of its own and its evidence references are ids, not digests.** `evidenceRefs: ["obs-identity"]`
   means nothing without the bundle that defines `obs-identity`. A signature over the assessment text alone could be
   replayed against another bundle that reuses the ids. The signed statement therefore carries the bundle digest and the
   focal assertion with the assessment (section 7).
2. **The `ISSUER` check is attribution, not authentication.** `issuer:circle` as an assessor id means "equal to the registry's
   string", which is exactly what a forger would type.
3. **The standing, the publication index and the page's carried results are unsigned and checked only for consistency.**
   Whoever controls the store can extend them. An attestation does not fix that unless it covers them, and it does not.
4. **The version label on a record is not authenticated** (`WALLPRINT.md`, Known limitations). An attestation names the
   version it was made under, so a label that moves does not move the signature with it.
5. **The evidence registry's digest is pinned by every record and bundled into the shipped runtime.** Anything that changes
   it makes historical records unreplayable and changes shipped artifacts. Signing keys must not live there (section 8).

## 3. Goals and non-goals

Goals: define the meaning of a signature precisely; keep authentication, authority and truth as separate dimensions; make
historical verification reproducible from public static data with no signer present; keep the record, receipt, reference
and WallPrint 0.2 byte-for-byte unchanged; require no online service, no database, no write endpoint and no custody in
this repository.

Non-goals: WalletWall signing operations, key generation, custody, HSM or KMS integration, a signing endpoint, a signing
step in CI (a later operational-security lane); a second assessment model; a trust score, rank or count of signatures;
signing evidence, claims or the engine's own evaluation; certifying anything; chain anchors, DIDs or wallet signatures;
replacing the registry's point-in-time verification.

Invariants this design adds (`ATTESTATION_INVARIANTS`, each pinned by a test):

```text
signature count != trust
key label != signer identity
```

## 4. Objects

| Object | What it is |
| --- | --- |
| **Statement** | the closed, typed, signed JSON: attestation version, purpose, signer, key, algorithm, public key, target |
| **Target** | what the statement is about: a record identity (`WALLPRINT_RECORD`) or one assessment in its context (`WALLPRINT_ASSESSMENT`) |
| **Envelope** | `{ type, attestationVersion, statement, signature }`; detached, immutable, content-addressed |
| **Signer** | a registry entity with a kind (`WALLETWALL_PUBLISHER`, `EXTERNAL_ASSESSOR`, `ISSUER_AUTHORITY`) and one or more keys |
| **Key** | a public key with an id, an algorithm, granted purposes, a status and the registry versions that dated them |
| **Key registry snapshot / chain** | one immutable, digest-carrying version of the signing-key registry; the append-only chain of them |
| **Acceptance ledger entry** | the registry version and digest the store recorded, in an append-only hash-chained ledger and bound to one attestation digest, when it accepted an attestation |
| **Verification result** | separate dimensions (section 12); never a single verdict |

## 5. What gets signed

Four options were compared. The choice follows semantic clarity and replay and historical integrity, not convenience.

| Option | Signs | Verdict |
| --- | --- | --- |
| 1. Record digest | `recordId`, `wallprintVersion`, `recordDigest` | **Right for WalletWall publication, wrong for assessors.** A record contains WalletWall's evaluation, every claim and every other assessor's statement; an assessor signing the record digest would appear to vouch for all of it. The record also does not exist when the assessor speaks: the assessment is an input to the record, so signing the record is circular for the signer. |
| 2. An individual assessment digest | the assessment plus its context | **Right for assessors and issuers**, with one correction: sign the assessment *with* its bundle digest and focal assertion, because its references are ids (fact 1). It introduces a target-key digest domain, used only to address attestations, never signed. |
| 3. A separate typed statement | purpose, version, subject, signer, key, algorithm, target | **Right as the form of every signature**: one small, domain-separated, closed statement per purpose, with every semantically relevant field inside the signed bytes. |
| 4. Combination | record digest for WalletWall publication; assessment-with-context for assessors and issuers | **Chosen**, realised as option 3 envelopes. |

**Detached, not in-record.** A signature field in the canonical record would be circular (the digest covers the record, so
the signature cannot be inside what it signs without being excluded from it), would change the record shape (a WallPrint
version change, with every historical-version consequence), and would make a successor inherit or contradict its
predecessor's signatures. A detached envelope satisfies every requirement here, so the contract does not bump: WallPrint
stays `0.2`, and the attestation format and the key registry carry their own versions (section 18).

**A successor record needs its own attestations.** A correction, supersession or withdrawal never carries an attestation
forward or erases one. An assessment attestation is *found again* in a successor only by re-deriving its target from the
successor's own content: the same assessment about the same evidence has the same target, so the assessor's statement
holds where it is still true, and a record attestation (whose target is a digest) matches nothing in a successor.

## 6. The three signing uses

| Purpose | Signer kind | Target | Meaning |
| --- | --- | --- | --- |
| `RECORD_PUBLICATION` | `WALLETWALL_PUBLISHER` | `WALLPRINT_RECORD` | WalletWall intentionally published this exact record digest |
| `ASSESSMENT_ORIGIN` | `EXTERNAL_ASSESSOR` | `WALLPRINT_ASSESSMENT` (role not `ISSUER`, not `WALLETWALL`) | a key bound to the signer that lists this assessor id made this attributed assessment |
| `ISSUER_ASSESSMENT_ORIGIN` | `ISSUER_AUTHORITY` | `WALLPRINT_ASSESSMENT` (role `ISSUER`) | a key bound to the registry authority this assessment is attributed to made it |

Each key is authorized per purpose. The purpose is inside the signed statement and selects the domain tag, so a signature
for one purpose is not a signature for another. The statement's purpose and the assessment's role must agree
(`ISSUER_ASSESSMENT_ORIGIN` exactly when the role is `ISSUER`); a disagreement is reported as a target mismatch whatever
the signature says.

### 6.1 WalletWall publication attestation (`RECORD_PUBLICATION`)

*Means:* WalletWall attests that it intentionally published this exact record digest. *Does not mean:* that WalletWall
certifies any claim, guarantees solvency or safety, or endorses any external assessment in the record. WalletWall's own
generated assessment (`walletwall-rules`) is never an attestation target: WalletWall's authorship of it is already
established by recomputation (validation parity admits a record only if the engine could have produced it), and WalletWall
speaks through this one statement.

**Is it useful beyond the digest and the resolver's origin?** Conditionally, and this lane says so plainly.

- Today the only thing that associates a published record with WalletWall is the origin it is served from. The digest
  proves bytes; TLS to the resolver base proves the host. An attestation adds *portable origin that survives the host*:
  a mirror, an archive, a pinned offline copy or a third-party verifier can check that WalletWall's key signed this digest
  without trusting wherever the bytes were fetched.
- It adds *separation from host compromise* only if the signing key is held apart from the deployment. If the same party
  and process that controls the store also holds the key, the attestation adds nothing a store takeover cannot forge.
- It adds nothing against a compromised registry channel: whoever can serve the registry can bind their own key
  (section 17, T19). It needs an out-of-band anchor to mean anything beyond origin trust.
- It is the lowest priority of the three. Implementing it first would produce the weakest claim; assessor and issuer
  attestations are where authentication is currently absent entirely. It is specified so the key registry, the format
  and the verifier are shared, not so it ships first.

### 6.2 External assessor attestation (`ASSESSMENT_ORIGIN`)

*Means:* the holder of a key associated, in the registry, with the signer that lists assessor X signed this assessment under
policy Y. *Does not make the assessor* independent, trusted, authoritative, an upstream authority or correct, and does not
create a second assessment model: the semantic object stays the existing `AssessmentRecord`; the signature is an
authentication layer around that attribution.

Without a registry binding, the system can truthfully say only *this key signed an assessment claiming assessor X*
(`KEY_ONLY`). That is weaker than authenticated assessor identity, and the result model keeps the two apart (section 12).
Self-declared key metadata never establishes real-world identity, and a limitation flag is not a boundary a consumer
switches on, so **there is no registry binding method for "the assessor told us this key is theirs"**: such a key is simply not
registered and is `KEY_ONLY`. The only external-assessor binding is `ASSESSOR_PUBLICATION`: governance recorded, point-in-time,
where the assessor's own publication names the key. That is a defined trust path from the assessor's published identity to the
key, still not proof of a real-world party, and the result carries its binding method.

### 6.3 Issuer attestation (`ISSUER_ASSESSMENT_ORIGIN`)

An assessment is an issuer attestation only if **all four** hold, and failure of any one prevents `BOUND_ISSUER_AUTHORITY`:

1. the assessment is attributed to the registered issuer authority: its role is `ISSUER`, its assessor id equals the
   registry authority of the focal deployment, and the record containing it is valid (the existing `ISSUER_AUTHORITY_MISMATCH`
   and `ISSUER_NOT_IN_REGISTRY` admission checks, evaluated by `validateWallPrintRecord`);
2. the signing key is explicitly bound, in the key registry, to a signer of kind `ISSUER_AUTHORITY` whose `authorityId` equals
   that assessor id;
3. the key is authorized for `ISSUER_ASSESSMENT_ORIGIN` and was `ACTIVE` in the registry version the attestation was accepted under;
4. the signature verifies over the exact statement bytes.

Issuer status is never inferred from an assessor claiming role `ISSUER`, a key label that says "Circle", a signature that
verifies, or a familiar domain or name. Without the record in hand criterion 1 is not evaluated and the result is capped at
`KEY_ONLY` with `ISSUER_ATTRIBUTION_NOT_EVALUATED`.

**Where the binding lives and who controls it.** In the signing-key registry (section 8), as a signer of kind
`ISSUER_AUTHORITY` whose binding method must be `ISSUER_PUBLICATION`: WalletWall governance records, point-in-time, where the
issuer's own publication names the key (publisher, URL, locator, retrieval date), exactly as the evidence registry records where
an issuer published a contract address. WalletWall governance controls the registry; the issuer controls only what it publishes.

**Is that a defensible trust root?** As a root of *authentication of origin to a key bound by WalletWall's governance to an
issuer publication*, yes; as proof that the issuer itself consented, no. `BOUND_ISSUER_AUTHORITY` therefore always carries the
binding method and the registry version, and its sentence says the statement's origin is authenticated, not that the issuer
endorses WalletWall or that the statement is correct. **No issuer publishes a WallPrint signing key today, so the registry holds
no issuer signer, and `BOUND_ISSUER_AUTHORITY` cannot occur until governance adds one with issuer-published evidence.** The model is
defined so that the first issuer to publish a key can be bound without a new contract.

## 7. The statement, the envelope and the exact signed bytes

```text
envelope  = { "type": "walletwall.wallprint.attestation",
              "attestationVersion": "0.1",
              "statement": statement,
              "signature": "<lower-case hex>" }
statement = { "attestationVersion": "0.1",
              "purpose": "RECORD_PUBLICATION" | "ASSESSMENT_ORIGIN" | "ISSUER_ASSESSMENT_ORIGIN",
              "signer": { "signerId", "keyId", "algorithm", "publicKey": "<lower-case hex>" },
              "target": record-target | assessment-target }
record-target     = { "kind": "WALLPRINT_RECORD", "wallprintVersion", "recordId",
                      "canonicalization": "RFC8785", "digestAlgorithm": "SHA-256", "digest": "<hex64>" }
assessment-target = { "kind": "WALLPRINT_ASSESSMENT", "wallprintVersion", "bundleDigest": "<hex64>",
                      "focalAssertionId", "assessment": <the AssessmentRecord, exactly as a record holds it> }
```

Every value is a string, boolean or null (no JSON numbers, as everywhere in WallPrint). Unknown fields are refused, never
dropped. The record target is exactly the identity a receipt carries (`recordId`, `wallprintVersion`, `canonicalization`,
`digestAlgorithm`, `digest`), which is why the receipt can stay unsigned.

| Field | Security purpose |
| --- | --- |
| `type` | rejects a signed object of another kind presented as an attestation |
| envelope `attestationVersion` | a parse selector only, so an unsupported version is reported before its grammar is read; it must equal the signed twin |
| `statement.attestationVersion` | signed: a statement cannot be re-read under another format version |
| `purpose` | signed: separates the three meanings; selects the domain tag; a purpose edit invalidates the signature |
| `signer.signerId`, `signer.keyId` | signed: the statement names who it says signed it and with which key, so the claimed binding is part of what was signed |
| `signer.algorithm` | signed: algorithm confusion is closed; the verifier takes the algorithm from signed data and compares it with the registry's, never from an unsigned header |
| `signer.publicKey` | signed: closes duplicate-signature-key-selection (a signature cannot be re-presented under another key that also verifies it); lets an unknown key be checked without a registry |
| `target.wallprintVersion` | signed: a statement made under 0.2 is not silently relabelled 0.1, and replay across versions is a target mismatch |
| record target fields | the exact digest and record identity published; `canonicalization` and `digestAlgorithm` stop a digest of another construction passing as this one |
| assessment target `bundleDigest`, `focalAssertionId` | the evidence context that gives the assessment's id references meaning (fact 1) |
| assessment target `assessment` | the whole assessment, so what is signed is what is read (no blind signing of a digest); the assessor's own `assessedAt` is inside it |
| `signature` | the only unsigned field of the envelope, and it is the signature itself |

**No timestamp, and why.** There is no `signedAt`. A signer-supplied time is signer-asserted and costs nothing to forge;
a compromised key could backdate it to before its compromise, which would defeat the one use a time would have (judging a key's
status "at signing"). A trusted timestamp needs a time-stamping or transparency service, which is online infrastructure this
design avoids. The only instant in an attestation is the assessor's `assessedAt`, inside the signed assessment, signer-asserted and
reported as such. Ordering and "when" are expressed by **registry versions**, which are totally ordered without a clock (section 11).

**The exact signed bytes.**

```text
signed bytes = UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))
```

| Purpose | Domain tag |
| --- | --- |
| `RECORD_PUBLICATION` | `walletwall.wallprint.attestation/0.1/record-publication` |
| `ASSESSMENT_ORIGIN` | `walletwall.wallprint.attestation/0.1/assessment-origin` |
| `ISSUER_ASSESSMENT_ORIGIN` | `walletwall.wallprint.attestation/0.1/issuer-assessment-origin` |

The tag names the product, the contract, the format version and the purpose. It is a closed table of ASCII strings with no
`0x00`, and canonical JSON escapes control characters, so the first `0x00` is the one boundary: there is no concatenation of
variable strings to be ambiguous. The preimage is not JSON (it starts with a letter and contains a `0x00`), so a signature over
it is never a signature over a JSON-signing protocol's input. A raw digest is never signed: the digest is a field inside a
statement that names its purpose, version, signer and canonicalization. `signed-bytes` examples with exact preimages are in the
vector file (`signedBytes.preimage`). The canonicalizer is the engine's RFC 8785 serializer (`canonical.ts`, numbers refused).

**Digests used.** The attestation address is `evidenceDigest(envelope)` and the assessment target key is
`evidenceDigest(target)`: SHA-256 over RFC 8785, the existing WWEP protocol digest, through the existing function, so no new
SHA-256 computation site is created (`security/integrity-policy.json`, `integrity-policy.test.ts`). Neither digest is ever signed.

**Limits.** An envelope is at most 16 KiB when read from text; a registry snapshot at most 256 KiB and a verification set at
most 256 attestations (publication and set limits: the pure verifier takes parsed values); nesting at most 16
(`ATTESTATION_LIMITS`). Text input is read with the same strict JSON reader as the assessor import boundary
(repeated key, byte-order mark, deep nesting and malformed UTF-8 refused; a prototype key refused).

### 7.1 Multiplicity and duplicates

- One target may have many attestations, by different signers, different keys and different purposes. They are separate
  statements. **There is no count, score, quorum or "majority"**, and the verifier returns none (`signature count != trust`).
- The same signer, same key (algorithm and material), same purpose and same target is one attestation. Two such envelopes are
  a duplicate even when their bytes differ: Ed25519 signing is deterministic per RFC 8032 but a signing implementation need not
  be (the Web Crypto implementation in Safari produces randomized signatures, per MDN's compatibility data), so equality of bytes
  cannot define "the same". **Only VALID signatures are ever duplicates of each other**: of several valid ones the first by
  deterministic order is the attestation and the rest are reported with `DUPLICATE_OF_EARLIER_ATTESTATION` and contribute
  nothing; an invalid or unchecked twin never displaces a genuine attestation, however its digest sorts (found by review and
  pinned by a test). Byte-identical repeats are idempotent in the store; differing bytes under the same duplicate key are refused at publication.
- One signer with several keys, or several algorithms, produces several independent attestations (a hybrid policy is a consumer
  requirement over them, section 14), never one object with summed trust.
- **Replacement** does not exist: a signer who wants to supersede an attestation uses a new key (rotation); the old attestation
  stays inspectable. Per-attestation withdrawal is deferred.
- Ordering is deterministic: purpose, signer id, key id, attestation digest, all ordinal; an unparsable input sorts last in input order.
- A key may appear under one signer only, and an assessor id under one signer only (case-folded), so one signer cannot be
  pretending to be many assessors *within the registry*. A signer that signs as unregistered ids is `KEY_ONLY` each time, and
  nothing can stop one party holding several unregistered keys; consumers must never count assessors as independent parties
  (`WALLPRINT.md`, Known limitations).

## 8. The signing-key registry

**Separate from the evidence registry, on purpose.** Every WallPrint record pins `versions.registryDigest`, replay refuses a
different registry (`MISSING_REGISTRY_VERSION`), and the registry is bundled into the shipped runtime. Placing keys in it would
make every rotation or revocation change every later record's replay outcome and the shipped bundle, MCPB and Claude Directory
payload. The signing-key registry is a different object with a different life: versioned and static, outside the runtime, changing
without replay or release consequences. It *refers to* evidence-registry authority ids (`issuer:circle`) and never changes them.

**Format** (`key-registry.ts`; every field is bound by the snapshot's digest):

```text
snapshot = { "type": "walletwall.wallprint.key-registry", "formatVersion": "0.1",
             "keyRegistryVersion": "<decimal, 1, 2, 3 ...>",
             "previous": null | { "version", "digest" },
             "signers": [ signer, ... ],            // strictly ordered by signerId
             "digest": "<SHA-256 over RFC 8785 of the snapshot without digest>" }
signer   = { "signerId", "kind", "authorityId": null | "issuer:..." | "protocol:...",
             "assessorIds": [ ... ],                // strictly ordered
             "binding": { "method", "publisher", "url", "locator", "retrievedAt" },
             "keys": [ key, ... ] }                 // strictly ordered by keyId
key      = { "keyId", "algorithm", "publicKey", "purposes": [ ... ],
             "status", "addedIn", "statusFrom", "successor", "retainedBefore" }
```

| Property the design requires | Where it lives |
| --- | --- |
| explicit signer identity | `signerId`, a lower-case token; never a display name |
| explicit key id, public key, algorithm | the key entry; a key id and a public key each appear once in a snapshot |
| purpose and role scope | `purposes` (a subset of what the signer's kind allows); `kind`; `assessorIds`; `authorityId` |
| status | `status` and `statusFrom` (the version in which it took effect), `successor`, `retainedBefore` |
| provenance, version, digest | `keyRegistryVersion`, `previous`, `digest`; `binding.method` and its evidence |
| deterministic and historical lookup | a snapshot is immutable; lookup is by key id in one named snapshot |
| validity interval | **none in instants.** Versions are the clock; `retrievedAt` is binding evidence, not a validity bound |

**Rules a snapshot must satisfy** (each a fixed finding code in `keyRegistrySnapshotFindings`): signers, keys, assessor ids and
purposes strictly ordered; key ids and public keys unique; supported-algorithm key material admitted (section 13); at most one
`WALLETWALL_PUBLISHER`; one signer per `authorityId`; an `ISSUER_AUTHORITY` lists exactly its authority id and its binding method
is `ISSUER_PUBLICATION` with a URL; an `EXTERNAL_ASSESSOR`'s ids may not read as WalletWall or WallPrint or equal a registry or engine
authority (the 0.2 admission rules); an assessor id belongs to one signer (case-folded); a `WALLETWALL_PUBLISHER` has
`GOVERNANCE_DECLARATION` and no external evidence, an `EXTERNAL_ASSESSOR` has `ASSESSOR_PUBLICATION` with full evidence; `ACTIVE` has `statusFrom == addedIn`; `SUPERSEDED` names a successor in the same
signer and no other status does; only `REVOKED` and `COMPROMISED` state `retainedBefore`.

**Chain rules** (`verifyKeyRegistryChain`): versions are `1..N`, consecutive; each snapshot carries its digest and names the previous
snapshot's digest; and each version **only appends**. A signer, its kind, authority id, assessor ids and binding never change; a key's
id, algorithm, public key, purposes and `addedIn` never change; a new key enters `ACTIVE` in the version that adds it; a status changes
only along the table below, in the version that makes the change, and a settled status is never rewritten; a finding of compromise may
narrow what a revocation retained and never widen it. A later version therefore cannot rewrite what an earlier snapshot said, and a
historical lookup under version N is the same bytes for ever.

**Binding methods** (strongest evidence first): `ISSUER_PUBLICATION` (the issuer's own publication names the key; required for an
issuer signer), `ASSESSOR_PUBLICATION` (the assessor's own publication names the key; required for an external assessor),
`GOVERNANCE_DECLARATION` (WalletWall's own key, no external evidence). There is no weaker method: a key without a trust path from
its signer's published identity is not registered (section 6.2).

**Who controls it.** The registry is WalletWall governance data, the same root the evidence registry rests on. Its source is
reviewed code in this repository (CODEOWNERS applies), and its published form would be immutable static files
(`keys/<version>.json` and an append-only `keys/index.json`, section 16). Adding a signer needs binding evidence and review.
Rotation, revocation and compromise are version appends by governance. No signer can edit its own entry.

**What the registry's integrity does and does not rest on.** The chain's hash links make a rewritten past detectable by anyone
holding an earlier head (`trustAnchor`: the chain must contain the anchored version with the anchored digest, so a rollback or a
substituted history is refused). **An anchor protects the past, not the future:** versions appended after the anchor are accepted
on the strength of the channel they arrive over, so a party that controls the channel can append a valid version binding its own key.
Closing that needs either the verifier pinning the head and updating it deliberately, a governance signature on each version (a
later lane that needs key custody), or an independent public mirror compared by the verifier. Until then the registry's
authenticity is the repository's and the origin's. The result says so: an unanchored chain carries `KEY_REGISTRY_UNANCHORED`.

## 9. Rotation

Designed before implementation, and independent of any online key infrastructure.

1. **A new key is introduced** by a registry version that adds it to its signer, `ACTIVE`, with `addedIn` set to that version.
   For an issuer or an assessor that publishes keys, the binding evidence points at the publication that names the new key.
2. **The previous key does not sign the new key.** The registry holds no signature. Requiring a predecessor's signature would make
   a lost key block rotation and would add a second authentication surface. Governance (and, where it exists, the signer's own
   publication) is the authority for a new key.
3. **The old key is marked** `SUPERSEDED` (replaced, naming its successor in the same signer) or `RETIRED` (no replacement) in the
   version that introduces its successor or ends its use. Its past acceptances keep their standing.
4. **If the old key is unavailable** nothing changes: rotation needs nothing from it. If it is believed exposed, section 10.
5. **Several keys may be `ACTIVE` at once**, per signer and per purpose, so overlap and algorithm migration need no flag day.
6. **Keys are purpose-scoped**: a key lists the purposes it may sign, within what its signer's kind allows.
7. **Historical verification knows which registry version applied** from the acceptance ledger (section 11), not from anything the
   signer says.

## 10. Revocation and compromise

| Status | Means | A new attestation under it | An earlier accepted attestation |
| --- | --- | --- | --- |
| `ACTIVE` | in use | may be accepted | standing held (nothing about it depends on when it was accepted) |
| `RETIRED` | no longer used, no replacement | refused at the gate; `KEY_RETIRED` | held only inside an anchored ledger prefix; otherwise withdrawn |
| `SUPERSEDED` | replaced by a named successor | refused at the gate; `KEY_SUPERSEDED` | held only inside an anchored ledger prefix; otherwise withdrawn |
| `REVOKED` | governance withdrew the binding (mis-issued, entity change, misuse) | refused | held only inside an anchored ledger prefix and for acceptances before `retainedBefore`; otherwise withdrawn |
| `COMPROMISED` | the private key is believed or known exposed | refused | held only inside an anchored ledger prefix and for acceptances before `retainedBefore`; `null` retains nothing |

**The critical distinction:** a valid historical signature from a later-compromised key remains **cryptographically valid**.
Whether it remains **relied upon** is a policy question the registry answers explicitly and the result reports separately:
`signature.status` is untouched, `current.keyStatus` says what the key is now, and `current.standing` is `HELD` or `WITHDRAWN`.
The policy is data, not code: `retainedBefore` is the first registry version whose acceptances are *not* retained
(`addedIn < retainedBefore <= statusFrom`, or `null` for "nothing"). An acceptance under version `a` is retained when
`addedIn <= a < retainedBefore`. Compromise can only narrow what revocation retained.

**An attestation under a key that is no longer `ACTIVE` and has no acceptance record is `WITHDRAWN`** (`WITHDRAWN_ACCEPTANCE_UNKNOWN`):
nothing shows it predates the status change, so none is assumed. **So is one whose ledger entry lies after the ledger prefix the verifier
holds an anchor for** (`WITHDRAWN_ACCEPTANCE_UNANCHORED`, and a ledger with no anchor covers nothing): the key registry and the ledger
are separate, unsigned logs with no cross-ordering, so an entry appended after the verifier's anchor, naming an old registry version, could
have been written after the status change. A retired or superseded key is no safer than a compromised one in this respect: it can be
stolen later, and a forged statement under it would carry an old version just the same. For a key that is not `ACTIVE`, retained standing
is therefore granted only inside an anchored prefix (and, for `REVOKED` and `COMPROMISED`, inside `retainedBefore`); a verifier advances
its anchor deliberately. This is what limits a former key's ability to backdate. (Found by review, in two rounds: first an attack that
appended a post-compromise statement to a ledger behind an old anchor, then the same attack through a superseded key, which the first
fix had left out; both are pinned by tests and vectors `10f`, `09c` and `14b`.) The designed hardening that would lift the restriction,
a registry snapshot committing the ledger head at its publication so later entries must name at least that version, was a follow-up here;
section 23 realises its signed form as a checkpoint that commits both heads together, and feeds the anchored prefix rule above
with anchors a governance key signed instead of anchors the caller merely holds.

**Revocation latency is real.** A verifier knows only the chain it holds. There is no online status check, by design.
`current` is "the head of the chain you were given", and the result states which version that was.

## 11. Historical verification and replay

**The acceptance ledger.** When the store accepts an attestation it appends an entry to an append-only, hash-chained **acceptance
ledger** (`acceptance-ledger.ts`): `{ seq, attestationDigest, acceptedUnder: { keyRegistryVersion, keyRegistryDigest },
previousEntryDigest, entryDigest }`. The `acceptedUnder` pair is the "historical trust decision": the registry version and digest the
store judged the key under. It is recorded by the store, never taken from the signer (the statement has no registry field, so a key
holder cannot choose the context it is judged in). The acceptance gate (section 16) admits an attestation only when, under the
current head, the signature is valid, the target matches and the key is `ACTIVE` and authorized, and pins that head (a claim the verifier
cannot check from the ledger alone, which is why section 10 restricts what the entry of a key that is no longer `ACTIVE` can earn).

**The pin is bound to one attestation, in a sequence a rewrite has to break, and the verifier reads it from its own trusted channel.**
The verifier looks a pin up *by attestation digest* in a ledger it obtained from the same trusted channel as the key registry; there is
no parameter by which a presenter can supply a pin, so a statement signed today with a later-compromised key has no entry and is
`NOT_PINNED`. Entries chain by digest (an edit, reorder or drop breaks every later entry); registry versions never decrease along the
ledger (an entry cannot be back-dated below an earlier one without re-chaining what follows); an attestation is accepted at most once;
and a caller-held `anchor` (a sequence number and entry digest) detects a ledger rewritten behind it (`ACCEPTANCE_ANCHOR_MISMATCH`).
A ledger that fails any rule is not read (`ACCEPTANCE_INDEX_INVALID`). **What this does not give:** nothing signs the ledger, so a
party that controls the store can write a whole new ledger or append entries after any anchor, exactly as for the registry chain
(section 8); the ledger's authenticity is the channel's and the anchor's. **The ledger and the registry chain are two separate logs with no
cross-ordering**: the ledger cannot prove that an entry naming registry version N was written before version N+1 existed. The
monotone-version rule stops back-dating *within* the ledger only. So for a key that is no longer `ACTIVE` the entry's pin
is trusted only if the entry lies inside a ledger prefix the verifier already holds an anchor for (section 10); the registry's retained
window then applies to what the verifier had already seen, and entries appended after the anchor wait for a deliberate anchor advance. A
compromised key can still get *new* attestations accepted in the window between its compromise and the registry version that records it,
which is why compromise is bounded by `retainedBefore` and not by the signer's honesty. An attestation that arrives without a ledger
entry, from anywhere, is judged on present-day state only.

**Two evaluations, reported together.** `atAcceptance` evaluates the key under the pinned snapshot (is it known, bound, authorized
for the purpose, and `ACTIVE`). `current` evaluates it under the head of the supplied chain (what is its status now, and what
standing does this acceptance keep). The classification `origin` requires: signature valid, target not mismatched, and either
(pinned) `atAcceptance` bound and authorized and `current.standing` not withdrawn, or (not pinned) the current evaluation
bound, authorized and held, with `originBasis: CURRENT` and the limitation `ACCEPTANCE_NOT_PINNED`.

**What replay needs** (no private key, no signer, no network):

| Input | Needed for |
| --- | --- |
| the envelope (statement and signature) | signature validity: reproducible for ever with no registry |
| the record (or the receipt's identity, for a record target) | target comparison |
| the key registry chain, versions `1..N` | binding, authorization and status |
| the acceptance ledger | the historical decision (the entry naming this attestation) |
| optionally a registry anchor and a ledger anchor | detecting rollback, rewrite and substitution |
| the verifier implementation | nothing else; the algorithm is named in the statement |

| State | When |
| --- | --- |
| **reproducible** | all inputs present: the signature checked, the chain valid and consistent with the pin, the record valid |
| **unavailable** | a required historical input is missing: no chain (`KEY_REGISTRY_NOT_SUPPLIED`), the pinned version absent (`KEY_REGISTRY_VERSION_MISSING`), no pin (`atAcceptance` unavailable), no record (`TARGET_NOT_COMPARED`). Never defaulted to present-day state |
| **invalid** | a bad signature; a target mismatch; a chain that is not a valid chain (`KEY_REGISTRY_CHAIN_INVALID`); a chain that does not contain the anchor (`KEY_REGISTRY_ANCHOR_MISMATCH`); a pin whose digest is not the chain's (`KEY_REGISTRY_DIGEST_MISMATCH`, a substituted registry) |
| **unknown** | the key is not in the registry (`KEY_UNKNOWN`); the algorithm is unsupported (`NOT_CHECKED`) |

`UNREPLAYABLE != INCORRECT` applies unchanged: an unavailable input is not a finding about the attestation. The acceptance-time
result is a pure function of the pinned snapshot: appending later versions, or truncating the chain after the pin, does not change
it (tested for every pinned vector).

## 12. The verification result

`verifyAttestation(envelope, { record, keyRegistry, trustAnchor, acceptance: { ledger, anchor } })` never throws and returns separate dimensions.
There is no `verified` flag.

| Dimension | Values | Needs |
| --- | --- | --- |
| `parse` | `PARSED`, `MALFORMED`, `UNSUPPORTED_VERSION` | the envelope |
| `signature` | `VALID`, `INVALID`, `NOT_CHECKED` (+ reasons) | the envelope only |
| `target` | `MATCHED`, `MISMATCHED`, `NOT_COMPARED` (+ reasons) | the record |
| `acceptance` | `PINNED`, `NOT_PINNED` | the ledger entry naming this attestation |
| `atAcceptance`, `current` | `evaluation` (`EVALUATED`, `UNAVAILABLE`), `key` (`KNOWN`, `UNKNOWN`, `MATERIAL_MISMATCH`), `keyStatus`, `signerKind`, `bindingMethod`, `binding` (`BOUND`, `UNBOUND`, `NOT_EVALUATED`), `authorization`, `standing` (`HELD`, `WITHDRAWN`, `NOT_EVALUATED`), `reasons` | the chain; the ledger entry for `atAcceptance` |
| `origin`, `originBasis` | `NONE`, `KEY_ONLY`, `BOUND_ASSESSOR`, `BOUND_ISSUER_AUTHORITY`, `BOUND_WALLETWALL_PUBLISHER`; basis `ACCEPTANCE`, `CURRENT`, `NONE` | all of the above |
| `limitations` | sorted codes the reader must not assume past | |
| `establishes`, `doesNotEstablish` | fixed sentences | |

The limitation codes, each a thing the reader must not assume: `ACCEPTANCE_NOT_PINNED` (no ledger entry names this attestation, so no
historical decision was made); `ACCEPTANCE_UNANCHORED` (the ledger is only self-consistent); `ACCEPTANCE_ANCHOR_MISMATCH` (the ledger is not
the one the caller's anchor names, so no pin was taken); `ACCEPTANCE_INDEX_INVALID` (the ledger failed its own rules, so no pin was taken);
`DUPLICATE_OF_EARLIER_ATTESTATION` (the same purpose, signer, key and target already counted once); `KEY_NOT_ACTIVE_NOW` (the key's
status in the head you were given is not `ACTIVE`); `KEY_REGISTRY_UNANCHORED` (the chain is only self-consistent); `RECORD_INVALID`
(the record supplied did not validate, so nothing was compared with it); `TARGET_NOT_COMPARED` (no record was supplied).

The origin levels, in the words the resolver prints (`ORIGIN_STATEMENTS`; none uses a verdict term):

- `NONE`: no signature stands for this target.
- `KEY_ONLY`: one public key signed this statement; nothing in the key registry binds that key to a named party for this purpose.
- `BOUND_ASSESSOR`: a key bound to the signer that lists this assessor identity signed this assessment. This authenticates the origin of the attributed statement; it does not show the statement is correct.
- `BOUND_ISSUER_AUTHORITY`: as above for the registry authority the assessment is attributed to; it does not show the issuer endorses WalletWall or that the statement is correct.
- `BOUND_WALLETWALL_PUBLISHER`: a WalletWall publication key signed that WalletWall published exactly this record digest; it authenticates the act of publication and is not a certification of the record's claims or of any external assessment in it.

`doesNotEstablish` is fixed: factual truth of the attributed statement; that the signer is independent, authoritative or correct;
that any other assessment in the record is endorsed; that WalletWall certifies, guarantees or endorses the record; that the key is
relied upon today; independent corroboration; safety; solvency; regulatory compliance; investment merit.

**Firewalls the verifier enforces** (each has vectors): a signature never feeds a WWEP state; an `ISSUER` result needs all four
conditions of section 6.3; a registered signer's key authorized for one purpose is `KEY_ONLY` for another; an assessor key signing an
`ISSUER`-role assessment is a target mismatch; a key bound to another authority is `KEY_ONLY` for this one; a key registered under one
algorithm presented under another is `MATERIAL_MISMATCH`; a WalletWall-generated assessment is not attestable.

## 13. Algorithm policy

| Candidate | Node `crypto` | Browser Web Crypto (verify) | Signing | Key / signature | Notes |
| --- | --- | --- | --- | --- | --- |
| **Ed25519** (RFC 8032, pure) | yes (since 16.17 for Web Crypto too) | Chrome 137, Firefox 129, Safari 17 | deterministic in RFC 8032; Safari's Web Crypto signs randomized | 32 B / 64 B | widely deployed; no dependency |
| ECDSA P-256 | yes | every browser | randomized unless RFC 6979; DER and raw encodings; low-S malleability | 33 or 65 B / 64 B | best KMS and HSM support; a non-reproducible signing step makes byte-for-byte vectors impossible |
| secp256k1 / wallet signatures | via OpenSSL | not in Web Crypto | randomized or RFC 6979 | 33 B / 64 B | a candidate future *binding* path (a key proven by an on-chain address), not a signature algorithm for this format |
| RSA-PSS | yes | yes | randomized | 256+ B | large and no advantage here |
| ML-DSA-44 / 65 / 87 (FIPS 204) | Node 24.16 with OpenSSL 3.5.6: yes, measured (signatures 2420, 3309, 4627 bytes) | none listed for sign, verify or import in MDN's browser-compat-data on this lane's date; ML-KEM key encapsulation is listed experimental (Chrome 155, Firefox preview, Safari none) | randomized or deterministic variants | 1312 / 1952 / 2592 B keys | standardized, but unusable for browser verification today |
| SLH-DSA (FIPS 205) | newer OpenSSL | none | | 32 B keys; signatures about 8 KB or more | conservative, large |

**Decision: Ed25519, fixed for attestation format 0.1, named inside the signed statement** (the token `ED25519`).

- It meets every runtime requirement without a package: Node's `node:crypto` and the browser's Web Crypto both verify it, and the
  prototype's only cryptographic import is `createPublicKey` and `verify`. No dependency, no lockfile change.
- Its signatures are deterministic in a conforming signer, so a vector file regenerates byte for byte and a CI check can hold it.
- **The platform primitives are not enough, and this lane measured why.** On Node 24.16 (OpenSSL 3.5) and in Web Crypto, a signature
  made with the identity point's encoding as the public key verifies for *any* message. A verifier that does not admit the key would let
  anyone "sign" anything. The verifier admits a key only if it is a canonical encoding of an on-curve point with no small-order component
  and no torsion at all (`ed25519KeyProblem`: `KEY_NON_CANONICAL`, `KEY_NOT_ON_CURVE`, `KEY_SMALL_ORDER`, `KEY_TORSION`). The check is about
  70 lines of arbitrary-precision arithmetic over public values only (no signing, no secrets); it is tested against RFC 8032 known answers, all
  eight small-order encodings with their sign variants, the non-canonical encodings, and a mixed-order key built by an independent
  implementation. A registry rejects an inadmissible key at validation.
- **A signature is checked strictly too.** Its R is held to the same standard as a key (canonical, on the curve, no small-order component, no
  torsion) and its S must be below the group order, before the platform primitive is asked. An honest signature always passes (R = [r]B is
  torsion-free), so this costs nothing, and it closes the one cofactored/cofactorless disagreement key admission alone leaves open: a key holder
  crafting an R with a torsion component, which a lax verifier would accept and a strict one would not (found by review; pinned by a test).
  A browser binding must run the same admission, which is pure and dependency-free, around Web Crypto's `verify`.
- A runtime that cannot run the primitive (an Ed25519-less provider, or a browser older than the versions above) reports `NOT_CHECKED` with
  `RUNTIME_UNSUPPORTED`, never `VALID` and never `INVALID`; the primitive is injectable so this is tested.
- **Algorithm agility, bounded.** The algorithm is a signed token in the statement and a field of the registered key; `SUPPORTED_ALGORITHMS`
  is a closed table. A statement naming an algorithm this verifier does not support is `NOT_CHECKED` (`ALGORITHM_UNSUPPORTED`): neither valid nor
  invalid. A new algorithm is additive and arrives with its own vectors and a format version if sizes change. There is no negotiation, no
  `none`, and no algorithm read from unsigned data.
- Not a generic crypto framework: one algorithm, one encoding (lower-case hex), one admission procedure.

## 14. The post-quantum boundary

| Option | Verdict |
| --- | --- |
| Classical now, PQ migration later | **Chosen.** |
| Classical plus PQ dual attestation | **Deferred, and expressible.** Two independent attestations by two keys of one signer over the same target; a consumer that wants hybrid assurance requires both. A composite single-object signature is a later attestation version, not a field added now. |
| PQ-only | **Rejected for now.** No browser can verify ML-DSA through Web Crypto today (section 13); a PQ-only design would leave the resolver unable to check anything. |
| Algorithm-agile envelope with PQ deferred | **Chosen**, as bounded above. |

ML-DSA is standardized (FIPS 204) and present in this repository's Node, but a research verifier or an experimental Web Crypto
flag is not production readiness, and nothing here claims it. The criteria to un-defer: ML-DSA verification in Node LTS and in the
evergreen browsers' Web Crypto without a flag; a passing vector suite from an independent source; an HSM or KMS path for signing; and a
size review of the envelope and registry limits (an ML-DSA-65 attestation is about 10 KB of hex).

**Coexistence.** A future PQ attestation does not invalidate a historical Ed25519 one: each is judged alone, its algorithm is signed, and
its key is in the registry under its own algorithm. The long-term risk is real and not solved here: an Ed25519 attestation of a long-lived
record is forgeable by a future quantum adversary. The mitigations are structural: attestations authenticate origin, not truth, so a forged
one forges "who published this digest" for a digest that must still match a real record; the acceptance ledger and the repository history bound
when an attestation existed; and a PQ re-attestation of historical targets can be added without touching the old ones.

## 15. Interaction with receipts, references, the resolver, import, lifecycle

- **Receipt: unsigned and separate** (option A), with detached attestations adjacent to its presentation (option B) and no new receipt
  field (option C rejected). A record attestation's target is exactly the receipt's identity, so a receipt can name what to look for. Existing
  receipts for every historical record stay valid.
- **Portable reference: unchanged.** It still identifies a record, a digest, a version and an optional section. It carries no signature
  and a QR code does not become an authentication token. Resolution *may additionally discover* attestations by the record's digest and,
  for assessments, by target key. A `target=attestations` section would change the closed target table, which is a reference version change,
  deferred.
- **Assessor import** (`assessmentImportVersion` 0.1) is unchanged: an attestation is a separate artifact the importer never sees, so no
  signature field enters the import envelope, which keeps refusing one.
- **Admission rules** (`ADMISSION_RULES`) are unchanged and unrelated to authentication: they decide what may be attributed to an
  external assessor at all, and still do (a registry entry for an assessor id is held to the 0.2 reserved-identity rules too).
- **Lifecycle.** Attestations never mutate a committed record. A corrected or superseding record has its own digest and needs its own
  record attestations; a withdrawn record keeps its attestations, and the lifecycle standing is shown separately. Withdrawal does not erase a
  signature or history.
- **WWEP.** A signature changes no evidence state, authority, freshness, finality, corroboration or readiness.

**The public resolver would show** (the contract for a later implementation; nothing is built in this lane). Never a generic green
"Verified" badge, a check mark, the words "verified", "trusted" or "certified" without the dimension named, a signature count, or an ordering
that ranks signers. Separate, equally weighted rows, each from one field of the result:

1. **Record digest:** the existing result (unchanged).
2. **Signature:** "Signature valid for key `<keyId>` (Ed25519)", "Signature invalid", or "Not checked in this browser".
3. **Signer binding:** "Key `<keyId>` is registered to `<signerId>` for `<purpose>` under key registry version N (binding method: …)", or "This key is not registered for this purpose. It signed this statement; nothing binds it to a named party."
4. **Key standing:** "Status when accepted (registry version N): ACTIVE. Status in the registry head you were given (version M): COMPROMISED since version K. This acceptance is retained / withdrawn." A non-active key is stated, not hidden.
5. **The statement:** the assessor's actual statement, verbatim, in the existing attribution voice ("Assessor X asserted …"), in its own section.

Then the origin sentence for the level reached, and the fixed `doesNotEstablish` line. An absent attestation index reads "No attestations are
published for this record at this resolver", never "unsigned" as a fault, because absence is not failure.

## 16. Publication and storage (design; nothing is published by this lane)

Static, content-addressed, no database, no write endpoint, publication deliberate:

```text
attestations/records/<recordDigest>/index.json              discovery: attestation digests for one record, sorted
attestations/records/<recordDigest>/<attestationDigest>.json immutable envelope
attestations/assessments/<targetKey>/index.json            discovery: attestation digests for one assessment target, sorted
attestations/assessments/<targetKey>/<attestationDigest>.json
attestations/ledger.json                                   the acceptance ledger (sharded by registry version if it grows)
keys/index.json                                            append-only list of { keyRegistryVersion, digest }
keys/<keyRegistryVersion>.json                             immutable snapshot
checkpoints/<checkpointDigest>.json                        immutable signed trust checkpoint (section 23)
checkpoints/index.json                                     discovery: checkpoint digests with their committed counts, sorted
```

A per-target `index.json` is only a discovery list of attestation digests: it carries no authority, and an attestation it lists is
read, and its envelope name recomputed, like any other. **The acceptance decision lives only in the ledger** (section 11), whose entries
are `{ seq, attestationDigest, acceptedUnder: { keyRegistryVersion, keyRegistryDigest }, previousEntryDigest, entryDigest }`: chained,
carrying no instant (publication time is the repository's history), versions never decreasing, one entry per attestation. Rules: an
envelope's name is `evidenceDigest(envelope)` and the reader recomputes it; identical bytes are idempotent; different bytes under one
duplicate key (section 7.1) are a conflict, never an overwrite; the ledger and the key registry only extend; the acceptance gate
(section 11) must pass before a ledger entry is written; the same privacy gate as the disclosure artifacts runs on every envelope; sizes
are bounded as in section 7. The directory split keeps the two address spaces apart.

**Limits that remain:** the discovery lists and the ledger are unsigned, so a store controller could withhold an attestation (absence is
not evidence) or write a new ledger. The repository's history, the registry and ledger anchors, and the rules that an attestation with no
entry, or with an entry outside the held anchor's prefix, is `WITHDRAWN` for a key that is no longer `ACTIVE` narrow what that can do; they do not remove it,
because the two logs have no cross-ordering (section 11). A signed checkpoint over both heads, specified in section 23, narrows this further
for a verifier that holds a governance trust root; it is not published by this lane.
An attestation first accepted while its key was unregistered stays accepted under that earlier version (a late binding does not upgrade
it); the signer's remedy is a new attestation by a registered key, since an identical re-signature is the same attestation.

## 17. Threat model

| # | Threat | Prevented by | Remains possible |
| --- | --- | --- | --- |
| T1 | Forged signature | Ed25519 verification over the exact bytes; key admission closes small-order and torsion keys | a party holding the private key signs what it likes |
| T2 | Wrong key (statement names key K, key material is another) | the registry's algorithm and public key are compared with the signed statement (`MATERIAL_MISMATCH`); the key is inside the signed bytes | none for a registered key |
| T3 | Valid key, wrong purpose | per-purpose grants; signer kind per purpose; domain tags | a key granted a purpose can sign anything within it |
| T4 | Valid key, wrong issuer | `authorityId` equality; all four issuer conditions; role and purpose must agree | an issuer key whose binding evidence was wrong (governance error) |
| T5 | Retired or superseded key | gate refuses it; `atAcceptance` shows `KEY_RETIRED` / `KEY_SUPERSEDED`; standing is held only for an entry inside an anchored ledger prefix (vectors `09c`, `14b`), so a stolen old key cannot append a post-retirement statement behind the anchor | an advanced anchor may already contain a back-dated entry; a verifier with no anchor holds nothing for a former key |
| T6 | Compromised or revoked key | `current.standing` withdraws acceptances outside `retainedBefore`; unpinned attestations are withdrawn | a window between compromise and the registry version that records it; the signature stays valid |
| T7 | Registry rollback | `trustAnchor` requires the anchored version and digest in the chain | a verifier with no anchor, or a stale one, sees an older head (revocation latency) |
| T8 | Registry substitution | hash chain; digest in the ledger entry; anchor; append-only evolution rules | an attacker who controls the channel can append a valid version after the anchor (section 8) |
| T9 | Replay across types (record vs assessment vs issuer) | three tags; purpose and target kind inside the statement; purpose/role agreement | none known |
| T10 | Replay across versions | `wallprintVersion` and `attestationVersion` inside the statement; a mismatch is a target mismatch | an assessor must sign once per version a statement should hold under |
| T11 | Digest substitution | the target is compared with the record in hand; `canonicalization` and `digestAlgorithm` are signed | SHA-256 and RFC 8785 are assumed sound |
| T12 | Algorithm confusion; key confusion | algorithm signed and compared with the registry; closed table; unsupported is `NOT_CHECKED`; no `none` | a future algorithm needs its own admission procedure |
| T13 | Malformed key or signature | fixed length and shape checks before cryptography; strict JSON | none |
| T14 | Duplicate attestations; a forged twin that sorts first | duplicate key (purpose, signer, key, algorithm, material, target); only valid signatures are duplicates, so an invalid twin never displaces the genuine one; flagged; no count | a signer can mint many valid-looking signatures; none adds anything |
| T15 | Malicious assessor statement | authentication is not truth: the statement is recorded as stated and the evidence engine is untouched | a bound assessor can still be wrong or dishonest |
| T16 | One signer posing as many assessors | one key and one assessor id per signer in the registry; unregistered keys are `KEY_ONLY` | a party can hold several unregistered keys, so assessors are never counted as independent |
| T17 | Compromised WalletWall publishing key | revocation by registry version; the gate refuses a revoked key; unpinned attestations are withdrawn | until revoked, the key can publish false "WalletWall published D" statements for any D; the signed record must still exist to be believed |
| T18 | Backdating by a compromised key | no timestamp to forge; the pin is looked up by attestation digest in a hash-chained, monotone ledger and never supplied by the presenter; a statement with no entry, or an entry after the held anchor's prefix, is judged on present-day state and withdrawn if the key is | a store controller can write a new ledger or an advanced anchor's prefix may already contain a back-dated entry; a compromised key can get new attestations accepted before its compromise is recorded; the two logs have no cross-ordering |
| T19 | Compromised registry governance or channel | review, CODEOWNERS, anchor, a chain that cannot rewrite its past | a malicious valid extension; the trust root is WalletWall governance |
| T20 | Selective publication | none; absence is not failure | a store can omit an attestation |
| T21 | Look-alike names (`synthetic-circle`, `issuer-circle`) | binding is by key id, signer id and authority id, never a display name; assessor ids pass the 0.2 admission rules | none for registered keys |
| T22 | Signature malleability, implementation variance | the key and the signature's R are admitted only if canonical and torsion-free and S is below the group order, so cofactored and cofactorless verifiers agree; duplicates are keyed by (purpose, signer, key, target), not by bytes | a signer may produce differing valid encodings (randomized signing); treated as one attestation |
| T23 | Authentication read as truth | no `verified` flag; fixed sentences; `doesNotEstablish`; reserved assurance terms barred | a reader can still misread; UX must keep the rows apart |
| T24 | Quantum forgery of classical signatures | algorithm is signed; PQ coexistence designed | long-lived classical attestations are forgeable later (section 14) |
| T25 | Private key leakage in the repository | no signing code, no key, no secret in engine code or CI; tests pin it; synthetic seeds are public labels | a future operational lane must keep it so |
| T26 | Mix and match: a valid registry presented with a valid ledger from another history | the checkpoint commits both heads and both counts in one signed statement; the verifier compares the head at the committed position of each log and checks every committed entry's registry pin against the committed registry (section 23) | governance signing a pair it should not have signed |
| T27 | A checkpoint that names its own signing key | authorization is by an explicit governance trust root only; the root's key material is compared with the statement's, id for id; a key the checkpoint merely names authorizes nothing | a wrong root supplied through the verifier's own channel (the bootstrap) |
| T28 | Circular trust: the registry being checkpointed authorizing its checkpoint's signer | the trust root is a separate input; the registry's WalletWall publication key is not a governance key (vectors `cp-03c`) | the same party controlling both the registry channel and the verifier's root |
| T29 | Truncation, extension, reordering or rewriting of either log relative to a checkpoint | exact state by default; a shorter log, a different head at the committed position, a reordered, dropped or edited entry each have their own reason; an extension is refused unless asked for and is then reported as not covered | versions and entries after the committed heads are unsigned until a later checkpoint covers them |
| T30 | Rollback: an older checkpoint presented as current | an anchor the caller holds; the older state is reported `BEHIND_ANCHOR` from counts alone; it stays cryptographically valid and is never authenticated as current | a verifier with no anchor cannot tell old from new |
| T31 | A fork: a different history with the anchor's counts, or a later state that does not contain the anchored heads | `FORKED_FROM_ANCHOR` from heads and from the supplied logs' contents | equivocation: a key holder signs two internally consistent histories, which no single verifier can see without comparing them |
| T32 | Replay of a signature across purposes or objects | a checkpoint domain tag that is no attestation's tag and no prefix of one; the same preimage construction (vectors `cp-18a` to `cp-18c`) | none known |
| T33 | Back-dating after a compromise (T18, revisited) | the authenticated prefix (entries up to the committed count); an entry after it is `WITHDRAWN` for a key that is no longer `ACTIVE`; an entry appended since an anchor must name the anchored registry head or later (section 23.8) | a back-dated entry naming a registry version at or after the held anchor's head; governance signing over a ledger it has not reviewed (vector `cp-22b`) |
| T34 | A compromised governance key | the key is removed from the root the verifier supplies | checkpoints it signed before removal still verify under a root that still lists it; the root has no history or lifecycle in this lane (section 23.4) |
| T35 | A checkpoint read as certification of the records, attestations or assessors in the logs | no `verified` flag; fixed `doesNotEstablish`; the verifier changes no attestation's origin; a covered acceptance still earns only what its own dimensions earn | a reader can still misread; UX must keep the rows apart |
| T36 | Unsigned metadata, labels, timestamps or links riding on a checkpoint | a closed schema; an unknown field is refused, never dropped; no timestamp, no status | none |
| T37 | A fabricated or revived verification result used to mint anchors | `checkpointAnchors` accepts only a result the verifier itself returned; a copy, a hand-built object or JSON that crossed a boundary yields `null` (section 23.6) | a consumer that trusts a result without calling the verifier is trusting whoever supplied it |

## 18. Versioning

- **WallPrint stays `0.2`.** The record shape, canonical form, digest, receipt, reference grammar, lifecycle table and admission rules are unchanged,
  so no contract bump is justified. A change that put a signature field in a record would be a WallPrint version change and must say why a
  detached envelope cannot do.
- **`attestationVersion` `0.1`** versions the envelope and statement. A change to a field, a tag, a limit or the preimage is a new version; an
  attestation made under one version is never reinterpreted under another.
- **`formatVersion` `0.1` and `keyRegistryVersion`** version the registry's format and its content. Registry versions are decimal integers growing by exactly one.
- `verificationVersion` `0.1` versions the result shape. These are independent of each other and of WWEP, the import envelope and the reference version.

## 19. The prototype and the vectors

`verifyAttestation` and `verifyAttestations` are pure: no clock, no I/O, no randomness, no network, no signing. They are not imported by the MCP
server, tools or resources, are not in the shipped bundle, and are not wired into the resolver or the canvas. Modules:
`attestation-vocabulary.ts`, `attestation.ts`, `key-registry.ts`, `acceptance-ledger.ts`, `ed25519.ts`, `attestation-verify.ts`. Tests:
`attestation-ed25519.test.ts`, `attestation.test.ts`, `key-registry.test.ts`, `acceptance-ledger.test.ts`, `attestation-verify.test.ts`,
`attestation-isolation.test.ts`, `attestation-spec-doc.test.ts`; vectors by `npm run gen:wallprint-attestation-vectors` / `npm run verify:wallprint-attestation-vectors`.
The checkpoint modules, tests and vectors are listed in section 23.14.

**Every key in the vectors is a synthetic test key** whose private seed is a public ASCII label (`SYNTHETIC-NON-PRODUCTION-KEY-001` and so on), so
anyone can sign as it. The file says so, signing exists only in the test support, and a test pins that these keys appear in no shipped or published place.

| Required case | Vector id(s) |
| --- | --- |
| 1 valid signer, valid signature, authorized purpose | `01-walletwall-publication-valid`, `16-valid-issuer-attestation`, `17-valid-assessor-attestation` |
| 2 valid signature, unknown key | `02-valid-signature-unknown-key`, `20-key-label-says-circle` |
| 3 known key, wrong purpose | `03-known-key-wrong-purpose` |
| 4 issuer key bound to another issuer | `04-issuer-key-bound-to-another-issuer` |
| 5 invalid signature | `05-invalid-signature` |
| 6 target digest mismatch | `06-target-digest-mismatch` |
| 7 algorithm mismatch | `07a-algorithm-unsupported`, `07b-algorithm-differs-from-registry` |
| 8 malformed signature | `08a-malformed-signature-length`, `08b-malformed-signature-not-hex` |
| 9 retired key | `09a-retired-key-before-retirement`, `09b-retired-key-accepted-after-retirement`, `09c-retired-key-entry-after-the-held-anchor` |
| 10 revoked or compromised key | `10a` to `10f` (inside, outside and at the boundary of the retained window; no acceptance record; an entry after the held anchor) |
| 11 record attestation replayed as assessment attestation | `11a-…`, `11b-…` |
| 12 assessment attestation replayed against another policy | `12a-…`; across WallPrint versions: `12b-…` |
| 13 historical key valid under an old registry version | `13-historical-key-valid-under-old-registry-version` |
| 14 same key no longer current today | `13`, `14-assessor-key-superseded-today`, `14b-superseded-key-entry-after-the-held-anchor`, `10d` |
| 15 multiple signatures, deterministic ordering | the `set` section: five inputs, shuffled, one duplicate |
| extra | `18` issuer without record context; `19` assessor key on an issuer-role assessment; `22` WalletWall's own assessment; `23` substituted registry; `24` unanchored; `25` no acceptance record; an assessor-declared key is simply the unregistered case (`02`) |

## 20. Stop conditions, evaluated

| Condition | Result |
| --- | --- |
| key custody required | **not triggered.** Nothing signs in this repository; signing is a later lane |
| signing requires CI secrets | **not triggered.** No workflow change, no secret |
| issuer identity binding has no defensible trust root | **not triggered, with a caveat.** The root is WalletWall governance binding a key to an issuer's own publication; no issuer publishes a key today, so no issuer signer exists |
| browser or runtime crypto insufficient | **not triggered for Ed25519** (Web Crypto verify in the evergreen browsers named above; older ones report `NOT_CHECKED`); **triggered for PQ-only**, which is why PQ is deferred |
| needs a database or an online verification service | **not triggered.** Static files and a pure function |
| historical key state cannot be deterministically reconstructed | **not triggered.** It is a function of the chain and the ledger entry. The weak link is the unsigned ledger (section 16), stated |
| would change the WallPrint 0.2 digest or shape | **not triggered.** Detached |
| PQ maturity insufficient | **triggered for production use; PQ is deferred, not forced** |

## 21. Unresolved design risks and follow-ups

1. **Registry extension trust.** An anchor protects history, not new versions. Needs governance-signed versions, a pinned-head update process or an independent mirror. *Partly addressed in section 23:* a checkpoint is a governance signature over the registry head as it stood, so the history up to the newest checkpoint is authenticated; versions after it are still accepted only on the strength of the channel, until a later checkpoint covers them.
2. **The unsigned ledger.** Nothing signs the acceptance ledger or the registry chain; a store controller can write a new ledger and append entries after an anchor. *Addressed in section 23* by a signed checkpoint of purpose `REGISTRY_LEDGER_CHECKPOINT` that commits both heads together. (`STANDING_HEAD`, the lifecycle-ledger head named in section 2, remains reserved and unimplemented.) What remains: governance signing keys and ceremony (item 11), publication (item 12), and anything after the last checkpoint.
3. **Revocation latency.** No online status; a verifier is as fresh as its chain. A short validity convention for the head a page embeds may be wanted.
4. **No issuer key exists.** The issuer model is untested against a real publication; the first binding will test the evidence format.
5. **`UPSTREAM_AUTHORITY` assessors** are bound only by assessor id, as the admission rules leave them; no authority-level firewall exists for that role.
6. **Browser binding.** The same decision procedure over Web Crypto (parity is tested on real vectors) is not written; the resolver does not read attestations.
7. **Per-attestation withdrawal** and **detached-attestation discovery by reference section** are deferred.
8. **Signing operations** (custody, ceremony, separation from the deployment host, publication gate tooling) are the next lane and must not start from this repository's CI.
9. **PQ migration** follows the criteria in section 14.
10. **Cross-log ordering.** The key registry and the acceptance ledger have no ordering between them. *Addressed in section 23*, in signed form: one governance statement commits both heads, so a checkpoint is a cut and an entry after the cut is not covered; an entry appended since an anchor must name the anchored registry head or later. What remains is the window before the first checkpoint that records a compromise (section 23.10) and the publication convention a verifier cannot enforce (a checkpoint is signed over the logs exactly as they stand).
11. **The governance key ceremony.** The checkpoint verifier needs a governance trust root, and this repository holds none and generates none. Production bootstrap (how a verifier first learns the root), custody, separation from the deployment host and from the WalletWall publication key, rotation, revocation and a history for governance keys are the next lane. It must not start from this repository's CI.
12. **Checkpoint publication tooling.** The static layout in section 16 and the conflict rule in section 23.12 are a design. A publication gate that refuses a checkpoint over a lagging prefix, refuses two checkpoints of one state by one key with different bytes, and writes nothing else is not built.
13. **Resolver and browser binding for checkpoints.** The resolver does not read checkpoints; the decision procedure is pure and dependency-free so the same code can run around Web Crypto, but that binding and its feature flag are a later lane.
14. **Equivocation.** Two internally consistent histories signed by one key are indistinguishable to a verifier that sees only one. Detecting it needs a verifier comparing checkpoints from independent mirrors, or a transparency log; neither is designed here.
15. **Checkpoint cadence.** How often governance signs, and the rule that it signs over the logs exactly as they stand, are publication policy. The verifier cannot enforce them, and a lagging checkpoint makes the since-the-anchor rule refuse honest later entries (fail closed).

Recommended implementation order: (1) publisher gate and the static store layout with the acceptance ledger; (2) the browser verification binding and the resolver's separate-row presentation; (3) assessor and issuer attestations, with the first real binding evidence; (4) custody and the WalletWall publication key last, because it is the weakest claim and needs the key held apart from the host.

## 22. Decision record

| # | Decision | Alternatives rejected, and why |
| --- | --- | --- |
| D1 | Option 4 as typed statements | Option 1 alone makes an assessor vouch for a whole record it cannot see; option 2 alone leaves the record unattributed; a bare digest signature breaks domain separation |
| D2 | Detached envelope | A field in the record is circular, bumps the version and entangles successors |
| D3 | `tag \|\| 0x00 \|\| RFC 8785` preimage | JWS, COSE or DSSE: closest in intent (DSSE's pre-authentication encoding frames a payload type the same way) but add a parser surface and, for JWS and COSE, unsigned algorithm headers; revisit if interop needs them |
| D4 | No timestamp | A signer clock is forgeable and backdates; a trusted timestamp needs online infrastructure |
| D5 | Separate signing-key registry | Keys in the evidence registry would break replay for every record and change the shipped artifacts on each rotation |
| D6 | Versions as the clock; an acceptance ledger recorded by the store, bound to the attestation digest | Validity instants are signer or governance clocks; a signer-chosen or presenter-supplied registry version is a backdating channel |
| D7 | `retainedBefore` as registry data | A hard-coded rule cannot express a governance finding of when a compromise began |
| D8 | Ed25519 now | ECDSA P-256 (non-reproducible vectors, encoding variants); PQ-only (no browser verification); hybrid now (cost without runtime) |
| D9 | Admit keys before verifying | Trusting the platform primitive alone leaves a measured universal-forgery hole |
| D10 | One narrow `origin` classification beside the raw dimensions | A single verdict collapses the dimensions; no classification leaves the firewalls implicit |
| D11 | Issuer binding by governance over an issuer publication, empty at launch | Inferring issuer from role, name or label; a self-declared issuer key |
| D12 | Duplicates keyed by (purpose, signer, key, target) | Keying by bytes fails when a signer is not deterministic |
| D13 | Receipt unsigned, reference unchanged | A signed receipt becomes a certificate; a signed reference becomes a credential |
| D14 | No new SHA-256 site | A new digest computation would need an integrity-policy exception |
| D15 | WalletWall's generated assessment is not attestable | It is already established by recomputation; a second statement would invite "WalletWall endorses" |
| D16 | No "assessor declared it" binding method | A flag on a bound result is not a boundary a consumer switches on; a self-declared key stays unregistered and `KEY_ONLY` (found by review) |
| D17 | Strict signature checking: R and S as well as the key | Key admission alone leaves a signer-crafted torsion R on which verifiers disagree (found by review) |
| D18 | Retained standing for any key that is no longer `ACTIVE` only inside an anchored ledger prefix | Trusting any entry's version: the ledger cannot prove an entry predates a registry version, for a compromised key or a stolen retired one (found by review, two rounds); cross-binding the logs is section 23 |
| D19 | One small detached checkpoint that commits both heads in one signed statement | Signing each head separately (the pair is then not committed, and mix and match is back); a registry snapshot that embeds the ledger head (couples two publication processes and rewrites the registry's bytes and digest chain, which every pin and anchor already rests on); a Merkle structure (no requirement a count and a head do not meet) |
| D20 | Governance keys are authorized only by an explicit, caller-supplied trust root | A key a checkpoint names (self-signed trust); the signing-key registry authorizing its own checkpoint's signer (circular: whoever controls the registry channel authorizes themselves); a default root in this repository (no production key may exist yet) |
| D21 | Counts and heads both signed, with distinct reasons for truncation, extension and a different head | A head alone (a shorter or longer log cannot be told from a rewritten one, and rollback cannot be ordered without the logs) |
| D22 | The supplied state must be exactly the committed state by default; extension is an explicit mode and is always reported as not covered | Silently accepting a longer log under an old checkpoint (an appended entry would borrow its authority) |
| D23 | Independent checkpoints, no previous-checkpoint link | A chain (it adds no resistance to rollback, fork or rewrite that the signed counts, the logs' own hash chains and a held anchor do not already give; it needs a second identity and a sequence; it does not help against a key holder, who can sign a well-linked successor of anything); revisit with a transparency log (section 23.9) |
| D24 | An entry appended since an anchored checkpoint must name the anchored registry head or later | Trusting any appended entry's pin (a later checkpoint over a polluted ledger would legitimise back-dated entries); the rule is conditional on the publication convention and says so (section 23.8) |
| D25 | Anchors for the attestation verifier are derived from the signed statement only, by a separate function; `verifyAttestation` is unchanged | Changing the #29 verifier or its vectors (every historical result would have to be re-argued) |
| D26 | The checkpoint's identity is the engine's existing digest of its envelope | A new digest construction or a new SHA-256 site (integrity policy, D14) |
| D27 | The trust root carries no status, history or validity interval | A lifecycle for governance keys without a custody and ceremony design to ground it; it is the next lane |
| D28 | `STANDING_HEAD` is a reserved key scope only | Implementing a second signed object now; leaving no way to scope a governance key by purpose |
| D29 | `checkpointAnchors` accepts only results the verifier returned, and carries `currentness`, `uncovered`, `limitations` and the state to hold next | A projection of any object of the right shape (a fabricated result mints anchors; found by review); returning bare anchors (an unanchored or extended result is indistinguishable from an anchored, exact one downstream); re-verifying on every call (cost, for a caller that already holds the result) |

## 23. Signed trust checkpoints

Status: implemented as a pure verifier prototype with synthetic vectors, outside the shipped runtime. **No governance key, trust root or checkpoint is
produced, held or published by this repository.** The governance key ceremony is a later lane (section 21, item 11).

### 23.1 The gap, exactly

The signing-key registry (section 8) and the acceptance ledger (section 11) are each hash-chained, and each verifies on its own. Nothing signed
commits to both heads together, and neither log carries the other's head. So a verifier cannot establish, as one statement by anyone, that *ledger
head L was accepted against registry head R*. The characterization is pinned by `checkpoint-gap.test.ts`, which uses only the #29 modules: a valid registry
and a valid ledger from different histories each verify alone; a ledger that names a registry version past the registry's head verifies as a ledger;
a ledger with one more entry is another independently valid ledger; the statement shape that is signed today names neither head; and the anchors the
attestation verifier takes are plain values the caller holds, so whichever prefix the caller names is the prefix that is covered.

This is not the claim that history is forgeable in every context. A verifier that holds the right anchors from a channel it relies upon is protected, and
section 11 says so. What is missing is *an authenticated statement of the pairing, and of the cut*.

### 23.2 The checkpoint

```text
envelope  = { "type": "walletwall.wallprint.trust-checkpoint",
              "checkpointVersion": "0.1",
              "statement": statement,
              "signature": "<lower-case hex>" }
statement = { "checkpointVersion": "0.1",
              "purpose": "REGISTRY_LEDGER_CHECKPOINT",
              "signer": { "keyId", "algorithm", "publicKey": "<lower-case hex>" },
              "registry": { "headVersion": "<decimal>", "headDigest": "<hex64>" },
              "acceptanceLedger": { "entryCount": "<decimal>", "headDigest": "<hex64> | null" } }
```

Every value is a string or null. Unknown fields are refused, never dropped. The one purpose is `REGISTRY_LEDGER_CHECKPOINT`. Every field has a verification purpose; there is no timestamp, label,
comment, status, identifier or link.

| Field | Verification purpose |
| --- | --- |
| `type` | rejects a signed object of another kind presented as a checkpoint |
| envelope `checkpointVersion` | a parse selector only, so an unsupported version is reported before its grammar is read; it must equal the signed twin |
| `statement.checkpointVersion` | signed: it fixes how both heads are read (the registry snapshot format, the ledger entry construction, the digest construction) |
| `purpose` | signed: selects the domain tag, and is what a governance key is authorized for |
| `signer.keyId`, `signer.algorithm`, `signer.publicKey` | signed: the statement names its key, so a signature cannot be re-presented under another key; the verifier compares all three with the trust root's entry and takes none of them on the checkpoint's word |
| `registry.headVersion` | signed: the number of snapshots committed (versions are `1..N`, so N is both); lets truncation, extension and order against an anchor be told apart without walking a chain |
| `registry.headDigest` | signed: the head snapshot's own digest, which commits the whole chain behind it |
| `acceptanceLedger.entryCount` | signed: the length of the committed prefix; the cut |
| `acceptanceLedger.headDigest` | signed: the last committed entry's digest, which commits the whole prefix; `null` exactly when the count is `0` |
| `signature` | the signature itself: the one envelope field that is neither part of the signed statement, nor a fixed literal (`type`), nor a parse selector with a signed twin (`checkpointVersion`) |

The ledger has no `version` field of its own: `checkpointVersion` fixes the entry construction the head is read under, exactly as `attestationVersion` fixes the
statement's. A checkpoint is detached from every WallPrint record and attestation; no record, receipt, reference, digest or attestation byte changes, and WallPrint stays `0.2`.

### 23.3 The exact signed bytes

```text
signed bytes = UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))
domain tag   = walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint
```

The domain tag is `walletwall.wallprint.trust-checkpoint/0.1/registry-ledger-checkpoint`. It is the same construction as an attestation's, through one
shared function (`domainSeparatedPreimage`), not a second convention; it differs from every attestation tag and is a prefix of none, and the preimage is not JSON.
So a signature over a checkpoint is not a signature over any attestation, and the reverse (vectors `cp-18a` to `cp-18c`). A raw digest is never signed.
The exact preimage of every vector is in the vector file (`signedBytes.preimage`).

Ed25519 only, with the same strict admission as an attestation: the public key, and the signature's R and S, before the platform primitive is asked (section 13).
No algorithm is read from unsigned data, and an unsupported algorithm is `NOT_CHECKED`.

### 23.4 Who may sign: the governance trust root, and the bootstrap

The checkpoint's signer is a WalletWall governance key. A checkpoint that carries a public key must not become relied upon because it signed itself,
so authorization comes only from a **governance trust root** the verifier is handed explicitly:

```text
trust root = { "type": "walletwall.wallprint.governance-trust-root", "formatVersion": "0.1",
               "keys": [ { "keyId", "algorithm", "publicKey", "purposes": [ "REGISTRY_LEDGER_CHECKPOINT" | "STANDING_HEAD" ] } ] }   // strictly ordered by keyId
```

- A key is authorized only if the root lists its id, its algorithm and public key equal the statement's, and its purposes include the statement's. Each of those is a separate
  reason: `SIGNER_UNKNOWN`, `SIGNER_KEY_MATERIAL_MISMATCH`, `PURPOSE_NOT_GRANTED`. A key id is never inferred from a name or a label.
- **The registry being checkpointed cannot authorize its own checkpoint's signer.** Its WalletWall publication key is not a governance key, and the root is a separate input
  (vector `cp-03c`); otherwise whoever controls the registry channel could add a key and sign for it.
- `STANDING_HEAD` is the deferred lifecycle-ledger head purpose named in section 2. No statement of that purpose exists; it is in the vocabulary so a root can scope a key to it and the
  verifier can refuse that key for a checkpoint (vector `cp-04`).
- A root has no status, history or validity interval. A key stops being accepted when the caller stops supplying it. A root that is missing or invalid authorizes nothing, and the
  result says `TRUST_ROOT_NOT_SUPPLIED` or `TRUST_ROOT_INVALID` rather than evaluating.

**The bootstrap.** *How does a verifier know the first authorized checkpoint key?* Not from anything this repository ships. The pure verifier takes the root as an input, and the tests pin a
synthetic root. **A production bootstrap does not exist and requires the governance key ceremony**: generating the keys offline and apart from the deployment host and from the WalletWall
publication key, recording their public halves somewhere a verifier's distributor can pin them and independent parties can compare, and defining rotation and revocation of governance keys.
Until then every checkpoint result says, in `doesNotEstablish`, that it does not establish that the supplied root is WalletWall's production key set. This repository contains no governance
private key, no seed phrase, no KMS or HSM integration, no environment-variable key and no workflow secret; signing exists only in the test support, with keys whose seeds are public ASCII labels.

### 23.5 What a checkpoint means

> WalletWall governance key K signed one statement committing signing-key registry state R (the snapshots `1..N`, by the digest of snapshot N) and acceptance-ledger prefix L (the entries
> `1..M`, by the digest of entry M) together.

- **Cross-binding.** The checkpoint commits both heads and both counts, so the pair cannot be mixed: a registry from one history with a ledger from another, a longer or shorter log, a log with an
  entry reordered, dropped, rewritten or re-chained, each fail against the committed head at the committed position.
- **The cut.** Every ledger entry up to `M` is covered. Every entry after `M`, and every registry version after `N`, is not: the checkpoint says nothing about them. A checkpoint over registry 5
  and ledger 12 does not authenticate registry 6 with ledger 12, or registry 5 with ledger 13.
- **Exact by default.** The supplied registry and ledger must be exactly the committed state. A longer log is refused as a different state claiming to be this checkpoint
  (`REGISTRY_EXTENDED_BEYOND_CHECKPOINT`, `LEDGER_EXTENDED_BEYOND_CHECKPOINT`); a shorter one is `…_TRUNCATED`; a different head at the committed position is `…_HEAD_MISMATCH`; a log that is not a valid
  chain is not compared at all (`…_CHAIN_INVALID`).
- **Extension, on request.** With `allowExtension` the committed state must still be an exact prefix, and everything after it is reported as `EXTENDED` with the number of uncovered entries and a
  limitation. The anchors a checkpoint yields (23.6) are the committed ones, never the supplied lengths.
- **Cross-version consistency.** Every committed ledger entry must name a registry version that exists in the committed registry state (`LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION` otherwise), and the digest it
  records must be that version's own digest in the supplied chain (`LEDGER_REGISTRY_DIGEST_MISMATCH`). A checkpoint over a combination that cannot have existed is `INCONSISTENT`.
- **What it does not prove.** It does not prove that entry *k* was written after registry version *v* existed, or before version *v+1* did. An entry's `acceptedUnder` is still the store's claim
  (section 11); the checkpoint authenticates *which entries and versions governance committed together*, not the physical order in which they were written. It does not establish that any attestation
  in the ledger is valid, matches its target, was rightly accepted or is correct, and it adds no origin to any attestation.

Dimension by dimension, none of these collapses into another (the invariants, each pinned by a test):

```text
signature validity != factual truth
checkpoint validity != record truth
checkpoint validity != assessor correctness
registry binding != issuer factual correctness
historical acceptance != current key status
assessor agreement != corroboration
valid checkpoint != current checkpoint
checkpoint signer != self-declared signer
```

### 23.6 The verification result

`verifyCheckpoint(checkpoint, { trustRoot, keyRegistry, acceptanceLedger, allowExtension, anchor, expectedDigest })` never throws, for any argument (a null, primitive or array context is treated as none, and input that cannot even be read, such as a throwing getter, is refused as `MALFORMED`),
reads no clock, file, network or environment, and returns separate dimensions. There is no `verified` flag, no top-level boolean, no score and no tally of checkpoints or signatures; the per-log counts are the committed and supplied lengths.

| Dimension | Values | Needs |
| --- | --- | --- |
| `parse` | `PARSED`, `MALFORMED`, `UNSUPPORTED_VERSION` | the checkpoint |
| `checkpointDigest`, `committed` | the identity and the committed state the statement says | the checkpoint |
| `identity` | `MATCHED`, `MISMATCHED`, `NOT_COMPARED` | the name it was published under |
| `signature` | `VALID`, `INVALID`, `NOT_CHECKED` (+ the section 12 reasons) | the checkpoint only |
| `signer` | `key` (`KNOWN`, `UNKNOWN`, `MATERIAL_MISMATCH`, `NOT_EVALUATED`), `authorization` (`AUTHORIZED`, `NOT_AUTHORIZED`, `NOT_EVALUATED`) | the trust root |
| `registry`, `acceptanceLedger` | `chain` (`VALID`, `INVALID`, `NOT_SUPPLIED`), `state` (`MATCHED`, `EXTENDED`, `MISMATCHED`, `NOT_EVALUATED`), committed / supplied / uncovered counts, reasons | the log |
| `crossBinding` | `CONSISTENT`, `INCONSISTENT`, `NOT_EVALUATED` (+ reasons) | both logs, and an anchor for the since-the-anchor rule |
| `anchor` | `NO_ANCHOR`, `AT_ANCHOR`, `ADVANCES_ANCHOR`, `BEHIND_ANCHOR`, `FORKED_FROM_ANCHOR`, `ANCHOR_INVALID`, `NOT_EVALUATED` | a held committed state |
| `limitations` | sorted: `CHECKPOINT_UNANCHORED`, `REGISTRY_EXTENDED_BEYOND_CHECKPOINT`, `LEDGER_EXTENDED_BEYOND_CHECKPOINT` | |
| `establishes`, `doesNotEstablish` | fixed sentences | |

Fixed reason codes, no caller text echoed: `TRUST_ROOT_NOT_SUPPLIED`, `TRUST_ROOT_INVALID`, `SIGNER_UNKNOWN`, `SIGNER_KEY_MATERIAL_MISMATCH`, `PURPOSE_NOT_GRANTED`;
`REGISTRY_NOT_SUPPLIED`, `REGISTRY_CHAIN_INVALID`, `REGISTRY_TRUNCATED`, `REGISTRY_HEAD_MISMATCH`, `REGISTRY_EXTENDED_BEYOND_CHECKPOINT` and the same five for the ledger;
`LEDGER_REFERENCES_FUTURE_REGISTRY_VERSION`, `LEDGER_REGISTRY_DIGEST_MISMATCH`, `LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD`, `STATE_NOT_ESTABLISHED`;
`CHECKPOINT_BEHIND_ANCHOR`, `CHECKPOINT_FORKS_FROM_ANCHOR`, `ANCHOR_MALFORMED`, `ANCHOR_CONTINUITY_NOT_CHECKED`; `CHECKPOINT_DIGEST_MISMATCH`.

**`doesNotEstablish`** is fixed: factual truth of any record, claim or attestation; that any assessor or issuer is correct, independent or authoritative; that any attestation in the ledger is valid,
matches its target or was rightly accepted; that a registry binding names the right party or that a key is relied upon today; that the checkpoint is the latest state; anything about registry versions or ledger
entries after the committed heads; when the checkpoint was signed or when any entry was accepted; that the supplied governance trust root is WalletWall's production key set; safety, solvency, regulatory compliance or investment merit.

**`checkpointAnchors(result)`** returns the committed registry head and ledger entry in the shapes `verifyAttestation` takes (`trustAnchor` and `acceptance.anchor`), or `null`. It returns them only when the signature is valid, the signer is
authorized, the identifier does not mismatch, both logs are valid and are the committed state (or extend it), the ordering rule holds, and the checkpoint is not behind or a fork of an anchor the caller holds; `null` also for an invalid anchor, an anchor
continuity that could not be checked and anything that did not parse. The anchors come from the *signed statement*, never from the supplied logs. **It accepts only a result `verifyCheckpoint` itself returned** (a module-private capability that the verifier never reads):
a plain object of the right shape, a copy, or a result revived from JSON that crossed a boundary yields `null`, so a fabricated "everything passed" result mints no anchors; re-derive it by calling `verifyCheckpoint` again. It is not a verdict about any attestation: it says
which prefix is authenticated, and the attestation verifier is unchanged.

What travels with the anchors, so a consumer cannot mistake them for more than they are: `currentness` (`NO_ANCHOR`, `AT_ANCHOR` or `ADVANCES_ANCHOR`; with `NO_ANCHOR` nothing says this is not an older checkpoint), `uncovered` (how many registry versions and ledger entries
of what was supplied lie past the committed state), `limitations`, and `committed`, the state to hold as the caller's next anchor. A result's own `committed` field is only what its statement says, for any checkpoint that parsed; it is authenticated only if `checkpointAnchors` returns non-null for that result, and holding an
unauthenticated one as an anchor would make the genuine checkpoint look like a rollback.

**Integrator rule.** The registry versions and ledger entries past the committed state are not authenticated, yet `verifyAttestation` decides a key's *current* status from the head of the registry it is given. When the question is what is true now, judge against exactly the committed state
(the default exact mode), or read `uncovered` and treat what lies past it as the channel's word. Anchors from an unanchored checkpoint are authentic for the prefix they name and say nothing about whether newer state exists.

### 23.7 Rollback, currentness and old checkpoints

Cryptographic validity and currentness are separate dimensions. An old checkpoint is **not invalid**: it is authentic, authorized and silent about everything after its heads. Whether it is *current* is a statement relative to
an anchor the caller holds, so the verifier makes no global "latest" claim and does no lookup.

The caller may supply the committed state of a checkpoint it already relies upon: the `committed` field of a `checkpointAnchors` result, the only authenticated way to obtain one (23.6). Counts decide order, and the supplied logs prove continuity:

| Status | When |
| --- | --- |
| `NO_ANCHOR` | none supplied; the result carries `CHECKPOINT_UNANCHORED` |
| `AT_ANCHOR` | the same counts and heads |
| `ADVANCES_ANCHOR` | not behind on either log, ahead on at least one, and the supplied logs contain the anchored heads at the anchored positions |
| `BEHIND_ANCHOR` | older on a log and not newer on the other: a rollback. Detected from counts alone, with no logs; never authenticated as current |
| `FORKED_FROM_ANCHOR` | the anchor's counts with another head, ahead on one log and behind on the other (logs only append, so no honest state is both), or a later state whose logs do not contain the anchored heads |
| `ANCHOR_INVALID` | the anchor is not exactly a committed state |
| `NOT_EVALUATED` | ahead, but no usable logs to prove continuity (`ANCHOR_CONTINUITY_NOT_CHECKED`) |

A verifier that has trusted checkpoint C10 and is shown C7 as current reports `BEHIND_ANCHOR`, and a verifier with no anchor cannot tell, which the result says.

### 23.8 The ordering rule between the ledger and the registry

A checkpoint is signed over the registry and the ledger **exactly as they stand**; it never commits a lagging prefix of a ledger that is longer when it is signed. That is a publication convention
the verifier cannot enforce (section 21, item 15). Given it, and given that the registry only grows, an entry appended *after* an anchored checkpoint was accepted when the registry head was at least the anchored head.
That inference rests on three premises, and the third is a rule about acceptors, not about governance: the checkpoint covers the whole ledger as it stood; the registry only grows; and **an acceptor judges under the registry head, at least as new as the last checkpointed head, when it appends**. A publication gate (section 21,
item 12) is where the third is enforced; nothing in a verifier can.

So, when a checkpoint advances an anchor, **every entry appended since the anchored prefix must name a registry version at or after the anchored registry head**, or the combination is `INCONSISTENT`
(`LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD`) and yields no anchors. An entry that names an older version, appended after a checkpoint that already showed the newer one, is what a back-dated acceptance
looks like. The rule needs the caller's anchor; it cannot see a back-dated entry that names a version at or after the anchored head, and an entry's version is still the store's claim.

**The cost of the rule, stated.** Because the ledger only appends, one entry appended after the anchor that names a version older than the anchored head makes every later checkpoint `INCONSISTENT` for a verifier holding that anchor, and it stays so. A stale acceptor, or a store controller, can cause that without any governance key.
It fails closed (no anchors, so nothing new is covered), and it is the intended outcome for a back-dated entry, but it is a liveness cost. Recovery is a deliberate, out-of-band act: governance publishes a checkpoint over the ledger as it stands, and the verifier resets its anchor knowingly, accepting that the entry stays in the ledger and that, with no anchor, the
checkpoint is `NO_ANCHOR` again (23.7). Nothing recovers silently.

### 23.9 Checkpoint chaining: decided against

Two options were evaluated: **A**, each checkpoint independently signs both heads; **B**, each also commits the previous checkpoint's digest.

Rollback, reorder and fork are already detected without a link. The signed counts order two checkpoints (`BEHIND_ANCHOR`, and a state ahead on one log and behind on the other); the logs are hash chains, so a checkpoint
of another history cannot contain the anchored heads (`FORKED_FROM_ANCHOR`); and a verifier that holds an anchor needs nothing else. A link adds nothing for a verifier without an anchor either: it names a digest the
verifier cannot check without already holding the previous checkpoint. It adds nothing against the attack a link cannot touch, a key holder, who can sign a correctly linked successor of any history, and nothing against
equivocation, where two checkpoints both link to the same predecessor. It costs a second identity, a sequence number and a rule for a missing predecessor. **Option A is chosen** (D23). It is revisited if a verifier
must walk checkpoint history without the logs, or together with a transparency log that makes equivocation visible (section 21, item 14).

### 23.10 Compromise and back-dating, revisited

The residual concern of section 10 and T18: key K is `ACTIVE`; attestation A is accepted; a checkpoint C binds registry R and ledger prefix L; later K becomes `COMPROMISED` or `SUPERSEDED`; an attacker appends a fake old acceptance
behind the current state. `checkpoint-scenarios.test.ts` builds it step by step, with the genuine acceptances inside the prefix and the forged ones after, and checks every ledger position mechanically:

- **Inside the prefix.** With the anchors a checkpoint yields once every dimension holds, an acceptance at or below the committed count keeps the standing the registry's own `retainedBefore` policy gives it, for a compromised key and for a superseded one. Checkpoint validity is not key standing:
  where the registry retained nothing, a checkpointed acceptance is still `WITHDRAWN` (`WITHDRAWN_AFTER_ACCEPTANCE`).
- **After the prefix.** An entry after the committed count is judged on present-day state and is `WITHDRAWN` for a key that is no longer `ACTIVE` (`WITHDRAWN_ACCEPTANCE_UNANCHORED`), whatever registry version it names, at every position and for every checkpoint size tested (vectors `cp-16` and `cp-17`).
- **Without a checkpoint** no entry is inside any authenticated prefix, so even the genuine acceptances lose their standing. This is what the checkpoint buys.
- **The next checkpoint cannot launder the forgery** if the verifier holds an anchor at or after the registry head that recorded the compromise: the forged entry names an older version than the anchored head, so the combination is `INCONSISTENT` (vector `cp-22a`).
- **The residual, stated.** If the held anchor predates the registry version that recorded the compromise, a forged entry naming a version at or after that anchored head cannot be told from a genuine one, and a checkpoint governance signs over a ledger it has not reviewed
  authenticates the ledger as it stands, including that entry (vector `cp-22b`, which exists to show it). A checkpoint commits what governance signed over; it does not show each entry was rightly accepted. It narrows the window to the interval between the last held checkpoint
  and the next one that follows the registry's record of the compromise, and the compromise window itself (T6) remains.

### 23.11 Evolution after a checkpoint

A signed checkpoint is immutable historical evidence. A later registry version or ledger entry needs a later checkpoint; an old checkpoint is never mutated or refreshed, and a new one is a different artifact with its own identity. Registry and ledger only append, so the committed counts
of successive checkpoints move forward. The verifier can say, of an old checkpoint: it is cryptographically valid; it authenticates registry head R5 and ledger head L12; newer state may exist; it says nothing about entries after L12.

### 23.12 The checkpoint digest, the integrity policy and publication (design; nothing is published by this lane)

A stable identifier is needed to publish and to name a checkpoint, and the signature alone is not one. The identity is `checkpointDigest(envelope) = evidenceDigest(envelope)`, the engine's existing SHA-256 over RFC 8785 through the existing function, never signed and used only as an
address and a name the reader recomputes (`identity`). **No new SHA-256 computation site is created and `security/integrity-policy.json` is unchanged** (D26); a test pins that the checkpoint modules hold none.

The static layout is in section 16 (`checkpoints/<checkpointDigest>.json`, with a `checkpoints/index.json` that is a discovery list only and carries no authority). Rules, as for attestations: the reader recomputes the name; identical bytes are idempotent; different bytes for one
(signer key, committed state) are a conflict, never an overwrite; checkpoints only extend; the same privacy gate and size bounds apply. A published checkpoint would be read together with the registry and ledger it commits, and a verifier would hold its own trust root. No resolver loading is wired,
no database, endpoint, remote fetch or hosted compute is added; the resolver feature-flag lane comes later.

### 23.13 What this lane does not do (stop conditions, evaluated)

| Condition | Result |
| --- | --- |
| a production signing key is required | **not triggered.** Synthetic test keys only; the root is an input |
| secrets must enter CI | **not triggered.** No workflow change, no secret; a test pins it |
| a network timestamp or notary is required | **not triggered.** No timestamp; order is by counts and logs |
| cross-ordering cannot be expressed without rewriting historical data | **not triggered.** The registry's snapshot bytes and the ledger's entry bytes are unchanged; the committed #29 vectors regenerate byte for byte |
| the model requires changing the WallPrint 0.2 record shape | **not triggered.** Detached |
| a database or hosted service appears necessary | **not triggered.** A pure function over supplied values |
| verification requires online revocation | **not triggered.** A governance key is revoked by the verifier no longer supplying it; there is no online status |

Also unchanged: the six MCP tools, the eleven resources, `plugin/server/walletwall-mcp.mjs`, the tool manifest, the MCPB and the Claude Directory payload; no dependency is added and no second crypto library or algorithm is introduced.

**Changes to existing #29 code, all of them listed.** (1) `attestation.ts` factors the signed-bytes construction into `domainSeparatedPreimage`; `attestationPreimage` returns the same bytes (the section 19 vectors regenerate byte for byte). (2) `acceptance-ledger.ts` applies its structure guard to each entry instead of to the whole array: the guard caps one value at 20,000 nodes, which limited a ledger to about 2,500 entries
against an advertised 100,000, and a checkpoint over a longer ledger could never produce anchors. The findings, the entry bytes and the chain rules are unchanged, and a hostile entry anywhere still refuses the ledger.

### 23.14 The prototype, the vectors and the mutation coverage

Modules: `checkpoint-vocabulary.ts`, `checkpoint.ts`, `checkpoint-verify.ts` (and the shared `domainSeparatedPreimage` in `attestation.ts`, whose output for attestations is byte-identical to before). Tests: `checkpoint-gap.test.ts`,
`checkpoint.test.ts`, `checkpoint-verify.test.ts`, `checkpoint-scenarios.test.ts`, `checkpoint-vectors.test.ts`, and the checkpoint cases in `attestation-isolation.test.ts`. Vectors, in a file separate from the section 19 vectors so those stay unchanged:
`wallprint-checkpoint-vectors-0.1.json`, by `scripts/gen-wallprint-checkpoint-vectors.ts` (`npm run gen:wallprint-checkpoint-vectors` / `npm run verify:wallprint-checkpoint-vectors`). **Every key is a synthetic test key** whose seed is a public ASCII label; nothing that ships or publishes carries one.

| Required case | Vector id(s) |
| --- | --- |
| valid checkpoint | `cp-01-valid-checkpoint`, `cp-01b-…`, `cp-01c-…` (an empty ledger) |
| wrong signature | `cp-02-wrong-signature` |
| unknown governance key | `cp-03a-…` (unlisted), `cp-03b-…` (names a listed id with its own key), `cp-03c-…` (the registry's publication key), `cp-03d-…`, `cp-03e-…` (no or invalid root) |
| known key, wrong purpose | `cp-04-known-key-wrong-purpose` |
| registry or ledger head mismatch | `cp-05-registry-head-mismatch`, `cp-06-ledger-head-mismatch` |
| registry or ledger count mismatch | `cp-07a-…`, `cp-07b-…` (shorter, longer), `cp-08a-…`, `cp-08b-…` |
| registry or ledger chain tampered | `cp-09-registry-chain-tampered`, `cp-10-ledger-chain-tampered` |
| ledger entry beyond the checkpointed registry | `cp-11a-…` (a future version), `cp-11b-…` (a digest that is not the committed registry's) |
| old checkpoint still valid | `cp-12-old-checkpoint-is-still-cryptographically-valid` |
| rollback, fork, advance against an anchor | `cp-13a-…` to `cp-13e-…` |
| post-checkpoint appends not covered | `cp-14-…` (ledger), `cp-15-…` (registry) |
| compromised-key history, back-dating | `cp-16-…` (keeps its standing), `cp-17-…` (outside the older checkpoint), `cp-22a-…` (refused by the ordering rule), `cp-22b-…` (the stated residual) |
| cross-purpose replay | `cp-18a-…` to `cp-18c-…` |
| statement byte mutation | `cp-19a-…`, `cp-19b-…` |
| linkage, identifier, version | `cp-20a-…` (a smuggled link is refused), `cp-20b-…`, `cp-20c-…`, `cp-20d-…`, `cp-20e-…` |
| algorithm, key and signature material | `cp-21a-…` to `cp-21f-…` (unsupported algorithm, signature length, public key, S, R, not hex) |

Mutation: `npm run test:wallprint-checkpoint-mutation` applies each realistic broken implementation to the real source by an exact patch (a signed statement that omits the registry head, the registry count, the ledger head, the ledger count, the key, the purpose or the version;
dropped domain separation; a self-declared or wrong-purpose key; a default root; skipped registry or ledger chain verification; ignored heads, truncation or exactness; a future registry reference; a dropped ordering rule; disabled rollback detection; anchors given for a
fork, an unsigned or unauthorized checkpoint; accepted malformed Ed25519 key, R or S; a generic `verified` flag; a covered acceptance that ignores the registry's retained window) and requires a suite to fail for each. A survivor fails the run.

### 23.15 Limitations

A checkpoint authenticates what governance committed together, not that any of it is right. It carries no time. It is only as relied upon as the governance trust root the verifier was handed, which this lane cannot establish. It does not detect equivocation. It leaves
registry versions and ledger entries after the newest checkpoint on the strength of the channel. Its since-the-anchor ordering rule depends on a publication convention it cannot enforce, on an anchor the caller holds and on acceptors judging under a current registry head (23.8), and a single stale entry can wedge it until the anchor is reset deliberately. The window between a compromise and the first checkpoint that records it remains.
