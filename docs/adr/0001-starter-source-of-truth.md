# ADR 0001: Starter as source of truth for reusable infrastructure

## Status

accepted

## Context

Bemoat runs multiple Payload + Next.js + Cloudflare projects. Each child project needs its own Worker names, D1 IDs, R2 buckets, secrets, and customer-specific features. Without a single upstream repo, agent rules, guards, CI patterns, and shared schema drift across projects.

Real child projects are created **deploy-first** via the Cloudflare Deploy button, not by cloning `bemoat-web-starter` directly. The starter exists to develop and publish reusable infrastructure that flows downstream through `pnpm run boilerplate:sync`.

## Decision

**`bemoat-web-starter` is the source of truth** for reusable Bemoat web project infrastructure:

- Agent rules (`AGENTS.md`, `.cursor/rules`)
- Harness workflow (guards, sync scripts, CI templates, integration tests)
- Shared Payload schema and starter UI (seeded once in new projects)
- Agent-loop and hardening documentation

Child projects own project-specific infrastructure: `wrangler.jsonc`, D1/R2 IDs, Worker names, `.env`, secrets, domains, and customized app code.

Reusable improvements go **upstream** into the starter; customer-specific work stays in child repos.

## Consequences

### Positive

- One place to fix guards, agent rules, and harness behavior for all Bemoat sites.
- Clear ownership boundary reduces accidental copying of Cloudflare resource IDs across projects.
- Child projects can pull rails without re-merging entire codebases.

### Negative

- Child customizations to rails-managed files are overwritten on sync unless upstreamed.
- Seed-only app files (`src/collections`, frontend pages, etc.) are not auto-updated after child customization — humans port improvements manually.

## Open questions

- None for this decision. See [source-of-truth.md](../agent-loop/source-of-truth.md) for path-level tables.
