import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { acceptanceEntryDigest, acceptanceFor, verifyAcceptanceLedger, type AcceptanceEntry } from "../../src/wallprint/acceptance-ledger.ts";
import { ledgerOf, pinOf, registryChain } from "../support/wallprint-attestations.ts";

const chain = registryChain();
const d = (c: string): string => c.repeat(64);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const codes = (raw: unknown): string[] => {
  const r = verifyAcceptanceLedger(raw);
  return r.ok ? [] : [...new Set(r.findings.map((f) => f.code))].sort();
};
const rehashed = (entries: AcceptanceEntry[]): AcceptanceEntry[] => entries.map((e) => ({ ...e, entryDigest: acceptanceEntryDigest(e) }));

describe("acceptance ledger: append-only, hash-chained, bound to attestation digests", () => {
  const good = ledgerOf([{ digest: d("a"), pin: pinOf(chain, 1) }, { digest: d("b"), pin: pinOf(chain, 2) }, { digest: d("c"), pin: pinOf(chain, 2) }]);

  test("a well-formed ledger is read, and an entry is found only by the digest of the attestation it names", () => {
    assert.equal(verifyAcceptanceLedger(good).ok, true);
    assert.equal(verifyAcceptanceLedger([]).ok, true, "an empty ledger names nothing");
    assert.equal(acceptanceFor(good, d("b"))?.acceptedUnder.keyRegistryVersion, "2");
    assert.equal(acceptanceFor(good, d("z")), null);
    assert.equal(good[0]?.previousEntryDigest, null);
    assert.equal(good[1]?.previousEntryDigest, good[0]?.entryDigest);
    assert.equal(JSON.stringify(good).match(/\d{4}-\d{2}-\d{2}T/), null, "no instant: order is the sequence number");
  });

  test("an edit, a reorder, a drop, a reused attestation, a decreasing registry version and a wrong shape each fail with their own code", () => {
    const edited = clone(good);
    (edited[1] as { acceptedUnder: { keyRegistryVersion: string } }).acceptedUnder.keyRegistryVersion = "1";
    assert.deepEqual(codes(edited), ["DIGEST_MISMATCH"]);
    assert.ok(codes([good[1], good[0], good[2]]).includes("SEQUENCE"));
    assert.ok(codes([good[0], good[2]]).includes("PREVIOUS_MISMATCH"));
    assert.ok(codes([good[1], good[2]]).includes("SEQUENCE"));
    const reused = clone(good);
    (reused[2] as { attestationDigest: string }).attestationDigest = d("a");
    assert.ok(codes(rehashed(reused)).includes("ACCEPTED_TWICE"));
    const decreasing = ledgerOf([{ digest: d("a"), pin: pinOf(chain, 3) }, { digest: d("b"), pin: pinOf(chain, 2) }]);
    assert.deepEqual(codes(decreasing), ["VERSION_DECREASED"]);
    assert.deepEqual(codes([{ ...good[0], extra: 1 }]), ["SHAPE"]);
    assert.deepEqual(codes("nope"), ["LEDGER_SHAPE"]);
    assert.deepEqual(codes([JSON.parse('{"__proto__":{}}')]), ["FORBIDDEN_STRUCTURE"]);
  });

  test("the first entry has no predecessor and every later entry names its predecessor's digest", () => {
    const first = clone(good);
    (first[0] as { previousEntryDigest: string | null }).previousEntryDigest = d("f");
    assert.ok(codes(rehashed(first)).includes("PREVIOUS_MISMATCH"));
    const relinked = clone(good);
    (relinked[1] as { previousEntryDigest: string | null }).previousEntryDigest = null;
    assert.ok(codes(rehashed(relinked)).includes("PREVIOUS_MISMATCH"));
  });

  test("the structure guard is applied entry by entry, so a ledger of several thousand entries is read, and one hostile entry among them still refuses the whole ledger", () => {
    const many = ledgerOf(Array.from({ length: 3000 }, (_, i) => ({ digest: (i + 1).toString(16).padStart(64, "0"), pin: pinOf(chain, 1 + Math.min(3, Math.floor(i / 750))) })));
    assert.equal(verifyAcceptanceLedger(many).ok, true, "more entries than one value-wide guard of 20,000 nodes can hold");
    assert.deepEqual(codes([...many.slice(0, 1500), JSON.parse('{"__proto__":{}}'), ...many.slice(1500)]), ["FORBIDDEN_STRUCTURE"]);
    assert.deepEqual(codes([...many.slice(0, 5), { ...many[5], extra: 1 }, ...many.slice(6)]), ["PREVIOUS_MISMATCH", "SHAPE"], "an entry that is not an entry is a shape finding and breaks the chain after it");
  });
});
