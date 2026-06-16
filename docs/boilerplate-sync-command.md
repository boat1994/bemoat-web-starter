# Bemoat boilerplate sync command

This repo includes a one-command sync script for copying reusable boilerplate pieces from `boat1994/bemoat-web-starter` into any project that was cloned from this starter.

## Command

**Existing projects** (custom Payload schema, frontend, components) should adopt harness rails only:

```bash
pnpm run boilerplate:sync -- --harness-only
```

**New child projects** or fresh starter-derived repos that still want missing starter modules seeded:

```bash
pnpm run boilerplate:sync -- --full
```

If you omit flags, sync defaults to **`harness-only`** (safe for existing repos).

Drift check uses the same modes:

```bash
pnpm run boilerplate:check -- --harness-only
pnpm run boilerplate:check -- --full
```

Optional environment variable (CLI flags take precedence):

```bash
BEMOAT_SYNC_MODE=harness-only pnpm run boilerplate:sync
BEMOAT_SYNC_MODE=full pnpm run boilerplate:check
```

Optional environment variable for the OpenNext build script contract (CLI flag takes precedence):

```bash
BEMOAT_APPLY_BUILD_CONTRACT=1 pnpm run boilerplate:sync -- --harness-only
```

### Apply build contract (opt-in)

Child projects stuck on the recursive OpenNext `build` script can apply the starter's split contract without hand-editing `package.json`:

```bash
pnpm run boilerplate:sync -- --harness-only --apply-build-contract
```

This **overwrites** these child-owned scripts from the starter `package.json`:

- `build` — Next.js `next build` only
- `cf:build` — OpenNext Cloudflare build
- `deploy:app` — uses `cf:build` then OpenNext deploy
- `preview` — uses `cf:build` then OpenNext preview

Default sync (without the flag) still **never** auto-overwrites other non-namespaced scripts. Review remaining drift in `.bemoat/package-sync-proposal.md`.

After merge of the build-contract fix into `bemoat-web-starter`, run the command above in **bemoat** (or any child) instead of copying scripts manually.

## Sync modes

| Mode | Harness rails | Starter modules (`seedOnlyPaths`) |
|------|---------------|-----------------------------------|
| `harness-only` (default) | Synced / overwritten | **Skipped** — does not copy collections, globals, frontend routes, components, lib, hooks, access, or `payload.config.ts` |
| `full` | Synced / overwritten | Copied only when missing in the child (never overwrites existing files) |

Starter modules are **not** harness. Use `harness-only` when the child project already has its own app and schema code.

## What it updates

### Always synced rails (harness workflow)

- `AGENTS.md` repository agent instructions
- `.cursor/rules/*` workflow instructions and Cursor rule files
- `.github/workflows/ci.yml`, PR template, and agent issue template (child-safe CI: `bemoat:guard:safety`, `bemoat:test:int` only)
- `docs/agent-loop/*`, `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/cloudflare-environments.md`, `docs/schema-evolution.md`
- `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs`, `scripts/deploy-smoke-test.mjs`
- `scripts/guard-repo-safety.mjs`, `scripts/guard-cloudflare-env.mjs`, `scripts/install-git-hooks.mjs`
- `.githooks/pre-push` (optional local pre-push harness — `bemoat:guard:safety`, `bemoat:test:int` only)
- `vitest.config.mts`, `vitest.setup.ts`, and shared harness tests under `tests/int/`:
  - `tests/int/api.int.spec.ts`
  - `tests/int/boilerplate-sync.int.spec.ts`
  - `tests/int/cloudflare-env-guard.int.spec.ts`
  - `tests/int/open-next-config.int.spec.ts`
  - `tests/int/repo-safety-guard.int.spec.ts`
- `docs/dev-boilerplate.md`, `docs/boilerplate-sync-command.md`, `docs/harness-sync-contract.md`

See [harness-sync-contract.md](./harness-sync-contract.md) for the full harness definition and maintainer rules.

### Package sync proposal (child-owned `package.json`)

`package.json` is **child-owned**. Sync does **not** auto-overwrite non-namespaced scripts, merge dependencies, or reorder scripts.

Default sync behavior:

- adds missing **`bemoat:*` scripts** only (`bemoat:guard:safety`, `bemoat:guard:cloudflare-env`, `bemoat:test:int`, `bemoat:check`, `bemoat:boilerplate:sync`, `bemoat:boilerplate:check`, `bemoat:hooks:install`)
- never overwrites existing **`bemoat:*` scripts**
- never adds, overwrites, removes, renames, or reorders deploy/build/check/test scripts **unless** you pass **`--apply-build-contract`** (see below)
- never auto-adds, removes, bumps, or rewrites **`dependencies`** or **`devDependencies`**
- writes **`.bemoat/package-sync-proposal.md`** with script and dependency drift for human review only

**Opt-in build contract** (`--apply-build-contract`):

```bash
pnpm run boilerplate:sync -- --harness-only --apply-build-contract
```

Overwrites `build`, `cf:build`, `deploy:app`, and `preview` from the starter. Use when fixing the recursive OpenNext build loop in child projects. All other non-namespaced scripts remain proposal-only.

Non-namespaced script drift surfaced in the proposal (never force-applied by default):

- Validation: `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- Deploy safety: `build`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- Runtime: `dev`, `start`

Dependency drift surfaced in the proposal: `dependencies`, `devDependencies`

Synced CI and pre-push hooks assume only `bemoat:*` scripts exist. Full `lint`, `typecheck`, `build`, and `check` baselines are follow-up work in each child project — add those scripts manually from the proposal when ready, then extend local CI or pre-push if desired.

`pnpm-lock.yaml` is never synced.

### Merged keep-child-content

- `.gitignore` — keeps existing child ignore rules and appends missing starter entries

### Seeded once (starter app code) — `full` mode only

These paths are processed only when you run sync with **`--full`**. In the default **`harness-only`** mode they are skipped entirely.

- Frontend starter pages
- Projects pages
- Blog pages
- Custom order page
- Payload collections
- Payload globals
- Admin extension placeholder components
- Helper utilities
- `src/payload.config.ts`

It does not overwrite project-specific Cloudflare resources such as `wrangler.jsonc`, D1 database IDs, R2 bucket names, secrets, or `.env` files. Deploy script **recommendations** appear in the package sync proposal; Cloudflare **resource config** is not synced.

## Use a different source ref

```bash
BEMOAT_BOILERPLATE_REF=dev pnpm run boilerplate:sync -- --harness-only
```

## Use a different source repository

```bash
BEMOAT_BOILERPLATE_REPO=boat1994/bemoat-web-starter pnpm run boilerplate:sync -- --harness-only
```

## After syncing

The sync command automatically creates a Git commit for:

- every file path it synced from the boilerplate
- newly seeded files from `seedOnlyPaths` ( **`full` mode only** )
- merge-keep updates such as `.gitignore` when starter ignore rules were appended
- `.bemoat/package-sync-proposal.md` (regenerated each sync)
- `package.json` only when missing `bemoat:*` scripts were added
- `.bemoat-boilerplate-sync.json`

If local uncommitted changes already exist, the script stashes only files outside the sync-managed scope and restores them after the sync commit. Existing edits on sync-managed files are overwritten by the new sync output instead of being popped back afterward.

If a child project is still using the older sync script, copy `scripts/sync-boilerplate.mjs` from the starter into that project once before rerunning sync. The older script version did not sync itself forward.

Review **`.bemoat/package-sync-proposal.md`** for script and dependency drift (human review only). Update `package.json` manually when desired, then run **`pnpm install`** if dependencies changed:

```bash
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Review the generated migration before deploying to Cloudflare D1.
