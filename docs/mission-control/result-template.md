# Historical Mission Control RESULT template

`RESULT` is migration-only historical evidence after the Issue #410 stateless
cutover. Do not publish a new RESULT for current work; use `bemoat:handoff` and
the stateless HANDOFF template instead. The fields below remain so existing
comments and migration readers can be interpreted. For old operational GitHub
posts from Dev, the compact-delta `## RESULT` in
[../agent-loop/role-handoff-contract.md](../agent-loop/role-handoff-contract.md).
For Core MC-gated review, post `## REVIEW_VERDICT` using exactly one verdict
from the enum below. This is the same vocabulary as
[mission-control-guide.md](./mission-control-guide.md) and the Core section of
[../agent-loop/role-handoff-contract.md](../agent-loop/role-handoff-contract.md).

## RESULT

- Role:
- Action completed:
- Repository/branch:
- Previous head:
- Current exact head:
- Files changed or reviewed:
- Acceptance Criteria audit:
- Commands/checks and outcomes:
- Manual QA evidence:
- Findings and dispositions:
- Review cycle/verdict:
- Durable GitHub state updated:
  - Delivery: `state: AWAITING_REVIEW_1`, `active_pr`, `current_head`; counters remain `0`/`0`
  - Review: resulting state, `review_cycle`, `full_review_count`, `last_reviewed_head`
- Blockers:
- Follow-up Issues created:
- Next permitted action:
- Stop confirmation:

### Double-Loop Review outcome (conditional)

Use only after a triggered no-code diagnostic checkpoint; retain `## RESULT`.

- Loop gate and trigger evidence:
- Failure class: IMPLEMENTATION | SPECIFICATION | VALIDATION | DECOMPOSITION | TOOL_OR_MODEL | ENVIRONMENT | UNKNOWN
- Invalidated assumptions:
- Decision: CONTINUE_IMPLEMENTATION | REVISE_SPECIFICATION | REVISE_VALIDATION | SPLIT_OR_REDECOMPOSE_TASK | CHANGE_TOOL_OR_MODEL | REPAIR_ENVIRONMENT | BLOCKED_EXTERNAL | BLOCKED_FOR_FOUNDER_DECISION | CREATE_FOLLOW_UP_ISSUE
- Smallest next experiment or blocker:
- Material difference from prior attempts:
- Allowed / prohibited actions:
- Verification and stop condition:

## Reviewer verdict enum

Reviewer verdict must be exactly one of:

```text
CORRECTION REQUIRED
ELIGIBLE FOR FOUNDER REVIEW
BLOCKED FOR FOUNDER DECISION
BLOCKED EXTERNAL
STATE CONFLICT
```
