// The Wall, drawn as a Coinstellation: SVG for the visual model that coinstellation-model.mjs projects from the
// authoritative Canvas view. This file only draws; it reads states from the model, which copied them verbatim.
//
// Rules this file must keep:
//  - It never computes, upgrades or downgrades a support, freshness, finality, authority, conflict or readiness state.
//  - Geometry and colour are never the only carrier of meaning: every piece has a text label, a state annotation where it
//    has a state, an accessible name, and a row in the text version of The Wall.
//  - Output is deterministic: the same model always produces the same markup.
//
// The drawing is a technical plate, not a set of tokens. Only the semantic anchors carry strong geometry: the Wallmark
// seal, the claims, the conflict fracture and the readiness keystone. Observations and WalletWall's rule are light
// drafting marks (a registration cross, a summing junction); context (authorities, sources, subjects, the snapshot
// slot) is a small index mark and its name. States are written beside the piece in small capitals, never boxed.
// Connections are drafted: straight where pieces align, otherwise out, a riser with 45-degree shoulders, and in; their
// weight says which relationships matter (evidence, then leaders from sources, then faint references to context).
// Adapted from walletwall-coinstellation (Wallet-Wall/walletwall-coinstellation@3ff0942, MIT, Copyright (c) 2024
// Wallet-Wall): the circular node, the glyphs, the selection ring and the anomaly ring for conflict.
import { EDGE_KINDS, HIT, KEYSTONE, KNOWN_CLASSES, KNOWN_STATES, NODE_R, NODE_TYPES, TIER, LINE_CLASS, ANNOT_STEP, annotWidth, labelY, short, stateText, classText } from "./coinstellation-model.mjs";

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
 * The path of one connection, drafted: clipped to the two pieces' outlines (a mark's radius, or the keystone's box).
 * Aligned pieces get one straight line. Otherwise the line leaves along the drawing's main axis (`dir` "x" for the wide
 * plate, "y" for the tall one), turns through a riser with 45-degree shoulders and arrives along the main axis, so it
 * enters a piece from the side and never through its label. The riser stands a fixed distance before the target by
 * default (inputs to one column share it, like a bus); a `lane` (percent of the way from the source) moves it clear of
 * other pieces, and an aligned line that would cross pieces takes a detour (a lane above 100). With no room along the
 * main axis it leaves across and turns in, as a leader. A conflict connection is broken at its middle.
 * Self-contained: the page embeds this function's source.
 */
