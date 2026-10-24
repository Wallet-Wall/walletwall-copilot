// The Wall, drawn as a Coinstellation: SVG for the visual model that coinstellation-model.mjs projects from the
// authoritative Canvas view. This file only draws; it reads states from the model, which copied them verbatim.
//
// Rules this file must keep:
//  - It never computes, upgrades or downgrades a support, freshness, finality, authority, conflict or readiness state.
//  - Geometry and colour are never the only carrier of meaning: every piece has a text label, a state chip where it has
//    a state, an accessible name, and a row in the text version of The Wall.
//  - Output is deterministic: the same model always produces the same markup.
//
// The node language is adapted from walletwall-coinstellation (Wallet-Wall/walletwall-coinstellation@3ff0942, MIT,
// Copyright (c) 2024 Wallet-Wall): one circular node family with a small glyph, straight connectors with a small arrow,
// a selection ring, and an anomaly-style ring for conflict. Its five demo node colours are replaced by one restrained
// family plus state treatments; the readiness keystone is the one other silhouette.
import { EDGE_KINDS, HIT, KEYSTONE, KNOWN_CLASSES, KNOWN_STATES, NODE_R, NODE_TYPES, chipWidth, short, stateText, classText } from "./coinstellation-model.mjs";

export { NODE_TYPES, EDGE_KINDS, short };

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Small glyphs, one per kind of piece, drawn in a 16-unit box around the piece's centre. */
const GLYPH = {
  authority: "M-6 -2.5h12M-4.5 -2.5v6M-1.5 -2.5v6M1.5 -2.5v6M4.5 -2.5v6M-6.5 4.5h13M-6 -3.5l6 -4l6 4",
  source: "M-5.5 -1.5a7.5 7.5 0 0 1 11 0M-3 1.5a4 4 0 0 1 6 0M0 4.6v0.1",
  observation: "M-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0M-6.5 0h2.5M4 0h2.5M0 -6.5v2.5M0 4v2.5",
  assertion: "M-6.5 -4.5h13v9h-13zM-6.5 0h13M-1.5 -4.5v4.5M2.5 0v4.5",
  wallmark: "M-7 -5h14v10h-14zM-7 0h14M-2.5 -5v5M3 -5v5M0.5 0v5M-5 0v5M5.5 0v5",
  derivation: "M-6.5 -5c3.5 0 4 5 7 5M-6.5 5c3.5 0 4 -5 7 -5M0.5 0h6M4 -2.5l2.5 2.5l-2.5 2.5",
  conflict: "M-1.5 -7.5l3.5 5.5l-3.5 2.5l3.5 7",
  gap: "M-2.6 -2.6a2.6 2.6 0 1 1 3.6 2.4c-0.8 0.4 -1 0.9 -1 1.8M0 4.4v0.1",
  snapshot: "M-4.5 -4.5h9v9h-9z",
  chain: "M-1 -3.2h-2.6a3.2 3.2 0 0 0 0 6.4h2.6M1 -3.2h2.6a3.2 3.2 0 0 1 0 6.4h-2.6M-2.5 0h5",
  contract: "M-4.5 -6.5h5.5l3.5 3.5v10h-9zM1 -6.5v3.5h3.5M-2 0.5h4M-2 3.5h4",
  wallet: "M-6.5 -4.5h11.5a1.5 1.5 0 0 1 1.5 1.5v7.5h-13zM6.5 -1h-3.5a1.6 1.6 0 0 0 0 3.2h3.5",
  stablecoin: "M-5.5 0a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0M-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0",
};

const r1 = (v) => (Math.round(v * 10) / 10).toString();

/** The keystone outline: wider at the top, seated on its course. */
const keystonePath = (w, h) => `M${r1(-w / 2)} ${r1(-h / 2)}H${r1(w / 2)}L${r1(w / 2 - 12)} ${r1(h / 2)}H${r1(-w / 2 + 12)}Z`;

