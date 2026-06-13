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
- Selected `package.json` scripts:
  - Validation: `check`, `check:full`, `guard:safety`, `guard:cloudflare-env`, `typecheck`, `lint`, `test`, `test:int`, `hooks:install`
  - Deploy safety: `build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
  - Payload and sync: generate scripts, `payload`, `boilerplate:sync`, `boilerplate:check`, `smoke:deploy`
- Shared `dependencies` and `devDependencies` from the starter `package.json`

See [harness-sync-contract.md](./harness-sync-contract.md) for the full harness definition and maintainer rules.

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

It does not overwrite project-specific Cloudflare resources such as `wrangler.jsonc`, D1 database IDs, R2 bucket names, secrets, or `.env` files. Deploy **scripts** are synced; Cloudflare **resource config** is not.

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
- `package.json`
- `.bemoat-boilerplate-sync.json`

If local uncommitted changes already exist, the script stashes only files outside the sync-managed scope and restores them after the sync commit. Existing edits on sync-managed files are overwritten by the new sync output instead of being popped back afterward.

If a child project is still using the older sync script, copy `scripts/sync-boilerplate.mjs` from the starter into that project once before rerunning sync. The older script version did not sync itself forward.

Run **`pnpm install`** after sync because `package.json` scripts and shared dependencies may have changed, then:

```bash
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Review the generated migration before deploying to Cloudflare D1.
