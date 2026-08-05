# Task 5 Brief — Documentation and Transport Contract

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
- Starting Task 5 head: `d3a2edf83f8fa1480f29b0f62b062a5481b4f188`
- Historical incident base: `88b306c7e055751f78b9ced5922607eee2d1037f`
- Expected execution-policy fixture base: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Task status: `in_progress`; this implementer must not mark Task 5 complete.

## Goal

Document the implemented recovery transport contract without changing recovery
behavior. Keep the exact `#274` / `#275` incident route bounded while making
the distinction between historical incident lineage and the trusted execution
policy commit unambiguous to agents and reviewers.

## Required documentation

- `incident_base_sha` is the immutable historical incident binding from PR #275
  `baseRefOid` / managed-state lineage. It is not the current policy source.
- `execution_policy_sha` is the live protected `main` tip used to load and
  verify policy for the trusted recovery transport. It is included in the
  receipt and transition identity and is reverified before mutation.
- The two base SHAs are independent; `incident_base_sha === execution_policy_sha`
  must not be required.
- `policy_source_sha` remains the separate guide-content/source identity.
- A legacy single-field `protected_base_sha` record or receipt is ambiguous and
  fails closed.
- `recover-review` remains an exceptional, pinned incident-class transport, not
  a generic recovery or comment-repair API.

## Allowed scope

- Update only the transport registry, command reference, recovery receipt
  documentation, and agent-facing recovery contract needed to describe the
  implemented behavior.
- Reconcile Task 5 SDD identity markers if `guard:safety` requires it.
- Run documentation/contract/safety validation and create one focused local
  commit; do not push.
- Write `sdd/task-05-implementer-report.md` and leave Task 5 in progress.

## Forbidden scope

- No production behavior change unless a contract comment is strictly required.
- No live `bemoat:mission-control:recover-review` invocation.
- No mutation of Issues #274/#275/#276, Campaign #215 Slice 5, child projects,
  deployments, migrations, production, or retained data.
- No generic recovery API, ordinary review ownership change, Task 6 review, or
  Task 5 completion marker.

## Validation and handoff

Run `pnpm run guard:safety`, the Mission Control contract guard when applicable,
and `git diff --check`. Self-review the documentation against the Tasks 2–4
receipt and workflow behavior, then hand off with `PASS_FOR_REVIEW`.
