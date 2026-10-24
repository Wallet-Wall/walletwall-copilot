// The WalletWall canvas stylesheet. Colours are the WalletWall brand tokens (canvas/brand/brand-sources.json and the
// Coinstellation's --ww-brick-low), or a named mix of them; there is no neon, purple or generic green.
// Surfaces, lightest to deepest: the workspace (warm stone with 30 % stone), the detail rail (tan parchment), The Wall's stage (warm
// stone deepened with stone-low and deep slate), the Wallprint band (deep slate) and the header (charcoal deepened toward
// the ink). No visible surface, piece, chip or button is white or reads as white. Terracotta is the WalletWall wordmark
// and focus; umber (accent-dark and stone-low, deepened with charcoal) is material depth only.
// Material: matte and drafted, like a printed technical plate. Flat fills; one family of hairlines (an umber seam round
// the stage, rail and panels, a fainter umber divider between rows, a near-black seam between control segments and
// Wallprint items, a barely-there grid). No drop shadow, bevel, gloss or pressed effect anywhere; the only highlight is
// a faint (0.12) etch beside each connector, under 1 px away, so a connector reads as one drafted mark.
// Motion follows the app's tokens: 140 to 280 ms transitions, decisive ease-out, no bounce. The loops (conflict ring,
// selection halo, stale recession, trace shimmer, the guide's idle) animate transform and opacity only, and stop under
// reduced motion; every state they accompany is also drawn statically.

