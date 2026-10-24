// The Coinstellation adapter: the authoritative Canvas view in, a non-authoritative visual model out.
//
// The WalletWall Canvas visualizes an authoritative MCP-evaluated view. Fixtures provide input, `explorer.mjs` owns Canvas
// state, and Coinstellation is a deterministic presentation projection. No renderer, layout, interaction, motion, or
// browser-time calculation may create, strengthen, or replace WalletWall evidence state.
//
// Authority, highest first: (1) the WWEP bundle, for declared sources, observations, assertions and derivations; (2) the
// WalletWall MCP results, for evaluated support, freshness, conflicts, invariants, provenance and readiness; (3) the
// explorer's ReadyCanvasView, which joins the two; (4) this model; (5) the DOM, SVG and CSS. A lower layer never
// overrides a higher one. Concretely, this file:
//  - builds nodes and edges only from relationships the bundle or the MCP results state explicitly (observation.sourceId,
//    assertion.observationIds, derivation inputs and output, evaluation dependencies, conflictsWith, supersededBy,
//    source.authorityId, the identity value's issuerAuthorityId, and the exact subject values of each claim);
//  - copies every evaluated state verbatim (formatting it as a CSS-friendly name is all it does); an assertion without an
//    evaluation is "unavailable", never UNKNOWN; a structural piece carries no state ("neutral"), never its neighbour's;
//  - takes Trace emphasis from `view.provenance` (trace_provenance) only;
//  - never reads the clock, randomness, storage or the network, and never mutates the view.
// Layout (positions, sizes, staggering) is presentation: deterministic from the topology alone, recomputed per render.
//
// The node language follows walletwall-coinstellation (Wallet-Wall/walletwall-coinstellation@3ff0942, MIT): compact
// circular nodes, straight connectors, a selection ring, connected-node highlighting and muting. Its demo taxonomy
// (wallet, token, defi, nft, counterparty) is not used; WWEP entities are.

export const COINSTELLATION_VIEW_VERSION = "1";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
export const short = (s, n = 18) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const ASSERTION_LABELS = {
  ASSET_IDENTITY: "Asset identity",
  TOKEN_BALANCE_AT_BLOCK: "Balance at block",
  TOKEN_USD_PRICE: "USD price",
  TOKEN_USD_VALUE: "USD value",
  VAULT_TECHNICAL_READINESS: "Vault readiness",
};
export const SOURCE_KIND_LABELS = {
  CHAIN_STATE: "Chain state",
  ISSUER_PUBLICATION: "Issuer publication",
  PROVIDER_ENDPOINT: "Provider endpoint",
  USER_INPUT: "User input",
  WALLETWALL_RULES: "WalletWall rules",
};
/** Short words for a piece's label on The Wall. Exact values live in the detail surface. */
const SOURCE_SHORT = { CHAIN_STATE: "Chain state", ISSUER_PUBLICATION: "Issuer source", PROVIDER_ENDPOINT: "Provider", USER_INPUT: "User input", WALLETWALL_RULES: "Rules" };
const CLAIM_SHORT = { ASSET_IDENTITY: "Identity", TOKEN_BALANCE_AT_BLOCK: "Balance", TOKEN_USD_PRICE: "Price", TOKEN_USD_VALUE: "USD value", VAULT_TECHNICAL_READINESS: "Readiness" };
const OBS_SHORT = { ASSET_IDENTITY: "Identity obs", TOKEN_BALANCE_AT_BLOCK: "Balance obs", TOKEN_USD_PRICE: "Price obs", TOKEN_USD_VALUE: "Value obs", VAULT_TECHNICAL_READINESS: "Readiness obs" };
const GAP_SHORT = { source: "Missing source", observation: "Missing obs", assertion: "Missing input", readiness: "Missing input" };

/** What each kind of piece is. `entity` is the contract's entity type; `name` is the plain-language name. */
export const NODE_TYPES = {
  authority: { name: "Issuer or protocol authority", entity: "authority" },
  source: { name: "Source", entity: "source" },
  observation: { name: "Observation", entity: "observation" },
  wallmark: { name: "Wallmark", entity: "wallmark" },
  assertion: { name: "Assertion", entity: "assertion" },
  derivation: { name: "WalletWall derivation", entity: "derivation" },
  readiness: { name: "Vault readiness", entity: "readiness" },
  conflict: { name: "Conflict", entity: "conflict" },
  gap: { name: "Missing piece", entity: "gap" },
  snapshot: { name: "Snapshot slot", entity: "snapshot" },
  stablecoin: { name: "Stablecoin", entity: "subject" },
  contract: { name: "Contract", entity: "subject" },
  wallet: { name: "Wallet", entity: "subject" },
  chain: { name: "Chain", entity: "subject" },
};

/**
 * Connections. Every edge points from the thing a piece rests on to the piece resting on it. `why` marks the evidence
 * relationships; `relationship` is the contract's relationship name.
 */
export const EDGE_KINDS = {
  speaks: { name: "speaks through", why: true, relationship: "authority-source" },
  observed: { name: "observed", why: true, relationship: "source-observation" },
  supports: { name: "supports", why: true, relationship: "observation-assertion" },
  input: { name: "is an input to", why: true, relationship: "assertion-derivation" },
  generates: { name: "generates", why: true, relationship: "derivation-assertion" },
  missing: { name: "is missing for", why: true, relationship: "other-explicit" },
  conflict: { name: "conflicts at", why: true, relationship: "other-explicit" },
  supersedes: { name: "is superseded by", why: true, relationship: "other-explicit" },
  names: { name: "names", why: false, relationship: "subject-claim" },
  issuer: { name: "is named as issuer by", why: false, relationship: "other-explicit" },
  subject: { name: "is the subject of", why: false, relationship: "subject-claim" },
  anchors: { name: "anchors", why: false, relationship: "subject-claim" },
  reserved: { name: "reserves", why: false, relationship: "other-explicit" },
};

export const KNOWN_STATES = ["ESTABLISHED", "SUPPORTED", "PARTIAL", "CONFLICTING", "STALE", "SUPERSEDED", "UNKNOWN", "NOT_ESTABLISHED"];
export const KNOWN_CLASSES = ["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"];
/** A state as printed on a piece: a WWEP value, or a plain phrase; never an unknown string passed through. */
export const stateText = (s) => (s === null || s === undefined ? "no evaluation" : KNOWN_STATES.includes(s) ? s : "not recognised");
export const classText = (c) => (c === undefined || c === null ? "not assessed" : KNOWN_CLASSES.includes(c) ? c : "not recognised");
/** The CSS-friendly visual state: formatting of the returned value, nothing more. */
const visualState = (s) => (s === null ? "unavailable" : s === undefined ? "neutral" : KNOWN_STATES.includes(s) ? s.toLowerCase().replace("_", "-") : "unrecognised");

/**
 * How much geometry each kind of piece carries. Anchors (the Wallmark, claims, a conflict, the readiness keystone) are
 * the plate's strong objects; facts (observations, WalletWall's rule, a missing piece) are light drafting marks; context
 * (authorities, sources, subjects, the snapshot slot) is an index mark and its name. Presentation only.
 */
export const TIER = { wallmark: "anchor", assertion: "anchor", conflict: "anchor", readiness: "anchor", observation: "fact", derivation: "fact", gap: "fact", authority: "context", source: "context", snapshot: "context", chain: "context", contract: "context", wallet: "context", stablecoin: "context" };
/** The visual radius of each kind's mark (anchors' discs, light marks' extent); the readiness keystone is a box. */
export const NODE_R = { wallmark: 26, assertion: 18, conflict: 15, observation: 8.5, derivation: 6.5, gap: 6.5, authority: 5, source: 2.5, snapshot: 4.5, chain: 5, contract: 5, wallet: 5, stablecoin: 3.5 };
export const KEYSTONE = { w: 96, h: 50 };
/**
 * The line class of each connection: evidence into claims and WalletWall's rule is primary; leaders from sources and
 * authorities, missing inputs and supersession are secondary; subjects and names are references; the snapshot
 * reservation is construction. Trace and focus are emphasis on top of these, never a class of their own.
 */
