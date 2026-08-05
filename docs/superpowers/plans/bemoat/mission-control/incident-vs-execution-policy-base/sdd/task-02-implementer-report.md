# Task 2 Implementer Report — Separate Recovery Bindings

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "hotfix-incident-vs-execution-policy-base"
task_issue_strategy: "create_before_execution"
active_task_issue: null
branch_template: "hotfix/incident-vs-execution-policy-base"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "ce8d67b19c6c5d210024434f532dcc32ebdc6daf"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: "docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/implementation-plan.md"
```
<!-- bemoat-task-identity:end -->

## Status

`PASS_FOR_REVIEW`

Task 2 remains `in_progress` in the durable ledger. It is ready for independent
review; this implementer did not mark the task complete.

## Scope and implementation

The recovery domain now uses schema/receipt version 2 with two required,
independent full-SHA bindings:

- `incident_base_sha` — historical PR #275 base identity.
- `execution_policy_sha` — protected execution-policy commit identity.

`policy_source_sha` remains the independent merged-guide source identity. The
domain does not compare the two base fields for equality. Canonical record
serialization and the `transition_identity_sha256` digest include both fields,
so changing either binding changes the transition identity.

Receipt parsing/rendering now uses the v2 marker and JSON fence. The shared
evidence detector rejects malformed v2 receipts and legacy v1 marker receipts
before quarantining evidence. `validateRecoveryRecord` rejects missing or
short bindings and explicitly rejects any ambiguous `protected_base_sha`.
`buildRecoveryRecord` also refuses legacy input rather than silently dropping
or reinterpreting it.

The pinned integration fixture now builds and asserts the two explicit fields.
It retains the divergent incident/execution values and all existing source,
lineage, finding, counter, managed-state, and exact-head evidence. New tests
cover divergent round-trip parsing, lowercase normalization, independent
identity changes, missing-field rejection, and legacy receipt rejection.

## Validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "round-trips|rejects missing|quarantines"`
  - Passed: 3 focused Task 2 tests.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "recovery record|receipt|identity|quarantines"`
  - Passed: 2 matching domain/quarantine tests.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 8 passed, 1 expected failure.
  - The sole failure is the intentionally deferred Task 3 end-to-end assertion,
    which still reaches `STATE_CONFLICT: protected base SHA differs from the
    recovery record` in `scripts/mission-control/workflows/recover-review.mjs`.
  - No Task 2 domain/receipt test failed.
- `pnpm exec eslint scripts/mission-control/domain/review-recovery.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  - Passed.
- `pnpm run lint`
  - Passed with zero warnings.
- `pnpm run typecheck`
  - Passed.
- `pnpm run guard:mission-control-contract`
  - Passed.
- `pnpm run guard:safety`
  - Passed, including planning-contract identity markers.
- `git diff --check`
  - Passed.
- `ReadLints` on changed production, test, and SDD files
  - No linter errors.

The full `pnpm run check` was not claimed as passing because the focused suite
contains the intentionally red Task 3 workflow assertion. Task 3 must split the
workflow’s PR incident-base and protected execution-policy checks before that
suite can become fully green.

## Changed files

Production and tests:

- `scripts/mission-control/domain/review-recovery.mjs`
  - Versioned the recovery schema and marker.
  - Added independent binding validation, canonical construction,
    serialization, receipt parsing, and legacy rejection.
  - Preserved the existing evidence/quarantine contract.
- `tests/int/mission-control-recover-review.int.spec.ts`
  - Added Task 2 domain/receipt/identity/legacy tests.
  - Updated the pinned fixture to use both bindings.
  - Added explicit collection typing needed for repository typecheck.

Durable SDD handoff:

- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-02-brief.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-02-implementer-report.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/progress-ledger.md`
- Existing Task 1 implementer/reviewer artifacts were retained and given the
  required identity markers:
  `task-01-brief.md`, `task-01-implementer-report.md`,
  `task-01-review-package.md`, and `task-01-review.md`.

## Legacy handling and handoff

Legacy v1 receipts/records with only `protected_base_sha` fail closed. They are
not migrated, inferred, or accepted as either new binding. Task 3 must consume
the two new fields by validating PR `baseRefOid` against `incident_base_sha`,
the live protected ref against `execution_policy_sha`, and the policy guide at
the exact verified execution SHA. No live recovery command was run.

Commit: the single local Task 2 commit containing this report, resolved as the
branch `HEAD` at handoff.
