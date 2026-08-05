# Task 4 Brief — Pinned Integration and Idempotency Regression

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
- Historical incident base: `88b306c7e055751f78b9ced5922607eee2d1037f`
- Expected execution-policy fixture base: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Task status: `in_progress`; this implementer must not mark Task 4 complete.

## Goal

Extend the existing injected #274/#275 recovery fixture so it proves the
corrected two-base workflow end to end without live recovery or GitHub
mutation. The historical PR base and trusted execution-policy SHA must remain
independent identities; equality between them is neither required nor tested
as a prerequisite.

## Required proof

The existing integration fixture must demonstrate:

1. The pinned historical incident base and later trusted execution-policy SHA.
2. Successful recovery validation and projection with those divergent SHAs.
3. Deterministic retry returns `NO_OP` with the same receipt identity.
4. An ambiguous comment POST is recovered by receipt discovery without a
   duplicate comment or second transition.
5. The single-winner comment/lease/CAS behavior remains intact.
6. Competing canonical evidence still fails closed before mutation.
7. Source comments remain unchanged and projected state remains the expected
   `ELIGIBLE_FOR_FOUNDER_REVIEW` `2/1` result.
8. The fixture uses only injected dependencies and does not invoke the live
   `bemoat:mission-control:recover-review` transport.

## Allowed scope

- Extend `tests/int/mission-control-recover-review.int.spec.ts`.
- Modify shared recovery call sites only if a directly affected assertion
  proves the corrected receipt contract requires it.
- Update this brief, the Task 4 implementer report, and the plan-owned
  progress ledger.
- Run focused recovery, transition, lint, guard, and diff validation.
- Create one focused local commit; do not push.

## Forbidden scope

- No live `bemoat:mission-control:recover-review` invocation.
- No mutation of Issues #274/#275/#276, Campaign #215 Slice 5, child
  projects, deployments, migrations, production, or retained data.
- No Task 5 documentation/transport prose.
- No Task 6 whole-branch review or Task 4 completion marker.
- No production behavior change unless a test-only fixture cannot exercise the
  already-correct Task 3 contract without a minimal directly required wiring
  change.

## Validation and handoff

Run the complete focused recovery file, directly affected Issue-body
CAS/reconciliation transition suites, targeted lint with zero warnings,
`ReadLints`, `pnpm run guard:safety`, `pnpm run guard:mission-control-contract`
when applicable, and `git diff --check`. Write
`sdd/task-04-implementer-report.md` with proof mapped to the eight required
bullets, exact commands/results, changed files, concerns, and the pending
review handoff. Do not mark Task 4 complete.
