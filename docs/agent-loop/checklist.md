# Agent checklists

Use with [README.md](./README.md), [source-of-truth.md](./source-of-truth.md), and [security-and-migrations.md](./security-and-migrations.md).

Agents run the [Default Agent Workflow](../../AGENTS.md#default-agent-workflow) by default when the user provides only a task. Do not wait for explicit branch, commit, push, or PR instructions unless the user overrides the workflow.

## Task-size tiers

Classify work **before editing** and use the minimum useful process for that tier. This rule applies **going forward only** — do not retroactively clean up or re-label old commits.

Prefer updating these docs over creating new templates or workflows.

| Tier | Examples | Minimum artifacts |
|------|----------|-------------------|
| **Small** | Typo, copy, spacing, rename, one-file low-risk refactor | Commit message reason + relevant validation tier |
| **Medium** | New reusable component, section, CMS block, layout pattern, or design-reference conversion | Short brief, changed scope, diff reason, checklist, design reference source when relevant |
| **Core** | Architecture, design system, Payload schema, sync behavior, CI, guards, migrations, agent rules, or anything reused across child projects | Full task brief, diff reason, agent boundary, feature checklist, regression result, source-of-truth / child-sync impact |

**Small** tasks still follow branch gates and PR workflow; they do not need a full architecture brief.

**Medium** tasks document *what* changed and *why* in the PR; link Mobbin, Figma, or other design references when the task is design-related.

**Core** tasks add explicit boundaries (what is in/out of scope), checklist evidence, validation results, and whether child projects need `pnpm run boilerplate:sync` after merge.

When unsure, round **up** one tier for source-of-truth or sync-managed paths; round **down** for clearly local, low-risk edits.

## Before coding

- [ ] Started with `superpowers:using-superpowers`
- [ ] Read `AGENTS.md` and this folder
- [ ] Understood the task; confirmed no user override (e.g. "do not commit")
- [ ] **Task-size tier classified** (small / medium / core) — see [Task-size tiers](#task-size-tiers)
- [ ] Confirmed correct repo: **starter** vs **child project**
- [ ] Read issue/PR goal, acceptance criteria, allowed and forbidden paths
- [ ] If GitHub URL, issue, PR, branch, or CI run is referenced: inspected via GitHub skill or `gh`
- [ ] **`git status` run**; current branch confirmed
- [ ] **Working tree clean** (or stop and report unrelated dirty changes — no file edits)
- [ ] **Not on `main` or routine-coding on `dev`** for issue-based work — dedicated issue branch created first ([issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md))
- [ ] Issue branch follows `<type>/<issue-number>-<short-slug>` (e.g. `fix/41-opennext-build-contract`)
- [ ] Branch created from current `dev` when starting fresh
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

Stop instead of committing if the task is ambiguous, forbidden files are required, checks fail for unrelated reasons, or secrets/Cloudflare IDs/production deploy are involved. See [security-and-migrations.md](./security-and-migrations.md).

**Migration files alone are not a stop** — use [migration-draft-pr.md](./migration-draft-pr.md): commit, push, and open a **draft** PR after checks pass.

- [ ] `git status` and diff summary shown
- [ ] Only allowed files changed
- [ ] **Security pre-commit:** no `.env*` files staged
- [ ] **Security pre-commit:** no secrets, tokens, or credentials in the diff
- [ ] **Security pre-commit:** no copied Cloudflare account IDs, D1 IDs, R2 names, or Worker names
- [ ] **Migration pre-commit:** destructive `up()` migration has `bemoat:destructive-migration-approved` or is additive-only (guard:safety must pass)
- [ ] **Validation tier applied** (see [AGENTS.md § Validation](../../AGENTS.md#validation-before-pr-and-merge)):
  - [ ] **Docs/markdown/CI only** (no code): `pnpm run guard:safety` passed
  - [ ] **Code changes**: `pnpm run check` passed (**required** — includes lint with **zero warnings**, typecheck, test:int, guard:safety)
- [ ] Exactly one focused commit (unless task requires more)
- [ ] No unrelated refactors in the commit

## Before PR

- [ ] Acceptance criteria met
- [ ] **Validation tier** same as before commit:
  - [ ] Docs-only → `pnpm run guard:safety`
  - [ ] Code changes → `pnpm run check` (**required**)
- [ ] `pnpm run generate:types` if Payload schema changed
- [ ] `pnpm run generate:importmap` if admin components changed
- [ ] Branch pushed to origin
- [ ] Checked whether branch already has an open PR — **open new PR** or **update existing PR** (no duplicate)
- [ ] **Migration PR:** opened or kept as **draft** (`gh pr create --draft`); title prefix `[D1 Migration]`, `[Payload Migration]`, or `[DB Migration]`; body includes migration safety checklist — see [migration-draft-pr.md](./migration-draft-pr.md)
- [ ] **Migration PR:** did **not** mark ready for review, merge, auto-merge, production migration, production deploy, or destructive rollback
- [ ] PR opened or updated; template complete: goal, changes, source-of-truth impact, Payload impact, commands, test result, risk review
- [ ] Clear answer: does this belong in starter or a child project?
- [ ] Agent notes and [state-template.md](./state-template.md) updated for reviewers
- [ ] User notified with: task summary, branch, files changed, commands run, test result, commit hash, PR URL, risks, human review needed
- [ ] **Did not merge** — merge is human-only

## Before issue closeout (workflow / source-of-truth changes)

Complete when the change affects agent docs, CI, sync scripts, guards, or harness contracts. See [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md#harness-sync-closeout-before-closing-the-issue).

- [ ] Decided whether child projects need `pnpm run boilerplate:sync` after merge
- [ ] Sync scripts, drift checks, or harness contract guards reviewed for impact
- [ ] `boilerplate:check` / `bemoat:boilerplate:check` behavior documented or updated if needed
- [ ] Follow-up sync issue created and linked **or** sync completed — do not close source issue until resolved
- [ ] PR status clear before marking issue done

## Child harness sync (after starter merge)

Run in **child repos** only. Full loop: [harness-sync-workflow.md](./harness-sync-workflow.md).

- [ ] Confirmed child repo (not `bemoat-web-starter`)
- [ ] **`git status` run**; working tree clean (or stop and report)
- [ ] **Not on `main` or routine-syncing on `dev`** — sync branch created first: `chore/sync-harness-from-starter-<source-pr-number>`
- [ ] Starter source PR or tag identified
- [ ] `pnpm run boilerplate:sync -- --harness-only` (or `bemoat:boilerplate:sync`) run on sync branch
- [ ] `pnpm run guard:safety` (or `bemoat:guard:safety`) passed
- [ ] `git diff --check` passed
- [ ] `pnpm run boilerplate:check -- --harness-only` run **only if** script exists in `package.json`
- [ ] Diff review: harness paths only; no product code, secrets, or Cloudflare IDs
- [ ] Branch pushed; PR opened or existing PR updated (no duplicate)
- [ ] Implementation report posted; **did not merge**

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
