# Task 3 Re-review Round 1 — Correction Delta

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
- Prior Task 3 head: `d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`
- Fix round 1 head: `31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`
- Exact review diff:
  `git diff d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55..31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`
- Review scope: correction delta for the two prior Task 3 P1 findings only.

## Verdict

`FAIL`

### [P1] Enforce array-typed child override values — `scripts/mission-control/workflows/recover-review.mjs:146-155`

The closed-world validator does not reject scalar or `null` values for the
array-typed keys `required_checks`, `manual_qa`, and `protected_paths`. The
array validation is nested under `value !== null && typeof value ===
'object'`; when one of those keys has `null`, `true`, or another scalar value,
the branch is skipped and none of the later string/boolean checks apply.

Consequently, malformed unsupported forms such as `required_checks: null` and
`required_checks: true` are accepted instead of failing closed. If the
project override is consumed as configuration, these values can disable or
otherwise alter project-specific checks while the recovery authority check
reports the override as valid. This leaves the second prior P1 only partially
fixed. The correction tests cover the documented forbidden keys and malformed
YAML syntax, but not invalid values for allowed array keys.

## Prior P1 status

- P1-1, observed executing checkout identity: `CLOSED`.
  `readExecutingCheckout` now uses the real process checkout through
  `git rev-parse HEAD`, `git symbolic-ref`, `git status`, `git merge-base`, and
  `git ls-tree`. The verifier requires clean state, required paths, and either
  exact protected `main@execution_policy_sha` or the exact authorized hotfix
  branch with ancestry from that SHA. The policy object's old synthetic
  `executing_checkout` metadata is no longer used as authority. The mismatch,
  unrelated-hotfix, and authorized-hotfix tests all preserve zero mutation on
  negative paths.
- P1-2, child override validation: `OPEN`.
  The key allowlist and YAML parsing close the previously reported documented
  structured-key bypasses, but the invalid array-key value bypass above
  remains a load-bearing fail-open path.

## New blocking findings

None beyond the residual P1-2 finding above. No regression was found in the
incident-base versus execution-policy separation or in the pre-mutation
ordering for the reviewed paths.

## Non-blocking notes

- The production checkout observer verifies the exact protected commit or the
  explicitly named descendant hotfix branch and required path presence. The
  focused tests use injected checkout evidence, so they validate the verifier
  contract rather than spawning a real Git checkout.
- The production policy loader still returns legacy synthetic
  `executing_checkout` metadata, but the corrected verifier no longer consumes
  that field as authority. This is redundant evidence, not a finding in this
  scoped delta.
- No Task 4 work, live recovery, deployment, migration, or external GitHub
  mutation was performed.

## Focused validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — 19 passed.
- `pnpm exec eslint scripts/mission-control/workflows/recover-review.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  — passed.
- `pnpm run guard:safety` — passed.
- `git diff --check d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55..31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`
  — passed.

## Ledger and handoff

Task 3 remains `in_progress`; the progress ledger was intentionally not
marked `complete / review-passed`. Do not start Task 4. Correct the array-key
type validation, add scalar/null negative cases with zero mutation assertions,
rerun the focused suite, and request another scoped re-review.
