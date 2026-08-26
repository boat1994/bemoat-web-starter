<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-430"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#430"
branch_template: "fix/430-protected-main-target-worktree"
transition_target: "FOUNDER_GATE"
planning_base_sha: "153973a591eb9672ddc201dcd21f9d9e8bbddce8"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/design.md"
paired_plan: "docs/superpowers/plans/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/plan.md"
```
<!-- bemoat-task-identity:end -->

# Protected-Main Stale-Branch Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `bemoat:context:sync-base` so the exact current protected-main command checkout can safely operate on one explicit absolute stale-PR worktree without weakening same-worktree behavior.

**Architecture:** Add a small neutral worktree boundary that canonicalizes the optional target path and independently verifies the command-source checkout. The public entrypoint collects live evidence from the selected target, while the existing synchronization function repeats source and target checks immediately before its first mutation.

**Tech Stack:** Node.js 24.15+, TypeScript with native type stripping, pnpm, Vitest, Git CLI, GitHub CLI.

**Spec:** `docs/superpowers/specs/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/design.md`

## Global Constraints

- The command implementation and registered contract come from a clean canonical checkout whose `HEAD` equals the exact live protected-main SHA.
- `--target-worktree` accepts one explicit absolute path; the command canonicalizes and verifies it independently.
- No target mutation occurs before source identity and every existing target eligibility check pass.
- Omitting `--target-worktree` preserves existing same-worktree behavior.
- The command never creates/removes worktrees, copies command files, mutates Issue/PR metadata, merges a PR, deploys, migrates, or touches PR #420 during correction development.
- Wrong source/repository, dirty/detached/unpushed target, ambiguity, ancestry failure, conflict, drift, or uncertain mutation result remains fail-closed.
- Write and run the failing story against the protected baseline before production implementation.

## File structure

- Create `scripts/context/sync-worktree.ts`: canonical target-root resolution and protected-main source-checkout verification only.
- Modify `scripts/agent-context-sync-base.mjs`: parse the optional target, select source/target roots, collect evidence from the target, and pass bootstrap source identity into synchronization.
- Modify `scripts/context/sync.ts`: revalidate optional source identity and target local state at the final pre-mutation checkpoint.
- Modify `scripts/cli/context-sync-command-metadata.ts`: expose the public flag and exact source/target evidence contract.
- Modify `tests/int/context-sync.int.spec.ts`: story-first lifecycle, path, source, target, drift, unchanged same-worktree, and mutation-boundary coverage.
- Modify `tests/int/cli-command-registry.int.spec.ts`: assert registry/help shape for the new path flag.
- Modify `tests/int/structural-protection.int.spec.ts`: advance the exact script inventory by one for the new bounded module.
- Modify `docs/agent-loop/context-story-matrix.md`: record the protected-main bootstrap lifecycle and invocation boundary.
- Keep the paired design and plan task-identity blocks byte-equivalent.

---

### Task 1: Protected-main command source and explicit target worktree

**Files:**
- Create: `scripts/context/sync-worktree.ts`
- Modify: `scripts/agent-context-sync-base.mjs`
- Modify: `scripts/context/sync.ts`
- Modify: `scripts/cli/context-sync-command-metadata.ts`
- Modify: `tests/int/context-sync.int.spec.ts`
- Modify: `tests/int/cli-command-registry.int.spec.ts`
- Modify: `docs/agent-loop/context-story-matrix.md`
- Modify: `docs/superpowers/specs/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/design.md`
- Modify: `docs/superpowers/plans/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/plan.md`

**Interfaces:**
- Consumes: `collectContextEvidence({ issueNumber, cwd })`, `runContextCommand`, `normalizeOriginRepository`, `NormalizedContextEvidence`, and the existing `synchronizeContext` mutation rail.
- Produces: `resolveContextSyncRoots(input): ContextSyncRoots`, `verifyContextSyncSource(input): string[]`, optional `sourceCwd` support in `synchronizeContext`, and the registered `target_worktree` caller value.

- [x] **Step 1: Add the failing protected-main bootstrap story**

Extend `tests/int/context-sync.int.spec.ts` with an explicit source root and stale target root. Record every command and `options.cwd`, then assert that bootstrap mode uses `/protected-main` for source identity reads and `/stale-pr` for all target evidence and mutation operations:

```ts
it('uses the exact protected-main command source to synchronize an explicit stale target worktree', () => {
  const calls: Array<{ command: string; args: string; cwd: string | undefined }> = []
  let merged = false
  let pushed = false
  const run: ContextCommandRunner = (command, args, options) => {
    const key = args.join(' ')
    const cwd = options?.cwd
    calls.push({ command, args: key, cwd })

    if (command !== 'git') return response('', 1)
    if (cwd === '/protected-main') {
      if (key === 'rev-parse --show-toplevel') return response('/protected-main')
      if (key === 'rev-parse HEAD') return response(protectedBase)
      if (key === 'status --short') return response('')
      if (key === 'remote get-url origin') return response('https://github.com/boat1994/bemoat-web-starter.git')
      return response('', 1)
    }
    if (cwd !== '/stale-pr') return response('', 1)
    if (key === 'status --short') return response('')
    if (key === 'branch --show-current') return response(prHeadBranch)
    if (key === 'rev-parse HEAD') return response(merged ? nextHead : head)
    if (key === 'ls-remote --heads origin main') return response(`${protectedBase}\trefs/heads/main\n`)
    if (key === `ls-remote --heads origin ${prHeadBranch}`) {
      return response(`${pushed ? nextHead : head}\trefs/heads/${prHeadBranch}\n`)
    }
    if (key === 'fetch --no-tags origin main') return response()
    if (key === 'rev-parse FETCH_HEAD') return response(protectedBase)
    if (key === `merge-base --is-ancestor ${oldBase} FETCH_HEAD`) return response()
    if (key === `merge-base --is-ancestor ${oldBase} HEAD`) return response()
    if (key === 'merge-tree --write-tree HEAD FETCH_HEAD') return response(nextHead)
    if (key === 'merge --no-edit FETCH_HEAD') { merged = true; return response() }
    if (key === `push origin HEAD:${prHeadBranch}`) { pushed = true; return response() }
    return response('', 1)
  }

  const result = synchronizeContext({
    evidence: baseEvidence(),
    cwd: '/stale-pr',
    sourceCwd: '/protected-main',
    run,
  })

  expect(result).toMatchObject({
    classification: 'SUCCESS',
    mutationPerformed: true,
    currentHead: nextHead,
  })
  expect(calls).toContainEqual({ command: 'git', args: 'rev-parse HEAD', cwd: '/protected-main' })
  expect(calls).toContainEqual({ command: 'git', args: 'merge --no-edit FETCH_HEAD', cwd: '/stale-pr' })
  expect(calls).toContainEqual({ command: 'git', args: `push origin HEAD:${prHeadBranch}`, cwd: '/stale-pr' })
})
```

Add public-boundary assertions that JSON help contains:

```ts
expect(help.optional_flags).toContainEqual(expect.objectContaining({
  name: 'target_worktree',
  syntax: '--target-worktree <absolute-path>',
  value_type: 'path',
  required: false,
}))
```

Add table cases for duplicate, relative, missing, non-directory, source-equal, and symlink-aliased target paths. Each case must assert `INVALID_INVOCATION`, `mutation_performed: false`, and no `git merge` or `git push` call.

- [x] **Step 2: Run the red story and classify it**

Run:

```bash
pnpm exec vitest run tests/int/context-sync.int.spec.ts tests/int/cli-command-registry.int.spec.ts
```

Expected: FAIL because `sourceCwd` and `--target-worktree` are not yet supported and help lacks `target_worktree`.

Record the story as an implementation defect under the newly Founder-approved Issue #430 contract. Inspect the bounded neighboring cases from Step 1; do not change production behavior until this red result is observed.

- [x] **Step 3: Register the public path flag**

In `scripts/cli/context-sync-command-metadata.ts`, add this optional input after `--json`:

```ts
flag(
  'target_worktree',
  '--target-worktree <absolute-path>',
  'path',
  'Absolute canonicalizable path to the stale active PR worktree; omit for same-worktree mode.',
)
```

Update the same contract's operation, trusted-derived values, required evidence, reads, stop conditions, examples, and `last_validation_before_mutation` so they explicitly distinguish exact protected-main command source from target-worktree Git evidence. Do not add a new command, route, classification, or retry mode.

In `tests/int/cli-command-registry.int.spec.ts`, assert that the registered command exposes exactly one `target_worktree` optional path input and that registry validation remains green.

- [x] **Step 4: Implement canonical root selection**

Create `scripts/context/sync-worktree.ts` with these exact public types and function:

```ts
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface ContextSyncRoots {
  sourceCwd: string
  targetCwd: string
  bootstrap: boolean
}

