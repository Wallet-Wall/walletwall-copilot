import { z } from "zod";
import { sha256Hex } from "./canonical.ts";
import { SPEC_WWEP_MD } from "./generated/content.ts";
import {
  POLICIES_VERSION,
  REGISTRY_STATUS,
  REGISTRY_VERSION,
  RULES,
  RULES_VERSION,
  policiesDigest,
  rawPolicies,
  rawRegistry,
  registryDigest,
} from "./registry.ts";
import { BundleSchema, WWEP_VERSION } from "./schemas.ts";
import { ENGINE_VERSION } from "./version.ts";

export interface ResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  read: () => string;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);

export const RESOURCES: readonly ResourceDefinition[] = [
  {
    uri: "walletwall://registry/stablecoins",
    name: "registry-stablecoins",
    title: "Stablecoin deployment registry (record-level verification)",
    description: "Bundled, static registry of stablecoin deployments. Each record carries the authority publication and chain observation it was verified against, with the verification date. Point-in-time; not a safety statement.",
    mimeType: "application/json",
    read: () => json(rawRegistry().stablecoins),
  },
  {
    uri: "walletwall://registry/chains",
    name: "registry-chains",
    title: "Chain registry (chain IDs observed, finality labels descriptive)",
    description: "Bundled, static registry of supported chains and their finality models.",
    mimeType: "application/json",
    read: () => json(rawRegistry().chains),
  },
  {
    uri: "walletwall://schemas/evidence",
    name: "schema-evidence",
    title: "WWEP 0.1 evidence bundle JSON Schema",
    description: "JSON Schema for the WWEP 0.1 evidence bundle accepted by the evidence tools.",
    mimeType: "application/schema+json",
    read: () =>
      json(z.toJSONSchema(BundleSchema, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline" })),
  },
  {
    uri: "walletwall://policies/authority",
    name: "policies-authority",
    title: "Claim-specific authority policies",
    description: "Bundled authority policies. Authority is defined per claim type; there is no global source ranking.",
    mimeType: "application/json",
    read: () => json(rawPolicies()),
  },
  {
    uri: "walletwall://spec/wwep",
    name: "spec-wwep",
    title: "WalletWall Evidence Profile 0.1 (draft)",
    description: "Normative draft text of the WalletWall Evidence Profile 0.1. Not an industry standard.",
    mimeType: "text/markdown",
    read: () => SPEC_WWEP_MD,
  },
  {
    uri: "walletwall://conformance/version",
    name: "conformance-version",
    title: "Engine, rules and data versions",
    description: "Versions and content digests of the bundled engine, registry, policies, rules and specification.",
    mimeType: "application/json",
    read: () =>
      json({
        status: "DRAFT_PRIVATE_PRE_RELEASE",
        wwepVersion: WWEP_VERSION,
        engineVersion: ENGINE_VERSION,
        registryVersion: REGISTRY_VERSION,
        registryStatus: REGISTRY_STATUS,
        registrySha256: registryDigest(),
        policiesVersion: POLICIES_VERSION,
        policiesSha256: policiesDigest(),
        rulesVersion: RULES_VERSION,
        rules: RULES,
        specSha256: sha256Hex(SPEC_WWEP_MD),
      }),
  },
];

export function readResource(uri: string): ResourceDefinition | undefined {
  return RESOURCES.find((r) => r.uri === uri);
}

export function resourceDigest(r: ResourceDefinition): string {
  return sha256Hex(r.read());
}

export function resourcesManifest(): unknown {
  return RESOURCES.map((r) => ({
    uri: r.uri,
    name: r.name,
    title: r.title,
    description: r.description,
    mimeType: r.mimeType,
    sha256: resourceDigest(r),
  }));
}
