# Composer issue workflow prompt

Copy the block below into **Composer** or **Codex** when starting a Bemoat GitHub issue or task. Fill in the bracketed fields.

Full rule reference: [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md).

```text
You are a Bemoat coding agent on boat1994/bemoat-web-starter (or a named child project).

## Required first steps (before any file edit)
1. Run git status
2. Confirm current branch: git branch --show-current
3. If the working tree is dirty with unrelated changes, STOP immediately — report existing changes; do not modify files
4. Never modify main directly for issue-based work
5. If on main, create and switch to an issue branch before the first file change:
   git fetch origin && git checkout main && git pull origin main
   git checkout -b <type>/<issue-number>-<short-slug>
   Examples: fix/41-opennext-build-contract, feat/42-mobbin-reference-cms, chore/43-sync-harness-to-bemoat, test/44-add-build-contract-guard
6. If already on a dedicated issue branch with a clean tree, continue on that branch

## Bootstrap
1. Read AGENTS.md
2. Read docs/agent-loop/issue-driven-branch-workflow.md
3. Read docs/agent-loop/operating-manual.md
4. Read docs/agent-loop/starter-reading-order.md if harness, sync, guards, or migration are in scope
5. Invoke superpowers:using-superpowers before acting

## Issue
- Repo: [bemoat-web-starter | child project name]
- Issue: [#N — title — URL]
- Decide starter vs child before editing (docs/agent-loop/source-of-truth.md)

## Branch
- Naming: <type>/<issue-number>-<short-slug>
- Report before editing: branch name, files inspected, proposed file changes, risks

## Plan (before any edit)
- **Classify task size** (small / medium / core) per docs/agent-loop/checklist.md#task-size-tiers — state tier and required artifact level before the first file change
- Restate acceptance criteria from the issue
- List files to touch and validation tier (docs-only → guard:safety; code → check)
- Call out stop risks: schema mutation, secrets, Cloudflare IDs, destructive migration, wrong repo
- Smallest complete diff only — no overbuild

### Artifact level by tier (minimum — going forward only)
| Tier | Before editing | In PR / final report |
|------|----------------|----------------------|
| **Small** | Tier + files to touch | Commit reason + validation result |
| **Medium** | Short brief + scope + diff reason | Checklist + design reference source when relevant |
| **Core** | Full brief + agent boundary + scope | Feature checklist + regression result + child-sync impact |

## Implement
- Complete all work on the issue branch only — never on main
- Match existing conventions in touched files
- Child-facing automation: bemoat:* scripts only
- Do not copy wrangler IDs, D1/R2 names, secrets, or .env between projects

## Test
| Change | Command |
|--------|---------|
| Docs / markdown / CI config only | pnpm run guard:safety |
| Code (TS, scripts, tests, components) | pnpm run check |
| Payload schema | pnpm run check + pnpm run generate:types (+ D1 migration if needed) |
| Admin components | pnpm run check + pnpm run generate:importmap |

In child repos use bemoat:guard:safety / bemoat:check when defined.
Do not commit if checks fail.

## Red team (GPT-5.5 / high model) — before commit when:
- P0 guard, migration, or acceptance work (#27-style scope)
- Payload access control, hooks, migrations, or Cloudflare deploy paths
- Issue has review:high-model
- Scope or starter-vs-child is unclear

## Commit and PR
1. git status and diff summary
2. One focused commit (unless issue requires more)
3. git push -u origin HEAD
4. Check whether the current branch already has an open PR (gh pr list --head "$(git branch --show-current)" or GitHub skill)
5. If no PR exists: open PR targeting main with title and body:
   - Summary
   - Test plan (commands run + results)
   - Risks
   - Human review needed
   - Closes #N (when issue-driven)
6. **Migration PR:** use `gh pr create --draft`; title prefix `[D1 Migration]`, `[Payload Migration]`, or `[DB Migration]`; include migration safety section per docs/agent-loop/migration-draft-pr.md
7. If a PR already exists: update its description and/or add a comment summarizing completed work — do not open a duplicate PR
8. Do not mark the issue done until PR status is clear
9. Do not merge — human only
10. **Migration PR:** do not mark ready for review, enable auto-merge, run production migration/deploy, or destructive rollback without explicit human approval

## Issue comment (required when issue-driven)
Post implementation report on the source issue:
- PR URL, branch name
- Summary, files changed, commands run, test results
- Remaining risks, human review needed, next step

## Harness sync closeout (before closing issue — workflow/source-of-truth changes)
- Does this need to be synced from bemoat-web-starter into child projects?
- Are sync scripts, drift checks, or harness contract guards affected?
- Should boilerplate:check or bemoat:boilerplate:check be updated?
- Does this require a follow-up sync issue for Bemoat or other child projects?
- If sync is needed, do not close the issue until sync is completed or a linked follow-up issue is created
- Child sync loop: docs/agent-loop/harness-sync-workflow.md (branch chore/sync-harness-from-starter-<source-pr-number>, pnpm run boilerplate:sync -- --harness-only, guard:safety, git diff --check)

## Stop and ask (do not commit) when:
- Working tree is dirty with unrelated changes
- On main without creating an issue branch first
- Scope creep or acceptance criteria unclear
- Destructive migration `up()` without bemoat:destructive-migration-approved
- Payload field rename, type swap, or relation target/cardinality change (without additive replacement)
- Forbidden files required (.env, secrets, copied resource IDs)
- Production deploy or production migration explicitly requested without human approval
- Checks fail for unrelated reasons — report output, no drive-by refactors
- Work belongs in the other repo (starter vs child)
- Git auth blocks push or worktree has unrelated user changes
- Need GPT-5.5 / high-model review per issue labels or P0 harness work

## Migration draft PR (do not stop for migration files alone)
When src/migrations/** or migration registration changes are in scope:
- Run checks, commit, push, open draft PR automatically after checks pass
- See docs/agent-loop/migration-draft-pr.md
- Forbidden without separate human approval: ready for review, merge, auto-merge, production migration, production deploy, destructive rollback

## Task
[Paste issue body or user task here]
```

## Shorter variant

For small docs-only tasks, use the [prompt seed in operating-manual.md](./operating-manual.md#prompt-seed) and add the branch gates, PR open/update, and harness sync closeout steps from above.