export class ContextSyncWorktreeError extends Error {}

export function resolveContextSyncRoots({
  sourceCwd,
  targetWorktree,
  realpath = realpathSync,
  stat = statSync,
}: {
  sourceCwd: string
  targetWorktree?: string | null
  realpath?: typeof realpathSync
  stat?: typeof statSync
}): ContextSyncRoots
```

Implementation rules:

```ts
const canonicalSource = realpath(resolve(sourceCwd))
if (!targetWorktree) {
  return { sourceCwd: canonicalSource, targetCwd: canonicalSource, bootstrap: false }
}
if (!isAbsolute(targetWorktree)) {
  throw new ContextSyncWorktreeError('--target-worktree must be an absolute path')
}
const canonicalTarget = realpath(targetWorktree)
if (!stat(canonicalTarget).isDirectory()) {
  throw new ContextSyncWorktreeError('--target-worktree must resolve to a directory')
}
if (canonicalTarget === canonicalSource) {
  throw new ContextSyncWorktreeError('--target-worktree must identify a distinct worktree')
}
return { sourceCwd: canonicalSource, targetCwd: canonicalTarget, bootstrap: true }
```

Catch filesystem failures and convert them to `ContextSyncWorktreeError` without exposing a stack trace or mutating either root.

- [x] **Step 5: Implement protected-main source verification**

In `scripts/context/sync-worktree.ts`, add:

```ts
import type { NormalizedContextEvidence } from './model.ts'
import { isFullSha, normalizeOriginRepository, output, runContextCommand } from './runtime.ts'
import type { ContextCommandRunner } from './runtime.ts'

