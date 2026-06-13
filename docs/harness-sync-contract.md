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
| Cloudflare deploy guards | Recommended `deploy` / `preview` scripts that call `guard:cloudflare-env` |
| Sync and drift | `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs` |
| Local git hooks | `.githooks`, `scripts/install-git-hooks.mjs`, `hooks:install` |
| Vitest harness | `vitest.config.mts`, `vitest.setup.ts` |
| Shared integration tests | All `tests/int/**/*.int.spec.ts` files intended for child projects |

Child projects receive harness **files** through **`pnpm run boilerplate:sync`**. Drift is reported by **`pnpm run boilerplate:check`**.

## What stays child-owned

These are **not** part of the harness sync contract:

- `package.json` (child-owned manifest)
- `pnpm-lock.yaml`
- `wrangler.jsonc`
- D1 database IDs and names
- R2 bucket names
- Worker names per environment
- `.env` files and Cloudflare secrets
- Custom domains
- Customized seed-only app files (`src/app/(frontend)/*`, collections, etc.)

Deploy **script recommendations** are surfaced in a package sync proposal. Cloudflare **resource config** stays in each child repo.

## Package manifest ownership

`package.json` is **child-owned**. Boilerplate sync does not treat it as a managed rails file.

| Category | Sync behavior |
|----------|---------------|
| `bemoat:*` scripts | Managed — sync **adds missing** namespaced scripts only; never overwrites existing entries |
| Non-namespaced scripts (`build`, `deploy`, `preview`, `check`, `lint`, etc.) | Proposal only — listed in `.bemoat/package-sync-proposal.md` |
| `dependencies` / `devDependencies` | Proposal only — never auto-merged with `Object.assign` |
| `pnpm-lock.yaml` | Never synced |

After sync, review **`.bemoat/package-sync-proposal.md`**, apply any desired `package.json` changes manually, then run **`pnpm install`**.

Managed namespaced scripts (see `managedPackageScripts` in `scripts/sync-boilerplate.mjs`):

- `bemoat:guard:safety`
- `bemoat:guard:cloudflare-env`
- `bemoat:test:int`
- `bemoat:check`
- `bemoat:boilerplate:sync`
- `bemoat:boilerplate:check`
- `bemoat:hooks:install`

Suggested non-namespaced scripts (proposal only):

- `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`

## Shared integration tests

All files matching `tests/int/**/*.int.spec.ts` are shared harness tests unless explicitly marked starter-only.

Current shared tests (listed in `managedPaths` in `scripts/sync-boilerplate.mjs`):

- `tests/int/api.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/cloudflare-env-guard.int.spec.ts`
- `tests/int/open-next-config.int.spec.ts`
- `tests/int/repo-safety-guard.int.spec.ts`

## Rules for maintainers

1. **New shared harness file** — Add the path to `managedPaths` in `scripts/sync-boilerplate.mjs` and ensure `tests/int/boilerplate-sync.int.spec.ts` covers it (directly or via the shared int-test contract test).

2. **New safe namespaced script** — Add to `managedPackageScripts` if sync should add it when missing. Add starter `bemoat:*` values in this repo's `package.json`.

3. **New recommended non-namespaced script** — Add to `suggestedPackageScripts` so it appears in the package sync proposal.

4. **Starter-only harness file** — Do not add to `managedPaths`. Document the path and reason in `STARTER_ONLY_INT_TESTS` in `tests/int/boilerplate-sync.int.spec.ts` so the contract test allows it.

5. **Do not sync** `wrangler.jsonc`, resource IDs, secrets, `.env` files, or `pnpm-lock.yaml`.

See also: [source-of-truth.md](./agent-loop/source-of-truth.md), [boilerplate-sync-command.md](./boilerplate-sync-command.md), root [README.md](../README.md#what-boilerplate-sync-updates).
