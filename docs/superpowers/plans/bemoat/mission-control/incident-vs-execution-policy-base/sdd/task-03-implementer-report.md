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
- The only authorized hotfix execution branch is the exact
  `hotfix/incident-vs-execution-policy-base` branch, and it must have observed
  ancestry from the trusted protected execution SHA.

Independent review is required before Task 3 can advance in the ledger.

## Fix round 1 — reviewer P1 corrections

The Task 3 reviewer reported two blocking findings against commit
`d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`:

1. Checkout identity was synthesized from the requested policy SHA rather than
   observed from the executing checkout.
2. Child overrides were checked with bypassable prose regexes.

P1-1 is corrected by requiring an injected `readExecutingCheckout` evidence
source. The production dependency now observes `git rev-parse HEAD`, the
symbolic branch, clean working-tree status, `git merge-base` ancestry, and
required recovery implementation paths. The workflow accepts either exact
protected `main@execution_policy_sha` or only the explicitly authorized
`hotfix/incident-vs-execution-policy-base` branch whose observed merge base is
the trusted execution SHA. Self-declared policy metadata is no longer used as
checkout authority. Tests cover mismatched HEAD, unrelated hotfix rejection,
and the authorized hotfix success case.

P1-2 is corrected with a closed-world YAML override parser. Only the documented
project-specific override keys and value shapes are accepted; duplicate,
malformed, unknown, nested unsupported, and structured relaxing declarations
fail closed. Tests cover `allow_auto_merge: true`,
`remove_exact_head_checks: true`, `minor_nit_blocking: true`,
`allow_destructive_migrations: true`, `chat_history_authoritative: true`, and
`allow_silent_state_reset: true`, plus malformed YAML. Every negative case
asserts zero comment posts and zero Issue-body writes.

Fix-round validation:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 19 passed, including the former divergent-base success and both P1
    matrices.
- `pnpm exec vitest run tests/int/mission-control-issue-body-cas.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts`
  - 83 passed.
- Targeted ESLint, typecheck, `pnpm run guard:safety`,
  `pnpm run guard:mission-control-contract`, `ReadLints`, and `git diff --check`
  - Passed with no linter errors.

Fix-round correction commit: pending. Task 3 remains `in_progress`; no live
recovery or external mutation was performed.

## Fix round 2 — residual array-value typing

Task 3 re-review round 1 left P1-2 open because scalar and `null` values for
the array-typed keys `required_checks`, `manual_qa`, and `protected_paths`
could bypass the object-branch validation.

The validator now checks array-key shape before all other value handling:
each such key must be a non-null array whose every element is a string.
Scalars, `null`, objects, and arrays containing non-string elements fail closed
with zero comment posts and zero Issue-body writes. Focused tests cover scalar,
`null`, object, and wrong-element-shape values.

Fix-round 2 validation:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 19 passed.
- Targeted ESLint, `pnpm run guard:safety`, `ReadLints`, and
  `git diff --check`
  - Passed.

Fix-round 2 correction commit: pending. Task 3 remains `in_progress`; P1-1
checkout identity was not changed or reopened. No live recovery or external
mutation was performed.
