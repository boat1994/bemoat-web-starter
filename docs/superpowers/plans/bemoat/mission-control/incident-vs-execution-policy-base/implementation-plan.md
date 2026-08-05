# Separate Incident and Execution Policy Bases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

**Goal:** Make the exact-incident `bemoat:mission-control:recover-review` transport bind the historical PR base and the live protected-policy execution base as separate identities, so the pinned #274/#275 recovery can be validated without requiring two different commits to be equal.

**Architecture:** Keep `policy_source_sha` as the existing merged-guide source identity, add explicit `incident_base_sha` and `execution_policy_sha` bindings to the recovery domain record and typed receipt, and include both in the deterministic transition identity. The workflow will bind `incident_base_sha` to PR #275's historical `baseRefOid`, bind `execution_policy_sha` to the current protected `main` ref, and load the merged guide from that exact execution SHA before validating the guide source. No legacy one-field receipt may authorize recovery after this change.

**Tech Stack:** Node.js ESM, Vitest, injected GitHub evidence dependencies, GitHub Contents/ref APIs, Mission Control Issue-body CAS/lease projection.

## Global Constraints

- Repository: `boat1994/bemoat-web-starter`.
- Protected base: `main`; the current protected tip at setup is `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.
- Guide policy version: `1.3.0`; observed live guide Contents blob SHA: `e79694467b89dace927c27a1022ec3d260a4a43c`; live protected policy execution commit: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`. The observed blob SHA is evidence, not a substitute for the execution commit.
- Exact incident binding: PR #275 `baseRefOid` / `incident_base_sha` is `88b306c7e055751f78b9ced5922607eee2d1037f`.
- Exact incident head: PR #275 `headRefOid` is `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`.
- The recovery transport must never require `incident_base_sha === execution_policy_sha`; it must validate each against its own authoritative source.
- Do not execute `bemoat:mission-control:recover-review` against live Issue #274 or PR #275.
- Do not mutate Issue #274, PR #275, Issue #276, Campaign #215 Slice 5, child projects, deployments, migrations, production access, or retained data.
- Use only pinned/simulated #274/#275 fixtures and injected dependencies in tests.
- Do not modify the ordinary `bemoat:mission-control:review` ownership or broaden recovery into a generic comment-repair API.
- A legacy receipt containing only `protected_base_sha` is ambiguous and must fail closed rather than be silently reinterpreted.

---

## Required Source Inputs

- `docs/mission-control/mission-control-guide.md`
- `docs/mission-control/command-reference.md`
- `docs/agent-loop/project-progress-tracking.md`
- `scripts/mission-control/domain/review-recovery.mjs`
- `scripts/mission-control/workflows/recover-review.mjs`
- `scripts/mission-control-reconcile.mjs`
- `scripts/mission-control-review.mjs`
- `scripts/mission-control-merge.mjs`
- `tests/int/mission-control-recover-review.int.spec.ts`

## Current Defect and Binding Contract

The current recovery workflow has one field, `protected_base_sha`, and line
342 of `scripts/mission-control/workflows/recover-review.mjs` requires both the
live protected `main` ref and `pr.baseRefOid` to equal it:

```js
if (String(protectedBase.sha ?? protectedBase.object?.sha) !== record.protected_base_sha || pr.baseRefOid !== record.protected_base_sha) {
  throw stateConflict('protected base SHA differs from the recovery record')
}
```

That equality is impossible for the pinned incident after PR #278:

