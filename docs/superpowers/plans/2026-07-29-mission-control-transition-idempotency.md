# Mission Control Transition Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false STATE_CONFLICT communication rounds by making role
comment transitions idempotent, recoverable, and deterministically projected
into durable Mission Control state.

**Architecture:** Role comments are immutable transition evidence; the managed
state block is the durable routing projection. Automated transitions use one
canonical coordinator with deterministic transition identity, at-most-one
intentional POST, no blind retry after ambiguous outcomes, and live
postcondition verification.

**Tech Stack:** Node.js ESM, GitHub REST/CLI, YAML Mission Control state,
Vitest integration tests, Bemoat harness managed-runtime closure.

## Global Constraints

- Derive transition identity before mutation.
- Reuse exactly one matching existing comment.
- More than one matching comment is `STATE_CONFLICT`.
- With zero matches, make at most one intentional POST attempt.
- Never blindly retry an ambiguous POST.
- Resolve ambiguous POST through bounded live-comment reads.
- One recovered match resumes projection.
- Zero provable matches ends as incomplete `BLOCKED_EXTERNAL`, with no state advance.
- Multiple matches end as `STATE_CONFLICT`.
- Reconciliation repairs projection only and creates no new role authority.
- Routing-only repair preserves counters, heads, findings, and Founder authority.
- Do not claim strict exactly-once delivery from GitHub.
- Do not authorize automatic stale-lock deletion based only on elapsed time.

---

## Determinism requirements

1. **Exact protected-main SHA:** `dfd0f42cc7abf8c0cce287b8198e8cbea4d3ae4c`
2. **Exact final file allowlist:**
   - `scripts/mission-control-reconcile.mjs`
   - `scripts/mission-control-state.mjs`
   - `scripts/mission-control-dispatch.mjs`
   - `tests/int/mission-control-reconcile.int.spec.ts`
3. **Exact symbols created or modified:**
   - `normalizeTransitionIdentity`
   - `parseCommentMarker`
   - `classifyTransition`
   - `Coordinator` (class)
   - `Coordinator.integrateHandoff`
   - `Coordinator.integrateResult`
   - `Coordinator.reconcileReviewVerdict`
   - `recoverAmbiguousPost`
   - `verifyStatePostcondition`
4. **Exact transition-identity object and canonical serialization:**
   ```json
   {
     "taskId": "string",
     "phase": "string",
     "role": "string",
     "contentHash": "string"
   }
   ```
5. **Exact role-comment marker format:** `## HANDOFF`, `## RESULT`, `## REVIEW_VERDICT`
6. **Exact state-machine phases:** `READY`, `IN_PROGRESS`, `AWAITING_REVIEW_1`, `CORRECTION_REQUIRED`, `ELIGIBLE_FOR_FOUNDER_REVIEW`
7. **Exact classification for every failure:**
   - `0_MATCHES`: `INCOMPLETE_BLOCKED_EXTERNAL`
   - `>1_MATCHES`: `STATE_CONFLICT`
   - `1_MATCH`: `RESUME_PROJECTION`
8. **Exact test names and test files:**
   - `tests/int/mission-control-reconcile.int.spec.ts`
     - `'normalizes transition identity consistently'`
     - `'parses and matches comment markers exactly'`
     - `'classifies pure transition'`
     - `'coordinator injects transports'`
     - `'recovers ambiguous POST with one live match'`
     - `'integrates HANDOFF with exact identity'`
     - `'integrates RESULT with exact identity'`
     - `'reconciles REVIEW_VERDICT external evidence'`
     - `'verifies state postcondition exactly'`
     - `'preserves child harness closures'`
     - `'ensures child sync ignores transition state'`
9. **Exact red command and expected failure:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'normalizes transition identity consistently'` -> expected `ReferenceError: normalizeTransitionIdentity is not defined`
10. **Exact minimal implementation step:** `- [ ] Export empty normalizeTransitionIdentity function returning dummy object`
11. **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts`
12. **Exact commit contents and commit message:** 
    - Message: `feat(mc): implement transition identity normalization`
    - Contents: The files modified during the task execution steps exactly matching the allowlist.
13. **Exact postcondition checks:** Read live issue state, assert equal to expected state block.
14. **Exact managed-closure changes:** Add `mission-control-reconcile.mjs` to standard closures if absent, ensure `import { ... }` paths are exact.
15. **Exact stop conditions:** 
    - Dirty working tree.
    - Missing or failed exact-head CI.
    - Test failure outside the allowlist.
    - Non-deterministic behavior observed.

---

## Tasks

