# ADR 0007: Docs and harness tests are durable, synced assets

## Status

accepted

## Context

Agent instructions, guard behavior, and sync contracts change over time. If docs and tests lived only in chat or child-local notes, harness behavior would be undocumented and untested. Child projects need the same integration tests as the starter to catch regressions in guards, sync, and Cloudflare config.

## Decision

Treat **harness documentation and integration tests as first-class durable assets**:

| Asset | Treatment |
|-------|-----------|
| Agent-loop docs (`docs/agent-loop/*`) | Rails-managed; overwritten on sync |
| Contract docs (`docs/harness-sync-contract.md`, `docs/guard-pack.md`, etc.) | Rails-managed |
| ADRs (`docs/adr/*`) | **Not yet in `managedPaths`** — live in starter; child adoption via future sync list update is **proposed** |
| Integration tests (`tests/int/**/*.int.spec.ts`) | Rails-managed; run via `bemoat:test:int` in child CI |
| Vitest harness (`vitest.config.mts`, `vitest.setup.ts`) | Rails-managed |

Validation tiers treat these assets seriously:

- Docs/markdown/CI-only changes: `pnpm run guard:safety`
- Code including scripts and tests: `pnpm run check` (starter) or `bemoat:check` when defined (child)

New harness behavior should ship with **doc updates and int tests**, not code alone.

## Consequences

### Positive

- Sync propagates both the rules and the tests that enforce them.
- CI in child projects runs the same harness tests as the starter baseline.
- Future agents can read ADRs and contract docs instead of inferring from git history.

### Negative

- Doc and test updates add PR overhead — intentional tradeoff for maintainability.
- ADRs are starter-local until added to `managedPaths`; children may not see them until then.

## Open questions

- Add `docs/adr` to `managedPaths` in `scripts/sync-boilerplate.mjs` — **proposed** after this pack is reviewed.
- Whether child-local docs (root `README.md`, product runbooks) should ever sync — **no**; root README stays child-owned per [source-of-truth.md](../agent-loop/source-of-truth.md).
