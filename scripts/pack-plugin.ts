import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the candidate plugin release artifact: a POSIX ustar archive of the tracked files under plugin/, with the
 * plugin root as the archive root. The bytes do not depend on the machine, the operating system or Git checkout
 * settings such as core.autocrlf:
 *
 * - members are the tracked plugin/ files only, ordered by path (byte order), with "/" separators; no directory entries;
 * - every header field is fixed: mtime 2026-01-01T00:00:00Z, uid and gid 0, empty owner names, mode 0644 (0755 only
 *   when Git records the file as executable); the archive ends with two zero blocks and is padded to 10240 bytes;
 * - a release build (--out) takes each file's bytes from the Git object database at a commit, never from a checkout;
 * - --check and --write-hash read the working tree (so the hash can be regenerated before committing), normalising text
 *   exactly as Git stores it (CRLF to LF; files with a NUL byte are binary and untouched). --check also builds the same
 *   archive from the Git objects at HEAD whenever plugin/ is unmodified, and fails if the two differ.
 *
 *   node scripts/pack-plugin.ts --check                  verify security/plugin-artifact.sha256 (CI: Linux and Windows)
 *   node scripts/pack-plugin.ts --write-hash             regenerate security/plugin-artifact.sha256
 *   node scripts/pack-plugin.ts --out <file> [--ref R]   write the release artifact from commit R (default HEAD)
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const SHA_FILE = "security/plugin-artifact.sha256";
const ARTIFACT_NAME = "walletwall-plugin.tar";
const MTIME = Date.UTC(2026, 0, 1) / 1000;
const BLOCK = 512;
const RECORD = 10240;

interface Member {
  path: string;
  executable: boolean;
  bytes: Buffer;
}

const git = (args: string[], input?: Buffer): Buffer => execFileSync("git", ["-C", root, ...args], { input, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] });
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Tracked files under plugin/ in the index or at a commit: [mode, path relative to plugin/]. */
function tracked(ref: string | null): { mode: string; path: string; blob: string }[] {
  const out = ref === null ? git(["ls-files", "-s", "-z", "--", "plugin/"]) : git(["ls-tree", "-r", "-z", ref, "--", "plugin/"]);
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t") as [string, string];
      const parts = meta.split(" ");
      const mode = parts[0] as string;
      const blob = (ref === null ? parts[1] : parts[2]) as string;
      if (mode !== "100644" && mode !== "100755") fail(`${path}: mode ${mode} is not a regular file; the plugin artifact holds regular files only`);
      if (!/^[\x21-\x7e]+$/.test(path)) fail(`${path}: plugin paths must be printable ASCII without spaces`);
      return { mode, path: path.slice("plugin/".length), blob };
    });
}

/** Text as Git stores it under `* text=auto eol=lf`: CRLF becomes LF; a file containing a NUL byte is binary. */
const normalise = (b: Buffer): Buffer => (b.includes(0) ? b : Buffer.from(b.toString("latin1").replace(/\r\n/g, "\n"), "latin1"));

function fromWorkingTree(): Member[] {
  const files = tracked(null);
  const known = new Set(files.map((f) => f.path));
  const walk = (base: string): string[] =>
    readdirSync(join(root, "plugin", base)).flatMap((name) => {
      const rel = base === "" ? name : `${base}/${name}`;
      return statSync(join(root, "plugin", rel)).isDirectory() ? walk(rel) : [rel];
    });
  const extra = walk("").filter((p) => !known.has(p));
  if (extra.length) fail(`Untracked files in plugin/ would not be in the artifact: ${extra.join(", ")}. Add them to Git or remove them.`);
  return files.map((f) => ({ path: f.path, executable: f.mode === "100755", bytes: normalise(readFileSync(join(root, "plugin", f.path))) }));
}

