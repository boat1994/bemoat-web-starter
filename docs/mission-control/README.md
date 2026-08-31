# Stateless coordination

This directory contains the canonical policy and public contract for Bemoat's
stateless cross-agent workflow.

    pnpm run bemoat:context <issue-number> --json
    → one bounded objective
    → pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>
    → fresh context

bemoat:context reconstructs live repository, Issue, PR, CI, review, policy,
and durability evidence without mutation. bemoat:handoff appends one
validated HANDOFF record whose body file contains exactly one strict JSON
object. bemoat:context:sync-base remains the protected-main synchronization
utility.

Canonical files:

| File | Purpose |
| --- | --- |
| mission-control-guide.md | Current policy, review boundaries, fail-closed safety, and sync rules |
| command-reference.md | Public command and CLI Discovery contract |
| handoff-template.md | Strict HANDOFF fields and publication example |
| ../../prompts/mission-control/chatgpt-project-loader.md | Copyable current Project loader |
| ../agent-loop/role-handoff-contract.md | Compact GitHub transport details |

Read the guide from the approved protected base. Historical RESULT,
REVIEW_VERDICT, and managed-state records are read-only migration evidence;
they are not current commands or authorization.
