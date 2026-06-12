# Source of truth

This document separates what **`bemoat-web-starter`** owns from what **child projects** own. When in doubt, reusable improvements go **upstream**; customer- or product-specific work stays **downstream**.

## bemoat-web-starter owns

| Area | Examples |
|------|----------|
| Agent rules | `AGENTS.md` |
| Cursor rules | `.cursor/rules/*` |
| GitHub templates | `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/*`, shared workflows |
| Agent-loop docs | `docs/agent-loop/*` |
| Payload schema (shared) | Shared collections and globals |
| Starter UI | Shared starter pages (home, projects, blog, custom order, etc.) |
| Shared utilities | Helper modules synced by boilerplate |
| Package scripts | Scripts required by the starter (`check`, `check:full`, `boilerplate:sync`, etc.) |
| Sync behavior | `scripts/sync-boilerplate.mjs` and managed path list |

Child projects receive these via **clone after Cloudflare deploy** (initial) and **`pnpm run boilerplate:sync`** (ongoing updates). For stable production syncs, pin a **version tag** with `BEMOAT_BOILERPLATE_REF` instead of always using `main`—see [docs/releases.md](../releases.md).

### Synced by `boilerplate:sync`

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Repository agent instructions |
| `.cursor/rules` | Cursor workflow rules |
| `.github/workflows/ci.yml` | Shared CI workflow |
| `.github/pull_request_template.md` | PR template |
| `.github/ISSUE_TEMPLATE/agent-task.yml` | Agent task issue template |
| `docs/agent-loop` | Agent operating loop docs |
| `scripts/sync-boilerplate.mjs` | Sync script and managed path list |
| `docs/dev-boilerplate.md` | Boilerplate module notes |
| Frontend starter pages | Home, projects, blog, custom order |
| Payload shared schema | Collections, globals, `payload.config.ts` |
| Shared utilities | e.g. `src/lib/payloadText.ts` |
| `package.json` scripts | `check`, `check:full`, `typecheck`, `lint`, `test`, `test:int`, generate scripts, `payload`, `boilerplate:sync` |

`pnpm-lock.yaml` is not synced. After sync, run `pnpm install` in the child project to refresh the local lockfile.

## Child projects own

| Area | Examples |
|------|----------|
| Cloudflare Worker config | `wrangler.jsonc` |
| D1 | Database IDs and names for that project |
| R2 | Bucket names for that project |
| Worker identity | Worker name per environment |
| Secrets and env | `.env` files, Cloudflare secrets, env-specific vars |
| Domains | Custom domains and routing for that deployment |
| Business modules | Project-specific features, integrations, operations |
| Customer integrations | LINE, payments, handoff, etc., when not yet in shared boilerplate |
| README | Root `README.md` may be project-specific; adopt starter wording manually if desired |

## Rules

1. **Reusable improvements go upstream** into `bemoat-web-starter`, then flow to children through `boilerplate:sync`.
2. **Project-specific work stays in child projects**—do not open PRs here for one customer's Worker name or D1 ID.
3. **Do not copy** Cloudflare resource IDs, `.env` files, or secrets across projects.
4. **Do not edit sync-managed files in child projects** unless you intend to upstream the same change to this starter; otherwise sync will overwrite or drift.
5. **Real projects start deploy-first** from the README Deploy button; cloning this repo is for developing the starter itself.

## Quick decision guide

| Question | Answer |
|----------|--------|
| Should every Bemoat site get this? | Upstream to starter |
| Only one client needs it? | Child project only |
| Touches `wrangler.jsonc` or D1 ID? | Child project only |
| Fixes shared collection or agent docs? | Starter |
| Unsure? | Triage with GitHub issue; tag scope in agent-task template |

See also: root [README.md](../../README.md) boilerplate sync sections, [docs/releases.md](../releases.md) for version tags and changelog policy, and [README.md](./README.md) in this folder.
