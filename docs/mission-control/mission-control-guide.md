---
policy_id: bemoat-mission-control
version: 1.2.0
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
<!-- bemoat-mc:invariant:delivery-owns-awaiting-review-1 -->
<!-- bemoat-mc:invariant:reviewer-owns-counters -->
<!-- bemoat-mc:invariant:deterministic-reconciliation-not-conflict -->
<!-- bemoat-mc:invariant:double-loop-no-similar-edit-without-decision -->
<!-- bemoat-mc:invariant:durable-state-is-not-an-agent-stage -->
<!-- bemoat-mc:invariant:changed-head-is-not-full-review-escalation -->

## Purpose

Mission Control coordinates bounded work across Dev, Reviewer, and Founder so
tasks converge within at most three normal review cycles. It reconstructs
durable GitHub state, performs one permitted action or state transition, writes
the result, identifies one next action, and stops.

Mission Control is not an implementation agent and not a perpetual code
reviewer.

A durable state records authority, evidence, and the next permitted action; it is not an agent execution stage. A durable state transition does not itself require or authorize a separate model run.

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

## Workflow profiles

Derive one profile from the declared task tier and Mission Control mode using the canonical routing contract: explicit `required` routes to MANAGED; explicit `optional` / `not required` routes to FAST for Small and STANDARD for Medium/Core; any missing (`null`/`undefined`), malformed, ambiguous, or `unsure` mode routes to STANDARD until authority is resolved (`#146`). This is routing guidance, not another state machine or durable taxonomy.

| Declared task | Profile | Default path |
| --- | --- | --- |
| Small + Mission Control optional (not required) | FAST | Focused implementation and verification → one commit → PR → compact `RESULT` → Founder review/merge |
| Medium/Core + Mission Control optional (not required) | STANDARD | Existing risk-adjusted implementation, verification, and Founder merge gates |
| Any tier + Mission Control required | MANAGED | Existing bounded role/state/review workflow |
| Mission Control mode missing, ambiguous, or unsure | STANDARD | Resolve the mode before treating the task as FAST |

The profile chooses review routing, not additional states or comment types.
Review routing depends on capability and proven risk; runtime model names remain replaceable configuration.

### FAST

FAST skips the Mission Control state block, Main Issue reconciliation,
multi-role orchestration, automatic Red Team, new plan/spec documents,
checkpoint commits, and `HANDOFF` / `REVIEW_VERDICT` when one agent completes
the task without a review gate.

It still requires branch safety, concise acceptance criteria, focused
verification, required lint/typecheck/tests, UI manual QA when applicable, one
focused final commit, a PR, a compact `RESULT`, and Founder-controlled merge.

Escalate out of FAST before another implementation attempt when scope includes
a schema/migration, authentication/authorization/security behavior, payment,
Finance, order state, PII, shared API/component contract, destructive or
production operation; when acceptance criteria are unclear; when focused
verification fails without explanation; when one correction does not converge;
or when scope/architecture changes materially. Route the triggered
non-convergence diagnosis to #121; do not create a FAST-specific state machine.

Legacy Core tasks that declare both a Main Issue and an Implementation Plan
remain MANAGED, regardless of an optional or absent mode declaration.

### Profile review defaults

| Profile | Semantic review default | Corrections and escalation |
| --- | --- | --- |
| FAST | No independent high-reasoning review by default; use focused verification and compact `RESULT`. | Escalate only when #119 conditions are proven; Founder merge gate remains. |
| STANDARD | One risk-adjusted semantic review. Use Medium when the change is bounded and normal-risk; use High only for material ambiguity or significant connected risk. | Later corrections use bounded Delta Review. |
| MANAGED | One independent High Full Semantic Review by default. | Later corrections use bounded Delta Review; repeat High only through a proven full-review escalation. |

Where independent first review is required by the profile or an existing task
gate, it remains independent. These defaults do not waive exact-head evidence,
Founder authority, or #107's three-cycle limit.

