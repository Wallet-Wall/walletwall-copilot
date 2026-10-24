// The WalletWall canvas stylesheet. Colours are the WalletWall brand tokens (canvas/brand/brand-sources.json and the
// Coinstellation's --ww-brick-low), or a named mix of them; there is no neon, purple or generic green.
// Surfaces, lightest to deepest: the detail rail (cream), the workspace (warm stone), The Wall's stage (warm stone
// deepened with stone-low and deep slate), the Wallprint band and header (deep slate, charcoal). Terracotta is focus.
// Motion follows the app's tokens: 140 to 280 ms transitions, decisive ease-out, no bounce. The loops (conflict ring,
// selection halo, stale recession, trace shimmer, the guide's idle) animate transform and opacity only, and stop under
// reduced motion; every state they accompany is also drawn statically.

export const CSS = `
:root{color-scheme:light;
--ww-bg:#F2ECDF;--ww-surface:#F8F2E4;--ww-card-bg:rgba(248,242,228,0.82);--ww-card-border:rgba(139,49,32,0.16);--ww-inner-border:rgba(30,26,20,0.1);
--ww-ink:rgba(30,26,20,0.9);--ww-muted-text:rgba(30,26,20,0.7);--ww-accent:#BF4E32;--ww-accent-dark:#8B3120;--ww-brick-low:#76281D;--ww-tan:#C9A47A;
--ww-charcoal:#2B2B2E;--ww-deep-slate:#3A3D41;--ww-warm-stone:#D8D3C8;--ww-cream:#F5F1E8;--ww-charcoal-border:rgba(43,43,46,0.3);--ww-charcoal-rail:rgba(43,43,46,0.72);
--ww-stone:#e9d3ad;--ww-stone-low:#b99568;--ww-mortar:#f5ead4;--ww-brick:#b94a31;--ww-radius-panel:4px;--ww-radius-badge:2px;
--ww-page:var(--ww-warm-stone);--ww-stage:#BBB0A0;--ww-rail:var(--ww-cream);--ww-node:var(--ww-cream);--ww-node-quiet:#E6E2D8;--ww-on-dark:var(--ww-cream);--ww-on-dark-muted:rgba(245,241,232,0.8);
--ww-focus:0 0 0 3px rgba(191,78,50,0.22);
--font-display:"Sora Variable","Sora",system-ui,sans-serif;--font-ui:"Manrope Variable","Manrope",system-ui,sans-serif;--font-mono:"IBM Plex Mono","SFMono-Regular",Consolas,monospace;
--ww-fast:140ms;--ww-base:180ms;--ww-settle:280ms;--ww-ease:cubic-bezier(0.22,1,0.36,1);--ww-peek:84px}
*{box-sizing:border-box;scrollbar-width:thin}
/* Scrollbars: narrow and quiet. Cream track, deep-slate thumb, terracotta while engaged. Scrolling itself is unchanged. */
html{scrollbar-color:var(--ww-deep-slate) var(--ww-cream)}
.ww-detail:hover,.ww-table-wrap:hover{scrollbar-color:var(--ww-accent) var(--ww-cream)}
::-webkit-scrollbar{width:8px;height:8px;background:var(--ww-cream)}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:var(--ww-cream)}
::-webkit-scrollbar-thumb{background:var(--ww-deep-slate);border:2px solid var(--ww-cream);border-radius:0}
::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{background:var(--ww-accent)}
body{margin:0;padding:12px 16px 32px;background:var(--ww-page);color:var(--ww-ink);font:14px/1.5 var(--font-ui);font-weight:500;overflow-wrap:anywhere}
h1,h2{font-family:var(--font-display);font-weight:600;letter-spacing:-0.01em}
h1{font-size:18px;line-height:1.2;margin:0}
h2{font-size:15px;margin:14px 0 8px}
h3{font-size:12px;margin:12px 0 4px;color:var(--ww-muted-text);font-weight:700;text-transform:uppercase;letter-spacing:0.08em}
code{font-family:var(--font-mono);font-size:12px;font-weight:400;word-break:break-all}
.muted{color:var(--ww-muted-text)}.small{font-size:12px}
.ww-sr,.ww-zoom-level{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-eyebrow{display:block;margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-brick-low)}
.note{padding:8px 10px;border-left:3px solid var(--ww-charcoal);background:var(--ww-cream);margin:8px 0}
.note[data-attention="true"]{border-left-color:var(--ww-brick-low);border-left-style:dashed}
.meta{font-size:12px;color:var(--ww-muted-text);margin:6px 0}
button{font:inherit}
button:focus-visible,.ww-node:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ww-accent-dark);outline-offset:2px;box-shadow:var(--ww-focus)}
.ww-node:focus-visible{outline:none}

/* Summary header: the charcoal anchor. Mark, name, the asset as presented and its chain ID. */
.ww-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding:6px 14px;background:var(--ww-charcoal);color:var(--ww-on-dark);border-bottom:3px solid var(--ww-accent);border-radius:var(--ww-radius-panel)}
.ww-rail{display:flex;align-items:center;gap:12px;min-height:40px;min-width:0}
.ww-mark{flex:0 0 auto;width:34px;height:34px;background-size:contain;background-repeat:no-repeat;background-position:center}
.ww-rail-name{display:flex;align-items:center;gap:8px}
.ww-rail-name h1{color:var(--ww-on-dark)}
.ww-lens-badge{font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:1px 6px;border:1px solid var(--ww-on-dark-muted);border-radius:var(--ww-radius-badge);color:var(--ww-on-dark)}
.ww-rail-asset{display:flex;align-items:baseline;gap:6px;margin:0;min-width:0;white-space:nowrap}
.ww-rail-symbol{font:600 17px/1.2 var(--font-display)}
.ww-rail-sep,.ww-rail-chain{color:var(--ww-on-dark-muted)}
.ww-rail-chain{font-size:13px}
.ww-strip{display:none}
.ww-strip .chip,.ww-summary .chip{background:var(--ww-cream);color:var(--ww-charcoal);border-color:transparent}

/* About this panel: the boundary, versions, lenses not live yet and invariant violations, one step away. */
.ww-panel-info{display:none}
#app[data-panel-open="true"] .ww-panel-info{display:block;margin-top:12px;padding:10px 14px;background:var(--ww-rail);border-top:3px solid var(--ww-charcoal);border-radius:var(--ww-radius-panel)}
.ww-boundary{font-size:12.5px;margin-top:0}
.ww-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:8px 0 4px}
.ww-lens{display:flex;flex-wrap:wrap}
.ww-lens button{min-height:32px;padding:4px 12px;border:1px solid var(--ww-charcoal-border);margin-right:-1px;background:transparent;color:var(--ww-ink);font-size:12.5px;font-weight:600}
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

/* The Wall's stage: a deeper warm surface with a grid that is felt, not read. */
.ww-wall{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"head guide" "view view";align-items:center;min-width:0;background-color:var(--ww-stage);background-image:linear-gradient(rgba(43,43,46,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(43,43,46,0.07) 1px,transparent 1px);background-size:28px 28px;border-radius:var(--ww-radius-panel)}
.ww-section-head{grid-area:head;display:flex;align-items:center;gap:10px;padding:8px 12px 0;min-width:0}
.ww-section-head h2{margin:0;font:700 10.5px var(--font-ui);letter-spacing:0.16em;text-transform:uppercase;white-space:nowrap;color:var(--ww-charcoal)}
.ww-guide-slot{grid-area:guide;display:flex;justify-content:flex-end;min-width:0;padding:10px 14px 2px}
.ww-wall-view{grid-area:view;min-width:0;padding:0 8px 4px}
.ww-wall-svg{display:block;width:100%;height:auto;margin:0 auto;user-select:none;-webkit-user-select:none;touch-action:pan-y}
.ww-wall-svg:not([data-zoom="1"]){cursor:grab;touch-action:none}
.ww-wall-svg.is-panning{cursor:grabbing}
.ww-wall-svg .ww-node{touch-action:none}

/* The one control group: a charcoal bar. Overview and Trace, Fit, the guide, More. */
.ww-wall-tools{position:relative;display:flex;align-items:center;flex-wrap:nowrap}
.ww-modes{display:flex}
.ww-wall-tools>button,.ww-modes button{min-height:34px;padding:0 12px;border:0;border-right:1px solid rgba(245,241,232,0.16);background:var(--ww-charcoal);color:var(--ww-cream);font:600 12.5px var(--font-ui);cursor:pointer;white-space:nowrap;transition:background var(--ww-fast) var(--ww-ease)}
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
.ww-wall-menu:not([hidden]){display:flex;flex-direction:column;position:absolute;top:calc(100% + 6px);left:0;z-index:8;min-width:220px;background:var(--ww-charcoal);border-radius:var(--ww-radius-panel);box-shadow:0 10px 24px rgba(30,26,20,0.28);overflow:hidden}
.ww-wall-menu button{min-height:44px;padding:0 14px;text-align:left;border:0;border-bottom:1px solid rgba(245,241,232,0.12);background:transparent;color:var(--ww-cream);font:600 14px var(--font-ui);cursor:pointer}
.ww-wall-menu button:hover:not(:disabled),.ww-wall-menu button:focus-visible{background:var(--ww-deep-slate)}
.ww-wall-menu button:disabled{color:rgba(245,241,232,0.55);border-style:solid}
.ww-wall-menu button[aria-pressed="true"]{box-shadow:inset 3px 0 0 var(--ww-accent)}
/* "Back to Overview" is for the phone toolbar, where Overview sits in More; wider panels keep Overview in the bar. */
.ww-back{display:none}

/* Pieces: one circular family (the readiness keystone is the one other shape), sized by role. */
.ww-node{cursor:pointer;outline:none}
.ww-node .ww-hit{fill:transparent;stroke:none}
.ww-node-art{transition:opacity var(--ww-base) var(--ww-ease)}
.ww-node .body{fill:var(--ww-node);stroke:var(--ww-charcoal);stroke-width:1.6;transition:stroke var(--ww-base) var(--ww-ease),stroke-width var(--ww-base) var(--ww-ease)}
.ww-node .ww-glyph{fill:none;stroke:var(--ww-charcoal);stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.ww-node text{font-family:var(--font-ui);pointer-events:none}
.ww-node .ww-label{font-size:11.5px;font-weight:700;fill:var(--ww-charcoal);paint-order:stroke;stroke:var(--ww-stage);stroke-width:3.5px;stroke-linejoin:round;transition:fill var(--ww-base) var(--ww-ease)}
.ww-chip rect{fill:var(--ww-cream);stroke:var(--ww-charcoal-rail);stroke-width:1}
.ww-chip .ww-chip-text{font-size:8.5px;font-weight:800;letter-spacing:0.04em;fill:var(--ww-charcoal)}
.ww-chip[data-attention="true"] rect{stroke:var(--ww-brick-low);stroke-width:1.3;stroke-dasharray:3 2}
.ww-chip[data-attention="true"] .ww-chip-text{fill:var(--ww-brick-low)}
.ww-node[data-type="source"] .body,.ww-node[data-type="derivation"] .body,.ww-node[data-type="chain"] .body,.ww-node[data-type="contract"] .body,.ww-node[data-type="wallet"] .body,.ww-node[data-type="stablecoin"] .body{fill:var(--ww-node-quiet);stroke:var(--ww-deep-slate);stroke-width:1.2}
.ww-node[data-type="source"] .ww-glyph,.ww-node[data-type="derivation"] .ww-glyph,.ww-node[data-type="chain"] .ww-glyph,.ww-node[data-type="contract"] .ww-glyph,.ww-node[data-type="wallet"] .ww-glyph,.ww-node[data-type="stablecoin"] .ww-glyph{stroke:var(--ww-deep-slate)}
.ww-node[data-type="wallmark"] .body{fill:var(--ww-accent);stroke:var(--ww-brick-low);stroke-width:2.6}
.ww-node[data-type="wallmark"] .ww-glyph{stroke:var(--ww-cream);stroke-width:1.5}
.ww-node[data-type="conflict"] .body{fill:var(--ww-brick-low);stroke:var(--ww-brick-low)}
.ww-node[data-type="conflict"] .ww-glyph{stroke:var(--ww-cream);stroke-width:1.8}
.ww-node[data-type="readiness"] .body{fill:var(--ww-charcoal);stroke:var(--ww-charcoal);stroke-width:1.5;transition:transform var(--ww-settle) var(--ww-ease);transform-box:fill-box}
.ww-node[data-type="readiness"] .ww-key-text{font-size:10px;font-weight:800;letter-spacing:0.16em;fill:var(--ww-cream)}
.ww-node[data-type="readiness"] .seat{stroke:var(--ww-charcoal);stroke-width:2.5}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .body{transform:translateY(-5px)}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .seat{stroke-dasharray:5 4;stroke:var(--ww-brick-low)}
.ww-node.is-resolving .ww-chip{opacity:0}
.ww-node .ww-chip{transition:opacity var(--ww-settle) var(--ww-ease)}
/* States: ring, line, fill and words together, never colour alone. */
.ww-node[data-state="ESTABLISHED"]:not([data-type="readiness"]) .body{stroke-width:2.4}
.ww-node[data-type="wallmark"][data-state="ESTABLISHED"] .body{stroke-width:3}
.ww-node .half{fill:var(--ww-stone-low)}
.ww-node .ww-ring{fill:none;transform-box:fill-box;transform-origin:center}
.ww-node .ww-ring-conflict{stroke:var(--ww-brick-low);stroke-width:1.8}
.ww-node .ww-ring-outer{stroke-dasharray:5 3;stroke-width:1.4;animation:ww-breathe 2.4s ease-in-out infinite}
.ww-node[data-state="CONFLICTING"] .body{stroke:var(--ww-brick-low);stroke-width:2.2}
.ww-node .ww-ring-stale{stroke:var(--ww-brick-low);stroke-width:1.5;stroke-dasharray:3 3}
.ww-node[data-state="STALE"]:not([data-type="readiness"]) .ww-node-art{opacity:0.66;animation:ww-recede 5.5s ease-in-out infinite}
.ww-node[data-type="readiness"][data-state="STALE"] .body,.ww-node[data-type="readiness"][data-state="CONFLICTING"] .body{stroke:var(--ww-brick-low);stroke-width:2.4;stroke-dasharray:5 3}
.ww-node[data-state="STALE"] .body{stroke-dasharray:4 2}
.ww-node[data-state="SUPERSEDED"] .ww-node-art{opacity:0.5}
.ww-node .ghost{fill:none;stroke:var(--ww-charcoal);stroke-width:1.2;stroke-dasharray:1.5 3}
.ww-node[data-state="UNKNOWN"] .body,.ww-node[data-state="NOT_ESTABLISHED"] .body,.ww-node[data-state="NONE"] .body,.ww-node[data-state="UNRECOGNISED"] .body,.ww-node[data-flags~="missing"] .body,.ww-node[data-type="gap"] .body{fill:transparent;stroke-dasharray:4 3}
.ww-node[data-type="snapshot"] .body{fill:transparent;stroke:var(--ww-deep-slate);stroke-dasharray:2 3}
.ww-node[data-flags~="unattested"] .body{stroke-dasharray:4 3}
/* Connectors. */
.ww-edge{fill:none;stroke:var(--ww-charcoal-rail);stroke-width:1.3;transition:stroke var(--ww-base) var(--ww-ease),stroke-width var(--ww-base) var(--ww-ease),opacity var(--ww-base) var(--ww-ease)}
.ww-edge[data-kind="subject"],.ww-edge[data-kind="anchors"],.ww-edge[data-kind="names"],.ww-edge[data-kind="issuer"],.ww-edge[data-kind="reserved"]{stroke-dasharray:4 3;stroke-width:1.2}
.ww-edge[data-kind="missing"]{stroke-dasharray:3 3}
.ww-edge[data-kind="supersedes"]{stroke-dasharray:1.5 3}
.ww-edge[data-kind="conflict"]{stroke:var(--ww-brick-low);stroke-width:2.2;stroke-dasharray:6 3}
#ww-arrow path{fill:var(--ww-charcoal-rail)}
/* The dominant story, drawn from the returned states: a conflict, a stale claim, or the Wallmark-to-readiness path. */
.ww-wall-svg[data-focus="none"]:not([data-trace="true"]) .ww-edge[data-story="true"]{stroke:var(--ww-brick-low);stroke-width:2.4}
/* Selection and focus: the focused piece, its direct connections, everything else muted. */
.ww-node .ww-halo{display:none;fill:none;stroke:var(--ww-accent);stroke-width:3.5;transform-box:fill-box;transform-origin:center}
.ww-wall-svg[data-selection="explicit"] .ww-node.is-selected .ww-halo,.ww-node.is-focus .ww-halo{display:inline;animation:ww-halo 3.2s ease-in-out infinite}
.ww-node.is-selected .body,.ww-node.is-focus .body{stroke:var(--ww-brick-low);stroke-width:2.8}
/* The guide's pointer is a reticle of four ticks, so it can never be read as the dashed ring that means STALE. */
.ww-node.is-pointed .ww-halo{display:inline;stroke-dasharray:7 18;stroke-dashoffset:3.5;stroke-width:3;stroke-linecap:round;stroke:var(--ww-accent-dark);animation:ww-halo 2.4s ease-in-out infinite}
.ww-node:focus-visible .ww-hit{stroke:var(--ww-accent-dark);stroke-width:2;stroke-dasharray:3 3}
.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-node-art,.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-chip{opacity:0.45;animation:none}
.ww-wall-svg[data-focus="pinned"] .ww-node:not(.on-path) .ww-label{fill:var(--ww-deep-slate)}
.ww-wall-svg[data-focus="pinned"] .ww-edge:not(.on-path){opacity:0.28}
.ww-wall-svg[data-focus="preview"] .ww-node:not(.on-path) .ww-node-art{opacity:0.72}
.ww-wall-svg[data-focus="preview"] .ww-edge:not(.on-path){opacity:0.55}
.ww-wall-svg[data-focus] .ww-node.is-related .ww-node-art{opacity:0.92}
.ww-edge.on-path{stroke:var(--ww-brick-low);stroke-width:2.2;opacity:1}
/* Trace: the same pieces in the same places; the provenance trace_provenance returned is drawn, the rest recedes. */
.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-node-art,.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-chip{opacity:0.36;animation:none}
.ww-wall-svg[data-trace="true"] .ww-node:not([data-trace="true"]) .ww-label{fill:var(--ww-deep-slate)}
.ww-wall-svg[data-trace="true"] .ww-edge:not([data-trace="true"]){opacity:0.16}
.ww-wall-svg[data-trace="true"] .ww-edge[data-trace="true"]{stroke:var(--ww-brick-low);stroke-width:2.8;opacity:1}
.ww-glint{fill:none;stroke:var(--ww-cream);stroke-width:1.4;stroke-linecap:round;stroke-dasharray:1 11;opacity:0;pointer-events:none}
.ww-wall-svg[data-trace="true"] .ww-glint{animation:ww-shimmer 2.4s ease-in-out infinite}
.ww-glint[data-step="1"]{animation-delay:0.4s}.ww-glint[data-step="2"]{animation-delay:0.8s}.ww-glint[data-step="3"]{animation-delay:1.2s}.ww-glint[data-step="4"]{animation-delay:1.6s}.ww-glint[data-step="5"]{animation-delay:2s}
.ww-wall-svg[data-trace="true"] .ww-node[data-trace="true"] .ww-node-art{opacity:1}
@keyframes ww-breathe{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:1;transform:scale(1.07)}}
@keyframes ww-halo{0%,100%{opacity:0.55;transform:scale(1)}50%{opacity:0.95;transform:scale(1.08)}}
@keyframes ww-recede{0%,100%{opacity:0.66}50%{opacity:0.5}}
@keyframes ww-shimmer{0%,100%{opacity:0}35%{opacity:0.85}}
@keyframes ww-idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}

/* Tooltip: one at a time, never the only place a fact lives. */
.ww-tip{position:absolute;z-index:9;max-width:220px;padding:5px 9px;background:var(--ww-charcoal);color:var(--ww-cream);font:600 12px/1.3 var(--font-ui);border-radius:var(--ww-radius-panel);pointer-events:none;box-shadow:0 4px 12px rgba(30,26,20,0.25)}
.ww-tip[hidden]{display:none}

/* WalletWallaby: on the stage beside the controls, pointing at the piece it explains; never over a piece. */
.ww-wallaby{display:flex;align-items:center;gap:8px;max-width:min(540px,100%);transition:opacity var(--ww-settle) var(--ww-ease),transform var(--ww-settle) var(--ww-ease)}
.ww-wallaby[hidden]{display:none}
.ww-wallaby[data-peek="out"]{opacity:0;transform:translateY(-4px)}
.ww-wallaby[data-peek="in"]{opacity:1;transform:none}
.ww-wallaby-art{flex:0 0 auto;width:40px;height:40px;background-size:contain;background-repeat:no-repeat;background-position:bottom center;animation:ww-idle 4.8s ease-in-out infinite}
.ww-wallaby-bubble{font-size:12.5px;line-height:1.35;color:var(--ww-charcoal);min-width:0}
.ww-wallaby-bubble p{margin:0}
.ww-wallaby-bubble .ww-eyebrow{font-size:9.5px;color:var(--ww-brick-low)}

/* Detail rail: lighter cream, its head in terracotta: what is in focus and whether it is the selected assertion. */
.chip{display:inline-block;padding:0 7px;border:1px solid var(--ww-charcoal-border);border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.04em;width:fit-content;background:var(--ww-cream);color:var(--ww-charcoal);font-family:var(--font-ui);white-space:nowrap}
.chip[data-attention="true"]{border-color:var(--ww-brick-low);border-style:dashed;color:var(--ww-brick-low)}
.ww-detail{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;min-width:0;padding:0 0 10px;background:var(--ww-rail);border-radius:var(--ww-radius-panel)}
.ww-sheet-bar,.ww-sheet-actions{display:none}
.ww-sheet-summary{display:block;margin:0;padding:12px 14px 10px;background:var(--ww-accent-dark);color:var(--ww-on-dark)}
.ww-sheet-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;font:600 16px/1.3 var(--font-display)}
.ww-sheet-title>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ww-sheet-summary .chip{background:var(--ww-cream);color:var(--ww-charcoal);border-color:transparent;flex:0 0 auto}
.ww-sheet-summary .chip[data-attention="true"]{color:var(--ww-brick-low);border-color:var(--ww-cream)}
.ww-sheet-meaning{margin:3px 0 0;font-size:12.5px;color:var(--ww-on-dark)}
.ww-focus-kind{margin:6px 0 0;font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ww-on-dark-muted)}
.ww-focus-kind code{font-size:11px;color:var(--ww-on-dark);text-transform:none;letter-spacing:0}
.ww-detail section,.ww-detail .ww-more{padding:0 14px}
.ww-detail .ww-more section{padding:0}
.ww-detail h2{font-size:14px;margin:8px 0 6px}
[data-assertion-detail]:not([hidden]){display:block}
.states{margin:0}.states>div{display:grid;grid-template-columns:104px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid var(--ww-inner-border)}
.states dt{color:var(--ww-muted-text);font-size:12px;font-weight:700}.states dd{margin:0;min-width:0}
.ww-why{display:inline-block;margin-left:6px;font-size:12px}
.ww-why summary{display:inline;cursor:pointer;color:var(--ww-brick-low);font-weight:700}
.ww-why[open]{display:block;margin:4px 0 0}
.ww-why p{margin:4px 0 0}
.ww-more{border-top:1px solid var(--ww-inner-border)}
.ww-more>summary{display:flex;align-items:center;min-height:40px;cursor:pointer;font-weight:700;font-size:12.5px;color:var(--ww-charcoal)}
.ww-more[open]>summary{color:var(--ww-brick-low)}
.kv{margin:0;display:grid;gap:2px}.kv>div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px}.kv dt{color:var(--ww-muted-text)}.kv dd{margin:0;min-width:0}
.addr{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;max-width:100%}
.addr-full{user-select:all;-webkit-user-select:all}
/* Copy appears on hover or keyboard focus without moving anything; on touch it is always there. */
button.copy{font-size:11px;padding:0 8px;min-height:26px;min-width:4.4em;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-cream);color:var(--ww-charcoal);cursor:pointer;font-weight:700;opacity:0;transition:opacity var(--ww-fast) var(--ww-ease)}
.addr:hover button.copy,.addr:focus-within button.copy,button.copy[data-copied="true"]{opacity:1}
button.copy[data-copied="true"]{border-color:var(--ww-accent-dark);color:var(--ww-accent-dark)}
@media (hover:none){button.copy{opacity:1;min-height:36px}}
button.link{background:none;border:0;padding:0;color:var(--ww-brick-low);text-decoration:underline;cursor:pointer;text-align:left}
.copy-status{position:fixed;left:18px;bottom:12px;margin:0;padding:4px 8px;font-size:12px;border-radius:var(--ww-radius-badge);background:var(--ww-charcoal);color:var(--ww-cream);z-index:5}
.copy-status:empty{display:none}
.two{display:grid;grid-template-columns:1fr;gap:8px}
.limits{margin:0;padding-left:18px}.limits li{margin:2px 0}
.ww-why-path{list-style:none;margin:6px 0;padding:0 0 0 12px;border-left:2px solid var(--ww-charcoal-rail)}
.ww-why-path li{position:relative;padding:3px 0}
.ww-why-path li::before{content:"";position:absolute;left:-17px;top:10px;width:8px;height:8px;border-radius:50%;background:var(--ww-cream);border:1.5px solid var(--ww-charcoal)}
.ww-why-step{display:block;font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ww-muted-text)}
.ww-why-target{background:rgba(191,78,50,0.12);outline:1px solid var(--ww-accent-dark)}
.ww-why-button{min-height:34px;padding:0 12px;border:0;border-radius:var(--ww-radius-panel);background:var(--ww-charcoal);color:var(--ww-cream);font-weight:700;cursor:pointer}
.ww-table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--ww-inner-border);padding:6px 8px;text-align:left;vertical-align:top}

/* Wallprint: a deep-slate band under The Wall, one compact item per facet, each leading to its piece. */
.ww-wallprint{display:flex;align-items:center;gap:6px 14px;padding:6px 10px 6px 14px;background:var(--ww-deep-slate);color:var(--ww-on-dark);border-radius:var(--ww-radius-panel)}
.ww-wallprint>h2{flex:0 0 auto;margin:0;font:700 10.5px var(--font-ui);letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-warm-stone)}
.ww-courses{flex:1 1 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));list-style:none;margin:0;padding:0;min-width:0}
.ww-brick{min-width:0;border-left:1px solid rgba(245,241,232,0.16)}
.ww-brick-key{display:flex;flex-direction:column;justify-content:center;gap:3px;width:100%;min-height:52px;padding:5px 10px;background:none;border:0;color:inherit;text-align:left;font:inherit;font-size:12.5px}
button.ww-brick-key{cursor:pointer;transition:background var(--ww-fast) var(--ww-ease)}
button.ww-brick-key:hover{background:rgba(245,241,232,0.08)}
.ww-wallprint .ww-eyebrow{font-size:9.5px;letter-spacing:0.14em;color:var(--ww-warm-stone)}
.ww-brick-value{display:flex;flex-wrap:wrap;align-items:center;gap:3px 6px;min-width:0}
.ww-wallprint .muted{color:var(--ww-on-dark-muted)}
.ww-wallprint code{color:var(--ww-on-dark)}
.ww-brick[data-attention="true"] .ww-eyebrow{color:var(--ww-cream)}

/* Readiness: the keystone and its criteria as a checklist. */
.ww-assembly,.ww-criteria{padding:10px 14px;background:var(--ww-rail);border-radius:var(--ww-radius-panel)}
.ww-arch{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:16px;align-items:start}
.ww-keystone{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 30px 14px;background:var(--ww-charcoal);color:var(--ww-cream);clip-path:polygon(0 0,100% 0,86% 100%,14% 100%);text-align:center;transition:transform var(--ww-settle) var(--ww-ease)}
.ww-keystone .ww-eyebrow{color:var(--ww-warm-stone)}
.ww-keystone .small{color:var(--ww-on-dark-muted)}
.ww-arch[data-fit="false"] .ww-keystone{transform:translateY(-6px)}
.ww-course{list-style:none;margin:0;padding:0}
.ww-course-empty{min-height:40px;border-bottom:1px dashed var(--ww-brick-low)}
.ww-piece{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 4px;border-bottom:1px solid var(--ww-inner-border)}
.ww-piece::before{content:"✓";flex:0 0 18px;font-weight:800;text-align:center}
.ww-piece[data-outcome="NOT_MET"]::before,.ww-piece[data-outcome="INDETERMINATE"]::before{content:"!";color:var(--ww-brick-low)}
.ww-piece[data-outcome="UNRECOGNISED"]::before{content:"?"}
.ww-piece[data-outcome="NOT_MET"],.ww-piece[data-outcome="INDETERMINATE"],.ww-piece[data-outcome="UNRECOGNISED"]{border-left:2px dashed var(--ww-brick-low)}
.ww-piece-id{font:700 10px var(--font-mono);color:var(--ww-muted-text)}
.ww-piece-name{flex:1 1 auto;min-width:0;font-weight:700}
.ww-piece-fit{font-size:11px;color:var(--ww-muted-text)}
.ww-piece-reason{font-size:10.5px}
.ww-piece .chip{flex:0 0 auto}
.ww-course[data-focus-node]{cursor:pointer}
.ww-assembly-show{margin:6px 0 0}
.ww-criteria h3{margin-top:10px}

/* The list: another lens on the same pieces, on the stage's own surface. */
.ww-list{padding:10px 14px;background:var(--ww-stage);border-radius:var(--ww-radius-panel)}
.ww-list>h2{margin-top:2px}
.ww-list .muted{color:var(--ww-deep-slate)}
.ww-search{display:block;width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--ww-charcoal-rail);border-radius:var(--ww-radius-panel);background:var(--ww-cream);color:var(--ww-ink);font:inherit}
.ww-filters{display:flex;gap:6px;overflow-x:auto;padding:8px 0;scrollbar-width:none}
.ww-filters button{flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid var(--ww-charcoal-rail);border-radius:999px;background:transparent;color:var(--ww-charcoal);font:700 12.5px var(--font-ui);cursor:pointer}
.ww-filters button[aria-pressed="true"]{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}
.ww-list-rows{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));column-gap:18px}
.ww-list-rows li[hidden]{display:none}
.ww-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name meta" "sub sub";align-items:center;gap:2px 10px;width:100%;min-height:54px;padding:7px 6px;border:0;border-bottom:1px solid rgba(43,43,46,0.2);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background var(--ww-fast) var(--ww-ease)}
.ww-list-row:hover{background:rgba(245,241,232,0.35)}
.ww-list-row[aria-current="true"]{box-shadow:inset 3px 0 0 var(--ww-brick-low)}
.ww-list-name{grid-area:name;font-weight:700;min-width:0}
.ww-list-meta{grid-area:meta;display:flex;align-items:center;gap:4px}
.ww-list-sub{grid-area:sub;min-width:0}
.ww-list .ww-type-chip{background:transparent;border-color:var(--ww-charcoal-rail);font-weight:600}

/* Legend, receipt and the text version: below everything, folded. */
.ww-legend{font-size:12px}
.ww-legend summary,.ww-text-version summary{display:flex;align-items:center;min-height:40px;cursor:pointer;font-weight:700}
.ww-legend-list{list-style:none;padding:0;margin:6px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 12px}
.ww-legend-list li{display:flex;align-items:center;gap:8px}
.ww-swatch{width:40px;height:24px;flex:0 0 auto}
.ww-swatch .ww-node .body{fill:var(--ww-node)}
.ww-receipt{border-top:1px solid var(--ww-inner-border)}
.ww-receipt>h2{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-receipt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ww-receipt-row-text{display:flex;flex-direction:column}
.ww-receipt-body{display:none}
.ww-receipt[data-open="true"] .ww-receipt-body{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;padding-bottom:8px}
.ww-receipt-body>div{flex:1 1 260px}
.ww-qr-slot{flex:0 0 auto;width:96px;height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--ww-charcoal-rail);color:var(--ww-muted-text);font:700 14px var(--font-mono)}
.ww-actions{display:flex;flex-wrap:wrap}
.ww-actions button{min-height:32px;padding:4px 12px;border:1px solid var(--ww-charcoal-border);margin-right:-1px;background:transparent;font-size:12.5px;font-weight:600}
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
.ww-rail:has(.ww-rail-asset) .ww-rail-name{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-mark{width:30px;height:30px}
.ww-rail-asset{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.ww-strip{display:flex;flex-wrap:nowrap;gap:2px 10px;list-style:none;margin:0;padding:0;min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none}
.ww-strip>li{flex:0 0 auto}
.ww-strip-item{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 8px 0 0;border:0;background:none;color:var(--ww-on-dark);font:inherit;line-height:1.2;text-align:left}
button.ww-strip-item{cursor:pointer}
.ww-strip-key{font-size:9.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ww-on-dark-muted)}
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
body{padding:8px 12px calc(var(--ww-peek) + 24px);-webkit-tap-highlight-color:transparent}
/* The state strip scrolls sideways when it does not fit; the fade at its edge says there is more. */
.ww-strip{-webkit-mask-image:linear-gradient(90deg,#000 86%,transparent);mask-image:linear-gradient(90deg,#000 86%,transparent);padding-right:24px}
button:not(:disabled):active,.ww-strip-item:active{filter:brightness(0.94)}
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
.ww-detail{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:7;margin:0;height:var(--ww-peek);max-height:none;overflow:hidden;border-radius:0;background:var(--ww-cream);padding:0 0 calc(env(safe-area-inset-bottom,0px) + 10px);box-shadow:0 -6px 18px rgba(30,26,20,0.18);transition:height var(--ww-settle) var(--ww-ease)}
.ww-detail[data-sheet="half"]{height:54vh;overflow-y:auto;overscroll-behavior:contain}
.ww-detail[data-sheet="full"]{height:calc(100vh - 16px);height:calc(100dvh - 16px);overflow-y:auto;overscroll-behavior:contain}
.ww-sheet-bar{display:flow-root;position:sticky;top:0;z-index:1;background:var(--ww-accent-dark);touch-action:none}
.ww-detail[data-sheet="peek"]{touch-action:none}
/* The grip draws a 24 px bar but takes 44 px of touch: the extra 20 px reach invisibly over the summary below it. */
.ww-sheet-grip{position:relative;display:flex;align-items:flex-start;justify-content:center;width:100%;min-height:44px;margin-bottom:-20px;padding:12px 0 0;border:0;background:transparent;color:var(--ww-cream);cursor:pointer}
.ww-sheet-grip span{display:block;width:40px;height:4px;border-radius:2px;background:var(--ww-on-dark-muted)}
.ww-sheet-summary{padding:2px 14px 10px;cursor:pointer}
.ww-sheet-meaning{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ww-sheet-actions{display:flex;gap:6px;position:sticky;bottom:calc(-10px - env(safe-area-inset-bottom,0px));margin:8px 0 0;padding:8px 14px 10px;background:var(--ww-cream);border-top:1px solid var(--ww-charcoal-border)}
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
.ww-brick{border-left:0;border-top:1px solid rgba(245,241,232,0.14)}
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
.ww-criteria tr{padding:6px 0;border-bottom:1px solid var(--ww-inner-border)}
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
.ww-detail,.ww-detail[data-sheet]{top:0;left:auto;width:40vw;height:100vh;height:100dvh;overflow-y:auto;border-left:2px solid var(--ww-charcoal);box-shadow:-6px 0 18px rgba(30,26,20,0.12)}
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
