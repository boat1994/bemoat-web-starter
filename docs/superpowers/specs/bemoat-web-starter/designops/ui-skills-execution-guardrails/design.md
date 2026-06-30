# UI Skills Execution Guardrails Design

- Date: 2026-06-30
- Project: `bemoat-web-starter`
- Initiative: DesignOps agent guardrails
- Related Issue: https://github.com/boat1994/bemoat-web-starter/issues/65
- Status: Draft spec for human review
- Branch: `docs/65-ui-skills-execution-guardrails`

## Purpose

Add reusable UI Skills execution guidance to `bemoat-web-starter` so AI-assisted frontend work starts from the right guardrail, stays aligned with a design brief, and ends with visual and accessibility checks. The starter should own the generic workflow, prompts, and checklists. Project-specific references, brand taste, screenshots, and Design Ref CMS memory remain downstream.

The preferred UI Skills entrypoint is:

```bash
npx ui-skills start
```

The starter should document this command as the default skill-selection step, then provide fallback Markdown guidance for offline or unavailable CLI contexts.

## Problem

The starter already has a broad HTML overview at `docs/ai/guardrail-workflow-bible.html`, but agents need smaller Markdown and prompt artifacts that are easier to select, copy, sync, and reference during issue work. Without that split, UI agents may over-load every possible skill, produce generic AI-looking UI, skip visual QA, or confuse reusable starter rules with project-specific taste memory.

## Goals

- Define how agents choose the smallest useful UI skill before building or polishing UI.
- Add a reusable UI execution workflow for issue-driven frontend work.
- Add prompt templates for selecting a UI skill and polishing an existing screen.
- Document `npx ui-skills start` as the preferred skill-selection entrypoint.
- Add visual QA and accessibility baseline checklists.
- Add an anti-generic UI rule and a shadcn/Tailwind composition rule.
- Keep all guidance generic and reusable across Bemoat child projects.
- Make the sync impact explicit so child projects can receive the guardrails after starter merge.

## Non-Goals

- Do not add project-specific Mobbin screenshots, bemoat homepage references, brand taste notes, or copyrighted reference dumps.
- Do not build a UI automation engine, MCP wrapper, screenshot ingester, or Design Ref CMS feature.
- Do not change frontend app code, Payload schema, Cloudflare config, package dependencies, or deployment behavior.
- Do not make UI Skills the source of truth for taste decisions. Human review remains the final taste gate.

## Source of Truth

Primary source:

- GitHub issue #65: `[DesignOps] Add UI Skills execution guardrails to starter`

Supporting sources:

- `docs/ai/guardrail-workflow-bible.html`
- `docs/agent-loop/source-of-truth.md`
- `docs/harness-sync-contract.md`
- `docs/agent-loop/checklist.md`
- `docs/superpowers/specs/_templates/ux-ui-spec.md`

## Recommended Approach

Use a minimal managed guardrail pack.

Create a small set of Markdown docs and prompt templates under `docs/ai` and `prompts/ui`, then add only the new reusable guardrail files to the boilerplate sync contract so child projects receive the same execution rails. This keeps the first version useful without turning it into a large design system or automation framework.

The docs should treat `npx ui-skills start` as the default routing command. The local starter docs are the Bemoat wrapper around that command: they explain project boundaries, sync behavior, QA expectations, and fallback selection when the CLI is unavailable.

Rejected alternatives:

- Keep everything inside `guardrail-workflow-bible.html`: simpler diff, but weak day-to-day usability for agents and prompt copy/paste.
- Add only Cursor rules: useful for Cursor, but less reusable for Codex, Composer, GitHub issues, and child repos that consume docs.
- Build a full UI automation workflow now: too broad for issue #65 and explicitly outside the rest gate.

## Proposed Files

Create:

- `docs/ai/ui-skills.md`
  - Explains what UI Skills are for, what they are not for, how to use `npx ui-skills start`, and how to choose the smallest useful fallback guidance.
- `docs/ai/ui-execution-workflow.md`
  - Defines the reusable pipeline from design brief to selected skill, implementation plan, UI changes, visual QA, accessibility QA, delta notes, and human taste gate.
- `docs/ai/visual-qa-checklist.md`
  - Provides a reusable post-implementation visual review checklist for desktop and mobile UI work.
- `docs/ai/accessibility-baseline.md`
  - Provides a reusable baseline for keyboard, semantic structure, contrast, focus, forms, motion, and responsive accessibility.
- `prompts/ui/select-ui-skill.md`
  - Copy/paste prompt for selecting only the relevant UI skill before implementation.
- `prompts/ui/polish-existing-screen.md`
  - Copy/paste prompt for polishing an existing screen while preserving scope.
- `prompts/ui/create-section-from-brief.md`
  - Copy/paste prompt for creating one section from an approved design brief.
- `prompts/ui/red-team-ui-output.md`
  - Copy/paste prompt for reviewing UI output against the brief, visual QA, accessibility, and anti-generic rules.

Modify if implementation chooses to sync these rails:

- `scripts/sync-boilerplate.mjs`
  - Add the four new `docs/ai/*.md` guardrail files and `prompts/ui` to `managedPaths`.
- `.bemoat/boilerplate-sync-manifest.json`
  - Mirror the same managed paths.
- `docs/agent-loop/source-of-truth.md`
  - Document the selected `docs/ai/*.md` files and `prompts/ui` as starter-owned reusable agent guardrails.
- `docs/harness-sync-contract.md`
  - Document the new managed guardrail paths.
- `tests/int/boilerplate-sync.int.spec.ts`
  - Assert the new paths are included in `managedPaths`.

Do not create in v1 unless a reviewer asks for them:

