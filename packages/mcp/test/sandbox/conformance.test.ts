import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { loadCorpus, runCase } from "../support/runner.ts";

const REQUIRED_CLAIM_CATEGORIES = [
  "asset-identity",
  "duplicate-evidence",
  "freshness",
  "conflict",
  "missing-evidence",
  "no-result-vs-zero",
  "unknown-vs-false",
  "authority-escalation",
  "derived-limitations",
  "malformed-numeric",
  "decimal-precision",
  "supersession",
  "quantity-vs-usd",
];

const cases = loadCorpus(["evidence", "authority", "freshness", "conflict"]);
const tally = new Map<string, { passed: number; total: number }>();

describe("WWEP conformance corpus", () => {
  after(() => {
    const rows = [...tally.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    console.log("\nConformance by claim category (no single accuracy score is reported):");
    for (const [cat, t] of rows) console.log(`  ${cat.padEnd(22)} ${t.passed}/${t.total}`);
  });

  test("corpus covers every required claim category", () => {
    const have = new Set(loadCorpus().map((c) => c.claimCategory));
    for (const required of REQUIRED_CLAIM_CATEGORIES) assert.ok(have.has(required), `missing claim category ${required}`);
  });

  test("case IDs are unique", () => {
    const ids = loadCorpus().map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const c of cases) {
    test(`${c.id} [${c.claimCategory}] ${c.description}`, () => {
      const failures = runCase(c);
      const t = tally.get(c.claimCategory) ?? { passed: 0, total: 0 };
      t.total++;
      if (failures.length === 0) t.passed++;
      tally.set(c.claimCategory, t);
      assert.deepEqual(failures, []);
    });
  }
});
