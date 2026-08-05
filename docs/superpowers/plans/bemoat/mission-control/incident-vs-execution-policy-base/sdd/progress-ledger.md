# Incident vs Execution Policy Base — Durable Progress Ledger

This ledger is the durable recovery map for the six implementation tasks in:

`docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/implementation-plan.md`

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

It records verified setup evidence, task ownership, exact starting state, and
the stop conditions needed to resume safely. It is not a substitute for live
GitHub state, exact-head CI, or the implementation plan.

## Controller Setup Record

- Repository: `boat1994/bemoat-web-starter`
- Protected base: `main`
- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Exact starting commit SHA: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Starting commit: `Merge pull request #278 from boat1994/feature/277-recover-review`
- Main branch status at setup: `origin/main` and `refs/heads/main` both resolved to the starting SHA.
- `dev` branch: absent; this hotfix uses the documented protected-`main` bootstrap exception.
- Managed hotfix Task Issue: none found. Issue #279 is an unrelated incident-report backlog item, not this hotfix. A dedicated Task Issue must be opened and linked before implementation delivery if the parent controller requires managed issue execution.
- Child override: absent at `.bemoat/mission-control-overrides.md`.
- Mission Control guide: `docs/mission-control/mission-control-guide.md`
- Guide version: `1.3.0`
- Observed guide Contents blob SHA on live `main`: `e79694467b89dace927c27a1022ec3d260a4a43c` (evidence only; not the execution commit).
- Last guide-changing commit in live `main`: `47f7c2d4b300e18b08eafa4f3681102501ef01da`
- Live policy execution commit: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`

## Verified GitHub Evidence

### Blocked recovery target

- Issue #274: `OPEN`, title `feat: add protected campaign-slice managed Task bootstrap`.
- Managed state: `AWAITING_REVIEW_2`.
- Counters: `review_cycle: 1`, `full_review_count: 1`.
- Active PR: `#275`.
- PR #275 state: `OPEN`, base branch `main`.
- PR #275 historical base: `baseRefOid = 88b306c7e055751f78b9ced5922607eee2d1037f`.
- PR #275 exact head: `headRefOid = c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`.
- Issue #274 managed `current_head`: `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`.
- Issue #274 managed `last_reviewed_head`: `301ae166052af036ce4d727be59d8d20cc8c02d1`.
- Raw source evidence IDs: Issue comment `5187836238`; PR conversation comment `5187837555`.
- Original Review 1 comment: `5187488219`.
- Correction RESULT comment: `5187802812`.
- Exact-head checks on PR #275: `ci` and `starter-ci` both completed successfully.
- Controller prohibition: never run recovery against this live target or mutate either historical artifact.

### Completed prerequisite

- Issue #277: `CLOSED`, managed state `DONE`.
- PR #278: `MERGED` into `main`.
- PR #278 reviewed head: `06a4b073af0415a21469b610843c2ad78d13e8a7`.
- PR #278 merge commit / current protected `main` tip: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.

## Binding Tuple For Pinned Tests

- `incident_base_sha`: `88b306c7e055751f78b9ced5922607eee2d1037f`
- `execution_policy_sha`: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- `policy_source_sha`: preserve the existing merged-guide source identity contract in fixtures; do not infer it from the execution commit or observed Contents blob.
- `active_pr`: `275`
- `exact_head`: `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`
- `prior_last_reviewed_head`: `301ae166052af036ce4d727be59d8d20cc8c02d1`

These are simulated regression-fixture values. They are not authorization to
run the recovery transport against live GitHub.

## Task Recovery Map

| Task | Owner | Status | Required evidence before marking complete |
| --- | --- | --- | --- |
| 1. Characterize impossible binding | Dev | in_progress | A focused test fails against the current one-field equality with no production change. |
| 2. Separate recovery bindings | Dev | NOT STARTED | Domain/receipt/parser/validator/identity tests prove both fields are required and independently serialized. |
| 3. Load policy from execution SHA | Dev | NOT STARTED | Workflow uses exact execution SHA; stale base, wrong ref, and wrong guide evidence fail closed. |
| 4. Pinned integration/idempotency regression | Dev | NOT STARTED | Simulated #274/#275 success, retry `NO_OP`, ambiguous POST recovery, and no duplicate/source mutation. |
| 5. Docs/transport contract | Dev | NOT STARTED | Command reference distinguishes incident base, execution policy commit, and policy-content identity. |
| 6. Whole-branch verification | Reviewer only | NOT STARTED | Independent review plus focused suite, contract guard, safety guard, full check, and diff check. |

## Durable Run Rules

1. Controller setup does not dispatch or implement Task 1.
2. No live `bemoat:mission-control:recover-review` invocation.
3. No mutation of Issue #274, PR #275, Issue #276, Campaign #215 Slice 5, child projects, production, migrations, deployments, or retained data.
4. Do not equate `incident_base_sha` and `execution_policy_sha`.
5. Do not silently accept a v1 receipt whose `protected_base_sha` has ambiguous meaning.
6. Stop on a dirty worktree, changed authority, unexpected branch/head, missing live evidence, or scope expansion.
7. Task workers update this ledger only with verified evidence and exact command results; the plan remains the roadmap and GitHub remains the live authority.

## Ledger Entries

### 2026-08-05 — Controller setup

- Verified repository, protected `main`, live `main` tip, Mission Control guide
  version/blob, absent child override, and absent `dev`.
- Reverified Issue #274 / PR #275 and Issue #277 / PR #278 using live GitHub
  state.
- Created the isolated hotfix worktree and branch from current protected `main`.
- Recorded starting SHA `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.
- Created the implementation plan and this durable ledger.
- No production code changed.
- No live recovery, Issue/PR mutation, child sync, deploy, migration, or
  retained-data operation performed.
- Next permitted action: Mission Control dispatches Task 1 to write and run the
  failing characterization test only.

### 2026-08-05 — Task 1 dispatched

- Confirmed clean worktree on branch
  `hotfix/incident-vs-execution-policy-base` at the existing docs/setup
  commit.
- Wrote the complete Task 1 brief to
  `sdd/task-01-brief.md`.
- Task 1 remains `in_progress`; the focused characterization test now fails at
  the current one-field protected-base equality with
  `STATE_CONFLICT: protected base SHA differs from the recovery record`.
- The full recovery fixture file reports 1 expected characterization failure
  and 6 passing existing tests. The existing six-test selector passes all 6.
- `ReadLints` reports no errors for the changed test, and `git diff --check`
  passes.
- No production code, live recovery command, GitHub artifact, child project,
  deployment, migration, or retained data was changed.
