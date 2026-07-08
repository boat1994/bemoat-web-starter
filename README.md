# Bemoat Web Starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)

A reusable Payload 3, Next.js, and Cloudflare starter for Bemoat projects. This repository is the **source of truth** for shared CMS schema, starter pages, agent rules, CI patterns, sync behavior, and harness docs.

Real product repositories should start from the **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)** button, then clone the generated child project — not this starter directly.

## What this repo is

- Payload 3 CMS with Cloudflare D1 and R2
- Next.js app router frontend deployed through OpenNext on Cloudflare Workers
- Generic project and blog CMS modules, site globals, and Thai/English localization
- Agent workflow rails, safety guards, GitHub templates, and CI patterns
- One-command harness sync for child projects

Clone this repository **only** when improving `bemoat-web-starter` itself (shared collections, starter pages, CI, agent docs, sync scripts).

## When to change starter vs child project

| Change | Where it belongs |
| --- | --- |
| Reusable agent rules, guards, CI, sync scripts, harness docs | **This starter** → sync to children with `bemoat:boilerplate:sync` |
| Shared Payload collections, starter pages, starter utilities | **This starter** (seeded once into new children) |
| `wrangler.jsonc`, D1 IDs, R2 bucket names, Worker names | **Child project** |
| `.env` files, Cloudflare secrets, domains, customer integrations | **Child project** |
| Product-specific schema, frontend, and business logic | **Child project** |

Full ownership boundaries: [docs/agent-loop/source-of-truth.md](./docs/agent-loop/source-of-truth.md).

## Agent workflow quick start

For issue-based work, run preflight **before any file edit**:

```bash
pnpm run bemoat:agent:issue -- <issue-number>
```

High-level loop:

```text
read issue → preflight → branch setup if needed → rerun preflight → summarize intent → wait for human trigger → implement → validate → AC audit/report → PR
```

Key rules:

- Stop on a dirty working tree with unrelated changes.
- Never edit `main` directly. Do not routine-code on `dev`.
- If preflight fails only because you are on a clean protected branch, create a topic branch and rerun preflight.
- After preflight passes, summarize scope and wait for an explicit human trigger (`proceed`, `continue`, `start dev`, etc.) before editing files.
- Agents may commit, push, and open PRs; humans merge.

Paste-ready agent prompt: [docs/agent-loop/composer-issue-workflow-prompt.md](./docs/agent-loop/composer-issue-workflow-prompt.md).

## Branch and PR policy

| Repository | Integration branch | Topic branches from | PR target |
| --- | --- | --- | --- |
| **This starter** (bootstrap) | `main` (no `dev` yet) | `main` | `main` — call out the bootstrap exception in the PR |
| **Child projects** (normal) | `dev` | `dev` | `dev` |

Branch naming: `<type>/<issue-number>-<short-slug>` (for example `docs/92-refresh-readme-docs`).

Allowed prefixes: `feature/*`, `feat/*`, `fix/*`, `refactor/*`, `chore/*`, `test/*`, `docs/*`, `release/*`, `hotfix/*`.

Full policy: [docs/workflow/git-flow.md](./docs/workflow/git-flow.md) and [docs/agent-loop/issue-driven-branch-workflow.md](./docs/agent-loop/issue-driven-branch-workflow.md).

## Child project harness sync

Child projects receive starter harness updates through **explicit sync** — not by editing this repo in place.

```bash
# In a child project (from latest dev)
pnpm run bemoat:boilerplate:check -- --harness-only
pnpm run bemoat:boilerplate:sync -- --harness-only
```

- **`harness-only`** (default): agent rules, CI, guards, sync scripts, harness tests — does not overwrite child app code.
- **`full`**: also seeds missing starter modules once for new projects.

`package.json` stays child-owned. Sync adds missing `bemoat:*` scripts only and writes `.bemoat/package-sync-proposal.md` for human review.

Pin a release tag for safer production syncs: `BEMOAT_BOILERPLATE_REF=v0.3.0-sync-rails`.

Deeper guides:

- [docs/harness-sync-contract.md](./docs/harness-sync-contract.md)
- [docs/agent-loop/harness-sync-workflow.md](./docs/agent-loop/harness-sync-workflow.md)
- [docs/boilerplate-sync-command.md](./docs/boilerplate-sync-command.md)

## Validation