export function verifyContextSyncSource({
  sourceCwd,
  evidence,
  run = runContextCommand,
}: {
  sourceCwd: string
  evidence: NormalizedContextEvidence
  run?: ContextCommandRunner
}): string[]
```

The function performs only these source-root reads:

```ts
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
git remote get-url origin
```

Return a deduplicated reason array unless all of the following hold:

- canonical `--show-toplevel` equals `sourceCwd`;
- source `HEAD` is a full SHA equal to `evidence.protectedBase.sha`;
- source status is empty;
- normalized source origin equals both `evidence.repository.nameWithOwner` and `evidence.localGit.originRepository`.

Use precise `EVIDENCE_CONFLICT: protected-main command source ...` reasons. Do not require a source branch, upstream, pushed state, or attachment; detached exact-SHA source worktrees are valid.

- [x] **Step 6: Connect the public entrypoint to the two roots**

Modify `scripts/agent-context-sync-base.mjs` after invocation parsing:

```js
const roots = resolveContextSyncRoots({
  sourceCwd: process.cwd(),
  targetWorktree: typeof invocation.values.target_worktree === 'string'
    ? invocation.values.target_worktree
    : null,
})
const evidence = collectContextEvidence({
  issueNumber: invocation.values.issue_number,
  cwd: roots.targetCwd,
})
const result = synchronizeContext({
  evidence,
  cwd: roots.targetCwd,
  sourceCwd: roots.bootstrap ? roots.sourceCwd : null,
})
```

Catch `ContextSyncWorktreeError` and rethrow `new CliInvocationError('--target-worktree', error.message)` so the public envelope is `INVALID_INVOCATION` with `mutation_performed: false`. Keep help handling mutation-free and before root resolution.

- [x] **Step 7: Gate synchronization on source identity and final target revalidation**

Modify `synchronizeContext` in `scripts/context/sync.ts` to accept:

```ts
sourceCwd?: string | null
```

When `sourceCwd` is present, call `verifyContextSyncSource` before `authorizeContextSync`; any reason returns `EVIDENCE_CONFLICT`, `STOP`, and `mutationPerformed: false`.

After fetch, ancestry, and `merge-tree` succeed but before `git merge`, repeat:

```ts
const sourceDrift = sourceCwd
  ? verifyContextSyncSource({ sourceCwd, evidence, run })
  : []
if (sourceDrift.length > 0) {
  return stop('HEAD_DRIFT', sourceDrift.map((reason) => reason.replace(/^EVIDENCE_CONFLICT:/, 'HEAD_DRIFT:')))
}

