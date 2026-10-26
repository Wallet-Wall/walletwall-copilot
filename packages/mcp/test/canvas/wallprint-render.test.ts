import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { LIMITATION_CODES } from "../../src/schemas.ts";
import { DIFF_CATEGORIES, RESERVED_ASSURANCE_TERMS } from "../../src/wallprint/vocabulary.ts";
import { ROOT } from "../support/harness.ts";
import type { DisclosureFixture, DisclosureRecord } from "../support/wallprint-disclosures.ts";

/**
 * The WallPrint disclosure document: a pure projection of the serialized engine outputs. These tests render every fixture
 * through the real renderer and pin what the document must show, what it must never imply, and how it degrades when a
 * value is unknown or hostile. No loopback, no MCP server: the renderer is a function.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface RenderMod {
  renderView: (view: unknown) => string;
  renderPage: (o: { nonce: string }) => string;
  LIMITATION_LABELS: Record<string, string>;
  SUPPORT_HINTS: Record<string, string>;
  FRESHNESS_HINTS: Record<string, string>;
  FINALITY_HINTS: Record<string, string>;
}
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const wp = (await import(pathToFileURL(`${EXT}/wallprint-render.mjs`).href)) as { REPLAY_REASON_LABELS: Record<string, string>; RECEIPT_REASON_LABELS: Record<string, string>; ASSESSOR_ROLE_LABELS: Record<string, string> };
const { WALLPRINT_FIXTURES, WALLPRINT_VOCABULARY } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture>; WALLPRINT_VOCABULARY: Record<string, unknown> };

const view = (name: string, disclosure: DisclosureFixture = WALLPRINT_FIXTURES[name]!) => ({ status: "wallprint", source: `wallprint:${name}`, fixture: name, disclosure, vocabulary: WALLPRINT_VOCABULARY });
const fragment = (name: string): string => render.renderView(view(name));
const names = Object.keys(WALLPRINT_FIXTURES);
const articles = (html: string): string[] => html.split(/(?=<article class="wp-record")/).slice(1).map((a) => a.slice(0, a.indexOf("</article>") + 10));
const articleOf = (html: string, id: string): string => {
  const a = articles(html).find((x) => x.includes(`data-record-id="${id}"`));
  assert.ok(a, `article ${id}`);
  return a;
};
const focusOf = (name: string): DisclosureRecord => {
  const f = WALLPRINT_FIXTURES[name]!;
  return f.records.find((r) => r.id === f.focus)!;
};
const focal = (r: DisclosureRecord) => r.record.claims.find((c) => c.assertionId === r.record.subject.focalAssertionId)!;
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

describe("rendering: every fixture becomes one disclosure document per record, in reading order", () => {
  test("the document carries the WalletWall wordmark header, the fixture notice, and one article per lineage record with only the focus visible", () => {
    for (const name of names) {
      const html = fragment(name);
      const f = WALLPRINT_FIXTURES[name]!;
      assert.ok(html.includes('<div class="ww-rail-name"><h1>WalletWall</h1>'), name);
      assert.ok(html.includes(`data-wp-fixture="${name}"`) && html.includes(`data-wp-focus="${f.focus}"`), name);
      const as = articles(html);
      assert.equal(as.length, f.records.length, `${name}: one article per record`);
      for (const r of f.records) {
        const a = articleOf(html, r.id);
        assert.equal(/<article class="wp-record"[^>]*\shidden/.test(a), r.id !== f.focus, `${r.id}: only the focus is shown; the rest stay in the document`);
        assert.ok(a.includes(`aria-labelledby="wp-h-${r.id}"`) && a.includes(`id="wp-h-${r.id}"`), `${r.id}: labelled article`);
      }
    }
  });

  test("sections appear in the agreed order: head, why and record, assessments, provenance, corrections, verify", () => {
    for (const name of names) {
      const a = articleOf(fragment(name), WALLPRINT_FIXTURES[name]!.focus);
      const order = ['class="wp-head"', 'class="wp-why', 'class="wp-recordbox', 'class="wp-assessments', 'class="wp-provenance', 'class="wp-history', 'class="wp-verify'];
      const at = order.map((s) => a.indexOf(s));
      assert.ok(at.every((i) => i >= 0), `${name}: every section exists`);
      assert.deepEqual([...at].sort((x, y) => x - y), at, `${name}: sections in order`);
      for (const h of ["Why WalletWall says this", "Record", "Assessments", "Provenance", "Corrections and supersessions", "Verify"]) assert.ok(a.includes(`>${h}</h3>`), `${name}: heading ${h}`);
    }
  });

  test("the current WalletWall assessment is the focal claim's recorded support state, with the canvas's own hint and the principle beside it", () => {
    for (const name of names) {
      const r = focusOf(name);
      const a = articleOf(fragment(name), r.id);
      const state = focal(r).supportState;
      assert.ok(a.includes(`<span class="wp-assessment-word" data-state="${state}"`), `${name}: ${state}`);
      assert.ok(a.includes(`>${state}</span>`), name);
      assert.ok(a.includes(esc(render.SUPPORT_HINTS[state]!)), `${name}: hint`);
      assert.ok(a.includes("WalletWall isn&#39;t always right. WallPrint keeps the record."), `${name}: principle`);
      assert.ok(!/WalletWall assessment[\s\S]{0,400}\b(verified|safe|certified|approved|trusted)\b/i.test(a), `${name}: no assurance word near the assessment`);
    }
  });

  test("the fixture line prints how the lineage was constructed, so an adversarial scenario is never mistaken for an engine-built one", () => {
    const built = fragment("current-supported");
    assert.ok(built.includes('<span class="wp-scenario" data-scenario="ENGINE_BUILT">Construction: every record of this lineage was built by the engine from its synthetic evidence.</span>'));
    const altered = fragment("receipt-mismatch");
    assert.ok(altered.includes('data-scenario="ALTERED_AFTER_COMMIT"') && altered.includes("changed afterwards without re-digesting (changed: <code>assessments[reviewer-y].statement</code>)"));
    const elsewhere = fragment("replay-mismatch");
    assert.ok(elsewhere.includes('data-scenario="COMMITTED_ELSEWHERE"') && elsewhere.includes("(changed: <code>claims[a-price].supportState</code>)"));
    const unverified = fragment("receipt-unverified");
    assert.ok(unverified.includes('data-scenario="VERIFICATION_NOT_CARRIED">Construction: every record of this lineage was built by the engine and its receipt was issued by the engine; the receipt&#39;s verification result was left out of this disclosure, so no check result is carried (changed: <code>receipt.verification</code>).'));
    assert.ok(!unverified.includes("not recognised: VERIFICATION_NOT_CARRIED"));
  });

  test("a focus that names no record shows the first record instead of hiding every article, and the version labels follow the recorded lineage", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["corrected"]!);
    (f as { focus: string }).focus = "no-such-record";
    const html = render.renderView(view("corrected", f));
    const as = articles(html);
    assert.equal(as.length, 2);
    assert.ok(!/<article class="wp-record"[^>]*\shidden/.test(as[0]!) && /<article class="wp-record"[^>]*\shidden/.test(as[1]!));
    assert.ok(html.includes(`data-wp-focus="${f.records[0]!.id}"`));
    // Version labels come from lineage.chain, root first, not from array position.
    const reversed = structuredClone(WALLPRINT_FIXTURES["corrected"]!);
    reversed.records.reverse();
    const r = render.renderView(view("corrected", reversed));
    assert.ok(articleOf(r, reversed.records[1]!.id).includes('data-version="v1"') && articleOf(r, reversed.records[0]!.id).includes('data-version="v2"'));
  });

  test("an unrecognised link kind is never read as a supersession, and a missing exact value is absence rather than an empty Copy", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["corrected"]!);
    (f.records[1]!.supersedes as unknown as { kind: string }).kind = "MERGE";
    (f.records[0]!.supersededBy as unknown as { kind: string }).kind = "MERGE";
    const html = render.renderView(view("corrected", f));
    assert.ok(html.includes("<strong>links to (kind not recognised)</strong>") && html.includes("<strong>linked (kind not recognised)</strong>"));
    assert.ok(!/<strong>(corrects|supersedes|corrected|superseded)<\/strong>/.test(html));
    const g = structuredClone(WALLPRINT_FIXTURES["current-supported"]!);
    (g.records[0]!.record as unknown as { digest: string }).digest = "";
    const h = render.renderView(view("current-supported", g));
    assert.ok(!h.includes('<code class="wp-exact"></code>'), "no empty exact value with a Copy control");
  });

  test("why WalletWall says this: authority, freshness, finality, corroboration, conflicts, limitations and violations, as recorded, with absence stated", () => {
    for (const name of names) {
      const r = focusOf(name);
      const c = focal(r);
      const a = articleOf(fragment(name), r.id);
      const why = a.slice(a.indexOf('class="wp-why'), a.indexOf('class="wp-recordbox'));
      assert.ok(why.includes(`<dt>Support</dt><dd><span class="chip" data-state="${c.supportState}"`), name);
      assert.ok(why.includes(`<dt>Freshness</dt><dd><span class="chip" data-state="${c.freshnessState}"`), name);
      if (c.finalityState === null) assert.ok(why.includes("does not apply to this claim type"), `${name}: null finality is absence, not a value`);
      else assert.ok(why.includes(`<dt>Finality</dt><dd><span class="chip" data-state="${c.finalityState}"`), name);
      if (c.authority) assert.ok(why.includes(`<code>${c.authority.kind}</code> · <code>${c.authority.authorityId}</code> · requirement ${c.authority.satisfied ? "satisfied" : "not satisfied"}`), name);
      else assert.ok(why.includes("no authority defined for this claim type"), name);
      if (c.independentCorroboration === null) assert.ok(why.includes("not recorded for this claim"), name);
      else assert.ok(why.includes(`<code>${c.independentCorroboration}</code>`), name);
      const lim = why.slice(why.indexOf('class="wp-limitations"'));
      for (const code of c.limitations) assert.ok(lim.includes(`<code>${code}</code>`) && lim.includes(esc(render.LIMITATION_LABELS[code]!)), `${name}: limitation ${code} with its description`);
      if (c.limitations.length === 0) assert.ok(lim.includes("No limitation codes were returned"), name);
      assert.ok(lim.includes("They are never hidden."), name);
      if (r.record.violations.length === 0) assert.ok(why.includes("<h4>Invariant violations</h4><p class=\"muted\">None recorded.</p>"), name);
    }
  });

  test("a recorded evidence conflict is visible between the claims and is never resolved", () => {
    const r = focusOf("conflicting-evidence");
    const a = articleOf(fragment("conflicting-evidence"), r.id);
    assert.ok(a.includes('<span class="wp-assessment-word" data-state="CONFLICTING" data-attention="true">CONFLICTING</span>'));
    for (const conflict of r.record.conflicts) {
      assert.ok(a.includes(`<li><code>${conflict.cause}</code> between ${conflict.assertionIds.map((id) => `<code>${id}</code>`).join(", ")}</li>`), conflict.cause);
    }
    assert.ok(!/<li><span class="chip"[^>]*>CONFLICTING<\/span>/.test(a), "a conflict record carries its cause, not a claim-state chip stamped by the page");
    assert.ok(a.includes("Conflicts are recorded, never resolved: no side is ranked above the other."));
    assert.ok(!/winner|resolved in favour|prevails/i.test(text(a)));
  });

  test("the record ledger shows every lifecycle state, reached ones with their instant and reason, unreached ones open, with screen-reader text", () => {
    for (const name of names) {
      const r = focusOf(name);
      const a = articleOf(fragment(name), r.id);
      const ledger = a.slice(a.indexOf('<ol class="wp-ledger"'), a.indexOf("</ol>", a.indexOf('<ol class="wp-ledger"')));
      const rows = ledger.split('<li class="wp-ledger-row"').slice(1);
      assert.equal(rows.length, 5, `${name}: five lifecycle rows`);
      for (const state of ["COMMITTED", "DISCLOSED", "CORRECTED", "SUPERSEDED", "WITHDRAWN"]) {
        const row = rows.find((x) => x.includes(`<code>${state}</code>`));
        assert.ok(row, `${name}: row ${state}`);
        const event = r.lifecycle.events.find((e) => e.state === state);
        assert.equal(row.includes('data-reached="true"'), event !== undefined, `${name}: ${state} reached`);
        assert.ok(row.includes(event ? "●" : "○") && row.includes(event ? "reached</span>" : "not reached</span>"), `${name}: ${state} dot and sr text`);
        if (event) {
          assert.ok(row.includes(`<time datetime="${event.at}"><code>${event.at}</code></time>`), `${name}: ${state} instant`);
          if (event.reason) assert.ok(row.includes(esc(event.reason)), `${name}: ${state} reason`);
          if (event.ref) assert.ok(row.includes(`<code>${event.ref.id}</code>`), `${name}: ${state} names the successor`);
        }
      }
      assert.ok(a.includes(`Hash-chained events (${r.lifecycle.events.length})`), name);
      for (const e of r.lifecycle.events) assert.ok(a.includes(`<code>${e.eventDigest}</code>`), `${name}: event digest in full`);
    }
  });

  test("digests, ids and versions are shown in full with a copy control; nothing is truncated", () => {
    for (const name of names) {
      const r = focusOf(name);
      const a = articleOf(fragment(name), r.id);
      for (const v of [r.record.digest, r.record.id, r.record.evidence.bundleDigest, r.record.versions.registryDigest, r.record.versions.policiesDigest]) {
        assert.ok(a.includes(`<code class="wp-exact">${v}</code><button type="button" class="copy" data-wp-copy`), `${name}: ${v} in full with Copy`);
      }
      for (const v of [r.record.versions.wwep, r.record.versions.registry, r.record.versions.policies, r.record.versions.rules, r.record.wallprintVersion]) assert.ok(a.includes(`<code>${v}</code>`), `${name}: version ${v}`);
      for (const [k, v] of Object.entries(r.record.policyVersions)) assert.ok(a.includes(`<li><code>${k}</code> <code>${v}</code></li>`), `${name}: policy ${k}`);
      assert.ok(!/<code class="wp-exact">[^<]*(…|\.\.\.)/.test(a), `${name}: no shortened exact value`);
      assert.ok(a.includes("<code>RFC8785</code>") && a.includes("<code>SHA-256</code>"), name);
      assert.ok(a.includes("Digest match = record integrity. Digest match &ne; factual correctness."), name);
    }
  });
});

describe("disagreement: every assessor stays, no consensus is manufactured, no assurance word is a verdict", () => {
  test("the assessments table has one row per recorded assessment with role, code, policy, version, time, limitations and statement", () => {
    for (const name of names) {
      const r = focusOf(name);
      const a = articleOf(fragment(name), r.id);
      const table = a.slice(a.indexOf('<table class="wp-table" role="table" aria-label="Assessments"'), a.indexOf("</table>", a.indexOf('aria-label="Assessments"')));
      const rows = table.split('<tr role="row"><th role="rowheader" scope="row">').slice(1);
      assert.equal(rows.length, r.record.assessments.length, `${name}: one row per assessment`);
      for (const s of r.record.assessments) {
        const row = rows.find((x) => x.startsWith(`<code>${s.assessor}</code>`));
        assert.ok(row, `${name}: row for ${s.assessor}`);
        assert.ok(row.includes(`data-label="Role">${esc(wp.ASSESSOR_ROLE_LABELS[s.assessorRole]!)}<`), `${name}: role`);
        if (s.assessorRole === "WALLETWALL") assert.ok(row.includes(`data-label="Assessment"><span class="chip" data-state="${s.assessment}"`), `${name}: WalletWall row is a support state`);
        else assert.ok(row.includes(`<code class="wp-attributed" data-attributed="true">${esc(s.assessment)}</code> <span class="muted small">as stated</span>`), `${name}: attributed code as stated`);
        assert.ok(row.includes(`<code>${s.policy}</code>`) && row.includes(`<code>${s.policyVersion}</code>`) && row.includes(`<time datetime="${s.assessedAt}">`), `${name}: policy and time`);
        if (s.statement === null) assert.ok(row.includes("no statement"), `${name}: absent statement is said`);
        else assert.ok(row.includes(`<q class="wp-attributed" data-attributed="true">${esc(s.statement)}</q>`), `${name}: statement verbatim, attributed`);
      }
    }
  });

  test("three assessors who disagree all remain, each as stated, and the page neither declares disagreement nor agreement: it compares nothing", () => {
    const html = fragment("conflicting-assessors");
    for (const id of ["walletwall-rules", "issuer:circle", "reviewer-y"]) assert.ok(html.includes(`<code>${id}</code>`), id);
    for (const code of ["ESTABLISHED", "CONFIRMED", "CONFLICTING"]) assert.ok(html.includes(`>${code}<`), code);
    assert.ok(html.includes("3 assessments are recorded, each under its own policy and in its own vocabulary. WallPrint compares none of them, ranks none above another and computes no consensus."));
    // Codes from different vocabularies are never compared: no fixture is told its assessors "differ" or "agree".
    for (const name of names) {
      const t = text(fragment(name));
      assert.ok(!/assessments? (?:differ|agree)|codes agree|consensus (?!is|was)|overall verdict|majority|wins|outvote/i.test(t.replace("computes no consensus", "")), `${name}: no comparison verdict`);
      assert.ok(!/data-state="(CONSENSUS|VERDICT|OVERALL|AGREE|DIFFER)"/.test(fragment(name)), name);
    }
    assert.ok(text(fragment("receipt-valid")).includes("One assessment is recorded: WalletWall's own."));
  });

  test("absence of an assessment is not a failed assessment: NOT_AVAILABLE is shown as stated", () => {
    const html = fragment("current-supported");
    assert.ok(html.includes('<code class="wp-attributed" data-attributed="true">NOT_AVAILABLE</code>'));
    assert.ok(html.includes("Absence of an assessment is not a failed assessment."));
  });

  test("no reserved assurance term is used as a verdict, state, badge or label anywhere in any fragment", () => {
    const hints = [...Object.values(render.LIMITATION_LABELS), ...Object.values(render.SUPPORT_HINTS)].map(esc);
    for (const name of names) {
      let html = fragment(name);
      // The engine's own code names (REGISTRY_VERIFIED_POINT_IN_TIME) and its negated hint sentences are the only places the words may appear.
      html = html.replace(/<code[^>]*>[^<]*<\/code>/g, "");
      for (const h of hints) html = html.replaceAll(h, "");
      for (const term of RESERVED_ASSURANCE_TERMS) assert.ok(!new RegExp(`\\b${term.replace("-", "[- ]")}\\b`, "i").test(text(html)), `${name}: ${term} appears as prose`);
      assert.ok(!/data-state="(VERIFIED|SAFE|CERTIFIED|APPROVED|TRUSTED|SOLVENT|COMPLIANT|AUDITED)"/i.test(html), name);
      // The canvas's own lens label in the header (`ww-lens-badge`, "Observed" on The Wall) is the one pre-existing badge class.
      assert.ok(!/class="[^"]*(badge|seal|verified|certified|kpi|tile)[^"]*"/i.test(html.replaceAll('class="ww-lens-badge"', "")), `${name}: no badge or seal class`);
    }
  });

  test("an unrecognised value is never printed as a state: not in the assessment word, the chips, or the table", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["current-supported"]!);
    const r = f.records[0]!;
    const c = r.record.claims.find((x) => x.assertionId === r.record.subject.focalAssertionId)! as { supportState: string; freshnessState: string };
    c.supportState = "VERIFIED";
    c.freshnessState = "FRESH";
    (r.record.assessments.find((a) => a.assessorRole === "WALLETWALL")! as { assessment: string }).assessment = "VERIFIED";
    (r.lifecycle as { state: string }).state = "FINAL";
    (r.replay as { outcome: string }).outcome = "CORRECT";
    const html = render.renderView(view("current-supported", f));
    assert.ok(!/data-state="(VERIFIED|FRESH|FINAL|CORRECT)"/.test(html));
    assert.ok(html.includes("not recognised: VERIFIED") && html.includes("not recognised: FRESH") && html.includes("not recognised: FINAL") && html.includes("not recognised: CORRECT"));
    assert.ok(!/<span class="wp-assessment-word"/.test(html), "no display word for an unrecognised assessment");
  });
});

describe("history: corrections, supersessions and withdrawals keep every record visible, selectable and intact", () => {
  test("a corrected predecessor remains in the document, says it was corrected and by what, and can be selected", () => {
    const f = WALLPRINT_FIXTURES["corrected"]!;
    const html = fragment("corrected");
    const [v1, v2] = f.records as [DisclosureRecord, DisclosureRecord];
    const a1 = articleOf(html, v1.id);
    const a2 = articleOf(html, v2.id);
    assert.ok(/<article class="wp-record"[^>]*\shidden/.test(a1) && !/<article class="wp-record"[^>]*\shidden/.test(a2), "the focus is the correction; the predecessor stays, folded");
    assert.ok(a1.includes(`This record was <strong>corrected</strong> by <code>${v2.id}</code> (successor digest <code>${v2.record.digest}</code>)`));
    assert.ok(a1.includes("it did not rewrite or remove the record. Whether the bytes shown here are its committed bytes is checked under Verify."));
    assert.ok(a2.includes(`This record <strong>corrects</strong> <code>${v1.id}</code> and binds that record's committed digest <code>${v1.record.digest}</code>`));
    assert.ok(a2.includes(esc(v2.supersedes!.reason!)), "the correction reason is printed");
    for (const a of [a1, a2]) {
      const lineage = a.slice(a.indexOf('<ol class="wp-lineage"'), a.indexOf("</ol>", a.indexOf('<ol class="wp-lineage"')));
      assert.ok(lineage.includes(`data-wp-version="${v1.id}"`) && lineage.includes(`data-wp-version="${v2.id}"`), "both versions selectable from either article");
      assert.ok(lineage.includes("<code>CORRECTION</code>"));
      assert.ok(lineage.includes(` corrects ${v1.id}, lifecycle </span>`), "screen-reader text names the relationship");
      assert.ok(lineage.includes('<span class="chip" data-state="CORRECTED" data-attention="true">CORRECTED</span>'), "the predecessor's lifecycle is on its version control");
    }
    assert.ok(a2.includes(`data-wp-version="${v2.id}" aria-current="true"`) && !a2.includes(`data-wp-version="${v1.id}" aria-current="true"`));
    assert.ok(!/(?<!\b(?:not|never|or) )\b(deleted|deletion|removed|erased|replaced by)\b/i.test(text(a1)), "deletion words appear only negated");
    assert.ok(a1.includes(`<code class="wp-exact">${v1.record.digest}</code>`), "the predecessor keeps its own digest");
  });

  test("a superseded predecessor is accessible the same way, with the supersession kind and reason", () => {
    const f = WALLPRINT_FIXTURES["superseded"]!;
    const html = fragment("superseded");
    const [v1, v2] = f.records as [DisclosureRecord, DisclosureRecord];
    const a1 = articleOf(html, v1.id);
    assert.ok(a1.includes(`This record was <strong>superseded</strong> by <code>${v2.id}</code>`));
    assert.ok(a1.includes('data-state="SUPERSEDED" data-attention="true">SUPERSEDED</span>'));
    assert.ok(articleOf(html, v2.id).includes("<code>SUPERSESSION</code>") && html.includes(esc(v2.supersedes!.reason!)));
  });

  test("a record that is corrected, superseded or withdrawn says so in its head, beside the assessment; a current one carries no such note", () => {
    const withdrawn = articleOf(fragment("withdrawn"), focusOf("withdrawn").id);
    const head = (a: string): string => a.slice(a.indexOf('<header class="wp-head">'), a.indexOf("</header>"));
    assert.ok(head(withdrawn).includes('<p class="note wp-standing" data-attention="true">This record\'s lifecycle is <code>WITHDRAWN</code>: <span class="wp-reason-inline">'));
    assert.ok(head(withdrawn).includes("a lifecycle state is disclosure metadata and changes no evidence state"));
    const corrected = WALLPRINT_FIXTURES["corrected"]!;
    const v1 = articleOf(fragment("corrected"), corrected.records[0]!.id);
    assert.ok(head(v1).includes(`This record's lifecycle is <code>CORRECTED</code> (corrected by <code>${corrected.records[1]!.id}</code>: <span class="wp-reason-inline">${esc(corrected.records[1]!.supersedes!.reason!)}</span>)`));
    const superseded = WALLPRINT_FIXTURES["superseded"]!;
    assert.ok(head(articleOf(fragment("superseded"), superseded.records[0]!.id)).includes(`<code>SUPERSEDED</code> (superseded by <code>${superseded.records[1]!.id}</code>: <span class="wp-reason-inline">`));
    for (const name of ["current-supported", "unreplayable", "receipt-valid"]) {
      const h = head(articleOf(fragment(name), focusOf(name).id));
      assert.ok(!h.includes("wp-standing") && h.includes('<p class="wp-eyebrow">Current WalletWall assessment</p>'), `${name}: current`);
    }
    for (const a of [withdrawn, v1]) assert.ok(head(a).includes('<p class="wp-eyebrow">WalletWall assessment as recorded (not the current record)</p>') && !head(a).includes("Current WalletWall"), "a non-current record is never headed Current");
  });

  test("a lifecycle event never vouches for the disclosed bytes: the ledger says where that check lives, and the altered copy shows it", () => {
    const a = articleOf(fragment("receipt-mismatch"), focusOf("receipt-mismatch").id);
    assert.ok(a.includes("Whether the bytes disclosed here are the committed bytes is what the digest and receipt checks under Verify say."));
    assert.ok(!/Nothing inside it changed|disclosed as it was|nothing in it was changed/.test(a), "no UI-authored promise about content");
    assert.ok(a.includes('data-state="MISMATCH" data-attention="true">MISMATCH</span> <span class="wp-check-meaning">The embedded digest is not the SHA-256'));
  });

  test("a withdrawn record is still fully inspectable: assessments, digest, receipt and reason all remain", () => {
    const r = focusOf("withdrawn");
    const a = articleOf(fragment("withdrawn"), r.id);
    assert.ok(!/<article class="wp-record"[^>]*\shidden/.test(a));
    assert.ok(a.includes('<span class="chip" data-state="WITHDRAWN" data-attention="true">WITHDRAWN</span>'));
    const reason = r.lifecycle.events.find((e) => e.state === "WITHDRAWN")!.reason!;
    assert.ok(a.includes(esc(reason)));
    assert.ok(a.includes(`<code class="wp-exact">${r.record.digest}</code>`) && a.includes("<code>issuer:circle</code>") && a.includes('data-receipt="MATCH"'));
    assert.ok(a.includes("Withdrawn with a stated reason. The record stays addressable; withdrawal is not deletion."));
  });

  test("the semantic diff is grouped by the engine's categories, in its order, with before, after and reason; the raw payload is only an advanced fold", () => {
    const f = WALLPRINT_FIXTURES["corrected"]!;
    const v2 = f.records[1]!;
    const a = articleOf(fragment("corrected"), v2.id);
    const diff = a.slice(a.indexOf('<div class="wp-diff">'), a.indexOf('class="wp-verify'));
    const groups = [...diff.matchAll(/<details class="wp-diff-group wp-more" open><summary>([^<]+) /g)].map((m) => m[1]);
    const expected = DIFF_CATEGORIES.filter((c) => v2.diff!.changes.some((x) => x.category === c)).map((c) => ({ record: "Record", subject: "Subject", snapshot: "Snapshot", claims: "Claims", evidence: "Evidence", assessments: "Assessments", limitations: "Limitations", conflicts: "Conflicts", violations: "Invariant violations", policyVersions: "Policies", ruleVersions: "Rules", versions: "Versions", provenance: "Provenance", lifecycle: "Lifecycle link" })[c]);
    assert.deepEqual(groups, expected, "every category with a change, in vocabulary order");
    assert.ok(diff.includes('<th role="rowheader" scope="row"><code>claims[a-identity].supportState</code></th><td role="cell" data-label="Before"><code>PARTIAL</code></td><td role="cell" data-label="After"><code>ESTABLISHED</code></td><td role="cell" data-label="Reason"><code>STRONGER</code></td>'));
    for (const c of v2.diff!.changes) assert.ok(diff.includes(`<code>${esc(c.path)}</code>`), c.path);
    assert.ok(diff.includes("It is not a text diff."));
    assert.ok(!/<div class="wp-diff">[\s\S]*wp-raw-text/.test(diff), "no raw JSON in the diff");
    const raw = a.slice(a.indexOf('<details class="wp-more wp-raw">'));
    assert.ok(raw.includes("Raw canonical payload (advanced)") && raw.includes(`<code class="wp-raw-text">${esc(v2.canonical)}</code>`), "the raw canonical payload is an advanced disclosure, verbatim");
  });

  test("a lineage without corrections says so and offers its one version", () => {
    const r = focusOf("current-supported");
    const a = articleOf(fragment("current-supported"), r.id);
    assert.ok(a.includes("No correction or supersession is recorded for this lineage."));
    assert.equal((a.match(/data-wp-version=/g) ?? []).length, 1);
    assert.ok(!a.includes('<div class="wp-diff">'));
  });
});

describe("receipt and replay: printed with their boundary, never as a truth badge", () => {
  test("a matching receipt is MATCH with the engine's fields and the sentence of what it does not establish", () => {
    const r = focusOf("receipt-valid");
    const a = articleOf(fragment("receipt-valid"), r.id);
    const block = a.slice(a.indexOf('data-check="receipt" data-receipt="MATCH"'), a.indexOf('data-check="replay"'));
    assert.ok(block.includes('<span class="chip" data-state="MATCH">MATCH</span>'));
    assert.ok(block.includes(`<code class="wp-exact">${r.receipt.issued!.digest}</code>`) && block.includes(`<code class="wp-exact">${r.receipt.issued!.bundleDigest}</code>`));
    assert.ok(block.includes("<code>matches: true</code>"));
    assert.ok(block.includes("The disclosed canonical record matches its committed bytes.") && block.includes("A matching receipt does not establish factual truth, investment merit, solvency"));
    assert.ok(!/true|correct|accurate|safe/i.test(text(block.replace("matches: true", "").replace(/does not establish[^.]*\./, ""))), "no truth wording beside the receipt");
  });

  test("a mismatching receipt is MISMATCH with the engine's reasons explained, and the digest check shows both digests", () => {
    const r = focusOf("receipt-mismatch");
    const a = articleOf(fragment("receipt-mismatch"), r.id);
    assert.ok(a.includes('data-check="receipt" data-receipt="MISMATCH"') && a.includes('<span class="chip" data-state="MISMATCH" data-attention="true">MISMATCH</span>'));
    assert.ok(a.includes("<code>RECORD_INVALID</code>") && a.includes(esc(wp.RECEIPT_REASON_LABELS["RECORD_INVALID"]!)));
    assert.ok(a.includes(`<code class="wp-exact">${r.record.digest}</code>`) && a.includes(`<code class="wp-exact">${r.digest.computedDigest}</code>`), "embedded and computed digests both shown in full");
    assert.ok(a.includes("The embedded digest is not the SHA-256 of the disclosed canonical record."));
    assert.ok(a.includes('<span class="chip" data-state="INVALID" data-attention="true">INVALID</span>') && a.includes("<code>DIGEST_MISMATCH</code> at <code>digest</code>"));
    assert.ok(a.includes("Digest mismatch is a record-integrity finding") || a.includes("Digest match &ne; factual correctness"));
  });

  test("no receipt is UNAVAILABLE, said in words, and never shown as a failure", () => {
    const a = articleOf(fragment("unreplayable"), focusOf("unreplayable").id);
    assert.ok(a.includes('data-check="receipt" data-receipt="UNAVAILABLE"') && a.includes("No receipt is carried for this record."));
    assert.ok(!/data-state="MISMATCH"/.test(a.slice(a.indexOf('data-check="receipt"'), a.indexOf('data-check="replay"'))));
  });

  test("an absent check is absence, never a verdict: no validation result, no digest check or no receipt verification prints as not carried", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["receipt-valid"]!) as unknown as { records: Record<string, unknown>[] };
    const r = f.records[0]!;
    delete r["validation"];
    delete r["digest"];
    (r["receipt"] as { verification: unknown }).verification = null;
    const html = render.renderView(view("receipt-valid", f as unknown as DisclosureFixture));
    assert.ok(html.includes('data-check="record" data-result="NOT_CARRIED"') && html.includes('<span class="chip" data-state="NA">not carried</span> <span class="wp-check-meaning">No validation result is carried in this disclosure.'));
    assert.ok(html.includes('data-check="digest" data-result="NOT_CARRIED"') && html.includes("<dt>Computed digest</dt><dd><span class=\"muted\">not carried</span>"));
    assert.ok(html.includes('data-receipt="UNCHECKED"') && html.includes("A receipt is carried, but no verification result is available in this disclosure. No check was run here."));
    assert.ok(!/data-state="(INVALID|MISMATCH)"/.test(html) && !html.includes("matches: false"), "nothing is invented in place of the missing checks");
    const s = structuredClone(WALLPRINT_FIXTURES["current-supported"]!);
    const focal = s.records[0]!.record.claims.find((c) => c.assertionId === s.records[0]!.record.subject.focalAssertionId)! as unknown as { authority: { authorityId: string; kind: string; satisfied: unknown } };
    focal.authority = { authorityId: "issuer-publication", kind: "ISSUER_PUBLICATION", satisfied: undefined };
    const withAbsentFlag = render.renderView(view("current-supported", s));
    assert.ok(withAbsentFlag.includes("requirement not stated") && !withAbsentFlag.includes("requirement not satisfied"), "an absent boolean is not a failed requirement");
  });

  test("replay REPRODUCED, MISMATCH and UNREPLAYABLE are printed with reasons, recomputed digest and sections; missing evidence is not filled in", () => {
    const ok = articleOf(fragment("receipt-valid"), focusOf("receipt-valid").id);
    assert.ok(ok.includes('data-check="replay" data-replay="REPRODUCED"') && ok.includes(`<code class="wp-exact">${focusOf("receipt-valid").replay.recomputedDigest}</code>`));

    const mm = focusOf("replay-mismatch");
    const m = articleOf(fragment("replay-mismatch"), mm.id);
    assert.ok(m.includes('data-check="replay" data-replay="MISMATCH"') && m.includes('<span class="chip" data-state="MISMATCH" data-attention="true">MISMATCH</span>'));
    assert.ok(m.includes("<code>CLAIM_MISMATCH</code>") && m.includes(esc(wp.REPLAY_REASON_LABELS["CLAIM_MISMATCH"]!)) && m.includes("<dt>Sections that differ</dt><dd><code>claims</code></dd>"));
    assert.ok(m.includes(`<code class="wp-exact">${mm.replay.recomputedDigest}</code>`));
    assert.ok(m.includes('data-receipt="MATCH"'), "a matching receipt sits beside a replay mismatch: integrity is not correctness");

    const un = articleOf(fragment("unreplayable"), focusOf("unreplayable").id);
    assert.ok(un.includes('data-check="replay" data-replay="UNREPLAYABLE"') && un.includes("<code>MISSING_EVIDENCE</code>"));
    assert.ok(un.includes("The referenced evidence bundle is not in the evidence store. It is not filled in."));
    assert.ok(un.includes("<dd><span class=\"muted\">nothing was recomputed</span></dd>"));
    assert.ok(un.includes("<strong>UNREPLAYABLE is not INCORRECT.</strong>"));
    const replayBlock = un.slice(un.indexOf('data-check="replay"'), un.indexOf("</ol>", un.indexOf('data-check="replay"')));
    assert.ok(!/(?<!not )\bincorrect\b|\bwrong\b|\bfalse\b/i.test(text(replayBlock)), "nothing calls the record incorrect");
    for (const h of ["0".repeat(64), "null"]) assert.ok(!un.includes(`<code class="wp-exact">${h}</code>`), "no placeholder digest is invented");
  });
});

describe("provenance: the record's own lineage, incomplete stages shown as such", () => {
  test("five stages in order, sources referenced by digest only, observations and assertions from the traced lineage, derivations from the evidence references", () => {
    for (const name of names) {
      const r = focusOf(name);
      const a = articleOf(fragment(name), r.id);
      const chain = a.slice(a.indexOf('<ol class="wp-chain"'), a.indexOf("</ol>", a.indexOf('<ol class="wp-chain"')));
      const stages = [...chain.matchAll(/data-stage="([a-z]+)" data-present="(true|false)"/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(stages.map((s) => s[0]), ["source", "observation", "assertion", "derivation", "assessment"], name);
      const items = r.record.evidence.items;
      assert.equal(stages[0]![1], String(items.some((i) => i.kind === "SOURCE")), `${name}: sources`);
      assert.equal(stages[3]![1], String(items.some((i) => i.kind === "DERIVATION")), `${name}: derivations`);
      for (const l of r.record.provenance.lineage) assert.ok(chain.includes(`<code>${l.id}</code>`), `${name}: lineage ${l.id}`);
      assert.ok(chain.includes(`<code>${r.record.subject.focalAssertionId}</code> <span class="muted small">focal claim</span>`), name);
      if (!items.some((i) => i.kind === "DERIVATION")) assert.ok(/data-stage="derivation" data-present="false">[\s\S]*?none in this record/.test(chain), `${name}: an absent stage is said, not drawn`);
      assert.ok(chain.includes("Which source reported which observation stays in the evidence bundle, not in the record."), name);
      assert.ok(chain.includes(", then </span>"), `${name}: screen-reader connective`);
    }
  });

  test("the readiness record shows its derivation and the nested assertions at their depths", () => {
    const r = focusOf("receipt-valid");
    const a = articleOf(fragment("receipt-valid"), r.id);
    const derivations = r.record.evidence.items.filter((i) => i.kind === "DERIVATION").map((i) => i.id);
    assert.ok(derivations.length >= 1);
    const stage = /<li class="wp-stage" data-stage="derivation" data-present="true">[\s\S]*?<\/ul>/.exec(a)?.[0] ?? "";
    for (const id of derivations) assert.ok(stage.includes(`<code>${id}</code> <span class="muted small">referenced by digest</span>`), id);
    assert.ok(a.includes("<code>a-identity</code> <span class=\"muted small\">depth 1</span>") && a.includes("<code>obs-identity</code> <span class=\"muted small\">depth 2</span>"));
  });

  test("a provenance issue is reported as incomplete, never patched", () => {
    const f = structuredClone(WALLPRINT_FIXTURES["current-supported"]!);
    (f.records[0]!.record.provenance as { issues: { code: string; id: string | null }[] }).issues = [{ code: "DANGLING_REFERENCE", id: "obs-missing" }];
    const html = render.renderView(view("current-supported", f));
    assert.ok(html.includes("Provenance is incomplete:") && html.includes("<code>DANGLING_REFERENCE</code> <code>obs-missing</code>"));
  });
});

describe("safety and accessibility of the markup", () => {
  test("hostile text in every slot is escaped: no element but the document's own, no attribute injection", () => {
    const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>"'&`;
    const f = structuredClone(WALLPRINT_FIXTURES["corrected"]!) as unknown as { title: string; focus: string; registry: Record<string, unknown>; records: Record<string, unknown>[] };
    const poison = (v: unknown): unknown => (typeof v === "string" ? `${v}${evil}` : Array.isArray(v) ? v.map(poison) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, poison(x)])) : v);
    const poisoned = poison(f) as DisclosureFixture;
    const html = render.renderView({ status: "wallprint", source: evil, fixture: evil, disclosure: poisoned, vocabulary: poison(WALLPRINT_VOCABULARY) });
    const allowed = new Set(["h1", "h2", "h3", "h4", "p", "code", "strong", "span", "div", "dl", "dt", "dd", "ul", "ol", "li", "button", "section", "article", "header", "nav", "details", "summary", "table", "thead", "tbody", "tr", "th", "td", "svg", "circle", "path", "time", "q", "br"]);
    for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) assert.ok(allowed.has(m[1] as string), `unexpected element <${m[1]}>`);
    assert.ok(!/<img|<script/.test(html));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!/(data-[a-z-]+|aria-[a-z]+|id|class|datetime|href|style)="[^"]*<[^"]*"/.test(html), "no attribute carries raw markup");
    assert.ok(!/ style=/.test(html), "no inline style attribute (the page's CSP forbids it)");
  });

  test("headings are nested without skipping, tables carry explicit roles and scopes, timestamps are time elements, controls are real buttons", () => {
    for (const name of names) {
      const html = fragment(name);
      const levels = [...html.matchAll(/<h([1-4])\b/g)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i++) assert.ok(levels[i]! <= levels[i - 1]! + 1, `${name}: heading levels do not skip (h${levels[i - 1]} to h${levels[i]})`);
      assert.ok(levels[0] === 1 && levels.filter((l) => l === 1).length === 1, `${name}: one h1`);
      for (const t of html.matchAll(/<table\b[^>]*>/g)) assert.ok(/role="table" aria-label="[^"]+"/.test(t[0]), `${name}: table has role and name`);
      for (const th of html.matchAll(/<th\b[^>]*>/g)) assert.ok(/role="(columnheader|rowheader)" scope="(col|row)"/.test(th[0]), `${name}: ${th[0]}`);
      for (const td of html.matchAll(/<td\b[^>]*>/g)) assert.ok(/role="cell"/.test(td[0]), `${name}: ${td[0]}`);
      // Outside code spans (exact values and the raw payload), every instant is the datetime of a time element.
      const prose = html.replace(/<code[^>]*>[^<]*<\/code>/g, "");
      for (const m of prose.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)) {
        assert.ok(prose.slice(Math.max(0, m.index - 16), m.index).endsWith('<time datetime="'), `${name}: instant ${m[0]} is a time element`);
      }
      for (const b of html.matchAll(/<button\b[^>]*>/g)) assert.ok(b[0].includes('type="button"'), `${name}: ${b[0]}`);
      assert.ok(!/tabindex="[1-9]/.test(html), `${name}: no positive tabindex`);
      assert.ok(!/<a\b/.test(html), `${name}: no links out of the document`);
      for (const b of html.matchAll(/<button[^>]*data-wp-copy[^>]*>/g)) assert.match(b[0], /aria-label="Copy the full [^"]+"/, `${name}: copy control is named`);
    }
  });

  test("every state is carried by words, never by colour alone: each state chip and the assessment word print their value", () => {
    for (const name of names) {
      const html = fragment(name);
      for (const m of html.matchAll(/<span class="chip"([^>]*)>([^<]*)<\/span>/g)) assert.ok((m[2] as string).trim().length > 0, `${name}: empty chip ${m[1]}`);
      for (const m of html.matchAll(/<span class="wp-assessment-word" data-state="([^"]+)"[^>]*>([^<]*)<\/span>/g)) assert.equal(m[2], m[1], name);
      for (const m of html.matchAll(/<li class="wp-ledger-row" data-reached="(true|false)"[^>]*>/g)) assert.ok(m[0].length > 0);
      assert.ok(!/data-reached="true"[^<]*<span class="wp-dot" aria-hidden="true">○/.test(html) && !/data-reached="false"[^<]*<span class="wp-dot" aria-hidden="true">●/.test(html), `${name}: dots agree with the words`);
    }
  });

  test("the subject identity is printed as recorded, addresses in full with the canvas's copy controls and chain context", () => {
    const r = focusOf("conflicting-evidence");
    const a = articleOf(fragment("conflicting-evidence"), r.id);
    const id = r.record.subject.identity as Record<string, string>;
    for (const [k, v] of Object.entries(id)) {
      if (/^0x[0-9a-fA-F]{40}$/.test(v)) assert.ok(a.includes(`<code class="addr-full">${v}</code><span class="addr-ctx muted small">chain ID ${id["chainId"]}</span><button type="button" class="copy" data-copy-address aria-label="Copy the full ${k} value (chain ID ${id["chainId"]})">Copy</button>`), k);
      else assert.ok(a.includes(`<dt>${k}</dt><dd><code>${v}</code></dd>`), k);
    }
    assert.ok(a.includes("Subject identity, as recorded"));
  });

  test("the limitation vocabulary the document can describe is the engine's whole list", () => {
    assert.deepEqual(Object.keys(render.LIMITATION_LABELS).sort(), [...LIMITATION_CODES].sort());
  });
});
