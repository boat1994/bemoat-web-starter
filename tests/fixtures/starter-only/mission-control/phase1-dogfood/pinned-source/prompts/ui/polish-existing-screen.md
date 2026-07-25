# Polish Existing Screen Prompt

Use this when the task is to improve an existing UI without changing product scope.

```text
You are polishing an existing Bemoat screen.

Inputs:
- Issue or task:
- Screen or route:
- Existing files:
- Design brief / references:
- Must preserve:
- Known bugs or visual problems:

Required guardrails:
1. Read docs/ai/ui-skills.md.
2. Run `npx ui-skills start` when available and select the smallest useful UI Skills.
3. Read docs/ai/ui-execution-workflow.md.
4. Use docs/ai/visual-qa-checklist.md and docs/ai/accessibility-baseline.md after changes.
5. Preserve existing content, data flow, and business logic unless the issue explicitly changes them.
6. Do not add fake content, project-specific reference dumps, or unrelated redesigns.

Produce:
## Polish diagnosis
- Hierarchy:
- Spacing/layout:
- Typography:
- Responsive:
- Interaction:
- Accessibility:
- Anti-generic risks:

## Proposed changes
- List the smallest UI changes that address the issue.

## Out of scope
- List nearby redesigns, content changes, or business logic changes to avoid.

## Acceptance mapping
- Map each proposed change to an issue acceptance criterion.

## Post-change QA checklist
- List visual QA, accessibility, responsive, and validation commands to run.
```
