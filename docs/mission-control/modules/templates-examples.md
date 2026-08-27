> The examples below are historical migration-only RESULT/REVIEW_VERDICT and
> managed-state records. Current cross-agent transport is `bemoat:handoff`
> after `bemoat:context`; do not copy these examples for new work.

## Compact transition examples

### Delivery success (Delivery Coordinator)

```markdown
## RESULT
**Completed:** Dev (implementation)
**PR:** <PR_URL> · head `<sha>`
**Managed state:** AWAITING_REVIEW_1 · PR #N · `<sha>` · counters unchanged (0/0)
**Next:** Reviewer `## REVIEW_VERDICT` on exact head
```

### Review eligibility after verdict

```markdown
## REVIEW_VERDICT
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
**Managed state:** ELIGIBLE_FOR_FOUNDER_REVIEW · cycle 3 · last_reviewed_head `<sha>`
**Next:** Founder merge authorization
```

### Founder merge success

```markdown
Merged PR #N at verified head `<sha>` → merge commit `<merge_sha>`.
Managed state: DONE. Migration/deploy not authorized in this transition.
```

### Safe merge completion bundle

```markdown
Repository: owner/repository
Task Issue: #N · PR: #N
Authority: comment <immutable-comment-id> · author @founder · scope `merge` · action `merge` · bundle `merge-completion`
Policy/source/base/head: version `1.3.0` · merged-policy source `<exact-merged-policy-source-sha>` (full 40-hex) · protected base `main@<exact-protected-base-sha>` (full 40-hex) · reviewed head `<exact-reviewed-head>` (full 40-hex)
Exact-head CI: <required-check-links> passed for `<exact-reviewed-head>`
Review verdict: `ELIGIBLE FOR FOUNDER REVIEW` · comment <verdict-comment-id> · not superseded
Objective: merge this exact reviewed PR and complete the Task/campaign terminal projection.
Stop before mutation on: authority, head, CI, verdict, mergeability, protected-base,
CAS, or lease drift; ambiguous/conflicting evidence also stops fail-closed.
Prohibited: implementation, independent review, new merge approval, Review 4,
migration, deploy, production access, child sync, retained-data mutation, or
starting the next campaign action.
Execute: verify evidence → merge with expected-head protection → verify the
protected-base merge commit `<merge_sha>` → post final RESULT → close Task #N
→ write Task DONE → project campaign slice DONE → select next action with
`started: false`.
Reconcile separately only after projection failure, ambiguous/conflicting
evidence, unavailable evidence, or a concurrent write.
```

### Terminal closure

Task #N closed DONE. Active PR merged; exact-head CI and review gates satisfied.
Next permitted action: none on this task.

## Worked examples

### Small correction after Review 1

Review 1 completed on head A with enumerated blockers. Dev pushes head B fixing
those findings. Mission Control increments to Review 2 (delta), not a new full
review. Reviewer inspects enumerated findings, B-minus-A delta, and exact-head
checks only.

### REVIEW_VERDICT canonical PR target (Issue #175)

Put the live review target only on the `PR / base / head` field. Prose may mention
historical, dependency, prohibited, or downstream pull requests without becoming
alternate target identity. Finding `source_thread` links must still reference the
same canonical PR.

### Third-cycle nit

Review 3 with checks green and no Blocker/Critical. A naming nit becomes a
follow-up Issue. Task becomes `ELIGIBLE FOR FOUNDER REVIEW`.

### Verified blocker remains after Review 3

One proven Blocker/Critical remains → `BLOCKED FOR FOUNDER DECISION`. No Review
4. Mission Control returns the lean Approve/Decline card only — no Suggested
model or Ready-to-paste prompt yet.

### Founder Approves a blocked exception

Founder replies **Approve** to the named exception. Mission Control writes
durable GitHub authorization, emits a compact `## HANDOFF` for that named step
only, and moves managed state to `IN_PROGRESS`. Review 4, merge, migration, and
deploy remain unauthorized unless the named decision explicitly includes them.

### Founder Declines a blocked exception

Founder replies **Decline**. Mission Control records stop/closure
(`BLOCKED_FOR_FOUNDER_DECISION` → `DONE` or a follow-up Issue only) with no
implementation prompt.

### New session mid-task

Fresh chat reads GitHub state block and continues at the recorded cycle. Chat
history is never authoritative.

### Multi-step technical design brainstorm (remote E2E cleanup)

Mission Control is choosing fixture and cleanup policy for remote automated E2E
in a child repository. No implementation is authorized yet.

```markdown
## BRAINSTORMING

## Brainstorming objective

Select a deterministic fixture cleanup policy before authorizing implementation.

## Confirmed context

- Child repo runs Playwright against staging.
- Issue scope is orchestration policy only; no code changes are authorized yet.
- Guide version `1.2.0` on approved base `main`; child override: none.

## Current design decisions

- Prefer per-test isolation over shared mutable fixtures until flake data exists.

## Options and trade-offs

- **Option A — truncate after each spec:** slower runs, simplest mental model.
- **Option B — seeded baseline snapshot:** faster reruns, higher setup and drift risk.

## Recommendation

Start with Option A and measure flake rate before optimizing for speed.

## Open question

Should cleanup run in `afterEach` or a dedicated teardown worker?

## Durable GitHub impact

None

## Do not do yet

- create a branch, commit, or PR;
- post `## HANDOFF`, `## RESULT`, or `## REVIEW_VERDICT`;
- update managed state or review counters;
- treat `approve` on the recommendation as implementation authorization.
```

Founder reply `approve` approves only the Option A recommendation. Mission
Control remains in brainstorming until the Founder later says `start dev` or
another explicit implementation authorization phrase.
