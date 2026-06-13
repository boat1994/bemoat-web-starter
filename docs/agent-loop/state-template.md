# Agent session state

Copy this template into issue comments, PR descriptions, or agent handoff notes. Update it before ending a session so the next agent can continue without re-discovery.

```markdown
## Task

<!-- Issue or PR link, title, and one-line summary -->

## Current objective

<!-- The single thing this session is trying to finish right now -->

## Branch

<!-- e.g. chore/add-agent-loop-foundation -->

## Last completed step

<!-- e.g. "Added PR template; lint passed" -->

## Last command run

<!-- Exact command and exit status -->

## Current blocker

<!-- None, or describe what is blocking progress -->

## Files changed

<!-- List paths touched in this session -->

## Checks

| Command | Status | Notes |
|---------|--------|-------|
| Change type | docs-only / code | |
| pnpm run guard:safety | | Required for docs-only; included in `check` |
| pnpm run check | | **Required** for code changes |
| pnpm run generate:importmap | N/A or pass/fail | |
| pnpm run generate:types | N/A or pass/fail | |
| pnpm run check:full | | Before merge when practical |
| CI | | Link to run |

## Next action

<!-- One concrete step for the next agent or human -->

## Notes for next agent

<!-- Assumptions, risks, URLs inspected, things not to redo -->

## Final user notification

<!-- Copy to the user when the task ends -->

- **Branch:**
- **Commit hash:**
- **PR URL:**
- **Files changed:**
- **Commands run:**
- **Test result:**
- **Risks:**
- **Human review:**
```
