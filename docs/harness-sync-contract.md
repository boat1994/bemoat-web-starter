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

## Sync modes

| Mode | When to use | Starter modules |
|------|-------------|-----------------|
| **`harness-only`** (default) | Existing projects with their own Payload schema, frontend, components, hooks, access, lib, and `payload.config.ts` | **Not copied** — `seedOnlyPaths` are skipped |
| **`full`** | New child projects or repos that still want missing starter files seeded once | Copied only when missing; never overwrites existing child files |

Commands:

```bash
# Existing repos (recommended)
pnpm run boilerplate:sync -- --harness-only
pnpm run boilerplate:check -- --harness-only

# New repos that want starter module seeding
pnpm run boilerplate:sync -- --full
pnpm run boilerplate:check -- --full
```

CLI flags take precedence over `BEMOAT_SYNC_MODE`. Sync metadata in `.bemoat-boilerplate-sync.json` records `syncMode` and `seedOnlyPathsSkipped`.

Starter modules (`src/app/(frontend)`, `src/collections`, `src/globals`, `src/components`, `src/hooks`, `src/access`, `src/lib`, `src/payload.config.ts`) are **not** harness.

## What stays child-owned

These are **not** part of the harness sync contract:

- `README.md` (project-owned — existing projects keep their own README; harness documentation lives under `docs/*` and `AGENTS.md`)
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

## Merge-keep paths

Some child-owned files are merged during sync: existing content is preserved and missing starter entries are appended.

| Path | Sync behavior |
|------|---------------|
| `.gitignore` | Keep all child ignore rules; append missing starter rules under `# Added by bemoat boilerplate sync` |

Listed in `mergeKeepPaths` in `scripts/sync-boilerplate.mjs`. Drift check fails when starter rules are missing from the child file.

## Package manifest ownership

`package.json` is **child-owned**. Boilerplate sync does not treat it as a managed rails file.

| Category | Sync behavior |
|----------|---------------|
| `bemoat:*` scripts | Managed — sync **adds missing** namespaced scripts only; **never overwrites** existing entries |
| Non-namespaced scripts (`build`, `deploy`, `preview`, `check`, `lint`, `dev`, `start`, etc.) | **Never touched** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| `dependencies` / `devDependencies` | **Never touched** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| `pnpm-lock.yaml` | Never synced |

After sync, review **`.bemoat/package-sync-proposal.md`**. Do not apply script or dependency changes automatically. Update `package.json` manually when desired, then run **`pnpm install`**.

Managed namespaced scripts (see `managedPackageScripts` in `scripts/sync-boilerplate.mjs`):

- `bemoat:guard:safety`
- `bemoat:guard:cloudflare-env`
- `bemoat:test:int`
- `bemoat:check`
- `bemoat:boilerplate:sync`
- `bemoat:boilerplate:check`
- `bemoat:hooks:install`

Suggested non-namespaced scripts (reported in proposal only — never auto-applied):

- `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- `dev`, `start`

Proposal sections: **Script drift report (human review only)**, **Dependency drift report (human review only)**.

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

3. **New recommended non-namespaced script** — Add to `suggestedPackageScripts` so drift appears in the package sync proposal (human review only; never auto-applied).

4. **New merge-keep path** — Add to `mergeKeepPaths` with merge logic in `scripts/sync-boilerplate.mjs` and drift coverage in `scripts/check-boilerplate-drift.mjs`.

5. **Starter-only harness file** — Do not add to `managedPaths`. Document the path and reason in `STARTER_ONLY_INT_TESTS` in `tests/int/boilerplate-sync.int.spec.ts` so the contract test allows it.

6. **Do not sync** `wrangler.jsonc`, resource IDs, secrets, `.env` files, or `pnpm-lock.yaml`.

7. **Do not add `README.md` to `managedPaths`.** Root README is project-owned. Existing projects keep their own README. Harness documentation lives under `docs/*` and `AGENTS.md`. `tests/int/boilerplate-sync.int.spec.ts` asserts `managedPaths` does not include `README.md`.

See also: [source-of-truth.md](./agent-loop/source-of-truth.md), [boilerplate-sync-command.md](./boilerplate-sync-command.md), root [README.md](../README.md#what-boilerplate-sync-updates).
