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

Child projects should run `pnpm run boilerplate:check -- --harness-only` before `pnpm run boilerplate:sync -- --harness-only`.

Existing projects with custom app and schema code should use **`harness-only`** (the default). Use **`--full`** only for new child projects that still want missing starter modules seeded.

The check command is read-only and reports these categories:

- **Managed drift** — rails-managed paths that differ from the starter (exit 1; run sync)
- **Missing seed files** — starter app files not yet present in the child (**`full` mode only**; exit 1; run `sync -- --full` to seed them)
- **Customized seed files ignored** — child-owned starter files that differ from upstream (exit 0; no action required)
- **Merge-keep drift** — child-owned paths such as `.gitignore` that are missing starter entries (exit 1; run sync to append missing rules while keeping child content)
- **Package sync proposal (informational)** — recommended non-namespaced scripts and dependencies when they differ from the starter (exit 0; review `.bemoat/package-sync-proposal.md` after sync)

### Rails-managed paths

Agent docs, CI, sync scripts, guard scripts, harness tests, hooks, and workflow rules are overwritten on every sync. See the root [README.md](../../README.md#what-boilerplate-sync-updates), [docs/agent-loop/source-of-truth.md](../agent-loop/source-of-truth.md), and [harness-sync-contract.md](../harness-sync-contract.md) for the full list.

### Child-owned package manifest

`package.json` is **child-owned**. Sync adds missing **`bemoat:*` scripts** only and generates **`.bemoat/package-sync-proposal.md`** for recommended scripts such as `build`, `deploy`, `preview`, `check`, and for `dependencies` / `devDependencies`. Humans review and apply package changes manually. `pnpm-lock.yaml` is never synced.

### Merge-keep paths

`.gitignore` keeps existing child ignore rules and appends missing starter entries (including `.bemoat-check-tmp/` and `.bemoat-sync-tmp/`). Child-specific ignore rules are never removed.

### Starter-seed paths

Frontend pages, collections, globals, components, hooks, access helpers, `src/lib`, and `src/payload.config.ts` are copied only when missing. After a child customizes them, sync never overwrites them.

After reviewing the package sync proposal and applying any manual `package.json` changes, run `pnpm install` in the child project.

## After pulling this change

Run these commands locally before serious deployment:

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
```

Then review the generated migration before deploying to Cloudflare D1.
