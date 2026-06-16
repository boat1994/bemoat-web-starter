# ADR 0003: Harness sync is narrow, explicit, and list-driven

## Status

accepted

## Context

`boilerplate:sync` could copy the entire starter into child projects. That would overwrite customized Payload schema, frontend pages, and Cloudflare config. Child repos also need different `package.json` scripts and dependencies.

A vague "sync everything reusable" policy causes data loss and merge conflicts.

## Decision

Harness sync is **narrow and explicit**:

1. **List-driven paths** — Only paths in `managedPaths`, `mergeKeepPaths`, and (in full mode) `seedOnlyPaths` in `scripts/sync-boilerplate.mjs` are touched. New harness files must be added to these lists and covered by drift/sync tests.

2. **Default `harness-only` mode** — Syncs rails (agent docs, guards, CI, harness tests) and **skips** starter app modules (`src/collections`, `src/app/(frontend)`, `payload.config.ts`, etc.). Use `--full` only when seeding missing starter files in new projects.

3. **Child-owned manifest** — `package.json` is never overwritten. Sync adds **missing** `bemoat:*` scripts only. Non-namespaced scripts and dependencies appear in `.bemoat/package-sync-proposal.md` for human review.

4. **Never synced** — `wrangler.jsonc`, `pnpm-lock.yaml`, `.env`, secrets, resource IDs, and root `README.md`.

## Consequences

### Positive

- Existing production projects can adopt harness updates without schema or frontend overwrites.
- Drift check (`boilerplate:check`) gives a read-only report before sync.
- Explicit lists make sync behavior reviewable in PRs.

### Negative

- Every new shared harness file requires a maintainer checklist (managedPaths, tests, docs).
- Package script and dependency alignment stays manual in child projects.

## Open questions

- Whether additional merge-keep paths beyond `.gitignore` are needed — **proposed**; only `.gitignore` is merge-keep today.
