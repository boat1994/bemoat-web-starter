# Sync Auto Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm run boilerplate:sync` create a scoped sync commit automatically while preserving unrelated local changes via stash/pop.

**Architecture:** Keep the sync CLI in `scripts/sync-boilerplate.mjs`, but split the Git workflow into small helpers that can be imported and tested without running the full networked sync. Limit Git staging and commit scope to sync-managed files, `package.json`, and `.bemoat-boilerplate-sync.json`, while stashing only files outside that scope.

**Tech Stack:** Node.js ESM script, Git CLI via `child_process`, Vitest, TypeScript type-checking

---

### Task 1: Move the plan artifact into the Superpowers convention

**Files:**
- Create: `docs/superpowers/plans/2026-06-12-sync-auto-commit-plan.md`
- Delete: `docs/plans/2026-06-12-sync-auto-commit-plan.md`

- [ ] **Step 1: Save the plan in the plugin-required path**

Create the plan file under `docs/superpowers/plans/` so the repo uses one Superpowers-specific docs convention for both specs and plans.

- [ ] **Step 2: Remove the older duplicate plan file**

Delete `docs/plans/2026-06-12-sync-auto-commit-plan.md` after the new file exists so there is one canonical plan location.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-12-sync-auto-commit-plan.md docs/plans/2026-06-12-sync-auto-commit-plan.md
git commit -m "docs: align sync plan with superpowers layout"
```

### Task 2: Refactor the sync script for scoped auto-commit

**Files:**
- Modify: `scripts/sync-boilerplate.mjs`
- Test: `tests/int/boilerplate-sync.int.spec.ts`

- [ ] **Step 1: Write the failing test**

Add tests that require:
- exported sync commit scope containing `scripts/sync-boilerplate.mjs`, `package.json`, and `.bemoat-boilerplate-sync.json`
- stash behavior to exclude sync-managed paths and restore only unrelated changes

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts`
Expected: FAIL because the old script runs on import and does not expose scoped commit/stash helpers.

- [ ] **Step 3: Write minimal implementation**

Implement in `scripts/sync-boilerplate.mjs`:
- import-safe module entry guard
- `syncCommitPaths` export
- Git helper methods for status, stash push/pop, scoped add, staged diff check, commit
- stash logic that excludes sync-managed files
- scoped commit logic for synced files only
- inclusion of `scripts/sync-boilerplate.mjs` in `managedPaths`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-boilerplate.mjs tests/int/boilerplate-sync.int.spec.ts
git commit -m "feat: auto-commit scoped boilerplate sync"
```

### Task 3: Update docs for the new sync behavior

**Files:**
- Modify: `README.md`
- Modify: `docs/boilerplate-sync-command.md`

- [ ] **Step 1: Document the scoped auto-commit behavior**

Explain that sync now commits:
- all files copied from `managedPaths`
- `package.json`
- `.bemoat-boilerplate-sync.json`

- [ ] **Step 2: Document the stash behavior**

Explain that pre-existing local changes outside the sync-managed scope are stashed and restored, while edits on sync-managed files are replaced by the latest sync output.

- [ ] **Step 3: Document the one-time child-project upgrade path**

Explain that older child projects may need a one-time update of `scripts/sync-boilerplate.mjs` before the new self-updating behavior can take over.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/boilerplate-sync-command.md
git commit -m "docs: describe sync auto-commit behavior"
```

### Task 4: Verify the implementation

**Files:**
- Test: `tests/int/boilerplate-sync.int.spec.ts`

- [ ] **Step 1: Run the focused sync tests**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts`
Expected: PASS with 3 passing tests

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "chore: verify sync auto-commit changes"
```
