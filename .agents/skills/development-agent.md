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
8. Create the issue branch from `dev` when needed. If `dev` does not exist,
   follow the bootstrap note in `docs/workflow/git-flow.md` and call out the
   temporary exception.
9. Make the smallest complete change.
10. Run the validation tier from `AGENTS.md`.
11. Review `git status` and the diff summary.
12. Commit, push, open or update a PR, and comment on the source issue when the
    repository workflow requires it.
13. Summarize changed files, commands run, test results, and risks.

## UI Animation Tasks

Before implementing non-trivial UI animation, read `.agents/skills/ui-animation.md` when native `ui-animation` skill loading is unavailable.

Trigger it when the task includes drawer, collapse, expand, morph, handoff, travel, transition, choreography, motion polish, visual QA, Framer Motion, perceived continuity, blink, pop, snap, or jank.

Keep CSS responsible for base layout, static styling, and simple one-property micro-transitions. Prefer Framer Motion for sequencing, height reveal, enter/exit, layout perception, same-object continuity, and state choreography.

## Validation Defaults

- Follow `AGENTS.md#validation-before-pr-and-merge`; do not assume raw
  non-namespaced scripts exist in child projects.
- Docs-only changes in this starter: `pnpm run guard:safety`.
- Docs-only changes in child projects: `pnpm run bemoat:guard:safety`.
- Docs that affect child sync or harness assumptions: also run
  `pnpm run bemoat:boilerplate:check -- --harness-only` in child projects, or
  `pnpm run boilerplate:check` in this starter when useful.
- Code changes in this starter: `pnpm run check`.
- Code changes in child projects: `pnpm run bemoat:check` when the child
  supports its local `lint` and `typecheck` scripts; otherwise run
  `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int`, and the
  child-owned code checks that exist.
- Payload schema changes: run the matching code tier above, then starter
  `pnpm run generate:types` or the child-owned `generate:types` script when
  present.
- Admin component changes: run the matching code tier above, then starter
  `pnpm run generate:importmap` or the child-owned `generate:importmap` script
  when present.

## Scope Rules

- Prefer existing project patterns and docs over new abstractions.
- Keep changes focused on the task.
- Do not vendor full Obra or Superpowers source.
- Do not duplicate the full Cursor rules.
- Do not hardcode local-only skill paths as the only source of truth.
- Do not edit project-specific infrastructure for a reusable starter task.
- Do not commit secrets, `.env` files, Cloudflare IDs, D1 IDs, R2 bucket names,
  or Worker names.
