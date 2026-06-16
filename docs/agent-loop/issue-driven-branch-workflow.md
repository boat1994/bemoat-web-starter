# Issue-driven branch workflow

Reusable rule for **issue-based agent tasks** in `bemoat-web-starter` and child projects that inherit harness docs via `pnpm run boilerplate:sync`.

Child projects receive this file through harness sync. Agents must follow it whenever work is tied to a GitHub issue.

## Required first steps (before any file edit)

Run these in order. **Stop and report** if any gate fails — do not modify files.

1. **`git status`** — inspect the working tree.
2. **Confirm current branch** — `git branch --show-current`.
3. **Dirty working tree** — if there are uncommitted changes (staged or unstaged) or untracked files that are not part of the task, **stop immediately**. Report what is already changed. Do not stash, reset, or edit over unrelated work.
4. **Never modify `main` directly** — no commits, file edits, or pushes on `main` for issue-based work.
5. **Create an issue branch when on `main`** — after a clean tree on `main`, create and switch to a dedicated branch before the first file change.

If you are already on a dedicated issue branch with a clean tree (or only task-intentional changes), continue on that branch.

## Branch naming convention

```
<type>/<issue-number>-<short-slug>
```

| Part | Values |
|------|--------|
| `type` | `feat`, `fix`, `chore`, `docs`, `test`, or another conventional prefix that matches the change |
| `issue-number` | GitHub issue number |
| `short-slug` | Lowercase, hyphen-separated summary (no spaces) |

**Examples:**

- `fix/41-opennext-build-contract`
- `feat/42-mobbin-reference-cms`
- `chore/43-sync-harness-to-bemoat`
- `test/44-add-build-contract-guard`

Create the branch from latest `main`:

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b <type>/<issue-number>-<short-slug>
```

## Implementation

- Complete all issue work on the **issue branch** only.
- Before editing, report: branch name, files inspected, proposed file changes, risks.
- Follow validation tiers in [AGENTS.md](../../AGENTS.md#validation-before-pr-and-merge).

## PR open or update (after development)

When implementation is complete and checks pass:

1. **Check whether the current branch already has an open PR** — use the GitHub skill or `gh pr list --head "$(git branch --show-current)"`.
2. **If no PR exists** — push the branch (`git push -u origin HEAD`) and **open a PR** targeting `main`. Link the source issue (`Closes #N` in the PR body when appropriate).
3. **If a PR already exists** — **update that PR** instead of opening a duplicate. Refresh the PR description and/or add a comment summarizing the completed work, files changed, commands run, and test results.
4. **Do not mark the issue done** until PR status is clear (PR URL known, body/comment updated, implementation report posted on the issue per [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation)).

Agents **must not merge** — merge is human-only.

## Harness sync closeout (before closing the issue)

For **source-of-truth or workflow-related changes** (agent docs, CI, sync scripts, guards, harness contracts), complete this checklist **before** closing the issue:

- [ ] **Does this need to be synced** from `bemoat-web-starter` into child projects?
- [ ] **Are sync scripts, drift checks, or harness contract guards affected?**
- [ ] **Should `boilerplate:check` or `bemoat:boilerplate:check` be updated** (or documented) for the new behavior?
- [ ] **Does this require a follow-up sync issue** for Bemoat or other child projects?
- [ ] **If sync is needed**, do not close the issue until the sync step is completed **or** a linked follow-up issue is created and referenced from the PR/issue comment.

Starter-only workflow changes in `docs/agent-loop`, `AGENTS.md`, `.github/workflows`, and harness scripts typically **do** need child sync after merge. Project-specific child work does not.

See [harness-sync-contract.md](../harness-sync-contract.md) and [source-of-truth.md](./source-of-truth.md).

## Stop conditions (summary)

| Condition | Action |
|-----------|--------|
| Working tree dirty (unrelated changes) | Stop; report existing changes; no file edits |
| On `main` without creating issue branch first | Stop before editing; create issue branch |
| Attempt to commit or push on `main` for issue work | Forbidden — use issue branch |
| PR exists for branch | Update PR; do not open duplicate |
| Harness sync needed but not planned | Do not close issue; create follow-up or run sync |

## Related docs

| Doc | Use for |
|-----|---------|
| [composer-issue-workflow-prompt.md](./composer-issue-workflow-prompt.md) | Paste-ready Composer/Codex prompt |
| [checklist.md](./checklist.md) | Before/during/PR/closeout checklists |
| [operating-manual.md](./operating-manual.md) | Model roles and prompt seed |
| [AGENTS.md](../../AGENTS.md#default-agent-workflow) | Full default agent workflow |
