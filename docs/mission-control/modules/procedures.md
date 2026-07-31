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
= verify authorization/head/CI + mark ready when needed + merge + verify merge commit + close Issue completed + reconcile DONE + verify NO_OP
```

Reviewer completion uses the repository-owned atomic facade, not the generic
comment transport:

```bash
pnpm run bemoat:mission-control:review -- <issue-number> --body-file <verdict.md> \
  --expected-state <state> --review-type <full|delta> --expected-head <sha>
```

`bemoat:issue:comment` remains a validation/posting primitive and does not
project managed state.

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
| Issue closure | Founder-authorized merge transport, after verified merge evidence |
| `DONE` state projection | State Reconciler, only after the Issue is closed/completed and merge evidence agrees |
| Issue acceptance criteria checklist | Mission Control pre-merge reconciliation only |

Delivery and Reviewer roles may update **only** content between the
`bemoat-mission-control-state` markers. They must preserve human-authored Issue
content outside the markers. Dev must never increment `review_cycle` or `full_review_count`.

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

### Strict reconciliation classification and budget

Apply this ordered classification before writing managed state:

| Live condition | Outcome |
| --- | --- |
| Required live evidence cannot be fetched or verified | `BLOCKED_EXTERNAL` |
| Two authoritative live sources contradict each other | `STATE_CONFLICT` |
| A managed task uses unambiguous legacy post-budget or Founder-authorization fields | deterministic migration |
| One exact PR/head/CI/role-output chain is unambiguous and only bookkeeping lags | bookkeeping repair |
| The PR is merged and otherwise valid, but the managed Issue is open | `STATE_CONFLICT`; merge transport must close the Issue |
| The Issue is closed/completed, its PR is merged, and the reviewed head matches | terminal repair to `DONE` |
| The same live evidence is already represented canonically | no-op |

Missing canonical representation is not contradictory authority. Migrate
`post_budget_review_history` into `post_budget_reviews`, bind Founder review and
correction authorization to the exact review number, reviewed head, and finding
IDs, and preserve `review_cycle`, `full_review_count`, `last_reviewed_head`, and
immutable finding lineage. Remove superseded legacy keys only in the same
successful canonical write.

One reconciliation run may perform at most one deterministic state repair and
one fresh live verification. It must not recurse or attempt a second repair.
Identical evidence after a completed reconciliation performs no state write,
posts no role comment, and requires no model stage. After terminal repair,
stale non-authoritative bookkeeping must never reopen the task.

The reconciler owns no Issue lifecycle operation: it never closes or reopens an
Issue. Option A assigns closure to merge transport. After Founder authorization,
configure the repository Actions variable `BEMOAT_FOUNDER_LOGINS` as a
comma-separated allowlist of GitHub user logins. This repository-owned setting
is required for personal and organization-owned repositories; caller-provided
environment values never establish Founder identity. Then record one trusted
Issue comment containing the exact authorization object:

```json
{
  "schema_version": 1,
  "authority": "Founder",
  "scope": "merge",
  "task_issue": 123,
  "pr": 124,
  "reviewed_head": "<exact-reviewed-head>",
  "action": "merge"
}
```

Then run the single terminal entrypoint with that comment ID:

```bash
pnpm run bemoat:mission-control:merge -- 123 \
  --repo owner/repository \
  --authorization-comment <comment-id>
```

The PR body must use `Refs #<issue>`. The PR title/body and every commit subject
and body must not contain `Closes`, `Fixes`, or `Resolves` references to the
managed Issue. The transport queries every commit through GitHub's paginated
commits endpoint and rejects all of those automatic closing sources so GitHub
cannot close the Issue before protected-base verification and the explicit
closure step.

The executable command performs this exact order:

```text
verify explicit Founder authorization
→ verify exact reviewed/current PR head and required exact-head CI
→ mark the Draft PR ready when required
→ merge with expected-head protection
→ verify the merge commit on the protected base
→ close only the directly managed Issue as completed
→ invoke bounded reconciliation and require DONE
→ rerun reconciliation and require NO_OP
```

If merge succeeds before Issue closure fails, rerun the same merge command; it
does not merge twice. If Issue closure succeeds before `DONE` projection fails,
rerun it; the already-closed Issue is not closed twice. An already-merged,
closed, `DONE` task returns `NO_OP`. A delegated parent without direct
`active_pr` ownership is never closed or projected by a child task transport.

If the first reconcile command returns a classified failure, the CLI prints its
`finalReason`, then its initial `reason`, then the deterministic safe fallback;
it must never emit a blank `ERROR:` diagnostic.

### Atomic implementation dispatch

Use the managed dispatch action for a bounded implementation handoff:

```bash
pnpm run bemoat:mission-control:dispatch -- <issue-number> --body-file <handoff.md>
```

The action validates `READY`, writes `IN_PROGRESS`, posts exactly one existing
`## HANDOFF`, and verifies the resulting state. If HANDOFF publication fails,
it rolls the state back only when a fresh read proves no concurrent Issue edit;
otherwise it fails closed without overwriting the concurrent writer.

### Founder-authorized correction after normal Review 3

`FOUNDER_AUTHORIZED_CORRECTION` is the distinct execution state for the one
bounded correction a Founder explicitly authorizes after normal Review 3. It is
not Review 4: it preserves counters `3/1`, the exact `last_reviewed_head`,
immutable finding IDs, and `post_budget_reviews: []`.

Its versioned `founder_correction_authorization` binds an `authorization_id`,
Review 3, reviewed head, finding set, Founder authority, scope, and timestamp.
Dispatch requires its unconsumed `status: authorized` record:

```bash
pnpm run bemoat:mission-control:dispatch -- <issue-number> --founder-correction --body-file <handoff.md>
```

Dispatch first acquires a repository-scoped, single-winner reservation for the
authorization identity. It then posts one HANDOFF and records `status:
consumed` with that exact comment ID plus a SHA-256 binding over the immutable
authority, target, PR, exact head/correction base, Review 3, scope, finding
chain, comment timestamps, and complete HANDOFF content. The reservation is
released only after the consumed state is freshly verified. Failed or
indeterminate writes retain the reservation unless a fresh read proves safe
compensation, so concurrent dispatch cannot publish two successful HANDOFFs.

Correction preflight accepts the consumed authorization only when the bound
comment still exists, is byte-identical, and remains the latest approved,
non-superseded HANDOFF, and when its active PR, current/reviewed head, exact
finding IDs, and binding fingerprint all match. Deletion, edit, substitution,
supersession, and replay fail closed. Correction delivery preserves counters
`3/1`, the prior `last_reviewed_head`, lineage, consumed binding, and empty
`post_budget_reviews`, then returns to `BLOCKED_FOR_FOUNDER_DECISION`. It does
not authorize Review 4; a separate Founder authorization bound to the delivered
head is mandatory.

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