- `incident_base_sha`: `88b306c7e055751f78b9ced5922607eee2d1037f` from PR #275 `baseRefOid`.
- `execution_policy_sha`: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf` from the current protected `main` ref.

The existing `policy_source_sha` remains a third, distinct merged-guide source
identity. It must not be used as either base commit, and it must not replace
`execution_policy_sha`. Task workers must preserve the existing
`guide_source_sha`/`policy_source_sha` contract rather than silently
reinterpreting one as the other.

## File and Interface Map

- `scripts/mission-control/domain/review-recovery.mjs`
  - Owns the recovery record schema, canonical serialization, field validation,
    receipt marker parsing/rendering, and recovery evidence detector.
  - Replace the ambiguous recovery binding with `incident_base_sha` and
    `execution_policy_sha`; keep `policy_source_sha` as the existing
    merged-guide source identity.
  - Ensure the canonical serialized record and its
    `transition_identity_sha256` include both base identities.
- `scripts/mission-control/workflows/recover-review.mjs`
  - Owns CLI parsing, live evidence loading, exact incident preflight, policy
    loading, receipt validation, and idempotent projection.
  - Compare PR `baseRefOid` only to `incident_base_sha`.
  - Compare the live protected `main` ref only to `execution_policy_sha`.
  - Load `docs/mission-control/mission-control-guide.md` at the exact
    `execution_policy_sha`, not at the historical incident base and not from a
    moving ref after the execution SHA has been established.
- `scripts/mission-control-review.mjs`,
  `scripts/mission-control-reconcile.mjs`, and
  `scripts/mission-control-merge.mjs`
  - Continue consuming the shared recovery detector and receipt parser without
    creating a second recovery schema. Update only if the new receipt contract
    requires a directly affected call-site assertion.
- `tests/int/mission-control-recover-review.int.spec.ts`
  - Owns pinned characterization, domain/receipt, negative policy-loading,
    integration, retry, and idempotency coverage. All GitHub behavior is
    simulated through injected dependencies.
- `docs/mission-control/command-reference.md`
  - Documents the two-base recovery contract and the explicit prohibition on
    live recovery during this hotfix.

## Tasks

### Task 1: Characterize the impossible one-field binding

**Files:**
- Modify: `tests/int/mission-control-recover-review.int.spec.ts`
- Do not modify production files in this task.

**Interfaces:**
- Consumes the current `buildRecoveryRecord`, `renderRecoveryReceipt`, and
  `runReviewRecovery` interfaces.
- Produces a pinned failing test that proves the current single-field equality
  cannot accept `PR #275 baseRefOid = 88b306...` together with live protected
  `main = ce8d67...`.

- [ ] **Step 1: Add pinned divergent-base constants and a full simulated recovery evidence fixture.**

Use these exact constants in the test fixture:

```ts
const INCIDENT_BASE_SHA = '88b306c7e055751f78b9ced5922607eee2d1037f'
const EXECUTION_POLICY_SHA = 'ce8d67b19c6c5d210024434f532dcc32ebdc6daf'
```

Build the existing v1 record with `protected_base_sha: INCIDENT_BASE_SHA`,
`policy_source_sha: 'e'.repeat(40)`, and the already pinned #274/#275 head,
source-comment, lineage, finding, and exact-head check values. Inject
dependencies that return:

- PR #275 with `baseRefName: 'main'`, `baseRefOid: INCIDENT_BASE_SHA`,
  `headRefOid: INCIDENT_HEAD`, and `state: 'OPEN'`.
- Protected `main` with `sha: EXECUTION_POLICY_SHA`.
- The guide contents response and managed state with the same synthetic
  guide-source SHA (`'e'.repeat(40)`), so the test reaches the isolated
  base-binding failure rather than an unrelated source-identity failure.
- Issue #274 in exact `AWAITING_REVIEW_2`, counters `1/1`, and the existing
  pinned active/head/lineage fields.
- Pinned source comments, original Review 1, correction RESULT, and successful
  exact-head `CI`/`CI (starter strict)` checks.

- [ ] **Step 2: Assert the intended divergent-base behavior.**

Call `runReviewRecovery` with the complete canonical recovery body and assert
that it resolves to the recovery result rather than rejecting the evidence:

```ts
await expect(runReviewRecovery({ options, body, deps })).resolves.toMatchObject({
  outcome: 'RECOVERED',
})
```

Do not call the production CLI, `gh`, or any live recovery command.

- [ ] **Step 3: Run only the characterization test and record the expected failure.**

