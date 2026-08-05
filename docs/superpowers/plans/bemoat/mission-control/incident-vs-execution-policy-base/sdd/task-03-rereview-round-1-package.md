# Task 3 Re-review Round 1 Package

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
- Correction base: `d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`
- Correction head: `31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`
- Exact scope:
  `git diff d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55..31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`

## Verdict

`FAIL`

P1-1 is closed. P1-2 is not fully closed because the new closed-world
validator does not reject scalar or null values for array-typed override keys.
Task 3 remains `in_progress`; the ledger was not advanced and Task 4 was not
started.

## Scoped finding status

### P1-1 — CLOSED

The workflow now obtains executing-checkout evidence through the injected
`readExecutingCheckout` dependency before loading policy or allowing mutation.
The production dependency observes `git rev-parse HEAD`, the symbolic branch,
clean status, `git merge-base` ancestry, and the required implementation paths.
`assertExecutingCheckout` ignores the old policy-supplied synthetic checkout
metadata and accepts only exact protected `main` at the execution SHA or the
exact authorized hotfix branch based on that SHA.

The correction tests cover an observed HEAD mismatch, an unrelated hotfix, and
the authorized hotfix success path. Each negative case asserts zero comment
posts and zero Issue-body writes.

### P1-2 — OPEN

The YAML parser and key allowlist correctly reject the documented relaxing
keys, unknown keys, duplicate keys, nested unsupported values, and malformed
YAML. However, `assertChildOverride` only validates array-key values inside the
`value !== null && typeof value === 'object'` branch. A scalar or `null` value
for `required_checks`, `manual_qa`, or `protected_paths` falls through without
being rejected. For example, `required_checks: null` or
`required_checks: true` is accepted despite not matching the declared array
shape and potentially removing project-specific checks in downstream
consumers.

This violates the closed-world requirement to reject malformed or unsupported
override values by default. The focused correction matrix covers forbidden
keys and malformed syntax, but not invalid scalar/null values for allowed
array keys.

## Acceptance criteria audit

1. `Done` — observed checkout HEAD, branch, cleanliness, ancestry, and required
   paths are checked before policy loading and mutation.
2. `Done` — exact protected `main` and the explicitly authorized hotfix path are
   handled; unrelated and mismatched checkout cases fail closed.
3. `Not done` — child override validation is closed-world for keys and several
   forms, but invalid scalar/null values for array-typed keys still pass.
4. `Done` — the correction focused on the two prior P1 areas; no Task 4
   implementation or live recovery operation was added.

## Validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — 19 passed.
- `pnpm exec eslint scripts/mission-control/workflows/recover-review.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  — passed.
- `pnpm run guard:safety` — passed.
- `git diff --check d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55..31a4eec08e9cd04dbbe91f9e2b900e4264289c2c`
  — passed.

No live recovery command or external artifact mutation was performed.
