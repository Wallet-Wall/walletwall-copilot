import type { Bundle } from "./schemas.ts";
import { indexEvidence } from "./evaluate.ts";

const NS = "ww";
export const PROV_NAMESPACE = "urn:walletwall:wwep:0.1:";

type Attrs = Record<string, string | boolean | null>;

export interface ProvDocument {
  prefix: Record<string, string>;
  entity: Record<string, Attrs>;
  activity: Record<string, Attrs>;
  agent: Record<string, Attrs>;
  wasDerivedFrom: Record<string, { "prov:generatedEntity": string; "prov:usedEntity": string }>;
  wasAttributedTo: Record<string, { "prov:entity": string; "prov:agent": string }>;
  wasGeneratedBy: Record<string, { "prov:entity": string; "prov:activity": string }>;
  used: Record<string, { "prov:activity": string; "prov:entity": string }>;
  wasRevisionOf: Record<string, { "prov:generatedEntity": string; "prov:usedEntity": string }>;
}

export interface ProvenanceTrace {
  target: string;
  lineage: { id: string; kind: "assertion" | "observation"; depth: number }[];
  prov: ProvDocument;
  issues: { code: "TARGET_NOT_FOUND" | "DANGLING_REFERENCE" | "DEPENDENCY_CYCLE"; id: string | null }[];
}

const byCodeUnit = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The cycles of a graph, each once: a strongly connected set of nodes, or a node that names itself, reported by its smallest id, in order
 * of code unit. A set of nodes does not change with where a walk entered it, how its records were listed or how its ids are spelled, so
 * neither can change how many there are: a walk that counted every way back into a cycle counted them by where it began.
 */
