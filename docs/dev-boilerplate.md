# Bemoat dev boilerplate

Target repository: `boat1994/bemoat-web-starter`

## Included

- Generic project CMS schema
- Categories and tags
- Blog categories
- Blog media
- Blog posts with content blocks
- Site settings global
- Custom order page global
- Frontend pages for home, projects, blog, and custom order
- Payload admin import map placeholders for AI extension points

## Intentionally not included yet

The order operations, LINE, payment slip, copilot, and handoff modules from previous project work are not included in this first boilerplate pass because they depend on project-specific collections, secrets, external APIs, and operational workflows.

## Sync behavior

Child projects should run `pnpm run boilerplate:check` before `pnpm run boilerplate:sync`.

The check command is read-only and reports three categories:

- **Managed drift** — rails-managed paths that differ from the starter (exit 1; run sync)
- **Missing seed files** — starter app files not yet present in the child (exit 1; run sync to seed them)
- **Customized seed files ignored** — child-owned starter files that differ from upstream (exit 0; no action required)

### Rails-managed paths

Agent docs, CI, sync scripts, and shared package scripts are overwritten on every sync. See the root [README.md](../../README.md#what-boilerplate-sync-updates) and [docs/agent-loop/source-of-truth.md](../agent-loop/source-of-truth.md) for the full list.

### Starter-seed paths

Frontend pages, collections, globals, components, hooks, access helpers, `src/lib`, and `src/payload.config.ts` are copied only when missing. After a child customizes them, sync never overwrites them.

`pnpm-lock.yaml` is not synced. After sync, run `pnpm install` in the child project to refresh the local lockfile.

## After pulling this change

Run these commands locally before serious deployment:

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Then review the generated migration before deploying to Cloudflare D1.
