import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface IntegrityPolicy {
  policyVersion: "1";
  currentAlgorithm: "sha512";
  current: {
    bundle: string;
    toolManifest: string;
    pluginManifest: string;
    pluginArtifact: string;
    mcpb: string;
  };
  sha256Exceptions: {
    compatibility: { mcpRegistryArtifact: string };
    protocol: { evidenceDigestImplementation: string; resourceDigestImplementation: string };
    provenance: {
      brandSources: string;
      agentFinderDraft: string;
      agentFinderRegression: string;
      apacheReferenceRegression: string;
    };
    testOnly: { fingerprintHarness: string; canonicalRegression: string; mcpbRegression: string };
    historical: { pluginV030: string; releaseV030: string };
  };
  historicalDocuments: string[];
}

const policyPath = fileURLToPath(new URL("../security/integrity-policy.json", import.meta.url));

function fail(message: string): never {
  throw new Error(`Invalid integrity policy: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} keys must be exactly: ${wanted.join(", ")}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function repoPath(value: unknown, label: string): string {
  const path = text(value, label);
  const hasWildcard = path.includes("*") || path.includes("?") || path.includes("[") || path.includes("]");
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || hasWildcard) fail(`${label} must be one exact repository-relative path without traversal or wildcards`);
  return path;
}

function parsePolicy(): IntegrityPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    return fail("security/integrity-policy.json is missing or invalid JSON");
  }

  const root = record(parsed, "root");
  exactKeys(root, ["policyVersion", "currentAlgorithm", "current", "sha256Exceptions", "historicalDocuments"], "root");
  if (root["policyVersion"] !== "1") fail("policyVersion must be 1");
  if (root["currentAlgorithm"] !== "sha512") fail("currentAlgorithm must be sha512");

  const current = record(root["current"], "current");
  exactKeys(current, ["bundle", "toolManifest", "pluginManifest", "pluginArtifact", "mcpb"], "current");
  const currentPaths = {
    bundle: repoPath(current["bundle"], "current.bundle"),
    toolManifest: repoPath(current["toolManifest"], "current.toolManifest"),
    pluginManifest: repoPath(current["pluginManifest"], "current.pluginManifest"),
    pluginArtifact: repoPath(current["pluginArtifact"], "current.pluginArtifact"),
    mcpb: repoPath(current["mcpb"], "current.mcpb"),
  };
  for (const [name, path] of Object.entries(currentPaths)) if (!path.endsWith(".sha512")) fail(`current.${name} must end in .sha512`);
  if (new Set(Object.values(currentPaths)).size !== Object.values(currentPaths).length) fail("current record paths must be unique");

  const exceptions = record(root["sha256Exceptions"], "sha256Exceptions");
  exactKeys(exceptions, ["compatibility", "protocol", "provenance", "testOnly", "historical"], "sha256Exceptions");
  const compatibility = record(exceptions["compatibility"], "sha256Exceptions.compatibility");
  exactKeys(compatibility, ["mcpRegistryArtifact"], "sha256Exceptions.compatibility");
  const protocol = record(exceptions["protocol"], "sha256Exceptions.protocol");
  exactKeys(protocol, ["evidenceDigestImplementation", "resourceDigestImplementation"], "sha256Exceptions.protocol");
  const provenance = record(exceptions["provenance"], "sha256Exceptions.provenance");
  exactKeys(provenance, ["brandSources", "agentFinderDraft", "agentFinderRegression", "apacheReferenceRegression"], "sha256Exceptions.provenance");
  const testOnly = record(exceptions["testOnly"], "sha256Exceptions.testOnly");
  exactKeys(testOnly, ["fingerprintHarness", "canonicalRegression", "mcpbRegression"], "sha256Exceptions.testOnly");
  const historical = record(exceptions["historical"], "sha256Exceptions.historical");
  exactKeys(historical, ["pluginV030", "releaseV030"], "sha256Exceptions.historical");

  const exceptionPaths = {
    compatibility: { mcpRegistryArtifact: repoPath(compatibility["mcpRegistryArtifact"], "sha256Exceptions.compatibility.mcpRegistryArtifact") },
    protocol: {
      evidenceDigestImplementation: repoPath(protocol["evidenceDigestImplementation"], "sha256Exceptions.protocol.evidenceDigestImplementation"),
      resourceDigestImplementation: repoPath(protocol["resourceDigestImplementation"], "sha256Exceptions.protocol.resourceDigestImplementation"),
    },
    provenance: {
      brandSources: repoPath(provenance["brandSources"], "sha256Exceptions.provenance.brandSources"),
      agentFinderDraft: repoPath(provenance["agentFinderDraft"], "sha256Exceptions.provenance.agentFinderDraft"),
      agentFinderRegression: repoPath(provenance["agentFinderRegression"], "sha256Exceptions.provenance.agentFinderRegression"),
      apacheReferenceRegression: repoPath(provenance["apacheReferenceRegression"], "sha256Exceptions.provenance.apacheReferenceRegression"),
    },
    testOnly: {
      fingerprintHarness: repoPath(testOnly["fingerprintHarness"], "sha256Exceptions.testOnly.fingerprintHarness"),
      canonicalRegression: repoPath(testOnly["canonicalRegression"], "sha256Exceptions.testOnly.canonicalRegression"),
      mcpbRegression: repoPath(testOnly["mcpbRegression"], "sha256Exceptions.testOnly.mcpbRegression"),
    },
    historical: {
      pluginV030: repoPath(historical["pluginV030"], "sha256Exceptions.historical.pluginV030"),
      releaseV030: repoPath(historical["releaseV030"], "sha256Exceptions.historical.releaseV030"),
    },
  };
  const flatExceptions = Object.values(exceptionPaths).flatMap((group) => Object.values(group));
  if (new Set(flatExceptions).size !== flatExceptions.length) fail("each SHA-256 exception path must have exactly one purpose");
  const overlap = flatExceptions.filter((path) => Object.values(currentPaths).includes(path));
  if (overlap.length > 0) fail(`current and SHA-256 exception paths overlap: ${overlap.join(", ")}`);

  const documentsRaw = root["historicalDocuments"];
  if (!Array.isArray(documentsRaw) || documentsRaw.length === 0) fail("historicalDocuments must be a non-empty array");
  const historicalDocuments = documentsRaw.map((value, index) => repoPath(value, `historicalDocuments[${index}]`));
  if (new Set(historicalDocuments).size !== historicalDocuments.length) fail("historicalDocuments must be unique");

  return Object.freeze({
    policyVersion: "1",
    currentAlgorithm: "sha512",
    current: Object.freeze(currentPaths),
    sha256Exceptions: Object.freeze({
      compatibility: Object.freeze(exceptionPaths.compatibility),
      protocol: Object.freeze(exceptionPaths.protocol),
      provenance: Object.freeze(exceptionPaths.provenance),
      testOnly: Object.freeze(exceptionPaths.testOnly),
      historical: Object.freeze(exceptionPaths.historical),
    }),
    historicalDocuments: Object.freeze(historicalDocuments) as unknown as string[],
  });
}

export const INTEGRITY_POLICY = parsePolicy();

export const SHA512_HEX = /^[0-9a-f]{128}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;

export function currentIntegrityHex(text: string): string {
  return createHash(INTEGRITY_POLICY.currentAlgorithm).update(text, "utf8").digest("hex");
}

export function recordedDigest(textValue: string): string {
  return textValue.trim().split(/\s+/)[0] ?? "";
}