### 1. transition identity normalization
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `string` body, produces `{ taskId, phase, role, contentHash }`
- **One failing test step:** `- [ ] Add test 'normalizes transition identity consistently'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'normalizes transition identity consistently'` -> expected `ReferenceError: normalizeTransitionIdentity is not defined`
- **Minimal implementation:** `- [ ] Export empty normalizeTransitionIdentity function returning dummy object`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'normalizes transition identity consistently'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement transition identity normalization"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 2. comment-marker parsing and matching
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `string` body, produces `string` marker
- **One failing test step:** `- [ ] Add test 'parses and matches comment markers exactly'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'parses and matches comment markers exactly'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Export parseCommentMarker`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'parses and matches comment markers exactly'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement comment-marker parsing and matching"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 3. pure transition classification
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `number` matchCount, produces `string` classification
- **One failing test step:** `- [ ] Add test 'classifies pure transition'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'classifies pure transition'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Export classifyTransition`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'classifies pure transition'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement pure transition classification"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 4. coordinator with injected transports
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes injected `fetch` function, produces `Coordinator` instance
- **One failing test step:** `- [ ] Add test 'coordinator injects transports'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'coordinator injects transports'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Export class Coordinator`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'coordinator injects transports'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement coordinator with injected transports"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 5. ambiguous POST recovery
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `Coordinator` and `identity`, produces `Match | Error`
- **One failing test step:** `- [ ] Add test 'recovers ambiguous POST with one live match'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'recovers ambiguous POST with one live match'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Export recoverAmbiguousPost`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'recovers ambiguous POST with one live match'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement ambiguous POST recovery"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 6. HANDOFF integration
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `Coordinator` and `identity`, projects `HANDOFF` state
- **One failing test step:** `- [ ] Add test 'integrates HANDOFF with exact identity'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'integrates HANDOFF with exact identity'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Implement Coordinator.integrateHandoff`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'integrates HANDOFF with exact identity'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement HANDOFF integration"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 7. RESULT integration
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `Coordinator` and `identity`, projects `RESULT` state
- **One failing test step:** `- [ ] Add test 'integrates RESULT with exact identity'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'integrates RESULT with exact identity'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Implement Coordinator.integrateResult`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'integrates RESULT with exact identity'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement RESULT integration"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 8. REVIEW_VERDICT external-evidence reconciliation
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes `Coordinator` and `identity`, projects `REVIEW_VERDICT` state
- **One failing test step:** `- [ ] Add test 'reconciles REVIEW_VERDICT external evidence'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'reconciles REVIEW_VERDICT external evidence'` -> expected `ReferenceError`
- **Minimal implementation:** `- [ ] Implement Coordinator.reconcileReviewVerdict`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'reconciles REVIEW_VERDICT external evidence'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement REVIEW_VERDICT external-evidence reconciliation"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 9. state postcondition verification
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** consumes expected and actual state, throws on mismatch
- **One failing test step:** `- [ ] Add test 'verifies state postcondition exactly'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'verifies state postcondition exactly'` -> expected `AssertionError`
- **Minimal implementation:** `- [ ] Export verifyStatePostcondition`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'verifies state postcondition exactly'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "feat(mc): implement state postcondition verification"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 10. managed runtime ownership and closure
- **Exact files:** `scripts/mission-control-dispatch.mjs`, `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** ensures execution closure is isolated
- **One failing test step:** `- [ ] Add test 'preserves child harness closures'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'preserves child harness closures'` -> expected failure
- **Minimal implementation:** `- [ ] Update imports and closures in dispatch to strictly isolate reconcile runtime`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'preserves child harness closures'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "chore(mc): ensure managed runtime ownership and closure"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 11. child-preservation regression
- **Exact files:** `scripts/mission-control-reconcile.mjs`, `tests/int/mission-control-reconcile.int.spec.ts`
- **Interfaces consumed and produced:** ensures reconcile does not break legacy syncing
- **One failing test step:** `- [ ] Add test 'ensures child sync ignores transition state'`
- **Exact red command and expected assertion:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'ensures child sync ignores transition state'` -> expected failure
- **Minimal implementation:** `- [ ] Add regression protections for child sync`
- **Exact green command:** `npx vitest run tests/int/mission-control-reconcile.int.spec.ts -t 'ensures child sync ignores transition state'`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit -m "test(mc): add child-preservation regression tests"`
- **Stop condition:** Failing test or unmodified file outside allowlist.

### 12. full-suite and exact-diff verification
- **Exact files:** None (verification only)
- **Interfaces consumed and produced:** runs full test suite
- **One failing test step:** `- [ ] Verify full test suite execution`
- **Exact red command and expected assertion:** `pnpm run check` -> no unexpected failure allowed
- **Minimal implementation:** `- [ ] N/A`
- **Exact green command:** `pnpm run check`
- **Full verification command:** `pnpm run check`
- **Git diff check:** `- [ ] git diff --stat`
- **Exact commit command:** `git commit --allow-empty -m "chore(mc): run full-suite and exact-diff verification"`
- **Stop condition:** Uncommitted changes or failed tests.
