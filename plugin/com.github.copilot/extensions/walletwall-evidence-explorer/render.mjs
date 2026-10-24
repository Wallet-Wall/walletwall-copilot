// Rendering for the WalletWall canvas. Pure functions: the authoritative Canvas view in, escaped HTML out.
//
// The WalletWall Canvas visualizes an authoritative MCP-evaluated view. Fixtures provide input, `explorer.mjs` owns Canvas
// state, and Coinstellation is a deterministic presentation projection. No renderer, layout, interaction, motion, or
// browser-time calculation may create, strengthen, or replace WalletWall evidence state.
//
// Rules this file must keep:
//  - It never computes or upgrades a support, freshness or finality state, an authority decision, a conflict or a
//    readiness classification. It prints what the WalletWall MCP server returned.
//  - A state value outside the WWEP 0.1 enumerations is shown as "not recognised" instead of being rendered as a state.
//  - No "verified", "safe" or "approved" colour or wording. ESTABLISHED is described as "evidence satisfies policy".
//  - Limitations stay next to the states they qualify: their count is a fact beside the states, the codes one step away.
//  - Replay, Scenario, Compare, Receipt and QR are drawn as reserved, disabled affordances only. Nothing here fakes them.
//  - A piece that is not a claim gets visual focus only; the one assertion selection is view.selectedId.
import { ASSERTION_LABELS, NODE_TYPES, EDGE_KINDS, buildCoinstellation, short } from "./coinstellation-model.mjs";
import { esc, renderWall } from "./wall.mjs";
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

/** One line under the selected piece's title: the same meaning as the hints above, shortened. */
export const SUPPORT_SHORT = {
  ESTABLISHED: "Evidence satisfies the published policy.",
  SUPPORTED: "Meets policy except authority or finality.",
  PARTIAL: "Usable evidence, but not enough.",
  CONFLICTING: "Evidence about this claim disagrees.",
  STALE: "Evidence is older than policy allows.",
  SUPERSEDED: "A later assertion replaces this one.",
  UNKNOWN: "No result or an error; not false.",
  NOT_ESTABLISHED: "No admissible basis under the policy.",
};

/** How each state is drawn on The Wall. Meaning never depends on colour alone: ring, line, fill and label carry it too. */
export const STATE_GEOMETRY = {
  ESTABLISHED: "solid piece with a firm ring",
  SUPPORTED: "solid piece with a lighter ring",
  PARTIAL: "half-filled piece",
  CONFLICTING: "double rust ring, broken connection and a conflict piece between the claims",
  STALE: "receded piece inside a dashed ring",
  SUPERSEDED: "faint piece with a historical outline behind it",
  UNKNOWN: "open, dashed piece: an empty slot, not a zero",
  NOT_ESTABLISHED: "open piece, outline only",
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

/** An explanation folded behind "Why?", so nothing long stands between the reader and The Wall. */
const explain = (html) => `<p class="muted small ww-explain">${html}</p><details class="ww-why-more"><summary>Why?</summary><p class="muted small">${html}</p></details>`;
/** A hint folded behind "Why?" next to the state it explains. */
const why = (text) => (text ? `<details class="ww-why"><summary>Why?</summary><p class="muted small">${esc(text)}</p></details>` : "");

/**
 * The head of the detail surface: what is in focus, its state, one line of meaning, and whether this is the selected
 * assertion (shared with the agent) or visual focus on a piece that is not a claim. On a phone it is the sheet's peek.
 */
const sheetSummary = (title, chip, meaning, kind) => `<div class="ww-sheet-summary"><p class="ww-sheet-title"><span>${esc(title)}</span>${chip}</p><p class="ww-sheet-meaning">${esc(meaning)}</p><p class="ww-focus-kind">${kind}</p></div>`;

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
  const rows = (Array.isArray(r.criteria) ? r.criteria : []).map((c) => `<tr><th scope="row">${esc(c.id)}</th><td data-label="Description">${esc(c.description)}</td><td data-label="Outcome">${stateChip(c.outcome, CRITERION_OUTCOMES)}</td><td data-label="Reason"><code>${esc(c.reason)}</code></td></tr>`).join("");
  const nots = (Array.isArray(r.doesNotEstablish) ? r.doesNotEstablish : []).map((x) => `<li>${esc(x)}</li>`).join("");
  return `<section class="ww-section ww-criteria" aria-labelledby="h-ready"><h2 id="h-ready">Vault technical readiness</h2>
<p>Rules <code>${esc(r.ruleId)}</code> <code>${esc(r.rulesVersion)}</code> applied to assertion <code>${esc(readiness.assertionId)}</code>: ${stateChip(r.classification, READINESS_CLASSES)}</p>
<p class="muted">Support of the inputs: ${stateChip(r.supportOfInputs, SUPPORT_STATES)}. This is a classification against published technical criteria, not a statement about the asset.</p>
<div class="ww-table-wrap"><table><thead><tr><th>Criterion</th><th>Description</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>
<h3>Limitations</h3>${limitationsList(r.limitations)}
<h3>Does not establish</h3><ul class="limits">${nots}</ul></section>`;
}

