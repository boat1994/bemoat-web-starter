# Task 3 Fix Round 2 Brief — Array Override Value Types

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

## Scope

Fix only the residual P1-2 finding from Task 3 re-review round 1:

- `required_checks`, `manual_qa`, and `protected_paths` are array-typed child
  override keys, but scalar and `null` values currently bypass validation.
- Enforce arrays containing only strings; reject scalar, `null`, object, and
  wrong-element-shape values before any recovery mutation.
- Add focused negative tests for scalar and `null` array-key values, retaining
  zero comment-post and zero Issue-body-write assertions.

P1-1 checkout identity is closed and is not being changed. Do not start Task 4,
run live recovery, mutate GitHub artifacts, push, merge, deploy, migrate, or
mark Task 3 complete.
