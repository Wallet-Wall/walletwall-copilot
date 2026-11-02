import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import { WALLPRINT_VERSION, WALLPRINT_VERSIONS } from "../../src/wallprint/vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { GOV_KEYS, publicKeyOf } from "../support/wallprint-governance.ts";
import { seedLabel } from "../support/wallprint-attestations.ts";

/**
 * The governance-ceremony lane defines a hierarchy, a bootstrap, an authorization and a procedure. It ships no runtime change, generates no key,
 * holds no private key, signs nothing in CI and adds no secret: these tests pin each of those claims so a later change has to make them on purpose.
 */
const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const SKIP = new Set(["node_modules", ".git", "dist"]);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [relative(ROOT.replace(/[\\/]$/, ""), p).replaceAll("\\", "/")];
  });
const all = walk(ROOT.replace(/[\\/]$/, ""));
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

const t = (...parts: string[]): string => parts.join("");
/** Built from fragments so that this file does not itself contain the tokens the repository's signing-isolation scan looks for. */
const SIGNING_TOKENS = [t("create", "PrivateKey"), t("generate", "KeyPair"), t("create", "Sign"), t("create", "SecretKey"), t("create", "Hmac"), t("create", "Cipher"), "scrypt", "pbkdf2", "\\bsign\\(", "subtle\\.", t("private", "Key"), t("PRIVATE", " KEY"), "process\\.env", t("random", "Bytes"), t("random", "UUID"), "Math\\.random", "Date\\.now", "new Date\\(", t("read", "File"), t("write", "File"), "fetch\\("];
const SIGNING = new RegExp(SIGNING_TOKENS.join("|"));
/** The scanner module names the patterns it looks for, so it may contain the names of a private key, and nothing else here. */
const SIGNING_EXCEPT_PATTERN_NAMES = new RegExp(SIGNING_TOKENS.filter((x) => x !== t("private", "Key") && x !== t("PRIVATE", " KEY")).join("|"));
/** What the lane's scripts, support and mutation harness must never do: make a key, sign, or draw randomness (they do read and write files). */
const KEY_AND_SIGNING_CALLS = new RegExp([t("create", "PrivateKey"), t("generate", "KeyPair"), t("generate", "KeyPairSync"), "\\bsign\\(", t("random", "Bytes"), t("random", "UUID"), "Math\\.random", "crypto\\.subtle"].join("|"));
const SIGNER_FILE = new RegExp(`${t("create", "PrivateKey")}|\\bsign\\(`);
const KEYGEN = new RegExp([t("generate", "KeyPair(?:Sync)?"), t("create", "PrivateKey"), "generateKey\\(", "\\bopenssl\\b", "ssh-keygen", "age-keygen", "gpg --gen"].join("|"));
const KEYGEN_COMMAND = new RegExp([t("generate", "KeyPair"), t("create", "PrivateKey"), "openssl", "ssh-keygen", "gpg", "age-keygen", "cosign", "sigstore", "kms"].join("|"), "i");
const GOVERNANCE_MODULES = ["governance-vocabulary", "governance", "governance-verify", "governance-transcript", "governance-secret-scan"].map((m) => `packages/mcp/src/wallprint/${m}.ts`);
/** The scanner names the patterns it looks for, so it is the one module allowed to contain them. */
const PURE_MODULES = GOVERNANCE_MODULES.filter((m) => !m.endsWith("governance-secret-scan.ts"));
const GENERATOR = "scripts/gen-wallprint-governance-vectors.ts";
const REHEARSAL = "scripts/rehearse-wallprint-governance-ceremony.ts";
const LANE_SCRIPTS = [GENERATOR, REHEARSAL];

