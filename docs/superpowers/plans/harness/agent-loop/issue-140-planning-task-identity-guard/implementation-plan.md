# Issue #140 Planning Task-Identity and Execution-Base Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-140"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#140"
branch_template: "harness/140-planning-task-identity"
transition_target: "DONE"
planning_base_sha: "2489c7bf6d10ad8c2a724a7920bd83350102ee03"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/harness/agent-loop/issue-140-planning-task-identity-guard/design.md"
paired_plan: "docs/superpowers/plans/harness/agent-loop/issue-140-planning-task-identity-guard/implementation-plan.md"
```
<!-- bemoat-task-identity:end -->

**Goal:** Add deterministic planning task-identity and execution-base validation across Bemoat specification (`design.md`) and implementation-plan (`implementation-plan.md`) packages, preventing closed-issue reuse (`#169`), issue/branch mismatches, and unconditional planning-SHA branch creation without relying on heuristic interpretation of arbitrary Markdown.

**Architecture:** We introduce a canonical YAML marker block (`<!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end -->`) per planning document (`paired_spec` and `paired_plan`). A new core validator (`scripts/guard-planning-contract.mjs`) parses and statically validates these blocks across paired documents for consistency (`PLAN001`–`PLAN007`), integrating directly into `GUARD_PACK` (`scripts/guard-pack.mjs`) and `scripts/agent-issue.mjs` preflight. When `gh` CLI access is available, `verifyLiveTaskIdentity` verifies active issue existence, open status, `task_key` alignment, and managed state compatibility (`PLAN008`–`PLAN010`), gracefully degrading when offline while maintaining full compatibility with `FAST`, `STANDARD`, and `MANAGED` profiles.

**Tech Stack:** Node.js (ES modules `.mjs`), TypeScript (`vitest` for integration/acceptance testing), GitHub CLI (`gh`).

## Global Constraints

- Repository: `boat1994/bemoat-web-starter`
- Approved protected base: `main`
- All code must pass `pnpm run check` (`guard:safety`, `typecheck`, and `test:int`) with zero warnings.
- Do not modify `bogus-jewelry` or perform immediate Finance Task 11–12 corrections.
- Do not reopen, repurpose, or rewrite completed Issue `#169`.
- Do not alter Mission Control states, review counters, the three-cycle budget, role authority, Founder gates, merge gates, deployment gates, migration gates, or destructive-action gates.
- Do not add a second durable state store, generic broken-link checker, issue auto-creation, issue auto-close/reopen, or natural-language identity inference.
- Do not require historical issue references to remain open.
- Do not sync or roll out to child repositories without a separate authorized task.
- Do not modify the external Superpowers plugin directly (`~/.gemini/config/skills/...` or external repos); create `docs/agent-loop/superpowers-planning-contract-recommendation.md` instead.
- Must not break existing valid `FAST`, `STANDARD`, and `MANAGED` workflows or child sync boundaries.

---

## File Summary and Responsibilities

