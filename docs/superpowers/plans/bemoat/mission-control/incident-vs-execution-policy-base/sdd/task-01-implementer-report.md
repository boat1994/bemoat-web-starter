# Task 1 Implementer Report — Characterize the Impossible One-Field Binding

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

Task 1 remains `in_progress` in the durable ledger. It is ready for the task
reviewer; it is not marked complete.

## Commit

- Branch: `hotfix/incident-vs-execution-policy-base`
- Commit: `b0a35215b3e33d08d2217c64739e1a5e879f0aa5`
- Commit message: `test(mission-control): characterize divergent recovery bases`
- Push: not performed, per the Task 1 instruction for Mission Control to push
  later.

## Implemented characterization

Extended
`tests/int/mission-control-recover-review.int.spec.ts` with the focused test
`accepts divergent incident and execution bases`.

The injected fixture binds:

- Historical PR #275 incident base:
  `88b306c7e055751f78b9ced5922607eee2d1037f`
- Current protected `main` execution-policy base:
  `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Corrected PR #275 head:
  `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`
- Synthetic merged-guide source identity:
  `'e'.repeat(40)`
- Issue #274 managed state: `AWAITING_REVIEW_2`
- Prior counters: `review_cycle: 1`, `full_review_count: 1`
- Source comments: `5187836238` and `5187837555`
- Original Review 1: `5187488219`
- Correction RESULT: `5187802812`
- Findings: `MC-R1-001` through `MC-R1-007`
- Exact-head successful checks: `CI` and `CI (starter strict)`

The test asserts the desired future result, `outcome: 'RECOVERED'`, without
requiring the two base SHAs to be equal. With unchanged production code, the
fixture passes all preceding source, lineage, state, finding, and exact-head
checks and fails at the current one-field equality:

`STATE_CONFLICT: protected base SHA differs from the recovery record`

No production recovery behavior was changed.

## Validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "accepts divergent incident and execution bases"`
  - Expected red result: 1 failed, 6 skipped.
  - Failure is the exact current protected-base equality conflict above.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  - 1 expected characterization failure; 6 existing tests passed.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "registers|requires the merged-guide|quarantines|does not loosen|accepts only|resumes an ambiguous"`
  - 6 passed, 1 skipped.
- `pnpm exec eslint tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  - Passed.
- `ReadLints` for the changed test
  - No linter errors.
- `git diff --check`
  - Passed before commit.

The full `pnpm run check` was not run because this task intentionally adds a
red characterization test and must not change production code to make it pass.

## Changed files

- `tests/int/mission-control-recover-review.int.spec.ts`
  - Added divergent-base constants and the complete simulated recovery
    evidence fixture.
  - Preserved and strengthened assertions for counters, managed state,
    comments, review lineage, findings, and exact-head CI.
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-01-brief.md`
  - Added the complete Task 1 scope, fixture, validation, and handoff brief.
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/progress-ledger.md`
  - Marked Task 1 `in_progress` and recorded the expected red evidence.

No production files, migrations, child-sync paths, deployment files, or
project-specific infrastructure were changed.

## Concerns and handoff

- The current v1 `protected_base_sha` schema remains intentionally unchanged
  and ambiguous. Task 2 must introduce separate
  `incident_base_sha`/`execution_policy_sha` fields and reject legacy v1
  receipts rather than reinterpret them.
- The existing `policy_source_sha` remains a distinct synthetic guide-source
  identity in this fixture; it must not be conflated with either base commit.
- The commit emitted a warning that `.githooks/pre-commit` is not executable,
  so the hook was ignored. The changed test was independently linted and the
  diff passed whitespace validation.
- No live GitHub recovery, issue/PR mutation, child sync, deploy, migration,
  production operation, or retained-data operation was performed.
- Task 2 should consume this fixture and make the positive `RECOVERED`
  assertion pass only after the two bindings are separated.
