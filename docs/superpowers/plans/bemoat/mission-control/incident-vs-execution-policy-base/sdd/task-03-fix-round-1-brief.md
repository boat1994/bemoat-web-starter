# Task 3 Fix Round 1 Brief — Reviewer P1 Corrections

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

Fix only the two blocking P1 findings from the Task 3 review of
`d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`:

1. Bind recovery authorization to observed executing checkout identity. The
   workflow must fail closed when actual checkout HEAD, branch, cleanliness, or
   protected-base ancestry does not match the verified `execution_policy_sha`.
   The only hotfix exception is the explicitly authorized
   `hotfix/incident-vs-execution-policy-base` branch with observed ancestry
   from that protected tip.
2. Replace heuristic child-override matching with closed-world YAML validation.
   Reject unsupported keys, malformed content, and all documented structured
   forms that relax shared invariants, including `allow_auto_merge: true`.

## Test-first acceptance

- A self-declared policy checkout that disagrees with observed checkout
  identity fails before mutation.
- An unrelated hotfix branch fails before mutation.
- The exact authorized hotfix branch based on the trusted execution SHA passes.
- Structured and malformed/unknown child overrides fail before comment or
  Issue-body writes.
- Existing divergent-base success and all unrelated fail-closed recovery
  invariants remain unchanged.

## Boundaries

Modify only the recovery workflow, its focused integration tests, this brief,
the Task 3 implementer report, and the plan-owned ledger. Do not start Task 4,
run live recovery, mutate GitHub artifacts, push, merge, deploy, migrate, or
mark Task 3 complete.
