# Agent checklists

Use with [README.md](./README.md) and [source-of-truth.md](./source-of-truth.md).

## Before coding

- [ ] Started with `superpowers:using-superpowers`
- [ ] Confirmed correct repo: **starter** vs **child project**
- [ ] Read issue/PR goal, acceptance criteria, allowed and forbidden paths
- [ ] If GitHub URL, issue, PR, branch, or CI run is referenced: inspected via GitHub skill or `gh`
- [ ] Branch created from current `main`
- [ ] No plan to copy D1 IDs, R2 names, Worker names, `.env`, or secrets across projects
- [ ] Filled [state-template.md](./state-template.md) with task and objective

## During coding

- [ ] Minimal diff; match existing conventions
- [ ] Reusable work targets `bemoat-web-starter`; project-specific work stays in child repos
- [ ] Payload hooks pass `req` to nested operations
- [ ] Local API with `user` sets `overrideAccess: false`
- [ ] After admin component changes: `pnpm run generate:importmap`
- [ ] After Payload schema changes: `pnpm run generate:types`
- [ ] After D1 schema changes: `pnpm payload migrate:create` and review migration
- [ ] Update session state (files changed, last command, blockers)

## Before commit

Stop instead of committing if the task is ambiguous, forbidden files are required, checks fail for unrelated reasons, secrets or Cloudflare resource IDs are involved, or the change belongs in a child project.

- [ ] `git status` and diff summary shown
- [ ] Only allowed files changed; no secrets, `.env`, D1 IDs, R2 names, or Worker names
- [ ] `pnpm run lint`, `typecheck`, and `test:int` pass
- [ ] Exactly one focused commit (unless task requires more)
- [ ] No unrelated refactors in the commit

## Before PR

- [ ] Acceptance criteria met
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:int`
- [ ] `pnpm run check` when possible (lint + typecheck + test:int)
- [ ] `pnpm run build` if practical for the change
- [ ] Branch pushed to origin
- [ ] PR opened; template complete: goal, changes, source-of-truth impact, Payload impact, commands, test result, risk review
- [ ] Clear answer: does this belong in starter or a child project?
- [ ] Agent notes and [state-template.md](./state-template.md) updated for reviewers
- [ ] User notified: branch, commit hash, PR URL, checks, risks, human-review items
- [ ] **Did not merge** — merge is human-only

## CI failure

- [ ] Open the failed GitHub Actions run—do not guess the cause
- [ ] Copy exact error lines into issue/PR or session state
- [ ] Fix only what the log indicates; avoid unrelated refactors
- [ ] Re-run failed command locally if possible
- [ ] Push fix and confirm CI re-run is green
- [ ] If failure is unrelated pre-existing: report exact output and stop broad fixes

## Merge readiness

- [ ] All required review threads resolved
- [ ] CI green on the PR branch
- [ ] `pnpm run check:full` run when practical before merge
- [ ] Migration and Cloudflare risks acknowledged in PR
- [ ] No sync-managed child edits that should have been upstreamed
- [ ] Squash/merge only after checks and review—not on failing CI
