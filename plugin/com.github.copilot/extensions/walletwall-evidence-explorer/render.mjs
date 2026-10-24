// Rendering for the WalletWall canvas. Pure functions: structured MCP results in, escaped HTML out.
//
// Rules this file must keep:
//  - It never computes or upgrades a support, freshness or finality state, an authority decision, a conflict or a
//    readiness classification. It prints what the WalletWall MCP server returned.
//  - A state value outside the WWEP 0.1 enumerations is shown as "not recognised" instead of being rendered as a state.
//  - No "verified", "safe" or "approved" colour or wording. ESTABLISHED is described as "evidence satisfies policy".
//  - Limitations are always on screen next to the states they qualify.
//  - Replay, Scenario, Compare, Receipt and QR are drawn as reserved, disabled affordances only. Nothing here fakes them.
import { ASSERTION_LABELS, NODE_TYPES, EDGE_KINDS, buildWall, esc, layoutWall, nodeName, renderWall, short } from "./wall.mjs";
import { FONT_FACES, MARK, WALLABY } from "./brand.mjs";
import { CSS } from "./styles.mjs";
import { CLIENT_JS } from "./client.mjs";

export { esc, CSS, CLIENT_JS };

export const SUPPORT_STATES = ["ESTABLISHED", "SUPPORTED", "PARTIAL", "CONFLICTING", "STALE", "SUPERSEDED", "UNKNOWN", "NOT_ESTABLISHED"];
export const FRESHNESS_STATES = ["CURRENT", "STALE", "PINNED", "UNKNOWN_FRESHNESS"];
export const FINALITY_STATES = ["FINALIZED", "UNFINALIZED", "UNKNOWN_FINALITY"];
export const READINESS_CLASSES = ["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"];
const CRITERION_OUTCOMES = ["MET", "NOT_MET", "INDETERMINATE"];

export const SUPPORT_HINTS = {
  ESTABLISHED: "Presented evidence satisfies the published policy for this claim. This does not verify that upstream data is true.",
  SUPPORTED: "Meets the policy except for authority or finality.",
  PARTIAL: "Some usable evidence exists, but it is insufficient.",
  CONFLICTING: "Evidence about the same claim disagrees, or a conflict is declared.",
  STALE: "Older than the policy allows for a current claim, or a dependency was superseded.",
  SUPERSEDED: "A later assertion replaces this one. The old assertion stays in the bundle.",
  UNKNOWN: "Sources produced no result or an error. Not false, not zero.",
  NOT_ESTABLISHED: "No admissible basis under the policy.",
};
export const FRESHNESS_HINTS = {
  CURRENT: "Newest observation is within the policy maximum age.",
  STALE: "Older than the policy maximum age.",
  PINNED: "About a specific point such as a block; recency is not required.",
  UNKNOWN_FRESHNESS: "Freshness cannot be judged from the evidence.",
};
export const FINALITY_HINTS = {
  FINALIZED: "Every relied-upon observation states finalized finality.",
  UNFINALIZED: "At least one relied-upon observation is not finalized.",
  UNKNOWN_FINALITY: "Finality was not stated for at least one observation.",
};

/** How each state is drawn on The Wall. Meaning never depends on colour alone: shape, line and label carry it too. */
export const STATE_GEOMETRY = {
  ESTABLISHED: "solid, fully seated piece",
  SUPPORTED: "seated piece, lighter outline",
  PARTIAL: "half-filled piece",
  CONFLICTING: "split seam with diverging connections",
  STALE: "recessed, faded piece",
  SUPERSEDED: "faint historical layer behind its replacement",
  UNKNOWN: "empty, hatched slot: a missing brick, not a zero",
  NOT_ESTABLISHED: "outline only, no fill",
};

export const LIMITATION_LABELS = {
  NO_SOURCE: "No source or derivation supports this value.",
  NO_RESULT: "A source returned no result. No result is not zero.",
  DANGLING_REFERENCE: "A referenced record is missing from the bundle.",
  TRANSPORT_FIDELITY_NOT_VERIFIED: "Whether the transport reported chain state faithfully is not verified.",
  NOT_FINALIZED: "Relied-upon evidence is not finalized.",
  FINALITY_UNKNOWN: "Finality of the evidence is unknown.",
  STALE_EVIDENCE: "Evidence is older than the policy allows.",
  FRESHNESS_UNKNOWN: "Freshness could not be judged.",
  OBSERVATION_FROM_FUTURE: "An observation is dated after the evaluation time.",
  NO_AUTHORITATIVE_OBSERVATION: "No observation from the authority this claim type requires.",
  NON_AUTHORITATIVE_ONLY: "Only non-authoritative observations support this claim.",
  INSUFFICIENT_INDEPENDENT_CORROBORATION: "Too few independent sources agree.",
  DUPLICATE_EVIDENCE_COLLAPSED: "Duplicate evidence was counted once.",
  ORIGIN_SOURCE_KIND_MISMATCH: "An observation's origin does not match its source kind.",
  AUTHORITY_ID_MISMATCH: "The source's authority ID is not the registry authority for this deployment.",
  SUBJECT_MISMATCH: "An observation is about a different subject than the assertion.",
  INVALID_SUBJECT: "The subject is not valid for this claim type.",
  VALUE_MISMATCH: "The asserted value differs from the observed value.",
  OBSERVATION_DISAGREEMENT: "Observations disagree.",
  NOT_IN_REGISTRY: "The asset is not in the WalletWall registry.",
  CHAIN_NOT_IN_REGISTRY: "The chain is not in the WalletWall registry.",
  REGISTRY_MISMATCH: "The evidence disagrees with the registry record.",
  REGISTRY_VERIFIED_POINT_IN_TIME: "The registry was verified at a point in time and may have changed since.",
  SYMBOL_NOT_AUTHORITY: "A symbol is not an identity.",
  POLICY_MISSING: "No policy exists for this claim type.",
  DERIVATION_MISSING: "A derived claim has no derivation record.",
  DERIVATION_NOT_PERMITTED: "This claim type may not be derived.",
  MISSING_REQUIRED_DEPENDENCY: "A required input assertion is missing.",
  DEPENDENCY_CYCLE: "The dependency graph contains a cycle.",
  DEPENDENCY_SUPERSEDED: "An input assertion was superseded.",
  PINNED_DEPENDENCY_FOR_CURRENT_CLAIM: "A current claim depends on pinned evidence.",
  RULES_UNKNOWN: "The derivation rules or version are not known.",
  WALLETWALL_DERIVED_NOT_UPSTREAM_AUTHORITY: "A WalletWall-derived result is not an upstream authority.",
  CONFLICT_DECLARED: "A conflict was declared in the bundle.",
  CONFLICT_DETECTED: "A conflict was detected between assertions.",
  SUPERSEDED: "This assertion was superseded.",
  REGISTRY_VERSION_MISMATCH: "The bundle names a different registry version than the engine used.",
  RULES_VERSION_MISMATCH: "The bundle names a different rules version than the engine used.",
  PRICE_IS_PROVIDER_OBSERVATION: "A price is a provider observation, not an authority.",
  INVALID_VALUE: "A value is not valid for this claim type.",
};

