# WallPrint governance key ceremony: runbook

Status: **draft, design lane, pre-release. This procedure has not been performed.** It is the operational procedure a future, live ceremony would follow to create, authorize,
preserve, rotate, recover, revoke and publicly bootstrap the WalletWall governance keys that authorize signed registry and ledger checkpoints. Every step is a requirement a
reviewer should challenge before it is relied upon, and no step in this document is run by any script, test or workflow in this repository.

**No production key is generated, stored or described by this repository.** The rehearsal (appendix C) uses unmistakably synthetic keys whose seeds are public labels. There is
deliberately no command here that creates a production root or a production operational key, and a live ceremony starts from a separate, reviewed, hash-pinned procedure, not from this
repository's CI.

The semantic contract, the formats, the exact signed bytes and the verifier are in [`spec/WALLPRINT_ATTESTATIONS.md`](../spec/WALLPRINT_ATTESTATIONS.md), section 24 (the
checkpoint they authorize is section 23). That specification stays the contract; this document is procedure.

## 1. Purpose

A signed WallPrint trust checkpoint (specification section 23) commits the signing-key registry head and the acceptance-ledger head together, but it is only as relied upon as the
governance trust root a verifier is handed. The question this runbook answers:

> How does WalletWall create, authorize, preserve, rotate, recover, revoke and publicly bootstrap the governance keys that authorize signed registry and ledger checkpoints?

