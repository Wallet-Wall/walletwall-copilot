import { z } from "zod";
import { evidenceDigest } from "./canonical.ts";
import { WwError } from "./errors.ts";
import { checkInvariants, INVARIANT_TEXT } from "./invariants.ts";
import { evaluateBundle } from "./evaluate.ts";
import { normalizeObservation } from "./normalize.ts";
import { traceProvenance } from "./provenance.ts";
import { assessReadiness } from "./readiness.ts";
import { resolveAsset } from "./resolve.ts";
import {
  ADDRESS_RE,
  BundleSchema,
  CHAIN_ID_RE,
  EvaluatedAtSchema,
  FINALITY_STATES,
  HASH_RE,
  ID_RE,
  KNOWN_PATH_SEGMENTS,
  OBSERVATION_RESULTS,
  ORIGINS,
  hasForbiddenStructure,
} from "./schemas.ts";

const Id = z.string().regex(ID_RE);
const ChainId = z.string().regex(CHAIN_ID_RE);
const Address = z.string().regex(ADDRESS_RE);

const ResolveAssetInput = z
  .strictObject({
    chainId: ChainId.optional(),
    address: Address.optional(),
    symbol: z.string().regex(/^[A-Za-z0-9]{1,16}$/).optional(),
  })
  .refine((v) => (v.address === undefined || v.chainId !== undefined) && (v.address !== undefined || v.symbol !== undefined), {
    message: "provide chainId with address, or a symbol",
  });

const BundleAtInput = z.strictObject({ bundle: BundleSchema, evaluatedAt: EvaluatedAtSchema });

const TraceInput = z.strictObject({ bundle: BundleSchema, assertionId: Id });

const NormalizeInput = z.strictObject({
  id: Id,
  sourceId: Id,
  origin: z.enum(ORIGINS),
  observedAt: EvaluatedAtSchema,
  finality: z.enum(FINALITY_STATES),
  result: z.enum(OBSERVATION_RESULTS),
  chainId: ChainId,
  token: Address,
  holder: Address,
  blockNumber: z.string().regex(/^(0|[1-9][0-9]{0,17})$/),
  blockHash: z.string().regex(HASH_RE),
  balanceAtomic: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).optional(),
  decimals: z.string().regex(/^(0|[1-9][0-9]?)$/).optional(),
});

const ReadinessInput = z.strictObject({
  bundle: BundleSchema,
  evaluatedAt: EvaluatedAtSchema,
  identityAssertionId: Id,
  balanceAssertionId: Id,
});

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  run: (args: never) => unknown;
}

function defineTool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (args: z.output<S>) => unknown;
}): ToolDefinition {
  return def;
}