/** Readiness criteria as structural pieces. Names are plain-language labels for the published criterion IDs. */
export const CRITERION_PIECES = {
  C1: "Identity",
  C2: "Balance and finality",
  C3: "Route: same chain and contract",
  C4: "Decimals",
  C5: "No conflict or supersession",
  C6: "Freshness",
};

/** The modes the panel has, and the reason each unavailable one is unavailable. Shown on screen, not only on hover. */
export const UNAVAILABLE = {
  compare: "Compare — requires two comparable states, which need immutable snapshots.",
  replay: "Replay — requires immutable snapshots.",
  scenario: "Scenario — simulation engine not yet enabled.",
  receipt: "Requires immutable snapshot.",
};

/** The claim restated in words, from the supplied bundle only. It is labelled as a claim wherever it is shown. */
function claimSentence(a) {
  const s = a.subject ?? {};
  const v = a.value ?? {};
  const t = (x) => esc(x ?? "unspecified");
  switch (a.claimType) {
    case "ASSET_IDENTITY":
      return `Contract <code>${t(s.address)}</code> on chain <code>${t(s.chainId)}</code> is claimed to be <code>${t(v.symbol)}</code> (decimals <code>${t(v.decimals)}</code>) under authority <code>${t(v.issuerAuthorityId)}</code>.`;
    case "TOKEN_BALANCE_AT_BLOCK":
      return `Holder <code>${t(s.holder)}</code> is claimed to have held <code>${t(v.balanceAtomic)}</code> atomic units (decimals <code>${t(v.decimals)}</code>) of token <code>${t(s.token)}</code> at block <code>${t(s.blockNumber)}</code> on chain <code>${t(s.chainId)}</code>.`;
    case "TOKEN_USD_PRICE":
      return `Token <code>${t(s.token)}</code> on chain <code>${t(s.chainId)}</code> is claimed to have a USD price of <code>${t(v.priceUsd)}</code>.`;
    case "TOKEN_USD_VALUE":
      return `A USD value (scaled 1e18) of <code>${t(v.usdScaled18)}</code> is claimed for the holding of token <code>${t(s.token)}</code> at block <code>${t(s.blockNumber)}</code>.`;
    case "VAULT_TECHNICAL_READINESS":
      return `A technical readiness classification of <code>${t(v.classification)}</code> is claimed under WalletWall's published rules.`;
    default:
      return "";
  }
}

const ATTENTION_FREE = ["ESTABLISHED", "SUPPORTED", "CURRENT", "PINNED", "FINALIZED", "CRITERIA_MET", "MET"];

function stateChip(value, allowed) {
  if (value === null || value === undefined) return '<span class="chip" data-state="NA">N/A</span>';
  if (!allowed.includes(value)) return `<span class="chip" data-attention="true" data-state="UNRECOGNISED">not recognised: ${esc(short(value, 24))}</span>`;
  const attention = !ATTENTION_FREE.includes(value);
  return `<span class="chip" data-state="${esc(value)}"${attention ? ' data-attention="true"' : ""}>${esc(value)}</span>`;
}

const ADDRESS_KEYS = new Set(["address", "token", "holder"]);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const isAddressField = (key, value) => typeof value === "string" && (ADDRESS_KEYS.has(key) || EVM_ADDRESS.test(value));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * An address is always printed in full, exactly as the bundle presents it (no shortening, no case or checksum change),
 * selectable with one click, with the chain it was presented for next to it. The copy buttons copy the text of the
 * `<code>` element beside them, so the copied value can never differ from the displayed full value.
 */
function addressValue(key, value, chainId) {
  const stated = !(chainId === undefined || chainId === null || chainId === "");
  const context = stated ? `chain ID ${esc(chainId)}` : "chain not stated";
  const withChain = stated ? `<button type="button" class="copy" data-copy-chain-address aria-label="Copy the chain ID and the full ${esc(key)} value (${context})">Copy chain + address</button>` : "";
  return `<span class="addr" data-chain="${stated ? esc(chainId) : ""}"><code class="addr-full">${esc(value)}</code><span class="addr-ctx muted small">${context}</span><button type="button" class="copy" data-copy-address aria-label="Copy the full ${esc(key)} value (${context})">Copy</button>${withChain}</span>`;
}