export const LINE_CLASS = { supports: "primary", input: "primary", generates: "primary", conflict: "conflict", observed: "secondary", speaks: "secondary", missing: "secondary", supersedes: "secondary", subject: "reference", anchors: "reference", names: "reference", issuer: "reference", reserved: "construction" };
/** The touch target around a piece: never smaller than 44 px at the scale the page draws The Wall (a phone draws the
 * tall plate at about 0.87, so 52 units is about 45 px), however small the piece's visible mark. */
export const HIT = 52;
const LABEL_EM = 0.6;
const LABEL_PX = 11.5;

/** The accessible name of a piece: what it is, its label, and its state in words. Addresses and IDs are given in full. */
export function nodeName(n) {
  const type = NODE_TYPES[n.type]?.name ?? n.type;
  const parts = [`${type}: ${n.address ?? n.exactValue ?? n.label}`];
  if (n.type === "wallmark" || n.type === "assertion" || n.type === "readiness") parts.push(`assertion ${n.assertionId}`);
  if (n.chainId) parts.push(`chain ID ${n.chainId}`);
  if (n.type === "readiness") parts.push(n.readinessError ? `readiness not assessed (${n.readinessError})` : `readiness ${classText(n.classification)}`);
  if (n.wwepState !== undefined) parts.push(n.wwepState === null ? "no evaluation returned" : `support ${stateText(n.wwepState)}`);
  if (n.freshness) parts.push(`freshness ${KNOWN_FRESHNESS.includes(n.freshness) ? n.freshness : "not recognised"}`);
  if (n.superseded) parts.push("superseded");
  if (n.missing) parts.push(n.type === "observation" ? `result ${n.data?.result ?? "unknown"}, not a value` : "missing");
  if (n.unattested) parts.push("named by the claim, no source in the bundle");
  if (n.type === "snapshot") parts.push("reserved for immutable snapshots, not available yet");
  return parts.join(", ");
}
const KNOWN_FRESHNESS = ["CURRENT", "STALE", "PINNED", "UNKNOWN_FRESHNESS"];

/** Words of the piece's state annotation: the returned value, or nothing for a piece that carries no state. */
function chipOf(n) {
  if (n.type === "readiness") return { text: n.readinessError ? "not assessed" : classText(n.classification), second: stateText(n.wwepState), attention: n.classification !== "CRITERIA_MET" };
  if (n.wwepState !== undefined) return { text: stateText(n.wwepState), attention: !["ESTABLISHED", "SUPPORTED"].includes(n.wwepState) };
  if (n.type === "observation" && n.missing) return { text: String(n.data?.result ?? "no value").replaceAll("_", " ").toLowerCase(), attention: true };
  if (n.type === "gap" || n.unattested) return { text: n.unattested ? "no source" : "missing", attention: true };
  if (n.type === "snapshot") return { text: "reserved", attention: false };
  return null;
}

/**
 * The pure adapter. `view` is the explorer's ReadyCanvasView; `presentation` is presentation-only state (mode, local
 * visual focus, viewport class); it changes emphasis, never evidence. The view is read, never written.
 */
