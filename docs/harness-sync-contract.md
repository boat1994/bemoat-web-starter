# Harness sync contract

This document defines what **harness** means in Bemoat boilerplate sync and how to keep the contract complete when adding new shared rails.

## What "harness" includes

The harness is everything child projects need to run the same safety rails, workflow rules, deploy guards, and integration tests as `bemoat-web-starter`:

| Category | Examples |
|----------|----------|
| Agent rules | `AGENTS.md`, `.agents/*`, `.cursor/rules/*` |
| Agent-loop docs | `docs/agent-loop/*`, `docs/hardening.md`, `docs/schema-evolution.md`, etc. |
| GitHub workflow and templates | `.github/workflows/ci.yml` (child-safe `bemoat:*` only), PR template, issue templates |
| Safety guards | `scripts/guard-pack.mjs` (orchestrator), `scripts/guard-repo-safety.mjs`, `scripts/guard-harness-contract.mjs`, `scripts/guard-package-manager.mjs`, `scripts/guard-env-placeholder.mjs`, `scripts/guard-cloudflare-env.mjs`, `scripts/guard-frontend-seo.mjs` — see [guard-pack.md](./guard-pack.md) |
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

### Source-driven sync manifest

The starter publishes **`.bemoat/boilerplate-sync-manifest.json`** — a static JSON copy of the sync path lists and package sync config. After cloning the starter, `scripts/sync-boilerplate.mjs` reads that manifest from the cloned source and uses it for the current run (`managedPaths`, `seedOnlyPaths`, `mergeKeepPaths`, package script lists). If the manifest is missing (very old starter ref), sync falls back to the local script constants.

This prevents the **first-sync paradox**: when the starter adds a new managed path, child projects with an older local sync script still copy the new path in **one** run because path discovery happens from the cloned manifest, not only from the already-loaded local constants. Maintain the manifest in `bemoat-web-starter` whenever you change `managedPaths` or related lists in `scripts/sync-boilerplate.mjs` (keep them identical; `tests/int/boilerplate-sync.int.spec.ts` asserts parity).

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
| Non-namespaced scripts (`build`, `deploy`, `preview`, `check`, `lint`, `dev`, `start`, etc.) | **Never touched by default** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| Build/deploy contract (`build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`) | **Opt-in only** — pass `--apply-build-contract` to overwrite these scripts from the starter and sync `scripts/build.mjs` |
| Build contract files (`open-next.config.ts`) | **Opt-in only** — applied with `--apply-build-contract` via `buildContractFilePaths`; not in `managedPaths` |
| `src/payload.config.ts` build context | **Child-owned** — not overwritten; review manually after build contract rollout (see `src/lib/payloadBuildContext.ts`) |
| `dependencies` / `devDependencies` | **Never touched** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| `pnpm-lock.yaml` | Never synced |

After sync, review **`.bemoat/package-sync-proposal.md`**. Do not apply script or dependency changes automatically unless you used **`--apply-build-contract`** for the build/deploy scripts. Update `package.json` manually for other drift when desired, then run **`pnpm install`**.

```bash
# Fix recursive OpenNext build or stale deploy scripts in child projects (overwrites build/deploy contract scripts + syncs scripts/build.mjs + open-next.config.ts)
pnpm run boilerplate:sync -- --harness-only --apply-build-contract
```

Managed namespaced scripts (see `managedPackageScripts` in `scripts/sync-boilerplate.mjs`):

- `bemoat:guard:safety` (repo safety + harness contract)
- `bemoat:guard:harness-contract` (standalone harness contract check)
- `bemoat:guard:cloudflare-env`
- `bemoat:test:int`
- `bemoat:check`
- `bemoat:boilerplate:sync`
- `bemoat:boilerplate:check`
- `bemoat:hooks:install`

Suggested non-namespaced scripts (reported in proposal only — never auto-applied by default):

