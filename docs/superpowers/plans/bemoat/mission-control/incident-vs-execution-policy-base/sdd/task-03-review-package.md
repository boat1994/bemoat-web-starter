# Task 3 Review Package

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
- Reviewed base: `d840bc3f7bef0a1ff2fea82ff68cc69328900917`
- Reviewed head: `d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`
- Review diff:
  `git diff d840bc3f7bef0a1ff2fea82ff68cc69328900917..d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`
- Review-start worktree: clean

## Files in the exact Task 3 delta

- `scripts/mission-control/workflows/recover-review.mjs`
- `tests/int/mission-control-recover-review.int.spec.ts`
- Task 3 SDD brief, implementer report, and ledger updates
- Retained Task 2 review artifacts included by the Task 3 head

No Task 4/5 production implementation, migration, deployment, child project,
or live recovery operation was observed.

## Verdict

`FAIL`

The divergent incident/execution policy split is implemented and the focused
suite passes, but Task 3 cannot advance because the recovery authority boundary
is not independently verified at execution time. Child-override validation also
accepts common structured forms that relax shared invariants.

## Acceptance criteria audit

1. `Done` — policy loading is invoked with the verified
   `execution_policy_sha`, and `policy_source_sha` remains the separate guide
   content identity.
2. `Not done` — the live protected tip, policy files, guide metadata, and
   current implementation text are checked, but the actual executing checkout is
   not resolved or compared. The loader synthesizes its checkout evidence from
   the requested SHA and only permits `main`; it neither verifies the running
   checkout nor supports an authorized hotfix based on that SHA. Child override
   validation is also incomplete; see the blocking findings.
3. `Done` — no `incident_base_sha === execution_policy_sha` equality is
   required.
4. `Done` — no guide commit/blob equality against the historical incident base
   is required.
5. `Done` — PR `baseRefOid` is checked against `incident_base_sha`, and the
   incident base is not used to load policy content.
6. `Done` for the listed narrow cases — focused negative tests cover incident
   base drift, protected execution SHA drift, missing facade evidence, current
   guide/source mismatch, and one relaxed child override. Coverage does not
   exercise checkout mismatch, missing workflow/registry evidence, or alternate
   structured override forms.
7. `Done` — the focused recovery tests and existing transition checks observed
   in the implementation preserve the unrelated fail-closed paths; no
   weakening was found in the reviewed production diff.
8. `Done` — the former divergent-base failure now resolves to `RECOVERED`, and
   the test asserts the policy loader received `EXECUTION_POLICY_SHA`.
9. `Done` — no Task 4/5 runtime expansion was found. The retained Task 2 review
   documents are process artifacts, not new recovery behavior.

## Focused validation evidence

- Confirmed `HEAD` is
  `d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55` on the requested branch.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — 15 passed.
- `pnpm run guard:safety` — passed.
- `pnpm run guard:mission-control-contract` — passed.
- Targeted ESLint with `--max-warnings 0` — passed.
- `ReadLints` for the changed workflow and focused test — no errors.
- `git diff --check` — passed.

No live recovery command or external artifact mutation was performed.

## Required handoff

Keep Task 3 `in_progress`. Fix both blocking authority findings, add the
corresponding negative/positive tests, rerun the focused validation, and request
independent review again. Do not start Task 4.
