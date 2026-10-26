import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalize } from "../../src/canonical.ts";
import { PUBLICATION_STATEMENT } from "../../src/wallprint/publication-vocabulary.ts";
import { buildPublicDisclosure } from "../../src/wallprint/publication.ts";
import { encodeReference, referenceOf, toHttpsUrl, toResolverPath, type ReferenceTarget } from "../../src/wallprint/reference.ts";
import { publicView } from "../../../wallprint-web/lib/view.ts";
import { resolvePublic, type PublicResolution } from "../../../wallprint-web/lib/resolve.ts";
import { exportOf, FIXTURES, memoryStore, PUBLISHED_AT, publishedExports } from "../../../wallprint-web/test/support/store.ts";
import { ROOT } from "../support/harness.ts";
import { decodeQrMatrix } from "../support/qr-decoder.ts";

/**
 * The public page is the same WallPrint instrument in PUBLIC MODE: the canvas renderer with a `publication` block. It
 * prints the publication line instead of the fixture line, the boundary statement, the record's standing, same-origin
 * links to a predecessor or successor built only from validated ids and digests, and the HTTPS form of the reference in
 * the QR code when a resolver base is known. Every other outcome is an outcome page that renders no record content.
 * The canvas itself never enters public mode, so its fragments stay link-free.
 */

const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface RenderMod {
  renderView: (view: unknown) => string;
  LIMITATION_LABELS: Record<string, string>;
  SUPPORT_HINTS: Record<string, string>;
  FRESHNESS_HINTS: Record<string, string>;
  FINALITY_HINTS: Record<string, string>;
}
interface QrMod {
  encodeQr: (text: string) => { modules: ArrayLike<number>; size: number };
  qrPathData: (code: { modules: ArrayLike<number>; size: number }) => { extent: number; d: string };
}
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as RenderMod;
const qr = (await import(pathToFileURL(`${EXT}/wallprint-qr.mjs`).href)) as QrMod;
const { WALLPRINT_VOCABULARY } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_VOCABULARY: unknown };

const BASE = ["https:", "//", "walletwall.org"].join("");
const first = publishedExports()[0]!;
const refOf = (e = first, target: ReferenceTarget | null = null) => referenceOf({ id: e.id, digest: e.record.digest, wallprintVersion: e.record.wallprintVersion }, target);
const resolved = async (e = first, target: ReferenceTarget | null = null): Promise<PublicResolution> => resolvePublic(toResolverPath(refOf(e, target)), memoryStore());
const html = (r: PublicResolution, base: string | null = BASE): string => render.renderView(publicView(r, base, WALLPRINT_VOCABULARY));
const text = (h: string): string => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const unescape = (s: string): string => s.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const portableOf = (h: string): string => {
  const start = h.indexOf('<div class="wp-portable"');
  assert.ok(start >= 0, "a portable block");
  return h.slice(start, h.indexOf('<div class="wp-derivation">', start));
};
const qrText = (block: string): string => {
  const m = /<svg class="wp-qr-code" viewBox="0 0 (\d+) \d+"[^>]*data-qr-modules="(\d+)"[^>]*><rect[^>]*\/><path class="wp-qr-dark" d="([^"]*)"\/><\/svg>/.exec(block);
  assert.ok(m, "a QR code");
  // The drawn path is deterministic for the text; find the text by re-encoding the candidates the block prints.
  const candidates = [...block.matchAll(/<code class="wp-exact"[^>]*>([^<]*)<\/code>/g)].map((x) => unescape(x[1]!));
  for (const c of candidates) {
    const code = qr.encodeQr(c);
    if (qr.qrPathData(code).d === m[3]) {
      assert.equal(decodeQrMatrix(code.modules, code.size).text, c);
      return c;
    }
  }
  assert.fail("the QR code draws none of the printed texts");
};
/** The canvas design guard's list for WalletWall-authored prose; "absence of fraud" is the engine's own negated non-claim and stays. */
const BAD_WORDS = /\b(authentic\w*|certif\w*|trust\w*|guarantee\w*|100 ?%|seal|badge|shield|tamper\w*|verified|genuine|forged|fake|malicious|proves)\b/i;
const HREF_RE = /href="([^"]*)"/g;
const hrefs = (h: string): string[] => [...h.matchAll(HREF_RE)].map((m) => unescape(m[1]!));