export const TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "resolve_asset",
    title: "Resolve stablecoin deployment",
    description:
      "Look up a stablecoin deployment in the bundled WalletWall registry by chain ID and contract address, or list candidate deployments for a symbol. Offline and read-only. A registry match is a WalletWall-derived lookup without issuer attestation, so it is reported as PARTIAL. Symbols are never treated as identity. The registry itself is served as walletwall://registry/stablecoins and walletwall://registry/chains.",
    input: ResolveAssetInput,
    run: (args) => resolveAsset(args),
  }),
  defineTool({
    name: "normalize_observation",
    title: "Normalize balance observation",
    description:
      "Normalize a balance-at-block observation draft into a canonical WWEP observation. Validates atomic-unit decimal strings with BigInt, lowercases addresses and hashes, returns the RFC 8785 canonical JSON, SHA-256 evidence digest, content digest and exact decimal rendering. Offline and read-only; it does not fetch chain data. The returned observation has the TOKEN_BALANCE_AT_BLOCK shape published at walletwall://schemas/claims and can be placed directly in a bundle's observations.",
    input: NormalizeInput,
    run: (args) => normalizeObservation(args),
  }),
  defineTool({
    name: "inspect_evidence",
    title: "Inspect evidence bundle",
    description:
      "Evaluate every assertion in a WWEP 0.1 evidence bundle against the bundled authority policies at the supplied evaluation time. Returns support, freshness and finality states, claim-specific authority, limitations, conflicts, supersession and digests. States describe how well the presented evidence satisfies policy; they do not verify that upstream evidence is true. Offline and read-only. Input contract: walletwall://schemas/evidence (bundle), walletwall://schemas/claims (per-claim subject, value and observation shapes), walletwall://policies/authority and walletwall://spec/wwep; worked inputs: walletwall://examples/identity-established. Shape failures carry structured diagnostics beside the limitation code.",
    input: BundleAtInput,
    run: (args) => {
      const evaluation = evaluateBundle(args.bundle, args.evaluatedAt);
      const violations = checkInvariants(args.bundle, evaluation);
      return {
        wwepVersion: evaluation.versions.wwep,
        evaluatedAt: evaluation.evaluatedAt,
        bundleDigest: evaluation.bundleDigest,
        versions: evaluation.versions,
        assertions: evaluation.assertions,
        invariantViolationCount: violations.length,
      };
    },
  }),
  defineTool({
    name: "check_invariants",
    title: "Check evidence invariants",
    description:
      "Check a WWEP 0.1 evidence bundle against the thirteen mandatory evidence invariants plus the rule that declared states must not exceed computed states. Returns violations by invariant ID and assertion ID. Offline and read-only. Input contract: walletwall://schemas/evidence, walletwall://schemas/claims and walletwall://policies/authority.",
    input: BundleAtInput,
    run: (args) => {
      const evaluation = evaluateBundle(args.bundle, args.evaluatedAt);
      const violations = checkInvariants(args.bundle, evaluation);
      return {
        pass: violations.length === 0,
        violationCount: violations.length,
        violations: violations.map((v) => ({ ...v, rule: INVARIANT_TEXT[v.invariant] ?? "" })),
        bundleDigest: evaluation.bundleDigest,
      };
    },
  }),
  defineTool({
    name: "trace_provenance",
    title: "Trace assertion provenance",
    description:
      "Return a W3C PROV-JSON-shaped provenance graph for one assertion and all of its ancestors in a WWEP 0.1 bundle. Transport such as retrievedVia is recorded as an attribute and never as authority. Offline and read-only. Input contract: walletwall://schemas/evidence, walletwall://schemas/claims and walletwall://policies/authority.",
    input: TraceInput,
    run: (args) => traceProvenance(args.bundle, args.assertionId),
  }),
  defineTool({
    name: "assess_vault_readiness",
    title: "Assess vault technical readiness",
    description:
      "Evaluate WalletWall's published VAULT_TECHNICAL_READINESS rules 0.1.0-draft over an asset-identity assertion and a balance-at-block assertion. Returns CRITERIA_MET, CRITERIA_NOT_MET or NOT_ESTABLISHED with a per-criterion breakdown. It does not establish investment merit, solvency, creditworthiness, legal status, regulatory compliance, absence of fraud or future performance. Offline and read-only. Input contract: walletwall://schemas/evidence, walletwall://schemas/claims (ASSET_IDENTITY and TOKEN_BALANCE_AT_BLOCK) and walletwall://policies/authority; worked inputs: walletwall://examples/vault-readiness-established (CRITERIA_MET) and walletwall://examples/vault-readiness-not-established (NOT_ESTABLISHED).",
    input: ReadinessInput,
    run: (args) => {
      const evaluation = evaluateBundle(args.bundle, args.evaluatedAt);
      return assessReadiness(args.bundle, evaluation, args.identityAssertionId, args.balanceAssertionId);
    },
  }),
];

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function inputJsonSchema(def: ToolDefinition): Record<string, unknown> {
  return z.toJSONSchema(def.input, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline" });
}

export interface SanitizedIssue {
  path: string[];
  code: string;
}

/** Validation issues reduced to known field names and issue codes. Caller-supplied values are never echoed. */
export function sanitizeIssues(error: z.ZodError): SanitizedIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.slice(0, 6).map((seg) => {
      if (typeof seg === "number") return "#";
      return typeof seg === "string" && KNOWN_PATH_SEGMENTS.has(seg) ? seg : "*";
    }),
    code: issue.code,
  }));
}

export type CallOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; issues?: SanitizedIssue[] } };

export function callTool(name: string, rawArgs: unknown): CallOutcome {
  const def = TOOLS.find((t) => t.name === name);
  if (def === undefined) return { ok: false, error: { code: "UNKNOWN_TOOL", message: "No such tool." } };
  if (hasForbiddenStructure(rawArgs)) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "Input structure is not permitted.", issues: [] } };
  }
  const parsed = def.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Input failed schema validation.", issues: sanitizeIssues(parsed.error) },
    };
  }
  try {
    return { ok: true, result: def.run(parsed.data as never) };
  } catch (e) {
    if (e instanceof WwError) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: "INTERNAL", message: "Internal error." } };
  }
}

export function toolsDigest(): string {
  return evidenceDigest(
    TOOLS.map((t) => ({ name: t.name, description: t.description, schema: inputJsonSchema(t) })),
    { numbers: "jcs" },
  );
}
