import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { ENTRIES, allFileBytes, hashesOf, runRaw, runSession, type Session } from "../support/harness.ts";

const sessions = new Map<string, Session>();
const cleanups: (() => void)[] = [];

async function session(label: string): Promise<Session> {
  const hit = sessions.get(label);
  if (hit) return hit;
  const s = await runSession({ entry: ENTRIES[label as keyof typeof ENTRIES] });
  sessions.set(label, s);
  cleanups.push(s.cleanup);
  return s;
}

const contains = (haystacks: (string | Buffer)[], needle: string): boolean =>
  haystacks.some((h) => (typeof h === "string" ? h : h.toString("latin1")).toLowerCase().includes(needle.toLowerCase()));

describe("privacy runtime proofs (real stdio server under the privacy guard)", () => {
  after(() => {
    for (const c of cleanups) c();
  });

  for (const label of Object.keys(ENTRIES)) {
    describe(`entry: ${label}`, () => {
      test("PRIV-001 offline MCP works with every network API blocked: all tools and resources answered", async () => {
        const s = await session(label);
        assert.equal(s.responses.length, 21, "2 list requests, 8 tool calls and one read of each of the 11 resources");
        assert.ok(s.responses.every((r) => !r.includes('"isError":true') || r.includes("INVALID_INPUT")), "only the deliberate bad-input call may error");
        assert.ok(s.responses.filter((r) => r.includes('"isError":true')).length === 1);
        assert.deepEqual(s.guard.network, []);
        assert.deepEqual(s.guard.dns, []);
      });

      test("PRIV-002 offline MCP works with every filesystem write blocked (read-only filesystem behavior)", async () => {
        const s = await session(label);
        assert.deepEqual(s.guard.fsWrite, []);
        assert.ok(s.responses.length > 0);
      });

      test("PRIV-003 no WalletWall (or any) endpoint contacted: zero DNS lookups and zero connection attempts", async () => {
        const s = await session(label);
        assert.equal(s.guard.network.length + s.guard.dns.length, 0);
      });

      test("PRIV-005 no persistent query log: no file exists in cwd, HOME, TMP, APPDATA or XDG dirs after a session", async () => {
        const s = await session(label);
        assert.deepEqual(s.tree, []);
        assert.deepEqual(s.guard.fsWrite, []);
      });

      test("PRIV-006 no persistent wallet cache and no state carried between requests", async () => {
        const s = await session(label);
        assert.deepEqual(s.tree, []);
        // The canary was sent in requests 3..10. Responses that do not take it as input must not contain it.
        const unrelated = [0, 1, 3].map((i) => s.responses[i] as string);
        assert.ok(unrelated.every((r) => !r.toLowerCase().includes(s.canary.toLowerCase())));
        assert.ok(!s.responses.slice(10).some((r) => r.toLowerCase().includes(s.canary.toLowerCase())), "resource reads must not contain earlier query data");
      });

      test("PRIV-007 no generated user ID: the server never requests randomness or identity", async () => {
        const s = await session(label);
        assert.deepEqual(s.guard.random, []);
        assert.deepEqual(s.guard.fingerprint, []);
      });

      test("PRIV-008 no generated device ID or machine fingerprint: no os identity API and identical output across processes", async () => {
        const a = await session(label);
        const b = await runSession({ entry: ENTRIES[label as keyof typeof ENTRIES], canary: a.canary });
        cleanups.push(b.cleanup);
        assert.deepEqual(b.guard.fingerprint, []);
        assert.deepEqual(a.responses, b.responses);
      });

      test("PRIV-009 wallet address is not written to disk", async () => {
        const s = await session(label);
        assert.ok(!contains(allFileBytes(s.dirs), s.canary));
        assert.ok(!contains(s.tree, s.canary));
        assert.ok(!contains([s.stderr], s.canary), "the canary must not appear in stderr");
      });

      test("PRIV-010 wallet address is not hashed and persisted: no file contains any hash of it, and no file exists", async () => {
        const s = await session(label);
        const bytes = allFileBytes(s.dirs);
        for (const h of hashesOf(s.canary)) assert.ok(!contains(bytes, h));
        assert.ok(!contains([s.stderr], s.canary.slice(2)));
        for (const h of hashesOf(s.canary)) assert.ok(!contains([s.stderr], h));
        assert.deepEqual(s.guard.fsWrite, []);
      });

      test("PRIV-011 credentials present in the environment are not written, logged or returned", async () => {
        const s = await session(label);
        for (const secret of Object.values(s.secrets)) {
          assert.ok(!contains(allFileBytes(s.dirs), secret));
          assert.ok(!contains([s.stderr], secret));
          assert.ok(!contains(s.responses, secret));
        }
      });

      test("PRIV-012 no crash uploader: malformed protocol input is survived without network, files or leaked detail", async () => {
        const s = await runRaw(ENTRIES[label as keyof typeof ENTRIES], [
          "this is not json 0xCANARYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_evidence","arguments":{"bundle":"0xCANARYBBBB"}}}',
          '{"jsonrpc":"2.0","id":2,"method":"does/not/exist"}',
          '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"0xCANARYCCCC"}}',
        ]);
        assert.deepEqual(s.guard.network, []);
        assert.deepEqual(s.guard.dns, []);
        assert.deepEqual(s.guard.fsWrite, []);
        assert.deepEqual(s.guard.spawn, []);
        assert.deepEqual(s.tree, []);
        assert.equal(s.code, 0, "stdin close must end the process cleanly");
        assert.ok(!/CANARY/i.test(s.stderr), "stderr must not echo input");
        s.cleanup();
      });

      test("PRIV-014 unexpected outbound network connections = 0 across the whole session", async () => {
        const s = await session(label);
        assert.equal(s.guard.network.length, 0);
        assert.equal(s.guard.spawn.length, 0);
      });

      test("logging is disabled by default: stderr carries nothing but the guard report", async () => {
        const s = await session(label);
        const rest = s.stderr.replace(/\nWW_GUARD_REPORT \{.*\}\n/, "").trim();
        assert.equal(rest, "");
      });
    });
  }
});