| File Path | Action | Responsibility |
| --- | --- | --- |
| `scripts/guard-planning-contract.mjs` | Create | Core parser (`parseTaskIdentityBlock`), static validator (`runPlanningContractGuard`), and live GitHub preflight verifier (`verifyLiveTaskIdentity`) emitting diagnostic codes `PLAN001`–`PLAN010`. |
| `scripts/guard-pack.mjs` | Modify | Import and register `planning-contract` guard (`id: 'planning-contract'`) inside `GUARD_PACK` so `pnpm run guard:safety` scans modified/staged planning documents. |
| `scripts/agent-issue.mjs` | Modify | Import `parseTaskIdentityBlock`, `runPlanningContractGuard`, and `verifyLiveTaskIdentity` from `./guard-planning-contract.mjs`; invoke them in `analyzeProgressTracking` to block launch on contract violations or closed/invalid active task issues (`#169`). |
| `.bemoat/boilerplate-sync-manifest.json` | Modify | Add `scripts/guard-planning-contract.mjs` to `managedPaths` so child projects receive the guard on `pnpm run bemoat:boilerplate:sync -- --harness-only`. |
| `tests/fixtures/planning/valid-existing-issue.md` | Create | Valid planning fixture (`schema_version: 1`, `task_issue_strategy: existing_dedicated_issue`, `active_task_issue: "#140"`). |
| `tests/fixtures/planning/valid-paired-plan.md` | Create | Paired plan matching `valid-existing-issue.md` exactly across all identity fields. |
| `tests/fixtures/planning/closed-issue-169-reuse.md` | Create | Invalid fixture where future `task-11` assigns closed Task 10 Issue `#169` as `active_task_issue` / `transition_target`. |
| `tests/fixtures/planning/mismatched-issue-numbers.md` | Create | Invalid fixture pair where spec (`#170`) and plan (`#171`) disagree on `active_task_issue`. |
| `tests/fixtures/planning/unrelated-branch-prefix.md` | Create | Invalid fixture where `branch_template` (`feature/169-slug`) conflicts with `active_task_issue` (`#170`). |
| `tests/fixtures/planning/terminal-transition-target.md` | Create | Invalid fixture where `transition_target` targets terminal string (`DONE` / `CLOSED`) while modifying/closing a terminal issue. |
| `tests/fixtures/planning/unconditional-planning-sha.md` | Create | Invalid fixture where `execution_base_rule` hardcodes `use_planning_base_sha_unconditionally`. |
| `tests/fixtures/planning/missing-strategy.md` | Create | Invalid fixture lacking `task_issue_strategy`. |
| `tests/fixtures/planning/valid-create-before-execution.md` | Create | Valid fixture with `task_issue_strategy: create_before_execution` and `active_task_issue: null`. |
| `tests/fixtures/planning/valid-historical-references.md` | Create | Valid fixture referencing closed `#169` inside prose and `Durable Progress` historical checklist items only (`- [x] Task 10 (#169)`). |
| `tests/fixtures/planning/valid-old-provenance-live-base.md` | Create | Valid fixture declaring older `planning_base_sha` and `execution_base_rule: resolve_live_protected_base_at_dispatch`. |
| `tests/int/guard-planning-contract.int.spec.ts` | Create | Comprehensive integration/unit test suite verifying all 14 required regression cases and offline degradation. |
| `tests/int/agent-issue.int.spec.ts` | Modify | Add integration tests verifying `agent-issue.mjs` preflight blocks when planning contract or live issue verification fails (`#169`), while preserving existing `FAST`, `STANDARD`, `MANAGED` coverage. |
| `tests/int/guard-pack.int.spec.ts` | Modify | Add integration tests confirming `guard-pack.mjs` executes `planning-contract` and surfaces `PLAN001`–`PLAN010` violations. |
| `tests/int/boilerplate-sync.int.spec.ts` | Modify | Confirm manifest parity and sync contract coverage for `scripts/guard-planning-contract.mjs`. |
| `docs/guard-pack.md` | Modify | Document `planning-contract` guard rules, diagnostic codes `PLAN001`–`PLAN010`, YAML marker syntax, and troubleshooting. |
| `docs/agent-loop/security-and-migrations.md` | Modify | Document planning task-identity invariants, `planning_base_sha` vs `resolve_live_protected_base_at_dispatch`, and historical reference safety. |
| `docs/agent-loop/superpowers-planning-contract-recommendation.md` | Create | External recommendation file guiding Superpowers plugin maintainers to emit `<!-- bemoat-task-identity:start -->` blocks during `brainstorming` and `writing-plans`. |

---

## Exported Interfaces and Data Shapes

### `scripts/guard-planning-contract.mjs`

```typescript
export interface TaskIdentityContract {
  schema_version: number; // must be 1
  main_issue: string | null; // e.g. "#106" or null
  task_key: string; // e.g. "task-11" or "issue-140"
  task_issue_strategy: 'existing_dedicated_issue' | 'create_before_execution';
  active_task_issue: string | null; // e.g. "#169" or null
  branch_template: string; // e.g. "feature/169-task-11-slug"
  transition_target: string; // e.g. "DONE", "AWAITING_REVIEW_1", or "#169"
  planning_base_sha: string; // 40-hex SHA e.g. "2489c7bf6d10ad8c2a724a7920bd83350102ee03"
  execution_base_rule: string; // "resolve_live_protected_base_at_dispatch"
  paired_spec: string | null; // e.g. "docs/superpowers/specs/.../design.md"
  paired_plan: string | null; // e.g. "docs/superpowers/plans/.../implementation-plan.md"
}

export interface PlanningViolation {
  type: 'planning-contract';
  rule: string; // 'PLAN001' | 'PLAN002' | ... | 'PLAN010'
  file: string; // relative file path
  message: string;
  found: string;
  reason: string;
  correctiveAction: string;
}

export interface ParseResult {
  present: boolean;
  valid: boolean;
  contract: TaskIdentityContract | null;
  violations: PlanningViolation[];
}

export interface LiveVerificationResult {
  ok: boolean;
  degradedOffline: boolean;
  violations: PlanningViolation[];
  issueMetadata?: {
    number: string;
    state: string;
    title: string;
    body: string;
  };
}

export function parseTaskIdentityBlock(content: string, filePath: string): ParseResult;
export function runPlanningContractGuard(options?: {
  root?: string;
  files?: string[];
  checkAll?: boolean;
}): PlanningViolation[];
export function formatPlanningContractViolations(violations: PlanningViolation[]): string[];
export function verifyLiveTaskIdentity(options: {
  cwd?: string;
  filePath: string;
  contract: TaskIdentityContract;
  env?: Record<string, string>;
  offline?: boolean;
}): LiveVerificationResult;
```

