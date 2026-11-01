import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord } from "../../src/wallprint/record.ts";
import { ATTRIBUTION_CASES } from "./assessor-cases.ts";
import { baseInput } from "./support.ts";

/**
 * Characterization of the attribution rules `buildWallPrintSnapshot` applies to caller-supplied external assessments,
 * pinned before the import boundary was added and kept as the contract the boundary reuses. A change in any row is a
 * change to a digest-covered admission rule.
 */
describe("external assessment attribution: the builder's contract, row by row", () => {
  for (const c of ATTRIBUTION_CASES) {
    test(c.name, () => {
      const input = baseInput({ ...(c.bundle === undefined ? {} : { bundle: c.bundle }), assessments: c.assessments as never });
      if (c.expected === "BUILT") {
        const record = buildWallPrintSnapshot(input);
        assert.equal(validateWallPrintRecord(record).ok, true);
        return;
      }
      const { error, findings } = c.expected;
      assert.throws(
        () => buildWallPrintSnapshot(input),
        (e: unknown) => {
          assert.ok(e instanceof WallPrintError);
          assert.equal(e.code, error);
          assert.deepEqual(e.findings.map((f) => ({ code: f.code, path: f.path })), findings);
          return true;
        },
      );
    });
  }
});
