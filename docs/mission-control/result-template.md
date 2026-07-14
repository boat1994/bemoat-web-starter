# Mission Control RESULT template

Full reference field checklist for Mission Control `## RESULT` comments and
review outcomes. For operational GitHub posts from Dev, prefer the compact-delta
`## RESULT` in
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
- Blockers:
- Follow-up Issues created:
- Next permitted action:
- Stop confirmation:

## Reviewer verdict enum

Reviewer verdict must be exactly one of:

```text
CORRECTION REQUIRED
ELIGIBLE FOR FOUNDER REVIEW
BLOCKED FOR FOUNDER DECISION
BLOCKED EXTERNAL
STATE CONFLICT
```
