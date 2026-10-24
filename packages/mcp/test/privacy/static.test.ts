import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { RESOURCES } from "../../src/resources.ts";
import { TOOLS } from "../../src/tools.ts";

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const srcFiles = walk(`${ROOT}packages/mcp/src`, (p) => p.endsWith(".ts") && !p.includes("generated"));
const read = (p: string): string => readFileSync(p, "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const relative = (p: string): string => p.slice(ROOT.length).replaceAll("\\", "/");

describe("privacy static proofs", () => {
  test("PRIV-003 engine source imports no network, filesystem, process, OS or vm module", () => {
    const banned = /^(node:)?(fs|fs\/promises|net|http|https|http2|dgram|dns|dns\/promises|tls|child_process|cluster|worker_threads|os|vm|inspector|readline|repl|v8|perf_hooks|diagnostics_channel)$/;
    for (const f of srcFiles) {
      for (const m of stripComments(read(f)).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
        assert.ok(!banned.test(m[1] as string), `${relative(f)} imports ${m[1]}`);
      }
    }
  });

  test("PRIV-003 engine source contains no URL, network primitive, dynamic import, eval or clock read", () => {
    for (const f of srcFiles) {
      const code = stripComments(read(f));
      assert.ok(!/https?:\/\//.test(code), `${relative(f)} contains a URL literal`);
      assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(code), `${relative(f)} uses a network primitive`);
      assert.ok(!/\bimport\s*\(/.test(code), `${relative(f)} uses dynamic import`);
      assert.ok(!/\beval\s*\(|new\s+Function\b/.test(code), `${relative(f)} evaluates code`);
      assert.ok(!/Date\.now\s*\(|new\s+Date\s*\(\s*\)/.test(code), `${relative(f)} reads the clock`);
    }
  });

  test("PRIV-004 no telemetry, analytics or crash-reporting dependency in the production dependency tree", () => {
    const lock = JSON.parse(read(`${ROOT}package-lock.json`)) as { packages: Record<string, { dev?: boolean; version?: string }> };
    const deny = /(sentry|bugsnag|rollbar|datadog|newrelic|appinsights|applicationinsights|segment|analytics|amplitude|mixpanel|posthog|honeycomb|opentelemetry|telemetry|logrocket|raygun|instana|dynatrace|elastic-apm|crashpad|minidump|node-machine-id|machine-id|systeminformation)/i;
    const prod = Object.entries(lock.packages).filter(([k, v]) => k.includes("node_modules/") && v.dev !== true);
    assert.ok(prod.length > 10, "lock scan found no production packages");
    for (const [name] of prod) assert.ok(!deny.test(name), `production dependency ${name} matches a telemetry pattern`);
    const mcp = JSON.parse(read(`${ROOT}packages/mcp/package.json`)) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(mcp.dependencies).sort(), ["@modelcontextprotocol/sdk", "zod"]);
  });

  test("PRIV-004 the shipped bundle imports only node:crypto and node:process and carries no telemetry package", () => {
    const bundle = read(`${ROOT}plugin/server/walletwall-mcp.mjs`);
    const specs = new Set([...bundle.matchAll(/\bfrom\s*["'](node:[^"']+)["']/g)].map((m) => m[1]));
    assert.deepEqual([...specs].sort(), ["node:crypto", "node:process"]);
    assert.ok(!/require\(\s*["'](node:)?(fs|net|http|https|dns|child_process|os|tls|dgram|worker_threads)["']\s*\)/.test(bundle));
    assert.ok(!/(sentry|posthog|mixpanel|amplitude|appinsights|bugsnag|datadog)/i.test(bundle));
    assert.ok(!/walletwall\.(com|io|xyz|app|dev|org)|vercel\.app|googleapis\.com|run\.app|upstash/i.test(bundle));
  });

  test("PRIV-007 PRIV-008 engine source never generates identifiers or reads machine identity", () => {
    const re = /\b(randomUUID|randomBytes|randomInt|randomFill|getRandomValues|Math\.random|hostname|networkInterfaces|userInfo|machineId|fingerprint|navigator|uuid)\b/i;
    for (const f of srcFiles) {
      const code = stripComments(read(f));
      assert.ok(!re.test(code), `${relative(f)}: ${re.exec(code)?.[0]}`);
    }
  });

  test("PRIV-011 engine source never reads the environment or the filesystem path of the user", () => {
    for (const f of srcFiles) {
      const code = stripComments(read(f));
      assert.ok(!/process\.env|process\.cwd|homedir|tmpdir|__dirname|import\.meta\.(dirname|url)/.test(code), relative(f));
    }
  });

  test("PRIV-012 crash handling prints one fixed line and exits; there is no uploader or report writer", () => {
    const main = stripComments(read(`${ROOT}packages/mcp/src/main.ts`));
    assert.ok(main.includes('process.stderr.write("walletwall-mcp: fatal error\\n")'));
    assert.ok(/uncaughtException", fatal/.test(main) && /unhandledRejection", fatal/.test(main));
    assert.ok(!/report|upload|submit|send|post/i.test(main.replace(/process\.stderr\.write\("walletwall-mcp: fatal error\\n"\)/, "")));
    for (const f of srcFiles) assert.ok(!/console\.(log|error|warn|info|debug)/.test(stripComments(read(f))), `${relative(f)} logs`);
  });

  test("PRIV-013 tools, resources and engine source contain no natural-person enrichment capability", () => {
    const re = /\b(kyc|aml|ofac|sanction(s|ed)?|ens name|reverse ens|twitter|telegram|discord|linkedin|e-?mail address|phone number|doxx|deanonymi[sz]|real name|owner identity|social profile|attribution of (a )?wallet)\b/i;
    for (const t of TOOLS) assert.ok(!re.test(`${t.name} ${t.title} ${t.description}`), t.name);
    for (const r of RESOURCES) assert.ok(!re.test(`${r.name} ${r.title} ${r.description} ${r.read()}`), r.uri);
    for (const f of srcFiles) assert.ok(!re.test(stripComments(read(f))), relative(f));
  });

  test("PRIV-013 the registry holds issuers and protocols, never natural persons or wallet owners", () => {
    const reg = JSON.parse(read(`${ROOT}packages/mcp/registry/stablecoins.json`)) as { assets: Record<string, string>[] };
    const allowedKeys = ["symbol", "name", "chainId", "address", "decimals", "issuerName", "authorityId", "verification"];
    for (const a of reg.assets) assert.deepEqual(Object.keys(a).sort(), [...allowedKeys].sort());
  });

  test("PRIV-003 plugin files reference no WalletWall runtime endpoint, credential or environment variable", () => {
    // plugin/LICENSE is the unmodified Apache-2.0 text (pinned by SHA-256 in repo/public-release.test.ts); it quotes the license's own URL and is legal text, not plugin behaviour.
    // plugin/THIRD_PARTY_NOTICES.md reproduces the embedded fonts' SIL Open Font License texts, which must ship unmodified; these
    // are the only URLs they contain, and they are legal text, not something the plugin contacts.
    const LICENSE_TEXT_URLS = new Set(["http://scripts.sil.org/OFL", "https://github.com/sora-xor/sora-font", "https://github.com/sharanda/manrope"]);
    const pluginFiles = walk(`${ROOT}plugin`, (p) => !p.endsWith("walletwall-mcp.mjs") && !p.replaceAll("\\", "/").endsWith("/plugin/LICENSE"));
    assert.ok(pluginFiles.length >= 3);
    for (const f of pluginFiles) {
      const text = read(f);
      assert.ok(!/(api[_-]?key|secret|token|password|bearer)\s*[:=]/i.test(text), `${relative(f)} looks like it holds a credential`);
      for (const m of text.matchAll(/https?:\/\/[^\s"')>]+/g)) {
        const loopbackOnly = relative(f).startsWith("plugin/com.github.copilot/") && /^http:\/\/127\.0\.0\.1(:\$\{[^}]+\})?/.test(m[0]);
        const licenseText = relative(f) === "plugin/THIRD_PARTY_NOTICES.md" && LICENSE_TEXT_URLS.has(m[0]);
        assert.ok(
          loopbackOnly || licenseText || /^https:\/\/github\.com\/Wallet-Wall\/walletwallrus-copilot/.test(m[0]) || /^https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\/(plugin|mcp)\.schema\.json$/.test(m[0]),
          `${relative(f)} references ${m[0]}`,
        );
      }
    }
    const mcp = JSON.parse(read(`${ROOT}plugin/mcp.json`)) as { mcpServers: Record<string, Record<string, unknown>> };
    for (const server of Object.values(mcp.mcpServers)) {
      assert.equal(server["type"], "stdio");
      assert.equal(server["env"], undefined);
      assert.equal(server["url"], undefined);
    }
  });

  test("every PRIV requirement 001..019 is named by at least one privacy test and listed in the matrix", () => {
    const text = [...walk(`${ROOT}packages/mcp/test/privacy`, (p) => p.endsWith(".test.ts")), ...walk(`${ROOT}packages/mcp/test/canvas`, (p) => p.endsWith(".test.ts"))].map(read).join("\n");
    const matrix = JSON.parse(read(`${ROOT}conformance/privacy/PRIV-matrix.json`)) as { requirements: { id: string }[] };
    assert.equal(matrix.requirements.length, 19);
    for (let i = 1; i <= 19; i++) {
      const id = `PRIV-${String(i).padStart(3, "0")}`;
      assert.ok(text.includes(id), `${id} has no test`);
      assert.ok(matrix.requirements.some((r) => r.id === id), `${id} missing from matrix`);
    }
  });
});
