# Task 3 Review — Load Policy From Execution Policy SHA

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
- Exact scope:
  `git diff d840bc3f7bef0a1ff2fea82ff68cc69328900917..d5238c4bdfc84b76fb82bdaf95c3ed5958da2e55`
- Review-start worktree: clean

## Verdict

`FAIL`

The implementation correctly separates historical incident lineage from the
execution-policy SHA and passes the focused suite. It does not yet establish
that the code performing the recovery is the trusted protected implementation,
and its child-override check can be bypassed by ordinary structured override
syntax.

## Blocking findings

### [P1] Verify the actual executing checkout instead of self-generated evidence

`scripts/mission-control/workflows/recover-review.mjs:94-103,652-680`

`assertExecutionPolicyEvidence` treats `policy.executing_checkout` as authority,
but `createProductionDeps().readPolicySource` constructs that object directly
from the requested `ref`:

```js
executing_checkout: {
  ref: 'refs/heads/main',
  sha: ref,
  based_on_sha: ref,
},
```

There is no `git rev-parse`, local file/blob verification, or other trusted
evidence tying the checkout that is actually running
`runReviewRecovery` to `execution_policy_sha`. A recovery command launched from
stale, task-branch, or otherwise altered local code can therefore pass the
policy-file checks and mutate the incident even though the executing code is
not the code validated at the protected SHA. The implementation also only
accepts `main` with `sha === based_on_sha === execution_policy_sha`, so it does
not implement the required authorized-hotfix-based-on-protected-commit case.

Required fix: obtain execution-checkout identity from a trusted source rather
than constructing it from the policy request. Verify that the actual checkout
and the recovery implementation being executed are the trusted protected
implementation at `execution_policy_sha`, or an explicitly authorized hotfix
whose ancestry and authorization are bound to that SHA. Reject stale,
unrelated, or unverifiable checkouts before any comment or Issue-body write.
Add injected tests for a mismatched checkout, an unrelated hotfix, and the
authorized protected-based hotfix case; each negative case must assert zero
mutation.

### [P1] Reject all relaxing child-override forms, not only selected prose

`scripts/mission-control/workflows/recover-review.mjs:82-91`

`childOverrideRelaxesSharedInvariants` is a line-oriented regex heuristic and
accepts any nonempty override that does not match one of seven phrases. Common
structured forms based on the repository's YAML example bypass it, including:

```yaml
allow_auto_merge: true
remove_exact_head_checks: true
minor_nit_blocking: true
allow_destructive_migrations: true
chat_history_authoritative: true
allow_silent_state_reset: true
```

Those values directly relax invariants that the example marks forbidden, yet
the workflow would accept them and proceed to recovery mutation. Similar
alternate keys or wording can bypass the current patterns as well.

Required fix: parse the child override and validate its semantics against an
explicit shared-invariant schema/allowlist, rejecting forbidden values,
unsupported keys, and unparseable content by default. If a textual policy is
retained, it must cover the documented structured forms and fail closed on
unknown declarations rather than treating regex non-matches as safe. Add
negative tests for each documented forbidden invariant and at least one
unparseable/unknown override, with zero comment posts and zero Issue-body
writes.

## 1. Specification compliance

The workflow now:

- compares PR `baseRefOid` only with `incident_base_sha`;
- compares the protected `main` tip only with `execution_policy_sha`;
- calls `readPolicySource` with the verified execution SHA;
- keeps `policy_source_sha` as the guide Contents/blob identity; and
- avoids historical incident-base guide loading or equality checks.

Those parts satisfy the policy-vs-incident separation. The execution-checkout
and child-override requirements are not fully satisfied, so the Task 3
specification is incomplete.

## 2. Code quality

The change has a clear validation helper and keeps policy loading after the
independent base checks and before projection. The production loader requests
the guide, recovery facade, recovery workflow, transport registry, and optional
child override at the exact execution ref.

The main maintainability concern is that the policy evidence shape mixes
authoritative fetched content with a checkout object synthesized by the loader.
The checkout object should represent independently observed execution state,
not metadata manufactured from the same requested ref. The child-override
regexes similarly encode a partial policy parser without a closed-world
contract.

## 3. Security and authority invariants

The independent incident/execution binding is preserved. Existing state,
lineage, source-comment, exact-head, and no-write-on-preflight-failure checks
remain in place, and the focused negative tests confirm no mutation for their
covered failures.

The two P1 findings leave authority gaps: the running implementation is not
bound to the trusted policy commit, and a child override can relax shared
requirements while passing the new check. Both must be fixed before recovery
can be authorized.

## 4. Test adequacy

Independent focused evidence:

- `pnpm exec vitest run tests/int/mission-control-recover-review.int.spec.ts`
  — 15 passed.
- `pnpm run guard:safety` — passed.
- `pnpm run guard:mission-control-contract` — passed.
- `pnpm exec eslint scripts/mission-control/workflows/recover-review.mjs tests/int/mission-control-recover-review.int.spec.ts --max-warnings 0`
  — passed.
- `ReadLints` on the changed workflow and test — no errors.
- `git diff --check` — passed.

The positive fixture records a synthetic execution checkout and omits guide
content, so it does not independently prove actual checkout identity or exercise
the guide frontmatter/invariant scanner. The negative suite tests one child
override spelling and only the missing facade variant; it should be expanded
with the cases specified in the blocking findings.

## 5. Scope discipline

No Task 4/5 production expansion, live recovery, migration, deployment, child
project, or retained-data operation was found. The exact head also includes
retained Task 2 review artifacts, but those are documentation evidence rather
than runtime scope expansion.

## Review conclusion

Task 3 remains `in_progress` and is not review-passed. Do not mark the ledger
complete and do not start Task 4 until both blocking findings are corrected and
independently re-reviewed.
