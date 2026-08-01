# Narrow CommandRunner Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

<!-- bemoat-task-identity:start -->

```yaml
schema_version: 1
main_issue: null
task_key: 'issue-224'
task_issue_strategy: 'existing_dedicated_issue'
active_task_issue: '#224'
branch_template: 'docs/224-narrow-scripts-design'
transition_target: 'AWAITING_REVIEW_1'
planning_base_sha: '35703b786a4b7fbbcff7546cba2ba450a2e1804f'
execution_base_rule: 'resolve_live_protected_base_at_dispatch'
paired_spec: 'docs/superpowers/specs/bemoat-web-starter/architecture/scripts-refactor/design.md'
paired_plan: 'docs/superpowers/plans/bemoat-web-starter/architecture/scripts-refactor/implementation-plan.md'
```

<!-- bemoat-task-identity:end -->

**Goal:** Add one internal CommandRunner adapter path while preserving the
existing root import facade, public CLI behavior, managed child delivery, and
the exact trusted dependency-cycle baseline.

**Architecture:** Keep every root script path stable. Add
`scripts/adapters/command-runner.mjs`, turn
`scripts/command-runner.mjs` into a compatibility re-export, and rewire only
`scripts/mission-control-review.mjs` to the internal adapter. Tests define
additive child delivery and a no-new/no-expanded-cycle ratchet.

**Tech Stack:** Node.js 24.15+, ECMAScript modules, Vitest, pnpm, GitHub Actions,
Bemoat boilerplate sync.

## Global Constraints

- Required design:
  `docs/superpowers/specs/bemoat-web-starter/architecture/scripts-refactor/design.md`
