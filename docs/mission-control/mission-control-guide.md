---
policy_id: bemoat-mission-control
version: 1.3.0
scope: repository-development
canonical_repository: boat1994/bemoat-web-starter
max_review_cycles: 3
---

# Stateless coordination policy

This guide is the canonical policy source for Bemoat's stateless
cross-agent workflow. It is read from the approved protected base, never from
an unmerged task branch. Chat history and copied handoffs are context only;
fresh repository and GitHub evidence is authoritative.

## Current protocol

The public coordination protocol has exactly two commands:

    pnpm run bemoat:context <issue-number> --json
    → one bounded objective
    → pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>
    → fresh context

bemoat:context is read-only. It reconstructs repository, protected-base,
Issue, PR, exact-head CI, review, policy, and local-durability evidence and
returns one route. bemoat:handoff appends one validated, read-back-verified
HANDOFF record. Its body file must contain exactly one strict JSON HANDOFF
object.

## Bounded objective execution

Assign one accountable controller per bounded objective. The controller may
delegate bounded internal subwork, including read-only evidence gathering,
Git/GitHub and repository inventory, mechanical implementation, focused
testing and validation, and other deterministic substeps. These tasks stay
inside the authorized objective. The controller retains responsibility for the
objective contract, authority and routing, evidence synthesis against live
durable state, resolving contradictions, acceptance criteria audit, durable
delivery/Handoff, and fresh Context after durable completion before continuing.
Continuation follows only independently reconstructed Context command routes.

Workers receive no new authority. They must stay within assigned scope and cannot
broaden it, start dependent or future objectives, merge, cross production,
destructive, migration, or secret gates, bypass Context/Handoff/public-command
contracts, treat worker-local state as durable workflow authority, or make gate
decisions.

Multiple read-only, non-overlapping workers may contribute evidence or
deterministic findings to the same objective; they do not create a bundle of
independent objectives. Make mutation ownership unambiguous before workers
write. Overlapping worker mutation is prohibited. Assign one worker to each
bounded mutation scope. The controller remains accountable for combining
the results and completing the objective's authorized delivery steps.

Policy semantics remain agnostic to provider and model identity. Provider or
model identity never grants authority or changes routing. Independent review
remains independent; a worker implementing or controlling the objective does
not perform its review.

Global MC authorizes one bounded objective at a time. If semantics and
authority are clear, choose the lowest-cost sufficient model and keep one
accountable controller for the objective. Delegate suitable internal subtasks
to non-overlapping workers as needed; the controller need not perform every
deterministic step personally. When useful, the controller may keep the same
capable worker through a coherent inspect/implement/focused-check/correction
chain and any authorized delivery steps. Run the required full validation tier
on the final candidate; do not repeat it after each small edit unless a failure
or specific risk warrants it. Completing a substep alone does not require
replacing the controller, a return to Global MC, or fresh Context.

Split only at a real boundary: unresolved authority or protocol decision;
destructive, production, migration, or secret gate; independent review required
by policy; required validation that needs a separately scoped correction;
scope expansion; conflicting or stale durable evidence; unsupported command
or policy. A correction that remains in scope can stay with the same worker.

That worker may carry out only that objective. Do not combine independent
objectives or start dependent future work before fresh Context and authorization.
Once the objective has a durable result, publish required Handoff and reconstruct
Context before choosing or starting the next objective. Independent review
remains separate.

Example: `Global MC → one worker (one objective) → durable result/Handoff → fresh Context → next route`

bemoat:context:sync-base remains a separately bounded protected-main
synchronization utility. Run CLI Discovery before invoking any retained
bemoat command. Follow the repository's
[Bemoat CLI Discovery](../../AGENTS.md#bemoat-cli-discovery) rule, use the
registry-declared contract, and use its safe help invocation.
Help is read-only and must not mutate GitHub, branches, or local workflow
state.

## Approved protected base

The canonical generic approved-base rule is:

1. If live remote `refs/heads/dev` exists:
      approved base = `dev`

2. Otherwise, if live remote `refs/heads/main` exists:
      approved base = `main`

3. Otherwise:
      STOP with precise approved-base-unresolved classification.

`main` and `dev` both existing is NOT contradictory.
`dev` deterministically wins.

These are NOT approved-base authority:

- GitHub default branch
- GitHub protection status
- hidden/local git config
- environment variables or undocumented caller overrides
- Issue metadata
- provider identity
- chat/session state

A repository requiring a different integration/protected base is unsupported
by this generic resolver until merged repository authority explicitly extends
the supported branch-role contract.

Do not guess another branch.

Context and Handoff must consume the same resolved approved base.

## Review and correction boundaries

STANDARD work receives one independent, risk-adjusted semantic review when a
review gate applies. A bounded correction is evaluated with a focused Delta Review
against the changed scope and the original acceptance criteria.
Independent review evidence must remain independent; a correction must not
silently broaden scope or restart unrelated review.

Exact-head CI, repository/base identity, policy binding, required checks,
authority, and durable evidence remain mandatory. Ambiguous or unavailable
evidence stops fail-closed as STOP, including BLOCKED_EXTERNAL,
STATE_CONFLICT, or CLI_DISCOVERY_DEFECT as applicable.

## Safety and durability

Each objective has one authority scope, explicit in/out-of-scope boundaries,
acceptance-criteria audit, required checks, and one terminal outcome.
Progressive durable commits are allowed for bounded work, but dirty,
uncommitted, unpublished, or non-durable required state cannot be treated as
complete evidence. Destructive, production, secret, migration, and merge
operations require their normal repository gates.

No agent may autonomously merge, approve its own review, invent authority,
repair conflicting Issue state, or treat a handoff as permission for a new
objective. FOUNDER_GATE and STOP remain human-owned boundaries. A handoff at a
gate records the evidence and next permitted action; it does not grant the
approval.

## Child synchronization

Child projects receive the managed harness through
bemoat:boilerplate:sync -- --harness-only. Sync must preserve child-owned
infrastructure, secrets, overrides, and project-specific resources. Generic
branch, repository, toolchain, environment, and child-sync guards remain
required and must fail closed on drift or unsafe inputs.

## Historical evidence

Older Issues and comments may contain RESULT, REVIEW_VERDICT, or managed-state
vocabulary. Context may read those records as bounded, migration-only
evidence when reconstructing history. They do not create a current route,
review counter, state machine, write permission, or alternate transport. New
work uses only Context and Handoff.

For the exact field and command contracts, see command-reference.md and
handoff-template.md.
