// The Wall: WalletWall's relationship graph for one evaluated bundle. Pure functions: the panel's view (the WalletWall MCP
// results plus the bundle as presented) in, a node and edge model, a deterministic force layout and escaped SVG out.
//
// Rules this file must keep:
//  - It never computes, upgrades or downgrades a support, freshness, finality, authority, conflict or readiness state. A
//    piece carries exactly the state the WalletWall MCP server returned for it, or no state.
//  - Geometry is never the only carrier of meaning: every piece has a text label, an accessible name and a row in the
//    text version of The Wall.
//  - The layout is deterministic (no randomness, no clock): the same view always produces the same picture.

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const short = (s, n = 18) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A shortened address for a piece's face only. The full value is in the piece's accessible name and in its detail. */
export const shortAddress = (a) => {
  const t = String(a ?? "");
  return t.length > 14 ? `${t.slice(0, 6)}…${t.slice(-4)}` : t;
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

export const ASSERTION_LABELS = {
  ASSET_IDENTITY: "Asset identity",
  TOKEN_BALANCE_AT_BLOCK: "Balance at block",
  TOKEN_USD_PRICE: "USD price",
  TOKEN_USD_VALUE: "USD value",
  VAULT_TECHNICAL_READINESS: "Vault readiness",
};

export const SOURCE_KIND_LABELS = {
  CHAIN_STATE: "Chain state",
  ISSUER_PUBLICATION: "Issuer publication",
  PROVIDER_ENDPOINT: "Provider endpoint",
  USER_INPUT: "User input",
  WALLETWALL_RULES: "WalletWall rules",
};

/** The node taxonomy: what each kind of piece is and the architectural shape it is drawn as. */
export const NODE_TYPES = {
  authority: { name: "Issuer or protocol authority", shape: "seal plate", w: 144, h: 40 },
  source: { name: "Source", shape: "source plate", w: 132, h: 38 },
  observation: { name: "Observation", shape: "measurement tile", w: 132, h: 36 },
  wallmark: { name: "Wallmark", shape: "stamped identity seal", w: 164, h: 52 },
  assertion: { name: "Assertion", shape: "fitted piece", w: 156, h: 44 },
  derivation: { name: "WalletWall derivation", shape: "hinge plate", w: 132, h: 30 },
  readiness: { name: "Vault readiness", shape: "keystone", w: 176, h: 62 },
  conflict: { name: "Conflict", shape: "split seam", w: 76, h: 30 },
  gap: { name: "Missing piece", shape: "empty slot", w: 140, h: 36 },
  snapshot: { name: "Snapshot slot", shape: "reserved slot", w: 136, h: 34 },
  stablecoin: { name: "Stablecoin", shape: "brick", w: 124, h: 40 },
  contract: { name: "Contract", shape: "address plate", w: 168, h: 30 },
  wallet: { name: "Wallet", shape: "address brick", w: 168, h: 32 },
  chain: { name: "Chain", shape: "structural anchor", w: 108, h: 32 },
};

/**
 * The edge taxonomy. Every edge points from the thing a piece rests on to the piece resting on it. `why` marks the
 * evidence path (source, observation, assertion, derivation, readiness) that "Why WalletWall says this" traces.
 */
export const EDGE_KINDS = {
  speaks: { name: "speaks through", why: true, len: 170 },
  observed: { name: "observed", why: true, len: 170 },
  supports: { name: "supports", why: true, len: 170 },
  input: { name: "is an input to", why: true, len: 170 },
  generates: { name: "generates", why: true, len: 170 },
  missing: { name: "is missing for", why: true, len: 150 },
  conflict: { name: "conflicts at", why: true, len: 70 },
  supersedes: { name: "is superseded by", why: true, len: 90 },
  names: { name: "names", why: false, len: 110 },
  issuer: { name: "is named as issuer by", why: false, len: 150 },
  subject: { name: "is the subject of", why: false, len: 120 },
  anchors: { name: "anchors", why: false, len: 90 },
  reserved: { name: "reserves", why: false, len: 90 },
};

const COL = 188;
const FINALITY_SHORT = { FINALIZED: "finalized", UNFINALIZED: "unfinalized", UNKNOWN_FINALITY: "finality unknown" };
const COLUMN = { authority: 0, source: 1, observation: 2, wallmark: 3, assertion: 3, conflict: 3.62, derivation: 4, readiness: 5, snapshot: 5 };

/** Builds the pieces and connections of The Wall from the panel view. */
export function buildWall(view) {
  const nodes = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const add = (id, type, fields) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, w: NODE_TYPES[type].w, h: NODE_TYPES[type].h, ...fields });
    return nodes.get(id);
  };
  const link = (from, to, kind) => {
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (from === to || edgeKeys.has(key) || !nodes.has(from) || !nodes.has(to)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };

  const sources = list(view.sources).filter(isObject);
  const observations = list(view.observations).filter(isObject);
  const assertions = list(view.assertions).filter(isObject);
  const derivations = list(view.derivations).filter(isObject);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const obsById = new Map(observations.map((o) => [o.id, o]));

  // Authorities and sources.
  for (const s of sources) {
    if (typeof s.authorityId === "string" && s.authorityId !== "") add(`auth:${s.authorityId}`, "authority", { label: s.authorityId, sub: "authority", data: { authorityId: s.authorityId } });
    add(`src:${s.id}`, "source", { label: SOURCE_KIND_LABELS[s.kind] ?? String(s.kind ?? "source"), sub: s.transport?.retrievedVia ? `via ${s.transport.retrievedVia}` : s.authorityId ? String(s.authorityId) : String(s.id), data: s });
    if (typeof s.authorityId === "string" && s.authorityId !== "") link(`auth:${s.authorityId}`, `src:${s.id}`, "speaks");
  }

  // Observations. A source an observation names but the bundle lacks is drawn as a missing piece, never filled in.
  for (const o of observations) {
    add(`obs:${o.id}`, "observation", { label: String(o.id), sub: `${o.result === "VALUE" ? "value" : String(o.result ?? "?").toLowerCase().replace("_", " ")} · ${FINALITY_SHORT[o.finality] ?? "finality ?"}`, missing: o.result !== "VALUE", data: o });
    if (sourceById.has(o.sourceId)) link(`src:${o.sourceId}`, `obs:${o.id}`, "observed");
    else {
      add(`gap:src:${o.sourceId}`, "gap", { label: `Source ${short(o.sourceId, 14)}`, sub: "not in the bundle", missing: true, gapFor: "source", column: 1, data: { id: o.sourceId } });
      link(`gap:src:${o.sourceId}`, `obs:${o.id}`, "missing");
    }
  }

  // Assertions, each carrying the state the MCP server returned.
  for (const a of assertions) {
    const e = a.evaluation ?? null;
    const type = a.claimType === "ASSET_IDENTITY" ? "wallmark" : a.claimType === "VAULT_TECHNICAL_READINESS" ? "readiness" : "assertion";
    add(`as:${a.id}`, type, {
      label: type === "wallmark" ? "Wallmark" : ASSERTION_LABELS[a.claimType] ?? String(a.claimType),
      sub: String(a.id),
      state: e ? e.supportState : null,
      freshness: e ? e.freshnessState : null,
      assertionId: a.id,
      superseded: Boolean(e?.supersededBy),
      symbol: type === "wallmark" && isObject(a.value) ? a.value.symbol : undefined,
      data: a,
    });
  }
  for (const a of assertions) {
    const deps = a.evaluation?.dependencies;
    for (const id of list(deps?.observationIds)) {
      if (obsById.has(id)) link(`obs:${id}`, `as:${a.id}`, "supports");
      else {
        add(`gap:obs:${id}`, "gap", { label: `Observation ${short(id, 12)}`, sub: "not in the bundle", missing: true, gapFor: "observation", column: 2, data: { id } });
        link(`gap:obs:${id}`, `as:${a.id}`, "missing");
      }
    }
  }

  // WalletWall derivations: inputs into the hinge, the hinge into the assertion it generated.
  const assertionIds = new Set(assertions.map((a) => a.id));
  for (const d of derivations) {
    add(`drv:${d.id}`, "derivation", { label: "Derivation", sub: `${d.ruleId ?? "?"}`, data: d });
    for (const id of list(d.inputAssertionIds)) {
      if (assertionIds.has(id)) link(`as:${id}`, `drv:${d.id}`, "input");
      else {
        add(`gap:as:${id}`, "gap", { label: `Input ${short(id, 14)}`, sub: "not in the bundle", missing: true, gapFor: "assertion", column: 3, data: { id } });
        link(`gap:as:${id}`, `drv:${d.id}`, "missing");
      }
    }
    if (assertionIds.has(d.outputAssertionId)) link(`drv:${d.id}`, `as:${d.outputAssertionId}`, "generates");
  }
  // Input assertions named by an evaluation but not reached through a derivation record.
  for (const a of assertions) {
    for (const id of list(a.evaluation?.dependencies?.assertionIds)) {
      const viaDerivation = derivations.some((d) => d.outputAssertionId === a.id && list(d.inputAssertionIds).includes(id));
      if (!viaDerivation && assertionIds.has(id)) link(`as:${id}`, `as:${a.id}`, "input");
    }
  }

  // Conflicts as returned by the MCP server: a split seam between the two pieces.
  for (const a of assertions) {
    for (const other of list(a.evaluation?.conflictsWith)) {
      if (!assertionIds.has(other)) continue;
      const [x, y] = [a.id, other].sort();
      const id = `conflict:${x}|${y}`;
      add(id, "conflict", { label: "Conflict", sub: `${short(x, 10)} / ${short(y, 10)}`, data: { between: [x, y] } });
      link(`as:${x}`, id, "conflict");
      link(`as:${y}`, id, "conflict");
    }
  }

  // Supersession: the earlier piece stays as a faint historical layer next to the one that replaced it.
  for (const a of assertions) {
    const by = a.evaluation?.supersededBy;
    if (typeof by === "string" && assertionIds.has(by)) link(`as:${a.id}`, `as:${by}`, "supersedes");
  }

  // Readiness that could not be assessed because a required input is missing: a visible gap, not a filled one.
  const readiness = view.readiness;
  if (isObject(readiness) && typeof readiness.errorCode === "string" && nodes.has(`as:${readiness.assertionId}`)) {
    add("gap:readiness-input", "gap", { label: "Required input", sub: "missing", missing: true, gapFor: "readiness", column: 4, data: { code: readiness.errorCode } });
    link("gap:readiness-input", `as:${readiness.assertionId}`, "missing");
  }
  for (const n of nodes.values()) {
    if (n.type === "readiness") {
      if (isObject(readiness) && readiness.assertionId === n.assertionId && isObject(readiness.result)) n.classification = readiness.result.classification;
      add("snapshot:reserved", "snapshot", { label: "Snapshot slot", sub: "reserved, not available", data: {} });
      link(n.id, "snapshot:reserved", "reserved");
    }
  }

  // The foundation course: the subjects the claims are about (chain, contract, wallet) and the stablecoin a Wallmark names.
  for (const a of assertions) {
    const s = isObject(a.subject) ? a.subject : {};
    const chain = typeof s.chainId === "string" ? s.chainId : null;
    const chainNode = chain === null ? null : add(`chain:${chain}`, "chain", { label: `Chain ${chain}`, sub: "chain ID", data: { chainId: chain } }).id;
    const contract = a.claimType === "ASSET_IDENTITY" ? s.address : a.claimType === "VAULT_TECHNICAL_READINESS" ? undefined : s.token;
    if (typeof contract === "string") {
      const id = `contract:${chain ?? "?"}|${contract}`;
      add(id, "contract", { label: shortAddress(contract), address: contract, chainId: chain, sub: "contract", data: { address: contract, chainId: chain } });
      if (chainNode) link(chainNode, id, "anchors");
      link(id, `as:${a.id}`, "subject");
    }
    if (a.claimType === "TOKEN_BALANCE_AT_BLOCK" && typeof s.holder === "string") {
      const id = `wallet:${chain ?? "?"}|${s.holder}`;
      add(id, "wallet", { label: shortAddress(s.holder), address: s.holder, chainId: chain, sub: "wallet", data: { address: s.holder, chainId: chain } });
      if (chainNode) link(chainNode, id, "anchors");
      link(id, `as:${a.id}`, "subject");
    }
    if (a.claimType === "ASSET_IDENTITY" && isObject(a.value)) {
      if (typeof a.value.symbol === "string") {
        const id = `asset:${chain ?? "?"}|${String(s.address ?? "")}|${a.value.symbol}`;
        add(id, "stablecoin", { label: a.value.symbol, sub: "as presented", data: { symbol: a.value.symbol, decimals: a.value.decimals, chainId: chain, address: s.address } });
        link(`as:${a.id}`, id, "names");
      }
      if (typeof a.value.issuerAuthorityId === "string") {
        const id = `auth:${a.value.issuerAuthorityId}`;
        if (!nodes.has(id)) add(id, "authority", { label: a.value.issuerAuthorityId, sub: "named, no source", unattested: true, data: { authorityId: a.value.issuerAuthorityId } });
        link(id, `as:${a.id}`, "issuer");
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}

/**
 * A small deterministic force simulation: link springs, column and band anchors, and rectangle collision. It is used
 * twice with identical inputs: on the server to place the pieces, and in the page to play the assembly when the state
 * changes. It is self-contained on purpose (the page embeds its source), so it must not refer to anything outside itself.
 */
export function forceLayout(nodes, edges, ticks) {
  const byId = new Map();
  for (const n of nodes) {
    byId.set(n.id, n);
    n.vx = 0;
    n.vy = 0;
  }
  const links = [];
  for (const e of edges) {
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    if (s && t) links.push({ s, t, len: e.len, k: e.k });
  }
  let alpha = 1;
  const decay = 1 - Math.pow(0.001, 1 / ticks);
  let done = 0;
  function step() {
    if (done >= ticks) return false;
    for (const l of links) {
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = ((d - l.len) / d) * l.k * alpha;
      l.s.vx += dx * f;
      l.s.vy += dy * f;
      l.t.vx -= dx * f;
      l.t.vy -= dy * f;
    }
    for (const n of nodes) {
      if (n.ax !== null) n.vx += (n.ax - n.x) * n.kx;
      if (n.ay !== null) n.vy += (n.ay - n.y) * n.ky;
    }
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 0.58;
      n.vy *= 0.58;
      n.x += n.vx;
      n.y += n.vy;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const minX = (a.w + b.w) / 2 + 22;
        const minY = (a.h + b.h) / 2 + 16;
        if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
        if (dx === 0 && dy === 0) dy = 1;
        const px = minX - Math.abs(dx);
        const py = minY - Math.abs(dy);
        const wa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const wb = 1 - wa - (a.fixed && b.fixed ? 1 : 0);
        if (px < py) {
          const sx = dx < 0 ? -1 : 1;
          a.x -= sx * px * wa;
          b.x += sx * px * wb;
        } else {
          const sy = dy < 0 ? -1 : 1;
          a.y -= sy * py * wa;
          b.y += sy * py * wb;
        }
      }
    }
    alpha -= alpha * decay;
    done++;
    return true;
  }
  return { step, ticks };
}

/** The path of one connection, clipped to the two pieces' outlines. A conflict seam is drawn split in the middle. */
export function edgePath(a, b, kind) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const clip = (n) => Math.min(ux === 0 ? Infinity : (n.w / 2 + 4) / Math.abs(ux), uy === 0 ? Infinity : (n.h / 2 + 4) / Math.abs(uy), len / 2 - 1);
  const s = clip(a);
  const t = clip(b);
  const x1 = a.x + ux * s;
  const y1 = a.y + uy * s;
  const x2 = b.x - ux * t;
  const y2 = b.y - uy * t;
  const f = (v) => (Math.round(v * 10) / 10).toString();
  if (kind === "conflict") {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const g = 6;
    const nx = -uy * 4;
    const ny = ux * 4;
    return `M${f(x1)} ${f(y1)}L${f(mx - ux * g + nx)} ${f(my - uy * g + ny)}M${f(mx + ux * g - nx)} ${f(my + uy * g - ny)}L${f(x2)} ${f(y2)}`;
  }
  return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
}