export function buildCoinstellation(view, presentation = {}) {
  const nodes = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const add = (id, type, fields) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, entityType: NODE_TYPES[type].entity, ...fields });
    return nodes.get(id);
  };
  const link = (from, to, kind) => {
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (from === to || edgeKeys.has(key) || !nodes.has(from) || !nodes.has(to)) return;
    edgeKeys.add(key);
    edges.push({ id: `${from}>${to}:${kind}`, from, to, kind, source: from, target: to, relationship: EDGE_KINDS[kind].relationship, activeTrace: false, muted: false });
  };

  const sources = list(view.sources).filter(isObject);
  const observations = list(view.observations).filter(isObject);
  const assertions = list(view.assertions).filter(isObject);
  const derivations = list(view.derivations).filter(isObject);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const obsById = new Map(observations.map((o) => [o.id, o]));
  const assertionIds = new Set(assertions.map((a) => a.id));
  const claimTypeOf = new Map(assertions.map((a) => [a.id, a.claimType]));

  // Authorities exist only where the bundle names one (source.authorityId, the identity's issuerAuthorityId). Transport is
  // an attribute of a source, never an authority.
  for (const s of sources) {
    const auth = typeof s.authorityId === "string" && s.authorityId !== "" ? s.authorityId : null;
    if (auth) add(`auth:${auth}`, "authority", { label: "Authority", exactValue: auth, semanticRef: { type: "authority", id: auth }, data: { authorityId: auth } });
    add(`src:${s.id}`, "source", { label: SOURCE_SHORT[s.kind] ?? "Source", exactValue: String(s.id), semanticRef: { type: "source", id: String(s.id) }, data: s });
    if (auth) link(`auth:${auth}`, `src:${s.id}`, "speaks");
  }

  // Observations. A source an observation names but the bundle lacks is a missing piece, never filled in.
  for (const o of observations) {
    add(`obs:${o.id}`, "observation", { label: "Observation", exactValue: String(o.id), semanticRef: { type: "observation", id: String(o.id) }, missing: o.result !== "VALUE", data: o });
    if (sourceById.has(o.sourceId)) link(`src:${o.sourceId}`, `obs:${o.id}`, "observed");
    else {
      add(`gap:src:${o.sourceId}`, "gap", { label: GAP_SHORT.source, exactValue: String(o.sourceId), gapFor: "source", missing: true, semanticRef: { type: "source", id: String(o.sourceId) }, data: { id: o.sourceId } });
      link(`gap:src:${o.sourceId}`, `obs:${o.id}`, "missing");
    }
  }

  // Assertions, each carrying exactly the evaluation inspect_evidence returned (or none).
  const claimCount = {};
  for (const a of assertions) {
    const e = a.evaluation ?? null;
    const type = a.claimType === "ASSET_IDENTITY" ? "wallmark" : a.claimType === "VAULT_TECHNICAL_READINESS" ? "readiness" : "assertion";
    const word = CLAIM_SHORT[a.claimType] ?? "Claim";
    claimCount[word] = (claimCount[word] ?? 0) + 1;
    const symbol = type === "wallmark" && isObject(a.value) && typeof a.value.symbol === "string" ? a.value.symbol : undefined;
    add(`as:${a.id}`, type, {
      label: type === "wallmark" ? `Wallmark${symbol ? ` · ${short(symbol, 8)}` : ""}` : type === "readiness" ? "Readiness" : claimCount[word] > 1 ? `${word} · ${claimCount[word]}` : word,
      exactValue: String(a.id),
      semanticRef: type === "wallmark" ? { type: "wallmark", assertionId: a.id } : type === "readiness" ? { type: "readiness", assertionId: a.id } : { type: "assertion", id: a.id },
      wwepState: e ? e.supportState : null,
      freshness: e ? e.freshnessState : undefined,
      assertionId: a.id,
      superseded: Boolean(e?.supersededBy),
      symbol,
      data: a,
    });
  }
  for (const a of assertions) {
    const raw = list(a.observationIds);
    const evaluated = list(a.evaluation?.dependencies?.observationIds);
    for (const id of [...raw, ...evaluated.filter((x) => !raw.includes(x))]) {
      if (obsById.has(id)) link(`obs:${id}`, `as:${a.id}`, "supports");
      else {
        add(`gap:obs:${id}`, "gap", { label: GAP_SHORT.observation, exactValue: String(id), gapFor: "observation", missing: true, semanticRef: { type: "observation", id: String(id) }, data: { id } });
        link(`gap:obs:${id}`, `as:${a.id}`, "missing");
      }
    }
  }
  // An observation is labelled by the claim it supports (explicitly, through assertion.observationIds).
  for (const n of nodes.values()) {
    if (n.type !== "observation") continue;
    const supported = edges.filter((e) => e.from === n.id && e.kind === "supports").map((e) => claimTypeOf.get(e.to.slice(3)));
    const kinds = [...new Set(supported)];
    n.label = kinds.length === 1 ? (OBS_SHORT[kinds[0]] ?? "Observation") : "Observation";
  }

  // WalletWall derivations: inputs into the derivation, the derivation into the assertion it generated.
  for (const d of derivations) {
    add(`drv:${d.id}`, "derivation", { label: "WalletWall rule", exactValue: String(d.ruleId ?? d.id), semanticRef: { type: "derivation", id: String(d.id) }, data: d });
    for (const id of list(d.inputAssertionIds)) {
      if (assertionIds.has(id)) link(`as:${id}`, `drv:${d.id}`, "input");
      else {
        add(`gap:as:${id}`, "gap", { label: GAP_SHORT.assertion, exactValue: String(id), gapFor: "assertion", missing: true, semanticRef: { type: "assertion", id: String(id) }, data: { id } });
        link(`gap:as:${id}`, `drv:${d.id}`, "missing");
      }
    }
    if (assertionIds.has(d.outputAssertionId)) link(`drv:${d.id}`, `as:${d.outputAssertionId}`, "generates");
  }
  // Input assertions an evaluation names that no derivation record carries.
  for (const a of assertions) {
    for (const id of list(a.evaluation?.dependencies?.assertionIds)) {
      const viaDerivation = derivations.some((d) => d.outputAssertionId === a.id && list(d.inputAssertionIds).includes(id));
      if (!viaDerivation && assertionIds.has(id)) link(`as:${id}`, `as:${a.id}`, "input");
    }
  }
  // Conflicts exactly as the MCP server returned them: a conflict piece between the two claims. No winner is chosen.
  for (const a of assertions) {
    for (const other of list(a.evaluation?.conflictsWith)) {
      if (!assertionIds.has(other)) continue;
      const [x, y] = [a.id, other].sort();
      const id = `conflict:${x}|${y}`;
      add(id, "conflict", { label: "Conflict", exactValue: `${x} / ${y}`, semanticRef: { type: "assertion", id: x }, between: [x, y], data: { between: [x, y] } });
      link(`as:${x}`, id, "conflict");
      link(`as:${y}`, id, "conflict");
    }
  }
  // Supersession: the earlier piece stays, as history, next to the one that replaced it.
  for (const a of assertions) {
    const by = a.evaluation?.supersededBy;
    if (typeof by === "string" && assertionIds.has(by)) link(`as:${a.id}`, `as:${by}`, "supersedes");
  }
  // Readiness: the keystone carries view.readiness verbatim, or the error the explorer recorded; it is never recomputed.
  const readiness = view.readiness;
  for (const n of nodes.values()) {
    if (n.type !== "readiness") continue;
    if (isObject(readiness) && readiness.assertionId === n.assertionId) {
      if (isObject(readiness.result)) n.classification = readiness.result.classification;
      if (typeof readiness.errorCode === "string") n.readinessError = readiness.errorCode;
    }
  }
  if (isObject(readiness) && typeof readiness.errorCode === "string" && nodes.has(`as:${readiness.assertionId}`)) {
    add("gap:readiness-input", "gap", { label: GAP_SHORT.readiness, exactValue: readiness.errorCode, gapFor: "readiness", missing: true, semanticRef: { type: "readiness", assertionId: readiness.assertionId }, data: { code: readiness.errorCode } });
    link("gap:readiness-input", `as:${readiness.assertionId}`, "missing");
  }
  for (const n of [...nodes.values()]) {
    if (n.type !== "readiness") continue;
    add("snapshot:reserved", "snapshot", { label: "Snapshot slot", semanticRef: { type: "readiness", assertionId: n.assertionId }, data: {} });
    link(n.id, "snapshot:reserved", "reserved");
  }

  // Subjects: a visual convenience grouping exactly equal subject values already in the bundle (no fuzzy matching).
  for (const a of assertions) {
    const s = isObject(a.subject) ? a.subject : {};
    const chain = typeof s.chainId === "string" ? s.chainId : null;
    const chainNode = chain === null ? null : add(`chain:${chain}`, "chain", { label: `Chain ${short(chain, 7)}`, exactValue: chain, chainId: chain, semanticRef: { type: "subject", key: `chain:${chain}` }, data: { chainId: chain } }).id;
    const contract = a.claimType === "ASSET_IDENTITY" ? s.address : a.claimType === "VAULT_TECHNICAL_READINESS" ? undefined : s.token;
    if (typeof contract === "string") {
      const id = `contract:${chain ?? "?"}|${contract}`;
      add(id, "contract", { label: "Contract", address: contract, exactValue: contract, chainId: chain, semanticRef: { type: "subject", key: id }, data: { address: contract, chainId: chain } });
      if (chainNode) link(chainNode, id, "anchors");
      link(id, `as:${a.id}`, "subject");
    }
    if (a.claimType === "TOKEN_BALANCE_AT_BLOCK" && typeof s.holder === "string") {
      const id = `wallet:${chain ?? "?"}|${s.holder}`;
      add(id, "wallet", { label: "Wallet", address: s.holder, exactValue: s.holder, chainId: chain, semanticRef: { type: "subject", key: id }, data: { address: s.holder, chainId: chain } });
      if (chainNode) link(chainNode, id, "anchors");
      link(id, `as:${a.id}`, "subject");
    }
    if (a.claimType === "ASSET_IDENTITY" && isObject(a.value)) {
      if (typeof a.value.symbol === "string") {
        const id = `asset:${chain ?? "?"}|${String(s.address ?? "")}|${a.value.symbol}`;
        add(id, "stablecoin", { label: short(a.value.symbol, 10), exactValue: a.value.symbol, semanticRef: { type: "subject", key: id }, data: { symbol: a.value.symbol, decimals: a.value.decimals, chainId: chain, address: s.address } });
        link(`as:${a.id}`, id, "names");
      }
      if (typeof a.value.issuerAuthorityId === "string") {
        const id = `auth:${a.value.issuerAuthorityId}`;
        if (!nodes.has(id)) add(id, "authority", { label: "Issuer", exactValue: a.value.issuerAuthorityId, unattested: true, semanticRef: { type: "authority", id: a.value.issuerAuthorityId }, data: { authorityId: a.value.issuerAuthorityId } });
        else nodes.get(id).label = "Issuer";
        link(id, `as:${a.id}`, "issuer");
      }
    }
  }

  const all = [...nodes.values()];
  for (const n of all) {
    n.state = n.type === "readiness" || n.type === "wallmark" || n.type === "assertion" ? visualState(n.wwepState) : "neutral";
    n.primary = n.type === "wallmark" || n.type === "readiness" || n.assertionId === view.selectedId;
    n.chip = chipOf(n);
    n.accessibleLabel = nodeName(n);
  }

  // Trace: the edges and pieces the MCP provenance of the selected assertion names, and nothing else.
  const trace = traceFromProvenance(view, all, edges);
  for (const e of edges) e.activeTrace = trace.edges.has(e.id);
  for (const n of all) n.onTrace = trace.nodes.has(n.id);

  const story = dominantStory(view, all);
  // A derivation between two pieces of the story belongs to it (the Wallmark feeds readiness through one).
  const inStory = new Set(story.path);
  for (const n of all) {
    if (n.type !== "derivation") continue;
    const ins = edges.filter((e) => e.to === n.id && inStory.has(e.from)).length;
    const outs = edges.filter((e) => e.from === n.id && inStory.has(e.to)).length;
    if (ins && outs) story.path.push(n.id);
  }
  const focus = typeof presentation.visualFocusId === "string" && nodes.has(presentation.visualFocusId) ? presentation.visualFocusId : null;
  const model = {
    coinstellationViewVersion: COINSTELLATION_VIEW_VERSION,
    nodes: all,
    edges,
    authoritativeSelectedAssertionId: typeof view.selectedId === "string" ? view.selectedId : null,
    visualFocusId: focus,
    mode: presentation.mode === "trace" || presentation.mode === "list" ? presentation.mode : "overview",
    dominantStory: story.story,
    storyTarget: story.target,
    storyPath: story.path,
  };
  layoutCoinstellation(model);
  for (const n of all) {
    const p = presentation.viewportClass === "mobile" || presentation.viewportClass === "tablet" ? n.tall : n.wide;
    n.x = p.x;
    n.y = p.y;
  }
  return model;
}

