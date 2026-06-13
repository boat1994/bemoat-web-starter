# Source of truth

This document separates what **`bemoat-web-starter`** owns from what **child projects** own. When in doubt, reusable improvements go **upstream**; customer- or product-specific work stays **downstream**.

## bemoat-web-starter owns

| Area | Examples |
|------|----------|
| Agent rules | `AGENTS.md` |
| Cursor rules | `.cursor/rules/*` |
| GitHub templates | `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/*`, shared workflows |
| Agent-loop docs | `docs/agent-loop/*`, `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/schema-evolution.md` |
| Harness workflow | `scripts/guard-repo-safety.mjs`, `scripts/install-git-hooks.mjs`, `.githooks`, `vitest.config.mts`, `vitest.setup.ts`, harness tests under `tests/int/` |
| Payload schema (shared) | Shared collections and globals (seeded once) |
| Starter UI | Shared starter pages (home, projects, blog, custom order, etc.; seeded once) |
| Shared utilities | Helper modules under `src/lib` (seeded once) |
| Package scripts | Scripts required by the starter (`check`, `check:full`, `guard:safety`, `boilerplate:sync`, `boilerplate:check`, `hooks:install`, etc.) — see [AGENTS.md § Validation](../../AGENTS.md#validation-before-pr-and-merge) for when to run each |
| Sync behavior | `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs`, managed and seed-only path lists |

Child projects receive these via **clone after Cloudflare deploy** (initial) and **`pnpm run boilerplate:sync`** (ongoing updates). Run **`pnpm run boilerplate:check`** first to see rails-managed drift and missing seed files without modifying files. For stable production syncs, pin a **version tag** with `BEMOAT_BOILERPLATE_REF` instead of always using `main`—see [docs/releases.md](../releases.md).

### Always synced by `boilerplate:sync` (rails-managed)

These paths are overwritten on every sync:

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Repository agent instructions |
| `.cursor/rules` | Cursor workflow rules |
| `.github/workflows/ci.yml` | Shared CI workflow |
| `.github/pull_request_template.md` | PR template |
| `.github/ISSUE_TEMPLATE/agent-task.yml` | Agent task issue template |
| `docs/agent-loop` | Agent operating loop docs |
| `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/schema-evolution.md` | Production hardening, releases, smoke test, and schema evolution |
| `scripts/sync-boilerplate.mjs` | Sync script and path lists |
| `scripts/check-boilerplate-drift.mjs` | Read-only drift check before sync |
| `scripts/deploy-smoke-test.mjs` | Optional deploy smoke test helper |
| `scripts/guard-repo-safety.mjs` | Repository safety guard (secrets, resource IDs, destructive migrations) |
| `scripts/install-git-hooks.mjs` | Optional local pre-push harness installer |
| `.githooks` | Optional pre-push hook (`guard:safety`, `typecheck`, `test:int`) |
| `vitest.config.mts`, `vitest.setup.ts` | Integration test harness for workflow rails |
| `tests/int/repo-safety-guard.int.spec.ts`, `tests/int/boilerplate-sync.int.spec.ts`, `tests/int/open-next-config.int.spec.ts` | Harness integration tests |
| `docs/dev-boilerplate.md`, `docs/boilerplate-sync-command.md` | Boilerplate module and sync command notes |
| `package.json` scripts | `check`, `check:full`, `guard:safety`, `typecheck`, `lint`, `test`, `test:int`, generate scripts, `payload`, `boilerplate:sync`, `boilerplate:check`, `smoke:deploy`, `hooks:install` |

`pnpm-lock.yaml` is not synced. After sync, run `pnpm install` in the child project to refresh the local lockfile.

### Seeded once by `boilerplate:sync` (starter app code)

These paths are copied only when missing in the child project. After customization, sync never overwrites them:

| Path | Purpose |
|------|---------|
| `src/app/(frontend)` | Starter frontend pages |
| `src/components` | Shared UI and admin extension placeholders |
| `src/collections`, `src/globals`, `src/hooks`, `src/access` | Payload schema and access helpers |
| `src/lib` | Shared utilities |
| `src/payload.config.ts` | Payload configuration |

`src/app/(payload)` is Payload admin framework integration and is not synced.

## Child projects own

| Area | Examples |
|------|----------|
| Cloudflare Worker config | `wrangler.jsonc` |
| D1 | Database IDs and names for that project |
| R2 | Bucket names for that project |
| Worker identity | Worker name per environment |
| Secrets and env | `.env` files, Cloudflare secrets, env-specific vars |
| Domains | Custom domains and routing for that deployment |
| Customized starter app files | Any seed-only file the child has edited after initial import |
| Business modules | Project-specific features, integrations, operations |
| Customer integrations | LINE, payments, handoff, etc., when not yet in shared boilerplate |
| README | Root `README.md` may be project-specific; adopt starter wording manually if desired |

## Rules

1. **Reusable improvements go upstream** into `bemoat-web-starter`, then flow to children through `boilerplate:sync` (rails) or optional seed import (missing starter files).
2. **Project-specific work stays in child projects**—do not open PRs here for one customer's Worker name or D1 ID.
3. **Do not copy** Cloudflare resource IDs, `.env` files, or secrets across projects. See [security-and-migrations.md](./security-and-migrations.md).
4. **Do not edit rails-managed files in child projects** unless you intend to upstream the same change to this starter; otherwise sync will overwrite or drift.
5. **Do not edit seed-only app files in child projects expecting future boilerplate sync to preserve upstream changes.** Reusable app improvements should be made in the starter, but existing child customizations will not be overwritten automatically. If an upstream seed file changes after child customization, the human decides whether to manually port the improvement.
6. **Real projects start deploy-first** from the README Deploy button; cloning this repo is for developing the starter itself.

## Quick decision guide

| Question | Answer |
|----------|--------|
| Should every Bemoat site get this? | Upstream to starter |
| Only one client needs it? | Child project only |
| Touches `wrangler.jsonc` or D1 ID? | Child project only |
| Fixes shared collection or agent docs? | Starter |
| Child already customized a starter page? | Keep in child; port starter improvements manually if desired |
| Unsure? | Triage with GitHub issue; tag scope in agent-task template |

See also: root [README.md](../../README.md) boilerplate sync sections, [docs/releases.md](../releases.md) for version tags and changelog policy, and [README.md](./README.md) in this folder.