/** Sets each piece's anchors and deterministic starting position, then runs the layout to rest. */
export const LAYOUT_TICKS = 160;
export function layoutWall(model) {
  const { nodes, edges } = model;
  const columnOf = (n) => (n.type === "gap" ? n.column : COLUMN[n.type]);
  const columns = new Map();
  for (const n of nodes) {
    const c = columnOf(n);
    if (c === undefined) continue;
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c).push(n);
  }
  let half = 0;
  for (const [c, members] of columns) {
    const step = 76;
    members.forEach((n, i) => {
      n.ax = c * COL;
      n.kx = 0.3;
      n.ay = 0;
      n.ky = 0.006;
      n.x0 = c * COL;
      n.y0 = (i - (members.length - 1) / 2) * step;
      half = Math.max(half, Math.abs(n.y0) + n.h);
    });
  }
  const band = half + 72;
  const foundation = nodes.filter((n) => columnOf(n) === undefined);
  foundation.forEach((n, i) => {
    n.ax = null;
    n.kx = 0;
    n.ay = n.type === "chain" ? band + 84 : band;
    n.ky = 0.3;
    n.x0 = COL * 1.5 + ((i + 0.5) * (COL * 3)) / Math.max(1, foundation.length);
    n.y0 = n.ay;
  });
  for (const n of nodes) {
    n.x = n.x0;
    n.y = n.y0;
    n.fixed = false;
  }
  const FOUNDATION_EDGES = new Set(["subject", "anchors", "names", "issuer"]);
  const springs = edges.map((e) => ({ from: e.from, to: e.to, len: EDGE_KINDS[e.kind]?.len ?? 150, k: e.kind === "conflict" || e.kind === "supersedes" ? 0.08 : FOUNDATION_EDGES.has(e.kind) ? 0.015 : 0.035 }));
  const sim = forceLayout(nodes, springs, LAYOUT_TICKS);
  while (sim.step());
  for (const n of nodes) {
    n.x = Math.round(n.x * 10) / 10;
    n.y = Math.round(n.y * 10) / 10;
  }
  model.springs = springs;
  return model;
}