function records(rec, chainId) {
  if (rec === null || rec === undefined) return '<span class="muted">none</span>';
  if (!isObject(rec)) return `<code>${esc(rec)}</code>`;
  const entries = Object.entries(rec);
  if (entries.length === 0) return '<span class="muted">empty</span>';
  const chain = chainId ?? rec.chainId;
  return `<dl class="kv">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${isAddressField(k, v) ? addressValue(k, v, chain) : isObject(v) ? records(v, chain) : `<code>${esc(v)}</code>`}</dd></div>`).join("")}</dl>`;
}

function limitationsList(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return '<p class="muted">No limitation codes were returned for this result.</p>';
  return `<ul class="limits">${codes.map((c) => `<li><code>${esc(c)}</code> <span class="muted">${esc(LIMITATION_LABELS[c] ?? "No description is bundled for this code.")}</span></li>`).join("")}</ul>`;
}

/** Layers of a `trace_provenance` result: authority or source, observation, assertion, WalletWall derivation. */
function traceLayers(trace) {
  const { prov } = trace;
  return [
    { title: "Authority or source", nodes: Object.entries(prov.agent ?? {}).map(([id, a]) => ({ id, label: a["ww:authorityId"] ?? a["ww:kind"] ?? "agent", sub: a["ww:kind"] === undefined ? "" : `${a["ww:kind"]}${a["ww:retrievedVia"] ? ` · via ${a["ww:retrievedVia"]}` : ""}` })) },
    { title: "Observation", nodes: Object.entries(prov.entity ?? {}).filter(([, e]) => e["prov:type"] === "ww:Observation").map(([id, e]) => ({ id, label: id.replace(/^.*obs\//, ""), sub: `${e["ww:origin"]} · ${e["ww:result"]}` })) },
    { title: "Assertion", nodes: Object.entries(prov.entity ?? {}).filter(([, e]) => e["prov:type"] === "ww:Assertion").map(([id, e]) => ({ id, label: id.replace(/^.*assertion\//, ""), sub: `${e["ww:claimType"]}`, target: id.endsWith(`assertion/${trace.target}`) })) },
    { title: "WalletWall derivation", nodes: Object.entries(prov.activity ?? {}).map(([id, a]) => ({ id, label: id.replace(/^.*derivation\//, ""), sub: `${a["ww:ruleId"]} ${a["ww:rulesVersion"]}` })) },
  ].filter((l) => l.nodes.length > 0);
}

/** Layered provenance graph from the MCP `trace_provenance` result: authority/source, observation, assertion, derivation. */
export function renderGraph(trace) {
  if (trace === null || trace === undefined || trace.prov === undefined) return '<p class="muted">No provenance trace is available.</p>';
  const { prov } = trace;
  const layers = traceLayers(trace);
  if (layers.length === 0) return '<p class="muted">The trace contains no records.</p>';
  const W = 760;
  const rowH = 86;
  const H = layers.length * rowH + 10;
  const pos = new Map();
  layers.forEach((layer, li) => {
    layer.nodes.forEach((n, ni) => pos.set(n.id, { x: ((ni + 1) * W) / (layer.nodes.length + 1), y: li * rowH + 40 }));
  });
  const edges = [];
  // Edges stop at the node borders so the arrowheads stay visible.
  const add = (from, to, label) => {
    const a = pos.get(from);
    const b = pos.get(to);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const pad = (Math.abs(dy) >= Math.abs(dx) * 0.2 ? 22 : 82) / len;
    edges.push(`<line x1="${(a.x + dx * pad).toFixed(1)}" y1="${(a.y + dy * pad).toFixed(1)}" x2="${(b.x - dx * pad).toFixed(1)}" y2="${(b.y - dy * pad).toFixed(1)}" marker-end="url(#arrow)"><title>${esc(label)}</title></line>`);
  };
  for (const r of Object.values(prov.wasAttributedTo ?? {})) add(r["prov:agent"], r["prov:entity"], "attributed to");
  for (const r of Object.values(prov.wasDerivedFrom ?? {})) add(r["prov:usedEntity"], r["prov:generatedEntity"], "was derived from");
  for (const r of Object.values(prov.wasGeneratedBy ?? {})) add(r["prov:activity"], r["prov:entity"], "was generated by");
  const nodes = layers.flatMap((layer) =>
    layer.nodes.map((n) => {
      const p = pos.get(n.id);
      return `<g class="node${n.target ? " target" : ""}" transform="translate(${(p.x - 78).toFixed(1)} ${(p.y - 20).toFixed(1)})"><title>${esc(n.id)}</title><rect width="156" height="40" rx="2"/><text x="78" y="17" text-anchor="middle" class="t1">${esc(short(n.label, 22))}</text><text x="78" y="32" text-anchor="middle" class="t2">${esc(short(n.sub, 26))}</text></g>`;
    }),
  );
  const rows = layers.map((l, li) => `<text x="4" y="${li * rowH + 12}" class="layer">${esc(l.title.toUpperCase())}</text>`);
  return `<svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Provenance: ${esc(layers.map((l) => l.title).join(" to "))}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${rows.join("")}${edges.join("")}${nodes.join("")}</svg><p class="muted small">Arrows point from the thing a record was made from to the record made from it: evidence into the claim it supports, and a WalletWall derivation into the assertion it generated. Transport (for example an RPC provider) is shown only as an attribute of a source; it is not an authority.</p>${trace.issues?.length ? `<p class="note" data-attention="true">Trace issues: ${trace.issues.map((i) => `<code>${esc(i.code)}</code>`).join(" ")}</p>` : ""}`;
}

/** The "Why WalletWall says this" ladder: the selected claim's lineage, read bottom-up, from `trace_provenance`. */
function whyLadder(trace) {
  if (trace === null || trace === undefined || trace.prov === undefined) return '<p class="muted small">No provenance trace is available for this claim.</p>';
  const layers = traceLayers(trace);
  if (layers.length === 0) return '<p class="muted small">The trace contains no records.</p>';
  const order = ["Authority or source", "Observation", "Assertion", "WalletWall derivation"];
  const steps = order
    .map((title) => layers.find((l) => l.title === title))
    .filter(Boolean)
    .map((l) => `<li><span class="ww-why-step">${esc(l.title)}</span> ${l.nodes.map((n) => `<code${n.target ? ' class="ww-why-target"' : ""}>${esc(short(n.label, 28))}</code>`).join(" ")}</li>`);
  return `<ol class="ww-why-path" aria-label="Lineage of this claim, from source to result">${steps.join("")}</ol>`;
}

function readinessPanel(readiness) {
  if (readiness === null || readiness === undefined) return "";
  if (readiness.errorCode !== undefined) {
    return `<section class="ww-section ww-criteria" aria-labelledby="h-ready"><h2 id="h-ready">Vault technical readiness</h2><p class="note" data-attention="true">The readiness rules could not be applied (<code>${esc(readiness.errorCode)}</code>).</p></section>`;
  }
  const r = readiness.result;
  const rows = (Array.isArray(r.criteria) ? r.criteria : []).map((c) => `<tr><th scope="row">${esc(c.id)}</th><td>${esc(c.description)}</td><td>${stateChip(c.outcome, CRITERION_OUTCOMES)}</td><td><code>${esc(c.reason)}</code></td></tr>`).join("");
  const nots = (Array.isArray(r.doesNotEstablish) ? r.doesNotEstablish : []).map((x) => `<li>${esc(x)}</li>`).join("");
  return `<section class="ww-section ww-criteria" aria-labelledby="h-ready"><h2 id="h-ready">Vault technical readiness</h2>
