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

### Terminal closure

Task #N closed DONE. Active PR merged; exact-head CI and review gates satisfied.
Next permitted action: none on this task.

## Worked examples

### Small correction after Review 1

Review 1 completed on head A with enumerated blockers. Dev pushes head B fixing
those findings. Mission Control increments to Review 2 (delta), not a new full
review. Reviewer inspects enumerated findings, B-minus-A delta, and exact-head
checks only.

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