The answer is a two-level hierarchy: an **offline governance root** authorizes **one operational checkpoint-signing key at a time**, and that operational key signs the checkpoints.
The ceremony produces only public artifacts: a **bootstrap** (the root's public key and an epoch) and **authorizations** (root-signed statements naming the operational key), plus a
**transcript** of what two participants attest happened.

## 2. Trust architecture

```text
public bootstrap  (pinned by a verifier through at least two distinct origins)
        |  names the root public key and the root epoch
        v
offline governance root          (private key exists only on ephemeral offline media and in encrypted backups)
        |  signs detached authorizations, purpose CHECKPOINT_KEY_AUTHORIZATION
        v
operational checkpoint key       (one current key per generation; purpose REGISTRY_LEDGER_CHECKPOINT only)
        |  signs
        v
registry + acceptance-ledger checkpoints   (specification section 23, unchanged)
```

| Question | Answer |
| --- | --- |
| Why not let the root sign every checkpoint? | The root would be handled at every publication, its exposure would grow with every use, and losing or exposing it would mean losing or exposing the signer. An offline root that is used only to authorize or replace an operational key is handled rarely. |
| Why not put the keys in the signing-key registry? | The registry being checkpointed cannot authorize its own checkpoint's signer: whoever controls the registry channel would authorize themselves. |
| What does the verifier trust first? | Only the bootstrap the consumer pinned, never anything in the checkpoint it is verifying. |
| What can the root do? | Authorize or replace the operational key. It is granted no other purpose. |
| What can it not do? | Sign checkpoints, records, attestations, assessments or transactions; control funds; authorize MCP tools or deployment credentials; attest that anything is true. |
| What can the operational key do? | Sign checkpoints for `REGISTRY_LEDGER_CHECKPOINT`. It cannot authorize any key, replace the root, sign attestations or modify records. |
| What does a governance signature establish? | Authority over a key. It is never a claim that a record, an assessor or an issuer is right (`governance signature != factual truth`). |

## 3. Roles

| Role | Responsibilities | Must not |
| --- | --- | --- |
| **Operator** | runs the pinned ceremony procedure on the ceremony machine; generates the root key; signs the authorization; writes the public artifacts to the output medium | expose a private key to anyone, including the witness; act without the witness present |
| **Witness** | reads the pinned script and tool digests and compares them with the published list; watches that the network is off; compares the root fingerprint aloud against an independent copy; verifies the recovered public key; reviews the public outputs before they leave the room | hold the working key or a backup passphrase together with a media copy; sign off on anything they did not see |

- **Who records the public artifacts:** the operator writes them to the output medium; the witness reads them back and compares digests on a second machine before publication.
- **Who verifies fingerprints:** the witness, independently of the operator, and later two independent origins (section 8).
- **Who approves an authorization or a rotation:** both, together, on the written ceremony plan agreed before the ceremony. A rotation or replacement is never decided during the ceremony.
- **No one needs to expose a private key to another person.** A backup is encrypted, and its passphrase is kept apart from every media copy.

| Participant model | Strength | Weakness | Decision |
| --- | --- | --- | --- |
| single custodian | simplest | one person's compromise, loss or coercion is total | rejected |
| two-person (operator and witness) | catches a lone error or a lone malicious act; modest operational cost | two colluding participants, or one person filling both roles, defeat it | **chosen** |
| multi-party or threshold | stronger against collusion | much more operational complexity, a new cryptographic construction and more custody to lose | not introduced: the root is offline and rarely used, and nothing here requires it |

Two roles are the minimum, not the aim: a larger team adds witnesses (the transcript accepts more than one). The transcript refuses the same participant id twice; it cannot tell that
two ids are one person.

## 4. Prerequisites

Before a live ceremony opens, all of the following exist and are reviewed, and none of them is created by this repository:

1. **A written ceremony plan:** the kind (`ROOT_BOOTSTRAP` or `OPERATIONAL_KEY_ACTION`), the participants, the place, the output media, the backup locations and custodians, and, for a rotation, the old key's standing and the retained checkpoint state.
2. **A reviewed, hash-pinned ceremony script and a published tooling list** (section 6): the exact image, tool versions and digests. That script is a deliverable of the first live-ceremony lane; it does not exist here.
3. **A dry run of the real tooling and the real media with a throwaway key**, on the day, by the same people, discarded unrecorded. The rehearsal in this repository exercises the verifiers, not the tools.
4. **The verifier release** that will pin the bootstrap, built before the ceremony so the fingerprint can be added to it afterwards through review.
5. **At least two independent origins** committed to publishing the fingerprint (section 8), named before the ceremony.
6. **The backup plan** (section 9): at least three media copies, two or more places, two or more passphrase envelopes in two or more other places, and the people who hold them.
7. **A recovery drill plan** (section 10) and a calendar for periodic rehearsal.
8. **For a rotation:** the last published checkpoint signed by the key being replaced, read from public data, so `retainedAt` is its committed state, not a guess.
9. **A decision on where the operational key will live** (section 11), made before it is generated.

## 5. Environment

| Option | For | Against | Decision |
| --- | --- | --- | --- |
| general-purpose workstation | convenient | malware, synced folders, shell history, clipboard managers, telemetry, package managers and a network are all present | **rejected** |
| dedicated offline machine, persistent disk | no daily-use software | the disk keeps what was written; erasure of flash storage cannot be guaranteed | acceptable only if the disk is encrypted and never holds the key in clear |
| **live, ephemeral operating system on a dedicated machine, network physically disabled, output to removable media** | nothing persists after power-off; the image is hash-verified | needs a verified image and hardware that boots it | **chosen** |

Requirements, none of which is optional:

- **Network physically disabled** (radios removed or disabled in firmware, no cable), confirmed by the witness before any key exists. A software setting alone is not enough.
- **Verified binaries:** the live image and every tool are checked against the published tooling list (section 6) before the machine is used.
- **Reliable randomness:** the operating system's CSPRNG, reached through a mature tool (section 7). No human-generated entropy.
- **Removable media:** a fresh, labelled output medium for public artifacts; separate fresh media for each encrypted backup copy. No medium is reused from daily work.
- **No clipboard use, no shell history, no terminal logging or screen capture, no cameras or recording devices, no photographs** of anything on the screen or the media. A transcript records attestations, never raw output.
- **Paper and printer:** paper is used for passphrases and the fingerprint comparison. A printer is used only if it is dedicated, offline and has no memory the participants cannot clear; otherwise write by hand.
- **Disk encryption:** any persistent medium that ever touches key material is encrypted, and is still treated as exposed.
- **Erasure is not a control.** Deleting a file, overwriting a file or formatting a disk does not reliably remove data from flash storage, wear-levelled media or backups. The procedure therefore never relies on deletion: the working copy lives only on ephemeral media that is powered off, and anything persistent is encrypted. If the working key was ever written to persistent storage, that storage is treated as exposed and destroyed, not wiped.

## 6. Verified tooling

- The **tooling list** is a public, reviewed file of `name`, `version` and `digest` for the live image, each tool and the ceremony script, committed and published before the ceremony. The transcript's `tooling` must equal it exactly (`TOOLING_MISMATCH`); without a list the transcript reports `TOOLING_NOT_CROSS_CHECKED`.
- The live image and the tools are fetched and checked **before** the ceremony on a networked machine, by the witness, against the published digests and the origin's own signatures where they exist, then written to read-only media. Nothing is downloaded during the ceremony.
- The ceremony machine boots from that media. The operator and witness recompute each digest on the ceremony machine and compare with the list before any key exists (event `TOOLING_VERIFIED`).
- Acceptable key tools are mature, widely reviewed and able to draw from the operating system CSPRNG and write PKCS#8 or a raw seed only to a destination the operator chooses (section 7). The runbook names no tool as certified; the first live-ceremony lane pins one.

## 7. Generation procedure

Preconditions: the ceremony is open (`CEREMONY_OPENED`), the roles are acknowledged (`ROLES_ACKNOWLEDGED`), the tooling is verified (`TOOLING_VERIFIED`), and the network is confirmed physically off (`NETWORK_CONFIRMED_OFFLINE`).

**Acceptable mechanisms for an Ed25519 root:**

| Mechanism | Notes |
| --- | --- |
| a mature library or tool that draws 32 bytes from the operating system CSPRNG and derives the key per RFC 8032 | the baseline; OpenSSL, libsodium, the Go and Node standard libraries and OpenSSH key generation all qualify in principle |
| on-device generation in a hardware token | acceptable **only** if the token produces a pure Ed25519 signature over the exact preimage bytes of the specification and its public key passes the verifier's admission; many tokens sign hashes or framed data instead, which is not this format |
| a hardware random-number generator feeding the above | additive only, never a replacement for the operating system CSPRNG |

**Not acceptable:** a brainwallet or any key derived from a human-chosen phrase; dice, cards or coin flips unless a separate, audited ceremony specifies and reviews them; a timestamp, a UUID, a user name, a machine name or an environment variable as a seed or as entropy; a key generated on a networked machine or a general workstation; a key generated by a script that has not been read and hash-compared by the witness; a deterministic seed of any kind (only the synthetic rehearsal uses one, because it is a public label).

**Steps:**

1. The operator generates the root key pair with the pinned script. The private key is written only to the encrypted ephemeral volume (and never printed, copied or typed); only the **public key** is shown.
2. The operator writes the **bootstrap** (section 8) with the public key, the key id, `rootEpoch` and the one root purpose to the output medium.
3. The witness reads the public key from the medium, recomputes the bootstrap digest on a second machine and compares it with the operator's, aloud, in groups of eight characters. Event `ROOT_PUBLIC_KEY_RECORDED` records the digest, never the key material beyond what is public.
4. The operator creates the backups (section 9; event `BACKUP_CREATED`), then the drill (section 10; event `BACKUP_RECOVERY_TESTED`).
5. The first **operational** key pair is generated on the device where it will be used, never on the ceremony machine (section 11). Its **public key** is brought into the room as printed or hand-typed text, typed by the operator and read back by the witness against the destination device's display, and the root authorizes it (event `OPERATIONAL_KEY_AUTHORIZED`). No operational private key enters or leaves the room.
6. The working secrets are removed (section 18; event `WORKING_SECRET_REMOVED`) and the ceremony is closed (`CEREMONY_CLOSED`).

The checklist items attested at each step are in appendix B. A step that cannot be completed as written stops the ceremony: it is not improvised.

## 8. Public bootstrap

The bootstrap is the only thing a verifier pins. It is closed public material (specification section 24.5):

```text
{ "type": "walletwall.wallprint.governance-bootstrap", "formatVersion": "0.1", "rootEpoch": "<n>",
  "root": { "keyId": "<token>", "algorithm": "ED25519", "publicKey": "<64 lower-case hex>", "purposes": [ "CHECKPOINT_KEY_AUTHORIZATION" ] } }
```

- **The fingerprint** is `bootstrapDigest`, shown as eight groups of eight hex characters. It is what people compare.
- **Distribution is a policy, not a signature.** A consumer pins the fingerprint only when at least two **distinct origins** report the same one: for example a verifier release bundle distributed by a channel other than the repository's own releases, WalletWall's own site, a registry publication, a printed card handed over in person. A GitHub repository, its releases, a bundle served from them and its documentation are **one origin**; GitHub alone is not an independent trust root. The consumer classifies the origins; no verifier can know whether they are independent in fact.
- **Publish at least two origins before announcing,** and publish nothing else with it (no private key, no seed, no transcript output beyond section 17).
- **A verifier never learns its first root from a checkpoint,** an authorization or the registry. If a consumer cannot pin through two origins, it must say so (`BOOTSTRAP_UNPINNED`): the verifier then relies on nothing (no trust root, no held state, no anchors) rather than passing quietly.
- **No remote trust service is built.**

## 9. Backup

The root private key is backed up so that the loss of any one copy, place or person loses nothing, and so that the theft of any one copy, place or person exposes nothing.

| Model | Verdict |
| --- | --- |
| **encrypted removable-media copies in separate places** | **chosen** |
| paper or encoded-seed backup | acceptable as an additional offline copy only if it is encrypted in the same way or stored as a sealed, tamper-evident item with the same custody rules; a plain seed on paper is a bearer secret |
| hardware-token storage | acceptable as a copy only if the token can be duplicated without exposing the key; otherwise it is a single point of loss |
| a custom secret-sharing scheme | not adopted: it adds a construction to implement, test and lose, without a requirement that three ordinary encrypted copies do not meet |
| no backup | rejected: loss of the root then forces a consumer reset for an ordinary accident |

Minimums (`BACKUP_MINIMUMS`, checked by the transcript validator on a live ceremony):

- at least **3 encrypted copies** on removable media, each made with a mature, reviewed encryption tool (an authenticated, passphrase-based format with a memory-hard key derivation, such as age's scrypt mode; the first live-ceremony lane pins the exact format and its cost parameters), never a home-made format and never an unpinned PKCS#8 password setting;
- in at least **2 physically separate places**;
- at least **2 passphrase envelopes** (a long passphrase generated on the ceremony machine from the operating system CSPRNG, written by hand, sealed in tamper-evident envelopes) in at least **2 places that hold no media copy**;
- **no place and no person holds both a media copy and its passphrase;**
- an access list for every place, recorded outside this repository; authentication of the custodian at every access;
- **a recovery drill** (section 10) before the working copy is removed, and a periodic drill afterwards.

**Never store a backup, a passphrase, a seed or a key in:** GitHub or any repository, a cloud drive or sync folder, a password manager's notes unless a reviewer has explicitly accepted that custody, a repository or CI secret, a CI artifact, a developer home directory, an email or chat message, a ticket, or a photograph.

## 10. Recovery

**Drill (part of every ceremony, event `BACKUP_RECOVERY_TESTED`).** Before the working copy is removed:

1. the operator decrypts one backup copy on the ceremony machine, using the sealed passphrase, into the encrypted ephemeral volume;
2. the operator derives the public key from the recovered key and writes the bootstrap it would produce;
3. the witness compares that bootstrap's digest with the recorded one. **They must be equal.** Any difference stops the ceremony: the backup is wrong and is remade;
4. **every copy is drilled before the ceremony closes**: a copy that was never decrypted is not known to work. The event records how many copies were drilled (`copiesDrilled`), and the transcript validator refuses fewer than the number of copies made (`BACKUP_NOT_ALL_DRILLED`). Periodic rehearsals drill at least one copy per place each time.

**If one backup is lost or damaged:** the others recover the root; the lost copy's passphrase envelope is treated as exposed if the copy might have been taken, and a fresh backup is made in a ceremony of kind `OPERATIONAL_KEY_ACTION` or a dedicated backup ceremony. If a copy might have been stolen, the root's exposure is assessed as in section 16.

**If all backups are lost:** the root is lost (section 15). There is no other recovery.

**Periodic rehearsal:** at least once a year, and whenever a custodian changes, a drill proves a backup still decrypts and still yields the pinned fingerprint. The drill's transcript is kept.

## 11. Operational-key authorization

1. The operational key pair is generated **on the device where it will be used** (section 11, item 5), never on the ceremony machine and never carried through it. The ceremony receives only the operational **public key**, as printed or hand-typed text (never carried on removable media from the device), which both participants compare with what the destination device displays (`OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE`): this is the control against a substituted key. It is **a different key**, never the root key and never the WalletWall publication key.
2. The root signs one **authorization statement** (specification section 24.6) naming the operational key, its grant (`REGISTRY_LEDGER_CHECKPOINT` only), the root epoch and the generation (1 for the first). The signed bytes are `UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))`, with the authorization's own domain tag, produced by the pinned script and never by hand.
3. The witness checks the statement on a second machine before and after signing: the root key, the epoch, the generation, the authorized public key, the grant and, for a later generation, the superseded digest, the standing and the retained state.
4. The public authorization is written to the output medium; it is verified (section 19) before it is published.
5. **Custody of the operational private key** is decided before the ceremony. It must satisfy: **not in CI, not on the deployment host, not the WalletWall publication key, not in a repository, protected at rest on a dedicated device, used only to sign checkpoints, and replaceable by the root at any time.** The constraints bind the next operational lane; this lane does not choose a device.
6. No private key leaves the room and none enters it: the output medium holds only public artifacts (`ONLY_PUBLIC_ARTIFACTS_EXPORTED`), the operational private key never touches the ceremony machine, and the root's only persistent copies are the encrypted backups.

## 12. Rotation

**Operational key (routine, expected).** A ceremony of kind `OPERATIONAL_KEY_ACTION`:

1. the root is **restored** from a backup onto the ephemeral volume (event `ROOT_KEY_RESTORED`), and its public key is checked against the **pinned** bootstrap;
2. a new operational key pair is generated on its destination device, and only its public key is brought to the ceremony;
3. generation *n* + 1 is signed: it authorizes the new key, names the digest of generation *n*, marks the old key `RETIRED`, and sets `retainedAt` to the committed state of the **last checkpoint the old key signed** (read from public data, not memory);
4. the authorization is verified, published, and the transcript is closed.

The old key stays historically identifiable; a checkpoint at exactly the retained state stays relied upon, and no other does; **new checkpoints require the new key**.

**Root (rare, exceptional).** Root rotation is a **reset** (section 16): a new root at a higher epoch with a different key, pinned by consumers through two distinct origins. No previous-root signature is used as a trust basis: an old root signing a new one proves nothing if the old root is compromised, a new root signing the old one proves only the new holder's access, and cross-signing is evidence of continuity, never a basis. A voluntary rotation may publish both ceremonies' transcripts and an announcement as continuity evidence; no verifier reads it.

## 13. Retirement

A key is retired by the **next authorization**, never on its own: generation *n* + 1 names it with standing `RETIRED` and its `retainedAt`. There is no retirement without a replacement: the same ceremony authorizes the successor, so a state in which nothing is relied upon never arises from routine work. A retired key's private material is destroyed by the custodian once the replacement is relied upon and the retired key's last checkpoint is published; destruction is a custody act recorded outside this repository, and it is not a control (section 5): the key is retired by the root's signature, not by what happens to the device.

## 14. Revocation

Revocation is **publication, not an online check**. A key believed exposed is marked `COMPROMISED` by the next authorization, with `retainedAt` null (nothing retained) or the last state the participants independently reviewed. The authorization is published through the same origins as the bootstrap's announcements. A verifier that holds the newer state refuses the old key's later checkpoints; a verifier that has not seen it still relies on the old key. That latency is real, is reported (`GOVERNANCE_STATE_UNHELD`) and cannot be removed offline. There is no OCSP-like service and none is built. Historical signatures stay cryptographically valid; **reliance changes**, and the result reports the two separately.

After a compromise, the replacement key signs a fresh checkpoint over the logs as the participants reviewed them: a checkpoint commits both logs by head, so it re-establishes the history the compromised key's checkpoints no longer vouch for.

## 15. Root loss

If every copy of the root is irrecoverably lost:

- existing signed checkpoints remain **cryptographically valid**, and under the root a consumer already pins they remain relied upon; the current operational key keeps working;
- **no new authorization can be produced.** Nothing else can sign for the root, so an operational key can no longer be replaced;
- new governance authorization requires a **new root**, which consumers must **explicitly bootstrap**: a ceremony of kind `ROOT_BOOTSTRAP` at a higher epoch with a different key, pinned by at least two distinct origins, after which consumers raise their minimum epoch;
- what the old lineage signed stays valid and is not authorized under the new root; the new root authorizes a new operational key, which signs a fresh checkpoint.

There is no magic recovery that preserves trust without an existing authorized key, and none is offered.

## 16. Root compromise

The highest-severity event. **A compromised root cannot be repaired by anything the root signs**: whoever holds the key signs valid authorizations for a key of their choosing, and the defender's replacement signed by the same key verifies exactly as the attacker's does.

1. **Stop.** Treat the root as exposed the moment a copy, a passphrase or the ceremony machine might have been exposed; do not wait for proof.
2. **Announce through every origin** that the root is compromised and that consumers must not accept anything newly signed under it; name the fingerprint concerned.
3. **Hold a ceremony of kind `ROOT_BOOTSTRAP`**: a new root key at a **higher epoch**, a **different key**, with a new operational key authorized in the same session.
4. **Publish the new bootstrap through at least two distinct origins** and invite independent comparison of its fingerprint. This is the out-of-band trust reset; **it is the repair**.
5. Consumers pin the new bootstrap and raise their minimum epoch; the old root is then refused (`BOOTSTRAP_EPOCH_BELOW_MINIMUM`), so the attacker's authorizations are worthless to them.
6. **Separate two questions.** *Cryptographic validity:* every signature the old lineage made is unchanged and still valid. *Continued reliance:* nothing the old lineage signed is authorized under the new root, so it is no longer relied upon; whether to rely on any history is the consumer's decision, helped by any checkpoint anchor it held before the compromise. The new root's operational key signs a fresh checkpoint over the logs as reviewed.

A root that has not been reset is still pinned by consumers that have not heard: that window is the cost, and it is announced, not hidden.

## 17. Transcript and evidence

The ceremony transcript (specification section 24.12) is a closed, structured record. It is safe to commit publicly because it can hold only public data, and it records **what participants attest, not proof that the machine was uncompromised or that anything happened**.

**May be published:** the transcript; the ceremony version and kind; the public bootstrap and its fingerprint; the public authorizations; tool and script versions and digests; the source commit; the operating-system image description and digest; participant role acknowledgements (pseudonymous ids); the completed checklist; backup counts (copies, places, envelopes); the completion of the recovery drill.

**Never published:** the private seed or key; any entropy; backup contents; a recovery secret or passphrase; an encrypted key blob, unless a reviewed design says so; screenshots, photographs or terminal captures that could show any of them; custodian names and places beyond what the access list needs; raw shell output.

The events are `CEREMONY_OPENED`, `ROLES_ACKNOWLEDGED`, `TOOLING_VERIFIED`, `NETWORK_CONFIRMED_OFFLINE`, `ROOT_PUBLIC_KEY_RECORDED`, `BACKUP_CREATED`, `BACKUP_RECOVERY_TESTED`, `ROOT_KEY_RESTORED`, `OPERATIONAL_KEY_AUTHORIZED`, `WORKING_SECRET_REMOVED` and `CEREMONY_CLOSED`, each attested by **both** roles with its exact checklist (appendix B). Any digest it records must equal the digest of the public artifact it names. Run the scanner over every output before publishing (section 19): a finding is a code and a position, never the matched text.

## 18. Cleanup

1. Confirm that the output medium holds **only** the public artifacts listed in section 17 (event `CEREMONY_CLOSED`, checklist `ONLY_PUBLIC_ARTIFACTS_EXPORTED`).
2. **Power off the ephemeral machine** and remove the live medium; the working key existed only in memory and the encrypted ephemeral volume (`EPHEMERAL_MEDIA_POWERED_OFF`, `NO_PRIVATE_MATERIAL_ON_PERSISTENT_STORAGE`).
3. Seal the backup media and the passphrase envelopes in tamper-evident bags; hand each to its custodian and record the hand-over on paper kept with that custodian.
4. Destroy the paper used for the fingerprint comparison, and any scratch paper, by shredding and burning.
5. Anything persistent that ever touched key material (a disk, a card) is destroyed, not wiped.
6. Remember what this does not do: it does not prove that nothing was captured. It reduces exposure; it is not a guarantee.

## 19. Post-ceremony verification

On a machine with the repository checked out and **no secret anywhere on it**:

1. **Verify the authorization chain** under the bootstrap, with the fingerprint pinned (`verifyGovernance` with `expectedBootstrapDigest`): the chain must be `VALID`, the bootstrap `PINNED`, and the head generation the one just signed.
2. **Verify the transcript** against the public artifacts (`verifyCeremonyTranscript` with the bootstrap, the authorizations and the published tooling list): no reason, no limitation.
3. **Verify a checkpoint** signed by the new operational key under the derived trust root (`verifyGovernedCheckpoint`): `reliance` must be `RELIED_UPON`.
4. **Scan every output** with the secret scanner (`scanCeremonyFile`): no finding.
5. **Compare the fingerprint** with the witness's independent copy and with each origin it was published to.
6. **Rehearse the reset path** once with the synthetic rehearsal (`npm run rehearse:wallprint-governance-ceremony`), so the people who may need it have seen it.
7. Run `npm run verify` in the repository the verifier release is built from. CI performs the same checks and holds no secret.

## 20. Prohibited actions

- Generating, holding or using a production root or operational key in Git, GitHub, CI, GitHub Actions, a hosted runner or any service.
- Any repository secret, any identity-token or OIDC to key-management signing setup, any KMS, HSM-as-a-service or hosted signing endpoint.
- Any command in this repository that creates a production root or key.
- Generating a key on a networked machine or a general workstation, or from human-generated entropy, a timestamp, a UUID, a user name or an environment variable.
- Using the clipboard, a shell history, terminal logging, screen capture or a camera during the ceremony; capturing raw output into the transcript.
- Storing a key, seed, passphrase or backup in a repository, a cloud drive, a sync folder, a password manager's notes (without explicit review), a developer home directory, a ticket or a message.
- Relying on deletion, wiping or formatting as protection.
- Letting one person act as both operator and witness, or hold a backup copy together with its passphrase.
- Using the root for anything but authorizing an operational key; granting an operational key any purpose but the checkpoint purpose; reusing the root key as an operational key or as the WalletWall publication key.
- Treating a root-signed "replacement root" as recovery from a root compromise, or accepting a bootstrap pinned from one origin.
- Reading a governance signature as a claim that any record, assessor or issuer is correct, or a transcript as proof that a ceremony happened.
- Committing a synthetic key, bootstrap or transcript as if it were production, or a production artifact under a synthetic name.

## Appendix A: threat model

For every threat, what the ceremony protects and what it cannot. The identifiers `T38` to `T57` in specification section 17 are these rows, in order.

| # | Threat | What the ceremony protects | What it cannot protect |
| --- | --- | --- | --- |
| 1 | Compromised developer workstation | the root key never touches one (generation and use are on ephemeral, offline media from a hash-verified image) and the operational key is generated on its own dedicated device | a ceremony machine or image that is itself compromised |
| 2 | Compromised GitHub account | no key or secret is in GitHub; GitHub is one origin, and a pin needs two distinct ones | a repository artifact the verifier's distributor ships; the second origin and the pinned fingerprint are the defence |
| 3 | Compromised CI | CI holds no secret and signs nothing; it only verifies public artifacts | a later lane that adds a signing step on purpose |
| 4 | Malicious dependency | the lane adds none; the ceremony uses a pinned, hash-verified tool list on offline media | a malicious pinned tool |
| 5 | Accidental private-key commit | closed public schemas with no secret slot; the scanner; ignore rules for key files; the procedure keeps keys off any machine with a repository | a secret that does not look like one; a participant who ignores the procedure |
| 6 | Clipboard leakage | the procedure forbids clipboard use; the ephemeral image has no clipboard manager | a malicious firmware or a participant's other device |
| 7 | Terminal-history leakage | no shell history on the ephemeral image; keys are never typed or printed | a tool that logs its own state |
| 8 | Shell-transcript leakage | no terminal capture; the transcript holds attestations only | a recording device in the room |
| 9 | Cloud-sync leakage | no synced storage on the ceremony machine or the media | a custodian who copies a backup to a synced folder |
| 10 | Backup theft | backups are encrypted; the passphrase is stored apart from every copy; no place holds both | collusion of the holders of a copy and its passphrase; a weak passphrase |
| 11 | Lost root key | three encrypted copies in two places and two passphrase envelopes in two other places; a drill; periodic rehearsal | loss of every copy: a new root and an explicit consumer reset follow (section 15) |
| 12 | Lost operational key | the root replaces it at any time | a window until the replacement is published |
| 13 | One participant acting maliciously | two roles on every event; independent fingerprint comparison; no single custody of media and passphrase | two colluding participants, or one person filling both roles |
| 14 | Forged ceremony record | the transcript is cross-checked against public artifacts, and only the root's signature authorizes a key | a fabricated transcript of a believable ceremony: evidence for review, not proof |
| 15 | Unauthorized operational-key authorization | only the pinned root's signature, over the exact statement, in its own domain, for one purpose, authorizes a key | a key the genuine root signs by mistake |
| 16 | Old operational key continuing after rotation | the next authorization retires it and names the last state the root stands behind; a checkpoint past it is not relied upon | a verifier that has not seen the newer generation |
| 17 | Compromised operational key | the root replaces it and marks it `COMPROMISED`; it holds no authorization power | the window before the replacement is seen |
| 18 | Compromised root | an out-of-band reset to a new root at a higher epoch with a different key, confirmed by two distinct origins | the window until each consumer resets; and nothing the compromised root signs can repair it |
| 19 | Rollback to an old root a consumer once pinned | the consumer's minimum epoch; a held generation refuses a stale or forked chain | a consumer that holds neither |
| 20 | Fake public bootstrap file | a closed, deterministic artifact whose fingerprint must match the one pinned through two distinct origins | a consumer that pins from one origin, or from the artifact's own channel |

## Appendix B: checklist by event

A ceremony is complete only when every event below is present, in order, attested by **both** roles, with exactly this checklist. The order for a root bootstrap is the order below; an operational-key action replaces the two backup events with `ROOT_KEY_RESTORED`.

| Event | Checklist items attested |
| --- | --- |
| `CEREMONY_OPENED` | none |
| `ROLES_ACKNOWLEDGED` | `ROLES_UNDERSTOOD` |
| `TOOLING_VERIFIED` | `MEDIA_BOOTED_FROM_VERIFIED_IMAGE`, `TOOL_DIGESTS_MATCH_PUBLISHED` |
| `NETWORK_CONFIRMED_OFFLINE` | `NETWORK_PHYSICALLY_DISABLED` |
| `ROOT_PUBLIC_KEY_RECORDED` | `KEY_FROM_OS_CSPRNG`, `NO_CLIPBOARD_USED`, `NO_SECRET_IN_TRANSCRIPT`, `NO_SHELL_HISTORY_WRITTEN` |
| `BACKUP_CREATED` | `BACKUP_ENCRYPTED`, `NO_CLOUD_OR_REPOSITORY_STORAGE`, `PASSPHRASE_STORED_APART_FROM_MEDIA` |
| `BACKUP_RECOVERY_TESTED` | `RECOVERED_PUBLIC_KEY_MATCHES` |
| `ROOT_KEY_RESTORED` | `NO_CLIPBOARD_USED`, `NO_SHELL_HISTORY_WRITTEN`, `RESTORED_PUBLIC_KEY_MATCHES_PINNED_BOOTSTRAP` |
| `OPERATIONAL_KEY_AUTHORIZED` | `AUTHORIZATION_SIGNED_OFFLINE`, `OPERATIONAL_KEY_DISTINCT_FROM_ROOT`, `OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE` |
| `WORKING_SECRET_REMOVED` | `EPHEMERAL_MEDIA_POWERED_OFF`, `NO_PRIVATE_MATERIAL_ON_PERSISTENT_STORAGE` |
| `CEREMONY_CLOSED` | `ONLY_PUBLIC_ARTIFACTS_EXPORTED` |

`BACKUP_CREATED` also records four counts (copies, places, envelopes, envelope places); a live ceremony must meet the floor of section 9. The two roles in a transcript are `OPERATOR` and `WITNESS`, and every event names both. A ceremony is of mode `SYNTHETIC_REHEARSAL` or `LIVE`: a rehearsal names only synthetic keys and a live ceremony names none, and the id must agree with the mode.

## Appendix C: the synthetic rehearsal

`npm run rehearse:wallprint-governance-ceremony` runs a full rehearsal with keys labelled `SYNTHETIC-NON-PRODUCTION-...`, deterministic and in memory, and `npm run verify:wallprint-governance-vectors` holds its record. It generates no key and writes nothing. The fifteen steps and what the verifiers said:

| Step | What is modelled | Result |
| --- | --- | --- |
| 1 | isolated environment | tooling list and an offline confirmation in every transcript; nothing persistent |
| 2 | synthetic root generation | a synthetic root, working copy present |
| 3 | public root artifact | a bootstrap and its fingerprint, `PINNED` |
| 4 | backup creation | three sealed synthetic copies |
| 5 | operational key generation, on its own (modelled) device | a distinct synthetic key; only its public key reaches the ceremony |
| 6 | root authorization of the operational key | generation 1, chain `VALID` |
| 7 | the operational key signs a synthetic checkpoint | two checkpoints over the synthetic registry and ledger |
| 8 | verification using only the public bootstrap | signature `VALID`, signer `AUTHORIZED`, reliance `RELIED_UPON`, anchors authenticated |
| 9 | operational-key rotation | generation 2; the retired key is relied upon at exactly its retained state and nowhere else (a checkpoint below it and one beyond it are both refused); the new key is relied upon |
| 10 | old-key retirement | a late checkpoint by the retired key has a `VALID` signature and is `NOT_RELIED_UPON` |
| 11 | root recovery from backup | working copy removed; recovery gives the same public key and fingerprint; a wrong passphrase, a damaged copy, another key's backup and no backup all fail |
| 12 | replacement operational authorization | generation 3, `COMPROMISED`, signed by the recovered root |
| 13 | root loss | no backup, no new authorization possible; existing state still verifies; the reset is the only way forward |
| 14 | root compromise | the attacker's and the defender's chains both verify under the old root; only a verifier holding one side sees the fork |
| 15 | trust reset | two distinct origins accept; one origin, the same origin twice and the same root key are refused; history keeps a valid signature and loses reliance |

The three ceremonies that would have produced these artifacts have complete transcripts with no secret-looking material.

## Appendix D: what this runbook does not decide

The ceremony script and the tool pins; the operational key's device and custody; the publication layout and gate for bootstraps, authorizations and checkpoints; the resolver and browser binding; detection of equivocation by a root or an operational key; binding a participant token to a person and signing a transcript; a post-quantum root. They are follow-ups (specification sections 24.16 and 24.17), not omissions this document papers over.
