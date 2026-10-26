import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BundleSchema, type Bundle } from "../../src/schemas.ts";
import { createServer } from "../../src/server.ts";
import { TOOLS, callTool } from "../../src/tools.ts";
import { ROOT } from "../support/harness.ts";

/**
 * The published plugin contract as a consumer sees it: only resources, tool descriptions and tool outputs.
 * Nothing in this file reaches into fixtures or builders; a consumer with no source access must get the same result.
 */

const LEGACY_RESOURCES = [
  "walletwall://registry/stablecoins",
  "walletwall://registry/chains",
  "walletwall://schemas/evidence",
  "walletwall://policies/authority",
  "walletwall://spec/wwep",
  "walletwall://conformance/version",
];
const CLAIMS_RESOURCE = "walletwall://schemas/claims";
const EXAMPLE_RESOURCES = {
  identity: "walletwall://examples/identity-established",
  balance: "walletwall://examples/balance-established",
  ready: "walletwall://examples/vault-readiness-established",
  notReady: "walletwall://examples/vault-readiness-not-established",
} as const;
const SYNTHETIC_HOLDER = "0x1234567890123456789012345678901234567890";
const EVIDENCE_TOOLS = ["inspect_evidence", "check_invariants", "trace_provenance", "assess_vault_readiness"] as const;

interface Diagnostic {
  limitation: string;
  record: string;
  observationId: string | null;
  requiredKeys: string[];
  missingKeys: string[];
  invalidKeys: { key: string; reason: string }[];
  unexpectedKeys: string[];
  mismatchedKeys: string[];
}
interface AssertionResult {
  assertionId: string;
  supportState: string;
  finalityState: string | null;
  authority: { satisfied: boolean } | null;
  limitations: string[];
  diagnostics: Diagnostic[];
}
interface Example {
  example: string;
  synthetic: boolean;
  notice: string;
  contract: string;
  toolCall: { name: string; arguments: Record<string, unknown> };
  expected: Record<string, unknown>;
}
interface ClaimContract {
  policyId: string;
  derived: boolean;
  subject: { required: string[]; properties: Record<string, { type: string; pattern?: string; description: string }> };
  value: { required: string[]; properties: Record<string, { type: string; pattern?: string; enum?: string[]; description: string }> };
  observation: { sourceKindByOrigin: Record<string, string[]>; origins: { authoritative: string[]; corroborating: string[] }; linkage: string[] } | null;
  authority: { authorityIdSource: string };
  derivation: { ruleId: string | null; requiredDependencyClaimTypes: string[] } | null;
  example: string | null;
}

async function connect(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(b);
  const client = new Client({ name: "consumer-contract", version: "0" });
  await client.connect(a);
  return client;
}

async function readJson<T>(c: Client, uri: string): Promise<T> {
  const r = await c.readResource({ uri });
  return JSON.parse((r.contents[0] as { text: string }).text) as T;
}

async function readText(c: Client, uri: string): Promise<string> {
  const r = await c.readResource({ uri });
  return (r.contents[0] as { text: string }).text;
}

const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0] as { text: string }).text;

async function inspect(c: Client, bundle: unknown, evaluatedAt: string): Promise<{ raw: string; assertions: AssertionResult[] }> {
  const r = await c.callTool({ name: "inspect_evidence", arguments: { bundle, evaluatedAt } });
  assert.notEqual(r.isError, true, text(r));
  return { raw: text(r), assertions: (r.structuredContent as { assertions: AssertionResult[] }).assertions };
}

const byId = (assertions: AssertionResult[], id: string): AssertionResult => {
  const a = assertions.find((x) => x.assertionId === id);
  assert.ok(a, `assertion ${id} missing from evaluation`);
  return a;
};

async function identityExample(c: Client): Promise<{ bundle: Bundle; evaluatedAt: string }> {
  const ex = await readJson<Example>(c, EXAMPLE_RESOURCES.identity);
  return { bundle: structuredClone(ex.toolCall.arguments["bundle"] as Bundle), evaluatedAt: ex.toolCall.arguments["evaluatedAt"] as string };
}

function assertNoInternalLeak(raw: string): void {
  for (const marker of ["    at ", "node:internal", "packages/mcp", "walletwall-mcp.mjs", ".ts:", "C:\\", "/home/", "Error:"]) {
    assert.ok(!raw.includes(marker), `tool output leaks internal detail: ${marker}`);
  }
}

