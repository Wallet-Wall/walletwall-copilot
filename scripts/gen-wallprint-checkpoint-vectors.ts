import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCheckpointVectorFile, formatVectorFile } from "../packages/mcp/test/support/wallprint-checkpoints.ts";

/**
 * Synthetic, deterministic WallPrint trust-checkpoint vectors (spec/WALLPRINT_ATTESTATIONS.md, section 23). Every key is a test
 * key derived from a public ASCII seed; the committed file is a regression record and an interoperability aid for an independent
 * verifier, never a trust root. Ed25519 signatures are deterministic, so a regeneration equals the file.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const outPath = `${root}packages/mcp/test/wallprint/fixtures/wallprint-checkpoint-vectors-0.1.json`;
const text = `${formatVectorFile(buildCheckpointVectorFile())}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // reported below
  }
  if (current !== text) {
    console.error("WallPrint checkpoint vectors are out of date. Run: npm run gen:wallprint-checkpoint-vectors");
    process.exit(1);
  }
  console.log("wallprint checkpoint vectors current");
} else {
  writeFileSync(outPath, text);
  console.log(`wrote wallprint checkpoint vectors (${Math.round(text.length / 1024)} KiB)`);
}
