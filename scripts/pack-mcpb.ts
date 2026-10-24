import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

/**
 * Builds the WalletWall MCPB (MCP Bundle) for the official MCP Registry: a ZIP of exactly four files for the existing
 * local stdio server. Nothing else is packaged: no canvas, no skill, no evals, no documents, no .git, no node_modules.
 *
 *   manifest.json              from mcpb/manifest.json
 *   server/walletwall-mcp.mjs  the shipped single-file bundle, byte-identical to plugin/server/walletwall-mcp.mjs
 *   LICENSE                    Apache-2.0
 *   THIRD_PARTY_NOTICES.md     notices for the packages bundled into the server file (the plugin's canvas font section is removed)
 *
 * The bytes do not depend on the machine, the operating system, the zlib version or Git checkout settings:
 * entries are STORED (no compression), ordered by path (byte order), with a fixed timestamp (2026-01-01 00:00:00), a fixed
 * "made by" and mode 0644, no extra fields, no comments, no directory entries. A release build (--out) reads every file
 * from the Git object database at a commit. --check and --write-hash read the working tree, normalising text exactly as
 * Git stores it (CRLF to LF), and --check also builds from the Git objects at HEAD when the inputs are unmodified.
 *
 *   node scripts/pack-mcpb.ts --check                  verify security/mcpb.sha256
 *   node scripts/pack-mcpb.ts --write-hash             regenerate security/mcpb.sha256
 *   node scripts/pack-mcpb.ts --out <file> [--ref R]   write the release artifact from commit R (default HEAD)
 *   node scripts/pack-mcpb.ts --out <file> --from-tree  write it from the working tree (tests only; not a release build)
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const SHA_FILE = "security/mcpb.sha256";
const ARTIFACT_NAME = "walletwall.mcpb";
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Archive path -> repository path. */
const SOURCES: readonly (readonly [string, string])[] = [
  ["LICENSE", "LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "plugin/THIRD_PARTY_NOTICES.md"],
  ["manifest.json", "mcpb/manifest.json"],
  ["server/walletwall-mcp.mjs", "plugin/server/walletwall-mcp.mjs"],
];

interface Member {
  path: string;
  bytes: Buffer;
}

const git = (args: string[]): Buffer => execFileSync("git", ["-C", root, ...args], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Text as Git stores it under `* text=auto eol=lf`: CRLF becomes LF. */
const normalise = (b: Buffer): Buffer => Buffer.from(b.toString("latin1").replace(/\r\n/g, "\n"), "latin1");

/** The notices file is generated for the plugin: its font section belongs to the canvas, which this package does not contain. */
const CANVAS_NOTICES = "\n# Fonts embedded in the WalletWall canvas";
function forPackage(m: Member): Member {
  if (m.path !== "THIRD_PARTY_NOTICES.md") return m;
  const text = m.bytes.toString("utf8");
  const at = text.indexOf(CANVAS_NOTICES);
  if (at < 0) fail("THIRD_PARTY_NOTICES.md no longer has the canvas font section this packer removes; update scripts/pack-mcpb.ts.");
  return { path: m.path, bytes: Buffer.from(`${text.slice(0, at).trimEnd()}\n`, "utf8") };
}

const fromWorkingTree = (): Member[] => SOURCES.map(([path, source]) => forPackage({ path, bytes: normalise(readFileSync(join(root, source))) }));
const fromGit = (ref: string): Member[] => SOURCES.map(([path, source]) => forPackage({ path, bytes: git(["show", `${ref}:${source}`]) }));

function archive(members: Member[]): Buffer {
  const sorted = [...members].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const m of sorted) {
    if (!/^[\x21-\x7e]+$/.test(m.path)) fail(`${m.path}: archive paths must be printable ASCII without spaces`);
    const name = Buffer.from(m.path, "ascii");
    const crc = crc32(m.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(m.bytes.length, 18);
    local.writeUInt32LE(m.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const entry = Buffer.concat([local, name, m.bytes]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(m.bytes.length, 20);
    cd.writeUInt32LE(m.bytes.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    locals.push(entry);
    offset += entry.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const shaLine = (hex: string, count: number): string => `${hex}  ${ARTIFACT_NAME} (deterministic stored ZIP of ${count} files; scripts/pack-mcpb.ts)\n`;
const recorded = (text: string): string => text.split(/\s+/)[0] ?? "";
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (process.argv.includes("--check")) {
  const members = fromWorkingTree();
  const hex = sha256(archive(members));
  let current = "";
  try {
    current = readFileSync(join(root, SHA_FILE), "utf8");
  } catch {
    // reported below
  }
  if (current.replace(/\r\n/g, "\n") !== shaLine(hex, members.length)) fail(`MCPB changed: ${SHA_FILE} records ${recorded(current) || "nothing"}, the inputs pack to ${hex}.\nReview the diff, then run: npm run gen:mcpb`);
  const inputs = SOURCES.map(([, source]) => source);
  const clean = git(["status", "--porcelain", "--untracked-files=all", "--", ...inputs]).length === 0;
  if (clean) {
    const fromObjects = sha256(archive(fromGit("HEAD")));
    if (fromObjects !== hex) fail(`The working tree packs to ${hex} but the Git objects at HEAD pack to ${fromObjects}: the checkout converted input bytes.`);
  }
  console.log(`mcpb verified: sha256 ${hex} (${members.length} files${clean ? "; equal to the build from Git objects at HEAD" : "; inputs have uncommitted changes, Git-object cross-check skipped"})`);
} else if (process.argv.includes("--write-hash")) {
  const members = fromWorkingTree();
  const hex = sha256(archive(members));
  writeFileSync(join(root, SHA_FILE), shaLine(hex, members.length));
  console.log(`wrote ${SHA_FILE}: sha256 ${hex} (${members.length} files)`);
} else {
  const out = arg("--out");
  if (!out) fail("Usage: node scripts/pack-mcpb.ts --check | --write-hash | --out <file> [--ref <commit>]");
  const ref = arg("--ref") ?? "HEAD";
  const fromTree = process.argv.includes("--from-tree");
  const members = fromTree ? fromWorkingTree() : fromGit(ref);
  const zip = archive(members);
  const hex = sha256(zip);
  let expected = "";
  try {
    expected = fromTree ? "" : recorded(git(["show", `${ref}:${SHA_FILE}`]).toString("utf8"));
  } catch {
    // a commit from before this script existed records no hash
  }
  writeFileSync(out, zip);
  console.log(`${hex}  ${out} (${members.length} files from ${ref})`);
  if (expected && expected !== hex) fail(`This does not match ${SHA_FILE} at ${ref} (${expected}).`);
}