describe("consumer contract: MCP resource discovery", () => {
  test("listing carries the existing resources, the claim contract and the published synthetic examples", async () => {
    const c = await connect();
    const { resources } = await c.listResources();
    const uris = new Set(resources.map((r) => r.uri));
    for (const uri of [...LEGACY_RESOURCES, CLAIMS_RESOURCE, ...Object.values(EXAMPLE_RESOURCES)]) assert.ok(uris.has(uri), uri);
    for (const r of resources) {
      assert.ok(r.name && r.title && r.description && r.mimeType, r.uri);
      const body = await readText(c, r.uri);
      assert.ok(body.length > 20, r.uri);
    }
    await c.close();
  });

  test("resource bodies are deterministic across reads", async () => {
    const c = await connect();
    for (const uri of [CLAIMS_RESOURCE, ...Object.values(EXAMPLE_RESOURCES)]) {
      assert.equal(await readText(c, uri), await readText(c, uri), uri);
    }
    await c.close();
  });
});

describe("consumer contract: per-claim shapes are published, not inferred", () => {
  test("every policy claim type has a contract with required keys, string types and observation linkage", async () => {
    const c = await connect();
    const policies = await readJson<{
      policies: { claimType: string; derived: boolean; ruleId: string | null; subjectKeys: string[]; valueKeys: string[]; authoritativeOrigins: string[]; corroboratingOrigins: string[]; authorityIdSource: string }[];
    }>(c, "walletwall://policies/authority");
    const contract = await readJson<{ wwepVersion: string; claims: Record<string, ClaimContract> }>(c, CLAIMS_RESOURCE);
    assert.equal(contract.wwepVersion, "0.1");
    const listed = new Set((await c.listResources()).resources.map((r) => r.uri));
    assert.deepEqual(Object.keys(contract.claims).sort(), policies.policies.map((p) => p.claimType).sort());
    for (const p of policies.policies) {
      const claim = contract.claims[p.claimType];
      assert.ok(claim, p.claimType);
      assert.deepEqual(claim.subject.required, p.subjectKeys, `${p.claimType} subject keys`);
      assert.deepEqual(claim.value.required, p.valueKeys, `${p.claimType} value keys`);
      for (const k of p.subjectKeys) assert.equal(claim.subject.properties[k]?.type, "string", `${p.claimType}.subject.${k}`);
      for (const k of p.valueKeys) {
        assert.equal(claim.value.properties[k]?.type, "string", `${p.claimType}.value.${k}`);
        assert.ok((claim.value.properties[k]?.description ?? "").length > 0, `${p.claimType}.value.${k} description`);
      }
      assert.equal(claim.derived, p.derived);
      if (p.derived) {
        assert.equal(claim.observation, null, `${p.claimType} is derived: no observation contract`);
        assert.ok(claim.derivation, `${p.claimType} publishes its derivation linkage`);
        assert.equal(claim.derivation.ruleId, p.ruleId);
      } else {
        assert.ok(claim.observation, `${p.claimType} publishes its observation contract`);
        assert.equal(claim.derivation, null);
        assert.deepEqual(claim.observation.origins, { authoritative: p.authoritativeOrigins, corroborating: p.corroboratingOrigins });
        assert.ok(p.authoritativeOrigins.length + p.corroboratingOrigins.length > 0, `${p.claimType} names at least one origin`);
        for (const origin of [...p.authoritativeOrigins, ...p.corroboratingOrigins]) {
          assert.ok((claim.observation.sourceKindByOrigin[origin]?.length ?? 0) > 0, `${p.claimType} source kind for ${origin}`);
        }
        assert.ok(claim.observation.linkage.some((l) => l.includes("observationIds")), `${p.claimType} explains observation linkage`);
      }
      assert.equal(claim.authority.authorityIdSource, p.authorityIdSource);
      if (claim.example !== null) assert.ok(listed.has(claim.example), `${p.claimType} example ${claim.example} is not a listed resource`);
    }
    await c.close();
  });

  test("the ASSET_IDENTITY contract names issuerAuthorityId, its registry relationship and the attesting source kind", async () => {
    const c = await connect();
    const contract = await readJson<{ claims: Record<string, ClaimContract> }>(c, CLAIMS_RESOURCE);
    const identity = contract.claims["ASSET_IDENTITY"];
    assert.ok(identity);
    assert.deepEqual(identity.value.required, ["symbol", "decimals", "issuerAuthorityId"]);
    assert.deepEqual(identity.subject.required, ["chainId", "address"]);
    assert.match(identity.value.properties["issuerAuthorityId"]?.description ?? "", /registry/i);
    assert.match(identity.value.properties["decimals"]?.pattern ?? "", /0-9/);
    assert.ok(identity.observation);
    assert.deepEqual(identity.observation.sourceKindByOrigin["AUTHORITY_ATTESTED"], ["ISSUER_PUBLICATION"]);
    assert.match(identity.subject.properties["address"]?.description ?? "", /lowercase/i, "the contract says how address case is treated");
    assert.equal(identity.authority.authorityIdSource, "REGISTRY");
    assert.equal(identity.example, EXAMPLE_RESOURCES.identity);
    await c.close();
  });

  test("a consumer can build the exact accepted identity shape from the contract and the example alone", async () => {
    const c = await connect();
    const contract = await readJson<{ claims: Record<string, ClaimContract> }>(c, CLAIMS_RESOURCE);
    const identity = contract.claims["ASSET_IDENTITY"]!;
    const ex = await readJson<Example>(c, EXAMPLE_RESOURCES.identity);
    assert.equal(ex.toolCall.name, "inspect_evidence");
    assert.equal(ex.contract, CLAIMS_RESOURCE);
    const bundle = ex.toolCall.arguments["bundle"] as Bundle;
    const assertion = bundle.assertions.find((a) => a.claimType === "ASSET_IDENTITY");
    const observation = bundle.observations[0];
    assert.ok(assertion && observation);
    assert.deepEqual(Object.keys(assertion.value ?? {}).sort(), [...identity.value.required].sort());
    assert.deepEqual(Object.keys(observation.payload).sort(), [...identity.value.required].sort());
    assert.deepEqual(Object.keys(assertion.subject).sort(), [...identity.subject.required].sort());
    assert.deepEqual(Object.keys(observation.subject).sort(), [...identity.subject.required].sort());

    // Rebuild the shape from the published contract with fresh identifiers; nothing is copied from source fixtures.
    const registry = await readJson<{ assets: { chainId: string; address: string; symbol: string; decimals: string; authorityId: string }[] }>(c, "walletwall://registry/stablecoins");
    const record = registry.assets.find((a) => a.chainId === assertion.subject["chainId"] && a.address === String(assertion.subject["address"]).toLowerCase());
    assert.ok(record, "the example identity names a registry deployment");
    const sourceKind = identity.observation!.sourceKindByOrigin["AUTHORITY_ATTESTED"]![0]!;
    const value = { symbol: record.symbol, decimals: record.decimals, issuerAuthorityId: record.authorityId };
    const subject = { chainId: record.chainId, address: record.address };
    const rebuilt = {
      wwepVersion: "0.1",
      sources: [{ id: "my-issuer", kind: sourceKind, authorityId: record.authorityId, independenceGroup: "my-issuer-group" }],
      observations: [{ id: "my-obs", sourceId: "my-issuer", origin: "AUTHORITY_ATTESTED", observedAt: observation.observedAt, finality: "UNKNOWN_FINALITY", result: "VALUE", subject, payload: value }],
      assertions: [{ id: "my-identity", claimType: "ASSET_IDENTITY", origin: "AUTHORITY_ATTESTED", temporality: "CURRENT", subject, value, observationIds: ["my-obs"], assertedAt: observation.observedAt }],
      derivations: [],
    };
    const { assertions } = await inspect(c, rebuilt, ex.toolCall.arguments["evaluatedAt"] as string);
    const mine = byId(assertions, "my-identity");
    assert.equal(mine.supportState, "ESTABLISHED");
    assert.equal(mine.authority?.satisfied, true);
    assert.deepEqual(mine.diagnostics, []);
    await c.close();
  });
});