FAST defaults to focused verification without independent high-reasoning review.
STANDARD defaults to one risk-adjusted semantic review: Medium for bounded normal-risk work and High only for material ambiguity or significant connected risk.
MANAGED defaults to one independent High Full Semantic Review, followed by bounded Delta Review.

## Operational-stage minimization and state necessity

Keep a distinct durable state only when it changes execution authority or owner, next permitted action, required evidence, failure-handling path, or a Founder/human approval requirement. Do not add a state merely to label a review number, review mode, model/reasoning level, bookkeeping action, or agent run.

Keep `review_cycle`, `review_mode`, `last_reviewed_head`, findings, and
`next_permitted_action` as explicit durable fields or evidence when applicable;
they do not create duplicate operational stages or a second phase/state model.
Atomic role completion writes its result and resulting canonical state in the
same authorized run. Mechanical checks and deterministic reconciliation may be
performed in that run without routing a separate agent just to rename or advance
state.

### Bounded defect workflow simplification (KISS)

For bounded defects where root cause, acceptance criteria, and affected files are clear:
- **No separate planning phase**: Bounded defects proceed directly to implementation (`READY` or `IN_PROGRESS`) without requiring a dedicated planning phase or separate plan document.
- **No duplicate Founder approval gates**: If Founder authorization was already granted or the defect is pre-authorized correction work, do not insert a duplicate pre-implementation Founder review gate.
- **Atomic Dev delivery**: Dev completes code changes, validation, Draft PR (`Closes #N`), exact-head CI verification, `## RESULT` comment, and state advancement (`AWAITING_REVIEW_1`) atomically in one delivery run.
- **Deterministic comment-timestamp filtering**: When evaluating live task progress in `READY` or `IN_PROGRESS`, role comments (`RESULT` or `REVIEW_VERDICT`) from earlier planning or diagnostic phases whose valid timestamps (`createdAt`) precede a valid `state.updated_at` are ignored by deterministic preflight guards (`#146`) to prevent stale comments from triggering false `STATE_CONFLICT` blockers or inferring stale PR references. If either timestamp is absent or malformed (`NaN`), the role comment is preserved for normal reconciliation or fail-closed rules rather than treating invalid timestamps as epoch zero (`MC-R1-003`).

## Double-Loop Review Gate

The Double-Loop Review Gate is a **no-code diagnostic checkpoint** between a
proven non-converging or structurally suspicious failure and another materially
similar edit. It complements, rather than replaces, normal implementation
diagnosis, TDD, CI, manual QA, bounded review cycles, or Founder decisions.

Single-loop correction is: identify a clear implementation defect, make one
materially different correction, then verify it. Double-Loop Review is: stop
code edits; test whether the objective, assumptions, specification, validation,
decomposition, tool/model, or environment is the actual cause; record one
bounded decision and the smallest differentiating experiment; then stop or
authorize only that experiment.

| Profile | Trigger for the no-code checkpoint |
| --- | --- |
| FAST | Focused verification fails without explanation, or the task does not converge within one correction loop. Exit FAST; do not create a FAST state machine. |
| STANDARD | Two materially similar attempts fail without new evidence; the diff/workarounds grow without Acceptance-Criteria progress; tests pass while required behavior fails; scope/objective drifts; repeated local masking changes hide the cause; or the next attempt cannot state a material difference. |
| MANAGED / high-risk | The first failure involving security, authorization, payment/Finance, destructive data risk, schema/migration, or production operations; before a material scope, AC, architecture, API, or validation-contract change; otherwise after two materially similar normal-risk attempts. |

Classify each triggered gate as exactly one primary class, supported by evidence:

```text
IMPLEMENTATION
SPECIFICATION
VALIDATION
DECOMPOSITION
TOOL_OR_MODEL
ENVIRONMENT
UNKNOWN
```

Use exactly one resulting decision:

```text
CONTINUE_IMPLEMENTATION
REVISE_SPECIFICATION
REVISE_VALIDATION
SPLIT_OR_REDECOMPOSE_TASK
CHANGE_TOOL_OR_MODEL
REPAIR_ENVIRONMENT
BLOCKED_EXTERNAL
BLOCKED_FOR_FOUNDER_DECISION
CREATE_FOLLOW_UP_ISSUE
```

