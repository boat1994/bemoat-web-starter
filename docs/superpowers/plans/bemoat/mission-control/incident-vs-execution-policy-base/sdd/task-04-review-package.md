# Task 4 Review Package — Pinned Integration and Idempotency Regression

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
- Reviewed base: `35b13b026df182725db2e8d428d35ed5891c6f6f`
- Reviewed head: `d3a2edf83f8fa1480f29b0f62b062a5481b4f188`
- Exact review diff:
  `git diff 35b13b026df182725db2e8d428d35ed5891c6f6f..d3a2edf83f8fa1480f29b0f62b062a5481b4f188`
- Review-start worktree: clean
- Historical incident base: `88b306c7e055751f78b9ced5922607eee2d1037f`
- Trusted execution-policy SHA: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- `origin/main`, local `main`, and the expected execution-policy object all resolve
  to `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.

## Exact Task 4 delta

- `tests/int/mission-control-recover-review.int.spec.ts`
- Task 4 brief, implementer report, and ledger update
- Retained Task 3 review and re-review SDD artifacts

No production file, migration, deployment, child project, retained-data, or
live GitHub artifact changed in this delta.

## Verdict

`PASS`

Task 4 satisfies the pinned integration and idempotency contract. The fixture
uses injected dependencies only and proves the historical incident base and
trusted execution-policy commit remain separate identities through successful
projection, retry, ambiguous POST recovery, and competing-evidence rejection.

## Evaluation

### 1. Specification compliance

The fixture pins PR #275 `baseRefOid` to the historical incident base and the
protected execution ref to the later trusted policy SHA. The positive path
resolves `RECOVERED`, projects `ELIGIBLE_FOR_FOUNDER_REVIEW` with counters `2/1`,
and records a typed receipt containing both base bindings. The retry and
ambiguous-POST cases preserve the required single-winner behavior.

### 2. Code quality

The change is localized to the existing recovery fixture. The shared scenario
builder keeps the evidence tuple, receipt, state, source comments, and mutation
counters in one reusable fixture, while the new tests assert durable state and
comment identities rather than only outcome strings. No production workaround or
duplicate recovery schema was added.

### 3. Security and authority invariants

The tests preserve the exact incident, PR head, prior reviewed head, lineage,
source-comment, and exact-head CI bindings. Divergent base validation loads the
policy at `EXECUTION_POLICY_SHA`; stale incident-base, stale execution-policy,
historical-base policy evidence, guide/source mismatches, checkout mismatches,
unsupported child overrides, and competing canonical evidence fail closed before
comment or Issue-body mutation. The existing coordinator and Issue-body
lease/CAS paths are unchanged.

### 4. Test adequacy

The focused recovery file covers:

- divergent-base success and receipt round trip;
- independent transition-identity changes;
- deterministic retry with no second post or state write;
- source-comment byte preservation;
- policy-ref and policy-evidence fail-closed cases;
- competing canonical evidence;
- single-winner recovery after an ambiguous comment POST;
- the existing direct coordinator ambiguous-POST regression.

The directly affected suites also pass, providing regression coverage for the
unchanged Issue-body CAS and reconciliation behavior.

### 5. Scope discipline

The runtime delta is test-only. The additional files are Task 3 review evidence,
Task 4 SDD artifacts, and the plan-owned ledger. No Task 5 transport
documentation, production behavior, live recovery, or external mutation was
introduced.

## Eight proof bullets

1. **CLOSED — Historical base.** The pinned PR fixture uses
   `88b306c7e055751f78b9ced5922607eee2d1037f` as `baseRefOid`, and the recovery
   record preserves it as `incident_base_sha`.
2. **CLOSED — Trusted execution-policy SHA.** The fixture uses
   `ce8d67b19c6c5d210024434f532dcc32ebdc6daf` as the protected tip and asserts
   that policy loading requests exactly that SHA.
3. **CLOSED — Positive recovery.** The divergent-base scenario returns
   `RECOVERED`, produces one typed receipt, and projects
   `ELIGIBLE_FOR_FOUNDER_REVIEW` with `2/1` counters.
4. **CLOSED — Equality is not required.** The domain test explicitly asserts
   the two full SHAs differ, while the positive recovery succeeds and preserves
   both fields in the receipt.
5. **CLOSED — Deterministic retry.** The same request returns `NO_OP`, preserves
   the state and receipt identity, and performs no additional post or Issue-body
   write.
6. **CLOSED — Single-winner comment recovery.** The ambiguous POST fixture makes
   one post attempt, leaves one durable receipt, and performs one projection;
   the direct coordinator regression also remains green.
7. **CLOSED — Lease/CAS unchanged.** No production recovery, CAS, or
   reconciliation file changed; the focused CAS and reconciliation suites pass.
8. **CLOSED — Competing evidence fails closed.** A later canonical verdict
   rejects with `STATE_CONFLICT` before comment or Issue-body mutation.

## Additional acceptance checks

9. **CLOSED — No live recovery.** All recovery behavior is exercised through
   injected fixtures; no live recovery command or GitHub mutation was run.
10. **CLOSED — Scope disciplined.** The only runtime file in the Task 4 delta is
    `tests/int/mission-control-recover-review.int.spec.ts`; no production file
    was changed.

## Non-blocking note

The workflow's auxiliary `recoveryComments` return list closes over the
pre-post evidence snapshot, so it is empty on the first successful recovery.
The durable `comment` result, posted receipt, projected state, retry behavior,
and all current repository consumers are correct. This is outside the Task 4
acceptance contract and is non-blocking.

## Focused validation evidence

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — 22 passed.
- `pnpm exec vitest run tests/int/mission-control-issue-body-cas.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts`
  — 83 passed.
- `pnpm exec eslint tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  — passed.
- `ReadLints` on the focused test and Task 4 SDD directory — no errors.
- `pnpm run guard:safety` — passed.
- `pnpm run guard:mission-control-contract` — passed.
- `pnpm run branch:check` — passed.
- `git diff --check 35b13b026df182725db2e8d428d35ed5891c6f6f..d3a2edf83f8fa1480f29b0f62b062a5481b4f188`
  — passed.

## Handoff

Task 4 is review-passed and may be marked `complete / review-passed` in the
durable ledger. Do not start Task 5 from this review.