describe("RESOLVED in public mode: the same disclosure document, published", () => {
  test("the document is marked public, carries the publication line with id, digest and instant, the boundary statement once, and no fixture notice", async () => {
    const h = html(await resolved());
    assert.ok(h.includes('data-wp-public="true"'));
    const line = /<p class="wp-fixture muted small wp-publication">([\s\S]*?)<\/p>/.exec(h);
    assert.ok(line, "the publication line");
    assert.ok(line[1]!.includes("Published WallPrint disclosure") && line[1]!.includes(`<code class="wp-exact">${first.id}</code>`) && line[1]!.includes(`<code class="wp-exact">${first.record.digest}</code>`) && line[1]!.includes(`<time datetime="${PUBLISHED_AT}">`), line[1]);
    assert.equal(h.split(PUBLICATION_STATEMENT).length - 1, 1, "the statement appears exactly once");
    assert.ok(/<p class="wp-boundary wp-publication-statement">/.test(h));
    assert.ok(!h.includes("Synthetic fixture") && !h.includes("Source: <code>"), "no fixture notice, no source code");
    assert.equal((h.match(/<article class="wp-record"/g) ?? []).length, 1);
    assert.ok(!/<article class="wp-record"[^>]*\shidden/.test(h), "the one record is shown");
    assert.ok(h.includes(`<h1>WalletWall</h1><span class="ww-lens-badge" title="A published WallPrint disclosure record">WallPrint</span>`));
  });

  test("a synthetic disclosure says so on its publication line, with the construction as the artifact declares it", async () => {
    const h = html(await resolved());
    assert.ok(/<span class="wp-scenario" data-scenario="ENGINE_BUILT">Synthetic disclosure: every record of this lineage was built by the engine from its synthetic evidence\.<\/span>/.test(h), h.slice(h.indexOf("wp-publication"), h.indexOf("wp-publication") + 900));
    const elsewhere = exportOf(FIXTURES["replay-mismatch"]!, FIXTURES["replay-mismatch"]!.records[0]!);
    const h2 = html(await resolved(elsewhere));
    assert.ok(h2.includes('data-scenario="COMMITTED_ELSEWHERE"') && h2.includes("(changed: <code>claims[a-price].supportState</code>)"));
  });

  test("the readout says it was resolved from a public URL and what that establishes, with every digest this page compared", async () => {
    const h = html(await resolved(first, "receipt"));
    const readout = h.slice(h.indexOf('<div class="wp-reference-result'), h.indexOf("<article"));
    assert.ok(readout.includes('data-outcome="RESOLVED"') && readout.includes('role="status"'));
    assert.ok(readout.includes('<p class="wp-eyebrow">Resolved from a public URL</p>'));
    assert.ok(readout.includes("the SHA-256 this page computed over its canonical bytes"), readout);
    assert.ok(!readout.includes("the digest the engine recorded"), "a public page does not claim the engine computed anything here");
    assert.ok(readout.includes(`<code class="wp-exact">${first.record.digest}</code>`));
    assert.ok(text(readout).includes("Section Receipt"));
    assert.ok(h.includes('data-wp-open="receipt"'), "the requested section is opened through the client's allow-listed focus");
  });

  test("standing is printed as the index says it, labelled as standing, beside the record", async () => {
    const corrected = FIXTURES["corrected"]!;
    const old = exportOf(corrected, corrected.records[0]!);
    const h = html(await resolved(old));
    const standing = /<section class="wp-standing-now[^"]*"[\s\S]*?<\/section>/.exec(h);
    assert.ok(standing, "a standing section");
    assert.ok(standing[0].includes("Standing in the public store") && standing[0].includes('data-state="CORRECTED"') && standing[0].includes(`<code class="wp-exact">${corrected.records[1]!.id}</code>`));
    assert.ok(standing[0].includes("as the public store&#39;s index records it") && standing[0].includes("changes nothing in the record"));
    assert.ok(text(standing[0]).includes(`published ${PUBLISHED_AT}`) || standing[0].includes(`<time datetime="${PUBLISHED_AT}">`));
  });
});

