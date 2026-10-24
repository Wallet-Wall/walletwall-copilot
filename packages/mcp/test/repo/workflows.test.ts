import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { ROOT } from "../support/harness.ts";

const WORKFLOWS = `${ROOT}.github/workflows`;
const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const read = (p: string): string => readFileSync(p, "utf8");
const strip = (s: string): string => s.replace(/^\s*#.*$/gm, "").replace(/\s+#\s.*$/gm, "");

/**
 * Threat model: every future contributor pull request is hostile. The invariant these tests protect is that
 * untrusted, contributor-controlled code can never run with repository write capability, publish credentials,
 * organization secrets or any other privileged credential.
 */
describe("workflow security (hostile public-fork pull requests)", () => {
  test("the repository has workflows and every one is covered below", () => {
    assert.ok(files.includes("ci.yml"));
  });

  for (const file of files) {
    const raw = read(`${WORKFLOWS}/${file}`);
    const text = strip(raw);

    test(`${file}: triggers are only push to main and pull_request; never pull_request_target, workflow_run or workflow_call`, () => {
      const on = /^on:\s*\n((?:[ \t]+.*\n?|\n)*)/m.exec(text)?.[1] ?? "";
      const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
      assert.deepEqual([...triggers].sort(), ["pull_request", "push"]);
      assert.ok(/push:\s*\n\s+branches:\s*\[main\]/.test(on), "push is limited to main");
      assert.ok(!/pull_request_target|workflow_run|workflow_call|workflow_dispatch|issue_comment|repository_dispatch|schedule/.test(text));
    });

    test(`${file}: permissions are declared read-only at the top level and nothing grants write`, () => {
      assert.ok(/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text), "top-level permissions: contents: read");
      assert.ok(!/:\s*write\b|write-all|id-token/.test(text), "no write permission and no OIDC token");
    });

    test(`${file}: no secrets, no tokens, no self-hosted runner, no upload or publish`, () => {
      assert.ok(!/\bsecrets\b|github\.token|GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN/i.test(text), "no secret or token reference");
      assert.ok(!/self-hosted|runs-on:\s*\[|runs-on:\s*\$\{\{|container:|services:/i.test(text), "GitHub-hosted runners only");
      assert.ok(!/upload-artifact|download-artifact|actions\/cache|upload-pages|deploy|npm publish|gh release|gh pr|git push|docker login|docker push/i.test(text), "no artifact, cache, deploy or publish step");
    });

    test(`${file}: every action is pinned to a full 40-character commit SHA, and every checkout drops credentials`, () => {
      const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1] as string);
      assert.ok(uses.length > 0);
      for (const u of uses) assert.match(u, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/, `unpinned or non-GitHub action: ${u}`);
      for (const block of text.split(/^\s*-\s+uses:\s*actions\/checkout@/m).slice(1)) {
        assert.ok(/^[^\n]*\n\s+with:\s*\n\s+persist-credentials:\s*false/.test(block), "checkout with persist-credentials: false");
      }
    });

    test(`${file}: no expression is interpolated into a shell step; the only expression is the concurrency group`, () => {
      const lines = text.split("\n").filter((l) => l.includes("${{"));
      for (const l of lines) assert.match(l.trim(), /^group:\s*ci-\$\{\{ github\.ref \}\}$/, `unexpected expression: ${l.trim()}`);
      assert.ok(!/github\.event|github\.head_ref|github\.actor|github\.base_ref|inputs\./.test(text), "no attacker-influenced context");
    });
  }

  test("ci.yml documents the fork-safety rules it relies on", () => {
    assert.match(read(`${WORKFLOWS}/ci.yml`), /Fork-safe by construction/);
  });
});

describe("dependency update policy (no permanent update blindness)", () => {
  const yml = read(`${ROOT}.github/dependabot.yml`);
  const policy = read(`${ROOT}docs/DEPENDENCY_POLICY.md`);
  const entries = [...yml.matchAll(/((?:^[ \t]*#.*\n)+)[ \t]*-\s+dependency-name:\s*"?([^"\n]+)"?\s*\n((?:[ \t]+[a-z-]+:.*\n?)*)/gm)];

  test("every ignore is narrow (names versions), commented with a review date, and listed in the dependency policy", () => {
    assert.ok(entries.length >= 1, "the ignore entries were parsed");
    for (const [, comment, name, body] of entries) {
      assert.match(body as string, /^\s+versions:\s*\[[^\]]+\]/m, `${name}: ignores named versions, not a whole update type`);
      assert.ok(!/update-types/.test(body as string), `${name}: no blanket update-type ignore`);
      assert.match(comment as string, /review[^\n]*by \d{4}-\d{2}-\d{2}/i, `${name}: a review date is recorded next to the ignore`);
      assert.ok(policy.includes(`\`${name}\``), `${name}: documented in docs/DEPENDENCY_POLICY.md`);
    }
    assert.ok(!/update-types:/.test(yml), "no update-types ignore anywhere");
  });

  test("both ecosystems are monitored: npm and github-actions", () => {
    assert.ok(/package-ecosystem:\s*npm/.test(yml) && /package-ecosystem:\s*github-actions/.test(yml));
  });
});
