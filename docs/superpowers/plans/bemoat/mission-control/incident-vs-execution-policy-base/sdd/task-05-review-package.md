# Task 5 Review Package — Documentation and Transport Contract

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
- Task 5 base: `d3a2edf83f8fa1480f29b0f62b062a5481b4f188`
- Task 5 head: `c7c247722413559b10f6f03d8cf70f2ae8d9da2c`
- Exact review diff:
  `git diff d3a2edf83f8fa1480f29b0f62b062a5481b4f188..c7c247722413559b10f6f03d8cf70f2ae8d9da2c`
- Review-start worktree: clean
- Review artifacts: intentionally uncommitted

The Task 4 base resolves to
`d3a2edf83f8fa1480f29b0f62b062a5481b4f188`, matching the reported parent
and the parent of the reviewed Task 5 head.

## Exact Task 5 delta

Contract/documentation surfaces:

- `scripts/mission-control/transport-registry.mjs`
- `scripts/mission-control/domain/review-recovery.mjs`
- `docs/mission-control/command-reference.md`
- `docs/agent-loop/role-handoff-contract.md`

Plan-owned SDD evidence:

- `sdd/progress-ledger.md`
- `sdd/task-04-review-package.md`
- `sdd/task-04-review.md`
- `sdd/task-05-brief.md`
- `sdd/task-05-implementer-report.md`

The only runtime-file changes are explanatory comments and the pinned
`#274/#275` purpose wording in the transport registry. No recovery behavior,
ordinary review ownership, migration, deployment, child project, or live
GitHub artifact changed.

## Independent review

### 1. Specification compliance

PASS. The command reference and agent-facing receipt contract explicitly
distinguish:

- `incident_base_sha` as PR #275 `baseRefOid` and historical managed-state
  lineage only;
- `execution_policy_sha` as the live protected `main` commit used to load and
  verify the trusted recovery policy/transport;
- `policy_source_sha` as the separate merged-guide Contents/blob identity.

The documentation explicitly says the two base SHAs are independent and that
their equality is neither required nor a validation condition. It also
documents the v2 receipt, canonical identity coverage, and fail-closed legacy
`protected_base_sha` behavior.

### 2. Documentation accuracy

PASS. The implementation at the reviewed head independently compares the PR
base with `record.incident_base_sha`, compares the live protected ref with
`record.execution_policy_sha`, and loads policy at the verified execution SHA
in `scripts/mission-control/workflows/recover-review.mjs`. The domain validates
both full base SHAs, preserves `policy_source_sha`, includes the fields in
canonical transition identity, and rejects the ambiguous legacy field.

The added source comments accurately describe those existing semantics and do
not claim a new runtime interface.

### 3. Security and authority invariants

PASS. The recovery route remains exceptional and pinned to the #274/#275
incident. The documents preserve ordinary `review` as the `REVIEW_VERDICT`
owner, require exact v2 receipt evidence, retain fail-closed handling for
legacy or competing evidence, and prohibit generic comment repair. Nothing in
the delta grants a caller authority to bypass policy loading, receipt
validation, lease/CAS projection, or mutation preconditions.

### 4. Test adequacy

Not applicable to new behavior. The Task 5 runtime delta is comments and
registry wording only; Tasks 2–4 already cover the behavior described by these
documents. The documentation and contract guards were rerun independently.

### 5. Scope discipline

PASS. The implementation changes only the approved transport registry,
command reference, receipt documentation, and agent-facing recovery contract,
plus plan-owned SDD evidence. The retained Task 4 review artifacts and Task 5
brief/report are process records, not production behavior changes.

## Acceptance-criteria audit

1. **Done** — `incident_base_sha` and `execution_policy_sha` are explicitly
   distinguished in the command reference, role-handoff contract, registry
   comments, and recovery-domain comment.
2. **Done** — incident identity is historical lineage only; execution identity
   governs trusted policy/transport loading and receipt/transition identity.
3. **Done** — the docs explicitly prohibit requiring SHA equality.
4. **Done** — recovery-specific legacy `protected_base_sha` ambiguity is
   documented as fail-closed, without redefining the unrelated merge record.
5. **Done** — `recover-review` remains a pinned incident-class transport and
   is explicitly not a generic recovery or comment-repair API.
6. **Done** — only the approved contract surfaces and plan-owned SDD evidence
   changed; no unrelated production behavior changed.
7. **Done** — `pnpm run guard:safety` passed, including planning-contract
   marker validation.
8. **Done** — the runtime delta is documentation/comments only.

## Validation evidence

- `git rev-parse --verify c7c247722413559b10f6f03d8cf70f2ae8d9da2c^{commit}` —
  passed.
- `git rev-parse --verify c7c247722413559b10f6f03d8cf70f2ae8d9da2c^` —
  resolved to `d3a2edf83f8fa1480f29b0f62b062a5481b4f188`.
- `pnpm run guard:safety` — passed; all central guards passed, including
  `planning-contract`.
- `pnpm run guard:mission-control-contract` — passed.
- `git diff --check d3a2edf83f8fa1480f29b0f62b062a5481b4f188..c7c247722413559b10f6f03d8cf70f2ae8d9da2c` —
  passed.

No live `bemoat:mission-control:recover-review` command, GitHub mutation,
deployment, migration, child sync, or retained-data operation was run.

## Verdict

`PASS`

No blocking findings. Task 5 may be marked `complete / review-passed` in the
durable ledger. Task 6 remains reviewer-only and was not started.
