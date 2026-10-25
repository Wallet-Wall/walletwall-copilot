import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { INTEGRITY_POLICY, SHA256_HEX, SHA512_HEX, recordedDigest } from "../../../../scripts/integrity-policy.ts";
import { ROOT } from "../support/harness.ts";

const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8").replace(/\r\n/g, "\n");
const flatten = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(flatten);
};
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.name === "node_modules" || entry.name === ".git") return [];
  return entry.isDirectory() ? walk(path) : [relative(ROOT, path).replaceAll("\\", "/")];
});

// Independent guardrail: changing the declarative policy alone must never self-authorize a new SHA-256 exception.
const EXPECTED_SHA256_EXCEPTION_PATHS = Object.freeze([
  "canvas/brand/brand-sources.json",
  "docs/RELEASE_V0.3.0.md",
  "docs/discovery/agent-finder-icon-declaration.draft.json",
  "packages/mcp/src/canonical.ts",
  "packages/mcp/src/resources.ts",
  "packages/mcp/test/repo/discovery-readiness.test.ts",
  "packages/mcp/test/repo/mcpb.test.ts",
  "packages/mcp/test/repo/public-release.test.ts",
  "packages/mcp/test/sandbox/canonical.test.ts",
  "packages/mcp/test/support/harness.ts",
  "security/history/v0.3.0/plugin-artifact.sha256",
  "security/mcpb.sha256",
] as const);

const ALLOWED_SHA256_COMPUTATION_FILES = new Set([
  "scripts/pack-mcpb.ts",
  "packages/mcp/src/canonical.ts",
  "packages/mcp/src/resources.ts",
  "packages/mcp/test/repo/discovery-readiness.test.ts",
  "packages/mcp/test/repo/mcpb.test.ts",
  "packages/mcp/test/repo/public-release.test.ts",
  "packages/mcp/test/sandbox/canonical.test.ts",
  "packages/mcp/test/support/harness.ts",
]);

const CURRENT_INTEGRITY_CONSUMERS = Object.freeze([
  "scripts/build-bundle.ts",
  "scripts/gen-manifest.ts",
  "scripts/gen-plugin-manifest.ts",
  "scripts/gen-canvas-brand.ts",
  "scripts/pack-plugin.ts",
  "packages/mcp/test/support/plugin-validator.ts",
]);

