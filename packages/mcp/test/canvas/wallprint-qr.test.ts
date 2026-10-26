import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { encodeReference, referenceOf, REFERENCE_TARGETS } from "../../src/wallprint/reference.ts";
import { ROOT } from "../support/harness.ts";
import { decodeQrMatrix } from "../support/qr-decoder.ts";
import type { DisclosureFixture } from "../support/wallprint-disclosures.ts";

/**
 * The QR encoder is a local, deterministic, dependency-free ISO/IEC 18004 byte-mode encoder at level M. Every claim
 * below is checked by an independent reader (test/support/qr-decoder.ts) that re-derives the function patterns, checks
 * the format and version BCH codes, verifies the Reed-Solomon syndromes with its own field arithmetic and parses the
 * segment back: record -> reference -> QR matrix -> decode -> the identical reference text.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface QrCode {
  version: number;
  size: number;
  mask: number;
  penalty: number;
  modules: Uint8Array;
  ecLevel: string;
  byteLength: number;
}
interface QrModule {
  QR_EC_LEVEL: string;
  QR_MAX_VERSION: number;
  QR_QUIET_ZONE: number;
  EC_BLOCKS_M: [number, number][];
  ALIGNMENT_CENTRES: number[][];
  encodeQr: (text: string, options?: { mask?: number }) => QrCode;
  qrPathData: (code: QrCode, quiet?: number) => { extent: number; d: string };
  generatorPolynomial: (n: number) => number[];
  errorCorrection: (data: number[], n: number) => number[];
  totalCodewords: (v: number) => number;
  dataCodewords: (v: number) => number;
  smallestVersion: (len: number) => number | null;
  formatBits: (mask: number) => number;
  versionBits: (v: number) => number;
  functionPatterns: (v: number) => { size: number; reserved: Uint8Array; dark: Uint8Array };
  penalty: (dark: Uint8Array, size: number) => number;
  MASKS: ((r: number, c: number) => boolean)[];
}
const qr = (await import(pathToFileURL(`${EXT}/wallprint-qr.mjs`).href)) as QrModule;
const { WALLPRINT_FIXTURES } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture> };

const logOf = (coeffs: number[]): number[] => {
  const LOG: number[] = [];
  let x = 1;
  for (let i = 0; i < 255; i++) {
    LOG[x] = i;
    x *= 2;
    if (x >= 256) x ^= 0x11d;
  }
  return coeffs.map((c) => LOG[c]!);
};

describe("the arithmetic: GF(256), generator polynomials and codeword counts match the standard's published values", () => {
  test("the generator polynomials for 7 and 10 error-correction codewords are the standard's (as exponents of α)", () => {
    assert.deepEqual(logOf(qr.generatorPolynomial(7)), [0, 87, 229, 146, 149, 238, 102, 21]);
    assert.deepEqual(logOf(qr.generatorPolynomial(10)), [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
    assert.deepEqual(logOf(qr.generatorPolynomial(2)), [0, 25, 1]);
  });

  test("total codewords per version are the standard's table 7 values for versions 1 to 15, and level-M data capacity follows table 9", () => {
    const totals = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];
    const dataM = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415];
    for (let v = 1; v <= 15; v++) {
      assert.equal(qr.totalCodewords(v), totals[v - 1], `version ${v} total`);
      assert.equal(qr.dataCodewords(v), dataM[v - 1], `version ${v} data (M)`);
      const [ec, blocks] = qr.EC_BLOCKS_M[v - 1]!;
      assert.equal(totals[v - 1]! - dataM[v - 1]!, ec * blocks, `version ${v} ec total`);
    }
    assert.equal(qr.QR_MAX_VERSION, 15);
    assert.equal(qr.QR_EC_LEVEL, "M");
    assert.equal(qr.QR_QUIET_ZONE, 4);
  });

  test("byte-mode capacity at level M: 14 bytes in version 1, 106 in version 6, 180 in version 9, 213 in version 10; a 416-byte text does not fit", () => {
    assert.equal(qr.smallestVersion(14), 1);
    assert.equal(qr.smallestVersion(15), 2);
    assert.equal(qr.smallestVersion(106), 6);
    assert.equal(qr.smallestVersion(107), 7);
    assert.equal(qr.smallestVersion(180), 9);
    assert.equal(qr.smallestVersion(181), 10);
    assert.equal(qr.smallestVersion(213), 10);
    assert.equal(qr.smallestVersion(412), 15);
    assert.equal(qr.smallestVersion(413), null);
    assert.throws(() => qr.encodeQr("x".repeat(413)), RangeError);
    assert.throws(() => qr.encodeQr(""), RangeError);
  });

  test("format and version information are valid BCH codes: the standard's published values for mask 0 level M and version 7", () => {
    assert.equal(qr.formatBits(0), 0b101010000010010);
    assert.equal(qr.formatBits(5), 0b100000011001110);
    assert.equal(qr.versionBits(7), 0b000111110010010100);
    assert.equal(qr.versionBits(8), 0b001000010110111100);
  });

  test("the error-correction codewords of a known block are the standard's worked example", () => {
    // ISO/IEC 18004 annex I: "01234567" numeric, version 1-M, data codewords then 10 EC codewords.
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    assert.deepEqual(qr.errorCorrection(data, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });
});

describe("the matrix: function patterns in place, format readable, no reserved module overwritten, deterministic", () => {
  test("every version 1 to 15 lays out finders, timing, alignment, the dark module and reserved areas where the standard puts them", () => {
    for (let v = 1; v <= 15; v++) {
      const { size, reserved, dark } = qr.functionPatterns(v);
      assert.equal(size, v * 4 + 17);
      const at = (r: number, c: number): number => dark[r * size + c]!;
      // Finder outer ring dark, separator light, centre dark.
      for (const [r0, c0] of [
        [0, 0],
        [0, size - 7],
        [size - 7, 0],
      ]) {
        assert.equal(at(r0!, c0!), 1);
        assert.equal(at(r0! + 3, c0! + 3), 1);
        assert.equal(at(r0! + 1, c0! + 1), 0);
      }
      assert.equal(at(7, 7), 0, "separator");
      for (let i = 8; i < size - 8; i++) {
        assert.equal(at(6, i), i % 2 === 0 ? 1 : 0, `timing row ${i}`);
        assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0, `timing col ${i}`);
      }
      assert.equal(at(size - 8, 8), 1, "dark module");
      for (const r of qr.ALIGNMENT_CENTRES[v - 1]!) {
        for (const c of qr.ALIGNMENT_CENTRES[v - 1]!) {
          const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
          if (nearFinder) continue;
          assert.equal(at(r, c), 1, `alignment centre ${v}:${r},${c}`);
          assert.equal(at(r - 1, c), 0);
          assert.equal(at(r - 2, c - 2), 1);
          assert.ok(reserved[(r - 2) * size + (c - 2)]);
        }
      }
      let free = 0;
      for (let i = 0; i < size * size; i++) if (!reserved[i]) free++;
      assert.ok(free % 8 <= 7 && Math.floor(free / 8) === qr.totalCodewords(v));
      if (v >= 7) assert.ok(reserved[0 * size + (size - 11)] && reserved[(size - 11) * size + 0], "version areas reserved");
    }
  });

  test("the same text always gives the same matrix; different texts give different matrices; the chosen mask has the lowest penalty", () => {
    const text = "walletwall://wallprint/wp-test?reference=0.1&wallprint=0.1&digest=" + "a".repeat(64);
    const a = qr.encodeQr(text);
    const b = qr.encodeQr(text);
    assert.deepEqual(Array.from(a.modules), Array.from(b.modules));
    assert.equal(a.version, b.version);
    assert.equal(a.mask, b.mask);
    const c = qr.encodeQr("walletwall://wallprint/wp-test?reference=0.1&wallprint=0.1&digest=" + "b".repeat(64));
    assert.notDeepEqual(Array.from(a.modules), Array.from(c.modules));
    assert.ok(a.mask >= 0 && a.mask <= 7);
    // Every other mask scores at least the chosen penalty; an equal score only on a higher mask number (ties go low).
    assert.equal(a.penalty, qr.penalty(a.modules, a.size));
    for (let m = 0; m < 8; m++) {
      const forced = qr.encodeQr(text, { mask: m });
      assert.equal(forced.mask, m);
      assert.ok(forced.penalty >= a.penalty, `mask ${m} scores ${forced.penalty} < ${a.penalty}`);
      if (forced.penalty === a.penalty) assert.ok(m >= a.mask);
      const decoded = decodeQrMatrix(forced.modules, forced.size);
      assert.equal(decoded.text, text, `mask ${m} decodes`);
      assert.equal(decoded.mask, m);
    }
  });
});

describe("round trip through the independent reader: record -> reference -> QR -> decode -> identical reference", () => {
  const records = Object.values(WALLPRINT_FIXTURES).flatMap((f) => f.records);

  test("every bundled record's reference, with and without each section target, decodes to the exact text with zero syndromes and consistent format copies", () => {
    assert.ok(records.length >= 14);
    for (const entry of records) {
      for (const target of [null, ...REFERENCE_TARGETS]) {
        const text = encodeReference(referenceOf(entry.record, target));
        const code = qr.encodeQr(text);
        const decoded = decodeQrMatrix(code.modules, code.size);
        assert.equal(decoded.text, text, `${entry.id} ${target}`);
        assert.equal(decoded.version, code.version);
        assert.equal(decoded.mask, code.mask);
        assert.equal(decoded.ecLevel, "M");
        assert.ok(decoded.formatCopiesAgree && decoded.syndromesZero && decoded.paddingValid, `${entry.id} ${target}: format ${decoded.formatCopiesAgree} syndromes ${decoded.syndromesZero} padding ${decoded.paddingValid}`);
        if (code.version >= 7) assert.equal(decoded.versionInfoValid, true);
        assert.ok(code.version >= 7 && code.version <= 10, `${entry.id}: a reference fits versions 7 to 10 (${code.version})`);
      }
    }
  });

  test("texts at every version boundary from 1 to 15 round-trip, including the version-information area from version 7", () => {
    for (let v = 1; v <= 15; v++) {
      const len = qr.dataCodewords(v) - (v <= 9 ? 2 : 3); // the capacity minus the 4-bit mode and the count field, rounded up to a byte
      const text = "w".repeat(len);
      const code = qr.encodeQr(text);
      assert.equal(code.version, v, `length ${len} fills version ${v}`);
      const decoded = decodeQrMatrix(code.modules, code.size);
      assert.equal(decoded.text, text);
      assert.ok(decoded.syndromesZero && decoded.formatCopiesAgree && decoded.paddingValid);
      assert.equal(decoded.versionInfoValid, v >= 7 ? true : null);
      assert.equal(decoded.totalCodewords, qr.totalCodewords(v));
      assert.equal(decoded.blocks, qr.EC_BLOCKS_M[v - 1]![1]);
    }
  });

  test("a non-ASCII text is encoded as UTF-8 bytes and decodes back exactly (the reference itself is ASCII only)", () => {
    const text = "wällprint ✓ 記録";
    const decoded = decodeQrMatrix(qr.encodeQr(text).modules, qr.encodeQr(text).size);
    assert.equal(decoded.text, text);
    assert.equal(qr.encodeQr(text).byteLength, new TextEncoder().encode(text).length);
  });

  test("flipping one data module breaks a syndrome (the reader detects it); the encoder never produces such a matrix", () => {
    const text = encodeReference(referenceOf(records[0]!.record));
    const code = qr.encodeQr(text);
    const { reserved } = qr.functionPatterns(code.version);
    const damaged = Uint8Array.from(code.modules);
    const idx = damaged.findIndex((_, i) => !reserved[i]);
    damaged[idx] = damaged[idx]! ^ 1;
    const decoded = decodeQrMatrix(damaged, code.size);
    assert.equal(decoded.syndromesZero, false);
  });
});

describe("the path: one subpath per run of dark modules inside a quiet zone of four modules", () => {
  test("the extent is the module count plus two quiet zones, every subpath lies inside the data square, and the dark count matches the matrix", () => {
    const code = qr.encodeQr(encodeReference(referenceOf(Object.values(WALLPRINT_FIXTURES)[0]!.records[0]!.record, "receipt")));
    const { extent, d } = qr.qrPathData(code);
    assert.equal(extent, code.size + 8);
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
    assert.equal(runs.map((m) => m[0]).join(""), d, "the path data is only run subpaths");
    let dark = 0;
    for (const m of runs) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      const w = Number(m[3]);
      assert.equal(Number(m[4]), w);
      assert.ok(x >= 4 && y >= 4 && x + w <= extent - 4 && y < extent - 4, "inside the quiet zone");
      dark += w;
    }
    assert.equal(dark, Array.from(code.modules).reduce((n, m) => n + m, 0));
    assert.ok(!/[^Mhvz0-9 -]/.test(d), "digits, M, h, v, z, space and minus only: nothing to escape");
    assert.equal(qr.qrPathData(code, 0).extent, code.size);
  });
});
