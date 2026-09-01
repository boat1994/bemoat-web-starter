# Bemoat boilerplate sync command

This repo includes a one-command sync script for copying reusable boilerplate pieces from `boat1994/bemoat-web-starter` into any project that was cloned from this starter.

## Command

**Existing projects** (custom Payload schema, frontend, components) should adopt harness rails only:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

**New child projects** or fresh starter-derived repos that still want missing starter modules seeded:

```bash
pnpm run bemoat:boilerplate:sync -- --full
```

If you omit flags, sync defaults to **`harness-only`** (safe for existing repos).

Drift check uses the same modes:

```bash
pnpm run bemoat:boilerplate:check -- --harness-only
pnpm run bemoat:boilerplate:check -- --full
```

Use raw `boilerplate:sync` / `boilerplate:check` aliases only when a child
project defines those non-namespaced scripts. In `bemoat-web-starter` itself,
the raw aliases are available for starter development.

Optional environment variable (CLI flags take precedence):

```bash
BEMOAT_SYNC_MODE=harness-only pnpm run bemoat:boilerplate:sync
BEMOAT_SYNC_MODE=full pnpm run bemoat:boilerplate:check
```

Optional environment variable for the OpenNext build script contract (CLI flag takes precedence):

```bash
BEMOAT_APPLY_BUILD_CONTRACT=1 pnpm run bemoat:boilerplate:sync -- --harness-only
```

### Apply build contract (opt-in)

