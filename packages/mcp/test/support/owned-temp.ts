/**
 * The only place in this repository that creates or automatically deletes temporary directories.
 *
 * Invariant: WalletWallrus-Copilot may only automatically delete temporary paths that it created itself beneath a
 * uniquely owned temp root, `<system temp>/walletwallrus-copilot/<run-id>/`. Nothing here ever matches a glob or a
 * name pattern in the system temp directory, never deletes a sibling of the owned root, and refuses any path that
 * does not resolve (after following existing links) to a location inside the run directory it was handed.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const OWNED_ROOT_NAME = "walletwallrus-copilot";
export const MARKER_FILE = ".walletwallrus-copilot-run";
const RUN_ID_RE = /^run-[0-9]{1,10}-[0-9a-f]{16}$/;

export class UnsafeCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCleanupError";
  }
}

const same = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** True if `child` is `parent` or lies beneath it, judged on lexical paths that are already resolved. */
export function isInside(parent: string, child: string, opts: { allowEqual: boolean }): boolean {
  const rel = relative(parent, child);
  if (rel === "") return opts.allowEqual;
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function ownedTempRoot(base: string = tmpdir()): string {
  return join(base, OWNED_ROOT_NAME);
}

export class OwnedRun {
  /** Canonical (link-free) location of this run, `<real temp base>/walletwallrus-copilot/<run-id>`. */
  readonly dir: string;
  readonly id: string;
  private readonly expectedParent: string;
  private disposed = false;

  constructor(realBase: string, id: string) {
    if (!RUN_ID_RE.test(id)) throw new UnsafeCleanupError("run id is not well formed");
    this.id = id;
    this.expectedParent = join(realBase, OWNED_ROOT_NAME);
    this.dir = join(this.expectedParent, id);
  }

  /** Resolves a path beneath the run directory. Absolute paths, drive-relative paths and any `..` escape are refused. */
  path(...segments: string[]): string {
    for (const s of segments) {
      if (s.includes("\0") || isAbsolute(s) || /^[A-Za-z]:/.test(s) || s.startsWith("\\") || s.startsWith("/")) {
        throw new UnsafeCleanupError("path segment is not relative");
      }
    }
    const p = resolve(this.dir, ...segments);
    if (!isInside(this.dir, p, { allowEqual: true })) throw new UnsafeCleanupError("path escapes the owned run directory");
    return p;
  }

  mkdir(...segments: string[]): string {
    const p = this.path(...segments);
    mkdirSync(p, { recursive: true });
    return p;
  }

  /** Confirms the run directory is still the real directory this handle created and carries this run's marker. */
  private assertOwned(): void {
    let st;
    try {
      st = lstatSync(this.dir);
    } catch {
      throw new UnsafeCleanupError("run directory does not exist");
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new UnsafeCleanupError("run directory is not a plain directory");
    if (!same(realpathSync(this.dir), this.dir)) throw new UnsafeCleanupError("run directory resolves elsewhere");
    let marker: unknown;
    try {
      marker = JSON.parse(readFileSync(join(this.dir, MARKER_FILE), "utf8"));
    } catch {
      throw new UnsafeCleanupError("run directory carries no ownership marker");
    }
    if ((marker as { runId?: unknown } | null)?.runId !== this.id) throw new UnsafeCleanupError("ownership marker names another run");
  }

  /** Deletes one path beneath the run directory. Links are removed, never followed. */
  remove(target: string): void {
    this.assertOwned();
    const abs = isAbsolute(target) ? resolve(target) : this.path(target);
    if (!isInside(this.dir, abs, { allowEqual: false })) throw new UnsafeCleanupError("refusing to delete outside the owned run directory");
    let parent: string;
    try {
      parent = realpathSync(join(abs, ".."));
    } catch {
      return;
    }
    if (!isInside(this.dir, parent, { allowEqual: true })) throw new UnsafeCleanupError("parent resolves outside the owned run directory");
    rmSync(abs, { recursive: true, force: true });
  }

  /** Deletes the whole run directory (and the owned root, if that leaves it empty). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    try {
      this.assertOwned();
    } catch (e) {
      if (e instanceof UnsafeCleanupError && e.message === "run directory does not exist") {
        this.disposed = true;
        return;
      }
      throw e;
    }
    rmSync(this.dir, { recursive: true, force: true });
    this.disposed = true;
    try {
      rmdirSync(this.expectedParent);
    } catch {
      // not empty (another run is active) or already gone
    }
  }
}

/** Creates a fresh, uniquely named run directory beneath `<temp base>/walletwallrus-copilot/`. */
export function createOwnedRun(base: string = tmpdir()): OwnedRun {
  const realBase = realpathSync(base);
  const id = `run-${process.pid}-${randomBytes(8).toString("hex")}`;
  const run = new OwnedRun(realBase, id);
  for (let attempt = 0; ; attempt++) {
    mkdirSync(join(realBase, OWNED_ROOT_NAME), { recursive: true });
    try {
      mkdirSync(run.dir);
      break;
    } catch (e) {
      // another run removed the now-empty owned root between the two calls; try again
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= 5) throw e;
    }
  }
  writeFileSync(join(run.dir, MARKER_FILE), `${JSON.stringify({ schema: 1, runId: id, pid: process.pid })}\n`, { flag: "wx" });
  return run;
}
