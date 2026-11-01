import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WallPrintError } from "../../src/wallprint/errors.ts";
import { buildWallPrintSnapshot, validateWallPrintRecord } from "../../src/wallprint/record.ts";
import { ATTRIBUTION_CASES, ATTRIBUTION_VERSIONS, expectedUnder } from "./assessor-cases.ts";
import { baseInput } from "./support.ts";

/**
 * Characterization of the attribution rules `buildWallPrintSnapshot` applies to caller-supplied external assessments,
 * held to every WallPrint contract version the engine reads. A row either has the same outcome in both versions or lists
 * its 0.2 outcome explicitly (`v02`): that is the whole difference between the versions' admission rules for these inputs.
 * A change in any row is a change to a digest-covered admission rule, which is a WallPrint version change.
 */
describe("external assessment attribution: the builder's contract, row by row, per WallPrint version", () => {
  for (const version of ATTRIBUTION_VERSIONS) {
    for (const c of ATTRIBUTION_CASES) {
      test(`${c.name} [WallPrint ${version}]`, () => {
        const input = baseInput({ ...(c.bundle === undefined ? {} : { bundle: c.bundle }), assessments: c.assessments as never, wallprintVersion: version });
        const expected = expectedUnder(c, version);
        if (expected === "BUILT") {
          const record = buildWallPrintSnapshot(input);
          assert.equal(record.wallprintVersion, version);
          assert.equal(validateWallPrintRecord(record).ok, true);
          return;
        }
        const { error, findings } = expected;
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
  }
});
