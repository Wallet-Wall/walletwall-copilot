import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ANCHOR_REASONS,
  ANCHOR_STATUSES,
  CHECKPOINT_DOMAIN_TAGS,
  CHECKPOINT_ESTABLISHES,
  CHECKPOINT_INVARIANTS,
  CHECKPOINT_LIMITATIONS,
  CHECKPOINT_PURPOSES,
  CHECKPOINT_VERSION,
  CROSS_BINDING_REASONS,
  CROSS_BINDING_STATUSES,
  GOVERNANCE_AUTHORIZATION,
  GOVERNANCE_KEY_KNOWLEDGE,
  GOVERNANCE_KEY_PURPOSES,
  GOVERNANCE_TRUST_ROOT_FORMAT_VERSION,
  IDENTITY_REASONS,
  IDENTITY_STATUSES,
  LOG_CHAIN_STATUSES,
  LOG_REASONS,
  LOG_STATE_STATUSES,
  SIGNER_REASONS,
} from "../../src/wallprint/checkpoint-vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { checkpointVectorSpecs } from "../support/wallprint-checkpoints.ts";

/**
 * Structural guard for section 23 of spec/WALLPRINT_ATTESTATIONS.md: the sections the checkpoint lane was asked to document, the exact
 * names the verifier uses, the boundary statements, the decisions and threats it added, and the modules, tests and vectors it points at.
 * The repository's public-claims scan (public-release.test.ts) already covers prohibited wording for every spec/*.md file.
 */
const DOC = "spec/WALLPRINT_ATTESTATIONS.md";
const doc = readFileSync(`${ROOT}${DOC}`, "utf8").replace(/\r\n/g, "\n");
const flat = doc.replace(/\s+/g, " ");
const section = doc.slice(doc.indexOf("## 23. Signed trust checkpoints"));