<p>Rules <code>${esc(r.ruleId)}</code> <code>${esc(r.rulesVersion)}</code> applied to assertion <code>${esc(readiness.assertionId)}</code>: ${stateChip(r.classification, READINESS_CLASSES)}</p>
<p class="muted">Support of the inputs: ${stateChip(r.supportOfInputs, SUPPORT_STATES)}. This is a classification against published technical criteria, not a statement about the asset.</p>
<div class="ww-table-wrap"><table><thead><tr><th>Criterion</th><th>Description</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>
<h3>Limitations</h3>${limitationsList(r.limitations)}
<h3>Does not establish</h3><ul class="limits">${nots}</ul></section>`;
}

/** The readiness keystone resting on its criterion pieces. A piece that is not MET leaves a visible gap or sits loose. */
function readinessAssembly(readiness) {
  if (readiness === null || readiness === undefined) return "";
  if (readiness.errorCode !== undefined || !isObject(readiness.result)) {
    return `<section class="ww-section ww-assembly" aria-labelledby="h-assembly"><h2 id="h-assembly">Readiness assembly</h2><div class="ww-arch" data-fit="false"><div class="ww-keystone" data-classification="NONE"><span class="ww-eyebrow">Vault readiness</span><span>Not assessed: a required input is missing (<code>${esc(readiness.errorCode)}</code>).</span></div><div class="ww-course ww-course-empty" aria-hidden="true"></div></div></section>`;
  }
  const r = readiness.result;
  const known = READINESS_CLASSES.includes(r.classification);
  const seated = r.classification === "CRITERIA_MET";
  const pieces = (Array.isArray(r.criteria) ? r.criteria : [])
    .map((c) => {
      const outcome = CRITERION_OUTCOMES.includes(c.outcome) ? c.outcome : "UNRECOGNISED";
      const word = outcome === "MET" ? "in place" : outcome === "NOT_MET" ? "missing" : outcome === "INDETERMINATE" ? "loose: cannot be determined" : "not recognised";
      return `<li class="ww-piece" data-outcome="${esc(outcome)}"><span class="ww-piece-id">${esc(c.id)}</span><span class="ww-piece-name">${esc(CRITERION_PIECES[c.id] ?? c.id)}</span><span class="ww-piece-fit">${esc(word)}</span>${stateChip(c.outcome, CRITERION_OUTCOMES)}<code class="ww-piece-reason">${esc(c.reason)}</code></li>`;
    })
    .join("");
  return `<section class="ww-section ww-assembly" aria-labelledby="h-assembly"><h2 id="h-assembly">Readiness assembly</h2>
<p class="muted small">The keystone seats only when every criterion piece is in place. Pieces and outcomes exactly as returned by <code>assess_vault_readiness</code>; WalletWall's canvas decides nothing here.</p>
<div class="ww-arch" data-fit="${seated}"><div class="ww-keystone" data-classification="${known ? esc(r.classification) : "UNRECOGNISED"}"><span class="ww-eyebrow">Vault readiness</span>${stateChip(r.classification, READINESS_CLASSES)}<span class="small">${seated ? "Seated: every criterion piece is in place." : "Not seated: at least one criterion piece is missing or loose."}</span></div><ol class="ww-course" aria-label="Readiness criteria">${pieces}</ol></div></section>`;
}

/** Wallprint: WalletWall's profile of this asset context, laid as masonry courses. Every facet repeats a returned result. */
function wallprint(view, model) {
  const as = view.assertions;
  const identity = as.find((a) => a.claimType === "ASSET_IDENTITY");
  const evalOf = (a) => a?.evaluation ?? null;
  const chains = [...new Set(as.map((a) => a.subject?.chainId).filter((c) => typeof c === "string"))];
  const wallets = model.nodes.filter((n) => n.type === "wallet");
  const authorities = model.nodes.filter((n) => n.type === "authority");
  const conflicts = model.nodes.filter((n) => n.type === "conflict");
  const limitations = new Set(as.flatMap((a) => (Array.isArray(evalOf(a)?.limitations) ? evalOf(a).limitations : [])));
  const readinessInputs = view.readiness?.result?.inputs;
  const brick = (title, body, attention, wide) => `<div class="ww-brick${wide ? " wide" : ""}"${attention ? ' data-attention="true"' : ""}><span class="ww-eyebrow">${esc(title)}</span>${body}</div>`;
  const attentionState = (s) => s !== null && s !== undefined && !ATTENTION_FREE.includes(s);
  const idState = evalOf(identity)?.supportState;
  const rd = view.readiness?.result?.classification;
  const freshness = as.map((a) => `<li><code>${esc(short(a.id, 22))}</code> ${evalOf(a) ? stateChip(evalOf(a).freshnessState, FRESHNESS_STATES) : '<span class="muted">no evaluation</span>'}</li>`).join("");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `<section class="ww-section ww-wallprint" aria-labelledby="h-wallprint"><h2 id="h-wallprint">Wallprint</h2>