describe("links in public mode: same-origin, built only from validated ids and digests, never a redirect", () => {
  test("a corrected predecessor links to its successor and the successor links back; no other link exists in the document", async () => {
    const corrected = FIXTURES["corrected"]!;
    const v1 = exportOf(corrected, corrected.records[0]!);
    const v2 = exportOf(corrected, corrected.records[1]!);
    const h1 = html(await resolved(v1));
    const h2 = html(await resolved(v2));
    assert.deepEqual(hrefs(h1), [toResolverPath(refOf(v2))], "v1 links only to v2");
    assert.deepEqual(hrefs(h2), [toResolverPath(refOf(v1))], "v2 links only to v1");
    for (const href of [...hrefs(h1), ...hrefs(h2)]) assert.match(href, /^\/wallprint\/[a-z0-9][a-z0-9_-]{2,63}\?reference=0\.1&wallprint=0\.1&digest=[0-9a-f]{64}$/);
    assert.ok(/<a class="[^"]*wp-lineage-link[^"]*" href="/.test(h1) && !h1.includes("data-wp-version="), "lineage nodes are links or text in public mode, never version toggles");
    assert.ok(!/<a [^>]*(target=|rel=|onclick|javascript:)/.test(h1 + h2));
  });

  test("a root record without a successor carries no link at all, and a withdrawn record stays its own page", async () => {
    assert.deepEqual(hrefs(html(await resolved())), []);
    const withdrawn = FIXTURES["withdrawn"]!;
    const h = html(await resolved(exportOf(withdrawn, withdrawn.records[0]!)));
    assert.deepEqual(hrefs(h), []);
    assert.ok(h.includes('data-state="WITHDRAWN"'));
  });
});

describe("the portable block in public mode: the HTTPS form in the code, the canonical reference beside it", () => {
  test("with a resolver base the QR code encodes the HTTPS URL; the URL and the walletwall: reference are both printed exactly with copy controls", async () => {
    const h = html(await resolved());
    const block = portableOf(h);
    const url = toHttpsUrl(refOf(), BASE);
    assert.equal(qrText(block), url);
    assert.ok(block.includes('data-wp-reference-form="https"'));
    assert.ok(block.includes(`<code class="wp-exact" id="wp-pu-${first.id}">${url.replaceAll("&", "&amp;")}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full public URL">Copy URL</button>`), block);
    assert.ok(block.includes(`<code class="wp-exact" id="wp-pr-${first.id}">${encodeReference(refOf()).replaceAll("&", "&amp;")}</code><button type="button" class="copy" data-wp-copy aria-label="Copy the full portable reference">Copy reference</button>`));
    assert.ok(block.includes("The code encodes the public URL of this record: the same reference under WalletWall&#39;s public resolver"), block);
    assert.ok(block.includes("<strong>A reference is a locator, not authority.</strong>") && block.includes("The URL is a representation of the reference, not a second identity"));
    assert.ok(!block.includes("No public resolver exists"));
    assert.equal(h.split(BASE).length - 1, (block.match(new RegExp(BASE.replaceAll(".", "\\."), "g")) ?? []).length, "the base appears only inside the portable block");
  });

  test("without a resolver base the QR code encodes the walletwall: reference and no URL is printed", async () => {
    const h = html(await resolved(), null);
    const block = portableOf(h);
    assert.equal(qrText(block), encodeReference(refOf()));
    assert.ok(block.includes('data-wp-reference-form="reference"'));
    assert.ok(!block.includes("Copy URL") && !/https?:\/\//.test(block));
  });

  test("the HTTPS form of every published record round-trips through the drawn code", async () => {
    for (const e of publishedExports()) {
      const block = portableOf(html(await resolved(e)));
      assert.equal(qrText(block), toHttpsUrl(refOf(e), BASE), e.id);
    }
  });
});

describe("outcome pages in public mode: no record content, the boundary statement, words never verdicts", () => {
  const outcomePage = async (path: string, mutate: (s: ReturnType<typeof memoryStore>) => void = () => {}): Promise<[PublicResolution, string]> => {
    const store = memoryStore();
    mutate(store);
    const r = await resolvePublic(path, store);
    return [r, html(r)];
  };
  const artifactPath = `/wallprint/records/${first.id}/${first.record.digest}.json`;

  test("UNAVAILABLE is Record unavailable: the id and digest as written, the statement, no record, never invalid", async () => {
    const [r, h] = await outcomePage(toResolverPath(refOf({ ...first, id: "wp-not-published-v1" })));
    assert.equal(r.outcome, "UNAVAILABLE");
    assert.ok(h.includes('data-wp-reference-outcome="UNAVAILABLE"') && h.includes("<h2 class=\"wp-title\">Record unavailable</h2>"));
    assert.ok(h.includes('<code class="wp-exact">wp-not-published-v1</code>') && h.includes(PUBLICATION_STATEMENT));
    // "Unavailable is not invalid" is the one, negated, use of the word: the outcome is never told AS invalid.
    assert.ok(!h.includes("<article") && !/invalid|untrusted|false/i.test(text(h).replace(/not invalid/g, "")));
    assert.deepEqual(hrefs(h), []);
    assert.ok(h.includes("This resolver serves published WallPrint disclosures; the record this URL names is not published here."));
  });

  test("DIGEST_MISMATCH against the store: every digest printed, the published version offered as an explicit link, nothing decided, no record", async () => {
    const other = "1".repeat(64);
    const [r, h] = await outcomePage(toResolverPath(refOf({ ...first, record: { ...first.record, digest: other } })));
    assert.equal(r.outcome, "DIGEST_MISMATCH");
    assert.ok(h.includes('data-wp-reference-outcome="DIGEST_MISMATCH"') && h.includes('<h2 class="wp-title">Digest mismatch</h2>') && h.includes('role="alert"'));
    assert.ok(h.includes(`<code class="wp-exact">${other}</code>`) && h.includes(`<code class="wp-exact">${first.record.digest}</code>`));
    assert.ok(text(h).includes("Digest carried by the URL") && text(h).includes("Digest the published artifact carries") && text(h).includes("Digest this page computed"));
    assert.ok(h.includes("Nothing here decides which bytes are the committed ones"));
    assert.deepEqual(hrefs(h), [toResolverPath(refOf())], "one explicit link to the published version, no redirect");
    assert.ok(h.includes("Open the published version") && h.includes(`<time datetime="${PUBLISHED_AT}">`));
    assert.ok(!h.includes("<article") && !h.includes('"canonical"') && !text(h).includes("Assessments"));
  });

  test("DIGEST_MISMATCH because the artifact failed its own check: flagged, no link, nothing shown from it", async () => {
    const { artifact } = buildPublicDisclosure(first);
    const [r, h] = await outcomePage(toResolverPath(refOf()), (s) => s.set(artifactPath, canonicalize({ ...artifact, canonical: artifact.canonical.replace('"snapshotAt":"2026', '"snapshotAt":"2025') })));
    assert.equal(r.outcome, "DIGEST_MISMATCH");
    assert.ok(h.includes("The published artifact does not digest to the digest it carries: the store&#39;s copy failed its own check. Nothing from it is shown."), h);
    assert.deepEqual(hrefs(h), []);
    assert.ok(!h.includes("<article"));
  });

  test("NOT_COMPARED: the artifact is not a disclosure this page reads; the code is named and nothing is compared", async () => {
    const [r, h] = await outcomePage(toResolverPath(refOf()), (s) => s.set(artifactPath, "{not json"));
    assert.equal(r.outcome, "NOT_COMPARED");
    assert.ok(h.includes('data-wp-reference-outcome="NOT_COMPARED"') && h.includes('<h2 class="wp-title">Not compared</h2>'));
    assert.ok(h.includes("<code>MALFORMED</code>") && text(h).includes("nothing was compared"));
    assert.ok(!h.includes("<article") && h.includes('role="status"'));
  });

  test("UNREACHABLE: the store could not be read; nothing is said about the record and it is not told as unavailable", async () => {
    const [r, h] = await outcomePage(toResolverPath(refOf()), (s) => {
      s.offline = true;
    });
    assert.equal(r.outcome, "UNREACHABLE");
    assert.ok(h.includes('data-wp-reference-outcome="UNREACHABLE"') && h.includes('<h2 class="wp-title">Store unreachable</h2>'));
    assert.ok(h.includes("<code>NETWORK</code>") && h.includes("Nothing is said about the record"));
    assert.ok(!/unavailable|invalid|mismatch/i.test(text(h).replace("Store unreachable", "")), text(h));
    assert.ok(h.includes('role="status"') && !h.includes("<article"));
  });

  test("MALFORMED_REFERENCE and UNSUPPORTED_VERSION: the fixed problem code, never a byte of the URL", async () => {
    const hostile = `/wallprint/${"<script>alert(1)</script>"}?reference=0.1`;
    const [r, h] = await outcomePage(hostile);
    assert.equal(r.outcome, "MALFORMED_REFERENCE");
    assert.ok(h.includes('data-wp-reference-outcome="MALFORMED_REFERENCE"') && h.includes('<h2 class="wp-title">Malformed reference</h2>') && h.includes("<code>characters</code>"));
    assert.ok(!h.includes("alert(1)") && !h.includes("script>") && !h.includes("&lt;script"), "no byte of the hostile path, escaped or not");
    const [r2, h2] = await outcomePage(toResolverPath(refOf()).replace("reference=0.1", "reference=0.2"));
    assert.equal(r2.outcome, "UNSUPPORTED_VERSION");
    assert.ok(h2.includes('<h2 class="wp-title">Unsupported version</h2>') && h2.includes("<code>reference</code>"));
    assert.ok(!h2.includes(first.id) && !h2.includes(first.record.digest), "never echoed");
  });

  test("every outcome page and the resolved document use no assurance word, no inline style, no script and no external link", async () => {
    const pages = [
      html(await resolved()),
      (await outcomePage(toResolverPath(refOf({ ...first, id: "wp-none-v1" }))))[1],
      (await outcomePage(toResolverPath(refOf({ ...first, record: { ...first.record, digest: "2".repeat(64) } }))))[1],
      (await outcomePage("/wallprint/"))[1],
    ];
    // As the canvas's own design guard does: exact values, attributed statements and the canvas's negated hint texts are
    // not WalletWall-authored prose of this page.
    const hints = [...Object.values(render.SUPPORT_HINTS), ...Object.values(render.FRESHNESS_HINTS), ...Object.values(render.FINALITY_HINTS), ...Object.values(render.LIMITATION_LABELS)].map((s) => s.replaceAll("&", "&amp;").replaceAll("'", "&#39;"));
    for (const h of pages) {
      let prose = h.replace(/<code[^>]*>[^<]*<\/code>/g, "").replace(/<(q|code) class="wp-attributed" data-attributed="true">[^<]*<\/\1>/g, "");
      for (const hint of hints) prose = prose.replaceAll(hint, "");
      assert.ok(!BAD_WORDS.test(text(prose).replaceAll("not authority", "")), BAD_WORDS.exec(text(prose))?.[0]);
      assert.ok(!/ style="|<script|javascript:|srcdoc=|<iframe|<form|<input/.test(h));
      for (const href of hrefs(h)) assert.ok(href.startsWith("/wallprint/") && !/\/\/|:/.test(href.slice(0, 11)), href);
      assert.ok(h.includes(PUBLICATION_STATEMENT));
    }
  });
});

describe("what the digest covers, said where it matters: the readout, the derivation and the foot", () => {
  test("the RESOLVED readout says the URL's digest covers the record and not the results carried beside it, and that nothing signs the standing", async () => {
    const h = html(await resolved());
    const readout = h.slice(h.indexOf('<div class="wp-reference-result'), h.indexOf("<article"));
    assert.ok(readout.includes("The URL&#39;s digest covers the record&#39;s canonical bytes. The title, the registry names and the engine&#39;s receipt, replay and diff results are carried beside the record in the published artifact as they were recorded at publication: the digest does not cover them, and this page checks only that they are consistent with the record."), readout);
    assert.ok(readout.includes("The standing beside the record is the store&#39;s index, checked against its own hash-chained ledger and the digest this page computed; nothing signs it."));
  });

  test("in public mode the derivation and the foot say what this page computed and what it carries; the canvas keeps its own words", async () => {
    const h = html(await resolved());
    assert.ok(h.includes("Every value in this section is the engine&#39;s, as published; the SHA-256 this page computed over the canonical bytes is in the readout at the top."));
    assert.ok(!h.includes("Every value is the engine's; nothing is recomputed here."));
    assert.ok(h.includes("This page renders a published WallPrint record and the engine&#39;s receipt, replay and diff results carried with it. It decides no state, no authority, no verdict."));
    assert.ok(!h.includes("This page renders the canonical WallPrint record"));
    const canvas = render.renderView({ status: "wallprint", source: "wallprint:current-supported", fixture: "current-supported", disclosure: FIXTURES["current-supported"], vocabulary: WALLPRINT_VOCABULARY });
    assert.ok(canvas.includes("Every value is the engine's; nothing is recomputed here.") && canvas.includes("This page renders the canonical WallPrint record and the engine's receipt, replay and diff results for it."));
  });
});

describe("a copy served from another origin says so, without naming that origin", () => {
  const MIRROR_NOTICE = "This copy of the page is not served from the resolver base its share URL and code name";
  test("RESOLVED and outcome pages carry the notice when the serving origin differs from the resolver base, and never print the serving origin", async () => {
    const elsewhere = ["http:", "//", "127.0.0.1:4177"].join("");
    const resolvedHtml = render.renderView(publicView(await resolved(), BASE, WALLPRINT_VOCABULARY, { servedFrom: elsewhere }));
    assert.ok(resolvedHtml.includes(MIRROR_NOTICE) && resolvedHtml.includes(`<code>${BASE}</code>`));
    assert.ok(!resolvedHtml.includes("127.0.0.1"));
    const unavailable = await resolvePublic(toResolverPath(refOf({ ...first, id: "wp-none-v1" })), memoryStore());
    const outcomeHtml = render.renderView(publicView(unavailable, BASE, WALLPRINT_VOCABULARY, { servedFrom: elsewhere }));
    assert.ok(outcomeHtml.includes(MIRROR_NOTICE) && !outcomeHtml.includes("127.0.0.1"));
  });

  test("served from the resolver base, or with no base or origin known, there is no notice", async () => {
    const r = await resolved();
    assert.ok(!render.renderView(publicView(r, BASE, WALLPRINT_VOCABULARY, { servedFrom: BASE })).includes(MIRROR_NOTICE));
    assert.ok(!render.renderView(publicView(r, BASE, WALLPRINT_VOCABULARY)).includes(MIRROR_NOTICE));
    assert.ok(!render.renderView(publicView(r, null, WALLPRINT_VOCABULARY, { servedFrom: BASE })).includes(MIRROR_NOTICE));
  });
});

describe("the bare route is a landing, not an error", () => {
  test("/wallprint with no record says what the resolver is and that this address names no record; nothing is resolved", async () => {
    const r = await resolvePublic("/wallprint", memoryStore());
    assert.equal(r.outcome, "MALFORMED_REFERENCE");
    const h = render.renderView(publicView(r, BASE, WALLPRINT_VOCABULARY, { landing: true }));
    assert.ok(h.includes('<h2 class="wp-title">WallPrint public resolver</h2>') && h.includes('data-wp-landing="true"'));
    assert.ok(h.includes("This address names no record, so nothing was resolved."));
    assert.ok(h.includes("/wallprint/&lt;record id&gt;?reference=0.1&amp;wallprint=0.1&amp;digest=&lt;64 hexadecimal characters&gt;"));
    assert.ok(!h.includes("Malformed reference") && !h.includes('role="alert"') && !h.includes("<article"));
    assert.ok(h.includes(PUBLICATION_STATEMENT));
  });
});

describe("published-version links on a mismatch are re-checked by the renderer, whatever the view carries", () => {
  test("a missing, foreign or other-record path is never emitted; a valid same-record path is", async () => {
    const other = "1".repeat(64);
    const r = await resolvePublic(toResolverPath(refOf({ ...first, record: { ...first.record, digest: other } })), memoryStore());
    assert.equal(r.outcome, "DIGEST_MISMATCH");
    const view = publicView(r, BASE, WALLPRINT_VOCABULARY) as { publication: { published: { digest: string; publishedAt: string; path: string | null }[] } };
    const good = view.publication.published[0]!;
    view.publication.published = [
      { ...good, path: null },
      { ...good, path: ["https:", "//", "evil.example/x"].join("") },
      { ...good, path: "javascript:alert(1)" },
      { ...good, path: toResolverPath(refOf({ ...first, id: "wp-other-v1" })) },
      { ...good, path: `${good.path}&target=receipt"><script>` },
      good,
    ];
    const h = render.renderView(view);
    assert.deepEqual(hrefs(h), [good.path]);
    assert.ok(!h.includes('href=""') && !h.includes("evil.example") && !h.includes("javascript:"));
  });
});

describe("the canvas stays the canvas: no public mode, no link, the truthful boundary sentence", () => {
  test("a canvas fragment carries no link and its portable block says what the code encodes and where a reference opens", () => {
    const view = { status: "wallprint", source: "wallprint:current-supported", fixture: "current-supported", disclosure: FIXTURES["current-supported"], vocabulary: WALLPRINT_VOCABULARY };
    const h = render.renderView(view);
    assert.ok(!/<a\b/.test(h) && !h.includes('data-wp-public') && !h.includes(PUBLICATION_STATEMENT));
    const block = portableOf(h);
    assert.ok(block.includes("The code encodes the <code>walletwall:</code> reference itself, not a web address"), block);
    assert.ok(block.includes("such as this panel&#39;s bundled lineages or WalletWall&#39;s public resolver for published disclosures, which serves the same reference under an HTTPS form"));
    assert.ok(!block.includes("No public resolver exists") && !/https?:\/\//.test(block));
    assert.ok(block.includes('data-wp-reference-form="reference"'));
  });
});
