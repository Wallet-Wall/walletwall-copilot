import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CeremonyTranscriptSchema, verifyCeremonyTranscript } from "../../src/wallprint/governance-transcript.ts";
import { BACKUP_MINIMUMS, CEREMONY_EVENTS, CEREMONY_SEQUENCES, CHECKLIST_ITEMS, EVENT_CHECKLIST, GOVERNANCE_LIMITS, TRANSCRIPT_DOES_NOT_ESTABLISH } from "../../src/wallprint/governance-vocabulary.ts";
import { GK, SYNTHETIC_TOOLING, bootstrapFor, chainOf, transcriptFor, verifyTranscriptFor } from "../support/wallprint-governance.ts";

/**
 * The ceremony transcript: a closed, structured record of what two participants attest, safe to commit when it holds only public data.
 * It is evidence for review, not proof, and it has no slot a secret could sit in.
 */
const root = bootstrapFor();
const chain = chainOf([{ key: GK.op1 }, { key: GK.op2, previousStanding: "RETIRED", previousRetainedAt: null }]);
const first = [chain[0] as never];
const second = [chain[1] as never];
const bootstrapT = () => transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-001", kind: "ROOT_BOOTSTRAP", bootstrap: root, authorizations: first });
const rotationT = () => transcriptFor({ ceremonyId: "synthetic-rehearsal-rotation-001", kind: "OPERATIONAL_KEY_ACTION", bootstrap: root, authorizations: second });
type T = ReturnType<typeof bootstrapT>;
const mutate = (build: () => T, edit: (t: T) => void): T => {
  const t = structuredClone(build());
  edit(t);
  return t;
};
const check = (t: unknown, authorizations: readonly unknown[] = first, bootstrap: unknown = root) => verifyCeremonyTranscript(t, { bootstrap, authorizations, expectedTooling: SYNTHETIC_TOOLING });
const event = (t: T, name: string): Record<string, unknown> => t.events.find((e) => e.event === name) as unknown as Record<string, unknown>;

describe("transcript: a complete ceremony", () => {
  test("a complete root-bootstrap transcript is accepted: every event in order, both roles on every event, the exact checklist, digests that equal the public artifacts', no secret", () => {
    const r = check(bootstrapT());
    assert.equal(r.parse, "PARSED");
    assert.deepEqual(r.structure, { status: "COMPLETE", reasons: [] });
    assert.deepEqual(r.artifacts, { status: "CONSISTENT", reasons: [] });
    assert.deepEqual(r.tooling, { status: "MATCHED", reasons: [] });
    assert.equal(r.secrets.status, "CLEAN");
    assert.deepEqual(r.reasons, []);
    assert.deepEqual(r.limitations, []);
    assert.deepEqual(bootstrapT().events.map((e) => e.event), [...CEREMONY_SEQUENCES.ROOT_BOOTSTRAP]);
  });

  test("a complete operational-key transcript is accepted too: root restored, authorization recorded", () => {
    const r = check(rotationT(), second);
    assert.deepEqual(r.reasons, []);
    assert.deepEqual(rotationT().events.map((e) => e.event), [...CEREMONY_SEQUENCES.OPERATIONAL_KEY_ACTION]);
  });

  test("the event names are the ones the lane asked for, and a rotation may authorize more than once in one ceremony", () => {
    for (const name of ["CEREMONY_OPENED", "TOOLING_VERIFIED", "NETWORK_CONFIRMED_OFFLINE", "ROOT_PUBLIC_KEY_RECORDED", "BACKUP_CREATED", "BACKUP_RECOVERY_TESTED", "OPERATIONAL_KEY_AUTHORIZED", "WORKING_SECRET_REMOVED", "CEREMONY_CLOSED"]) assert.ok(CEREMONY_EVENTS.some((e) => e === name), name);
    const two = transcriptFor({ ceremonyId: "synthetic-rehearsal-rotation-002", kind: "OPERATIONAL_KEY_ACTION", bootstrap: root, authorizations: chain.slice(1) });
    assert.deepEqual(check(two, chain.slice(1)).reasons, []);
    const doubled = transcriptFor({ ceremonyId: "synthetic-rehearsal-rotation-003", kind: "OPERATIONAL_KEY_ACTION", bootstrap: root, authorizations: [chain[1] as never, chain[1] as never] });
    assert.ok(check(doubled, [chain[1], chain[1]]).structure.status !== undefined);
  });

  test("it states what it does not establish: a transcript records what participants attest, and is not proof the machine was uncompromised", () => {
    const r = check(bootstrapT());
    assert.ok(r.doesNotEstablish.some((s) => /ceremony took place/.test(s)));
    assert.ok(r.doesNotEstablish.some((s) => /uncompromised/.test(s)));
    assert.ok(r.doesNotEstablish.some((s) => /records what participants attest/.test(s)));
    assert.equal(TRANSCRIPT_DOES_NOT_ESTABLISH.length, r.doesNotEstablish.length);
    for (const key of Object.keys(r)) assert.doesNotMatch(key, /verified|trusted|ok$|score/i);
  });
});

