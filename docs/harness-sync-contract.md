# Harness sync contract

This document defines what **harness** means in Bemoat boilerplate sync and how to keep the contract complete when adding new shared rails.

## What "harness" includes

The harness is everything child projects need to run the same safety rails, workflow rules, deploy guards, and integration tests as `bemoat-web-starter`:

| Category | Examples |
|----------|----------|
| Agent rules | `AGENTS.md`, `.cursor/rules/*` |
| Agent-loop docs | `docs/agent-loop/*`, `docs/hardening.md`, `docs/schema-evolution.md`, etc. |
| GitHub workflow and templates | `.github/workflows/ci.yml`, PR template, issue templates |
| Safety guards | `scripts/guard-repo-safety.mjs`, `scripts/guard-cloudflare-env.mjs` |
| Cloudflare deploy guards | `guard:cloudflare-env` package script; deploy scripts that call it |
| Sync and drift | `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs` |
| Local git hooks | `.githooks`, `scripts/install-git-hooks.mjs`, `hooks:install` |
| Vitest harness | `vitest.config.mts`, `vitest.setup.ts` |
| Shared integration tests | All `tests/int/*.int.spec.ts` files intended for child projects |
| Package scripts | Scripts required to run validation, deploy guards, sync, and tests |

Child projects receive harness files through **`pnpm run boilerplate:sync`**. Drift is reported by **`pnpm run boilerplate:check`**.

## What stays child-owned

These are **not** part of the harness sync contract:

- `wrangler.jsonc`
- D1 database IDs and names
- R2 bucket names
- Worker names per environment
- `.env` files and Cloudflare secrets
- Custom domains
- Customized seed-only app files (`src/app/(frontend)/*`, collections, etc.)

Deploy **scripts** are synced so every project runs the same guard chain; Cloudflare **resource config** stays in each child repo.

## Shared integration tests

All files matching `tests/int/*.int.spec.ts` are shared harness tests unless explicitly marked starter-only.

Current shared tests (listed in `managedPaths` in `scripts/sync-boilerplate.mjs`):

- `tests/int/api.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/cloudflare-env-guard.int.spec.ts`
- `tests/int/open-next-config.int.spec.ts`
- `tests/int/repo-safety-guard.int.spec.ts`

## Shared package scripts

Selected scripts in `packageScripts` (see `scripts/sync-boilerplate.mjs`):

**Validation:** `check`, `check:full`, `guard:safety`, `guard:cloudflare-env`, `typecheck`, `lint`, `test`, `test:int`

**Deploy safety:** `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`

**Payload and sync:** `generate:importmap`, `generate:types`, `generate:types:cloudflare`, `generate:types:payload`, `payload`, `boilerplate:sync`, `boilerplate:check`, `smoke:deploy`, `hooks:install`

After sync, run **`pnpm install`** in the child project because scripts and shared dependencies may have changed.

## Rules for maintainers

1. **New shared harness file** — Add the path to `managedPaths` in `scripts/sync-boilerplate.mjs` and ensure `tests/int/boilerplate-sync.int.spec.ts` covers it (directly or via the shared int-test contract test).

2. **New shared package script** — Add the script name to `packageScripts` in `scripts/sync-boilerplate.mjs` and add an assertion in `tests/int/boilerplate-sync.int.spec.ts` (or extend `REQUIRED_SHARED_PACKAGE_SCRIPTS`).

3. **Starter-only harness file** — Do not add to `managedPaths`. Document the path and reason in `STARTER_ONLY_INT_TESTS` in `tests/int/boilerplate-sync.int.spec.ts` so the contract test allows it.

4. **Do not sync** `wrangler.jsonc`, resource IDs, secrets, or `.env` files.

See also: [source-of-truth.md](./agent-loop/source-of-truth.md), [boilerplate-sync-command.md](./boilerplate-sync-command.md), root [README.md](../README.md#what-boilerplate-sync-updates).
