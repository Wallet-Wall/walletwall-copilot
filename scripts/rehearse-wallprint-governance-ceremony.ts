import { bootstrapDigest } from "../packages/mcp/src/wallprint/governance.ts";
import { scanCeremonyFile } from "../packages/mcp/src/wallprint/governance-secret-scan.ts";
import { rehearse, verifyTranscriptFor } from "../packages/mcp/test/support/wallprint-governance.ts";
import { verifyGovernance } from "../packages/mcp/src/wallprint/governance-verify.ts";

/**
 * Runs the SYNTHETIC governance key-ceremony rehearsal and prints what the verifiers said at each step. It generates no key: every key is a
 * public ASCII-label seed, everything is in memory, nothing is written, and nothing here can sign for anyone. It is not the live ceremony and
 * it is not a tool for one: the real ceremony is a separate, human procedure (docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md), and there is
 * deliberately no command in this repository that creates a production root or a production signing key.
 *
 *   npm run rehearse:wallprint-governance-ceremony            a readable log
 *   npm run rehearse:wallprint-governance-ceremony -- --json  the whole record as JSON
 *
 * The exit status is 1 when the rehearsal's own checks fail (a transcript that is not complete, a secret-looking finding, a chain that does not verify).
 */
const rehearsal = rehearse();
const { bootstrap1, chain1, transcripts } = rehearsal.artifacts;

const problems: string[] = [];
const chain = verifyGovernance({ bootstrap: bootstrap1, authorizations: chain1, allowSynthetic: true, expectedBootstrapDigest: bootstrapDigest(bootstrap1) });
if (chain.chain.status !== "VALID" || chain.bootstrap.pin !== "PINNED") problems.push("the rehearsal chain does not verify under its pinned bootstrap");
const secretFindings = scanCeremonyFile("rehearsal.json", JSON.stringify(rehearsal)).length;
if (secretFindings > 0) problems.push(`secret-looking findings in the rehearsal output: ${secretFindings}`);
for (const [name, transcript] of Object.entries(transcripts)) {
  const authorizations = chain1.filter((a) => (name === "rootBootstrap" ? a.statement.generation === "1" : name === "rotation" ? a.statement.generation === "2" : a.statement.generation === "3"));
  const result = verifyTranscriptFor(transcript, bootstrap1, authorizations);
  if (result.reasons.length > 0) problems.push(`transcript ${name}: ${result.reasons.join(", ")}`);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ synthetic: true, steps: rehearsal.steps, problems }, null, 2));
} else {
  console.log("SYNTHETIC / NON-PRODUCTION: governance key-ceremony rehearsal. No key is generated; every seed is a public label.\n");
  for (const s of rehearsal.steps) {
    console.log(`${String(s.step).padStart(2, "0")}  ${s.name}`);
    for (const [key, value] of Object.entries(s.facts)) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      console.log(`      ${key}: ${text.length > 150 ? `${text.slice(0, 147)}...` : text}`);
    }
  }
  console.log(`\nsteps: ${rehearsal.steps.length}  transcripts: ${Object.keys(transcripts).length}  secret-looking findings: ${secretFindings}`);
  console.log("production keys generated: NO   production secrets written: NO");
  for (const p of problems) console.error(`PROBLEM: ${p}`);
}
if (problems.length > 0) process.exit(1);