/**
 * The path of one connection, clipped to the two pieces' outlines (a circle, or the keystone's box). With a bend it is a
 * gentle curve around a piece it would otherwise cross; a conflict connection is drawn broken in the middle.
 * Self-contained: the page embeds this function's source.
 */
export function edgePath(a, b, kind, bend) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const k = Number(bend) || 0;
  const c = k ? { x: (a.x + b.x) / 2 - uy * 2 * k, y: (a.y + b.y) / 2 + ux * 2 * k } : null;
  const dir = (p, q) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  const clip = (n, d) => (n.kw ? Math.min(d.x === 0 ? Infinity : (n.kw / 2 + 3) / Math.abs(d.x), d.y === 0 ? Infinity : (n.kh / 2 + 3) / Math.abs(d.y)) : n.r + 3);
  const ds = c ? dir(a, c) : { x: ux, y: uy };
  const de = c ? dir(c, b) : { x: ux, y: uy };
  const s = Math.min(clip(a, ds), len / 2 - 1);
  const t = Math.min(clip(b, de), len / 2 - 1);
  const x1 = a.x + ds.x * s;
  const y1 = a.y + ds.y * s;
  const x2 = b.x - de.x * t;
  const y2 = b.y - de.y * t;
  const f = (v) => (Math.round(v * 10) / 10).toString();
  if (c) return `M${f(x1)} ${f(y1)}Q${f(c.x)} ${f(c.y)} ${f(x2)} ${f(y2)}`;
  if (kind === "conflict") {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const g = 4;
    return `M${f(x1)} ${f(y1)}L${f(mx - ux * g)} ${f(my - uy * g)}M${f(mx + ux * g)} ${f(my + uy * g)}L${f(x2)} ${f(y2)}`;
  }
  return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
}

/** How far a connection bends so that it passes no other piece: 0 if a straight line is clear. */
function bendFor(a, b, others) {
  const near = (k) => {
    const c = k ? { x: (a.x + b.x) / 2 - ((b.y - a.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1)) * 2 * k, y: (a.y + b.y) / 2 + ((b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1)) * 2 * k } : null;
    let hits = 0;
    for (let i = 1; i < 16; i++) {
      const s = i / 16;
      const p = c ? { x: (1 - s) * (1 - s) * a.x + 2 * (1 - s) * s * c.x + s * s * b.x, y: (1 - s) * (1 - s) * a.y + 2 * (1 - s) * s * c.y + s * s * b.y } : { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
      for (const o of others) {
        if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + 9) hits++;
        // and the piece's label under it
        if (o.lw && Math.abs(p.x - o.x) < o.lw / 2 + 4 && Math.abs(p.y - (o.y + o.r + 11)) < 9) hits++;
      }
    }
    return hits;
  };
  if (near(0) === 0) return 0;
  let best = { k: 0, h: near(0) };
  for (const k of [18, -18, 30, -30, 44, -44, 60, -60]) {
    const h = near(k);
    if (h < best.h) best = { k, h };
    if (h === 0) break;
  }
  return best.k;
}

const t = (x, y, cls, text) => `<text x="${r1(x)}" y="${r1(y)}" text-anchor="middle" class="${cls}">${esc(text)}</text>`;
function chip(text, attention, y, x = 0, cls = "") {
  const w = chipWidth(text);
  return `<g class="ww-chip${cls}" transform="translate(${r1(x)} ${r1(y)})"${attention ? ' data-attention="true"' : ""}><rect x="${r1(-w / 2)}" y="-6.5" width="${r1(w)}" height="13" rx="2"/>${t(0, 3, "ww-chip-text", text)}</g>`;
}

/** The minimum touch target of a piece, in drawing units. */
function baseHit(n) {
  if (n.type === "readiness") return { w: Math.max(HIT, KEYSTONE.w + 4), h: Math.max(HIT, KEYSTONE.h + 4) };
  const side = Math.max(HIT, 2 * (NODE_R[n.type] ?? 14) + 8);
  return { w: side, h: side };
}

