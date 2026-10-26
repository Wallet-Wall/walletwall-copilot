import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import * as jsqrModule from "jsqr";
import { encodeReference, referenceOf, toHttpsUrl } from "../../mcp/src/wallprint/reference.ts";
import { ROOT } from "../../mcp/test/support/harness.ts";
import { publishedExports } from "./support/store.ts";

/**
 * Third-party scanner interoperability. The repository's QR encoder is hand-rolled and its own tests decode with a
 * matrix decoder written here too. This suite decodes the drawn symbols with jsQR (an independent, widely deployed
 * decoder: finder-pattern location, format and version information, de-masking, Reed-Solomon correction, byte mode),
 * from a rasterised image of the module matrix, exactly as a camera would see a printed code. jsQR is a development
 * dependency used only by tests; nothing of it ships.
 */

interface QrMod {
  encodeQr: (text: string) => { modules: ArrayLike<number>; size: number; version: number; ecLevel: string };
  QR_QUIET_ZONE: number;
}
/** jsQR ships as a CommonJS/UMD module; under Node's ESM interop its default export is the decoder function. */
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null;
const jsQR = (jsqrModule as unknown as { default: JsQr }).default;
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
const qr = (await import(pathToFileURL(`${EXT}/wallprint-qr.mjs`).href)) as QrMod;
const BASE = ["https:", "//", "walletwall.org"].join("");

/** Rasterise a module matrix as a camera would see it: dark modules black, light modules and the quiet zone white, `scale` pixels per module. */
function rasterise(modules: ArrayLike<number>, size: number, scale: number): { data: Uint8ClampedArray; width: number; height: number } {
  const quiet = qr.QR_QUIET_ZONE;
  const width = (size + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && modules[my * size + mx] === 1;
      const v = dark ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height: width };
}

const decodeWithJsQr = (text: string, scale = 4): string => {
  const code = qr.encodeQr(text);
  const img = rasterise(code.modules, code.size, scale);
  const result = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  assert.ok(result, `jsQR found no code for ${text.length} characters (version ${code.version})`);
  return result.data;
};

describe("independent decoding of the drawn codes", () => {
  test("every published record's HTTPS QR code decodes with jsQR to exactly the public URL, and parses back to the same reference", () => {
    for (const e of publishedExports()) {
      const ref = referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion });
      const url = toHttpsUrl(ref, BASE);
      assert.equal(decodeWithJsQr(url), url, e.id);
    }
  });

  test("every published record's canonical walletwall: QR code (the canvas form) decodes with jsQR to the reference text", () => {
    for (const e of publishedExports()) {
      const text = encodeReference(referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion }));
      assert.equal(decodeWithJsQr(text), text, e.id);
    }
  });

  test("the section-targeted HTTPS forms decode too, at a small module size, as a phone camera would read a 176 px print", () => {
    const e = publishedExports()[0]!;
    const ref = referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion }, "receipt");
    const url = toHttpsUrl(ref, BASE);
    assert.equal(decodeWithJsQr(url, 3), url);
  });

  test("golden interoperability fixture: the ISO/IEC 18004 worked example text decodes with jsQR from this encoder's symbol", () => {
    // The standard's Annex worked example encodes "01234567"; this encoder draws it in byte mode (its own tests pin the
    // matrix against the annex). An independent decoder reading the same text closes the loop.
    assert.equal(decodeWithJsQr("01234567", 6), "01234567");
  });
});