| Change type | Command (starter) | Command (child) |
| --- | --- | --- |
| Docs, markdown, or CI config only | `pnpm run guard:safety` | `pnpm run bemoat:guard:safety` |
| Code, scripts, or tests | `pnpm run check` | `pnpm run bemoat:check` when defined; otherwise `bemoat:guard:safety` + `bemoat:test:int` |
| Payload schema changes | `pnpm run check` + `generate:types` | Same child tier + child `generate:types` |
| D1 or Payload migrations | Same as triggering change; open a **draft** PR | Same |

Every GitHub PR runs child-safe CI (`bemoat:guard:safety`, `bemoat:test:int`). The starter also runs [strict CI](./.github/workflows/ci-starter.yml).

Optional local hooks: `pnpm run hooks:install` (branch safety + fast `bemoat:*` subset on pre-push).

## Source-of-truth docs

| Topic | Doc |
| --- | --- |
| Agent entrypoint | [AGENTS.md](./AGENTS.md) |
| Working loop and checklist | [docs/agent-loop/README.md](./docs/agent-loop/README.md) |
| Issue-driven branches | [docs/agent-loop/issue-driven-branch-workflow.md](./docs/agent-loop/issue-driven-branch-workflow.md) |
| Starter vs child ownership | [docs/agent-loop/source-of-truth.md](./docs/agent-loop/source-of-truth.md) |
| Harness sync contract | [docs/harness-sync-contract.md](./docs/harness-sync-contract.md) |
| Git Flow guardrails | [docs/workflow/git-flow.md](./docs/workflow/git-flow.md) |
| Production schema evolution | [docs/schema-evolution.md](./docs/schema-evolution.md) |
| Security and migrations | [docs/agent-loop/security-and-migrations.md](./docs/agent-loop/security-and-migrations.md) |
| Cloudflare environments | [docs/cloudflare-environments.md](./docs/cloudflare-environments.md) |
| Releases and sync tags | [docs/releases.md](./docs/releases.md) |
| Operational notes | [docs/knowledge/README.md](./docs/knowledge/README.md) |

## Recommended project flow (deploy-first)

1. Click **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)**.
2. Let Cloudflare provision Worker, D1, R2, and secrets for the new project.
3. Clone the **generated child repository** locally.
4. Run local setup:

```bash
pnpm install
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
pnpm dev
```

5. Review migrations, test locally, then deploy with `pnpm run deploy`.

Configure project-specific values in the child repo: `wrangler.jsonc`, D1/R2 bindings, domains, and environment variables. Do not copy one project's Cloudflare resource IDs into another.

## Developing this starter

```bash
git clone https://github.com/boat1994/bemoat-web-starter.git
cd bemoat-web-starter
pnpm install
pnpm dev
```

## Local setup and deploy

```bash
pnpm install
pnpm wrangler login
pnpm dev
```

Cloudflare deploy button commands:

```text
Build command: pnpm run build
Deploy command: pnpm run deploy
```

| Target | Command |
| --- | --- |
| Production | `pnpm run deploy` |
| Dev stack (isolated Worker/D1/R2) | `pnpm run deploy:dev` |

After Payload schema or admin component changes:

```bash
pnpm run generate:importmap
pnpm run generate:types
```

Before deploying schema changes to D1:

```bash
pnpm payload migrate:create
```

Post-deploy smoke test: [docs/deploy-smoke-test.md](./docs/deploy-smoke-test.md).

## What's included

**Core CMS:** Users, Media, BlogMedia, Projects, Categories, Tags, Posts, BlogCategories.

**Globals:** SiteSettings, CustomOrderPage.

**Not included yet:** Orders, LINE integration, payment slip review, Copilot, handoff workflow — add these as separate layers when stable.

## Useful commands

```bash
pnpm dev
pnpm run build
pnpm run preview
pnpm run deploy
pnpm run deploy:dev
pnpm run generate:importmap
pnpm run generate:types
pnpm payload migrate:create
pnpm run boilerplate:sync
pnpm run smoke:deploy
```

Set `BEMOAT_SMOKE_BASE_URL` when running the optional smoke script.

## Troubleshooting

**`Unknown command: build`** — use the universal wrapper in `scripts/build.mjs`; do not use `payload build`.

**Admin field component not found** — run `pnpm run generate:importmap`.

**Stale Payload types** — run `pnpm run generate:types`.

**D1 schema drift** — run `pnpm payload migrate:create`, review the migration, then deploy.
