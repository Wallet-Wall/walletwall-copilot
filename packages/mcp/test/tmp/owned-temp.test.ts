import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";
import { MARKER_FILE, OWNED_ROOT_NAME, OwnedRun, UnsafeCleanupError, createOwnedRun, ownedTempRoot } from "../support/owned-temp.ts";

/** A decoy directory with a file in it, standing in for someone else's temporary data. */
function decoy(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "keep.txt");
  writeFileSync(f, "unrelated data that must survive");
  return f;
}
const intact = (file: string): boolean => existsSync(file) && readFileSync(file, "utf8") === "unrelated data that must survive";

/**
 * Every scenario runs against a stand-in "system temp directory" created inside the outer run, so decoys are never
 * placed in, and nothing here can touch, the real temp directory of the machine running the tests.
 */
function withFakeTemp(body: (fakeTemp: string) => void): void {
  const outer = createOwnedRun();
  try {
    body(outer.mkdir("fake-system-temp"));
  } finally {
    outer.dispose();
  }
}

describe("temp-cleanup regression: only a uniquely owned run directory is ever deleted (security regression)", () => {
  test("a run lives at <temp>/walletwallrus-copilot/<run-id>/ and carries an ownership marker", () => {
    withFakeTemp((fake) => {
      const run = createOwnedRun(fake);
      assert.ok(run.dir.startsWith(ownedTempRoot(fake)) || run.dir.toLowerCase().includes(`${sep}${OWNED_ROOT_NAME}${sep}run-`));
      assert.match(run.id, /^run-[0-9]+-[0-9a-f]{16}$/);
      const marker = JSON.parse(readFileSync(join(run.dir, MARKER_FILE), "utf8")) as { runId: string };
      assert.equal(marker.runId, run.id);
      run.dispose();
      assert.ok(!existsSync(run.dir));
    });
  });

  test("unrelated sibling temp folders survive, including ww-* look-alikes", () => {
    withFakeTemp((fake) => {
      const files = [
        decoy(join(fake, "ww-priv-abc")),
        decoy(join(fake, "ww-raw-xyz")),
        decoy(join(fake, "ww-plugin-123")),
        decoy(join(fake, "ww-")),
        decoy(join(fake, "walletwallrus-copilot-other")),
        decoy(join(fake, "walletwallrus-copilot.bak")),
        decoy(join(fake, "WALLETWALL")),
        decoy(join(fake, "unrelated-app")),
      ];
      const run = createOwnedRun(fake);
      run.mkdir("cwd", "nested");
      writeFileSync(run.path("cwd", "nested", "x.txt"), "x");
      run.dispose();
      for (const f of files) assert.ok(intact(f), `${f} must survive`);
      assert.ok(!existsSync(run.dir));
    });
  });

  test("files inside the owned root that are not this run's directory survive too", () => {
    withFakeTemp((fake) => {
      const root = ownedTempRoot(fake);
      const stray = decoy(join(root, "not-a-run"));
      const strayFile = join(root, "stray.txt");
      writeFileSync(strayFile, "stray");
      const run = createOwnedRun(fake);
      run.dispose();
      assert.ok(intact(stray));
      assert.ok(existsSync(strayFile));
    });
  });

  test("only the owned run directory is deleted: a second concurrent run is untouched", () => {
    withFakeTemp((fake) => {
      const a = createOwnedRun(fake);
      const b = createOwnedRun(fake);
      assert.notEqual(a.dir, b.dir);
      writeFileSync(b.path("b.txt"), "b");
      a.dispose();
      assert.ok(!existsSync(a.dir));
      assert.ok(existsSync(join(b.dir, "b.txt")));
      assert.ok(existsSync(ownedTempRoot(fake)), "the owned root must remain while another run is live");
      b.dispose();
      b.dispose();
      assert.ok(!existsSync(b.dir));
    });
  });

  test("cleanup rejects a handle whose directory was not created by this tool (no marker)", () => {
    withFakeTemp((fake) => {
      const real = createOwnedRun(fake);
      const forged = new OwnedRun(join(real.dir, "..", ".."), "run-1-0123456789abcdef");
      const f = decoy(forged.dir);
      assert.throws(() => forged.dispose(), UnsafeCleanupError);
      assert.ok(intact(f));
      real.dispose();
    });
  });

  test("cleanup rejects a directory whose marker names a different run", () => {
    withFakeTemp((fake) => {
      const real = createOwnedRun(fake);
      const forged = new OwnedRun(join(real.dir, "..", ".."), "run-2-0123456789abcdef");
      const f = decoy(forged.dir);
      writeFileSync(join(forged.dir, MARKER_FILE), JSON.stringify({ schema: 1, runId: real.id }));
      assert.throws(() => forged.dispose(), UnsafeCleanupError);
      assert.ok(intact(f));
      real.dispose();
    });
  });

  test("a malformed run id cannot be constructed", () => {
    for (const id of ["", "..", "run-1-zz", "../run-1-0123456789abcdef", "run-1-0123456789abcdef/..", "ww-1", "run-1-0123456789abcdef\\x"]) {
      assert.throws(() => new OwnedRun(ownedTempRoot(), id), UnsafeCleanupError, id);
    }
  });

  test("path traversal cannot leave the owned run directory", () => {
    withFakeTemp((fake) => {
      const run = createOwnedRun(fake);
      const sibling = createOwnedRun(fake);
      const f = decoy(join(fake, "ww-victim"));
      const attempts = [
        ["..", "ww-victim"],
        ["..", "..", "ww-victim"],
        ["a", "..", "..", "x"],
        ["../.."],
        ...(process.platform === "win32" ? [["..\\..\\ww-victim"]] : []),
        ["sub/../../ww-victim"],
        [`../${sibling.id}`],
        [".."],
        ["/etc"],
        ["\\\\server\\share\\x"],
        ["C:\\Windows"],
        ["C:evil"],
        [`${fake}${sep}ww-victim`],
        ["bad\0name"],
      ];
      for (const segs of attempts) {
        assert.throws(() => run.path(...segs), UnsafeCleanupError, JSON.stringify(segs));
        assert.throws(() => run.mkdir(...segs), UnsafeCleanupError, JSON.stringify(segs));
      }
      assert.ok(intact(f));
      assert.ok(existsSync(sibling.dir));
      sibling.dispose();
      run.dispose();
    });
  });

  test("remove() deletes inside the run and refuses everything outside it, including the run directory and its parents", () => {
    withFakeTemp((fake) => {
      const run = createOwnedRun(fake);
      const sibling = createOwnedRun(fake);
      const outside = decoy(join(fake, "ww-victim"));
      const inside = run.path("work", "data.txt");
      mkdirSync(run.path("work"));
      writeFileSync(inside, "d");

      for (const target of [run.dir, join(run.dir, ".."), ownedTempRoot(fake), fake, sibling.dir, join(fake, "ww-victim"), join(run.dir, "..", "ww-victim"), outside]) {
        assert.throws(() => run.remove(target), UnsafeCleanupError, target);
      }
      assert.ok(intact(outside));
      assert.ok(existsSync(sibling.dir));
      run.remove("work");
      assert.ok(!existsSync(inside));
      assert.ok(existsSync(run.dir));
      sibling.dispose();
      run.dispose();
    });
  });

  test("a link inside the run pointing at unrelated data is removed without following it", () => {
    withFakeTemp((fake) => {
      const victim = decoy(join(fake, "ww-victim"));
      const run = createOwnedRun(fake);
      symlinkSync(join(fake, "ww-victim"), run.path("link"), "junction");
      run.remove("link");
      assert.ok(!existsSync(run.path("link")));
      assert.ok(intact(victim), "the link target must survive removal of the link");

      symlinkSync(join(fake, "ww-victim"), run.path("link2"), "junction");
      run.dispose();
      assert.ok(!existsSync(run.dir));
      assert.ok(intact(victim), "disposing a run that contains a link must not delete the link target");
    });
  });

  test("a path that passes through a link out of the run is refused", () => {
    withFakeTemp((fake) => {
      const victim = decoy(join(fake, "ww-victim"));
      const run = createOwnedRun(fake);
      symlinkSync(join(fake, "ww-victim"), run.path("link"), "junction");
      assert.throws(() => run.remove(join("link", "keep.txt")), UnsafeCleanupError);
      assert.ok(intact(victim));
      run.dispose();
      assert.ok(intact(victim));
    });
  });

  test("a run directory that has been swapped for a link is not deleted", () => {
    withFakeTemp((fake) => {
      const victim = decoy(join(fake, "ww-victim"));
      const run = createOwnedRun(fake);
      renameSync(run.dir, `${run.dir}-moved`);
      symlinkSync(join(fake, "ww-victim"), run.dir, "junction");
      assert.throws(() => run.dispose(), UnsafeCleanupError);
      assert.ok(intact(victim));
      assert.ok(statSync(`${run.dir}-moved`).isDirectory());
    });
  });
});