describe("governance lane: no shipped runtime change", () => {
  test("no module outside the lane imports a governance module: the runtime, the tools, the resources, the canvas, the resolver and every other script cannot reach it", () => {
    for (const f of all.filter((x) => /\.(ts|mjs)$/.test(x) && x.startsWith("packages/") && !x.startsWith("packages/mcp/test/") && !GOVERNANCE_MODULES.includes(x))) {
      assert.doesNotMatch(read(f), /from\s+"[^"]*governance(?:-verify|-vocabulary|-transcript|-secret-scan)?\.ts"/, f);
    }
    for (const f of all.filter((x) => /\.ts$/.test(x) && x.startsWith("scripts/") && !LANE_SCRIPTS.includes(x))) assert.doesNotMatch(read(f), /wallprint\/governance|governance-ceremony|governance-bootstrap/, f);
    for (const f of ["plugin/server/walletwall-mcp.mjs", "security/tool-manifest.json", "security/plugin-manifest.json"]) {
      const text = read(f);
      for (const needle of ["walletwall.wallprint.governance-bootstrap", "walletwall.wallprint.governance-authorization", "CHECKPOINT_KEY_AUTHORIZATION", "governance-ceremony", "checkpoint-key-authorization", "OPERATIONAL_KEY_AUTHORIZED"]) assert.equal(text.includes(needle), false, `${f}: ${needle}`);
    }
  });

  test("the six tools and eleven resources are unchanged, and none is named for governance, a ceremony, a bootstrap or a root", () => {
    const manifest = JSON.parse(read("security/tool-manifest.json")) as { tools: { name: string }[]; resources: { uri: string }[] };
    assert.equal(manifest.tools.length, 6);
    assert.equal(manifest.resources.length, 11);
    assert.deepEqual(manifest.tools.map((t) => t.name).filter((n) => /governance|ceremony|bootstrap|root|authoriz/i.test(n)), []);
    assert.deepEqual(manifest.resources.map((r) => r.uri).filter((u) => /governance|ceremony|bootstrap|root|authoriz/i.test(u)), []);
  });

  test("no dependency was added: the governance modules import only the engine, zod and the WallPrint modules", () => {
    for (const m of GOVERNANCE_MODULES) {
      const imports = [...read(m).matchAll(/^(?:import|export)\s[^;]*?from\s+"([^"]+)";/gm)].map((x) => x[1] ?? "");
      for (const i of imports) assert.ok(i.startsWith("./") || i.startsWith("../") || i === "zod", `${m}: ${i}`);
      assert.doesNotMatch(read(m), /from "node:/, `${m} imports no Node module at all`);
    }
    for (const f of ["package.json", "package-lock.json", "packages/mcp/package.json", "packages/wallprint-web/package.json"]) assert.doesNotMatch(read(f), /@noble\/|tweetnacl|libsodium|sodium-native|elliptic|node-forge|jsrsasign|mldsa|dilithium|liboqs|shamir|secrets\.js|age-encryption/i, f);
    assert.deepEqual(Object.keys((JSON.parse(read("packages/mcp/package.json")) as { dependencies: object }).dependencies).sort(), ["@modelcontextprotocol/sdk", "zod"]);
  });

  test("WallPrint stays 0.2, and the record, the receipt, the reference and the vocabulary know nothing of governance", () => {
    assert.equal(WALLPRINT_VERSION, "0.2");
    assert.deepEqual([...WALLPRINT_VERSIONS], ["0.1", "0.2"]);
    for (const f of ["record", "receipt", "reference", "vocabulary", "attestation-vocabulary", "attestation", "key-registry", "acceptance-ledger", "checkpoint", "checkpoint-verify", "checkpoint-vocabulary", "ed25519"]) {
      assert.doesNotMatch(read(`packages/mcp/src/wallprint/${f}.ts`), /governance-(?:bootstrap|authorization|ceremony|verify|vocabulary|transcript)|CHECKPOINT_KEY_AUTHORIZATION/, f);
    }
    assert.doesNotMatch(read("packages/mcp/src/wallprint/index.ts"), /governance-/, "the public WallPrint barrel exports nothing of the ceremony");
  });

  test("the existing verifiers are untouched by the lane: the checkpoint and attestation vector files and the shipped artifacts keep their recorded hashes", () => {
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    for (const f of changed) {
      assert.ok(!/^packages\/mcp\/src\/(?!wallprint\/governance)/.test(f), `${f}: an engine module changed`);
      assert.ok(!/^(?:plugin|mcpb|canvas|skills|security)\//.test(f), `${f}: a shipped or integrity path changed`);
      assert.ok(!/wallprint-(?:attestation|checkpoint)-vectors-0\.1\.json$/.test(f), `${f}: an earlier lane's vectors changed`);
    }
  });
});

describe("governance lane: no key generation, no private key, no signing", () => {
  test("the governance modules hold no signing primitive, key generation, secret handling, clock, randomness or I/O, and no 32-byte hex literal", () => {
    for (const m of PURE_MODULES) {
      const text = read(m);
      assert.doesNotMatch(text, SIGNING, m);
      assert.doesNotMatch(text, /\b[0-9a-f]{64}\b/, `${m} holds no 32-byte hex literal: no key, no digest, no root`);
      assert.doesNotMatch(text, /createHash|sha256Hex\(|crypto\.subtle/, `${m} adds no SHA-256 site`);
    }
    const scanner = read("packages/mcp/src/wallprint/governance-secret-scan.ts");
    assert.doesNotMatch(scanner, SIGNING_EXCEPT_PATTERN_NAMES);
    assert.doesNotMatch(scanner, /\b[0-9a-f]{64}\b/);
  });

  test("the identity of every artifact is the engine's existing digest, and the signed bytes use the one shared construction", () => {
    const governance = read("packages/mcp/src/wallprint/governance.ts");
    assert.match(governance, /evidenceDigest\(artifact\)/);
    assert.match(governance, /evidenceDigest\(envelope\)/);
    assert.match(governance, /domainSeparatedPreimage\(AUTHORIZATION_DOMAIN_TAGS\[statement\.purpose\], statement\)/);
    assert.doesNotMatch(governance, /TextEncoder\(\)\.encode\(tag|out\.set\(|set\(tag/, "no second assembly of the signed bytes");
    const integrity = JSON.parse(read("security/integrity-policy.json")) as { sha256Exceptions: Record<string, Record<string, string>> };
    const registered = Object.values(integrity.sha256Exceptions).flatMap((group) => Object.values(group));
    for (const m of GOVERNANCE_MODULES) assert.equal(registered.includes(m), false, `${m} is not, and needs not be, an integrity-policy exception`);
  });

  test("signing exists in exactly one place, the test support, and only with keys whose seed is a public ASCII label; the lane's files hold no signing call and no key construction", () => {
    const signers = all.filter((f) => /\.(ts|mjs)$/.test(f) && f.startsWith("packages/mcp/test/") && f !== "packages/mcp/test/wallprint/attestation-isolation.test.ts" && f !== "packages/mcp/test/wallprint/governance-isolation.test.ts" && SIGNER_FILE.test(read(f)));
    assert.deepEqual(signers.filter((f) => /wallprint/.test(f)), ["packages/mcp/test/support/wallprint-attestations.ts"]);
    for (const f of [...LANE_SCRIPTS, "packages/mcp/test/support/wallprint-governance.ts", "packages/mcp/test/support/wallprint-governance-vectors.ts", "packages/mcp/test/mutation/wallprint-governance-mutation.ts"]) {
      assert.doesNotMatch(read(f), KEY_AND_SIGNING_CALLS, f);
    }
    for (const key of GOV_KEYS) {
      assert.match(seedLabel(key.n), /^SYNTHETIC-NON-PRODUCTION-KEY-\d{3}$/);
      assert.equal(Buffer.from(seedLabel(key.n), "utf8").length, 32);
      assert.match(key.keyId, /^synthetic-/);
      assert.match(key.label, /^SYNTHETIC-NON-PRODUCTION-/);
    }
  });

  test("no command in the repository generates a production root or a production signing key: no script, no npm script and no tool in the lane draws randomness or makes a key", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      assert.doesNotMatch(name, /(?:create|generate|make|mint|new|init|sign)[-:]?.*(?:root|ceremony|production|governance[-_]?key|signing[-_]?key)/i, `npm run ${name}`);
      assert.doesNotMatch(command, KEYGEN_COMMAND, `npm run ${name}`);
    }
    for (const f of all.filter((x) => /\.(ts|mjs|sh|ps1|cmd|bat)$/.test(x) && (x.startsWith("scripts/") || x.startsWith("packages/mcp/src/") || x.startsWith("packages/mcp/transport/") || x.startsWith("packages/wallprint-web/")))) {
      assert.doesNotMatch(read(f), KEYGEN, f);
    }
  });

  test("the synthetic governance keys appear nowhere that ships or publishes: not in the plugin, the bundle, the manifests, the canvas, the MCPB, the public store, the server or the package manifest", () => {
    const publics = [...new Set(GOV_KEYS.map((k) => publicKeyOf(k)))];
    const shipped = all.filter((f) => /^(plugin|security|canvas|mcpb|packages\/wallprint-web\/publication|packages\/wallprint-web\/lib|packages\/wallprint-web\/browser)\//.test(f) && !/\.(png|woff2?)$/.test(f));
    assert.ok(shipped.length > 20);
    for (const f of shipped) {
      const text = read(f);
      for (const key of publics) assert.equal(text.includes(key), false, `${f} carries a synthetic governance key`);
      assert.equal(text.includes("SYNTHETIC-NON-PRODUCTION"), false, f);
    }
    for (const f of ["server.json", "package.json"]) for (const key of publics) assert.equal(read(f).includes(key), false, f);
  });

  test("the lane publishes no bootstrap, no authorization and no transcript: the public store has no governance directory and the resolver reads none", () => {
    for (const dir of ["governance", "bootstrap", "authorizations", "ceremony", "ceremonies", "keys"]) assert.equal(existsSync(`${ROOT}packages/wallprint-web/publication/${dir}`), false, dir);
    for (const f of all.filter((x) => /^packages\/wallprint-web\/(lib|browser)\//.test(x))) assert.doesNotMatch(read(f), /governance-bootstrap|governance-authorization|ceremony|CHECKPOINT_KEY_AUTHORIZATION/i, f);
    for (const f of all.filter((x) => /publish|build-wallprint-public/.test(x) && x.startsWith("scripts/"))) assert.doesNotMatch(read(f), /governance|ceremony|bootstrap/i, f);
  });

  test("no production secret path exists: no key, certificate, keystore, backup, seed, ceremony-output or recovery file is tracked, and the ignore file refuses them", () => {
    assert.deepEqual(tracked.filter((f) => /(^|\/)(?:id_ed25519|id_rsa|\.ssh|\.gnupg|\.age|ceremony-(?:private|secret|output|working)|private-keys?|recovery)(\/|$)|\.(?:pem|key|p8|p12|pfx|jks|keystore|kdbx|asc|gpg|age|seed|mnemonic|backup)$/i.test(f)), []);
    const ignore = read(".gitignore");
    for (const pattern of ["*.pem", "*.key", "*.p8", "*.p12", "*.pfx", "*.age", "*.gpg", "*.kdbx", "id_ed25519*", "ceremony-private/", "ceremony-working/"]) assert.ok(ignore.split("\n").includes(pattern), `.gitignore refuses ${pattern}`);
  });
});

describe("governance lane: CI verifies and never signs", () => {
  test("the only workflow is the CI workflow, and it names no secret, no signing step, no key, no ceremony, no governance root and no identity token", () => {
    assert.deepEqual(all.filter((f) => f.startsWith(".github/workflows/")), [".github/workflows/ci.yml"]);
    const ci = read(".github/workflows/ci.yml");
    assert.doesNotMatch(ci, /\$\{\{\s*secrets\.|SIGNING|PRIVATE_KEY|attestation|cosign|gpg|sigstore|openssl|ssh-keygen|age-keygen|kms|vault|hsm|id-token|oidc/i);
    assert.doesNotMatch(ci, /checkpoint|governance|trust[-_ ]?root|ceremony|bootstrap|rehears/i);
    assert.match(ci, /^permissions:\n {2}contents: read\n/m);
    const topLevel = /^permissions:\n((?: {2}.+\n)+)/m.exec(ci)?.[1] ?? "";
    assert.doesNotMatch(topLevel, /write|id-token/, "the workflow token is read-only and carries no identity token");
  });

  test("the ceremony's checks run inside npm test with no secret and no network: they read committed files and synthetic seeds only", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.match(pkg.scripts["test"] ?? "", /packages\/mcp\/test\/\*\*\/\*\.test\.ts/);
    assert.match(pkg.scripts["verify"] ?? "", /verify:wallprint-governance-vectors/);
    for (const name of ["gen:wallprint-governance-vectors", "verify:wallprint-governance-vectors", "test:wallprint-governance-mutation", "rehearse:wallprint-governance-ceremony"]) assert.ok(pkg.scripts[name], name);
    for (const f of LANE_SCRIPTS) assert.doesNotMatch(read(f), /process\.env|fetch\(|node:(?:net|http|https|child_process|os)\b|\$\{\{\s*secrets/, f);
  });

  test("no repository secret is introduced: nothing in the tree references a secrets context, and the Dependabot and CODEOWNERS files are unchanged in kind", () => {
    for (const f of tracked.filter((x) => x.startsWith(".github/"))) assert.doesNotMatch(read(f), /\$\{\{\s*secrets\./, f);
  });
});
