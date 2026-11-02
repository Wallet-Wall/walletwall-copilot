import type { AssessorRole } from "../../src/wallprint/vocabulary.ts";
import type { ExternalAssessmentInput } from "../../src/wallprint/record.ts";
import { issuerAssessment, reviewerAssessment } from "./support.ts";

/**
 * The semantic table of external-assessor admission: what one attributed assessment, about the registered USDC deployment
 * the golden world describes, is admitted or refused with, under each WallPrint contract version.
 *
 * A row is (family, role, assessor, policy) and the outcome the engine gives it: `ADMIT`, or the ordered findings it is
 * refused with, written `CODE@field`. `V01` is the characterization of WallPrint 0.1 as it stood when this table was
 * written, before any admission rule changed; it is the compatibility oracle for historical records. Rows a later version
 * decides differently are listed once, in the version's own delta (admission-versions.test.ts), never by editing a 0.1 row.
 *
 * The 0.1 rules are what they are: a token-run test for WalletWall / WallPrint identities, an exact case-folded match for
 * registry authority identities, and a `wwap` / `wwdr` / `wwvr` prefix test for policy namespaces. Several spellings of the
 * same identity are admitted; the `why` of each row says whether that is intended (a near miss) or a known gap.
 */
export type Family = "role" | "identity" | "authority" | "policy";
export type Outcome = "ADMIT" | readonly string[];

export interface AdmissionCase {
  readonly id: string;
  readonly family: Family;
  readonly role: AssessorRole;
  readonly assessor: string;
  readonly policy: string;
  /** WallPrint 0.1, as characterized before any change. */
  readonly v01: Outcome;
  readonly why: string;
}

export const ADMIT = "ADMIT" as const;
const refuse = (...codes: string[]): Outcome => codes;
const IDENTITY = refuse("ASSESSOR_IDENTITY_RESERVED@assessor");
const NAMESPACE = refuse("RESERVED_POLICY_NAMESPACE@policy");
const MISMATCH = refuse("ISSUER_AUTHORITY_MISMATCH@assessor");

const REVIEWER_POLICY = "reviewer-y-review";
const REVIEWER: AssessorRole = "INDEPENDENT_REVIEWER";
const NON_ISSUER_ROLES: readonly AssessorRole[] = ["INDEPENDENT_REVIEWER", "UPSTREAM_AUTHORITY", "OTHER"];

const cases: AdmissionCase[] = [];
const add = (family: Family, role: AssessorRole, assessor: string, policy: string, v01: Outcome, why: string): void => {
  const id = `${family}|${role}|${assessor}|${policy}`;
  cases.push({ id, family, role, assessor, policy, v01, why });
};
const identity = (assessor: string, v01: Outcome, why: string): void => add("identity", REVIEWER, assessor, REVIEWER_POLICY, v01, why);
const policy = (id: string, v01: Outcome, why: string): void => add("policy", REVIEWER, "reviewer-y", id, v01, why);
const authority = (assessor: string, v01: Outcome, why: string, roles: readonly AssessorRole[] = NON_ISSUER_ROLES): void => {
  for (const role of roles) add("authority", role, assessor, REVIEWER_POLICY, v01, why);
};

// ─── role ────────────────────────────────────────────────────────────────────
add("role", "WALLETWALL", "reviewer-y", REVIEWER_POLICY, refuse("ASSESSOR_IDENTITY_RESERVED@assessorRole"), "WalletWall's own assessment is generated, never supplied");
add("role", "ISSUER", "issuer:circle", "issuer-attestation", ADMIT, "the registry authority of the focal deployment may assess as ISSUER");
add("role", "ISSUER", "issuer:tether", "issuer-attestation", MISMATCH, "another registered authority is not this deployment's issuer");
add("role", "ISSUER", "Issuer:Circle", "issuer-attestation", MISMATCH, "an ISSUER must be spelled exactly as the registry spells its authority");
add("role", "ISSUER", "issuer-circle", "issuer-attestation", MISMATCH, "a separator spelling of the authority is not the registry authority, under the ISSUER role either");
add("role", "ISSUER", "issuer_circle", "issuer-attestation", MISMATCH, "a separator spelling of the authority is not the registry authority, under the ISSUER role either");
add("role", "ISSUER", "reviewer-y", "issuer-attestation", MISMATCH, "a name is not an issuer because the role says so");
add("role", "ISSUER", "issuer-acme", "issuer-attestation", MISMATCH, "an issuer-looking name is not an issuer: role comes from the registry, not from the name");
add("role", REVIEWER, "issuer-acme", REVIEWER_POLICY, ADMIT, "an issuer-looking name under a non-issuer role is just a name");
add("role", REVIEWER, "issuer:acme", REVIEWER_POLICY, ADMIT, "an issuer-looking name that is no registry authority is not reserved");