describe("consumer contract: INVALID_VALUE stays stable and explains itself", () => {
  test("authorityId in place of issuerAuthorityId is INVALID_VALUE with a deterministic structural diagnostic", async () => {
    const c = await connect();
    const { bundle, evaluatedAt } = await identityExample(c);
    const obs = bundle.observations[0]!;
    const a = bundle.assertions[0]!;
    obs.payload = { symbol: obs.payload["symbol"]!, decimals: obs.payload["decimals"]!, authorityId: obs.payload["issuerAuthorityId"]! };
    a.value = { symbol: a.value!["symbol"]!, decimals: a.value!["decimals"]!, authorityId: a.value!["issuerAuthorityId"]! };

    const first = await inspect(c, bundle, evaluatedAt);
    const second = await inspect(c, bundle, evaluatedAt);
    assert.equal(first.raw, second.raw, "diagnostics must be deterministic");
    const e = byId(first.assertions, a.id);
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    assert.ok(e.limitations.includes("INVALID_VALUE"));
    assert.deepEqual(e.diagnostics, [
      {
        limitation: "INVALID_VALUE",
        record: "OBSERVATION_PAYLOAD",
        observationId: obs.id,
        requiredKeys: ["symbol", "decimals", "issuerAuthorityId"],
        missingKeys: ["issuerAuthorityId"],
        invalidKeys: [],
        unexpectedKeys: ["authorityId"],
        mismatchedKeys: [],
      },
    ]);
    assertNoInternalLeak(first.raw);

    // The same wrong key inside the complete readiness bundle: readiness fails closed because of the identity, not because an input is missing.
    const readyEx = await readJson<Example>(c, EXAMPLE_RESOURCES.ready);
    const readyBundle = structuredClone(readyEx.toolCall.arguments["bundle"] as Bundle);
    const idObs = readyBundle.observations.find((o) => o.id === "obs-identity")!;
    const idA = readyBundle.assertions.find((x) => x.id === "a-identity")!;
    idObs.payload = { symbol: idObs.payload["symbol"]!, decimals: idObs.payload["decimals"]!, authorityId: idObs.payload["issuerAuthorityId"]! };
    idA.value = { symbol: idA.value!["symbol"]!, decimals: idA.value!["decimals"]!, authorityId: idA.value!["issuerAuthorityId"]! };
    const ready = await c.callTool({ name: "assess_vault_readiness", arguments: { ...readyEx.toolCall.arguments, bundle: readyBundle } });
    const body = ready.structuredContent as { classification: string; criteria: { id: string; outcome: string; reason: string }[]; limitations: string[] };
    assert.equal(body.classification, "NOT_ESTABLISHED");
    assert.deepEqual(
      body.criteria.filter((x) => x.id === "C1" || x.id === "C2").map((x) => [x.id, x.outcome, x.reason]),
      [
        ["C1", "INDETERMINATE", "IDENTITY_NOT_ESTABLISHED"],
        ["C2", "MET", "BALANCE_ESTABLISHED"],
      ],
    );
    assert.ok(body.limitations.includes("INVALID_VALUE"));
    await c.close();
  });

  test("a repeated observation id yields one diagnostic, not one per repetition", async () => {
    const c = await connect();
    const { bundle, evaluatedAt } = await identityExample(c);
    const obs = bundle.observations[0]!;
    obs.payload = { symbol: obs.payload["symbol"]!, decimals: obs.payload["decimals"]! };
    bundle.assertions[0]!.observationIds = [obs.id, obs.id, obs.id];
    const { assertions } = await inspect(c, bundle, evaluatedAt);
    const e = byId(assertions, "a-identity");
    assert.ok(e.limitations.includes("INVALID_VALUE"));
    assert.equal(e.diagnostics.length, 1);
    assert.deepEqual(e.diagnostics[0]!.missingKeys, ["issuerAuthorityId"]);
    await c.close();
  });

  test("a missing required key, a wrong primitive and an invalid format are each named without echoing values", async () => {
    const c = await connect();
    const base = await identityExample(c);
    const canary = "CANARYSYMBOL";

    const missing = structuredClone(base);
    missing.bundle.observations[0]!.payload = { symbol: canary, issuerAuthorityId: missing.bundle.observations[0]!.payload["issuerAuthorityId"]! };
    const m = await inspect(c, missing.bundle, missing.evaluatedAt);
    const md = byId(m.assertions, "a-identity").diagnostics[0]!;
    assert.deepEqual(md.missingKeys, ["decimals"]);
    assert.deepEqual(md.invalidKeys, []);
    assert.ok(!m.raw.includes(canary), "payload values must never be echoed");

    const wrongType = structuredClone(base);
    wrongType.bundle.observations[0]!.payload = { ...wrongType.bundle.observations[0]!.payload, decimals: true };
    const w = await inspect(c, wrongType.bundle, wrongType.evaluatedAt);
    assert.deepEqual(byId(w.assertions, "a-identity").diagnostics[0]!.invalidKeys, [{ key: "decimals", reason: "WRONG_TYPE" }]);

    const badFormat = structuredClone(base);
    badFormat.bundle.observations[0]!.payload = { ...badFormat.bundle.observations[0]!.payload, decimals: "six" };
    const f = await inspect(c, badFormat.bundle, badFormat.evaluatedAt);
    assert.deepEqual(byId(f.assertions, "a-identity").diagnostics[0]!.invalidKeys, [{ key: "decimals", reason: "INVALID_FORMAT" }]);
    assert.ok(!f.raw.includes("six"));

    const unknownKey = structuredClone(base);
    unknownKey.bundle.observations[0]!.payload = { ...unknownKey.bundle.observations[0]!.payload, decimals: "six", zzzUnknownKey: "x" };
    const u = await inspect(c, unknownKey.bundle, unknownKey.evaluatedAt);
    assert.deepEqual(byId(u.assertions, "a-identity").diagnostics[0]!.unexpectedKeys, ["*"]);
    assert.ok(!u.raw.includes("zzzUnknownKey"), "keys outside the contract vocabulary are not echoed");
    await c.close();
  });

  test("an assertion value that disagrees with its observation is VALUE_MISMATCH with the differing key named", async () => {
    const c = await connect();
    const { bundle, evaluatedAt } = await identityExample(c);
    bundle.assertions[0]!.value = { ...bundle.assertions[0]!.value!, decimals: "18" };
    const { assertions } = await inspect(c, bundle, evaluatedAt);
    const e = byId(assertions, "a-identity");
    assert.equal(e.supportState, "NOT_ESTABLISHED");
    assert.ok(e.limitations.includes("VALUE_MISMATCH"));
    assert.deepEqual(e.diagnostics, [
      {
        limitation: "VALUE_MISMATCH",
        record: "ASSERTION_VALUE",
        observationId: "obs-identity",
        requiredKeys: ["symbol", "decimals", "issuerAuthorityId"],
        missingKeys: [],
        invalidKeys: [],
        unexpectedKeys: [],
        mismatchedKeys: ["decimals"],
      },
    ]);
    await c.close();
  });

  test("an invalid assertion subject is INVALID_SUBJECT with the offending key named", async () => {
    const c = await connect();
    const { bundle, evaluatedAt } = await identityExample(c);
    bundle.assertions[0]!.subject = { chainId: "1", address: "not-an-address" };
    const { assertions, raw } = await inspect(c, bundle, evaluatedAt);
    const e = byId(assertions, "a-identity");
    assert.ok(e.limitations.includes("INVALID_SUBJECT"));
    assert.deepEqual(e.diagnostics[0]!.record, "ASSERTION_SUBJECT");
    assert.deepEqual(e.diagnostics[0]!.invalidKeys, [{ key: "address", reason: "INVALID_FORMAT" }]);
    assert.ok(!raw.includes("not-an-address"));
    await c.close();
  });
});

