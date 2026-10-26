import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../packages/mcp/src/canonical.ts";
import { isCanonicalInstant } from "../packages/mcp/src/wallprint/history.ts";
import {
  buildPublicDisclosure,
  comparePublication,
  extendStanding,
  isPublishableId,
  publicationFindings,
  publicationIndex,
  recordStanding,
  storeGraphFindings,
  STORE_RECORDS_DIR,
  STORE_STANDING_FILE,
  verifyPublicDisclosure,
  verifyStanding,
  type DisclosureExport,
  type PublicationIndex,
  type RecordStanding,
} from "../packages/mcp/src/wallprint/publication.ts";
import { HEX64_RE } from "../packages/mcp/src/wallprint/record.ts";
import { isResolverBase } from "../packages/mcp/src/wallprint/reference.ts";
import { buildWallPrintDisclosures } from "../packages/mcp/test/support/wallprint-disclosures.ts";

/**
 * The deliberate publication step: turn disclosure exports into the public store the resolver serves.
 *
 *   node scripts/wallprint-publish.ts --from-fixtures --published-at <instant> --resolver-base <https origin> [--expect-refused id,id]
 *   node scripts/wallprint-publish.ts --export <file.json>  --published-at <instant> [--resolver-base <https origin>]
 *   node scripts/wallprint-publish.ts --check
 *
 * Store layout (packages/wallprint-web/publication, or --dir):
 *   records/<id>/<digest>.json   the immutable public disclosure, RFC 8785 bytes, written once and never changed
 *   records/<id>/index.json      the record's standing (append-only metadata), rewritten only when it extends
 *   index.json                   the publication index (resolver base, route, one entry per publication)
 *
 * Nothing is written unless every export either publishes or is an expected refusal and no conflict was found; the
 * instant of publication and the resolver base are explicit arguments (no clock is read, no base is assumed). `--check`
 * verifies the whole store: every artifact proves itself, every standing verifies and names exactly its artifacts, and
 * the index is byte for byte what the standings regenerate.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const value = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] as string) : null;
};
const dir = value("--dir") ?? join(root, "packages", "wallprint-web", "publication");
const recordsDir = join(dir, STORE_RECORDS_DIR);
const indexPath = join(dir, "index.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const readText = (p: string): string => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function readIndex(): PublicationIndex | null {
  if (!existsSync(indexPath)) return null;
  const parsed: unknown = JSON.parse(readText(indexPath));
  if (parsed === null || typeof parsed !== "object") fail("index.json is not an object");
  return parsed as PublicationIndex;
}

function listStandings(): RecordStanding[] {
  if (!existsSync(recordsDir)) return [];
  const out: RecordStanding[] = [];
  for (const id of readdirSync(recordsDir).sort()) {
    const standingPath = join(recordsDir, id, STORE_STANDING_FILE);
    if (!existsSync(standingPath)) fail(`${id}: no standing document`);
    const v = verifyStanding(JSON.parse(readText(standingPath)));
    if (!v.ok) fail(`${id}: standing does not verify: ${JSON.stringify(v.findings)}`);
    if (v.standing.recordId !== id) fail(`${id}: standing names another record`);
    out.push(v.standing);
  }
  return out;
}

function check(): void {
  const index = readIndex();
  if (index === null) fail("no index.json: nothing is published here");
  if (!isResolverBase(index.resolverBase)) fail("index.json names no valid resolver base");
  const rootEntries = readdirSync(dir).sort();
  const expectedRoot = existsSync(recordsDir) ? ["index.json", STORE_RECORDS_DIR] : ["index.json"];
  if (rootEntries.join("|") !== expectedRoot.join("|")) fail(`unexpected entries in the publication directory: ${rootEntries.join(", ")}`);
  const standings = listStandings();
  let artifacts = 0;
  for (const s of standings) {
    const id = s.recordId;
    if (!isPublishableId(id)) fail(`${id}: not a publishable id`);
    const files = readdirSync(join(recordsDir, id)).sort();
    const digests = files.filter((f) => f !== STORE_STANDING_FILE).map((f) => f.replace(/\.json$/, ""));
    for (const f of files) if (f !== STORE_STANDING_FILE && !/^[0-9a-f]{64}\.json$/.test(f)) fail(`${id}/${f}: not an artifact file name`);
    const published = s.publications.map((p) => p.digest).sort();
    if (digests.join("|") !== published.join("|")) fail(`${id}: the standing's publications and the artifact files differ`);
    for (const digest of digests) {
      const bytes = readText(join(recordsDir, id, `${digest}.json`));
      const v = verifyPublicDisclosure(bytes);
      if (!v.ok) fail(`${id}/${digest}: artifact does not verify: ${JSON.stringify(v.findings)}`);
      if (v.artifact.recordId !== id || v.artifact.digest !== digest) fail(`${id}/${digest}: artifact names another record or digest`);
      if (!HEX64_RE.test(digest)) fail(`${id}/${digest}: not a digest`);
      artifacts++;
    }
  }
  const graph = storeGraphFindings(standings);
  if (graph.length > 0) fail(`the store graph is inconsistent: ${JSON.stringify(graph)}`);
  const regenerated = canonicalize(publicationIndex(standings, index.resolverBase));
  if (regenerated !== readText(indexPath)) fail("index.json is not what the standings regenerate. Run the publisher again.");
  console.log(`wallprint publication current: ${standings.length} records, ${artifacts} artifacts, resolver base ${index.resolverBase}`);
}

interface Plan {
  id: string;
  digest: string;
  artifactPath: string;
  bytes: string | null; // null when identical bytes are already published
  standingPath: string;
  standing: RecordStanding | null; // null when unchanged
  note: string;
}

function loadExports(): DisclosureExport[] {
  if (flag("--from-fixtures")) {
    const fixtures = buildWallPrintDisclosures();
    return Object.values(fixtures).flatMap((f) => f.records.map((r) => structuredClone({ title: f.title, construction: f.scenario, registry: f.registry, ...r }) as unknown as DisclosureExport));
  }
  const file = value("--export");
  if (file === null) fail("Provide --from-fixtures or --export <file.json>, or --check.");
  const parsed: unknown = JSON.parse(readText(file));
  return Array.isArray(parsed) ? (parsed as DisclosureExport[]) : [parsed as DisclosureExport];
}

function publish(): void {
  const publishedAt = value("--published-at");
  if (!isCanonicalInstant(publishedAt)) fail("--published-at must be a canonical instant (UTC, millisecond precision), e.g. 2026-10-26T18:00:00.000Z");
  const existingIndex = readIndex();
  const resolverBase = value("--resolver-base") ?? existingIndex?.resolverBase ?? null;
  if (!isResolverBase(resolverBase)) fail("--resolver-base must be exactly one HTTPS origin (or index.json must already name one)");
  const expectRefused = new Set((value("--expect-refused") ?? "").split(",").filter(Boolean));
  const exports = loadExports();
  const plans: Plan[] = [];
  const refused: string[] = [];
  const failures: string[] = [];
  for (const e of exports) {
    const id = typeof (e as { id?: unknown }).id === "string" ? (e as { id: string }).id : "(no id)";
    const findings = publicationFindings(e);
    if (findings.length > 0) {
      if (expectRefused.has(id)) {
        refused.push(id);
        continue;
      }
      failures.push(`${id}: refused: ${JSON.stringify(findings)}`);
      continue;
    }
    const { artifact, bytes } = buildPublicDisclosure(e);
    const recordDir = join(recordsDir, artifact.recordId);
    const artifactPath = join(recordDir, `${artifact.digest}.json`);
    let artifactBytes: string | null = bytes;
    let note = "NEW";
    if (existsSync(artifactPath)) {
      const outcome = comparePublication(readText(artifactPath), bytes);
      if (outcome === "CONFLICT") {
        failures.push(`${artifact.recordId}/${artifact.digest}: CONFLICT: different bytes are already published under this id and digest; nothing is overwritten`);
        continue;
      }
      artifactBytes = null;
      note = "IDENTICAL";
    }
    const standingPath = join(recordDir, STORE_STANDING_FILE);
    const next = recordStanding(e, [{ digest: artifact.digest, wallprintVersion: artifact.wallprintVersion, publishedAt }]);
    let existing: unknown = null;
    if (existsSync(standingPath)) {
      const v = verifyStanding(JSON.parse(readText(standingPath)));
      if (!v.ok) {
        failures.push(`${artifact.recordId}: the existing standing does not verify: ${JSON.stringify(v.findings)}`);
        continue;
      }
      existing = v.standing;
    }
    const ext = extendStanding(existing, next);
    if (!ext.ok) {
      failures.push(`${artifact.recordId}: standing would not extend: ${JSON.stringify(ext.findings)}`);
      continue;
    }
    plans.push({ id: artifact.recordId, digest: artifact.digest, artifactPath, bytes: artifactBytes, standingPath, standing: ext.changed ? ext.standing : null, note: `${note}${ext.changed ? (existing === null ? "" : ", standing extended") : ""}` });
  }
  // The store as it will be after this publication: standings on disk, overlaid with every standing this run extends.
  const finalStandings = new Map(listStandings().map((st) => [st.recordId, st]));
  for (const p of plans) if (p.standing !== null) finalStandings.set(p.id, p.standing);
  const graph = storeGraphFindings([...finalStandings.values()]);
  if (graph.length > 0) failures.push(`the store graph would be inconsistent: ${JSON.stringify(graph)}`);
  const unexpected = [...expectRefused].filter((id) => !refused.includes(id));
  if (unexpected.length) failures.push(`expected refusals that were not refused: ${unexpected.join(", ")}`);
  if (failures.length) {
    for (const f of failures) console.error(f);
    fail(`Nothing was written: ${failures.length} problem(s).`);
  }
  // Every decision is made; now write, artifacts first, then standings, then the regenerated index.
  for (const p of plans) {
    mkdirSync(join(recordsDir, p.id), { recursive: true });
    if (p.bytes !== null) writeFileSync(p.artifactPath, p.bytes);
    if (p.standing !== null) writeFileSync(p.standingPath, canonicalize(p.standing));
    console.log(`${p.id} ${p.digest.slice(0, 12)}… ${p.note}`);
  }
  for (const id of refused) console.log(`${id} REFUSED (expected): not published`);
  const index = publicationIndex(listStandings(), resolverBase);
  writeFileSync(indexPath, canonicalize(index));
  console.log(`index.json: ${index.records.length} publication(s), resolver base ${resolverBase}`);
}

if (flag("--check")) check();
else {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!statSync(dir).isDirectory()) fail(`${dir} is not a directory`);
  publish();
}
