# Package scripts and commands

Source of truth: root [`package.json`](../../package.json).

## Public harness API (`bemoat:*`)

Child-facing automation (synced CI, pre-push) may call **only** these:

| Script | Purpose |
|--------|---------|
| `bemoat:branch:check` | Manual Git Flow branch safety check |
| `bemoat:guard:safety` | Full central guard pack (CI + optional pre-push) |
| `bemoat:guard:pack` | Same as above (explicit alias) |
| `bemoat:test:int` | Shared Vitest integration tests |
| `bemoat:guard:cloudflare-env` | Deploy env guard (when deploy scripts exist) |
| `bemoat:check` | `bemoat:guard:safety` + lint + typecheck + `bemoat:test:int` (when child defines lint/typecheck) |
| `bemoat:boilerplate:sync` / `bemoat:boilerplate:check` | Pull or audit harness from starter |
| `bemoat:hooks:install` | Install optional `.githooks/pre-commit` and `.githooks/pre-push` |

Sync adds missing `bemoat:*` entries in child `package.json` without overwriting existing values.

## Starter-internal scripts

Used in **this repo** and optional child tooling — **not** wired into synced CI/pre-push:

| Script | Typical use |
|--------|-------------|
| `branch:check` | Starter alias for `scripts/check-branch-safety.sh` |
| `guard:safety` | Starter alias to guard pack (used by `check` and ci-starter) |
| `check` | `guard:safety` + lint + typecheck + `test:int` — **required before starter code PRs** |
| `check:full` | lint + typecheck + full test + build — human pre-merge |
| `lint`, `typecheck`, `test:int`, `test`, `test:e2e` | Starter strict validation |
| `build`, `deploy`, `preview`, `deploy:*` | Cloudflare deploy pipeline |
| `generate:types`, `generate:importmap` | After Payload schema or admin component changes |
| `boilerplate:sync` / `boilerplate:check` | Non-namespaced aliases (same scripts as `bemoat:*` counterparts) |

## When to run what

| Change type | Command |
|-------------|---------|
| Docs / markdown / CI config only | `pnpm run guard:safety` |
| TypeScript, scripts, tests, components | `pnpm run check` |
| Payload schema | `pnpm run check` + `pnpm run generate:types` (+ migration if D1) |
| Admin components | `pnpm run check` + `pnpm run generate:importmap` |

In child repos: prefer `bemoat:guard:safety` and `bemoat:check` when defined.

## Engines

`package.json` declares `node >= 24.15.0` and `pnpm ^9 || ^10`. CI uses Node **24.15.0** and pnpm **10**.

## Related

- [harness-sync-contract.md](../harness-sync-contract.md) — script contract for maintainers
- [ADR 0002](../adr/0002-bemoat-script-contract.md) — why `bemoat:*` only in child automation
