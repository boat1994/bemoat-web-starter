# Task 1 Review — Characterize the Impossible One-Field Binding

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
- Reviewed base: `e42a3e9d062ef31c72d41c859821cc6dd70ef2e9`
- Reviewed head: `b0a35215b3e33d08d2217c64739e1a5e879f0aa5`
- Review scope: `git diff base..head` plus the current recovery validation
  implementation needed to verify the claimed failure mode

## Verdict

`PASS`

No blocking findings. Task 1 is a valid characterization-only handoff for the
later domain/workflow changes. Task 2 was not started.

## 1. Specification compliance

All seven Task 1 acceptance criteria are met:

1. `tests/int/mission-control-recover-review.int.spec.ts` binds the PR
   historical base to
   `88b306c7e055751f78b9ced5922607eee2d1037f` and protected `main` to
   `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.
2. The record still contains only the current v1
   `protected_base_sha`, set to the incident base, while the injected
   protected ref returns the distinct execution-policy base. The desired
   `RECOVERED` assertion therefore characterizes the current one-field
   equality requirement.
3. The exact #274/#275 fixture reaches the current equality check. The focused
   run fails at `scripts/mission-control/workflows/recover-review.mjs:343`,
   rather than at source identity, state, lineage, finding, or CI validation.
4. The fixture preserves and asserts the relevant evidence: `AWAITING_REVIEW_2`,
   counters `1/1`, active PR #275, corrected head, prior reviewed head,
   source-comment IDs and hashes, Review 1/correction lineage, all seven
   findings, and successful `CI`/`CI (starter strict)` exact-head checks.
5. The test asks for `outcome: 'RECOVERED'` with divergent constants and never
   adds an equality assertion between the two bases.
6. The observed current failure is fail-closed with the exact message:
   `STATE_CONFLICT: protected base SHA differs from the recovery record`.
7. The base-to-head diff contains only the test and two SDD documentation
   files. No production edit, live recovery invocation, or Issue/PR mutation
   was performed as part of this review.

## 2. Code quality

The characterization is clear and appropriately isolated:

- Named constants make the historical/execution-policy distinction explicit.
- The test extends the existing recovery integration fixture and uses injected
  dependencies rather than a second harness or live GitHub calls.
- The fixture preserves the exact incident IDs, heads, counters, lineage,
  findings, and check identities required by the recovery workflow.
- The test name matches the focused command prescribed by the brief.
- The test's preflight assertions make fixture regressions distinguishable from
  the intended protected-base failure.

The SDD brief, ledger transition, and implementer report state that the current
v1 schema remains intentionally unchanged and that legacy receipt separation
belongs to later tasks. That is consistent with Task 1's scope.

## 3. Security and authority invariants

The test preserves the security boundary rather than weakening it. It expects
the unchanged workflow to reject the evidence before any projection can occur,
and the exact rejection is the existing `STATE_CONFLICT`. All GitHub behavior
is simulated through injected dependencies. No CLI, live recovery, comment
write, Issue-body write, deployment, migration, or retained-data operation was
used.

The production equality check remains unchanged in the reviewed diff. Task 1
does not introduce the future two-field schema, silently reinterpret a legacy
receipt, or authorize recovery.

## 4. Test adequacy

Independent local evidence:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "accepts divergent incident and execution bases"`
  → expected red result: one failed, six skipped; failure is
  `STATE_CONFLICT: protected base SHA differs from the recovery record` at the
  current equality check.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "registers|requires the merged-guide|quarantines|does not loosen|accepts only|resumes an ambiguous"`
  → six passed, one skipped.
- `pnpm exec eslint tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  → passed.
- `git diff --check`
  → passed for the reviewed implementation diff.
- `pnpm run guard:safety`
  → failed in the planning-contract guard with `PLAN001` for the modified
  `task-01-brief.md` and the untracked implementer report. The review package
  and review artifacts now contain the required identity marker; the brief
  and implementer report remain unchanged by this review.

The expected red characterization is the correct validation result before
production changes. A full `pnpm run check` is not required to establish this
red-test gate and was not claimed by the implementer. The safety-guard failure
is a repository documentation-process concern to resolve before final branch
delivery; it does not invalidate the Task 1 characterization acceptance
criteria.

## 5. Scope discipline

The exact base-to-head file list is:

- `docs/.../sdd/progress-ledger.md`
- `docs/.../sdd/task-01-brief.md`
- `tests/int/mission-control-recover-review.int.spec.ts`

The worktree also contains the requested implementer report as an untracked
handoff artifact; it is not part of the reviewed head. The review package and
review itself are additional local SDD review artifacts. No production files
are changed in the Task 1 diff.

## Non-blocking notes

1. The Task 1 mock for `readPolicySource` returns the synthetic source SHA but
   does not record the requested ref. Exact execution-SHA policy loading is
   explicitly deferred to Task 3, so this is not a Task 1 defect.
2. The focused test does not separately assert `postCount === 0` or byte-for-
   byte unchanged managed state after rejection. The workflow reaches the
   equality guard before the first mutation, and the exact failure stack proves
   that checkpoint; an explicit no-write assertion would be useful follow-up
   hardening if the implementer revisits the fixture.
3. `pnpm run guard:safety` cannot pass in the current worktree until the
   modified Task 1 brief and the untracked implementer report receive the
   repository-required task-identity marker blocks. This is separate from the
   production behavior under review and must be reconciled before a final
   branch validation.

## Review conclusion

Task 1 satisfies its characterization-only contract and is
`review-passed`. The ledger may advance Task 1 to `complete / review-passed`;
the production two-base implementation and all later tasks remain pending.
