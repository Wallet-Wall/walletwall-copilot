import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { canonicalize, sha256Hex } from "../../src/canonical.ts";
import { createServer } from "../../src/server.ts";
import { resourcesManifest } from "../../src/resources.ts";
import { ROOT } from "../support/harness.ts";

const manifestText = readFileSync(`${ROOT}security/tool-manifest.json`, "utf8").replace(/\r\n/g, "\n");
const manifest = JSON.parse(manifestText) as {
  manifestVersion: string;
  tools: { name: string; title: string; description: string; inputSchema: unknown; annotations: unknown }[];
  resources: unknown[];
};

describe("tool manifest (tool contracts are security-sensitive)", () => {
  test("SHA-256 file equals the hash of the RFC 8785 canonical manifest", () => {
    const line = readFileSync(`${ROOT}security/tool-manifest.sha256`, "utf8").replace(/\r\n/g, "\n");
    const expected = sha256Hex(canonicalize(JSON.parse(manifestText), { numbers: "jcs" }));
    assert.ok(line.startsWith(`${expected}  `), "tool-manifest.sha256 is stale; run npm run gen:manifest and review the manifest diff");
  });

  test("the manifest matches exactly what a client receives over the protocol", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer().connect(b);
    const client = new Client({ name: "manifest-test", version: "0" });
    await client.connect(a);
    const { tools } = await client.listTools();
    const live = tools
      .map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }))
      .sort((x, y) => (x.name < y.name ? -1 : 1));
    assert.equal(canonicalize(live, { numbers: "jcs" }), canonicalize(manifest.tools, { numbers: "jcs" }));
    await client.close();
  });

  test("resource contents are pinned by digest in the manifest", () => {
    assert.equal(canonicalize(resourcesManifest(), { numbers: "jcs" }), canonicalize(manifest.resources, { numbers: "jcs" }));
  });

  test("no tool is added, removed or renamed without a manifest diff", () => {
    assert.deepEqual(
      manifest.tools.map((t) => t.name),
      ["assess_vault_readiness", "check_invariants", "inspect_evidence", "normalize_observation", "resolve_asset", "trace_provenance"],
    );
  });

  test("descriptions are static text with no template, URL or remote reference", () => {
    for (const t of manifest.tools) {
      assert.ok(!/https?:\/\/|\$\{|\{\{|<script|<tool|ignore (all )?previous/i.test(t.description), t.name);
      assert.ok(t.description.length < 800, t.name);
    }
  });
});