/** The readiness keystone resting on its criterion pieces. A piece that is not MET leaves a visible gap or sits loose. */
function readinessAssembly(readiness, model) {
  if (readiness === null || readiness === undefined) return "";
  const keystone = model.nodes.find((n) => n.type === "readiness" && n.assertionId === readiness.assertionId);
  const focus = keystone ? ` data-focus-node="${esc(keystone.id)}"` : "";
  const show = keystone ? `<p class="ww-assembly-show"><button type="button" class="link" data-focus-node="${esc(keystone.id)}">Show readiness on The Wall</button></p>` : "";
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
${explain("The keystone seats only when every criterion piece is in place. Pieces and outcomes exactly as returned by <code>assess_vault_readiness</code>; WalletWall's canvas decides nothing here.")}
<div class="ww-arch" data-fit="${seated}"><div class="ww-keystone" data-classification="${known ? esc(r.classification) : "UNRECOGNISED"}"><span class="ww-eyebrow">Vault readiness</span>${stateChip(r.classification, READINESS_CLASSES)}<span class="small">${seated ? "Seated: every criterion piece is in place." : "Not seated: at least one criterion piece is missing or loose."}</span></div><ol class="ww-course" aria-label="Readiness criteria"${focus}>${pieces}</ol></div>${show}</section>`;
}

/**
 * Wallprint: a compact summary of the Coinstellation, one item per facet. Each value repeats a returned result exactly
 * (nothing is combined into a new state); each item with a piece behind it leads to that piece.
 */
function wallprint(view, model) {
  const as = view.assertions;
  const identity = as.find((a) => a.claimType === "ASSET_IDENTITY");
  const ie = identity?.evaluation ?? null;
  const ids = new Set(model.nodes.map((n) => n.id));
  const target = (id) => (id !== undefined && ids.has(id) ? id : undefined);
  const chains = [...new Set(as.map((a) => a.subject?.chainId).filter((c) => typeof c === "string"))];
  const wallets = model.nodes.filter((n) => n.type === "wallet");
  const authorities = model.nodes.filter((n) => n.type === "authority");
  const conflicts = model.nodes.filter((n) => n.type === "conflict");
  const r = view.readiness;
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const attentionState = (s) => s !== null && s !== undefined && !ATTENTION_FREE.includes(s);
  const item = (key, value, focus, attention) => {
    const f = target(focus);
    const inner = `<span class="ww-eyebrow">${esc(key)}</span><span class="ww-brick-value">${value}</span>`;
    return `<li class="ww-brick"${attention ? ' data-attention="true"' : ""}${f ? ` data-focus-node="${esc(f)}"` : ""}>${f ? `<button type="button" class="ww-brick-key" data-focus-node="${esc(f)}">${inner}</button>` : `<span class="ww-brick-key">${inner}</span>`}</li>`;
  };
  const items = [
    item("Wallmark", identity ? `<span>${esc(short(identity.value?.symbol ?? "symbol not stated", 12))}</span>${ie ? stateChip(ie.supportState, SUPPORT_STATES) : '<span class="chip" data-attention="true" data-state="NA">no evaluation</span>'}` : '<span class="muted">none in this bundle</span>', identity ? `as:${identity.id}` : undefined, !ie || attentionState(ie.supportState)),
    item("Readiness", r ? (r.result ? stateChip(r.result.classification, READINESS_CLASSES) : '<span class="chip" data-attention="true" data-state="NA">not assessed</span>') : '<span class="muted">none in this bundle</span>', r ? `as:${r.assertionId}` : undefined, Boolean(r) && r.result?.classification !== "CRITERIA_MET"),
    item("Freshness", ie ? `${stateChip(ie.freshnessState, FRESHNESS_STATES)}<span class="muted small">Wallmark</span>` : '<span class="muted">no evaluation</span>', identity ? `as:${identity.id}` : undefined, Boolean(ie) && attentionState(ie.freshnessState)),
    item("Conflicts", conflicts.length ? `<span class="chip" data-attention="true" data-state="CONFLICTING">${plural(conflicts.length, "conflict")}</span>` : '<span class="muted">none reported</span>', conflicts[0]?.id, conflicts.length > 0),
    item("Sources", `<span>${plural(view.sources.length, "source")} · ${plural(authorities.length, "authority", "authorities")}</span>`, model.nodes.find((n) => n.type === "source")?.id, false),
    item("Chain", chains.length ? chains.map((c) => `<code>${esc(c)}</code>`).join(" ") : '<span class="muted">not stated</span>', chains.length ? `chain:${chains[0]}` : undefined, chains.length === 0),
    item("Wallet", wallets.length ? `<span>${plural(wallets.length, "holder")}</span>` : '<span class="muted">none</span>', wallets[0]?.id, false),
  ];
  const violations = Number(view.invariantViolationCount);
  if (Number.isFinite(violations) && violations > 0) items.push(item("Invariants", `<span class="chip" data-attention="true" data-state="NA">${plural(violations, "violation")}</span>`, undefined, true));
  return `<section class="ww-section ww-wallprint" aria-labelledby="h-wallprint"><h2 id="h-wallprint">Wallprint</h2><ul class="ww-courses">${items.join("")}</ul></section>`;
}

/** Receipt and QR: reserved space only. There are no immutable snapshots yet, so nothing here produces a receipt. */
function receipt() {
  return `<section class="ww-section ww-receipt" aria-labelledby="h-receipt"><h2 id="h-receipt">Receipt</h2>
<button type="button" class="ww-receipt-row" data-receipt-toggle aria-expanded="false" aria-controls="receipt-body"><span class="ww-receipt-row-text"><strong>Receipt</strong><span class="ww-reason">${esc(UNAVAILABLE.receipt)}</span></span><span aria-hidden="true">›</span></button>
<div class="ww-receipt-body" id="receipt-body"><div class="ww-qr-slot" role="img" aria-label="Reserved space for a future receipt QR code. No QR code is generated."><span>QR</span><span class="small">reserved</span></div>
<div><p>A receipt will let someone else check this exact state later. That needs immutable snapshots, which WalletWall does not create yet, so these controls are disabled.</p>
<div class="ww-actions"><button type="button" disabled aria-describedby="receipt-why">Copy receipt</button><button type="button" disabled aria-describedby="receipt-why">Verify</button><button type="button" disabled aria-describedby="receipt-why">QR</button></div>
<p id="receipt-why" class="ww-reason">${esc(UNAVAILABLE.receipt)}</p>
<p class="muted small">When it exists, the QR code will locate a verifiable snapshot receipt. It will never encode a wallet address, a local URL, a Copilot session, a key or the query itself.</p></div></div></section>`;
}

/** The summary header: mark, name, the asset as presented and its chain ID; the critical state strip below. */
function summaryHeader(view, model) {
  const identity = view.assertions.find((a) => a.claimType === "ASSET_IDENTITY");
  const chain = identity?.subject?.chainId ?? view.assertions.find((a) => typeof a.subject?.chainId === "string")?.subject?.chainId;
  const asset = `<p class="ww-rail-asset"><span class="ww-rail-symbol">${esc(identity ? (identity.value?.symbol ?? "symbol not stated") : "No Wallmark")}</span><span class="ww-rail-sep" aria-hidden="true">·</span><span class="ww-rail-chain">${typeof chain === "string" ? `chain ${esc(chain)}` : "chain not stated"}</span></p>`;
  return `<div class="ww-summary"><header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1><span class="ww-lens-badge" title="The only lens with complete semantics today">Observed</span></div>${asset}</header>${stateStrip(view, model)}</div>`;
}

/**
 * The critical state strip under the phone header: the Wallmark, freshness and readiness exactly as returned, plus a
 * conflict or invariant chip only when there is one. Each chip leads to its piece on The Wall.
 */
function stateStrip(view, model) {
  const identity = view.assertions.find((a) => a.claimType === "ASSET_IDENTITY");
  const ids = new Set(model.nodes.map((n) => n.id));
  const item = (key, chip, focus) => `<li>${focus && ids.has(focus) ? `<button type="button" class="ww-strip-item" data-focus-node="${esc(focus)}">` : '<span class="ww-strip-item">'}<span class="ww-strip-key">${esc(key)}</span>${chip}${focus && ids.has(focus) ? "</button>" : "</span>"}</li>`;
  const wallmark = identity ? `as:${identity.id}` : undefined;
  const items = [
    item("Wallmark", identity?.evaluation ? stateChip(identity.evaluation.supportState, SUPPORT_STATES) : '<span class="chip" data-attention="true" data-state="NA">none</span>', wallmark),
    item("Freshness", identity?.evaluation ? stateChip(identity.evaluation.freshnessState, FRESHNESS_STATES) : '<span class="chip" data-state="NA">N/A</span>', wallmark),
  ];
  if (view.readiness) {
    const r = view.readiness;
    items.push(item("Readiness", r.result ? stateChip(r.result.classification, READINESS_CLASSES) : '<span class="chip" data-attention="true" data-state="NA">not assessed</span>', `as:${r.assertionId}`));
  }
  // A conflict, when the engine reported one, leads the strip: it is what a phone shows first.
  const conflicts = model.nodes.filter((n) => n.type === "conflict");
  if (conflicts.length) items.unshift(item("Conflict", `<span class="chip" data-attention="true" data-state="CONFLICTING">${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}</span>`, conflicts[0].id));
  const violations = Number(view.invariantViolationCount);
  if (Number.isFinite(violations) && violations > 0) items.push(item("Invariants", `<span class="chip" data-attention="true" data-state="NA">${violations} violation${violations === 1 ? "" : "s"}</span>`));
  return `<ul class="ww-strip" aria-label="Current state">${items.join("")}</ul>`;
}

/**
 * The Wall's one control group: Overview and Trace, Fit, the guide, and More. More holds everything else, so nothing is
 * phone-only and no future capability takes a primary place.
 */
function stageTools() {
  const menu = [
    '<button type="button" data-mode="trace">Trace</button>',
    '<button type="button" data-guide-toggle aria-controls="wallaby">Hide Guide</button>',
    '<button type="button" data-zoom="in" aria-label="Zoom in">Zoom in</button>',
    '<button type="button" data-zoom="out" aria-label="Zoom out" disabled>Zoom out</button>',
    '<button type="button" data-reset-layout>Reset layout</button>',
    '<button type="button" data-motion-toggle aria-pressed="false">Reduce motion</button>',
    '<button type="button" data-list-view>List view</button>',
    '<button type="button" data-panel-toggle aria-expanded="false" aria-controls="panel-info">About this panel</button>',
  ].join("");
  return `<div class="ww-wall-tools" role="toolbar" aria-label="The Wall"><div class="ww-modes" role="group" aria-label="View"><button type="button" data-mode="overview" aria-pressed="true">Overview</button><button type="button" data-mode="trace" aria-pressed="false">Trace</button></div><button type="button" class="ww-tool-in" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="fit" disabled>Fit</button><button type="button" data-guide-toggle aria-controls="wallaby">Hide Guide</button><button type="button" class="ww-icon-button ww-wall-menu-toggle" data-wall-menu-toggle aria-expanded="false" aria-controls="wall-menu" aria-label="More options">More</button><div class="ww-wall-menu" id="wall-menu" hidden>${menu}</div></div><span class="ww-zoom-level" data-zoom-level aria-live="polite">Whole wall</span>`;
}

const LIST_FILTERS = [
  ["all", "All"],
  ["claims", "Claims"],
  ["sources", "Sources"],
  ["observations", "Observations"],
  ["conflicts", "Conflicts"],
  ["readiness", "Readiness"],
  ["missing", "Missing"],
];

/**
 * The list: every piece of The Wall as a row, an alternate lens on the same pieces. Search and filter chips; at most two
 * chips a row; a row leads back to its piece. Addresses are printed in full, as everywhere outside a piece's face.
 */
function listSurface(view, model) {
  const supports = (n) => model.edges.filter((e) => e.to === n.id && e.kind === "supports").length;
  const rows = model.nodes
    .map((n) => {
      const kinds = ["all"];
      if (n.type === "assertion" || n.type === "wallmark" || n.type === "readiness") kinds.push("claims");
      if (n.type === "authority" || n.type === "source") kinds.push("sources");
      if (n.type === "observation") kinds.push("observations");
      if (n.type === "conflict" || n.wwepState === "CONFLICTING") kinds.push("conflicts");
      if (n.type === "readiness" || n.type === "snapshot" || n.type === "derivation" || (n.type === "gap" && n.gapFor === "readiness")) kinds.push("readiness");
      if (n.type === "gap" || n.missing) kinds.push("missing");
      const name = n.type === "assertion" ? `${ASSERTION_LABELS[n.data?.claimType] ?? "Claim"} claim` : n.type === "wallmark" ? "Wallmark" : n.type === "readiness" ? "Vault readiness" : n.label;
      const state = n.wwepState === undefined ? "" : n.wwepState === null ? '<span class="chip" data-state="NA">no evaluation</span>' : stateChip(n.wwepState, SUPPORT_STATES);
      const cls = n.type === "readiness" ? (n.classification !== undefined ? stateChip(n.classification, READINESS_CLASSES) : '<span class="chip" data-attention="true" data-state="NA">not assessed</span>') : "";
      const type = `<span class="chip ww-type-chip" data-state="NA">${esc(NODE_TYPES[n.type].name)}</span>`;
      const chips = n.type === "readiness" ? `${cls}${state}` : `${state}${type}`;
      const count = supports(n);
      const second = n.address ? `<code>${esc(n.address)}</code>` : n.assertionId !== undefined ? `<code>${esc(n.assertionId)}</code>${count ? ` · ${count} supporting observation${count === 1 ? "" : "s"}` : ""}` : n.exactValue !== undefined ? `<code>${esc(short(n.exactValue, 40))}</code>` : "";
      // Searchable text, exactly as presented (the page compares without regard to case).
      const text = [name, n.address ? undefined : n.label, n.address, n.assertionId, n.exactValue, n.wwepState, n.classification, NODE_TYPES[n.type].name].filter((x) => typeof x === "string").join(" ");
      return `<li data-kinds="${kinds.join(" ")}" data-text="${esc(text)}"><button type="button" class="ww-list-row" data-focus-node="${esc(n.id)}"${n.assertionId !== undefined && n.assertionId === view.selectedId ? ' aria-current="true"' : ""}><span class="ww-list-name">${esc(name)}</span><span class="ww-list-meta">${chips}</span>${second ? `<span class="ww-list-sub muted small">${second}</span>` : ""}</button></li>`;
    })
    .join("");
  const filters = LIST_FILTERS.map(([key, label]) => `<button type="button" data-list-filter="${key}" aria-pressed="${key === "all"}">${label}</button>`).join("");
  return `<section class="ww-section ww-list" id="ww-list" aria-labelledby="h-list"><h2 id="h-list">Inspect The Wall</h2><label class="ww-sr" for="ww-search">Search The Wall</label><input id="ww-search" class="ww-search" type="search" placeholder="Search The Wall" autocomplete="off" spellcheck="false" data-list-search><div class="ww-filters" role="group" aria-label="Show">${filters}</div><ul class="ww-list-rows">${rows}</ul><p class="muted small" data-list-empty hidden>No piece matches.</p></section>`;
}

/** Lenses and modes that are not live yet: in the panel's About section, each with its reason in visible text. */
function panelToolbar() {
  return `<div class="ww-toolbar"><div class="ww-lens" role="group" aria-label="State lens"><button type="button" class="is-on" aria-pressed="true">Observed</button><button type="button" disabled aria-describedby="why-replay">Replay</button><button type="button" disabled aria-describedby="why-scenario">Scenario</button></div>
<div class="ww-lens" role="group" aria-label="More views"><button type="button" disabled aria-describedby="why-compare">Compare</button></div>
<ul class="ww-reasons"><li id="why-compare">${esc(UNAVAILABLE.compare)}</li><li id="why-replay">${esc(UNAVAILABLE.replay)}</li><li id="why-scenario">${esc(UNAVAILABLE.scenario)}</li></ul></div>`;
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

/**
 * The selected assertion: its state and at most six facts first; the claim as presented, provenance, limitation codes
 * and sources one step away. All of it repeats the WalletWall MCP results.
 */
function detail(view, a) {
  const e = a.evaluation;
  const auth = e?.authority;
  const claim = ASSERTION_LABELS[a.claimType] ?? a.claimType;
  const title = a.claimType === "ASSET_IDENTITY" ? "Wallmark" : a.claimType === "VAULT_TECHNICAL_READINESS" ? "Vault readiness" : `${claim} claim`;
  const chip = e ? stateChip(e.supportState, SUPPORT_STATES) : '<span class="chip" data-attention="true" data-state="NA">no evaluation</span>';
  const meaning = e ? (SUPPORT_SHORT[e.supportState] ?? "This state is not one WalletWall recognises.") : "No evaluation was returned for this assertion.";
  const lims = Array.isArray(e?.limitations) ? e.limitations : [];
  const fact = (dt, dd) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const conflicts = e?.conflictsWith?.length ? e.conflictsWith.map((c) => `<button type="button" class="link" data-assertion-id="${esc(c)}">${esc(c)}</button>`).join(", ") : null;
  const facts = e
    ? `<dl class="states ww-facts">${[
        fact("Support", `${stateChip(e.supportState, SUPPORT_STATES)}${why(SUPPORT_HINTS[e.supportState])}`),
        fact("Freshness", `${stateChip(e.freshnessState, FRESHNESS_STATES)}${why(FRESHNESS_HINTS[e.freshnessState])}`),
        fact("Finality", e.finalityState === null ? '<span class="chip" data-state="NA">N/A</span> <span class="muted small">does not apply to this claim type</span>' : `${stateChip(e.finalityState, FINALITY_STATES)}${why(FINALITY_HINTS[e.finalityState])}`),
        fact("Authority", auth ? `<span>${auth.satisfied === true ? "requirement satisfied" : "requirement not satisfied"}</span>` : '<span class="muted">none defined for this claim type</span>'),
        ...(conflicts ? [fact("Conflicts", conflicts)] : []),
        fact("Limitations", lims.length ? `<span class="chip" data-attention="true" data-state="NA">${lims.length}</span> <span class="muted small">under Limitations</span>` : '<span class="muted">none returned</span>'),
      ].join("")}</dl>`
    : '<p class="note" data-attention="true">No evaluation was returned for this assertion.</p>';
  const more = e
    ? `<dl class="states">
<div><dt>Authority class</dt><dd>${auth ? `<code>${esc(auth.kind)}</code> · <code>${esc(auth.authorityId)}</code> · scope <code>${esc(auth.scope)}</code> · requirement satisfied: <strong>${auth.satisfied === true ? "yes" : "no"}</strong>` : '<span class="muted">no authority defined for this claim type</span>'}</dd></div>
<div><dt>Independent corroboration</dt><dd>${e.independentCorroboration === null ? '<span class="muted">not applicable (derived)</span>' : `<code>${esc(e.independentCorroboration)}</code>`}</dd></div>
<div><dt>Superseded by</dt><dd>${e.supersededBy ? `<button type="button" class="link" data-assertion-id="${esc(e.supersededBy)}">${esc(e.supersededBy)}</button>` : '<span class="muted">not superseded</span>'}</dd></div>
<div><dt>Policy</dt><dd><code>${esc(e.policyId ?? "none")}</code></dd></div>
</dl>`
    : "";
  return `<div data-assertion-detail>${sheetSummary(title, chip, meaning, `Selected assertion · <code>${esc(short(a.id, 28))}</code>`)}
<section aria-labelledby="h-states"><h2 id="h-states" class="ww-sr">Why WalletWall says this</h2>${facts}</section>
<details class="ww-more" data-more="provenance"><summary>Provenance</summary><section aria-labelledby="h-prov"><h2 id="h-prov" class="ww-sr">Provenance</h2><p class="muted small">The lineage trace_provenance returned for this claim; Trace shows it on The Wall.</p>${whyLadder(view.provenance)}<p><button type="button" class="ww-why-button" data-why>Show this path on The Wall</button></p></section></details>
<details class="ww-more"><summary>Details</summary><section aria-labelledby="h-assertion"><h2 id="h-assertion">${esc(claim)} <code>${esc(a.id)}</code></h2>
<p class="claim muted small">Claim type <code>${esc(a.claimType)}</code>, origin as presented <code>${esc(a.origin)}</code>, temporality <code>${esc(a.temporality)}</code></p>
<p><strong>Claim as presented:</strong> ${claimSentence(a)}</p>
<div class="two"><div><h3>Subject (as presented)</h3>${records(a.subject)}</div><div><h3>Value (as presented)</h3>${records(a.value, a.subject?.chainId)}</div></div>
<p class="muted small">Subject and value are copied from the supplied bundle. They are claims, not findings. Addresses are shown in full, exactly as presented; Copy copies that exact text.</p>${more}</section></details>
<details class="ww-more"><summary>Limitations${lims.length ? ` (${lims.length})` : ""}</summary><section aria-labelledby="h-limits"><h2 id="h-limits" class="ww-sr">Limitations</h2>${limitationsList(e?.limitations)}<p class="muted small">Limitations qualify every state above. They are never hidden.</p></section></details>
<details class="ww-more"><summary>Sources</summary><section aria-labelledby="h-deps"><h2 id="h-deps" class="ww-sr">Sources</h2>${dependencies(view, a)}</section></details></div>`;
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

/** Panels for pieces that are not claims: visual focus only, never an assertion selection. One shows at a time. */
function piecePanels(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const pieceRef = (n) => (n.address ? `<code>${esc(n.address)}</code>` : esc(n.label));
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
      const summaryChip = n.type === "observation" ? `<span class="chip"${n.missing ? ' data-attention="true"' : ""} data-state="NA">${esc(String(n.data?.result ?? "result not stated").toLowerCase().replace("_", " "))}</span>` : n.missing ? '<span class="chip" data-attention="true" data-state="NA">missing</span>' : "";
      return `<section class="ww-node-detail" data-node-panel="${esc(n.id)}" hidden aria-label="${esc(n.accessibleLabel)}">${sheetSummary(n.label, summaryChip, (PIECE_NOTES[n.type] ?? "").split(". ")[0].replace(/\.?$/, "."), `Visual focus · ${esc(t.name)}, not an assertion selection`)}<h2>${n.address ? `<code>${esc(n.address)}</code>` : esc(n.exactValue ?? n.label)}</h2>
<dl class="states ww-facts"><div><dt>As presented</dt><dd>${presented}</dd></div>${finality}${n.unattested ? '<div><dt>Authority</dt><dd><span class="chip" data-attention="true" data-state="NA">no source</span> <span class="muted">Named by the identity claim; no source in the bundle speaks for it.</span></dd></div>' : ""}<div><dt>Rests on</dt><dd>${incoming.length ? `<ul class="limits">${incoming.join("")}</ul>` : '<span class="muted">nothing</span>'}</dd></div><div><dt>Supports</dt><dd>${outgoing.length ? `<ul class="limits">${outgoing.join("")}</ul>` : '<span class="muted">nothing</span>'}</dd></div></dl>
<details class="ww-more"><summary>Details</summary><p class="muted small">${esc(PIECE_NOTES[n.type] ?? "")}</p><dl class="states"><div><dt>Support</dt><dd><span class="muted">Not a claim, so it carries no support state.</span></dd></div></dl></details></section>`;
    })
    .join("");
}

/** The Wall as a table: the same pieces, states, selection and connections, for anyone who does not read a graph. */
function textVersion(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (n) => (n.address ? `<code>${esc(n.address)}</code>` : `${esc(n.label)}${n.exactValue !== undefined && n.exactValue !== n.label ? ` <code>${esc(short(n.exactValue, 40))}</code>` : ""}`);
  const rows = model.nodes
    .map((n) => {
      const rests = model.edges.filter((e) => e.to === n.id).map((e) => `${name(byId.get(e.from))} <span class="muted">(${esc(EDGE_KINDS[e.kind].name)})</span>`);
      const state = n.wwepState === undefined ? '<span class="muted">not a claim</span>' : n.wwepState === null ? '<span class="muted">no evaluation</span>' : stateChip(n.wwepState, SUPPORT_STATES);
      const selected = n.assertionId !== undefined && n.assertionId === model.authoritativeSelectedAssertionId;
      return `<tr><th scope="row"><button type="button" class="link" data-focus-node="${esc(n.id)}"${selected ? ' aria-current="true"' : ""}>${name(n)}</button>${selected ? ' <span class="muted small">selected</span>' : ""}</th><td>${esc(NODE_TYPES[n.type].name)}</td><td>${state}${n.classification !== undefined ? ` ${stateChip(n.classification, READINESS_CLASSES)}` : ""}${n.missing ? ' <span class="muted">missing</span>' : ""}</td><td>${rests.join("<br/>") || '<span class="muted">nothing</span>'}</td></tr>`;
    })
    .join("");
  return `<details class="ww-section ww-text-version"><summary>The Wall as a list (${model.nodes.length} pieces)</summary><div class="ww-table-wrap"><table><thead><tr><th>Piece</th><th>Type</th><th>State</th><th>Rests on</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function legend() {
  const swatch = (state) => `<li><svg class="ww-swatch" viewBox="0 0 40 24" aria-hidden="true"><g class="ww-node" data-type="assertion" data-state="${state}" data-visual="${state.toLowerCase().replace("_", "-")}">${state === "CONFLICTING" ? '<circle class="ww-ring ww-ring-conflict" cx="20" cy="12" r="10.5"/>' : ""}${state === "STALE" ? '<circle class="ww-ring ww-ring-stale" cx="20" cy="12" r="10.5"/>' : ""}<circle class="body" cx="20" cy="12" r="7"/>${state === "PARTIAL" ? '<path class="half" d="M20 5A7 7 0 0 0 20 19Z"/>' : ""}</g></svg><span><strong>${state}</strong> <span class="muted">${esc(STATE_GEOMETRY[state])}</span></span></li>`;
  return `<details class="ww-section ww-legend"><summary>How to read The Wall</summary><ul class="ww-legend-list">${SUPPORT_STATES.map(swatch).join("")}</ul><p class="muted small">Pieces rest on what supports them: authorities and sources first, then observations, claims, WalletWall's derivation and the readiness keystone; subjects (chain, contract, wallet) sit with the claims they are about. Terracotta marks focus and the selected path; it never means good or bad.</p></details>`;
}

/**
 * WalletWallaby's cues, each tied to one piece the cue is about (data-node). The first is chosen by the model's dominant
 * story, a fixed precedence over returned states (conflict, then staleness, then a weak focal claim, then an
 * established Wallmark); one per piece follows, for when that piece is selected. Every cue repeats returned states only.
 */
function guideCues(view, model) {
  const cues = [];
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const first = (type, pred = () => true) => model.nodes.find((n) => n.type === type && pred(n));
  const st = (n) => (n.wwepState === null ? "without an evaluation" : KNOWN.includes(n.wwepState) ? n.wwepState : "in a state WalletWall does not recognise");
  const t = model.storyTarget ? byId.get(model.storyTarget) : null;
  if (model.dominantStory === "conflict" && t) cues.push(["conflict", t.id, "inspect", "These two claims disagree, so WalletWall marks a conflict between them and picks no winner."]);
  else if (model.dominantStory === "stale" && t) cues.push(["stale", t.id, "inspect", t.type === "wallmark" ? "The Wallmark is STALE: its evidence is older than the policy allows for a current claim." : `${t.type === "readiness" ? "Readiness" : t.label} is STALE: an input is older than the policy allows.`]);
  else if (model.dominantStory === "other" && t) cues.push([t.wwepState === "PARTIAL" ? "partial" : "invariant", t.id, "inspect", t.wwepState === "PARTIAL" ? `${t.type === "readiness" ? "Readiness" : t.label} is PARTIAL: some usable evidence exists, but not enough for the policy.` : "The engine reports invariant violations on this claim. About this panel lists each one."]);
  else if (model.dominantStory === "unknown" && t) cues.push(["unknown", t.id, "inspect", `${t.type === "readiness" ? "Readiness" : t.label} is ${st(t)}: shown as missing evidence, never as false or zero.`]);
  else if (model.dominantStory === "established" && t) cues.push(["established", t.id, "perch", "This Wallmark's evidence satisfies the published policy, and the readiness keystone rests on it."]);
  const missing = model.nodes.find((n) => n.missing);
  if (missing) cues.push(["unknown", missing.id, "inspect", missing.type === "observation" ? "This observation returned no result. WalletWall leaves the gap instead of filling it with zero." : "This slot is empty because the bundle refers to something it does not contain."]);
  const keystone = first("readiness");
  if (keystone && view.readiness && view.readiness.result?.classification !== "CRITERIA_MET") cues.push(["readiness", keystone.id, "perch", "The keystone is not seated: a readiness criterion is not in place. The checklist shows which."]);
  const superseded = model.nodes.find((n) => n.superseded);
  if (superseded) cues.push(["superseded", superseded.id, "perch", "This faint piece was superseded by a later claim. It stays on The Wall as history."]);
  const anchor = model.nodes.find((n) => n.primary) ?? model.nodes[0];
  if (anchor) cues.push(["orientation", anchor.id, "perch", "Select a piece to see what it rests on and what rests on it."]);
  // One cue per piece, for when it is selected.
  for (const n of model.nodes) {
    const obs = model.edges.filter((e) => e.to === n.id && e.kind === "supports").length;
    const src = model.edges.find((e) => e.to === n.id && e.kind === "observed");
    const via = n.type === "source" && typeof n.data?.transport?.retrievedVia === "string" ? short(n.data.transport.retrievedVia, 20) : null;
    const text = {
      wallmark: () => `The Wallmark is ${st(n)}${n.freshness ? `, freshness ${KNOWN_FRESH.includes(n.freshness) ? n.freshness : "not recognised"}` : ""}. Trace shows the source and observation it rests on.`,
      assertion: () => `${n.label} is ${st(n)}. ${n.wwepState === "CONFLICTING" ? "It disagrees with another claim; WalletWall picks no winner." : `It rests on ${obs} observation${obs === 1 ? "" : "s"}.`}`,
      readiness: () => `Readiness is ${n.readinessError ? "not assessed" : KNOWN_CLASS.includes(n.classification) ? n.classification : "not recognised"}; its support is ${st(n)}. The checklist shows each criterion as returned.`,
      observation: () => `${n.label} came from ${src ? byId.get(src.from).label : "a source not in the bundle"}. ${n.missing ? "It returned no result, which is not zero." : "Its value is in the detail, exactly as presented."}`,
      source: () => `A ${String(n.label).toLowerCase()} source.${via ? ` Transport such as ${via} is not an authority.` : " What it observed rests on it."}`,
      authority: () => (n.unattested ? "Named as issuer by the Wallmark; no source in the bundle speaks for it." : "An issuer or protocol authority. Sources speak for it; it is never inferred from transport."),
      derivation: () => "A WalletWall rule. Its result is WalletWall-derived, never an upstream authority.",
      conflict: () => "These two claims disagree. WalletWall marks the conflict and picks no winner.",
      gap: () => "Something the bundle refers to is missing. The gap stays visible; it is never filled with zero.",
      snapshot: () => "Reserved for immutable snapshots. Nothing is stored or snapshotted today.",
      contract: () => "The contract the claims are about. Its full address is in the detail, with Copy.",
      wallet: () => "The holder a balance claim is about. Its full address is in the detail, with Copy.",
      chain: () => "The chain ID the claims are about. It anchors the contract and the wallet.",
      stablecoin: () => "The symbol the Wallmark presents. A symbol is not an identity.",
    }[n.type];
    if (text) cues.push(["node", n.id, n.type === "conflict" || n.missing ? "inspect" : "perch", text()]);
  }
  return `<ul class="ww-guide-cues" hidden>${cues.map(([cue, node, pose, text]) => `<li data-cue="${cue}" data-node="${esc(node)}" data-pose="${pose}">${esc(text)}</li>`).join("")}</ul>`;
}
const KNOWN = SUPPORT_STATES;
const KNOWN_FRESH = FRESHNESS_STATES;
const KNOWN_CLASS = READINESS_CLASSES;

export function renderView(view) {
  if (view.status === "empty") {
    const fx = (view.fixtures ?? []).map((f) => `<li><code>${esc(f.name)}</code> <span class="muted">${esc(f.title)}</span></li>`).join("");
    return `<div class="ww-summary"><header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1></div></header></div><p class="note">Nothing is loaded. Ask Copilot to inspect a WWEP evidence bundle and open it here, or open WalletWall with one of the bundled synthetic fixtures:</p><ul class="limits">${fx}</ul><p class="muted small">This panel only displays results returned by the local WalletWall MCP server. It computes nothing itself.</p>`;
  }
  if (view.status === "error") {
    return `<div class="ww-summary"><header class="ww-rail"><span class="ww-mark" role="img" aria-label="WalletWall mark"></span><div class="ww-rail-name"><h1>WalletWall</h1></div></header></div><p class="note" data-attention="true" role="alert">The evidence could not be evaluated: <code>${esc(view.error.code)}</code>. ${esc(view.error.message)} No states are shown.</p>`;
  }
  const selected = view.assertions.find((a) => a.id === view.selectedId) ?? view.assertions[0];
  const v = view.versions ?? {};
  const inv = Array.isArray(view.invariantViolations) ? view.invariantViolations : [];
  // The visual model is a projection of this view; if it cannot be built, the evaluated state stays inspectable.
  let model;
  try {
    model = buildCoinstellation(view, { mode: "overview" });
  } catch {
    model = null;
  }
  // Without a model every assertion stays reachable: a plain list of each one with its returned support state.
  const unplaced = () =>
    `<div class="note" data-attention="true"><p>The Wall could not be drawn for this bundle. Each assertion is listed with its evaluated support state; select one to see its detail.</p><ul class="limits">${view.assertions
      .map((a) => `<li><button type="button" class="link" data-assertion-id="${esc(a.id)}">${esc(ASSERTION_LABELS[a.claimType] ?? a.claimType)} <code>${esc(a.id)}</code></button> ${a.evaluation ? stateChip(a.evaluation.supportState, SUPPORT_STATES) : '<span class="chip" data-attention="true" data-state="NA">no evaluation</span>'}</li>`)
      .join("")}</ul></div>`;
  const wall = model ? renderWall(model, { digest: view.bundleDigest }) : unplaced();
  const empty = { nodes: [], edges: [] };
  return `${summaryHeader(view, model ?? empty)}
<div class="ww-panel-info" id="panel-info">
<p class="note ww-boundary">States describe how well the presented evidence satisfies published policy. They do not verify that upstream data is true, and they are not statements about safety, solvency or investment merit.</p>
${panelToolbar()}
<p class="meta">Evaluated at <code>${esc(view.evaluatedAt)}</code> · WWEP <code>${esc(v.wwep)}</code> · registry <code>${esc(v.registry)}</code> · policies <code>${esc(v.policies)}</code> · rules <code>${esc(v.rules)}</code><br/>Bundle digest <code>${esc(view.bundleDigest)}</code> · Invariant violations: <strong>${esc(view.invariantViolationCount)}</strong>${view.source ? ` · Source: <code>${esc(view.source)}</code>` : ""}</p>
${inv.length ? `<ul class="limits ww-violations">${inv.map((x) => `<li data-attention="true"><code>${esc(x.invariant)}</code> <code>${esc(x.code)}</code> ${x.assertionId ? `on <code>${esc(x.assertionId)}</code>` : ""} <span class="muted">${esc(x.rule)}</span></li>`).join("")}</ul>` : ""}
</div>
<div class="ww-flow">
<div class="ww-stage"><section class="ww-wall" aria-labelledby="h-wall"><div class="ww-section-head"><h2 id="h-wall">The Wall</h2>${stageTools()}<button type="button" class="ww-back" data-back-overview>Back to Overview</button></div><div class="ww-guide-slot"></div><div class="ww-wall-view">${wall}</div><div class="ww-tip" id="ww-tip" role="tooltip" hidden></div></section>
<aside class="ww-detail" id="detail" aria-label="Selected piece" data-sheet="peek"><div class="ww-sheet-bar"><button type="button" class="ww-sheet-grip" data-sheet-toggle aria-expanded="false" aria-controls="detail" aria-label="Show more of the selected piece"><span aria-hidden="true"></span></button></div>${selected ? detail(view, selected) : '<p class="muted">The bundle has no assertions.</p>'}${model ? piecePanels(model) : ""}<div class="ww-sheet-actions" role="group" aria-label="Selected piece actions"><button type="button" data-mode="trace">Trace</button><button type="button" data-show-on-wall>Show on Wall</button><button type="button" data-sheet-full>More</button></div></aside></div>
${wallprint(view, model ?? empty)}
${readinessAssembly(view.readiness, model ?? empty)}
${listSurface(view, model ?? empty)}
${readinessPanel(view.readiness)}
${legend()}
${receipt()}
${textVersion(model ?? empty)}
</div>
${model ? guideCues(view, model) : ""}`;
}

export function renderPage({ nonce }) {
  const brandCss = `.ww-mark{background-image:url("${MARK}")}.ww-wallaby-art[data-pose="inspect"]{background-image:url("${WALLABY.inspect}")}.ww-wallaby-art[data-pose="perch"]{background-image:url("${WALLABY.perch}")}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>WalletWall</title><link rel="icon" type="image/png" sizes="96x96" href="${MARK}"><style nonce="${esc(nonce)}">${FONT_FACES}\n${brandCss}\n${CSS}</style></head><body><main id="app" data-mode="overview" data-motion="full"><p class="muted">Loading…</p></main><p id="view-status" class="ww-sr" role="status" aria-live="polite"></p><aside id="wallaby" class="ww-wallaby" hidden data-peek="out" aria-label="WalletWallaby, the WalletWall guide"><span id="wallaby-art" class="ww-wallaby-art" data-pose="inspect" aria-hidden="true"></span><div class="ww-wallaby-bubble"><p class="ww-eyebrow">WalletWallaby</p><p id="wallaby-text"></p></div></aside><p id="copy-status" class="copy-status" role="status" aria-live="polite"></p><script nonce="${esc(nonce)}">${CLIENT_JS}</script></body></html>`;
}
