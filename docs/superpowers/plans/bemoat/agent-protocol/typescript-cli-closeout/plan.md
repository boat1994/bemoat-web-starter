# Retained Harness TypeScript CLI Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-429"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#429"
branch_template: "refactor/429-typescript-cli-entrypoints"
transition_target: "FOUNDER_GATE"
planning_base_sha: "f498a5efbfa188565683dbcf6e02318fd6cbcfc1"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat/agent-protocol/typescript-cli-closeout/design.md"
paired_plan: "docs/superpowers/plans/bemoat/agent-protocol/typescript-cli-closeout/plan.md"
```
<!-- bemoat-task-identity:end -->

**Goal:** Remove every maintained Bemoat/current-harness `.mjs` implementation by porting the retained runtime to native TypeScript without changing public behavior.

**Architecture:** Characterize public process boundaries first, then port dependency leaves before composition roots. Update package, registry, architecture, structural, and child-sync consumers in the same bounded tasks so no duplicate `.mjs`/`.ts` authority remains.

**Tech Stack:** Node.js `>=24.15.0`, TypeScript 6, pnpm, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/bemoat/agent-protocol/typescript-cli-closeout/design.md`

## Global Constraints

- Preserve all current command inputs, output envelopes, stdout/stderr, exit codes, mutation classification, retry, readback, and fail-closed behavior.
- Use native Node TypeScript execution; add no loader, bundler, transpilation stage, or build framework.
- Do not add stateful Mission Control machinery, protocol concepts, persistence, controllers, classes, factories, or ceremonial interfaces.
- Delete each superseded harness `.mjs`; never retain duplicate JS/TS authority.
- Keep `eslint.config.mjs`, `scripts/build.mjs`, and `scripts/deploy-smoke-test.mjs` unchanged and classify them as OUTSIDE-HARNESS.
- Preserve child-owned infrastructure and update the harness sync projection for every renamed managed runtime file.
- Use test-first reproduction for missing behavior or semantic corrections; mechanical extension changes may rely on existing passing characterization.
- Do not merge.

---

### Task 1: Characterize public stateless entrypoint boundaries

**Files:**
- Modify: `tests/int/context-cli.int.spec.ts`
- Modify: `tests/int/context-sync.int.spec.ts`
- Modify: `tests/int/handoff-cli.int.spec.ts`
- Modify: `tests/int/handoff-transport.int.spec.ts`
- Modify: `tests/int/cli-tier-a-boundaries.int.spec.ts`
- Modify: `tests/int/cli-tier-b-boundaries.int.spec.ts`

**Interfaces:**
- Consumes: existing `runCliBoundaryCase`, command registry contracts, and transport dependency injection.
- Produces: executable-boundary assertions that remain unchanged when `.mjs` paths become `.ts` paths.

- [ ] **Step 1: Add failing future-entrypoint characterization**

Add cases using the future paths `scripts/agent-context.ts`,
`scripts/agent-context-sync-base.ts`, and `scripts/agent-handoff.ts`. Assert help
JSON, invalid invocation exit `2`, stdout/stderr placement, lifecycle identity,
Context no-mutation, Handoff pre-mutation validation, and sync-base fail-closed
classification. Add Handoff transport stories for exact identical retry and
ambiguous duplicate readback.