Child projects stuck on the recursive OpenNext `build` script can apply the starter's split contract without hand-editing `package.json`:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only --apply-build-contract
```

This **overwrites** these child-owned scripts from the starter `package.json`, syncs `scripts/build.ts`, and applies build-contract files:

- `build` — context-aware wrapper (`node scripts/build.ts`) that runs OpenNext at the top level
- `build:next` — plain Next.js `next build` for OpenNext re-entry
- `build:cloudflare` — OpenNext Cloudflare build
- `cf:build` — compatibility alias to `pnpm run build`
- `deploy:app` — uses `pnpm run build` then OpenNext deploy
- `preview` — uses `pnpm run build` then OpenNext preview
- `open-next.config.ts` — OpenNext `buildCommand` re-enters `pnpm run build` with `BEMOAT_BUILD_CONTEXT=opennext-next-build`

Default sync (without the flag) still **never** auto-overwrites other non-namespaced scripts or `open-next.config.ts`. Review remaining drift in `.bemoat/package-sync-proposal.md`.

### Child-owned `src/payload.config.ts`

`src/payload.config.ts` is **seed-only / child-owned**. Harness-only sync does **not** overwrite an existing child payload config. After `--apply-build-contract`, review whether your Payload config recognizes production build context. Without this, Cloudflare builds may fail when Payload tries to initialize D1/R2 bindings incorrectly.

Use the starter helper `src/lib/payloadBuildContext.ts` (`isPayloadBuildContext`) or equivalent checks for:

- `npm_lifecycle_event === 'build'`
- `npm_lifecycle_event === 'build:next'`
- `BEMOAT_BUILD_CONTEXT === 'opennext-next-build'`
- `NEXT_PHASE === 'phase-production-build'`

If your child project has a custom payload config, apply the snippet manually or in a child-specific task — sync will not overwrite it.

After merge of the build-contract fix into `bemoat-web-starter`, run the
namespaced command above in **bemoat** (or any child) instead of copying scripts
manually.

## Sync modes

| Mode | Harness rails | Starter modules (`seedOnlyPaths`) |
|------|---------------|-----------------------------------|
| `harness-only` (default) | Synced / overwritten | **Skipped** — does not copy collections, globals, frontend routes, components, lib, hooks, access, or `payload.config.ts` |
| `full` | Synced / overwritten | Copied only when missing in the child (never overwrites existing files) |

Starter modules are **not** harness. Use `harness-only` when the child project already has its own app and schema code.

## What it updates

### Always synced rails (harness workflow)

- `AGENTS.md` repository agent instructions
- `.agents/*` portable project-level agent fallback instructions
- `.cursor/rules/*` workflow instructions and Cursor rule files
- `.github/workflows/ci.yml`, PR template, and agent issue template (child-safe CI: `bemoat:guard:safety`, `bemoat:test:int` only)
- `docs/agent-loop/*`, `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/cloudflare-environments.md`, `docs/schema-evolution.md`
- `scripts/sync-boilerplate.ts`, `scripts/check-boilerplate-drift.ts`, `scripts/deploy-smoke-test.ts`
- `scripts/guards/repo-safety.ts`, `scripts/guard-cloudflare-env.ts`, `scripts/install-git-hooks.ts`
- `.githooks/pre-commit` and `.githooks/pre-push` (optional local branch safety and pre-push harness)
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

- adds missing **`bemoat:*` scripts** only (`bemoat:branch:check`, `bemoat:guard:safety`, `bemoat:guard:cloudflare-env`, `bemoat:test:int`, `bemoat:check`, `bemoat:boilerplate:sync`, `bemoat:boilerplate:check`, `bemoat:hooks:install`)
- never overwrites existing **`bemoat:*` scripts**
- never adds, overwrites, removes, renames, or reorders deploy/build/check/test scripts **unless** you pass **`--apply-build-contract`** (see below)
- never auto-adds, removes, bumps, or rewrites **`dependencies`** or **`devDependencies`**
- writes **`.bemoat/package-sync-proposal.md`** with script and dependency drift for human review only

Toolchain policy is the exception: review `.bemoat/toolchain-contract.json` and
manually align the child package and lockfile to its exact TypeScript pin before
running `pnpm run bemoat:typecheck`.

**Opt-in build contract** (`--apply-build-contract`):

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only --apply-build-contract
```

Overwrites `build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy:app`, and `preview` from the starter, syncs `scripts/build.ts`, and applies `open-next.config.ts` from `buildContractFilePaths`. Use when fixing the recursive OpenNext build loop in child projects. All other non-namespaced scripts remain proposal-only.

**Build contract files** (`buildContractFilePaths` in `scripts/sync-boilerplate.ts`):

| File | Why opt-in sync |
|------|-----------------|
| `open-next.config.ts` | Sets OpenNext `buildCommand` to re-enter `pnpm run build` with `BEMOAT_BUILD_CONTEXT=opennext-next-build` |

Default sync does **not** overwrite `open-next.config.ts`.

**Child-owned payload config:** `src/payload.config.ts` is not synced in harness-only mode. After applying the build contract, manually review that your Payload config uses build context detection (see `src/lib/payloadBuildContext.ts` in the starter). Sync surfaces this in suggested next commands but does not overwrite child payload config.

Non-namespaced script drift surfaced in the proposal (never force-applied by default):

- Validation: `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- Deploy safety: `build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- Runtime: `dev`, `start`

Dependency drift surfaced in the proposal: `dependencies`, `devDependencies`

Synced CI and hooks assume only `bemoat:*` scripts exist, plus direct shell execution of the synced branch safety script. Full `lint`, `typecheck`, `build`, and `check` baselines are follow-up work in each child project — add those scripts manually from the proposal when ready, then extend local CI or hooks if desired.

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
BEMOAT_BOILERPLATE_REF=dev pnpm run bemoat:boilerplate:sync -- --harness-only
```

## Use a different source repository

```bash
BEMOAT_BOILERPLATE_REPO=boat1994/bemoat-web-starter pnpm run bemoat:boilerplate:sync -- --harness-only
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

### Bootstrap a child whose local sync command is intercepted

Use the bootstrap path only when all of these are true:

- the child working tree is clean;
- `package.json` maps `bemoat:boilerplate:sync` exactly to `node scripts/sync-boilerplate.mjs`;
- local `pnpm run bemoat:boilerplate:sync -- --help --json` enters retired Mission Control logic before it can return the current JSON help envelope; and
- a clean checkout of the current approved starter source is available with its locked dependencies installed.

First perform CLI Discovery against the current source-owned registered command. This step is read-only and must succeed before any bootstrap mutation:

```bash
pnpm --dir /absolute/path/to/current/bemoat-web-starter \
  run bemoat:boilerplate:sync -- --help --json
```

Then run the same current Tier A entrypoint from the legacy child root:

```bash
cd /absolute/path/to/clean/legacy-child
env -u npm_lifecycle_event node \
  /absolute/path/to/current/bemoat-web-starter/scripts/sync-boilerplate.ts \
  --bootstrap-legacy-child --harness-only --json
```

This is an explicit mode of the authoritative `bemoat:boilerplate:sync` CLI, not an internal workflow API or a second sync implementation. It reuses the normal source clone, source-driven manifest, preflight, harness-only sync, validation, commit, and readback path. The only package-script replacements it permits are exact known generated `.mjs` mappings whose current starter values are the matching `.ts` entrypoints. Custom or unrecognized mappings, a dirty target, `--full`, and `--apply-build-contract` fail before harness mutation.

Do not fabricate legacy Issues, HANDOFF records, managed YAML, review counters, Founder receipts, or Mission Control transitions. Do not use `--skip-mc-transition-gate`, manually copy managed files, or temporarily edit the child package manifest.

After bootstrap, verify that `package.json` maps `bemoat:boilerplate:sync` to `node scripts/sync-boilerplate.ts`, review the committed paths, install any proposed dependencies if approved, and run:

```bash
pnpm run bemoat:boilerplate:sync -- --help --json
pnpm run bemoat:boilerplate:sync -- --harness-only --json
pnpm run bemoat:guard:safety
pnpm run bemoat:test:int
git diff --check
```

The normal child command is authoritative after bootstrap; an identical retry must report the normal no-op result rather than re-entering legacy workflow logic.

### Source-driven sync manifest (one-run managed paths)

After cloning the starter, sync reads **`.bemoat/boilerplate-sync-manifest.json`** from the cloned source. That static JSON file is the source-of-truth sync config for the run: `managedPaths`, `seedOnlyPaths`, `mergeKeepPaths`, and package sync lists.

**Why it exists:** child projects execute their **local** `scripts/sync-boilerplate.ts`. When the starter adds a new managed path (for example `.agents`), an older local script may not list that path yet. Without the manifest, the first sync would update the local script but would have already used the old in-memory path list, so the new path would only copy on a **second** run. Reading the manifest from the cloned starter after clone fixes that first-sync paradox: newly added managed paths apply in the same run.

If the cloned source has no manifest (very old starter ref), sync falls back to the local script constants and continues safely.

Review **`.bemoat/package-sync-proposal.md`** for script and dependency drift (human review only). Update `package.json` manually when desired, then run **`pnpm install`** if dependencies changed:

```bash
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Review the generated migration before deploying to Cloudflare D1.