export function edgePath(a, b, kind, lane, dir) {
  const f = (v) => (Math.round(v * 10) / 10).toString();
  const H = dir !== "y";
  const pt = (u, v) => (H ? `${f(u)} ${f(v)}` : `${f(v)} ${f(u)}`);
  // How far a piece reaches from its centre along an axis; below it (screen down, `side` 1) its label and state reach
  // further (lb), so a line leaves under the words and arrives at their foot instead of crossing them.
  const reach = (n, alongU, side) => Math.max(n.kw ? (alongU === H ? n.kw : n.kh) / 2 + 3 : (Number(n.r) || 0) + 3, side === 1 && alongU !== H ? (Number(n.lb) || 0) + 2 : 0);
  const au = H ? a.x : a.y, av = H ? a.y : a.x, bu = H ? b.x : b.y, bv = H ? b.y : b.x;
  const du = bu - au, dv = bv - av;
  const su = du < 0 ? -1 : 1, sv = dv < 0 ? -1 : 1;
  const gap = (p, q) => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, g = Math.min(4, l / 4);
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], e = [((q[0] - p[0]) / l) * g, ((q[1] - p[1]) / l) * g];
    return [[m[0] - e[0], m[1] - e[1]], [m[0] + e[0], m[1] + e[1]]];
  };
  // A polyline of [u, v] points; a conflict breaks its longest segment in the middle.
  const draw = (ps) => {
    if (kind !== "conflict") return `M${ps.map((p) => pt(p[0], p[1])).join("L")}`;
    let k = 0, best = -1;
    for (let i = 0; i + 1 < ps.length; i++) { const l = Math.hypot(ps[i + 1][0] - ps[i][0], ps[i + 1][1] - ps[i][1]); if (l > best) { best = l; k = i; } }
    const [m1, m2] = gap(ps[k], ps[k + 1]);
    return `M${[...ps.slice(0, k + 1), m1].map((p) => pt(p[0], p[1])).join("L")}M${[m2, ...ps.slice(k + 1)].map((p) => pt(p[0], p[1])).join("L")}`;
  };
  // A lane above 100 is a detour: an aligned line that would run through other pieces steps aside by (lane - 150)
  // units on 45-degree shoulders, runs parallel, and steps back.
  const t = Number(lane) || 0;
  const off = t > 100 ? t - 150 : 0;
  if (Math.abs(dv) < 1.5 || Math.abs(du) < 1.5) {
    const along = Math.abs(dv) < 1.5;
    const s1 = along ? su : sv;
    const [p0, p1, q] = along ? [au + su * reach(a, true, su), bu - su * reach(b, true, -su), av] : [av + sv * reach(a, false, sv), bv - sv * reach(b, false, -sv), au];
    const k = Math.abs(off);
    const P = (x, y) => (along ? [x, y] : [y, x]);
    if (k && (p1 - p0) * s1 > 2 * k + 8) return draw([P(p0, q), P(p0 + s1 * k, q + off), P(p1 - s1 * k, q + off), P(p1, q)]);
    return draw([P(p0, q), P(p1, q)]);
  }
  const u0 = au + su * reach(a, true, su), u1 = bu - su * reach(b, true, -su);
  const room = (u1 - u0) * su;
  if (room >= 14) {
    // The riser stands a fixed distance before the target's centre, so every input to one column shares one bus line.
    const bus = bu - su * Math.max(reach(b, true, -su) + 12, 44);
    const um = t && t <= 100 ? u0 + (u1 - u0) * (t / 100) : (bus - u0) * su >= 8 ? bus : u1 - su * Math.min(16, room / 2);
    const c = Math.min(6, Math.abs(dv) / 2, Math.abs(um - u0), Math.abs(u1 - um));
    return draw([[u0, av], [um - su * c, av], [um, av + sv * c], [um, bv - sv * c], [um + su * c, bv], [u1, bv]]);
  }
  if (Math.abs(du) >= reach(b, true, -su) + 6) {
    const v0 = av + sv * reach(a, false, sv);
    const c = Math.min(6, Math.abs(bv - v0) / 2, Math.abs(du) - reach(b, true, -su));
    return draw([[au, v0], [au, bv - sv * c], [au + su * c, bv], [u1, bv]]);
  }
  const l = Math.hypot(du, dv) || 1;
  return draw([[au + (du / l) * reach(a, true, su), av + (dv / l) * reach(a, false, sv)], [bu - (du / l) * reach(b, true, -su), bv - (dv / l) * reach(b, false, -sv)]]);
}

/** The points of a drafted path (M and L commands only), for routing checks. */
const pointsOf = (d) => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

/** Which lane keeps a connection clear of other pieces and their labels: 0 (the riser before the target) if it is clear. */
function laneFor(a, b, kind, others, dir) {
  const hits = (lane) => {
    const ps = pointsOf(edgePath(a, b, kind, lane, dir));
    let h = 0;
    for (let i = 0; i + 1 < ps.length; i++) {
      const p = ps[i], q = ps[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 6));
      for (let s = 0; s <= steps; s++) {
        const x = p.x + ((q.x - p.x) * s) / steps, y = p.y + ((q.y - p.y) * s) / steps;
        for (const o of others) {
          if (o.kw ? Math.abs(x - o.x) < o.kw / 2 + 5 && Math.abs(y - o.y) < o.kh / 2 + 5 : Math.hypot(x - o.x, y - o.y) < o.r + 6) h++;
          if (o.lw && Math.abs(x - o.x) < o.lw / 2 + 3 && y > o.y + o.ly0 - 2 && y < o.y + o.ly1 + 2) h++;
        }
      }
    }
    return h;
  };
  let best = { lane: 0, h: hits(0) };
  if (best.h === 0) return 0;
  const aligned = Math.abs(a.x - b.x) < 1.5 || Math.abs(a.y - b.y) < 1.5;
  for (const lane of aligned ? [128, 172, 116, 184] : [50, 30, 70, 15, 85]) {
    const h = hits(lane);
    if (h < best.h) best = { lane, h };
    if (h === 0) break;
  }
  return best.lane;
}

