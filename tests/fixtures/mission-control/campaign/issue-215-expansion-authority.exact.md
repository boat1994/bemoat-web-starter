## FOUNDER_DECISION

**Decision:** APPROVE CAMPAIGN EXPANSION — APPEND SLICES 8–11

**Authority:** Founder
**Campaign:** #215 — Thin facades for oversized harness entrypoints
**Policy:** Mission Control guide 1.3.0
**Effect:** Expand the approved campaign after existing Slice 7. This decision does not alter or restart Slices 1–7 and does not authorize implementation of any new slice.

### Slice 8 — Mission Control command entrypoint facades

Target stable root entrypoints:

- `scripts/mission-control-brainstorming.mjs`
- `scripts/mission-control-dispatch.mjs`
- `scripts/mission-control-review.mjs`
- `scripts/mission-control-merge.mjs`

Bounded objective:

- Extract orchestration, transport parsing, authority checks, command-specific workflow logic, and reporting into cohesive internal modules.
- Preserve each root file as a stable thin CLI/import facade.
- Preserve arguments, environment inputs, stdout/stderr, exit behavior, direct-execution behavior, comment transport, authority gates, idempotency, and fail-closed classifications.

### Slice 9 — Mission Control state and persistence facades

Target stable root entrypoints:

- `scripts/mission-control-state.mjs`
- `scripts/mission-control-issue-body-cas.mjs`

Bounded objective:

- Extract state parsing/serialization, managed-block projection, CAS/lease coordination, conflict detection, retries, and persistence adapters into cohesive internal modules.
- Preserve stable root import surfaces, single-winner semantics, durable-state compatibility, lease/CAS behavior, error classifications, and all existing callers.

Boundary clarification:

- `scripts/mission-control-reconcile.mjs` remains owned by existing Slice 5 and must not be duplicated in Slice 9.

### Slice 10 — Repository and package guard facades

Target stable root entrypoints:

- `scripts/guard-build-script-contract.mjs`
- `scripts/guard-pack.mjs`
- `scripts/guard-package-manager.mjs`

Bounded objective:

- Extract package/build inventory, validation rules, diagnostics, and command orchestration into cohesive internal guard modules.
- Preserve rule IDs, evaluation order, messages, exports, CLI behavior, package-script contracts, and exit codes.

### Slice 11 — Environment and policy guard facades

Target stable root entrypoints:

- `scripts/guard-cloudflare-env.mjs`
- `scripts/guard-env-placeholder.mjs`
- `scripts/guard-frontend-seo.mjs`
- `scripts/guard-mission-control-drift.mjs`

Bounded objective:

- Extract environment inventory, placeholder detection, SEO policy checks, Mission Control drift checks, diagnostics, and command orchestration into cohesive internal guard modules.
- Preserve rule IDs, deterministic ordering, messages, public exports, CLI behavior, and exit classifications.

### Shared invariants for Slices 8–11

- Root files remain stable thin facades; moving files out of `scripts/` root is not required.
- Characterization-first and TDD.
- One independently revertible Task Issue and implementation PR per slice.
- Each slice requires its own planning RESULT, separate Founder implementation approval, bounded review, and separate Founder merge gate.
- Preserve all public imports, package-script aliases, CLI contracts, diagnostics, ordering, authority behavior, child portability, and runtime-delivery ownership.
- Update `scripts/architecture-contract.json` only when required by the approved slice plan; no dependency-cycle retirement outside Slice 6.
- Simulation only for child portability; no real child sync.

### Explicitly not authorized by this decision

- Starting Slice 8–11 now
- Changing the active Slice 4 merge-completion path
- Renumbering or rewriting Slices 1–7
- Merging PR #253
- Real child sync
- Finance #92
- Deployment, migration, production access, or retained-data mutation

### Next durable action

After Slice 4 merge-completion is finished, reconcile Campaign #215 durable campaign state to append Slice rows 8–11 as `NOT_STARTED` and update the milestone exit criteria/root-entrypoint inventory without starting Slice 5 or any appended slice.
