# Public visibility flip checklist

Runbook for changing the **canonical** repository `Wallet-Wall/walletwallrus-copilot` from private to public. **Nothing here has been executed.** The audit lane stops before step 6 and does not change visibility, publish to npm or submit to a marketplace. Record the result of every step in the flip pull request or issue.

**Which repository this applies to.** Only a repository whose Git history is a clean root commit of the reviewed tree. The development repository that preceded it (see `docs/PUBLIC_RELEASE_AUDIT.md`, `EXISTING_REPOSITORY_PUBLIC_FLIP = BLOCKED`) must never be flipped: its history, pull request refs, Actions history and an unreachable historical commit would become public. Deleting files from a tree does not change that.

Replace `$R` with `Wallet-Wall/walletwallrus-copilot`.

## Gates: confirm these before step 1

| Gate | Status and why it matters | Who decides |
| --- | --- | --- |
| **Public license** | Resolved: Apache-2.0, unmodified, in `LICENSE`, `plugin/LICENSE` and `packages/mcp/LICENSE` (identical, checked by a test); manifests declare `Apache-2.0`; brand guidance is separate in `TRADEMARKS.md`. Re-confirm the three file hashes in the repository about to be flipped | Done |
| **History independence** | The repository about to be flipped must have exactly one reachable commit lineage that starts at a clean root commit, with no shared object database, alternates, grafts, replace refs or shallow linkage with the development repository, and none of the development repository's commits addressable by SHA (`git rev-list --all --count`, `git count-objects -v`, `gh api repos/$R/commits/<old sha>` must return not found). Author and committer identities must be the approved public identity | Owner, verified by the re-audit |
| A second maintainer or an organization team can approve pull requests | CODEOWNERS lists one owner. Code-owner review must not be made mandatory until a second appropriate code owner exists; do not create a placeholder reviewer to satisfy the setting | Owner |

## Steps

1. **Bind the final audit HEAD.** Record `git rev-parse origin/main`, the root commit and its tree, the working-tree state (clean), open pull requests, tags, plugin version (`plugin/plugin.json`), WWEP version, registry version, policies and rules versions, and the SHA-256 of `security/tool-manifest.json`, `security/plugin-manifest.json`, `plugin/server/walletwall-mcp.mjs` and the plugin artifact (`security/plugin-artifact.sha256`, rebuilt with `npm run pack:plugin -- <file>`).
2. **Verify CI** on that exact SHA: `verify`, `verify-windows` and `offline-sandbox` all green.
3. **Verify the full-history secret scan.** Re-run the multi-strategy scan over every reachable ref (pattern scan of every blob and commit message, high-entropy scan, binary and image review, author and committer identities), and check by SHA that no commit of any earlier repository is served (`gh api repos/$R/commits/<sha>`). Never push from a local clone with `git push --mirror` or `--all`: local clones can hold `refs/copilot/checkpoints/*` and other non-public refs. A real credential anywhere in history is a blocker until it is revoked **and** a new clean root is published; deleting it from the tree is not enough.
4. **Verify the historical Actions and log audit.** Download the logs of every workflow run (`gh run view <id> -R $R --log`), list artifacts (`gh api repos/$R/actions/artifacts`) and caches (`gh api repos/$R/actions/caches`), and scan them. Delete runs or caches you do not want public (`gh api -X DELETE repos/$R/actions/runs/<id>`).
5. **Capture current repository settings** to a private file: `gh api repos/$R`, `.../rulesets`, `.../branches/main/protection`, `.../actions/permissions`, `.../actions/permissions/workflow`, `.../collaborators`, `.../hooks`, `.../keys`, `.../environments`, `.../actions/secrets`, `.../actions/variables`. Also check at organization level (needs an organization owner): Actions secrets and which repositories may read them, runner groups and self-hosted runners available to this repository, two-factor requirement, default repository permission.
6. **Change private to public** (the one irreversible-looking step; do it only when every gate is closed):
   `gh repo edit $R --visibility public --accept-visibility-change-consequences`