/**
 * Maps the trace_provenance result of the selected assertion onto the pieces: entities ww:assertion/<id> and ww:obs/<id>,
 * activities ww:derivation/<id>, agents ww:source/<id>. An edge is on the trace only where a provenance relation backs it.
 */
function traceFromProvenance(view, nodes, edges) {
  const none = { nodes: new Set(), edges: new Set() };
  const trace = view.provenance;
  if (!isObject(trace) || !isObject(trace.prov) || trace.target !== view.selectedId) return none;
  const prov = trace.prov;
  const ref = (id) => {
    const m = /^ww:(assertion|obs|derivation|source)\/(.+)$/.exec(String(id));
    return m ? `${{ assertion: "as", obs: "obs", derivation: "drv", source: "src" }[m[1]]}:${m[2]}` : null;
  };
  const backed = new Set();
  const pair = (a, b) => (a && b ? backed.add(`${a}\u0000${b}`) : undefined);
  for (const r of Object.values(isObject(prov.wasAttributedTo) ? prov.wasAttributedTo : {})) pair(ref(r?.["prov:agent"]), ref(r?.["prov:entity"]));
  for (const r of Object.values(isObject(prov.wasDerivedFrom) ? prov.wasDerivedFrom : {})) pair(ref(r?.["prov:usedEntity"]), ref(r?.["prov:generatedEntity"]));
  for (const r of Object.values(isObject(prov.wasGeneratedBy) ? prov.wasGeneratedBy : {})) pair(ref(r?.["prov:activity"]), ref(r?.["prov:entity"]));
  for (const r of Object.values(isObject(prov.used) ? prov.used : {})) pair(ref(r?.["prov:entity"]), ref(r?.["prov:activity"]));
  // An authority speaks through a source on the trace only where the source's provenance record names that authority.
  for (const [id, a] of Object.entries(isObject(prov.agent) ? prov.agent : {})) {
    const src = ref(id);
    if (src && isObject(a) && typeof a["ww:authorityId"] === "string") pair(`auth:${a["ww:authorityId"]}`, src);
  }
  const out = { nodes: new Set(), edges: new Set() };
  const target = `as:${view.selectedId}`;
  if (nodes.some((n) => n.id === target)) out.nodes.add(target);
  for (const e of edges) {
    if (!EDGE_KINDS[e.kind].why || !backed.has(`${e.from}\u0000${e.to}`)) continue;
    out.edges.add(e.id);
    out.nodes.add(e.from);
    out.nodes.add(e.to);
  }
  return out;
}

/**
 * The dominant story, for emphasis only: a fixed precedence over states the MCP server returned. It never changes a state.
 * conflict > invariant violation on a focal claim > stale focal claim > not established, unknown or partial focal claim
 * > established or supported identity.
 */
function dominantStory(view, nodes) {
  const conflict = nodes.find((n) => n.type === "conflict");
  const conflicting = nodes.filter((n) => n.wwepState === "CONFLICTING" && n.type !== "readiness");
  if (conflict || conflicting.length) {
    const path = conflict ? [conflict.id, ...conflict.between.map((x) => `as:${x}`)] : conflicting.map((n) => n.id);
    return { story: "conflict", target: conflict ? conflict.id : conflicting[0].id, path };
  }
  const focal = nodes.filter((n) => n.type === "wallmark" || n.type === "readiness" || n.assertionId === view.selectedId);
  const focalIds = new Set(focal.map((n) => n.assertionId));
  if (list(view.invariantViolations).some((v) => isObject(v) && focalIds.has(v.assertionId))) {
    const n = focal.find((f) => list(view.invariantViolations).some((v) => v?.assertionId === f.assertionId));
    return { story: "other", target: n.id, path: [n.id] };
  }
  const stale = focal.find((n) => n.wwepState === "STALE" || n.freshness === "STALE");
  if (stale) return { story: "stale", target: stale.id, path: focal.filter((n) => n.wwepState === "STALE" || n.freshness === "STALE").map((n) => n.id) };
  const weak = focal.find((n) => ["UNKNOWN", "NOT_ESTABLISHED", "PARTIAL"].includes(n.wwepState) || n.wwepState === null);
  if (weak) return { story: weak.wwepState === "PARTIAL" ? "other" : "unknown", target: weak.id, path: [weak.id] };
  const mark = nodes.find((n) => n.type === "wallmark" && (n.wwepState === "ESTABLISHED" || n.wwepState === "SUPPORTED"));
  if (mark) {
    const keystone = nodes.find((n) => n.type === "readiness");
    return { story: "established", target: mark.id, path: keystone ? [mark.id, keystone.id] : [mark.id] };
  }
  return { story: null, target: null, path: [] };
}

// ---- Layout ----------------------------------------------------------------------------------------------------------
// Two deterministic coordinate sets from the topology alone: "wide" (reads left to right, for desktop and landscape) and
// "tall" (reads top to bottom, for phones and portrait tablets). Pieces are ranked by what they rest on, ordered within a
// rank to reduce crossings, and subjects (chain, contract, wallet, stablecoin) are placed where their connections cross
// least. No simulation runs, here or in the page.

const EVIDENCE = new Set(["speaks", "observed", "supports", "input", "generates", "missing"]);
const BASE_RANK = { authority: 0, source: 1, observation: 2, assertion: 3, wallmark: 3, conflict: 3, derivation: 4, readiness: 3, snapshot: 3 };
const SUBJECT = new Set(["chain", "contract", "wallet", "stablecoin"]);

const labelWidth = (text, px = LABEL_PX) => String(text).length * px * LABEL_EM;
/** The width of a state annotation (small capitals, tracked) as the renderer draws it. */
export const annotWidth = (text) => String(text).length * 6.6;
/** Where a piece's label sits (its baseline below the centre); the state annotation follows ANNOT_STEP lower. */
export const ANNOT_STEP = 11.5;
export const labelY = (n) => (TIER[n.type] === "anchor" ? (NODE_R[n.type] ?? 14) + 17 : (NODE_R[n.type] ?? 14) + 15.5);
/**
 * A piece's footprint around its centre, as boxes [x0, y0, x1, y1]: the touch target, the label and the state
 * annotation. Used for
 * spacing (no two pieces' boxes may meet) and for the frame.
 */
