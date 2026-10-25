import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { INTEGRITY_POLICY, recordedDigest } from "./integrity-policy.ts";

/**
 * Builds the WalletWall MCPB (MCP Bundle) for the official MCP Registry: a ZIP of exactly four files for the existing
 * local stdio server. The MCP Registry requires fileSha256, so SHA-256 remains only for that upstream compatibility
 * boundary. WalletWall additionally records the policy-selected current integrity digest.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const SHA256_FILE = INTEGRITY_POLICY.sha256Exceptions.compatibility.mcpRegistryArtifact;
const SHA512_FILE = INTEGRITY_POLICY.current.mcpb;
const ARTIFACT_NAME = "walletwall.mcpb";
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

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
const digest = (algorithm: "sha256" | "sha512", b: Buffer): string => createHash(algorithm).update(b).digest("hex");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const normalise = (b: Buffer): Buffer => Buffer.from(b.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
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
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function hashes(zip: Buffer): { sha256: string; sha512: string } {
  return { sha256: digest("sha256", zip), sha512: digest(INTEGRITY_POLICY.currentAlgorithm, zip) };
}

if (process.argv.includes("--check")) {
  const members = fromWorkingTree();
  const zip = archive(members);
  const hex = hashes(zip);
  let current256 = "";
  let current512 = "";
  try {
    current256 = readFileSync(join(root, SHA256_FILE), "utf8");
    current512 = readFileSync(join(root, SHA512_FILE), "utf8");
  } catch {
    // reported below
  }
  if (current256.replace(/\r\n/g, "\n") !== shaLine(hex.sha256, members.length)) fail(`MCP Registry SHA-256 changed: ${SHA256_FILE} records ${recordedDigest(current256) || "nothing"}, the inputs pack to ${hex.sha256}.\nReview the diff, then run: npm run gen:mcpb`);
  if (current512.replace(/\r\n/g, "\n") !== shaLine(hex.sha512, members.length)) fail(`WalletWall ${INTEGRITY_POLICY.currentAlgorithm.toUpperCase()} changed: ${SHA512_FILE} records ${recordedDigest(current512) || "nothing"}, the inputs pack to ${hex.sha512}.\nReview the diff, then run: npm run gen:mcpb`);
  const inputs = SOURCES.map(([, source]) => source);
  const clean = git(["status", "--porcelain", "--untracked-files=all", "--", ...inputs]).length === 0;
  if (clean) {
    const objectHashes = hashes(archive(fromGit("HEAD")));
    if (objectHashes.sha256 !== hex.sha256 || objectHashes.sha512 !== hex.sha512) fail("The working tree and Git objects at HEAD produce different MCPB bytes.");
  }
  console.log(`mcpb verified: registry sha256 ${hex.sha256}; WalletWall ${INTEGRITY_POLICY.currentAlgorithm} ${hex.sha512} (${members.length} files${clean ? "; equal to the build from Git objects at HEAD" : "; inputs have uncommitted changes, Git-object cross-check skipped"})`);
} else if (process.argv.includes("--write-hash")) {
  const members = fromWorkingTree();
  const hex = hashes(archive(members));
  writeFileSync(join(root, SHA256_FILE), shaLine(hex.sha256, members.length));
  writeFileSync(join(root, SHA512_FILE), shaLine(hex.sha512, members.length));
  console.log(`wrote ${SHA256_FILE}: sha256 ${hex.sha256}`);
  console.log(`wrote ${SHA512_FILE}: ${INTEGRITY_POLICY.currentAlgorithm} ${hex.sha512}`);
} else {
  const out = arg("--out");
  if (!out) fail("Usage: node scripts/pack-mcpb.ts --check | --write-hash | --out <file> [--ref <commit>]");
  const ref = arg("--ref") ?? "HEAD";
  const fromTree = process.argv.includes("--from-tree");
  const members = fromTree ? fromWorkingTree() : fromGit(ref);
  const zip = archive(members);
  const hex = hashes(zip);
  let expected256 = "";
  let expected512 = "";
  try {
    if (!fromTree) {
      expected256 = recordedDigest(git(["show", `${ref}:${SHA256_FILE}`]).toString("utf8"));
      expected512 = recordedDigest(git(["show", `${ref}:${SHA512_FILE}`]).toString("utf8"));
    }
  } catch {
    // older commits may not record both hashes
  }
  writeFileSync(out, zip);
  console.log(`registry sha256 ${hex.sha256}; WalletWall ${INTEGRITY_POLICY.currentAlgorithm} ${hex.sha512}  ${out} (${members.length} files from ${ref})`);
  if (expected256 && expected256 !== hex.sha256) fail(`This does not match ${SHA256_FILE} at ${ref} (${expected256}).`);
  if (expected512 && expected512 !== hex.sha512) fail(`This does not match ${SHA512_FILE} at ${ref} (${expected512}).`);
}
