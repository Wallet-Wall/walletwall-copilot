import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { after, describe, test } from "node:test";
import { crc32 } from "node:zlib";
import { ROOT, runSession } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";

const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const json = <T>(p: string): T => JSON.parse(read(p)) as T;
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const sha512 = (b: Buffer): string => createHash("sha512").update(b).digest("hex");

interface Entry {
  path: string;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  bytes: Buffer;
}

function readZip(zip: Buffer): Entry[] {
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50, "end of central directory at the very end (no comment)");
  const count = zip.readUInt16LE(eocd + 10);
  assert.equal(zip.readUInt16LE(eocd + 8), count);
  const dirSize = zip.readUInt32LE(eocd + 12);
  const dirOffset = zip.readUInt32LE(eocd + 16);
  assert.equal(dirOffset + dirSize, eocd, "central directory is contiguous with the end record");
  const out: Entry[] = [];
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 24);
    assert.equal(zip.readUInt32LE(at + 20), size, "stored: compressed equals uncompressed size");
    const nameLen = zip.readUInt16LE(at + 28);
    assert.equal(zip.readUInt16LE(at + 30), 0, "no extra field");
    assert.equal(zip.readUInt16LE(at + 32), 0, "no entry comment");
    const local = zip.readUInt32LE(at + 42);
    const path = zip.toString("ascii", at + 46, at + 46 + nameLen);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const lNameLen = zip.readUInt16LE(local + 26);
    assert.equal(zip.readUInt16LE(local + 28), 0);
    const dataAt = local + 30 + lNameLen;
    out.push({ path, method, flags: zip.readUInt16LE(at + 8), time: zip.readUInt16LE(at + 12), date: zip.readUInt16LE(at + 14), crc, bytes: zip.subarray(dataAt, dataAt + size) });
    at += 46 + nameLen;
  }
  return out;
}

const run = createOwnedRun();
after(() => run.dispose());
const pack = (name: string): Buffer => {
  const file = run.path(name);
  execFileSync(process.execPath, [`${ROOT}scripts/pack-mcpb.ts`, "--out", file, "--from-tree"], { cwd: ROOT, stdio: "pipe" });
  return readFileSync(file);
};

const EXPECTED = ["LICENSE", "THIRD_PARTY_NOTICES.md", "manifest.json", "server/walletwall-mcp.mjs"];
const DESCRIPTION = "Stablecoin intelligence and vault readiness through WalletWall MCP.";

describe("MCPB package (the WalletWall MCP for the official MCP Registry)", () => {
  const a = pack("a.mcpb");
  const b = pack("b.mcpb");
  const entries = readZip(a);

  test("two builds are byte-identical and match both recorded integrity hashes", () => {
    assert.ok(a.equals(b));
    assert.equal(read("security/mcpb.sha256").split(/\s+/)[0], sha256(a), "MCP Registry compatibility hash");
    assert.equal(read("security/mcpb.sha512").split(/\s+/)[0], sha512(a), "WalletWall release-integrity hash");
  });

  test("the archive holds exactly the four files needed to run the server: no canvas, skill, evals, docs, .git or dev files", () => {
    assert.deepEqual(entries.map((e) => e.path), EXPECTED);
  });

  test("every entry is stored with fixed header fields and an intact CRC", () => {
    for (const e of entries) {
      assert.equal(e.method, 0, e.path);
      assert.equal(e.flags, 0, e.path);
      assert.equal(e.time, 0, e.path);
      assert.equal(e.date, ((2026 - 1980) << 9) | (1 << 5) | 1, e.path);
      assert.equal(e.crc, crc32(e.bytes), e.path);
    }
  });

  test("the packaged server is byte-identical to the shipped plugin bundle, and the manifest is the committed one", () => {
    const get = (p: string): Buffer => (entries.find((e) => e.path === p) as Entry).bytes;
    assert.ok(get("server/walletwall-mcp.mjs").equals(readFileSync(`${ROOT}plugin/server/walletwall-mcp.mjs`)));
    assert.equal(get("manifest.json").toString("utf8"), read("mcpb/manifest.json"));
    assert.equal(sha512(get("server/walletwall-mcp.mjs")), read("security/bundle.sha512").split(/\s+/)[0]);
  });

  test("the notices in the archive cover the bundled packages and nothing about the canvas", () => {
    const notices = (entries.find((e) => e.path === "THIRD_PARTY_NOTICES.md") as Entry).bytes.toString("utf8");
    assert.ok(notices.includes("## @modelcontextprotocol/sdk "));
    assert.ok(!notices.includes("walletwall-evidence-explorer") && !notices.includes("Fonts embedded"));
  });

  test("the documents in the archive carry no local path, e-mail address, credential or private key", () => {
    for (const p of ["manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      const text = (entries.find((e) => e.path === p) as Entry).bytes.toString("utf8");
      assert.ok(!/[A-Za-z]:\\Users\\|\/home\/|\/Users\//.test(text), `${p}: local path`);
      assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(text.replace(/@modelcontextprotocol\/sdk/g, "")), `${p}: e-mail address`);
      assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(text), `${p}: credential`);
    }
  });
});