Run:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "accepts divergent incident and execution bases"
```

Expected result before any production edit: `FAIL` with the current
`STATE_CONFLICT: protected base SHA differs from the recovery record`. This
failure is the required proof of the defect. Do not make a production change
or convert the test to a passing assertion in Task 1.

### Task 2: Separate recovery bindings through the domain, receipt, and identity

**Files:**
- Modify: `scripts/mission-control/domain/review-recovery.mjs`
- Modify: `tests/int/mission-control-recover-review.int.spec.ts`

**Interfaces:**
- Consumes the Task 1 fixture and current recovery transport call sites.
- Produces a versioned recovery record containing independent
  `incident_base_sha`, `execution_policy_sha`, and existing `policy_source_sha`
  values; a parser/renderer that round-trips those fields; and a transition
  identity that changes when either base binding changes.

- [ ] **Step 1: Replace the ambiguous schema field with two explicit commit bindings.**

Use `incident_base_sha` for the historical PR base and `execution_policy_sha`
for the protected execution ref. Keep both as required full 40-character SHAs.
Do not add an equality check between them. Keep `policy_source_sha` as the
existing merged-guide source identity.

Because an old v1 receipt cannot say which meaning its
`protected_base_sha` had, advance the receipt schema/marker version and reject
v1 receipts rather than accepting or migrating them implicitly. Preserve the
existing fixed repository, Issue #274, PR #275, review, lineage, finding, and
counter invariants.

- [ ] **Step 2: Include both base fields in canonical record construction and identity.**

`buildRecoveryRecord` must normalize both fields to lowercase before
serialization. `stableRecoverySerialize` must see both fields, and
`transition_identity_sha256` must be computed over the complete record without
the identity field. A record with only one of the two fields must fail closed.

- [ ] **Step 3: Update receipt rendering, parsing, and shared evidence detection.**

Render the new receipt marker/schema, parse exactly one receipt, validate both
base fields, and ensure `detectUnaccountedReviewEvidence` only quarantines the
two pinned raw comments after a valid receipt with the complete two-base
identity exists. Preserve ordinary parser behavior and the
`NONCANONICAL_ROLE_EVIDENCE` stop condition.

- [ ] **Step 4: Add domain and receipt tests.**

Cover round-trip preservation of both fields, rejection of missing/short/legacy
bindings, acceptance when the two valid SHAs differ, and identity changes when
only `incident_base_sha` or only `execution_policy_sha` changes. Run:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "recovery record|receipt|identity|quarantines"
```

Expected result: the Task 1 characterization passes only after the workflow
changes in the next task are complete; domain/receipt tests pass immediately
after this task.

### Task 3: Load and validate protected policy from the execution-policy SHA

**Files:**
- Modify: `scripts/mission-control/workflows/recover-review.mjs`
- Modify: `tests/int/mission-control-recover-review.int.spec.ts`

**Interfaces:**
- Consumes the Task 2 record/receipt fields.
- Produces live-evidence validation that independently checks historical PR base,
  current protected execution base, and guide content loaded at the exact
  execution SHA.

- [ ] **Step 1: Split the current protected-base equality check.**

Replace the one-field check at
`scripts/mission-control/workflows/recover-review.mjs:342-344` with:

```js
const liveExecutionPolicySha = String(protectedBase.sha ?? protectedBase.object?.sha)
if (pr.baseRefOid !== record.incident_base_sha) {
  throw stateConflict('incident base SHA differs from the recovery record')
}
if (liveExecutionPolicySha !== record.execution_policy_sha) {
  throw stateConflict('execution policy SHA differs from the recovery record')
}
```

The two checks must remain independent: a mismatch in either one fails closed,
and equality between them must neither be required nor treated as an error.

- [ ] **Step 2: Bind policy loading to the exact execution commit.**

After verifying the live protected ref, call `readPolicySource` with
`record.execution_policy_sha` (or the verified identical live execution SHA),
not `record.incident_base_sha` and not an unpinned `main` ref. Keep the existing
`policy_source_sha` and managed `guide_source_sha` validation contract intact;
do not compare a commit SHA to a Contents blob SHA merely because both are
called “source.” Make the injected dependency signature expose the requested
ref so tests can prove the loader used the execution SHA.

- [ ] **Step 3: Preserve downstream receipt and transition behavior.**

Ensure the workflow passes the validated two-base record through existing
`Coordinator` idempotency, Issue-body CAS/lease, postcondition verification,
and `projectReviewVerdictState` calls. The resulting state must still be
`ELIGIBLE_FOR_FOUNDER_REVIEW` with counters `2/1`; the transition identity must
be the identity of the complete two-base receipt.