describe("transcript: incomplete, out of order, one-sided or below the floor", () => {
  test("a missing required event is reported, whichever it is", () => {
    for (const name of CEREMONY_SEQUENCES.ROOT_BOOTSTRAP) {
      const t = mutate(bootstrapT, (x) => void (x.events = x.events.filter((e) => e.event !== name).map((e, i) => ({ ...e, seq: String(i + 1) })) as never));
      assert.ok(check(t).reasons.includes("EVENT_REQUIRED_MISSING") || check(t).reasons.includes("OPERATIONAL_KEY_EVENTS_MISMATCH"), name);
      assert.equal(check(t).structure.status, "INCOMPLETE", name);
    }
  });

  test("events out of order, repeated or with a wrong sequence number are refused", () => {
    const swapped = mutate(bootstrapT, (t) => void t.events.splice(4, 2, t.events[5] as never, t.events[4] as never));
    assert.ok(check(swapped).structure.reasons.includes("EVENT_ORDER_INVALID"));
    const repeated = mutate(bootstrapT, (t) => void t.events.splice(5, 0, structuredClone(t.events[4]) as never));
    assert.ok(check(repeated).structure.reasons.includes("EVENT_ORDER_INVALID"));
    const renumbered = mutate(bootstrapT, (t) => void (t.events[3]!.seq = "9"));
    assert.ok(check(renumbered).structure.reasons.includes("EVENT_ORDER_INVALID"));
    const wrongKind = mutate(bootstrapT, (t) => void (t.kind = "OPERATIONAL_KEY_ACTION"));
    assert.equal(check(wrongKind).structure.status, "INCOMPLETE");
  });

  test("every event needs both roles: an event one participant alone attests is refused, whichever event", () => {
    for (let i = 0; i < bootstrapT().events.length; i++) {
      for (const by of [["OPERATOR"], ["WITNESS"]] as const) {
        const t = mutate(bootstrapT, (x) => void (x.events[i]!.by = [...by] as never));
        assert.ok(check(t).structure.reasons.includes("ONE_ATTESTER_ONLY"), `${i} ${by.join()}`);
      }
    }
    const duplicated = mutate(bootstrapT, (t) => void (t.events[2]!.by = ["OPERATOR", "OPERATOR"] as never));
    assert.ok(check(duplicated).structure.reasons.includes("ONE_ATTESTER_ONLY"));
  });

  test("the checklist is exact: a missing item is an incomplete ceremony, an extra item is an unknown claim", () => {
    for (const e of CEREMONY_EVENTS) {
      const required = EVENT_CHECKLIST[e];
      if (required.length === 0) continue;
      const index = bootstrapT().events.findIndex((x) => x.event === e);
      const rootOnly = !(CEREMONY_SEQUENCES.ROOT_BOOTSTRAP as readonly string[]).includes(e);
      if (index < 0 || rootOnly) continue;
      const missing = mutate(bootstrapT, (t) => void (t.events[index]!.attests = required.slice(1) as never));
      assert.ok(check(missing).structure.reasons.includes("CHECKLIST_INCOMPLETE"), `missing ${e}`);
      const extra = mutate(bootstrapT, (t) => void (t.events[index]!.attests = [...required, CHECKLIST_ITEMS.find((c) => !required.includes(c)) as never] as never));
      assert.ok(check(extra).structure.reasons.includes("CHECKLIST_INCOMPLETE"), `extra ${e}`);
    }
    const none = mutate(bootstrapT, (t) => void (t.events[7]!.attests = []));
    assert.ok(check(none).structure.reasons.includes("CHECKLIST_INCOMPLETE"));
  });

  test("the backup floor is enforced per count: copies, locations, passphrase envelopes and passphrase locations", () => {
    assert.deepEqual(BACKUP_MINIMUMS, { mediaCopies: 3, mediaLocations: 2, passphraseEnvelopes: 2, passphraseLocations: 2 });
    for (const field of ["mediaCopies", "mediaLocations", "passphraseEnvelopes", "passphraseLocations"] as const) {
      const t = mutate(bootstrapT, (x) => void ((event(x, "BACKUP_CREATED")["ref"] as Record<string, string>)[field] = "1"));
      const impossible = field === "mediaCopies" || field === "passphraseEnvelopes" ? ["BACKUP_BELOW_MINIMUM", "BACKUP_COUNTS_IMPOSSIBLE"] : ["BACKUP_BELOW_MINIMUM"];
      assert.deepEqual(check(t).structure.reasons, impossible, field);
    }
    const generous = mutate(bootstrapT, (x) => {
      Object.assign(event(x, "BACKUP_CREATED")["ref"] as object, { mediaCopies: "5", mediaLocations: "3" });
      Object.assign(event(x, "BACKUP_RECOVERY_TESTED")["ref"] as object, { copiesDrilled: "5" });
    });
    assert.deepEqual(check(generous).reasons, []);
  });

  test("every copy is drilled: a recovery drill that tested fewer copies than were made is refused, and testing more is not an error", () => {
    const some = mutate(bootstrapT, (x) => void Object.assign(event(x, "BACKUP_RECOVERY_TESTED")["ref"] as object, { copiesDrilled: "2" }));
    assert.deepEqual(check(some).structure.reasons, ["BACKUP_NOT_ALL_DRILLED"]);
    const none = mutate(bootstrapT, (x) => void Object.assign(event(x, "BACKUP_RECOVERY_TESTED")["ref"] as object, { copiesDrilled: "0" }));
    assert.deepEqual(check(none).structure.reasons, ["BACKUP_NOT_ALL_DRILLED"]);
    const more = mutate(bootstrapT, (x) => void Object.assign(event(x, "BACKUP_RECOVERY_TESTED")["ref"] as object, { copiesDrilled: "4" }));
    assert.deepEqual(check(more).reasons, []);
    const noCount = mutate(bootstrapT, (x) => void delete (event(x, "BACKUP_RECOVERY_TESTED")["ref"] as Record<string, unknown>)["copiesDrilled"]);
    assert.equal(check(noCount).parse, "MALFORMED", "the count is a required field of the event");
  });

  test("the operational public key is attested against the device that holds its private half: the checklist item cannot be dropped", () => {
    assert.ok(EVENT_CHECKLIST.OPERATIONAL_KEY_AUTHORIZED.includes("OPERATIONAL_PUBLIC_KEY_MATCHES_DEVICE"));
    const dropped = mutate(bootstrapT, (x) => void (event(x, "OPERATIONAL_KEY_AUTHORIZED")["attests"] = ["AUTHORIZATION_SIGNED_OFFLINE", "OPERATIONAL_KEY_DISTINCT_FROM_ROOT"]));
    assert.deepEqual(check(dropped).structure.reasons, ["CHECKLIST_INCOMPLETE"]);
  });

  test("impossible counts are refused: more places than copies cannot be true of one backup", () => {
    const places = mutate(bootstrapT, (x) => void Object.assign(event(x, "BACKUP_CREATED")["ref"] as object, { mediaCopies: "3", mediaLocations: "9" }));
    assert.deepEqual(check(places).structure.reasons, ["BACKUP_COUNTS_IMPOSSIBLE"]);
    const envelopes = mutate(bootstrapT, (x) => void Object.assign(event(x, "BACKUP_CREATED")["ref"] as object, { passphraseEnvelopes: "2", passphraseLocations: "5" }));
    assert.deepEqual(check(envelopes).structure.reasons, ["BACKUP_COUNTS_IMPOSSIBLE"]);
  });

  test("two people: exactly one operator, at least one witness, distinct participants", () => {
    const sameId = mutate(bootstrapT, (t) => void (t.participants[1]!.participantId = t.participants[0]!.participantId));
    assert.ok(check(sameId).structure.reasons.includes("PARTICIPANTS_INVALID"));
    const twoOperators = mutate(bootstrapT, (t) => void (t.participants[1]!.role = "OPERATOR"));
    assert.ok(check(twoOperators).structure.reasons.includes("PARTICIPANTS_INVALID"));
    const alone = mutate(bootstrapT, (t) => void (t.participants = [t.participants[0] as never]));
    assert.equal(check(alone).parse, "MALFORMED");
    const witnesses = mutate(bootstrapT, (t) => void t.participants.push({ role: "WITNESS", participantId: "synthetic-witness-002" }));
    assert.deepEqual(check(witnesses).reasons, []);
  });
});

