---
policy_id: bemoat-mission-control
version: 1.3.0
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

The exact production command contract is [Mission Control command reference](./command-reference.md).

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
- **Atomic Dev delivery**: Dev completes code changes, validation, Draft PR (`Refs #N` when Option A merge transport owns Issue closure; otherwise the repository's normal linkage), exact-head CI verification, `## RESULT` comment, and state advancement (`AWAITING_REVIEW_1`) atomically in one delivery run.
- **Deterministic comment-timestamp filtering**: When evaluating live task progress in `READY` or `IN_PROGRESS`, role comments (`RESULT` or `REVIEW_VERDICT`) from earlier planning or diagnostic phases whose valid timestamps (`createdAt`) precede a valid `state.updated_at` are ignored by deterministic preflight guards (`#146`) to prevent stale comments from triggering false `STATE_CONFLICT` blockers or inferring stale PR references. If either timestamp is absent or malformed (`NaN`), the role comment is preserved for normal reconciliation or fail-closed rules rather than treating invalid timestamps as epoch zero (`MC-R1-003`).

## Safe execution bundles

A safe execution bundle is one bounded objective with one authority scope and one
terminal durable outcome. It may contain multiple mechanical substeps only when
they share the same immutable scope, require no new discretionary decision, and
are preflighted against the same live authority, head, base, CI, and state
evidence.

Recording an already-made Founder authorization may be bundled with executing
that exact authorization. Founder decision-making itself is never silently
combined with implementation, independent review, or merge approval.

### Generic Founder authorization record

Every Founder authorization is a repository-bound, immutable record with a
trusted Founder identity, an immutable decision comment/reference, and
non-supersession verification. It has these fields (omitting PR/head/base only
when the authorized action genuinely has no such object):

```yaml
schema_version: 1
status: approved
authority: Founder
author_login: <trusted-founder-login>
comment_id: <immutable-decision-comment>
comment_sha256: <sha256-of-comment-body>
immutable_comment_reference: true
non_superseded: true
repository: owner/repository
task_issue: <issue-number>
pr: <pull-request-number-or-null>
exact_head: <full-sha-or-null>
reviewed_head: <full-sha-or-null>
base: main
policy_source_sha: <full-sha-of-merged-policy-source>
protected_base_sha: <full-sha-of-approved-protected-base>
bundle_kind: merge-completion
scope: merge
action: merge
policy_version: 1.3.0
```

The runtime verifies the authenticated Founder against the repository-owned
allowlist, the comment identity and hash, non-supersession, every repository
and task/PR/head/base/policy-source binding, the exact
`bundle_kind: merge-completion` tuple, and the exact scope/action. The merge
transport never treats a generic `delivery`, implementation, ratification, or
other bundle as merge authority. Ambiguous,
fabricated, superseded, scope-mismatched, implementation-only, ratifying, or
non-merge decisions fail closed and cannot authorize merge.

Every bundle must verify its complete evidence set before the first mutation and
stop at the first safe checkpoint if any identity, scope, authority, head, CI,
lease, CAS, or mergeability assumption changes.

## Allowed bundled flows

The allowed flows are limited to mechanically dependent steps within one
authority scope:

- record Founder authorization → execute the exact authorized action → project
  its deterministic Task state;
- create Task Issue → initialize planning state → update the parent campaign
  projection;
- deliver implementation → verify exact-head CI → post `RESULT` → project
  `AWAITING_REVIEW_1`;
- after Founder merge approval, verify and merge the exact reviewed head → post
  final `RESULT` → close the Task Issue → project Task/campaign `DONE` → select
  the next campaign action without starting it.

## Prohibited cross-gate bundles

Bundles must not combine implementation-plan approval with implementation,
implementation with independent review, review with correction or re-review,
review with Founder merge approval, or merge with migration, deployment,
production access, destructive work, or real child sync.

Closing one task and starting the next task is also prohibited. Campaign
projection may select the next permitted action, but never authorizes its
execution. A bundle must stop rather than introduce a new discretionary
decision, broaden Acceptance Criteria, or change architecture or scope.

## Reconciliation only on failure

Successful bundles write their deterministic durable projection directly. A
separate reconciliation run is required only when projection fails, a concurrent
writer changes authority or state, evidence is ambiguous or unavailable, or the
durable result conflicts with the action outcome. Reconciliation remains
bounded, idempotent, and fail-closed; identical evidence is `NO_OP`.

## Merge completion bundle

After Founder merge approval, the merge completion bundle may verify the exact
reviewed head and exact-head CI, merge with expected-head protection, verify the
protected-base merge commit, post the final RESULT, close the Task Issue, write
Task `DONE`, project the campaign slice as `DONE`, and select the next campaign
action. It may not start that next action or add a new gate.

Hard gates remain unchanged: implementation-plan Founder approval, exact-head
independent review, exact-head CI, Founder merge approval, protected-base and
merged-policy verification, and fail-closed behavior. No autonomous Review 4 or
review-counter reset is introduced.

## Double-Loop Review Gate

Extracted to module: [Procedures](./modules/procedures.md)

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

## Execution roles and atomic completions

Extracted to module: [Procedures](./modules/procedures.md)

## Role-owned durable state updates

Extracted to module: [Procedures](./modules/procedures.md)

## Deterministic reconciliation

Extracted to module: [Procedures](./modules/procedures.md)

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
- Compact prompts must identify only the repository and active Issue/PR,
  authority reference, exact head/base, bounded objective, stop conditions,
  required evidence, and prohibited actions. Stable policy and historical
  evidence should be linked rather than repeated.

## Brainstorming Response Profile

Use the **Brainstorming Response Profile** when Mission Control is exploring or
refining a design and no implementation, review, merge, deployment, migration,
or other durable workflow transition is authorized in the current run.

This profile is **formatting and routing guidance only**. It is not a durable Mission Control state, GitHub comment type, review counter, or authorization channel. Chat history never overrides GitHub evidence.

### Trigger conditions

Apply the profile when all are true:

1. the task is requirements discovery, architecture exploration, policy
   selection, or design refinement;
2. no implementation, commit, PR, review, merge, deployment, or migration
   transition is being executed in the current run;
3. the immediate next step is a design question, comparison, or Founder approval
   of the presented design decision;
4. durable GitHub state remains unchanged unless the run explicitly performs one
   authorized planning write.

The profile may also apply when the Founder or Mission Control explicitly
requests brainstorming or design exploration before implementation authorization.

### Required response shape

Use exactly one profile marker heading: `## BRAINSTORMING` or `## DESIGN RESULT`.

Then use the compact structured sections below. Omit empty sections only when
nothing material belongs in that section:

```markdown
## Brainstorming objective

## Confirmed context

## Current design decisions

## Options and trade-offs

## Recommendation

## Open question
(Exactly one question when a decision is still required. Omit when no question remains.)

## Durable GitHub impact
(`None` or the single authorized planning artifact written in that run.)

## Do not do yet
```

Profile behavior:

- ask one clarifying question at a time;
- omit `Current state` unless a real durable Mission Control state is relevant;
- omit `Suggested model` until execution/review routing is actually needed;
- omit `Ready-to-paste prompt` until there is an approved handoff or
  implementation plan;
- distinguish conversational design decisions from durable GitHub decisions;
- preserve repository/base/policy verification internally and report it only
  when changed, disputed, or decision-relevant.

Strictly **omit** from brainstorming responses:

- `## HANDOFF`, `## RESULT`, and `## REVIEW_VERDICT` headings;
- any `<!-- bemoat-mission-control-state -->` block;
- execution/review checklists, review counters, and PR/head SHA metadata unless
  a real durable state is decision-relevant.

### Authorization semantics

- A brief approval such as `approve`, `looks good`, or `use option A` approves
  **only** the immediately presented design decision or recommendation.
- It **does not** authorize implementation, branch creation, commits, PR
  creation, review, merge, deployment, or migration.
- Implementation mode resumes only when:
  a. the Founder explicitly names the implementation action, such as
     `implement this`, `start dev`, or `create the implementation HANDOFF`; or
  b. Mission Control asks a narrowly scoped Founder decision that explicitly
     states approval will authorize implementation, and the Founder approves that
     exact decision.
- When the object of approval is ambiguous, remain in brainstorming/design mode and ask exactly one clarification question.

### Exit conditions

Exit the brainstorming profile when valid explicit implementation authorization
occurs. The normal Mission Control response contract resumes on the next agent invocation after that authorization, using standard `## HANDOFF` or `## RESULT`
transport as appropriate.

Until that transition, brainstorming output must not mutate managed state,
review counters, or durable role-comment semantics.

## Integration boundaries

- **#107** remains the canonical Mission Control foundation. v1.1 is additive.
- **#119** owns FAST / STANDARD / MANAGED profile derivation and escalation
  conditions; this guide applies the compatible review-routing defaults.
- **#121** owns the bounded Double-Loop Review Gate — not this Issue.
- **#122** implements review-stage minimization and cost-aware routing while
  preserving #107, #119, #120, and #121 compatibility.

## Bootstrap and state reconstruction

Extracted to module: [Procedures](./modules/procedures.md)

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
guide_version: 1.3.0
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

`BLOCKED_FOR_FOUNDER_DECISION` normally remains review-backed with
`full_review_count: 1`. The only pre-review form uses counters `0/0` and is a
no-code diagnostic/planning gate. It is valid only when `active_pr`,
`current_head`, and `last_reviewed_head` are all `null`,
`latest_result_comment_id` identifies the bound RESULT, and the structured
`latest_transition_identity` binds the active task to role `RESULT` with a
non-empty phase and SHA-256 content hash. A `REVIEW_VERDICT` identity cannot
authorize this form. Free-form `next_permitted_action` text is routing only and
must never discriminate the schema. Normal review-backed and post-budget
Founder gates retain their existing counters, exact-head bindings, and
authorization rules.

### Founder-authorized post-budget history

### Founder-authorized correction after normal Review 3

Use `FOUNDER_AUTHORIZED_CORRECTION` for a Founder-approved correction immediately
after normal Review 3. It is not Review 4 and must retain counters `3/1`, the
exact `last_reviewed_head`, immutable finding lineage, and
`post_budget_reviews: []`. Its versioned, single-use authorization is bound to
Review 3, the exact head, and the complete finding-ID set; dispatch consumes it
and binds it to one `## HANDOFF` through a repository-scoped single-winner
reservation and an immutable SHA-256 binding over the authority, target, PR,
head/base, review, scope, findings, timestamps, and exact body. Correction
preflight requires that byte-identical comment to remain the latest approved
non-superseded HANDOFF. Delivery preserves `3/1`, the prior reviewed head,
lineage, consumed binding, and empty post-budget history, then returns to an
explicit Founder decision. Review 4 needs separately bound Founder authority.

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
FOUNDER_AUTHORIZED_CORRECTION
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
BLOCKED_FOR_FOUNDER_DECISION -> FOUNDER_AUTHORIZED_CORRECTION
FOUNDER_AUTHORIZED_CORRECTION -> IN_PROGRESS
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

### Terminal completion contract (Option A)

Merge transport owns the complete terminal transition. Before the first
mutation it must verify the exact Founder merge authorization record, the
non-superseded `ELIGIBLE FOR FOUNDER REVIEW` verdict, exact reviewed/current PR
head, exact-head CI, protected base, policy, and mergeability. It then performs
one bounded merge-completion bundle:

```text
verify authority/verdict/head/base/CI/mergeability
→ mark ready when required
→ merge with expected-head protection
→ verify the protected-base merge commit
→ post final RESULT
→ close the managed Task Issue as completed
→ write Task DONE
→ project the campaign slice DONE
→ select the next campaign action without starting it
```

The executable `bemoat:mission-control:merge` entrypoint requires a pinned,
trusted Founder authorization comment whose authenticated author is listed in
the repository Actions variable `BEMOAT_FOUNDER_LOGINS`. Its exact record binds
the repository, Task Issue, PR, exact head/base, policy, scope, action, comment
identity, and non-supersession evidence. The repository-owned allowlist supports
personal and organization-owned child repositories without trusting caller
environment state.

Successful deterministic completion writes its terminal projection directly;
it does not invoke reconciliation and does not perform a second `NO_OP` run.
An already closed, merged, and `DONE` task is an idempotent `NO_OP` after the
same evidence is verified. Separate reconciliation is permitted only when a projection fails,
evidence is ambiguous/conflicting or unavailable, or a concurrent CAS/lease
write occurs. Reconciliation remains bounded, idempotent,
and fail-closed; it never closes or reopens an Issue. A failure after a partial
merge or projection must stop and retain an actionable classification.

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

Extracted to module: [Checklists](./modules/checklists.md)

## Reopening rules

After `ELIGIBLE FOR FOUNDER REVIEW` or `DONE`, reopen only for a newly proven
Blocker/Critical tied to concrete evidence (exact head, reproduction or failing
required check, affected AC/invariant, risk) plus Founder decision to reopen or
file a new regression Issue. Minor cleanup uses follow-up Issues.

## Handoff contract

Every handoff contains one bounded job or one explicitly named safe execution
bundle. Use
[handoff-template.md](./handoff-template.md) for the full field checklist. For
operational GitHub comments, prefer the compact-delta shape in
[role-handoff-contract.md](../agent-loop/role-handoff-contract.md). A bundle
may not cross independent review, Founder approval, or production-operation
gates.

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

Stop after one bounded objective with one authority scope and one terminal
durable outcome. Stop before mutation or at the first safe checkpoint when the
exact head moves, CI is stale or changes, newer authority supersedes the
bundle, the review verdict changes, mergeability changes materially, a CAS or
lease write fails, an unexpected file/Issue/PR/campaign state would be modified,
or implementation semantics would exceed the approved plan. Also stop on
`STATE_CONFLICT`, `STATE_MIGRATION_REQUIRED`, Founder gate, exhausted review
budget without autonomous Review 4, or when evidence cannot be proven
(`BLOCKED_EXTERNAL`).

## Existing-task migration behavior

Extracted to module: [Migration Guidance](./modules/migration-guidance.md)

## Repository-specific override behavior

Extracted to module: [Child-Sync Operations](./modules/child-sync-operations.md)

## Compact transition examples

Extracted to module: [Templates / Examples](./modules/templates-examples.md)

## Worked examples

Extracted to module: [Templates / Examples](./modules/templates-examples.md)
