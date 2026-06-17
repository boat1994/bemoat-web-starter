# Development Agent Skill

Use this for normal implementation, documentation, maintenance, and small
starter-harness work when native development skills are unavailable.

## Required Loop

1. Read the task or issue.
2. Read `.agents/README.md`.
3. Read `AGENTS.md`.
4. Read `docs/agent-loop/README.md`.
5. Run `git status`.
6. Stop if the working tree is dirty with unrelated changes.
7. Never edit `main` directly for issue work.
8. Create the issue branch from `main` when needed.
9. Make the smallest complete change.
10. Run the validation tier from `AGENTS.md`.
11. Review `git status` and the diff summary.
12. Commit, push, open or update a PR, and comment on the source issue when the
    repository workflow requires it.
13. Summarize changed files, commands run, test results, and risks.

## Validation Defaults

- Docs-only changes: `pnpm run bemoat:guard:safety`.
- Docs that affect sync or harness assumptions:
  `pnpm run bemoat:boilerplate:check` in addition to the safety guard.
- Code changes in this starter: `pnpm run check`.
- Payload schema changes: `pnpm run check` and `pnpm run generate:types`.
- Admin component changes: `pnpm run check` and
  `pnpm run generate:importmap`.

## Scope Rules

- Prefer existing project patterns and docs over new abstractions.
- Keep changes focused on the task.
- Do not vendor full Obra or Superpowers source.
- Do not duplicate the full Cursor rules.
- Do not hardcode local-only skill paths as the only source of truth.
- Do not edit project-specific infrastructure for a reusable starter task.
- Do not commit secrets, `.env` files, Cloudflare IDs, D1 IDs, R2 bucket names,
  or Worker names.