const t = (x, y, cls, text) => `<text x="${r1(x)}" y="${r1(y)}" text-anchor="middle" class="${cls}">${esc(text)}</text>`;
/** A state written beside its piece in small capitals: the returned value, never boxed. */
function annot(text, attention, y, cls = "") {
  return `<text x="0" y="${r1(y)}" text-anchor="middle" class="ww-annot${cls}"${attention ? ' data-attention="true"' : ""}>${esc(text)}</text>`;
}

/** The minimum touch target of a piece, in drawing units: a small mark keeps a full-size target. */
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

/** A small glyph drawn at `k` of its 16-unit box with a constant line, for the context pieces that keep one. */
const tinyGlyph = (type, k) => `<path class="ww-glyph" transform="scale(${k})" stroke-width="${Math.round((1.1 / k) * 100) / 100}" d="${GLYPH[type]}"/>`;

/**
 * The light marks: an observation is a registration cross, WalletWall's rule a summing junction, a missing piece an open
 * dashed ring; a source is a small solid index square, a stablecoin a small coin outline, the snapshot slot a dashed
 * square; an authority, chain, contract or wallet keeps a small glyph and no enclosure.
 */
function lightMark(n, r) {
  switch (n.type) {
    case "observation": {
      const ring = 3.6;
      return `<circle class="ww-draft ww-draft-ring" r="${ring}"/><path class="ww-draft" d="M${r} 0H${ring + 1.2}M${-r} 0H${-ring - 1.2}M0 ${r}V${ring + 1.2}M0 ${-r}V${-ring - 1.2}"/><circle class="ww-draft-dot" r="0.9"/>`;
    }
    case "derivation": {
      const d = r1(r * 0.52);
      return `<circle class="ww-draft ww-draft-ring" r="${r}"/><path class="ww-draft" d="M-${d} -${d}L${d} ${d}M${d} -${d}L-${d} ${d}"/>`;
    }
    case "gap":
      return `<circle class="ww-draft ww-draft-ring ww-draft-open" r="${r}"/>`;
    case "source":
      return `<rect class="ww-draft ww-draft-solid" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"/>`;
    case "stablecoin":
      return `<circle class="ww-draft ww-draft-ring" r="${r}"/>`;
    case "snapshot":
      return `<rect class="ww-draft ww-draft-open" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"/>`;
    default:
      return tinyGlyph(n.type, 0.55);
  }
}

/** How far below a piece's centre its words reach: the label, and the state annotation where there is one. */
function labelDepth(n) {
  if (n.type === "readiness") return KEYSTONE.h / 2 + 19 + (n.chip ? ANNOT_STEP + 3 : 0);
  return r1(labelY(n) + (n.chip ? ANNOT_STEP + 3 : 4));
}

