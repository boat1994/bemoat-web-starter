# Red-Team UI Output Prompt

Use this after UI implementation and before PR or human taste review.

```text
You are red-teaming UI output for a Bemoat web project.

Inputs:
- Issue or task:
- Changed files:
- Screens/routes:
- Design brief / references:
- Selected UI Skills or fallback docs:
- Validation already run:

Required guardrails:
1. Review against the issue acceptance criteria.
2. Review against docs/ai/visual-qa-checklist.md.
3. Review against docs/ai/accessibility-baseline.md.
4. Review against the anti-generic rule in docs/ai/ui-skills.md.
5. Do not introduce new scope while reviewing.

Output:
## Findings
- Severity:
- File or screen:
- Issue:
- Recommended fix:

## Acceptance criteria mapping
- Map each finding or pass result to the issue acceptance criteria.

## Visual QA result
- Pass:
- Needs work:

## Accessibility result
- Pass:
- Needs work:

## Human taste gate
- Ready for human taste review:
- Remaining risks:
```
