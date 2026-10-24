// The browser-side script of the WalletWall canvas page, as a string served inline under the page's CSP nonce.
//
// It talks only to its own origin (GET view, POST select, the events stream), stores nothing (no cookies, no web
// storage), and keeps its UI state (mode, motion preference, pinned pieces, focus, guide, sheet) in memory for the life of
// the page. It computes no evidence state: every state it shows is in the markup the server rendered from the WalletWall
// MCP results.
//
// Selection: the one assertion selection is the server's (view.selectedId), shared with the agent's select_assertion. A
// click on a claim gives immediate local feedback and POSTs select; the server re-renders through the events stream. A
// click on any other piece is local visual focus only: it shows that piece's relationships and facts, and never becomes
// an assertion selection or a provenance request.
//
// Motion: the pieces settle once (at most 240 ms) when the bundle changes; selection, Trace and the sheet use short CSS
// transitions; semantic loops (conflict ring, selection halo, stale recession, trace shimmer, the guide's idle) are CSS
// animations on transform and opacity only. Reduced motion, from the system or the panel, stops all of it.
//
// Compositions: below 1024 px in portrait The Wall uses the server's tall layout; below 768 px the detail rail becomes a
// bottom sheet (peek, half, full). Both are recomputed when the panel turns or resizes.
import { edgePath } from "./wall.mjs";

