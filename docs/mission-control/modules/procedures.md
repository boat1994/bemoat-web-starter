> Current work uses `bemoat:context` for read-only reconstruction and
> `bemoat:handoff` for the final append-only cross-agent record. The managed
> delivery/review/state procedures in this module are historical migration
> compatibility only; they are not supported future routing.

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
= verify exact Founder authorization/verdict/head/base/CI/mergeability → mark ready when needed → merge the expected head → verify protected-base merge commit → post final RESULT → close Task Issue → write Task DONE → project campaign slice DONE → select, but do not start, the next campaign action
```

The merge transition uses one generic Founder authorization record. It must
contain the trusted Founder identity, immutable decision comment/reference,
non-supersession verification, repository, Task Issue, PR when applicable,
exact head and protected base when applicable, exact scope, and exact
authorized action. A ratification, implementation-only decision, ambiguous or
fabricated comment, superseded decision, scope mismatch, or non-merge action is
not merge authority.

The managed review writer is retired. Historical `REVIEW_VERDICT` evidence may
still be read for migration compatibility, but no supported command publishes
managed review state or mutates review counters.

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
| Issue closure | Native GitHub evidence; no retained custom merge writer |
| `DONE` state projection | Historical compatibility only; no retained merge-completion writer |
| Issue acceptance criteria checklist | Mission Control pre-merge reconciliation only |

Delivery and Reviewer roles may update **only** content between the
`bemoat-mission-control-state` markers. They must preserve human-authored Issue
content outside the markers. Dev must never increment `review_cycle` or `full_review_count`.

## Deterministic reconciliation

When a safe execution bundle deterministically produces its durable projection,
the executor writes that final state in the same authorized run. A separate
reconciliation run is not required for successful bundled execution.

## Reconciliation only on failure

Require a separate reconciliation run only when the bundle's projection failed,
a concurrent writer changed authority or state, evidence is ambiguous or
unavailable, or the durable result conflicts with the action outcome. In those
cases reconciliation remains bounded, idempotent, fail-closed, and subject to
the existing one-repair/one-verification rules. Identical evidence remains
`NO_OP` and must not create another model stage.

When bookkeeping lag is unambiguous outside a bundle, Mission Control or a
State Reconciler may repair the managed state block without requiring a
separate coordination run before Review 1 or the next permitted action.

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
| The PR is merged and otherwise valid, but the managed Issue is open | `STATE_CONFLICT`; reconstruct native GitHub evidence and stop |
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
Issue. The legacy managed and STANDARD custom merge wrappers are retired.
Context reconstructs ordinary merge authority and completion from native GitHub
evidence; no retained command posts a terminal RESULT, closes an Issue, writes
managed `DONE`, or projects campaign state as part of merge completion.

If the first reconcile command returns a classified failure, the CLI prints its
`finalReason`, then its initial `reason`, then the deterministic safe fallback;
it must never emit a blank `ERROR:` diagnostic.

### Retired stateful dispatch

The former stateful implementation-dispatch transport is retired. Historical
dispatch state is read-only and stops at the Founder gate; no replacement
command or direct Issue-body mutation is authorized.

### Founder-authorized correction after normal Review 3

`FOUNDER_AUTHORIZED_CORRECTION` is the distinct execution state for the one
bounded correction a Founder explicitly authorizes after normal Review 3. It is
not Review 4: it preserves counters `3/1`, the exact `last_reviewed_head`,
immutable finding IDs, and `post_budget_reviews: []`.

Its versioned `founder_correction_authorization` binds an `authorization_id`,
Review 3, reviewed head, finding set, Founder authority, scope, and timestamp.
The retired stateful transport no longer consumes this authorization or posts a
correction HANDOFF. Historical authorization bindings remain read-only and
fail closed when evidence is incomplete, stale, or conflicting.

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
