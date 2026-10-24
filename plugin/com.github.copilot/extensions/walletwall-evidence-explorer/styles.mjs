// The WalletWall canvas stylesheet. Token values are copied from the WalletWall brand contract (see
// canvas/brand/brand-sources.json); nothing here introduces a colour the WalletWall app does not already define.
// Motion follows the app's motion tokens: 140 to 280 ms, decisive ease-out, no bounce, nothing perpetual.

export const CSS = `
:root{color-scheme:light;
--ww-bg:#F2ECDF;--ww-surface:#F8F2E4;--ww-card-bg:rgba(248,242,228,0.82);--ww-card-border:rgba(139,49,32,0.16);--ww-inner-border:rgba(30,26,20,0.07);
--ww-ink:rgba(30,26,20,0.88);--ww-muted-text:rgba(30,26,20,0.66);--ww-accent:#BF4E32;--ww-accent-dark:#8B3120;--ww-tan:#C9A47A;
--ww-charcoal:#2B2B2E;--ww-deep-slate:#3A3D41;--ww-warm-stone:#D8D3C8;--ww-cream:#F5F1E8;--ww-charcoal-border:rgba(43,43,46,0.22);--ww-charcoal-rail:rgba(43,43,46,0.28);
--ww-stone:#e9d3ad;--ww-stone-low:#b99568;--ww-mortar:#f5ead4;--ww-brick:#b94a31;--ww-radius-panel:2px;--ww-radius-badge:1px;
--ww-focus:0 0 0 3px rgba(191,78,50,0.18);
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
body{margin:0;padding:14px 18px 40px;background:var(--ww-bg);color:var(--ww-ink);font:14px/1.5 var(--font-ui);font-weight:500;overflow-wrap:anywhere}
h1,h2{font-family:var(--font-display);font-weight:600;letter-spacing:-0.01em}
h1{font-size:20px;line-height:1.2;margin:0}
h2{font-size:15px;margin:18px 0 8px}
h3{font-size:12px;margin:12px 0 4px;color:var(--ww-muted-text);font-weight:700;text-transform:uppercase;letter-spacing:0.08em}
code{font-family:var(--font-mono);font-size:12px;font-weight:400;word-break:break-all}
.muted{color:var(--ww-muted-text)}.small{font-size:12px}
.ww-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ww-eyebrow{display:block;margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-accent-dark)}
.note{padding:8px 10px;border:1px solid var(--ww-card-border);border-left:3px solid var(--ww-charcoal-rail);border-radius:var(--ww-radius-panel);background:var(--ww-card-bg);margin:8px 0}
[data-attention="true"]{border-color:var(--ww-accent-dark)}
.note[data-attention="true"]{border-left-style:dashed}
.meta{font-size:12px;color:var(--ww-muted-text);margin:6px 0}
button{font:inherit}
button:focus-visible,.ww-node:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ww-accent);outline-offset:2px;box-shadow:var(--ww-focus)}

/* Identity rail: compact, so The Wall stays dominant. */
.ww-rail{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding:8px 10px;border:1px solid var(--ww-card-border);border-top:2px solid var(--ww-charcoal);border-radius:var(--ww-radius-panel);background:var(--ww-surface)}
.ww-mark{flex:0 0 auto;width:40px;height:40px;background-size:contain;background-repeat:no-repeat;background-position:center;margin:2px}
.ww-rail-name{display:flex;align-items:center;gap:8px}
.ww-lens-badge{font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:1px 6px;border:1px solid var(--ww-charcoal);border-radius:var(--ww-radius-badge)}
.ww-rail-facts{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;flex:1 1 420px}
.ww-rail-facts>div{display:flex;flex-direction:column;min-width:0}
.ww-rail-facts dt{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ww-muted-text)}
.ww-rail-facts dd{margin:0}
.ww-boundary{font-size:12px}

/* Modes and lenses. Disabled ones say why, in text that is always visible. */
.ww-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:10px 0 4px}
.ww-modes,.ww-lens,.ww-tools,.ww-actions{display:flex;flex-wrap:wrap;gap:0}
.ww-modes button,.ww-lens button,.ww-tools button,.ww-actions button,.ww-zoom button,[data-reset-layout],.ww-why-button,.ww-wallaby button{min-height:32px;padding:4px 12px;border:1px solid var(--ww-charcoal-border);margin-right:-1px;border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:var(--ww-ink);cursor:pointer;font-size:12.5px;font-weight:600}
.ww-modes button[aria-pressed="true"],.ww-lens .is-on{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}
.ww-tools button[aria-pressed="true"]{border-color:var(--ww-charcoal)}
button:disabled{cursor:not-allowed;color:var(--ww-muted-text);background:transparent;border-style:dashed}
.ww-reasons{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 14px;font-size:11.5px;color:var(--ww-muted-text);flex-basis:100%}
.ww-reason{font-size:12px;color:var(--ww-muted-text);font-weight:600}
.ww-why-button{border-color:var(--ww-accent);color:var(--ww-accent-dark)}

/* Layout. */
.ww-flow{display:flex;flex-direction:column}
.ww-flow>*{order:5}.ww-flow>.ww-stage{order:1}.ww-flow>.ww-assembly{order:2}
#app[data-mode="trace"] .ww-flow>.ww-lineage{order:1}
#app[data-mode="trace"] .ww-flow>.ww-stage{order:0}
.ww-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:16px;margin-top:8px;align-items:start}
.ww-section,.ww-wall,.ww-detail{border:1px solid var(--ww-card-border);border-radius:var(--ww-radius-panel);background:var(--ww-card-bg);padding:10px 12px;margin-top:12px;min-width:0}
.ww-stage>.ww-wall,.ww-stage>.ww-detail{margin-top:0}
.ww-section>h2:first-child,.ww-detail h2:first-of-type{margin-top:4px}
.ww-section-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
.ww-section-head h2{margin:2px 0}
.ww-section-head p{margin:0;flex:1 1 220px}
.ww-detail{position:sticky;top:8px;max-height:calc(100vh - 16px);overflow:auto}
#app[data-mode="trace"] .ww-lineage{border-top:2px solid var(--ww-charcoal)}

/* The Wall. */
.ww-wall{background:var(--ww-surface);background-image:linear-gradient(var(--ww-inner-border) 1px,transparent 1px),linear-gradient(90deg,var(--ww-inner-border) 1px,transparent 1px);background-size:24px 24px}
/* The Wall: it always fits its frame (the whole graph, readiness keystone included, is visible without scrolling).
   Zoom and pan happen inside the frame by changing the SVG view box; the page never scrolls sideways. */
.ww-wall-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.ww-zoom{display:flex;align-items:center}
.ww-zoom-level{display:inline-block;min-width:82px;padding:0 6px;text-align:center;font-size:12px;font-weight:600;color:var(--ww-muted-text)}
.ww-wall-view{margin-top:6px;min-width:0}
.ww-wall-svg{display:block;width:100%;max-width:1400px;margin:0 auto;height:auto;user-select:none;-webkit-user-select:none;touch-action:pan-y}
/* Two faces per piece: wide (left to right) and compact (portrait, top to bottom). The page shows the one whose
   positions it applied, so a piece's face, place and size always agree. */
.ww-wall-svg [data-face="compact"],.ww-wall-svg[data-layout="portrait"] [data-face="wide"],.ww-wall-svg[data-layout="portrait"] .ww-chamber text{display:none}
.ww-wall-svg[data-layout="portrait"] [data-face="compact"]{display:inline}
.ww-wall-svg[data-layout="portrait"]{height:clamp(360px,70vh,620px);max-width:none}
.ww-node .c1{font-size:11.5px;font-weight:700}
.ww-node .c2{font-size:9.5px;fill:var(--ww-muted-text);font-weight:600}
.ww-node .c2.mono{font-family:var(--font-mono);font-weight:500;fill:var(--ww-ink)}
.ww-node .c3{font-size:8.5px;font-weight:700;letter-spacing:0.08em}
.ww-wall-svg:not([data-zoom="1"]){cursor:grab;touch-action:none}
.ww-wall-svg.is-panning{cursor:grabbing}
.ww-wall-svg .ww-node{touch-action:none}
.ww-wall-svg .layer{font:700 9px var(--font-ui);letter-spacing:0.18em;fill:var(--ww-muted-text)}
.ww-chamber rect{fill:rgba(201,164,122,0.12);stroke:var(--ww-charcoal-rail);stroke-width:1}
.ww-chamber rect.inner{fill:none;stroke:var(--ww-inner-border)}
.ww-edge{fill:none;stroke:var(--ww-charcoal-rail);stroke-width:1;transition:stroke var(--ww-base) var(--ww-ease),opacity var(--ww-base) var(--ww-ease)}
.ww-edge[data-evidence="true"]{stroke:rgba(43,43,46,0.5)}
.ww-edge[data-kind="supersedes"]{stroke-dasharray:2 3}
.ww-edge[data-kind="conflict"]{stroke:var(--ww-accent-dark);stroke-width:1.6}
.ww-edge[data-kind="reserved"]{stroke-dasharray:4 4}
.ww-edge[data-kind="missing"]{stroke-dasharray:3 3}
.ww-edge[data-kind="subject"],.ww-edge[data-kind="anchors"],.ww-edge[data-kind="names"],.ww-edge[data-kind="issuer"]{stroke:rgba(43,43,46,0.2)}
#ww-arrow path{fill:var(--ww-charcoal-rail)}
#ww-hatch line{stroke:rgba(30,26,20,0.28);stroke-width:1.4}
#ww-half rect{fill:rgba(201,164,122,0.55)}
.ww-node{cursor:pointer;outline:none;transition:opacity var(--ww-base) var(--ww-ease)}
.ww-node .body{fill:var(--ww-surface);stroke:var(--ww-charcoal);stroke-width:1}
.ww-node text{font-family:var(--font-ui);fill:var(--ww-ink);pointer-events:none}
.ww-node .t1{font-size:11px;font-weight:700}
.ww-node .t2{font-size:9.5px;fill:var(--ww-muted-text);font-weight:600}
.ww-node .t3{font-size:8.5px;font-weight:700;letter-spacing:0.12em}
.ww-node .mono{font-family:var(--font-mono);font-weight:500;font-size:10.5px}
.ww-node .on-dark{fill:var(--ww-cream)}
.ww-node[data-type="authority"] .body{fill:var(--ww-stone)}
.ww-node[data-type="authority"] .inner{fill:none;stroke:var(--ww-stone-low);stroke-width:1}
.ww-node[data-type="source"] .rail{stroke:var(--ww-charcoal);stroke-width:3}
.ww-node[data-type="observation"] .body{fill:var(--ww-cream)}
.ww-node[data-type="observation"] .tick{stroke:var(--ww-charcoal);stroke-width:1}
.ww-node[data-type="wallmark"] .seal{fill:var(--ww-accent);stroke:var(--ww-accent-dark)}
.ww-node[data-type="wallmark"] .seal-ring{fill:none;stroke:var(--ww-mortar);stroke-width:1}
.ww-node[data-type="wallmark"] .seal-bricks{fill:none;stroke:var(--ww-mortar);stroke-width:1.2}
.ww-node[data-type="derivation"] .body{fill:rgba(43,43,46,0.06)}
.ww-node[data-type="readiness"] .body{fill:var(--ww-stone);stroke-width:1.5;transition:transform var(--ww-settle) var(--ww-ease);transform-box:fill-box}
.ww-node[data-type="readiness"] .seat{stroke:var(--ww-charcoal);stroke-width:2}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .body{transform:translateY(-5px)}
.ww-node[data-type="readiness"]:not([data-classification="CRITERIA_MET"]) .seat{stroke-dasharray:5 4;stroke:var(--ww-accent-dark)}
.ww-node[data-type="readiness"] .classification{transition:opacity var(--ww-settle) var(--ww-ease)}
.ww-node.is-resolving .classification,.ww-node.is-resolving .state{opacity:0}
.ww-node[data-type="conflict"] .body{fill:var(--ww-accent-dark);stroke:var(--ww-accent-dark)}
.ww-node[data-type="gap"] .body,.ww-node[data-flags~="missing"] .body{fill:url(#ww-hatch);stroke-dasharray:4 3}
.ww-node[data-type="snapshot"] .body{fill:none;stroke:var(--ww-charcoal-rail);stroke-dasharray:4 4}
.ww-node[data-type="snapshot"] text{fill:var(--ww-muted-text)}
.ww-node[data-type="stablecoin"] .body{fill:var(--ww-brick);stroke:var(--ww-accent-dark)}
.ww-node[data-type="stablecoin"] .hi{stroke:rgba(255,244,223,0.45);stroke-width:1}
.ww-node[data-type="contract"] .body{fill:var(--ww-cream);stroke:var(--ww-charcoal-border)}
.ww-node[data-type="wallet"] .body{fill:var(--ww-stone);stroke:var(--ww-stone-low)}
.ww-node[data-type="wallet"] .mortar{stroke:var(--ww-mortar);stroke-width:2}
.ww-node[data-type="chain"] .body{fill:var(--ww-charcoal)}
.ww-node[data-flags~="unattested"] .body{stroke-dasharray:4 3}
/* Support states: shape, line and label together, never colour alone. */
.ww-node[data-state="ESTABLISHED"] .body{stroke-width:1.8}
.ww-node[data-state="PARTIAL"] .body{fill:url(#ww-half)}
.ww-node[data-state="CONFLICTING"] .body{stroke:var(--ww-accent-dark);stroke-dasharray:6 3;stroke-width:1.4}
.ww-node[data-state="STALE"]{opacity:0.62}
.ww-node[data-state="STALE"] .body{fill:var(--ww-warm-stone);stroke-dasharray:2 2}
.ww-node[data-state="SUPERSEDED"]{opacity:0.45}
.ww-node[data-state="SUPERSEDED"] .body{stroke-dasharray:1 3}
.ww-node .ghost{fill:none;stroke:var(--ww-charcoal-rail);stroke-dasharray:1 3}
.ww-node[data-state="UNKNOWN"] .body{fill:url(#ww-hatch);stroke-dasharray:4 3}
.ww-node[data-state="NOT_ESTABLISHED"] .body{fill:transparent;stroke-dasharray:1 2}
.ww-node[data-state="NONE"] .body,.ww-node[data-state="UNRECOGNISED"] .body{fill:transparent;stroke-dasharray:6 2 1 2}
/* Selection and the dependency path. */
.ww-node.is-selected .body,.ww-node[aria-pressed="true"] .body{stroke:var(--ww-accent);stroke-width:2.4}
.ww-node.is-pointed .body{stroke:var(--ww-accent);stroke-width:2.4;stroke-dasharray:none}
.ww-edge.on-path{stroke:var(--ww-accent);stroke-width:1.8;opacity:1}
.ww-wall-svg[data-trace="true"] .ww-edge.on-path{stroke-width:2.4}
.ww-wall-svg[data-trace="true"] .ww-node:not(.on-path){opacity:0.22}
.ww-wall-svg[data-trace="true"] .ww-edge:not(.on-path){opacity:0.15}
.ww-wall-svg[data-trace="true"] .ww-chamber{opacity:0.5}
.ww-legend{margin-top:8px;font-size:12px}
.ww-legend summary,.ww-text-version summary{cursor:pointer;font-weight:700}
.ww-legend-list{list-style:none;padding:0;margin:6px 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 12px}
.ww-legend-list li{display:flex;align-items:center;gap:8px}
.ww-swatch{width:40px;height:20px;flex:0 0 auto}

/* Detail rail. */
.chip{display:inline-block;padding:0 7px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);font-size:11px;font-weight:700;letter-spacing:0.04em;width:fit-content;background:var(--ww-surface);font-family:var(--font-ui)}
.chip[data-attention="true"]{border-width:1.5px;border-style:dashed}
.states{margin:0}.states>div{display:grid;grid-template-columns:130px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--ww-inner-border)}
.states dt{color:var(--ww-muted-text);font-size:12px;font-weight:700}.states dd{margin:0;min-width:0}
@media (max-width:640px){.states>div{grid-template-columns:1fr}}
.kv{margin:0;display:grid;gap:2px}.kv>div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px}.kv dt{color:var(--ww-muted-text)}.kv dd{margin:0;min-width:0}
.addr{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;max-width:100%}
.addr-full{user-select:all;-webkit-user-select:all}
button.copy{font-size:11.5px;padding:0 8px;min-height:24px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:inherit;cursor:pointer;font-weight:600}
button.link{background:none;border:0;padding:0;color:var(--ww-accent-dark);text-decoration:underline;cursor:pointer;text-align:left}
.copy-status{position:fixed;left:18px;bottom:12px;margin:0;padding:4px 8px;font-size:12px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);z-index:5}
.copy-status:empty{display:none}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ww-detail .two{grid-template-columns:1fr}
.limits{margin:0;padding-left:18px}.limits li{margin:2px 0}
.ww-why-path{list-style:none;margin:6px 0;padding:0 0 0 12px;border-left:2px solid var(--ww-charcoal-rail)}
.ww-why-path li{position:relative;padding:3px 0}
.ww-why-path li::before{content:"";position:absolute;left:-17px;top:10px;width:8px;height:8px;background:var(--ww-cream);border:1px solid var(--ww-charcoal)}
.ww-why-step{display:block;font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ww-muted-text)}
.ww-why-target{background:rgba(191,78,50,0.1);outline:1px solid var(--ww-accent)}
.nav{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}
.nav button{width:100%;text-align:left;display:flex;flex-direction:column;gap:2px;padding:7px 8px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-panel);background:var(--ww-surface);color:inherit;cursor:pointer}
.nav button[aria-pressed="true"]{border-color:var(--ww-accent);box-shadow:inset 3px 0 0 var(--ww-accent)}
.nav-id{font-weight:700;word-break:break-all}.nav-type{font-size:12px;color:var(--ww-muted-text)}
.ww-table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--ww-inner-border);padding:6px 8px;text-align:left;vertical-align:top}
.graph{width:100%;height:auto;max-width:760px}.graph line{stroke:var(--ww-charcoal-rail);stroke-width:1.2}.graph marker path{fill:var(--ww-charcoal-rail)}
.graph .node rect{fill:var(--ww-surface);stroke:var(--ww-charcoal);stroke-width:1}.graph .node.target rect{stroke:var(--ww-accent);stroke-width:2.4}
.graph text{fill:var(--ww-ink);font:600 11px var(--font-ui)}.graph .t2{fill:var(--ww-muted-text);font-size:9.5px}.graph .layer{font-size:9px;font-weight:700;letter-spacing:0.16em;fill:var(--ww-muted-text)}

/* Readiness assembly: criterion pieces under the keystone. */
.ww-arch{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0}
.ww-keystone{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 40px 12px;background:var(--ww-stone);border:1.5px solid var(--ww-charcoal);clip-path:polygon(0 0,100% 0,88% 100%,12% 100%);text-align:center;transition:transform var(--ww-settle) var(--ww-ease)}
.ww-arch[data-fit="false"] .ww-keystone{transform:translateY(-8px);border-style:dashed}
.ww-course{list-style:none;margin:0;padding:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px;width:100%;background:var(--ww-mortar);border-top:2px solid var(--ww-charcoal)}
.ww-course-empty{min-height:40px;background:repeating-linear-gradient(45deg,transparent 0 5px,rgba(30,26,20,0.12) 5px 6px)}
.ww-piece{display:flex;flex-direction:column;gap:2px;padding:6px 8px;background:var(--ww-surface);border:1px solid var(--ww-charcoal);border-radius:var(--ww-radius-panel);transition:transform var(--ww-settle) var(--ww-ease)}
.ww-piece-id{font:700 10px var(--font-mono);color:var(--ww-muted-text)}.ww-piece-name{font-weight:700}.ww-piece-fit{font-size:11px;color:var(--ww-muted-text)}
.ww-piece-reason{font-size:10.5px}
.ww-piece[data-outcome="NOT_MET"]{background:repeating-linear-gradient(45deg,transparent 0 5px,rgba(30,26,20,0.14) 5px 6px);border-style:dashed;border-color:var(--ww-accent-dark)}
.ww-piece[data-outcome="INDETERMINATE"],.ww-piece[data-outcome="UNRECOGNISED"]{transform:translateY(5px);border-style:dashed}

/* Wallprint: running-bond courses. */
.ww-courses{display:flex;flex-direction:column;gap:4px;background:var(--ww-mortar);padding:4px;border:1px solid var(--ww-card-border)}
.ww-course-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:4px}
.ww-course-row.offset{padding-left:clamp(0px,6%,48px)}
.ww-brick{display:flex;flex-direction:column;gap:4px;padding:8px 10px;background:var(--ww-surface);border:1px solid var(--ww-stone-low);border-radius:var(--ww-radius-panel);min-width:0}
.ww-brick[data-attention="true"]{border-style:dashed;border-color:var(--ww-accent-dark)}
.ww-mini{list-style:none;margin:0;padding:0;font-size:12px}.ww-mini li{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.ww-brick[data-focus-node],.ww-course[data-focus-node]{cursor:pointer}
.ww-brick-key{background:none;border:0;padding:0;text-align:left;cursor:pointer;font-family:var(--font-ui)}
.ww-assembly-show{margin:4px 0 0}

/* Receipt: reserved, disabled. */
.ww-receipt-body{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
.ww-receipt-body>div{flex:1 1 260px}
.ww-qr-slot{flex:0 0 auto;width:96px;height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--ww-charcoal-rail);color:var(--ww-muted-text);font:700 14px var(--font-mono);background:repeating-linear-gradient(0deg,transparent 0 11px,var(--ww-inner-border) 11px 12px),repeating-linear-gradient(90deg,transparent 0 11px,var(--ww-inner-border) 11px 12px)}

/* WalletWallaby: optional, dismissible, peeks in once per cue and then holds still. */
.ww-wallaby{position:fixed;right:14px;bottom:12px;z-index:6;display:flex;align-items:flex-end;gap:6px;max-width:min(420px,calc(100vw - 28px));transition:transform var(--ww-settle) var(--ww-ease),opacity var(--ww-settle) var(--ww-ease)}
.ww-wallaby[hidden]{display:none}
.ww-wallaby[data-peek="out"]{transform:translateY(calc(100% + 16px));opacity:0}
.ww-wallaby[data-peek="in"]{transform:translateY(0);opacity:1}
.ww-wallaby-art{flex:0 0 auto;width:84px;height:84px;background-size:contain;background-repeat:no-repeat;background-position:bottom center}
.ww-wallaby-bubble{padding:8px 10px;background:var(--ww-surface);border:1px solid var(--ww-charcoal);border-radius:var(--ww-radius-panel);font-size:12.5px}
.ww-wallaby-bubble p{margin:0 0 6px}
@media (max-width:520px){.ww-wallaby-art{width:56px;height:56px}}

/* Elements of the phone composition. Hidden on wide panels, where the rail, toolbar and detail column carry the same
   controls and facts. */
.ww-rail-asset,.ww-icon-button,.ww-wall-menu,.ww-back,.ww-sheet-bar,.ww-sheet-actions,.ww-sheet-summary,.ww-strip,.ww-why-more,.ww-receipt-row,.ww-list{display:none}
.ww-icon-button{align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 10px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:var(--ww-ink);cursor:pointer;font-weight:700;letter-spacing:0.08em}
.ww-icon-button[aria-expanded="true"]{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}

/* Tablet (768 to 1023 px): The Wall about two thirds, the detail rail beside it, Wallprint and readiness beneath. */
@media (min-width:768px) and (max-width:1023px){
.ww-stage{grid-template-columns:minmax(0,2fr) minmax(240px,1fr)}
.ww-wall-svg[data-layout="portrait"]{height:clamp(420px,64vh,820px)}
}
/* A phone or small tablet on its side: the wide layout, and the detail rail takes about 40 % on the right. */
@media (min-width:768px) and (max-width:1023px) and (orientation:landscape) and (max-height:600px){
.ww-stage{grid-template-columns:minmax(0,3fr) minmax(220px,2fr)}
}

/* Below 1024 px (phones, tablets, phones on their side): a compact header and the critical state strip; the boundary,
   versions, lenses and modes fold behind the header menu. */
@media (max-width:1023px){
.ww-rail:has(.ww-rail-asset) .ww-rail-name{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-wall-hint{display:none}
/* 1. Compact identity header: mark, asset, chain, menu. Not sticky. */
.ww-rail{flex-wrap:nowrap;gap:10px;padding:6px 6px 6px 8px;min-height:52px;max-height:60px;position:relative}
.ww-mark{width:32px;height:32px;margin:0}
.ww-rail-asset{display:flex;align-items:baseline;gap:6px;margin:0;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ww-rail-symbol{font:600 17px/1.2 var(--font-display)}
.ww-rail-sep{color:var(--ww-muted-text)}
.ww-rail-chain{font-size:13px;color:var(--ww-muted-text)}
.ww-panel-toggle{display:inline-flex;flex:0 0 auto}
.ww-rail-facts{display:none}
/* Boundary, versions and lenses fold behind the header menu. */
.ww-panel-info{display:none}
#app[data-panel-open="true"] .ww-panel-info{display:block;margin-top:8px;padding:10px;border:1px solid var(--ww-charcoal);background:var(--ww-surface)}
.ww-panel-info .ww-boundary{margin-top:0}
/* 2. Critical state strip. */
.ww-strip{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:8px 0 0;padding:0}
.ww-strip-item{display:inline-flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:0;min-height:44px;padding:3px 9px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:inherit;font:inherit;line-height:1.25;text-align:left}
button.ww-strip-item{cursor:pointer}
.ww-strip-item:has(.chip[data-attention="true"]){border-style:dashed;border-color:var(--ww-accent-dark)}
.ww-strip-key{font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--ww-muted-text)}
.ww-strip .chip{border:0;padding:0;background:transparent;font-size:12px}
}
/* Very short screens (a phone on its side): The Wall gets the height; the state strip is left to the sheet and Wallprint. */
@media (max-width:1023px) and (orientation:landscape) and (max-height:500px){
.ww-strip{display:none}
}

/* Phone (up to 767 px): a focused instrument. Header, state strip, The Wall, then a detail sheet; the rest below. */
@media (max-width:767px){
body{padding:8px 12px calc(var(--ww-peek) + 24px);-webkit-tap-highlight-color:transparent}
button:not(:disabled):active,.ww-strip-item:active{filter:brightness(0.94)}
h2{font-size:14px;margin:4px 0 6px}
.ww-section,.ww-wall{padding:10px;margin-top:12px}
.ww-sr-phone,.ww-section-head h2,.ww-zoom-level,.ww-receipt>h2{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0;padding:0}
.ww-panel-info .ww-modes,.ww-panel-info .ww-tools{display:none}
/* 3. The Wall is the stage. */
.ww-flow>.ww-stage{order:1}.ww-flow>.ww-wallprint{order:2}.ww-flow>.ww-assembly{order:3}.ww-flow>.ww-list{order:4}.ww-flow>.ww-lineage{order:5}.ww-flow>.ww-criteria{order:6}.ww-flow>.ww-receipt{order:9}
#app[data-mode="trace"] .ww-flow>.ww-stage{order:1}#app[data-mode="trace"] .ww-flow>.ww-lineage{order:5}
.ww-flow>.ww-claims,.ww-flow>.ww-text-version{display:none}
.ww-stage{display:block;margin-top:10px}
.ww-wall{position:relative;padding:0;margin-top:0}
.ww-section-head{display:flex;align-items:center;justify-content:flex-end;min-height:52px;padding:4px 6px;border-bottom:1px solid var(--ww-inner-border)}
.ww-wall-hint{display:none}
.ww-wall-view{margin:0}
.ww-legend{margin:0;padding:0 10px;border-top:1px solid var(--ww-inner-border)}
.ww-legend summary{display:flex;align-items:center;min-height:44px}
/* 6. One compact control group on the stage's top edge, so it never sits on a piece. */
.ww-wall-tools{position:relative;z-index:8;flex-wrap:nowrap;gap:4px}
.ww-wall-tools>[data-reset-layout]{display:none}
.ww-zoom button{min-width:44px;min-height:44px;padding:0 10px;margin-right:-1px;background:var(--ww-cream)}
.ww-wall-menu-toggle{display:inline-flex;background:var(--ww-cream)}
.ww-wall-menu:not([hidden]){display:flex;flex-direction:column;position:absolute;top:50px;right:0;min-width:210px;background:var(--ww-cream);border:1px solid var(--ww-charcoal);box-shadow:0 8px 20px rgba(30,26,20,0.16)}
.ww-wall-menu button{min-height:44px;padding:0 14px;text-align:left;border:0;border-bottom:1px solid var(--ww-inner-border);background:transparent;color:var(--ww-ink);font:600 14px var(--font-ui);cursor:pointer}
.ww-wall-menu button[aria-pressed="true"]{box-shadow:inset 3px 0 0 var(--ww-charcoal)}
#app[data-mode="trace"] .ww-back{display:inline-flex;align-items:center;margin-right:auto;order:-1;min-height:44px;padding:0 12px;border:1px solid var(--ww-charcoal);background:var(--ww-charcoal);color:var(--ww-cream);font:600 13px var(--font-ui);cursor:pointer}
/* 8. The detail rail becomes a bottom sheet: peek, half, full. Only the sheet stays on screen while scrolling. */
.ww-detail{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:7;margin:0;height:var(--ww-peek);max-height:none;overflow:hidden;border:0;border-top:2px solid var(--ww-charcoal);border-radius:0;background:var(--ww-cream);padding:0 14px calc(env(safe-area-inset-bottom,0px) + 10px);box-shadow:0 -6px 18px rgba(30,26,20,0.12);transition:height var(--ww-settle) var(--ww-ease)}
.ww-detail[data-sheet="half"]{height:54vh;overflow-y:auto;overscroll-behavior:contain}
.ww-detail[data-sheet="full"]{height:calc(100vh - 16px);height:calc(100dvh - 16px);overflow-y:auto;overscroll-behavior:contain}
.ww-sheet-bar{display:block;position:sticky;top:0;z-index:1;background:var(--ww-cream);touch-action:none}
.ww-detail[data-sheet="peek"]{touch-action:none}
.ww-sheet-grip{display:flex;align-items:center;justify-content:center;width:100%;min-height:28px;padding:8px 0 6px;border:0;background:transparent;cursor:pointer}
.ww-sheet-grip span{display:block;width:40px;height:4px;border-radius:2px;background:var(--ww-charcoal-rail)}
.ww-sheet-actions{display:flex;gap:6px;position:sticky;bottom:calc(-10px - env(safe-area-inset-bottom,0px));margin:8px -14px 0;padding:8px 14px 10px;background:var(--ww-cream);border-top:1px solid var(--ww-charcoal-border)}
.ww-sheet-actions button{flex:1 1 0;min-height:44px;padding:0 8px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:var(--ww-ink);font:600 13px var(--font-ui);cursor:pointer}
.ww-detail[data-sheet="peek"] .ww-sheet-actions{display:none}
.ww-sheet-summary{display:block;margin:0 0 8px;cursor:pointer}
.ww-sheet-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;font:600 15px/1.3 var(--font-display)}
.ww-sheet-title>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ww-sheet-meaning{margin:2px 0 0;font-size:12.5px;color:var(--ww-muted-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ww-detail[data-sheet="peek"] [data-assertion-detail]>:not(.ww-sheet-summary),.ww-detail[data-sheet="peek"] .ww-node-detail>:not(.ww-sheet-summary){display:none}
.ww-detail .ww-eyebrow+h2,.ww-detail h2:first-of-type{margin-top:4px}
[data-assertion-detail]:not([hidden]){display:flex;flex-direction:column}
[data-assertion-detail]>section[aria-labelledby="h-states"]{order:1}[data-assertion-detail]>section[aria-labelledby="h-limits"]{order:2}[data-assertion-detail]>section[aria-labelledby="h-deps"]{order:3}[data-assertion-detail]>section[aria-labelledby="h-assertion"]{order:4}
.ww-detail button.copy{min-height:36px;padding:0 12px}
.copy-status{left:12px;bottom:calc(var(--ww-peek) + 10px)}
/* 10. The guide: a small card docked under the stage, so it never covers a piece or the sheet. */
.ww-wall>.ww-wallaby{position:static;display:flex;align-items:flex-start;gap:6px;max-width:none;margin:0;padding:8px 10px;border-top:1px solid var(--ww-inner-border);transform:none}
.ww-wall>.ww-wallaby[hidden]{display:none}
.ww-wall>.ww-wallaby[data-peek="out"]{opacity:0;transform:none}
.ww-wallaby-art{width:36px;height:36px}
.ww-wallaby-bubble{flex:1 1 auto;font-size:13px;border-color:var(--ww-charcoal-border)}
.ww-wallaby .ww-actions{gap:6px}
.ww-wallaby button{min-height:44px}
/* 12. Wallprint: a two-column summary; a tile with a list spans both. Each tile leads to its piece. */
.ww-courses{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px}
.ww-course-row{display:contents}
.ww-brick{padding:8px 10px;min-height:44px;gap:2px}
.ww-brick:has(.ww-mini){grid-column:1/-1}
/* 13. Readiness: a compact checklist under a small keystone, not six boxes. */
.ww-arch{align-items:stretch;padding:2px 0;gap:6px}
.ww-keystone{align-self:center;padding:6px 30px 8px}
.ww-keystone .small{display:none}
.ww-arch[data-fit="false"] .ww-keystone{transform:translateY(-4px)}
.ww-course{display:flex;flex-direction:column;gap:0;padding:0;background:none}
.ww-piece{flex-direction:row;align-items:center;gap:8px;min-height:44px;padding:8px 4px;border:0;border-bottom:1px solid var(--ww-inner-border);border-radius:0;background:none;transform:none}
.ww-piece::before{content:"✓";flex:0 0 18px;font-weight:700;text-align:center}
.ww-piece[data-outcome="NOT_MET"]::before,.ww-piece[data-outcome="INDETERMINATE"]::before{content:"!";color:var(--ww-accent-dark)}
.ww-piece[data-outcome="UNRECOGNISED"]::before{content:"?"}
.ww-piece[data-outcome="NOT_MET"],.ww-piece[data-outcome="INDETERMINATE"],.ww-piece[data-outcome="UNRECOGNISED"]{transform:none;background:none;border-left:2px dashed var(--ww-accent-dark);border-bottom-style:solid;border-bottom-color:var(--ww-inner-border)}
.ww-piece-id,.ww-piece-fit,.ww-piece-reason{display:none}
.ww-piece-name{flex:1 1 auto;min-width:0}
.ww-piece .chip,.ww-strip .chip,.ww-sheet-title .chip,.ww-list-meta .chip{white-space:nowrap;overflow-wrap:normal;flex:0 0 auto}
/* Criteria table: stacked rows, never a squeezed table. */
.ww-criteria table,.ww-criteria tbody,.ww-criteria tr,.ww-criteria th,.ww-criteria td{display:block}
.ww-criteria thead{display:none}
.ww-criteria tr{padding:6px 0;border-bottom:1px solid var(--ww-inner-border)}
.ww-criteria th,.ww-criteria td{border:0;padding:1px 0}
.ww-criteria td[data-label]::before{content:attr(data-label) ": ";font-size:11px;font-weight:700;color:var(--ww-muted-text)}
/* 14. List mode: search, filter chips, rows. */
.ww-list{display:block}
.ww-search{display:block;width:100%;min-height:44px;padding:8px 10px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-cream);color:var(--ww-ink);font:inherit}
.ww-filters{display:flex;gap:6px;overflow-x:auto;padding:8px 0;scrollbar-width:none}
.ww-filters button{flex:0 0 auto;min-height:44px;padding:0 12px;border:1px solid var(--ww-charcoal-border);border-radius:var(--ww-radius-badge);background:var(--ww-surface);color:var(--ww-ink);font:600 13px var(--font-ui);cursor:pointer}
.ww-filters button[aria-pressed="true"]{background:var(--ww-charcoal);color:var(--ww-cream);border-color:var(--ww-charcoal)}
.ww-list-rows{list-style:none;margin:0;padding:0}
.ww-list-rows li[hidden]{display:none}
.ww-list-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;min-height:52px;padding:8px 2px;border:0;border-bottom:1px solid var(--ww-inner-border);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ww-list-name{font-weight:700}
.ww-list-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px}
.ww-list-sub{max-width:100%}
/* 15. Receipt: one compact row. No QR placeholder, no large disabled panel. */
.ww-receipt{padding:4px 10px}
.ww-receipt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:52px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ww-receipt-row-text{display:flex;flex-direction:column}
.ww-receipt-body{display:none}
.ww-receipt[data-open="true"] .ww-receipt-body{display:block;padding-bottom:8px}
.ww-qr-slot{display:none}
/* 16. Text density: explanations fold behind "Why?". */
.ww-explain{display:none}
.ww-why-more{display:block;margin:0 0 6px;font-size:12px}
.ww-why-more summary{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:var(--ww-accent-dark);font-weight:700;cursor:pointer}
.ww-why-more p{margin:2px 0 6px}
.two,.kv>div{grid-template-columns:1fr}
}
/* A phone on its side: the wide Wall, and the detail sheet becomes a right-hand panel of about 40 %. */
@media (max-width:767px) and (orientation:landscape) and (max-height:500px){
body{padding-right:calc(40vw + 12px);padding-bottom:24px}
.ww-detail,.ww-detail[data-sheet]{top:0;left:auto;width:40vw;height:100vh;height:100dvh;overflow-y:auto;border-top:0;border-left:2px solid var(--ww-charcoal);box-shadow:-6px 0 18px rgba(30,26,20,0.12)}
.ww-detail[data-sheet="peek"] [data-assertion-detail]>:not(.ww-sheet-summary),.ww-detail[data-sheet="peek"] .ww-node-detail>:not(.ww-sheet-summary){display:revert}
.ww-sheet-grip{display:none}
.ww-detail[data-sheet="peek"] .ww-sheet-actions{display:flex}
.copy-status,.ww-wallaby{bottom:10px;right:calc(40vw + 12px)}
}

/* Reduced motion: from the system setting or the panel's own toggle. Nothing animates; meaning is unchanged. */
#app[data-motion="reduced"] *,#app[data-motion="reduced"]~.ww-wallaby{transition:none!important;animation:none!important}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}

`;
