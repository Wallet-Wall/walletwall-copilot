import { z } from "zod";
import { sha256Hex } from "./canonical.ts";
import { CLAIMS_RESOURCE_URI, claimContracts } from "./claims.ts";
import { WwError } from "./errors.ts";
import type { AssertionEvaluation } from "./evaluate.ts";
import { EXAMPLE_BY_CLAIM, EXAMPLE_URI_PREFIX, PUBLISHED_EXAMPLES, SYNTHETIC_NOTICE, type PublishedExample } from "./examples.ts";
import { SPEC_WWEP_MD } from "./generated/content.ts";
import type { ReadinessResult } from "./readiness.ts";
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
import { callTool } from "./tools.ts";
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

/**
 * The published example is evaluated through the same callTool path a consumer uses, so the stated outcome is the
 * engine's own result at the bundled versions and can never drift from it. The projection keeps only the states a
 * consumer needs to compare against.
 */
function expectedOutcome(example: PublishedExample): unknown {
  const outcome = callTool(example.toolCall.name, example.toolCall.arguments);
  if (!outcome.ok) throw new WwError("INTERNAL", "Published example is not accepted by the engine.");
  if (example.toolCall.name === "assess_vault_readiness") {
    const r = outcome.result as ReadinessResult;
    return {
      classification: r.classification,
      criteria: r.criteria.map((c) => ({ id: c.id, outcome: c.outcome, reason: c.reason })),
      supportOfInputs: r.supportOfInputs,
      limitations: r.limitations,
      // The derivation and assertion the engine suggests: the VAULT_TECHNICAL_READINESS shape a bundle would carry.
      suggestedDerivation: r.suggestedDerivation,
      suggestedAssertion: r.suggestedAssertion,
      missingMeasurement: example.missingMeasurement,
    };
  }
  const r = outcome.result as { assertions: AssertionEvaluation[]; invariantViolationCount: number };
  const assertions: Record<string, unknown> = {};
  for (const a of r.assertions) {
    assertions[a.assertionId] = {
      supportState: a.supportState,
      freshnessState: a.freshnessState,
      finalityState: a.finalityState,
      authoritySatisfied: a.authority?.satisfied ?? null,
      limitations: a.limitations,
    };
  }
  return { assertions, invariantViolationCount: r.invariantViolationCount };
}

function exampleResource(example: PublishedExample): ResourceDefinition {
  return {
    uri: `${EXAMPLE_URI_PREFIX}${example.name}`,
    name: `example-${example.name}`,
    title: example.title,
    description: `${example.demonstrates} Synthetic, illustrative evidence that conforms to the bundle schema; not a claim about any real wallet or chain state.`,
    mimeType: "application/json",
    read: () =>
      json({
        example: example.name,
        title: example.title,
        demonstrates: example.demonstrates,
        synthetic: true,
        notice: SYNTHETIC_NOTICE,
        contract: CLAIMS_RESOURCE_URI,
        claimType: example.claimType,
        toolCall: example.toolCall,
        expected: expectedOutcome(example),
        versions: { wwep: WWEP_VERSION, registry: REGISTRY_VERSION, policies: POLICIES_VERSION, rules: RULES_VERSION },
      }),
  };
}

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
    description: "JSON Schema for the WWEP 0.1 evidence bundle accepted by the evidence tools. Per-claim subject, value and observation shapes are in walletwall://schemas/claims.",
    mimeType: "application/schema+json",
    read: () =>
      json(z.toJSONSchema(BundleSchema, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline" })),
  },
  {
    uri: CLAIMS_RESOURCE_URI,
    name: "schema-claims",
    title: "Per-claim-type contract: subject, value, observation linkage and authority",
    description:
      "For every claim type: the required subject and value keys with their formats, which observation origins and source kinds may establish or corroborate the claim, how observations link to assertions, the registry and derivation relationships, and the structured diagnostics attached to shape failures. Generated from the bundled authority policies and the evaluator's own rules.",
    mimeType: "application/json",
    read: () => json(claimContracts(EXAMPLE_BY_CLAIM)),
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
  ...PUBLISHED_EXAMPLES.map(exampleResource),
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