<p class="muted small">WalletWall's profile of this asset context, course by course. Each facet repeats a result already shown above; nothing here is a new score.</p>
<div class="ww-courses">
<div class="ww-course-row">${brick("Wallmark", identity ? `<span>${esc(identity.value?.symbol ?? "symbol not stated")} <span class="muted small">as presented</span></span>${stateChip(idState, SUPPORT_STATES)}` : '<span class="muted">No identity claim in this bundle.</span>', !identity || attentionState(idState), true)}${brick("Vault readiness", view.readiness ? (view.readiness.result ? stateChip(rd, READINESS_CLASSES) : `<span>not assessed: <code>${esc(view.readiness.errorCode)}</code></span>`) : '<span class="muted">No readiness claim in this bundle.</span>', Boolean(view.readiness) && rd !== "CRITERIA_MET", true)}</div>
<div class="ww-course-row offset">${brick("Sources", `<span>${plural(view.sources.length, "source")} · ${plural(authorities.length, "authority").replace(/ys$/, "ies")} · ${plural(view.observations.length, "observation")}</span>`, false)}${brick("Chain", chains.length ? chains.map((c) => `<code>${esc(c)}</code>`).join(" ") : '<span class="muted">not stated</span>', chains.length === 0)}${brick("Wallet", wallets.length ? `<span>${wallets.length} holder${wallets.length === 1 ? "" : "s"}, listed in full on The Wall</span>` : '<span class="muted">no holder in this bundle</span>', false)}</div>
<div class="ww-course-row">${brick("Freshness", `<ul class="ww-mini">${freshness}</ul>`, as.some((a) => attentionState(evalOf(a)?.freshnessState)))}${brick("Conflicts", conflicts.length ? `<span>${conflicts.length} split seam${conflicts.length === 1 ? "" : "s"}</span>` : '<span class="muted">none reported</span>', conflicts.length > 0)}${brick("Dependencies", Array.isArray(readinessInputs) ? `<ul class="ww-mini">${readinessInputs.map((i) => `<li><code>${esc(i.assertionId)}</code> ${stateChip(i.supportState, SUPPORT_STATES)}</li>`).join("")}</ul>` : '<span class="muted">no readiness inputs</span>', Array.isArray(readinessInputs) && readinessInputs.some((i) => attentionState(i.supportState)))}${brick("Limitations", `<span>${limitations.size} distinct code${limitations.size === 1 ? "" : "s"}</span>`, limitations.size > 0)}</div>
</div></section>`;
}

/** Receipt and QR: reserved space only. There are no immutable snapshots yet, so nothing here produces a receipt. */
function receipt() {
  return `<section class="ww-section ww-receipt" aria-labelledby="h-receipt"><h2 id="h-receipt">Receipt</h2>
<div class="ww-receipt-body"><div class="ww-qr-slot" role="img" aria-label="Reserved space for a future receipt QR code. No QR code is generated."><span>QR</span><span class="small">reserved</span></div>
<div><p>A receipt will let someone else check this exact state later. That needs immutable snapshots, which WalletWall does not create yet, so these controls are disabled.</p>
<div class="ww-actions"><button type="button" disabled aria-describedby="receipt-why">Copy receipt</button><button type="button" disabled aria-describedby="receipt-why">Verify</button><button type="button" disabled aria-describedby="receipt-why">QR</button></div>
<p id="receipt-why" class="ww-reason">${esc(UNAVAILABLE.receipt)}</p>
<p class="muted small">When it exists, the QR code will locate a verifiable snapshot receipt. It will never encode a wallet address, a local URL, a Copilot session, a key or the query itself.</p></div></div></section>`;
}

/** The compact identity rail: mark, name, and the Wallmark facts of the bundle's identity claim, as presented. */
function identityRail(view) {
  const identity = view.assertions.find((a) => a.claimType === "ASSET_IDENTITY");
  const v = view.versions ?? {};
  const fact = (dt, dd) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`;
  const facts = identity
    ? [
        fact("Asset", `${esc(identity.value?.symbol ?? "not stated")} <span class="muted small">as presented</span>`),
        fact("Chain", `<code>${esc(identity.subject?.chainId ?? "not stated")}</code>`),
        fact("Contract", typeof identity.subject?.address === "string" ? addressValue("contract address", identity.subject.address, identity.subject?.chainId) : '<span class="muted">not stated</span>'),
        fact("Issuer or protocol", `<code>${esc(identity.value?.issuerAuthorityId ?? "not stated")}</code>`),
        fact("Wallmark", identity.evaluation ? stateChip(identity.evaluation.supportState, SUPPORT_STATES) : '<span class="muted">no evaluation</span>'),
        fact("Freshness", identity.evaluation ? stateChip(identity.evaluation.freshnessState, FRESHNESS_STATES) : '<span class="muted">no evaluation</span>'),
      ]
    : [fact("Wallmark", '<span class="muted">No identity claim in this bundle.</span>')];
  facts.push(fact("Registry", `<code>${esc(v.registry)}</code>`));
  return `<header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1><span class="ww-lens-badge" title="The only lens with complete semantics today">Observed</span></div><dl class="ww-rail-facts" aria-label="Wallmark identity">${facts.join("")}</dl></header>`;
}

function toolbar() {
  return `<div class="ww-toolbar"><div class="ww-modes" role="group" aria-label="View"><button type="button" data-mode="overview" aria-pressed="true">Overview</button><button type="button" data-mode="trace" aria-pressed="false">Trace</button><button type="button" disabled aria-describedby="why-compare">Compare</button></div>
<div class="ww-lens" role="group" aria-label="State lens"><button type="button" class="is-on" aria-pressed="true">Observed</button><button type="button" disabled aria-describedby="why-replay">Replay</button><button type="button" disabled aria-describedby="why-scenario">Scenario</button></div>
<div class="ww-tools"><button type="button" data-motion-toggle aria-pressed="false">Reduce motion</button><button type="button" data-guide-toggle aria-controls="wallaby">Hide Guide</button></div>
<ul class="ww-reasons"><li id="why-compare">${esc(UNAVAILABLE.compare)}</li><li id="why-replay">${esc(UNAVAILABLE.replay)}</li><li id="why-scenario">${esc(UNAVAILABLE.scenario)}</li></ul></div>`;
}

function assertionNav(view) {
  return `<nav class="ww-section ww-claims" aria-label="Claims in this bundle"><h2>Claims in this bundle</h2><ul class="nav">${view.assertions
    .map((a) => {
      const selected = a.id === view.selectedId;
      return `<li><button type="button" data-assertion-id="${esc(a.id)}" aria-pressed="${selected}"><span class="nav-id">${esc(short(a.id, 28))}</span><span class="nav-type">${esc(ASSERTION_LABELS[a.claimType] ?? a.claimType)}</span>${a.evaluation ? stateChip(a.evaluation.supportState, SUPPORT_STATES) : ""}</button></li>`;
    })
    .join("")}</ul></nav>`;
}

