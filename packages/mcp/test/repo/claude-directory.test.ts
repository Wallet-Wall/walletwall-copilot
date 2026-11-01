import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";
import { byPath, checkedOutCommit, sourceCommit } from "../../../../scripts/claude-directory-provenance.ts";
import { ROOT } from "../support/harness.ts";
import { createOwnedRun } from "../support/owned-temp.ts";

const HEAD_A = "eb641bf8a0ffab0d6ea015fb553063a73ba63766";
const HEAD_B = "96d15f677b4be8a8c5b3a0789499996a40b8ee09";
const noCheckout = (): string | undefined => undefined;
// A HEAD lookup that fails, as git does when it is missing or refuses the repository. Where a case must not consult Git
// at all (no pin, or a malformed pin), reaching it changes the error and fails the assertion.
const headLookupFails = (): string | undefined => {
  throw new Error("HEAD lookup failed");
};

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" });
const gitUsable = git(["--version"]).status === 0;
const head = git(["-C", ROOT, "rev-parse", "HEAD"]);
const repositoryHead = head.status === 0 ? head.stdout.trim() : undefined;
const generator = (pinned: string) =>
  spawnSync(process.execPath, ["scripts/build-claude-directory.ts", "--check"], {
    cwd: ROOT,
    env: { ...process.env, WALLETWALL_SOURCE_SHA: pinned },
    encoding: "utf8",
    timeout: 120_000,
  });

describe("Claude Directory provenance", () => {
  const runs: ReturnType<typeof createOwnedRun>[] = [];
  after(() => {
    for (const r of runs) r.dispose();
  });

  test("PROVENANCE.json entries are in UTF-16 code-unit order of their paths, not locale collation order", () => {
    // String#localeCompare puts README.md after node_modules/ in most locales and, under lt-LT, locales/yo.js before
    // locales/ja.js; code-unit order does neither.
    const shuffled = [
      "node_modules/zod/locales/yo.js",
      "README.md",
      "node_modules/zod-to-json-schema/dist/esm/index.js",
      ".mcp.json",
      "node_modules/zod/locales/ja.js",
      "LICENSE",
      ".gitattributes",
      "node_modules/@modelcontextprotocol/sdk/package.json",
      "server/walletwall-mcp.mjs",
      "node_modules/zod/index.js",
      ".claude-plugin/plugin.json",
      "skills/vault-readiness/SKILL.md",
    ].map((path) => ({ path }));
    assert.deepEqual(shuffled.sort(byPath).map(({ path }) => path), [
      ".claude-plugin/plugin.json",
      ".gitattributes",
      ".mcp.json",
      "LICENSE",
      "README.md",
      "node_modules/@modelcontextprotocol/sdk/package.json",
      "node_modules/zod-to-json-schema/dist/esm/index.js",
      "node_modules/zod/index.js",
      "node_modules/zod/locales/ja.js",
      "node_modules/zod/locales/yo.js",
      "server/walletwall-mcp.mjs",
      "skills/vault-readiness/SKILL.md",
    ]);
  });

  test("an explicit WALLETWALL_SOURCE_SHA is recorded only if it is a full lowercase commit SHA and, in a Git checkout, the checked-out HEAD", () => {
    assert.equal(sourceCommit({ WALLETWALL_SOURCE_SHA: HEAD_A }, () => HEAD_A), HEAD_A);
    assert.equal(sourceCommit({ WALLETWALL_SOURCE_SHA: HEAD_A, GITHUB_SHA: HEAD_B }, () => HEAD_A), HEAD_A, "the explicit pin wins over GITHUB_SHA");
    assert.equal(sourceCommit({ WALLETWALL_SOURCE_SHA: HEAD_A }, noCheckout), HEAD_A, "an export without .git records the pin as given");

    assert.throws(() => sourceCommit({ WALLETWALL_SOURCE_SHA: HEAD_A }, () => HEAD_B), new RegExp(`WALLETWALL_SOURCE_SHA ${HEAD_A} is not the checked-out commit ${HEAD_B}`));
    assert.throws(() => sourceCommit({ WALLETWALL_SOURCE_SHA: HEAD_A }, headLookupFails), /cannot verify WALLETWALL_SOURCE_SHA against the checked-out commit/, "a failed HEAD lookup refuses the pin");
    for (const malformed of ["", "eb641bf", HEAD_A.toUpperCase(), `${HEAD_A}0`, ` ${HEAD_A}`, "working-tree"]) {
      assert.throws(() => sourceCommit({ WALLETWALL_SOURCE_SHA: malformed }, headLookupFails), /full 40-character lowercase hex/, JSON.stringify(malformed));
    }
  });

  test("without WALLETWALL_SOURCE_SHA the recorded commit is GITHUB_SHA, else working-tree, and Git is not consulted", () => {
    assert.equal(sourceCommit({ GITHUB_SHA: HEAD_B }, headLookupFails), HEAD_B);
    assert.equal(sourceCommit({}, headLookupFails), "working-tree");
  });

  test("a directory without its own .git is not a checkout, even inside another repository", { skip: !gitUsable && "git is not available" }, () => {
    const run = createOwnedRun();
    runs.push(run);
    const outer = run.mkdir("outer");
    assert.equal(git(["init", "-q", outer]).status, 0);
    assert.equal(checkedOutCommit(run.mkdir("outer", "export")), undefined);
  });

  test("the generator refuses a WALLETWALL_SOURCE_SHA that is not the checked-out commit", { skip: repositoryHead === undefined && "the repository root is not a usable Git checkout" }, () => {
    const pinned = "0".repeat(40);
    const r = generator(pinned);
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`WALLETWALL_SOURCE_SHA ${pinned} is not the checked-out commit ${repositoryHead}`));
    assert.doesNotMatch(r.stdout, /Claude Directory package:/);
  });

  test("the generator accepts the checked-out commit as WALLETWALL_SOURCE_SHA and builds the package", { skip: repositoryHead === undefined && "the repository root is not a usable Git checkout" }, () => {
    const r = generator(repositoryHead ?? "");
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Claude Directory package: \d+ files/);
  });
});