- Main Issue:
  [boat1994/bemoat-web-starter#224](https://github.com/boat1994/bemoat-web-starter/issues/224)
- Trusted implementation base:
  `main@35703b786a4b7fbbcff7546cba2ba450a2e1804f`
- Independent review:
  [Issue comment 5150196877](https://github.com/boat1994/bemoat-web-starter/issues/224#issuecomment-5150196877)
- This plan is not executable until a separate Founder decision authorizes this
  exact CommandRunner candidate.
- Preserve every existing root CLI and import path.
- Use additive changes only; remove or rename no managed path.
- Do not change package scripts, CI workflows, Mission Control semantics,
  diagnostics, CLI arguments, output, or exit behavior.
- Do not run a real child sync.
- Stop if any file outside the exact allowlist is required.

---

## Main Issue and durable state

- Main GitHub Issue: #224
- Relevant plan section after Founder authorization:
  `Slice 1 — Additive CommandRunner boundary proof`
- The Issue owns current stage and Founder authority.
- This plan owns future task ordering, exact paths, interfaces, and verification.
- No checkbox in this document is evidence that implementation has started or
  completed.

## Required source inputs

- `docs/superpowers/specs/bemoat-web-starter/architecture/scripts-refactor/design.md`
- `scripts/command-runner.mjs`
- `scripts/mission-control-review.mjs`
- `scripts/sync-boilerplate.mjs`
- `.bemoat/boilerplate-sync-manifest.json`
- `tests/int/command-runner.int.spec.ts`
- `tests/int/mission-control-review.int.spec.ts`
- `tests/int/mission-control-review-cli.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `scripts/guard-harness-contract.mjs`

## Slice 1 — Additive CommandRunner boundary proof

### Scope contract

#### Exact allowed paths

- `scripts/adapters/command-runner.mjs` (new)
- `scripts/command-runner.mjs`
- `scripts/mission-control-review.mjs`
- `scripts/sync-boilerplate.mjs`
- `.bemoat/boilerplate-sync-manifest.json`
- `tests/int/command-runner.int.spec.ts`
- `tests/int/mission-control-review.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/scripts-architecture.int.spec.ts` (new)

#### Exact prohibited paths and actions

- `package.json`, `pnpm-lock.yaml`, `.github/workflows/**`,
  `.githooks/**`, `.bemoat-boilerplate-sync.json`
- `scripts/pr-identity.mjs`, `scripts/correction-contract.mjs`,
  `scripts/mission-control-state.mjs`,
  `scripts/mission-control-issue-body-cas.mjs`,
  `scripts/agent-issue/**`, every `scripts/guard-*.mjs`
- every other script, test, fixture, pinned snapshot, doc, app file, Cloudflare
  file, Payload file, and migration
- any deletion, rename, package-command edit, CI edit, real child sync, deploy,
  migration, production access, Issue #229 work, or Finance work

If an implementer believes another path is required, stop without editing it
and return to the Founder.

### Interfaces

`scripts/adapters/command-runner.mjs` produces:

```js
import { spawnSync } from 'node:child_process'

export function createCommandRunner(spawn = spawnSync) {
  return function runCommand(command, args = [], options = {}) {
    const result = spawn(command, args, { encoding: 'utf8', ...options })
    if (result.error || result.status !== 0) {
      throw new Error(
        result.stderr || result.stdout || result.error?.message || `${command} failed`,
      )
    }
    return (result.stdout ?? '').trim()
  }
}

export const runCommand = createCommandRunner()
```

`scripts/command-runner.mjs` remains the stable public import facade:

```js
export { createCommandRunner, runCommand } from './adapters/command-runner.mjs'
```

`scripts/mission-control-review.mjs` consumes only:

```js
import { runCommand as run } from './adapters/command-runner.mjs'
```

No other production consumer is rewired.

### Dependency-cycle ratchet contract

The architecture test records the exact nine baseline nodes and sixteen
baseline internal edges from the design. Its public test helpers are local to
the test file:

```ts
type ImportGraph = Map<string, Set<string>>

function buildScriptImportGraph(root: string): ImportGraph
function findStronglyConnectedComponents(graph: ImportGraph): string[][]
function collectInternalEdges(graph: ImportGraph, component: ReadonlySet<string>): Set<string>
```

The assertion permits the baseline component to remain unchanged, split, shrink,
or lose edges. It rejects every new cyclic node or internal edge:

```ts
for (const component of findStronglyConnectedComponents(graph)) {
  if (component.length < 2) continue

  expect(component.every((path) => BASELINE_CYCLE_NODES.has(path))).toBe(true)

  const edges = collectInternalEdges(graph, new Set(component))
  for (const edge of edges) {
    expect(BASELINE_CYCLE_EDGES.has(edge)).toBe(true)
  }
}
```

The test also asserts that
`scripts/adapters/command-runner.mjs` imports no repository module and that
only `scripts/command-runner.mjs` plus
`scripts/mission-control-review.mjs` import the new adapter.

## Task 1: Write the failing additive-boundary tests

**Files:**

- Modify: `tests/int/command-runner.int.spec.ts`
- Modify: `tests/int/mission-control-review.int.spec.ts`
- Modify: `tests/int/boilerplate-sync.int.spec.ts`
- Create: `tests/int/scripts-architecture.int.spec.ts`

**Interfaces:**

- Consumes: existing `createCommandRunner`, `runCommand`,
  `syncPathsFromSource`, `managedPaths`, and
  `scanManagedRuntimeDeliveryClosure`.
- Produces: executable acceptance tests for the internal adapter, compatibility
  facade, simulated child delivery, and cycle ratchet.

- [ ] **Step 1: Add the CommandRunner internal-path and facade assertions**

In `tests/int/command-runner.int.spec.ts`, import both paths and assert export
identity:

```ts
import {
  createCommandRunner as createFromAdapter,
  runCommand as runFromAdapter,
} from '../../scripts/adapters/command-runner.mjs'
import {
  createCommandRunner as createFromFacade,
  runCommand as runFromFacade,
} from '../../scripts/command-runner.mjs'

expect(createFromFacade).toBe(createFromAdapter)
expect(runFromFacade).toBe(runFromAdapter)
```

Keep every existing success, failure, diagnostics, option, encoding, and trimmed
stdout assertion. Change no expected behavior.

- [ ] **Step 2: Add the single-consumer assertion**

In `tests/int/mission-control-review.int.spec.ts`, require the new literal
import and preserve the no-direct-child-process assertions:

```ts
expect(source).toMatch(/from '\.\/adapters\/command-runner\.mjs'/)
expect(source).not.toMatch(/from 'node:child_process'/)
expect(source).not.toMatch(/\bspawnSync\b/)
```

Also assert that both CommandRunner paths remain in `managedPaths`.

- [ ] **Step 3: Add the simulated child-sync assertion**

In `tests/int/boilerplate-sync.int.spec.ts`, use the existing temporary source
and child helpers. Start the child without the nested adapter, execute
`syncPathsFromSource()` in `HARNESS_ONLY` mode, and assert:

```ts
expect(existsSync(join(childRoot, 'scripts/command-runner.mjs'))).toBe(true)
expect(existsSync(join(childRoot, 'scripts/adapters/command-runner.mjs'))).toBe(true)

execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import('./scripts/command-runner.mjs').then((m) => { if (typeof m.runCommand !== 'function') throw new Error('missing compatibility export') })",
  ],
  { cwd: childRoot, stdio: 'pipe' },
)
```

Snapshot child-owned files before sync and assert the snapshot is unchanged
after sync. Do not invoke the networked sync CLI.

- [ ] **Step 4: Create the architecture ratchet test**

Create `tests/int/scripts-architecture.int.spec.ts` with:

- the exact nine-node and sixteen-edge baseline from the design;
- static `from './x.mjs'`, `from '../x.mjs'`, and literal
  `import('./x.mjs')` extraction;
- relative-path resolution from importer to repository-relative callee;
- Tarjan strongly connected component detection;
- the subset assertions shown in the ratchet contract;
- the adapter dependency and importer allowlist assertions.

Non-literal dynamic imports are outside this graph test; the existing managed
runtime delivery closure remains responsible for unresolved runtime imports.

- [ ] **Step 5: Run RED verification**

Run:

```bash
pnpm exec vitest run \
  tests/int/command-runner.int.spec.ts \
  tests/int/mission-control-review.int.spec.ts \
  tests/int/boilerplate-sync.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts
```

Expected: failure because
`scripts/adapters/command-runner.mjs` does not exist, the review command still
imports the root implementation, and the new managed path is absent. The cycle
baseline portion should already pass.

Do not commit the RED state.

## Task 2: Add the internal adapter and stable compatibility facade

**Files:**

- Create: `scripts/adapters/command-runner.mjs`
- Modify: `scripts/command-runner.mjs`
- Modify: `scripts/mission-control-review.mjs`

**Interfaces:**

- Consumes: the current exact CommandRunner implementation at the approved
  baseline.
- Produces: the same `createCommandRunner` and `runCommand` values through
  both import paths; one direct internal consumer.

- [ ] **Step 1: Add the internal adapter without semantic changes**

Create `scripts/adapters/command-runner.mjs` with the current 24-line
implementation from `scripts/command-runner.mjs`. Preserve:

- `spawnSync` default injection;
- `{ encoding: 'utf8', ...options }` option order;
- failure precedence:
  `stderr -> stdout -> error.message -> "<command> failed"`;
- `stdout ?? ''` and `.trim()`;
- both export names.

- [ ] **Step 2: Replace the root implementation with the compatibility facade**

Replace only the contents of `scripts/command-runner.mjs` with:

```js
#!/usr/bin/env node
export { createCommandRunner, runCommand } from './adapters/command-runner.mjs'
```

The root file remains present and managed.

- [ ] **Step 3: Rewire the one permitted production consumer**

In `scripts/mission-control-review.mjs`, change only:

```js
import { runCommand as run } from './command-runner.mjs'
```

to:

```js
import { runCommand as run } from './adapters/command-runner.mjs'
```

Do not alter any other import or statement.

- [ ] **Step 4: Run focused GREEN verification**

Run:

```bash
pnpm exec vitest run \
  tests/int/command-runner.int.spec.ts \
  tests/int/mission-control-review.int.spec.ts \
  tests/int/mission-control-review-cli.int.spec.ts
```

Expected: all tests pass with unchanged CLI behavior and diagnostics.

## Task 3: Close managed child delivery additively

**Files:**

- Modify: `scripts/sync-boilerplate.mjs`
- Modify: `.bemoat/boilerplate-sync-manifest.json`
- Modify: `tests/int/boilerplate-sync.int.spec.ts`

**Interfaces:**

- Consumes: both CommandRunner paths and the existing source-driven manifest
  contract.
- Produces: one-run simulated child delivery of the nested adapter while
  preserving the root facade and all package commands.

- [ ] **Step 1: Add the nested adapter to exported managed paths**

Add `'scripts/adapters/command-runner.mjs'` immediately after
`'scripts/command-runner.mjs'` in `scripts/sync-boilerplate.mjs`. Keep the
root path.

Add `'tests/int/scripts-architecture.int.spec.ts'` next to the other managed
CommandRunner/review tests so the child-safe architecture ratchet runs in
synced integration tests.

- [ ] **Step 2: Mirror the exact entries in the source manifest**

Add the same two paths at corresponding positions in
`.bemoat/boilerplate-sync-manifest.json`. Change no other array or metadata
file.

- [ ] **Step 3: Run managed delivery GREEN verification**

Run:

```bash
pnpm exec vitest run \
  tests/int/boilerplate-sync.int.spec.ts \
  tests/int/harness-contract-guard.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts
```

Expected: manifest parity, runtime delivery closure, simulated child sync, and
cycle ratchet all pass. The child-owned snapshot remains unchanged.

- [ ] **Step 4: Verify prohibited paths remain untouched**

Run:

```bash
git diff --name-only
```

Every output path must be in the nine-path allowlist. If not, stop.

## Task 4: Full verification and bounded delivery

**Files:**

- Modify: none beyond the exact allowlist.

**Interfaces:**

- Consumes: completed Tasks 1–3.
- Produces: exact-head evidence for semantic review. It does not authorize a
  later extraction or child sync.

- [ ] **Step 1: Run the complete focused suite**

Run:

```bash
pnpm exec vitest run \
  tests/int/command-runner.int.spec.ts \
  tests/int/mission-control-review.int.spec.ts \
  tests/int/mission-control-review-cli.int.spec.ts \
  tests/int/boilerplate-sync.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the starter validation tier**

Run:

```bash
pnpm run guard:safety
pnpm run check
git diff --check
```

Expected: every command exits zero; lint has zero warnings; all integration
tests pass.

- [ ] **Step 3: Audit the exact diff**

Run:

```bash
git status --short
git diff --stat
git diff --name-only
git diff -- scripts/command-runner.mjs \
  scripts/adapters/command-runner.mjs \
  scripts/mission-control-review.mjs
```

Confirm:

- exactly the nine allowed paths or a subset changed;
- no file was deleted or renamed;
- `package.json`, workflows, metadata, fixtures, and prohibited modules are
  absent from the diff;
- only review imports the internal adapter directly;
- the cycle baseline is unchanged.

After the focused commit exists, run:

```bash
git diff --name-only \
  35703b786a4b7fbbcff7546cba2ba450a2e1804f...HEAD
```

The result must still be the same nine-path allowlist or a subset. If live
`main` no longer matches the separately Founder-approved implementation base,
stop and obtain a new exact-base decision rather than using the planning SHA
unconditionally.

- [ ] **Step 4: Create one focused implementation commit**

Only after a separate Founder implementation decision and passing checks:

```bash
git add \
  scripts/adapters/command-runner.mjs \
  scripts/command-runner.mjs \
  scripts/mission-control-review.mjs \
  scripts/sync-boilerplate.mjs \
  .bemoat/boilerplate-sync-manifest.json \
  tests/int/command-runner.int.spec.ts \
  tests/int/mission-control-review.int.spec.ts \
  tests/int/boilerplate-sync.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts
git commit -m "refactor(harness): add additive command runner boundary"
```

- [ ] **Step 5: Push and open the implementation PR**

Only after the separate Founder decision authorizes implementation delivery:

```bash
git push -u origin HEAD
gh pr create --base main --title "refactor(harness): add additive CommandRunner boundary (#224)"
```

The PR body must bind the trusted base, state the nine-path allowlist, report
RED/GREEN and full-check evidence, explain the unchanged cycle baseline, and
state that no real child sync ran.

- [ ] **Step 6: Verify exact-head CI and stop**

Require successful exact-head runs for:

- `CI`;
- `CI (starter strict)`.

Post the compact implementation `## RESULT` only after those requirements are
met. Do not post an implementation HANDOFF from this plan, merge, run child
sync, or begin another extraction.

## Later work is not planned here

This plan deliberately contains no task for:

- moving `pr-identity.mjs`, `correction-contract.mjs`, or
  `mission-control-state.mjs`;
- moving root commands into `cli/`;
- moving guards;
- reducing the recorded cycle;
- renaming or deleting a managed path;
- migrating package commands;
- running a child sync;
- Issue #229, deployment, migration, production access, or Finance work.

Each item requires a separate evidence-backed design and Founder decision.
