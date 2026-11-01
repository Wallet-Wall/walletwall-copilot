import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SUPPORT_STATES } from "../../src/schemas.ts";
import { ASSESSOR_IMPORT_INVARIANTS, ASSESSOR_IMPORT_MAX_BYTES, ASSESSOR_IMPORT_MAX_INPUTS, ASSESSOR_IMPORT_REFUSALS, ASSESSOR_IMPORT_VERSION } from "../../src/wallprint/assessor-import.ts";
import { REFERENCE_IDENTIFIES, REFERENCE_OUTCOMES, REFERENCE_TARGETS } from "../../src/wallprint/reference.ts";
import { LIFECYCLE_STATES, WALLPRINT_INVARIANTS, WALLPRINT_PRINCIPLE, WALLPRINT_VERSION } from "../../src/wallprint/vocabulary.ts";
import { ROOT } from "../support/harness.ts";

/**
 * Structural guard for spec/WALLPRINT.md: the governing statements, the three dimensions, the invariants, the
 * address-case report and the module paths it names. The repository's public-claims scan (public-release.test.ts)
 * already covers prohibited wording for every spec/*.md file.
 */
const DOC = "spec/WALLPRINT.md";
const doc = readFileSync(`${ROOT}${DOC}`, "utf8").replace(/\r\n/g, "\n");
const flat = doc.replace(/\s+/g, " ");