function cycleIds(edges: ReadonlyMap<string, readonly string[]>): string[] {
  let counter = 0;
  const index = new Map<string, number>();
  const lowest = new Map<string, number>();
  const open: string[] = [];
  const onOpen = new Set<string>();
  const found: string[] = [];
  const connect = (v: string): void => {
    index.set(v, counter);
    lowest.set(v, counter);
    counter++;
    open.push(v);
    onOpen.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        connect(w);
        lowest.set(v, Math.min(lowest.get(v) ?? 0, lowest.get(w) ?? 0));
      } else if (onOpen.has(w)) {
        lowest.set(v, Math.min(lowest.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (lowest.get(v) !== index.get(v)) return;
    const members: string[] = [];
    for (let w = open.pop(); w !== undefined; w = open.pop()) {
      onOpen.delete(w);
      members.push(w);
      if (w === v) break;
    }
    if (members.length > 1 || (edges.get(v) ?? []).includes(v)) found.push(members.reduce((x, y) => (x < y ? x : y)));
  };
  for (const v of edges.keys()) if (!index.has(v)) connect(v);
  return found.sort(byCodeUnit);
}

/**
 * Builds a W3C PROV-JSON-shaped provenance graph for one assertion and its ancestors.
 * Transport (ww:retrievedVia) is recorded as an attribute and never as an agent or authority.
 *
 * The issues are a set of what the walk reaches, not a count of how it got there: each id a walked record names that resolves to nothing,
 * once, then each cycle of the graph walked, once, each in order of code unit. How many there are follows the records reached, never the
 * assertion the walk entered at, the order the records or a list inside one are in, or how the ids are spelled; and the count is never
 * more than the walk's own per-reference, per-back-edge count was, so a record that fitted under that fits under this.
 */
export function traceProvenance(bundle: Bundle, assertionId: string): ProvenanceTrace {
  const idx = indexEvidence(bundle);
  const prov: ProvDocument = {
    prefix: { [NS]: PROV_NAMESPACE },
    entity: {},
    activity: {},
    agent: {},
    wasDerivedFrom: {},
    wasAttributedTo: {},
    wasGeneratedBy: {},
    used: {},
    wasRevisionOf: {},
  };
  const lineage: ProvenanceTrace["lineage"] = [];
  const visited = new Set<string>();
  /** Every id a walked record names that resolves to nothing, and what each walked assertion leads to, for the issues the walk ends with. */
  const dangling = new Set<string>();
  const edges = new Map<string, string[]>();
  let relCounter = 0;
  const rel = (p: string): string => `${NS}:${p}${++relCounter}`;

  const target = idx.assertions.get(assertionId);
  if (target === undefined) {
    return { target: assertionId, lineage, prov, issues: [{ code: "TARGET_NOT_FOUND", id: null }] };
  }

  // Walked by the id they supersede: what one assertion supersedes must not come out in the order it was listed.
  const supersessions = [...(bundle.supersessions ?? [])].sort((x, y) => (x.supersededAssertionId < y.supersededAssertionId ? -1 : x.supersededAssertionId > y.supersededAssertionId ? 1 : 0));

  const addObservation = (id: string, depth: number): void => {
    const o = idx.observations.get(id);
    if (o === undefined) {
      dangling.add(id);
      return;
    }
    const key = `${NS}:obs/${o.id}`;
    if (prov.entity[key] !== undefined) return;
    lineage.push({ id: o.id, kind: "observation", depth });
    prov.entity[key] = {
      "prov:type": "ww:Observation",
      "ww:origin": o.origin,
      "ww:result": o.result,
      "ww:finality": o.finality,
      "prov:generatedAtTime": o.observedAt,
    };
    const s = idx.sources.get(o.sourceId);
    if (s === undefined) {
      dangling.add(o.sourceId);
      return;
    }
    const agentKey = `${NS}:source/${s.id}`;
    prov.agent[agentKey] = {
      "prov:type": "ww:Source",
      "ww:kind": s.kind,
      "ww:authorityId": s.authorityId ?? null,
      "ww:independenceGroup": s.independenceGroup ?? null,
      "ww:retrievedVia": s.transport?.retrievedVia ?? null,
    };
    prov.wasAttributedTo[rel("attr")] = { "prov:entity": key, "prov:agent": agentKey };
  };

  const walk = (id: string, depth: number): void => {
    const a = idx.assertions.get(id);
    if (a === undefined) {
      dangling.add(id);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    const successors: string[] = [];
    edges.set(id, successors);
    const key = `${NS}:assertion/${a.id}`;
    lineage.push({ id: a.id, kind: "assertion", depth });
    prov.entity[key] = {
      "prov:type": "ww:Assertion",
      "ww:claimType": a.claimType,
      "ww:origin": a.origin,
      "ww:temporality": a.temporality,
      "prov:generatedAtTime": a.assertedAt,
    };
    for (const oid of a.observationIds) {
      addObservation(oid, depth + 1);
      if (idx.observations.has(oid)) {
        prov.wasDerivedFrom[rel("der")] = { "prov:generatedEntity": key, "prov:usedEntity": `${NS}:obs/${oid}` };
      }
    }
    if (a.derivationId !== undefined) {
      const d = idx.derivations.get(a.derivationId);
      if (d === undefined) {
        dangling.add(a.derivationId);
      } else {
        const actKey = `${NS}:derivation/${d.id}`;
        prov.activity[actKey] = { "prov:type": "ww:Derivation", "ww:ruleId": d.ruleId, "ww:rulesVersion": d.rulesVersion };
        prov.agent[`${NS}:agent/walletwall-rules`] = { "prov:type": "ww:WalletWallRules" };
        prov.wasGeneratedBy[rel("gen")] = { "prov:entity": key, "prov:activity": actKey };
        prov.wasAttributedTo[rel("attr")] = { "prov:entity": key, "prov:agent": `${NS}:agent/walletwall-rules` };
        for (const dep of d.inputAssertionIds) {
          prov.used[rel("use")] = { "prov:activity": actKey, "prov:entity": `${NS}:assertion/${dep}` };
          prov.wasDerivedFrom[rel("der")] = { "prov:generatedEntity": key, "prov:usedEntity": `${NS}:assertion/${dep}` };
          if (idx.assertions.has(dep)) successors.push(dep);
          walk(dep, depth + 1);
        }
      }
    }
    for (const s of supersessions) {
      if (s.supersedingAssertionId === id && idx.assertions.has(s.supersededAssertionId)) {
        prov.wasRevisionOf[rel("rev")] = {
          "prov:generatedEntity": key,
          "prov:usedEntity": `${NS}:assertion/${s.supersededAssertionId}`,
        };
        successors.push(s.supersededAssertionId);
        walk(s.supersededAssertionId, depth + 1);
      }
    }
  };

  walk(assertionId, 0);
  const issues: ProvenanceTrace["issues"] = [
    ...[...dangling].sort(byCodeUnit).map((id) => ({ code: "DANGLING_REFERENCE" as const, id })),
    ...cycleIds(edges).map((id) => ({ code: "DEPENDENCY_CYCLE" as const, id })),
  ];
  return { target: assertionId, lineage, prov, issues };
}