`CONTINUE_IMPLEMENTATION` requires concrete evidence and a smallest next
experiment that materially differs from prior attempts. `UNKNOWN` must not authorize another materially similar edit. It must produce a smaller diagnostic
experiment or a blocker. Material changes, exhausted review budget, production,
migration, destructive actions, and merge authority remain Founder gates.

Record the gate using existing `## HANDOFF` or `## RESULT` transport only; do
not create a new state, comment type, attempt counter, telemetry store, or
recursive review. A triggered `## HANDOFF` explicitly prohibits code edits
until the decision is recorded. Managed tasks reuse existing
`next_permitted_action`, `material_change_status`, blocker, and Founder-gate
fields; a Double-Loop Review does not reset review counters or authorize Review
4.

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

When acting as **Delivery Coordinator**, may also update only the managed state
block between `bemoat-mission-control-state` markers to record `AWAITING_REVIEW_1`
with `active_pr` and `current_head` in the same authorized run as the successful
`## RESULT`.

Must not: silently fix unrelated findings; reset or increment review counters;
reinterpret Acceptance Criteria; merge; perform review; edit the Issue acceptance
criteria checklist.

### Reviewer

May: perform the review type assigned by Mission Control; issue findings with
evidence and required verification; produce one allowed verdict; update the
managed state block atomically with the `## REVIEW_VERDICT` (counters,
`last_reviewed_head`, and resulting state).

Must not: expand a delta review into a full repository review; block on
unproven hypotheticals; treat Minor/Nit findings as blockers; start another
review cycle independently; merge or start the next task.

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

Distinguish **bookkeeping lag** from **genuine conflict**:

- **Bookkeeping lag:** one unambiguous live PR, exact head, exact-head CI result,
  and durable role output (`## RESULT` or `## REVIEW_VERDICT`) exist, but the
  managed state block is stale. Treat as **incomplete role delivery** or apply
  **deterministic reconciliation** — not `STATE CONFLICT`.
- **Genuine conflict:** contradictory durable evidence such as wrong or
  competing PR; head mismatch or unsafe ancestry; stale or non-matching CI;
  conflicting task pointer; inconsistent review history; scope or authorization
  mismatch. Return `STATE CONFLICT`, identify the conflicting fields and links,
  request or apply one bounded reconciliation action, and stop.

Do not guess which state is correct when evidence is contradictory.

## Execution roles and atomic completions

One role completion must leave one complete durable transition. Reuse existing
`## HANDOFF`, `## RESULT`, and `## REVIEW_VERDICT` transport — do not create a
new operational comment type or second durable state store.

```text
Integration Builder completion
= verified bounded implementation + durable handoff to delivery

Delivery Coordinator completion
= final commit + Draft PR + exact-head CI + RESULT + AWAITING_REVIEW_1 state block

Independent/Delta Reviewer completion
= REVIEW_VERDICT + reviewed exact head + counters/findings + resulting state

Diagnostic Reviewer completion
= evidence + failure class + invalidated assumptions + one smallest next experiment or blocker

State Reconciler completion
= deterministic state repair from unambiguous evidence, or explicit STATE_CONFLICT

Founder-authorized merge transition
= verify authorization/head/CI + mark ready when needed + merge + verify merge commit + DONE/close
```

A **State Reconciler** may normalize facts that are already proven. It may not
choose product behavior, expand scope, waive review, or infer missing
authorization.

## Role-owned durable state updates

| Field / artifact | Authoritative owner |
| --- | --- |
| `active_pr`, `current_head` after delivery | Delivery Coordinator (same run as `## RESULT`) |
| `state: AWAITING_REVIEW_1` after delivery | Delivery Coordinator |
| `review_cycle`, `full_review_count` | Reviewer only (with `## REVIEW_VERDICT`) |
| `last_reviewed_head` | Reviewer only |
| Resulting correction/eligibility state | Reviewer or State Reconciler from verdict evidence |
| `DONE` / terminal closure | Founder-authorized merge transition or State Reconciler from merge evidence |
| Issue acceptance criteria checklist | Mission Control pre-merge reconciliation only |

