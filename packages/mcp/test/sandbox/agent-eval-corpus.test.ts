import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { TOOLS } from "../../src/tools.ts";
import { ROOT } from "../support/harness.ts";

interface Case {
  id: string;
  risk: string;
  prompt: string;
  bundle?: { case?: string; fixture?: string };
  expect: { toolsAnyOf: string[]; mustMention: string[][]; mustNotMatch: string[] };
}
const corpus = JSON.parse(readFileSync(`${ROOT}evals/cases.json`, "utf8")) as { cases: Case[] };
const fixtures = readFileSync(`${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer/fixtures.mjs`, "utf8");

describe("agent-eval corpus (reported separately from MCP conformance; Copilot prose is not deterministic)", () => {
  test("case IDs are unique, every case is well formed and every regex compiles", () => {
    const ids = corpus.cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of corpus.cases) {
      assert.match(c.id, /^AE-\d{2}$/);
      assert.ok(c.risk.length > 0 && c.prompt.length > 20, c.id);
      for (const t of c.expect.toolsAnyOf) assert.ok(TOOLS.some((x) => x.name === t), `${c.id}: unknown tool ${t}`);
      for (const p of [...c.expect.mustNotMatch, ...c.expect.mustMention.flat()]) assert.doesNotThrow(() => new RegExp(p, "im"), `${c.id}: ${p}`);
      assert.ok(c.expect.mustMention.length > 0 && c.expect.mustMention.every((g) => g.length > 0), c.id);
      assert.ok(c.expect.mustNotMatch.length > 0, `${c.id} must forbid at least one overclaim`);
      if (c.prompt.includes("{{bundle}}")) assert.ok(c.bundle !== undefined, `${c.id} uses {{bundle}} without a bundle reference`);
      if (c.bundle?.case !== undefined) assert.ok(["evidence", "authority", "freshness", "conflict", "adversarial"].some((d) => existsSync(`${ROOT}conformance/${d}/${c.bundle?.case}.json`)), `${c.id}: no conformance case ${c.bundle.case}`);
      if (c.bundle?.fixture !== undefined) assert.ok(fixtures.includes(`"${c.bundle.fixture}"`), `${c.id}: no fixture ${c.bundle.fixture}`);
    }
  });

  test("the corpus covers every leap the lane named", () => {
    const risks = new Set(corpus.cases.map((c) => c.risk));
    for (const r of ["authority-leap", "readiness-to-safety", "no-result-to-zero", "natural-person-attribution", "provider-to-authority", "stale-to-current", "unknown-to-false", "readiness-to-investment", "conflict-resolution-by-ranking", "transport-to-authority", "symbol-as-identity", "quantity-to-usd", "prompt-injection-via-data"]) assert.ok(risks.has(r), r);
    assert.ok(corpus.cases.some((c) => c.expect.toolsAnyOf.includes("resolve_asset")) && corpus.cases.some((c) => c.expect.toolsAnyOf.includes("inspect_evidence")), "tool selection is exercised");
  });

  test("every recorded run carries a manual verdict for every case and lists its findings honestly", () => {
    const files = readdirSync(`${ROOT}evals/results`).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 1);
    for (const f of files) {
      const run = JSON.parse(readFileSync(`${ROOT}evals/results/${f}`, "utf8")) as { copilotCli: string; results: { id: string; run: { tools: unknown[]; finalText: string }; grade: { automated: string }; manualVerdict: { verdict: string; note: string } | null }[] };
      assert.match(run.copilotCli, /Copilot CLI/);
      for (const r of run.results) {
        assert.ok(r.manualVerdict !== null && ["PASS", "PASS_WITH_FINDING", "FAIL"].includes(r.manualVerdict.verdict) && r.manualVerdict.note.length > 10, `${f}/${r.id} lacks a manual verdict`);
        assert.ok(r.run.finalText.length > 0, `${f}/${r.id} has no recorded answer`);
        assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(JSON.stringify(r)), `${f}/${r.id} contains something that looks like a credential`);
      }
    }
  });
});
