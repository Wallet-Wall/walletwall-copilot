// A QR Code encoder for the WallPrint portable reference: ISO/IEC 18004 model 2, byte mode, error correction level M,
// versions 1 to 15, generated locally from the reference text and nothing else. No remote image service, no library, no
// canvas element, no randomness, no clock: the same text always produces the same module matrix (the mask is chosen by
// the standard's penalty rules and ties go to the lowest mask number).
//
// The QR code is a locator, exactly as the printed reference beside it is: it encodes the reference's bytes, verbatim,
// and encodes no wallet address, no local URL, no session, no key, no query and no record content. It is rendered as a
// plain path of dark modules on the plate (the colours are the stylesheet's tokens), framed as a registration block,
// never as a seal or a mark of approval. A reader who cannot scan it loses nothing: the same text is printed and copyable.
//
// Imports nothing. The matrix is handed to the renderer as a flat Uint8Array (1 = dark) with its size, plus the path data.

export const QR_EC_LEVEL = "M";
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 15;
/** The quiet zone the standard asks for, in modules, on every side. */
export const QR_QUIET_ZONE = 4;

// ─── GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) ───

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The Reed-Solomon generator polynomial for n error-correction codewords, highest degree first (leading coefficient 1). */
export function generatorPolynomial(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** The n error-correction codewords for one block of data codewords. */
export function errorCorrection(data, n) {
  const g = generatorPolynomial(n);
  const reg = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ reg.shift();
    reg.push(0);
    if (factor !== 0) for (let j = 0; j < n; j++) reg[j] ^= mul(g[j + 1], factor);
  }
  return reg;
}

// ─── version tables (level M only) ───────────────────────────────────────────

/** Error-correction codewords per block and number of blocks, level M, versions 1 to 15 (ISO/IEC 18004 table 9). */
export const EC_BLOCKS_M = [
  [10, 1],
  [16, 1],
  [26, 1],
  [18, 2],
  [24, 2],
  [16, 4],
  [18, 4],
  [22, 4],
  [22, 5],
  [26, 5],
  [30, 5],
  [22, 8],
  [22, 9],
  [24, 9],
  [24, 10],
];

/** Alignment pattern centre coordinates, versions 1 to 15 (ISO/IEC 18004 annex E). */
export const ALIGNMENT_CENTRES = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 52], [6, 30, 56], [6, 32, 60], [6, 34, 64], [6, 26, 46, 66], [6, 26, 48, 70]];

export const sizeOf = (version) => version * 4 + 17;

/** True when an alignment centre falls on one of the three finder patterns, where the standard omits it. */
const onFinder = (r, c, size) => (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);

/**
 * The function patterns of a version: finders with separators, timing patterns, alignment patterns, the dark module,
 * and the reserved format and version areas. `reserved` marks every module that carries no data; `dark` holds the
 * pattern modules' colour (format and version bits are written later).
 */
export function functionPatterns(version) {
  const size = sizeOf(version);
  const reserved = new Uint8Array(size * size);
  const dark = new Uint8Array(size * size);
  const set = (r, c, on) => {
    reserved[r * size + c] = 1;
    dark[r * size + c] = on ? 1 : 0;
  };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        set(rr, cc, inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const centres = ALIGNMENT_CENTRES[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      if (onFinder(r, c, size)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  set(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    if (!reserved[8 * size + i]) set(8, i, false);
    if (!reserved[i * size + 8]) set(i, 8, false);
  }
  for (let i = size - 8; i < size; i++) if (!reserved[8 * size + i]) set(8, i, false);
  for (let i = size - 7; i < size; i++) if (!reserved[i * size + 8]) set(i, 8, false);
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = size - 11; j < size - 8; j++) {
        set(i, j, false);
        set(j, i, false);
      }
    }
  }
  return { size, reserved, dark };
}

/** Total codewords of a version: the free modules after every function pattern, eight bits each (remainder bits dropped). */
export function totalCodewords(version) {
  const { size, reserved } = functionPatterns(version);
  let free = 0;
  for (let i = 0; i < size * size; i++) if (!reserved[i]) free++;
  return Math.floor(free / 8);
}

/** Data codewords of a version at level M: total minus the error-correction codewords of every block. */
export function dataCodewords(version) {
  const [ecPerBlock, blocks] = EC_BLOCKS_M[version - 1];
  return totalCodewords(version) - ecPerBlock * blocks;
}

/** Byte-mode character count width: 8 bits through version 9, 16 bits from version 10. */
const countBits = (version) => (version <= 9 ? 8 : 16);

/** The smallest version (1 to 15) whose level-M data capacity holds `length` bytes in byte mode, or null. */
export function smallestVersion(length) {
  for (let v = QR_MIN_VERSION; v <= QR_MAX_VERSION; v++) if (4 + countBits(v) + 8 * length <= dataCodewords(v) * 8) return v;
  return null;
}

// ─── bit stream, blocks, interleaving ────────────────────────────────────────

function byteModeCodewords(bytes, version) {
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits data codewords into the version's blocks (the later blocks one codeword longer), computes each block's EC and interleaves. */
function interleave(data, version) {
  const [ecPerBlock, blocks] = EC_BLOCKS_M[version - 1];
  const short = Math.floor(data.length / blocks);
  const longer = data.length % blocks;
  const dataBlocks = [];
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = short + (b >= blocks - longer ? 1 : 0);
    dataBlocks.push(data.slice(offset, offset + len));
    offset += len;
  }
  const ecBlocks = dataBlocks.map((block) => errorCorrection(block, ecPerBlock));
  const out = [];
  for (let i = 0; i <= short; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

// ─── placement, masking, format ──────────────────────────────────────────────

/** Every data-module position in placement order: two-module columns from the right, snaking up and down, skipping column 6. */
export function placementOrder(size, reserved) {
  const order = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const idx = row * size + (col - c);
        if (!reserved[idx]) order.push(idx);
      }
    }
    upward = !upward;
  }
  return order;
}

