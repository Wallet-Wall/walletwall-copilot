import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { LIMITS } from "../../src/schemas.ts";
import { ROOT } from "../support/harness.ts";

const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8");
const security = read("SECURITY.md");
const threat = read("THREAT_MODEL.md");
const agent = read("docs/CLAUDE_MANAGED_AGENT.md");
const source = read("scripts/claude-mcp-http.ts");

const constant = (name: string): number => {
  const m = new RegExp(`const ${name} = ([0-9* ]+);`).exec(source);
  assert.ok(m?.[1], `${name} is defined in the adapter`);
  return m[1].split("*").reduce((acc, n) => acc * Number(n.trim()), 1);
};

describe("local adapter documentation: the four boundaries are described, in plain language", () => {
  test("SECURITY.md has a section for hostile or malformed input, prompt injection, local adapters and the hostile local owner", () => {
    for (const heading of ["Hostile or malformed input", "Prompt injection", "Local adapters", "Hostile local owner"]) {
      assert.match(security, new RegExp(`^## ${heading}$`, "m"), heading);
    }
  });

  test("the hostile-local-owner section says who is trusted, what is not attempted, and that this reaches no one else's computer", () => {
    const section = /^## Hostile local owner$([\s\S]*?)^## /m.exec(security)?.[1] ?? "";
    assert.ok(section.includes("WalletWall assumes the local operating-system account and process environment are relied upon."));
    assert.ok(section.includes("Someone who already controls that account or process can inspect or alter local tool traffic and code."));
    assert.ok(section.includes("does not attempt to detect or resist a compromised machine owner"));
    assert.ok(section.includes("This does not mean WalletWall can inspect other people's computers."));
    for (const actor of ["Remote caller with no credentials", "Local program that does not hold the token", "Hostile program running as the same account", "Hostile owner of the machine or account"]) {
      assert.ok(section.includes(actor), actor);
    }
    assert.match(section, /Out of scope: it can already read what the account can read/);
    assert.match(section, /\| Hostile owner of the machine or account \| Out of scope: /);
    assert.match(section, /\| Hostile program running as the same account \| Out of scope: /);
  });

  test("the threat model keeps the four actors apart and marks the last two out of scope", () => {
    assert.match(threat, /Four actors are kept apart/);
    assert.match(threat, /a hostile program running as the same account \(out of scope\); and a hostile owner of the machine or account \(out of scope\)/);
    assert.match(threat, /\| T18 \|[^\n]*\*\*Out of scope, documented\.\*\*/);
  });

  test("no document claims protection against a hostile local owner or a same-account process", () => {
    const docs = [
      "README.md", "SECURITY.md", "THREAT_MODEL.md", "BOUNDARIES.md", "PRIVACY.md", "CONTRIBUTING.md", "canvas/README.md", "plugin/README.md",
      ...readdirSync(`${ROOT}docs`).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
    ];
    const SUBJECT = /hostile (?:local )?owner|same[- ]account|compromised (?:runtime|machine)|controls (?:that|the|this) (?:account|process|machine)/i;
    const CLAIM = /\b(?:protect|defend|prevent|detect|resist|block|mitigate|stop|safeguard|guard|shield)(?:s|ed|ing|d)?\b/i;
    const DENIAL = /\b(?:not|never|no|cannot|can't|nor|without|out of scope|unable|already|neither)\b|n't\b/i;
    const hits: string[] = [];
    for (const f of docs) {
      const lines = read(f).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (SUBJECT.test(line) && CLAIM.test(line) && !DENIAL.test(line) && !DENIAL.test(lines[i - 1] ?? "")) hits.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});

describe("local adapter documentation: what is written is what the adapter does", () => {
  const documents: [string, string][] = [["SECURITY.md", security], ["docs/CLAUDE_MANAGED_AGENT.md", agent]];

  test("the documented body, URL and token sizes are the adapter's constants", () => {
    const bodyKiB = constant("MAX_BODY_BYTES") / 1024;
    assert.equal(bodyKiB, 512);
    assert.equal(constant("MAX_URL_LENGTH"), 256);
    assert.equal(constant("TOKEN_BYTES"), 32);
    for (const [name, text] of documents) {
      assert.ok(text.includes(`${bodyKiB} KiB`), `${name} names the ${bodyKiB} KiB body limit`);
      assert.ok(text.includes("256 characters"), `${name} names the 256-character target limit`);
      assert.ok(text.includes("32 bytes (256 bits)"), `${name} names the token size`);
      assert.ok(text.includes("43 base64url characters"), `${name} names the token encoding`);
    }
    assert.ok(threat.includes("512 KiB"));
    assert.equal(Buffer.alloc(constant("TOKEN_BYTES")).toString("base64url").length, 43);
  });

  test("the documented bind addresses are exactly the ones the adapter accepts, and the wildcard modes are documented as refused", () => {
    const keys = /LOOPBACK_BINDS[^=]*= (\{[^}]*\})/.exec(source)?.[1] ?? "{}";
    assert.deepEqual(Object.keys(JSON.parse(keys) as Record<string, string>), ["127.0.0.1", "::1"]);
    for (const [name, text] of documents) {
      assert.ok(text.includes("`127.0.0.1`") && text.includes("`::1`"), name);
      assert.ok(text.includes("`0.0.0.0`") && text.includes("`::`"), `${name} names the refused wildcard addresses`);
      assert.match(text, /no external-bind mode/i, name);
    }
  });

  test("the documented enable switch, header and token lifecycle exist in the adapter", () => {
    assert.ok(source.includes('arg === "--enable"'));
    for (const [name, text] of documents) {
      assert.ok(text.includes("--enable"), `${name} names the switch`);
      assert.ok(text.includes("Authorization: Bearer <token>"), `${name} names the one accepted carrier`);
      assert.match(text, /never written to disk/, name);
      assert.match(text, /CSPRNG/, name);
    }
    assert.match(source, /Authorization|authorization/);
    assert.ok(!/process\.env/.test(source), "documented as reading no environment");
    assert.ok(security.includes("reads no environment"));
  });

  test("the documentation records the compatibility break and withdraws the Cloud Run deployment", () => {
    for (const [name, text] of documents) assert.match(text, /Compatib|Compatibility change/, name);
    assert.match(agent, /Cloud Run deployment that depended on `--host 0\.0\.0\.0` is withdrawn/);
  });

  test("the open-map limits written in SECURITY.md are the schema's limits", () => {
    const section = /^## Hostile or malformed input$([\s\S]*?)^## /m.exec(security)?.[1] ?? "";
    assert.ok(section.includes(`at most ${LIMITS.recordEntries} entries`));
    assert.ok(section.includes(`at most ${LIMITS.textLength} characters`));
    assert.ok(section.includes("up to 31 letters, digits or underscores"));
    const schemas = read("packages/mcp/src/schemas.ts");
    assert.match(schemas, /depth > 12 \|\| \+\+nodes > 20_000/);
    assert.ok(section.includes("deeper than 12 levels or more than 20,000 values"));
  });

  test("the prompt-injection section states the model (data, not instruction authority) and its limit, and does not promise to solve it", () => {
    const section = /^## Prompt injection$([\s\S]*?)^## /m.exec(security)?.[1] ?? "";
    assert.ok(section.includes("**tool output is data, not instruction authority.**"));
    assert.match(section, /does not claim to prevent prompt injection and does not attempt to detect it/);
    assert.match(section, /Limits:/);
    assert.equal(readdirSync(`${ROOT}plugin/skills`).length, 4, "the section says all four skills");
    assert.ok(section.includes("all four skills"));
    assert.ok(!/\b(?:prevents|solves|eliminates|detects) prompt injection\b/i.test(security.replace("does not claim to prevent prompt injection and does not attempt to detect it", "")));
  });
});
