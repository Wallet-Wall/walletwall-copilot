import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { validatePluginDir } from "../support/plugin-validator.ts";
import { PROHIBITED_CLAIMS } from "../support/claims.ts";

describe("Copilot plugin shell (Agent Plugins 1.0.0)", () => {
  test("the plugin directory conforms", () => {
    assert.deepEqual(validatePluginDir(`${ROOT}plugin`, ROOT), []);
  });

  test("the plugin is named walletwall, carries the public short description and makes none of the prohibited claims", () => {
    const manifest = JSON.parse(readFileSync(`${ROOT}plugin/plugin.json`, "utf8")) as { name: string; description: string; author: { name: string } };
    assert.equal(manifest.name, "walletwall");
    assert.equal(manifest.description, "Stablecoin intelligence and vault readiness for GitHub Copilot.");
    assert.equal(manifest.author.name, "WalletWall");
    assert.ok(!PROHIBITED_CLAIMS.test(manifest.description));
  });

  test("the marketplace manifest lists exactly this plugin by relative path and matches plugin.json", () => {
    const mp = JSON.parse(readFileSync(`${ROOT}.github/plugin/marketplace.json`, "utf8")) as { name: string; owner: { name: string }; plugins: { name: string; version: string; source: string; description: string }[] };
    const manifest = JSON.parse(readFileSync(`${ROOT}plugin/plugin.json`, "utf8")) as { name: string; version: string; description: string };
    assert.match(mp.name, /^[a-z0-9][a-z0-9.-]*$/);
    assert.equal(mp.plugins.length, 1);
    const entry = mp.plugins[0]!;
    assert.equal(entry.name, manifest.name);
    assert.equal(entry.version, manifest.version);
    assert.equal(entry.description, manifest.description);
    assert.equal(entry.source, "./plugin", "a relative path inside this repository, never a remote source");
  });

  test("the plugin needs no environment, URL or credential: its only server is local stdio with no env block", () => {
    const mcp = JSON.parse(readFileSync(`${ROOT}plugin/mcp.json`, "utf8")) as { mcpServers: Record<string, Record<string, unknown>> };
    assert.deepEqual(Object.keys(mcp.mcpServers), ["walletwall"]);
    const s = mcp.mcpServers["walletwall"] as Record<string, unknown>;
    assert.equal(s["type"], "stdio");
    assert.equal(s["env"], undefined);
    assert.equal(s["url"], undefined);
  });
});