- [ ] **Step 2: Verify the new boundary stories fail for the missing `.ts` roots**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/context-cli.int.spec.ts tests/int/context-sync.int.spec.ts tests/int/handoff-cli.int.spec.ts tests/int/handoff-transport.int.spec.ts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/cli-tier-b-boundaries.int.spec.ts
```

Expected: failures identify the missing TypeScript entrypoint paths; unchanged
transport stories remain green.

- [ ] **Step 3: Record the red characterization without changing production code**

```bash
git diff --check
git status --short
```

Expected: only the six characterization files differ and no production file
has changed.

### Task 2: Port shared CLI, adapters, harness-contract leaves, and protocol roots

**Files:**
- Rename to `.ts`: `scripts/adapters/command-runner.mjs`
- Rename/remove facades under: `scripts/cli/*.mjs`, `scripts/harness-contract/*.mjs`
- Rename to `.ts`: `scripts/context/cli.mjs`
- Rename to `.ts`: `scripts/agent-context.mjs`, `scripts/agent-context-sync-base.mjs`, `scripts/agent-handoff.mjs`
- Modify: `scripts/cli/command-contract-registry.ts`
- Modify: `scripts/cli/context-sync-command-metadata.ts`
- Modify: `scripts/cli/handoff-command-metadata.ts`
- Modify: `package.json`
- Modify affected tests under: `tests/int/cli-*.spec.ts`, `tests/int/context-*.spec.ts`, `tests/int/handoff-*.spec.ts`, `tests/int/harness-contract/**/*.spec.ts`, `tests/int/command-runner.int.spec.ts`

**Interfaces:**
- Consumes: the Task 1 process-boundary contracts.
- Produces: TypeScript-only shared CLI/harness-contract dependencies and stateless protocol composition roots.

- [ ] **Step 1: Rename dependency leaves and remove logic-free facades**

Use `apply_patch` to move each retained source to `.ts`, update relative import
extensions to `.ts`, and point imports directly at existing TypeScript
authorities where an `.mjs` file only re-exported that authority. Preserve
exports exactly.

- [ ] **Step 2: Port the three protocol roots and public command metadata**

Change the public targets to:

```json
{
  "bemoat:context": "node scripts/agent-context.ts",
  "bemoat:context:sync-base": "node scripts/agent-context-sync-base.ts",
  "bemoat:handoff": "node scripts/agent-handoff.ts"
}
```

Update registry `entrypoint`, `parser_owner`, safe-help expectations, lifecycle
identity, tests, and documentation to the same `.ts` identities.

- [ ] **Step 3: Verify the focused protocol and shared-boundary suite is green**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/context-cli.int.spec.ts tests/int/context-sync.int.spec.ts tests/int/handoff-cli.int.spec.ts tests/int/handoff-schema.int.spec.ts tests/int/handoff-transport.int.spec.ts tests/int/cli-command-registry.int.spec.ts tests/int/cli-invocation-contract.int.spec.ts tests/int/cli-envelope-runtime.int.spec.ts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/cli-tier-b-boundaries.int.spec.ts tests/int/command-runner.int.spec.ts tests/int/harness-contract/child-script-policy.int.spec.ts tests/int/harness-contract/runtime-import-parser.int.spec.ts tests/int/harness-contract/managed-runtime-closure.int.spec.ts tests/int/harness-contract/facade-exports.int.spec.ts
```

Expected: all selected tests pass with no `.mjs` protocol or shared-facade
consumer remaining.

### Task 3: Port guards and typecheck dependency cluster

**Files:**
- Rename to `.ts`: `scripts/bemoat-typecheck.ts`
- Rename to `.ts`: `scripts/guard-cloudflare-env.ts`, `scripts/guard-harness-contract.ts`, `scripts/guard-pack.ts`
- Rename to `.ts`: all retained `scripts/guards/*.mjs`
- Modify: `scripts/architecture-contract.json`
- Modify: `scripts/structural-protection-manifest.json`
- Modify guard, typecheck, architecture, and structural tests under `tests/int/`

**Interfaces:**
- Consumes: Task 2 TypeScript CLI and harness-contract exports.
- Produces: TypeScript-only aggregate guards and public typecheck/guard entrypoints.

- [ ] **Step 1: Port guard leaves before aggregate roots**

Rename and minimally type the leaf guard modules, preserving exported names and
return shapes. Then port `scripts/guards/pack.ts` and the three public guard
roots. Update every import and exact entrypoint assertion.

- [ ] **Step 2: Port the typecheck wrapper**

Set both `typecheck` and `bemoat:typecheck` to
`node scripts/bemoat-typecheck.ts`, preserving the two strict TypeScript
configurations and toolchain preflight.

