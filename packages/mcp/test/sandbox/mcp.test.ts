import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.ts";
import { TOOLS } from "../../src/tools.ts";
import { RESOURCES } from "../../src/resources.ts";
import { EVALUATED_AT, USDC, golden } from "../support/builders.ts";

async function connect(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return client;
}

const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0] as { text: string }).text;

describe("MCP server contract (in-process)", () => {
  test("exposes exactly the six consolidated tools, all read-only", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["assess_vault_readiness", "check_invariants", "inspect_evidence", "normalize_observation", "resolve_asset", "trace_provenance"],
    );
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true);
      assert.equal(t.annotations?.destructiveHint, false);
      assert.equal(t.annotations?.openWorldHint, false);
      assert.equal(t.inputSchema.type, "object");
    }
    assert.equal(tools.length, TOOLS.length);
    await c.close();
  });

  test("no tool offers shell, filesystem write, network, RPC, SQL, signing, swap or free-text verification", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).join(" ");
    for (const banned of [/shell|exec|run_command|bash/, /write|delete|save|file/, /fetch|http|url|rpc|network/, /sql|query_db/, /sign|broadcast|swap|transfer|send|approve/, /verify_response|verify_text|fact_check/]) {
      assert.ok(!banned.test(names), `tool name matched ${String(banned)}`);
    }
    await c.close();
  });

  test("every input schema is strict and bounded", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const walk = (node: unknown, path: string, out: string[]): void => {
      if (node === null || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n["type"] === "object" && n["properties"] !== undefined && n["additionalProperties"] !== false) out.push(`${path}: object not closed`);
      if (n["type"] === "array" && typeof n["maxItems"] !== "number") out.push(`${path}: array unbounded`);
      for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`, out);
    };
    for (const t of tools) {
      const problems: string[] = [];
      walk(t.inputSchema, t.name, problems);
      assert.deepEqual(problems, []);
    }
    await c.close();
  });

  test("lists and reads every resource", async () => {
    const c = await connect();
    const { resources } = await c.listResources();
    assert.deepEqual(resources.map((r) => r.uri).sort(), RESOURCES.map((r) => r.uri).sort());
    for (const uri of [
      "walletwall://registry/stablecoins",
      "walletwall://registry/chains",
      "walletwall://schemas/evidence",
      "walletwall://policies/authority",
      "walletwall://spec/wwep",
      "walletwall://conformance/version",
    ]) {
      const r = await c.readResource({ uri });
      const body = (r.contents[0] as { text: string }).text;
      assert.ok(body.length > 20, uri);
    }
    const spec = (await c.readResource({ uri: "walletwall://spec/wwep" })).contents[0] as { text: string };
    assert.ok(spec.text.includes("not** an industry standard"));
    const v = JSON.parse(((await c.readResource({ uri: "walletwall://conformance/version" })).contents[0] as { text: string }).text) as Record<string, string>;
    assert.equal(v["wwepVersion"], "0.1");
    assert.equal(v["status"], "DRAFT_PRIVATE_PRE_RELEASE");
    await c.close();
  });

  test("unknown resource is an error", async () => {
    const c = await connect();
    await assert.rejects(c.readResource({ uri: "walletwall://nope" }));
    await c.close();
  });

  test("resolve_asset, inspect_evidence, check_invariants, trace_provenance and readiness work through the protocol", async () => {
    const c = await connect();
    const r1 = await c.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: USDC } });
    assert.equal((r1.structuredContent as { supportState: string }).supportState, "PARTIAL");

    const inspect = await c.callTool({ name: "inspect_evidence", arguments: { bundle: golden(), evaluatedAt: EVALUATED_AT } });
    const body = inspect.structuredContent as { assertions: { assertionId: string; supportState: string }[]; invariantViolationCount: number };
    assert.equal(body.invariantViolationCount, 0);
    assert.equal(body.assertions.find((a) => a.assertionId === "a-balance")?.supportState, "ESTABLISHED");

    const inv = await c.callTool({ name: "check_invariants", arguments: { bundle: golden(), evaluatedAt: EVALUATED_AT } });
    assert.equal((inv.structuredContent as { pass: boolean }).pass, true);

    const prov = await c.callTool({ name: "trace_provenance", arguments: { bundle: golden(), assertionId: "a-balance" } });
    assert.equal((prov.structuredContent as { issues: unknown[] }).issues.length, 0);

    const ready = await c.callTool({
      name: "assess_vault_readiness",
      arguments: { bundle: golden(), evaluatedAt: EVALUATED_AT, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" },
    });
    assert.equal((ready.structuredContent as { classification: string }).classification, "CRITERIA_MET");
    await c.close();
  });

  test("validation errors are fixed-shape and never echo caller-supplied values", async () => {
    const c = await connect();
    const canary = "0xCANARY00000000000000000000000000000BAD";
    const bad = await c.callTool({ name: "resolve_asset", arguments: { chainId: "1", address: canary, [canary]: canary } });
    assert.equal(bad.isError, true);
    assert.ok(!text(bad).includes("CANARY"));
    const bundle = golden();
    (bundle.observations[1] as unknown as { payload: Record<string, unknown> }).payload = { balanceAtomic: 5, [canary]: canary };
    const bad2 = await c.callTool({ name: "inspect_evidence", arguments: { bundle, evaluatedAt: EVALUATED_AT } });
    assert.equal(bad2.isError, true);
    assert.ok(!text(bad2).includes("CANARY"));
    const parsed = JSON.parse(text(bad2)) as { error: { code: string; issues: { path: string[]; code: string }[] } };
    assert.equal(parsed.error.code, "INVALID_INPUT");
    assert.ok(parsed.error.issues.every((i) => i.path.every((p) => /^[A-Za-z#*]+$/.test(p))));
    await c.close();
  });

  test("prototype-polluting keys and unknown tools are refused without echo", async () => {
    const c = await connect();
    const poisoned = JSON.parse('{"bundle":{"__proto__":{"x":1}},"evaluatedAt":"2026-10-23T12:00:30Z"}') as unknown;
    const r = await c.callTool({ name: "inspect_evidence", arguments: poisoned as Record<string, unknown> });
    assert.equal(r.isError, true);
    const u = await c.callTool({ name: "totally_unknown_tool_xyz", arguments: {} });
    assert.equal(u.isError, true);
    assert.ok(!text(u).includes("totally_unknown_tool_xyz"));
    await c.close();
  });

  test("oversized inputs are refused", async () => {
    const c = await connect();
    const b = golden();
    b.observations = Array.from({ length: 129 }, (_, i) => ({ ...b.observations[0]!, id: `o-${i}` }));
    const r = await c.callTool({ name: "inspect_evidence", arguments: { bundle: b, evaluatedAt: EVALUATED_AT } });
    assert.equal(r.isError, true);
    await c.close();
  });

  test("tool definitions are static: listing twice is identical", async () => {
    const c = await connect();
    assert.equal(JSON.stringify(await c.listTools()), JSON.stringify(await c.listTools()));
    await c.close();
  });

  test("server advertises only tools and resources", async () => {
    const c = await connect();
    const caps = c.getServerCapabilities() ?? {};
    assert.deepEqual(Object.keys(caps).sort(), ["resources", "tools"]);
    await c.close();
  });
});