export function footprint(n) {
  const keystone = n.type === "readiness";
  const r = keystone ? KEYSTONE.h / 2 : NODE_R[n.type] ?? 14;
  const hw = keystone ? Math.max(HIT, KEYSTONE.w + 4) / 2 : Math.max(HIT, 2 * r + 8) / 2;
  const hh = keystone ? Math.max(HIT, KEYSTONE.h + 4) / 2 : Math.max(HIT, 2 * r + 8) / 2;
  const boxes = [[-hw, -hh, hw, hh]];
  if (!keystone) {
    const lw = labelWidth(n.label) / 2 + 2;
    const ly = labelY(n);
    boxes.push([-lw, ly - 11, lw, ly + 4]);
    if (n.chip) {
      const aw = annotWidth(n.chip.text) / 2 + 2;
      boxes.push([-aw, ly + ANNOT_STEP - 9, aw, ly + ANNOT_STEP + 3]);
    }
  } else if (n.chip) {
    // Two lines under the keystone: the classification, centred; then the "support" key ending just left of the centre
    // and the claim's state starting just right of it (both a size smaller).
    const aw = annotWidth(n.chip.text) / 2 + 2;
    const y = KEYSTONE.h / 2 + 19;
    boxes.push([-aw, y - 9, aw, y + 3]);
    boxes.push([-(3 + annotWidth("support") * 0.9) - 2, y + ANNOT_STEP - 8, 2 + annotWidth(n.chip.second) * 0.9 + 2, y + ANNOT_STEP + 3]);
  }
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const x1 = Math.max(...boxes.map((b) => b[2]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const y1 = Math.max(...boxes.map((b) => b[3]));
  return { boxes, w: x1 - x0, x0, x1, top: -y0, bottom: y1, r };
}

/** Whether two pieces' footprints meet (with a small gap), at the given centres. */
function collide(a, pa, b, pb, gap = 6) {
  for (const p of a._f.boxes) for (const q of b._f.boxes) {
    if (pa.x + p[0] < pb.x + q[2] + gap && pb.x + q[0] < pa.x + p[2] + gap && pa.y + p[1] < pb.y + q[3] + gap && pb.y + q[1] < pa.y + p[3] + gap) return true;
  }
  return false;
}

function ranks(model) {
  const { nodes, edges } = model;
  const rank = new Map();
  for (const n of nodes) if (!SUBJECT.has(n.type)) rank.set(n.id, n.type === "gap" ? { source: 1, observation: 2, assertion: 3, readiness: 3 }[n.gapFor] ?? 2 : BASE_RANK[n.type] ?? 2);
  const ev = edges.filter((e) => EVIDENCE.has(e.kind) && rank.has(e.from) && rank.has(e.to));
  // Longest path, bounded (a bundle may declare a cycle; the bound keeps the layout finite and deterministic).
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    for (const e of ev) {
      const want = Math.min(rank.get(e.from) + 1, 12);
      if (rank.get(e.to) < want) {
        rank.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of nodes) {
    if (n.type === "conflict") rank.set(n.id, Math.max(...n.between.map((x) => rank.get(`as:${x}`) ?? 3)));
    if (n.type === "gap" && n.gapFor === "readiness") {
      const k = edges.find((e) => e.from === n.id);
      if (k && rank.has(k.to)) rank.set(n.id, Math.max(0, rank.get(k.to) - 1));
    }
  }
  for (const e of edges) if (e.kind === "reserved" && rank.has(e.from)) rank.set(e.to, rank.get(e.from));
  for (const e of edges) if (e.kind === "supersedes" && rank.has(e.from) && rank.has(e.to)) rank.set(e.to, Math.max(rank.get(e.to), rank.get(e.from)));
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const columns = used.map(() => []);
  for (const n of nodes) if (rank.has(n.id)) columns[used.indexOf(rank.get(n.id))].push(n);
  return columns;
}

/** Keeps a conflict piece between the two claims it joins, and a superseded claim next to its replacement. */
function fixBlocks(col, model) {
  for (const c of col.filter((n) => n.type === "conflict")) {
    const pair = c.between.map((x) => col.find((n) => n.id === `as:${x}`)).filter(Boolean);
    if (pair.length !== 2) continue;
    for (const p of [c, ...pair]) col.splice(col.indexOf(p), 1);
    pair.sort((a, b) => a._i - b._i);
    const at = Math.min(pair[0]._i, col.length);
    col.splice(at, 0, pair[0], c, pair[1]);
  }
  for (const e of model.edges.filter((x) => x.kind === "supersedes")) {
    const a = col.find((n) => n.id === e.from);
    const b = col.find((n) => n.id === e.to);
    if (!a || !b) continue;
    col.splice(col.indexOf(b), 1);
    col.splice(col.indexOf(a) + 1, 0, b);
  }
  col.forEach((n, i) => (n._i = i));
}

const segX = (a, b, c, d) => {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
};
/** Squared distance from point p to segment ab. */
const segDist2 = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
};

/** The geometric cost of a placement: crossings, connectors running through other pieces, colliding pieces, length. */
function cost(model, pos) {
  const { edges, nodes } = model;
  let crossings = 0;
  let through = 0;
  let length = 0;
  let collisions = 0;
  for (let i = 0; i < edges.length; i++) {
    const a = pos.get(edges[i].from);
    const b = pos.get(edges[i].to);
    if (!a || !b) continue;
    // Foundation connections should stay short: subjects sit near the claims they are the subjects of, and together.
    length += Math.hypot(a.x - b.x, a.y - b.y) * (EDGE_KINDS[edges[i].kind].why ? 1 : 3);
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[j];
      if (e.from === edges[i].from || e.from === edges[i].to || e.to === edges[i].from || e.to === edges[i].to) continue;
      const c = pos.get(e.from);
      const d = pos.get(e.to);
      if (c && d && segX(a, b, c, d)) crossings++;
    }
    for (const n of nodes) {
      if (n.id === edges[i].from || n.id === edges[i].to) continue;
      const p = pos.get(n.id);
      if (!p) continue;
      const r = (n.type === "readiness" ? KEYSTONE.w / 2 : n._f.r) + 7;
      if (segDist2(p, a, b) < r * r) through++;
      // A connector across a piece's label.
      if (n.type !== "readiness" && segDist2({ x: p.x, y: p.y + labelY(n) - 4 }, a, b) < 49) through += 0.5;
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const pa = pos.get(nodes[i].id);
    if (!pa) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const pb = pos.get(nodes[j].id);
      if (pb && collide(nodes[i], pa, nodes[j], pb)) collisions++;
    }
  }
  return { total: crossings * 100 + through * 140 + collisions * 400 + length * 0.02, crossings, through, collisions };
}

function arrange(model, columns, opt) {
  // opt: main axis ("x" ranks left to right, "y" top to bottom), step between ranks, cross span, staggering of crowded
  // ranks, the minimum gap between pieces of a short rank, and where the foundation course for subjects lies.
  const { nodes, edges } = model;
  const neighbours = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    neighbours.get(e.from)?.push(e.to);
    neighbours.get(e.to)?.push(e.from);
  }
  for (const n of nodes) n._f = footprint(n);
  const toXY = (main, cross) => (opt.main === "x" ? { x: main, y: cross } : { x: cross, y: main });
  // The evaluation axis: WalletWall's rule and the readiness keystone it generates stand on the Wallmark's line when the
  // Wallmark is an input to that rule, so the plate reads Wallmark, rule, readiness along one constructed axis. The
  // snapshot slot the keystone reserves sits beside it, toward the middle. A piece that would meet a neighbour stays.
  const W = nodes.find((n) => n.type === "wallmark");
  const K = nodes.find((n) => n.type === "readiness");
  const axis = W && K ? { on: edges.filter((e) => e.kind === "generates" && e.to === K.id && edges.some((x) => x.kind === "input" && x.from === W.id && x.to === e.from)).map((e) => e.from), slot: edges.find((e) => e.kind === "reserved" && e.from === K.id)?.to } : null;
  if (axis && axis.on.length) axis.on.push(K.id);
  else if (axis) axis.on = [];
  const rankOf = new Map();
  columns.forEach((col, ci) => col.forEach((n) => rankOf.set(n.id, ci)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const snapAxis = () => {
    if (!axis || !axis.on.length || !pos.has(W.id)) return;
    const c = pos.get(W.id).cross;
    for (const id of axis.on) {
      const q = pos.get(id);
      if (!q) continue;
      const n = byId.get(id);
      // The tall plate keeps every piece inside the phone's width, reaching into the margin no further than the
      // Wallmark's own words already do (or a few units); the wide plate's frame grows to fit.
      const [lo, hi] = reach(n);
      const [wl, wh] = reach(W);
      const want = opt.main === "y" ? Math.min(Math.max(c, lo - Math.max(8, wl - c + 1)), opt.span - hi + Math.max(8, c + wh - opt.span + 1)) : c;
      const was = q.cross;
      q.cross = want;
      const mates = columns[rankOf.get(id)].filter((m) => m.id !== id && m.id !== axis.slot && pos.has(m.id));
      if (mates.some((m) => collide(n, toXY(q.main, q.cross), m, toXY(pos.get(m.id).main, pos.get(m.id).cross)))) q.cross = was;
    }
    const s = axis.slot && pos.get(axis.slot);
    const k = pos.get(K.id);
    if (s && k && s.main === k.main) {
      const S = byId.get(axis.slot);
      const down = k.cross < opt.span / 2;
      const d = (down ? reach(K)[1] + reach(S)[0] : reach(K)[0] + reach(S)[1]) + 14;
      s.cross = k.cross + (down ? d : -d);
    }
  };
  // How far a piece reaches either side of its centre along the cross axis.
  const reach = (n) => (opt.main === "x" ? [n._f.top, n._f.bottom] : [-n._f.x0, n._f.x1]);
  const pos = new Map();
  let mains = [];
  let lastMain = 0;
  const place = () => {
    pos.clear();
    // A crowded rank is staggered in two offset rows, just far enough apart that neighbours never meet.
    const offsets = columns.map((col) => {
      const k = col.length;
      if (k >= opt.splitFrom) {
        let sp = opt.split;
        const meets = () => col.some((n, i) => i + 1 < k && collide(n, toXY(-sp, (i + 0.5) * (opt.span / k)), col[i + 1], toXY(sp, (i + 1.5) * (opt.span / k))));
        while (sp < 90 && meets()) sp += 2;
        return sp;
      }
      if (k < opt.staggerFrom || !opt.stagger) return 0;
      // A staggered rank: the offset grows from opt.stagger until no two neighbours' words meet.
      let sp = opt.stagger;
      const at = (i, d) => toXY(i % 2 === 0 ? -d : d, (i + 0.5) * (opt.span / k));
      const meets = () => col.some((n, i) => i + 1 < k && collide(n, at(i, sp), col[i + 1], at(i + 1, sp)));
      while (sp < 44 && meets()) sp += 1;
      return sp;
    });
    // Ranks follow each other at the step, or further where a rank's pieces (offsets, labels, chips) need the room.
    const along = (n) => (opt.main === "x" ? [-n._f.x0, n._f.x1] : [n._f.top, n._f.bottom]);
    const extent = columns.map((col, ci) => {
      let lo = 0;
      let hi = 0;
      col.forEach((n, i) => {
        const off = col.length >= 3 ? (i % 2 === 0 ? -offsets[ci] : offsets[ci]) : 0;
        lo = Math.max(lo, along(n)[0] - off);
        hi = Math.max(hi, along(n)[1] + off);
      });
      return { lo, hi };
    });
    mains = [];
    let at = 0;
    columns.forEach((col, ci) => {
      if (ci > 0) at += Math.max(opt.step, extent[ci - 1].hi + extent[ci].lo + opt.rankGap);
      mains.push(at);
    });
    lastMain = at + (columns.length ? extent[columns.length - 1].hi : 0);
    columns.forEach((col, ci) => {
      const k = col.length;
      if (k < 3) return;
      col.forEach((n, i) => pos.set(n.id, { main: mains[ci] + (i % 2 === 0 ? -offsets[ci] : offsets[ci]), cross: (i + 0.5) * (opt.span / k) }));
    });
    // Short ranks sit beside what they connect to, so their connectors run straight.
    columns.forEach((col, ci) => {
      if (col.length >= 3) return;
      const want = col.map((n) => {
        const ys = neighbours.get(n.id).map((m) => pos.get(m)?.cross).filter((v) => v !== undefined);
        return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : opt.span / 2;
      });
      const lo = (i) => reach(col[i])[0];
      const hi = (i) => opt.span - reach(col[i])[1];
      const ys = want.map((v, i) => Math.min(Math.max(v, lo(i)), hi(i)));
      const gap = (i) => Math.max(opt.minGap, reach(col[i - 1])[1] + reach(col[i])[0] + 10);
      for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1] + gap(i)) ys[i] = ys[i - 1] + gap(i);
      if (ys.length) ys[ys.length - 1] = Math.min(ys[ys.length - 1], hi(ys.length - 1));
      for (let i = ys.length - 2; i >= 0; i--) if (ys[i] > ys[i + 1] - gap(i + 1)) ys[i] = ys[i + 1] - gap(i + 1);
      col.forEach((n, i) => pos.set(n.id, { main: mains[ci], cross: ys[i] }));
    });
    snapAxis();
    for (const s of model._subjects) if (s._slot) pos.set(s.id, s._slot);
  };
  const xy = () => {
    const out = new Map();
    for (const [id, p] of pos) out.set(id, toXY(p.main, p.cross));
    return out;
  };
  const score = () => cost(model, xy()).total;
  const slotsNow = () => {
    const slots = [];
    const crosses = [];
    for (let c = opt.minGap / 2; c <= opt.span - opt.minGap / 2 + 1e-6; c += opt.minGap / 2) crosses.push(c);
    const mainSlots = [];
    for (let i = 0; i < mains.length; i++) {
      mainSlots.push(mains[i]);
      // Between two ranks: the midpoint, or in the wide plate one lane a little past it, so a context column clears
      // the claims' words and stands as one straight axis.
      if (i + 1 < mains.length) mainSlots.push(mains[i] + (mains[i + 1] - mains[i]) * (opt.main === "x" ? 0.62 : 0.5));
    }
    mainSlots.push(lastMain + opt.step / 2 + 20, -opt.step / 2);
    // In the wide plate, subjects stand in the context column beside the claims (or on the course below), so the field
    // past WalletWall's rule stays open.
    const claimsAt = columns.findIndex((col) => col.some((n) => n.type === "assertion" || n.type === "wallmark"));
    const until = opt.main === "x" && claimsAt >= 0 && claimsAt + 1 < mains.length ? mains[claimsAt + 1] - 1 : Infinity;
    // Subjects belong with the claims they are the subjects of: the free room from the claims' rank on, and a foundation
    // course below the evidence (wide) or after the last rank (tall). Never among the sources.
    // In the wide plate subjects stand from the claims' column on, so the evidence rows (source, observation, claim)
    // stay clear; the tall plate also allows the row just before the claims.
    const claims = columns.findIndex((col) => col.some((n) => n.type === "assertion" || n.type === "wallmark"));
    const from = claims < 1 ? -Infinity : opt.main === "x" ? mains[claims] : (mains[claims - 1] + mains[claims]) / 2;
    for (const m of mainSlots) if (m >= from - 1e-6 && m <= until) for (const c of crosses) slots.push({ main: m, cross: c });
    if (opt.foundation) for (const m of mainSlots) if (m >= from - 1e-6 && m <= until) slots.push({ main: m, cross: opt.span + opt.foundation });
    else for (const m of [lastMain + opt.step / 2 + 20]) for (const c of crosses) slots.push({ main: m, cross: c });
    return slots;
  };
  const placeSubjects = () => {
    for (const s of model._subjects) s._slot = null;
    for (const s of model._subjects) {
      place();
      const base = xy();
      let best = null;
      // A subject stays within reach of what it belongs to: a chain beside the contract or wallet it anchors, a
      // stablecoin beside the Wallmark that names it, a contract or wallet near its claims.
      const anchor = (() => {
        const ids = s.type === "chain" ? neighbours.get(s.id).filter((id) => base.has(id)).slice(0, 1) : neighbours.get(s.id).filter((id) => base.has(id) && !SUBJECT.has(nodes.find((m) => m.id === id)?.type));
        const ps = ids.map((id) => base.get(id));
        return ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null;
      })();
      const all = slotsNow();
      const near = (slot) => {
        if (!anchor) return true;
        const p = toXY(slot.main, slot.cross);
        return Math.hypot(p.x - anchor.x, p.y - anchor.y) <= opt.tether;
      };
      const open = (slot) => {
        const p = toXY(slot.main, slot.cross);
        return !nodes.some((m) => m !== s && base.has(m.id) && collide(s, p, m, base.get(m.id), 10));
      };
      // Within reach if there is room; anywhere free otherwise; past the last rank as a last resort.
      let choices = all.filter((slot) => near(slot) && open(slot));
      if (!choices.length) choices = all.filter(open);
      for (let extra = 1; !choices.length && extra < 8; extra++) {
        for (let c = opt.minGap / 2; c <= opt.span - opt.minGap / 2 + 1e-6; c += opt.minGap / 2) {
          const slot = { main: lastMain + opt.step * (extra + 0.5), cross: c };
          if (open(slot)) choices.push(slot);
        }
      }
      for (const slot of choices) {
        pos.set(s.id, slot);
        const c = score() + (opt.foundation ? (slot.cross <= opt.span ? opt.insidePenalty : 0) : slot.main > lastMain ? 0 : opt.insidePenalty);
        pos.delete(s.id);
        if (best === null || c < best.c - 1e-9) best = { c, slot };
      }
      s._slot = best ? best.slot : { main: lastMain + opt.step, cross: opt.span / 2 };
    }
    place();
  };
  // The one-to-one chain through a piece: its only neighbour in the next rank, as long as that neighbour has only it.
  const chainOf = (n, ci) => {
    const out = [[ci, n]];
    for (const dir of [-1, 1]) {
      let cur = n;
      let c = ci;
      for (;;) {
        const cc = c + dir;
        if (cc < 0 || cc >= columns.length) break;
        const nb = neighbours.get(cur.id).filter((id) => columns[cc].some((m) => m.id === id));
        if (nb.length !== 1) break;
        const m = columns[cc].find((x) => x.id === nb[0]);
        if (m.type === "conflict" || neighbours.get(m.id).filter((id) => columns[c].some((x) => x.id === id)).length !== 1) break;
        out.push([cc, m]);
        cur = m;
        c = cc;
      }
    }
    return out;
  };
  const sweep = (passes, backward, backFirst = false) => {
    const rel = new Map();
    for (const col of columns) col.forEach((n, i) => rel.set(n.id, i / Math.max(1, col.length - 1)));
    for (let k = 0; k < passes; k++) {
      const back = backFirst ? k % 2 === 0 : backward && k % 2 === 1;
      const order = back ? columns.map((_, i) => columns.length - 1 - i) : columns.map((_, i) => i);
      for (const ci of order) {
        const col = columns[ci];
        const key = new Map(col.map((n) => {
          const vs = neighbours.get(n.id).map((m) => rel.get(m)).filter((v) => v !== undefined);
          return [n.id, vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : rel.get(n.id)];
        }));
        col.sort((a, b) => key.get(a.id) - key.get(b.id) || a._i - b._i);
        col.forEach((n, i) => (n._i = i));
        fixBlocks(col, model);
        col.forEach((n) => rel.set(n.id, n._i / Math.max(1, col.length - 1)));
      }
    }
  };
  const search = () => {
    placeSubjects();
    let current = score();
    // Move each piece to every place in its rank and keep what crosses least; then re-seat the subjects.
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      for (const col of columns) {
        for (const n of [...col]) {
          const from = col.indexOf(n);
          const base = [...col];
          let best = { c: current, order: base };
          for (let to = 0; to < base.length; to++) {
            if (to === from) continue;
            const trial = [...base];
            trial.splice(from, 1);
            trial.splice(to, 0, n);
            col.splice(0, col.length, ...trial);
            col.forEach((m, k) => (m._i = k));
            fixBlocks(col, model);
            place();
            const c = score();
            if (c < best.c - 1e-6) best = { c, order: [...col] };
          }
          col.splice(0, col.length, ...best.order);
          col.forEach((m, k) => (m._i = k));
          if (best.c < current - 1e-6) {
            current = best.c;
            improved = true;
          }
        }
      }
      // A piece moved together with the one-to-one chain it belongs to (source, observation, claim).
      for (let ci = 0; ci < columns.length; ci++) {
        const col = columns[ci];
        if (col.length < 2) continue;
        for (const n of [...col]) {
          const chain = chainOf(n, ci);
          if (chain.length < 2) continue;
          const saved = columns.map((c2) => [...c2]);
          let best = { c: current, orders: saved };
          for (let to = 0; to < col.length; to++) {
            columns.forEach((c2, i) => c2.splice(0, c2.length, ...saved[i]));
            for (const [cj, m] of chain) {
              const c2 = columns[cj];
              const idx = cj === ci ? to : Math.round((to / Math.max(1, col.length - 1)) * (c2.length - 1));
              c2.splice(c2.indexOf(m), 1);
              c2.splice(idx, 0, m);
              c2.forEach((x, k) => (x._i = k));
              fixBlocks(c2, model);
            }
            place();
            const c = score();
            if (c < best.c - 1e-6) best = { c, orders: columns.map((c2) => [...c2]) };
          }
          columns.forEach((c2, i) => {
            c2.splice(0, c2.length, ...best.orders[i]);
            c2.forEach((x, k) => (x._i = k));
          });
          if (best.c < current - 1e-6) {
            current = best.c;
            improved = true;
          }
        }
      }
      placeSubjects();
      let c = score();
      // Two subjects trading places.
      const subj = model._subjects;
      for (let i = 0; i < subj.length; i++) for (let j = i + 1; j < subj.length; j++) {
        [subj[i]._slot, subj[j]._slot] = [subj[j]._slot, subj[i]._slot];
        place();
        const t = score();
        if (t < c - 1e-6) c = t;
        else [subj[i]._slot, subj[j]._slot] = [subj[j]._slot, subj[i]._slot];
      }
      place();
      if (c < current - 1e-6) improved = true;
      current = c;
      if (!improved) break;
    }
    return current;
  };
  // A few deterministic starting orders (bundle order, forward sweeps, alternating sweeps); the cheapest result wins.
  const initial = columns.map((col) => [...col]);
  // Anchored on the claims: the Wallmark first, then each upstream piece beside the first claim it leads to.
  const anchored = () => {
    const ci = columns.findIndex((col) => col.some((n) => n.type === "wallmark" || n.type === "assertion"));
    if (ci < 0) return;
    const claims = columns[ci];
    claims.sort((a, b) => (a.type === "wallmark" ? 0 : 1) - (b.type === "wallmark" ? 0 : 1) || a._i - b._i);
    claims.forEach((n, i) => (n._i = i));
    fixBlocks(claims, model);
    const out = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) if (EVIDENCE.has(e.kind)) out.get(e.from)?.push(e.to);
    const reach = (id) => {
      const seen = new Set([id]);
      const queue = [id];
      let best = Infinity;
      while (queue.length) {
        const x = queue.shift();
        const hit = claims.find((n) => n.id === x);
        if (hit) best = Math.min(best, hit._i);
        for (const y of out.get(x) ?? []) {
          if (seen.has(y)) continue;
          seen.add(y);
          queue.push(y);
        }
      }
      return best;
    };
    for (let k = ci - 1; k >= 0; k--) {
      const col = columns[k];
      const key = new Map(col.map((n) => [n.id, reach(n.id)]));
      col.sort((a, b) => key.get(a.id) - key.get(b.id) || a._i - b._i);
      col.forEach((n, i) => (n._i = i));
    }
  };
  const starts = [() => undefined, () => sweep(2, false), () => sweep(4, true), () => sweep(4, true, true), anchored];
  let best = null;
  for (const start of starts) {
    columns.forEach((col, i) => {
      col.splice(0, col.length, ...initial[i]);
      col.forEach((n, k) => (n._i = k));
      fixBlocks(col, model);
    });
    start();
    const c = search();
    if (best === null || c < best.c - 1e-6) best = { c, orders: columns.map((col) => [...col]), slots: model._subjects.map((s) => s._slot) };
  }
  columns.forEach((col, i) => col.splice(0, col.length, ...best.orders[i]));
  model._subjects.forEach((s, i) => (s._slot = best.slots[i]));
  place();
  model._cost = model._cost ?? {};
  model._cost[opt.main === "x" ? "wide" : "tall"] = cost(model, xy());
  return xy();
}

