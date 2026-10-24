import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { validatePluginDir } from "../support/plugin-validator.ts";

const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const json = <T>(p: string): T => JSON.parse(read(p)) as T;

const PUBLIC_MARKETPLACE = "walletwall";
const OLD_MARKETPLACE = "walletwall-private";
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|zip|gz)$/i;
const SELF = "packages/mcp/test/repo/discovery-readiness.test.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(relative(ROOT, p).replaceAll("\\", "/"));
  }
  return out;
}
const TEXT = walk(ROOT.replace(/[\\/]$/, "")).filter((f) => !BINARY.test(f) && f !== "package-lock.json" && f !== "plugin/server/walletwall-mcp.mjs");

// The former marketplace name was the real identity when these records were generated. They keep it; nothing else may.
const HISTORICAL_DOCS = ["docs/DESKTOP_INSTALL_PROOF.md", "docs/PUBLIC_RELEASE_AUDIT.md", "docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md"];
const isRecordedResult = (f: string): boolean => /^evals\/results\/[^/]+\.json$/.test(f);

describe("public marketplace identity", () => {
  const marketplace = json<{ name: string; owner: { name: string }; metadata: { description: string; version: string }; plugins: { name: string; version: string; source: string }[] }>(".github/plugin/marketplace.json");
  const plugin = json<{ name: string; version: string; description: string; author: { name: string } }>("plugin/plugin.json");

  test("the active marketplace is named walletwall, owned by Wallet-Wall, and lists exactly the walletwall plugin by relative path", () => {
    assert.equal(marketplace.name, PUBLIC_MARKETPLACE);
    assert.equal(marketplace.owner.name, "Wallet-Wall");
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0]?.name, "walletwall");
    assert.equal(marketplace.plugins[0]?.source, "./plugin");
    assert.equal(marketplace.metadata.version, plugin.version);
  });

  test("the former marketplace name is absent from every active file; it survives only in labelled historical evidence", () => {
    const offenders: string[] = [];
    for (const f of TEXT) {
      if (f === SELF || isRecordedResult(f)) continue;
      if (!read(f).includes(OLD_MARKETPLACE)) continue;
      if (!HISTORICAL_DOCS.includes(f)) offenders.push(`${f}: former marketplace name in an active file`);
    }
    assert.deepEqual(offenders, []);
  });

  test("every historical document that keeps the former name says so in its opening lines", () => {
    for (const f of HISTORICAL_DOCS.filter((d) => read(d).includes(OLD_MARKETPLACE))) {
      const head = read(f).split("\n").slice(0, 4).join("\n");
      assert.match(head, /\*\*Historical record\.\*\*/, f);
    }
  });

  test("recorded eval results are immutable evidence: they keep the identity they were generated under", () => {
    const results = TEXT.filter(isRecordedResult);
    assert.ok(results.length >= 4);
    for (const f of results) assert.equal(json<{ plugin: { marketplace: string } }>(f).plugin.marketplace, OLD_MARKETPLACE, f);
  });

  test("the eval harness derives the marketplace from the manifest instead of hard-coding a name", () => {
    const harness = read("evals/run-agent-evals.ts");
    assert.ok(harness.includes(".github/plugin/marketplace.json"));
    assert.ok(!harness.includes(OLD_MARKETPLACE));
  });
});

describe("public wording", () => {
  const STALE = /pre-release|prerelease|private|not published|release[- ]candidate/i;

  test("the public descriptions carry no pre-release, private or not-published wording", () => {
    const marketplace = json<{ metadata: { description: string }; plugins: { description: string }[] }>(".github/plugin/marketplace.json");
    const descriptions = [
      json<{ description: string }>("plugin/plugin.json").description,
      json<{ description: string }>("package.json").description,
      marketplace.metadata.description,
      marketplace.plugins[0]?.description ?? "",
    ];
    for (const d of descriptions) assert.ok(d.length > 0 && !STALE.test(d), d);
    assert.equal(marketplace.metadata.description, "Public WalletWall Agent Plugin source and local MCP integration.");
  });

  test("the marketplace wording does not claim an acceptance that has not happened", () => {
    const text = read(".github/plugin/marketplace.json");
    assert.ok(!/official|approved|verified|certified|endorsed|GitHub Marketplace/i.test(text));
  });

  test("SECURITY.md no longer describes a private phase", () => {
    assert.ok(!/private phase/i.test(read("SECURITY.md")));
  });
});

