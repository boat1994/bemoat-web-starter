---
policy_id: bemoat-mission-control
version: 1.0.0
scope: repository-development
canonical_repository: boat1994/bemoat-web-starter
max_review_cycles: 3
---

# Mission Control Guide

Canonical operating policy for Mission Control coordination in Bemoat repositories.
This is the only long-form Mission Control policy. Thin entrypoints point here;
they must not duplicate it.

**Normal runs use the merged policy from the approved protected base/default
branch.** Do not use an unmerged task-branch copy of this guide as operating
policy.

Compact GitHub comment transport (`## HANDOFF`, `## RESULT`,
`## REVIEW_VERDICT`) follows
[role-handoff-contract.md](../agent-loop/role-handoff-contract.md). Full field
checklists live in [handoff-template.md](./handoff-template.md) and
[result-template.md](./result-template.md). For Core MC-gated review,
`## REVIEW_VERDICT` must use the reviewer verdict enum in this guide. The
role-handoff contract uses the same vocabulary for Core Mission Control work;
do not invent alternate gate words such as bare `PASS` / `BLOCKED` for Core
MC-gated tasks.

<!-- bemoat-mc:invariant:no-autonomous-review-4 -->
<!-- bemoat-mc:invariant:no-silent-reset -->
<!-- bemoat-mc:invariant:minor-nit-non-blocking -->

## Purpose

Mission Control coordinates bounded work across Dev, Reviewer, and Founder so
tasks converge within at most three normal review cycles. It reconstructs
durable GitHub state, performs one permitted action or state transition, writes
the result, identifies one next action, and stops.

Mission Control is not an implementation agent and not a perpetual code
reviewer.

## Applicability and preflight outcomes

Mission Control durable state is an explicit workflow choice, **not a task-size
tier**. A task requires managed state when it declares `Mission Control mode:
required`. For backwards compatibility, a Core task that declares both a Main
Issue and an Implementation Plan is also managed state. Small, Medium, and
standalone Core tasks that do neither remain valid without a state block.

`bemoat:agent:issue` is read-only. It classifies a missing state block on a
non-managed task as a warning; it must not initialize one. For a managed task,
an absent or malformed block is `STATE_MIGRATION_REQUIRED`; disagreement with
the live Issue/PR/base/head/terminal state is `STATE_CONFLICT`; and required
live evidence that cannot be obtained is `BLOCKED_EXTERNAL`. These outcomes
require reconciliation, never a silent reset or inferred review count.

## Roles and authority boundaries

### Mission Control

May: resolve repository and approved base; read this guide and optional child
override; reconstruct state from plan, issues, PR head, and exact-head checks;
identify one next permitted action; create/update bounded handoffs; record
durable state and review counters; route work to Dev, Reviewer, or Founder;
mark a task eligible for Founder Review when the completion gate is satisfied.

Must not: implement code in the coordination run; perform a new full review
after every correction; discover optional cleanup after the completion gate
passed; broaden scope without proven material change and Founder decision;
merge a PR; infer current state from chat memory when GitHub evidence exists.

### Dev

May: implement only the active bounded scope; run required checks; commit and
push to the approved issue branch; update/open the PR; post a RESULT with exact
head SHA and evidence.

Must not: silently fix unrelated findings; reset review counters; reinterpret
Acceptance Criteria; merge.

### Reviewer

May: perform the review type assigned by Mission Control; issue findings with
evidence and required verification; produce one allowed verdict.

Must not: expand a delta review into a full repository review; block on
unproven hypotheticals; treat Minor/Nit findings as blockers; start another
review cycle independently.

### Founder

Owns: material scope, Acceptance Criteria, or architecture changes;
authorization after the review budget is exhausted; merge approval; reopening
after Founder Review or completion when evidence is disputed; production,
migration, destructive work, and required manual-QA decisions. Founder
approval is not required for routine in-scope diagnosis, CI reruns, evidence
reconciliation, or localized corrections that preserve the approved contract.