function fromGit(ref: string): Member[] {
  const files = tracked(ref);
  if (files.length === 0) fail(`No plugin/ files at ${ref}`);
  const batch = git(["cat-file", "--batch"], Buffer.from(`${files.map((f) => f.blob).join("\n")}\n`));
  let at = 0;
  return files.map((f) => {
    const nl = batch.indexOf(0x0a, at);
    const [sha, type, size] = batch.toString("latin1", at, nl).split(" ");
    if (sha !== f.blob || type !== "blob") fail(`Unexpected object for ${f.path}: ${sha} ${type}`);
    const bytes = batch.subarray(nl + 1, nl + 1 + Number(size));
    at = nl + 1 + Number(size) + 1;
    return { path: f.path, executable: f.mode === "100755", bytes: Buffer.from(bytes) };
  });
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(m: Member): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  let name = m.path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    let split = -1;
    for (let i = name.indexOf("/"); i >= 0; i = name.indexOf("/", i + 1)) if (i <= 155 && name.length - i - 1 <= 100) { split = i; break; }
    if (split < 0) fail(`${m.path}: path too long for a ustar header`);
    prefix = name.slice(0, split);
    name = name.slice(split + 1);
  }
  h.write(name, 0, 100, "ascii");
  h.write(octal(m.executable ? 0o755 : 0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(m.bytes.length, 12), 124, 12, "ascii");
  h.write(octal(MTIME, 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write("0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(octal(0, 8), 329, 8, "ascii");
  h.write(octal(0, 8), 337, 8, "ascii");
  h.write(prefix, 345, 155, "ascii");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

function archive(members: Member[]): Buffer {
  const sorted = [...members].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const parts: Buffer[] = [];
  for (const m of sorted) {
    parts.push(header(m), m.bytes);
    const pad = (BLOCK - (m.bytes.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  const body = Buffer.concat(parts);
  const tail = (RECORD - (body.length % RECORD)) % RECORD;
  return tail ? Buffer.concat([body, Buffer.alloc(tail, 0)]) : body;
}

const shaLine = (hex: string, count: number): string => `${hex}  ${ARTIFACT_NAME} (deterministic ustar of the ${count} tracked plugin/ files; scripts/pack-plugin.ts)\n`;
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
  if (current.replace(/\r\n/g, "\n") !== shaLine(hex, members.length)) fail(`Plugin artifact changed: ${SHA_FILE} records ${recorded(current) || "nothing"}, plugin/ packs to ${hex}.\nReview the diff, then run: npm run gen:plugin-artifact`);
  const clean = git(["status", "--porcelain", "--untracked-files=all", "--", "plugin/"]).length === 0;
  if (clean) {
    const fromObjects = sha256(archive(fromGit("HEAD")));
    if (fromObjects !== hex) fail(`The working tree packs to ${hex} but the Git objects at HEAD pack to ${fromObjects}: the checkout converted plugin/ bytes.`);
  }
  console.log(`plugin artifact verified: sha256 ${hex} (${members.length} files${clean ? "; equal to the build from Git objects at HEAD" : "; plugin/ has uncommitted changes, Git-object cross-check skipped"})`);
} else if (process.argv.includes("--write-hash")) {
  const members = fromWorkingTree();
  const hex = sha256(archive(members));
  writeFileSync(join(root, SHA_FILE), shaLine(hex, members.length));
  console.log(`wrote ${SHA_FILE}: sha256 ${hex} (${members.length} files)`);
} else {
  const out = arg("--out");
  if (!out) fail("Usage: node scripts/pack-plugin.ts --check | --write-hash | --out <file> [--ref <commit>]");
  const ref = arg("--ref") ?? "HEAD";
  const members = fromGit(ref);
  const tar = archive(members);
  const hex = sha256(tar);
  let expected = "";
  try {
    expected = recorded(git(["show", `${ref}:${SHA_FILE}`]).toString("utf8"));
  } catch {
    // a commit from before this script existed records no hash
  }
  writeFileSync(out, tar);
  console.log(`${hex}  ${out} (${members.length} files from ${ref})`);
  if (expected && expected !== hex) fail(`This does not match ${SHA_FILE} at ${ref} (${expected}).`);
}