export const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** The 15 format bits for level M and a mask: BCH(15,5) with generator 0x537, then the fixed XOR mask 0x5412. */
export function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits for versions 7 and up: BCH(18,6) with generator 0x1f25. */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function writeFormat(dark, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => (bits >>> i) & 1;
  const put = (r, c, v) => {
    dark[r * size + c] = v;
  };
  for (let i = 0; i <= 5; i++) put(i, 8, bit(i));
  put(7, 8, bit(6));
  put(8, 8, bit(7));
  put(8, 7, bit(8));
  for (let i = 9; i <= 14; i++) put(8, 14 - i, bit(i));
  for (let i = 0; i <= 7; i++) put(8, size - 1 - i, bit(i));
  for (let i = 8; i <= 14; i++) put(size - 15 + i, 8, bit(i));
  put(size - 8, 8, 1);
}

function writeVersion(dark, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const v = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    dark[b * size + a] = v;
    dark[a * size + b] = v;
  }
}

/** The standard's four penalty rules (N1 = 3, N2 = 3, N3 = 40, N4 = 10) over a complete matrix. */
export function penalty(dark, size) {
  let score = 0;
  const at = (r, c) => dark[r * size + c];
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  };
  for (let r = 0; r < size; r++) line((i) => at(r, i));
  for (let c = 0; c < size; c++) line((i) => at(i, c));
  for (let r = 0; r + 1 < size; r++) for (let c = 0; c + 1 < size; c++) if (at(r, c) === at(r, c + 1) && at(r, c) === at(r + 1, c) && at(r, c) === at(r + 1, c + 1)) score += 3;
  const finderLike = (get) => {
    for (let i = 0; i + 7 <= size; i++) {
      if (!(get(i) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6))) continue;
      const before = i >= 4 && !get(i - 1) && !get(i - 2) && !get(i - 3) && !get(i - 4);
      const after = i + 10 < size && !get(i + 7) && !get(i + 8) && !get(i + 9) && !get(i + 10);
      if (before) score += 40;
      if (after) score += 40;
    }
  };
  for (let r = 0; r < size; r++) finderLike((i) => at(r, i) === 1);
  for (let c = 0; c < size; c++) finderLike((i) => at(i, c) === 1);
  let darkCount = 0;
  for (let i = 0; i < size * size; i++) darkCount += dark[i];
  const total = size * size;
  const low = Math.floor((darkCount * 100) / total / 5) * 5;
  const high = low + 5;
  score += (Math.min(Math.abs(low - 50), Math.abs(high - 50)) / 5) * 10;
  return score;
}

// ─── the encoder ─────────────────────────────────────────────────────────────

/**
 * Encode text (UTF-8, byte mode, level M) into a QR Code matrix. Returns { version, size, mask, modules } where
 * `modules` is a flat Uint8Array of size×size with 1 for a dark module, or throws RangeError when the text does not fit
 * version 15 (level M holds 415 data codewords there; a portable reference is at most 206 bytes). `options.mask` forces
 * one mask pattern (tests use it to check the penalty choice); the document never passes it.
 */
export function encodeQr(text, options = {}) {
  if (typeof text !== "string" || text === "") throw new RangeError("QR text must be a non-empty string");
  const forced = Number.isInteger(options.mask) && options.mask >= 0 && options.mask <= 7 ? options.mask : null;
  const bytes = new TextEncoder().encode(text);
  const version = smallestVersion(bytes.length);
  if (version === null) throw new RangeError("QR text exceeds the level-M capacity of version 15");
  const { size, reserved, dark } = functionPatterns(version);
  const codewords = interleave(byteModeCodewords(bytes, version), version);
  const order = placementOrder(size, reserved);
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forced !== null && mask !== forced) continue;
    const candidate = Uint8Array.from(dark);
    for (let i = 0; i < order.length; i++) {
      const idx = order[i];
      const r = Math.floor(idx / size);
      const c = idx % size;
      candidate[idx] = (i < bits.length ? bits[i] : 0) ^ (MASKS[mask](r, c) ? 1 : 0);
    }
    writeFormat(candidate, size, mask);
    writeVersion(candidate, size, version);
    const score = penalty(candidate, size);
    if (best === null || score < best.score) best = { mask, score, modules: candidate };
  }
  return { version, size, mask: best.mask, penalty: best.score, modules: best.modules, ecLevel: QR_EC_LEVEL, byteLength: bytes.length };
}

/**
 * The dark modules of a code as SVG path data inside a square of (size + 2 × quiet) units, one `M x y h n v 1 h -n z`
 * subpath per horizontal run. The renderer wraps it in the markup; this module writes no markup.
 */
export function qrPathData(code, quiet = QR_QUIET_ZONE) {
  const { size, modules } = code;
  let d = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r * size + c]) {
        c++;
        continue;
      }
      let run = 0;
      while (c + run < size && modules[r * size + c + run]) run++;
      d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
      c += run;
    }
  }
  return { extent: size + 2 * quiet, d };
}