Delivery and Reviewer roles may update **only** content between the
`bemoat-mission-control-state` markers. They must preserve human-authored Issue
content outside the markers. Dev must never increment `review_cycle` or
`full_review_count`.

## Deterministic reconciliation

When bookkeeping lag is unambiguous, Mission Control or a State Reconciler
should repair the managed state block without requiring a separate coordination
run before Review 1 or the next permitted action.

Reconciliation inputs (all must agree):

- exactly one active PR for the task;
- live PR head matches the durable role output head;
- exact-head CI passes for that head;
- latest non-superseded `## RESULT` or `## REVIEW_VERDICT` supports the transition.

If any input is missing or contradictory, stop with `STATE CONFLICT` or
`INCOMPLETE_DELIVERY` (when the producing role has not finished its atomic
transition) — never infer authorization or review outcomes.

## Protocol compression

Routine successful transitions should return compact user-facing output while
retaining full evidence in GitHub.

- Omit stable repository, policy, model, and prompt boilerplate unless it
  changed or is required for a decision.
- Founder Decision stops stay lean by default — do not keep model or
  Ready-to-paste prompt boilerplate merely because the run is blocked.
- Do not require a separate Mission Control run between valid delivery and
  Review 1, or between a completed review and its next state.
- One explicit Founder merge instruction may authorize the bounded
  ready → merge → verify → close sequence.
- Migration, deployment, production mutation, destructive rollback, material
  scope change, and starting dependent work remain separately gated unless
  explicitly authorized.

## Integration boundaries

- **#107** remains the canonical Mission Control foundation. v1.1 is additive.
- **#119** owns FAST / STANDARD / MANAGED profile derivation and escalation
  conditions; this guide applies the compatible review-routing defaults.
- **#121** owns the bounded Double-Loop Review Gate — not this Issue.
- **#122** implements review-stage minimization and cost-aware routing while
  preserving #107, #119, #120, and #121 compatibility.

## Bootstrap and state reconstruction

At the start of every Mission Control run:

1. Resolve the repository and its approved protected base branch.
2. Read this guide from that merged base/default branch (not an unmerged task branch).
3. Read `.bemoat/mission-control-overrides.md` when it exists.
4. Report repository, policy ref, policy commit SHA, and guide version.
5. Read the approved Implementation Plan, Main Issue, Active Task Issue, active PR exact head, and exact-head CI/check status.
6. Read the existing Mission Control state block before choosing an action.
7. If durable sources genuinely conflict, return `STATE_CONFLICT` and stop. If
   only bookkeeping lag is proven, reconcile deterministically or classify as
   incomplete delivery.
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
post_budget_reviews: []
guide_version: 1.2.0
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

- Delivery Coordinator must write `AWAITING_REVIEW_1` with `active_pr` and
  `current_head` in the same authorized run as a successful delivery `## RESULT`.
- Reviewer must write `review_cycle`, `full_review_count`, `last_reviewed_head`,
  and the resulting state in the same authorized run as `## REVIEW_VERDICT`.
- `review_cycle` increments only when a reviewer posts a completed verdict for a new review cycle.
- Dev must never increment `review_cycle` or `full_review_count`.
- Reading state, rerunning CI, or refreshing GitHub metadata does not increment the cycle.
- A correction commit does not reset the cycle.
- `last_reviewed_head` records the exact head SHA covered by the most recent completed review.
- If PR head changes after review, the previous verdict remains historical evidence but does not cover the new head.
- If a managed task has a malformed or absent block, return `STATE_MIGRATION_REQUIRED`; do not silently initialize as Review 1.

### Founder-authorized post-budget history

