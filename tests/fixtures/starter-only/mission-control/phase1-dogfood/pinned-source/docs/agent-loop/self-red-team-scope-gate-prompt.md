# Self Red-Team Scope Gate Prompt

Copy this prompt for one constrained self red-team pass before expanding a spec,
creating a detailed plan, or requesting another High Reasoning pass.

```text
You are running one constrained self red-team scope gate for a Bemoat task.

Inputs:
- Issue or task:
- Active implementation slice:
- Current plan/spec/output:
- Concrete artifact inspected: issue | spec | code | diff | test | UI
- Decisions already closed, with reopen conditions:
- Validation or evidence already available:

Rules:
1. Do not fully specify future phases.
2. Do not reopen a Closed decision unless its reopen condition is met or new
   evidence exists.
3. Classify every finding as exactly one of:
   - BLOCKER
   - EXPENSIVE_TO_REVERSE
   - VERIFY_DURING_IMPLEMENTATION
   - FUTURE_BACKLOG
   - SPECULATIVE
4. Only BLOCKER and EXPENSIVE_TO_REVERSE findings may block implementation by
   default.
5. FUTURE_BACKLOG and SPECULATIVE findings get at most one sentence each unless
   the owner explicitly promotes them into the active slice.
6. Stop after this pass. Prefer reviewing the real diff, tests, or UI over
   another abstract reasoning pass.

Check:
- Is each requirement necessary for the active implementation slice?
- If a decision is wrong later, is it expensive to reverse?
- Is each edge case backed by current evidence, code, or an existing contract?
- Does the detail block implementation now, or can it be verified during
  implementation?
- Is this analysis producing a new decision or action?
- Has a closed decision been reopened without new evidence?

Output:
## Findings
| Classification | Finding | Evidence | Action |
| --- | --- | --- | --- |

## Planning Loop Check
- Loop detected: yes/no
- Reason:

## Decision Ledger Updates
- Closed decisions reopened: none or list with evidence
- New decisions to close: none or list

## Outcome
Choose exactly one:
- START_IMPLEMENTATION
- RESOLVE_BLOCKERS
- MOVE_NON_BLOCKERS_TO_BACKLOG

## Stop Message
If no unresolved BLOCKER or EXPENSIVE_TO_REVERSE finding remains, end with:
SELF RED-TEAM: Further specification has diminishing returns. No unresolved
blocker or expensive-to-reverse decision remains. Move non-blocking findings to
backlog and begin the smallest implementation slice.
```
