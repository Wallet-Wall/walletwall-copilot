/**
 * An independent QR Code matrix reader for tests: ISO/IEC 18004 model 2, read back from a module matrix (no image
 * processing). It re-derives the function patterns, checks the format information's BCH code on both copies, checks the
 * version information where present, unmasks, reads the codewords in placement order, de-interleaves the level-M block
 * structure, checks every block's Reed-Solomon syndromes with its own GF(256) arithmetic, and parses the byte-mode
 * segment including the terminator and padding. It shares no code with the encoder under test.
 */

const EXP: number[] = [];
const LOG: number[] = [];
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x * 2;
    if (x >= 256) x ^= 0x11d;
  }
}
const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!);
const gfPow = (a: number, e: number): number => (a === 0 ? 0 : EXP[(LOG[a]! * e) % 255]!);

export interface DecodedQr {
  version: number;
  size: number;
  ecLevel: "L" | "M" | "Q" | "H";
  mask: number;
  formatCopiesAgree: boolean;
  versionInfoValid: boolean | null;
  totalCodewords: number;
  blocks: number;
  ecPerBlock: number;
  syndromesZero: boolean;
  paddingValid: boolean;
  bytes: Uint8Array;
  text: string;
}

/** Level-M block structure for versions 1 to 15: [ec codewords per block, blocks] (ISO/IEC 18004 table 9). */
const LEVEL_M: Record<number, [number, number]> = { 1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5], 11: [30, 5], 12: [22, 8], 13: [22, 9], 14: [24, 9], 15: [24, 10] };
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 52], 11: [6, 30, 56], 12: [6, 32, 60], 13: [6, 34, 64], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70] };

/** Which modules carry no data: finders and separators, timing, alignment, the dark module, format and version areas. */
function functionMask(version: number, size: number): Uint8Array {
  const f = new Uint8Array(size * size);
  const mark = (r: number, c: number): void => {
    if (r >= 0 && c >= 0 && r < size && c < size) f[r * size + c] = 1;
  };
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 8],
    [size - 8, 0],
  ] as const) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) mark(r0 + r, c0 + c);
  }
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (const r of ALIGN[version]!) {
    for (const c of ALIGN[version]!) {
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  }
  for (let i = 0; i <= 8; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = size - 8; i < size; i++) {
    mark(8, i);
    mark(i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = size - 11; j < size - 8; j++) {
        mark(i, j);
        mark(j, i);
      }
    }
  }
  return f;
}

/** All 32 valid format codes, keyed by their (level bits << 3 | mask) data, computed by polynomial division. */
function validFormatCodes(): Map<number, number> {
  const out = new Map<number, number>();
  for (let data = 0; data < 32; data++) {
    let value = data << 10;
    for (let i = 14; i >= 10; i--) if ((value >>> i) & 1) value ^= 0x537 << (i - 10);
    out.set(((data << 10) | value) ^ 0x5412, data);
  }
  return out;
}