/** One piece: an invisible touch target, its mark (anchor geometry or a light drafting mark), label and state. */
function piece(n, selectedId, wideHit, tallHit) {
  const keystone = n.type === "readiness";
  const tier = TIER[n.type] ?? "context";
  const r = keystone ? KEYSTONE.h / 2 : NODE_R[n.type] ?? 14;
  const anchor = tier === "anchor";
  const hitW = wideHit.w;
  const hitH = wideHit.h;
  // A light mark's ring is drawn only under focus, hover or selection (progressive emphasis); at rest it is the mark.
  const ring = anchor ? r : r + 3.5;
  const rings = [];
  if (n.superseded) rings.push(keystone ? "" : `<circle class="ghost" cx="5" cy="-5" r="${r}"/>`);
  // Matte and drafted: a flat fill and one ring. A state adds at most one more ring (conflict, staleness), close to the
  // first, so no piece becomes a layered token; the Wallmark's seal line sits inside its disc and gives way to a state.
  if (!keystone && n.type !== "conflict" && n.wwepState === "CONFLICTING") rings.push(`<circle class="ww-ring ww-ring-conflict" r="${r + 3.5}"/>`);
  if (!keystone && (n.wwepState === "STALE" || (n.freshness === "STALE" && n.wwepState !== "CONFLICTING"))) rings.push(`<circle class="ww-ring ww-ring-stale" r="${r + 3.5}"/>`);
  let body;
  if (keystone) body = `<path class="body" d="${keystonePath(KEYSTONE.w, KEYSTONE.h)}"/><line class="seat" x1="${-KEYSTONE.w / 2 + 12}" y1="${KEYSTONE.h / 2 + 5}" x2="${KEYSTONE.w / 2 - 12}" y2="${KEYSTONE.h / 2 + 5}"/>`;
  else if (n.type === "conflict") {
    // The conflict is an event in the drawing: a ring broken at both sides and a terracotta seam split across it.
    body = `<circle class="body" r="${r}" pathLength="100"/><path class="ww-seam" d="M${-r - 6} 1L${-r + 2} -1.5L${-r + 8} 2L-2 -2.5L3 2L${r - 8} -1.5L${r - 2} 2L${r + 6} -0.5"/>`;
  } else body = `<circle class="body" r="${ring}"/>`;
  const seal = n.type === "wallmark" ? `<circle class="ww-seal" r="${r - 3.5}"/>` : "";
  const half = !keystone && n.wwepState === "PARTIAL" ? `<path class="half" d="M0 ${-r}A${r} ${r} 0 0 0 0 ${r}Z"/>` : "";
  // An anchor's glyph is a small engraved hint, about a third of its diameter, drawn with a constant 1.25-unit line.
  const scale = r / 22;
  let mark;
  if (keystone) mark = t(0, 4, "ww-key-text", "READINESS");
  else if (n.type === "conflict") mark = "";
  else if (anchor) mark = `<path class="ww-glyph" transform="scale(${r1(scale * 100) / 100})" stroke-width="${Math.round((1.25 / scale) * 100) / 100}" d="${GLYPH[n.type] ?? GLYPH.assertion}"/>`;
  else mark = lightMark(n, r);
  // Selection is the piece's own ring, heavier and in terracotta (the halo lies on the ring, it does not add one). The
  // guide's pointer is four short radial ticks just outside the ring, nothing like the dotted ring that means STALE.
  const tick = (a) => { const c = Math.cos(a), si = Math.sin(a); return `M${r1(c * (ring + 1.5))} ${r1(si * (ring + 1.5))}L${r1(c * (ring + 5))} ${r1(si * (ring + 5))}`; };
  const halo = keystone ? `<rect class="ww-halo" x="${-KEYSTONE.w / 2 - 5}" y="${-KEYSTONE.h / 2 - 5}" width="${KEYSTONE.w + 10}" height="${KEYSTONE.h + 10}" rx="4"/>` : `<circle class="ww-halo" r="${ring}"/>`;
  const reticle = keystone ? `<rect class="ww-reticle" x="${-KEYSTONE.w / 2 - 5}" y="${-KEYSTONE.h / 2 - 5}" width="${KEYSTONE.w + 10}" height="${KEYSTONE.h + 10}" rx="4" pathLength="100"/>` : `<path class="ww-reticle" d="${[1, 3, 5, 7].map((k) => tick((k * Math.PI) / 4)).join("")}"/>`;
  let words;
  if (keystone) {
    // Under the keystone, two lines of drafting notation: the readiness classification, then the claim's support.
    const c = n.chip;
    const y = KEYSTONE.h / 2 + 19;
    // The second line is a small "support" key and the state, set either side of the centre line.
    const sub = !["ESTABLISHED", "SUPPORTED"].includes(n.wwepState);
    words = `${annot(c.text, c.attention, y, " ww-annot-class")}<text x="-3" y="${r1(y + ANNOT_STEP)}" text-anchor="end" class="ww-annot ww-annot-key">support</text><text x="2" y="${r1(y + ANNOT_STEP)}" class="ww-annot ww-annot-sub"${sub ? ' data-attention="true"' : ""}>${esc(c.second)}</text>`;
  } else {
    const ly = labelY(n);
    words = `${t(0, ly, "ww-label", n.label)}${n.chip ? annot(n.chip.text, n.chip.attention, ly + ANNOT_STEP) : ""}`;
  }
  const state = n.wwepState === undefined ? "" : ` data-state="${n.wwepState === null ? "NONE" : KNOWN_STATES.includes(n.wwepState) ? esc(n.wwepState) : "UNRECOGNISED"}"`;
  const flags = [n.superseded ? "superseded" : "", n.missing ? "missing" : "", n.unattested ? "unattested" : ""].filter(Boolean).join(" ");
  const cls = n.classification !== undefined ? ` data-classification="${KNOWN_CLASSES.includes(n.classification) ? esc(n.classification) : "UNRECOGNISED"}"` : "";
  const shape = `${keystone ? ` data-kw="${KEYSTONE.w}" data-kh="${KEYSTONE.h}"` : ` data-r="${r}"`} data-lb="${labelDepth(n)}"`;
  const selected = n.assertionId !== undefined && n.assertionId === selectedId;
  const where = `data-w="${hitW}" data-h="${hitH}" data-px="${n.tall.x}" data-py="${n.tall.y}" data-pw="${tallHit.w}" data-ph="${tallHit.h}"${shape}`;
  return `<g class="ww-node${selected ? " is-selected" : ""}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${esc(n.accessibleLabel)}" data-node-id="${esc(n.id)}" data-type="${esc(n.type)}" data-entity="${esc(n.entityType)}" data-tier="${tier}"${state} data-visual="${esc(n.state)}"${flags ? ` data-flags="${flags}"` : ""}${n.assertionId !== undefined ? ` data-assertion-id="${esc(n.assertionId)}"` : ""}${cls}${n.primary ? ' data-primary="true"' : ""}${n.onTrace ? ' data-trace="true"' : ""} ${where} transform="translate(${n.wide.x} ${n.wide.y})"><rect class="ww-hit" x="${-hitW / 2}" y="${-hitH / 2}" width="${hitW}" height="${hitH}"/><g class="ww-node-art">${rings.join("")}${body}${seal}${half}${halo}${mark}${reticle}</g>${words}</g>`;
}

