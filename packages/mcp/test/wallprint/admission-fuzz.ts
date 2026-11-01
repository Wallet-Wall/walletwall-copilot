import type { ExternalAssessmentInput } from "../../src/wallprint/record.ts";
import { ASSESSOR_ROLES } from "../../src/wallprint/vocabulary.ts";
import { reviewerAssessment } from "./support.ts";

/**
 * Seeded generators of assessor and policy spellings for the admission properties and the native / import differential:
 * casing, separators, omitted separators, numeric suffixes, namespace decoration, roles, policy ids and registry or engine
 * authorities. Deterministic: the same seed gives the same sample on every machine.
 */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;
export const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

export const WORDS = ["wallet", "wall", "print", "walletwall", "wallprint", "fire", "firewall", "stone", "wallpaper", "issuer", "circle", "tether", "protocol", "sky", "canonical", "chain", "state", "publication", "reviewer", "y", "acme", "ww", "ap", "dr", "vr", "wwap", "wwdr", "wwvr", "api", "2", "10", "x", "walletwall2", "wwap2", "rules"];
export const SEPS_ID = ["-", "_", ".", ":"];
export const SEPS_POLICY = [...SEPS_ID, "/"];

const recase = (rand: Rand, w: string): string => {
  const r = rand();
  return r < 0.2 ? w.toUpperCase() : r < 0.35 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};

/** A few words, mixed case, joined by random separators (sometimes none, sometimes doubled). */
export function sample(rand: Rand, seps: readonly string[]): string {
  const n = 1 + Math.floor(rand() * 4);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += recase(rand, pick(rand, WORDS));
    if (i < n - 1 && rand() < 0.8) out += pick(rand, seps).repeat(1 + Math.floor(rand() * 2));
  }
  return out.slice(0, 60);
}

const AUTHORITIES = ["issuer:circle", "issuer:tether", "protocol:sky", "canonical-chain-state", "issuer-publication", "walletwall-rules"];

/** A spelling of a registry or engine authority: separators swapped or omitted, case changed, sometimes decorated. */
export function authoritySpelling(rand: Rand): string {
  const base = pick(rand, AUTHORITIES);
  let out = "";
  for (const ch of base) {
    if (/[:-]/.test(ch)) {
      const r = rand();
      out += r < 0.15 ? "" : r < 0.3 ? ch : pick(rand, SEPS_ID);
    } else out += rand() < 0.2 ? ch.toUpperCase() : ch;
  }
  const d = rand();
  return d < 0.15 ? `${out}${pick(rand, ["2", "-2", "s", "-labs", "x"])}` : out;
}

/** A spelling of a WalletWall policy namespace or of a WalletWall identity used as a policy: separators inside the prefix, numeric suffix, trailing path. */
export function namespaceSpelling(rand: Rand): string {
  const parts = rand() < 0.5 ? ["ww", pick(rand, ["ap", "dr", "vr"])] : pick(rand, [["wallet", "wall"], ["wall", "print"], ["walletwall"], ["wallprint"]]);
  let out = parts.map((p) => recase(rand, p)).join(rand() < 0.5 ? "" : pick(rand, SEPS_POLICY));
  if (rand() < 0.3) out += pick(rand, ["2", "10", "x", "i", "-2", "pp"]);
  if (rand() < 0.6) out += `${pick(rand, SEPS_POLICY)}${pick(rand, ["x", "asset-identity", "0.1", "review"])}`;
  return out;
}

export function assessorSpelling(rand: Rand, i: number): string {
  const r = rand();
  if (r < 0.35) return sample(rand, SEPS_ID);
  if (r < 0.7) return authoritySpelling(rand);
  if (r < 0.85) return recase(rand, pick(rand, ["wallet-wall", "wall.print", "walletwall", "wallprint", "walletwallprint", "wallet_wall2", "firewall-print-shop"]));
  return `reviewer-${i}`;
}

export function policySpelling(rand: Rand, i: number): string {
  const r = rand();
  if (r < 0.4) return sample(rand, SEPS_POLICY);
  if (r < 0.75) return namespaceSpelling(rand);
  return `p-${i}`;
}

/** One schema-valid external assessment with a random role, assessor and policy. */
export function assessmentSpelling(rand: Rand, i: number): ExternalAssessmentInput {
  return reviewerAssessment({ assessor: assessorSpelling(rand, i), assessorRole: pick(rand, ASSESSOR_ROLES), policy: policySpelling(rand, i) });
}

/** One to three assessments. Repeats of an assessor and policy are possible on purpose: duplicates must refuse identically too. */
export function assessmentSet(rand: Rand): ExternalAssessmentInput[] {
  const n = 1 + Math.floor(rand() * 3);
  const out = Array.from({ length: n }, (_, i) => assessmentSpelling(rand, i));
  if (n > 1 && rand() < 0.1) out[1] = { ...out[1]!, assessor: out[0]!.assessor.toUpperCase(), policy: out[0]!.policy.toLowerCase() };
  return out;
}