function dependencies(view, a) {
  const dep = a.evaluation?.dependencies;
  if (!dep) return '<p class="muted">No dependency information was returned.</p>';
  const obs = new Map(view.observations.map((o) => [o.id, o]));
  const src = new Map(view.sources.map((s) => [s.id, s]));
  const obsItems = dep.observationIds.map((id) => {
    const o = obs.get(id);
    if (!o) return `<li><code>${esc(id)}</code> <span class="muted">missing from the bundle</span></li>`;
    const s = src.get(o.sourceId);
    return `<li><code>${esc(id)}</code> <span class="muted">${esc(o.origin)} · result ${esc(o.result)} · observed ${esc(o.observedAt)} · finality ${esc(o.finality)} · source ${esc(s ? s.kind : "unknown")}${s?.authorityId ? ` (${esc(s.authorityId)})` : ""}</span></li>`;
  });
  const asItems = dep.assertionIds.map((id) => `<li><button type="button" class="link" data-assertion-id="${esc(id)}">${esc(id)}</button> <span class="muted">input assertion</span></li>`);
  const items = [...obsItems, ...asItems];
  return items.length ? `<ul class="limits">${items.join("")}</ul>` : '<p class="muted">This assertion lists no observations or input assertions.</p>';
}

function detail(view, a) {
  const e = a.evaluation;
  const auth = e?.authority;
  const conflicts = e?.conflictsWith?.length ? e.conflictsWith.map((c) => `<button type="button" class="link" data-assertion-id="${esc(c)}">${esc(c)}</button>`).join(", ") : '<span class="muted">none reported</span>';
  const claim = ASSERTION_LABELS[a.claimType] ?? a.claimType;
  return `<div data-assertion-detail><section aria-labelledby="h-assertion"><p class="ww-eyebrow">${esc(a.claimType === "ASSET_IDENTITY" ? "Wallmark" : a.claimType === "VAULT_TECHNICAL_READINESS" ? "Keystone" : "Claim")}</p><h2 id="h-assertion">${esc(claim)} <code>${esc(a.id)}</code></h2>
<p class="claim muted small">Claim type <code>${esc(a.claimType)}</code>, origin as presented <code>${esc(a.origin)}</code>, temporality <code>${esc(a.temporality)}</code></p>
<p><strong>Claim as presented:</strong> ${claimSentence(a)}</p>
<div class="two"><div><h3>Subject (as presented)</h3>${records(a.subject)}</div><div><h3>Value (as presented)</h3>${records(a.value, a.subject?.chainId)}</div></div>
<p class="muted small">Subject and value are copied from the supplied bundle. They are claims, not findings. Addresses are shown in full, exactly as presented; Copy copies that exact text.</p></section>
<section aria-labelledby="h-states"><h2 id="h-states">Why WalletWall says this</h2>
<p class="muted small">Support, freshness, finality and conflicts exactly as returned by WalletWall MCP.</p>
${whyLadder(view.provenance)}<p><button type="button" class="ww-why-button" data-why>Show this path on The Wall</button></p>
${
  e
    ? `<dl class="states">
<div><dt>Support</dt><dd>${stateChip(e.supportState, SUPPORT_STATES)} <span class="muted">${esc(SUPPORT_HINTS[e.supportState] ?? "")}</span></dd></div>
<div><dt>Authority class</dt><dd>${auth ? `<code>${esc(auth.kind)}</code> · <code>${esc(auth.authorityId)}</code> · scope <code>${esc(auth.scope)}</code> · requirement satisfied: <strong>${auth.satisfied === true ? "yes" : "no"}</strong>` : '<span class="muted">no authority defined for this claim type</span>'}</dd></div>
<div><dt>Freshness</dt><dd>${stateChip(e.freshnessState, FRESHNESS_STATES)} <span class="muted">${esc(FRESHNESS_HINTS[e.freshnessState] ?? "")}</span></dd></div>
<div><dt>Finality</dt><dd>${e.finalityState === null ? '<span class="chip" data-state="NA">N/A</span> <span class="muted">finality does not apply to this claim type</span>' : `${stateChip(e.finalityState, FINALITY_STATES)} <span class="muted">${esc(FINALITY_HINTS[e.finalityState] ?? "")}</span>`}</dd></div>
<div><dt>Independent corroboration</dt><dd>${e.independentCorroboration === null ? '<span class="muted">not applicable (derived)</span>' : `<code>${esc(e.independentCorroboration)}</code>`}</dd></div>
<div><dt>Conflicts</dt><dd>${conflicts}</dd></div>
<div><dt>Superseded by</dt><dd>${e.supersededBy ? `<button type="button" class="link" data-assertion-id="${esc(e.supersededBy)}">${esc(e.supersededBy)}</button>` : '<span class="muted">not superseded</span>'}</dd></div>
<div><dt>Policy</dt><dd><code>${esc(e.policyId ?? "none")}</code></dd></div>
</dl>`
    : '<p class="note" data-attention="true">No evaluation was returned for this assertion.</p>'
}
</section>
<section aria-labelledby="h-limits"><h2 id="h-limits">Limitations</h2>${limitationsList(e?.limitations)}<p class="muted small">Limitations qualify every state above. They are never hidden.</p></section>
<section aria-labelledby="h-deps"><h2 id="h-deps">Sources</h2>${dependencies(view, a)}</section></div>`;
}

const PIECE_NOTES = {
  authority: "An issuer or protocol authority. Sources speak for it; a Wallmark may name it as the issuer.",
  source: "Where observations came from. Transport (for example an RPC provider) is an attribute of a source, never an authority.",
  observation: "One measurement a source reported, exactly as presented in the bundle.",
  derivation: "A WalletWall rule applied to input claims. Its result is WalletWall-derived, not an upstream authority.",
  conflict: "Two claims about the same thing disagree. WalletWall does not rank one above the other.",
  gap: "Something the bundle refers to is not there. The gap stays visible; it is never filled with zero, false or a default.",
  snapshot: "Reserved for immutable snapshots. Nothing is stored or snapshotted today.",
  stablecoin: "The stablecoin a Wallmark names, with its symbol as presented. A symbol is not an identity.",
  contract: "The contract address a claim is about, exactly as presented.",
  wallet: "The holder address a balance claim is about, exactly as presented. It is held in memory only while the panel is open.",
  chain: "The chain ID a claim is about. It anchors contracts and wallets.",
};