describe("consumer contract: published examples are live evidence, not snapshots", () => {
  test("every example parses under the bundle schema and runs through the normal tool path to its stated outcome", async () => {
    const c = await connect();
    const expectedTool: Record<string, string> = { identity: "inspect_evidence", balance: "inspect_evidence", ready: "assess_vault_readiness", notReady: "assess_vault_readiness" };
    for (const [key, uri] of Object.entries(EXAMPLE_RESOURCES)) {
      const ex = await readJson<Example>(c, uri);
      assert.equal(ex.synthetic, true, uri);
      assert.match(ex.notice, /synthetic/i);
      assert.match(ex.notice, /(not|nothing) .*claim/i, "the notice denies being a real-world claim");
      assert.match(ex.notice, /transport/i, "the notice covers the transport label as a placeholder");
      const bundleForSources = ex.toolCall.arguments["bundle"] as Bundle;
      for (const s of bundleForSources.sources) {
        if (s.transport) assert.match(s.transport.retrievedVia, /^Example/, `${uri}: transport label is a placeholder, not a provider`);
      }
      assert.equal(ex.toolCall.name, expectedTool[key]);
      assert.ok(TOOLS.some((t) => t.name === ex.toolCall.name), `${uri} names a real tool`);
      const bundle = BundleSchema.parse(ex.toolCall.arguments["bundle"]);
      for (const o of bundle.observations) {
        if (typeof o.subject["holder"] === "string") assert.equal(o.subject["holder"], SYNTHETIC_HOLDER, `${uri} uses the documented synthetic holder`);
      }
      const direct = callTool(ex.toolCall.name, ex.toolCall.arguments);
      assert.ok(direct.ok, `${uri} must be accepted by callTool`);
      const viaProtocol = await c.callTool({ name: ex.toolCall.name, arguments: ex.toolCall.arguments });
      assert.notEqual(viaProtocol.isError, true, uri);
      assert.deepEqual(viaProtocol.structuredContent, direct.result, `${uri}: protocol and direct paths agree`);
    }
    await c.close();
  });

  test("the established identity and balance examples evaluate to ESTABLISHED with empty diagnostics", async () => {
    const c = await connect();
    const id = await readJson<Example>(c, EXAMPLE_RESOURCES.identity);
    const idEval = await inspect(c, id.toolCall.arguments["bundle"], id.toolCall.arguments["evaluatedAt"] as string);
    const identity = byId(idEval.assertions, "a-identity");
    assert.equal(identity.supportState, "ESTABLISHED");
    assert.equal(identity.authority?.satisfied, true);
    assert.deepEqual(identity.diagnostics, []);
    assert.equal((id.expected["assertions"] as Record<string, { supportState: string }>)["a-identity"]?.supportState, "ESTABLISHED");

    const bal = await readJson<Example>(c, EXAMPLE_RESOURCES.balance);
    const balEval = await inspect(c, bal.toolCall.arguments["bundle"], bal.toolCall.arguments["evaluatedAt"] as string);
    const balance = byId(balEval.assertions, "a-balance");
    assert.equal(balance.supportState, "ESTABLISHED");
    assert.equal(balance.finalityState, "FINALIZED");
    assert.ok(balance.limitations.includes("TRANSPORT_FIDELITY_NOT_VERIFIED"), "chain readings always carry the transport limitation");
    assert.deepEqual(balance.diagnostics, []);
    await c.close();
  });

  test("the established Vault example is CRITERIA_MET and passes the invariants", async () => {
    const c = await connect();
    const ex = await readJson<Example>(c, EXAMPLE_RESOURCES.ready);
    const r = await c.callTool({ name: "assess_vault_readiness", arguments: ex.toolCall.arguments });
    const body = r.structuredContent as { classification: string; criteria: { outcome: string }[]; doesNotEstablish: string[] };
    assert.equal(body.classification, "CRITERIA_MET");
    assert.ok(body.criteria.every((x) => x.outcome === "MET"));
    assert.ok(body.doesNotEstablish.includes("investment merit"));
    assert.equal(ex.expected["classification"], "CRITERIA_MET");
    // The example also exhibits the VAULT_TECHNICAL_READINESS assertion shape it is cited for by the claim contract.
    const contract = await readJson<{ claims: Record<string, ClaimContract> }>(c, CLAIMS_RESOURCE);
    const readinessContract = contract.claims["VAULT_TECHNICAL_READINESS"]!;
    assert.equal(readinessContract.example, EXAMPLE_RESOURCES.ready);
    const suggested = ex.expected["suggestedAssertion"] as { claimType: string; origin: string; derivationId: string; subject: Record<string, unknown>; value: Record<string, unknown> };
    assert.equal(suggested.claimType, "VAULT_TECHNICAL_READINESS");
    assert.equal(suggested.origin, "WALLETWALL_DERIVED");
    assert.deepEqual(Object.keys(suggested.value), readinessContract.value.required);
    assert.deepEqual(Object.keys(suggested.subject).sort(), [...readinessContract.subject.required].sort());
    assert.equal(suggested.value["classification"], "CRITERIA_MET");
    const derivation = ex.expected["suggestedDerivation"] as { id: string; outputAssertionId: string; ruleId: string };
    assert.equal(derivation.id, suggested.derivationId);
    assert.equal(derivation.ruleId, readinessContract.derivation?.ruleId);
    const inv = await c.callTool({ name: "check_invariants", arguments: { bundle: ex.toolCall.arguments["bundle"], evaluatedAt: ex.toolCall.arguments["evaluatedAt"] } });
    assert.equal((inv.structuredContent as { pass: boolean }).pass, true);
    const prov = await c.callTool({ name: "trace_provenance", arguments: { bundle: ex.toolCall.arguments["bundle"], assertionId: ex.toolCall.arguments["identityAssertionId"] } });
    assert.equal((prov.structuredContent as { issues: unknown[] }).issues.length, 0);
    await c.close();
  });

  test("the incomplete Vault example stays NOT_ESTABLISHED and names the missing measurement", async () => {
    const c = await connect();
    const ex = await readJson<Example>(c, EXAMPLE_RESOURCES.notReady);
    const r = await c.callTool({ name: "assess_vault_readiness", arguments: ex.toolCall.arguments });
    const body = r.structuredContent as { classification: string; criteria: { id: string; outcome: string; reason: string }[]; limitations: string[] };
    assert.equal(body.classification, "NOT_ESTABLISHED");
    assert.ok(body.criteria.some((x) => x.outcome === "INDETERMINATE"));
    assert.ok(!body.criteria.some((x) => x.outcome === "NOT_MET"), "incomplete evidence is indeterminate, not a failed criterion");
    assert.ok(body.limitations.includes("NO_AUTHORITATIVE_OBSERVATION"));
    assert.equal(ex.expected["classification"], "NOT_ESTABLISHED");
    assert.equal(typeof ex.expected["missingMeasurement"], "string");
    assert.match(ex.expected["missingMeasurement"] as string, /AUTHORITY_ATTESTED/);
    const inv = await c.callTool({ name: "check_invariants", arguments: { bundle: ex.toolCall.arguments["bundle"], evaluatedAt: ex.toolCall.arguments["evaluatedAt"] } });
    assert.equal((inv.structuredContent as { pass: boolean }).pass, true, "incomplete is not malformed: no invariant violation");
    await c.close();
  });
});

