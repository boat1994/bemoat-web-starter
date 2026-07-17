# Mission Control handoff template

Full reference field checklist for Mission Control `## HANDOFF` comments.
For operational GitHub posts, prefer the compact-delta shape in
[../agent-loop/role-handoff-contract.md](../agent-loop/role-handoff-contract.md)
while retaining material risk fields below when omission would create risk.

The handoff must contain one bounded job. Do not bundle implementation, review,
merge, and next-task discovery into one run.

## HANDOFF

- Repository:
- Approved base:
- Active Task Issue:
- Active PR:
- Current head SHA:
- Guide version/ref/SHA:
- Assigned role: Dev | Reviewer | Founder
- Execution role: Integration Builder | Delivery Coordinator | Reviewer | State Reconciler | Mission Control
- Review type: none | full | delta | blocker-verification
- Review cycle:
- Model/reasoning guidance:
- Exact scope:
- Out of scope:
- Acceptance Criteria:
- Open findings:
- Required checks:
- Required manual QA:
- Stop condition:
- Expected RESULT format:

### Double-Loop Review fields (conditional)

Use only when the gate is triggered; retain the existing `## HANDOFF` heading.

- Loop gate: triggered / trigger evidence / no-code checkpoint
- Failure class: IMPLEMENTATION | SPECIFICATION | VALIDATION | DECOMPOSITION | TOOL_OR_MODEL | ENVIRONMENT | UNKNOWN
- Invalidated assumptions:
- Decision: CONTINUE_IMPLEMENTATION | REVISE_SPECIFICATION | REVISE_VALIDATION | SPLIT_OR_REDECOMPOSE_TASK | CHANGE_TOOL_OR_MODEL | REPAIR_ENVIRONMENT | BLOCKED_EXTERNAL | BLOCKED_FOR_FOUNDER_DECISION | CREATE_FOLLOW_UP_ISSUE
- Next experiment:
- Material difference from prior attempts:
- Allowed / prohibited files and actions:
- Verify / stop condition:
