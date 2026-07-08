# Issue-driven branch workflow

Reusable rule for **issue-based agent tasks** in `bemoat-web-starter` and child projects that inherit harness docs via `pnpm run bemoat:boilerplate:sync -- --harness-only`.

Child projects receive this file through harness sync. Agents must follow it whenever work is tied to a GitHub issue.

## Required first steps (before any file edit)

For issue-based work, do not edit files first.
Run:

```bash
pnpm run bemoat:agent:issue -- <issue-number>
```

If the blocker is a dirty working tree, unrelated repo state, a failed git
command, or anything that risks overwriting human work, report the blocker and
do not edit files. If the only blocker is a clean protected or integration
branch, treat it as branch setup: create an issue-related topic branch, rerun
`pnpm run bemoat:agent:issue -- <issue-number>`, and continue only after the
preflight passes.

Run these in order. **Stop and report** if a hard blocker fails; do not modify
files until branch setup is complete and preflight passes.

1. **`git status`** — inspect the working tree.
2. **Confirm current branch** — `git branch --show-current`.
3. **Dirty working tree** — if there are uncommitted changes (staged or unstaged) or untracked files that are not part of the task, **stop immediately**. Report what is already changed. Do not stash, reset, or edit over unrelated work.
4. **Never modify `main` directly** — no commits, file edits, or pushes on `main` for issue-based work.
5. **Do not implement directly on `dev`** — stop before routine coding unless the task is explicitly integration maintenance.
6. **Create an issue branch when on a clean `main` or `dev`** — after a clean tree, create and switch to a dedicated branch from `dev` before the first file change, then rerun the issue preflight.

If you are already on a dedicated issue branch with a clean tree (or only task-intentional changes), continue on that branch.

## Branch naming convention

```
<type>/<issue-number>-<short-slug>
```

| Part | Values |
|------|--------|
| `type` | `feature`, `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, or another conventional prefix allowed by [Git Flow guardrails](../workflow/git-flow.md) |
| `issue-number` | GitHub issue number |
| `short-slug` | Lowercase, hyphen-separated summary (no spaces) |

**Examples:**

- `fix/41-opennext-build-contract`
- `feature/42-mobbin-reference-cms`
- `chore/67-git-flow-branch-guardrails`
- `test/44-add-build-contract-guard`

Create the branch from latest `dev`:

```bash
git fetch origin
git switch dev
git pull origin dev
git switch -c docs/dev-branch-policy-sync-contract
```

If a repository has not created `dev` yet, follow the bootstrap note in [Git Flow guardrails](../workflow/git-flow.md) and call out the temporary exception in the PR. This starter currently has no `dev` branch, so use topic branches from `main` and target `main` as the bootstrap exception.

## Post-preflight implementation trigger

After branch setup and a passing issue preflight, do not edit files
immediately. First summarize the implementation intent for the human:

- issue goal
- intended scope
- out-of-scope work
- files or areas to inspect
- expected validation commands
- notable risks or assumptions

Then wait for the user to explicitly trigger implementation before modifying
files. Clear triggers include `proceed`, `continue`, `start dev`, `เริ่มได้`,
and `dev ได้`.

This checkpoint controls the start of file edits only. Once the human triggers
implementation, continue the normal issue workflow through validation, commit,
push, PR, and implementation report unless a stop condition applies.

## Implementation

- Complete all issue work on the **issue branch** only.
- Before editing, complete the post-preflight implementation trigger above.
- Follow validation tiers in [AGENTS.md](../../AGENTS.md#validation-before-pr-and-merge).

## PR open or update (after development)

When implementation is complete and checks pass:

1. **Check whether the current branch already has an open PR** — use the GitHub skill or `gh pr list --head "$(git branch --show-current)"`.
2. **Audit source issue acceptance criteria** — before PR creation/update and final reporting, copy or summarize every acceptance criterion. Mark each item `Done`, `Not done`, `Not applicable`, or `Waiting for CI / human review`; include brief evidence for completed items. Put the audit in the PR body and/or issue implementation report comment. Do not edit the source issue checklist unless the user explicitly asks.
3. **If no PR exists** — push the branch (`git push -u origin HEAD`) and **open a PR** targeting `dev`. In this starter only, target `main` while the bootstrap exception applies. Link the source issue (`Closes #N` in the PR body when appropriate).
4. **If a PR already exists** — **update that PR** instead of opening a duplicate. Refresh the PR description and/or add a comment summarizing the completed work, files changed, commands run, test results, and acceptance criteria audit.
5. **Do not mark the issue done** until PR status is clear (PR URL known, body/comment updated, implementation report posted on the issue per [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation)).

Agents **must not merge** — merge is human-only.

## Harness sync closeout (before closing the issue)

For **source-of-truth or workflow-related changes** (agent docs, CI, sync scripts, guards, harness contracts), complete this checklist **before** closing the issue:

- [ ] **Does this need to be synced** from `bemoat-web-starter` into child projects?
- [ ] **Are sync scripts, drift checks, or harness contract guards affected?**
- [ ] **Should `boilerplate:check` or `bemoat:boilerplate:check` be updated** (or documented) for the new behavior?
- [ ] **Does this require a follow-up sync issue** for Bemoat or other child projects?
- [ ] **If sync is needed**, do not close the issue until the sync step is completed **or** a linked follow-up issue is created and referenced from the PR/issue comment.

Starter-only workflow changes in `docs/agent-loop`, `AGENTS.md`, `.github/workflows`, and harness scripts typically **do** need child sync after merge. Project-specific child work does not.

See [harness-sync-workflow.md](./harness-sync-workflow.md), [harness-sync-contract.md](../harness-sync-contract.md), and [source-of-truth.md](./source-of-truth.md).

## Stop conditions (summary)

| Condition | Action |
|-----------|--------|
| Working tree dirty (unrelated changes) | Stop; report existing changes; no file edits |
| On `main` or `dev` without creating issue branch first | Stop before editing; create issue branch |
| Preflight passed but no implementation trigger yet | Summarize intent; wait for explicit human trigger before editing |
| Attempt to commit or push on `main` or routine-code on `dev` for issue work | Forbidden — use issue branch |
| PR exists for branch | Update PR; do not open duplicate |
| Harness sync needed but not planned | Do not close issue; create follow-up or run sync |

## Related docs

| Doc | Use for |
|-----|---------|
| [composer-issue-workflow-prompt.md](./composer-issue-workflow-prompt.md) | Paste-ready Composer/Codex prompt |
| [checklist.md](./checklist.md) | Before/during/PR/closeout checklists |
| [operating-manual.md](./operating-manual.md) | Model roles and prompt seed |
| [AGENTS.md](../../AGENTS.md#default-agent-workflow) | Full default agent workflow |
