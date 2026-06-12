# Bemoat boilerplate sync command

This repo includes a one-command sync script for copying reusable boilerplate pieces from `boat1994/bemoat-web-starter` into any project that was cloned from this starter.

## Command

```bash
pnpm run boilerplate:sync
```

## What it updates

- `AGENTS.md` repository agent instructions
- `.cursor/rules/*` workflow instructions and Cursor rule files
- Frontend starter pages
- Projects pages
- Blog pages
- Custom order page
- Payload collections
- Payload globals
- Admin extension placeholder components
- Helper utilities
- `src/payload.config.ts`
- Selected package scripts and dependencies

It does not overwrite project-specific Cloudflare resources such as `wrangler.jsonc`, D1 database IDs, R2 bucket names, secrets, or `.env` files.

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

If local uncommitted changes already exist, the script stashes them first and restores them after the sync commit.

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Review the generated migration before deploying to Cloudflare D1.
