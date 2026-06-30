# Harness sync workflow (child projects)

Canonical agent workflow for pulling **harness rails** from `bemoat-web-starter` into an **existing child project** after a starter PR merges.

This workflow runs in **child repos**, not in `bemoat-web-starter` itself. For diff boundaries, rollback, and readiness scoring, see the [Child project migration guide](../child-project-migration-guide.md). For command reference and sync modes, see [harness-sync-contract.md](../harness-sync-contract.md) and [boilerplate-sync-command.md](../boilerplate-sync-command.md).

## When to use

Use this workflow when:

- A starter PR merged that changes harness rails (agent docs, CI, guards, sync scripts, harness tests)
- A starter issue closeout or release note asks child projects to sync
- You are assigned to open or update a **harness sync PR** in a child repo

Do **not** use this workflow for:

- Developing reusable harness changes (those belong in `bemoat-web-starter` first)
- `--full` sync on existing production children unless explicitly approved
- Product code, Payload schema, D1 migrations, or dependency upgrades in the same PR

## High-level loop

```text
starter PR merged → child sync branch → boilerplate sync → checks → diff review → commit → open/update PR → report
```

| Step | What happens |
|------|----------------|
| **Starter PR merged** | Confirm the harness change is on `main` (or pin `BEMOAT_BOILERPLATE_REF` to a release tag). Note the **source PR number** for branch naming. |
| **Child sync branch** | Create a dedicated branch from latest child `dev` — never sync on `main` or routine-sync directly on `dev`. |
| **Boilerplate sync** | Run `pnpm run boilerplate:sync -- --harness-only` (or `bemoat:boilerplate:sync` in child repos). |
| **Checks** | `pnpm run guard:safety` (or `bemoat:guard:safety`), `git diff --check`, optional drift check if script exists. |
| **Diff review** | Verify only harness paths changed; no product code, secrets, or Cloudflare IDs. |
| **Commit** | One focused commit on the sync branch. |
| **Open/update PR** | Push branch; open a new PR or update the existing one — no duplicates. |
| **Report** | Post implementation report on the child issue (or starter follow-up issue) with PR link and review checklist. |

Agents **must not merge** harness sync PRs — merge is human-only.

## Required first steps (before any file edit)

Run these in order. **Stop and report** if any gate fails — do not modify files.

1. **`git status`** — inspect the working tree.
2. **Confirm current branch** — `git branch --show-current`.
3. **Dirty working tree** — if there are uncommitted changes (staged or unstaged) or untracked files that are not part of the sync task, **stop immediately**. Report what is already changed. Do not stash, reset, or edit over unrelated work.
4. **Never sync on `main`** — no `boilerplate:sync`, commits, or pushes on `main` for harness sync work.
5. **Do not sync directly on `dev`** unless the task is explicitly integration maintenance.
6. **Create a sync branch when on `main` or `dev`** — after a clean tree, create and switch to a dedicated sync branch from `dev` before running sync or editing files.

If you are already on a dedicated sync branch with a clean tree (or only task-intentional changes), continue on that branch.

## Branch naming convention

```
chore/sync-harness-from-starter-<source-pr-number>
```

| Part | Meaning |
|------|---------|
| `chore` | Harness sync is maintenance, not product feature work |
| `sync-harness-from-starter` | Fixed prefix for traceability |
| `<source-pr-number>` | Merged starter PR that triggered the sync (e.g. `45`) |

**Examples:**

- `chore/sync-harness-from-starter-45`
- `chore/sync-harness-from-starter-123`

Create the branch from latest child `dev`:

```bash
git fetch origin
git switch dev
git pull origin dev
git switch -c chore/sync-harness-from-starter-73
```

## Sync command

Default mode for existing child projects is **harness-only**:

```bash
pnpm run boilerplate:sync -- --harness-only
```

In child repos that received harness scripts via sync, prefer the namespaced alias when present:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

Optional: pin the starter ref before sync (recommended for production children):

```bash
export BEMOAT_BOILERPLATE_REF=vX.Y.Z   # or a reviewed SHA
pnpm run boilerplate:sync -- --harness-only
```

