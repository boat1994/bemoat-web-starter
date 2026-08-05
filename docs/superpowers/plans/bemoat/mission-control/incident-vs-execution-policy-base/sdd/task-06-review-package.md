# Task 6 Review Package — Whole-Branch Verification

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
- Protected starting SHA: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Exact reviewed head: `c7c247722413559b10f6f03d8cf70f2ae8d9da2c`
- Review range:
  `git diff ce8d67b19c6c5d210024434f532dcc32ebdc6daf...HEAD`
- Review role: final whole-branch reviewer; no implementation fixes

The committed branch diff contains 32 paths. Runtime/test scope is limited to
the recovery domain, recovery workflow, transport registry, command/role
contracts, the focused recovery fixture, and plan-owned SDD evidence.

## Blocking finding

### [P1] MC-T6-001 — Required full check fails TypeScript in focused recovery tests

`tests/int/mission-control-recover-review.int.spec.ts:639,641,660,674,877`

`PAYLOAD_SECRET=secret pnpm run check` passes the safety guard and lint, then
fails `tsc --noEmit` because `scenario.issueComments` is typed as
`Array<Record<string, unknown>>`, while the new receipt assertions pass
`comment.body` directly to `parseRecoveryReceipt`, which requires a string.
This prevents the required full check from passing and blocks branch delivery.

Required correction: keep the correction test-only and either type the scenario
comments with a string `body` field, or pass
`String(comment.body ?? '')` at every listed receipt-parser call, including the
`receipts[0]` call. Do not change production recovery behavior. Re-run
`PAYLOAD_SECRET=secret pnpm run check`, the focused recovery suite, affected
CAS/reconciliation suites, and `git diff --check`.

## Contract verification

- `incident_base_sha` is the historical PR #275 `baseRefOid`.
- `execution_policy_sha` is the live protected `main` commit and the exact
  policy-loading ref.
- `policy_source_sha` remains the separate guide Contents/source identity.
- The two base SHAs are both required, independently serialized, and included
  in the recovery receipt identity; equality is not required.
- v1 / `protected_base_sha` recovery records are rejected fail-closed.
- The recovery route remains pinned to #274/#275, while ordinary `review`
  retains `REVIEW_VERDICT` ownership.
- Recovery still uses the existing trusted evidence, receipt matching,
  Coordinator transition, Issue-body CAS, and lease paths.
- No generic recovery or comment-repair API was introduced.

## Fail-closed coverage reviewed

The focused suite and direct dependencies cover historical PR-base drift,
untrusted execution SHA, exact execution-policy loading, missing recovery
implementation, guide/source mismatch, malformed and unsupported child
overrides, observed checkout identity, source-comment/verdict/RESULT/finding
lineage, exact-head CI, competing evidence, malformed/legacy receipts,
divergent-base receipt identity, deterministic retry, and ambiguous POST
recovery. Shared reconciliation/CAS suites cover managed-state counters,
transition projection, lease/CAS conflicts, and concurrent evidence. Existing
planning-lineage suites remain outside the changed runtime paths and pass in
the full integration run.

## Validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — passed, 22 tests.
- `pnpm exec vitest run tests/int/mission-control-issue-body-cas.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts`
  — passed, 83 tests.
- `pnpm run guard:safety` — passed.
- `pnpm run guard:mission-control-contract` — passed.
- `pnpm run branch:check` — passed.
- `git diff --check` — passed for working and committed diffs.
- `PAYLOAD_SECRET=secret pnpm run test:int` — passed, 54 files / 1,149
  tests.
- `PAYLOAD_SECRET=secret pnpm run check` — failed at typecheck with
  MC-T6-001 after guard and lint passed.
- `pnpm run test:int` without `PAYLOAD_SECRET` — failed only because the local
  Payload test environment reported a missing secret; the secret-configured
  full integration run passed.

## Scope and prohibited-operation confirmation

No live `bemoat:mission-control:recover-review` invocation, GitHub artifact
mutation, Issue #274 / PR #275 mutation, Issue #276 work, Campaign #215 Slice
5 work, child sync, deployment, migration, production operation, or retained
data operation was performed. No forbidden implementation paths appear in the
committed branch diff.

## Verdict

`FAIL — CORRECTION REQUIRED`

The branch is not ready for push/PR delivery to `AWAITING_REVIEW_1` until
MC-T6-001 is corrected and the required full check passes. No other blocking
finding was identified.