// ─── identity: WalletWall and WallPrint ──────────────────────────────────────
for (const id of ["walletwall", "WalletWall", "WALLETWALL", "wallet-wall", "Wallet-Wall", "wallet_wall", "wallet.wall", "wallet:wall", "wallet--wall", "wallprint", "WallPrint", "wall-print", "wall.print", "wall_print", "wall:print"]) {
  identity(id, IDENTITY, "a separator or case spelling of a reserved stem");
}
for (const id of ["walletwall-rules", "the.walletwall.desk", "WallPrint:audit", "wallet-wall-2", "walletwall-2024", "wall-print-shop", "fire-wall-print-shop", "official-wallprint", "x.wallet.wall.y"]) {
  identity(id, IDENTITY, "a run of whole words that spells a reserved stem, with other whole words around it");
}
for (const id of ["walletwallprint", "walletwall2", "wallprint2", "wallet-wall2", "wall-print2", "walletwallofficial", "wallprinters", "walletwallprint-bot"]) {
  identity(id, ADMIT, "known gap: a reserved stem fused with a number, another stem or more letters is not a run of whole words that spells the stem");
}
for (const id of [
  "firewall-print-shop",
  "firewall-prints",
  "stonewall",
  "stone-wall",
  "wallet",
  "wallet-print",
  "print-wall",
  "printwall",
  "wall-e",
  "wallace",
  "wall-street-review",
  "wallpaper",
  "wallet-wallpaper-co",
  "wallet-walnut",
  "walletwal",
  "thewalletwall",
  "officialwalletwall",
  "reviewer-y",
]) {
  identity(id, ADMIT, "a near miss: not a reserved stem, in the 0.1 contract's own words 'a stem buried inside a longer token' or no stem at all");
}

// ─── authority: a registry or engine authority identity under a role other than ISSUER ───────
authority("issuer:circle", IDENTITY, "the registry authority, exactly");
authority("Issuer:Circle", IDENTITY, "the registry authority in another letter case");
authority("ISSUER:CIRCLE", IDENTITY, "the registry authority in another letter case");
authority("issuer:tether", IDENTITY, "another registered authority, exactly");
authority("protocol:sky", IDENTITY, "another registered authority, exactly");
for (const id of ["issuer-circle", "issuer_circle", "issuer.circle", "ISSUER-CIRCLE", "Issuer_Circle", "issuercircle", "issuer--circle", "issuer-:circle", "issuer-tether", "protocol-sky", "protocol.sky"]) {
  authority(id, ADMIT, "known gap: a separator, case or omitted-separator spelling of a registry authority is not an exact case-folded match");
}
for (const id of ["canonical-chain-state", "canonical_chain_state", "issuer-publication"]) {
  authority(id, ADMIT, "known gap: an engine authority id is not a registry authority, so only an exact registry match was ever reserved");
}
authority("walletwall-rules", IDENTITY, "the engine's own agent is a reserved identity under every role");
for (const id of ["none", "issuer", "circle", "circle-review", "issuer:acme", "issuer-acme", "issuer:circle-labs", "issuer:circle2", "issuer:circles", "protocol:skyline", "tether", "canonical-chain", "chain-state", "publication"]) {
  authority(id, ADMIT, "not a registry or engine authority identity: a lookalike or a part of one");
}

// ─── policy: WalletWall policy and rule namespaces ───────────────────────────────────────────
for (const id of ["wwap", "WWAP", "wwap/asset-identity/0.1", "wwap.x", "wwap_x", "wwap:x", "wwap-x", "wwap-2", "wwdr", "wwdr.usd-value", "WWDR.usd-value", "wwvr-thing", "wwvr:readiness", "WwVr/x"]) {
  policy(id, NAMESPACE, "a reserved namespace: the prefix followed by a separator or the end, in any case");
}
for (const id of ["wwap2", "wwap2/x", "wwdr10", "WWVR2", "ww-ap", "ww-ap/x", "ww.ap", "ww_ap", "ww:ap", "ww--ap", "WW-AP", "ww-dr/x", "ww.vr", "ww/ap/x", "walletwall-policy", "walletwall", "WalletWall.policy", "wallet-wall/review", "walletwall2/x", "wallprint/x", "wall.print.v2", "walletwallprint/x"]) {
  policy(id, ADMIT, "known gap: a separator spelling, a numbered form or a WalletWall-named namespace is not the literal prefix the 0.1 rule tests");
}
for (const id of ["wwapi", "wwapi/x", "wwapp", "wwdrive", "wwvrt", "ww", "ww-api", "wwap2x", "acme/wwap/x", "reviewer-y-wwap", "acme/walletwall-review", "firewall-print-shop", "wall-street", "reviewer-y-review"]) {
  policy(id, ADMIT, "a near miss: not a reserved namespace");
}

export const ADMISSION_CASES: readonly AdmissionCase[] = cases;

/** The assessment a row stands for. */
export function assessmentOf(c: AdmissionCase): ExternalAssessmentInput {
  return c.role === "ISSUER"
    ? issuerAssessment({ assessor: c.assessor, policy: c.policy })
    : reviewerAssessment({ assessor: c.assessor, assessorRole: c.role, policy: c.policy });
}

/** `CODE@field` of a finding, with the list position dropped (`assessments[0].assessor` is `assessor`). */
export const findingKey = (f: { code: string; path: string }): string => `${f.code}@${f.path.replace(/^assessments\[0\]\.?/, "")}`;