---

## Task Decomposition and Steps

### Task 1: Core Static Schema and Pairing Validator (`scripts/guard-planning-contract.mjs` & fixtures)

**Files:**
- Create: `scripts/guard-planning-contract.mjs`
- Create: `tests/fixtures/planning/valid-existing-issue.md`
- Create: `tests/fixtures/planning/valid-paired-plan.md`
- Create: `tests/fixtures/planning/closed-issue-169-reuse.md`
- Create: `tests/fixtures/planning/mismatched-issue-numbers.md`
- Create: `tests/fixtures/planning/unrelated-branch-prefix.md`
- Create: `tests/fixtures/planning/terminal-transition-target.md`
- Create: `tests/fixtures/planning/unconditional-planning-sha.md`
- Create: `tests/fixtures/planning/missing-strategy.md`
- Create: `tests/fixtures/planning/valid-create-before-execution.md`
- Create: `tests/fixtures/planning/valid-historical-references.md`
- Create: `tests/fixtures/planning/valid-old-provenance-live-base.md`
- Create: `tests/int/guard-planning-contract.int.spec.ts`

**Interfaces:**
- Produces: `parseTaskIdentityBlock`, `runPlanningContractGuard`, `formatPlanningContractViolations`, and structured diagnostic codes `PLAN001`–`PLAN007`.

- [ ] **Step 1: Write the failing tests for static schema parsing and pairing rules**

