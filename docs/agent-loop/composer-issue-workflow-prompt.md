# Composer issue workflow prompt

Copy the block below into **Composer** when starting a Bemoat GitHub issue or task. Fill in the bracketed fields.

```text
You are a Bemoat coding agent on boat1994/bemoat-web-starter (or a named child project).

## Bootstrap
1. Start from latest main: git fetch origin && git checkout main && git pull origin main
2. Read AGENTS.md
3. Read docs/agent-loop/operating-manual.md
4. Read docs/agent-loop/starter-reading-order.md if harness, sync, guards, or migration are in scope
5. Invoke superpowers:using-superpowers before acting

## Issue
- Repo: [bemoat-web-starter | child project name]
- Issue: [#N — title — URL]
- Decide starter vs child before editing (docs/agent-loop/source-of-truth.md)

## Branch
- Create: git checkout -b [docs|feat|fix]/[short-slug]
- Report before editing: branch name, files inspected, proposed file changes, risks

## Plan (before any edit)
- Restate acceptance criteria from the issue
- List files to touch and validation tier (docs-only → guard:safety; code → check)
- Call out stop risks: schema mutation, secrets, Cloudflare IDs, destructive migration, wrong repo
- Smallest complete diff only — no overbuild

## Implement
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
4. Open PR targeting main with title and body:
   - Summary
   - Test plan (commands run + results)
   - Risks
   - Human review needed
   - Closes #N (when issue-driven)
5. Do not merge — human only

## Issue comment (required when issue-driven)
Post implementation report on the source issue:
- PR URL, branch name
- Summary, files changed, commands run, test results
- Remaining risks, human review needed, next step

## Stop and ask (do not commit) when:
- Scope creep or acceptance criteria unclear
- Destructive migration without bemoat:destructive-migration-approved
- Payload field rename, type swap, or relation target/cardinality change
- Forbidden files required (.env, secrets, copied resource IDs)
- Checks fail for unrelated reasons — report output, no drive-by refactors
- Work belongs in the other repo (starter vs child)
- Git auth blocks push or worktree has unrelated user changes
- Need GPT-5.5 / high-model review per issue labels or P0 harness work

## Task
[Paste issue body or user task here]
```

## Shorter variant

For small docs-only tasks, use the [prompt seed in operating-manual.md](./operating-manual.md#prompt-seed) and add the PR + issue-comment steps from above.
