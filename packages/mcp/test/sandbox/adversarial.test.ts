import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadCorpus, runCase } from "../support/runner.ts";

describe("WWEP adversarial corpus", () => {
  for (const c of loadCorpus(["adversarial"])) {
    test(`${c.id} [${c.claimCategory}] ${c.description}`, () => {
      assert.deepEqual(runCase(c), []);
    });
  }
});
