# UI Execution Workflow

Use this workflow for Bemoat UI work in starter or child projects.

## Pipeline

```text
Design brief from CMS / issue / reference pack
-> select smallest useful UI skill
-> create implementation plan
-> apply UI changes
-> run visual QA checklist
-> run accessibility checklist
-> generate delta notes
-> human taste gate
```

## Pre-Implementation Checklist

- [ ] Read the issue and acceptance criteria.
- [ ] Confirm whether the work belongs in `bemoat-web-starter` or a child project.
- [ ] Read any supplied design brief, reference pack, screenshots, or Design Ref CMS notes.
- [ ] Run `npx ui-skills start` when available and select the smallest useful skill set.
- [ ] If the CLI is unavailable, select fallback guidance from `docs/ai/ui-skills.md`.
- [ ] List selected guardrails before editing.
- [ ] List what is intentionally out of scope.
- [ ] Create an implementation plan before changing UI code.
- [ ] Confirm validation tier from `AGENTS.md`.

## Scope Control

Do:

- Keep changes mapped to the current issue.
- Preserve existing product content unless the issue asks to change it.
- Reuse existing components, tokens, spacing conventions, and data flow.
- Add states that a real user would encounter.
- Prefer a small complete improvement over a broad redesign.

Do not:

- Redesign unrelated screens.
- Add project-specific reference assets to the starter.
- Add fake testimonials, logos, metrics, or production claims.
- Replace Design Ref CMS or human taste review with generic skill output.
- Add a UI automation framework in a normal UI polish task.

## Implementation Rules

- Start with layout and hierarchy before decoration.
- Make responsive behavior explicit.
- Keep fixed-format UI stable with dimensions, aspect ratios, or grid constraints.
- Use semantic HTML and accessible primitives.
- Add motion only when the trigger, moving element, purpose, timing, and reduced-motion behavior are clear.
- Keep Tailwind class usage readable and close to local conventions.

## Post-Implementation Checklist

- [ ] Run `docs/ai/visual-qa-checklist.md`.
- [ ] Run `docs/ai/accessibility-baseline.md`.
- [ ] Test mobile and desktop breakpoints when UI changed.
- [ ] Verify loading, empty, error, success, disabled, and permission states when relevant.
- [ ] Check for generic AI-looking UI.
- [ ] Run the validation tier from `AGENTS.md`.
- [ ] Write visual delta notes.
- [ ] Ask for human taste review when the UI direction changed.

## Visual Delta Notes Format

Use this format in PRs or issue reports:

```markdown
### Visual delta notes
- Changed:
- Preserved:
- Responsive behavior checked:
- Accessibility checks:
- UI Skills / fallback docs used:
- Human taste review needed:
```

## Human Taste Gate

Human review is required before treating a new visual direction as canonical. Agents may recommend, implement, and self-check UI, but project taste and promoted reusable patterns require human approval.