describe("temp-cleanup regression: no code path deletes by pattern or touches the system temp directory directly", () => {
  const SKIP_DIRS = new Set(["node_modules", ".git"]);
  const EXTS = /\.(ts|mjs|cjs|js|json|md|ya?ml|ps1|sh|cmd|bat)$/;
  const self = "packages/mcp/test/tmp/owned-temp.test.ts";
  const helper = "packages/mcp/test/support/owned-temp.ts";

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (EXTS.test(name) && st.size < 1_500_000) out.push(p);
    }
    return out;
  }
  const files = walk(ROOT).map((p) => ({ rel: p.slice(ROOT.length).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));

  test("the repository scan found the files it is meant to police", () => {
    assert.ok(files.length > 50);
    assert.ok(files.some((f) => f.rel === helper));
  });

  test("only the owned-temp helper calls mkdtemp, rm, rmdir or tmpdir", () => {
    const banned = /\b(mkdtemp(Sync)?|rmSync|rmdirSync|rmdir|tmpdir)\s*\(|\bfs\.(promises\.)?rm\s*\(|\bunlinkSync\s*\(/;
    for (const f of files) {
      if (f.rel === helper || f.rel === self || f.rel === "plugin/server/walletwall-mcp.mjs") continue;
      if (!/\.(ts|mjs|cjs|js)$/.test(f.rel)) continue;
      const code = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.ok(!banned.test(code), `${f.rel} deletes or creates temp paths outside the owned-temp helper`);
    }
  });

  test("no script, workflow or document deletes by a ww-* glob or removes from the system temp directory by pattern", () => {
    const bad = [
      /ww-\*/,
      /Remove-Item[^\n]*(\$env:TEMP|\$env:TMP|%TEMP%|%TMP%|\[IO\.Path\]::GetTempPath|\/tmp\/)[^\n]*\*/i,
      /\brm\s+-[a-z]*r[a-z]*f?[^\n]*(\/tmp\/|\$TMPDIR|%TEMP%)[^\n]*\*/i,
      /\bdel\s+[^\n]*%TEMP%[^\n]*\*/i,
      /rimraf[^\n]*(tmp|temp)/i,
    ];
    for (const f of files) {
      if (f.rel === self || f.rel === "plugin/server/walletwall-mcp.mjs" || f.rel === "package-lock.json") continue;
      for (const re of bad) assert.ok(!re.test(f.text), `${f.rel} matches ${re}`);
    }
  });

  test("the helper itself never builds a glob, pattern or wildcard", () => {
    const code = (files.find((f) => f.rel === helper)?.text ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/readdirSync|opendirSync|\bglob\b|\*\*|new RegExp|readdir\(/.test(code), "owned-temp must not enumerate or pattern-match the temp directory");
  });
});