- [ ] **Step 4: Add protected-policy negative tests.**

Using simulated dependencies only, prove fail-closed behavior for:

1. PR #275 `baseRefOid` changed while `execution_policy_sha` is correct.
2. Protected `main` changed while `incident_base_sha` is correct.
3. The loader is asked to read the guide at `incident_base_sha`.
4. The loader is asked to read the guide at a moving `main` ref rather than the
   verified execution SHA.
5. The guide-source identity or managed `guide_source_sha` differs from the
   receipt under the existing contract.

Run:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "execution policy|incident base|policy source|fail closed"
```

Expected result: each negative case rejects with `STATE_CONFLICT`, and no
comment or Issue-body write is attempted.

### Task 4: Run pinned #274/#275 integration and idempotency regressions

**Files:**
- Modify: `tests/int/mission-control-recover-review.int.spec.ts`
- Inspect, and modify only if directly required by the shared receipt contract:
  `scripts/mission-control-review.mjs`,
  `scripts/mission-control-reconcile.mjs`,
  `scripts/mission-control-merge.mjs`

**Interfaces:**
- Consumes the corrected domain and workflow contract.
- Produces a complete simulated recovery proof without any live GitHub
  mutation, including deterministic retry and ambiguous POST recovery.

- [ ] **Step 1: Pin the incident and execution tuple in the integration fixture.**

The fixture must retain:

- Issue #274, PR #275.
- Historical incident base `88b306c7e055751f78b9ced5922607eee2d1037f`.
- Execution policy base `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`.
- Corrected head `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`.
- Prior reviewed head `301ae166052af036ce4d727be59d8d20cc8c02d1`.
- Raw source comment IDs `5187836238` and `5187837555`.
- Existing original-review and correction-RESULT lineage IDs from the fixture.

- [ ] **Step 2: Prove successful projection with divergent bases.**

Run `runReviewRecovery` against injected Issue/PR/comment/check/ref/policy
fixtures. Assert the result is `RECOVERED`, the only posted comment contains
one valid typed receipt, the projected state is `ELIGIBLE_FOR_FOUNDER_REVIEW`
with `2/1` counters, the current and last-reviewed heads are the corrected
head, and no source comment body is changed.

- [ ] **Step 3: Prove deterministic identical retry.**

Run the same request against the already projected state and receipt. Assert
`NO_OP`, the same receipt comment identity, unchanged state, and zero additional
comment posts.

- [ ] **Step 4: Preserve ambiguous POST recovery.**

Keep the existing one-post-only ambiguous network response fixture. Assert that
the exact typed receipt is found and recovered on retry without a duplicate
comment or a second state transition.

- [ ] **Step 5: Run the focused integration suite.**

Run:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts
```

Expected result: the complete focused suite passes using fixtures/injected
dependencies only. Do not invoke `pnpm run bemoat:mission-control:recover-review`
with live Issue #274 values.

### Task 5: Update the recovery transport contract only as needed

**Files:**
- Modify: `docs/mission-control/command-reference.md`
- Modify only if the contract guard requires a synchronized phrase or fixture:
  `scripts/guards/mission-control-contract/scan-command-reference.mjs`

**Interfaces:**
- Consumes the corrected recovery receipt and preflight semantics.
- Produces agent-facing documentation that distinguishes historical incident
  base, execution policy base, and policy-content/blob identity.

- [ ] **Step 1: Document the three distinct policy/base identities.**

In the recovery section, state that:

- `incident_base_sha` is PR #275 `baseRefOid`;
- `execution_policy_sha` is the live protected `main` commit used to load the
  merged guide for this execution;
- `policy_source_sha` remains the existing merged-guide source identity;
- no equality between the incident and execution commits is required;
- the exact policy SHA/ref must be re-read and verified before any mutation.

- [ ] **Step 2: Preserve the exceptional route boundary and prohibitions.**

Keep `recover-review` restricted to the pinned #274/#275 incident, keep
ordinary `review` as the sole ordinary REVIEW_VERDICT owner, and explicitly
retain the prohibition on executing recovery during this hotfix setup or
against live historical artifacts.