for (const [label, args, expected] of checks) {
  const value = readback(run, 'git', args, cwd)
  if (value !== expected) return stop('HEAD_DRIFT', [`HEAD_DRIFT: ${label} changed immediately before synchronization`])
}
```

Then retain the existing protected-base and PR-branch `ls-remote` revalidation, merge, push, and readback without broad refactoring. All target Git calls use `cwd`; all source verification calls use `sourceCwd`.

- [x] **Step 8: Make the story and bounded neighbors green**

Complete the Step 1 fixtures so source verification returns the protected SHA and canonical origin on both reads, target `HEAD` changes only after merge, and target remote head changes only after push.

Add explicit assertions for:

- dirty, wrong-SHA, wrong-repository, and drifting source;
- target local status/branch/head drift at the final checkpoint;
- unchanged successful same-worktree invocation with `sourceCwd` omitted;
- no source-root `merge`, `push`, `fetch`, or filesystem mutation;
- no `git worktree`, `cp`, `gh issue`, `gh pr`, or metadata mutation call.

Run:

```bash
pnpm exec vitest run tests/int/context-sync.int.spec.ts tests/int/cli-command-registry.int.spec.ts
```

Expected: both files pass and every mutation assertion binds to `/stale-pr` only.

- [x] **Step 9: Document the lifecycle extension**

Update `docs/agent-loop/context-story-matrix.md` with one bounded story row and lifecycle paragraph:

```text
Stale PR branch predates sync-base command × exact protected-main source × explicit durable target worktree
→ protected-main registered command may run the existing bounded synchronization against that target
→ every source/target ambiguity remains STOP
```

Document the `pnpm --dir <protected-main-worktree> ... --target-worktree <absolute-path>` invocation. State that the command does not create/remove worktrees and that PR #420 remains untouched until Issue #430 is Founder-manually merged.

- [x] **Step 10: Run full validation**

Run in order:

```bash
pnpm run bemoat:context:sync-base -- --help --json
pnpm exec vitest run tests/int/context-sync.int.spec.ts tests/int/cli-command-registry.int.spec.ts
pnpm exec tsc --noEmit -p tsconfig.harness-strict.json
pnpm run check
git diff --check
```

Expected:

- JSON help is mutation-free and exposes the optional absolute-path flag.
- Focused tests pass.
- Strict harness TypeScript passes.
- Full guard/lint/typecheck/integration suite passes with zero warnings.
- Diff check emits no output.

- [x] **Step 11: Review and commit one focused correction**

Verify:

```bash
git status --short
git diff --stat
git diff -- scripts/agent-context-sync-base.mjs scripts/context/sync-worktree.ts scripts/context/sync.ts scripts/cli/context-sync-command-metadata.ts tests/int/context-sync.int.spec.ts tests/int/cli-command-registry.int.spec.ts docs/agent-loop/context-story-matrix.md
```

Confirm no PR #420, legacy Stateful Mission Control, deployment, migration, production, ruleset, or unrelated file changed. Then commit the implementation and paired plan update:

```bash
git add scripts/agent-context-sync-base.mjs scripts/context/sync-worktree.ts scripts/context/sync.ts scripts/cli/context-sync-command-metadata.ts tests/int/context-sync.int.spec.ts tests/int/cli-command-registry.int.spec.ts docs/agent-loop/context-story-matrix.md docs/superpowers/specs/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/design.md docs/superpowers/plans/bemoat/agent-protocol/protected-main-stale-branch-bootstrap/plan.md
git commit -m "feat(context): bootstrap stale PRs from protected main"
```

### Task 2: Durable delivery and independent exact-head review

**Files:**
- Modify through GitHub only: Issue #430, the new PR, exact-head check/review evidence.
- Do not modify: PR #420 or its branch.

**Interfaces:**
- Consumes: green Task 1 commit and exact Issue #430 acceptance criteria.
- Produces: one open PR targeting `main`, one canonical HANDOFF, green exact-head CI, and independent Luna Medium semantic-review evidence.

- [ ] **Step 1: Push and open the independent PR**

Push `fix/430-protected-main-target-worktree`, audit every Issue #430 acceptance criterion as `Done`, `Waiting for CI / human review`, or `Not applicable`, and open a PR targeting `main` with `Closes #430`. The PR body includes changed files, exact validation results, the AC audit, bootstrap risks, and the explicit statement that PR #420 is unchanged.

- [ ] **Step 2: Discover and publish the canonical HANDOFF**

Run:

```bash
pnpm run bemoat:handoff -- --help --json
```

Follow the discovered public contract exactly to append one Issue #430 HANDOFF bound to the new PR and exact head with route `VERIFY`. Do not use raw GitHub mutation for the handoff.

- [ ] **Step 3: Reconstruct and verify exact-head CI**

Run fresh `bemoat:context 430`. Follow deterministic `VERIFY` until GitHub `ci` and `starter-ci` both complete successfully on the exact PR head. Any failed check routes to bounded `FIX`; inspect logs before changing code.

- [ ] **Step 4: Run independent Luna Medium semantic review**

Review the full exact-head diff against Issue #430, the approved spec, and protected-main policy. Required review emphasis: source-command identity, target-root canonicalization, no pre-gate mutation, same-worktree compatibility, final source/target drift checks, ambiguous-result handling, and prohibited-scope audit.

Publish the canonical exact-head review evidence. If a deterministic Important defect is proven, route one bounded `FIX`, apply story-first correction, push a new head, and invalidate old CI/review. If no Critical or Important finding remains, reconstruct fresh and stop at `FOUNDER_GATE` for manual merge.

- [ ] **Step 5: Preserve the resumption boundary**

Do not invoke the new bootstrap against PR #420 before Founder manual merge. After the Founder merges Issue #430's PR, fresh-reconstruct protected main, Issue #430 terminal evidence, Issue #410, and PR #420 before discovering and invoking `bemoat:context:sync-base` from the exact protected-main checkout.