/** Fits a coordinate set into a frame: stretches the sparser axis towards the target proportion, then pads ~8 %. */
function frame(model, pos, key, aspect) {
  const { nodes } = model;
  const extent = () => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      const p = pos.get(n.id);
      if (!p) throw new Error(`no position for ${n.id} in ${key}`);
      const f = n._f;
      x0 = Math.min(x0, p.x + f.x0);
      x1 = Math.max(x1, p.x + f.x1);
      y0 = Math.min(y0, p.y - f.top);
      y1 = Math.max(y1, p.y + f.bottom);
    }
    return { x0, y0, x1, y1 };
  };
  let e = extent();
  const ratio = (e.x1 - e.x0) / Math.max(1, e.y1 - e.y0);
  // Stretch only (never compress), so spacing never shrinks below what the arrangement chose.
  if (ratio > aspect * 1.04) {
    const k = (e.x1 - e.x0) / aspect / (e.y1 - e.y0);
    const cy = (e.y0 + e.y1) / 2;
    for (const p of pos.values()) p.y = cy + (p.y - cy) * k;
  } else if (ratio < aspect / 1.04 && key === "wide") {
    const k = ((e.y1 - e.y0) * aspect) / (e.x1 - e.x0);
    const cx = (e.x0 + e.x1) / 2;
    for (const p of pos.values()) p.x = cx + (p.x - cx) * k;
  }
  e = extent();
  const w = e.x1 - e.x0;
  const h = e.y1 - e.y0;
  const px = Math.max(14, w * 0.075);
  const py = Math.max(14, h * 0.075);
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const n of nodes) {
    const p = pos.get(n.id);
    n[key] = { x: r1(p.x - e.x0 + px), y: r1(p.y - e.y0 + py) };
  }
  model.box = model.box ?? {};
  model.box[key] = { x: 0, y: 0, w: Math.ceil(w + 2 * px), h: Math.ceil(h + 2 * py) };
}