export const CSS = `
:root{color-scheme:light;
--ww-bg:#F2ECDF;--ww-surface:#F8F2E4;--ww-card-bg:rgba(248,242,228,0.82);--ww-card-border:rgba(139,49,32,0.16);--ww-inner-border:rgba(30,26,20,0.1);
--ww-ink:rgba(30,26,20,0.9);--ww-muted-text:rgba(30,26,20,0.7);--ww-accent:#BF4E32;--ww-accent-dark:#8B3120;--ww-brick-low:#76281D;--ww-tan:#C9A47A;
--ww-charcoal:#2B2B2E;--ww-deep-slate:#3A3D41;--ww-warm-stone:#D8D3C8;--ww-cream:#F5F1E8;--ww-charcoal-border:rgba(43,43,46,0.3);--ww-charcoal-rail:rgba(43,43,46,0.72);
--ww-stone:#e9d3ad;--ww-stone-low:#b99568;--ww-mortar:#f5ead4;--ww-brick:#b94a31;--ww-radius-panel:2px;--ww-radius-badge:2px;
--ww-umber:#674739;--ww-umber-deep:#4F3C35;
--ww-page:#DDD3C0;--ww-stage:#B8AD9C;--ww-rail:#D4BD98;--ww-shell:#221F1C;--ww-node:#DDCBA8;--ww-node-quiet:#CBBCA2;--ww-label:#E2D2B2;--ww-on-dark:var(--ww-cream);--ww-on-dark-muted:rgba(245,241,232,0.8);
--ww-seam:rgba(79,60,53,0.35);--ww-cut:rgba(79,60,53,0.3);--ww-cut-strong:rgba(79,60,53,0.55);--ww-cut-dark:rgba(12,10,8,0.5);--ww-etch:rgba(245,241,232,0.12);
--font-display:"Sora Variable","Sora",system-ui,sans-serif;--font-ui:"Manrope Variable","Manrope",system-ui,sans-serif;--font-mono:"IBM Plex Mono","SFMono-Regular",Consolas,monospace;
--ww-fast:140ms;--ww-base:180ms;--ww-settle:280ms;--ww-ease:cubic-bezier(0.22,1,0.36,1);--ww-peek:84px}
*{box-sizing:border-box;scrollbar-width:thin}
/* Scrollbars: narrow and quiet. A track the colour of the surface it scrolls, a deep-slate thumb, terracotta while
   engaged. Scrolling itself is unchanged. */
html{scrollbar-color:var(--ww-deep-slate) var(--ww-page)}
.ww-detail{scrollbar-color:var(--ww-deep-slate) var(--ww-rail)}
.ww-detail:hover,.ww-table-wrap:hover{scrollbar-color:var(--ww-accent) var(--ww-rail)}
::-webkit-scrollbar{width:8px;height:8px;background:var(--ww-page)}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:var(--ww-page)}
::-webkit-scrollbar-thumb{background:var(--ww-deep-slate);border:2px solid var(--ww-page);border-radius:0}
::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{background:var(--ww-accent)}
body{margin:0;padding:12px 16px 32px;background:var(--ww-page);color:var(--ww-ink);font:14px/1.5 var(--font-ui);font-weight:500;overflow-wrap:anywhere}
h1,h2{font-family:var(--font-display);font-weight:600;letter-spacing:-0.01em}
h1{font-size:18px;line-height:1.2;margin:0}
h2{font-size:15px;margin:14px 0 8px}
h3{font-size:10.5px;margin:12px 0 4px;color:var(--ww-brick-low);font-weight:700;text-transform:uppercase;letter-spacing:0.16em}
code{font-family:var(--font-mono);font-size:12px;font-weight:400;word-break:break-all}
.muted{color:var(--ww-muted-text)}.small{font-size:12px}
.ww-sr,.ww-zoom-level{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-eyebrow{display:block;margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-brick-low)}
.note{padding:8px 10px;border-left:2px solid var(--ww-umber-deep);background:var(--ww-rail);margin:8px 0}
.note[data-attention="true"]{border-left-color:var(--ww-brick-low);border-left-style:dashed}
.meta{font-size:12px;color:var(--ww-muted-text);margin:6px 0}
button{font:inherit}
::selection{background:rgba(191,78,50,0.26);color:inherit}
html{-webkit-tap-highlight-color:transparent}
button:focus-visible,.ww-node:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ww-accent-dark);outline-offset:2px}
.ww-node:focus-visible{outline:none}

/* Summary header: the charcoal anchor, deepened toward the ink so the terracotta wordmark carries (3.4:1, large text).
   Mark, the WalletWall wordmark, the asset as presented and its chain ID. */
.ww-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding:6px 14px;background:var(--ww-shell);color:var(--ww-on-dark);border-bottom:2px solid var(--ww-accent);border-radius:var(--ww-radius-panel)}
.ww-rail{display:flex;align-items:center;gap:12px;min-height:40px;min-width:0}
.ww-mark{flex:0 0 auto;width:34px;height:34px;background-size:contain;background-repeat:no-repeat;background-position:center}
.ww-rail-name{display:flex;align-items:center;gap:8px}
/* The product name is the wordmark: Sora 600 in the canonical terracotta. Ordinary prose that names WalletWall is not. */
.ww-rail-name h1{color:var(--ww-accent);font:600 24px/1.15 var(--font-display);letter-spacing:-0.015em;white-space:nowrap}
.ww-lens-badge{font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:1px 6px;border:1px solid rgba(233,211,173,0.5);border-radius:var(--ww-radius-badge);color:var(--ww-stone)}
.ww-rail-asset{display:flex;align-items:baseline;gap:6px;margin:0;min-width:0;white-space:nowrap}
.ww-rail-symbol{font:700 15px/1.2 var(--font-ui);letter-spacing:0.01em}
.ww-rail-sep,.ww-rail-chain{color:var(--ww-on-dark-muted)}
.ww-rail-chain{font-size:13px}
.ww-strip{display:none}
.ww-strip .chip,.ww-summary .chip{background:var(--ww-label);color:var(--ww-charcoal);border-color:var(--ww-umber)}

/* About this panel: the boundary, versions, lenses not live yet and invariant violations, one step away. */
.ww-panel-info{display:none}
#app[data-panel-open="true"] .ww-panel-info{display:block;margin-top:12px;padding:10px 14px;background:var(--ww-rail);border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
.ww-boundary{font-size:12.5px;margin-top:0}
.ww-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:8px 0 4px}
.ww-lens{display:flex;flex-wrap:wrap}
.ww-lens button{min-height:32px;padding:4px 12px;border:1px solid var(--ww-cut-strong);margin-right:-1px;background:transparent;color:var(--ww-ink);font-size:12.5px;font-weight:600}
.ww-lens .is-on{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}
button:disabled{cursor:not-allowed;color:var(--ww-muted-text);border-style:dashed}
.ww-reasons{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 14px;font-size:11.5px;color:var(--ww-muted-text);flex-basis:100%}
.ww-reason{font-size:12px;color:var(--ww-muted-text);font-weight:600}

/* Layout: The Wall is the centre of gravity; the detail rail sits beside it, Wallprint beneath. */
.ww-flow{display:flex;flex-direction:column}
.ww-flow>*{order:5}.ww-flow>.ww-stage{order:1}.ww-flow>.ww-wallprint{order:2}.ww-flow>.ww-assembly{order:3}.ww-flow>.ww-list{order:4}
.ww-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:16px;margin-top:12px;align-items:start}
.ww-section{margin-top:12px;min-width:0}
.ww-section>h2:first-child{margin-top:2px}

/* The Wall's stage: a deeper warm field with an umber hairline seam and a sparse drafting sheet grid (64 px, about
   1.07:1), felt, not read; the plate's own centrelines and crop marks carry the structure. */
.ww-wall{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"head guide" "view view";align-items:center;min-width:0;background-color:var(--ww-stage);background-image:linear-gradient(rgba(79,60,53,0.055) 1px,transparent 1px),linear-gradient(90deg,rgba(79,60,53,0.055) 1px,transparent 1px);background-size:64px 64px;border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
.ww-section-head{grid-area:head;display:flex;align-items:center;gap:10px;padding:8px 12px 0;min-width:0}
.ww-section-head h2{margin:0;font:600 15px/1.2 var(--font-display);letter-spacing:-0.01em;white-space:nowrap;color:var(--ww-charcoal)}
.ww-guide-slot{grid-area:guide;display:flex;justify-content:flex-end;min-width:0;padding:10px 14px 2px}
.ww-wall-view{grid-area:view;min-width:0;padding:0 8px 4px}
.ww-wall-svg{display:block;width:100%;height:auto;margin:0 auto;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.ww-wall-svg:not([data-zoom="1"]){cursor:grab;touch-action:none}
.ww-wall-svg.is-panning{cursor:grabbing}
.ww-wall-svg .ww-node{touch-action:none}

/* The one control group: a charcoal bar. Overview and Trace, Fit, the guide, More. */
/* Instrumentation, printed flat: 1 px seams between segments, the active mode a flat terracotta fill, nothing lifts. */
.ww-wall-tools{position:relative;display:flex;align-items:center;flex-wrap:nowrap;border-radius:var(--ww-radius-panel)}
.ww-modes{display:flex}
.ww-wall-tools>button,.ww-modes button{min-height:34px;padding:0 12px;border:0;border-right:1px solid var(--ww-cut-dark);background:var(--ww-charcoal);color:var(--ww-cream);font:600 12.5px var(--font-ui);cursor:pointer;white-space:nowrap;transition:background var(--ww-fast) var(--ww-ease)}
.ww-modes button:first-child{border-radius:var(--ww-radius-panel) 0 0 var(--ww-radius-panel)}
.ww-wall-tools>button:last-of-type{border-right:0;border-radius:0 var(--ww-radius-panel) var(--ww-radius-panel) 0}
.ww-modes button[aria-pressed="true"]{background:var(--ww-accent-dark)}
.ww-wall-tools>button:hover:not(:disabled),.ww-modes button:hover:not([aria-pressed="true"]){background:var(--ww-deep-slate)}
.ww-wall-tools button:disabled{color:rgba(245,241,232,0.55);border-style:solid;cursor:default}
.ww-wall-tools>.ww-tool-in{display:none}
.ww-icon-button{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 10px;cursor:pointer;font-weight:700}
.ww-wall-tools>.ww-icon-button{min-height:34px;min-width:52px}
.ww-wall-tools>.ww-icon-button[aria-expanded="true"]{background:var(--ww-accent-dark)}
.ww-wall-menu{display:none}
.ww-wall-menu:not([hidden]){display:flex;flex-direction:column;position:absolute;top:calc(100% + 6px);left:0;z-index:8;min-width:220px;background:var(--ww-charcoal);border:1px solid var(--ww-cut-dark);border-radius:var(--ww-radius-panel);overflow:hidden}
.ww-wall-menu button{min-height:44px;padding:0 14px;text-align:left;border:0;border-bottom:1px solid var(--ww-cut-dark);background:transparent;color:var(--ww-cream);font:600 14px var(--font-ui);cursor:pointer}
.ww-wall-menu button:hover:not(:disabled),.ww-wall-menu button:focus-visible{background:var(--ww-deep-slate)}
.ww-wall-menu button:disabled{color:rgba(245,241,232,0.55);border-style:solid}
.ww-wall-menu button[aria-pressed="true"]{border-left:2px solid var(--ww-accent);padding-left:12px}
/* "Back to Overview" is for the phone toolbar, where Overview sits in More; wider panels keep Overview in the bar. */
.ww-back{display:none}

/* The stage is a technical plate. Only the semantic anchors carry strong geometry: the Wallmark seal, the claims, the
   conflict fracture and the readiness keystone. Facts (observations, WalletWall's rule, a missing piece) are light
   drafting marks and context (authorities, sources, subjects, the snapshot slot) is an index mark with its name; a
   light mark's ring appears only under focus, hover or selection. States are small capitals beside the piece. */
.ww-node{cursor:pointer;outline:none}
.ww-node .ww-hit{fill:transparent;stroke:none}
.ww-node-art{transition:opacity var(--ww-base) var(--ww-ease)}
.ww-node .body{fill:var(--ww-node);stroke:var(--ww-umber);stroke-width:1;transition:stroke var(--ww-base) var(--ww-ease),stroke-width var(--ww-base) var(--ww-ease)}
.ww-node:not([data-tier="anchor"]) .body{fill:none;stroke:none}
.ww-node:not([data-tier="anchor"]):not(.is-focus):not(.is-selected):hover .body{stroke:var(--ww-umber-deep)}
.ww-node .ww-glyph{fill:none;stroke:var(--ww-umber-deep);stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.ww-node .ww-draft{fill:none;stroke:var(--ww-umber-deep);stroke-width:1.1;stroke-linecap:round;pointer-events:none}
.ww-node .ww-draft-ring{fill:var(--ww-stage)}
.ww-node .ww-draft-dot{fill:var(--ww-umber-deep)}
.ww-node .ww-draft-solid{fill:var(--ww-umber);stroke:none}
.ww-node .ww-draft-open{fill:none;stroke-dasharray:2 2}
.ww-node[data-tier="context"] .ww-glyph,.ww-node[data-tier="context"] .ww-draft{opacity:0.72;transition:opacity var(--ww-base) var(--ww-ease)}
.ww-node[data-tier="context"]:hover .ww-glyph,.ww-node[data-tier="context"]:hover .ww-draft,.ww-node[data-tier="context"].is-focus .ww-glyph,.ww-node[data-tier="context"].is-focus .ww-draft{opacity:1}
.ww-node text{font-family:var(--font-ui);pointer-events:none}
/* Labels: anchors in Manrope 700, facts 600, context 500 in deep slate; every label keeps 4.5:1 on the stage. */
.ww-node .ww-label{font-size:11.5px;font-weight:700;fill:var(--ww-charcoal);paint-order:stroke;stroke:var(--ww-stage);stroke-width:3.5px;stroke-linejoin:round;transition:fill var(--ww-base) var(--ww-ease)}
.ww-node[data-tier="fact"] .ww-label{font-size:11px;font-weight:600}
.ww-node[data-tier="context"] .ww-label{font-size:11px;font-weight:500;fill:var(--ww-deep-slate)}
.ww-node[data-tier="context"]:hover .ww-label,.ww-node[data-tier="context"].is-focus .ww-label{font-weight:700;fill:var(--ww-charcoal)}
/* State annotations: drafting notation, small tracked capitals in umber (rust where the state asks for attention). */
.ww-annot{font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;fill:var(--ww-umber-deep);paint-order:stroke;stroke:var(--ww-stage);stroke-width:3px;stroke-linejoin:round;transition:opacity var(--ww-settle) var(--ww-ease)}
.ww-annot[data-attention="true"]{fill:var(--ww-brick-low)}
.ww-annot-sub{font-size:8.5px;font-weight:600}
.ww-annot-key{font-size:8.5px;font-weight:500;fill:var(--ww-deep-slate)}
.ww-node.is-resolving .ww-annot{opacity:0}
/* The Wallmark: a terracotta seal. A fine stone line inside the disc stamps it; a state ring takes its place. */
.ww-node[data-type="wallmark"] .body{fill:var(--ww-accent);stroke:var(--ww-brick-low);stroke-width:1.2}
.ww-node[data-type="wallmark"] .ww-glyph{stroke:var(--ww-stone)}
.ww-node .ww-seal{fill:none;stroke:var(--ww-stone);stroke-width:0.8;stroke-opacity:0.75}
.ww-node[data-state="STALE"] .ww-seal,.ww-node[data-state="CONFLICTING"] .ww-seal{display:none}
/* The conflict: an event, not a token. A rust ring broken at both sides and a terracotta seam split across it. */
.ww-node[data-type="conflict"] .body{fill:none;stroke:var(--ww-brick-low);stroke-width:1.8;stroke-dasharray:44 6;stroke-dashoffset:-3;animation:ww-breathe 2.4s ease-in-out infinite}
.ww-node .ww-seam{fill:none;stroke:var(--ww-accent-dark);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.ww-node[data-type="readiness"] .body{fill:var(--ww-charcoal);stroke:var(--ww-charcoal);stroke-width:1.5;transition:transform var(--ww-settle) var(--ww-ease);transform-box:fill-box}
.ww-node[data-type="readiness"] .ww-key-text{font-size:9px;font-weight:700;letter-spacing:0.18em;fill:var(--ww-stone)}
.ww-node[data-type="readiness"] .seat{stroke:var(--ww-charcoal);stroke-width:2}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .body{transform:translateY(-5px)}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .seat{stroke-dasharray:5 4;stroke:var(--ww-brick-low)}
/* States: ring, line, fill and words together, never colour alone. */
/* ESTABLISHED: a firmer, deeper ring. SUPPORTED keeps the lighter default ring: a quieter stamp. */
.ww-node[data-state="ESTABLISHED"]:not([data-type="readiness"]) .body{stroke:var(--ww-umber-deep);stroke-width:1.2}
.ww-node[data-type="wallmark"][data-state="ESTABLISHED"] .body{stroke:var(--ww-brick-low)}
.ww-node .half{fill:var(--ww-stone-low)}
.ww-node .ww-ring{fill:none}
/* CONFLICTING: the piece's own ring in rust and one fractured rust ring close outside it, breathing in opacity only. */
.ww-node .ww-ring-conflict{stroke:var(--ww-brick-low);stroke-width:1.1;stroke-dasharray:5 2;animation:ww-breathe 2.4s ease-in-out infinite}
.ww-node[data-state="CONFLICTING"] .body{stroke:var(--ww-brick-low);stroke-width:1.2}
/* STALE: a worn, receded piece inside one dotted rust ring. */
.ww-node .ww-ring-stale{stroke:var(--ww-brick-low);stroke-width:1;stroke-dasharray:0.1 2.6;stroke-linecap:round}
.ww-node[data-state="STALE"]:not([data-type="readiness"]):not(.is-selected):not(.is-focus) .ww-node-art{opacity:0.66;animation:ww-recede 5.5s ease-in-out infinite}
/* Selected or focused, a stale piece recedes its face only, so its selection ring keeps full contrast. */
.ww-node[data-state="STALE"].is-selected:not([data-type="readiness"]) .body,.ww-node[data-state="STALE"].is-focus:not([data-type="readiness"]) .body{fill-opacity:0.6}
.ww-node[data-state="STALE"].is-selected:not([data-type="readiness"]) .ww-glyph,.ww-node[data-state="STALE"].is-focus:not([data-type="readiness"]) .ww-glyph{opacity:0.6;animation:ww-recede 5.5s ease-in-out infinite}
.ww-node[data-type="readiness"][data-state="STALE"] .body,.ww-node[data-type="readiness"][data-state="CONFLICTING"] .body{stroke:var(--ww-brick-low);stroke-width:1.8;stroke-dasharray:5 3}
.ww-node[data-state="SUPERSEDED"] .ww-node-art{opacity:0.5}
.ww-node .ghost{fill:none;stroke:var(--ww-umber-deep);stroke-width:1;stroke-dasharray:1.5 3}
.ww-node[data-state="UNKNOWN"] .body,.ww-node[data-state="NOT_ESTABLISHED"] .body,.ww-node[data-state="NONE"] .body,.ww-node[data-state="UNRECOGNISED"] .body{fill:transparent;stroke-dasharray:4 3}
.ww-node[data-flags~="missing"] .ww-draft-ring{stroke-dasharray:2 2}
.ww-swatch .ww-ring,.ww-swatch .body{animation:none}
/* Connections: the line class says which relationships matter before any label is read. Evidence into claims and the
   rule is primary (solid umber, 1.2 units, with an arrow); leaders from sources and authorities are secondary (finer,
   about 60 %); subjects and names are references (hairline charcoal at 30 %); the snapshot reservation is construction
   (dashed, fainter still). Trace and focus lay terracotta over a line; the conflict is a broken rust seam. */
.ww-edge{fill:none;stroke:var(--ww-umber);stroke-width:1.2;transition:stroke var(--ww-base) var(--ww-ease),stroke-width var(--ww-base) var(--ww-ease),opacity var(--ww-base) var(--ww-ease),stroke-opacity var(--ww-base) var(--ww-ease)}
.ww-edge[data-line="primary"]{stroke-opacity:0.92;marker-end:url(#ww-arrow)}
.ww-edge[data-line="secondary"]{stroke-width:0.8;stroke-opacity:0.58}
.ww-edge[data-line="reference"]{stroke:var(--ww-charcoal);stroke-width:0.7;stroke-opacity:0.3}
.ww-edge[data-line="construction"]{stroke:var(--ww-charcoal);stroke-width:0.6;stroke-opacity:0.26;stroke-dasharray:3 3}
.ww-edge[data-kind="missing"]{stroke-dasharray:3 3}
.ww-edge[data-kind="supersedes"]{stroke-dasharray:1.5 3}
.ww-edge[data-kind="conflict"]{stroke:var(--ww-brick-low);stroke-width:1.6;stroke-dasharray:6 3}
.ww-edge-lip{fill:none;stroke:var(--ww-etch);stroke-width:1.2;transform:translate(0.4px,0.6px);pointer-events:none;transition:stroke-width var(--ww-base) var(--ww-ease),opacity var(--ww-base) var(--ww-ease)}
.ww-edge-lip:not([data-line="primary"]){display:none}
#ww-arrow path{fill:var(--ww-umber)}
#ww-emphasis path{fill:var(--ww-accent-dark)}
/* The dominant story, drawn from the returned states: a conflict, a stale claim, or the Wallmark-to-readiness path along
   the evaluation axis, in deep umber, the heaviest line at rest. */
.ww-wall-svg[data-focus="none"]:not([data-trace="true"]) .ww-edge[data-story="true"]:not([data-kind="conflict"]){stroke:var(--ww-umber-deep);stroke-width:1.5}
.ww-wall-svg[data-focus="none"]:not([data-trace="true"]) .ww-edge-lip[data-story="true"]{stroke-width:1.5}
/* Construction: the centrelines the plate is built on and four crop marks at its corners; under everything. */
.ww-construction{pointer-events:none}
.ww-construction[data-for="tall"],.ww-wall-svg[data-layout="portrait"] .ww-construction[data-for="wide"]{display:none}
.ww-wall-svg[data-layout="portrait"] .ww-construction[data-for="tall"]{display:inline}
.ww-axis{fill:none;stroke:var(--ww-umber);stroke-width:0.7;stroke-opacity:0.38;stroke-dasharray:16 3 2 3}
.ww-reg{fill:none;stroke:var(--ww-umber-deep);stroke-width:0.8;stroke-opacity:0.5}
/* Material response: under a pointer the ring firms up a little; nothing lifts, moves or casts a shadow. */
.ww-node[data-tier="anchor"]:hover:not(.is-selected):not(.is-focus):not([data-type="readiness"]) .body{stroke-width:1.3}
/* Selection and focus: the piece's own ring, heavier and in rust (a light mark's ring appears for it); a terracotta-dark
   trace lies on that ring and breathes in opacity, so selection adds no ring. Its direct connections stay, references
   included; everything else is muted. */
.ww-node .ww-halo{display:none;fill:none;stroke:var(--ww-accent-dark);stroke-width:2}
.ww-wall-svg[data-selection="explicit"] .ww-node.is-selected .ww-halo,.ww-node.is-focus .ww-halo{display:inline;animation:ww-halo 3.2s ease-in-out infinite}
.ww-node.is-selected .body,.ww-node.is-focus .body{stroke:var(--ww-brick-low);stroke-width:2}
/* The guide's pointer: four short radial ticks just outside the ring (on the keystone, four ticks round its frame), so
   it can never be read as the dotted ring that means STALE, and it adds no ring. */
.ww-node .ww-reticle{display:none;fill:none;stroke:var(--ww-accent-dark);stroke-width:1.5;stroke-linecap:round}
.ww-node[data-type="readiness"] .ww-reticle{stroke-dasharray:7 18;stroke-dashoffset:3.5}
.ww-node.is-pointed .ww-reticle{display:inline;animation:ww-halo 2.4s ease-in-out infinite}
.ww-node:focus-visible .ww-hit{stroke:var(--ww-accent-dark);stroke-width:2;stroke-dasharray:3 3}
.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-node-art,.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-annot{opacity:0.45;animation:none}
.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-label{fill:var(--ww-deep-slate)}
.ww-wall-svg[data-focus="pinned"] .ww-edge:not(.on-path),.ww-wall-svg[data-focus="pinned"] .ww-edge-lip:not(.on-path){opacity:0.28}
.ww-wall-svg[data-focus="preview"] .ww-node:not(.on-path) .ww-node-art{opacity:0.72}
.ww-wall-svg[data-focus="preview"] .ww-edge:not(.on-path),.ww-wall-svg[data-focus="preview"] .ww-edge-lip:not(.on-path){opacity:0.55}
.ww-wall-svg[data-focus] .ww-node.is-related .ww-node-art{opacity:0.92}
.ww-edge.on-path{stroke:var(--ww-brick-low);stroke-width:1.6;stroke-opacity:1;opacity:1;marker-end:url(#ww-emphasis)}
.ww-edge.on-path[data-kind="conflict"],.ww-edge.on-path[data-kind="reserved"]{marker-end:none}
.ww-edge-lip.on-path{stroke-width:1.6}
/* Trace: the same pieces in the same places; the provenance trace_provenance returned is drawn in terracotta, the
   heaviest line on the plate, and the rest recedes to a quarter or less. */
.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-node-art,.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-annot{opacity:0.36;animation:none}
.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-label{fill:var(--ww-deep-slate)}
.ww-wall-svg[data-trace="true"] .ww-edge:not([data-trace="true"]),.ww-wall-svg[data-trace="true"] .ww-edge-lip:not([data-trace="true"]){opacity:0.16}
.ww-wall-svg[data-trace="true"] .ww-edge[data-trace="true"]{stroke:var(--ww-accent-dark);stroke-width:2.2;stroke-opacity:1;opacity:1;marker-end:url(#ww-emphasis)}
.ww-wall-svg[data-trace="true"] .ww-edge-lip[data-trace="true"]{display:inline;stroke-width:2.2}
.ww-glint{fill:none;stroke:var(--ww-cream);stroke-width:1.4;stroke-linecap:round;stroke-dasharray:1 11;opacity:0;pointer-events:none}
.ww-wall-svg[data-trace="true"] .ww-glint{animation:ww-shimmer 2.4s ease-in-out infinite}
.ww-glint[data-step="1"]{animation-delay:0.4s}.ww-glint[data-step="2"]{animation-delay:0.8s}.ww-glint[data-step="3"]{animation-delay:1.2s}.ww-glint[data-step="4"]{animation-delay:1.6s}.ww-glint[data-step="5"]{animation-delay:2s}
.ww-wall-svg[data-trace="true"] .ww-node[data-trace="true"] .ww-node-art{opacity:1}
@keyframes ww-breathe{0%,100%{opacity:0.55}50%{opacity:1}}
@keyframes ww-halo{0%,100%{opacity:0.45}50%{opacity:1}}
@keyframes ww-recede{0%,100%{opacity:0.66}50%{opacity:0.5}}
@keyframes ww-shimmer{0%,100%{opacity:0}35%{opacity:0.85}}
@keyframes ww-idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}

/* Tooltip: one at a time, never the only place a fact lives. */
.ww-tip{position:absolute;z-index:9;max-width:220px;padding:5px 9px;background:var(--ww-charcoal);color:var(--ww-cream);font:600 12px/1.3 var(--font-ui);border-radius:var(--ww-radius-panel);pointer-events:none}
.ww-tip[hidden]{display:none}

/* WalletWallaby: on the stage beside the controls, pointing at the piece it explains; never over a piece. */
.ww-wallaby{display:flex;align-items:center;gap:8px;max-width:min(540px,100%);transition:opacity var(--ww-settle) var(--ww-ease),transform var(--ww-settle) var(--ww-ease)}
.ww-wallaby[hidden]{display:none}
.ww-wallaby[data-peek="out"]{opacity:0;transform:translateY(-4px)}
.ww-wallaby[data-peek="in"]{opacity:1;transform:none}
.ww-wallaby-art{flex:0 0 auto;width:40px;height:40px;background-size:contain;background-repeat:no-repeat;background-position:bottom center;animation:ww-idle 4.8s ease-in-out infinite}
/* The cue is printed on the stage beside the guide behind one umber hairline: not a bubble or a card. */
.ww-wallaby-bubble{font-size:12.5px;line-height:1.35;color:var(--ww-charcoal);min-width:0;padding-left:10px;border-left:1px solid var(--ww-cut-strong)}
.ww-wallaby-bubble p{margin:0}
.ww-wallaby-bubble .ww-eyebrow{color:var(--ww-brick-low)}

/* State chips: one component, a stamped tag. A flat parchment label, a 1 px umber edge, a 2 px corner; attention is a
   dashed rust edge and rust words. */
.chip{display:inline-block;padding:1px 7px;line-height:16px;border:1px solid var(--ww-umber);border-radius:var(--ww-radius-badge);font-size:11px;font-weight:700;letter-spacing:0.04em;width:fit-content;background:var(--ww-label);color:var(--ww-charcoal);font-family:var(--font-ui);white-space:nowrap}
.chip[data-attention="true"]{border-color:var(--ww-brick-low);border-style:dashed;color:var(--ww-brick-low)}
/* Detail rail: flat tan parchment with an umber hairline seam; its head in terracotta: what is in focus and whether it
   is the selected assertion; folded sections on a slightly deeper row fill. */
.ww-detail{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;min-width:0;padding:0 0 10px;background:var(--ww-rail);border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
.ww-sheet-bar,.ww-sheet-actions{display:none}
.ww-sheet-summary{display:block;margin:0;padding:12px 14px 10px;background:var(--ww-accent-dark);color:var(--ww-on-dark)}
.ww-sheet-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;font:600 16px/1.3 var(--font-display)}
.ww-sheet-title>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ww-sheet-summary .chip{background:var(--ww-label);color:var(--ww-charcoal);border-color:var(--ww-brick-low);flex:0 0 auto}
.ww-sheet-summary .chip[data-attention="true"]{color:var(--ww-brick-low);border-color:var(--ww-brick-low)}
.ww-sheet-meaning{margin:3px 0 0;font-size:12.5px;color:var(--ww-on-dark)}
.ww-focus-kind{margin:6px 0 0;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-on-dark-muted)}
.ww-focus-kind code{font-size:11px;color:var(--ww-on-dark);text-transform:none;letter-spacing:0;white-space:nowrap;word-break:normal;overflow-wrap:normal}
.ww-detail section,.ww-detail .ww-more{padding:0 14px}
.ww-detail .ww-more section{padding:0}
.ww-detail h2{font-size:14px;margin:8px 0 6px}
[data-assertion-detail]:not([hidden]){display:block}
.states{margin:0}.states>div{display:grid;grid-template-columns:104px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid var(--ww-cut)}
.states dt{color:var(--ww-muted-text);font-size:12px;font-weight:700}.states dd{margin:0;min-width:0}
.ww-why{display:inline-block;margin-left:6px;font-size:12px}
.ww-why summary{display:inline;cursor:pointer;color:var(--ww-brick-low);font-weight:700}
.ww-why[open]{display:block;margin:4px 0 0}
.ww-why p{margin:4px 0 0}
.ww-more{border-top:1px solid var(--ww-cut)}
.ww-more>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;cursor:pointer;font-weight:700;font-size:12.5px;color:var(--ww-charcoal);list-style:none}
.ww-more>summary::-webkit-details-marker{display:none}
.ww-more>summary::after{content:"+";flex:0 0 auto;font-weight:500;font-size:15px;line-height:1;color:var(--ww-umber)}
.ww-more[open]>summary::after{content:"−"}
/* The folded sections' headers are rows of the rail itself: the same flat surface, one hairline between them, a quiet
   plus or minus; no second fill, so the rail reads as one printed sheet, not stacked tabs. */
.ww-more[open]>summary{color:var(--ww-brick-low)}
.kv{margin:0;display:grid;gap:2px}.kv>div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px}.kv dt{color:var(--ww-muted-text)}.kv dd{margin:0;min-width:0}
.addr{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;max-width:100%}
.addr-full{user-select:all;-webkit-user-select:all}
/* Copy appears on hover or keyboard focus without moving anything; on touch it is always there. */
button.copy{font-size:11px;padding:0 8px;min-height:26px;min-width:4.4em;border:1px solid var(--ww-umber);border-radius:var(--ww-radius-badge);background:var(--ww-label);color:var(--ww-umber-deep);cursor:pointer;font-weight:700;opacity:0;transition:opacity var(--ww-fast) var(--ww-ease)}
.addr:hover button.copy,.addr:focus-within button.copy,button.copy[data-copied="true"]{opacity:1}
button.copy[data-copied="true"]{border-color:var(--ww-accent-dark);color:var(--ww-accent-dark)}
@media (hover:none){button.copy{opacity:1;min-height:36px}}
button.link{background:none;border:0;padding:0;color:var(--ww-brick-low);text-decoration:underline;cursor:pointer;text-align:left}
.copy-status{position:fixed;left:18px;bottom:12px;margin:0;padding:4px 8px;font-size:12px;border-radius:var(--ww-radius-badge);background:var(--ww-charcoal);color:var(--ww-cream);z-index:5}
.copy-status:empty{display:none}
.two{display:grid;grid-template-columns:1fr;gap:8px}
.limits{margin:0;padding-left:18px}.limits li{margin:2px 0}
.ww-why-path{list-style:none;margin:6px 0;padding:0 0 0 12px;border-left:2px solid var(--ww-umber)}
.ww-why-path li{position:relative;padding:3px 0}
.ww-why-path li::before{content:"";position:absolute;left:-17px;top:10px;width:8px;height:8px;border-radius:50%;background:var(--ww-label);border:1.5px solid var(--ww-umber-deep)}
.ww-why-step{display:block;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-umber-deep)}
.ww-why-target{background:rgba(191,78,50,0.12);outline:1px solid var(--ww-accent-dark)}
.ww-why-button{min-height:34px;padding:0 12px;border:0;border-radius:var(--ww-radius-panel);background:var(--ww-charcoal);color:var(--ww-cream);font-weight:700;cursor:pointer}
.ww-table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--ww-cut);padding:6px 8px;text-align:left;vertical-align:top}

/* Wallprint: a flat deep-slate band under The Wall, one compact item per facet, each leading to its piece. Its items
   are divided by 1 px seams like courses of a wall; the band keeps the composition's dark weight. */
.ww-wallprint{display:flex;align-items:center;gap:6px 14px;padding:6px 10px 6px 14px;background:var(--ww-deep-slate);color:var(--ww-on-dark);border-radius:var(--ww-radius-panel)}
.ww-wallprint>h2{flex:0 0 auto;margin:0;font:600 14px/1.2 var(--font-display);letter-spacing:-0.01em;color:var(--ww-stone)}
.ww-courses{flex:1 1 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));list-style:none;margin:0;padding:0;min-width:0}
.ww-brick{min-width:0;border-left:1px solid var(--ww-cut-dark)}
.ww-brick-key{display:flex;flex-direction:column;justify-content:center;gap:3px;width:100%;min-height:52px;padding:5px 10px;background:none;border:0;color:inherit;text-align:left;font:inherit;font-size:12.5px}
button.ww-brick-key{cursor:pointer;transition:background var(--ww-fast) var(--ww-ease)}
button.ww-brick-key:hover{background:rgba(245,241,232,0.06)}
.ww-wallprint .ww-eyebrow{color:var(--ww-stone)}
.ww-brick-value{display:flex;flex-wrap:wrap;align-items:center;gap:3px 6px;min-width:0}
.ww-wallprint .muted{color:var(--ww-on-dark-muted)}
.ww-wallprint code{color:var(--ww-on-dark)}
.ww-brick[data-attention="true"] .ww-eyebrow{color:var(--ww-cream)}

/* Readiness: the keystone and its criteria as a checklist. */
.ww-assembly,.ww-criteria{padding:10px 14px;background:var(--ww-rail);border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
.ww-arch{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:16px;align-items:start}
.ww-keystone{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 30px 14px;background:var(--ww-charcoal);color:var(--ww-cream);clip-path:polygon(0 0,100% 0,86% 100%,14% 100%);text-align:center;transition:transform var(--ww-settle) var(--ww-ease)}
.ww-keystone .ww-eyebrow{color:var(--ww-stone)}
.ww-keystone .small{color:var(--ww-on-dark-muted)}
.ww-arch[data-fit="false"] .ww-keystone{transform:translateY(-6px)}
.ww-course{list-style:none;margin:0;padding:0}
.ww-course-empty{min-height:40px;border-bottom:1px dashed var(--ww-brick-low)}
.ww-piece{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 4px;border-bottom:1px solid var(--ww-cut)}
.ww-piece::before{content:"✓";flex:0 0 18px;font-weight:700;text-align:center}
.ww-piece[data-outcome="NOT_MET"]::before,.ww-piece[data-outcome="INDETERMINATE"]::before{content:"!";color:var(--ww-brick-low)}
.ww-piece[data-outcome="UNRECOGNISED"]::before{content:"?"}
.ww-piece[data-outcome="NOT_MET"],.ww-piece[data-outcome="INDETERMINATE"],.ww-piece[data-outcome="UNRECOGNISED"]{border-left:2px dashed var(--ww-brick-low)}
.ww-piece-id{font:500 10px var(--font-mono);color:var(--ww-muted-text)}
.ww-piece-name{flex:1 1 auto;min-width:0;font-weight:700}
.ww-piece-fit{font-size:11px;color:var(--ww-muted-text)}
.ww-piece-reason{font-size:10.5px}
.ww-piece .chip{flex:0 0 auto}
.ww-course[data-focus-node]{cursor:pointer}
.ww-assembly-show{margin:6px 0 0}
.ww-criteria h3{margin-top:10px}

/* The list: another lens on the same pieces, on the stage's own surface. */
.ww-list{padding:10px 14px;background:var(--ww-stage);border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
.ww-list>h2{margin-top:2px}
.ww-list .muted{color:var(--ww-deep-slate)}
.ww-search{display:block;width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-panel);background:var(--ww-node);color:var(--ww-ink);font:inherit}
.ww-search::placeholder{color:var(--ww-umber-deep);opacity:0.9}
.ww-filters{display:flex;gap:6px;overflow-x:auto;padding:8px 0;scrollbar-width:none}
.ww-filters button{flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-badge);background:transparent;color:var(--ww-charcoal);font:700 12.5px var(--font-ui);cursor:pointer}
.ww-filters button[aria-pressed="true"]{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}
.ww-list-rows{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));column-gap:18px}
.ww-list-rows li[hidden]{display:none}
.ww-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name meta" "sub sub";align-items:center;gap:2px 10px;width:100%;min-height:54px;padding:7px 6px;border:0;border-bottom:1px solid var(--ww-cut);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background var(--ww-fast) var(--ww-ease)}
.ww-list-row:hover{background:rgba(221,203,168,0.45)}
.ww-list-row[aria-current="true"]{border-left:2px solid var(--ww-brick-low);padding-left:4px}
.ww-list-name{grid-area:name;font-weight:700;min-width:0}
.ww-list-meta{grid-area:meta;display:flex;align-items:center;gap:4px}
.ww-list-sub{grid-area:sub;min-width:0}
.ww-list .ww-type-chip{background:transparent;border-color:var(--ww-cut-strong);font-weight:600}

/* Legend, receipt and the text version: below everything, folded. */
.ww-legend{font-size:12px}
.ww-legend summary,.ww-text-version summary{display:flex;align-items:center;min-height:40px;cursor:pointer;font-weight:700}
.ww-legend-list{list-style:none;padding:0;margin:6px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 12px}
.ww-legend-list li{display:flex;align-items:center;gap:8px}
.ww-swatch{width:40px;height:24px;flex:0 0 auto}
.ww-swatch .ww-node .body{fill:var(--ww-node)}
.ww-receipt{border-top:1px solid var(--ww-cut)}
.ww-receipt>h2{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-receipt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ww-receipt-row-text{display:flex;flex-direction:column}
.ww-receipt-body{display:none}
.ww-receipt[data-open="true"] .ww-receipt-body{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;padding-bottom:8px}
.ww-receipt-body>div{flex:1 1 260px}
.ww-qr-slot{flex:0 0 auto;width:96px;height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--ww-cut-strong);color:var(--ww-umber-deep);font:700 12px var(--font-ui);letter-spacing:0.16em;text-transform:uppercase}
.ww-actions{display:flex;flex-wrap:wrap}
.ww-actions button{min-height:32px;padding:4px 12px;border:1px solid var(--ww-cut-strong);margin-right:-1px;background:transparent;font-size:12.5px;font-weight:600}
.ww-explain{display:none}
.ww-why-more{display:block;margin:0 0 6px;font-size:12px}
.ww-why-more summary{display:inline-flex;align-items:center;min-height:32px;color:var(--ww-brick-low);font-weight:700;cursor:pointer}
.ww-why-more p{margin:2px 0 6px}

/* Tablet (768 to 1023 px): The Wall about two thirds, the detail rail beside it, Wallprint and readiness beneath. */
@media (min-width:768px) and (max-width:1023px){
.ww-stage{grid-template-columns:minmax(0,2fr) minmax(240px,1fr)}
}
/* A phone or small tablet on its side: the wide layout, and the detail rail takes about 40 % on the right. */
@media (min-width:768px) and (max-width:1023px) and (orientation:landscape) and (max-height:600px){
.ww-stage{grid-template-columns:minmax(0,3fr) minmax(220px,2fr)}
}

/* Below 1024 px (phones, tablets, phones on their side): the critical state strip joins the header, and the guide sits
   under The Wall instead of beside the controls. */
@media (max-width:1023px){
.ww-summary{flex-direction:column;align-items:stretch;gap:4px;padding:6px 10px 8px}
.ww-rail{flex-wrap:nowrap;gap:10px;min-height:44px;position:relative}
.ww-mark{width:30px;height:30px}
.ww-rail-asset{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ww-strip{display:flex;flex-wrap:nowrap;gap:2px 10px;list-style:none;margin:0;padding:0;min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none}
.ww-strip>li{flex:0 0 auto}
.ww-strip-item{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 8px 0 0;border:0;background:none;color:var(--ww-on-dark);font:inherit;line-height:1.2;text-align:left}
button.ww-strip-item{cursor:pointer}
.ww-strip-key{font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-stone)}
.ww-strip .chip{font-size:11.5px}
.ww-wall{grid-template-columns:minmax(0,1fr);grid-template-areas:"head" "guide" "view"}
.ww-guide-slot{justify-content:flex-start;padding:6px 12px 0}
}
/* Very short screens (a phone on its side): The Wall gets the height; the state strip is left to the sheet and Wallprint. */
@media (max-width:1023px) and (orientation:landscape) and (max-height:500px){
.ww-strip{display:none}
}

/* Phone (up to 767 px): a focused instrument. Header and state, The Wall, then a detail sheet; the rest below. */
@media (max-width:767px){
body{padding:8px 12px calc(var(--ww-peek) + 24px)}
/* The wordmark stays on a phone; the lens badge waits in About this panel. */
.ww-lens-badge{display:none}
/* The plate simplifies on a phone: no crop marks; the centrelines stay. */
.ww-reg{display:none}
/* The state strip scrolls sideways when it does not fit; the fade at its edge says there is more. */
.ww-strip{-webkit-mask-image:linear-gradient(90deg,#000 86%,transparent);mask-image:linear-gradient(90deg,#000 86%,transparent);padding-right:24px}
button:not(:disabled):active,.ww-strip-item:active{opacity:0.88}
h2{font-size:14px;margin:4px 0 6px}
.ww-section{margin-top:12px}
.ww-flow>.ww-stage{order:1}.ww-flow>.ww-wallprint{order:2}.ww-flow>.ww-assembly{order:3}.ww-flow>.ww-list{order:4}.ww-flow>.ww-criteria{order:6}.ww-flow>.ww-receipt{order:9}
.ww-flow>.ww-claims,.ww-flow>.ww-text-version{display:none}
.ww-stage{display:block;margin-top:10px}
.ww-section-head{justify-content:space-between;padding:6px 6px 0 10px;min-height:52px}
.ww-wall-view{padding:0 4px 4px}
/* The guide docks under The Wall on a phone, so The Wall keeps the height and the guide covers nothing. */
.ww-wall{grid-template-areas:"head" "view" "guide"}
.ww-guide-slot{padding:2px 12px 10px}
/* One compact control group on the stage's top edge, so it never sits on a piece: zoom in, Fit, More. */
.ww-wall-tools>.ww-modes,.ww-wall-tools>[data-guide-toggle]{display:none}
.ww-wall-tools>.ww-tool-in{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--ww-radius-panel) 0 0 var(--ww-radius-panel)}
.ww-wall-tools>button{min-width:44px;min-height:44px;padding:0 12px}
.ww-wall-tools>.ww-icon-button{min-height:44px}
.ww-wall-menu:not([hidden]){left:auto;right:0;top:50px}
.ww-wall-menu button{min-height:44px}
#app[data-mode="trace"] .ww-back{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:0;border-radius:var(--ww-radius-panel);background:var(--ww-accent-dark);color:var(--ww-cream);font:600 12.5px var(--font-ui);white-space:nowrap;cursor:pointer}
/* The detail rail becomes a bottom sheet: peek, half, full. Only the sheet stays on screen while scrolling. */
.ww-detail{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:7;margin:0;height:var(--ww-peek);max-height:none;overflow:hidden;border-radius:0;background:var(--ww-rail);border:0;padding:0 0 calc(env(safe-area-inset-bottom,0px) + 10px);transition:height var(--ww-settle) var(--ww-ease)}
.ww-detail[data-sheet="half"]{height:54vh;overflow-y:auto;overscroll-behavior:contain}
.ww-detail[data-sheet="full"]{height:calc(100vh - 16px);height:calc(100dvh - 16px);overflow-y:auto;overscroll-behavior:contain}
.ww-sheet-bar{display:flow-root;position:sticky;top:0;z-index:1;background:var(--ww-accent-dark);touch-action:none}
.ww-detail[data-sheet="peek"]{touch-action:none}
/* The grip draws a 24 px bar but takes 44 px of touch: the extra 20 px reach invisibly over the summary below it. */
.ww-sheet-grip{position:relative;display:flex;align-items:flex-start;justify-content:center;width:100%;min-height:44px;margin-bottom:-20px;padding:12px 0 0;border:0;background:transparent;color:var(--ww-cream);cursor:pointer}
.ww-sheet-grip span{display:block;width:40px;height:4px;border-radius:2px;background:var(--ww-on-dark-muted)}
.ww-sheet-summary{padding:2px 14px 10px;cursor:pointer}
.ww-sheet-meaning{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ww-sheet-actions{display:flex;gap:6px;position:sticky;bottom:calc(-10px - env(safe-area-inset-bottom,0px));margin:8px 0 0;padding:8px 14px 10px;background:var(--ww-rail);border-top:1px solid var(--ww-cut)}
.ww-sheet-actions button{flex:1 1 0;min-height:44px;padding:0 8px;border:0;border-radius:var(--ww-radius-panel);background:var(--ww-charcoal);color:var(--ww-cream);font:600 13px var(--font-ui);cursor:pointer}
.ww-detail[data-sheet="peek"] .ww-sheet-actions{display:none}
.ww-detail[data-sheet="peek"] [data-assertion-detail]>:not(.ww-sheet-summary),.ww-detail[data-sheet="peek"] .ww-node-detail>:not(.ww-sheet-summary){display:none}
.ww-detail[data-sheet="peek"] .ww-focus-kind{display:none}
.ww-detail button.copy{min-height:36px;padding:0 12px}
.copy-status{left:12px;bottom:calc(var(--ww-peek) + 10px)}
.ww-more>summary{min-height:44px}
/* Wallprint: a two-column summary of the facets; each tile leads to its piece. */
.ww-wallprint{display:block;padding:8px 6px}
.ww-wallprint>h2{padding:2px 8px 4px}
.ww-courses{grid-template-columns:1fr 1fr}
.ww-brick{border-left:0;border-top:1px solid var(--ww-cut-dark)}
.ww-brick-key{min-height:48px}
/* Readiness: a compact checklist under a small keystone. */
.ww-arch{grid-template-columns:1fr;gap:8px}
.ww-keystone{justify-self:center;padding:6px 30px 10px}
.ww-keystone .small{display:none}
.ww-piece-id,.ww-piece-fit,.ww-piece-reason{display:none}
.ww-piece .chip,.ww-strip .chip,.ww-sheet-title .chip,.ww-list-meta .chip{white-space:nowrap;overflow-wrap:normal;flex:0 0 auto}
/* Criteria table: stacked rows, never a squeezed table. */
.ww-criteria table,.ww-criteria tbody,.ww-criteria tr,.ww-criteria th,.ww-criteria td{display:block}
.ww-criteria thead{display:none}
.ww-criteria tr{padding:6px 0;border-bottom:1px solid var(--ww-cut)}
.ww-criteria th,.ww-criteria td{border:0;padding:1px 0}
.ww-criteria td[data-label]::before{content:attr(data-label) ": ";font-size:11px;font-weight:700;color:var(--ww-muted-text)}
/* List mode: search, filter chips (one scrolling row), rows. */
.ww-list{display:block}
.ww-search{min-height:44px}
.ww-filters button{min-height:44px}
.ww-list-rows{grid-template-columns:1fr}
.ww-list-row{min-height:52px}
/* Receipt: one compact row. No QR placeholder, no large disabled panel. */
.ww-receipt-row{min-height:52px}
.ww-qr-slot{display:none}
/* Text density: explanations fold behind "Why?". */
.ww-explain{display:none}
.ww-why-more{display:block;margin:0 0 6px;font-size:12px}
.ww-why-more summary{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:var(--ww-brick-low);font-weight:700;cursor:pointer}
.kv>div,.states>div{grid-template-columns:1fr}
}
/* A phone on its side: the wide Wall, and the detail sheet becomes a right-hand panel of about 40 %. */
@media (max-width:767px) and (orientation:landscape) and (max-height:500px){
body{padding-right:calc(40vw + 12px);padding-bottom:24px}
.ww-detail,.ww-detail[data-sheet]{top:0;left:auto;width:40vw;height:100vh;height:100dvh;overflow-y:auto;border:0;border-left:1px solid var(--ww-seam)}
.ww-detail[data-sheet="peek"] [data-assertion-detail]>:not(.ww-sheet-summary),.ww-detail[data-sheet="peek"] .ww-node-detail>:not(.ww-sheet-summary){display:revert}
.ww-sheet-grip{display:none}
.ww-detail[data-sheet="peek"] .ww-sheet-actions{display:flex}
.copy-status{bottom:10px;right:calc(40vw + 12px)}
}

/* Reduced motion: from the system setting or the panel's own toggle. Nothing animates; meaning is unchanged. */
#app[data-motion="reduced"] *,#app[data-motion="reduced"]~.ww-wallaby,#app[data-motion="reduced"]~.ww-wallaby *{transition:none!important;animation:none!important}
/* Touch at any width (a tablet included): every essential control takes at least 44 x 44 CSS px. Inline "Why?" toggles
   grow their touch area with padding that a matching negative margin takes back, so no text moves. */
@media (pointer:coarse){
.ww-wall-tools>button,.ww-wall-tools>.ww-icon-button,.ww-modes button,.ww-wall-menu button,.ww-back{min-height:44px}
.ww-wall-tools>button,.ww-modes button{min-width:44px}
.ww-more>summary,.ww-legend summary,.ww-text-version summary{min-height:44px}
.ww-why summary{padding:14px 12px;margin:0 -12px}
.ww-why-more summary{min-height:44px;min-width:44px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