/** Detail panels for pieces that are not claims. The page shows one at a time when the piece is focused. */
function piecePanels(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const pieceRef = (n) => (n.address ? `<code>${esc(n.address)}</code>` : esc(short(n.label, 30)));
  const focusLink = (n) => `<button type="button" class="link" data-focus-node="${esc(n.id)}">${pieceRef(n)}</button>`;
  return model.nodes
    .filter((n) => n.assertionId === undefined)
    .map((n) => {
      const t = NODE_TYPES[n.type];
      const incoming = model.edges.filter((e) => e.to === n.id).map((e) => `<li>${focusLink(byId.get(e.from))} <span class="muted">${esc(EDGE_KINDS[e.kind].name)} this piece</span></li>`);
      const outgoing = model.edges.filter((e) => e.from === n.id).map((e) => `<li><span class="muted">This piece ${esc(EDGE_KINDS[e.kind].name)}</span> ${focusLink(byId.get(e.to))}</li>`);
      let presented;
      if (n.type === "contract" || n.type === "wallet") presented = addressValue(n.type === "contract" ? "contract address" : "wallet address", n.address, n.chainId);
      else if (n.type === "conflict") presented = n.data.between.map((id) => `<button type="button" class="link" data-assertion-id="${esc(id)}">${esc(id)}</button>`).join(" and ");
      else if (n.type === "snapshot") presented = `<span class="ww-reason">${esc(UNAVAILABLE.receipt)}</span>`;
      else if (n.type === "observation") presented = records({ id: n.data.id, sourceId: n.data.sourceId, origin: n.data.origin, result: n.data.result, observedAt: n.data.observedAt, finality: n.data.finality, subject: n.data.subject, payload: n.data.payload });
      else presented = records(n.data);
      const finality = n.type === "observation" ? `<div><dt>Finality</dt><dd><code>${esc(n.data.finality)}</code> <span class="muted">as stated by the observation</span></dd></div><div><dt>Observed at</dt><dd><code>${esc(n.data.observedAt)}</code></dd></div>` : "";
      return `<section class="ww-node-detail" data-node-panel="${esc(n.id)}" hidden aria-label="${esc(nodeName(n))}"><p class="ww-eyebrow">${esc(t.name)} · ${esc(t.shape)}</p><h2>${n.address ? `<code>${esc(n.address)}</code>` : esc(n.label)}</h2>
<p class="muted small">${esc(PIECE_NOTES[n.type] ?? "")}</p>
<dl class="states"><div><dt>As presented</dt><dd>${presented}</dd></div><div><dt>Support</dt><dd><span class="muted">Not a claim, so it carries no support state.</span></dd></div>${finality}${n.unattested ? '<div><dt>Authority</dt><dd><span class="chip" data-attention="true" data-state="NA">no source</span> <span class="muted">Named by the identity claim; no source in the bundle speaks for it.</span></dd></div>' : ""}<div><dt>Rests on</dt><dd>${incoming.length ? `<ul class="limits">${incoming.join("")}</ul>` : '<span class="muted">nothing</span>'}</dd></div><div><dt>Supports</dt><dd>${outgoing.length ? `<ul class="limits">${outgoing.join("")}</ul>` : '<span class="muted">nothing</span>'}</dd></div></dl></section>`;
    })
    .join("");
}

/** The Wall as a table: the same pieces, states and connections, for anyone who cannot or does not want to read a graph. */
function textVersion(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const rows = model.nodes
    .map((n) => {
      const rests = model.edges.filter((e) => e.to === n.id).map((e) => {
        const from = byId.get(e.from);
        return `${from.address ? `<code>${esc(from.address)}</code>` : esc(short(from.label, 26))} <span class="muted">(${esc(EDGE_KINDS[e.kind].name)})</span>`;
      });
      const state = n.state === undefined ? '<span class="muted">not a claim</span>' : n.state === null ? '<span class="muted">no evaluation</span>' : stateChip(n.state, SUPPORT_STATES);
      return `<tr><th scope="row"><button type="button" class="link" data-focus-node="${esc(n.id)}">${n.address ? `<code>${esc(n.address)}</code>` : esc(n.label)}</button></th><td>${esc(NODE_TYPES[n.type].name)}</td><td>${state}${n.classification ? ` ${stateChip(n.classification, READINESS_CLASSES)}` : ""}${n.missing ? ' <span class="muted">missing</span>' : ""}</td><td>${rests.join("<br/>") || '<span class="muted">nothing</span>'}</td></tr>`;
    })
    .join("");
  return `<details class="ww-section ww-text-version"><summary>The Wall as a list (${model.nodes.length} pieces)</summary><div class="ww-table-wrap"><table><thead><tr><th>Piece</th><th>Type</th><th>State</th><th>Rests on</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function legend() {
  const swatch = (state) => `<li><svg class="ww-swatch" viewBox="0 0 40 20" aria-hidden="true"><g class="ww-node" data-type="assertion" data-state="${state}"><rect class="body" x="2" y="2" width="36" height="16" rx="1"/></g></svg><span><strong>${state}</strong> <span class="muted">${esc(STATE_GEOMETRY[state])}</span></span></li>`;
  return `<details class="ww-legend"><summary>How to read The Wall</summary><ul class="ww-legend-list">${SUPPORT_STATES.map(swatch).join("")}</ul><p class="muted small">Pieces rest on what supports them: authorities and sources on the left, observations, then claims, then WalletWall's derivation and the readiness keystone in its chamber. Subjects (chain, contract, wallet) form the foundation course. Terracotta marks only the selected piece and its path; it never means good or bad.</p></details>`;
}