describe("install instructions match the active marketplace", () => {
  test("README installs walletwall@walletwall and never the former name", () => {
    const readme = read("README.md");
    assert.ok(readme.includes(`copilot plugin install walletwall@${PUBLIC_MARKETPLACE}\n`));
    assert.ok(readme.includes("copilot plugin marketplace add <path to this checkout>"));
    assert.ok(!readme.includes(OLD_MARKETPLACE));
  });

  test("every documented install command names the active marketplace", () => {
    for (const f of TEXT.filter((x) => x.endsWith(".md") && !HISTORICAL_DOCS.includes(x))) {
      for (const m of read(f).matchAll(/plugin install walletwall@([A-Za-z0-9._-]+)/g)) assert.equal(m[1], PUBLIC_MARKETPLACE, `${f}: ${m[0]}`);
    }
  });
});

describe("agent plugin and MCP metadata stay valid and unprivileged", () => {
  test("the plugin directory still conforms to Agent Plugins 1.0.0", () => {
    assert.deepEqual(validatePluginDir(`${ROOT}plugin`, ROOT), []);
  });

  test("the only MCP server is local stdio: no URL, no env, no credential, no argument beyond the bundled script", () => {
    const mcp = json<{ mcpServers: Record<string, { type: string; command: string; args: string[]; url?: string; env?: unknown; headers?: unknown }> }>("plugin/mcp.json");
    assert.deepEqual(Object.keys(mcp.mcpServers), ["walletwall"]);
    const s = mcp.mcpServers["walletwall"]!;
    assert.deepEqual({ type: s.type, command: s.command, args: s.args }, { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/server/walletwall-mcp.mjs"] });
    assert.ok(s.url === undefined && s.env === undefined && s.headers === undefined);
  });

  test("the marketplace entry and plugin manifest agree on identity, version, license and source repository", () => {
    const plugin = json<{ name: string; version: string; license: string; repository: string; homepage: string }>("plugin/plugin.json");
    const entry = json<{ plugins: { name: string; version: string; license: string; repository: string; homepage: string }[] }>(".github/plugin/marketplace.json").plugins[0]!;
    for (const k of ["name", "version", "license", "repository", "homepage"] as const) assert.equal(entry[k], plugin[k], k);
    assert.equal(plugin.repository, "https://github.com/Wallet-Wall/walletwallrus-copilot");
    assert.equal(plugin.license, "Apache-2.0");
  });
});

describe("Agent Finder draft artifacts (prepared, not submitted)", () => {
  const entry = json<{ identifier: string; displayName: string; mediaType: string; url: string; description: string; tags?: string[]; metadata: { sourceSet: string; repoPath: string } }>("docs/discovery/agent-finder-catalog-entry.draft.json");
  const icon = json<{ icons: { identifier: string; url: string; provenance: { sourceUrl: string; sha256: string; approval: string } }[] }>("docs/discovery/agent-finder-icon-declaration.draft.json");
  const plugin = json<{ name: string; description: string }>("plugin/plugin.json");

  test("the catalog entry describes the plugin at its real manifest path, with the public description and no canvas-only tag", () => {
    assert.equal(entry.identifier, "urn:ai:github.com:Wallet-Wall:walletwallrus-copilot:walletwall");
    assert.equal(entry.displayName, "WalletWall");
    assert.equal(entry.mediaType, "application/vnd.github.copilot-plugin");
    assert.equal(entry.description, plugin.description);
    assert.deepEqual(entry.metadata, { sourceSet: "Wallet-Wall/walletwallrus-copilot", repoPath: "plugin/plugin.json" });
    assert.equal(entry.url, "https://github.com/Wallet-Wall/walletwallrus-copilot/blob/main/plugin/plugin.json");
    assert.ok(!(entry.tags ?? []).includes("canvas-only"), "the plugin also ships a skill and an MCP server");
    assert.ok(!/compliance|investment advi|custody|transaction system|truth engine/i.test(JSON.stringify(entry)));
  });

  test("the icon declaration records the SHA-256 of the shipped mark and a placeholder for the not-yet-published catalog commit", () => {
    const declaration = icon.icons[0]!;
    const bytes = readFileSync(`${ROOT}canvas/brand/walletwall-brick-wallet-96.png`);
    assert.equal(declaration.provenance.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(declaration.identifier, entry.identifier.replace("urn:ai:", "urn:air:"));
    assert.match(declaration.url, /^https:\/\/raw\.githubusercontent\.com\/github\/agentfinder-catalog\/<40-hex-commit>\/icons\/wallet-wall\/walletwall\.png$/);
    assert.ok(bytes.length <= 262144 && bytes.readUInt32BE(16) <= 512 && bytes.readUInt32BE(20) <= 512, "static PNG within the catalog limits");
  });
});