function bounds(nodes, pad) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.w / 2);
    y0 = Math.min(y0, n.y - n.h / 2);
    x1 = Math.max(x1, n.x + n.w / 2);
    y1 = Math.max(y1, n.y + n.h / 2);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** The pieces that sit inside the vault readiness chamber. */
export const inChamber = (n) => n.type === "readiness" || n.type === "snapshot" || (n.type === "gap" && n.gapFor === "readiness");

const t2 = (x, y, cls, text) => `<text x="${x}" y="${y}" text-anchor="middle" class="${cls}">${esc(text)}</text>`;

/** The architectural shape of each kind of piece, centred on 0,0. */
function shape(n) {
  const w = n.w;
  const h = n.h;
  const hw = w / 2;
  const hh = h / 2;
  const lines = (a, b, mono = false) => `${t2(0, b === undefined ? 4 : -2, mono ? "t1 mono" : "t1", a)}${b === undefined ? "" : t2(0, 12, "t2", b)}`;
  switch (n.type) {
    case "authority": {
      const c = 8;
      return `<polygon class="body" points="${-hw + c},${-hh} ${hw - c},${-hh} ${hw},${-hh + c} ${hw},${hh - c} ${hw - c},${hh} ${-hw + c},${hh} ${-hw},${hh - c} ${-hw},${-hh + c}"/><polygon class="inner" points="${-hw + c + 3},${-hh + 3} ${hw - c - 3},${-hh + 3} ${hw - 3},${-hh + c + 3} ${hw - 3},${hh - c - 3} ${hw - c - 3},${hh - 3} ${-hw + c + 3},${hh - 3} ${-hw + 3},${hh - c - 3} ${-hw + 3},${-hh + c + 3}"/>${lines(short(n.label, 20), n.sub)}`;
    }
    case "source":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="1"/><line class="rail" x1="${-hw}" y1="${-hh + 2}" x2="${hw}" y2="${-hh + 2}"/>${lines(n.label, short(n.sub, 22))}`;
    case "observation": {
      const ticks = [0.2, 0.35, 0.5, 0.65, 0.8].map((p) => `<line class="tick" x1="${(-hw + w * p).toFixed(1)}" y1="${-hh}" x2="${(-hw + w * p).toFixed(1)}" y2="${-hh + (p === 0.5 ? 6 : 4)}"/>`).join("");
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="2"/>${ticks}${lines(short(n.label, 18), short(n.sub, 26))}`;
    }
    case "wallmark": {
      const cx = -hw + 24;
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="3"/><circle class="seal" cx="${cx}" cy="0" r="17"/><circle class="seal-ring" cx="${cx}" cy="0" r="12.5"/><path class="seal-bricks" d="M${cx - 9} -3.5H${cx + 9}M${cx - 9} 3.5H${cx + 9}M${cx - 2} -10V-3.5M${cx + 4} -3.5V3.5M${cx - 5} -3.5V3.5M${cx + 1} 3.5V10"/>${t2(18, -6, "t1", `Wallmark${n.symbol ? ` · ${short(n.symbol, 10)}` : ""}`)}${t2(18, 7, "t2", short(n.sub, 20))}${t2(18, 19, "t3 state", stateText(n.state))}`;
    }
    case "assertion":
      return `<path class="body" d="M${-hw} ${-hh}H${hw}V-7h7v14h-7V${hh}H${-hw}V7h7v-14h-7Z"/>${t2(0, -6, "t1", short(n.label, 22))}${t2(0, 6, "t2", short(n.sub, 22))}${t2(0, 17, "t3 state", stateText(n.state))}`;
    case "derivation":
      return `<polygon class="body" points="${-hw + 10},${-hh} ${hw - 10},${-hh} ${hw},0 ${hw - 10},${hh} ${-hw + 10},${hh} ${-hw},0"/>${lines(n.label, short(n.sub, 22))}`;
    case "readiness":
      return `<polygon class="body" points="${-hw},${-hh} ${hw},${-hh} ${hw - 18},${hh} ${-hw + 18},${hh}"/><line class="seat" x1="${-hw + 18}" y1="${hh + 5}" x2="${hw - 18}" y2="${hh + 5}"/>${t2(0, -12, "t1", "Vault readiness")}${t2(0, 1, "t3 classification", classText(n.classification))}${t2(0, 14, "t3 state", stateText(n.state))}`;
    case "conflict":
      return `<polygon class="body half" points="${-hw},${-hh} -3,${-hh} -9,-3 -1,4 -7,${hh} ${-hw},${hh}"/><polygon class="body half" points="5,${-hh} ${hw},${-hh} ${hw},${hh} 1,${hh} 7,4 -1,-3"/>${t2(0, 4, "t1 on-dark", "split")}`;
    case "gap":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="1"/>${lines(short(n.label, 20), n.sub)}`;
    case "snapshot":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="1"/>${lines(n.label, n.sub)}`;
    case "stablecoin":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="6"/><line class="hi" x1="${-hw + 6}" y1="${-hh + 3}" x2="${hw - 6}" y2="${-hh + 3}"/>${t2(0, -2, "t1 on-dark", short(n.label, 14))}${t2(0, 12, "t2 on-dark", "stablecoin, as presented")}`;
    case "contract":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="1"/>${t2(0, 4, "t1 mono", `contract ${n.label}`)}`;
    case "wallet":
      return `<rect class="body" x="${-hw}" y="${-hh}" width="${w}" height="${h}" rx="6"/><line class="mortar" x1="${-hw + 34}" y1="${-hh}" x2="${-hw + 34}" y2="${hh}"/>${t2(16, 4, "t1 mono", `wallet ${n.label}`)}`;
    case "chain":
      return `<polygon class="body" points="${-hw + 12},${-hh} ${hw - 12},${-hh} ${hw},${hh} ${-hw},${hh}"/>${t2(0, 4, "t1 on-dark", n.label)}`;
    default:
      return "";
  }
}

/** The accessible name of a piece: what it is, what it says, and its state in words. Addresses are given in full. */
export function nodeName(n) {
  const type = NODE_TYPES[n.type]?.name ?? n.type;
  const parts = [`${type}: ${n.address ?? n.label}`];
  if (n.type === "wallmark" || n.type === "assertion" || n.type === "readiness") parts.push(`assertion ${n.assertionId}`);
  if (n.chainId) parts.push(`chain ID ${n.chainId}`);
  if (n.classification) parts.push(`readiness ${classText(n.classification)}`);
  if (n.state !== undefined) parts.push(n.state === null ? "no evaluation returned" : `support ${stateText(n.state)}`);
  if (n.superseded) parts.push("superseded");
  if (n.missing) parts.push(n.type === "observation" ? `result ${n.data?.result ?? "unknown"}, not a value` : "missing");
  if (n.unattested) parts.push("named by the claim, no source in the bundle");
  if (n.type === "snapshot") parts.push("reserved for immutable snapshots, not available yet");
  return parts.join(", ");
}

const KNOWN_STATES = ["ESTABLISHED", "SUPPORTED", "PARTIAL", "CONFLICTING", "STALE", "SUPERSEDED", "UNKNOWN", "NOT_ESTABLISHED"];
const KNOWN_CLASSES = ["CRITERIA_MET", "CRITERIA_NOT_MET", "NOT_ESTABLISHED"];
/** A state as printed on a piece's face: a WWEP value, or "not recognised"; never an unknown string passed through. */
const stateText = (s) => (s === null || s === undefined ? "no evaluation" : KNOWN_STATES.includes(s) ? s : "not recognised");
const classText = (c) => (c === undefined ? "not assessed" : KNOWN_CLASSES.includes(c) ? c : "not recognised");

/** The Wall as SVG. Positions come from layoutWall; the page script animates and drags from the same data. */
export function renderWall(model, { selectedNodeId, digest }) {
  const { nodes, edges, springs } = model;
  if (nodes.length === 0) return '<p class="muted">The bundle has no pieces to place.</p>';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chamberNodes = nodes.filter(inChamber);
  const all = bounds(nodes, 30);
  const vb = { x: Math.floor(all.x), y: Math.floor(all.y - 26), w: Math.ceil(all.w), h: Math.ceil(all.h + 26) };
  const chamber = chamberNodes.length ? bounds(chamberNodes, 20) : null;
  const edgeMarkup = edges
    .map((e, i) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const kind = EDGE_KINDS[e.kind];
      const spring = springs[i];
      return `<path class="ww-edge" data-kind="${esc(e.kind)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-len="${spring.len}" data-k="${spring.k}"${kind.why ? ' data-evidence="true"' : ""} d="${edgePath(a, b, e.kind)}"${e.kind === "conflict" || e.kind === "reserved" ? "" : ' marker-end="url(#ww-arrow)"'}><title>${esc(`${a.label} ${kind.name} ${b.label}`)}</title></path>`;
    })
    .join("");
  const nodeMarkup = nodes
    .map((n) => {
      const state = n.state === undefined ? "" : ` data-state="${n.state === null ? "NONE" : KNOWN_STATES.includes(n.state) ? esc(n.state) : "UNRECOGNISED"}"`;
      const flags = [n.superseded ? "superseded" : "", n.missing ? "missing" : "", n.unattested ? "unattested" : ""].filter(Boolean).join(" ");
      const anchors = `data-x0="${n.x0}" data-y0="${n.y0}" data-ax="${n.ax ?? ""}" data-ay="${n.ay ?? ""}" data-kx="${n.kx}" data-ky="${n.ky}" data-w="${n.w}" data-h="${n.h}"`;
      const ghost = n.superseded ? `<rect class="ghost" x="${-n.w / 2 + 5}" y="${-n.h / 2 - 5}" width="${n.w}" height="${n.h}" rx="2"/>` : "";
      return `<g class="ww-node${n.id === selectedNodeId ? " is-selected" : ""}" tabindex="0" role="button" aria-pressed="${n.id === selectedNodeId}" aria-label="${esc(nodeName(n))}" data-node-id="${esc(n.id)}" data-type="${esc(n.type)}"${state}${flags ? ` data-flags="${flags}"` : ""}${n.assertionId ? ` data-assertion-id="${esc(n.assertionId)}"` : ""}${n.classification ? ` data-classification="${KNOWN_CLASSES.includes(n.classification) ? esc(n.classification) : "UNRECOGNISED"}"` : ""} ${anchors} transform="translate(${n.x} ${n.y})">${ghost}${shape(n)}</g>`;
    })
    .join("");
  const chamberMarkup = chamber
    ? `<g class="ww-chamber" aria-hidden="true"><rect x="${chamber.x.toFixed(1)}" y="${chamber.y.toFixed(1)}" width="${chamber.w.toFixed(1)}" height="${chamber.h.toFixed(1)}"/><rect class="inner" x="${(chamber.x + 4).toFixed(1)}" y="${(chamber.y + 4).toFixed(1)}" width="${(chamber.w - 8).toFixed(1)}" height="${(chamber.h - 8).toFixed(1)}"/><text x="${(chamber.x + 8).toFixed(1)}" y="${(chamber.y - 7).toFixed(1)}" class="layer">VAULT READINESS CHAMBER</text></g>`
    : "";
  const columnTitles = [
    [0, "AUTHORITIES"],
    [1, "SOURCES"],
    [2, "OBSERVATIONS"],
    [3, "CLAIMS"],
    [4, "DERIVATION"],
  ]
    .filter(([c]) => nodes.some((n) => n.ax === c * COL || (n.type === "gap" && n.column === c)))
    .map(([c, t]) => `<text x="${c * COL}" y="${vb.y + 14}" text-anchor="middle" class="layer">${t}</text>`)
    .join("");
  const foundation = nodes.some((n) => n.ax === null) ? `<text x="${vb.x + 8}" y="${Math.max(...nodes.filter((n) => n.ax === null).map((n) => n.y + n.h / 2)) + 18}" class="layer">FOUNDATION · SUBJECTS OF THE CLAIMS</text>` : "";
  const foundationH = foundation ? 20 : 0;
  return `<svg class="ww-wall-svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h + foundationH}" width="${vb.w}" height="${vb.h + foundationH}" data-digest="${esc(digest)}" data-ticks="${LAYOUT_TICKS}" role="group" aria-label="The Wall: ${nodes.length} pieces and ${edges.length} connections. The same information is listed in the text version below.">
<defs><marker id="ww-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker><pattern id="ww-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6"/></pattern><pattern id="ww-half" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8"/></pattern></defs>
${columnTitles}${chamberMarkup}<g class="ww-edges">${edgeMarkup}</g><g class="ww-nodes">${nodeMarkup}</g>${foundation}</svg>`;
}
