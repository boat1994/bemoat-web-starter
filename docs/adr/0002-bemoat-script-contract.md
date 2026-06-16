# ADR 0002: Child-facing automation uses `bemoat:*` scripts only

## Status

accepted

## Context

Child projects own `package.json`. They may define `lint`, `typecheck`, `build`, `deploy`, and other scripts at different times or not at all. Synced CI (`.github/workflows/ci.yml`) and optional pre-push hooks (`.githooks/pre-push`) are copied to every child project.

If synced automation called raw script names (`check`, `lint`, `guard:safety`), CI would fail in repos that have not adopted those scripts yet. Starter-internal names (`guard:safety`) also differ from the child-facing API.

## Decision

**`bemoat:*` is the public harness API** for child-facing automation.

Synced CI and pre-push call only:

- `pnpm run bemoat:guard:safety`
- `pnpm run bemoat:test:int`

`scripts/guard-harness-contract.mjs` enforces this on child-facing paths. Human-facing templates (PR template, issue template) may mention raw scripts as local developer instructions — they are not scanned.

Raw scripts (`lint`, `typecheck`, `build`, `deploy`, `check`, `guard:safety`, etc.) remain starter-internal or child-local. The starter itself runs stricter validation via `ci-starter.yml` and `pnpm run check`.

## Consequences

### Positive

- Synced CI works in minimal child repos that only have namespaced harness scripts added by sync.
- One stable entrypoint (`bemoat:guard:safety`) maps to the central guard pack regardless of internal refactors.
- Contract is testable (`tests/int/harness-contract-guard.int.spec.ts`).

### Negative

- Maintainers must add new child-facing scripts under `bemoat:*` and update `managedPackageScripts` in `scripts/sync-boilerplate.mjs`.
- Child projects that want lint/typecheck in CI must wire it themselves — sync does not add non-namespaced scripts automatically.

## Open questions

- Whether a future `bemoat:check` should become the default synced CI step once most child projects define `lint` and `typecheck` — **proposed**, not current behavior.
