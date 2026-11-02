import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SIGNATURE_REASONS } from "../../src/wallprint/attestation-vocabulary.ts";
import {
  AUTHORIZATION_DOMAIN_TAGS,
  AUTHORIZATION_PURPOSES,
  BACKUP_MINIMUMS,
  BOOTSTRAP_EPOCH_STATUSES,
  BOOTSTRAP_PARSE_STATUSES,
  BOOTSTRAP_PIN_STATUSES,
  BOOTSTRAP_REASONS,
  CEREMONY_EVENTS,
  CEREMONY_KINDS,
  CEREMONY_MODES,
  CEREMONY_ROLES,
  CHAIN_REASONS,
  CHAIN_STATUSES,
  CHECKLIST_ITEMS,
  CONFIRMATION_ORIGINS,
  EVENT_CHECKLIST,
  GOVERNANCE_FORMAT_VERSION,
  GOVERNANCE_INVARIANTS,
  GOVERNANCE_LIMITATIONS,
  HELD_REASONS,
  HELD_STATUSES,
  KEY_STANDINGS,
  MINIMUM_INDEPENDENT_ORIGINS,
  NOT_GRANTABLE_PURPOSES,
  OPERATIONAL_KEY_PURPOSES,
  PIN_REASONS,
  RELIANCE_REASONS,
  RELIANCE_STANDINGS,
  RELIANCE_STATUSES,
  ROOT_PURPOSES,
  SECRET_SCAN_CODES,
  SUPERSEDED_STANDINGS,
  SYNTHETIC_KEY_ID_PREFIX,
  TRANSCRIPT_LIMITATIONS,
  TRANSCRIPT_REASONS,
} from "../../src/wallprint/governance-vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import { governanceVectorSpecs } from "../support/wallprint-governance-vectors.ts";

/**
 * Structural guard for section 24 of spec/WALLPRINT_ATTESTATIONS.md and for docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md: the sections the lane was
 * asked to document, the exact names the verifiers use, the boundary statements, the decisions and threats it added, and the modules, tests and
 * vectors it points at. The repository's public-claims scan (public-release.test.ts) already covers prohibited wording for every spec and docs file.
 */
const SPEC = "spec/WALLPRINT_ATTESTATIONS.md";
const RUNBOOK = "docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md";
const read = (p: string): string => readFileSync(`${ROOT}${p}`, "utf8").replace(/\r\n/g, "\n");
const doc = read(SPEC);
const section = doc.slice(doc.indexOf("## 24. The governance key ceremony"));
const flat = section.replace(/\s+/g, " ");
const runbook = read(RUNBOOK);
const runbookFlat = runbook.replace(/\s+/g, " ");
const pkg = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

