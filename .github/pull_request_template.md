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

## Commands run

<!-- List the exact commands the agent or author ran. -->

```bash
# Example:
# pnpm run lint
# pnpm run typecheck
# pnpm run test:int
```

## Test result

<!-- Paste pass/fail output or link to CI. Do not guess. -->

- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:int`
- [ ] `pnpm run check` (lint + typecheck + test:int)
- [ ] `pnpm run check:full` (includes build)
- [ ] CI green on this branch

## Risk review

<!-- Help reviewers spot migration, security, Cloudflare, and sync risks quickly. -->

| Area | Risk | Mitigation |
|------|------|------------|
| D1 migrations | | |
| Access control / security | | |
| Cloudflare (Worker, D1, R2, secrets) | | |
| `boilerplate:sync` managed files | | |
| Cross-project resource IDs copied | | |

## Screenshots

<!-- UI or admin changes only. Write N/A for docs-only or backend-only PRs. -->

## Agent notes

<!-- Handoff for the next agent or reviewer: assumptions, follow-ups, blocked items. -->
