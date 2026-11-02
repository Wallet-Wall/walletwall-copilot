import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { WHO, seedLabel, syntheticKey } from "../support/wallprint-attestations.ts";
import { GOV } from "../support/wallprint-checkpoints.ts";

/**
 * This lane defines verification and trust semantics. It ships no runtime change, holds no private key and performs no
 * signing: these tests pin each of those claims so a later change has to make them on purpose.
 */
const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const SKIP = new Set(["node_modules", ".git", "dist"]);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [relative(ROOT.replace(/[\\/]$/, ""), p).replaceAll("\\", "/")];
  });

const CHECKPOINT_MODULES = ["checkpoint-vocabulary", "checkpoint", "checkpoint-verify"].map((m) => `packages/mcp/src/wallprint/${m}.ts`);
const MODULES = ["attestation-vocabulary", "attestation", "attestation-verify", "key-registry", "acceptance-ledger", "ed25519"].map((m) => `packages/mcp/src/wallprint/${m}.ts`).concat(CHECKPOINT_MODULES);
const VECTOR_FILES = ["packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json", "packages/mcp/test/wallprint/fixtures/wallprint-checkpoint-vectors-0.1.json"];

describe("attestation lane: no shipped runtime change", () => {
  test("the shipped server, tools, resources and every non-WallPrint engine module never reach the attestation modules", () => {
    const engine = readdirSync(`${ROOT}packages/mcp/src`, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".ts")).map((e) => e.name);
    assert.ok(engine.length > 10);
    for (const f of engine) assert.doesNotMatch(read(`packages/mcp/src/${f}`), /from\s+"\.\/(?:wallprint\/|attestation|key-registry|ed25519)/, f);
  });

  test("the shipped bundle contains none of the attestation vocabulary", () => {
    const bundle = read("plugin/server/walletwall-mcp.mjs");
    for (const needle of ["walletwall.wallprint.attestation", "walletwall.wallprint.key-registry", "RECORD_PUBLICATION", "ISSUER_ASSESSMENT_ORIGIN", "BOUND_ISSUER_AUTHORITY", "KEY_SMALL_ORDER"]) assert.equal(bundle.includes(needle), false, needle);
  });

  test("the tool and resource manifests are unchanged in kind: six tools, eleven resources, nothing named for an attestation", () => {
    const manifest = JSON.parse(read("security/tool-manifest.json")) as { tools: { name: string }[]; resources: { uri: string }[] };
    assert.equal(manifest.tools.length, 6);
    assert.equal(manifest.resources.length, 11);
    assert.deepEqual(manifest.tools.map((t) => t.name).filter((n) => /attest|sign|key/i.test(n)), []);
    assert.deepEqual(manifest.resources.map((r) => r.uri).filter((u) => /attest|sign|key/i.test(u)), []);
  });

  test("no dependency was added: the attestation modules import only the engine, zod and node:crypto's public-key verification", () => {
    for (const m of MODULES) {
      const imports = [...read(m).matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((x) => x[1] ?? "");
      for (const i of imports) assert.ok(i.startsWith("./") || i.startsWith("../") || i === "zod" || i === "node:crypto", `${m}: ${i}`);
    }
    const crypto = read("packages/mcp/src/wallprint/ed25519.ts").match(/import \{([^}]*)\} from "node:crypto"/)?.[1]?.split(",").map((s) => s.trim()).sort();
    assert.deepEqual(crypto, ["createPublicKey", "verify"]);
    for (const f of ["package.json", "package-lock.json", "packages/mcp/package.json", "packages/wallprint-web/package.json"]) {
      assert.doesNotMatch(read(f), /@noble\/|tweetnacl|libsodium|sodium-native|elliptic|node-forge|jsrsasign|mldsa|dilithium|liboqs/i, f);
    }
    assert.deepEqual(Object.keys((JSON.parse(read("packages/mcp/package.json")) as { dependencies: object }).dependencies).sort(), ["@modelcontextprotocol/sdk", "zod"]);
  });
});

