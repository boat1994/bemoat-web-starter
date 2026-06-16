# ADR 0004: Central guard pack v1 for reusable safety checks

## Status

accepted

## Context

Agents and contributors can accidentally commit secrets, destructive SQL migrations, wrong Cloudflare env bindings, or harness contract violations. Ad-hoc pre-commit checks in each child repo would diverge. CI needs a fast, deterministic baseline that works the same in starter and children.

## Decision

Run reusable safety checks through a **central guard pack** orchestrated by `scripts/guard-pack.mjs`:

| Entrypoint | Audience |
|------------|----------|
| `pnpm run bemoat:guard:safety` | Child CI, pre-push, agents in child repos |
| `pnpm run bemoat:guard:pack` | Explicit alias to the same pack |
| `pnpm run guard:safety` | Starter-internal alias |

**v1 guard coverage:**

- Secret leak and tracked `.env*` (except `.env.example`)
- Destructive SQL in migration `up` sections (unless `bemoat:destructive-migration-approved`)
- Harness contract (no raw scripts in synced CI/pre-push)
- Package manager drift (pnpm-only, `engines.pnpm`)
- Env placeholder hygiene (`.env.example`)
- Cloudflare config isolation (dev vs production bindings)
- Frontend SEO baseline when starter frontend layout exists

Guards have fixtures under `tests/fixtures/guard/` and integration tests under `tests/int/`.

## Consequences

### Positive

- One command (`bemoat:guard:safety`) protects starter and all synced child projects.
- Failures include which guard failed and how to fix (see [guard-pack.md](../guard-pack.md)).
- Docs-only changes can validate with `guard:safety` without full `check`.

### Negative

- v1 has known gaps (no AST-based Payload rename detection, limited workflow scanning). See [guard-pack.md § Known gaps](../guard-pack.md#known-gaps-v1).
- False positives possible; guards exclude `tests/` and markdown from some secret scans.

## Open questions

- When to add required `sitemap.ts` / `robots.ts` checks — **proposed** follow-up when SEO routes are part of starter seed.