describe("MCPB manifest", () => {
  const m = json<Record<string, unknown> & { server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env?: unknown } }; tools: { name: string }[]; compatibility: { runtimes: Record<string, string> } }>("mcpb/manifest.json");
  const plugin = json<{ name: string; description: string; license: string }>("plugin/plugin.json");
  const registry = json<{ version: string }>("server.json");
  const tools = json<{ tools: { name: string }[] }>("security/tool-manifest.json").tools.map((t) => t.name);

  test("identity, package version, description and license stay internally consistent without coupling to the plugin release version", () => {
    assert.equal(m["manifest_version"], "0.3");
    assert.equal(m["name"], plugin.name);
    assert.equal(m["version"], registry.version);
    assert.equal(m["description"], DESCRIPTION);
    assert.equal(m["license"], plugin.license);
  });

  test("the server is the local stdio Node bundle with no environment, no user configuration, no URL and no extra argument", () => {
    assert.equal(m.server.type, "node");
    assert.equal(m.server.entry_point, "server/walletwall-mcp.mjs");
    assert.deepEqual(m.server.mcp_config, { command: "node", args: ["${__dirname}/server/walletwall-mcp.mjs"] });
    assert.ok(m["user_config"] === undefined && m["privacy_policies"] === undefined && m["tools_generated"] === false);
    assert.equal(m.compatibility.runtimes["node"], ">=22.18.0");
  });

  test("the listed tools are exactly the tools of the tool manifest", () => {
    assert.deepEqual(m.tools.map((t) => t.name).sort(), [...tools].sort());
  });
});

describe("server.json for the official MCP Registry", () => {
  const s = json<{ $schema: string; name: string; title: string; description: string; version: string; repository: { url: string; source: string }; packages: { registryType: string; identifier: string; fileSha256: string; transport: { type: string }; environmentVariables?: unknown; runtimeArguments?: unknown }[]; remotes?: unknown }>("server.json");
  const plugin = json<{ repository: string }>("plugin/plugin.json");
  const mcpb = json<{ version: string }>("mcpb/manifest.json");

  test("name, title, description, repository and MCP package version", () => {
    assert.equal(s.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    assert.equal(s.name, "io.github.Wallet-Wall/walletwall");
    assert.equal(s.title, "WalletWall");
    assert.equal(s.description, DESCRIPTION);
    assert.ok(s.description.length <= 100);
    assert.deepEqual(s.repository, { url: plugin.repository, source: "github" });
    assert.equal(s.version, mcpb.version);
  });

  test("one MCPB package from its own tagged GitHub Release, stdio only, with the registry-required SHA-256", () => {
    assert.equal(s.packages.length, 1);
    const p = s.packages[0]!;
    assert.equal(p.registryType, "mcpb");
    assert.equal(p.identifier, `${plugin.repository}/releases/download/v${s.version}/walletwall.mcpb`);
    assert.ok(p.identifier.includes("mcp"));
    assert.equal(p.fileSha256, read("security/mcpb.sha256").split(/\s+/)[0]);
    assert.deepEqual(p.transport, { type: "stdio" });
  });

  test("no environment variable, runtime argument, remote URL or credential", () => {
    assert.ok(s.remotes === undefined);
    const p = s.packages[0]!;
    assert.ok(p.environmentVariables === undefined && p.runtimeArguments === undefined);
    assert.ok(!/token|secret|password|apikey|api_key/i.test(JSON.stringify(s)));
  });
});

describe("the packaged server, extracted and run over real stdio under the privacy guard", () => {
  test("it answers every tool and resource exactly like the shipped bundle, with zero network, DNS, write, randomness or fingerprint access", async () => {
    const entries = readZip(pack("c.mcpb"));
    for (const e of entries) {
      const file = run.path("extracted", e.path);
      run.mkdir("extracted", dirname(e.path) === "." ? "" : dirname(e.path));
      writeFileSync(file, e.bytes);
    }
    const packaged = await runSession({ entry: run.path("extracted", "server", "walletwall-mcp.mjs") });
    const shipped = await runSession({ entry: `${ROOT}plugin/server/walletwall-mcp.mjs`, canary: packaged.canary });
    try {
      assert.equal(packaged.responses.length, 16);
      assert.deepEqual(packaged.guard.network, []);
      assert.deepEqual(packaged.guard.dns, []);
      assert.deepEqual(packaged.guard.fsWrite, []);
      assert.deepEqual(packaged.guard.random, []);
      assert.deepEqual(packaged.guard.fingerprint, []);
      assert.deepEqual(packaged.tree, []);
      assert.deepEqual(packaged.responses, shipped.responses);
    } finally {
      packaged.cleanup();
      shipped.cleanup();
    }
  });
});
