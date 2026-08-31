# Agent session state

Copy this template for **local/session recovery** (interrupted work, PR
descriptions, or private execution notes). For current GitHub transport between
agents on an Active Task Issue, use `bemoat:context` followed by
`bemoat:handoff`; see [role-handoff-contract.md](./role-handoff-contract.md).
Older comment records are migration-only evidence. This template is
local/session recovery only.

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
| Starter docs: `pnpm run guard:safety`; child docs: `pnpm run bemoat:guard:safety` | | Required for docs-only |
| Starter code: `pnpm run check`; child code: `pnpm run bemoat:check` when supported, otherwise child-owned checks | | Required for code changes |
| Starter admin: `pnpm run generate:importmap`; child admin: child-owned `generate:importmap` when present | N/A or pass/fail | |
| Starter schema: `pnpm run generate:types`; child schema: child-owned `generate:types` when present | N/A or pass/fail | |
| Starter or child-local `pnpm run check:full` when defined | | Before merge when practical |
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