/**
 * Construction, for each of the two plates: faint centrelines along the axes the composition is built on (the claims'
 * column; the evaluation axis from the Wallmark through WalletWall's rule to the readiness keystone, ended by a datum
 * tick) and four crop marks at the frame's corners. Drawn under everything, decorative, and never a fact.
 */
function construction(model, key, box) {
  const nodes = model.nodes;
  const main = key === "wide" ? "x" : "y";
  const cross = key === "wide" ? "y" : "x";
  const P = (m, c) => (main === "x" ? `${r1(m)} ${r1(c)}` : `${r1(c)} ${r1(m)}`);
  const parts = [];
  const claims = nodes.filter((n) => n.type === "assertion" || n.type === "wallmark");
  if (claims.length >= 3) {
    const at = claims[0][key][main];
    if (claims.every((n) => Math.abs(n[key][main] - at) < 1)) {
      const cs = claims.map((n) => n[key][cross]);
      parts.push(`<path class="ww-axis" d="M${P(at, Math.min(...cs) - 44)}L${P(at, Math.max(...cs) + 52)}"/>`);
    }
  }
  const wall = nodes.find((n) => n.type === "wallmark");
  const key2 = nodes.find((n) => n.type === "readiness");
  if (wall && key2 && Math.abs(wall[key][cross] - key2[key][cross]) < 1) {
    const c = wall[key][cross];
    const end = key2[key][main] + (main === "x" ? KEYSTONE.w : KEYSTONE.h) / 2 + 22;
    parts.push(`<path class="ww-axis ww-axis-eval" d="M${P(wall[key][main] - (NODE_R.wallmark + 30), c)}L${P(end, c)}M${P(end, c - 7)}L${P(end, c + 7)}"/>`);
  }
  const k = 12, i = 7;
  const [x0, y0, x1, y1] = [box.x + i, box.y + i, box.x + box.w - i, box.y + box.h - i];
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) parts.push(`<path class="ww-reg" d="M${r1(x)} ${r1(y + sy * k)}V${r1(y)}H${r1(x + sx * k)}"/>`);
  return `<g class="ww-construction" data-for="${key}" aria-hidden="true">${parts.join("")}</g>`;
}

