// The WallPrint disclosure document's stylesheet: a forensic disclosure record rendered as a contemporary technical
// instrument. Warm technical paper (the canvas's parchment rail token), a sparse drafting grid, crop marks and a
// registration mark, narrow umber rules, editorial Sora and Manrope, IBM Plex Mono for every exact value (through the
// page's `code` rule), ledger annotations and restrained terracotta. Every colour is a WalletWall token or a named mix
// of them; no new hue, no gradient but the sheet grid, no shadow, bevel, pill or seal.
//
// State colour is a secondary cue only: every state, lifecycle step, receipt and replay outcome is written in words and
// carried by a chip, a dot or a dashed rule as well. Meaning never depends on colour. The Verify readout keeps three
// edges: solid for a result, dotted for an absent result (absence is not failure), dashed brick for a mismatch, an invalid
// record or a result the document does not recognise. A positive result is never singled out: no fill, no seal, no glow.
//
// Layout is container-driven (`@container wp`), so the document recomposes when the host panel resizes, not only when the
// browser does; a media-query fallback covers engines without container queries. Nothing is reordered with `order`,
// nothing critical is hidden at any width: limitations, assessments, lineage, receipt and verification stay on screen.
//
// Motion: one orchestrated reveal (registration mark, identity, assessment, evidence columns, provenance line, record and
// receipt metadata), each step a 280 ms rise on opacity and a 4 px transform. The base state of every animated element
// is its final state, so reduced motion (the system setting or the panel's toggle, both handled by the page's global
// rule) shows the finished document at once. No loop, no pulse, no celebration.

/* Stacked table rows: the header row stays in the accessibility tree, every cell carries its column label. */
const STACKED = (table) => `
${table} thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
${table},${table} tbody,${table} tr,${table} th,${table} td{display:block}
${table} tr{padding:6px 0;border-bottom:1px solid var(--ww-cut)}
${table} th,${table} td{border:0;padding:1px 0}
${table} td[data-label]::before{content:attr(data-label) ": ";font-size:11px;font-weight:700;color:var(--ww-muted-text)}
`;

const NARROW = `
.wp-plate{padding:14px 14px 18px}
.wp-columns{grid-template-columns:1fr;gap:0}
.wp-title{font-size:22px}
.wp-assessment-word{font-size:24px}
.wp-facts>div,.wp-verify-grid>div{grid-template-columns:1fr}
.wp-ledger-row{grid-template-columns:18px minmax(0,1fr)}
.wp-ledger-detail,.wp-ledger-hint{grid-column:2 / -1}
.wp-chain{grid-template-columns:1fr;gap:12px 0;padding-left:20px}
.wp-chain::before{left:5px;right:auto;top:4px;bottom:4px;width:1px;height:auto;transform-origin:center top;animation-name:wp-draw-y}
.wp-stage{padding-top:0}
.wp-stage-mark{left:-20px;top:3px}
.wp-lineage{flex-direction:column;gap:12px}
.wp-lineage-arrow{display:none}
.wp-lineage-node[data-link]::before{content:"";display:block;width:1px;height:12px;margin:0 0 2px 16px;background:var(--ww-umber)}
.wp-checks{grid-template-columns:1fr}
.wp-check-fields>div,.wp-receipt-fields>div{grid-template-columns:1fr}
${STACKED(".wp-table")}`;