/** Short guide messages tied to what this bundle actually shows. The page shows at most one per change. */
function guideCues(view, model) {
  const cues = [];
  const first = (type, pred = () => true) => model.nodes.find((n) => n.type === type && pred(n));
  const conflict = first("conflict");
  if (conflict) cues.push(["conflict", conflict.id, "inspect", "This seam split because two claims about the same thing disagree. WalletWall does not pick a winner."]);
  const missing = model.nodes.find((n) => n.missing);
  if (missing) cues.push(["unknown", missing.id, "inspect", missing.type === "observation" ? "This brick is missing on purpose: the source returned no result. WalletWall leaves the gap instead of filling it with 0 or false." : "This slot is empty because the bundle refers to something it does not contain."]);
  const keystone = first("readiness");
  if (keystone && view.readiness && view.readiness.result?.classification !== "CRITERIA_MET") cues.push(["readiness", keystone.id, "perch", "The keystone does not seat: at least one readiness criterion is not in place. The Readiness assembly shows which piece is missing or loose."]);
  const stale = model.nodes.find((n) => n.state === "STALE");
  if (stale) cues.push(["stale", stale.id, "inspect", "This piece receded because its evidence is older than the policy allows for a current claim."]);
  const superseded = model.nodes.find((n) => n.superseded);
  if (superseded) cues.push(["superseded", superseded.id, "perch", "This faint piece was superseded by a later claim. It stays on The Wall as history; it is not deleted or rewritten."]);
  cues.push(["orientation", "", "perch", "This is The Wall. Each piece rests on what supports it. Select a piece, then use Why WalletWall says this to trace its path."]);
  return `<ul class="ww-guide-cues" hidden>${cues.map(([cue, node, pose, text]) => `<li data-cue="${cue}" data-node="${esc(node)}" data-pose="${pose}">${esc(text)}</li>`).join("")}</ul>`;
}

export function renderView(view) {
  if (view.status === "empty") {
    const fx = (view.fixtures ?? []).map((f) => `<li><code>${esc(f.name)}</code> <span class="muted">${esc(f.title)}</span></li>`).join("");
    return `<header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1></div></header><p class="note">Nothing is loaded. Ask Copilot to inspect a WWEP evidence bundle and open it here, or open WalletWall with one of the bundled synthetic fixtures:</p><ul class="limits">${fx}</ul><p class="muted small">This panel only displays results returned by the local WalletWall MCP server. It computes nothing itself.</p>`;
  }
  if (view.status === "error") {
    return `<header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1></div></header><p class="note" data-attention="true" role="alert">The evidence could not be evaluated: <code>${esc(view.error.code)}</code>. ${esc(view.error.message)} No states are shown.</p>`;
  }
  const selected = view.assertions.find((a) => a.id === view.selectedId) ?? view.assertions[0];
  const v = view.versions ?? {};
  const inv = Array.isArray(view.invariantViolations) ? view.invariantViolations : [];
  const model = layoutWall(buildWall(view));
  return `${identityRail(view)}
<p class="note ww-boundary">States describe how well the presented evidence satisfies published policy. They do not verify that upstream data is true, and they are not statements about safety, solvency or investment merit.</p>
${toolbar()}
<p class="meta">Evaluated at <code>${esc(view.evaluatedAt)}</code> · WWEP <code>${esc(v.wwep)}</code> · registry <code>${esc(v.registry)}</code> · policies <code>${esc(v.policies)}</code> · rules <code>${esc(v.rules)}</code><br/>Bundle digest <code>${esc(view.bundleDigest)}</code> · Invariant violations: <strong>${esc(view.invariantViolationCount)}</strong>${view.source ? ` · Source: <code>${esc(view.source)}</code>` : ""}</p>
${inv.length ? `<ul class="limits ww-violations">${inv.map((x) => `<li data-attention="true"><code>${esc(x.invariant)}</code> <code>${esc(x.code)}</code> ${x.assertionId ? `on <code>${esc(x.assertionId)}</code>` : ""} <span class="muted">${esc(x.rule)}</span></li>`).join("")}</ul>` : ""}
<div class="ww-flow">
<div class="ww-stage"><section class="ww-wall" aria-labelledby="h-wall"><div class="ww-section-head"><h2 id="h-wall">The Wall</h2><p class="muted small">The whole wall fits this frame. Select a piece to see its details. Drag a piece to move it; it stays pinned until Reset layout. Zoom in to read closely, then drag the background to pan.</p><div class="ww-wall-tools"><div class="ww-zoom" role="group" aria-label="Zoom The Wall"><button type="button" data-zoom="out" aria-label="Zoom out" disabled>−</button><span class="ww-zoom-level" data-zoom-level aria-live="polite">Whole wall</span><button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="fit" disabled>Fit</button></div><button type="button" data-reset-layout>Reset layout</button></div></div><div class="ww-wall-view">${renderWall(model, { selectedNodeId: selected ? `as:${selected.id}` : null, digest: view.bundleDigest })}</div>${legend()}</section>
<aside class="ww-detail" id="detail" aria-label="Selected piece">${selected ? detail(view, selected) : '<p class="muted">The bundle has no assertions.</p>'}${piecePanels(model)}</aside></div>
${readinessAssembly(view.readiness)}
<section class="ww-section ww-lineage" aria-labelledby="h-prov"><h2 id="h-prov">Source lineage</h2><p class="muted small">The selected claim's provenance as returned by <code>trace_provenance</code>.</p>${renderGraph(view.provenance)}</section>
${wallprint(view, model)}
${readinessPanel(view.readiness)}
${receipt()}
${assertionNav(view)}
${textVersion(model)}
</div>
${guideCues(view, model)}`;
}

export function renderPage({ nonce }) {
  const brandCss = `.ww-mark{background-image:url("${MARK}")}.ww-wallaby-art[data-pose="inspect"]{background-image:url("${WALLABY.inspect}")}.ww-wallaby-art[data-pose="perch"]{background-image:url("${WALLABY.perch}")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>WalletWall</title><link rel="icon" type="image/png" sizes="96x96" href="${MARK}"><style nonce="${esc(nonce)}">${FONT_FACES}\n${brandCss}\n${CSS}</style></head><body><main id="app" data-mode="overview" data-motion="full"><p class="muted">Loading…</p></main><p id="view-status" class="ww-sr" role="status" aria-live="polite"></p><aside id="wallaby" class="ww-wallaby" hidden data-peek="out" aria-label="WalletWallaby, the WalletWall guide"><span id="wallaby-art" class="ww-wallaby-art" data-pose="inspect" aria-hidden="true"></span><div class="ww-wallaby-bubble"><p class="ww-eyebrow">WalletWallaby</p><p id="wallaby-text"></p><div class="ww-actions"><button type="button" data-wallaby-dismiss>Got it</button><button type="button" data-wallaby-off>Hide Guide</button></div></div></aside><p id="copy-status" class="copy-status" role="status" aria-live="polite"></p><script nonce="${esc(nonce)}">${CLIENT_JS}</script></body></html>`;
}