describe("WallPrint attestations specification, section 23: signed trust checkpoints", () => {
  test("defines every section the lane was asked to document", () => {
    for (const heading of [
      "## 23. Signed trust checkpoints",
      "### 23.1 The gap, exactly",
      "### 23.2 The checkpoint",
      "### 23.3 The exact signed bytes",
      "### 23.4 Who may sign: the governance trust root, and the bootstrap",
      "### 23.5 What a checkpoint means",
      "### 23.6 The verification result",
      "### 23.7 Rollback, currentness and old checkpoints",
      "### 23.8 The ordering rule between the ledger and the registry",
      "### 23.9 Checkpoint chaining: decided against",
      "### 23.10 Compromise and back-dating, revisited",
      "### 23.11 Evolution after a checkpoint",
      "### 23.12 The checkpoint digest, the integrity policy and publication (design; nothing is published by this lane)",
      "### 23.13 What this lane does not do (stop conditions, evaluated)",
      "### 23.14 The prototype, the vectors and the mutation coverage",
      "### 23.15 Limitations",
    ]) assert.ok(doc.includes(heading), heading);
    assert.ok(doc.indexOf("## 22. Decision record") < doc.indexOf("## 23. Signed trust checkpoints"));
  });

  test("states the exact signed bytes and the domain tag, and that it is the one shared construction", () => {
    assert.ok(section.includes("UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))"));
    for (const tag of Object.values(CHECKPOINT_DOMAIN_TAGS)) assert.ok(section.includes(`\`${tag}\``), tag);
    assert.ok(flat.includes("`domainSeparatedPreimage`"));
    assert.ok(flat.includes("not a second convention"));
    assert.ok(section.includes(`"checkpointVersion": "${CHECKPOINT_VERSION}"`) && section.includes(`"formatVersion": "${GOVERNANCE_TRUST_ROOT_FORMAT_VERSION}"`));
  });

  test("names every purpose, status, reason, limitation and invariant the verifier uses", () => {
    for (const name of [...CHECKPOINT_PURPOSES, ...GOVERNANCE_KEY_PURPOSES]) assert.ok(section.includes(`\`${name}\``), name);
    for (const name of [...GOVERNANCE_KEY_KNOWLEDGE, ...GOVERNANCE_AUTHORIZATION, ...LOG_CHAIN_STATUSES, ...LOG_STATE_STATUSES, ...CROSS_BINDING_STATUSES, ...ANCHOR_STATUSES, ...IDENTITY_STATUSES]) assert.ok(section.includes(`\`${name}\``), name);
    for (const code of [...SIGNER_REASONS, ...CROSS_BINDING_REASONS, ...ANCHOR_REASONS, ...IDENTITY_REASONS, ...CHECKPOINT_LIMITATIONS]) assert.ok(section.includes(code), code);
    for (const code of LOG_REASONS) assert.ok(section.includes(code.replace(/^(?:REGISTRY|LEDGER)_/, "")) || section.includes(code), code);
    for (const inv of CHECKPOINT_INVARIANTS) assert.ok(section.includes(inv), inv);
    assert.ok(flat.includes("There is no `verified` flag"));
  });

  test("answers the questions it was asked: what a checkpoint establishes and does not, the bootstrap, the cut, rollback, chaining, evolution, back-dating, ceremony and publication", () => {
    for (const s of [
      "WalletWall governance key K signed one statement committing signing-key registry state R",
      "A checkpoint over registry 5 and ledger 12 does not authenticate registry 6 with ledger 12, or registry 5 with ledger 13",
      "does not prove that entry *k* was written after registry version *v* existed",
      "How does a verifier know the first authorized checkpoint key?",
      "A production bootstrap does not exist and requires the governance key ceremony",
      "The registry being checkpointed cannot authorize its own checkpoint's signer",
      "An old checkpoint is **not invalid**",
      "Cryptographic validity and currentness are separate dimensions",
      "Option A is chosen",
      "A signed checkpoint is immutable historical evidence",
      "Checkpoint validity is not key standing",
      "The residual, stated.",
      "No new SHA-256 computation site is created",
      "no database, endpoint, remote fetch or hosted compute is added",
      "This repository contains no governance private key",
      "It accepts only a result `verifyCheckpoint` itself returned",
      "**Integrator rule.**",
      "**The cost of the rule, stated.**",
      "**Changes to existing #29 code, all of them listed.**",
      "an acceptor judges under the registry head",
      "never throws, for any argument",
    ]) assert.ok(flat.includes(s), s);
    assert.ok(CHECKPOINT_ESTABLISHES.startsWith("Only when the signature is VALID and the signer is AUTHORIZED:"));
    assert.ok(/every ledger position is covered|at every position/.test(flat));
  });

  test("keeps the contract versions it does not move, and the runtime it does not touch", () => {
    for (const s of ["WallPrint stays `0.2`", "the six MCP tools, the eleven resources", "`plugin/server/walletwall-mcp.mjs`", "no second crypto library or algorithm is introduced"]) assert.ok(flat.includes(s), s);
    assert.ok(flat.includes("regenerate byte for byte"));
  });

  test("records the decisions and threats the lane added, and the follow-ups it leaves", () => {
    for (let n = 19; n <= 29; n++) assert.ok(doc.includes(`| D${n} |`), `D${n}`);
    for (let n = 26; n <= 37; n++) assert.ok(doc.includes(`| T${n} |`), `T${n}`);
    for (const f of ["11. **The governance key ceremony.**", "12. **Checkpoint publication tooling.**", "13. **Resolver and browser binding for checkpoints.**", "14. **Equivocation.**", "15. **Checkpoint cadence.**"]) assert.ok(doc.includes(f), f);
    assert.ok(doc.includes("*Addressed in section 23*"));
  });

  test("every checkpoint vector it cites exists in the committed file, and the table names every vector family", () => {
    const ids = checkpointVectorSpecs().map((v) => v.id);
    const cited = [...new Set(section.match(/`cp-\d\d[a-f]?(?=[-`])/g) ?? [])].map((c) => c.slice(1));
    assert.ok(cited.length >= 20, `${cited.length} cited`);
    for (const c of cited) assert.ok(ids.some((id) => id === c || id.startsWith(`${c}-`)), c);
    const families = new Set(ids.map((id) => id.slice(0, 5)));
    for (const family of families) assert.ok(section.includes(`\`${family}`) || section.includes(`\`${family.replace(/[a-f]$/, "")}`), `family ${family}`);
  });

  test("the modules, tests, fixtures and scripts it names exist", () => {
    for (const p of [
      "packages/mcp/src/wallprint/checkpoint-vocabulary.ts",
      "packages/mcp/src/wallprint/checkpoint.ts",
      "packages/mcp/src/wallprint/checkpoint-verify.ts",
      "packages/mcp/test/wallprint/checkpoint-gap.test.ts",
      "packages/mcp/test/wallprint/checkpoint.test.ts",
      "packages/mcp/test/wallprint/checkpoint-verify.test.ts",
      "packages/mcp/test/wallprint/checkpoint-scenarios.test.ts",
      "packages/mcp/test/wallprint/checkpoint-vectors.test.ts",
      "packages/mcp/test/wallprint/fixtures/wallprint-checkpoint-vectors-0.1.json",
      "packages/mcp/test/mutation/wallprint-checkpoint-mutation.ts",
      "scripts/gen-wallprint-checkpoint-vectors.ts",
    ]) {
      assert.ok(existsSync(`${ROOT}${p}`), p);
      assert.ok(section.includes(p.split("/").pop() ?? p) || p.endsWith("wallprint-checkpoint-mutation.ts"), p);
    }
    const scripts = (JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const name of ["gen:wallprint-checkpoint-vectors", "verify:wallprint-checkpoint-vectors", "test:wallprint-checkpoint-mutation"]) {
      assert.ok(scripts[name], name);
      assert.ok(section.includes(name), name);
    }
    assert.ok(scripts["verify"]?.includes("verify:wallprint-checkpoint-vectors"), "`npm run verify` runs the checkpoint vector check");
  });

  test("uses no generic assurance claim for itself: it never says a WallPrint, issuer or record is verified or trusted", () => {
    assert.ok(!/\bWallPrint verified\b|\bissuer verified\b|\btrusted record\b|\bverified WallPrint\b|\bverified checkpoint\b/i.test(flat));
    assert.ok(!/\bsecure(?:ly)?\b|tamper[\s-]*proof|\banonymous/i.test(section));
  });
});
