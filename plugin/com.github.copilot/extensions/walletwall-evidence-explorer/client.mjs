// The browser-side script of the WalletWall canvas page, as a string served inline under the page's CSP nonce.
//
// It talks only to its own origin (GET view, POST select, the events stream), stores nothing (no cookies, no web
// storage), and keeps its UI state (mode, motion preference, pinned pieces, guide, sheet) in memory for the life of the
// page. Motion only plays when the bundle changed or the user acted, and never when reduced motion is requested.
//
// Compositions: below 1024 px in portrait The Wall uses the server's portrait layout (bands read top to bottom); below
// 768 px the detail rail becomes a bottom sheet (peek, half, full). Both are recomputed when the panel turns or resizes.
import { edgePath, forceLayout } from "./wall.mjs";

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
  const ui = { mode: "overview", focus: null, reducedByUser: false, guideOff: false, digest: null, seen: {}, pinned: {}, positions: {}, states: {}, pointed: null, reveal: false, sheet: "peek", panelOpen: false, wallMenu: false, quiet: false, listFilter: "all", listQuery: "", receiptOpen: false, layout: null };
  const reduced = () => ui.reducedByUser || Boolean(mql && mql.matches);
  const isPhone = () => Boolean(phoneQ && phoneQ.matches);
  const wantPortrait = () => Boolean(portraitQ && portraitQ.matches);
  const all = (sel) => (app.querySelectorAll ? Array.from(app.querySelectorAll(sel)) : []);
  const one = (sel) => (app.querySelector ? app.querySelector(sel) : null);
  const forceLayout = ${forceLayout.toString()};
  const edgePath = ${edgePath.toString()};
  let statusTimer;
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
    applyMode();
    initWall();
    applyPanels();
    revealDetail();
    if (keep && app.querySelector) {
      const sel = (attr) => app.querySelector("[" + attr + '="' + CSS.escape(keep) + '"]');
      const el = sel("data-node-id") || sel("data-assertion-id") || app.querySelector('button[data-mode="' + CSS.escape(keep) + '"]');
      if (el) el.focus();
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

  // ---- Panels around The Wall: the detail sheet, the header and Wall menus, the list and the receipt row ------------
  // On a phone the guide docks under The Wall (in the page flow, over nothing); wider panels keep it floating.
  function dockGuide() {
    if (!guide || !guide.parentNode) return;
    const stage = isPhone() ? one(".ww-wall") : null;
    if (stage && guide.parentNode !== stage) stage.appendChild(guide);
    else if (!stage && guide.parentNode !== document.body && document.body) document.body.insertBefore(guide, app.nextSibling);
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
    if (moveFocus && open && menu) { const first = menu.querySelector("button"); if (first) first.focus(); }
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
      return { g, id: d.nodeId, x0: num(d.x0), y0: num(d.y0), ax: num(d.ax), ay: num(d.ay), kx: num(d.kx), ky: num(d.ky), w: num(d.w), h: num(d.h), fx: Number(m[1]), fy: Number(m[2]), x: Number(m[1]), y: Number(m[2]), fixed: false,
        wide: { fx: Number(m[1]), fy: Number(m[2]), w: num(d.w), h: num(d.h), ax: num(d.ax), ay: num(d.ay), kx: num(d.kx), ky: num(d.ky) },
        tall: d.px === undefined ? null : { fx: num(d.px), fy: num(d.py), w: num(d.pw), h: num(d.ph), ax: num(d.px), ay: num(d.py), kx: 0.2, ky: 0.2 } };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = Array.from(svg.querySelectorAll(".ww-edge")).map((p) => ({ p, from: p.dataset.from, to: p.dataset.to, len: Number(p.dataset.len), k: Number(p.dataset.k), kind: p.dataset.kind, why: p.dataset.evidence === "true" }));
    const chamber = svg.querySelector(".ww-chamber");
    const parse = (s) => { const v = String(s || "").split(/[\\s,]+/).map(Number); return v.length === 4 && v.every((x) => Number.isFinite(x)) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null; };
    wall = { svg, nodes, edges, byId, chamber, ticks: Number(svg.dataset.ticks) || 160, boxes: { wide: parse(svg.getAttribute("viewBox")), tall: parse(svg.dataset.portraitViewbox) } };
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
    if (changed || relaid) ui.pinned = {};
    if (!changed && !relaid) {
      for (const n of nodes) {
        const p = ui.positions[n.id];
        if (p) { n.x = p.x; n.y = p.y; }
        if (ui.pinned[n.id]) n.fixed = true;
      }
      place();
    } else if (changed && !reduced() && window.requestAnimationFrame) {
      assemble(previous === null ? null : ui.positions);
    } else {
      place();
    }
    ui.states = nextStates;
    ui.digest = digest;
    ui.layout = layout;
    remember();
    if (ui.focus && !byId.has(ui.focus)) ui.focus = null;
    if (ui.focus) focusPiece(ui.focus, false); else highlight();
    if (changed) cue(previous === null, moved);
  }

  // Applies one of the two layouts the server computed: its rest positions, piece sizes, anchors and frame.
  function useLayout(layout) {
    wall.layout = layout;
    wall.box = wall.boxes[layout] || wall.boxes.wide;
    for (const n of wall.nodes) {
      const l = n[layout] || n.wide;
      n.fx = l.fx; n.fy = l.fy; n.w = l.w; n.h = l.h; n.ax = l.ax; n.ay = l.ay; n.kx = l.kx; n.ky = l.ky;
      n.x = n.fx; n.y = n.fy; n.fixed = false;
    }
    const svg = wall.svg;
    if (layout === "tall") svg.dataset.layout = "portrait";
    else if (svg.removeAttribute) svg.removeAttribute("data-layout");
    else delete svg.dataset.layout;
    fitFrame();
  }

  // The frame: the wide layout takes the wall's own proportions; the portrait stage keeps its height from the
  // stylesheet but is never taller than the wall needs at the frame's width, so it has no blank band.
  function fitFrame() {
    const svg = wall.svg;
    if (!svg.style || !wall.box) return;
    if (wall.layout === "tall") {
      svg.style.aspectRatio = "";
      svg.style.maxWidth = "";
      const width = svg.clientWidth || wall.box.w;
      svg.style.maxHeight = Math.ceil((wall.box.h * width) / wall.box.w) + "px";
    } else {
      svg.style.aspectRatio = wall.box.w + " / " + wall.box.h;
      svg.style.maxWidth = Math.round(wall.box.w * 1.1) + "px";
      svg.style.maxHeight = "";
    }
  }

  function relayout() {
    if (!wall) return;
    const layout = wantPortrait() && wall.boxes.tall && wall.nodes.every((n) => n.tall) ? "tall" : "wide";
    if (layout !== ui.layout) {
      ++animation;
      useLayout(layout);
      ui.layout = layout;
      ui.pinned = {};
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
  // z = 1 fits the frame's width; the visible box always has the frame's proportions, so nothing is letterboxed.
  // The wide layout's frame takes the wall's own proportions, so there z = 1 is the whole wall, as before.
  const ZOOMS = [1, 1.5, 2, 3];
  function frameAspect() {
    const b = wall.box;
    if (wall.layout !== "tall") return b.w / b.h;
    const w = wall.svg.clientWidth, h = wall.svg.clientHeight;
    return w > 0 && h > 0 ? w / h : b.w / b.h;
  }
  const wholeZoom = () => Math.min(1, wall.box.w / (wall.box.h * frameAspect()));
  function levels() { const z = wholeZoom(); return z < 1 - 1e-3 ? [z, ...ZOOMS] : ZOOMS; }
  function defaultView() { return { z: wall && wall.box ? wholeZoom() : 1, cx: null, cy: null }; }
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
    wall.svg.dataset.zoom = atWhole() ? "1" : String(Math.round((ui.view.z / wholeZoom()) * 100) / 100);
    const label = one("[data-zoom-level]");
    if (label) label.textContent = atWhole() ? "Whole wall" : Math.round((ui.view.z / wholeZoom()) * 100) + "%";
    for (const b of all("button[data-zoom]")) b.disabled = b.dataset.zoom === "in" ? ui.view.z >= ZOOMS[ZOOMS.length - 1] - 1e-3 : atWhole();
  }
  function zoomTo(z, around) {
    if (!wall || !wall.box) return;
    ui.view.z = Math.max(wholeZoom(), Math.min(ZOOMS[ZOOMS.length - 1], z));
    if (atWhole()) { ui.view.cx = null; ui.view.cy = null; }
    else if (around) { ui.view.cx = around.x; ui.view.cy = around.y; }
    applyView();
    announce(atWhole() ? "The whole wall is in view." : "Zoomed to " + Math.round((ui.view.z / wholeZoom()) * 100) + "%. Drag to pan.");
  }
  function zoomStep(dir) {
    const zs = levels();
    const z = ui.view.z;
    const next = dir > 0 ? zs.find((v) => v > z + 1e-3) : [...zs].reverse().find((v) => v < z - 1e-3);
    const f = ui.focus ? wall.byId.get(ui.focus) : wall.nodes.find((n) => n.g.classList.contains("is-selected"));
    zoomTo(next === undefined ? z : next, dir > 0 && atWhole() && f ? f : null);
  }
  // A piece reached by keyboard or by a link is brought into view when the wall is zoomed in.
  function keepInView(n) {
    if (!wall || !wall.box || atWhole()) return;
    const r = visibleBox();
    if (n.x - n.w / 2 < r.x || n.x + n.w / 2 > r.x + r.w || n.y - n.h / 2 < r.y || n.y + n.h / 2 > r.y + r.h) { ui.view.cx = n.x; ui.view.cy = n.y; applyView(); }
  }

  function chamberBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of wall.nodes) {
      const t = n.g.dataset.type;
      if (!(t === "readiness" || t === "snapshot" || n.id === "gap:readiness-input")) continue;
      x0 = Math.min(x0, n.x - n.w / 2); y0 = Math.min(y0, n.y - n.h / 2); x1 = Math.max(x1, n.x + n.w / 2); y1 = Math.max(y1, n.y + n.h / 2);
    }
    const pad = wall.layout === "tall" ? 8 : 20;
    return x0 === Infinity ? null : { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  function place() {
    if (!wall) return;
    const r = (v) => Math.round(v * 10) / 10;
    for (const n of wall.nodes) n.g.setAttribute("transform", "translate(" + r(n.x) + " " + r(n.y) + ")");
    for (const e of wall.edges) {
      const a = wall.byId.get(e.from), b = wall.byId.get(e.to);
      if (a && b) e.p.setAttribute("d", edgePath(a, b, e.kind));
    }
    const c = wall.chamber ? chamberBounds() : null;
    if (c) {
      const rects = wall.chamber.querySelectorAll("rect");
      const set = (el, x, y, w, h) => { el.setAttribute("x", r(x)); el.setAttribute("y", r(y)); el.setAttribute("width", r(w)); el.setAttribute("height", r(h)); };
      if (rects[0]) set(rects[0], c.x, c.y, c.w, c.h);
      if (rects[1]) set(rects[1], c.x + 4, c.y + 4, c.w - 8, c.h - 8);
      const t = wall.chamber.querySelector("text");
      if (t) { t.setAttribute("x", r(c.x + 8)); t.setAttribute("y", r(c.y - 7)); }
    }
  }

  // First load: replay the same deterministic force simulation the server ran, so the pieces assemble and come to rest
  // exactly where the server placed them (the portrait layout has no simulation: its pieces settle once into their
  // rows). A later state change: each piece moves from where it was to where it now belongs; the keystone resolves last.
  function assemble(from) {
    const run = ++animation;
    const keystones = wall.nodes.filter((n) => n.g.dataset.type === "readiness");
    for (const k of keystones) k.g.classList.add("is-resolving");
    const finish = () => {
      if (run !== animation) return;
      for (const n of wall.nodes) { n.x = n.fx; n.y = n.fy; }
      place();
      remember();
      for (const k of keystones) k.g.classList.remove("is-resolving");
    };
    if (from === null && wall.layout === "tall") {
      from = {};
      for (const n of wall.nodes) from[n.id] = { x: wall.box.x + wall.box.w / 2, y: n.fy - 16 };
    }
    if (from === null) {
      const sim = wall.nodes.map((n) => ({ id: n.id, x: n.x0, y: n.y0, ax: n.ax, ay: n.ay, kx: n.kx, ky: n.ky, w: n.w, h: n.h, fixed: false }));
      const stepper = forceLayout(sim, wall.edges.map((e) => ({ from: e.from, to: e.to, len: e.len, k: e.k })), wall.ticks);
      const frame = () => {
        if (run !== animation) return;
        let more = true;
        for (let i = 0; i < 4 && more; i++) more = stepper.step();
        wall.nodes.forEach((n, i) => { n.x = sim[i].x; n.y = sim[i].y; });
        place();
        if (more) raf(frame); else finish();
      };
      raf(frame);
      return;
    }
    const start = wall.nodes.map((n) => (from[n.id] ? { x: from[n.id].x, y: from[n.id].y } : { x: n.x0, y: n.y0 }));
    const frames = 18;
    let f = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = () => {
      if (run !== animation) return;
      f++;
      wall.nodes.forEach((n, i) => {
        const delay = n.g.dataset.type === "readiness" || n.g.dataset.type === "snapshot" ? 6 : 0;
        const t = ease(Math.max(0, Math.min(1, (f - delay) / (frames - delay))));
        n.x = start[i].x + (n.fx - start[i].x) * t;
        n.y = start[i].y + (n.fy - start[i].y) * t;
      });
      place();
      if (f < frames) raf(frame); else finish();
    };
    raf(frame);
  }

  // The selected piece's dependency path: everything it rests on (upstream) and everything resting on it (downstream),
  // following only the evidence connections that "Why WalletWall says this" traces. A cleared selection shows no path.
  function highlight() {
    if (!wall) return;
    const selectedEl = ui.quiet ? null : ui.focus ? wall.byId.get(ui.focus) : wall.nodes.find((n) => n.g.classList.contains("is-selected"));
    const sel = selectedEl ? selectedEl.id : null;
    const on = new Set();
    const onEdges = new Set();
    if (sel) {
      on.add(sel);
      const walk = (forward) => {
        const queue = [sel];
        const seen = new Set([sel]);
        while (queue.length) {
          const id = queue.shift();
          for (const e of wall.edges) {
            if (!e.why) continue;
            const next = forward ? (e.from === id ? e.to : null) : (e.to === id ? e.from : null);
            if (next === null) continue;
            onEdges.add(e);
            on.add(next);
            if (!seen.has(next)) { seen.add(next); queue.push(next); }
          }
        }
      };
      walk(false);
      walk(true);
      // A split seam on the path shows both sides of the disagreement.
      for (const e of wall.edges) if (e.kind === "conflict" && on.has(e.to)) { onEdges.add(e); on.add(e.from); }
    }
    for (const n of wall.nodes) {
      n.g.classList.toggle("on-path", on.has(n.id));
      if (ui.quiet) { n.g.classList.remove("is-selected"); n.g.setAttribute("aria-pressed", "false"); }
      else if (ui.focus) n.g.setAttribute("aria-pressed", String(n.id === ui.focus));
    }
    for (const e of wall.edges) e.p.classList.toggle("on-path", onEdges.has(e));
  }

  function focusPiece(id, speak) {
    ui.focus = id;
    if (id) ui.quiet = false;
    const panels = app.querySelectorAll("[data-node-panel]");
    for (const p of panels) p.hidden = p.dataset.nodePanel !== id;
    const main = app.querySelector("[data-assertion-detail]");
    if (main) main.hidden = Boolean(id);
    if (!id && wall && !ui.quiet) for (const n of wall.nodes) n.g.setAttribute("aria-pressed", String(n.g.classList.contains("is-selected")));
    highlight();
    if (speak && id && wall && wall.byId.get(id)) announce("Showing " + wall.byId.get(id).g.getAttribute("aria-label"));
  }

  function selectAssertion(id) {
    ui.focus = null;
    ui.quiet = false;
    fetch(base + "select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assertionId: id }) });
  }

  function activate(g) {
    ui.reveal = true;
    if (g.dataset.assertionId) selectAssertion(g.dataset.assertionId);
    else { focusPiece(ui.focus === g.dataset.nodeId ? null : g.dataset.nodeId, true); revealDetail(); }
  }

  // Tapping empty space on The Wall: no piece emphasised, the sheet folds down to its peek.
  function clearSelection() {
    ui.quiet = true;
    focusPiece(null, false);
    if (isPhone()) setSheet("peek", false);
    announce("Selection cleared.");
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

  // Trace: dim what is off the path, keep the graph where it is, centre the path if zoomed in, and on a phone turn the
  // sheet to the provenance of the selected claim.
  function startTrace() {
    ui.mode = "trace";
    ui.quiet = false;
    applyMode();
    highlight();
    if (wall && !atWhole()) {
      const on = wall.nodes.filter((n) => n.g.classList.contains("on-path"));
      if (on.length) { ui.view.cx = on.reduce((s, n) => s + n.x, 0) / on.length; ui.view.cy = on.reduce((s, n) => s + n.y, 0) / on.length; applyView(); }
    }
    if (isPhone()) {
      if (ui.sheet === "peek") setSheet("half", false);
      const d = one("#detail");
      const why = one("#h-states");
      if (d && why && !(why.closest && why.closest("[hidden]"))) d.scrollTop = Math.max(0, why.offsetTop - 64);
    }
  }

  // ---- Dragging: the dragged piece is pinned where it is dropped; its neighbours relax around it, then stop. --------
  function svgPoint(e) {
    const m = wall.svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function relax(pinnedId) {
    const sim = wall.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ax: n.ax, ay: n.ay, kx: n.kx, ky: n.ky, w: n.w, h: n.h, fixed: n.id === pinnedId || Boolean(ui.pinned[n.id]) }));
    // The portrait layout has no springs: pieces only make room and return towards their own place.
    const springs = wall.layout === "tall" ? [] : wall.edges.map((e) => ({ from: e.from, to: e.to, len: e.len, k: e.k }));
    const stepper = forceLayout(sim, springs, 40);
    const apply = () => { wall.nodes.forEach((n, i) => { n.x = sim[i].x; n.y = sim[i].y; }); place(); };
    if (reduced()) { while (stepper.step()); apply(); remember(); return; }
    const run = ++animation;
    const frame = () => {
      if (run !== animation) return;
      const more = stepper.step() && stepper.step();
      apply();
      if (more) raf(frame); else remember();
    };
    raf(frame);
  }

  // ---- Guide ------------------------------------------------------------------------------------------------------
  function say(text, pose, nodeId) {
    if (!guide || ui.guideOff) return;
    ui.lastCue = { text, pose, nodeId };
    unpoint();
    guideText.textContent = text;
    guideArt.dataset.pose = pose || "inspect";
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
  // Show Guide brings WalletWallaby back with the last cue, or the bundle's first cue if none was shown yet.
  function showGuide() {
    if (ui.lastCue) { say(ui.lastCue.text, ui.lastCue.pose, ui.lastCue.nodeId); return; }
    const first = app.querySelectorAll ? app.querySelectorAll(".ww-guide-cues li")[0] : null;
    if (first) say(first.textContent, first.dataset.pose, first.dataset.node);
  }
  function setGuide(off) {
    ui.guideOff = off;
    if (off) retract(); else showGuide();
    applyMode();
    announce(off ? "Guide hidden." : "Guide shown.");
  }
  function cue(first, moved) {
    if (!guide || ui.guideOff || !app.querySelectorAll) return;
    if (moved.length) {
      const n = moved[0];
      const now = (n.g.dataset.state || n.g.dataset.classification || "changed").replace("NONE", "no evaluation");
      say("This piece moved because its state changed. " + (n.g.getAttribute("aria-label") || "").split(",")[0] + " is now " + now + ".", "inspect", n.id);
      return;
    }
    for (const c of app.querySelectorAll(".ww-guide-cues li")) {
      if (c.dataset.cue === "orientation" && !first) continue;
      const key = ui.digest + "|" + c.dataset.cue;
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
      if (button.dataset) button.dataset.label = label;
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = label; }, 1500);
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
    // Menus close when anything else is chosen.
    const inMenu = e.target.closest("#wall-menu");
    if (ui.wallMenu && !e.target.closest("[data-wall-menu-toggle]")) {
      setWallMenu(false, false);
      // A choice made in the menu returns focus to the menu's own button, not to the top of the page.
      const t = inMenu ? one("[data-wall-menu-toggle]") : null;
      if (t && !e.target.closest("[data-list-view]")) t.focus({ preventScroll: true });
    }
    if (e.target.closest("[data-wall-menu-toggle]")) { setWallMenu(!ui.wallMenu, !ui.wallMenu); return; }
    if (e.target.closest("[data-panel-toggle]")) { ui.panelOpen = !ui.panelOpen; applyPanels(); return; }
    if (e.target.closest("[data-back-overview]")) { ui.mode = "overview"; applyMode(); highlight(); announce("Overview."); return; }
    const mode = e.target.closest("button[data-mode]");
    if (mode) {
      if (mode.dataset.mode === "trace") { startTrace(); announce("Trace: the selected piece's dependency path is emphasised."); }
      else { ui.mode = mode.dataset.mode; applyMode(); announce("Overview."); }
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
      const n = wall ? (ui.focus ? wall.byId.get(ui.focus) : wall.nodes.find((x) => x.g.classList.contains("is-selected"))) : null;
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
      ui.pinned = {};
      for (const n of wall.nodes) { n.x = n.fx; n.y = n.fy; n.fixed = false; }
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
      if (ui.wallMenu) { setWallMenu(false, false); const t = one("[data-wall-menu-toggle]"); if (t) t.focus(); return; }
      if (ui.panelOpen) { ui.panelOpen = false; applyPanels(); const t = one("[data-panel-toggle]"); if (t) t.focus(); return; }
      if (isPhone() && ui.sheet !== "peek" && e.target.closest && e.target.closest("#detail")) { sheetStep(-1); return; }
    }
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || !wall) {
      if (e.key === "Escape" && ui.focus) focusPiece(null, false);
      else if (e.key === "Escape" && isPhone() && ui.sheet !== "peek") sheetStep(-1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(g); return; }
    if (e.key === "Escape") { focusPiece(null, false); return; }
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

  app.addEventListener("focusin", (e) => {
    const g = wall && e.target && e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (g) { const n = wall.byId.get(g.dataset.nodeId); if (n) keepInView(n); }
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
      announce(atWhole() ? "The whole wall is in view." : "Zoomed to " + Math.round((ui.view.z / wholeZoom()) * 100) + "%. Drag to pan.");
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
    if (!drag.moved) { drag.moved = true; ++animation; if (drag.g.setPointerCapture) drag.g.setPointerCapture(e.pointerId); }
    const p = svgPoint(e);
    if (!p) return;
    drag.n.x = p.x + drag.ox;
    drag.n.y = p.y + drag.oy;
    if (wall.box) {
      const b = wall.box, n = drag.n;
      n.x = Math.min(Math.max(n.x, b.x + n.w / 2), b.x + b.w - n.w / 2);
      n.y = Math.min(Math.max(n.y, b.y + n.h / 2), b.y + b.h - n.h / 2);
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
    ui.pinned[d.n.id] = true;
    d.n.fixed = true;
    relax(d.n.id);
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

  if (guide) guide.addEventListener("click", (e) => {
    if (e.target.closest("[data-wallaby-dismiss]")) retract();
    else if (e.target.closest("[data-wallaby-off]")) setGuide(true);
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
