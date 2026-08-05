# Task 3 Brief — Load Policy From Execution Policy SHA

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

## Task identity

- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Starting protected base: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Task status: `in_progress`; this implementer must not mark Task 3 complete.

## Goal

Correct recovery policy loading so the workflow uses the independently
validated `execution_policy_sha` as the only canonical policy commit. The
historical `incident_base_sha` remains exclusively the PR #275 lineage binding.
The two valid SHAs may differ and must never be required to be equal.

## Required behavior

1. Compare PR #275 `baseRefOid` only with `incident_base_sha`.
2. Compare the live protected execution ref only with `execution_policy_sha`.
3. Request `docs/mission-control/mission-control-guide.md` at the verified
   execution-policy SHA, never at the incident base or a moving `main` ref.
4. Preserve the existing guide/source identity, managed-state, executing
   checkout, recovery transport, and fail-closed invariants.
5. Reject incident-base drift, untrusted execution SHA, missing recovery
   implementation at the execution SHA, current guide/policy mismatch, and a
   relaxed child override without attempting mutation.

## Test-first scope

Use the injected recovery fixture only. The focused tests must demonstrate:

- divergent incident and execution bases recover successfully;
- the policy loader receives the exact `execution_policy_sha`;
- incident-base drift fails closed;
- protected execution-policy SHA drift or an untrusted execution commit fails
  closed;
- missing recovery implementation at the execution SHA fails closed;
- current guide/policy mismatch fails closed;
- a child override that relaxes shared invariants fails closed.

Preserve existing negative coverage for historical PR base drift, Issue #274
planning-lineage drift, changed managed state/review counters, source-comment
identity, Review 1/correction/finding lineage, exact PR head/CI, later
authority, malformed receipts, transition identity, and CAS/lease conflicts.

## Allowed scope

- `scripts/mission-control/workflows/recover-review.mjs`
- `tests/int/mission-control-recover-review.int.spec.ts`
- This Task 3 brief, implementer report, and the plan-owned progress ledger.
- Focused local tests and directly affected transition tests.

## Forbidden scope

- No Task 4 full pinned integration/idempotency expansion.
- No Task 5 transport documentation or registry prose.
- No live `bemoat:mission-control:recover-review` invocation.
- No mutation of Issues #274/#275/#276, Campaign #215 Slice 5, child
  projects, deployments, migrations, production, or retained data.
- Do not weaken unrelated fail-closed checks.
- Do not mark Task 3 complete; hand off for independent review.

## Validation and handoff

Run the focused recovery suite, directly affected transition tests, lint with
zero warnings, `ReadLints` on edited files, `pnpm run guard:safety`,
`pnpm run guard:mission-control-contract` when applicable, and
`git diff --check`. Create exactly one focused local commit, do not push, and
write the implementer report with the former expected failure now passing,
negative-test results, changed files, policy-loading semantics, and concerns.