describe("WallPrint attestations specification, section 24: the governance key ceremony", () => {
  test("defines every section the lane was asked to document, after section 23", () => {
    for (const heading of [
      "## 24. The governance key ceremony: bootstrap, authorization and lifecycle",
      "### 24.1 The question, and the short answer",
      "### 24.2 The hierarchy: three options compared",
      "### 24.3 What the root is for, and what it is not",
      "### 24.4 The operational checkpoint key",
      "### 24.5 The bootstrap artifact",
      "### 24.6 The authorization object",
      "### 24.7 Bootstrap distribution is a policy, not a signature",
      "### 24.8 The verification result",
      "### 24.9 Operational-key lifecycle",
      "### 24.10 Root lifecycle: rotation, loss and compromise",
      "### 24.11 The ceremony model",
      "### 24.12 The ceremony transcript",
      "### 24.13 Secret isolation",
      "### 24.14 What this lane does not do (stop conditions, evaluated)",
      "### 24.15 The prototype, the vectors and the mutation coverage",
      "### 24.16 Limitations",
      "### 24.17 Unresolved risks and follow-ups",
    ]) assert.ok(doc.includes(heading), heading);
    assert.ok(doc.indexOf("## 23. Signed trust checkpoints") < doc.indexOf("## 24. The governance key ceremony"));
  });

  test("states the invariants verbatim, the exact signed bytes, the domain tag and that it is the one shared construction", () => {
    for (const inv of GOVERNANCE_INVARIANTS) assert.ok(section.includes(inv), inv);
    assert.ok(section.includes("UTF-8(domain tag) || 0x00 || UTF-8(RFC 8785(statement))"));
    for (const tag of Object.values(AUTHORIZATION_DOMAIN_TAGS)) assert.ok(section.includes(`\`${tag}\``) || section.includes(`domain tag   = ${tag}`), tag);
    assert.ok(flat.includes("`domainSeparatedPreimage`") && flat.includes("not a second convention"));
    assert.ok(section.includes(`"formatVersion": "${GOVERNANCE_FORMAT_VERSION}"`) && section.includes(`"authorizationVersion": "${GOVERNANCE_FORMAT_VERSION}"`));
    assert.ok(section.includes("walletwall.wallprint.governance-bootstrap") && section.includes("walletwall.wallprint.governance-authorization") && section.includes("walletwall.wallprint.governance-ceremony-transcript"));
  });

  test("names every purpose, standing, origin, status, reason, limitation and code the verifiers use", () => {
    for (const name of [...ROOT_PURPOSES, ...AUTHORIZATION_PURPOSES, ...OPERATIONAL_KEY_PURPOSES, ...NOT_GRANTABLE_PURPOSES, ...SUPERSEDED_STANDINGS, ...KEY_STANDINGS, ...CONFIRMATION_ORIGINS, ...CEREMONY_MODES, ...CEREMONY_KINDS, ...CEREMONY_ROLES]) {
      assert.ok(section.includes(`\`${name}\``) || section.includes(`"${name}"`), name);
    }
    for (const name of [...BOOTSTRAP_PARSE_STATUSES, ...BOOTSTRAP_PIN_STATUSES, ...BOOTSTRAP_EPOCH_STATUSES, ...CHAIN_STATUSES, ...HELD_STATUSES, ...RELIANCE_STATUSES, ...RELIANCE_STANDINGS]) assert.ok(section.includes(`\`${name}\``), name);
    for (const code of [...BOOTSTRAP_REASONS, ...CHAIN_REASONS, ...HELD_REASONS, ...RELIANCE_REASONS, ...PIN_REASONS, ...GOVERNANCE_LIMITATIONS, ...TRANSCRIPT_REASONS, ...TRANSCRIPT_LIMITATIONS, ...SECRET_SCAN_CODES]) assert.ok(section.includes(code), code);
    for (const code of SIGNATURE_REASONS.slice(0, 1)) assert.ok(doc.includes(code), code);
    assert.ok(flat.includes(`\`${SYNTHETIC_KEY_ID_PREFIX}\``));
    assert.ok(flat.includes("There is no `verified` flag") || flat.includes("no `verified` flag"));
  });

  test("answers the questions it was asked: the options, the root's purpose, the operational key, the bootstrap, distribution, rotation, loss, compromise, revocation, evidence and the transcript", () => {
    for (const s of [
      "**Rejected.** Security and recoverability both argue against a long-lived trust anchor that must be used often",
      "**Chosen.** The cost is a small, closed, signed object and a pure verifier",
      "Purpose separation is mandatory",
      "Its compromise therefore grants no authority to replace the root",
      "it never from the checkpoint it is verifying".replace("it never", "never"),
      "GitHub alone is **not** an independent trust root",
      "Bootstrap distribution is a policy, not a signature",
      "**New checkpoints require the new key.**",
      "Retirement without replacement does not exist",
      "Revocation is publication, not an online check",
      "Nothing like OCSP exists or is built",
      "A stale generation cannot supersede newer state",
      "Root rotation and root compromise are one event: a reset.",
      "**Root loss.**",
      "no new authorization can be produced",
      "**Root compromise** is the highest-severity event",
      "**cannot self-heal**",
      "a root-signed replacement is not a recovery",
      "The **cryptographic validity** of what the old lineage signed is unchanged",
      "**Rollback to an old trusted root** is refused by the epoch floor",
      "It records what participants attest; it does not prove the ceremony happened or that the machine was uncompromised.",
      "none is long enough to carry a 32-byte secret",
      "A finding is a code and a position and never the matched text",
      "**The live ceremony has not been performed.**",
      "**accepts only a result `verifyGovernance` itself returned**",
    ]) assert.ok(flat.includes(s), s);
    for (const option of ["| A. The root signs every checkpoint |", "| B. The offline root authorizes operational keys |", "| C. Another repo-native structure |"]) assert.ok(section.includes(option), option);
    for (const old of ["old root signs new root", "new root signs old root", "cross-signing", "external bootstrap reset"]) assert.ok(section.includes(`| ${old} |`), old);
    assert.equal(MINIMUM_INDEPENDENT_ORIGINS, 2);
    assert.ok(flat.includes("at least `2` **distinct** origins"));
  });

  test("keeps the contract versions it does not move, and the runtime it does not touch", () => {
    for (const s of ["the six MCP tools, the eleven resources", "`plugin/server/walletwall-mcp.mjs`", "WallPrint `0.2`", "No dependency is added", "no production key is generated by this repository"]) assert.ok(flat.includes(s) || doc.replace(/\s+/g, " ").includes(s), s);
    for (const s of ["No governance root, no operational", "no CI job may produce one"]) assert.ok(flat.includes(s), s);
  });

  test("records the decisions and threats the lane added, the evaluated stop conditions, and updates the follow-up it addressed", () => {
    for (let n = 30; n <= 41; n++) assert.ok(doc.includes(`| D${n} |`), `D${n}`);
    for (let n = 38; n <= 57; n++) assert.ok(doc.includes(`| T${n} |`), `T${n}`);
    for (const c of ["the ceremony requires production secrets in Git or CI", "the root must be frequently online", "recovery depends on one ordinary developer workstation", "the bootstrap trust path is circular", "a compromised root can only recover by trusting itself", "deleting a file is the sole protection", "a production key must be generated to test the workflow", "the design requires a hosted signing service"]) assert.ok(section.includes(c), c);
    assert.ok(doc.includes("*Addressed in section 24*"));
    assert.ok(doc.includes("11. **The governance key ceremony.**"));
    assert.ok(doc.indexOf("| D29 |") < doc.indexOf("| D30 |") && doc.indexOf("| D41 |") < doc.indexOf("## 23. Signed trust checkpoints"));
    assert.ok(doc.indexOf("| T37 |") < doc.indexOf("| T38 |") && doc.indexOf("| T57 |") < doc.indexOf("## 18. Versioning"));
  });

  test("every governance vector it cites exists in the committed file, and the table names every vector family", () => {
    const ids = governanceVectorSpecs().map((v) => v.id);
    const cited = [...new Set(section.match(/`gv-\d\d[a-z]?(?=[-`])/g) ?? [])].map((c) => c.slice(1));
    assert.ok(cited.length >= 15, `${cited.length} cited`);
    for (const c of cited) assert.ok(ids.some((id) => id === c || id.startsWith(`${c}-`)), c);
    for (const family of ["gv-01", "gv-10", "gv-20", "gv-30", "gv-40", "gv-50"]) assert.ok(section.includes(`\`${family}\``), family);
    assert.ok(!/`\d{2}[a-e]?-[a-z0-9-]+`/.test(section), "no token that the attestation vector scan would read as one of its own ids");
  });

  test("the modules, tests, fixtures and scripts it names exist, and its scripts exist in package.json and run in `npm run verify`", () => {
    for (const p of [
      "packages/mcp/src/wallprint/governance-vocabulary.ts",
      "packages/mcp/src/wallprint/governance.ts",
      "packages/mcp/src/wallprint/governance-verify.ts",
      "packages/mcp/src/wallprint/governance-transcript.ts",
      "packages/mcp/src/wallprint/governance-secret-scan.ts",
      "packages/mcp/test/wallprint/governance-bootstrap.test.ts",
      "packages/mcp/test/wallprint/governance-authorization.test.ts",
      "packages/mcp/test/wallprint/governance-rotation.test.ts",
      "packages/mcp/test/wallprint/governance-recovery.test.ts",
      "packages/mcp/test/wallprint/governance-compromise.test.ts",
      "packages/mcp/test/wallprint/governance-transcript.test.ts",
      "packages/mcp/test/wallprint/governance-secret-scan.test.ts",
      "packages/mcp/test/wallprint/governance-isolation.test.ts",
      "packages/mcp/test/wallprint/governance-rehearsal.test.ts",
      "packages/mcp/test/wallprint/governance-vectors.test.ts",
      "packages/mcp/test/wallprint/governance-spec-doc.test.ts",
      "packages/mcp/test/wallprint/fixtures/wallprint-governance-ceremony-vectors-0.1.json",
      "packages/mcp/test/mutation/wallprint-governance-mutation.ts",
      "scripts/gen-wallprint-governance-vectors.ts",
      "scripts/rehearse-wallprint-governance-ceremony.ts",
      RUNBOOK,
    ]) {
      assert.ok(existsSync(`${ROOT}${p}`), p);
      assert.ok(section.includes(p.split("/").pop() ?? p) || p.endsWith("wallprint-governance-mutation.ts") || p === RUNBOOK, p);
    }
    for (const name of ["gen:wallprint-governance-vectors", "verify:wallprint-governance-vectors", "test:wallprint-governance-mutation", "rehearse:wallprint-governance-ceremony"]) {
      assert.ok(pkg[name], name);
      assert.ok(section.includes(name), name);
    }
    assert.ok(pkg["verify"]?.includes("verify:wallprint-governance-vectors"), "`npm run verify` runs the governance vector check");
    assert.ok(doc.includes("docs/WALLPRINT_GOVERNANCE_KEY_CEREMONY.md"), "the specification points at the runbook");
  });

  test("uses no generic assurance claim for itself: it never says a WallPrint, issuer, record or checkpoint is verified or trusted, and uses none of the banned claim words", () => {
    assert.ok(!/\bWallPrint verified\b|\bissuer verified\b|\btrusted record\b|\bverified WallPrint\b|\bverified checkpoint\b|\bverified ceremony\b|\btrusted ceremony\b/i.test(flat));
    assert.ok(!/\bsecure(?:ly)?\b|tamper[\s-]*proof|\banonymous/i.test(section));
    assert.ok(!/\bsecure(?:ly)?\b|tamper[\s-]*proof|\banonymous|\bverified ceremony\b/i.test(runbook));
  });
});