describe("attestation lane: no private key, no signing in the engine", () => {
  test("the engine modules hold no signing primitive, no key generation and no secret handling", () => {
    for (const m of MODULES) {
      const text = read(m);
      assert.doesNotMatch(text, /createPrivateKey|generateKeyPair|createSign|createSecretKey|createHmac|\bsign\(|subtle\.(?:sign|generateKey|importKey)|privateKey|PRIVATE KEY|process\.env|randomBytes|randomUUID|Math\.random|Date\.now|new Date\(/, m);
    }
  });

  test("signing exists in exactly one place, the test support, and only with keys whose seed is a public ASCII label", () => {
    const signers = walk(ROOT).filter((f) => /\.(ts|mjs)$/.test(f) && f.startsWith("packages/mcp/test/") && f !== "packages/mcp/test/wallprint/attestation-isolation.test.ts" && /createPrivateKey|\bsign\(/.test(read(f)));
    assert.deepEqual(signers.filter((f) => /wallprint/.test(f)), ["packages/mcp/test/support/wallprint-attestations.ts"]);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      assert.match(seedLabel(n), /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/);
      assert.equal(Buffer.from(seedLabel(n), "utf8").length, 32);
    }
  });

  test("the synthetic keys appear nowhere that ships or publishes: not in the plugin, the bundle, the manifests, the canvas, the MCPB or the public store", () => {
    const publics = [...new Set([...Object.values(WHO), ...Object.values(GOV)].map((w) => syntheticKey(w.n).publicKey))];
    const shipped = walk(ROOT).filter((f) => /^(plugin|security|canvas|mcpb|packages\/wallprint-web\/publication|packages\/wallprint-web\/lib|packages\/wallprint-web\/browser)\//.test(f) && !/\.(png|woff2?)$/.test(f));
    assert.ok(shipped.length > 20);
    for (const f of shipped) {
      const text = read(f);
      for (const key of publics) assert.equal(text.includes(key), false, `${f} carries a synthetic key`);
      assert.equal(text.includes("SYNTHETIC-NON-PRODUCTION-KEY"), false, f);
    }
    for (const f of ["server.json", "package.json"]) for (const key of publics) assert.equal(read(f).includes(key), false);
  });

  test("this lane publishes no key registry and no attestation: the public store has neither directory, and the resolver reads neither", () => {
    for (const dir of ["attestations", "keys", "key-registry"]) assert.equal(existsSync(`${ROOT}packages/wallprint-web/publication/${dir}`), false, dir);
    for (const f of walk(`${ROOT}packages/wallprint-web`).filter((x) => /^packages\/wallprint-web\/(lib|browser)\//.test(x))) assert.doesNotMatch(read(f), /attestation|key-registry/i, f);
    for (const f of walk(`${ROOT}scripts`).filter((x) => /publish|build-wallprint-public/.test(x))) assert.doesNotMatch(read(f), /attestation|key-registry/i, f);
  });

  test("no key material shaped like a real private key is in either vector file: no PEM block, no PKCS#8 header, only labelled seeds and public keys", () => {
    for (const path of VECTOR_FILES) {
      const text = read(path);
      assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY|MC4CAQAwBQYDK2Vw|302e020100300506032b6570/, path);
      const file = JSON.parse(text) as { keys: { seedLabel: string }[] };
      for (const k of file.keys) assert.match(k.seedLabel, /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/, path);
      assert.match(text, /"notice": "SYNTHETIC NON-PRODUCTION FIXTURE/, path);
    }
  });

  test("no secret reaches a workflow: the CI workflow names no signing step, key, attestation, checkpoint or governance-root secret", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.doesNotMatch(ci, /\$\{\{\s*secrets\.|SIGNING|PRIVATE_KEY|attestation|cosign|gpg/i);
    assert.doesNotMatch(ci, /checkpoint|governance[-_ ]?(?:key|root)|trust[-_ ]?root/i);
  });
});

describe("checkpoint lane: nothing ships, nothing signs, no production trust root exists", () => {
  test("no module outside the lane imports a checkpoint module: the runtime, the tools, the resources, the canvas and the resolver cannot reach it", () => {
    for (const f of walk(`${ROOT}packages`).filter((x) => /\.(ts|mjs)$/.test(x) && x.startsWith("packages/") && !x.startsWith("packages/mcp/test/") && !CHECKPOINT_MODULES.includes(x))) {
      assert.doesNotMatch(read(f), /from\s+"[^"]*checkpoint(?:-verify|-vocabulary)?\.ts"/, f);
    }
    for (const f of walk(`${ROOT}scripts`).filter((x) => /\.ts$/.test(x) && x !== "scripts/gen-wallprint-checkpoint-vectors.ts")) assert.doesNotMatch(read(f), /wallprint\/checkpoint|trust-checkpoint/, f);
    for (const f of ["plugin/server/walletwall-mcp.mjs", "security/tool-manifest.json", "security/plugin-manifest.json"]) {
      const text = read(f);
      for (const needle of ["walletwall.wallprint.trust-checkpoint", "governance-trust-root", "REGISTRY_LEDGER_CHECKPOINT", "registry-ledger-checkpoint", "LEDGER_ENTRY_PREDATES_ANCHORED_REGISTRY_HEAD"]) assert.equal(text.includes(needle), false, `${f}: ${needle}`);
    }
  });

  test("the six tools and eleven resources are unchanged, and none is named for a checkpoint, a trust root or a governance key", () => {
    const manifest = JSON.parse(read("security/tool-manifest.json")) as { tools: { name: string }[]; resources: { uri: string }[] };
    assert.equal(manifest.tools.length, 6);
    assert.equal(manifest.resources.length, 11);
    assert.deepEqual(manifest.tools.map((t) => t.name).filter((n) => /checkpoint|governance|trust[-_]?root/i.test(n)), []);
    assert.deepEqual(manifest.resources.map((r) => r.uri).filter((u) => /checkpoint|governance|trust[-_]?root/i.test(u)), []);
  });

  test("the checkpoint modules hold no signing primitive, no key generation, no secret, no clock, no randomness, and no governance key literal", () => {
    for (const m of CHECKPOINT_MODULES) {
      const text = read(m);
      assert.doesNotMatch(text, /createPrivateKey|generateKeyPair|createSign|createSecretKey|createHmac|\bsign\(|subtle\.|privateKey|PRIVATE KEY|process\.env|randomBytes|randomUUID|Math\.random|Date\.now|new Date\(|readFile|writeFile|fetch\(/, m);
      assert.doesNotMatch(text, /\b[0-9a-f]{64}\b/, `${m} holds no 32-byte hex literal: no key, no digest, no root`);
      assert.doesNotMatch(text, /createHash|sha256Hex\(|crypto\.subtle/, `${m} adds no SHA-256 site`);
    }
    assert.doesNotMatch(read("packages/mcp/src/wallprint/checkpoint.ts"), /\bexport const (?:DEFAULT|PRODUCTION|WALLETWALL)[A-Z_]*ROOT\b/);
  });

  test("the checkpoint's identity is the engine's existing digest function, and the signed bytes use the one shared construction", () => {
    const checkpoint = read("packages/mcp/src/wallprint/checkpoint.ts");
    assert.match(checkpoint, /evidenceDigest\(envelope\)/);
    assert.match(checkpoint, /domainSeparatedPreimage\(CHECKPOINT_DOMAIN_TAGS\[statement\.purpose\], statement\)/);
    assert.doesNotMatch(checkpoint, /TextEncoder\(\)\.encode\(tag|set\(tag|out\.set\(/, "no second assembly of the signed bytes");
    assert.match(read("packages/mcp/src/wallprint/attestation.ts"), /domainSeparatedPreimage\(DOMAIN_TAGS\[statement\.purpose\], statement\)/);
    const integrity = JSON.parse(read("security/integrity-policy.json")) as { sha256Exceptions: Record<string, Record<string, string>> };
    const registered = Object.values(integrity.sha256Exceptions).flatMap((group) => Object.values(group));
    for (const m of CHECKPOINT_MODULES) assert.equal(registered.includes(m), false, `${m} is not, and needs not be, an integrity-policy exception`);
  });

  test("the lane publishes no checkpoint and no trust root: the public store has no checkpoints directory and the resolver reads none", () => {
    for (const dir of ["checkpoints", "attestation-trust", "governance"]) assert.equal(existsSync(`${ROOT}packages/wallprint-web/publication/${dir}`), false, dir);
    for (const f of walk(`${ROOT}packages/wallprint-web`).filter((x) => /^packages\/wallprint-web\/(lib|browser)\//.test(x))) assert.doesNotMatch(read(f), /trust-checkpoint|governance-trust-root|REGISTRY_LEDGER/i, f);
    for (const f of walk(`${ROOT}scripts`).filter((x) => /publish|build-wallprint-public/.test(x))) assert.doesNotMatch(read(f), /trust-checkpoint|governance-trust-root/i, f);
  });

  test("the synthetic governance keys are labelled public seeds, and signing still exists in exactly one place", () => {
    for (const g of Object.values(GOV)) {
      assert.match(seedLabel(g.n), /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/);
      assert.equal(Buffer.from(seedLabel(g.n), "utf8").length, 32);
    }
    const signers = walk(ROOT).filter((f) => /\.(ts|mjs)$/.test(f) && f.startsWith("packages/mcp/test/") && f !== "packages/mcp/test/wallprint/attestation-isolation.test.ts" && /createPrivateKey|\bsign\(/.test(read(f)));
    assert.deepEqual(signers.filter((f) => /wallprint/.test(f)), ["packages/mcp/test/support/wallprint-attestations.ts"]);
  });
});


describe("attestation lane: WallPrint 0.2 is unchanged", () => {
  test("the WallPrint contract version, its supported versions and the record shape did not move", async () => {
    const { WALLPRINT_VERSION, WALLPRINT_VERSIONS } = await import("../../src/wallprint/vocabulary.ts");
    assert.equal(WALLPRINT_VERSION, "0.2");
    assert.deepEqual([...WALLPRINT_VERSIONS], ["0.1", "0.2"]);
    const record = read("packages/mcp/src/wallprint/record.ts");
    assert.doesNotMatch(record, /attestation|signature/i, "the record module knows nothing of attestations");
    assert.doesNotMatch(read("packages/mcp/src/wallprint/vocabulary.ts"), /attestation/i);
    assert.doesNotMatch(read("packages/mcp/src/wallprint/receipt.ts"), /attestation/i);
    assert.doesNotMatch(read("packages/mcp/src/wallprint/reference.ts"), /attestation/i);
  });
});
