# Antigravity Entry Point

Google Antigravity agents working in this repo or synced child projects must
treat `AGENTS.md` as the canonical rule entrypoint. Use
`docs/agent-loop/README.md`, `docs/agent-loop/checklist.md`, and
`docs/harness-sync-contract.md` for the operating loop, validation tier, and
child-sync boundaries.

Before editing, stop and summarize:

- Constraints and guard rails that apply to the task.
- Current branch and working-tree status.
- Files you plan to inspect or change.
- Verification commands you will run before the final response.

Do not edit until that preflight summary is complete and the branch guard rails
in `AGENTS.md` are satisfied. Do not duplicate or reinterpret the guard rails
here; follow the canonical docs when anything conflicts or is missing.

Before the final response, run the relevant validation tier from `AGENTS.md` and
report the exact commands and result. If validation cannot run or fails, say so
clearly and do not claim the task is complete.
