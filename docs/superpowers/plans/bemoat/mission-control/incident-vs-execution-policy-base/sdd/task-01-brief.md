# Task 1 Brief — Characterize the Impossible One-Field Binding

## Task identity

- Plan: `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/implementation-plan.md`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Starting protected base: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Task status while this brief is executed: `in_progress`

## Goal

Add focused, characterization-first tests that prove the current recovery
transport incorrectly binds two distinct roles to one
`protected_base_sha` value:

1. The historical incident base recorded by PR #275 may differ from the
   current execution-policy base at protected `main`.
2. Current recovery validation requires PR #275's historical base and the live
   protected base to equal the same one-field record value.
3. The exact pinned Issue #274 / PR #275 evidence fixture reaches and fails at
   that one-field protected-base equality, rather than failing because of any
   other recovery invariant.
4. Review counters, managed state, comment lineage, finding evidence, and
   exact-head CI evidence remain valid in the simulated fixture.

This task intentionally leaves production recovery behavior unchanged. The
desired divergent-base assertion must fail against the current implementation;
Task 2 and Task 3 will change the production contract later.

## Required pinned evidence

The focused fixture uses these exact values:

```text
incident / historical PR #275 base:
88b306c7e055751f78b9ced5922607eee2d1037f

current execution-policy / protected main:
ce8d67b19c6c5d210024434f532dcc32ebdc6daf

corrected PR #275 head:
c44bf1bc379fe4160946dce96e5a4d7abae7b5b0
```

The fixture retains the pinned recovery facts:

- Issue #274 is in `AWAITING_REVIEW_2`.
- Review counters are `review_cycle: 1` and `full_review_count: 1`.
- Active PR is #275 and its state is `OPEN`.
- The PR base branch is `main`; its historical `baseRefOid` is the incident
  base above and its `headRefOid` is the corrected head above.
- The existing prior reviewed head, source comment IDs and hashes, original
  Review 1 verdict, correction `RESULT`, findings `MC-R1-001` through
  `MC-R1-007`, lineage, and exact-head successful CI checks remain asserted.
- The synthetic guide contents and managed state use the same
  `policy_source_sha` (`'e'.repeat(40)`) so source identity cannot mask the
  base-binding failure.

## Allowed scope

- Modify tests only, preferably the existing
  `tests/int/mission-control-recover-review.int.spec.ts` fixture and helpers.
- Add this brief, the Task 1 ledger transition, and the implementer report.
- Use injected/simulated dependencies only.
- Run focused recovery-related tests and any directly useful broader focused
  suite.
- Create exactly one focused local commit on this hotfix branch.

## Forbidden scope

- Do not modify `scripts/mission-control/domain/review-recovery.mjs`,
  `scripts/mission-control/workflows/recover-review.mjs`, or any production
  behavior.
- Do not invoke the production CLI, `gh`, or live
  `bemoat:mission-control:recover-review`.
- Do not mutate Issue #274, PR #275, Issue #276, Campaign #215 Slice 5,
  comments, child projects, deployments, migrations, production, or retained
  data.
- Do not start Task 2 or weaken existing recovery evidence assertions.
- Do not mark Task 1 complete in the ledger; task review is a later gate.

## Test design

Extend the existing pinned recover-review integration fixture rather than
creating a parallel harness. Build the current v1 recovery record with:

- `protected_base_sha: INCIDENT_BASE_SHA`;
- `policy_source_sha: 'e'.repeat(40)`;
- the existing exact incident, review, lineage, finding, comment, and CI
  evidence.

Inject dependencies that return:

- PR #275 with `baseRefName: 'main'`, `baseRefOid: INCIDENT_BASE_SHA`,
  `headRefOid: INCIDENT_HEAD`, and `state: 'OPEN'`;
- protected `main` with `sha: EXECUTION_POLICY_SHA`;
- guide contents and managed state using the synthetic guide-source SHA;
- the exact pinned Issue #274 state, counters, comments, review verdict,
  correction result, findings, lineage, and successful exact-head checks.

Add a test named so the focused command can select
`"accepts divergent incident and execution bases"`. Its desired assertion is:

```ts
await expect(runReviewRecovery({ options, body, deps })).resolves.toMatchObject({
  outcome: 'RECOVERED',
})
```

Against the unchanged current implementation, this assertion must fail closed
with the current protected-base conflict:

```text
STATE_CONFLICT: protected base SHA differs from the recovery record
```

That failure is expected and is the characterization evidence. The test must
not pass by weakening assertions or by making the two base SHAs equal.

## Validation

Primary red test:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "accepts divergent incident and execution bases"
```

Expected result before production changes: `FAIL`, specifically at the
single-field protected-base equality. Any failure in review counters, managed
state, comment IDs/hashes, Review 1, correction `RESULT`, findings, lineage,
exact head, or CI evidence is an unexpected fixture defect and must be fixed
within test scope before handoff.

If run, broader focused recovery tests must be reported separately, including
any pre-existing or expected failures. No live recovery command is a valid
validation step.

## Handoff conditions

The task is ready for reviewer handoff only when:

- the branch remains `hotfix/incident-vs-execution-policy-base`;
- only tests plus the brief, ledger, and report are changed;
- the divergent-base test is red for the exact current
  `STATE_CONFLICT` protected-base message;
- no production recovery behavior was modified or executed;
- the single Task 1 commit is created locally;
- the ledger still says Task 1 `in_progress`; and
- the full report records commands, results, changed files, and any
  schema/legacy-receipt concerns without claiming the behavior is fixed.