// Touch targets grow from the minimum into the free space around each piece, up to HIT_MAX, keeping HIT_GAP clear of a
// neighbour's target and staying inside the frame: a phone-sized frame drawn below 1:1 still gives every piece 44 CSS
// pixels. Squares centred d apart (d the larger of the two axis distances) keep the gap when each half-side is at most
// (d - gap) / 2 and at most d - gap minus the other's minimum half-side; the keystone keeps its minimum.
const HIT_MAX = 60;
const HIT_GAP = 10;
function hitSizes(nodes, key, box) {
  const base = nodes.map(baseHit);
  return new Map(nodes.map((n, i) => {
    if (n.type === "readiness") return [n.id, base[i]];
    const p = n[key];
    let half = Math.min(HIT_MAX / 2, p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y);
    nodes.forEach((m, j) => {
      if (j === i) return;
      const dx = Math.abs(p.x - m[key].x), dy = Math.abs(p.y - m[key].y);
      if (m.type === "readiness") half = Math.min(half, Math.max(dx - base[j].w / 2, dy - base[j].h / 2) - HIT_GAP);
      else { const d = Math.max(dx, dy) - HIT_GAP; half = Math.min(half, d / 2, d - base[j].w / 2); }
    });
    const side = Math.max(base[i].w, Math.floor(half * 2));
    return [n.id, { w: side, h: side }];
  }));
}