export const WALLPRINT_CSS = `
.wp{container-type:inline-size;container-name:wp;margin-top:12px;min-width:0}
.wp-plate{position:relative;padding:18px 22px 22px;background-color:var(--ww-rail);background-image:linear-gradient(rgba(79,60,53,0.055) 1px,transparent 1px),linear-gradient(90deg,rgba(79,60,53,0.055) 1px,transparent 1px);background-size:64px 64px;border:1px solid var(--ww-seam);border-radius:var(--ww-radius-panel)}
/* Crop marks at two corners of the plate: the print is a registered object, not a card. */
.wp-plate::before,.wp-plate::after{content:"";position:absolute;width:14px;height:14px;pointer-events:none;border:0 solid var(--ww-umber-deep);opacity:0.6}
.wp-plate::before{top:6px;left:6px;border-top-width:1px;border-left-width:1px}
.wp-plate::after{bottom:6px;right:6px;border-bottom-width:1px;border-right-width:1px}
.wp-fixture{margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--ww-cut)}
.wp-record{min-width:0;outline:none}
.wp-record[hidden]{display:none}
.wp h2,.wp h3,.wp h4{margin:0}
.wp h3{font:600 15px/1.25 var(--font-display);letter-spacing:-0.01em;color:var(--ww-charcoal);text-transform:none;padding:8px 0 6px;margin-top:14px;border-top:1px solid var(--ww-cut-strong)}
.wp h4{font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-brick-low);margin:12px 0 4px}
.wp-eyebrow{margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-brick-low)}
.wp-eyebrow-inline{font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-brick-low)}
/* Head: registration mark, eyebrow, the full id on the right; then identity; then the current assessment. */
.wp-head-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wp-reg{width:20px;height:20px;flex:0 0 auto;fill:none;stroke:var(--ww-accent);stroke-width:1.4;stroke-linecap:round}
.wp-id{margin:0 0 0 auto;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}
.wp-version-of{color:var(--ww-muted-text)}
.wp-identity{margin-top:14px}
.wp-title{font:600 26px/1.15 var(--font-display);letter-spacing:-0.015em;color:var(--ww-charcoal)}
.wp-subtitle{margin:4px 0 0;font-size:13px;color:var(--ww-muted-text)}
.wp-current{margin-top:16px;padding:12px 0;border-top:1px solid var(--ww-cut-strong);border-bottom:1px solid var(--ww-cut)}
.wp-assessment{margin:4px 0 0}
.wp-assessment-word{font:600 28px/1.1 var(--font-display);letter-spacing:0.02em;color:var(--ww-charcoal)}
.wp-assessment-word[data-attention="true"]{color:var(--ww-brick-low)}
.wp-assessment-hint{margin:6px 0 0;font-size:13px;max-width:62ch}
.wp-principle{margin:10px 0 0;font:600 13.5px/1.4 var(--font-ui);color:var(--ww-umber-deep)}
.wp-status-line{margin:10px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12.5px}
/* The two evidence columns: why WalletWall says this, and the record's lifecycle ledger. */
.wp-columns{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:0 28px;align-items:start}
.wp-facts>div{grid-template-columns:150px minmax(0,1fr)}
.wp-codes li{margin:3px 0}
.wp-limitations,.wp-violations,.wp-diagnostics{margin-top:4px}
/* Ledger: one row per lifecycle state, reached rows with a filled dot and their instant, unreached rows open. */
.wp-ledger{list-style:none;margin:6px 0 10px;padding:0}
.wp-ledger-row{display:grid;grid-template-columns:18px 112px minmax(0,1fr);gap:2px 10px;padding:6px 0;border-bottom:1px solid var(--ww-cut);align-items:baseline}
.wp-ledger-row[data-reached="false"]{color:var(--ww-muted-text)}
.wp-ledger-row[data-attention="true"] .wp-dot,.wp-ledger-row[data-attention="true"] .wp-ledger-state code{color:var(--ww-brick-low)}
.wp-dot{font-size:11px;line-height:1}
.wp-ledger-detail{display:flex;flex-direction:column;gap:2px;min-width:0}
.wp-ledger-hint{grid-column:2 / -1}
.wp-reason{display:block;font-size:12.5px}
.wp-ref{display:block}
/* Exact values: full, monospace, selectable, with an always-present copy control. */
.wp-copyable{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;max-width:100%;min-width:0}
.wp-exact,.wp-raw-text{user-select:all;-webkit-user-select:all;overflow-wrap:anywhere}
.wp-copyable button.copy{opacity:1}
/* Tables keep their roles when stacked on a narrow plate (role attributes in the markup). */
.wp-table{font-size:12.5px}
.wp-table th[scope="col"]{white-space:nowrap}
.wp-table th[scope="row"]{font-weight:600}
.wp-reason-inline{font-weight:600}
.wp-assessments-note{margin:8px 0 0;font-size:12.5px}
/* Provenance: five stages on one drafted line that draws once; an absent stage keeps its place, dashed. */
.wp-chain{position:relative;list-style:none;margin:10px 0 0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0 12px}
.wp-chain::before{content:"";position:absolute;left:5px;right:6px;top:5px;height:1px;background:var(--ww-umber);transform-origin:left center;animation:wp-draw 560ms var(--ww-ease) 480ms backwards}
.wp-stage{position:relative;padding-top:16px;min-width:0}
.wp-stage-mark{position:absolute;top:0;left:0;width:11px;height:11px;border:1px solid var(--ww-umber-deep);background:var(--ww-rail)}
.wp-stage[data-present="true"] .wp-stage-mark{background:var(--ww-umber)}
.wp-stage[data-present="false"] .wp-stage-mark{border-style:dashed}
.wp-stage-title{display:block;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-umber-deep)}
.wp-stage[data-present="false"] .wp-stage-title{color:var(--ww-muted-text)}
.wp-stage-entries{list-style:none;margin:4px 0 0;padding:0}
.wp-stage-entries li{margin:2px 0;font-size:12px;overflow-wrap:anywhere}
.wp-stage-empty,.wp-stage-note{margin:4px 0 0}
/* Lineage: root first; each later version hangs off its predecessor by a drafted connector with a small chevron. */
.wp-lineage{list-style:none;margin:8px 0;padding:0;display:flex;flex-wrap:wrap;gap:10px 30px;align-items:flex-start}
.wp-lineage-node{position:relative;min-width:0;display:flex;flex-direction:column;gap:4px}
.wp-lineage-arrow{position:absolute;left:-26px;top:22px;width:22px;height:1px;background:var(--ww-umber)}
.wp-lineage-arrow::after{content:"";position:absolute;right:0;top:-3px;width:5px;height:5px;border-top:1px solid var(--ww-umber);border-right:1px solid var(--ww-umber);transform:rotate(45deg)}
.wp-version{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-height:44px;padding:6px 10px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-panel);background:var(--ww-node);color:var(--ww-ink);font:inherit;text-align:left;cursor:pointer;max-width:100%}
.wp-version[aria-current="true"]{border-color:var(--ww-brick-low);border-left-width:2px;background:var(--ww-label)}
.wp-version-label{font:600 13px var(--font-display);color:var(--ww-charcoal)}
.wp-version-id{min-width:0;overflow-wrap:anywhere}
.wp-link{margin:0;font-size:12px}
.wp-diff{margin-top:10px}
.wp-diff-group{margin-top:4px}
/* Verify: four questions in one grid, each a quiet row of the instrument. A positive result is the plate's resting state
   (no rule singles it out); absence is a dotted neutral edge; only a mismatch, an invalid record or an unrecognised
   result gets the dashed brick edge. No filled panel, no seal, no glow. */
.wp-verify-grid>div{grid-template-columns:200px minmax(0,1fr)}
.wp-verify-intro{margin:6px 0 0}
.wp-boundary{margin:8px 0;padding:8px 10px;border-left:2px solid var(--ww-umber-deep);background:var(--ww-node);font-size:12.5px}
.wp-checks{list-style:none;margin:10px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.wp-check{min-width:0;padding:10px 12px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-panel)}
.wp-check[data-result="NOT_CARRIED"],.wp-check[data-result="NO_DIGEST"],.wp-check[data-receipt="UNAVAILABLE"],.wp-check[data-receipt="UNCHECKED"],.wp-check[data-replay="UNREPLAYABLE"],.wp-check[data-replay="NOT_CARRIED"]{border-style:dotted}
.wp-check[data-result="INVALID"],.wp-check[data-result="MISMATCH"],.wp-check[data-result="UNRECOGNISED"],.wp-check[data-receipt="MISMATCH"],.wp-check[data-receipt="UNRECOGNISED"],.wp-check[data-replay="MISMATCH"],.wp-check[data-replay="UNRECOGNISED"]{border-style:dashed;border-color:var(--ww-brick-low)}
.wp-check h4{margin:0;display:flex;align-items:baseline;gap:8px}
.wp-check-no{font-size:10.5px;font-weight:700;letter-spacing:0.08em;line-height:14px;padding:0 4px;border:1px solid var(--ww-umber);color:var(--ww-umber-deep)}
.wp-check-q{margin:6px 0 0;font-size:13px;font-weight:600;color:var(--ww-charcoal)}
.wp-check-a{margin:6px 0 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12.5px}
.wp-check-meaning{max-width:62ch}
.wp-check-fields>div,.wp-receipt-fields>div{grid-template-columns:150px minmax(0,1fr)}
.wp-receipt-standing{margin:8px 0}
.wp-receipt-lineage{margin-top:8px;padding-top:6px;border-top:1px solid var(--ww-cut)}
.wp-version-inline{min-height:36px;padding:0 10px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-badge);background:var(--ww-label);color:var(--ww-umber-deep);font:700 11.5px var(--font-ui);cursor:pointer}
.wp-independent{margin:10px 0 0;font-size:12.5px;max-width:72ch}
/* Jump: one row of section controls in the chip material under the status line; buttons, never links. */
.wp-jump{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.wp-jump button{min-height:36px;padding:0 12px;border:1px solid var(--ww-cut-strong);border-radius:var(--ww-radius-badge);background:var(--ww-label);color:var(--ww-charcoal);font:700 12px var(--font-ui);cursor:pointer}
.wp-jump button:hover{border-color:var(--ww-brick-low)}
/* Registration and derivation: the readout grid, then five steps on one drafted rail (a static hairline; nothing draws). */
.wp-registration,.wp-derivation{margin-top:14px}
.wp-steps{list-style:none;margin:8px 0 0;padding:0 0 0 20px;position:relative}
.wp-steps::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:var(--ww-umber)}
.wp-step{position:relative;padding:4px 0 8px;min-width:0}
.wp-step::before{content:"";position:absolute;left:-20px;top:8px;width:11px;height:11px;border:1px solid var(--ww-umber-deep);background:var(--ww-rail)}
.wp-step-title{display:block;font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--ww-umber-deep)}
.wp-step p{margin:4px 0 0;font-size:12.5px}
.wp-raw-body{display:block}
.wp-raw-text{display:block;white-space:pre-wrap;font-size:11px;max-height:320px;overflow:auto;padding:8px;background:var(--ww-node);border:1px solid var(--ww-cut)}
.wp-invariants{margin-top:14px}
.wp-foot{margin:12px 0 0}
/* The reveal: six steps, in reading order. Base state = final state; the animation only adds the entrance (fill-mode
   backwards: the from-state holds through the delay, and nothing is kept after). It plays once per document: after the
   first render the page script marks the document revealed, so choosing another version never replays it. */
.wp-rise{animation:wp-rise var(--ww-settle) var(--ww-ease) backwards}
.wp[data-wp-revealed="true"] .wp-rise,.wp[data-wp-revealed="true"] .wp-chain::before{animation:none}
/* Reduced motion reaches the drawn provenance line too: the page's rule matches elements, not pseudo-elements. */
#app[data-motion="reduced"] .wp-chain::before{animation:none!important}
@media (prefers-reduced-motion:reduce){.wp-chain::before{animation:none!important}}
.wp-rise[data-wp-step="0"]{animation-delay:0ms}
.wp-rise[data-wp-step="1"]{animation-delay:120ms}
.wp-rise[data-wp-step="2"]{animation-delay:240ms}
.wp-rise[data-wp-step="3"]{animation-delay:360ms}
.wp-rise[data-wp-step="4"]{animation-delay:480ms}
.wp-rise[data-wp-step="5"]{animation-delay:600ms}
@keyframes wp-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes wp-draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes wp-draw-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
/* Compositions follow the host panel's own width. */
@container wp (max-width:719px){${NARROW}}
@container wp (min-width:720px) and (max-width:1023px){
.wp-columns{gap:0 18px}
.wp-facts>div{grid-template-columns:120px minmax(0,1fr)}
.wp-verify-grid>div{grid-template-columns:160px minmax(0,1fr)}
.wp-checks{gap:10px}
.wp-check-fields>div,.wp-receipt-fields>div{grid-template-columns:120px minmax(0,1fr)}
}
/* The eight-column assessments table stacks its rows well before the plate is narrow, so no id wraps mid-word. */
@container wp (min-width:720px) and (max-width:959px){${STACKED(".wp-assessments .wp-table")}}
@supports not (container-type:inline-size){
@media (max-width:767px){${NARROW}}
}
/* The page's phone rules reserve room for a detail sheet and hide the lens label; the document has no sheet and keeps
   its label. */
@media (max-width:767px){
body:has(.wp){padding-bottom:24px}
body:has(.wp) .copy-status{bottom:12px}
body:has(.wp) .ww-lens-badge{display:inline-block}
}
/* Touch: every control takes at least 44 px; copy controls 36 px. */
@media (pointer:coarse){
.wp-version{min-height:44px}
.wp-copyable button.copy{min-height:36px;padding:0 12px}
.wp .wp-more>summary{min-height:44px}
.wp-jump button,.wp-version-inline{min-height:44px}
}
`;
