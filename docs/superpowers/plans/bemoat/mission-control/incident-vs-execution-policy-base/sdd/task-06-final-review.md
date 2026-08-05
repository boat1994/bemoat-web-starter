# Task 6 Final Review — Whole-Branch Verification

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

## Verdict

`FAIL`

The two-base recovery contract and authority boundaries are correct, but the
required full check cannot pass at the reviewed head because the new focused
test assertions do not type-check.

## Review identity

- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Protected base / starting SHA:
  `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Exact branch HEAD:
  `c7c247722413559b10f6f03d8cf70f2ae8d9da2c`
- Reviewed range:
  `git diff ce8d67b19c6c5d210024434f532dcc32ebdc6daf...HEAD`
- Committed diff: 32 paths; no forbidden scope paths

## Blocking finding

### [P1] MC-T6-001 — Full check fails focused-test typecheck

**Location:** `tests/int/mission-control-recover-review.int.spec.ts:639,641,660,674,877`

The fixture stores issue comments as `Array<Record<string, unknown>>`. The
added receipt assertions pass `comment.body` directly to
`parseRecoveryReceipt`, whose parameter is a string. The required command
fails at `tsc --noEmit` with five `TS2345` errors:

```text
Argument of type 'unknown' is not assignable to parameter of type 'string'.
```

**Exact correction:** in the focused test only, give fixture comments a typed
string `body`, or convert every listed parser argument to
`String(comment.body ?? '')` (including `receipts[0].body`). Preserve the
behavioral assertions and do not modify production recovery code.

**Required verification:** rerun
`PAYLOAD_SECRET=secret pnpm run check`,
`pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`,
`pnpm exec vitest run tests/int/mission-control-issue-body-cas.int.spec.ts tests/int/mission-control-reconcile.int.spec.ts`,
and `git diff --check`. One scoped final correction and re-review is sufficient.

## Independent review findings

No other actionable blocking finding was identified.

### Binding and policy authority

- The domain requires independent full `incident_base_sha` and
  `execution_policy_sha` values and preserves `policy_source_sha` separately.
- Canonical serialization and `transition_identity_sha256` include both base
  bindings.
- PR #275 `baseRefOid` is checked only against `incident_base_sha`.
- The protected `main` tip is checked only against `execution_policy_sha`.
- Policy files are requested at the verified execution SHA, not the historical
  incident base or a moving `main` ref.
- The observed executing checkout is required and supports only protected
  `main` or the explicitly authorized hotfix ancestry.
- Guide frontmatter, source identity, version, implementation paths, and
  closed-world child overrides fail closed before mutation.

### Recovery and transition integrity

- Fixed repository, Issue #274, PR #275, expected state, review counters,
  exact head, reviewer, finding IDs, source IDs/hashes, and Review 1 / correction
  RESULT lineage remain enforced.
- Exact-head `CI` and `CI (starter strict)` checks remain required.
- v1 receipts and records carrying ambiguous `protected_base_sha` are rejected.
- Exactly one v2 receipt is parsed; malformed or duplicate receipt evidence
  fails closed.
- Divergent-base recovery, receipt preservation, deterministic `NO_OP`, and
  ambiguous POST recovery pass in the injected focused fixture.
- Later competing canonical evidence remains a pre-mutation `STATE_CONFLICT`.
- Existing Coordinator transition identity, managed-state postconditions, and
  repository-wide lease/CAS writer remain in use.
- Existing planning-lineage, review-counter, managed-state, reconciliation,
  lease, and CAS suites remain green; the branch does not alter those
  implementations.

### Scope and authority boundaries

- `recover-review` remains an exceptional #274/#275 route, not a generic
  recovery or arbitrary comment-repair API.
- Ordinary `bemoat:mission-control:review` remains the ordinary
  `REVIEW_VERDICT` owner.
- No #276, Campaign #215 Slice 5, child sync, deployment, migration,
  production, or retained-data change is present.
- No live recovery or GitHub mutation was run.

## Acceptance criteria audit

1. **Done** — domain, parser, validator, receipt, and identity carry
   independent base fields; focused round-trip and identity tests pass.
2. **Done** — incident base and protected execution base are validated against
   their separate authoritative sources without an equality requirement.
3. **Done** — policy loading uses the exact verified execution SHA while
   `policy_source_sha` remains a separate content identity.
4. **Done** — stale bases, wrong policy ref/source, missing implementation,
   malformed overrides, missing fields, and legacy receipts fail closed in
   focused tests.
5. **Done** — pinned simulated recovery proves projection, receipt lineage,
   source immutability, deterministic `NO_OP`, and ambiguous POST recovery.
6. **Done** — transport documentation preserves the #274/#275 exception and
   ordinary review ownership.
7. **Waiting for CI / human review** — required full check is blocked by
   MC-T6-001; no GitHub exact-head CI exists for this unpushed branch.

## Validation command results

- `pnpm run guard:safety` — PASS.
- `pnpm run guard:mission-control-contract` — PASS.
- `pnpm run branch:check` — PASS.
- `git diff --check` — PASS for working and committed diffs.
- Focused recovery suite — PASS, 22 tests.
- Affected Issue-body CAS and reconciliation suites — PASS, 83 tests.
- `PAYLOAD_SECRET=secret pnpm run test:int` — PASS, 54 files / 1,149 tests.
- `PAYLOAD_SECRET=secret pnpm run check` — FAIL at typecheck; guard and lint
  passed, five TS2345 errors at MC-T6-001.
- `pnpm run test:int` without the requested Payload secret — environment-only
  failure (`missing secret key`); the secret-configured run passed.

## Dirty tree

The worktree was already dirty at review start from Task 5 artifacts:

- modified:
  `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/progress-ledger.md`
- untracked:
  `sdd/task-05-review-package.md`
- untracked:
  `sdd/task-05-review.md`

This review adds the two Task 6 review files and the Task 6 ledger entry. No
implementation fix is included.

## Delivery concerns

- One final scoped correction is required for MC-T6-001 before delivery.
- The branch has no managed Task Issue (`active_task_issue: null`,
  `main_issue: null`). If Mission Control requires managed execution for PR
  delivery, create/link the dedicated Task Issue and record the correct `Refs
  #N` / closure transport before moving to `AWAITING_REVIEW_1`.
- The branch is unpushed and has no PR or GitHub exact-head CI evidence.
- Do not run live recovery, push, open a PR, merge, deploy, migrate, or sync a
  child project from this final review.

## Review files

- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-06-review-package.md`
- `docs/superpowers/plans/bemoat/mission-control/incident-vs-execution-policy-base/sdd/task-06-final-review.md`
