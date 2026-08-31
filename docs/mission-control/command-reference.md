# Stateless command reference

Run repository-defined CLI Discovery before invoking a retained command. Use
the registry-declared inputs, safe help invocation, and live evidence returned
by the command.

## Context

    pnpm run bemoat:context <issue-number> --json

This command is read-only. It binds the Issue to the repository, protected
base, policy path/SHA, PR, exact-head CI, review, and local durability
evidence, then returns one route. Help must not create or modify any state.

## Handoff

    pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>

The body file must contain exactly one strict JSON HANDOFF object. The command
validates scope, authority, evidence, acceptance criteria, required checks,
stop conditions, and next permitted action, then appends and verifies one
durable record.

## Protected-base synchronization

    pnpm run bemoat:context:sync-base

This is a separately bounded synchronization utility. It does not authorize
implementation, review, approval, or merge.

## Stop conditions

Stop and return STOP when repository/base/head/CI/policy evidence is ambiguous,
unavailable, conflicting, noncanonical, or not durable. Use BLOCKED_EXTERNAL,
STATE_CONFLICT, or CLI_DISCOVERY_DEFECT when that classification is supported
by the command contract. FOUNDER_GATE remains a human authorization boundary.
No agent may autonomously merge or repair conflicting Issue state.

Historical RESULT and REVIEW_VERDICT comments may be read by Context as
bounded migration evidence only. They do not expose a writer, create a review
route, or grant authority.