export const WIDE_ASPECT = 1.5;
export const TALL_ASPECT = 0.78;
export const TALL_WIDTH = 340;

/**
 * Layout depends on the topology and the words on the pieces only (never on selection, mode or state values beyond the
 * chip words that size a piece), so a recent result is reused while the same bundle stays open. Memory only, bounded.
 */
const LAYOUTS = new Map();
const topologyKey = (model) => JSON.stringify([model.nodes.map((n) => [n.id, n.type, n.label, n.chip?.text ?? "", n.chip?.second ?? ""]), model.edges.map((e) => e.id)]);

export function layoutCoinstellation(model) {
  const key = topologyKey(model);
  const hit = LAYOUTS.get(key);
  if (hit) {
    for (const n of model.nodes) {
      n.wide = { ...hit.wide[n.id] };
      n.tall = { ...hit.tall[n.id] };
    }
    model.box = { wide: { ...hit.box.wide }, tall: { ...hit.box.tall } };
    return model;
  }
  layoutFresh(model);
  LAYOUTS.set(key, { wide: Object.fromEntries(model.nodes.map((n) => [n.id, { ...n.wide }])), tall: Object.fromEntries(model.nodes.map((n) => [n.id, { ...n.tall }])), box: { wide: { ...model.box.wide }, tall: { ...model.box.tall } } });
  if (LAYOUTS.size > 24) LAYOUTS.delete(LAYOUTS.keys().next().value);
  return model;
}

