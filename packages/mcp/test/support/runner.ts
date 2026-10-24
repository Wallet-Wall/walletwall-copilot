import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateBundle } from "../../src/evaluate.ts";
import { checkInvariants } from "../../src/invariants.ts";
import { parseBundleStrict } from "../../src/schemas.ts";
import type { ConformanceCase } from "./cases.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const CATEGORIES = ["evidence", "authority", "freshness", "conflict", "adversarial"] as const;

export function loadCorpus(categories: readonly string[] = CATEGORIES): ConformanceCase[] {
  const out: ConformanceCase[] = [];
  for (const cat of categories) {
    const dir = `${root}conformance/${cat}`;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      out.push(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ConformanceCase);
    }
  }
  return out;
}

/** Returns a list of failure strings. An empty list means the case passed. */
export function runCase(c: ConformanceCase): string[] {
  const failures: string[] = [];
  const parsed = parseBundleStrict(c.bundle);
  if (c.expect.schemaRejected === true) {
    if (parsed.success) failures.push("bundle was accepted but schema rejection was expected");
    return failures;
  }
  if (!parsed.success) return ["bundle was unexpectedly rejected by the schema"];
  const evaluation = evaluateBundle(parsed.data, c.evaluatedAt);
  const violations = checkInvariants(parsed.data, evaluation);

  for (const [id, exp] of Object.entries(c.expect.assertions ?? {})) {
    const got = evaluation.assertions.find((a) => a.assertionId === id);
    if (got === undefined) {
      failures.push(`assertion ${id} missing from evaluation`);
      continue;
    }
    const check = (name: string, actual: unknown, wanted: unknown): void => {
      if (wanted !== undefined && JSON.stringify(actual) !== JSON.stringify(wanted)) {
        failures.push(`${id}.${name}: expected ${JSON.stringify(wanted)} got ${JSON.stringify(actual)}`);
      }
    };
    check("supportState", got.supportState, exp.supportState);
    check("freshnessState", got.freshnessState, exp.freshnessState);
    check("finalityState", got.finalityState, exp.finalityState);
    check("independentCorroboration", got.independentCorroboration, exp.independentCorroboration);
    check("conflictsWith", got.conflictsWith, exp.conflictsWith);
    check("supersededBy", got.supersededBy, exp.supersededBy);
    check("authoritySatisfied", got.authority?.satisfied, exp.authoritySatisfied);
    for (const l of exp.limitationsInclude ?? []) {
      if (!got.limitations.includes(l)) failures.push(`${id}.limitations missing ${l} (have ${got.limitations.join(",")})`);
    }
    for (const l of exp.limitationsExclude ?? []) {
      if (got.limitations.includes(l)) failures.push(`${id}.limitations unexpectedly has ${l}`);
    }
  }
  if (c.expect.violations?.none === true && violations.length > 0) {
    failures.push(`expected no violations, got ${violations.map((v) => `${v.invariant}:${v.code}`).join(",")}`);
  }
  for (const want of c.expect.violations?.include ?? []) {
    if (!violations.some((v) => v.invariant === want.invariant && v.code === want.code)) {
      failures.push(`missing violation ${want.invariant}:${want.code} (have ${violations.map((v) => `${v.invariant}:${v.code}`).join(",")})`);
    }
  }
  return failures;
}
