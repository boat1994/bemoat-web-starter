# Bemoat boilerplate sync command

This repo includes a one-command sync script for copying reusable boilerplate pieces from `boat1994/bemoat-web-starter` into any project that was cloned from this starter.

## Command

```bash
pnpm run boilerplate:sync
```

## What it updates

### Always synced rails (harness workflow)

- `AGENTS.md` repository agent instructions
- `.cursor/rules/*` workflow instructions and Cursor rule files
- `.github/workflows/ci.yml`, PR template, and agent issue template
- `docs/agent-loop/*`, `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/cloudflare-environments.md`, `docs/schema-evolution.md`
- `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs`, `scripts/deploy-smoke-test.mjs`
- `scripts/guard-repo-safety.mjs`, `scripts/guard-cloudflare-env.mjs`, `scripts/install-git-hooks.mjs`
- `.githooks/pre-push` (optional local pre-push harness)
- `vitest.config.mts`, `vitest.setup.ts`, and shared harness tests under `tests/int/`:
  - `tests/int/api.int.spec.ts`
  - `tests/int/boilerplate-sync.int.spec.ts`
  - `tests/int/cloudflare-env-guard.int.spec.ts`
  - `tests/int/open-next-config.int.spec.ts`
  - `tests/int/repo-safety-guard.int.spec.ts`
- `docs/dev-boilerplate.md`, `docs/boilerplate-sync-command.md`, `docs/harness-sync-contract.md`

See [harness-sync-contract.md](./harness-sync-contract.md) for the full harness definition and maintainer rules.

### Package sync proposal (child-owned `package.json`)

`package.json` is **child-owned**. Sync does **not** auto-overwrite non-namespaced scripts or merge dependencies.

Default sync behavior:

- adds missing **`bemoat:*` scripts** only (`bemoat:guard:safety`, `bemoat:guard:cloudflare-env`, `bemoat:test:int`, `bemoat:check`, `bemoat:boilerplate:sync`, `bemoat:boilerplate:check`, `bemoat:hooks:install`)
- writes **`.bemoat/package-sync-proposal.md`** with recommended scripts and dependencies for human review

Recommended scripts surfaced in the proposal (not force-applied):

- Validation: `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- Deploy safety: `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`

Recommended sections surfaced in the proposal: `dependencies`, `devDependencies`

`pnpm-lock.yaml` is never synced.

### Seeded once (starter app code)

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
BEMOAT_BOILERPLATE_REF=dev pnpm run boilerplate:sync
```

## Use a different source repository

```bash
BEMOAT_BOILERPLATE_REPO=boat1994/bemoat-web-starter pnpm run boilerplate:sync
```

## After syncing

The sync command automatically creates a Git commit for:

- every file path it synced from the boilerplate
- newly seeded files from `seedOnlyPaths`
- `package.json` only when missing `bemoat:*` scripts were added
- `.bemoat-boilerplate-sync.json`

If local uncommitted changes already exist, the script stashes only files outside the sync-managed scope and restores them after the sync commit. Existing edits on sync-managed files are overwritten by the new sync output instead of being popped back afterward.

If a child project is still using the older sync script, copy `scripts/sync-boilerplate.mjs` from the starter into that project once before rerunning sync. The older script version did not sync itself forward.

Review **`.bemoat/package-sync-proposal.md`**, apply any desired `package.json` changes manually, then run **`pnpm install`** because dependencies may have changed:

```bash
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Review the generated migration before deploying to Cloudflare D1.