- `build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- `dev`, `start`

Proposal sections: **Script drift report (human review only)**, **Dependency drift report (human review only)**.

## Synced CI and hooks (child-safe baseline)

Package sync adds only missing `bemoat:*` scripts. Synced harness files must not assume non-namespaced scripts exist in child projects.

| Harness file | Runs on CI / pre-push |
|--------------|----------------------|
| `.github/workflows/ci.yml` | `pnpm install --frozen-lockfile`, `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int` |
| `.githooks/pre-push` | `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int` |

Do **not** call these directly from synced CI or pre-push: `guard:safety`, `guard:cloudflare-env`, `check`, `check:full`, `typecheck`, `lint`, `build`, `deploy`, `deploy:app`, `deploy:database`, `preview`, or `test:int`.

Child projects may add stricter validation later (`check`, `lint`, `typecheck`, `build`, deploy scripts) and extend their own CI or pre-push when those scripts exist. `bemoat-web-starter` itself runs full validation locally and via [`.github/workflows/ci-starter.yml`](../.github/workflows/ci-starter.yml) (starter-only, not synced).

## Harness contract guard

`scripts/guard-harness-contract.mjs` enforces that **child-facing automation** calls only `bemoat:*` scripts.

| Child-facing path | Purpose |
|-------------------|---------|
| `.github/workflows/ci.yml` | Synced GitHub Actions workflow |
| `.githooks/pre-push` | Optional local pre-push hook |

Human-facing templates (`.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/agent-task.yml`) may reference raw scripts as **local developer instructions** — they are not automation entry points and are not scanned by the guard.

The guard runs:

- as part of `pnpm run guard:safety` and `pnpm run bemoat:guard:safety`
- standalone via `pnpm run bemoat:guard:harness-contract`
- in integration tests (`tests/int/harness-contract-guard.int.spec.ts`)

If a maintainer adds a new child-facing automation file, add its path to `CHILD_FACING_HARNESS_PATHS` in `scripts/guard-harness-contract.mjs` and extend the guard tests.

## Child harness script contract

Child projects should treat **`bemoat:*` as the public harness API**. Synced CI and pre-push call only these scripts:

| Script | Purpose |
|--------|---------|
| `bemoat:guard:safety` | Central guard pack v1 (all reusable safety checks) |
| `bemoat:guard:pack` | Explicit alias for the central guard pack |
| `bemoat:test:int` | Shared Vitest integration tests |
| `bemoat:guard:cloudflare-env` | Cloudflare deploy environment guard (when deploy scripts exist) |
| `bemoat:check` | Optional stricter local/CI check when child defines `lint` and `typecheck` |
| `bemoat:boilerplate:sync` / `bemoat:boilerplate:check` | Pull harness updates from starter |
| `bemoat:hooks:install` | Install optional `.githooks/pre-push` |

Raw implementation scripts (`lint`, `typecheck`, `build`, `deploy`, `preview`, `check`, `guard:safety`, etc.) are **starter-internal or child-local**. Do not call them from synced CI or pre-push templates.

## Shared integration tests

All files matching `tests/int/**/*.int.spec.ts` are shared harness tests unless explicitly marked starter-only.

Current shared tests (listed in `managedPaths` in `scripts/sync-boilerplate.mjs`):

- `tests/int/api.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/cloudflare-env-guard.int.spec.ts`
- `tests/int/guard-pack.int.spec.ts`
- `tests/int/harness-contract-guard.int.spec.ts`
- `tests/int/open-next-config.int.spec.ts`
- `tests/int/repo-safety-guard.int.spec.ts`
- `tests/int/starter-acceptance.int.spec.ts` (acceptance contract — see [starter-acceptance-tests.md](./starter-acceptance-tests.md))

## Rules for maintainers

1. **New shared harness file** — Add the path to `managedPaths` in `scripts/sync-boilerplate.mjs`, mirror the same entry in `.bemoat/boilerplate-sync-manifest.json`, and ensure `tests/int/boilerplate-sync.int.spec.ts` covers it (directly or via the shared int-test contract test).

2. **New safe namespaced script** — Add to `managedPackageScripts` if sync should add it when missing. Add starter `bemoat:*` values in this repo's `package.json`.

3. **New child-facing automation file** — Add to `CHILD_FACING_HARNESS_PATHS` in `scripts/guard-harness-contract.mjs` and cover it in `tests/int/harness-contract-guard.int.spec.ts`.

4. **New recommended non-namespaced script** — Add to `suggestedPackageScripts` so drift appears in the package sync proposal (human review only; never auto-applied).

5. **New merge-keep path** — Add to `mergeKeepPaths` with merge logic in `scripts/sync-boilerplate.mjs` and drift coverage in `scripts/check-boilerplate-drift.mjs`.

6. **Starter-only harness file** — Do not add to `managedPaths`. Document the path and reason in `STARTER_ONLY_INT_TESTS` in `tests/int/boilerplate-sync.int.spec.ts` so the contract test allows it.

7. **Do not sync** `wrangler.jsonc`, resource IDs, secrets, `.env` files, or `pnpm-lock.yaml`.

8. **Do not add `README.md` to `managedPaths`.** Root README is project-owned. Existing projects keep their own README. Harness documentation lives under `docs/*` and `AGENTS.md`. `tests/int/boilerplate-sync.int.spec.ts` asserts `managedPaths` does not include `README.md`.

See also: [source-of-truth.md](./agent-loop/source-of-truth.md), [boilerplate-sync-command.md](./boilerplate-sync-command.md), [child-project-migration-guide.md](./child-project-migration-guide.md) (harness migration playbook for child repos), root [README.md](../README.md#what-boilerplate-sync-updates).
