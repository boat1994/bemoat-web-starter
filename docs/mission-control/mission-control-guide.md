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

bemoat:context:sync-base remains a separately bounded protected-main
synchronization utility. Run CLI Discovery before invoking any retained
bemoat command. Follow the repository's
[Bemoat CLI Discovery](../../AGENTS.md#bemoat-cli-discovery) rule, use the
registry-declared contract, and use its safe help invocation.
Help is read-only and must not mutate GitHub, branches, or local workflow
state.

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