7. **Immediately re-check branch and ruleset protection.** Add or confirm a ruleset (or branch protection) on `main`: pull request required, required status checks `verify`, `verify-windows` and `offline-sandbox`, force pushes and branch deletion blocked, code-owner review once a second owner exists, no bypass for non-admins. Today only `verify` and `offline-sandbox` are required, review is not required and administrators are not enforced.
8. **Re-check the fork Actions policy.** Set fork pull request approval to require approval from all outside collaborators: `gh api -X PUT repos/$R/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`. Confirm default workflow permissions are `read` and that Actions cannot approve pull request reviews (`gh api repos/$R/actions/permissions/workflow`). Allow only GitHub-owned and SHA-pinned actions if the policy UI offers it. Confirm no organization secret is exposed to this repository.
9. **Re-check secret scanning and push protection** (they become available for free on public repositories): enable secret scanning, push protection and Dependabot alerts and security updates (`gh api -X PATCH repos/$R -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`; `gh api -X PUT repos/$R/vulnerability-alerts`; `gh api -X PUT repos/$R/automated-security-fixes`). Review any secret-scanning alert as a credential leak: revoke, then remediate history. Consider enabling CodeQL default setup for `javascript-typescript` and `actions`. Optionally disable the unused wiki and projects.
10. **Re-check vulnerability reporting.** Enable private vulnerability reporting (`gh api -X PUT repos/$R/private-vulnerability-reporting`), then confirm the "Report a vulnerability" button works and that `SECURITY.md` and the issue chooser point to it. It cannot be verified while the repository is private.
11. **Run CI from the public repository**: re-run the workflow on `main` and open a throwaway pull request from a fork account to confirm the workflow requires approval, runs with a read-only token and has no secrets.
12. **Perform a clean public clone** in an empty directory with no credentials: `git clone https://github.com/Wallet-Wall/walletwallrus-copilot.git`, `npm ci`, `npm run verify`, `npm audit`, `npm run pack:plugin -- <file>`. Compare the four SHA-256 values with step 1.
13. **Inspect what is publicly visible**, signed out: the file tree, every ref (`git ls-remote` must show `main`, the merged branch and `refs/pull/*` only), pull request and issue titles, bodies and comments, the Actions run list, logs and caches, releases (none), wiki (none), the community profile (license, security policy, contributing, code owners).
14. **Verify nothing unexpected was exposed.** Re-run the secret and personal-data scan against the clone. Check the secret-scanning alert list is empty. If anything sensitive is exposed, set the repository back to private immediately (`gh repo edit $R --visibility private --accept-visibility-change-consequences`), then revoke credentials and remediate. Forks and clones made in the meantime cannot be recalled.
15. **Stop before npm and marketplace publication.** Publishing `@walletwall/mcp` to npm and submitting the plugin to a Copilot marketplace are separate lanes. Before either, rename the marketplace `walletwall-private` (it changes the install command and users' saved settings), add provenance and an SBOM, and re-verify the Desktop install.

## Controls that change when the repository becomes public

| Control | While private | After the flip |
| --- | --- | --- |
| Secret scanning, push protection, code scanning | not available on this plan for private repositories | available at no cost; must be enabled (step 9) |
| Fork pull request approval | not applicable (a private repository cannot be forked by outsiders) | configurable; set to approve all outside contributors (step 8) |
| Private vulnerability reporting, security advisories | not available | must be enabled (step 10) |
| Forking | restricted to the organization | anyone can fork and open pull requests |
| Pull request refs, Actions runs, logs and caches, issues, pull request text | visible to collaborators | visible to everyone |
| Branch protection | set while private (pull request, `verify`, `verify-windows`, `offline-sandbox`, no force push, no deletion) | re-check immediately (step 7) |
| Community profile | license, readme | adds security policy, contributing guide, code owners, issue chooser and pull request template from this repository |

## If something sensitive is found before or after the flip

Do not rewrite or filter the history of a repository that is already referenced elsewhere. If anything sensitive is found in the repository about to be published, stop, keep it private, and publish a new repository from a new clean root commit of a corrected tree. If it is found after the flip, set the repository back to private immediately (step 14), revoke any credential, and publish a new repository from a new clean root; forks and clones made in the meantime cannot be recalled.
