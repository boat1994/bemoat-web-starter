# Bemoat Web Starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)

A reusable Payload 3, Next.js, and Cloudflare starter for Bemoat projects.

This starter is based on the Payload Cloudflare D1 template and extended with reusable modules from the Bogus dev branch.

## What is included

- Payload 3 CMS
- Next.js app router frontend
- Cloudflare Workers deployment through OpenNext
- Cloudflare D1 database binding
- Cloudflare R2 media storage binding
- Jewelry project CMS schema
- Blog CMS schema
- Custom order page global
- Site settings global
- Thai and English localization
- One-command boilerplate sync for child projects

## Source history

The first Bemoat boilerplate layer was migrated from:

```text
boat1994/bogus-jewelry#dev
```

Target boilerplate repository:

```text
boat1994/bemoat-web-starter#main
```

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

- Frontend starter page
- Projects index page
- Project detail page
- Blog index page
- Blog detail page
- Custom order page
- Payload collections
- Payload globals
- Gemstone constants
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

## Current CMS modules

### Core

- Users
- Media
- BlogMedia

### Jewelry and portfolio

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

The first boilerplate layer does not include the heavy operations modules from Bogus dev:

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
