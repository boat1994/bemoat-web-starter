# ADR 0006: Stop overbuild before commit

## Status

accepted

## Context

Coding agents tend to add refactors, abstractions, and scope beyond the issue when they already understand the codebase. That increases review cost, merge risk, and sync surface area. Bemoat issues are sized for **one focused PR** with clear acceptance criteria.

The operating manual and red-team role explicitly call out overbuild as a stop condition.

## Decision

Agents and contributors **stop and report** (do not commit) when:

- Work exceeds issue acceptance criteria or adds "while I'm here" changes
- A drive-by refactor or new abstraction is not required for the task
- Requirements are ambiguous — clarify before coding
- The change belongs in the wrong repo (starter vs child)
- A follow-up issue is the right home for extra work

**Mantra:** Smallest complete change. One issue → one PR → one focused commit (unless the issue says otherwise).

GPT-5.5 (or a red-team pass) gates scope before commit; Composer 2.5 implements within that boundary.

## Consequences

### Positive

- PRs stay reviewable and map cleanly to GitHub issues.
- Less accidental coupling between unrelated fixes.
- Child sync and harness contracts stay stable.

### Negative

- Agents must resist "helpful" extras; some polish may need a separate issue.
- Strict scope can feel slow when the same file needs unrelated fixes — file a follow-up instead.

## Open questions

- None. Enforcement is procedural (agent rules, PR review), not a guard script.
