# Bemoat Web Starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)

Bemoat Web Starter is a reusable, production-ready web foundation and AI-agent development harness. It provides a complete, modern technology stack deployed to the edge, paired with rigorous agent-coordination rails (Mission Control) to build, review, and evolve real products safely.

## The Problem It Solves

Building and maintaining real-world applications with AI agents often degrades into fragile, unreviewed code, state conflicts, or prompt drift. Bemoat solves this by separating the immutable **starter harness** (which provides workflow rails, schema, CI, and safety guards) from the **child project** (which owns the business logic and cloud resources). 

With Bemoat, you can:
- **Build faster:** Start with a fully-configured CMS, database, and frontend.
- **Operate safely:** Rely on deterministic, multi-role AI agent coordination (Mission Control).
- **Evolve continuously:** Sync upstream workflow and safety improvements to existing projects without overwriting custom app code.

## The Stack: Next.js + Payload 3 + Cloudflare

Bemoat is built on a scalable, edge-native stack:
- **Payload 3 CMS:** A headless TypeScript CMS backed by Cloudflare D1 (SQLite at the edge) and Cloudflare R2 (object storage).
- **Next.js App Router:** A React frontend deployed through OpenNext on Cloudflare Workers.
- **Core Modules Included:** Pre-built project and blog CMS modules, site globals, and Thai/English localization out of the box.

## The Bemoat Agent & Mission Control Harness

Bemoat is designed for AI-driven development. It embeds a complete workflow harness directly in the repository:
- **Mission Control Coordination:** Bounded tasks, deterministic role handoffs (Dev, Reviewer, Founder), and strict review cycles to prevent infinite agent loops.
- **Durable GitHub State:** The single source of truth is GitHub (issues, PRs, comments), not chat memory.
- **Safety Rails & CI:** Built-in repository safety guards, Cloudflare environment guards, and Git Flow protections to prevent destructive operations.

## How to Start a New Project

Real product repositories should start from the Cloudflare deployment, not by cloning this starter directly.

1. Click **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)** to provision your Worker, D1, R2, and secrets.
2. Clone the **generated child repository** locally.
3. Run local setup:
   ```bash
   pnpm install
   pnpm run generate:importmap
   pnpm run generate:types
   pnpm payload migrate:create
   pnpm dev
   ```
4. Review migrations, test locally, and deploy (`pnpm run deploy`).

*(Clone this `bemoat-web-starter` repository directly **only** if you are improving the starter boilerplate itself).*

## Starter vs. Child Repositories

| What | Where it belongs | Sync Behavior |
|------|------------------|---------------|
| Agent rules, CI, safety guards, sync scripts | **This starter** | Updates flow to children via `bemoat:boilerplate:sync` |
| Shared Payload collections, starter pages | **This starter** | Seeded once into new children; manually ported thereafter |
| `wrangler.jsonc`, D1 IDs, R2 bucket names | **Child project** | Child-owned; never overwritten |
| `.env` files, secrets, customer logic | **Child project** | Child-owned; never overwritten |

Child projects pull upstream harness updates using:
```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```
See [Source of Truth](docs/agent-loop/source-of-truth.md) for detailed boundaries.

## Detailed Operational Documentation

For deep-dive documentation on workflows, policies, and operations, refer to the source-of-truth docs:

### Agent & Workflow
- **[Agent Entrypoint (AGENTS.md)](AGENTS.md)**
- **[Agent Loop & Checklist](docs/agent-loop/README.md)**
- **[Issue-Driven Branch Workflow](docs/agent-loop/issue-driven-branch-workflow.md)**
- **[Mission Control Guide](docs/mission-control/mission-control-guide.md)**
- **[Git Flow Guardrails](docs/workflow/git-flow.md)**

### Architecture & Operations
- **[Harness Sync Contract](docs/harness-sync-contract.md)**
- **[Production Schema Evolution](docs/schema-evolution.md)**
- **[Security and Migrations](docs/agent-loop/security-and-migrations.md)**
- **[Cloudflare Environments](docs/cloudflare-environments.md)**
- **[Releases and Sync Tags](docs/releases.md)**
