# UI Skills Execution Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable UI Skills guardrail docs and prompts to the starter, with boilerplate sync coverage for child projects.

**Architecture:** Keep the workflow as selected Markdown docs under `docs/ai` and copy/paste prompts under `prompts/ui`. Treat only the new `docs/ai/*.md` guardrail files and `prompts/ui` as managed harness paths so existing starter-only `docs/ai/guardrail-workflow-bible.html` does not sync to child projects.

**Tech Stack:** Markdown, Node.js ESM sync script constants, Vitest integration tests, Bemoat boilerplate sync manifest

---

## Required Inputs

- `docs/superpowers/specs/bemoat-web-starter/designops/ui-skills-execution-guardrails/design.md`
- GitHub issue #65: https://github.com/boat1994/bemoat-web-starter/issues/65
- UI Skills reference: https://www.ui-skills.com/skills

## Task 1: Prove New Managed Paths Are Required

**Files:**
- Modify: `tests/int/boilerplate-sync.int.spec.ts`

- [x] **Step 1: Add failing managed-path assertions**

Add the four new `docs/ai/*.md` files and `prompts/ui` to the harness managed-path assertions. Assert that the whole `docs/ai` directory is not managed.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts --testNamePattern "includes harness workflow rails|exports managedPaths"
```

Expected: FAIL because the specific `docs/ai/*.md` files are not yet in `managedPaths`.

## Task 2: Add UI Guardrail Content

**Files:**
- Create: `docs/ai/ui-skills.md`
- Create: `docs/ai/ui-execution-workflow.md`
- Create: `docs/ai/visual-qa-checklist.md`
- Create: `docs/ai/accessibility-baseline.md`
- Create: `prompts/ui/select-ui-skill.md`
- Create: `prompts/ui/polish-existing-screen.md`
- Create: `prompts/ui/create-section-from-brief.md`
- Create: `prompts/ui/red-team-ui-output.md`

- [x] **Step 1: Add the UI Skills guide**

Document `npx ui-skills start` as the preferred entrypoint, with starter fallback rules when the CLI is unavailable.

- [x] **Step 2: Add the execution workflow and QA baselines**

Add the pipeline, scope rules, visual QA checklist, and accessibility baseline.

- [x] **Step 3: Add copy/paste prompts**

Add prompts for selecting a UI skill, polishing an existing screen, creating a section from a brief, and red-teaming UI output.

## Task 3: Add Sync Coverage

**Files:**
- Modify: `scripts/sync-boilerplate.mjs`
- Modify: `.bemoat/boilerplate-sync-manifest.json`
- Modify: `docs/agent-loop/source-of-truth.md`
- Modify: `docs/harness-sync-contract.md`
- Modify: `tests/int/boilerplate-sync.int.spec.ts`

- [x] **Step 1: Add selected `docs/ai/*.md` files and `prompts/ui` to `managedPaths`**

Update the script constants and the source-driven sync manifest together. Do not add the whole `docs/ai` directory because it would recursively sync `docs/ai/guardrail-workflow-bible.html`.

- [x] **Step 2: Document the paths as starter-owned rails**

Update source-of-truth and harness contract docs.

- [x] **Step 3: Run the focused test and confirm GREEN**

Run:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts --testNamePattern "includes harness workflow rails|exports managedPaths|matches local sync constants"
```

Expected: PASS.

## Task 4: Verify and Ship

**Files:**
- All changed files

- [x] **Step 1: Run required validation**

Run:

```bash
pnpm run check
```

Expected: PASS with guard, lint, typecheck, and integration tests passing.

- [x] **Step 2: Review status and diff**

Run:

```bash
git status --short --branch
git diff --stat
```

- [x] **Step 3: Commit, push, open PR, and comment on issue**

Use one focused final commit by amending the existing spec commit if the diff is clean and validation passes.
