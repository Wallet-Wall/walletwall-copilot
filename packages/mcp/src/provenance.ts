import type { Bundle } from "./schemas.ts";
import { indexBundle } from "./evaluate.ts";

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

/**
 * Builds a W3C PROV-JSON-shaped provenance graph for one assertion and its ancestors.
 * Transport (ww:retrievedVia) is recorded as an attribute and never as an agent or authority.
 */
export function traceProvenance(bundle: Bundle, assertionId: string): ProvenanceTrace {
  const idx = indexBundle(bundle);
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
  const issues: ProvenanceTrace["issues"] = [];
  const lineage: ProvenanceTrace["lineage"] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  let relCounter = 0;
  const rel = (p: string): string => `${NS}:${p}${++relCounter}`;

  const target = idx.assertions.get(assertionId);
  if (target === undefined) {
    return { target: assertionId, lineage, prov, issues: [{ code: "TARGET_NOT_FOUND", id: null }] };
  }

  const addObservation = (id: string, depth: number): void => {
    const o = idx.observations.get(id);
    if (o === undefined) {
      issues.push({ code: "DANGLING_REFERENCE", id });
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
      issues.push({ code: "DANGLING_REFERENCE", id: o.sourceId });
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
      issues.push({ code: "DANGLING_REFERENCE", id });
      return;
    }
    if (stack.has(id)) {
      issues.push({ code: "DEPENDENCY_CYCLE", id });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
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
        issues.push({ code: "DANGLING_REFERENCE", id: a.derivationId });
      } else {
        const actKey = `${NS}:derivation/${d.id}`;
        prov.activity[actKey] = { "prov:type": "ww:Derivation", "ww:ruleId": d.ruleId, "ww:rulesVersion": d.rulesVersion };
        prov.agent[`${NS}:agent/walletwall-rules`] = { "prov:type": "ww:WalletWallRules" };
        prov.wasGeneratedBy[rel("gen")] = { "prov:entity": key, "prov:activity": actKey };
        prov.wasAttributedTo[rel("attr")] = { "prov:entity": key, "prov:agent": `${NS}:agent/walletwall-rules` };
        for (const dep of d.inputAssertionIds) {
          prov.used[rel("use")] = { "prov:activity": actKey, "prov:entity": `${NS}:assertion/${dep}` };
          prov.wasDerivedFrom[rel("der")] = { "prov:generatedEntity": key, "prov:usedEntity": `${NS}:assertion/${dep}` };
          walk(dep, depth + 1);
        }
      }
    }
    for (const s of bundle.supersessions ?? []) {
      if (s.supersedingAssertionId === id && idx.assertions.has(s.supersededAssertionId)) {
        prov.wasRevisionOf[rel("rev")] = {
          "prov:generatedEntity": key,
          "prov:usedEntity": `${NS}:assertion/${s.supersededAssertionId}`,
        };
        walk(s.supersededAssertionId, depth + 1);
      }
    }
    stack.delete(id);
  };

  walk(assertionId, 0);
  return { target: assertionId, lineage, prov, issues };
}
