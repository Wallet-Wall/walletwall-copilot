import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";

const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const json = <T>(p: string): T => JSON.parse(read(p)) as T;

describe("Claude plugin distribution", () => {
  test("manifest defines a separate Claude packaging version without changing the MCP engine version", () => {
    const manifest = json<{ name: string; version: string; description: string; license: string }>("plugin/.claude-plugin/plugin.json");
    const mcpPackage = json<{ version: string }>("packages/mcp/package.json");

    assert.equal(manifest.name, "walletwall");
    assert.equal(manifest.version, "0.1.0");
    assert.equal(manifest.license, "Apache-2.0");
    assert.match(manifest.description, /Vault-first readiness analysis/);
    assert.equal(mcpPackage.version, "0.1.0");
  });

  test("Claude MCP config launches the canonical shipped stdio server and nothing else", () => {
    const config = json<{
      mcpServers: Record<string, { command?: string; args?: string[]; env?: unknown; url?: unknown; type?: unknown }>;
    }>("plugin/.mcp.json");
    const walletwall = config.mcpServers["walletwall"];

    assert.ok(walletwall);
    assert.deepEqual(Object.keys(config.mcpServers), ["walletwall"]);
    assert.equal(walletwall.command, "node");
    assert.deepEqual(walletwall.args, ["${CLAUDE_PLUGIN_ROOT}/server/walletwall-mcp.mjs"]);
    assert.equal(walletwall.env, undefined);
    assert.equal(walletwall.url, undefined);
    assert.equal(walletwall.type, undefined);
  });

  test("Claude and Copilot launch the exact same server file", () => {
    const claude = json<{ mcpServers: { walletwall: { args: string[] } } }>("plugin/.mcp.json");
    const copilot = json<{ mcpServers: { walletwall: { args: string[] } } }>("plugin/mcp.json");

    assert.equal(claude.mcpServers.walletwall.args[0], "${CLAUDE_PLUGIN_ROOT}/server/walletwall-mcp.mjs");
    assert.equal(copilot.mcpServers.walletwall.args[0], "${PLUGIN_ROOT}/server/walletwall-mcp.mjs");

    const shipped = readFileSync(`${ROOT}plugin/server/walletwall-mcp.mjs`);
    const recorded = read("security/bundle.sha256").split(/\s+/).at(0) ?? "";
    assert.equal(shipped.length > 0, true);
    assert.match(recorded, /^[a-f0-9]{64}$/);
  });

  test("Vault readiness is primary and supporting methodology skills remain discoverable", () => {
    const skills = ["vault-readiness", "walletwall-evidence-audit", "walletwall-authority"];
    for (const name of skills) {
      const text = read(`plugin/skills/${name}/SKILL.md`);
      assert.match(text, /^---\n/);
      assert.match(text, new RegExp(`\\nname: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
      assert.match(text, /\ndescription: .+\n---\n/);
    }
    assert.match(read("plugin/skills/vault-readiness/SKILL.md"), /WalletWall Vault migration readiness/);
    assert.match(read("plugin/skills/walletwall-evidence/SKILL.md"), /name: walletwall-evidence/);
  });

  test("Claude skills preserve read-only wallet boundaries", () => {
    const combined = [
      read("plugin/skills/walletwall-evidence-audit/SKILL.md"),
      read("plugin/skills/walletwall-authority/SKILL.md"),
      read("plugin/skills/vault-readiness/SKILL.md"),
    ].join("\n");

    assert.match(combined, /Do not mutate repositories, deployments, wallets, or production state/);
    assert.match(combined, /Never mutate a wallet, submit a transaction, request a signature, or change production state/);
    assert.match(combined, /read-only/i);
  });
});
