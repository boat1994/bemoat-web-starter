# Bemoat Web Starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)

A reusable Payload 3, Next.js, and Cloudflare starter for Bemoat projects.

This starter is based on the Payload Cloudflare D1 template and extended with reusable CMS and frontend modules.

## What is included

- Payload 3 CMS
- Next.js app router frontend
- Cloudflare Workers deployment through OpenNext
- Cloudflare D1 database binding
- Cloudflare R2 media storage binding
- Generic project CMS schema
- Blog CMS schema
- Custom order page global
- Site settings global
- Thai and English localization
- One-command boilerplate sync for child projects
- VS Code and Cursor workspace defaults
- Payload CMS agent rules and Superpowers workflow guidance

## Source history

The first Bemoat boilerplate layer was extracted from working project code and cleaned up for reuse in new repositories.

## Agent and editor setup

This starter includes the same development guidance used in the source project:

- `AGENTS.md` for repository-wide Payload CMS development rules
- `.cursor/rules/*` for Cursor rules covering Payload collections, fields, hooks, access control, endpoints, adapters, plugins, custom components, and critical security patterns
- `.cursor/rules/superpowers-using-superpowers.mdc` to require the Superpowers skill workflow
- `.vscode/*` for recommended extensions, formatting, TypeScript SDK, and Next.js debugging

All coding agents should begin task work with:

```text
superpowers:using-superpowers
```

Skill source:

```text
/home/boat/.codex/plugins/cache/openai-curated/superpowers/c6ea566d/skills/using-superpowers/SKILL.md
```

Before responding, asking clarifying questions, planning, editing files, running implementation commands, or reviewing code, agents should check whether a skill applies and follow it first. User instructions remain the highest priority.

## Important Cloudflare note

This template is expected to run on Cloudflare Paid Workers because the bundle can exceed the free Worker size limit.

Do not copy one project's Cloudflare resources into another project without changing them first:

- D1 database ID
- D1 database name
- R2 bucket name
- Worker name
- Environment variables
- Secrets

## Cloudflare deploy button settings

When Cloudflare asks for commands, use pnpm:

```text
Build command: pnpm run build
Deploy command: pnpm run deploy
```

The npm scripts internally use `pnpm exec` for OpenNext, Payload, and Wrangler so the local project binaries are used consistently.

## Local setup

```bash
pnpm install
pnpm wrangler login
pnpm dev
```

## Generate Payload files

Run these after changing Payload collections, globals, admin fields, or import map components:

```bash
pnpm run generate:importmap
pnpm run generate:types
```

## Create migrations

Run this before deploying schema changes to Cloudflare D1:

```bash
pnpm payload migrate:create
```

Review the generated migration before running deploy.

## Deploy

You can start from the Cloudflare deploy button at the top of this README, or deploy manually after setting up your Cloudflare resources.

```bash
pnpm run deploy
```

The deploy command runs database migration, optimizes D1, builds the app, and deploys the Worker.

## Boilerplate sync command

Child projects cloned from this starter can pull the latest reusable boilerplate layer with one command:

```bash
pnpm run boilerplate:sync
```

By default, this syncs from:

```text
boat1994/bemoat-web-starter#main
```

## Sync from another branch

```bash
BEMOAT_BOILERPLATE_REF=dev pnpm run boilerplate:sync
```

## Sync from another repository

```bash
BEMOAT_BOILERPLATE_REPO=boat1994/bemoat-web-starter pnpm run boilerplate:sync
```

## What boilerplate sync updates

- `AGENTS.md` repository agent instructions
- `.cursor/rules/*` workflow instructions and Cursor rule files
- Frontend starter page
- Projects index page
- Project detail page
- Blog index page
- Blog detail page
- Custom order page
- Payload collections
- Payload globals
- Admin extension placeholder components
- Helper utilities
- `src/payload.config.ts`
- Selected package scripts and dependencies

## What boilerplate sync does not update

The sync script intentionally does not overwrite project-specific infrastructure files:

- `wrangler.jsonc`
- D1 database IDs
- R2 bucket names
- Worker names
- `.env` files
- Cloudflare secrets

This keeps each project safe while still allowing reusable code to move forward.

## After every sync

The sync command now creates a Git commit automatically for the files it manages:

- every synced path in `managedPaths`
- `package.json`
- `.bemoat-boilerplate-sync.json`

If you have local uncommitted changes first, the script stashes them before syncing and restores them after the sync commit is created.

Run:

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Then review the migration and test locally before deploying.

## Recommended child project flow

```bash
git clone https://github.com/boat1994/bemoat-web-starter.git my-new-project
cd my-new-project
pnpm install
pnpm run boilerplate:sync
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
pnpm dev
```

After the project becomes real, update these files for that project:

- `package.json` name
- `wrangler.jsonc` Worker name
- D1 database config
- R2 bucket config
- Site metadata
- Domain and environment variables
- Agent rules that are no longer relevant to the child project

## Current CMS modules

### Core

- Users
- Media
- BlogMedia

### Projects and portfolio

- Projects
- Categories
- Tags

### Blog

- Posts
- BlogCategories

### Globals

- SiteSettings
- CustomOrderPage

## Intentionally not included yet

The first boilerplate layer does not include project-specific operations modules:

- Orders
- LINE integration
- Payment slip review
- Copilot
- Handoff workflow

These modules depend on project-specific APIs, secrets, collections, and operations rules. Add them later as a separate boilerplate layer when the interface is stable.

## Useful commands

```bash
pnpm dev
pnpm run build
pnpm run preview
pnpm run deploy
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
pnpm run boilerplate:sync
```

## Troubleshooting

### Build says `Unknown command: build`

Make sure the build script uses pnpm and OpenNext:

```json
"build": "cross-env NODE_OPTIONS=\"--no-deprecation --max-old-space-size=8000\" pnpm exec opennextjs-cloudflare build"
```

Do not use `payload build`.

### Admin field component not found

Run:

```bash
pnpm run generate:importmap
```

### Payload types are stale

Run:

```bash
pnpm run generate:types
```

### D1 schema does not match collections

Create and review a migration:

```bash
pnpm payload migrate:create
```

Then deploy only after the migration looks correct.