Create `tests/int/guard-planning-contract.int.spec.ts` asserting:
1. `valid-existing-issue.md` + `valid-paired-plan.md` return zero violations.
2. `closed-issue-169-reuse.md` (when paired with `#170` task key or checked statically for terminal targets) emits appropriate violations.
3. `mismatched-issue-numbers.md` across paired spec (`#170`) and plan (`#171`) emits `PLAN002` with clear diagnostic: `Found '#171' in implementation-plan.md but '#170' in design.md`.
4. `unrelated-branch-prefix.md` (`feature/169-slug` with `active_task_issue: #170`) emits `PLAN003`.
5. `terminal-transition-target.md` (`transition_target: DONE` when targeting/updating a closed/terminal issue reference) emits `PLAN004`.
6. `missing-strategy.md` emits `PLAN006`.
7. `unconditional-planning-sha.md` (`execution_base_rule: use_planning_base_sha_unconditionally`) emits `PLAN007`.
8. `valid-create-before-execution.md` (`task_issue_strategy: create_before_execution`, `active_task_issue: null`) passes `PLAN005`/`PLAN006`.
9. `valid-historical-references.md` (mentions `#169` and `#100` only in prose/`Durable Progress` `- [x]` items outside `<!-- bemoat-task-identity:start -->`) passes all checks (`PLAN001`–`PLAN007`).
10. `valid-old-provenance-live-base.md` (`planning_base_sha` from past commit + `execution_base_rule: resolve_live_protected_base_at_dispatch`) passes `PLAN007`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/int/guard-planning-contract.int.spec.ts`
Expected: FAIL with `Cannot find module '../../scripts/guard-planning-contract.mjs'` or failing assertions.

- [ ] **Step 3: Create the fixtures and implement `scripts/guard-planning-contract.mjs` static parsing and validation**

Implement `parseTaskIdentityBlock` using exact balanced markers `<!-- bemoat-task-identity:start --> ... <!-- bemoat-task-identity:end -->` and simple YAML key-value parsing (matching `parseMissionControlState` in `agent-issue.mjs`). Implement `runPlanningContractGuard({ root, files, checkAll })` scanning `docs/superpowers/plans/**` and `docs/superpowers/specs/**` when modified or when `checkAll: true`. Enforce `PLAN001` through `PLAN007` with structured diagnostic formatting:
`[RuleID] FilePath: Message. Found: <value>. Reason: <reason>. Corrective action: <action>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/int/guard-planning-contract.int.spec.ts`
Expected: PASS across all static schema, pairing, boundary, and historical reference test cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/guard-planning-contract.mjs tests/fixtures/planning/ tests/int/guard-planning-contract.int.spec.ts
git commit -m "feat(harness): implement static planning task-identity guard and fixtures"
```

---

### Task 2: Authenticated Live GitHub Verification & Degradation Engine (`scripts/guard-planning-contract.mjs` & integration tests)

**Files:**
- Modify: `scripts/guard-planning-contract.mjs`
- Modify: `tests/int/guard-planning-contract.int.spec.ts`

**Interfaces:**
- Consumes: `parseTaskIdentityBlock` (`Task 1`)
- Produces: `verifyLiveTaskIdentity` emitting `PLAN008`, `PLAN009`, `PLAN010`, with safe `degradedOffline` fallback.

- [ ] **Step 1: Write the failing tests for live verification (`PLAN008`–`PLAN010` and offline fallback)**

Append tests to `tests/int/guard-planning-contract.int.spec.ts` using stubbed `gh` binary (`withStubbedGh` helper pattern):
1. **Regression Case 1 (Closed Task 10 Issue #169 reused for future Task 11)**: Stub `gh issue view 169` returning `{ "title": "[Task 10] Homepage Foundation", "state": "CLOSED", "body": "..." }`. Verify `verifyLiveTaskIdentity` emits `PLAN008` (`Found state 'CLOSED'. Reason: Active task issue #169 is closed/terminal. Corrective action: Reopen issue #169 or create a new dedicated open task issue.`).
2. **Repository mismatch**: Stub `gh issue view` failing or returning issue from different repository. Verify `PLAN008`.
3. **Open but semantically wrong Task Issue**: Stub `gh issue view 170` returning `{ "title": "[Task 12] Billing API", "state": "OPEN", "body": "..." }` when `task_key` is `task-11`. Verify `PLAN009` (`Found task key mismatch. Reason: Issue #170 title/body does not identify task-11. Corrective action: Update active_task_issue to point to the issue for task-11.`).
4. **Incompatible managed metadata**: Stub `gh issue view 170` returning `OPEN` state but with `<!-- bemoat-mission-control-state:start -->` declaring `state: DONE` or `active_task_issue: "#999"`. Verify `PLAN010` (`Found incompatible Mission Control state. Reason: recorded state is DONE or conflicts with task issue. Corrective action: Reconcile Mission Control state on issue #170.`).
5. **Existing dedicated open managed Issue valid (`#140`)**: Stub `gh issue view 140` returning `OPEN`, matching title/body, and valid state block. Verify `verifyLiveTaskIdentity` returns `ok: true, violations: []`.
6. **Create-before-execution without concrete Issue valid**: Verify `verifyLiveTaskIdentity` on `task_issue_strategy: create_before_execution` with `active_task_issue: null` returns `ok: true` without calling `gh issue view`.
7. **Unavailable GitHub authentication degradation**: When `gh` fails with exit code 4 or `gh auth status` fails/not found, verify `verifyLiveTaskIdentity({ offline: true })` or auto-degradation returns `degradedOffline: true, ok: true` without failing closed for static check runs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/int/guard-planning-contract.int.spec.ts`
Expected: FAIL due to missing `verifyLiveTaskIdentity` export and live verification checks.

- [ ] **Step 3: Implement `verifyLiveTaskIdentity` inside `scripts/guard-planning-contract.mjs`**

Implement `verifyLiveTaskIdentity({ cwd, filePath, contract, env, offline })`. If `offline` or if `gh --version` / `gh auth status` returns failure, return `{ ok: true, degradedOffline: true, violations: [] }`. If `contract.task_issue_strategy === 'existing_dedicated_issue'` and `contract.active_task_issue` exists, run `gh issue view <num> --json title,state,body,url`. Validate repository, check `state === 'OPEN'` (`PLAN008`), inspect title/body for `contract.task_key` (`PLAN009`), and run `parseMissionControlState(issue.body)` to assert state compatibility (`PLAN010`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/int/guard-planning-contract.int.spec.ts`
Expected: PASS across all static, live stubbed, regression (#169), and offline degradation test cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/guard-planning-contract.mjs tests/int/guard-planning-contract.int.spec.ts
git commit -m "feat(harness): add live GitHub task-identity verification and offline fallback"
```

---

### Task 3: Integration into Central Guard Pack (`scripts/guard-pack.mjs` & integration tests)

**Files:**
- Modify: `scripts/guard-pack.mjs`
- Modify: `tests/int/guard-pack.int.spec.ts`

**Interfaces:**
- Consumes: `runPlanningContractGuard`, `formatPlanningContractViolations` (`Task 1`)
- Produces: `planning-contract` entry inside `GUARD_PACK` (`scripts/guard-pack.mjs`).

- [ ] **Step 1: Write failing test in `tests/int/guard-pack.int.spec.ts`**

In `tests/int/guard-pack.int.spec.ts`, assert `runGuardPack()` includes entry `{ id: 'planning-contract', summary: 'Planning task-identity and execution-base contract across paired spec/plan files' }`. Assert that seeding an invalid planning file (like `tests/fixtures/planning/closed-issue-169-reuse.md`) inside a test repo's `docs/superpowers/plans/bad/plan.md` and running `runGuardPack` causes `planning-contract` violations and exit code 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/int/guard-pack.int.spec.ts`
Expected: FAIL (`expected GUARD_PACK to contain guard with id 'planning-contract'`).

- [ ] **Step 3: Modify `scripts/guard-pack.mjs`**

Import `formatPlanningContractViolations`, `runPlanningContractGuard` from `./guard-planning-contract.mjs`. Add entry to `GUARD_PACK`:
```javascript
  {
    id: 'planning-contract',
    summary: 'Planning task-identity and execution-base contract across paired spec/plan files',
    run: runPlanningContractGuard,
    format: formatPlanningContractViolations,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/int/guard-pack.int.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/guard-pack.mjs tests/int/guard-pack.int.spec.ts
git commit -m "feat(harness): register planning-contract in central guard pack"
```

---

### Task 4: Integration into Agent Preflight (`scripts/agent-issue.mjs` & integration tests)

**Files:**
- Modify: `scripts/agent-issue.mjs`
- Modify: `tests/int/agent-issue.int.spec.ts`

**Interfaces:**
- Consumes: `parseTaskIdentityBlock`, `runPlanningContractGuard`, `verifyLiveTaskIdentity` (`Tasks 1–2`)
- Produces: Integrated preflight validation inside `runAgentIssuePreflight` / `analyzeProgressTracking`.

- [ ] **Step 1: Write failing integration tests in `tests/int/agent-issue.int.spec.ts`**

Add tests to `tests/int/agent-issue.int.spec.ts`:
1. When an active issue (`#140`) declares `Implementation Plan path: docs/superpowers/plans/test/implementation-plan.md`, and that plan file has a `PLAN001`–`PLAN007` static violation or `PLAN008` (`#169` closed reuse) live violation, `runAgentIssuePreflight` returns `ok: false`, exit code 1, and lists the exact `[PLAN00x]` structured violation under `Hard blockers:`.
2. When `task_issue_strategy === 'create_before_execution'` and `active_task_issue: null`, preflight blocks launch with clear instruction: `Create dedicated task issue before launching implementation.`
3. Verify existing `FAST`, `STANDARD`, and `MANAGED` workflow tests in `agent-issue.int.spec.ts` continue passing without state-machine or role authority changes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/int/agent-issue.int.spec.ts`
Expected: FAIL due to missing `<!-- bemoat-task-identity:start -->` validation during `analyzeProgressTracking`.

- [ ] **Step 3: Modify `scripts/agent-issue.mjs`**

In `analyzeProgressTracking` (`scripts/agent-issue.mjs`), after `validatePlanPath(cwd, declarations.implementationPlanPath, relevantSection)` runs and `planValidation.ok === true`:
Load `planValidation.absolutePath`, run `parseTaskIdentityBlock` on it. If `parseResult.contract` exists:
- Run `runPlanningContractGuard({ root: cwd, files: [declarations.implementationPlanPath] })`. Add any resulting violations to `blockers`.
- If `parseResult.contract.task_issue_strategy === 'create_before_execution'` and `!parseResult.contract.active_task_issue`:
  `blockers.push('PLAN005: Dedicated task issue must be created on GitHub and assigned to active_task_issue before launching implementation.')`
- If `parseResult.contract.task_issue_strategy === 'existing_dedicated_issue'` and `parseResult.contract.active_task_issue`:
  Run `verifyLiveTaskIdentity({ cwd, filePath: declarations.implementationPlanPath, contract: parseResult.contract, env, offline: false })`. Add any `liveResult.violations` (`PLAN008`–`PLAN010`) to `blockers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/int/agent-issue.int.spec.ts`
Expected: PASS across all preflight blockers and existing `FAST`, `STANDARD`, `MANAGED` regression fixtures.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent-issue.mjs tests/int/agent-issue.int.spec.ts
git commit -m "feat(harness): integrate planning contract and live verification into agent preflight"
```

---

### Task 5: Harness Sync Manifest & Documentation Update (`.bemoat/boilerplate-sync-manifest.json`, docs, & external recommendation)

**Files:**
- Modify: `.bemoat/boilerplate-sync-manifest.json`
- Modify: `tests/int/boilerplate-sync.int.spec.ts`
- Modify: `docs/guard-pack.md`
- Modify: `docs/agent-loop/security-and-migrations.md`
- Create: `docs/agent-loop/superpowers-planning-contract-recommendation.md`

**Interfaces:**
- Consumes: `guard-planning-contract.mjs` (`Tasks 1–4`)
- Produces: Updated manifest and documentation boundaries.

- [ ] **Step 1: Write failing test in `tests/int/boilerplate-sync.int.spec.ts`**

In `tests/int/boilerplate-sync.int.spec.ts`, assert that `scripts/guard-planning-contract.mjs` and `tests/int/guard-planning-contract.int.spec.ts` are listed inside `managedPaths` of `.bemoat/boilerplate-sync-manifest.json` and synced to child repositories.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/int/boilerplate-sync.int.spec.ts`
Expected: FAIL (`expected managedPaths to include 'scripts/guard-planning-contract.mjs'`).

- [ ] **Step 3: Update manifest, docs, and create external recommendation file**

1. In `.bemoat/boilerplate-sync-manifest.json`, add `"scripts/guard-planning-contract.mjs"` and `"tests/int/guard-planning-contract.int.spec.ts"` to `managedPaths`.
2. In `docs/guard-pack.md`, add section `## planning-contract` documenting `PLAN001` through `PLAN010`, YAML marker block `<!-- bemoat-task-identity:start -->`, schema, and when errors are triggered.
3. In `docs/agent-loop/security-and-migrations.md`, add section documenting planning task-identity invariants, why `planning_base_sha` is distinct from live branch creation (`resolve_live_protected_base_at_dispatch`), and why historical references in prose/`Durable Progress` (`- [x] Task 10 (#169)`) remain valid without being reopened. Document that child sync (`pnpm run bemoat:boilerplate:sync -- --harness-only`) delivers `guard-planning-contract.mjs` without modifying existing child plans (`FAST`, `STANDARD`, `MANAGED` remain compatible).
4. Create `docs/agent-loop/superpowers-planning-contract-recommendation.md` specifying exact instructions and recommendations for external Superpowers plugin maintainers to emit `<!-- bemoat-task-identity:start -->` YAML blocks inside `brainstorming` (`design.md`) and `writing-plans` (`implementation-plan.md`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/int/boilerplate-sync.int.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .bemoat/boilerplate-sync-manifest.json tests/int/boilerplate-sync.int.spec.ts docs/guard-pack.md docs/agent-loop/security-and-migrations.md docs/agent-loop/superpowers-planning-contract-recommendation.md
git commit -m "docs(harness): update sync manifest, guard docs, and external Superpowers recommendation"
```

---

## Final Whole-Branch Verification

Before opening/updating the PR or completing the task, run exact-head CI verification locally across all harness and code checks:

```bash
pnpm run check
git diff --check
pnpm vitest run tests/int/guard-planning-contract.int.spec.ts tests/int/agent-issue.int.spec.ts tests/int/guard-pack.int.spec.ts tests/int/boilerplate-sync.int.spec.ts
```

Expected outcome:
- All unit, integration, and acceptance tests pass with zero warnings or failures.
- Zero git diff formatting or whitespace errors.
- Both invalid (`closed-issue-169-reuse.md`, `mismatched-issue-numbers.md`) and valid (`valid-existing-issue.md`, `valid-create-before-execution.md`, `valid-historical-references.md`) fixtures verified deterministically.