describe("integrity policy: algorithm means purpose, not whichever helper a file chose", () => {
  test("security/integrity-policy.json is the single policy record; TypeScript is only its fail-closed loader", () => {
    const loader = read("scripts/integrity-policy.ts");
    assert.match(loader, /security\/integrity-policy\.json/);
    assert.doesNotMatch(loader, /security\/(?:bundle|tool-manifest|plugin-manifest|plugin-artifact|mcpb)\.sha(?:256|512)/, "loader must not duplicate record paths");
    assert.equal(INTEGRITY_POLICY.policyVersion, "1");
    assert.equal(INTEGRITY_POLICY.currentAlgorithm, "sha512");
  });

  test("every WalletWall-current integrity record is policy-owned SHA-512", () => {
    const current = Object.values(INTEGRITY_POLICY.current);
    assert.equal(new Set(current).size, current.length, "current integrity paths are unique");
    for (const path of current) {
      assert.match(path, /^security\/.+\.sha512$/);
      assert.ok(existsSync(`${ROOT}${path}`), path);
      assert.match(recordedDigest(read(path)), SHA512_HEX, path);
    }
  });

  test("the policy cannot self-authorize a new SHA-256 exception", () => {
    const declared = flatten(INTEGRITY_POLICY.sha256Exceptions).sort();
    assert.deepEqual(declared, [...EXPECTED_SHA256_EXCEPTION_PATHS].sort());
    assert.equal(new Set(declared).size, declared.length, "an exception path has exactly one declared purpose");
    for (const path of declared) assert.ok(existsSync(`${ROOT}${path}`), `declared exception exists: ${path}`);
  });

  test("recursive security SHA-256 records are an exact closed set", () => {
    const actual = walk(`${ROOT}security`).filter((path) => path.endsWith(".sha256")).sort();
    const allowed = ["security/history/v0.3.0/plugin-artifact.sha256", "security/mcpb.sha256"].sort();
    assert.deepEqual(actual, allowed);
    assert.match(recordedDigest(read("security/mcpb.sha256")), SHA256_HEX);
    const historical = read("security/history/v0.3.0/plugin-artifact.sha256");
    assert.match(recordedDigest(historical), SHA256_HEX);
    assert.match(historical, /historical v0\.3\.0 release checksum/i);
  });

  test("SHA-256 computation exists only at classified source or regression sites", () => {
    const candidates = walk(ROOT.replace(/[\\/]$/, ""))
      .filter((path) => /\.(?:ts|mjs)$/.test(path))
      .filter((path) => path !== "plugin/server/walletwall-mcp.mjs");
    const hits = candidates.filter((path) => /(?:createHash|digest)\(["']sha256["']|sha256Hex\(/.test(read(path)));
    assert.deepEqual(hits.sort(), [...ALLOWED_SHA256_COMPUTATION_FILES].sort());
  });

  test("generated bundle is not an independent SHA-256 authority", () => {
    const bundle = read("plugin/server/walletwall-mcp.mjs");
    assert.match(bundle, /sha256/, "WWEP SHA-256 implementation is expected to be present in generated runtime bytes");
    assert.match(read("scripts/build-bundle.ts"), /INTEGRITY_POLICY/, "bundle integrity is governed separately by current release policy");
  });

  test("current-integrity generators and validators consume central policy", () => {
    for (const path of CURRENT_INTEGRITY_CONSUMERS) {
      const text = read(path);
      assert.match(text, /INTEGRITY_POLICY/, `${path} must consume the central policy`);
      assert.doesNotMatch(text, /createHash\(["']sha256["']\)/, `${path} must not independently choose SHA-256 for current integrity`);
    }
    const mcpb = read("scripts/pack-mcpb.ts");
    assert.match(mcpb, /INTEGRITY_POLICY\.sha256Exceptions\.compatibility\.mcpRegistryArtifact/, "MCPB SHA-256 must be explicitly routed through the Registry-compatibility exception");
    assert.match(mcpb, /digest\("sha256", zip\)/, "MCPB must compute the Registry-required SHA-256 over the same ZIP bytes as current integrity");
    assert.doesNotMatch(read("scripts/pack-plugin.ts"), /security\/plugin-artifact\.sha(?:256|512)/, "plugin packer must not own a digest filename");
    assert.doesNotMatch(mcpb, /const SHA(?:256|512)_FILE = "security\//, "MCPB packer must not own digest filenames");
    assert.doesNotMatch(read("packages/mcp/test/support/plugin-validator.ts"), /"security",\s*"bundle\.sha512"/, "secondary validator must not own the bundle digest path");
  });

  test("release-integrity helper is algorithm-agnostic and lives outside WWEP protocol code", () => {
    assert.doesNotMatch(read("packages/mcp/src/canonical.ts"), /sha512|INTEGRITY_POLICY/i, "WWEP canonicalization must not own release-integrity helpers");
    assert.match(read("scripts/integrity-policy.ts"), /export function currentIntegrityHex/);
    assert.doesNotMatch(read("scripts/integrity-policy.ts"), /export function sha512Hex/);
    assert.match(read("scripts/gen-manifest.ts"), /currentIntegrityHex/);
    assert.match(read("scripts/gen-plugin-manifest.ts"), /currentIntegrityHex/);
    assert.match(read("packages/mcp/test/sandbox/manifest.test.ts"), /currentIntegrityHex/);
    assert.match(read("packages/mcp/test/sandbox/plugin-manifest.test.ts"), /currentIntegrityHex/);
  });

  test("canvas current integrity is SHA-512 only; SHA-256 remains only in nested source provenance", () => {
    const generator = read("scripts/gen-canvas-brand.ts");
    assert.match(generator, /createHash\(INTEGRITY_POLICY\.currentAlgorithm\)/);
    assert.doesNotMatch(generator, /a\.sha256|createHash\("sha256"\)/, "canvas generator authority must not use SHA-256");
    const source = JSON.parse(read(INTEGRITY_POLICY.sha256Exceptions.provenance.brandSources)) as { note: string; images: { sha512: string; source: { sha256: string } }[]; fonts: { sha512: string }[] };
    assert.match(source.note, /SHA-512 as the only current integrity authority/i);
    assert.doesNotMatch(JSON.stringify(source.images.map((asset) => ({ ...asset, source: undefined }))), /sha256/i, "derived local image records must not carry SHA-256");
    assert.doesNotMatch(JSON.stringify(source.fonts), /sha256/i, "local font records must not carry SHA-256");
    for (const asset of [...source.images, ...source.fonts]) assert.match(asset.sha512, SHA512_HEX);
    for (const image of source.images) assert.match(image.source.sha256, SHA256_HEX);
    const canvasRegression = read("packages/mcp/test/canvas/design.test.ts");
    assert.match(canvasRegression, /createHash\("sha512"\)/);
    assert.doesNotMatch(canvasRegression, /createHash\("sha256"\)|\.sha256\b/, "canvas byte-for-byte regression must use SHA-512 only");
  });

  test("historical release checksums are namespaced and cannot masquerade as current state", () => {
    assert.equal(INTEGRITY_POLICY.sha256Exceptions.historical.pluginV030, "security/history/v0.3.0/plugin-artifact.sha256");
    assert.ok(!existsSync(`${ROOT}security/plugin-artifact.sha256`), "no ambiguous top-level historical SHA-256 record");
    const archived = recordedDigest(read(INTEGRITY_POLICY.sha256Exceptions.historical.pluginV030));
    assert.match(archived, SHA256_HEX);
    assert.ok(read("docs/RELEASE_V0.3.0.md").includes(`\`${archived}\``), "immutable release document retains the published digest value");
  });

  test("historical runbooks stay historical and current MCPB docs state the two-hash boundary", () => {
    const flip = read("docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md");
    assert.match(flip, /> \*\*Historical record\.\*\*/);
    assert.match(flip, /Wallet-Wall\/walletwallrus-copilot/);
    assert.match(flip, /Compare the four SHA-256 values with step 1\./);

    const mcpb = read("docs/MCPB.md");
    assert.match(mcpb, /WalletWall integrity fingerprint \| `security\/mcpb\.sha512`/);
    assert.match(mcpb, /MCP Registry compatibility digest \| `security\/mcpb\.sha256`/);
    assert.match(mcpb, /retained only for the Registry `fileSha256` field/);
  });
});
