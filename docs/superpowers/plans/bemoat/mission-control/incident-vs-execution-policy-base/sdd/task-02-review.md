# Task 2 Review — Separate Recovery Bindings

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
- Reviewed base: `b0a35215b3e33d08d2217c64739e1a5e879f0aa5`
- Reviewed head: `d840bc3f7bef0a1ff2fea82ff68cc69328900917`
- Exact review scope:
  `git diff b0a35215b3e33d08d2217c64739e1a5e879f0aa5..d840bc3f7bef0a1ff2fea82ff68cc69328900917`
- Review-start worktree: clean

## Findings

No blocking findings.

## Verdict

`PASS`

Task 2 meets its domain and receipt contract. It separates the historical
incident base from the execution-policy base without requiring equality,
preserves the existing policy-content identity, binds both bases into the
transition identity, and rejects the ambiguous v1 binding. The expected
end-to-end red assertion remains at the unchanged Task 3 workflow guard and
is explicitly deferred.

## 1. Specification compliance

The production delta in
`scripts/mission-control/domain/review-recovery.mjs`:

- advances the recovery schema and marker from v1 to v2;
- requires `incident_base_sha` and `execution_policy_sha` as full SHA values;
- lowercases both values during `buildRecoveryRecord`;
- leaves `policy_source_sha` as a separate merged-guide source identity;
- includes both fields in `stableRecoverySerialize` input and therefore in
  `transition_identity_sha256`;
- validates the complete record before rendering or accepting a receipt; and
- keeps the fixed repository, Task Issue #274, PR #275, review lineage,
  findings, counters, source evidence, and exact-head CI checks unchanged.

The changed tests in
`tests/int/mission-control-recover-review.int.spec.ts` demonstrate divergent
values, round-trip parsing, lowercase normalization, independent identity
changes, missing-field rejection, legacy rejection, and receipt-gated
quarantine.

No comparison between the two new fields was added. The exact Task 2 delta does
not modify `scripts/mission-control/workflows/recover-review.mjs`, so the
execution-policy loading rewrite is correctly left for Task 3.

## 2. Code quality

The change is narrow and follows the existing domain boundaries. The versioned
marker prevents accidental cross-version parsing, canonical serialization
continues to sort nested keys, and the identity is calculated from the full
record with only the identity field removed. The legacy rejection is explicit
at both record validation and record construction instead of relying only on a
missing-field side effect.

The parser still requires exactly one v2 marker pair and one JSON fence. Shared
evidence detection accepts only a fully validated typed receipt before
quarantining the two pinned source comments and preserves the existing
`NONCANONICAL_ROLE_EVIDENCE` path.

## 3. Security and authority invariants

Legacy v1 receipts cannot parse under the v2 marker, and the detector
explicitly treats a legacy v1 marker in Issue comments as an invalid recovery
receipt. Records containing `protected_base_sha` are rejected even if the new
fields are also present; records missing either new field fail validation.
`buildRecoveryRecord` refuses legacy input before constructing a v2 record.
There is no silent choice of which meaning to assign to the old field.

The transition digest changes when either independent base binding changes.
This prevents a receipt for one incident/execution tuple from being reused as a
receipt for another tuple. Existing fail-closed checks for repository, fixed
incident IDs, source-comment hashes, author identity, review lineage, finding
IDs, counters, managed-state expectations, and exact-head checks remain in
place.

The two valid bases may be equal or different; equality is neither required
nor treated as an error. No live GitHub recovery or mutation was performed.

## 4. Test adequacy

Independent review validation:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "round-trips|rejects missing|quarantines"`
  passed 3 tests.
- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  produced 8 passing tests and 1 expected failure. The failure is the
  intentionally deferred Task 3 assertion at
  `scripts/mission-control/workflows/recover-review.mjs:343`:
  `STATE_CONFLICT: protected base SHA differs from the recovery record`.
- Targeted ESLint with `--max-warnings 0` passed.
- `pnpm run guard:safety` passed.
- `pnpm run guard:mission-control-contract` passed.
- `git diff --check` passed.
- `ReadLints` reported no errors for the changed production and test files.

The tests do not separately assert short SHA rejection, although the validator
uses the full-length SHA regex and rejects such values. The workflow's
independent live-base checks, exact execution-SHA policy loading, and related
negative cases are intentionally Task 3 work.

## 5. Scope discipline

The only production behavior change is in the recovery domain, with focused
test fixture updates and SDD handoff artifacts. The delta does not include the
full policy-loading rewrite, Task 3 negative suite, Task 4 projection/retry
expansion, broad transport documentation, migrations, deployment, child
projects, retained data, or live incident recovery.

The retained Task 1 review artifacts and the Task 2 brief/report are process
handoff documents for this isolated plan; they do not broaden production
behavior.

## Legacy handling confirmation

Confirmed fail-closed:

1. `validateRecoveryRecord` requires schema v2, requires both new fields, and
   rejects any own `protected_base_sha` property.
2. `buildRecoveryRecord` throws on legacy `protected_base_sha` input.
3. `parseRecoveryReceipt` accepts only the v2 marker/fence and validates the
   resulting record.
4. `detectUnaccountedReviewEvidence` rejects malformed v2 and legacy v1
   recovery markers before source-comment quarantine.

No old field is inferred as either the incident base or execution-policy base.

## Task 3 deferral

Task 3 remains pending. It must independently compare PR #275 `baseRefOid` to
`incident_base_sha`, compare the live protected `main` ref to
`execution_policy_sha`, and request the guide at the verified execution SHA.
The current full-suite failure is the expected proof that this later workflow
change has not been started.

## Review conclusion

Task 2 is `review-passed`. The plan-owned ledger may advance Task 2 to
`complete / review-passed`. Task 3 must not be started as part of this review.
