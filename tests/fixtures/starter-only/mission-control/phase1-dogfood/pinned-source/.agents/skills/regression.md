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
- UI animation, Framer Motion choreography, slow-motion QA, reduced-motion behavior, or perceived continuity.

## Validation Selection

- Follow `AGENTS.md#validation-before-pr-and-merge`.
- Docs-only changes: starter `pnpm run guard:safety`; child
  `pnpm run bemoat:guard:safety`.
- Sync or harness docs: in child projects also run
  `pnpm run bemoat:boilerplate:check -- --harness-only` when available.
- Code changes: starter `pnpm run check`; child `pnpm run bemoat:check` when
  supported, otherwise `bemoat:guard:safety`, `bemoat:test:int`, and
  child-owned code checks.
- Payload schema or admin changes: run the matching code tier, then starter
  `generate:types` / `generate:importmap` or child-owned generation scripts
  when present.

## Motion QA Reporting

For non-trivial UI animation work, report:

- Normal-speed visual QA result.
- Slow-motion QA result when timing or continuity is unclear.
- Reduced-motion behavior.
- Changed animation selectors or components.
- Remaining motion risks, especially blink, pop, snap, jank, or same-object identity loss.

## Report Format

Include:

- Commands run.
- Pass or fail result for each command.
- Known gaps.
- Manual checks still needed.
- Remaining risk.
