# Task 2 Brief — Separate Recovery Bindings

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

## Task identity

- Worktree: `/home/boat/projects/.worktrees/bemoat-web-starter-hotfix-incident-policy`
- Branch: `hotfix/incident-vs-execution-policy-base`
- Starting protected base: `ce8d67b19c6c5d210024434f532dcc32ebdc6daf`
- Task status: `in_progress`; the ledger must not be advanced to complete by
  this implementer.

## Goal

Replace the ambiguous single `protected_base_sha` recovery binding with two
required, independently meaningful commit identities:

- `incident_base_sha`: the immutable historical PR base, derived from PR #275
  `baseRefOid` and used only to bind the incident lineage.
- `execution_policy_sha`: the current protected `main` commit used as the
  trusted recovery-policy execution identity and carried into the receipt and
  transition identity.

`policy_source_sha` remains the separate merged-guide content/source identity.
The domain and receipt contract must accept valid divergent incident and
execution SHAs without adding an equality requirement.

## Required implementation

Modify only the recovery domain and its focused test fixture for production
behavior:

1. Advance the recovery receipt/schema marker version so the old v1
   `protected_base_sha` receipt cannot be mistaken for the new contract.
2. Require both `incident_base_sha` and `execution_policy_sha` as full,
   normalized lowercase 40-character SHAs.
3. Preserve all existing fixed repository, issue, PR, review, lineage,
   findings, counters, exact-head CI, managed-state, and policy-source
   invariants.
4. Include both fields in canonical record serialization and recompute
   `transition_identity_sha256` from the complete record without the identity
   field.
5. Render and parse exactly one new-version receipt containing both fields.
   A missing field, malformed field, legacy one-field receipt, or ambiguous
   `protected_base_sha` record must fail closed; never reinterpret the legacy
   field silently.
6. Keep shared evidence detection dependent on a fully valid typed receipt and
   preserve `NONCANONICAL_ROLE_EVIDENCE` behavior.

Task 3 owns workflow loading/verification of the guide at the exact execution
SHA. Task 2 must not broaden into that policy-loading rewrite, but the model
must expose the fields needed by that follow-up.

## Pinned fixture contract

The existing simulated recovery fixture remains authoritative:

```text
incident_base_sha:
88b306c7e055751f78b9ced5922607eee2d1037f

execution_policy_sha:
ce8d67b19c6c5d210024434f532dcc32ebdc6daf

policy_source_sha:
eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
```

The fixture must continue to preserve Issue #274 / PR #275, corrected exact
head `c44bf1bc379fe4160946dce96e5a4d7abae7b5b0`, prior reviewed head,
source-comment hashes, original Review 1, correction `RESULT`, findings
`MC-R1-001` through `MC-R1-007`, counters `1/1 -> 2/1`, and successful exact
head checks. Update the fixture record assertions from the old
`protected_base_sha` field to the two explicit fields; leave the end-to-end
workflow success assertion red until Task 3 updates the workflow equality
guard.

## Test-first plan

Add or update focused tests before production changes and observe the expected
failures:

- build/validate/render/parse round-trip preserves both independent fields;
- valid divergent SHAs are accepted;
- missing, short, and legacy `protected_base_sha` bindings fail closed;
- changing only `incident_base_sha` changes the transition identity;
- changing only `execution_policy_sha` changes the transition identity;
- shared evidence quarantine still requires the valid two-base receipt.

Run the focused domain/receipt selector:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts -t "recovery record|receipt|identity|quarantines"
```

The complete focused recovery suite and Task 1 success path are expected to be
completed by later tasks after workflow policy loading is split:

```bash
pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts
```

## Scope boundaries and prohibitions

- Do not modify workflow policy loading or live protected-ref verification;
  those are Task 3.
- Do not perform Task 4 integration/idempotency expansion or Task 5 transport
  documentation changes.
- Do not invoke the production CLI, `gh`, or live recovery against #274/#275.
- Do not mutate Issues #274/#275/#276, Campaign #215 Slice 5, child projects,
  deployments, migrations, production, or retained data.
- Do not weaken unrelated fail-closed validation.
- Do not accept or migrate legacy `protected_base_sha` receipts implicitly.

## Validation and handoff

Run focused tests, lint the changed code/test files with zero warnings,
`ReadLints` on edited files, `pnpm run guard:safety`, and `git diff --check`.
Run the full `pnpm run check` only if it is practical after the focused
contract is green; report any pre-existing or documentation-only guard issue
precisely. Review the final diff for scope and create exactly one local,
focused Task 2 commit. Do not push or mark Task 2 complete in the ledger.

The implementer report must state the commit, exact tests and results, changed
files, legacy receipt handling, remaining Task 3 dependency, and any concerns.
