import { CATEGORIES, loadCorpus, runCase } from "../packages/mcp/test/support/runner.ts";

const cases = loadCorpus();
const byClaim = new Map<string, { passed: number; total: number }>();
const byDir = new Map<string, { passed: number; total: number }>();
const failed: string[] = [];
for (const c of cases) {
  const failures = runCase(c);
  for (const [map, key] of [
    [byClaim, c.claimCategory],
    [byDir, c.category],
  ] as const) {
    const t = map.get(key) ?? { passed: 0, total: 0 };
    t.total++;
    if (failures.length === 0) t.passed++;
    map.set(key, t);
  }
  if (failures.length > 0) failed.push(`${c.id}: ${failures.join("; ")}`);
}

const print = (title: string, m: Map<string, { passed: number; total: number }>): void => {
  console.log(`\n${title}`);
  for (const [k, t] of [...m.entries()].sort()) console.log(`  ${k.padEnd(22)} ${t.passed}/${t.total}`);
};
console.log("WWEP 0.1 conformance, reported by claim category. No single accuracy score is computed or implied.");
print("By claim category", byClaim);
print("By corpus directory", byDir);
const total = cases.length;
console.log(`\nTotal: ${total - failed.length}/${total} (${CATEGORIES.length} corpus directories)`);
if (failed.length > 0) {
  for (const f of failed) console.error(`FAIL ${f}`);
  process.exit(1);
}
