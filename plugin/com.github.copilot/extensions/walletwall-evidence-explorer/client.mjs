// The browser-side script of the WalletWall canvas page, as a string served inline under the page's CSP nonce.
//
// It talks only to its own origin (GET view, POST select, the events stream), stores nothing (no cookies, no web
// storage), and keeps its UI state (mode, motion preference, pinned pieces, guide) in memory for the life of the page.
// Motion only plays when the bundle changed or the user acted, and never when reduced motion is requested.
import { edgePath, forceLayout } from "./wall.mjs";

export const CLIENT_JS = `(() => {
  const base = location.pathname.replace(/[^/]*$/, "");
  const app = document.getElementById("app");
  const status = document.getElementById("copy-status");
  const announcer = document.getElementById("view-status");
  const guide = document.getElementById("wallaby");
  const guideText = document.getElementById("wallaby-text");
  const guideArt = document.getElementById("wallaby-art");
  const mql = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const raf = window.requestAnimationFrame ? (f) => window.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
  const ui = { mode: "overview", focus: null, reducedByUser: false, guideOff: false, digest: null, seen: {}, pinned: {}, positions: {}, states: {}, pointed: null, reveal: false };
  const reduced = () => ui.reducedByUser || Boolean(mql && mql.matches);
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
    for (const b of app.querySelectorAll ? app.querySelectorAll("button[data-mode]") : []) b.setAttribute("aria-pressed", String(b.dataset.mode === ui.mode));
    const m = app.querySelector ? app.querySelector("[data-motion-toggle]") : null;
    if (m) m.setAttribute("aria-pressed", String(reduced()));
    const g = app.querySelector ? app.querySelector("[data-guide-toggle]") : null;
    if (g) g.textContent = ui.guideOff ? "Show Guide" : "Hide Guide";
    if (wall) wall.svg.dataset.trace = String(ui.mode === "trace");
  }

  // ---- The Wall -------------------------------------------------------------------------------------------------
  function initWall() {
    const svg = app.querySelector ? app.querySelector(".ww-wall-svg") : null;
    if (!svg) { wall = null; ui.digest = null; return; }
    const num = (v) => (v === "" || v === undefined ? null : Number(v));
    const nodes = Array.from(svg.querySelectorAll(".ww-node")).map((g) => {
      const m = /translate\\(([-0-9.]+) ([-0-9.]+)\\)/.exec(g.getAttribute("transform") || "") || [0, 0, 0];
      return { g, id: g.dataset.nodeId, x0: num(g.dataset.x0), y0: num(g.dataset.y0), ax: num(g.dataset.ax), ay: num(g.dataset.ay), kx: num(g.dataset.kx), ky: num(g.dataset.ky), w: num(g.dataset.w), h: num(g.dataset.h), fx: Number(m[1]), fy: Number(m[2]), x: Number(m[1]), y: Number(m[2]), fixed: false };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = Array.from(svg.querySelectorAll(".ww-edge")).map((p) => ({ p, from: p.dataset.from, to: p.dataset.to, len: Number(p.dataset.len), k: Number(p.dataset.k), kind: p.dataset.kind, why: p.dataset.evidence === "true" }));
    const chamber = svg.querySelector(".ww-chamber");
    wall = { svg, nodes, edges, byId, chamber, ticks: Number(svg.dataset.ticks) || 160 };
    // The Wall fits its frame: the server's view box covers every piece, so the whole graph (readiness keystone
    // included) is visible at load. Zooming narrows the view box inside the same frame; the page never scrolls sideways.
    const vb = (svg.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number);
    wall.box = vb.length === 4 && vb.every((v) => Number.isFinite(v)) && vb[2] > 0 && vb[3] > 0 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null;
    if (wall.box && svg.style) { svg.style.aspectRatio = wall.box.w + " / " + wall.box.h; svg.style.maxWidth = Math.round(wall.box.w * 1.1) + "px"; }
    svg.dataset.trace = String(ui.mode === "trace");
    const digest = svg.dataset.digest;
    const changed = digest !== ui.digest;
    if (changed || !ui.view) ui.view = { z: 1, cx: null, cy: null };
    applyView();
    const previous = ui.digest;
    const nextStates = {};
    for (const n of nodes) nextStates[n.id] = (n.g.dataset.state || "") + "|" + (n.g.dataset.classification || "");
    const moved = previous === null ? [] : nodes.filter((n) => ui.states[n.id] !== undefined && ui.states[n.id] !== nextStates[n.id]);
    if (changed) ui.pinned = {};
    if (!changed) {
      for (const n of nodes) {
        const p = ui.positions[n.id];
        if (p) { n.x = p.x; n.y = p.y; }
        if (ui.pinned[n.id]) n.fixed = true;
      }
      place();
    } else if (!reduced() && window.requestAnimationFrame) {
      assemble(previous === null ? null : ui.positions);
    }
    ui.states = nextStates;
    ui.digest = digest;
    remember();
    if (ui.focus && !byId.has(ui.focus)) ui.focus = null;
    if (ui.focus) focusPiece(ui.focus, false); else highlight();
    if (changed) cue(previous === null, moved);
  }

  function remember() {
    ui.positions = {};
    if (wall) for (const n of wall.nodes) ui.positions[n.id] = { x: n.x, y: n.y };
  }

  // ---- Fit, zoom and pan, all inside The Wall's own frame --------------------------------------------------------
  const ZOOMS = [1, 1.5, 2, 3];
  function visibleBox() {
    const b = wall.box, v = ui.view;
    const w = b.w / v.z, h = b.h / v.z;
    const cx = v.cx === null ? b.x + b.w / 2 : v.cx, cy = v.cy === null ? b.y + b.h / 2 : v.cy;
    return { x: Math.min(Math.max(cx - w / 2, b.x), b.x + b.w - w), y: Math.min(Math.max(cy - h / 2, b.y), b.y + b.h - h), w, h };
  }
  function applyView() {
    if (!wall || !wall.box) return;
    const r = visibleBox();
    const k = (v) => Math.round(v * 10) / 10;
    ui.view.cx = r.x + r.w / 2;
    ui.view.cy = r.y + r.h / 2;
    wall.svg.setAttribute("viewBox", k(r.x) + " " + k(r.y) + " " + k(r.w) + " " + k(r.h));
    wall.svg.dataset.zoom = String(ui.view.z);
    const label = app.querySelector ? app.querySelector("[data-zoom-level]") : null;
    if (label) label.textContent = ui.view.z === 1 ? "Whole wall" : Math.round(ui.view.z * 100) + "%";
    for (const b of app.querySelectorAll ? app.querySelectorAll("button[data-zoom]") : []) b.disabled = b.dataset.zoom === "in" ? ui.view.z >= ZOOMS[ZOOMS.length - 1] : ui.view.z === 1;
  }
  function zoomTo(z, around) {
    if (!wall || !wall.box) return;
    ui.view.z = z;
    if (z === 1) { ui.view.cx = null; ui.view.cy = null; }
    else if (around) { ui.view.cx = around.x; ui.view.cy = around.y; }
    applyView();
    announce(z === 1 ? "The whole wall is in view." : "Zoomed to " + Math.round(z * 100) + "%. Drag the background to pan.");
  }
  function zoomStep(dir) {
    const i = ZOOMS.indexOf(ui.view.z);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))];
    const f = ui.focus ? wall.byId.get(ui.focus) : wall.nodes.find((n) => n.g.classList.contains("is-selected"));
    zoomTo(next, dir > 0 && ui.view.z === 1 && f ? f : null);
  }
  // A piece reached by keyboard or by a link is brought into view when the wall is zoomed in.
  function keepInView(n) {
    if (!wall || !wall.box || ui.view.z === 1) return;
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
    return x0 === Infinity ? null : { x: x0 - 20, y: y0 - 20, w: x1 - x0 + 40, h: y1 - y0 + 40 };
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
  // exactly where the server placed them. A later state change: each piece moves from where it was to where it now
  // belongs, and the readiness keystone resolves last.
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
  // following only the evidence connections that "Why WalletWall says this" traces.
  function highlight() {
    if (!wall) return;
    const selectedEl = ui.focus ? wall.byId.get(ui.focus) : wall.nodes.find((n) => n.g.classList.contains("is-selected"));
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
      if (ui.focus) n.g.setAttribute("aria-pressed", String(n.id === ui.focus));
    }
    for (const e of wall.edges) e.p.classList.toggle("on-path", onEdges.has(e));
  }

  function focusPiece(id, speak) {
    ui.focus = id;
    const panels = app.querySelectorAll("[data-node-panel]");
    for (const p of panels) p.hidden = p.dataset.nodePanel !== id;
    const main = app.querySelector("[data-assertion-detail]");
    if (main) main.hidden = Boolean(id);
    if (!id && wall) for (const n of wall.nodes) n.g.setAttribute("aria-pressed", String(n.g.classList.contains("is-selected")));
    highlight();
    if (speak && id && wall && wall.byId.get(id)) announce("Showing " + wall.byId.get(id).g.getAttribute("aria-label"));
  }

  function selectAssertion(id) {
    ui.focus = null;
    fetch(base + "select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assertionId: id }) });
  }

  function activate(g) {
    ui.reveal = true;
    if (g.dataset.assertionId) selectAssertion(g.dataset.assertionId);
    else { focusPiece(ui.focus === g.dataset.nodeId ? null : g.dataset.nodeId, true); revealDetail(); }
  }

  // When the detail rail sits below The Wall (narrow panels), bring it into view after an explicit selection only.
  function revealDetail() {
    if (!ui.reveal) return;
    ui.reveal = false;
    const stacked = window.matchMedia ? window.matchMedia("(max-width: 1180px)").matches : false;
    const d = app.querySelector ? app.querySelector("#detail") : null;
    if (stacked && d && d.scrollIntoView) d.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
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
    const stepper = forceLayout(sim, wall.edges.map((e) => ({ from: e.from, to: e.to, len: e.len, k: e.k })), 40);
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
  // nothing stored. The selection is made first so that a failed copy still leaves the full value selected.
  async function copyAddress(button, withChain) {
    const holder = button.closest(".addr");
    const node = holder.querySelector("code");
    const full = node.textContent;
    const text = withChain ? "chainId:" + holder.getAttribute("data-chain") + " address:" + full : full;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let ok = false;
    if (!withChain) { try { ok = document.execCommand("copy"); } catch (_) { ok = false; } }
    if (!ok) { try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = false; } }
    status.textContent = ok ? (withChain ? "Copied the chain ID and the full address." : "Copied the full address (" + full.length + " characters).") : "Copy was not permitted here. The full address is selected: press Ctrl+C.";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 4000);
  }

  app.addEventListener("click", (e) => {
    const copy = e.target.closest("[data-copy-address]");
    if (copy) { copyAddress(copy, false); return; }
    const copyChain = e.target.closest("[data-copy-chain-address]");
    if (copyChain) { copyAddress(copyChain, true); return; }
    const mode = e.target.closest("button[data-mode]");
    if (mode) { ui.mode = mode.dataset.mode; applyMode(); announce(ui.mode === "trace" ? "Trace: the selected piece's dependency path is emphasised." : "Overview."); return; }
    if (e.target.closest("button[data-why]")) {
      ui.mode = "trace";
      applyMode();
      highlight();
      const w = app.querySelector(".ww-wall");
      if (w && w.scrollIntoView) w.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
      announce("Trace: the path WalletWall followed for this claim is emphasised on The Wall.");
      return;
    }
    if (e.target.closest("[data-motion-toggle]")) { ui.reducedByUser = !ui.reducedByUser; applyMode(); announce(reduced() ? "Reduced motion on." : "Reduced motion off."); return; }
    if (e.target.closest("[data-guide-toggle]")) { setGuide(!ui.guideOff); return; }
    const z = e.target.closest("button[data-zoom]");
    if (z) { if (!wall) return; if (z.dataset.zoom === "fit") zoomTo(1, null); else zoomStep(z.dataset.zoom === "in" ? 1 : -1); return; }
    if (e.target.closest("[data-reset-layout]")) {
      if (!wall) return;
      ui.pinned = {};
      for (const n of wall.nodes) { n.x = n.fx; n.y = n.fy; n.fixed = false; }
      place();
      remember();
      announce("Layout reset.");
      return;
    }
    const piece = e.target.closest(".ww-wall-svg .ww-node");
    if (piece) { if (suppressClick) { suppressClick = false; return; } activate(piece); return; }
    const focusLink = e.target.closest("[data-focus-node]");
    if (focusLink) {
      const g = wall ? wall.byId.get(focusLink.dataset.focusNode) : null;
      if (g) { activate(g.g); keepInView(g); if (g.g.focus) g.g.focus(); }
      return;
    }
    const b = e.target.closest("[data-assertion-id]");
    if (!b) return;
    selectAssertion(b.dataset.assertionId);
  });

  app.addEventListener("keydown", (e) => {
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || !wall) { if (e.key === "Escape" && ui.focus) focusPiece(null, false); return; }
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

  // Panning: when zoomed in, dragging the background of The Wall moves the view inside its frame.
  let pan = null;
  app.addEventListener("pointerdown", (e) => {
    if (!wall || !wall.box || ui.view.z === 1 || e.button !== 0 || !e.target.closest) return;
    if (e.target.closest(".ww-wall-svg .ww-node") || !e.target.closest(".ww-wall-svg")) return;
    const r = visibleBox();
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: ui.view.cx, cy: ui.view.cy, k: r.w / (wall.svg.clientWidth || r.w) };
    wall.svg.classList.add("is-panning");
    if (wall.svg.setPointerCapture) wall.svg.setPointerCapture(e.pointerId);
  });
  app.addEventListener("pointermove", (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    ui.view.cx = pan.cx - (e.clientX - pan.sx) * pan.k;
    ui.view.cy = pan.cy - (e.clientY - pan.sy) * pan.k;
    applyView();
  });
  const endPan = (e) => { if (pan && e.pointerId === pan.id) { pan = null; if (wall) wall.svg.classList.remove("is-panning"); } };
  app.addEventListener("pointerup", endPan);
  app.addEventListener("pointercancel", endPan);

  app.addEventListener("pointerdown", (e) => {
    const g = e.target.closest ? e.target.closest(".ww-wall-svg .ww-node") : null;
    if (!g || !wall || e.button !== 0) return;
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

  if (guide) guide.addEventListener("click", (e) => {
    if (e.target.closest("[data-wallaby-dismiss]")) retract();
    else if (e.target.closest("[data-wallaby-off]")) setGuide(true);
  });
  if (mql && mql.addEventListener) mql.addEventListener("change", applyMode);

  const es = new EventSource(base + "events");
  es.onmessage = () => { load(); };
  load();
})();`;
