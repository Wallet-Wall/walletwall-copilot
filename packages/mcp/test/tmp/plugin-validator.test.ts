import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";
import { validatePluginDir } from "../support/plugin-validator.ts";

describe("plugin validator negative controls (needs a temporary directory)", () => {
  test("the validator rejects a manifest with a legacy field, a shell command and an env block", () => {
    const run = createOwnedRun();
    const d = run.mkdir("plugin");
    try {
      writeFileSync(join(d, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "Bad_Name", mcpServers: {} }));
      writeFileSync(
        join(d, "mcp.json"),
        JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { x: { type: "stdio", command: "node server.js", env: { A: "b" } } } }),
      );
      mkdirSync(join(d, "skills", "empty"), { recursive: true });
      mkdirSync(join(d, "com.github.copilot", "hooks"), { recursive: true });
      mkdirSync(join(d, "com.github.copilot", "extensions", "bad-ext"), { recursive: true });
      writeFileSync(join(d, "com.github.copilot", "extensions", "bad-ext", "package.json"), "{}");
      writeFileSync(join(d, "com.github.copilot", "extensions", "bad-ext", "copilot-extension.json"), JSON.stringify({ name: "other", version: 1 }));
      const problems = validatePluginDir(d, ROOT).map((f) => `${f.file}: ${f.problem}`);
      assert.ok(problems.some((p) => p.includes("name violates")));
      assert.ok(problems.some((p) => p.includes("unknown top-level field mcpServers")));
      assert.ok(problems.some((p) => p.includes("command must be one bare executable token")));
      assert.ok(problems.some((p) => p.includes("env must not be set")));
      assert.ok(problems.some((p) => p.includes("no SKILL.md")));
      assert.ok(problems.some((p) => p.includes("com.github.copilot/hooks")), "a hooks directory must be rejected");
      assert.ok(problems.some((p) => p.includes("bad-ext/package.json")), "an extension payload other than the expected files must be rejected");
      assert.ok(problems.some((p) => p.includes("bad-ext/extension.mjs")), "a missing entry point must be reported");
      assert.ok(problems.some((p) => p.includes("copilot-extension.json") && p.includes("must be exactly")));
    } finally {
      run.dispose();
    }
  });
});
