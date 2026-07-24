# UI Skills Guide

Use this guide whenever a Bemoat issue asks for new UI, frontend polish, responsive layout work, visual QA, or accessibility cleanup.

## What UI Skills Are

UI Skills are execution guidance for interface work. They help an agent choose the right craft checklist before changing UI code.

For current UI Skills routing, start with the official CLI:

```bash
npx ui-skills start
```

Reference: https://www.ui-skills.com/skills

The CLI is the preferred entrypoint because it can route the agent to the smallest useful skill for the task. The starter docs in this folder are the Bemoat wrapper around that routing: they define what is reusable, what stays project-specific, and what must be checked before a PR.

## What UI Skills Are Not

UI Skills do not replace:

- The current GitHub issue and acceptance criteria.
- A product or design brief.
- Design Ref CMS memory.
- Mobbin, screenshots, Figma, or other project references supplied by the issue.
- Human taste approval.
- Accessibility testing.
- The repo validation tier in `AGENTS.md`.

## Required Selection Rule

Before UI implementation or polish, choose the smallest useful guidance set.

Default flow:

1. Read the current issue and acceptance criteria.
2. Read any project-specific design brief, reference pack, screenshots, or Design Ref CMS notes explicitly provided for this task.
3. Run `npx ui-skills start` when network and tooling are available.
4. Select only the relevant UI Skills.
5. Write the implementation plan before editing UI files.
6. Run visual QA and accessibility checks after implementation.
7. Write delta notes for human review.

If the CLI is unavailable, use this fallback selection:

| Task | Smallest useful guidance |
|------|--------------------------|
| General UI planning | `ui-skills-root` |
| New screen or large section | `frontend-design` + `baseline-ui` |
| Polish existing UI | `frontend-design` + visual QA checklist |
| Accessibility bug or form/navigation work | accessibility guidance + `docs/ai/accessibility-baseline.md` |
| Motion or interaction polish | relevant motion skill + reduced-motion review |

Do not load every UI-related skill by default.

## Anti-Generic UI Rule

Avoid output that looks like generic AI-generated SaaS or portfolio filler.

Check for:

- Default card grids with no clear product logic.
- Oversized gradients, badges, and decorative panels that do not help the user.
- Vague copy such as "streamline your workflow" unless the issue provides that language.
- Repeated section rhythms with no hierarchy shift.
- Placeholder testimonials, stats, logos, screenshots, or brand claims.
- UI that copies a reference pack instead of extracting the useful pattern.

Prefer:

- Clear hierarchy tied to the user's job.
- Real content from the issue, CMS, or project repo.
- Calm density for operational tools.
- Strong responsive behavior over decorative complexity.
- One polished interaction over many weak effects.

## shadcn and Tailwind Composition Rule

Use shadcn and Tailwind as composition primitives, not as a visual identity.

- Prefer existing project components, tokens, and layout conventions before adding local patterns.
- Keep component APIs small and close to the existing codebase style.
- Compose from accessible primitives and semantic HTML.
- Avoid dumping default shadcn cards, badges, tabs, and gradients without product-specific hierarchy.
- Do not add a new design system layer for one issue.

## Output Contract

Before editing, agents should report:

- Selected UI Skills or fallback docs.
- Files inspected.
- Proposed file changes.
- Out-of-scope items.
- Visual QA and accessibility checks planned.

After editing, agents should report:

- Changed files.
- Visual delta notes.
- Accessibility checks run.
- Validation commands and results.
- Remaining risks for human taste review.