describe("WallPrint governance key ceremony runbook", () => {
  test("has the twenty required sections, in order, and the appendices", () => {
    const headings = [
      "## 1. Purpose",
      "## 2. Trust architecture",
      "## 3. Roles",
      "## 4. Prerequisites",
      "## 5. Environment",
      "## 6. Verified tooling",
      "## 7. Generation procedure",
      "## 8. Public bootstrap",
      "## 9. Backup",
      "## 10. Recovery",
      "## 11. Operational-key authorization",
      "## 12. Rotation",
      "## 13. Retirement",
      "## 14. Revocation",
      "## 15. Root loss",
      "## 16. Root compromise",
      "## 17. Transcript and evidence",
      "## 18. Cleanup",
      "## 19. Post-ceremony verification",
      "## 20. Prohibited actions",
      "## Appendix A: threat model",
      "## Appendix B: checklist by event",
      "## Appendix C: the synthetic rehearsal",
      "## Appendix D: what this runbook does not decide",
    ];
    let at = -1;
    for (const h of headings) {
      const i = runbook.indexOf(`\n${h}\n`);
      assert.ok(i > at, h);
      at = i;
    }
  });

  test("cross-references the specification, says it is a draft that has not been performed, and says no production key is generated", () => {
    assert.ok(runbook.includes("spec/WALLPRINT_ATTESTATIONS.md"));
    assert.ok(runbookFlat.includes("**draft, design lane, pre-release. This procedure has not been performed.**"));
    assert.ok(runbookFlat.includes("**No production key is generated, stored or described by this repository.**"));
    assert.ok(runbookFlat.includes("deliberately no command here that creates a production root or a production operational key"));
    assert.ok(runbookFlat.includes("That specification stays the contract; this document is procedure."));
  });

  test("names every event, kind, mode, role and checklist item the transcript validator uses, with each event's exact checklist", () => {
    for (const name of [...CEREMONY_EVENTS, ...CEREMONY_KINDS, ...CEREMONY_MODES, ...CEREMONY_ROLES, ...CHECKLIST_ITEMS]) assert.ok(runbook.includes(name), name);
    for (const event of CEREMONY_EVENTS) {
      const row = runbook.split("\n").find((l) => l.startsWith(`| \`${event}\` |`));
      assert.ok(row !== undefined, event);
      const items = EVENT_CHECKLIST[event];
      if (items.length === 0) assert.ok(row?.includes("none"), event);
      for (const item of items) assert.ok(row?.includes(`\`${item}\``), `${event} ${item}`);
    }
  });

  test("states the backup floor, the participant model, the environment decisions and the limits of deletion", () => {
    for (const [name, n] of Object.entries(BACKUP_MINIMUMS)) assert.ok(n >= 2, name);
    for (const s of ["at least **3 encrypted copies**", "at least **2 physically separate places**", "at least **2 passphrase envelopes**", "**no place and no person holds both a media copy and its passphrase;**", "| two-person (operator and witness) |", "**chosen**", "**Erasure is not a control.**", "never relies on deletion", "GitHub alone is not an independent trust root", "A GitHub repository, its releases, a bundle served from them and its documentation are **one origin**"]) assert.ok(runbookFlat.includes(s), s);
    for (const s of ["live, ephemeral operating system", "Network physically disabled", "No clipboard use, no shell history, no terminal logging", "Disk encryption", "operating system's CSPRNG", "brainwallet", "UUID"]) assert.ok(runbook.includes(s), s);
    for (const place of ["GitHub or any repository", "a cloud drive or sync folder", "a repository or CI secret", "a developer home directory"]) assert.ok(runbook.includes(place), place);
  });

  test("defines recovery, root loss and root compromise as the specification does: no magic recovery, a reset, the validity of history separated from reliance", () => {
    for (const s of [
      "There is no magic recovery that preserves trust without an existing authorized key, and none is offered.",
      "**A compromised root cannot be repaired by anything the root signs**",
      "**it is the repair**",
      "*Cryptographic validity:*",
      "*Continued reliance:*",
      "Revocation is **publication, not an online check**",
      "There is no OCSP-like service and none is built.",
      "**They must be equal.**",
    ]) assert.ok(runbookFlat.includes(s), s);
    assert.ok(runbook.includes("`ROOT_BOOTSTRAP`") && runbook.includes("`OPERATIONAL_KEY_ACTION`"));
  });

  test("the threat table has the twenty threats the lane named, each with what is protected and what is not", () => {
    const rows = runbook.split("\n").filter((l) => /^\| (?:[1-9]|1[0-9]|20) \| /.test(l) && l.split("|").length === 6);
    assert.equal(rows.length, 20);
    for (const [i, row] of rows.entries()) assert.ok(row.startsWith(`| ${i + 1} |`), row.slice(0, 30));
    for (const threat of ["developer workstation", "GitHub account", "CI", "dependency", "private-key commit", "Clipboard", "Terminal-history", "Shell-transcript", "Cloud-sync", "Backup theft", "Lost root", "Lost operational", "participant acting maliciously", "Forged ceremony", "Unauthorized operational", "Old operational key", "Compromised operational key", "Compromised root", "Rollback", "Fake public bootstrap"]) {
      assert.ok(rows.some((r) => r.toLowerCase().includes(threat.toLowerCase())), threat);
    }
  });

  test("carries no command that generates a key, no real secret and no personal path: it describes requirements, and the tooling is a later, reviewed deliverable", () => {
    assert.doesNotMatch(runbook, /openssl\s+(?:genpkey|genrsa|ecparam|req)|ssh-keygen\s|age-keygen|gpg\s+--(?:gen|full)|npm run (?:create|generate)[-\w:]*(?:root|key)/i);
    assert.ok(runbookFlat.includes("the exact commands are in the ceremony script") || runbookFlat.includes("That script is a deliverable of the first live-ceremony lane; it does not exist here."));
    assert.doesNotMatch(runbook, /[A-Za-z]:\\Users\\|\/home\/[a-z]|\/Users\/[a-z]/);
  });
});
