import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { GUARD, type GuardReport } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";

const violator = fileURLToPath(new URL("../support/violator.ts", import.meta.url));

describe("privacy guard positive control", () => {
  test("PRIV-000 the guard detects and blocks network, filesystem, process and fingerprint attempts", () => {
    const run = createOwnedRun();
    const cwd = run.mkdir("cwd");
    try {
      const r = spawnSync(process.execPath, ["--import", GUARD, violator], { cwd, encoding: "utf8", timeout: 30_000 });
      const results = JSON.parse(r.stdout.trim()) as Record<string, string>;
      const observedOnly = new Set(["randomUUID", "hostname"]);
      for (const [name, outcome] of Object.entries(results)) {
        assert.equal(outcome, observedOnly.has(name) ? "ALLOWED" : "BLOCKED", `${name} was ${outcome}`);
      }
      assert.equal(Object.keys(results).length, 11);

      const m = /WW_GUARD_REPORT (\{.*\})/.exec(r.stderr);
      assert.ok(m?.[1], "guard report missing");
      const report = JSON.parse(m[1]) as GuardReport;
      assert.ok(report.network.length >= 4, JSON.stringify(report.network));
      assert.ok(report.dns.length >= 1);
      assert.ok(report.fsWrite.length >= 3);
      assert.ok(report.spawn.length >= 1);
      assert.ok(report.random.length >= 1);
      assert.ok(report.fingerprint.length >= 1);

      assert.deepEqual(readdirSync(cwd), [], "the control must not have created any file");
      assert.ok(!existsSync(join(cwd, "ww-control-should-not-exist.txt")));
    } finally {
      run.dispose();
    }
  });

  test("PRIV-000 the guard permits stdout and stderr, which carry the MCP channel", () => {
    const r = spawnSync(process.execPath, ["--import", GUARD, "-e", "process.stdout.write('ok'); process.stderr.write('e')"], { encoding: "utf8" });
    assert.equal(r.stdout, "ok");
    assert.ok(r.stderr.startsWith("e"));
  });
});
