import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES } from "../packages/mcp/test/support/cases.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const expected = new Map<string, string>();
for (const c of CASES) {
  expected.set(`conformance/${c.category}/${c.id}.json`, `${JSON.stringify(c, null, 2)}\n`);
}

let bad = 0;
for (const [rel, text] of expected) {
  const path = `${root}${rel}`;
  if (check) {
    let cur: string;
    try {
      cur = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    } catch {
      cur = "";
    }
    if (cur !== text) {
      console.error(`out of date: ${rel}`);
      bad++;
    }
  } else {
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, text);
  }
}
for (const dir of ["evidence", "authority", "freshness", "conflict", "adversarial"]) {
  for (const f of readdirSync(`${root}conformance/${dir}`)) {
    if (f.endsWith(".json") && !expected.has(`conformance/${dir}/${f}`)) {
      console.error(`unexpected corpus file: conformance/${dir}/${f}`);
      bad++;
    }
  }
}
if (check) {
  if (bad > 0) {
    console.error("Conformance corpus is out of date. Run: node scripts/gen-conformance.ts");
    process.exit(1);
  }
  console.log(`conformance corpus up to date (${CASES.length} cases)`);
} else {
  console.log(`wrote ${CASES.length} conformance cases`);
}
