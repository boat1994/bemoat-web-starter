# Task 3 Implementer Report — Load Policy From Execution Policy SHA

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

Task 3 remains `in_progress` in the durable ledger. This implementer did not
mark the task complete and did not push the branch.

## Scope and implementation

The recovery workflow now keeps the two base identities independent:

- `incident_base_sha` is used only for PR #275 `baseRefOid` historical
  lineage validation.
- `execution_policy_sha` is compared only with the live protected `main` tip.
- `readPolicySource` is called only after that protected-tip check and receives
  the verified `execution_policy_sha`, never the incident base or moving
  `main`.
- `policy_source_sha` remains the separate guide Contents/blob identity.

Policy evidence loaded at the execution SHA must include the canonical current
guide, current accepted version, exact execution checkout binding, recovery
facade, recovery workflow, and registered recovery transport entry. The
workflow also validates the current guide invariants and rejects child
overrides that relax shared requirements. Production policy loading reads all
required files at the exact commit and treats the child override as optional
only when GitHub confirms it is absent.

## TDD and validation evidence

The pre-fix focused run was intentionally red:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 7 failures, including the former expected
    `STATE_CONFLICT: protected base SHA differs from the recovery record` on
    the divergent incident/execution success assertion.

After the workflow change:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 15 passed.
- `pnpm exec vitest run tests/int/mission-control-issue-body-cas.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts`
  - 83 passed.
- Negative coverage passes fail-closed for:
  1. incident-base drift;
  2. untrusted execution-policy SHA;
  3. missing recovery facade at the execution SHA;
  4. current guide-version and policy-source mismatches;
  5. policy evidence sourced from the historical incident base; and
  6. a relaxed child override.
  All negative cases assert zero comment posts and zero Issue-body writes.
- `PAYLOAD_SECRET=ci-validation-placeholder pnpm run check`
  - 54 test files and 1,142 tests passed; safety guard, lint, typecheck, and
    integration tests passed.
- `pnpm exec eslint scripts/mission-control/workflows/recover-review.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  - Passed.
- `pnpm run guard:safety`, `pnpm run guard:mission-control-contract`,
  `pnpm run branch:check`, and `git diff --check`
  - Passed.
- `ReadLints` on edited workflow, test, and SDD files
  - No linter errors.

The first unqualified `pnpm run check` was not a code failure: its API setup
stopped because `PAYLOAD_SECRET` was unset. The documented CI placeholder
rerun above passed.

## Changed files

Production and tests:

- `scripts/mission-control/workflows/recover-review.mjs`
- `tests/int/mission-control-recover-review.int.spec.ts`

Task 3 SDD handoff:

- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-03-brief.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-03-implementer-report.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/progress-ledger.md`

Retained Task 2 review trail included in the local delivery:

- `sdd/task-02-review-package.md`
- `sdd/task-02-review.md`

## Commit and prohibited actions

Commit: pending the single focused local Task 3 commit containing this report.

No live `bemoat:mission-control:recover-review` command was run. No Issue
#274/#275/#276, Campaign #215 Slice 5, child project, deployment, migration,
production, or retained data was mutated. Task 4 was not started.

## Concerns and handoff

- Task 4's broader pinned projection/idempotency expansion remains pending.
- Live GitHub recovery behavior remains unexecuted by design.
- The accepted guide version is intentionally pinned to `1.3.0`; a future
  policy version or execution transport change should fail closed until
  reviewed.
- The current transport models execution on protected `main`; no new hotfix
  execution branch route was introduced.

Independent review is required before Task 3 can advance in the ledger.
