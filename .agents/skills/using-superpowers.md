# Using Superpowers - Portable Fallback

Use this file when the IDE cannot call `superpowers:using-superpowers`
natively.

Native skills remain preferred. This file is only the project-level fallback
that explains how to find and follow the same operating rules without a native
skill runtime.

## Before Development Work

1. Identify the task type: issue workflow, implementation, regression review,
   Payload CMS, Cloudflare, or docs-only maintenance.
2. Check whether a native skill or global installed skill applies. Use it first
   when available.
3. If no native skill is available, read the relevant file in
   `.agents/skills/`.
4. Read `AGENTS.md` for repository-wide rules.
5. Read `docs/agent-loop/README.md` for the working loop.
6. Confirm the starter versus child-project boundary.
7. Run `git status`.
8. Stop if unrelated local changes are present.
9. Create a short plan scaled to the task.
10. Edit only the files required for the task.
11. Run required checks.
12. Report the diff summary, validation result, and remaining risk.

## Native Skill Mapping

| Native skill | Portable fallback |
| --- | --- |
| `superpowers:using-superpowers` | This file |
| GitHub issue or PR skill | `.agents/skills/issue-workflow.md` |
| Development workflow skill | `.agents/skills/development-agent.md` |
| Verification or regression skill | `.agents/skills/regression.md` |
| Payload CMS safety guidance | `.agents/skills/payload-cms.md` plus `AGENTS.md` |

## Stop Conditions

- Dirty working tree before starting.
- Ambiguous production schema change.
- Secret, environment, D1, R2, Worker, or Cloudflare resource uncertainty.
- Unrelated files changed during the task.
- Required check fails and cannot be fixed within scope.
- Native skill instructions and project instructions conflict. In that case,
  follow the explicit user and repository instructions first, then report the
  conflict.

