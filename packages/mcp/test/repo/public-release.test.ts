import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join, relative } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { PROHIBITED_CLAIM_PATTERNS } from "../support/claims.ts";

const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

const SKIP_DIRS = new Set(["node_modules", ".git", ".playwright-mcp"]);
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|zip|gz)$/i;
const SELF = "packages/mcp/test/repo/public-release.test.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(relative(ROOT, p).replaceAll("\\", "/"));
  }
  return out;
}
const ALL = walk(ROOT.replace(/[\\/]$/, ""));
// Third-party code (the bundle) and the lockfile are covered by their own tests; binaries are covered by review.
const TEXT = ALL.filter((f) => !BINARY.test(f) && f !== "package-lock.json" && f !== "plugin/server/walletwall-mcp.mjs" && f !== SELF && f !== "packages/mcp/test/repo/workflows.test.ts");

describe("public repository hygiene: what is in the tree", () => {
  test("only the expected top-level entries exist (a new one must be a conscious decision)", () => {
    const expected = [
      ".gitattributes", ".github", ".gitignore", "BOUNDARIES.md", "CONTRIBUTING.md", "DATA_SOURCES.md", "LICENSE", "PRIVACY.md", "README.md", "SECURITY.md", "THREAT_MODEL.md", "TRADEMARKS.md",
      "canvas", "conformance", "docs", "eslint.config.js", "evals", "package-lock.json", "package.json", "packages", "plugin", "scripts", "security", "skills", "spec", "tsconfig.json",
    ];
    const actual = readdirSync(ROOT.replace(/[\\/]$/, "")).filter((n) => !SKIP_DIRS.has(n));
    assert.deepEqual(actual.sort(), [...expected].sort());
  });

  test("no environment file, log, backup, source map, key, database, editor or session artifact is in the tree", () => {
    const bad = ALL.filter((f) => /(^|\/)(\.env(\..*)?|\.DS_Store|Thumbs\.db|\.copilot|session-state|\.vscode|\.idea)(\/|$)|\.(map|log|bak|orig|rej|swp|pem|key|p12|pfx|sqlite|db|tsbuildinfo|jsonl)$|~$/i.test(f));
    assert.deepEqual(bad, []);
  });

  test("no personal filesystem path, e-mail address, non-loopback IP address, credential or session identifier appears in any tracked text file", () => {
    const patterns: [string, RegExp][] = [
      ["Windows user path", /[A-Za-z]:\\{1,2}Users\\{1,2}(?![<%*]|Public\b|Default\b)[A-Za-z0-9._-]+/],
      ["POSIX user path", /\/(?:Users|home)\/(?![<$]|runner\b|user\b)[A-Za-z0-9._-]+/],
      ["e-mail address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/],
      ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
      ["npm token", /\bnpm_[A-Za-z0-9]{30,}\b/],
      ["cloud key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b/],
      ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY/],
      ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
      ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
      ["bearer token", /\bbearer\s+[A-Za-z0-9._~+/-]{24,}/i],
      ["credentials in a URL", /[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]+@/i],
      ["database URL", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\//i],
      ["Copilot session or worktree metadata", /copilot-worktrees|session-state/],
    ];
    const allowedIp = new Set(["127.0.0.1", "0.0.0.0", "93.184.216.34"]);
    const hits: string[] = [];
    for (const f of TEXT) {
      const text = read(f);
      for (const [label, re] of patterns) {
        const m = re.exec(text);
        if (m) hits.push(`${f}: ${label}`);
      }
      for (const m of text.matchAll(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g)) if (!allowedIp.has(m[0])) hits.push(`${f}: IPv4 ${m[0]}`);
    }
    assert.deepEqual(hits, []);
  });

  // The account name is read at run time on purpose: writing it into this file would publish it. CI runners are skipped because
  // their generic account names ("runner") are ordinary words in documentation.
  const GENERIC_ACCOUNTS = new Set(["runner", "runneradmin", "root", "user", "admin", "administrator", "ubuntu", "vsts", "node", "docker", "default"]);
  const accounts = [...new Set([userInfo().username, basename(homedir())])].filter((a) => a.length >= 4 && !GENERIC_ACCOUNTS.has(a.toLowerCase()));
  test("the local OS account name of whoever runs the suite appears in no tracked text file", { skip: (process.env["CI"] !== undefined || process.env["GITHUB_ACTIONS"] !== undefined || accounts.length === 0) && "CI runner or generic account name" }, () => {
    const hits: string[] = [];
    // Every tracked text file, including this one, the bundle and the lockfile: a name written into a test would otherwise slip through.
    for (const f of ALL.filter((x) => !BINARY.test(x))) {
      const text = read(f);
      for (const a of accounts) {
        if (new RegExp(`(?<![A-Za-z0-9-])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9-])`, "i").test(text)) hits.push(`${f}: local account name`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test("the MCP package would publish only its source, registry and policies, never tests or local files", () => {
    const pkg = JSON.parse(read("packages/mcp/package.json")) as { files?: string[]; private?: boolean };
    assert.deepEqual(pkg.files, ["src", "registry", "authority-policies"]);
    assert.equal(pkg.private, true, "nothing is published in this lane");
  });

  test("the only wallet addresses in the tree are the five registry deployments or obvious synthetic fixtures", () => {
    const registry = new Set((JSON.parse(read("packages/mcp/registry/stablecoins.json")) as { assets: { address: string }[] }).assets.map((a) => a.address.toLowerCase()));
    const synthetic = (a: string): boolean => a === "0x1234567890123456789012345678901234567890" || /^0x(.)\1{39}$/.test(a) || /^0x(?:dead){10}$/.test(a) || /^0x0{39}1$/.test(a);
    const seen = new Set<string>();
    for (const f of TEXT) for (const m of read(f).matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) seen.add(m[0].toLowerCase());
    const unexplained = [...seen].filter((a) => !registry.has(a) && !synthetic(a));
    assert.deepEqual(unexplained, [], "an address that is neither a registry deployment nor an obvious fixture may be a real person's wallet");
  });
});

describe("registry redistribution: facts and pointers only, every record documented", () => {
  const registry = JSON.parse(read("packages/mcp/registry/stablecoins.json")) as { assets: { symbol: string; chainId: string; address: string; verification: { identity: { url: string; publishedAddress: string; locator: string; publisher: string } } }[] };
  const doc = read("docs/REGISTRY_SOURCES.md");

  test("no registry string is long enough to be copied prose (the descriptive note excepted)", () => {
    const longest: string[] = [];
    const visit = (v: unknown, key: string): void => {
      if (typeof v === "string") {
        if (key !== "note" && v.length > 200) longest.push(`${key}: ${v.length}`);
      } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
      else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
    };
    visit(registry, "root");
    visit(JSON.parse(read("packages/mcp/registry/chains.json")), "root");
    assert.deepEqual(longest, []);
  });

  test("every record is listed in docs/REGISTRY_SOURCES.md with its address, publisher URL and locator", () => {
    assert.equal(registry.assets.length, 5);
    for (const a of registry.assets) {
      assert.ok(doc.includes(a.address), `${a.symbol} ${a.chainId}: address`);
      assert.ok(doc.includes(a.verification.identity.url), `${a.symbol} ${a.chainId}: URL`);
      assert.ok(norm(doc).includes(norm(a.verification.identity.locator)), `${a.symbol} ${a.chainId}: locator`);
    }
    assert.match(doc, /not live or current-chain data/i);
  });
});

describe("naming lock: WalletWall (product, plugin, canvas), WalletWall MCP (server)", () => {
  test("the public short description is identical in the README, plugin manifest and marketplace manifest", () => {
    const description = "Stablecoin intelligence and vault readiness for GitHub Copilot.";
    assert.ok(read("README.md").startsWith(`# WalletWall\n\n${description}\n`));
    assert.equal((JSON.parse(read("plugin/plugin.json")) as { description: string }).description, description);
    assert.equal((JSON.parse(read(".github/plugin/marketplace.json")) as { plugins: { description: string }[] }).plugins[0]?.description, description);
  });

  test("the canvas is labelled WalletWall everywhere a user can see it", () => {
    const ext = read("plugin/com.github.copilot/extensions/walletwall-evidence-explorer/extension.mjs");
    assert.match(ext, /displayName: "WalletWall",/);
    assert.ok(ext.includes("Inspect stablecoin identity, wallet state, source lineage, conflicts, and vault readiness through WalletWall MCP."));
    const render = read("plugin/com.github.copilot/extensions/walletwall-evidence-explorer/render.mjs");
    assert.ok(render.includes("<title>WalletWall</title>") && render.includes("<h1>WalletWall</h1>"));
    assert.ok(!/<h1>WalletWall [A-Z]/.test(render) && !/title: "WalletWall [A-Z]/.test(read("plugin/com.github.copilot/extensions/walletwall-evidence-explorer/explorer.mjs")));
  });

  test("the MCP server presents itself as WalletWall MCP", () => {
    assert.match(read("packages/mcp/src/version.ts"), /ENGINE_TITLE = "WalletWall MCP"/);
    assert.match(read("packages/mcp/src/server.ts"), /title: ENGINE_TITLE/);
  });

  test("retired public names are not used: Evidence Canvas, Stablecoin Evidence Explorer, MCP Canvas; Evidence Explorer only in historical records", () => {
    const historical = new Set(["docs/DESKTOP_INSTALL_PROOF.md", "docs/PUBLIC_RELEASE_AUDIT.md", "docs/GITHUB_COPILOT_INTEGRATION.md", "docs/PLUGIN_PATH_PRIVACY.md", "conformance/privacy/PRIV-matrix.json", "evals/cases.json"]);
    const hits: string[] = [];
    for (const f of TEXT.filter((x) => /\.(md|json|mjs)$/.test(x) && !x.startsWith("packages/mcp/test/") && !x.startsWith("evals/results/"))) {
      const t = read(f);
      if (/Evidence Canvas|Stablecoin Evidence|MCP Canvas/i.test(t)) hits.push(`${f}: retired name`);
      if (!historical.has(f) && /Evidence Explorer/.test(t) && !f.endsWith("generated/content.ts")) hits.push(`${f}: Evidence Explorer`);
    }
    assert.deepEqual(hits, []);
  });
});

describe("public claims: unsupported claims are absent, and the preferred statements are present", () => {
  const DOCS = [
    "README.md", "PRIVACY.md", "SECURITY.md", "BOUNDARIES.md", "DATA_SOURCES.md", "THREAT_MODEL.md", "TRADEMARKS.md", "CONTRIBUTING.md", "canvas/README.md", "skills/README.md", "plugin/README.md",
    "plugin/plugin.json", ".github/plugin/marketplace.json", ".github/pull_request_template.md", "plugin/skills/walletwall-evidence/SKILL.md",
    "plugin/com.github.copilot/extensions/walletwall-evidence-explorer/extension.mjs", "plugin/com.github.copilot/extensions/walletwall-evidence-explorer/render.mjs",
    ...ALL.filter((f) => /^docs\/[^/]+\.md$/.test(f) || /^spec\/[^/]+\.md$/.test(f)),
  ];
  const NEGATION = /\b(?:not|never|no|none|nor|without|cannot|reject(?:s|ed)?|ban(?:s|ned)?|prohibit(?:s|ed)?|forbid(?:s|den)?|den(?:y|ies)|avoid|refus(?:e|es|ed)|unsupported)\b|n't\b/i;
  const DENYING_HEADING = /will not|out of scope|prohibit|unsupported|not claim|retired|rejected/i;

  test("no prohibited claim appears except where it is being denied", () => {
    const hits: string[] = [];
    for (const f of DOCS) {
      const lines = read(f).split(/\r?\n/);
      let heading = "";
      lines.forEach((line, i) => {
        if (/^#{1,6}\s/.test(line)) heading = line;
        for (const [label, re] of PROHIBITED_CLAIM_PATTERNS) {
          if (!re.test(line)) continue;
          const denied = NEGATION.test(line) || NEGATION.test(lines[i - 1] ?? "") || DENYING_HEADING.test(heading);
          if (!denied) hits.push(`${f}:${i + 1}: ${label}`);
        }
      });
    }
    assert.deepEqual(hits, []);
  });

  test("README states what WalletWall is, its status and versions, and what it does not do", () => {
    const readme = norm(read("README.md"));
    assert.ok(readme.includes("WalletWall is a local, read-only Copilot plugin and MCP server for inspecting stablecoin identity, source lineage, conflicts and vault-readiness signals."));
    for (const s of ["Status: Pre-release", "WWEP: 0.1", "Registry: point-in-time verified"]) assert.ok(readme.includes(s), s);
    for (const w of ["sign", "custody", "trade", "broadcast transactions", "provide investment advice", "certify regulatory compliance"]) assert.ok(readme.includes(w), w);
    assert.ok(readme.length < 9000, "the README stays concise");
  });

  test("the preferred privacy statement and the support boundary are stated verbatim in the README and PRIVACY.md", () => {
    const privacy = "WalletWall-controlled code does not retain MCP query history or transmit query data to WalletWall infrastructure. GitHub Copilot and the selected model provider may independently process prompts and tool data under their own policies.";
    const support = "WalletWall reports what identified sources and authority policies support. A supported result does not guarantee that upstream information is correct.";
    for (const f of ["README.md", "PRIVACY.md"]) {
      assert.ok(norm(read(f)).includes(privacy), `${f}: privacy statement`);
      assert.ok(norm(read(f)).includes(support), `${f}: support boundary`);
    }
  });

  test("the bundled registry is described as point-in-time, never as live", () => {
    for (const f of ["README.md", "DATA_SOURCES.md", "docs/REGISTRY_SOURCES.md"]) assert.match(read(f), /point-in-time/i, f);
  });
});

describe("license metadata and third-party notices", () => {
  // SHA-256 of the unmodified text published at https://www.apache.org/licenses/LICENSE-2.0.txt
  const APACHE_2_0_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
  const sha256 = (p: string): string => createHash("sha256").update(readFileSync(`${ROOT}${p}`)).digest("hex");

  test("LICENSE is the standard, unmodified Apache License 2.0, and the copies shipped with the plugin and the MCP package are identical", () => {
    assert.equal(sha256("LICENSE"), APACHE_2_0_SHA256, "no edit, addition or custom restriction inside the license text");
    assert.equal(sha256("plugin/LICENSE"), APACHE_2_0_SHA256);
    assert.equal(sha256("packages/mcp/LICENSE"), APACHE_2_0_SHA256);
  });

  test("every manifest that declares a license declares Apache-2.0", () => {
    const plugin = JSON.parse(read("plugin/plugin.json")) as { license: string };
    const mp = JSON.parse(read(".github/plugin/marketplace.json")) as { plugins: { license: string }[] };
    assert.equal(plugin.license, "Apache-2.0");
    assert.equal(mp.plugins[0]?.license, "Apache-2.0");
    for (const p of ["package.json", "packages/mcp/package.json"]) assert.equal((JSON.parse(read(p)) as { license: string }).license, "Apache-2.0", p);
    assert.ok(!/LicenseRef|Proprietary|All rights reserved/i.test(["README.md", "CONTRIBUTING.md", "TRADEMARKS.md", "plugin/plugin.json", ".github/plugin/marketplace.json"].map(read).join("\n")), "no leftover proprietary wording");
  });

  test("the brand is kept separate from the software license: TRADEMARKS.md says the license grants no brand rights and adds no restriction", () => {
    const t = norm(read("TRADEMARKS.md"));
    assert.ok(t.includes("does not grant ownership of, or any right to use, the WalletWall brand"));
    assert.ok(t.includes("adds no restriction to the software license"));
    assert.ok(norm(read("README.md")).includes("does not grant rights to the WalletWall name, logos or marks"));
  });

  test("the license notices of every bundled third-party package ship inside the plugin", () => {
    const notices = read("plugin/THIRD_PARTY_NOTICES.md");
    for (const p of ["@modelcontextprotocol/sdk", "zod", "zod-to-json-schema"]) assert.ok(notices.includes(`## ${p} `), p);
    assert.ok(/Permission is hereby granted/.test(notices));
  });
});

describe("contribution and security governance", () => {
  test("CODEOWNERS names an owner for every sensitive path", () => {
    const text = read(".github/CODEOWNERS");
    const owned = new Set(text.split(/\r?\n/).filter((l) => /^\/?\S+\s+@\S+/.test(l)).map((l) => (l.trim().split(/\s+/)[0] ?? "").replace(/^\//, "")));
    for (const p of [
      ".github/workflows/", ".github/dependabot.yml", "plugin/", "packages/mcp/", "packages/mcp/src/", "packages/mcp/src/schemas.ts", "packages/mcp/registry/", "packages/mcp/authority-policies/", "canvas/", "spec/", "security/", "scripts/",
      "conformance/", "package.json", "package-lock.json", "SECURITY.md", "PRIVACY.md", "BOUNDARIES.md", "THREAT_MODEL.md", "DATA_SOURCES.md", "LICENSE", "docs/",
    ]) assert.ok(owned.has(p), `CODEOWNERS: ${p}`);
    for (const p of owned) if (!p.includes("*")) assert.ok(existsSync(`${ROOT}${p}`) && (p.endsWith("/") ? statSync(`${ROOT}${p}`).isDirectory() : true), `CODEOWNERS names a path that exists: ${p}`);
  });

  test("CONTRIBUTING names the good contribution categories, the heightened-review areas and the out-of-scope list", () => {
    const text = norm(read("CONTRIBUTING.md"));
    for (const s of ["Registry corrections", "Conformance vectors, adversarial tests", "Privacy and security tests", "Canvas usability and accessibility", "Documentation"]) assert.ok(text.includes(s), s);
    for (const s of ["WWEP semantics, authority policies", "MCP tool", "Networking, persistence, credentials", "Registry records"]) assert.ok(text.includes(s), s);
    for (const s of ["Custody", "Signing, transaction construction, broadcasting", "Arbitrary remote execution", "natural persons"]) assert.ok(text.includes(s), s);
  });

  test("SECURITY.md gives a private route and tells reporters not to use public issues; the issue chooser points to private reporting", () => {
    const sec = norm(read("SECURITY.md"));
    assert.ok(sec.includes("private vulnerability reporting"));
    assert.ok(/Do not open a public issue, discussion or pull request for a vulnerability/.test(sec));
    assert.ok(read(".github/ISSUE_TEMPLATE/config.yml").includes("/security/advisories/new"));
  });

  test("the pull request template asks about every sensitive area", () => {
    const t = read(".github/pull_request_template.md");
    for (const s of ["WWEP semantics", "MCP tool", "Registry records", "Networking, persistence, credentials", ".github/workflows/", "synthetic fixtures"]) assert.ok(t.includes(s), s);
  });

  test("the visibility-flip checklist and the audit summary exist and cover the required steps", () => {
    const checklist = read("docs/PUBLIC_VISIBILITY_FLIP_CHECKLIST.md");
    for (const s of ["bind the final audit HEAD", "full-history secret scan", "historical Actions", "private vulnerability reporting", "clean public clone", "Stop before npm"]) assert.ok(norm(checklist).toLowerCase().includes(s.toLowerCase()), s);
    assert.ok(existsSync(`${ROOT}docs/PUBLIC_RELEASE_AUDIT.md`));
  });

  test("the plugin release artifact is built by the deterministic packer and checked on Linux and Windows; git archive is not a release instruction", () => {
    const audit = read("docs/PUBLIC_RELEASE_AUDIT.md");
    const commands = [...audit.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1] as string).join("\n");
    assert.ok(commands.includes("node scripts/pack-plugin.ts --check") && commands.includes("npm run pack:plugin"), "the reproduction commands use scripts/pack-plugin.ts");
    assert.ok(!/git archive/.test(commands), "no release command uses git archive (it is not host-independent for a subtree)");
    const recorded = read("security/plugin-artifact.sha256").split(/\s+/)[0] ?? "";
    assert.match(recorded, /^[0-9a-f]{64}$/);
    assert.ok(audit.includes(`\`${recorded}\``), "the audit's current plugin artifact hash is the recorded one");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    assert.ok(pkg.scripts["verify"]?.includes("npm run verify:plugin-artifact"));
    const ci = read(".github/workflows/ci.yml");
    const jobs = Object.fromEntries([...ci.matchAll(/\n {2}([a-z-]+):\n([\s\S]*?)(?=\n {2}(?:[a-z-]+:|#)|$)/g)].map((m) => [m[1] as string, m[2] as string]));
    for (const job of ["verify", "verify-windows"]) assert.ok(jobs[job]?.includes("npm run verify:plugin-artifact"), `${job} checks the plugin artifact`);
  });
});