describe("consumer contract: tool descriptions route callers to the canonical resources", () => {
  test("every evidence-accepting tool names the bundle schema, the claim contract and the authority policies", () => {
    for (const name of EVIDENCE_TOOLS) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      for (const uri of ["walletwall://schemas/evidence", CLAIMS_RESOURCE, "walletwall://policies/authority"]) {
        assert.ok(t.description.includes(uri), `${name} description must reference ${uri}`);
      }
      assert.ok(t.description.length < 800, `${name} description stays bounded`);
    }
    const readiness = TOOLS.find((x) => x.name === "assess_vault_readiness")!;
    assert.ok(readiness.description.includes(EXAMPLE_RESOURCES.ready));
    assert.ok(readiness.description.includes(EXAMPLE_RESOURCES.notReady));
    const normalize = TOOLS.find((x) => x.name === "normalize_observation")!;
    assert.ok(normalize.description.includes(CLAIMS_RESOURCE));
  });

  test("every walletwall:// URI mentioned by a tool description, the server instructions or a skill resolves to a listed resource", async () => {
    const c = await connect();
    const listed = new Set((await c.listResources()).resources.map((r) => r.uri));
    const instructions = c.getInstructions() ?? "";
    const skillsDir = join(ROOT, "plugin", "skills");
    const skillText = readdirSync(skillsDir)
      .map((d) => readFileSync(join(skillsDir, d, "SKILL.md"), "utf8"))
      .join("\n");
    const corpus = [...TOOLS.map((t) => t.description), instructions, skillText].join("\n");
    const mentioned = new Set([...corpus.matchAll(/walletwall:\/\/[a-z0-9/-]+/g)].map((m) => m[0]));
    assert.ok(mentioned.size >= 5, "the contract is referenced");
    for (const uri of mentioned) {
      // A mention ending in "/" names a namespace; it must contain at least one served resource.
      const served = uri.endsWith("/") ? [...listed].some((l) => l.startsWith(uri)) : listed.has(uri);
      assert.ok(served, `${uri} is referenced but not served`);
    }
    assert.ok(instructions.includes(CLAIMS_RESOURCE), "server instructions point at the claim contract");
    assert.ok(skillText.includes(CLAIMS_RESOURCE) && skillText.includes(EXAMPLE_RESOURCES.ready), "skills point at the published contract and examples");
    await c.close();
  });
});
