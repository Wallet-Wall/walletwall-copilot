import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { ENTRIES, ROOT } from "../support/harness.ts";
import type { DisclosureFixture } from "../support/wallprint-disclosures.ts";

/**
 * The WallPrint view inside the canvas: opened with `{ wallprint }`, it shows a serialized disclosure lineage over the
 * same loopback listener, the same four routes and the same page, evaluates nothing, carries no assertion selection,
 * and leaves the evidence view untouched. The page script's local version switch and exact-value copy are exercised in
 * a stand-in DOM with no storage.
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Summary {
  status: string;
  error?: { code: string; message: string };
  fixture?: string;
  recordId?: string | null;
  lifecycle?: string | null;
  assessments?: { assessor: string; assessment: string }[];
  receipt?: { issued: boolean; matches: boolean | null; reasons: string[] } | null;
  replay?: { outcome: string; reasons: string[]; mismatches: string[] } | null;
  selectedAssertionId?: string | null;
  lineage?: { chain: string[] } | null;
}
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string; title: string; status: string }>;
  setInput: (id: string, input: unknown) => Promise<Summary>;
  select: (id: string, assertionId: string) => Promise<Summary>;
  view: (id: string) => Summary;
  canvasView: (id: string) => { status: string; fixture?: string; disclosure?: DisclosureFixture };
  close: (id: string) => Promise<void>;
}
const mod = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer; normalizeInput: (i: unknown) => Record<string, unknown> };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as { WALLPRINT_JS: string; WALLPRINT_CSS: string };
const { WALLPRINT_FIXTURES } = (await import(pathToFileURL(`${EXT}/wallprint-fixtures.mjs`).href)) as { WALLPRINT_FIXTURES: Record<string, DisclosureFixture> };

const explorer = mod.createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
let n = 0;
async function open(input?: unknown): Promise<{ id: string; url: string }> {
  const id = `w${++n}`;
  opened.push(id);
  const o = await explorer.open(id, input);
  return { id, url: o.url };
}
const get = async (url: string): Promise<string> => (await fetch(url)).text();

describe("normalizeInput: a wallprint input is a named fixture and nothing else", () => {
  test("accepts every bundled lineage by name, refuses unknown names, prototype keys, non-strings and combinations", () => {
    for (const name of Object.keys(WALLPRINT_FIXTURES)) assert.deepEqual(mod.normalizeInput({ wallprint: name }), { wallprint: name, source: `wallprint:${name}` });
    for (const bad of [{ wallprint: "nope" }, { wallprint: "__proto__" }, { wallprint: "constructor" }, { wallprint: 7 }, { wallprint: "corrected", fixture: "usdc-established" }, { wallprint: "corrected", assertionId: "a-identity" }, { wallprint: "corrected", evaluatedAt: "2026-10-23T12:00:00Z" }]) {
      assert.throws(() => mod.normalizeInput(bad), /wallprint/, JSON.stringify(bad));
    }
    assert.throws(() => mod.normalizeInput({ wallprint: "corrected", layout: "wide" }), /Unknown input field/);
  });
});

describe("the WallPrint view over the loopback listener", () => {
  test("opening a lineage shows the disclosure document, evaluates nothing and reports the recorded results to the agent", async () => {
    const { id, url } = await open({ wallprint: "corrected" });
    const s = explorer.view(id);
    const f = WALLPRINT_FIXTURES["corrected"]!;
    const focus = f.records.find((r) => r.id === f.focus)!;
    assert.equal(s.status, "wallprint");
    assert.equal(s.fixture, "corrected");
    assert.equal(s.recordId, f.focus);
    assert.equal(s.lifecycle, focus.lifecycle.state);
    assert.deepEqual(s.lineage?.chain, f.records.map((r) => r.id));
    assert.deepEqual(s.assessments?.map((a) => `${a.assessor}:${a.assessment}`), focus.record.assessments.map((a) => `${a.assessor}:${a.assessment}`));
    assert.deepEqual(s.receipt, { issued: true, matches: true, reasons: [] });
    assert.deepEqual(s.replay, { outcome: "REPRODUCED", reasons: [], mismatches: [] });
    assert.equal(s.selectedAssertionId, null, "a disclosure carries no assertion selection");
    assert.ok(!("evaluation" in s) && !("bundleDigest" in s), "nothing was evaluated");
    const html = await get(`${url}view`);
    assert.ok(html.includes('data-wp-fixture="corrected"') && html.includes("wallprint:corrected") && !html.includes('class="ww-wall-svg"'), "the fragment is the document, not The Wall");
    const cv = explorer.canvasView(id);
    assert.equal(cv.status, "wallprint");
    assert.deepEqual(cv.disclosure, f, "the view is the fixture, verbatim");
    assert.ok(Object.isFrozen(cv.disclosure));
    // The summary is a fresh copy: editing it reaches neither the next summary nor the fixture.
    s.lineage?.chain.push("tampered");
    assert.deepEqual(explorer.view(id).lineage?.chain, f.records.map((r) => r.id));
    assert.deepEqual(WALLPRINT_FIXTURES["corrected"]!.records.map((r) => r.lineage.chain), f.records.map((r) => r.id).map(() => f.records.map((r) => r.id)));
  });

  test("select_assertion is a no-op on a disclosure; replacing with a bundle restores The Wall; a disclosure then replaces it again", async () => {
    const { id, url } = await open({ wallprint: "withdrawn" });
    const before = await get(`${url}view`);
    const s = await explorer.select(id, "a-identity");
    assert.equal(s.status, "wallprint");
    assert.equal(s.selectedAssertionId, null);
    assert.equal(await get(`${url}view`), before, "nothing changed");
    const ready = await explorer.setInput(id, { fixture: "usdc-established" });
    assert.equal(ready.status, "ready");
    const wall = await get(`${url}view`);
    assert.ok(wall.includes('class="ww-wall-svg"') && !wall.includes('class="wp"') && !wall.includes("wallprint:withdrawn"), "the evidence view is untouched by the disclosure code");
    const back = await explorer.setInput(id, { wallprint: "receipt-mismatch" });
    assert.equal(back.status, "wallprint");
    assert.deepEqual(back.receipt, { issued: true, matches: false, reasons: ["RECORD_INVALID"] });
    assert.deepEqual(back.replay, { outcome: "UNREPLAYABLE", reasons: ["RECORD_INVALID"], mismatches: [] });
    const doc = await get(`${url}view`);
    assert.ok(doc.includes('data-wp-fixture="receipt-mismatch"') && !doc.includes("fixture:usdc-established"));
  });

  test("an unknown lineage name is an input error with no states shown, and the empty state lists the lineages", async () => {
    const bad = await open({ wallprint: "no-such-lineage" });
    assert.equal(explorer.view(bad.id).status, "error");
    assert.equal(explorer.view(bad.id).error?.code, "INVALID_INPUT");
    assert.ok(!(await get(`${bad.url}view`)).includes("data-state="));
    const empty = await open(undefined);
    const html = await get(`${empty.url}view`);
    for (const name of Object.keys(WALLPRINT_FIXTURES)) assert.ok(html.includes(`<code>${name}</code>`), name);
    assert.ok(html.includes("fixture-backed WallPrint disclosure record"));
  });

  test("the served page carries the WallPrint stylesheet and script under the same nonce, and the fragment's CSP still runs nothing", async () => {
    const { url } = await open({ wallprint: "current-supported" });
    const r = await fetch(url);
    const csp = String(r.headers.get("content-security-policy"));
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    const body = await r.text();
    assert.ok(nonce && body.includes(`<script nonce="${nonce}">${render.WALLPRINT_JS}</script>`));
    assert.ok(body.includes(render.WALLPRINT_CSS));
    assert.equal(csp, `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; font-src data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`, "the CSP is the pre-existing literal, unchanged");
    const v = await fetch(`${url}view`);
    assert.ok(String(v.headers.get("content-security-policy")).includes("sandbox"));
  });
});

describe("the page script: version switching and exact-value copy in a stand-in DOM with no storage", () => {
  interface FakeEl {
    dataset: Record<string, string>;
    hidden: boolean;
    attrs: Record<string, string>;
    setAttribute: (k: string, v: string) => void;
    removeAttribute: (k: string) => void;
    getAttribute: (k: string) => string | null;
    querySelector: (s: string) => unknown;
    closest: (s: string) => unknown;
    focus: () => void;
    textContent: string;
    focused?: boolean;
    style?: Record<string, string>;
    offsetWidth?: number;
  }
  const el = (dataset: Record<string, string>, extra: Partial<FakeEl> = {}): FakeEl => {
    const e: FakeEl = {
      dataset,
      hidden: false,
      attrs: {},
      setAttribute: (k, v) => (e.attrs[k] = v),
      removeAttribute: (k) => delete e.attrs[k],
      getAttribute: (k) => e.attrs[k] ?? null,
      querySelector: () => null,
      closest: () => null,
      focus: () => (e.focused = true),
      textContent: "",
      ...extra,
    };
    return e;
  };

  function page(opts: { clipboard: boolean }): { run: (target: unknown) => Promise<void>; records: FakeEl[]; buttons: FakeEl[]; root: FakeEl; status: FakeEl; announcer: FakeEl; copied: string[]; headings: FakeEl[] } {
    const headings = [el({}), el({})];
    const records = [el({ recordId: "v1", version: "v1" }, { hidden: true, querySelector: () => headings[0] }), el({ recordId: "v2", version: "v2" }, { querySelector: () => headings[1] })];
    const buttons = [el({ wpVersion: "v1" }), el({ wpVersion: "v2" }, { attrs: { "aria-current": "true" } })];
    const root = el({ wpFocus: "v2" });
    const status = el({});
    const announcer = el({});
    let onClick: ((e: unknown) => void) | undefined;
    const app = {
      dataset: {},
      addEventListener: (type: string, h: (e: unknown) => void) => {
        if (type === "click") onClick = h;
      },
      querySelector: (s: string) => (s === ".wp" ? root : null),
      querySelectorAll: (s: string) => (s === ".wp-record" ? records : s === "[data-wp-version]" ? buttons : []),
    };
    const copied: string[] = [];
    const context = {
      document: { getElementById: (id: string) => (id === "app" ? app : id === "copy-status" ? status : id === "view-status" ? announcer : null), createRange: () => ({ selectNodeContents: () => undefined }), execCommand: () => false },
      window: { getSelection: () => ({ removeAllRanges: () => undefined, addRange: () => undefined }) },
      navigator: { clipboard: { writeText: (t: string) => (opts.clipboard ? (copied.push(t), Promise.resolve()) : Promise.reject(new Error("NotAllowedError"))) } },
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    };
    runInNewContext(render.WALLPRINT_JS, context);
    assert.ok(onClick, "the script registers its click handler");
    const run = async (target: unknown): Promise<void> => {
      onClick!({ target });
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    };
    return { run, records, buttons, root, status, announcer, copied, headings };
  }

  test("choosing an earlier version shows it, folds the others, marks the control current, moves focus to its heading and announces; nothing is removed", async () => {
    const p = page({ clipboard: true });
    await p.run({ closest: (s: string) => (s === "[data-wp-version]" ? p.buttons[0] : null) });
    assert.deepEqual(p.records.map((r) => r.hidden), [false, true]);
    assert.equal(p.buttons[0]!.attrs["aria-current"], "true");
    assert.equal(p.buttons[1]!.attrs["aria-current"], undefined);
    assert.equal(p.root.dataset["wpFocus"], "v1");
    assert.equal(p.root.dataset["wpRevealed"], "true", "the reveal is marked played, so the chosen version shows at once");
    assert.equal(p.headings[0]!.focused, true);
    assert.equal(p.headings[0]!.attrs["tabindex"], "-1");
    assert.match(p.announcer.textContent, /^Showing v1 of this lineage: v1\. The other versions stay available\.$/);
    await p.run({ closest: (s: string) => (s === "[data-wp-version]" ? p.buttons[1] : null) });
    assert.deepEqual(p.records.map((r) => r.hidden), [true, false]);
  });

  test("Copy puts exactly the printed exact value on the clipboard and names it; a refusal selects the value instead", async () => {
    const digest = "a".repeat(64);
    const code = { textContent: digest };
    const holder = { querySelector: (s: string) => (s === "code" ? code : null) };
    const button = el({}, { closest: (s: string) => (s === ".wp-copyable" ? holder : null), attrs: { "aria-label": "Copy the full record digest" }, textContent: "Copy", style: {}, offsetWidth: 40 });
    const p = page({ clipboard: true });
    await p.run({ closest: (s: string) => (s === "[data-wp-copy]" ? button : null) });
    assert.deepEqual(p.copied, [digest]);
    assert.equal(p.status.textContent, "Copied the full record digest (64 characters).");
    assert.equal(button.textContent, "Copied");
    const denied = page({ clipboard: false });
    const button2 = el({}, { closest: (s: string) => (s === ".wp-copyable" ? holder : null), attrs: { "aria-label": "Copy the full record digest" }, textContent: "Copy" });
    await denied.run({ closest: (s: string) => (s === "[data-wp-copy]" ? button2 : null) });
    assert.deepEqual(denied.copied, []);
    assert.match(denied.status.textContent, /record digest is selected: press Ctrl\+C/);
    assert.ok(!denied.status.textContent.includes(digest), "the value is not echoed into the status line");
  });

  test("the script stores nothing, talks to no origin and never writes markup", () => {
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|EventSource|XMLHttpRequest|postMessage|innerHTML/.test(render.WALLPRINT_JS));
  });
});