- [ ] **Step 3: Verify the guard cluster**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/guard-pack.int.spec.ts tests/int/harness-contract-guard.int.spec.ts tests/int/repo-safety-guard.int.spec.ts tests/int/cloudflare-env-guard.int.spec.ts tests/int/build-script-contract-guard.int.spec.ts tests/int/structural-protection.int.spec.ts tests/int/scripts-architecture.int.spec.ts tests/int/toolchain-contract.int.spec.ts tests/int/cli-tier-b-boundaries.int.spec.ts
pnpm run typecheck
```

Expected: focused tests and strict typecheck pass with unchanged guard
classifications.

### Task 4: Port boilerplate sync/check and hook installer

**Files:**
- Rename to `.ts`: `scripts/boilerplate/*.mjs`
- Rename to `.ts`: `scripts/boilerplate/workflows/check-boilerplate-drift.mjs`
- Rename to `.ts`: `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs`
- Rename to `.ts`: `scripts/install-git-hooks.mjs`
- Modify: `package.json`
- Modify sync, hook, CLI Tier A, and child portability tests under `tests/int/`

**Interfaces:**
- Consumes: Tasks 2 and 3 TypeScript CLI, command-runner, guards, and harness-contract exports.
- Produces: TypeScript-only sync/check and hook public commands with unchanged mutation authority.

- [ ] **Step 1: Port boilerplate leaves and workflows**

Rename config, filesystem, Git, inventory, and workflow modules before the two
public roots. Preserve exports, sync modes, stashing/commit gates, and
read-only drift behavior.

- [ ] **Step 2: Port the hook installer and package targets**

Set the retained public targets to their `.ts` paths while preserving Tier A
validation, `chmod`, and `core.hooksPath` behavior.

- [ ] **Step 3: Verify mutation boundaries and child portability**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts tests/int/boilerplate-sync-filesystem.int.spec.ts tests/int/boilerplate-sync-git.int.spec.ts tests/int/boilerplate-sync-workflow.int.spec.ts tests/int/cli-tier-a-boundaries.int.spec.ts tests/int/child-portability.int.spec.ts tests/int/scripts-entrypoints-contract.int.spec.ts
```

Expected: all selected tests pass; check/help paths perform no mutation and
Tier A mutation tests retain their exact boundaries.

### Task 5: Close manifests, inventories, docs, and structural fallout

**Files:**
- Modify: `.bemoat/boilerplate-sync-manifest.json`
- Modify: `scripts/architecture-contract.json`
- Modify: `scripts/structural-protection-manifest.json`
- Modify: `scripts/AGENTS.md`, `scripts/ARCHITECTURE.md`
- Modify exact `.mjs` path references in `docs/**`, `.agents/**`, `.github/**`, `tests/**`, and `package.json`

**Interfaces:**
- Consumes: the final TypeScript paths from Tasks 2–4.
- Produces: one consistent managed runtime closure and complete remaining `.mjs` classification.

- [ ] **Step 1: Replace every retained-path consumer**

Use exact-path search and update only references to the 40 ported harness
files. Preserve references to the three OUTSIDE-HARNESS files.

- [ ] **Step 2: Prove the terminal structural invariant**

```bash
git ls-files '*.mjs'
rg -n 'scripts/[^"'"'[:space:]]+\.mjs|node scripts/[^"'"'[:space:]]+\.mjs' package.json scripts tests docs .agents .github .bemoat
```

Expected tracked `.mjs` output:

```text
eslint.config.mjs
scripts/build.mjs
scripts/deploy-smoke-test.mjs
```

No search result may reference a removed harness `.mjs` path.

- [ ] **Step 3: Run focused structural and sync verification**

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/cli-command-registry.int.spec.ts tests/int/scripts-architecture.int.spec.ts tests/int/structural-protection.int.spec.ts tests/int/harness-contract-guard.int.spec.ts tests/int/harness-contract/managed-runtime-closure.int.spec.ts tests/int/child-portability.int.spec.ts
pnpm run boilerplate:check -- --harness-only
git diff --check
```

Expected: all focused checks pass and the child runtime closure contains every
TypeScript dependency.

### Task 6: Full verification, review, and durable routing

**Files:**
- Modify only files required by evidence-backed corrections.
- Create a strict HANDOFF body outside tracked repository paths.

**Interfaces:**
- Consumes: the complete branch diff and Issue #429 acceptance criteria.
- Produces: exact-head CI/review evidence, canonical HANDOFF, and fresh Context route.

- [ ] **Step 1: Run local completion verification**

```bash
pnpm run check
git diff --check
git status --short
```

Expected: all commands pass; only authorized Issue #429 files differ.

- [ ] **Step 2: Push the exact head and verify GitHub checks**

```bash
git push
gh pr checks --watch
```

Expected: `ci` and `starter-ci` succeed on the exact pushed head.

- [ ] **Step 3: Run independent STANDARD semantic review**

Review public CLI drift, hidden mutation drift, guard weakening, scope
broadening, unnecessary abstraction, duplicate logic, stale `.mjs`, Node
compatibility, child portability, and stateful architecture revival. Correct
blocking findings test-first and run a focused Delta Review.

- [ ] **Step 4: Publish and read back the canonical HANDOFF**

First discover both command contracts through their registered safe-help
invocations. Then invoke `bemoat:handoff` once with a strict JSON body carrying
the exact branch, head, base, PR, evidence, acceptance audit, route
`FOUNDER_GATE`, and stop conditions. Read back the exact comment and run:

```bash
pnpm run bemoat:context -- 429 --json
```

Expected: fresh Context preserves the canonical terminal route without local
durability or evidence conflicts.