## Responsibility/source-of-truth model

| Source | Authoritative responsibility |
| --- | --- |
| Explicit current user/Founder instruction | Human decision, approval, exception, or cancellation |
| `docs/mission-control/mission-control-guide.md` | Shared process policy, role boundaries, state machine, review budget, severity and completion rules |
| `.bemoat/mission-control-overrides.md` | Child-owned project paths, approved base, deployment/manual-QA gates, protected areas; may only add/narrow requirements |
| Approved Implementation Plan | Roadmap, Slice/Task ordering, dependencies, durable milestone completion, first incomplete task/gate |
| Main Issue | Current project stage, active task pointer, active PR pointer, blocking summary, one next permitted action |
| Active Task Issue | Bounded scope, Acceptance Criteria, constraints, review-cycle state, current blockers |
| PR exact head | Actual implementation state and changed files |
| Exact-head CI/checks | Verification evidence for that exact PR head SHA |
| Chat history | Supporting context only; never authoritative current state |

### Conflict behavior

If durable sources conflict, return `STATE_CONFLICT`, identify the conflicting
fields and links, request or apply one bounded reconciliation action, and stop.
Do not guess which state is correct.

## Bootstrap and state reconstruction

At the start of every Mission Control run:

1. Resolve the repository and its approved protected base branch.
2. Read this guide from that merged base/default branch (not an unmerged task branch).
3. Read `.bemoat/mission-control-overrides.md` when it exists.
4. Report repository, policy ref, policy commit SHA, and guide version.
5. Read the approved Implementation Plan, Main Issue, Active Task Issue, active PR exact head, and exact-head CI/check status.
6. Read the existing Mission Control state block before choosing an action.
7. If durable sources conflict, return `STATE_CONFLICT` and stop.
8. Perform exactly one bounded action or state transition.
9. Write the durable result to GitHub, identify one next permitted action, and stop.

Never reset or infer the review count from chat history.

## Durable Mission Control state schema

Write review-cycle state on the Active Task Issue between stable markers.
Update only content between the markers. Preserve human-authored Issue content
outside the markers.

```html
<!-- bemoat-mission-control-state:start -->
```

```yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: "#<this active task issue>"
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.0.0
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: "Identify one next bounded action"
material_change_status: none
updated_at: null
updated_by: null
```

```html
<!-- bemoat-mission-control-state:end -->
```

### State update rules

- `review_cycle` increments only when a reviewer posts a completed verdict for a new review cycle.
- Reading state, rerunning CI, or refreshing GitHub metadata does not increment the cycle.
- A correction commit does not reset the cycle.
- `last_reviewed_head` records the exact head SHA covered by the most recent completed review.
- If PR head changes after review, the previous verdict remains historical evidence but does not cover the new head.
- If a managed task has a malformed or absent block, return `STATE_MIGRATION_REQUIRED`; do not silently initialize as Review 1.

## State machine and allowed transitions

States:

```text
READY
IN_PROGRESS
AWAITING_REVIEW_1
CORRECTION_REQUIRED_1
AWAITING_REVIEW_2
CORRECTION_REQUIRED_2
AWAITING_REVIEW_3
BLOCKED_FOR_FOUNDER_DECISION
ELIGIBLE_FOR_FOUNDER_REVIEW
DONE
BLOCKED_EXTERNAL
STATE_CONFLICT
STATE_MIGRATION_REQUIRED
```

Allowed forward transitions:

```text
READY -> IN_PROGRESS
IN_PROGRESS -> AWAITING_REVIEW_1
AWAITING_REVIEW_1 -> CORRECTION_REQUIRED_1
AWAITING_REVIEW_1 -> ELIGIBLE_FOR_FOUNDER_REVIEW
CORRECTION_REQUIRED_1 -> AWAITING_REVIEW_2
AWAITING_REVIEW_2 -> CORRECTION_REQUIRED_2
AWAITING_REVIEW_2 -> ELIGIBLE_FOR_FOUNDER_REVIEW
CORRECTION_REQUIRED_2 -> AWAITING_REVIEW_3
AWAITING_REVIEW_3 -> ELIGIBLE_FOR_FOUNDER_REVIEW
AWAITING_REVIEW_3 -> BLOCKED_FOR_FOUNDER_DECISION
ELIGIBLE_FOR_FOUNDER_REVIEW -> DONE
```

Any normal state may transition to `BLOCKED_EXTERNAL`, `STATE_CONFLICT`, or
`STATE_MIGRATION_REQUIRED` when proven. No backward transition without exact
evidence and authorized reason.

## Review-cycle budget

Normal review is limited to three cycles per task (`max_review_cycles: 3`).
Mission Control must not autonomously start Review 4.

## Full-review rules

**Review 1 — Full review** is task-bounded. Scope:

- task Acceptance Criteria;
- correctness of changed behavior;
- regressions reasonably connected to the changed behavior;
- security and access-control implications;
- data integrity and migration implications;
- required checks and manual QA;
- scope compliance.

Record: PR head SHA; files/areas reviewed; AC audit; findings; verdict;
verification required for each blocking finding.

## Delta-review rules

**Review 2 — Delta review** after a small correction. Scope limited to:

- enumerated findings from Review 1;
- files changed since `last_reviewed_head`;
- directly affected behavior/dependencies needed to verify those corrections;
- exact-head CI and required QA for the corrected head.

Do not restart a repository-wide search. A new Blocker/Critical inside the
changed delta may block. Newly noticed Important/Minor/Nit outside the assigned
delta becomes a follow-up issue.

## Blocker-verification rules

**Review 3 — Blocker verification** only. Scope:

- unresolved Blocker/Critical findings;
- the correction delta for those findings;
- exact-head checks required to prove resolution.

Not a general quality-improvement pass.

After Review 3, choose only one of:

- `ELIGIBLE FOR FOUNDER REVIEW` when the completion gate passes;
- `BLOCKED FOR FOUNDER DECISION` when a verified Blocker/Critical remains;
- `BLOCKED EXTERNAL` when infrastructure/permissions prevent proof.

Do not autonomously create Review 4.

## Finding severity and evidence requirements

### Blocker/Critical

Only for a proven condition such as Acceptance Criterion failure; incorrect
required behavior; connected regression; security/access-control defect;
data-loss or destructive-migration risk; required CI/check failure; missing
required manual QA evidence; inability to identify or verify the exact PR head;
implementation outside explicit task scope that creates concrete risk.

### Important

Meaningful quality issue that should be fixed within the remaining permitted
cycle when bounded and low risk. Does not independently justify unlimited review
or reopening after eligibility.

### Minor/Nit

Readability, naming, formatting, optional cleanup, non-required test
enhancement, documentation polish, speculative future-proofing, or preference.
These are non-blocking and must be deferred. Minor/Nit findings must not block
completion.

### Required finding fields

```yaml
finding_id: MC-R1-001
severity: Blocker
violated_acceptance_criterion: "AC text or concrete invariant"
head_sha: "exact reviewed SHA"
evidence: "file:line, failing check, reproduction, or linked artifact"
risk: "concrete user/system impact"
required_correction: "smallest acceptable correction"
verification: "command, test, or manual QA proving resolution"
disposition: open
```

Do not block on wording such as "might be better," "consider," "could possibly,"
or personal preference without concrete evidence.

## Material-change rules

A completed review does not return to full review unless a material change is
proven (architecture boundary; schema/migration; auth/security boundary; AC
change; public API/contract; broad behavior outside reviewed delta; replacement
approach making prior evidence inapplicable).

Not material by itself: wording/docs; naming/formatting; metadata; small
localized bug correction; focused regression test; refactor with proven
unchanged behavior; CI rerun without implementation change.

