import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { canonicalize, sha256Hex } from "../../src/canonical.ts";
import { POLICIES_VERSION, REGISTRY_VERSION, RULES_VERSION } from "../../src/registry.ts";
import { WWEP_VERSION } from "../../src/schemas.ts";
import { ENGINE_NAME, ENGINE_VERSION } from "../../src/version.ts";
import { ROOT } from "../support/harness.ts";

const norm = (s: string): string => s.replace(/\r\n/g, "\n");
const text = norm(readFileSync(`${ROOT}security/plugin-manifest.json`, "utf8"));
const manifest = JSON.parse(text) as {
  plugin: { name: string; version: string };
  versions: Record<string, string>;
  toolManifestSha256: string;
  serverBundleSha256: string;
  canvasExtensions: string[];
  files: { path: string; sha256: string; bytes: number }[];
};

function list(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base)).flatMap((n) => {
    const rel = base === "" ? n : `${base}/${n}`;
    return statSync(join(dir, rel)).isDirectory() ? list(dir, rel) : [rel];
  });
}

describe("plugin manifest digest (what the Copilot plugin ships is pinned)", () => {
  test("the SHA-256 file equals the hash of the RFC 8785 canonical manifest", () => {
    const line = norm(readFileSync(`${ROOT}security/plugin-manifest.sha256`, "utf8"));
    assert.ok(line.startsWith(`${sha256Hex(canonicalize(JSON.parse(text), { numbers: "jcs" }))}  `), "plugin-manifest.sha256 is stale; run npm run gen:plugin-manifest and review the diff");
  });

  test("every plugin file is listed with its exact digest, and nothing unlisted ships", () => {
    const actual = list(`${ROOT}plugin`).sort();
    assert.deepEqual(manifest.files.map((f) => f.path.replace(/^plugin\//, "")), actual);
    for (const f of manifest.files) {
      const body = norm(readFileSync(`${ROOT}${f.path}`, "utf8"));
      assert.equal(sha256Hex(body), f.sha256, f.path);
      assert.equal(Buffer.byteLength(body, "utf8"), f.bytes, f.path);
    }
  });

  test("it embeds the tool-manifest digest, the server bundle digest and the data versions it was built with", () => {
    assert.equal(manifest.toolManifestSha256, readFileSync(`${ROOT}security/tool-manifest.sha256`, "utf8").split(/\s+/)[0]);
    assert.equal(manifest.serverBundleSha256, readFileSync(`${ROOT}security/bundle.sha256`, "utf8").split(/\s+/)[0]);
    assert.deepEqual(manifest.versions, { engine: `${ENGINE_NAME}@${ENGINE_VERSION}`, wwep: WWEP_VERSION, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION });
    assert.deepEqual(manifest.canvasExtensions, ["walletwall-evidence-explorer"]);
    assert.equal(manifest.plugin.name, "walletwall");
  });
});