describe("WallPrint specification document", () => {
  test("states the principle, the integrity statement and the assessment statement verbatim", () => {
    assert.ok(flat.includes(WALLPRINT_PRINCIPLE));
    assert.ok(flat.includes("A valid WallPrint digest demonstrates that a disclosed canonical record matches its committed record. It does not, by itself, demonstrate that every factual claim in that record is correct."));
    assert.ok(flat.includes("An assessment records what a named assessor concluded under a named policy at a particular time. Multiple assessments may disagree. WallPrint preserves disagreement rather than manufacturing consensus."));
    assert.ok(flat.includes("WallPrint preserves the evidence, assessments, limitations, conflicts, corrections, and supersessions needed to understand how a WalletWall conclusion was reached and how it changed."));
    assert.ok(flat.includes("does not claim audit certification or immutable truth"));
  });

  test("names the WWEP support states as the only evidence vocabulary and the five lifecycle states", () => {
    for (const s of SUPPORT_STATES) assert.ok(doc.includes(`\`${s}\``), s);
    for (const s of LIFECYCLE_STATES) assert.ok(doc.includes(`\`${s}\``), s);
    assert.ok(flat.includes("WallPrint defines no evidence state of its own"));
    assert.ok(flat.includes(`\`${WALLPRINT_VERSION}\``));
    assert.ok(/versioned independently/.test(flat));
  });

  test("lists every non-negotiable invariant, including UNREPLAYABLE is not INCORRECT", () => {
    for (const inv of WALLPRINT_INVARIANTS) assert.ok(doc.includes(inv), inv);
    assert.ok(flat.includes("UNREPLAYABLE is not INCORRECT"));
  });

  test("reports the address-case behaviour as inherited and unchanged, and names the one module that owns identity", () => {
    assert.ok(flat.includes("packages/mcp/src/wallprint/identity.ts"));
    assert.ok(/does not normalise case/.test(flat));
    assert.ok(/EVIDENCE_PROFILE\.md.*section 11/.test(flat));
  });

  test("states the portable reference as a locator: both forms, the five outcomes, the resolver prerequisite and no signing", () => {
    assert.ok(flat.includes("A reference is a locator, not authority."));
    assert.ok(flat.includes(REFERENCE_IDENTIFIES));
    assert.ok(doc.includes("walletwall://wallprint/<recordId>?reference=0.1&wallprint=<wallprintVersion>&digest=<hex64>[&target=<target>]"));
    assert.ok(doc.includes('"type":"walletwall.wallprint.reference"'));
    for (const o of REFERENCE_OUTCOMES) assert.ok(doc.includes(`\`${o}\``), o);
    for (const t of REFERENCE_TARGETS) assert.ok(doc.includes(`\`${t}\``), t);
    assert.ok(/A resolver locates a disclosure\. It does not make that disclosure authoritative\./.test(flat) && /not a signature/.test(flat) && /never as forgery/.test(flat));
    assert.ok(!/No public resolver exists/.test(flat), "the public resolver exists now; the old statement is gone");
    assert.ok(/a corrected, superseded or withdrawn record is as valid a target as the current one/.test(flat));
    assert.ok(flat.includes("packages/mcp/src/wallprint/reference.ts") && flat.includes("scripts/gen-wallprint-reference.ts"));
    assert.ok(existsSync(`${ROOT}packages/mcp/src/wallprint/reference.ts`) && existsSync(`${ROOT}scripts/gen-wallprint-reference.ts`) && existsSync(`${ROOT}packages/mcp/test/wallprint/reference.test.ts`));
  });

  test("states the public resolver: the HTTPS form as a prefix substitution, deliberate publication, immutable bytes, the seven outcomes and the boundary statement", () => {
    assert.ok(doc.includes("## Public resolver"));
    assert.ok(doc.includes("<resolverBase>/wallprint/<recordId>?reference=0.1&wallprint=<wallprintVersion>&digest=<hex64>[&target=<target>]"));
    assert.ok(flat.includes("This page resolves a published WallPrint disclosure. Publication and resolution do not establish factual truth, safety, solvency, compliance, or investment merit."));
    for (const o of ["`UNREACHABLE`", "`UNAVAILABLE`", "`DIGEST_MISMATCH`", "`NOT_COMPARED`"]) assert.ok(doc.includes(o), o);
    assert.ok(/deliberate, never ambient/.test(flat) && /nothing redirects/.test(flat) && /never overwrite/.test(flat));
    assert.ok(flat.includes("**What the digest covers.** The URL's digest covers the record's canonical bytes and nothing else."));
    assert.ok(/nothing signs it/.test(flat) && /cannot be told apart from the engine's own without a signature/.test(flat));
    for (const name of ["isPublishableId", "storeGraphFindings", "lib/ledger.ts"]) assert.ok(flat.includes(name), name);
    assert.ok(/must answer 404|depends on the host answering 404/.test(flat), "the host requirement for UNAVAILABLE is stated");
    for (const p of ["packages/mcp/src/wallprint/publication.ts", "packages/mcp/src/wallprint/publication-vocabulary.ts", "packages/wallprint-web/browser/page.ts", "scripts/wallprint-publish.ts", "scripts/build-wallprint-public.ts", "docs/WALLPRINT_PUBLIC_RESOLVER.md"]) {
      assert.ok(flat.includes(p), p);
      assert.ok(existsSync(`${ROOT}${p}`), `${p} exists`);
    }
  });

  test("states the external assessor import: the envelope, its own version, the bounds, attribution without authentication, no authority, no lifecycle, no public write endpoint", () => {
    assert.ok(doc.includes("## External assessor import"));
    assert.ok(doc.includes('{ "assessmentImportVersion": "0.1",') && flat.includes(`\`assessmentImportVersion\` \`${ASSESSOR_IMPORT_VERSION}\``));
    assert.ok(flat.includes(`at most ${ASSESSOR_IMPORT_MAX_BYTES / 1024} KiB`) && flat.includes(`at most ${ASSESSOR_IMPORT_MAX_INPUTS} inputs per call`));
    for (const s of ["a repeated key", "`__proto__`", "ASSESSOR_IMPORT_REFUSALS"]) assert.ok(flat.includes(s), s);
    assert.ok(ASSESSOR_IMPORT_REFUSALS.includes("DUPLICATE_KEY") && ASSESSOR_IMPORT_REFUSALS.includes("FORBIDDEN_STRUCTURE"));
    for (const inv of ASSESSOR_IMPORT_INVARIANTS) assert.ok(doc.includes(inv), inv);
    for (const s of ["attribution, not authentication", "IMPORTED", "REFUSED", "atomic", "no score, trust level, confidence, rank, approval, certification, issuer-endorsement flag, verified flag, consensus or signature field exists"]) {
      assert.ok(flat.includes(s), s);
    }
    assert.ok(/WallPrint record version moved from `0\.1` to `0\.2`|moved WallPrint from 0\.1 to 0\.2/.test(flat) && /versioned independently as `assessmentImportVersion`/.test(flat), "the import version is distinct from the record version");
    assert.ok(/Importing builds, commits, discloses, corrects, supersedes, withdraws and publishes nothing/.test(flat));
    assert.ok(/no public or remote assessor import endpoint/.test(flat) && /no write route/.test(flat));
    assert.ok(!/There is no external assessor import/.test(flat), "the old blanket statement is gone; the local import now exists");
    for (const p of ["packages/mcp/src/wallprint/assessor-import.ts", "packages/mcp/src/wallprint/strict-json.ts", "packages/mcp/test/wallprint/assessor-import.test.ts", "packages/mcp/test/wallprint/assessor-import-mutation.test.ts"]) {
      assert.ok(existsSync(`${ROOT}${p}`), p);
    }
    for (const name of ["assessor-import.ts", "strict-json.ts", "assessor-import.test.ts", "assessor-import-mutation.test.ts", "externalAssessmentAdmissionFindings"]) assert.ok(doc.includes(name), name);
    const resolver = readFileSync(`${ROOT}docs/WALLPRINT_PUBLIC_RESOLVER.md`, "utf8").replace(/\s+/g, " ");
    assert.ok(/no public or remote assessor import/.test(resolver) && !/no search endpoint and no assessor import/.test(resolver));
  });

  test("the modules and tests it names exist", () => {
    for (const p of ["packages/mcp/src/wallprint/identity.ts", "packages/mcp/src/wallprint/record.ts", "packages/mcp/src/wallprint/history.ts", "packages/mcp/test/wallprint/identity.test.ts", "packages/mcp/test/wallprint/history.test.ts", "packages/mcp/test/wallprint/record.test.ts"]) {
      assert.ok(existsSync(`${ROOT}${p}`), p);
    }
    for (const name of ["identity.test.ts", "history.test.ts", "record.test.ts"]) assert.ok(doc.includes(name), name);
  });

  test("WallPrint stays out of the shipped runtime: main.ts, server.ts and tools.ts do not import it", () => {
    for (const f of ["packages/mcp/src/main.ts", "packages/mcp/src/server.ts", "packages/mcp/src/tools.ts", "packages/mcp/src/resources.ts"]) {
      assert.ok(!/wallprint/i.test(readFileSync(`${ROOT}${f}`, "utf8")), `${f} must not import wallprint`);
    }
  });
});