export const CLIENT_JS = `(() => {
  const base = location.pathname.replace(/[^/]*$/, "");
  const app = document.getElementById("app");
  const status = document.getElementById("copy-status");
  const announcer = document.getElementById("view-status");
  const guide = document.getElementById("wallaby");
  const guideText = document.getElementById("wallaby-text");
  const guideArt = document.getElementById("wallaby-art");
  const media = (q) => (window.matchMedia ? window.matchMedia(q) : null);
  const mql = media("(prefers-reduced-motion: reduce)");
  const phoneQ = media("(max-width: 767px)");
  const portraitQ = media("(max-width: 1023px) and (orientation: portrait)");
  const raf = window.requestAnimationFrame ? (f) => window.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
  const ui = { mode: "overview", focus: null, pinned: false, pending: null, reducedByUser: false, guideOff: false, digest: null, seen: {}, held: {}, positions: {}, states: {}, pointed: null, reveal: false, sheet: "peek", panelOpen: false, wallMenu: false, listFilter: "all", listQuery: "", receiptOpen: false, layout: null, hover: null };
  const reduced = () => ui.reducedByUser || Boolean(mql && mql.matches);
  const isPhone = () => Boolean(phoneQ && phoneQ.matches);
  const wantPortrait = () => Boolean(portraitQ && portraitQ.matches);
  const all = (sel) => (app.querySelectorAll ? Array.from(app.querySelectorAll(sel)) : []);
  const one = (sel) => (app.querySelector ? app.querySelector(sel) : null);
  const edgePath = ${edgePath.toString()};
  let statusTimer;
  let tipTimer;
  let wall = null;
  let animation = 0;
  let drag = null;
  let suppressClick = false;

  function announce(text) { if (announcer) announcer.textContent = text; }

  async function load() {
    const active = document.activeElement;
    const keep = active && active.dataset ? (active.dataset.nodeId || active.dataset.assertionId || active.dataset.mode || null) : null;
    const r = await fetch(base + "view", { cache: "no-store" });
    app.innerHTML = await r.text();
    ui.pending = null;
    applyMode();
    initWall();
    applyPanels();
    revealDetail();
    if (keep && app.querySelector) {
      const sel = (attr) => app.querySelector("[" + attr + '="' + CSS.escape(keep) + '"]');
      const el = sel("data-node-id") || sel("data-assertion-id") || app.querySelector('button[data-mode="' + CSS.escape(keep) + '"]');
      if (el && el.focus) el.focus({ preventScroll: true });
    }
  }

  function applyMode() {
    app.dataset.mode = ui.mode;
    app.dataset.motion = reduced() ? "reduced" : "full";
    for (const b of all("button[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode));
    for (const m of all("[data-motion-toggle]")) m.setAttribute("aria-pressed", String(reduced()));
    for (const g of all("[data-guide-toggle]")) g.textContent = ui.guideOff ? "Show Guide" : "Hide Guide";
    if (wall) wall.svg.dataset.trace = String(ui.mode === "trace");
  }

  // ---- Panels around The Wall: the guide's place, the detail sheet, the menu, the list and the receipt row ---------
  // The guide lives on The Wall's stage, beside the controls (or under The Wall on a phone): it never covers a piece.
  function dockGuide() {
    if (!guide || !guide.parentNode) return;
    const slot = one(".ww-guide-slot");
    if (slot && guide.parentNode !== slot && slot.appendChild) slot.appendChild(guide);
  }

  function applyPanels() {
    dockGuide();
    setSheet(ui.sheet, false);
    app.dataset.panelOpen = String(ui.panelOpen);
    for (const b of all("[data-panel-toggle]")) b.setAttribute("aria-expanded", String(ui.panelOpen));
    setWallMenu(ui.wallMenu, false);
    const receipt = one(".ww-receipt");
    if (receipt) receipt.dataset.open = String(ui.receiptOpen);
    for (const b of all("[data-receipt-toggle]")) b.setAttribute("aria-expanded", String(ui.receiptOpen));
    const search = one("[data-list-search]");
    if (search && search.value !== ui.listQuery) search.value = ui.listQuery;
    filterList();
  }

  // Scrolls the page makes on its own (bringing The Wall or the list into view) are not the reader scrolling away.
  function ownScroll() {
    ui.ownScroll = true;
    clearTimeout(ui.ownScrollTimer);
    ui.ownScrollTimer = setTimeout(() => { ui.ownScroll = false; ui.sheetY = window.scrollY || 0; }, 900);
  }

  const SHEETS = ["peek", "half", "full"];
  function setSheet(state, moveFocus) {
    if (state === "half" && ui.sheet !== "half") ownScroll();
    ui.sheet = SHEETS.includes(state) ? state : "peek";
    app.dataset.sheet = ui.sheet;
    const d = one("#detail");
    if (!d) return;
    d.dataset.sheet = ui.sheet;
    for (const g of all("[data-sheet-toggle]")) {
      g.setAttribute("aria-expanded", String(ui.sheet !== "peek"));
      g.setAttribute("aria-label", ui.sheet === "full" ? "Collapse the selected piece" : "Show more of the selected piece");
    }
    if (ui.sheet === "peek") {
      d.scrollTop = 0;
      // Content folded out of sight must not keep keyboard focus.
      const a = document.activeElement;
      if (isPhone() && a && d.contains && d.contains(a) && !(a.closest && (a.closest(".ww-sheet-bar") || a.closest(".ww-sheet-summary")))) { const g = d.querySelector("[data-sheet-toggle]"); if (g) g.focus(); }
    }
    if (moveFocus && ui.sheet === "full" && isPhone()) {
      const panel = Array.from(d.querySelectorAll("[data-assertion-detail],[data-node-panel]")).find((p) => !p.hidden);
      const h = panel ? panel.querySelector("h2") : null;
      if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    }
  }
  const sheetStep = (dir) => setSheet(SHEETS[Math.max(0, Math.min(SHEETS.length - 1, SHEETS.indexOf(ui.sheet) + dir))], dir > 0);

  function setWallMenu(open, moveFocus) {
    ui.wallMenu = open;
    const menu = one("#wall-menu");
    if (menu) menu.hidden = !open;
    for (const b of all("[data-wall-menu-toggle]")) b.setAttribute("aria-expanded", String(open));
    if (moveFocus && open && menu) { const first = Array.from(menu.querySelectorAll("button")).find((b) => !b.disabled && b.offsetParent !== null); if (first) first.focus(); }
  }

  function filterList() {
    const rows = all(".ww-list-rows li");
    if (!rows.length) return;
    const q = ui.listQuery.trim().toLowerCase();
    let shown = 0;
    for (const li of rows) {
      const ok = (li.dataset.kinds || "").split(" ").includes(ui.listFilter) && (!q || (li.dataset.text || "").toLowerCase().includes(q));
      li.hidden = !ok;
      if (ok) shown++;
    }
    for (const b of all("[data-list-filter]")) b.setAttribute("aria-pressed", String(b.dataset.listFilter === ui.listFilter));
    const empty = one("[data-list-empty]");
    if (empty) empty.hidden = shown > 0;
  }

  // ---- The Wall -------------------------------------------------------------------------------------------------
  function initWall() {
    const svg = one(".ww-wall-svg");
    if (!svg) { wall = null; ui.digest = null; return; }
    const num = (v) => (v === "" || v === undefined ? null : Number(v));
    const nodes = Array.from(svg.querySelectorAll(".ww-node")).map((g) => {
      const m = /translate\\(([-0-9.]+) ([-0-9.]+)\\)/.exec(g.getAttribute("transform") || "") || [0, 0, 0];
      const d = g.dataset;
      const shape = { r: num(d.r), kw: num(d.kw), kh: num(d.kh), lb: num(d.lb) };
      return { g, hit: g.querySelector(".ww-hit"), id: d.nodeId, x: Number(m[1]), y: Number(m[2]), fx: Number(m[1]), fy: Number(m[2]), ...shape, w: num(d.w), h: num(d.h),
        wide: { fx: Number(m[1]), fy: Number(m[2]), w: num(d.w), h: num(d.h) },
        tall: d.px === undefined ? null : { fx: num(d.px), fy: num(d.py), w: num(d.pw), h: num(d.ph) } };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const key = (p) => p.dataset.from + ">" + p.dataset.to + ":" + p.dataset.kind;
    const glints = new Map(Array.from(svg.querySelectorAll(".ww-glint")).map((p) => [key(p), p]));
    const lips = new Map(Array.from(svg.querySelectorAll(".ww-edge-lip")).map((p) => [key(p), p]));
    const edges = Array.from(svg.querySelectorAll(".ww-edge")).map((p) => ({ p, glint: glints.get(key(p)) || null, lip: lips.get(key(p)) || null, from: p.dataset.from, to: p.dataset.to, kind: p.dataset.kind, bends: { wide: Number(p.dataset.bend) || 0, tall: Number(p.dataset.pbend) || 0 } }));
    const parse = (s) => { const v = String(s || "").split(/[\\s,]+/).map(Number); return v.length === 4 && v.every((x) => Number.isFinite(x)) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null; };
    wall = { svg, nodes, edges, byId, boxes: { wide: parse(svg.getAttribute("viewBox")), tall: parse(svg.dataset.portraitViewbox) } };
    svg.dataset.trace = String(ui.mode === "trace");
    const digest = svg.dataset.digest;
    const changed = digest !== ui.digest;
    const layout = wantPortrait() && wall.boxes.tall && nodes.every((n) => n.tall) ? "tall" : "wide";
    const relaid = layout !== ui.layout;
    useLayout(layout);
    if (changed || relaid || !ui.view) ui.view = defaultView();
    applyView();
    const previous = ui.digest;
    const nextStates = {};
    for (const n of nodes) nextStates[n.id] = (n.g.dataset.state || "") + "|" + (n.g.dataset.classification || "");
    const moved = previous === null ? [] : nodes.filter((n) => ui.states[n.id] !== undefined && ui.states[n.id] !== nextStates[n.id]);
    if (changed || relaid) ui.held = {};
    if (changed) { ui.focus = null; ui.pinned = false; }
    if (!changed && !relaid) {
      for (const n of nodes) { const p = ui.positions[n.id]; if (p && ui.held[n.id]) { n.x = p.x; n.y = p.y; } }
      place();
    } else if (changed && !reduced()) settle(previous === null ? null : ui.positions);
    else place();
    // The halo marks a selection someone made (the person here, or the agent); the default selection only gets its ring.
    const sel = selectedNodeId();
    if (!changed && ui.lastSelected !== undefined && sel !== ui.lastSelected) ui.explicit = true;
    if (changed) ui.explicit = false;
    ui.lastSelected = sel;
    svg.dataset.selection = ui.explicit ? "explicit" : "default";
    ui.states = nextStates;
    ui.digest = digest;
    ui.layout = layout;
    remember();
    if (ui.focus && !byId.has(ui.focus)) ui.focus = null;
    focusPiece(ui.focus, false);
    if (changed) cue(previous === null, moved);
    else if (ui.lastCue && !ui.guideOff) showCueFor(ui.focus || selectedNodeId());
  }

  // Applies one of the two coordinate sets the server computed, and its frame.
  function useLayout(layout) {
    wall.layout = layout;
    wall.box = wall.boxes[layout] || wall.boxes.wide;
    for (const n of wall.nodes) {
      const l = n[layout] || n.wide;
      n.fx = l.fx; n.fy = l.fy; n.x = n.fx; n.y = n.fy;
      // Each layout has its own touch targets (grown into that layout's free space).
      if (n.hit && l.w && l.h) { n.w = l.w; n.h = l.h; n.hit.setAttribute("x", String(-l.w / 2)); n.hit.setAttribute("y", String(-l.h / 2)); n.hit.setAttribute("width", String(l.w)); n.hit.setAttribute("height", String(l.h)); }
    }
    const svg = wall.svg;
    if (layout === "tall") svg.dataset.layout = "portrait";
    else if (svg.removeAttribute) svg.removeAttribute("data-layout");
    else delete svg.dataset.layout;
    fitFrame();
  }

  // The frame takes the drawing's own proportions and never grows past about 1.2 times its natural size, so a small
  // bundle is not blown up and nothing is letterboxed.
  function fitFrame() {
    const svg = wall.svg;
    if (!svg.style || !wall.box) return;
    svg.style.aspectRatio = wall.box.w + " / " + wall.box.h;
    svg.style.maxWidth = Math.round(wall.box.w * (wall.layout === "tall" ? 1.45 : 1.2)) + "px";
    svg.style.maxHeight = "";
  }

  function relayout() {
    if (!wall) return;
    const layout = wantPortrait() && wall.boxes.tall && wall.nodes.every((n) => n.tall) ? "tall" : "wide";
    if (layout !== ui.layout) {
      ++animation;
      useLayout(layout);
      ui.layout = layout;
      ui.held = {};
      place();
      remember();
    } else fitFrame();
    ui.view = defaultView();
    applyView();
    highlight();
  }

  function remember() {
    ui.positions = {};
    if (wall) for (const n of wall.nodes) ui.positions[n.id] = { x: n.x, y: n.y };
  }

  // ---- Fit, zoom and pan, all inside The Wall's own frame --------------------------------------------------------
  const ZOOMS = [1, 1.5, 2, 3];
  const frameAspect = () => wall.box.w / wall.box.h;
  const wholeZoom = () => 1;
  function levels() { return ZOOMS; }
  function defaultView() { return { z: 1, cx: null, cy: null }; }
  function visibleBox() {
    const b = wall.box, v = ui.view;
    const w = b.w / v.z, h = w / frameAspect();
    const fit = (c, size, lo, len) => (size >= len ? lo + len / 2 : Math.min(Math.max(c, lo + size / 2), lo + len - size / 2));
    const cx = fit(v.cx === null ? b.x + b.w / 2 : v.cx, w, b.x, b.w), cy = fit(v.cy === null ? b.y + b.h / 2 : v.cy, h, b.y, b.h);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  const atWhole = () => ui.view.z <= wholeZoom() + 1e-3;
  function applyView() {
    if (!wall || !wall.box) return;
    const r = visibleBox();
    const k = (v) => Math.round(v * 10) / 10;
    ui.view.cx = r.x + r.w / 2;
    ui.view.cy = r.y + r.h / 2;
    wall.svg.setAttribute("viewBox", k(r.x) + " " + k(r.y) + " " + k(r.w) + " " + k(r.h));
    wall.svg.dataset.zoom = atWhole() ? "1" : String(Math.round(ui.view.z * 100) / 100);
    const label = one("[data-zoom-level]");
    if (label) label.textContent = atWhole() ? "Whole wall" : Math.round(ui.view.z * 100) + "%";
    for (const b of all("button[data-zoom]")) b.disabled = b.dataset.zoom === "in" ? ui.view.z >= ZOOMS[ZOOMS.length - 1] - 1e-3 : atWhole();
  }
  function zoomTo(z, around) {
    if (!wall || !wall.box) return;
    ui.view.z = Math.max(wholeZoom(), Math.min(ZOOMS[ZOOMS.length - 1], z));
    if (atWhole()) { ui.view.cx = null; ui.view.cy = null; }
    else if (around) { ui.view.cx = around.x; ui.view.cy = around.y; }
    applyView();
    announce(atWhole() ? "The whole wall is in view." : "Zoomed to " + Math.round(ui.view.z * 100) + "%. Drag to pan.");
  }
  function zoomStep(dir) {
    const zs = levels();
    const z = ui.view.z;
    const next = dir > 0 ? zs.find((v) => v > z + 1e-3) : [...zs].reverse().find((v) => v < z - 1e-3);
    const f = wall.byId.get(ui.focus || selectedNodeId());
    zoomTo(next === undefined ? z : next, dir > 0 && atWhole() && f ? f : null);
  }
  // A piece reached by keyboard or by a link is brought into view when the wall is zoomed in.
  function keepInView(n) {
    if (!wall || !wall.box || atWhole()) return;
    const r = visibleBox();
    if (n.x < r.x || n.x > r.x + r.w || n.y < r.y || n.y > r.y + r.h) { ui.view.cx = n.x; ui.view.cy = n.y; applyView(); }
  }

  function place() {
    if (!wall) return;
    const r = (v) => Math.round(v * 10) / 10;
    for (const n of wall.nodes) n.g.setAttribute("transform", "translate(" + r(n.x) + " " + r(n.y) + ")");
    for (const e of wall.edges) {
      const a = wall.byId.get(e.from), b = wall.byId.get(e.to);
      if (!a || !b) continue;
      const d = edgePath(a, b, e.kind, ui.held[e.from] || ui.held[e.to] ? 0 : e.bends[wall.layout] || 0, wall.layout === "tall" ? "y" : "x");
      e.p.setAttribute("d", d);
      if (e.glint) e.glint.setAttribute("d", d);
      if (e.lip) e.lip.setAttribute("d", d);
    }
  }

  // The pieces settle once into the server's positions: from a slightly gathered constellation on first load, or from
  // where they were when the bundle changed. At most 14 frames (about 240 ms); then nothing moves until someone acts.
  function settle(from) {
    const run = ++animation;
    const keystones = wall.nodes.filter((n) => n.g.dataset.type === "readiness");
    for (const k of keystones) k.g.classList.add("is-resolving");
    const b = wall.box;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const start = wall.nodes.map((n) => (from && from[n.id] ? { x: from[n.id].x, y: from[n.id].y } : { x: cx + (n.fx - cx) * 0.86, y: cy + (n.fy - cy) * 0.86 }));
    const frames = 14;
    let f = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = () => {
      if (run !== animation) return;
      f++;
      const t = ease(Math.min(1, f / frames));
      wall.nodes.forEach((n, i) => { n.x = start[i].x + (n.fx - start[i].x) * t; n.y = start[i].y + (n.fy - start[i].y) * t; });
      place();
      if (f < frames) raf(frame);
      else { for (const n of wall.nodes) { n.x = n.fx; n.y = n.fy; } place(); remember(); for (const k of keystones) k.g.classList.remove("is-resolving"); }
    };
    raf(frame);
  }

  const selectedNodeId = () => { const n = wall ? wall.nodes.find((x) => x.g.classList.contains("is-selected")) : null; return n ? n.id : null; };

  // Focus and its relationships: the focused piece, the pieces it is directly connected to (as in the reference
  // Coinstellation), everything else muted. With nothing pinned the whole wall stays readable. In Trace, emphasis
  // follows the server's provenance marks (data-trace) instead.
  function highlight() {
    if (!wall) return;
    const focus = ui.focus || (ui.pinned ? selectedNodeId() : null);
    const preview = !focus && ui.hover ? ui.hover : null;
    const centre = focus || preview;
    const related = new Set();
    const relEdges = new Set();
    if (centre) {
      related.add(centre);
      for (const e of wall.edges) if (e.from === centre || e.to === centre) { relEdges.add(e); related.add(e.from); related.add(e.to); }
      // A conflict marker only joins two claims: the claim on its far side is as direct a relationship as the marker.
      for (const e of Array.from(relEdges)) {
        const other = e.from === centre ? e.to : e.from;
        const mid = wall.byId.get(other);
        if (e.kind !== "conflict" || !mid || mid.g.dataset.type !== "conflict") continue;
        for (const f of wall.edges) if (f.kind === "conflict" && (f.from === other || f.to === other)) { relEdges.add(f); related.add(f.from); related.add(f.to); }
      }
    }
    for (const n of wall.nodes) {
      n.g.classList.toggle("is-focus", n.id === centre);
      n.g.classList.toggle("is-related", centre !== null && n.id !== centre && related.has(n.id));
      n.g.classList.toggle("on-path", related.has(n.id));
      const pressed = n.id === ui.focus || (!ui.focus && n.g.classList.contains("is-selected"));
      n.g.setAttribute("aria-pressed", String(pressed));
    }
    for (const e of wall.edges) { e.p.classList.toggle("on-path", relEdges.has(e)); if (e.lip) e.lip.classList.toggle("on-path", relEdges.has(e)); }
    wall.svg.dataset.focus = focus ? "pinned" : preview ? "preview" : "none";
  }

  function focusPiece(id, speak) {
    ui.focus = id && wall && wall.byId.get(id) && !wall.byId.get(id).g.dataset.assertionId ? id : null;
    const panels = app.querySelectorAll ? app.querySelectorAll("[data-node-panel]") : [];
    for (const p of panels) p.hidden = p.dataset.nodePanel !== ui.focus;
    const main = one("[data-assertion-detail]");
    if (main) main.hidden = Boolean(ui.focus);
    highlight();
    if (speak && ui.focus && wall) announce("Visual focus: " + wall.byId.get(ui.focus).g.getAttribute("aria-label"));
  }

  // A claim: immediate local feedback, then the shared selection (the agent sees the same) through the server.
  function selectAssertion(id) {
    ui.focus = null;
    ui.pinned = true;
    ui.pending = id;
    ui.explicit = true;
    if (wall) {
      wall.svg.dataset.selection = "explicit";
      for (const n of wall.nodes) n.g.classList.toggle("is-selected", n.g.dataset.assertionId === id);
      focusPiece(null, false);
      const n = wall.nodes.find((x) => x.g.dataset.assertionId === id);
      if (n) { showCueFor(n.id); announce("Selected assertion: " + n.g.getAttribute("aria-label")); }
    }
    fetch(base + "select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assertionId: id }) });
  }

  function activate(g) {
    ui.reveal = true;
    hideTip();
    if (g.dataset.assertionId) { selectAssertion(g.dataset.assertionId); revealDetail(); return; }
    const off = ui.focus === g.dataset.nodeId;
    ui.pinned = !off;
    focusPiece(off ? null : g.dataset.nodeId, true);
    showCueFor(off ? selectedNodeId() : g.dataset.nodeId);
    revealDetail();
  }

  // Tapping empty space, or Escape: back to the whole state. Nothing pinned, the sheet folds to its peek.
  function clearSelection() {
    ui.pinned = false;
    ui.hover = null;
    focusPiece(null, false);
    if (isPhone()) setSheet("peek", false);
    announce("Whole wall.");
  }

  // After an explicit selection: on a phone the detail sheet opens to half height; wider panels show the rail beside.
  function revealDetail() {
    if (!ui.reveal) return;
    ui.reveal = false;
    if (isPhone() && ui.sheet === "peek") setSheet("half", false);
    const d = one("#detail");
    if (d && isPhone()) d.scrollTop = 0;
  }

  function scrollToWall() {
    ownScroll();
    const w = one(".ww-wall");
    if (w && w.scrollIntoView) w.scrollIntoView({ block: isPhone() ? "start" : "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  // Trace: the same pieces in the same places; the selected claim's provenance (as trace_provenance returned it) is
  // emphasised and everything else recedes.
  function startTrace() {
    ui.mode = "trace";
    ui.focus = null;
    focusPiece(null, false);
    applyMode();
    if (wall && !atWhole()) {
      const on = wall.nodes.filter((n) => n.g.dataset.trace === "true");
      if (on.length) { ui.view.cx = on.reduce((s, n) => s + n.x, 0) / on.length; ui.view.cy = on.reduce((s, n) => s + n.y, 0) / on.length; applyView(); }
    }
    if (isPhone()) {
      if (ui.sheet === "peek") setSheet("half", false);
      const prov = one('[data-more="provenance"]');
      if (prov) prov.open = true;
    }
  }

  // ---- Tooltip: one at a time, after a short pause on hover, at once on keyboard focus ----------------------------
  function tipFor(g) {
    const tip = one("#ww-tip");
    const stage = one(".ww-wall");
    if (!tip || !stage || !g.getBoundingClientRect || !stage.getBoundingClientRect) return;
    const label = g.querySelector(".ww-label");
    const name = (g.getAttribute("aria-label") || "").split(":")[0];
    const state = g.dataset.classification || g.dataset.state || "";
    tip.textContent = (label ? label.textContent + " · " : "") + name + (state && state !== "NONE" ? " · " + state : "");
    tip.hidden = false;
    const a = g.getBoundingClientRect(), s = stage.getBoundingClientRect();
    tip.style.left = Math.round(Math.max(4, Math.min(s.width - 220, a.left - s.left + a.width / 2 - 110))) + "px";
    tip.style.top = Math.round(Math.max(4, a.top - s.top - 34)) + "px";
  }
  function hideTip() { clearTimeout(tipTimer); const tip = one("#ww-tip"); if (tip) tip.hidden = true; }

  // ---- Dragging with a mouse pins a piece where it is dropped; nothing else moves. Reset layout returns it. --------
  function svgPoint(e) {
    const m = wall.svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  // ---- Guide ------------------------------------------------------------------------------------------------------
  function say(text, pose, nodeId) {
    if (!guide || ui.guideOff) return;
    ui.lastCue = { text, pose, nodeId };
    unpoint();
    guideText.textContent = text;
    guideArt.dataset.pose = pose || "inspect";
    if (guide.dataset) guide.dataset.target = nodeId || "";
    guide.hidden = false;
    if (reduced()) guide.dataset.peek = "in";
    else { guide.dataset.peek = "out"; raf(() => raf(() => { guide.dataset.peek = "in"; })); }
    const n = wall && nodeId ? wall.byId.get(nodeId) : null;
    if (n) { n.g.classList.add("is-pointed"); ui.pointed = n.g; }
  }
  function unpoint() { if (ui.pointed) { ui.pointed.classList.remove("is-pointed"); ui.pointed = null; } }
  function retract() {
    if (!guide) return;
    unpoint();
    guide.dataset.peek = "out";
    if (reduced()) guide.hidden = true; else setTimeout(() => { if (guide.dataset.peek === "out") guide.hidden = true; }, 300);
  }
  const cues = () => (app.querySelectorAll ? Array.from(app.querySelectorAll(".ww-guide-cues li")) : []);
  // The cue about one piece, when it is selected or focused.
  function showCueFor(id) {
    if (!id || ui.guideOff) return;
    const c = cues().find((x) => x.dataset.cue === "node" && x.dataset.node === id);
    if (c) say(c.textContent, c.dataset.pose, c.dataset.node);
  }
  // Show Guide brings WalletWallaby back with the last cue, or the bundle's first cue if none was shown yet.
  function showGuide() {
    if (ui.lastCue) { say(ui.lastCue.text, ui.lastCue.pose, ui.lastCue.nodeId); return; }
    const first = cues()[0];
    if (first) say(first.textContent, first.dataset.pose, first.dataset.node);
  }
  function setGuide(off) {
    ui.guideOff = off;
    if (off) retract(); else showGuide();
    applyMode();
    announce(off ? "Guide hidden." : "Guide shown.");
  }
  function cue(first, moved) {
    if (!guide || ui.guideOff) return;
    if (moved.length) {
      const n = moved[0];
      const now = (n.g.dataset.state || n.g.dataset.classification || "changed").replace("NONE", "no evaluation");
      say((n.g.getAttribute("aria-label") || "").split(",")[0] + " is now " + now + ".", "inspect", n.id);
      return;
    }
    for (const c of cues()) {
      if (c.dataset.cue === "node" || (c.dataset.cue === "orientation" && !first)) continue;
      const key = ui.digest + "|" + c.dataset.cue + "|" + c.dataset.node;
      if (ui.seen[key]) continue;
      ui.seen[key] = true;
      say(c.textContent, c.dataset.pose, c.dataset.node);
      return;
    }
  }

  // Copies exactly the text of the full address shown beside the button: no shortening, no case or checksum change,
  // nothing stored. The clipboard is tried first, so a successful copy selects nothing (no selection flash); if it is
  // refused, the full value is selected so it can still be copied by hand.
  async function copyAddress(button, withChain) {
    const holder = button.closest(".addr");
    const node = holder.querySelector("code");
    const full = node.textContent;
    const text = withChain ? "chainId:" + holder.getAttribute("data-chain") + " address:" + full : full;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = false; }
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!withChain) { try { ok = document.execCommand("copy"); } catch (_) { ok = false; } }
    }
    status.textContent = ok ? (withChain ? "Copied the chain ID and the full address." : "Copied the full address (" + full.length + " characters).") : "Copy was not permitted here. The full address is selected: press Ctrl+C.";
    if (ok && typeof button.textContent === "string") {
      const label = button.dataset && button.dataset.label ? button.dataset.label : button.textContent;
      if (button.dataset) { button.dataset.label = label; button.dataset.copied = "true"; }
      // Keep the button's width while it says Copied, so nothing beside it moves.
      if (button.style && button.offsetWidth) button.style.minWidth = button.offsetWidth + "px";
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = label; if (button.dataset) delete button.dataset.copied; }, 1500);
    }
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 4000);
  }

  app.addEventListener("click", (e) => {
    // The click that ends a swipe on the sheet's bar is not a second request.
    if (suppressClick && (e.target.closest(".ww-sheet-bar") || e.target.closest(".ww-sheet-summary"))) { suppressClick = false; return; }
    const copy = e.target.closest("[data-copy-address]");
    if (copy) { copyAddress(copy, false); return; }
    const copyChain = e.target.closest("[data-copy-chain-address]");
    if (copyChain) { copyAddress(copyChain, true); return; }
    // The menu closes when anything else is chosen; a choice made in it returns focus to the menu's own button.
    const inMenu = e.target.closest("#wall-menu");
    if (ui.wallMenu && !e.target.closest("[data-wall-menu-toggle]")) {
      setWallMenu(false, false);
      const t = inMenu ? one("[data-wall-menu-toggle]") : null;
      if (t && !e.target.closest("[data-list-view]")) t.focus({ preventScroll: true });
    }
    if (e.target.closest("[data-wall-menu-toggle]")) { setWallMenu(!ui.wallMenu, !ui.wallMenu); return; }
    if (e.target.closest("[data-panel-toggle]")) { ui.panelOpen = !ui.panelOpen; applyPanels(); if (ui.panelOpen) { const p = one("#panel-info"); if (p && p.scrollIntoView) p.scrollIntoView({ block: "nearest" }); } return; }
    if (e.target.closest("[data-back-overview]")) { ui.mode = "overview"; applyMode(); highlight(); announce("Overview."); return; }
    const mode = e.target.closest("button[data-mode]");
    if (mode) {
      if (mode.dataset.mode === "trace") { startTrace(); announce("Trace: the provenance of the selected assertion is emphasised."); }
      else { ui.mode = mode.dataset.mode; applyMode(); highlight(); announce("Overview."); }
      return;
    }
    if (e.target.closest("button[data-why]")) {
      startTrace();
      if (isPhone()) setSheet("peek", false);
      scrollToWall();
      announce("Trace: the path WalletWall followed for this claim is emphasised on The Wall.");
      return;
    }
    if (e.target.closest("[data-show-on-wall]")) {
      setSheet("peek", false);
      scrollToWall();
      const n = wall ? wall.byId.get(ui.focus || selectedNodeId()) : null;
      if (n) { keepInView(n); if (n.g.focus) n.g.focus({ preventScroll: true }); }
      return;
    }
    if (e.target.closest("[data-sheet-toggle]")) { setSheet(ui.sheet === "full" ? "peek" : ui.sheet === "half" ? "full" : "half", ui.sheet === "half"); return; }
    if (e.target.closest("[data-sheet-full]")) { setSheet("full", true); return; }
    if (e.target.closest(".ww-sheet-summary") && isPhone() && ui.sheet === "peek") { setSheet("half", false); return; }
    if (e.target.closest("[data-receipt-toggle]")) { ui.receiptOpen = !ui.receiptOpen; applyPanels(); return; }
    if (e.target.closest("[data-list-view]")) {
      ownScroll();
      if (isPhone()) setSheet("peek", false);
      const list = one("#ww-list");
      if (list && list.scrollIntoView) list.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      const search = one("[data-list-search]");
      if (search) search.focus({ preventScroll: true });
      return;
    }
    const filter = e.target.closest("[data-list-filter]");
    if (filter) { ui.listFilter = filter.dataset.listFilter; filterList(); return; }
    if (e.target.closest("[data-motion-toggle]")) { ui.reducedByUser = !ui.reducedByUser; applyMode(); announce(reduced() ? "Reduced motion on." : "Reduced motion off."); return; }
    if (e.target.closest("[data-guide-toggle]")) { setGuide(!ui.guideOff); return; }
    const z = e.target.closest("button[data-zoom]");
    if (z) { if (!wall) return; if (z.dataset.zoom === "fit") zoomTo(0, null); else zoomStep(z.dataset.zoom === "in" ? 1 : -1); return; }
    if (e.target.closest("[data-reset-layout]")) {
      if (!wall) return;
      ui.held = {};
      for (const n of wall.nodes) { n.x = n.fx; n.y = n.fy; }
      place();
      remember();
      announce("Layout reset.");
      return;
    }
    if (inMenu) return;
    const piece = e.target.closest(".ww-wall-svg .ww-node");
    if (piece) { if (suppressClick) { suppressClick = false; return; } activate(piece); return; }
    if (e.target.closest(".ww-wall-svg")) { if (suppressClick) { suppressClick = false; return; } clearSelection(); return; }
    const focusLink = e.target.closest("[data-focus-node]");
    if (focusLink) {
      const g = wall ? wall.byId.get(focusLink.dataset.focusNode) : null;
      if (g) {
        if (isPhone()) scrollToWall();
        activate(g.g);
        keepInView(g);
        if (g.g.focus) g.g.focus(isPhone() ? { preventScroll: true } : undefined);
      }
      return;
    }
    const b = e.target.closest("[data-assertion-id]");
    if (!b) return;
    selectAssertion(b.dataset.assertionId);
  });

  app.addEventListener("input", (e) => {
    if (!e.target.closest || !e.target.closest("[data-list-search]")) return;
    ui.listQuery = e.target.value || "";
    filterList();
  });

  app.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideTip();
      if (ui.wallMenu) { setWallMenu(false, false); const t = one("[data-wall-menu-toggle]"); if (t) t.focus(); return; }
      if (ui.panelOpen) { ui.panelOpen = false; applyPanels(); return; }
      if (isPhone() && ui.sheet !== "peek" && e.target.closest && e.target.closest("#detail")) { sheetStep(-1); return; }
    }
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || !wall) {
      if (e.key === "Escape" && (ui.focus || ui.pinned)) clearSelection();
      else if (e.key === "Escape" && isPhone() && ui.sheet !== "peek") sheetStep(-1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(g); return; }
    if (e.key === "Escape") { clearSelection(); return; }
    if (e.key === "+" || e.key === "=") { zoomStep(1); return; }
    if (e.key === "-") { zoomStep(-1); return; }
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const here = wall.byId.get(g.dataset.nodeId);
    let best = null;
    let bestScore = Infinity;
    for (const n of wall.nodes) {
      if (n === here) continue;
      const dx = n.x - here.x, dy = n.y - here.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) { keepInView(best); best.g.focus(); }
  });

  // Keyboard focus previews a piece at once (tooltip and its connections); leaving it ends the preview.
  app.addEventListener("focusin", (e) => {
    const g = wall && e.target && e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g) return;
    const n = wall.byId.get(g.dataset.nodeId);
    if (n) keepInView(n);
    ui.hover = g.dataset.nodeId;
    highlight();
    tipFor(g);
  });
  app.addEventListener("focusout", (e) => {
    const g = e.target && e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g) return;
    if (ui.hover === g.dataset.nodeId) { ui.hover = null; highlight(); }
    hideTip();
  });
  // A mouse resting on a piece previews it; the tooltip follows after a short pause and leaves at once.
  app.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || !wall) return;
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || ui.hover === g.dataset.nodeId) return;
    ui.hover = g.dataset.nodeId;
    highlight();
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { if (ui.hover === g.dataset.nodeId) tipFor(g); }, 350);
  });
  app.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || !wall) return;
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || (e.relatedTarget && g.contains && g.contains(e.relatedTarget))) return;
    if (ui.hover === g.dataset.nodeId) { ui.hover = null; highlight(); }
    hideTip();
  });

  // ---- Touch and pointer: pinch zooms; dragging pans when zoomed in; a mouse can also drag a piece to pin it --------
  const touches = new Map();
  let pinch = null;
  let pan = null;
  app.addEventListener("pointerdown", (e) => {
    if (!wall || !wall.box || !e.target.closest || !e.target.closest(".ww-wall-svg")) return;
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = Array.from(touches.values());
        const mid = svgPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: ui.view.z, cx0: ui.view.cx, cy0: ui.view.cy, mid };
        pan = null;
        drag = null;
        return;
      }
    }
    if (atWhole() || e.button !== 0) return;
    if (e.target.closest(".ww-wall-svg .ww-node") && e.pointerType !== "touch") return;
    const r = visibleBox();
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: ui.view.cx, cy: ui.view.cy, k: Math.max(r.w / (wall.svg.clientWidth || r.w), r.h / (wall.svg.clientHeight || r.h)), moved: false };
    wall.svg.classList.add("is-panning");
    if (wall.svg.setPointerCapture) wall.svg.setPointerCapture(e.pointerId);
  });
  app.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = Array.from(touches.values());
      const z = Math.max(wholeZoom(), Math.min(ZOOMS[ZOOMS.length - 1], (pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0));
      ui.view.z = z;
      if (pinch.mid) { ui.view.cx = pinch.mid.x + (pinch.cx0 - pinch.mid.x) * (pinch.z0 / z); ui.view.cy = pinch.mid.y + (pinch.cy0 - pinch.mid.y) * (pinch.z0 / z); }
      applyView();
      suppressClick = true;
      return;
    }
    if (!pan || e.pointerId !== pan.id) return;
    if (!pan.moved && Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) < 5) return;
    pan.moved = true;
    ui.view.cx = pan.cx - (e.clientX - pan.sx) * pan.k;
    ui.view.cy = pan.cy - (e.clientY - pan.sy) * pan.k;
    applyView();
  });
  const endPointer = (e) => {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) {
      pinch = null;
      announce(atWhole() ? "The whole wall is in view." : "Zoomed to " + Math.round(ui.view.z * 100) + "%. Drag to pan.");
      setTimeout(() => { suppressClick = false; }, 0);
    }
    if (pan && e.pointerId === pan.id) {
      if (pan.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      pan = null;
      if (wall) wall.svg.classList.remove("is-panning");
    }
  };
  app.addEventListener("pointerup", endPointer);
  app.addEventListener("pointercancel", endPointer);

  app.addEventListener("pointerdown", (e) => {
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || !wall || e.button !== 0 || e.pointerType === "touch") return;
    const n = wall.byId.get(g.dataset.nodeId);
    const p = svgPoint(e);
    if (!n || !p) return;
    drag = { n, g, id: e.pointerId, ox: n.x - p.x, oy: n.y - p.y, sx: e.clientX, sy: e.clientY, moved: false };
  });
  app.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    if (!drag.moved) { drag.moved = true; ++animation; hideTip(); if (drag.g.setPointerCapture) drag.g.setPointerCapture(e.pointerId); }
    const p = svgPoint(e);
    if (!p) return;
    drag.n.x = p.x + drag.ox;
    drag.n.y = p.y + drag.oy;
    if (wall.box) {
      const b = wall.box, n = drag.n, half = (n.kw || 2 * (n.r || 14)) / 2;
      n.x = Math.min(Math.max(n.x, b.x + half), b.x + b.w - half);
      n.y = Math.min(Math.max(n.y, b.y + half), b.y + b.h - half);
    }
    place();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    ui.held[d.n.id] = true;
    remember();
    announce("Piece pinned where it was dropped. Reset layout returns every piece to its place.");
  };
  app.addEventListener("pointerup", endDrag);
  app.addEventListener("pointercancel", endDrag);

  // The sheet follows a short swipe on its bar or summary: up opens one step, down folds one step.
  let swipe = null;
  app.addEventListener("pointerdown", (e) => {
    if (!isPhone() || !e.target.closest || !(e.target.closest(".ww-sheet-bar") || e.target.closest(".ww-sheet-summary"))) return;
    swipe = { id: e.pointerId, y: e.clientY };
  });
  app.addEventListener("pointerup", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dy) < 30) return;
    sheetStep(dy < 0 ? 1 : -1);
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  });

  if (mql && mql.addEventListener) mql.addEventListener("change", applyMode);
  // Turning the device or resizing the panel recomputes the composition: layout, frame and zoom.
  const onShape = () => { relayout(); applyPanels(); };
  for (const q of [phoneQ, portraitQ]) if (q && q.addEventListener) q.addEventListener("change", onShape);
  // A half-open sheet folds to its peek when the reader scrolls the page on to Wallprint, readiness or the list.
  if (window.addEventListener) window.addEventListener("scroll", () => {
    if (ui.ownScroll || !isPhone() || ui.sheet !== "half") return;
    if (Math.abs((window.scrollY || 0) - (ui.sheetY || 0)) > 60) setSheet("peek", false);
  }, { passive: true });
  let resizing = false;
  if (window.addEventListener) window.addEventListener("resize", () => { if (resizing) return; resizing = true; raf(() => { resizing = false; if (wall) { fitFrame(); applyView(); } }); });

  const es = new EventSource(base + "events");
  es.onmessage = () => { load(); };
  load();
})();`;
