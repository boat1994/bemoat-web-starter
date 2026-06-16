# Architecture overview

## Stack

- **Payload 3** CMS (collections, globals, admin)
- **Next.js** App Router (`src/app/(frontend)` public site, `src/app/(payload)` admin)
- **Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`)
- **D1** (SQLite) for Payload data; **R2** for media

Check current versions in root `package.json`.

## Two repos in practice

| Repo | Purpose |
|------|---------|
| **`bemoat-web-starter`** | Reusable harness, shared schema seed, agent rules, sync scripts |
| **Child project** | Deploy button output; owns Cloudflare resources and product customizations |

Real customer/product work starts from the [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter) button, then clone the **generated** repo — not this starter directly.

## Reusable vs product-specific

| Reusable (upstream to starter) | Product-specific (child only) |
|--------------------------------|------------------------------|
| `AGENTS.md`, `.cursor/rules`, harness docs | `wrangler.jsonc`, D1/R2/Worker names |
| Guards, CI workflow, `tests/int/*` harness | `.env`, secrets, domains |
| Shared collections/globals (seed) | Customized seed files after child edits |
| `bemoat:*` script contract | Customer integrations, one-off features |

**Rule:** If every Bemoat site should get it → starter. If only one client needs it → child.

## Sync boundaries (short)

- **Rails-managed** (`managedPaths`): overwritten on sync — agent rules, child-safe CI, guards, harness tests.
- **Seed-only** (`seedOnlyPaths`): copied only in `--full` mode when missing — frontend, collections, `payload.config.ts`.
- **Merge-keep** (`mergeKeepPaths`): `.gitignore` — child rules kept, missing starter rules appended.
- **`package.json`**: child-owned; sync adds missing `bemoat:*` only.

Full tables: [source-of-truth.md](../agent-loop/source-of-truth.md), [harness-sync-contract.md](../harness-sync-contract.md).

## ADRs

Decision summaries: [adr/README.md](../adr/README.md). Start with [ADR 0001](../adr/0001-starter-source-of-truth.md) (source of truth).
