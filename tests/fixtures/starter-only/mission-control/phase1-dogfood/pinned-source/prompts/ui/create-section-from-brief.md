# Create Section From Brief Prompt

Use this when creating one UI section from an approved brief.

```text
You are creating one section in a Bemoat web project.

Inputs:
- Issue or task:
- Section purpose:
- Primary user action:
- Required content:
- Design brief / references:
- Existing components or tokens:
- Target file or route:

Required guardrails:
1. Read docs/ai/ui-skills.md.
2. Run `npx ui-skills start` when available and select the smallest useful UI Skills.
3. Read docs/ai/ui-execution-workflow.md.
4. Use existing project components and Tailwind/shadcn composition patterns.
5. Do not create a new design system for one section.
6. Do not invent project-specific claims, screenshots, logos, stats, or testimonials.

Output:
## Section contract
- User job:
- Primary action:
- Content hierarchy:
- Layout intent:
- Responsive behavior:
- States needed:
- Accessibility requirements:

## Implementation plan
- List files to inspect, files to change, and ordered implementation steps.

## Visual QA plan
- List breakpoints, states, hierarchy checks, and accessibility checks.
```
