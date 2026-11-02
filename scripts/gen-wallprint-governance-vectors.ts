import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGovernanceVectorFile, formatVectorFile } from "../packages/mcp/test/support/wallprint-governance-vectors.ts";

/**
 * Synthetic, deterministic WallPrint governance-ceremony vectors and rehearsal record (spec/WALLPRINT_ATTESTATIONS.md, section 24). Every key
 * is a test key derived from a public ASCII seed; the committed file is a regression record and an interoperability aid for an independent
 * verifier, never a root, a bootstrap or a ceremony. It generates no key: Ed25519 signing of a public synthetic seed is deterministic, so a
 * regeneration equals the file.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const outPath = `${root}packages/mcp/test/wallprint/fixtures/wallprint-governance-ceremony-vectors-0.1.json`;
const text = `${formatVectorFile(buildGovernanceVectorFile())}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // reported below
  }
  if (current !== text) {
    console.error("WallPrint governance ceremony vectors are out of date. Run: npm run gen:wallprint-governance-vectors");
    process.exit(1);
  }
  console.log("wallprint governance ceremony vectors current");
} else {
  writeFileSync(outPath, text);
  console.log(`wrote wallprint governance ceremony vectors (${Math.round(text.length / 1024)} KiB)`);
}
