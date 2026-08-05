# Task 1 Review Package

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

## Review identity

- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Base: `e42a3e9d062ef31c72d41c859821cc6dd70ef2e9`
- Head: `b0a35215b3e33d08d2217c64739e1a5e879f0aa5`
- Review diff: `git diff e42a3e9d062ef31c72d41c859821cc6dd70ef2e9`
  `..b0a35215b3e33d08d2217c64739e1a5e879f0aa5`

The requested implementer report exists in the worktree but is untracked and
is not part of the reviewed head.

## Files in the Task 1 diff

- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/progress-ledger.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-01-brief.md`
- `tests/int/mission-control-recover-review.int.spec.ts`

No production recovery files, migrations, deployment files, child-sync paths,
or project-specific infrastructure are changed between the base and head.

## Acceptance criteria checklist

- [x] Historical incident base and current execution-policy base are divergent
      in the injected fixture.
- [x] The desired `RECOVERED` assertion fails under the current one-field
      `protected_base_sha` binding.
- [x] The exact pinned #274/#275 fixture reaches the protected-base equality
      check and fails with the current `STATE_CONFLICT` message.
- [x] Source comments, managed state, counters, lineage, findings, and
      exact-head checks remain valid before the isolated failure.
- [x] The desired assertion does not require equality between the two bases.
- [x] The failure is fail-closed at
      `STATE_CONFLICT: protected base SHA differs from the recovery record`.
- [x] Scope is limited to tests and SDD documentation; no live recovery or
      Issue/PR mutation is present.

## Focused validation package

- Focused characterization: expected failure, one failed test and six skipped;
  failure is the exact protected-base conflict.
- Existing recovery characterization selector: six passed, one skipped.
- ESLint on the changed test: passed with zero warnings.
- `git diff --check`: passed.