function validVersionCode(version: number): number {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) if ((value >>> i) & 1) value ^= 0x1f25 << (i - 12);
  return (version << 12) | value;
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function decodeQrMatrix(modules: ArrayLike<number>, size: number): DecodedQr {
  if (size * size !== modules.length) throw new Error("matrix size mismatch");
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 15) throw new Error(`unsupported size ${size}`);
  const at = (r: number, c: number): number => (modules[r * size + c] ? 1 : 0);

  // Format information: 15 bits, two copies.
  const copy1 = [];
  for (let i = 0; i <= 5; i++) copy1[i] = at(i, 8);
  copy1[6] = at(7, 8);
  copy1[7] = at(8, 8);
  copy1[8] = at(8, 7);
  for (let i = 9; i <= 14; i++) copy1[i] = at(8, 14 - i);
  const copy2 = [];
  for (let i = 0; i <= 7; i++) copy2[i] = at(8, size - 1 - i);
  for (let i = 8; i <= 14; i++) copy2[i] = at(size - 15 + i, 8);
  const toInt = (bits: number[]): number => bits.reduce((acc, b, i) => acc | (b << i), 0);
  const codes = validFormatCodes();
  const data1 = codes.get(toInt(copy1));
  const data2 = codes.get(toInt(copy2));
  if (data1 === undefined) throw new Error("format information copy 1 is not a valid BCH code");
  if (data2 === undefined) throw new Error("format information copy 2 is not a valid BCH code");
  const formatCopiesAgree = data1 === data2;
  const levelBits = data1 >>> 3;
  const ecLevel = (["M", "L", "H", "Q"] as const)[levelBits]!;
  const mask = data1 & 7;
  if (at(size - 8, 8) !== 1) throw new Error("the dark module is not dark");

  let versionInfoValid: boolean | null = null;
  if (version >= 7) {
    const expected = validVersionCode(version);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 18; i++) {
      const col = size - 11 + (i % 3);
      const row = Math.floor(i / 3);
      a |= at(row, col) << i;
      b |= at(col, row) << i;
    }
    versionInfoValid = a === expected && b === expected;
  }

  // Unmask and read the data modules in placement order.
  const fn = functionMask(version, size);
  const bits: number[] = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (fn[row * size + cc]) continue;
        bits.push(at(row, cc) ^ (MASKS[mask]!(row, cc) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const totalCodewords = Math.floor(bits.length / 8);
  const codewords: number[] = [];
  for (let i = 0; i < totalCodewords; i++) codewords.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(""), 2));

  if (ecLevel !== "M") throw new Error(`decoder supports level M only; read ${ecLevel}`);
  const [ecPerBlock, blocks] = LEVEL_M[version]!;
  const dataTotal = totalCodewords - ecPerBlock * blocks;
  const short = Math.floor(dataTotal / blocks);
  const longer = dataTotal % blocks;
  const lengths = Array.from({ length: blocks }, (_, b) => short + (b >= blocks - longer ? 1 : 0));
  const dataBlocks: number[][] = lengths.map(() => []);
  let p = 0;
  for (let i = 0; i <= short; i++) for (let b = 0; b < blocks; b++) if (i < lengths[b]!) dataBlocks[b]!.push(codewords[p++]!);
  const ecBlocks: number[][] = lengths.map(() => []);
  for (let i = 0; i < ecPerBlock; i++) for (let b = 0; b < blocks; b++) ecBlocks[b]!.push(codewords[p++]!);

  // Syndromes: every block's data+ec polynomial must vanish at α^0 … α^(ec-1).
  let syndromesZero = true;
  for (let b = 0; b < blocks; b++) {
    const poly = [...dataBlocks[b]!, ...ecBlocks[b]!];
    for (let i = 0; i < ecPerBlock; i++) {
      const x = gfPow(2, i);
      let acc = 0;
      for (const coeff of poly) acc = gfMul(acc, x) ^ coeff;
      if (acc !== 0) syndromesZero = false;
    }
  }

  // Byte-mode segment: 0100, count (8 or 16 bits), bytes, terminator, byte alignment, EC 11 padding.
  const data = dataBlocks.flat();
  const dataBits: number[] = [];
  for (const cw of data) for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);
  const read = (pos: number, width: number): number => parseInt(dataBits.slice(pos, pos + width).join(""), 2);
  let pos = 0;
  if (read(pos, 4) !== 0b0100) throw new Error("not a byte-mode segment");
  pos += 4;
  const countWidth = version <= 9 ? 8 : 16;
  const count = read(pos, countWidth);
  pos += countWidth;
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    bytes[i] = read(pos, 8);
    pos += 8;
  }
  const remaining = dataBits.length - pos;
  const terminator = Math.min(4, remaining);
  let paddingValid = read(pos, terminator) === 0;
  pos += terminator;
  while (pos % 8 !== 0) {
    if (dataBits[pos] !== 0) paddingValid = false;
    pos++;
  }
  let expectedPad = 0xec;
  while (pos < dataBits.length) {
    if (read(pos, 8) !== expectedPad) paddingValid = false;
    expectedPad ^= 0xec ^ 0x11;
    pos += 8;
  }
  return { version, size, ecLevel, mask, formatCopiesAgree, versionInfoValid, totalCodewords, blocks, ecPerBlock, syndromesZero, paddingValid, bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}
