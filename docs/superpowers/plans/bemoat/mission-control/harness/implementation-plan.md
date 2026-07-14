# Mission Control Harness — Implementation Plan

> Execution artifact for [issue #107](https://github.com/boat1994/bemoat-web-starter/issues/107).
> Cursor plan: Mission Control Harness (do not edit the `.cursor/plans` file from this branch).

**Goal:** Sync-managed Mission Control policy, thin ChatGPT loader, durable Issue state, guard + tests.

**Branch:** `feature/107-mission-control-harness` from `main` (bootstrap: PR targets `main`).

**Tasks:** A policy/templates → B state + issue template → C sync → D guard/tests → E docs/PR.

**Validation:** `pnpm run check` plus focused Mission Control / sync / guard-pack vitest specs.

**Out of this PR:** Bogus harness sync, ChatGPT dogfood, Bogus review-history migration.