Reviewer may flag a suspected material change with evidence. Mission Control
records `material_change_status: proposed` and stops. Founder decides whether
to authorize a new full review, split into a new Issue, or revert. A new
full-review budget must never be created automatically.

## Completion gate

A task becomes `ELIGIBLE FOR FOUNDER REVIEW` only when all are true:

- every required Acceptance Criterion is `Done` or explicitly `Not applicable` with reason;
- required tests/checks pass for the exact current head;
- required manual QA evidence exists;
- no verified Blocker/Critical finding remains open;
- implementation remains inside approved scope;
- task Issue state records the current head and review cycle;
- PR targets the approved base;
- PR description links/closes the source Issue as required;
- no unresolved state conflict exists.

Once eligible: stop searching for additional improvements; do not reopen for
Important, Minor, or Nit; create bounded follow-up Issues where worthwhile;
return one Founder action (review/merge/decline); do not merge automatically.

## Reopening rules

After `ELIGIBLE FOR FOUNDER REVIEW` or `DONE`, reopen only for a newly proven
Blocker/Critical tied to concrete evidence (exact head, reproduction or failing
required check, affected AC/invariant, risk) plus Founder decision to reopen or
file a new regression Issue. Minor cleanup uses follow-up Issues.

## Handoff contract

Every handoff contains one bounded job. Use
[handoff-template.md](./handoff-template.md) for the full field checklist. For
operational GitHub comments, prefer the compact-delta shape in
[role-handoff-contract.md](../agent-loop/role-handoff-contract.md). Do not
bundle implementation, review, merge, and next-task discovery into one run.

## RESULT contract

Dev and Reviewer report via [result-template.md](./result-template.md) and the
compact operational templates in the role-handoff contract.

Reviewer verdict for Core Mission Control work must be exactly one of:

```text
CORRECTION REQUIRED
ELIGIBLE FOR FOUNDER REVIEW
BLOCKED FOR FOUNDER DECISION
BLOCKED EXTERNAL
STATE CONFLICT
```

This enum is authoritative for Core / multi-stage Mission Control review. Compact
`## REVIEW_VERDICT` comments keep the role-handoff heading and shape, but the
verdict line must use this vocabulary.

## Follow-up issue policy

Defer Important (when remaining cycles cannot absorb safely), Minor, Nit, and
newly noticed out-of-delta quality goals to bounded follow-up Issues. Do not use
follow-ups to hide unresolved Blocker/Critical findings.

## Scope-control rules

Implement and review only the active bounded scope. Material scope expansion
requires Founder decision. Prefer the smallest correction that resolves proven
blockers.

## Stop conditions

Stop after one bounded Mission Control action or state transition. Stop on
`STATE_CONFLICT`, `STATE_MIGRATION_REQUIRED`, Founder gate, exhausted review
budget without autonomous Review 4, or when evidence cannot be proven
(`BLOCKED_EXTERNAL`).

## Existing-task migration behavior

For a managed existing task already under review without a valid state block:

1. Reconstruct prior completed review rounds from Issue/PR comments where evidence is clear.
2. Record the reconstructed count and reviewed SHAs.
3. If the count cannot be proven, ask the Founder to set the starting cycle once.
4. Do not grant a fresh three-cycle budget by default.
5. Return `STATE_MIGRATION_REQUIRED` until migration is complete.

## Repository-specific override behavior

Child overrides live at `.bemoat/mission-control-overrides.md` (never
sync-managed). See [project-overrides.example.md](./project-overrides.example.md).

Overrides may add/narrow project requirements. They must not relax shared
invariants (review budget, completion gate, severity rules, exact-head
requirements, auto-merge bans, silent reset bans). Conflicting overrides yield
`STATE_CONFLICT`.

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
4.

### New session mid-task

Fresh chat reads GitHub state block and continues at the recorded cycle. Chat
history is never authoritative.
