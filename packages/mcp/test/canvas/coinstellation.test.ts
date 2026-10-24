import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { callTool } from "../../src/tools.ts";
import { ENTRIES, ROOT } from "../support/harness.ts";

/**
 * The Coinstellation: The Wall drawn as the WalletWall Coinstellation, as a projection of the explorer's authoritative
 * Canvas view. These tests pin the contract between the layers (fixture input, MCP evaluation, buildView, the adapter,
 * the renderer and the page script) and the interaction model (shared assertion selection, local visual focus, Trace on
 * the same graph, a contextual guide).
 */
const EXT = `${ROOT}plugin/com.github.copilot/extensions/walletwall-evidence-explorer`;
interface Explorer {
  open: (id: string, input?: unknown) => Promise<{ url: string }>;
  select: (id: string, assertionId: string) => Promise<unknown>;
  view: (id: string) => Record<string, unknown>;
  canvasView: (id: string) => View;
  close: (id: string) => Promise<void>;
}
interface Evaluation {
  assertionId: string;
  supportState: string;
  freshnessState: string;
  conflictsWith: string[];
}
interface View {
  status: string;
  selectedId: string | null;
  assertions: { id: string; claimType: string; evaluation: Evaluation | null }[];
  readiness: { assertionId: string; result?: { classification: string }; errorCode?: string } | null;
  provenance: { target: string; prov: Record<string, Record<string, Record<string, string>>> } | null;
  [k: string]: unknown;
}
interface CNode {
  id: string;
  type: string;
  entityType: string;
  label: string;
  state: string;
  wwepState?: string | null;
  classification?: string;
  assertionId?: string;
  semanticRef: Record<string, string>;
  onTrace: boolean;
  primary: boolean;
  exactValue?: string;
  accessibleLabel: string;
  wide: { x: number; y: number };
  tall: { x: number; y: number };
  x: number;
  y: number;
}
interface CEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  relationship: string;
  activeTrace: boolean;
}
interface Model {
  coinstellationViewVersion: string;
  nodes: CNode[];
  edges: CEdge[];
  authoritativeSelectedAssertionId: string | null;
  visualFocusId: string | null;
  mode: string;
  dominantStory: string | null;
  storyTarget: string | null;
  box: Record<"wide" | "tall", { x: number; y: number; w: number; h: number }>;
}
const { createExplorer, normalizeInput } = (await import(pathToFileURL(`${EXT}/explorer.mjs`).href)) as { createExplorer: (o: { serverArgs: string[] }) => Explorer; normalizeInput: (i: unknown) => { bundle: unknown; evaluatedAt: string } };
const model = (await import(pathToFileURL(`${EXT}/coinstellation-model.mjs`).href)) as { buildCoinstellation: (v: unknown, p?: unknown) => Model; footprint: (n: CNode) => { boxes: number[][] }; COINSTELLATION_VIEW_VERSION: string };
const render = (await import(pathToFileURL(`${EXT}/render.mjs`).href)) as Record<string, unknown> & { renderView: (v: unknown) => string; CLIENT_JS: string; CSS: string };
const { FIXTURES } = (await import(pathToFileURL(`${EXT}/fixtures.mjs`).href)) as { FIXTURES: Record<string, { title: string; from: string; evaluatedAt: string; bundle: { assertions: { id: string; claimType: string }[]; sources: unknown[]; observations: unknown[] } }> };