/** One piece: an invisible touch target, the shape (circle or keystone) with its glyph and state rings, label and chip. */
function piece(n, selectedId, wideHit, tallHit) {
  const keystone = n.type === "readiness";
  const r = keystone ? KEYSTONE.h / 2 : NODE_R[n.type] ?? 14;
  const hitW = wideHit.w;
  const hitH = wideHit.h;
  const rings = [];
  if (n.superseded) rings.push(keystone ? "" : `<circle class="ghost" cx="5" cy="-5" r="${r}"/>`);
  // Matte and drafted: a flat fill and one ring. A state adds at most one more ring (conflict, staleness), close to the
  // first, so no piece becomes a layered token.
  if (!keystone && (n.type === "conflict" || n.wwepState === "CONFLICTING")) rings.push(`<circle class="ww-ring ww-ring-conflict" r="${r + 3.5}"/>`);
  if (!keystone && (n.wwepState === "STALE" || (n.freshness === "STALE" && n.wwepState !== "CONFLICTING"))) rings.push(`<circle class="ww-ring ww-ring-stale" r="${r + 3.5}"/>`);
  const body = keystone ? `<path class="body" d="${keystonePath(KEYSTONE.w, KEYSTONE.h)}"/><line class="seat" x1="${-KEYSTONE.w / 2 + 12}" y1="${KEYSTONE.h / 2 + 5}" x2="${KEYSTONE.w / 2 - 12}" y2="${KEYSTONE.h / 2 + 5}"/>` : `<circle class="body" r="${r}"/>`;
  const half = !keystone && n.wwepState === "PARTIAL" ? `<path class="half" d="M0 ${-r}A${r} ${r} 0 0 0 0 ${r}Z"/>` : "";
  // The glyph is a small engraved hint, about a third of the piece's diameter, drawn with a constant 1.25-unit line.
  const scale = r / 22;
  const glyph = keystone ? t(0, 4, "ww-key-text", "READINESS") : `<path class="ww-glyph" transform="scale(${r1(scale * 100) / 100})" stroke-width="${Math.round((1.25 / scale) * 100) / 100}" d="${GLYPH[n.type] ?? GLYPH.assertion}"/>`;
  // Selection is the piece's own ring, heavier and in terracotta (the halo lies on the ring, it does not add one). The
  // guide's pointer is four short radial ticks across the ring, nothing like the dotted ring that means STALE.
  const tick = (a) => { const c = Math.cos(a), si = Math.sin(a); return `M${r1(c * (r - 2))} ${r1(si * (r - 2))}L${r1(c * (r + 2.2))} ${r1(si * (r + 2.2))}`; };
  const halo = keystone ? `<rect class="ww-halo" x="${-KEYSTONE.w / 2 - 5}" y="${-KEYSTONE.h / 2 - 5}" width="${KEYSTONE.w + 10}" height="${KEYSTONE.h + 10}" rx="4"/>` : `<circle class="ww-halo" r="${r}"/>`;
  const reticle = keystone ? `<rect class="ww-reticle" x="${-KEYSTONE.w / 2 - 5}" y="${-KEYSTONE.h / 2 - 5}" width="${KEYSTONE.w + 10}" height="${KEYSTONE.h + 10}" rx="4" pathLength="100"/>` : `<path class="ww-reticle" d="${[1, 3, 5, 7].map((k) => tick((k * Math.PI) / 4)).join("")}"/>`;
  let words;
  if (keystone) {
    // Two chips side by side under the keystone: the readiness classification, then the support of the claim.
    const c = n.chip;
    const a = chipWidth(c.text);
    const b = chipWidth(c.second);
    const y = KEYSTONE.h / 2 + 19;
    words = `${chip(c.text, c.attention, y, -(b + 4) / 2, " ww-chip-class")}${chip(c.second, !["ESTABLISHED", "SUPPORTED"].includes(n.wwepState), y, (a + 4) / 2)}`;
  } else {
    words = `${t(0, r + 15, "ww-label", n.label)}${n.chip ? chip(n.chip.text, n.chip.attention, r + 29) : ""}`;
  }
  const state = n.wwepState === undefined ? "" : ` data-state="${n.wwepState === null ? "NONE" : KNOWN_STATES.includes(n.wwepState) ? esc(n.wwepState) : "UNRECOGNISED"}"`;
  const flags = [n.superseded ? "superseded" : "", n.missing ? "missing" : "", n.unattested ? "unattested" : ""].filter(Boolean).join(" ");
  const cls = n.classification !== undefined ? ` data-classification="${KNOWN_CLASSES.includes(n.classification) ? esc(n.classification) : "UNRECOGNISED"}"` : "";
  const shape = keystone ? ` data-kw="${KEYSTONE.w}" data-kh="${KEYSTONE.h}"` : ` data-r="${r}"`;
  const selected = n.assertionId !== undefined && n.assertionId === selectedId;
  const where = `data-w="${hitW}" data-h="${hitH}" data-px="${n.tall.x}" data-py="${n.tall.y}" data-pw="${tallHit.w}" data-ph="${tallHit.h}"${shape}`;
  return `<g class="ww-node${selected ? " is-selected" : ""}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${esc(n.accessibleLabel)}" data-node-id="${esc(n.id)}" data-type="${esc(n.type)}" data-entity="${esc(n.entityType)}"${state} data-visual="${esc(n.state)}"${flags ? ` data-flags="${flags}"` : ""}${n.assertionId !== undefined ? ` data-assertion-id="${esc(n.assertionId)}"` : ""}${cls}${n.primary ? ' data-primary="true"' : ""}${n.onTrace ? ' data-trace="true"' : ""} ${where} transform="translate(${n.wide.x} ${n.wide.y})"><rect class="ww-hit" x="${-hitW / 2}" y="${-hitH / 2}" width="${hitW}" height="${hitH}"/><g class="ww-node-art">${rings.join("")}${body}${half}${halo}${glyph}${reticle}</g>${words}</g>`;
}