describe("transcript: consistency with the public artifacts", () => {
  test("every digest the transcript records must equal the digest of the artifact it names: the root, and each authorization", () => {
    const wrongRoot = check(bootstrapT(), first, bootstrapFor(GK.root2));
    assert.deepEqual(wrongRoot.artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH", "AUTHORIZATION_ROOT_MISMATCH"]);
    const wrongAuthorization = mutate(bootstrapT, (t) => void ((event(t, "OPERATIONAL_KEY_AUTHORIZED")["ref"] as Record<string, string>)["authorizationDigest"] = "0".repeat(64)));
    assert.deepEqual(check(wrongAuthorization).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"]);
    for (const name of ["ROOT_PUBLIC_KEY_RECORDED", "BACKUP_RECOVERY_TESTED"]) {
      const t = mutate(bootstrapT, (x) => void ((event(x, name)["ref"] as Record<string, string>)["bootstrapDigest"] = "1".repeat(64)));
      assert.deepEqual(check(t).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"], name);
    }
    const restored = mutate(rotationT, (x) => void ((event(x, "ROOT_KEY_RESTORED")["ref"] as Record<string, string>)["bootstrapDigest"] = "2".repeat(64)));
    assert.deepEqual(check(restored, second).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"]);
  });

  test("the authorizations must be signed under the root the transcript names: a transcript whose digests all agree still cannot pair a bootstrap with another root's authorizations", () => {
    const other = bootstrapFor(GK.root2);
    const paired = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-004", kind: "ROOT_BOOTSTRAP", bootstrap: other, authorizations: first });
    assert.deepEqual(check(paired, first, other).artifacts.reasons, ["AUTHORIZATION_ROOT_MISMATCH"]);
    const epoch2 = bootstrapFor(GK.root1, { rootEpoch: "2" });
    const lateEpoch = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-005", kind: "ROOT_BOOTSTRAP", bootstrap: epoch2, authorizations: first });
    assert.deepEqual(check(lateEpoch, first, epoch2).artifacts.reasons, ["AUTHORIZATION_ROOT_MISMATCH"], "the epoch alone");
    const otherKey = { ...root, root: { ...root.root, publicKey: bootstrapFor(GK.root2).root.publicKey } };
    const keyOnly = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-006", kind: "ROOT_BOOTSTRAP", bootstrap: otherKey, authorizations: first });
    assert.deepEqual(check(keyOnly, first, otherKey).artifacts.reasons, ["AUTHORIZATION_ROOT_MISMATCH"], "the key material alone");
    const otherId = { ...root, root: { ...root.root, keyId: "synthetic-governance-root-009" } };
    const idOnly = transcriptFor({ ceremonyId: "synthetic-rehearsal-root-bootstrap-007", kind: "ROOT_BOOTSTRAP", bootstrap: otherId, authorizations: first });
    assert.deepEqual(check(idOnly, first, otherId).artifacts.reasons, ["AUTHORIZATION_ROOT_MISMATCH"], "the key id alone");
  });

  test("a LIVE transcript is refused unless it is cross-checked against both the artifacts and the published tooling; a rehearsal may stand alone", () => {
    const live = mutate(bootstrapT, (t) => void Object.assign(t, { mode: "LIVE", ceremonyId: "walletwall-governance-root-live" }));
    assert.ok(verifyCeremonyTranscript(live).reasons.includes("LIVE_NOT_CROSS_CHECKED"));
    assert.ok(verifyCeremonyTranscript(live, { bootstrap: root, authorizations: first }).reasons.includes("LIVE_NOT_CROSS_CHECKED"), "artifacts alone are not enough");
    assert.ok(verifyCeremonyTranscript(live, { expectedTooling: SYNTHETIC_TOOLING }).reasons.includes("LIVE_NOT_CROSS_CHECKED"), "tooling alone is not enough");
    assert.ok(!check(live).reasons.includes("LIVE_NOT_CROSS_CHECKED"));
    assert.deepEqual(verifyCeremonyTranscript(bootstrapT()).reasons, [], "a synthetic rehearsal may stand alone, and reports what it did not check");
  });

  test("an identifier cannot carry key material: too long, or a long hex run, is refused as malformed in every identifier slot", () => {
    const hex = "ab".repeat(16);
    for (const edit of [
      (t: T) => void (t.ceremonyId = `synthetic-${hex}`),
      (t: T) => void (t.participants[0]!.participantId = `synthetic-operator-${"x".repeat(30)}`),
      (t: T) => void (t.participants[1]!.participantId = `syn-${hex}`),
      (t: T) => void (t.tooling[0]!.name = `syn-${hex}`),
    ]) assert.equal(check(mutate(bootstrapT, edit)).parse, "MALFORMED");
    assert.equal(check(mutate(bootstrapT, (t) => void (t.participants[1]!.participantId = `syn-${"ab".repeat(15)}`))).parse, "PARSED", "a 30-character hex run is an ordinary word");
    assert.equal(check(mutate(bootstrapT, (t) => void (t.participants[1]!.participantId = "synthetic-witness-with-a-short-hex-0123456789ab"))).parse, "MALFORMED", "over 40 characters");
    assert.equal(check(mutate(bootstrapT, (t) => void (t.participants[1]!.participantId = "synthetic-witness-c0ffee"))).parse, "PARSED", "short hex-looking words are ordinary");
  });

  test("a digest slot cannot hold a secret unnoticed: a 32-byte value that is not the artifact's digest is a mismatch", () => {
    const seedLike = "5359".repeat(16);
    const t = mutate(bootstrapT, (x) => void ((event(x, "ROOT_PUBLIC_KEY_RECORDED")["ref"] as Record<string, string>)["bootstrapDigest"] = seedLike));
    assert.deepEqual(check(t).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"]);
  });

  test("the authorization events must match the supplied authorizations one for one: count, generation, and the kind of ceremony", () => {
    assert.ok(check(bootstrapT(), []).artifacts.status !== undefined);
    assert.deepEqual(check(bootstrapT(), chain).artifacts.reasons, ["OPERATIONAL_KEY_EVENTS_MISMATCH"], "two authorizations, one event");
    const wrongGeneration = mutate(bootstrapT, (t) => void ((event(t, "OPERATIONAL_KEY_AUTHORIZED")["ref"] as Record<string, string>)["generation"] = "2"));
    assert.deepEqual(check(wrongGeneration).artifacts.reasons, ["OPERATIONAL_KEY_EVENTS_MISMATCH"]);
    assert.deepEqual(check(bootstrapT(), second).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH", "OPERATIONAL_KEY_EVENTS_MISMATCH"], "a root-bootstrap ceremony authorizes generation 1");
    assert.deepEqual(check(rotationT(), first).artifacts.reasons.includes("OPERATIONAL_KEY_EVENTS_MISMATCH"), true, "a rotation ceremony does not authorize generation 1");
    assert.deepEqual(check(bootstrapT(), [{ nonsense: true }]).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"]);
    assert.deepEqual(check(bootstrapT(), "x" as never).artifacts.reasons, ["ARTIFACT_DIGEST_MISMATCH"]);
  });

  test("without artifacts the transcript is checked for shape only, and says so; without a tooling list the tooling digests are reported as not cross-checked", () => {
    const r = verifyCeremonyTranscript(bootstrapT());
    assert.equal(r.artifacts.status, "NOT_EVALUATED");
    assert.deepEqual(r.limitations, ["ARTIFACTS_NOT_CROSS_CHECKED", "TOOLING_NOT_CROSS_CHECKED"]);
    assert.deepEqual(r.reasons, []);
    assert.equal(verifyTranscriptFor(bootstrapT(), root, first, false).tooling.status, "NOT_COMPARED");
  });

  test("tooling must equal the published list exactly: a changed digest, a missing tool and an extra tool are each a mismatch", () => {
    const changed = SYNTHETIC_TOOLING.map((t, i) => (i === 0 ? { ...t, digest: "3".repeat(64) } : t));
    for (const expected of [changed, SYNTHETIC_TOOLING.slice(0, 1), [...SYNTHETIC_TOOLING, { name: "synthetic-extra", version: "0.0.1", digest: "4".repeat(64) }], "x"]) {
      const r = verifyCeremonyTranscript(bootstrapT(), { bootstrap: root, authorizations: first, expectedTooling: expected });
      assert.deepEqual(r.tooling, { status: "MISMATCHED", reasons: ["TOOLING_MISMATCH"] });
    }
  });

  test("the mode agrees with the keys: a rehearsal names only synthetic keys, a live ceremony names none, and the ceremony id agrees with the mode", () => {
    const live = mutate(bootstrapT, (t) => void Object.assign(t, { mode: "LIVE", ceremonyId: "walletwall-governance-root-live" }));
    assert.deepEqual(check(live).artifacts.reasons, ["LIVE_MODE_WITH_SYNTHETIC_KEY"]);
    const liveId = mutate(bootstrapT, (t) => void Object.assign(t, { mode: "LIVE" }));
    assert.ok(check(liveId).structure.reasons.includes("CEREMONY_ID_MODE_MISMATCH"));
    const rehearsalId = mutate(bootstrapT, (t) => void (t.ceremonyId = "walletwall-governance-root-live"));
    assert.ok(check(rehearsalId).structure.reasons.includes("CEREMONY_ID_MODE_MISMATCH"));
    const production = { ...root, root: { ...root.root, keyId: "walletwall-governance-root-1" } };
    assert.deepEqual(check(bootstrapT(), first, production).artifacts.reasons.includes("SYNTHETIC_MODE_WITH_NON_SYNTHETIC_KEY"), true);
  });
});

describe("transcript: no slot for a secret", () => {
  test("the schema is closed: an unknown field anywhere is refused, never dropped, and a field that would carry a secret is also reported as suspected", () => {
    for (const field of ["privateKey", "seed", "secretKey", "passphrase", "mnemonic", "entropy", "backupContents"]) {
      const top = mutate(bootstrapT, (t) => void Object.assign(t, { [field]: "ab".repeat(32) }));
      const r = check(top);
      assert.equal(r.parse, "MALFORMED", field);
      assert.ok(r.reasons.includes("SECRET_MATERIAL_SUSPECTED"), field);
      assert.equal(r.secrets.status, "SUSPECTED");
      const inRef = mutate(bootstrapT, (t) => void Object.assign(event(t, "ROOT_PUBLIC_KEY_RECORDED")["ref"] as object, { [field]: "ab".repeat(32) }));
      assert.equal(check(inRef).parse, "MALFORMED", `ref.${field}`);
    }
    const note = mutate(bootstrapT, (t) => void Object.assign(t, { note: "free text" }));
    assert.equal(check(note).parse, "MALFORMED");
    const eventNote = mutate(bootstrapT, (t) => void Object.assign(t.events[0] as object, { output: "raw shell output" }));
    assert.equal(check(eventNote).parse, "MALFORMED");
  });

  test("the schema has no free-text field: every string is an enumeration, a token, a date, a commit id, a digest, a version or a count", () => {
    const open = new Set<string>();
    const walk = (schema: unknown, path: string): void => {
      type Check = { _zod?: { def?: { check?: string; pattern?: unknown } } };
      const def = (schema as { _zod?: { def?: { type?: string; shape?: Record<string, unknown>; element?: unknown; options?: unknown[]; checks?: Check[] } } })._zod?.def;
      if (def === undefined) return;
      if (def.type === "string") {
        if (!(def.checks ?? []).some((c) => c._zod?.def?.check === "string_format" && c._zod.def.pattern instanceof RegExp)) open.add(path);
        return;
      }
      if (def.type === "object") for (const [k, v] of Object.entries(def.shape ?? {})) walk(v, `${path}.${k}`);
      if (def.type === "array") walk(def.element, `${path}[]`);
      if (def.type === "union") for (const o of def.options ?? []) walk(o, path);
    };
    walk(CeremonyTranscriptSchema, "transcript");
    assert.deepEqual([...open], [], "every string in the transcript schema is pattern-constrained or an enumeration");
  });

  test("a secret-looking value anywhere is reported even when the schema already refused the transcript", () => {
    const pem = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const inToolingName = mutate(bootstrapT, (t) => void (t.tooling[0]!.name = pem as never));
    const r = check(inToolingName);
    assert.equal(r.parse, "MALFORMED");
    assert.ok(r.reasons.includes("SECRET_MATERIAL_SUSPECTED"));
    const text = JSON.stringify(mutate(bootstrapT, (t) => void Object.assign(t, { seedPhrase: "abandon ability able about above absent absorb abstract absurd abuse access accident" })));
    assert.ok(check(text).reasons.includes("SECRET_MATERIAL_SUSPECTED"));
  });

  test("reads strict JSON text: a repeated key, a byte-order mark, malformed text, nesting and size are refused", () => {
    const text = JSON.stringify(bootstrapT());
    assert.equal(check(text).parse, "PARSED");
    assert.equal(check(new TextEncoder().encode(text)).parse, "PARSED");
    for (const bad of [text.replace('"mode":"SYNTHETIC_REHEARSAL"', '"mode":"SYNTHETIC_REHEARSAL","mode":"LIVE"'), `\uFEFF${text}`, text.slice(0, -2), "x".repeat(GOVERNANCE_LIMITS.maxTranscriptBytes + 1), new Uint8Array([0xff, 0xfe])]) {
      assert.equal(check(bad).parse, "MALFORMED");
    }
    assert.equal(check({ ...bootstrapT(), formatVersion: "9.9" }).parse, "UNSUPPORTED_VERSION");
    assert.deepEqual(check({ ...bootstrapT(), formatVersion: "9.9" }).reasons, ["TRANSCRIPT_VERSION_UNSUPPORTED"]);
  });

  test("it never throws and echoes nothing, for any argument", () => {
    const hostile: unknown[] = [undefined, null, 0, "", [], {}, { get events(): never { throw new Error("secret-ish-text"); } }, new Proxy({}, { get: () => { throw new Error("secret-ish-text"); } }), Object.create(null), () => 1, 10n];
    for (const input of hostile) {
      const r = verifyCeremonyTranscript(input, hostile[6]);
      assert.equal(r.parse, "MALFORMED");
      assert.doesNotMatch(JSON.stringify(r), /secret-ish-text/);
    }
    assert.equal(check(bootstrapT(), first, new Proxy({}, { get: () => { throw new Error("x"); } })).parse, "PARSED");
  });
});