Keep `review_cycle` capped at `3` and `full_review_count` capped at `1`. A
Founder-authorized review after the normal budget is recorded separately in
`post_budget_reviews`; it never increments or resets the normal counters. Every
entry is contiguous from Review 4 and records the reviewed head, verdict,
Founder authorization for that exact review, and the disposition of its
findings:

```yaml
review_cycle: 3
full_review_count: 1
last_reviewed_head: <review-4-head>
post_budget_reviews:
  - review_number: 4
    reviewed_head: <review-4-head>
    verdict: BLOCKED FOR FOUNDER DECISION
    authorization:
      status: approved
      authority: Founder
      scope: review
      review_number: 4
      reviewed_head: <review-4-head>
      action: "Authorize bounded Review 4"
      authorized_at: "<timestamp>"
    finding_dispositions:
      - finding_id: MC-R1-002
        disposition: open
```

Authorization for one post-budget review does not authorize the next review.
Each `scope: review` authorization must bind to its exact `review_number` and
`reviewed_head`, and the same authorization object cannot be replayed for a later
review entry. Review 5 therefore requires its own durable `scope: review`
Founder authorization entry before it can be recorded.

When the completed post-budget verdict requires another correction, transition
to `IN_PROGRESS` only after recording a separate, bounded correction decision:

```yaml
state: IN_PROGRESS
founder_decision:
  status: approved
  authority: Founder
  scope: correction
  for_review_number: 4
  reviewed_head: <review-4-head>
  finding_ids:
    - MC-R1-002
  action: "Authorize one bounded correction for MC-R1-002"
  authorized_at: "<timestamp>"
```

