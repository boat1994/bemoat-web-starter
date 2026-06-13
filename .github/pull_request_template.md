## Goal

<!-- What problem does this PR solve? Does this belong in bemoat-web-starter or a child project? -->

## Changes

<!-- Bullet list of what changed and why. -->

## Source of truth impact

<!-- Does this change reusable starter infrastructure, or is it project-specific? -->
<!-- If child-project work landed here by mistake, say so and explain the correct repo. -->

- [ ] Reusable improvement for `bemoat-web-starter`
- [ ] Starter-only development (this repo)
- [ ] Should have stayed in a child project
- [ ] No source-of-truth impact (docs, CI, or tooling only)

## Payload impact

<!-- Collections, globals, hooks, access control, migrations, admin components, import map -->

- [ ] No Payload schema or admin changes
- [ ] Payload schema or admin changes included
- [ ] `pnpm run generate:types` run (if schema changed)
- [ ] `pnpm run generate:importmap` run (if admin components changed)
- [ ] Migration created or updated (if D1 schema changed)

## Schema and Migration Safety

<!-- See docs/schema-evolution.md and docs/agent-loop/security-and-migrations.md -->

- [ ] No schema change
- [ ] Additive-only schema change
- [ ] Deprecated field added
- [ ] Backfill required
- [ ] Destructive migration
- [ ] Production D1 backup required
- [ ] Human approval required

**Old field or relation:**

<!-- e.g. headline (text), category → categories -->

**New field or relation:**

<!-- e.g. titleV2 (text), categoriesV2 (hasMany → categories) -->

**Fallback behavior:**

<!-- e.g. read titleV2 ?? headline in resolveTitle() -->

**Backfill plan:**

<!-- migration, script, or N/A -->

**Rollback plan:**

<!-- how to revert reads or schema if deploy fails -->

## Commands run

<!-- List the exact commands the agent or author ran. -->

```bash
# Example:
# pnpm run lint
# pnpm run typecheck
# pnpm run test:int
```

## Test result

<!-- Paste pass/fail output or link to CI. Do not guess. See AGENTS.md § Validation tiers. -->

**Change type:**

- [ ] Docs / markdown / CI config only → `pnpm run guard:safety`
- [ ] Code changes → `pnpm run check` (**required**)

- [ ] `pnpm run guard:safety` (docs-only or included in `check`)
- [ ] `pnpm run check` (guard:safety + lint + typecheck + test:int) — **required for code changes**
- [ ] `pnpm run check:full` (before merge when practical)
- [ ] CI green on this branch

## Risk review

<!-- Help reviewers spot migration, security, Cloudflare, and sync risks quickly. See docs/agent-loop/security-and-migrations.md -->

### Security and secrets

- [ ] No `.env*` files or secrets in this PR
- [ ] No Cloudflare account IDs, D1 IDs, R2 names, Worker names, or tokens copied from another project
- [ ] Human approval obtained if this PR touches secrets or infrastructure identifiers (note who approved below)

### Migrations and deploy

- [ ] No D1 / Payload migration changes
- [ ] Migration included and reviewed (if D1 schema changed)
- [ ] Destructive migration—**human approval required** (describe below)
- [ ] No production migration or deploy in this PR unless explicitly approved (note approval below)

| Area | Risk | Mitigation / approval |
|------|------|------------------------|
| D1 migrations | | |
| Destructive schema change | | |
| Access control / security | | |
| Cloudflare (Worker, D1, R2, secrets) | | |
| Production deploy or prod migration | | |
| `boilerplate:sync` managed files | | |
| Cross-project resource IDs copied | | |

## Screenshots

<!-- UI or admin changes only. Write N/A for docs-only or backend-only PRs. -->

## Agent notes

<!-- Handoff for the next agent or reviewer: assumptions, follow-ups, blocked items. -->
