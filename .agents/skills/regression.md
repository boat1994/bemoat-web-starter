# Regression Skill

Use this before reporting that work is complete, fixed, or ready for review
when native verification skills are unavailable.

## Evidence Rule

Do not claim work is complete without fresh verification evidence. Run the
command that proves the claim, read the output, and report the actual result.

## Checklist

Ask whether the change affects:

- App runtime behavior.
- Payload schema, generated types, or migrations.
- Payload admin components or import maps.
- Cloudflare Workers, D1, R2, bindings, environments, or deploy commands.
- Boilerplate sync, harness assumptions, CI, or git hooks.
- Child project compatibility.
- Agent rules, fallback skills, or editor behavior.

## Validation Selection

- Docs-only changes: run `pnpm run bemoat:guard:safety`.
- Sync or harness docs: also run `pnpm run bemoat:boilerplate:check`.
- Code changes: run `pnpm run check`.
- Payload schema changes: also run `pnpm run generate:types`.
- Payload admin component changes: also run `pnpm run generate:importmap`.

## Report Format

Include:

- Commands run.
- Pass or fail result for each command.
- Known gaps.
- Manual checks still needed.
- Remaining risk.