/** The Wall as SVG: construction under connectors under pieces. Positions come from the model; the page animates and pins from the same data. */
export function renderWall(model, { digest }) {
  const { nodes, edges } = model;
  if (nodes.length === 0) return '<p class="muted">The bundle has no pieces to place.</p>';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const geom = (n, key = "wide") => (n.type === "readiness" ? { x: n[key].x, y: n[key].y, kw: KEYSTONE.w, kh: KEYSTONE.h, r: KEYSTONE.w / 2, lb: labelDepth(n) } : { x: n[key].x, y: n[key].y, r: NODE_R[n.type] ?? 14, lb: labelDepth(n) });
  // An obstacle: the piece, and the band its label and state annotation occupy below it.
  const obstacle = (n, key) => {
    const g = geom(n, key);
    if (n.type === "readiness") return g;
    const lw = Math.max(String(n.label).length * 6.9, n.chip ? annotWidth(n.chip.text) : 0);
    return { ...g, lw, ly0: labelY(n) - 11, ly1: labelY(n) + (n.chip ? ANNOT_STEP + 2 : 3) };
  };
  const lanes = (key, dir) => edges.map((e) => laneFor(geom(byId.get(e.from), key), geom(byId.get(e.to), key), e.kind, nodes.filter((n) => n.id !== e.from && n.id !== e.to).map((n) => obstacle(n, key)), dir));
  const wideLane = lanes("wide", "x");
  const tallLane = lanes("tall", "y");
  const story = new Set(model.storyPath ?? []);
  const inStory = (e) => (model.dominantStory === "conflict" ? e.kind === "conflict" : story.has(e.from) && story.has(e.to));
  const edgeMarkup = edges
    .map((e, i) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const kind = EDGE_KINDS[e.kind];
      return `<path class="ww-edge" data-kind="${esc(e.kind)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-rel="${esc(e.relationship)}" data-line="${LINE_CLASS[e.kind] ?? "reference"}"${kind.why ? ' data-evidence="true"' : ""}${e.activeTrace ? ' data-trace="true"' : ""}${inStory(e) ? ' data-story="true"' : ""} data-bend="${wideLane[i]}" data-pbend="${tallLane[i]}" d="${edgePath(geom(a), geom(b), e.kind, wideLane[i], "x")}"><title>${esc(`${a.label} ${kind.name} ${b.label}`)}</title></path>`;
    })
    .join("");
  // The lit lip of each evidence connector: the same path, offset by the stylesheet, so a line reads as cut into the
  // stage. Decorative; it carries the connector's kind and emphasis only so it can follow its strength.
  const lips = edges.map((e, i) => `<path class="ww-edge-lip" data-kind="${esc(e.kind)}" data-line="${LINE_CLASS[e.kind] ?? "reference"}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.activeTrace ? ' data-trace="true"' : ""}${inStory(e) ? ' data-story="true"' : ""} d="${edgePath(geom(byId.get(e.from)), geom(byId.get(e.to)), e.kind, wideLane[i], "x")}"/>`).join("");
  // Trace glints: a light overlay on each connector of the provenance trace whose opacity pulses from the sources toward
  // the claim (step = how many trace connectors lead into it). Only opacity animates; the connector itself stays solid.
  const traced = edges.filter((e) => e.activeTrace);
  const depth = new Map();
  for (let pass = 0; pass < traced.length; pass++) for (const e of traced) depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(e.from) ?? 0) + 1));
  const glints = traced.map((e) => `<path class="ww-glint" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${esc(e.kind)}" data-step="${Math.min(depth.get(e.from) ?? 0, 5)}" d="${edgePath(geom(byId.get(e.from)), geom(byId.get(e.to)), e.kind, wideLane[edges.indexOf(e)], "x")}"/>`).join("");
  const w = model.box.wide;
  const p = model.box.tall;
  const wideHits = hitSizes(nodes, "wide", w);
  const tallHits = hitSizes(nodes, "tall", p);
  const nodeMarkup = nodes.map((n) => piece(n, model.authoritativeSelectedAssertionId, wideHits.get(n.id), tallHits.get(n.id))).join("");
  // Arrowheads in drawing units: evidence in umber, emphasis (focus, the story, Trace) in terracotta.
  const arrow = (id) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker>`;
  return `<svg class="ww-wall-svg" viewBox="${w.x} ${w.y} ${w.w} ${w.h}" width="${w.w}" height="${w.h}" data-digest="${esc(digest)}" data-portrait-viewbox="${p.x} ${p.y} ${p.w} ${p.h}" data-story="${esc(model.dominantStory ?? "none")}"${model.storyTarget ? ` data-story-target="${esc(model.storyTarget)}"` : ""} data-view-version="${esc(model.coinstellationViewVersion)}" role="group" aria-label="The Wall: ${nodes.length} pieces and ${edges.length} connections. The same information is listed in the text version and the list below.">
<defs>${arrow("ww-arrow")}${arrow("ww-emphasis")}</defs>
${construction(model, "wide", w)}${construction(model, "tall", p)}<g class="ww-edge-lips" aria-hidden="true">${lips}</g><g class="ww-edges">${edgeMarkup}</g>${glints ? `<g class="ww-glints" aria-hidden="true">${glints}</g>` : ""}<g class="ww-nodes">${nodeMarkup}</g></svg>`;
}

export { stateText, classText };