- [ ] **Step 3: Run contract and documentation validation.**

Run:

```bash
pnpm run guard:mission-control-contract
pnpm run guard:safety
git diff --check
```

Expected result: all guards pass with no generated inventory drift and no
production behavior exercised.

### Task 6: Whole-branch verification (reviewer only)

**Files:**
- Review all branch changes; do not add implementation changes in this task.

**Interfaces:**
- Consumes the completed Tasks 1–5 evidence and the durable ledger.
- Produces an independent whole-branch verdict covering the exact two-base
  contract, security/fail-closed behavior, idempotency, scope, and validation.

- [ ] **Step 1: Verify the branch and changed-file scope.**

Confirm the branch is the isolated
`hotfix/incident-vs-execution-policy-base` worktree from starting SHA
`ce8d67b19c6c5d210024434f532dcc32ebdc6daf`, and that no forbidden Issue,
production, child-sync, migration, deployment, or retained-data operation was
run.

- [ ] **Step 2: Verify the exact contract.**

Review the domain, workflow, shared detector call sites, tests, and command
reference. Prove that `incident_base_sha`, `execution_policy_sha`, and the
existing `policy_source_sha` have non-overlapping meanings; both base SHAs
enter the receipt and transition identity; the guide is loaded from the
verified execution SHA; and legacy/mismatched evidence fails closed.

- [ ] **Step 3: Run the full required validation set.**

Run:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts
pnpm run guard:mission-control-contract
pnpm run guard:safety
PAYLOAD_SECRET=ci-validation-placeholder pnpm run check
git diff --check
```

Expected result: focused recovery tests, Mission Control contract guards,
safety guards, lint/typecheck/integration checks, and whitespace checks all
pass on the exact branch head. No live recovery command is an allowed
verification step.

- [ ] **Step 4: Record the reviewer result in the ledger.**

Update the plan-owned SDD ledger with exact command results, changed-file
scope, remaining risks, and the reviewer verdict. Do not dispatch Task 1 or
perform merge, deploy, migration, child sync, or live incident recovery from
the reviewer task.

## Acceptance Criteria Audit

1. `Done` only when the domain, parser, validator, receipt, and transition
   identity carry independent `incident_base_sha` and `execution_policy_sha`.
2. `Done` only when PR #275 `baseRefOid` is validated against
   `incident_base_sha` and live protected `main` is validated against
   `execution_policy_sha`, with no equality requirement between them.
3. `Done` only when the guide is loaded from the exact verified
   `execution_policy_sha` and its content identity remains separately checked.
4. `Done` only when negative tests fail closed for stale incident base, stale
   execution policy, wrong policy ref, wrong guide content, missing fields, and
   legacy one-field receipts.
5. `Done` only when pinned #274/#275 simulated integration proves successful
   projection, exact receipt lineage, no source mutation, deterministic
   `NO_OP`, and ambiguous POST recovery without duplicate comments.
6. `Done` only when the transport documentation preserves the exceptional
   #274/#275 boundary and ordinary review ownership.
7. `Waiting for CI / human review` until Task 6 independently reviews the full
   branch and any required GitHub exact-head checks are available.

## Stop Conditions and Risks

- Stop immediately on any live GitHub evidence conflict, unexpected worktree
  change, or request to run recovery against #274/#275.
- Stop if a proposed compatibility path would silently reinterpret an old
  `protected_base_sha`; require explicit schema/version rejection instead.
- Stop if a change expands the route beyond the exact approved incident.
- The main remaining risk is policy identity confusion between the execution
  commit (`execution_policy_sha`) and the existing guide-source identity
  (`policy_source_sha`); tests must assert both the value and the requested
  policy ref without changing the existing source-field semantics.
- The current protected main tip may advance before implementation. Task
  workers must re-read live protected main for normal execution evidence, while
  preserving the pinned simulated tuple for regression tests. This does not
  authorize live recovery.

## Execution Handoff

The controller setup creates the isolated worktree and this plan, then records
the exact starting SHA and Task 1 gate in the plan-owned SDD ledger. Mission
Control must dispatch Task 1 separately; this setup run does not implement its
failing tests.
