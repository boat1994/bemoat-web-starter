# Task 6 Final Correction Brief — MC-T6-001

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

## Correction identity

- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Reviewed head: `c7c247722413559b10f6f03d8cf70f2ae8d9da2c`
- Finding: `MC-T6-001`
- Correction status: `in_progress`; Task 6 remains awaiting scoped re-review.

## Goal

Resolve the five TypeScript errors in
`tests/int/mission-control-recover-review.int.spec.ts` by converting fixture
comment bodies to strings at the focused `parseRecoveryReceipt` call sites.
This is a test-only typing correction.

## Allowed scope

- Update only the five focused test parser inputs identified by MC-T6-001.
- Reconcile Task 5/6 SDD review artifacts and the progress ledger as needed for
  a clean, durable correction handoff.
- Run the required safety, typecheck, whitespace, and focused-suite validation.
- Create one focused local commit; do not push, open a PR, or run live recovery.
- Write the correction report and leave Task 6 awaiting scoped re-review.

## Forbidden scope

- No production recovery semantic or authority change.
- No live `bemoat:mission-control:recover-review` invocation.
- No mutation of Issues #274/#275/#276, Campaign #215 Slice 5, child projects,
  deployments, migrations, production, or retained data.
- No Task 6 final-complete or review-passed marker.

## Validation and handoff

Required commands:

```bash
pnpm run guard:safety
PAYLOAD_SECRET=secret pnpm run check
git diff --check
```

Run the focused recovery suite when practical, then report the correction commit
and leave the branch ready for the one permitted scoped re-review.
