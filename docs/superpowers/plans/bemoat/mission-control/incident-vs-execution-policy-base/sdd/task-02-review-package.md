# Task 2 Review Package

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
- Base: `b0a35215b3e33d08d2217c64739e1a5e879f0aa5`
- Head: `d840bc3f7bef0a1ff2fea82ff68cc69328900917`
- Review diff: `git diff b0a35215b3e33d08d2217c64739e1a5e879f0aa5..d840bc3f7bef0a1ff2fea82ff68cc69328900917`
- Worktree status at review start: clean

## Files in the exact Task 2 delta

- `scripts/mission-control/domain/review-recovery.mjs`
- `tests/int/mission-control-recover-review.int.spec.ts`
- Task 2 and retained Task 1 SDD handoff artifacts under
  `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/`

No workflow policy-loading rewrite, Task 3 negative suite, Task 4 integration
expansion, migration, deployment, child-sync, or live recovery operation is
present in this delta.

## Verdict

`PASS`

No blocking findings. Task 2 satisfies the domain, receipt, identity, legacy
rejection, and evidence-detector contract. The remaining full-suite red test is
the expected Task 3 workflow equality failure and is clearly deferred in the
brief, implementer report, and ledger.

## Acceptance criteria checklist

- [x] The domain/model and typed record contain explicit
      `incident_base_sha` and `execution_policy_sha` bindings.
- [x] Build, validation, receipt rendering/parsing, canonical serialization,
      and transition identity use both bindings.
- [x] Divergent valid SHA values are accepted; no equality check is introduced.
- [x] Legacy v1 markers and records with ambiguous `protected_base_sha` fail
      closed rather than being migrated or reinterpreted.
- [x] Existing fixed repository, issue, PR, lineage, finding, counter,
      source-evidence, managed-state, and exact-head CI validations remain
      intact.
- [x] Scope is limited to Task 2 domain/test work and SDD handoff artifacts;
      policy loading and full recovery projection remain Task 3/4 work.
- [x] Focused Task 2 tests pass.

## Focused validation package

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "round-trips|rejects missing|quarantines"`
  - Passed: 3 tests.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 8 passed, 1 expected failure.
  - The expected failure is `STATE_CONFLICT: protected base SHA differs from
    the recovery record` at the unchanged Task 3 workflow guard.
- `pnpm exec eslint scripts/mission-control/domain/review-recovery.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  - Passed.
- `pnpm run guard:safety`
  - Passed.
- `pnpm run guard:mission-control-contract`
  - Passed.
- `git diff --check`
  - Passed.
- `ReadLints` on the changed production and test files
  - No linter errors.

## Non-blocking notes

1. The focused tests cover missing and legacy bindings but do not separately
   assert short bindings; the production validator's full-SHA regex rejects
   them.
2. Task 3 must split workflow validation of PR `baseRefOid` and the live
   protected execution-policy SHA, then load policy content at the verified
   execution SHA. No Task 3 implementation was started by this review.