const explorer = createExplorer({ serverArgs: [ENTRIES.bundle] });
const opened: string[] = [];
after(async () => {
  for (const id of opened) await explorer.close(id);
});
async function open(name: string, assertionId?: string): Promise<{ id: string; url: string; view: View; html: string }> {
  const id = `c-${name}-${assertionId ?? "default"}-${opened.length}`;
  opened.push(id);
  const o = await explorer.open(id, assertionId ? { fixture: name, assertionId } : { fixture: name });
  return { id, url: o.url, view: explorer.canvasView(id), html: await (await fetch(`${o.url}view`)).text() };
}
const freeze = <T>(v: T): T => {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) freeze(x);
  }
  return v;
};
const attrs = (s: string): Record<string, string> => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1] as string, a[2] as string]));
const pieces = (html: string): Record<string, string>[] => [...html.matchAll(/<g class="ww-node[^"]*"([^>]*)>/g)].map((m) => attrs(m[1] as string)).filter((p) => p["data-node-id"] !== undefined);
const lin = (u: number): number => (u / 255 <= 0.03928 ? u / 255 / 12.92 : Math.pow((u / 255 + 0.055) / 1.055, 2.4));
const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const token = (name: string): string => {
  const raw = new RegExp(`--${name}:([^;]+);`).exec(render.CSS)?.[1] ?? "";
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? token(ref[1] as string) : raw;
};

describe("contract invariants: the Coinstellation is a projection of the authoritative view", () => {
  test("FIXTURE_IS_INPUT_NOT_EVALUATION: fixtures carry only test provenance and a WWEP bundle, no evaluated or visual state", () => {
    for (const [name, fx] of Object.entries(FIXTURES)) {
      assert.deepEqual(Object.keys(fx).sort(), ["bundle", "evaluatedAt", "from", "title"], name);
      const text = JSON.stringify(fx.bundle);
      assert.ok(!/"(evaluation|supportState|freshnessState|nodeColor|nodeState|isConflict|readinessPassed|freshnessLabel|authorityRank|graphWeight|visualPriority)"\s*:/.test(text), `${name}: no evaluated or visual field in the bundle`);
    }
    assert.ok(readFileSync(`${EXT}/fixtures.mjs`, "utf8").includes("gen-canvas-fixtures"), "fixtures.mjs says it is generated");
  });

  test("normalizeInput validates and copies; it evaluates nothing and accepts no presentation field", () => {
    const n = normalizeInput({ fixture: "conflicting-balances" });
    assert.ok(!/supportState|evaluation/.test(JSON.stringify(n)));
    for (const extra of ["layout", "nodePositions", "colorScheme", "graphMode"]) assert.throws(() => normalizeInput({ fixture: "usdc-established", [extra]: 1 }), /Unknown input field/);
  });

  test("MCP_IS_SEMANTIC_EVALUATOR and BUILD_VIEW_IS_AUTHORITATIVE_UI_STATE: the view's evaluations are the engine's, and the page is rendered from that view", async () => {
    for (const name of ["usdc-established", "stale-identity", "conflicting-balances"]) {
      const fx = FIXTURES[name]!;
      const direct = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(direct.ok);
      const { view, html } = await open(name);
      const byId = new Map((direct.result as { assertions: Evaluation[] }).assertions.map((e) => [e.assertionId, e]));
      for (const a of view.assertions) assert.deepEqual(a.evaluation, byId.get(a.id), `${name}/${a.id}`);
      assert.equal(render.renderView(view), html, `${name}: the served page is renderView(the authoritative view)`);
    }
  });

  test("COINSTELLATION_IS_PROJECTION_ONLY: the adapter reads a frozen view, mutates nothing, and is deterministic", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const { view } = await open(name);
      const before = JSON.stringify(view);
      const a = model.buildCoinstellation(freeze(view), { mode: "overview" });
      const b = model.buildCoinstellation(view, { mode: "overview" });
      assert.equal(JSON.stringify(view), before, `${name}: the view is unchanged`);
      assert.deepEqual(a, b, `${name}: same view, same model`);
      assert.equal(a.coinstellationViewVersion, "1", "a visual-contract version of its own");
      assert.ok(!("wwepVersion" in a), "it does not masquerade as an evidence schema version");
    }
  });

  test("the adapter copies every evaluated state verbatim and never strengthens one", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const { view } = await open(name);
      const m = model.buildCoinstellation(view);
      for (const a of view.assertions) {
        const n = m.nodes.find((x) => x.assertionId === a.id)!;
        assert.equal(n.wwepState, a.evaluation ? a.evaluation.supportState : null, `${name}/${a.id}`);
        assert.equal(n.state, a.evaluation ? a.evaluation.supportState.toLowerCase().replace("_", "-") : "unavailable", `${name}/${a.id}: formatting only`);
      }
      // Structural pieces carry no state of their own, never a neighbour's.
      for (const n of m.nodes.filter((x) => x.assertionId === undefined)) assert.equal(n.state, "neutral", `${name}/${n.id}`);
      const k = m.nodes.find((x) => x.type === "readiness");
      if (k && view.readiness?.result) assert.equal(k.classification, view.readiness.result.classification, `${name}: the keystone carries view.readiness verbatim`);
    }
  });

  test("LAYOUT_IS_NOT_EVIDENCE and MOTION_IS_NOT_EVIDENCE: presentation changes positions and emphasis only; the agent's view carries neither", async () => {
    const { id, view } = await open("conflicting-balances");
    const desk = model.buildCoinstellation(view, { viewportClass: "desktop" });
    const phone = model.buildCoinstellation(view, { viewportClass: "mobile", mode: "trace", visualFocusId: "src:src-chain" });
    assert.deepEqual(desk.nodes.map((n) => [n.id, n.wwepState, n.classification]), phone.nodes.map((n) => [n.id, n.wwepState, n.classification]));
    assert.ok(desk.nodes.some((n) => n.x !== phone.nodes.find((p) => p.id === n.id)!.x), "positions differ by viewport");
    assert.ok(!/"(x|y|transform|opacity|animation)"/.test(JSON.stringify(explorer.view(id))), "get_view stays semantic");
    const loops = [...render.CSS.matchAll(/@keyframes ([\w-]+)\{([\s\S]*?\})\}/g)];
    assert.ok(loops.length >= 5, "the semantic loops are declared");
    for (const m of loops) for (const p of (m[2] as string).matchAll(/([a-z-]+)\s*:/g)) assert.ok(["transform", "opacity"].includes(p[1] as string), `${m[1]} animates ${p[1]}: loops animate transform and opacity only`);
  });

  test("VISUAL_FOCUS_IS_NOT_ASSERTION_SELECTION: focus on a piece that is not a claim never becomes the selected assertion", async () => {
    const { view } = await open("conflicting-balances");
    const m = model.buildCoinstellation(view, { visualFocusId: "src:src-chain" });
    assert.equal(m.visualFocusId, "src:src-chain");
    assert.equal(m.authoritativeSelectedAssertionId, view.selectedId);
    const s = pageStage((await open("conflicting-balances")).html);
    await s.settle();
    s.click(s.node("src:src-chain"));
    assert.deepEqual(s.posts, [], "no select request for a source");
    assert.equal(s.node("src:src-chain").classList.contains("is-focus"), true, "visual focus is shown");
    s.click(s.node("as:a-balance"));
    assert.deepEqual(s.posts, [{ assertionId: "a-balance" }], "a claim goes through the shared selection");
  });

  test("TRACE_USES_AUTHORITATIVE_PROVENANCE: Trace marks exactly the pieces and connections trace_provenance names", async () => {
    const { view, html } = await open("conflicting-balances", "a-balance");
    const prov = view.provenance!;
    assert.equal(prov.target, "a-balance");
    const named = new Set<string>();
    for (const id of [...Object.keys(prov.prov["entity"] ?? {}), ...Object.keys(prov.prov["agent"] ?? {}), ...Object.keys(prov.prov["activity"] ?? {})]) {
      const m = /^ww:(assertion|obs|derivation|source)\/(.+)$/.exec(id);
      if (m) named.add(`${{ assertion: "as", obs: "obs", derivation: "drv", source: "src" }[m[1] as "assertion"]}:${m[2]}`);
    }
    const marked = new Set(pieces(html).filter((p) => p["data-trace"] === "true").map((p) => p["data-node-id"]));
    assert.deepEqual([...marked].sort(), [...named].sort(), "the traced pieces are the provenance's records");
    const edges = [...html.matchAll(/<path class="ww-edge"([^>]*)>/g)].map((m) => attrs(m[1] as string));
    for (const e of edges.filter((x) => x["data-trace"] === "true")) assert.ok(named.has(e["data-from"] ?? "") && named.has(e["data-to"] ?? ""), `${e["data-from"]} > ${e["data-to"]}`);
    for (const e of edges.filter((x) => ["subject", "anchors", "names", "conflict"].includes(x["data-kind"] ?? ""))) assert.notEqual(e["data-trace"], "true", "structure that is not provenance is never traced");
    const none = model.buildCoinstellation({ ...view, provenance: null });
    assert.ok(!none.edges.some((e) => e.activeTrace) && !none.nodes.some((n) => n.onTrace), "no provenance, no trace");
  });

  const synthetic = (over: Record<string, unknown>): View => {
    const v: Record<string, unknown> = {
      status: "ready",
      evaluatedAt: "2026-10-23T12:00:30Z",
      versions: {},
      bundleDigest: "d",
      invariantViolationCount: 0,
      invariantViolations: [],
      sources: [],
      observations: [],
      derivations: [],
      assertions: [],
      selectedId: null,
      provenance: null,
      readiness: null,
      ...over,
    };
    return v as View;
  };
  const ev = (id: string, supportState: string): Evaluation & Record<string, unknown> => ({ assertionId: id, supportState, freshnessState: "CURRENT", finalityState: null, conflictsWith: [], supersededBy: null, limitations: [], dependencies: { observationIds: ["o1"], assertionIds: [] } });

  test("TRANSPORT_IS_NOT_AUTHORITY and SOURCE_COUNT_IS_NOT_CORROBORATION", () => {
    const v = synthetic({
      sources: [
        { id: "p1", kind: "PROVIDER_ENDPOINT", transport: { retrievedVia: "Alchemy" }, independenceGroup: "g1" },
        { id: "p2", kind: "PROVIDER_ENDPOINT", transport: { retrievedVia: "Infura" }, independenceGroup: "g2" },
      ],
      observations: [
        { id: "o1", sourceId: "p1", result: "VALUE" },
        { id: "o2", sourceId: "p2", result: "VALUE" },
      ],
      assertions: [{ id: "x", claimType: "TOKEN_USD_PRICE", subject: { chainId: "1", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }, value: {}, observationIds: ["o1", "o2"], evaluation: ev("x", "PARTIAL") }],
      selectedId: "x",
    });
    const m = model.buildCoinstellation(v);
    assert.equal(m.nodes.filter((n) => n.type === "authority").length, 0, "no authority is invented from a transport");
    assert.equal(m.nodes.find((n) => n.id === "as:x")!.wwepState, "PARTIAL", "two providers do not lift the state");
    const html = render.renderView(v);
    assert.ok(!/corroborat|confirmation|independent sources agree/i.test(html.replace(/INSUFFICIENT_INDEPENDENT_CORROBORATION|Independent corroboration|Too few independent sources agree\./g, "")), "no corroboration is claimed from a count");
  });

  test("if the visual model cannot be built, no graph is drawn and every assertion stays reachable with its returned support state", async () => {
    const { view } = await open("conflicting-balances");
    const broken = structuredClone(view);
    Object.defineProperty(broken, "derivations", { get: () => { throw new Error("adapter input unreadable"); } });
    assert.throws(() => model.buildCoinstellation(broken), "the adapter fails on this view");
    const html = render.renderView(broken);
    assert.ok(!/class="ww-wall-svg"/.test(html) && /The Wall could not be drawn for this bundle/.test(html), "no partial graph, a plain note instead");
    for (const a of view.assertions) {
      const row = new RegExp(`data-assertion-id="${a.id}">[^<]*<code>${a.id}</code></button> <span class="chip"[^>]*data-state="${a.evaluation ? a.evaluation.supportState : "NA"}"`).exec(html);
      assert.ok(row, `${a.id} is listed with its returned support state`);
    }
  });

  test("UNKNOWN_IS_NOT_FALSE and NO_RESULT_IS_NOT_ZERO", async () => {
    const { html, view } = await open("unknown-balance");
    const m = model.buildCoinstellation(view);
    const claim = m.nodes.find((n) => n.assertionId === "a-nr")!;
    assert.equal(claim.wwepState, "UNKNOWN");
    const obs = m.nodes.find((n) => n.type === "observation")!;
    assert.ok(/result NO_RESULT, not a value/.test(obs.accessibleLabel));
    const face = /<g class="ww-node[^"]*"[^>]*data-node-id="obs:[^"]*"[\s\S]*?<\/g><\/g>/.exec(html)?.[0] ?? "";
    assert.ok(/no result/.test(face) && !/>0<|>false</i.test(face), "a missing result reads as no result, never 0 or false");
  });

  test("STALE_IS_NOT_CURRENT and CONFLICTING_IS_NOT_ESTABLISHED, with two encodings each that survive reduced motion", async () => {
    const stale = pieces((await open("stale-identity")).html).find((p) => p["data-type"] === "wallmark")!;
    assert.equal(stale["data-state"], "STALE");
    const conflict = pieces((await open("conflicting-balances")).html).filter((p) => p["data-state"] === "CONFLICTING");
    assert.ok(conflict.length >= 2);
    // Static encodings: a dotted ring and a STALE chip; a fractured ring, a broken connection and a CONFLICTING chip.
    const css = render.CSS;
    assert.ok(/\.ww-ring-stale\{[^}]*stroke-dasharray/.test(css) && /\.ww-node\[data-state="STALE"\][^{]*\.ww-node-art\{opacity:0\.66/.test(css));
    assert.ok(/\.ww-edge\[data-kind="conflict"\]\{[^}]*stroke-dasharray/.test(css) && /\.ww-node \.ww-ring-conflict\{/.test(css));
    assert.ok(/#app\[data-motion="reduced"\] \*[^{]*\{transition:none!important;animation:none!important\}/.test(css), "reduced motion stops every loop; the static treatments stay");
  });

  test("DERIVED_IS_NOT_UPSTREAM_AUTHORITY and READINESS_IS_NOT_RECOMPUTED_IN_BROWSER", async () => {
    const { view, html } = await open("usdc-established");
    const m = model.buildCoinstellation(view);
    const drv = m.nodes.find((n) => n.type === "derivation")!;
    assert.equal(drv.entityType, "derivation");
    assert.ok(!m.edges.some((e) => e.kind === "speaks" && e.to === drv.id), "no authority speaks for a WalletWall derivation");
    assert.ok(/never an upstream authority/.test(html));
    assert.ok(!/CRITERIA_MET|NOT_MET|INDETERMINATE|supportState|observedAt|Date\.now|new Date/.test(render.CLIENT_JS), "the page script classifies nothing and reads no clock");
    const blocked = model.buildCoinstellation(synthetic({ assertions: [{ id: "r", claimType: "VAULT_TECHNICAL_READINESS", subject: {}, value: {}, evaluation: ev("r", "NOT_ESTABLISHED") }], readiness: { assertionId: "r", errorCode: "REQUIRED_INPUT_ASSERTION_MISSING" } }));
    const k = blocked.nodes.find((n) => n.type === "readiness")!;
    assert.equal(k.classification, undefined, "a readiness error is not turned into a classification");
    assert.ok(/not assessed/.test(k.accessibleLabel) && blocked.nodes.some((n) => n.id === "gap:readiness-input"));
  });
});

describe("fixture contracts, end to end: fixture, normalizeInput, WalletWall MCP, buildView, buildCoinstellation", () => {
  for (const [name, expect] of [
    ["usdc-established", "established"],
    ["stale-identity", "stale"],
    ["conflicting-balances", "conflict"],
  ] as const) {
    test(`${name}: the authoritative states reach the Coinstellation unchanged, and the dominant story is "${expect}"`, async () => {
      const fx = FIXTURES[name]!;
      const inspect = callTool("inspect_evidence", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt });
      assert.ok(inspect.ok);
      const engine = new Map((inspect.result as { assertions: Evaluation[] }).assertions.map((e) => [e.assertionId, e]));
      const ready = callTool("assess_vault_readiness", { bundle: fx.bundle, evaluatedAt: fx.evaluatedAt, identityAssertionId: "a-identity", balanceAssertionId: "a-balance" });
      assert.ok(ready.ok);
      const { view, html } = await open(name);
      assert.equal(view.readiness?.result?.classification, (ready.result as { classification: string }).classification);
      const m = model.buildCoinstellation(view);
      for (const [id, e] of engine) assert.equal(m.nodes.find((n) => n.assertionId === id)?.wwepState, e.supportState, `${name}/${id}`);
      const wallmark = m.nodes.find((n) => n.type === "wallmark")!;
      assert.equal(wallmark.wwepState, engine.get("a-identity")!.supportState, "the Wallmark is the identity claim's evaluation, nothing else");
      assert.equal(m.dominantStory, expect);
      const anyConflict = [...engine.values()].some((e) => e.supportState === "CONFLICTING" || e.conflictsWith.length > 0);
      assert.equal(m.nodes.some((n) => n.type === "conflict"), anyConflict, "a conflict piece exists exactly when the engine reported one");
      assert.equal(m.nodes.some((n) => n.wwepState === "STALE"), [...engine.values()].some((e) => e.supportState === "STALE"), "staleness only where the engine said so");
      assert.ok(html.includes(`data-story="${expect}"`), "the page carries the story for emphasis");
      // The raw entities stay in the view for the graph's topology.
      assert.equal((view["sources"] as unknown[]).length, fx.bundle.sources.length);
      assert.equal((view["observations"] as unknown[]).length, fx.bundle.observations.length);
    });
  }

  test("the three canonical fixtures get different guide cues, each about one concrete piece", async () => {
    const first = new Map<string, { text: string; node: string }>();
    for (const name of ["usdc-established", "stale-identity", "conflicting-balances"]) {
      const { html } = await open(name);
      const cues = [...html.matchAll(/<li data-cue="([^"]*)" data-node="([^"]*)" data-pose="[^"]*">([^<]*)<\/li>/g)].map((m) => ({ cue: m[1] as string, node: m[2] as string, text: m[3] as string }));
      const ids = new Set(pieces(html).map((p) => p["data-node-id"]));
      for (const c of cues) {
        assert.ok(ids.has(c.node), `${name}: the "${c.cue}" cue targets a piece on The Wall`);
        const words = c.text.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length;
        assert.ok(words <= (c.cue === "node" ? 24 : 20), `${name}: "${c.text}" is ${words} words`);
      }
      const story = cues.find((c) => c.cue !== "node")!;
      first.set(name, story);
    }
    assert.match(first.get("conflicting-balances")!.text, /disagree/);
    assert.match(first.get("stale-identity")!.text, /STALE/);
    assert.match(first.get("usdc-established")!.text, /satisfies the published policy/);
    assert.equal(new Set([...first.values()].map((c) => c.text)).size, 3);
  });
});

describe("one visual language: shared nodes, one graph, surfaces that separate", () => {
  test("only the semantic anchors are node objects: claims, the Wallmark and a conflict are circles, the keystone the one other shape, and facts and context are drafting marks", async () => {
    const ANCHORS = ["wallmark", "assertion", "conflict", "readiness"];
    const FACTS = ["observation", "derivation", "gap"];
    for (const name of Object.keys(FIXTURES)) {
      const { html } = await open(name);
      const svg = /<svg class="ww-wall-svg"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
      const chunks = svg.split(/(?=<g class="ww-node[ "])/).slice(1);
      let anchors = 0;
      for (const chunk of chunks) {
        const type = /data-type="([^"]+)"/.exec(chunk)?.[1] as string;
        const tier = /data-tier="([^"]+)"/.exec(chunk)?.[1];
        assert.equal(tier, ANCHORS.includes(type) ? "anchor" : FACTS.includes(type) ? "fact" : "context", `${name}: ${type} is drawn at its tier`);
        if (type === "readiness") assert.ok(/<path class="body"/.test(chunk), `${name}: the keystone`);
        else assert.ok(/<circle class="body" r="[\d.]+"( pathLength="100")?\/>/.test(chunk) && !/<(rect|polygon|path) class="body"/.test(chunk), `${name}: ${type} keeps one circular ring for selection and focus`);
        if (tier === "anchor") anchors++;
        // A fact or context piece is a light mark (a drafting mark or a small glyph), never an enclosed medallion.
        else assert.ok(/class="ww-draft[ "]|class="ww-glyph" transform="scale\(0\.55\)"/.test(chunk), `${name}: ${type} is a light mark`);
        assert.ok(/<rect class="ww-hit"/.test(chunk), "a touch target");
      }
      assert.ok(anchors / chunks.length <= 0.45, `${name}: ${anchors} of ${chunks.length} pieces are node objects`);
    }
    // The ring of a fact or context piece is not drawn at rest; it appears under hover, focus and selection.
    const css = render.CSS;
    assert.ok(/\.ww-node:not\(\[data-tier="anchor"\]\) \.body\{fill:none;stroke:none\}/.test(css));
    assert.ok(/\.ww-node\.is-selected \.body,\.ww-node\.is-focus \.body\{stroke:var\(--ww-brick-low\);stroke-width:2\}/.test(css));
  });

  test("Trace reuses the same pieces: there is one graph, no separate lineage diagram, and Trace only changes emphasis", async () => {
    const { html } = await open("conflicting-balances", "a-balance");
    assert.equal((html.match(/<svg class="ww-wall-svg"/g) ?? []).length, 1);
    assert.ok(!/class="graph"|ww-lineage|Source lineage/.test(html), "no standalone Source lineage graph");
    assert.ok(!("renderGraph" in render), "the lineage renderer is gone");
    assert.ok(/\.ww-wall-svg\[data-trace="true"\] \.ww-node:not\(\[data-trace="true"\]\) \.ww-node-art/.test(render.CSS), "Trace dims what is off the path, by attribute, on the same nodes");
    const s = pageStage(html);
    await s.settle();
    const before = s.nodes.map((n) => n.attributes["transform"]);
    s.click(s.trace);
    assert.equal(s.svg.dataset["trace"], "true");
    assert.deepEqual(s.nodes.map((n) => n.attributes["transform"]), before, "no piece moves");
  });

  test("selecting a piece highlights it and its direct connections and mutes the rest; Escape returns to the whole wall", async () => {
    const s = pageStage((await open("conflicting-balances")).html);
    await s.settle();
    assert.equal(s.svg.dataset["focus"], "none", "nothing is muted before anyone acts");
    s.click(s.node("obs:obs-balance"));
    assert.equal(s.svg.dataset["focus"], "pinned");
    const on = s.nodes.filter((n) => n.classList.contains("on-path")).map((n) => n.dataset["nodeId"]).sort();
    assert.deepEqual(on, ["as:a-balance", "obs:obs-balance", "src:src-chain"]);
    assert.ok(s.node("as:a-balance").classList.contains("is-related"));
    assert.ok(/\[data-focus="pinned"\] \.ww-node:not\(\.on-path\) \.ww-node-art[^{]*\{opacity:0\.45/.test(render.CSS), "unrelated pieces drop to 45 %");
    s.key("Escape", s.node("obs:obs-balance"));
    assert.equal(s.svg.dataset["focus"], "none");
  });

  test("selecting one side of a conflict keeps the whole conflict lit: the marker, the other claim and both connectors", async () => {
    const s = pageStage((await open("conflicting-balances")).html);
    await s.settle();
    const marker = s.nodes.find((n) => n.dataset["type"] === "conflict")!;
    const links = s.edges.filter((e) => e.dataset["kind"] === "conflict");
    assert.equal(links.length, 2);
    const claims = links.map((e) => (e.dataset["from"] === marker.dataset["nodeId"] ? e.dataset["to"] : e.dataset["from"])) as [string, string];
    s.click(s.node(claims[0]));
    for (const id of [claims[1], marker.dataset["nodeId"] as string]) assert.ok(s.node(id).classList.contains("on-path"), `${id} stays lit`);
    for (const e of links) assert.ok(e.classList.contains("on-path"), "both conflict connectors stay at full strength");
  });

  test("the guide follows the selection: a selected piece gets its own cue and the guide points at it", async () => {
    const s = pageStage((await open("conflicting-balances")).html);
    await s.settle();
    const first = s.guideText.textContent;
    s.click(s.node("src:src-chain"));
    assert.notEqual(s.guideText.textContent, first);
    assert.ok(s.node("src:src-chain").classList.contains("is-pointed"));
    assert.match(s.guideText.textContent, /not an authority/);
  });

  test("large surfaces separate by value, not by hue alone: page, stage, rail and Wallprint", () => {
    const [page, stage, rail, slate, charcoal] = ["ww-page", "ww-stage", "ww-rail", "ww-deep-slate", "ww-charcoal"].map(token) as [string, string, string, string, string];
    assert.ok(ratio(page, stage) >= 1.2, `page / stage ${ratio(page, stage).toFixed(2)}`);
    assert.ok(ratio(page, rail) >= 1.2, `page / rail ${ratio(page, rail).toFixed(2)}`);
    assert.ok(ratio(stage, rail) >= 1.2, `stage / rail ${ratio(stage, rail).toFixed(2)}`);
    assert.ok(ratio(page, slate) >= 1.2 && ratio(page, charcoal) >= 1.2, "the Wallprint band and header anchor the page");
    assert.ok(/body\{[^}]*background:var\(--ww-page\)/.test(render.CSS) && /\.ww-wall\{[^}]*background-color:var\(--ww-stage\)/.test(render.CSS) && /\.ww-detail\{[^}]*background:var\(--ww-rail\)/.test(render.CSS));
    assert.ok(ratio(stage, "#2B2B2E") >= 4.5, "labels on the stage are readable");
  });

  test("responsive geometry: both coordinate sets fit their frames, no two touch targets meet, and the tall one is phone-shaped", async () => {
    for (const name of Object.keys(FIXTURES)) {
      const { view } = await open(name);
      const m = model.buildCoinstellation(view);
      for (const key of ["wide", "tall"] as const) {
        const box = m.box[key];
        const rects = m.nodes.map((n) => model.footprint(n).boxes.map((b) => [n[key].x + (b[0] as number), n[key].y + (b[1] as number), n[key].x + (b[2] as number), n[key].y + (b[3] as number)]));
        rects.flat().forEach((r) => assert.ok(r[0]! >= box.x - 0.5 && r[2]! <= box.x + box.w + 0.5 && r[1]! >= box.y - 0.5 && r[3]! <= box.y + box.h + 0.5, `${name} ${key}: inside the frame`));
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++)
            for (const p of rects[i]!) for (const q of rects[j]!) assert.ok(!(p[0]! < q[2]! && q[0]! < p[2]! && p[1]! < q[3]! && q[1]! < p[3]!), `${name} ${key}: ${m.nodes[i]!.id} meets ${m.nodes[j]!.id}`);
      }
      assert.ok(m.box.wide.w > m.box.wide.h && m.box.tall.w < m.box.tall.h && m.box.tall.w <= 440, `${name}: wide is landscape, tall is portrait`);
    }
  });

  test("no horizontal overflow by construction: the stage takes its column's width, the strip scrolls inside itself, nothing has a fixed width wider than a phone", () => {
    assert.ok(/\.ww-wall-svg\{display:block;width:100%/.test(render.CSS));
    assert.ok(/\.ww-strip\{[^}]*min-width:0;max-width:100%;overflow-x:auto/.test(render.CSS));
    for (const m of render.CSS.matchAll(/[{;](?:width|min-width):(\d+)px/g)) assert.ok(Number(m[1]) <= 320, `${m[0]} fits a 320 px screen`);
  });

  test("touch: on a coarse pointer at any width every essential control takes 44 CSS px, and the sheet grip reaches 44 px without moving the layout", () => {
    const coarse = /@media \(pointer:coarse\)\{([\s\S]*?)\n\}/.exec(render.CSS)?.[1] ?? "";
    assert.ok(/\.ww-wall-tools>button,\.ww-wall-tools>\.ww-icon-button,\.ww-modes button,\.ww-wall-menu button,\.ww-back\{min-height:44px\}/.test(coarse), "toolbar, menu and Back to Overview");
    assert.ok(/\.ww-more>summary[^{]*\{min-height:44px\}/.test(coarse) && /\.ww-why summary\{padding:14px 12px;margin:0 -12px\}/.test(coarse), "summaries, and Why? grown by padding its margin takes back");
    assert.ok(/\.ww-sheet-grip\{[^}]*min-height:44px;margin-bottom:-20px/.test(render.CSS), "the grip's extra touch area overlaps the summary instead of pushing it down");
    assert.ok(/\.ww-sheet-bar\{display:flow-root;/.test(render.CSS), "the bar contains the grip's negative margin, so its background never covers the summary");
  });

  test("copy: revealed on hover or focus without moving anything, always present on touch, and it says Copied for 1.5 s without changing the value", () => {
    assert.ok(/button\.copy\{[^}]*opacity:0/.test(render.CSS) && /\.addr:hover button\.copy,\.addr:focus-within button\.copy/.test(render.CSS), "hidden by opacity, not removed, so nothing shifts");
    assert.ok(/@media \(hover:none\)\{button\.copy\{opacity:1/.test(render.CSS), "touch always has the copy action");
    const body = /async function copyAddress[\s\S]*?\n {2}\}\n/.exec(render.CLIENT_JS)?.[0] ?? "";
    assert.ok(body.includes('button.style.minWidth = button.offsetWidth + "px"') && body.includes('button.textContent = "Copied"') && /setTimeout\(\(\) => \{ button\.textContent = label;[^}]*\}, 1500\)/.test(body));
    assert.ok(/const full = node\.textContent;/.test(body) && !/toLowerCase|toUpperCase|slice|substring/.test(body), "the exact text, never shortened or recased");
  });
});

/** The page script against a stand-in DOM: enough to click pieces, press keys and watch classes and requests. */
function pageStage(html: string) {
  const toCamel = (s: string): string => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  interface El {
    attributes: Record<string, string>;
    dataset: Record<string, string>;
    classList: { add: (c: string) => void; remove: (c: string) => void; toggle: (c: string, f?: boolean) => void; contains: (c: string) => boolean };
    style: Record<string, string>;
    hidden: boolean;
    textContent: string;
    getAttribute: (k: string) => string | null;
    setAttribute: (k: string, v: string) => void;
    focus: () => void;
    querySelectorAll: (s: string) => El[];
    querySelector: (s: string) => El | null;
    closest: (s: string) => El | null;
  }
  const element = (a: Record<string, string>, kind: string): El => {
    const attributes = { ...a };
    const dataset: Record<string, string> = {};
    for (const [k, v] of Object.entries(a)) if (k.startsWith("data-")) dataset[toCamel(k.slice(5))] = v;
    const set = new Set((a["class"] ?? "").split(/\s+/).filter(Boolean));
    const el: El = {
      attributes,
      dataset,
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => ((f ?? !set.has(c)) ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) },
      style: {},
      hidden: false,
      textContent: "",
      getAttribute: (k) => attributes[k] ?? null,
      setAttribute: (k, v) => (attributes[k] = String(v)),
      focus: () => undefined,
      querySelectorAll: () => [],
      querySelector: () => null,
      closest: (s) => (kind === "node" && s.includes(".ww-node") ? el : kind === "node" && s === ".ww-wall-svg" ? svg : kind === "trace" && s === "button[data-mode]" ? el : null),
    };
    return el;
  };
  const nodes = pieces(html).map((a) => element(a, "node"));
  const edges = [...html.matchAll(/<path class="ww-edge"([^>]*)>/g)].map((m) => element(attrs(m[1] as string), "edge"));
  const svg = { ...element(attrs(/<svg class="ww-wall-svg"([^>]*)>/.exec(html)?.[1] ?? ""), "svg"), querySelectorAll: (s: string) => (s === ".ww-node" ? nodes : s === ".ww-edge" ? edges : []) };
  const cues = [...html.matchAll(/<li data-cue="([^"]*)" data-node="([^"]*)" data-pose="([^"]*)">([^<]*)<\/li>/g)].map((m) => ({ ...element({ "data-cue": m[1] as string, "data-node": m[2] as string, "data-pose": m[3] as string }, "cue"), textContent: m[4] as string }));
  const trace = element({ "data-mode": "trace" }, "trace");
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const app = { ...element({}, "app"), innerHTML: "", addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] ??= []).push(h), querySelector: (s: string) => (s === ".ww-wall-svg" ? svg : null), querySelectorAll: (s: string) => (s === ".ww-guide-cues li" ? cues : s === "button[data-mode]" ? [trace] : []) };
  const guide = { ...element({ "data-peek": "out" }, "guide"), hidden: true, parentNode: null };
  const guideText = element({}, "text");
  const ids: Record<string, unknown> = { app, wallaby: guide, "wallaby-text": guideText, "wallaby-art": element({}, "art"), "copy-status": element({}, "status"), "view-status": element({}, "status") };
  const posts: unknown[] = [];
  runInNewContext(render.CLIENT_JS, {
    location: { pathname: "/KEY/" },
    document: { activeElement: null, getElementById: (id: string) => ids[id] ?? null },
    window: { matchMedia: (q: string) => ({ matches: q.includes("reduced-motion"), addEventListener: () => undefined }), requestAnimationFrame: (f: () => void) => setImmediate(f), getSelection: () => null },
    fetch: (url: string, init?: { body?: string }) => {
      if (url.endsWith("select")) posts.push(JSON.parse(init?.body ?? "{}"));
      return Promise.resolve({ text: () => Promise.resolve(html) });
    },
    EventSource: class {
      onmessage: unknown;
    },
    CSS: { escape: (s: string) => s },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  const fire = (type: string, e: unknown): void => {
    for (const h of handlers[type] ?? []) h(e);
  };
  return {
    nodes,
    edges,
    svg,
    guideText,
    posts,
    node: (id: string): El => nodes.find((n) => n.dataset["nodeId"] === id)!,
    trace,
    click: (target: El): void => fire("click", { target }),
    key: (key: string, target: El): void => fire("keydown", { key, target, preventDefault: () => undefined }),
    settle: async (): Promise<void> => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    },
  };
}