- `.cursor/rules/ui-skills.mdc`
- `.cursor/rules/frontend-polish.mdc`
- `.cursor/rules/accessibility-baseline.mdc`
- `docs/agents/ui-execution.md`

Those optional files can duplicate the same ideas across surfaces, so they should wait until the Markdown and prompt pack proves useful.

## Content Requirements

### UI Skills guide

The guide must state:

- UI Skills are execution guidance for interface work.
- `npx ui-skills start` is the preferred entrypoint when network and tooling are available.
- UI Skills do not replace the issue, design brief, Design Ref CMS, Mobbin, screenshots, approved brand direction, or human taste approval.
- Agents should choose the smallest useful skill set before UI implementation or polish.
- Agents should avoid loading every UI-related skill by default.
- Recommended initial skill set is small: `ui-skills-root`, `frontend-design`, `baseline-ui`, and accessibility-specific guidance only when relevant.

### UI execution workflow

The workflow must use this sequence:

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

The workflow must include:

- Pre-implementation checklist.
- Post-implementation checklist.
- Scope control rules.
- Visual delta notes format.
- Human taste gate language.

### Prompt templates

Each prompt must be copy/paste ready and include:

- Required inputs.
- Guardrails to read.
- Explicit out-of-scope section.
- Expected output format.
- Rule to avoid project-specific references unless provided by the current issue or project repo.

### Visual QA checklist

The checklist must cover:

- Hierarchy and scan path.
- Spacing, alignment, density, and rhythm.
- Typography scale and line length.
- Responsive desktop and mobile behavior.
- State coverage: loading, empty, error, success, permission, and disabled states when relevant.
- Interaction affordance and focus visibility.
- Motion purpose and reduced-motion fallback when motion is present.
- Anti-generic review: remove template-looking filler, vague decorative sections, and ungrounded copy.

### Accessibility baseline

The baseline must cover:

- Keyboard navigation.
- Focus order and visible focus.
- Semantic HTML.
- Labels, names, roles, and descriptions.
- Color contrast.
- Form validation messaging.
- Hit targets.
- Reduced motion.
- Screen-reader friendly state changes when relevant.

### shadcn/Tailwind composition rule

The rule must say:

- Use shadcn and Tailwind as composition primitives, not as a visual identity.
- Prefer existing project components and tokens before adding new local patterns.
- Avoid dumping default card grids, oversized gradients, generic badges, and placeholder marketing sections.
- Keep component APIs small and match the existing codebase conventions.

## Acceptance Criteria

- [ ] Starter includes UI Skills usage documentation.
- [ ] Starter includes a reusable UI execution workflow.
- [ ] Starter includes a prompt template for selecting UI skills before implementation.
- [ ] Starter includes a prompt template for polishing an existing screen.
- [ ] Starter includes a visual QA checklist.
- [ ] Starter includes an accessibility baseline checklist.
- [ ] Starter includes an anti-generic UI rule.
- [ ] Starter includes a shadcn/Tailwind composition rule.
- [ ] All content is generic and reusable across child projects.
- [ ] No project-specific screenshots, bemoat homepage reference content, production content, copyrighted dumps, secrets, or Cloudflare resource IDs are added.
- [ ] If the new `docs/ai/*.md` guardrails and `prompts/ui` should sync to child projects, sync script, manifest, docs, and integration tests are updated together.

## Validation Plan

Docs-only implementation:

```bash
pnpm run guard:safety
```

Implementation that touches sync scripts, manifest, or tests:

```bash
pnpm run check
```

Before PR, review:

```bash
git status --short --branch
git diff --stat
```

## Sync Impact

This work is reusable starter infrastructure. If the final implementation creates new `docs/ai/*.md` and `prompts/ui` guardrails for agents, those files should be managed by boilerplate sync so child projects receive them.

Required sync decision:

- Add the four new `docs/ai/*.md` guardrail files and `prompts/ui` to `managedPaths`, or explicitly document why they are starter-only.

Recommended decision:

- Add the four new `docs/ai/*.md` files and `prompts/ui` to `managedPaths`.

Reason:

- Issue #65 says the guidance belongs in the starter because it is reusable across projects.
- The docs and prompts are workflow rails, not project-specific app code.
- Child projects should not have to manually copy reusable agent execution prompts.
- The existing `docs/ai/guardrail-workflow-bible.html` should remain starter-only in this PR because it contains broader/project-specific references and suggested files outside the v1 scope.

## Risks

- Overbuilding: adding optional Cursor rules and extra automation in v1 could exceed the rest gate.
- Duplication: prompt templates and docs can drift if they repeat large blocks. Keep prompts focused and link to docs where practical.
- Sync contract drift: adding new managed paths requires updating both `scripts/sync-boilerplate.mjs` and `.bemoat/boilerplate-sync-manifest.json`.
- Sync blast radius: managing the whole `docs/ai` directory would also copy starter-only HTML notes, so v1 manages only the selected Markdown guardrail files.
- Taste confusion: the docs must clearly separate generic execution quality from project-specific visual taste.

## Human Review Needed

- Confirm that the selected `docs/ai/*.md` guardrail files and `prompts/ui` should be synced to child projects as managed harness paths.
- Confirm whether optional Cursor rules should wait for a follow-up issue.
- Confirm whether the first downstream use case should be tracked in a separate `bemoat` issue after this starter PR merges.

## Implementation Boundary

The first implementation should stop when the starter has:

- One UI Skills guide.
- One agent workflow doc.
- At least one Cursor/Composer-ready prompt.
- One visual QA checklist.
- One accessibility baseline.

It should not attempt to build a full UI automation framework.

## Branch Note

The issue workflow prefers branches from `develop`, but this checkout only exposed `origin/main` when the branch was created. The issue branch `docs/65-ui-skills-execution-guardrails` was therefore created from `origin/main` as a temporary repository-branching exception.
