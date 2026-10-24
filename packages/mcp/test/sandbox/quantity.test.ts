import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WwError } from "../../src/errors.ts";
import {
  UINT256_MAX,
  formatAtomic,
  parseAtomic,
  parseDecimals,
  parsePriceScaled18,
  usdValueScaled18,
} from "../../src/quantity.ts";

const invalid = (e: unknown): boolean => e instanceof WwError && e.code === "INVALID_QUANTITY";

describe("exact quantities", () => {
  test("parseAtomic accepts canonical strings up to uint256 max", () => {
    assert.equal(parseAtomic("0"), 0n);
    assert.equal(parseAtomic("1500000"), 1_500_000n);
    assert.equal(parseAtomic(UINT256_MAX.toString()), UINT256_MAX);
  });

  test("parseAtomic rejects every non-canonical form", () => {
    for (const bad of ["", "00", "01", "-1", "+1", "1.0", "1e6", "0x10", " 1", "1 ", "١٢٣", String(UINT256_MAX + 1n), "9".repeat(79)]) {
      assert.throws(() => parseAtomic(bad), invalid, bad);
    }
  });

  test("parseDecimals accepts 0..36 and rejects the rest", () => {
    assert.equal(parseDecimals("0"), 0);
    assert.equal(parseDecimals("18"), 18);
    assert.equal(parseDecimals("36"), 36);
    for (const bad of ["37", "-1", "06", "6.0", "", "100"]) assert.throws(() => parseDecimals(bad), invalid, bad);
  });

  test("formatAtomic renders exact decimals with BigInt and never rounds", () => {
    assert.equal(formatAtomic(1_500_000n, 6), "1.5");
    assert.equal(formatAtomic(1n, 6), "0.000001");
    assert.equal(formatAtomic(0n, 18), "0");
    assert.equal(formatAtomic(10n ** 18n, 18), "1");
    assert.equal(formatAtomic(1_000_000_000_000_000_001n, 18), "1.000000000000000001");
    assert.equal(formatAtomic(123n, 0), "123");
    assert.equal(formatAtomic(UINT256_MAX, 18), "115792089237316195423570985008687907853269984665640564039457.584007913129639935");
  });

  test("a value above 2^53 keeps every digit (JavaScript Number would not)", () => {
    const big = 9_007_199_254_740_993n;
    assert.notEqual(BigInt(Number(big)), big);
    assert.equal(formatAtomic(big, 0), "9007199254740993");
    assert.equal(parseAtomic("9007199254740993"), big);
  });

  test("format round-trips for a spread of values", () => {
    for (const d of [0, 1, 6, 8, 18, 36]) {
      for (const v of [0n, 1n, 9n, 10n ** BigInt(d), 10n ** BigInt(d) + 1n, UINT256_MAX]) {
        const s = formatAtomic(v, d);
        const [w = "0", f = ""] = s.split(".");
        assert.equal(BigInt(w + f.padEnd(d, "0")), v);
      }
    }
  });

  test("price parsing and USD valuation floor at 18 decimals", () => {
    assert.equal(parsePriceScaled18("1"), 10n ** 18n);
    assert.equal(parsePriceScaled18("0.999999999999999999"), 10n ** 18n - 1n);
    assert.equal(usdValueScaled18(1_500_000n, 6, parsePriceScaled18("1.0001")), 1_500_150_000_000_000_000n);
    assert.equal(usdValueScaled18(10n ** 18n + 1n, 18, 10n ** 18n - 1n), 10n ** 18n - 1n);
    for (const bad of ["", "1.", ".5", "1.1234567890123456789", "-1", "1e3", "01"]) assert.throws(() => parsePriceScaled18(bad), invalid, bad);
  });
});
