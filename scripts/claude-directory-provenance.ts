import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Sort order of PROVENANCE.json entries: the UTF-16 code units of the path. String#localeCompare would make the
 * manifest depend on the build machine's locale (lt-LT, for one, sorts `y` between `i` and `j`).
 */
export const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The source commit PROVENANCE.json records. An explicit WALLETWALL_SOURCE_SHA must be a full lowercase commit SHA and,
 * when the build runs in a Git checkout, the checked-out HEAD, so the manifest cannot name a commit the payload was not
 * built from. Without it the commit is GITHUB_SHA, else "working-tree".
 */
export function sourceCommit(env: Record<string, string | undefined>, checkedOut: () => string | undefined): string {
  const pinned = env["WALLETWALL_SOURCE_SHA"];
  if (pinned === undefined) return env["GITHUB_SHA"] ?? "working-tree";
  if (!/^[0-9a-f]{40}$/.test(pinned)) {
    throw new Error(`WALLETWALL_SOURCE_SHA must be a full 40-character lowercase hex commit SHA; got ${JSON.stringify(pinned)}`);
  }
  const head = checkedOut();
  if (head !== undefined && head !== pinned) throw new Error(`WALLETWALL_SOURCE_SHA ${pinned} is not the checked-out commit ${head}`);
  return pinned;
}

/**
 * HEAD of the Git checkout at `root`, or undefined when `root` has no `.git` (a source export). Only `root` itself
 * counts: an export unpacked inside some other repository must not report that repository's HEAD.
 */
export function checkedOutCommit(root: string): string | undefined {
  if (!existsSync(join(root, ".git"))) return undefined;
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