**Audit before sync** (read-only) when the drift check script exists — see [Validation](#validation).

## Validation

Run these **after sync** and **before commit**:

| Check | Command | Required |
|-------|---------|----------|
| Repo safety | `pnpm run guard:safety` (child: `pnpm run bemoat:guard:safety` when defined) | **Yes** |
| Whitespace / conflict markers | `git diff --check` | **Yes** |
| Boilerplate drift (audit) | `pnpm run boilerplate:check -- --harness-only` or `pnpm run bemoat:boilerplate:check -- --harness-only` | **Only if script exists** in `package.json` |

Do **not** fail the workflow because `boilerplate:check` is missing — older children may not have the script yet. After sync adds it, run the drift check on the next sync.

If the child defines `bemoat:check` and the sync touched harness tests or scripts, run `pnpm run bemoat:check` when practical before opening the PR.

## Diff review (before commit)

Stop and report instead of committing when any of these appear in the diff:

| Forbidden in harness-only PR | Action |
|------------------------------|--------|
| `src/collections`, `src/globals`, `src/app/(frontend)`, `src/components`, `src/hooks`, `src/access`, `src/lib`, `src/payload.config.ts` | **Stop** — wrong sync mode or mixed scope |
| `wrangler.jsonc`, `.env*`, secrets, D1/R2/Worker IDs | **Stop** — project-specific; never sync from starter |
| `pnpm-lock.yaml` dependency churn | **Stop** — out of harness-only scope |
| Unrelated local edits mixed with sync output | **Stop** — clean branch and re-run |

**Expected** paths include rails-managed harness files, `.bemoat-boilerplate-sync.json`, and `.bemoat/package-sync-proposal.md`. See [harness-sync-contract.md](../harness-sync-contract.md) and [child-project-migration-guide.md §7–§8](../child-project-migration-guide.md).

## PR open or update (after development)

When sync, checks, and diff review pass:

1. **Check whether the current branch already has an open PR** — use the GitHub skill or `gh pr list --head "$(git branch --show-current)"`.
2. **If no PR exists** — push the branch (`git push -u origin HEAD`) and **open a PR** targeting `dev`. Link the source starter PR or child follow-up issue in the PR body.
3. **If a PR already exists** — **update that PR** instead of opening a duplicate. Refresh the PR description and/or add a comment summarizing sync output, files changed, commands run, and test results.
4. **Do not mark the issue done** until PR status is clear and a human has reviewed the harness diff.

PR body should include:

- Source starter PR or release tag synced from
- Sync mode: `harness-only`
- Commands run and test results
- Diff boundary confirmation (harness paths only)
- Risks and human review needed (especially `.bemoat/package-sync-proposal.md`)
- `Closes #N` when working from a tracked issue

Agents **must not merge** — merge is human-only.

## Final report format

After opening or updating the PR, report to the user and post on the source issue when issue-driven:

```markdown
## Harness sync PR ready

PR: <PR_URL>
Branch: `chore/sync-harness-from-starter-<source-pr-number>`
Child repo: <repo-name>
Starter source: PR #<source-pr-number> (or tag <ref>)

### Summary
- Synced harness rails from bemoat-web-starter at <ref>
- Mode: harness-only

### Files changed
- <list key paths or count>

### Commands run
- pnpm run boilerplate:sync -- --harness-only
- pnpm run guard:safety
- git diff --check
- (optional) pnpm run boilerplate:check -- --harness-only

### Test results
- guard:safety: pass/fail
- git diff --check: pass/fail
- drift check: pass/fail/skipped (script missing)

### Diff review
- Harness paths only: yes/no
- Product code in diff: no (required)

### Remaining risks
- ...

### Human review needed
- Review `.bemoat/package-sync-proposal.md` for script/dependency recommendations
- Confirm CI green on PR branch
- Merge when satisfied

### Next suggested step
Review PR, wait for CI, then merge if green.
```

## Stop conditions (summary)

| Condition | Action |
|-----------|--------|
| Working tree dirty (unrelated changes) | Stop; report existing changes; no sync |
| On `main` or `dev` without creating sync branch first | Stop before sync; create sync branch |
| Sync or commit on `main`, or routine-sync on `dev` | Forbidden — use sync branch |
| Product code or secrets in diff | Stop before commit; fix scope or sync mode |
| PR exists for branch | Update PR; do not open duplicate |
| `boilerplate:check` script missing | Skip drift check; do not fail workflow |

## Related docs

| Doc | Use for |
|-----|---------|
| [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md) | Starter issue branch gates and harness sync closeout |
| [child-project-migration-guide.md](../child-project-migration-guide.md) | Readiness scoring, rollback, detailed diff boundaries |
| [harness-sync-contract.md](../harness-sync-contract.md) | What syncs and sync modes |
| [boilerplate-sync-command.md](../boilerplate-sync-command.md) | Command flags and env vars |
| [source-of-truth.md](./source-of-truth.md) | Starter vs child ownership |
| [composer-issue-workflow-prompt.md](./composer-issue-workflow-prompt.md) | Paste-ready starter issue prompt |
