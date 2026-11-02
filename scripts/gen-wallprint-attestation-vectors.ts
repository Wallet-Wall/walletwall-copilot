import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildVectorFile, formatVectorFile } from "../packages/mcp/test/support/wallprint-attestations.ts";

/**
 * Synthetic, deterministic WallPrint attestation vectors (spec/WALLPRINT_ATTESTATIONS.md, "Test vectors"). Every key is a
 * test key derived from a public ASCII seed; the committed file is a regression record and an interoperability aid for an
 * independent verifier, never a registry. Ed25519 signatures are deterministic, so a regeneration equals the file.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const outPath = `${root}packages/mcp/test/wallprint/fixtures/wallprint-attestation-vectors-0.1.json`;
const text = `${formatVectorFile(buildVectorFile())}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // reported below
  }
  if (current !== text) {
    console.error("WallPrint attestation vectors are out of date. Run: npm run gen:wallprint-attestation-vectors");
    process.exit(1);
  }
  console.log("wallprint attestation vectors current");
} else {
  writeFileSync(outPath, text);
  console.log(`wrote wallprint attestation vectors (${Math.round(text.length / 1024)} KiB)`);
}
