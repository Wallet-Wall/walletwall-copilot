import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT } from "../support/harness.ts";

const pluginRoot = join(ROOT, "plugin");
const readJson = (relative: string): Record<string, unknown> => JSON.parse(readFileSync(join(pluginRoot, relative), "utf8")) as Record<string, unknown>;

function oneServer(value: unknown): [string, Record<string, unknown>] {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  const entries = Object.entries(value as Record<string, unknown>);
  assert.equal(entries.length, 1);
  const first = entries[0];
  assert.ok(first);
  const [name, raw] = first;
  assert.equal(name, "walletwall");
  assert.ok(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  return [name, raw as Record<string, unknown>];
}

test("Claude plugin manifest is intentionally minimal and versioned", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.deepEqual(Object.keys(manifest).sort(), ["author", "description", "displayName", "name", "version"]);
  assert.equal(manifest["name"], "walletwall");
  assert.equal(manifest["displayName"], "WalletWall Vault Readiness");
  assert.equal(manifest["version"], "0.3.1");
  assert.deepEqual(manifest["author"], { name: "WalletWall" });
  assert.match(String(manifest["description"]), /vault technical-readiness/i);
});

test("Claude and Copilot launch the exact same bundled MCP server", () => {
  const claude = readJson(".mcp.json");
  const [, claudeServer] = oneServer(claude);
  assert.equal(claudeServer["command"], "node");
  assert.deepEqual(claudeServer["args"], ["${CLAUDE_PLUGIN_ROOT}/server/walletwall-mcp.mjs"]);
  assert.equal(claudeServer["env"], undefined);
  assert.equal(claudeServer["cwd"], undefined);

  const copilot = readJson("mcp.json");
  const [, copilotServer] = oneServer(copilot["mcpServers"]);
  assert.equal(copilotServer["type"], "stdio");
  assert.equal(copilotServer["command"], "node");
  assert.deepEqual(copilotServer["args"], ["${PLUGIN_ROOT}/server/walletwall-mcp.mjs"]);

  const relative = (args: unknown, token: string): string => {
    assert.ok(Array.isArray(args) && args.length === 1 && typeof args[0] === "string");
    assert.ok(args[0].startsWith(token));
    return args[0].slice(token.length);
  };
  assert.equal(
    relative(claudeServer["args"], "${CLAUDE_PLUGIN_ROOT}/"),
    relative(copilotServer["args"], "${PLUGIN_ROOT}/"),
  );
});

test("Claude methodology skills are additive and keep Vault readiness fail-closed", () => {
  const required = ["vault-readiness", "walletwall-authority", "walletwall-evidence-audit"];
  for (const skill of required) {
    const text = readFileSync(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^name: ${skill}$`, "m"));
    assert.match(text, /WalletWall|walletwall/);
  }

  const readiness = readFileSync(join(pluginRoot, "skills", "vault-readiness", "SKILL.md"), "utf8");
  assert.match(readiness, /CRITERIA_MET/);
  assert.match(readiness, /CRITERIA_NOT_MET/);
  assert.match(readiness, /NOT_ESTABLISHED/);
  assert.match(readiness, /UNKNOWN.*not false|UNKNOWN.*not.*ready/is);
  assert.match(readiness, /NO_RESULT.*not zero/is);
  assert.match(readiness, /Transport is not authority/);
  assert.match(readiness, /Never request private keys, seed phrases, signatures, or custody access/);
  assert.match(readiness, /Do not construct, sign, broadcast, route, or recommend transactions or trades/);
});