This transition preserves `review_cycle: 3`, `full_review_count: 1`,
`last_reviewed_head`, and every `post_budget_reviews` entry. The correction
authorization must bind to the latest completed post-budget review number,
reviewed head, and the specific `finding_ids` being corrected; stale correction
authorization after a later post-budget review is rejected. It authorizes only
the named correction; it does not authorize another review, merge, migration,
or deploy.

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
BLOCKED_FOR_FOUNDER_DECISION -> IN_PROGRESS
BLOCKED_FOR_FOUNDER_DECISION -> DONE
ELIGIBLE_FOR_FOUNDER_REVIEW -> DONE
```

`BLOCKED_FOR_FOUNDER_DECISION -> IN_PROGRESS` requires an explicit Founder
**Approve** of the named exception or next step, plus durable GitHub
authorization for that named step only. `BLOCKED_FOR_FOUNDER_DECISION -> DONE`
requires an explicit Founder **Decline** (stop/closure). Neither transition
authorizes Review 4, merge, migration, or deploy unless the named Founder
decision explicitly includes that gate.

After a completed Founder-authorized post-budget review, the same
`BLOCKED_FOR_FOUNDER_DECISION -> IN_PROGRESS` transition retains the normal
counter at `3` and the completed review in `post_budget_reviews`; it also
requires the separate `scope: correction` Founder decision shown above.

Any normal state may transition to `BLOCKED_EXTERNAL`, `STATE_CONFLICT`, or
`STATE_MIGRATION_REQUIRED` when proven. No backward transition without exact
evidence and authorized reason.

## Review-cycle budget

Normal review is limited to three cycles per task (`max_review_cycles: 3`).
Mission Control must not autonomously start Review 4.

Normal routing is Review 1 → Full Semantic Review, Review 2 → Delta Review,
Review 3 → bounded Delta Review or Blocker verification. Non-convergence after
the bounded budget routes to the #121 Double-Loop Review Gate or a Founder
decision; it never authorizes automatic Review 4.

## Cost-aware review routing

Mechanical verification uses deterministic scripts, or a low-reasoning coordinator when automation is unavailable; it is not a high-reasoning semantic review. Mechanical work includes proving PR/head equality, exact-head CI,
approved file scope, required evidence/state fields, review counters, and
unresolved-finding consistency.

Full Semantic Review evaluates Acceptance Criteria and business objective,
connected correctness/regressions, architecture and contract implications, and
applicable security, authorization, payment/Finance, schema, migration, and
data-integrity risk. It also determines whether evidence proves required
behavior rather than merely matching an implementation.

Delta Review is limited to enumerated prior findings, the diff since
`last_reviewed_head`, directly affected behavior, and exact-head checks for the
corrected head. It must not restart a repository-wide review. Delta Review uses the lowest reasoning level that can reliably verify the bounded change.

A changed commit or head alone is not a trigger for another Full Semantic Review. A new full review is permitted only when at least one proven trigger is
recorded: the correction changes an Acceptance Criterion, architecture, API
contract, schema, migration, security boundary, payment/Finance invariant, or
production behavior; files or behavior materially exceed the authorized
correction scope; the delta is too broad to preserve prior review coverage; the
prior reviewed head cannot be established reliably; a new Blocker/Critical
invalidates the original review assumptions; or the Founder explicitly
authorizes a new full review.

A Full Semantic Review escalation requires at least one explicit proven trigger.

## Full-review rules

**Review 1 — Full Semantic Review** is task-bounded. Scope:

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

**Review 2 — Delta Review** after a small correction. Scope limited to:

- enumerated findings from Review 1;
- files changed since `last_reviewed_head`;
- directly affected behavior/dependencies needed to verify those corrections;
- exact-head CI and required QA for the corrected head.

Do not restart a repository-wide search. A new Blocker/Critical inside the
changed delta may block. Newly noticed Important/Minor/Nit outside the assigned
delta becomes a follow-up issue.

Reviewers own immutable finding identity.
Correction agents may not rename, reinterpret, regroup, substitute, add, or omit findings.
Correction delivery does not resolve original PR review threads; the bounded
Delta Reviewer verifies each original finding against the correction delta and
owns thread resolution.
File names, test names, and green CI alone never prove semantic completion.

## Blocker-verification rules

**Review 3 — Blocker verification or bounded Delta Review** only. Scope:

- unresolved Blocker/Critical findings;
- the correction delta for those findings;
- exact-head checks required to prove resolution.

It is not a general quality-improvement pass and never becomes a repository-wide
review.

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

A completed review does not return to full review unless a material/high-risk
change is proven: architecture boundary; schema/migration; auth/security
boundary; payment/Finance invariant; production behavior; AC change; public
API/contract; broad behavior outside reviewed delta; replacement approach making
prior evidence inapplicable; or reviewed-head integrity cannot be established.

Not material by itself: wording/docs; naming/formatting; metadata; small
localized bug correction; focused regression test; refactor with proven
unchanged behavior; CI rerun without implementation change.

Reviewer may flag a suspected material change with evidence. Mission Control
records `material_change_status: proposed` and stops. Founder decides whether
to authorize a new full review, split into a new Issue, or revert. A new
full-review budget must never be created automatically.

## Lean Founder Decision

When managed state is `BLOCKED_FOR_FOUNDER_DECISION`, or an equivalent exception
escalation sets Founder decision required to a non-`None` value, Mission Control
presents a lean decision card only:

- current managed state;
- the concrete blocker or decision being escalated;
- the minimum verified evidence needed to understand the decision;
- a concise recommendation and rationale;
- the two available actions: **Approve** or **Decline**.

The primary Founder reply is exactly **Approve** or **Decline**. Do not include Suggested model, Ready-to-paste prompts, delivery checklists, or
implementation/review-execution prompts before Approve.

Post-decision:

- **Approve** → write durable GitHub authorization for the named exception or
  next step, then emit the compact `## HANDOFF` / implementation handoff for
  that named step only. Transition `BLOCKED_FOR_FOUNDER_DECISION` →
  `IN_PROGRESS` when execution is authorized.
- **Decline** → write only the minimal stop/closure transition
  (`BLOCKED_FOR_FOUNDER_DECISION` → `DONE` or follow-up Issue creation when
  required). Do not generate implementation content.

`ELIGIBLE_FOR_FOUNDER_REVIEW` merge authorization stays on the existing
compressed Founder merge instruction path and is not this lean card.

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
