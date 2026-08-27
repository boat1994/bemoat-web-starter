# Mission Control handoff template

Current cross-agent handoffs are published with `bemoat:handoff` after fresh
`bemoat:context` reconstruction. This template describes the stateless
HANDOFF contract. Historical managed-task fields are retained at the end for
read/migration compatibility only.

The handoff must contain one bounded job or one explicitly named safe execution
bundle. Bundles may contain only mechanically dependent steps with one authority
scope and one terminal durable outcome; they must not cross implementation,
independent review, Founder approval, or production-operation gates.

## HANDOFF

- Task / Issue:
- Phase:
- Executing role:
- Target:
- Objective:
- Repository / branch:
- Approved base / current head:
- PR and exact-head CI:
- Policy source/ref/SHA:
- Exact bounded scope:
- Out of scope:
- Acceptance Criteria audit:
- Required checks:
- Stop conditions:
- Founder gate:
- Next permitted action:

Publish this record with:

```text
pnpm run bemoat:handoff <issue-number>
```

The receiver must run `pnpm run bemoat:context <issue-number> --json` and
verify all live bindings before acting. A HANDOFF does not create managed
state, review counters, or a second protocol transport.

### Historical migration-only managed-task fields

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
- Expected RESULT format: historical migration-only compatibility; current work
  uses `bemoat:handoff` instead.

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