/** The Wall as SVG: connectors under pieces. Positions come from the model; the page animates and pins from the same data. */
export function renderWall(model, { digest }) {
  const { nodes, edges } = model;
  if (nodes.length === 0) return '<p class="muted">The bundle has no pieces to place.</p>';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const geom = (n, key = "wide") => (n.type === "readiness" ? { x: n[key].x, y: n[key].y, kw: KEYSTONE.w, kh: KEYSTONE.h, r: KEYSTONE.w / 2 } : { x: n[key].x, y: n[key].y, r: NODE_R[n.type] ?? 14 });
  const obstacle = (n, key) => ({ ...geom(n, key), lw: n.type === "readiness" ? 0 : String(n.label).length * 6.9 });
  const bends = (key) => edges.map((e) => bendFor(geom(byId.get(e.from), key), geom(byId.get(e.to), key), nodes.filter((n) => n.id !== e.from && n.id !== e.to).map((n) => obstacle(n, key))));
  const wideBend = bends("wide");
  const tallBend = bends("tall");
  const story = new Set(model.storyPath ?? []);
  const inStory = (e) => (model.dominantStory === "conflict" ? e.kind === "conflict" : story.has(e.from) && story.has(e.to));
  const edgeMarkup = edges
    .map((e, i) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const kind = EDGE_KINDS[e.kind];
      return `<path class="ww-edge" data-kind="${esc(e.kind)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-rel="${esc(e.relationship)}"${kind.why ? ' data-evidence="true"' : ""}${e.activeTrace ? ' data-trace="true"' : ""}${inStory(e) ? ' data-story="true"' : ""} data-bend="${wideBend[i]}" data-pbend="${tallBend[i]}" d="${edgePath(geom(a), geom(b), e.kind, wideBend[i])}"${e.kind === "conflict" || e.kind === "reserved" ? "" : ' marker-end="url(#ww-arrow)"'}><title>${esc(`${a.label} ${kind.name} ${b.label}`)}</title></path>`;
    })
    .join("");
  // The lit lip of each connector: the same path, offset by the stylesheet, under every connector, so a line reads as cut
  // into the stage. Decorative; it carries the connector's kind and emphasis only so it can follow its strength.
  const lips = edges.map((e, i) => `<path class="ww-edge-lip" data-kind="${esc(e.kind)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.activeTrace ? ' data-trace="true"' : ""}${inStory(e) ? ' data-story="true"' : ""} d="${edgePath(geom(byId.get(e.from)), geom(byId.get(e.to)), e.kind, wideBend[i])}"/>`).join("");
  // Trace glints: a light overlay on each connector of the provenance trace whose opacity pulses from the sources toward
  // the claim (step = how many trace connectors lead into it). Only opacity animates; the connector itself stays solid.
  const traced = edges.filter((e) => e.activeTrace);
  const depth = new Map();
  for (let pass = 0; pass < traced.length; pass++) for (const e of traced) depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(e.from) ?? 0) + 1));
  const glints = traced.map((e) => `<path class="ww-glint" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${esc(e.kind)}" data-step="${Math.min(depth.get(e.from) ?? 0, 5)}" d="${edgePath(geom(byId.get(e.from)), geom(byId.get(e.to)), e.kind, wideBend[edges.indexOf(e)])}"/>`).join("");
  const w = model.box.wide;
  const p = model.box.tall;
  const wideHits = hitSizes(nodes, "wide", w);
  const tallHits = hitSizes(nodes, "tall", p);
  const nodeMarkup = nodes.map((n) => piece(n, model.authoritativeSelectedAssertionId, wideHits.get(n.id), tallHits.get(n.id))).join("");
  return `<svg class="ww-wall-svg" viewBox="${w.x} ${w.y} ${w.w} ${w.h}" width="${w.w}" height="${w.h}" data-digest="${esc(digest)}" data-portrait-viewbox="${p.x} ${p.y} ${p.w} ${p.h}" data-story="${esc(model.dominantStory ?? "none")}"${model.storyTarget ? ` data-story-target="${esc(model.storyTarget)}"` : ""} data-view-version="${esc(model.coinstellationViewVersion)}" role="group" aria-label="The Wall: ${nodes.length} pieces and ${edges.length} connections. The same information is listed in the text version and the list below.">
<defs><marker id="ww-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>
<g class="ww-edge-lips" aria-hidden="true">${lips}</g><g class="ww-edges">${edgeMarkup}</g>${glints ? `<g class="ww-glints" aria-hidden="true">${glints}</g>` : ""}<g class="ww-nodes">${nodeMarkup}</g></svg>`;
}

export { stateText, classText };