function layoutFresh(model) {
  const { nodes } = model;
  if (nodes.length === 0) {
    model.box = { wide: { x: 0, y: 0, w: 0, h: 0 }, tall: { x: 0, y: 0, w: 0, h: 0 } };
    return model;
  }
  // Subjects are seated contract, wallet, stablecoin, then chain (a chain sits beside what it anchors).
  const SEAT = { contract: 0, wallet: 1, stablecoin: 2, chain: 3 };
  model._subjects = nodes.filter((n) => SUBJECT.has(n.type)).sort((a, b) => SEAT[a.type] - SEAT[b.type] || (a.id < b.id ? -1 : 1));
  const wideCols = ranks(model);
  const widest = Math.max(...wideCols.map((c) => c.length));
  // Ranks stand in straight columns (no staggering): the columns are the plate's alignment axes.
  const step = wideCols.length <= 3 ? 220 : wideCols.length <= 4 ? 180 : 150;
  const wide = arrange(model, wideCols, { main: "x", step, span: Math.max(widest * 90, ((wideCols.length - 1) * step) / WIDE_ASPECT - 70), stagger: 0, staggerFrom: 3, splitFrom: 99, split: 0, minGap: 70, foundation: 100, insidePenalty: 60, rankGap: 40, tether: 330 });
  frame(model, wide, "wide", WIDE_ASPECT);
  // Tall: the same ranks as rows, read top to bottom, inside a phone's width.
  for (const s of model._subjects) s._slot = null;
  // On a phone, a lone authority shares the row of the sources that speak for it.
  const tallCols = ranks(model).reduce((rows, col) => {
    const prev = rows[rows.length - 1];
    if (prev && prev.length === 1 && prev[0].type === "authority" && col.length <= 5) prev.push(...col);
    else rows.push([...col]);
    return rows;
  }, []);
  const tall = arrange(model, tallCols, { main: "y", step: 78, span: TALL_WIDTH - 24, stagger: 11, staggerFrom: 4, splitFrom: 5, split: 26, minGap: 64, foundation: 0, insidePenalty: 25, rankGap: 10, tether: 230 });
  frame(model, tall, "tall", TALL_ASPECT);
  for (const n of nodes) {
    delete n._i;
    delete n._f;
    delete n._slot;
  }
  delete model._subjects;
  return model;
}
