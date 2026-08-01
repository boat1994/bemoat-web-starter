# Narrow Scripts Architecture Design

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

## Decision status

This design corrects the rejected broad folder-move proposal for Issue
[224](https://github.com/boat1994/bemoat-web-starter/issues/224).

- Trusted repository baseline:
  `main@35703b786a4b7fbbcff7546cba2ba450a2e1804f`
- Independent architecture review:
  [Issue comment 5150196877](https://github.com/boat1994/bemoat-web-starter/issues/224#issuecomment-5150196877)
- Founder decision supplied for this correction pass:
  accept `NARROW THE DESIGN`
- Status after this document: design-only; implementation requires a separate
  Founder decision.
- Superseded direction: the global `cli/`, `workflows/`, `domain/`,
  `adapters/`, `guards/`, and `shared/` mass-move plan and its four-file
  first slice.

This document defines constraints and a single future implementation candidate.
It does not authorize implementation, file moves, path deletion, package-script
changes, CI changes, child sync, deployment, migration, production access, or
Finance work.

## Problem to solve

The scripts harness has real responsibility and dependency hotspots, but its
root paths are also public contracts:

- `package.json` invokes root scripts directly;
- scripts invoke other root scripts by literal path;
- integration tests import root modules directly;
- `scripts/sync-boilerplate.mjs` and
  `.bemoat/boilerplate-sync-manifest.json` deliver those paths to children;
- representative child fixtures preserve historical path shapes.

A cosmetic directory move would change those contracts without reducing the
dependency graph that drives maintenance context. The architecture must
therefore improve boundaries additively while preserving all existing root
facades and import paths.

## Revalidated trusted-baseline evidence

The following values were recomputed from the exact trusted baseline during the
design-correction pass.

| Metric                                               |                         Measured value |
| ---------------------------------------------------- | -------------------------------------: |
| Files under `scripts/`                               |                                     51 |
| `.mjs` files                                         |                                     50 |
| Files directly under `scripts/`                      |                                     34 |
| Static relative import edges                         |                                    102 |
| Inbound edges to `scripts/command-runner.mjs`        |                                      1 |
| Inbound edges to `scripts/pr-identity.mjs`           |                                      4 |
| Inbound edges to `scripts/correction-contract.mjs`   |                                      4 |
| Inbound edges to `scripts/mission-control-state.mjs` |                                     13 |
| `mission-control-review` static closure              | 27 files / 7,919 lines / 316,573 bytes |
| `sync-boilerplate` static closure                    | 28 files / 9,784 lines / 371,382 bytes |
| `guard-package-manager` static closure               |   4 files / 1,182 lines / 33,101 bytes |
| Sorted `.mjs` path listing                           |                            1,801 bytes |

The tracked `.bemoat-boilerplate-sync.json` file is present at the baseline.
It is sync-run metadata, not the authoritative starter path contract. The
authoritative source path list is
`.bemoat/boilerplate-sync-manifest.json`, mirrored by exported constants in
`scripts/sync-boilerplate.mjs`.

A direct copy-behavior check also confirmed that recursive managed-directory
copying adds current files without deleting a stale destination file.
`assertExactManagedPackageScripts()` rejects an existing child-managed
package command whose value differs from the source. Therefore later rename or
deletion work needs a separately designed migration contract; it cannot be
assumed to happen automatically.

## Architecture decision

### Stable root facades are the public surface

Every existing path directly under `scripts/` remains stable. Existing package
commands, shell invocations, runtime string paths, test imports, managed paths,
and child imports continue to use their current paths.

A root file may currently be a mixed executable/library. That is accepted
technical debt. Future work may make a root file thinner by extracting one
coherent internal boundary, but it must preserve the root module's CLI behavior
and public exports.

No global `scripts/cli/` move is planned.

### Feature-first internals, introduced only by evidence

Internal directories are introduced only when a bounded extraction needs them.
The directional taxonomy is:

```text
scripts/
├── *.mjs / *.sh               # stable public CLI and import facades
├── agent-issue/               # existing feature package; unchanged by Slice 1
├── adapters/                  # generic external transports only
├── mission-control/           # future feature-local internals, separately approved
│   ├── domain/
│   ├── workflows/
│   └── diagnostics/
├── boilerplate/               # future feature-local internals, separately approved
├── guards/                    # future guard feature grouping, not a pure layer
├── tooling/                   # future build/typecheck/hook/baseline internals
└── shared/                    # future pure primitives with at least two consumers
```

Only `scripts/adapters/command-runner.mjs` is part of the first implementation
candidate. Every other prospective directory or extraction requires separate
evidence, scope, Founder approval, and exact-head review.

## Independent-review finding closure

| Finding                                  | Design correction                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR-I1 — incorrect classifications        | The responsibility map below classifies CAS as mixed domain/workflow/infrastructure, projection and brainstorming as deterministic policy, baseline capture as tooling, and `agent-issue/` as a mixed feature package.                                          |
| AR-I2 — cosmetic composition roots       | Existing root paths remain the composition/public surface; mixed executable libraries are not called thin merely because they run as commands.                                                                                                                  |
| AR-I3 — unspecified import compatibility | The CommandRunner root module remains a compatibility facade with the same two exports; no existing public import path is removed or renamed.                                                                                                                   |
| AR-I4 — incomplete delivery coverage     | The first candidate names every permitted runtime, manifest, and test path; package scripts, CI workflows, metadata, fixtures, and unrelated literal paths are explicitly prohibited. Simulated child delivery is required before any later migration proposal. |

## Corrected responsibility classification

This classification corrects findings AR-I1 through AR-I4. It is descriptive;
it does not authorize moving the listed files.

### Root commands and composition

- `agent-issue.mjs`, `bemoat-typecheck.mjs`, `build.mjs`,
  `check-branch-safety.sh`, `deploy-smoke-test.mjs`, and
  `install-git-hooks.mjs` have command/facade identity.
- `agent-delivery.mjs`, `check-boilerplate-drift.mjs`,
  `mission-control-dispatch.mjs`, `mission-control-merge.mjs`,
  `mission-control-reconcile.mjs`, `mission-control-review.mjs`,
  `post-role-comment.mjs`, and `sync-boilerplate.mjs` are executable but
  also contain orchestration or reusable exports. They are not declared thin
  composition roots merely because they are executable.
- All of these paths remain at the root. Future extraction may change internals,
  not public paths.

### Mission Control domain, workflows, and infrastructure

- `mission-control-state.mjs`, `correction-contract.mjs`,
  `pr-identity.mjs`, and `mission-control-brainstorming.mjs` are
  deterministic domain or policy modules.
- `mission-control-issue-body-cas.mjs` is mixed. Its hashing, lease payload,
  conflict classification, and memory-store behavior are domain/policy; its
  GitHub, filesystem, process, and write sequencing are adapter/workflow
  behavior. It must be split before any classification-based relocation.
- `github-comment-projection.mjs` is deterministic projection/policy and
  diagnostics, not an external adapter. Its dependency on
  `mission-control-reconcile.mjs` is part of the recorded cycle baseline.
- `capture-baseline.mjs` is an executable tooling utility with Git and
  filesystem I/O, not an application workflow.
- `command-runner.mjs` is a generic process adapter and is the only first-slice
  extraction candidate.

### Agent Issue package

The existing `scripts/agent-issue/` directory is a feature package, not an
adapter directory.

- External adapters: `process-runner.mjs`, `local-git-evidence.mjs`,
  `github-evidence.mjs`.
- Workflow/use-case modules: `issue-preflight.mjs`,
  `correction-preflight.mjs`, `correction-pr-reconciliation.mjs`,
  `progress-tracking.mjs`, `planning-no-pr-lineage.mjs`,
  `current-post-budget-authority.mjs`,
  `historical-review3-authority.mjs`.
- Pure policy/value helpers: `exact-head-ci.mjs`,
  `issue-references.mjs`, `pure-helpers.mjs`.
- Presentation/configuration: `cli-args.mjs`, `presentation.mjs`,
  `constants.mjs`.
- `issue-declarations.mjs` mixes filesystem access with pure parsing and must
  be split before a stricter classification is applied.

The directory remains unchanged in the first candidate.

### Guards

The twelve `guard-*.mjs` files are a useful feature family, not a pure
architectural layer. Current guard behavior legitimately uses filesystem and
process capabilities, and current edges include
`guard-build-script-contract -> build` and
`guard-mission-control-drift -> mission-control-reconcile`.

No guard file is moved or edited in the first candidate.

## Dependency rules

These rules apply immediately as design constraints. Automated enforcement is
specified in the implementation plan but is not authorized by this
design-correction pass.

1. Stable root facades may parse arguments and environment, construct concrete
   capabilities, call workflows, map diagnostics, and set exit behavior.
2. A root facade must not gain unrelated business policy. If a bounded change
   would add such policy, extract that policy behind the stable path.
3. Feature workflows may import feature-local domain/policy/diagnostic modules
   and pure `shared/` modules. Concrete I/O capabilities must be injected as
   function arguments rather than imported from `adapters/`.
4. Domain and policy code is deterministic. It must not import `node:fs`,
   `node:child_process`, network/GitHub clients, or read `process.*`. Time,
   randomness, and environment values must be passed in.
5. Adapters may import Node/external libraries and pure value/codec helpers.
   They must not import workflows, guards, root facades, or feature policy.
6. Guards are application use cases. A guard may use I/O, but pure validation
   rules should be separated when a concrete extraction benefits from it.
7. Cross-feature imports require an explicitly named public contract module.
   Importing another feature's executable facade as a reusable library is
   prohibited for new edges.
8. `shared/` must remain I/O-free and requires at least two real consumers.
9. No new dependency cycle is allowed, and the recorded cycle may not gain a
   node or internal edge.

## Dependency-cycle baseline and ratchet

At the trusted baseline there is exactly one multi-node strongly connected
component.

### Baseline nodes

```text
scripts/agent-issue.mjs
scripts/agent-issue/correction-pr-reconciliation.mjs
scripts/agent-issue/correction-preflight.mjs
scripts/agent-issue/github-evidence.mjs
scripts/agent-issue/historical-review3-authority.mjs
scripts/agent-issue/issue-preflight.mjs
scripts/agent-issue/progress-tracking.mjs
scripts/github-comment-projection.mjs
scripts/mission-control-reconcile.mjs
```

### Baseline internal edges

```text
scripts/agent-issue.mjs -> scripts/agent-issue/issue-preflight.mjs
scripts/agent-issue.mjs -> scripts/agent-issue/progress-tracking.mjs
scripts/agent-issue/correction-pr-reconciliation.mjs -> scripts/agent-issue/github-evidence.mjs
scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/correction-pr-reconciliation.mjs
scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/github-evidence.mjs
scripts/agent-issue/correction-preflight.mjs -> scripts/agent-issue/historical-review3-authority.mjs
scripts/agent-issue/correction-preflight.mjs -> scripts/mission-control-reconcile.mjs
scripts/agent-issue/github-evidence.mjs -> scripts/github-comment-projection.mjs
scripts/agent-issue/historical-review3-authority.mjs -> scripts/mission-control-reconcile.mjs
scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/correction-preflight.mjs
scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/github-evidence.mjs
scripts/agent-issue/issue-preflight.mjs -> scripts/agent-issue/progress-tracking.mjs
scripts/agent-issue/progress-tracking.mjs -> scripts/agent-issue/github-evidence.mjs
scripts/agent-issue/progress-tracking.mjs -> scripts/mission-control-reconcile.mjs
scripts/github-comment-projection.mjs -> scripts/mission-control-reconcile.mjs
scripts/mission-control-reconcile.mjs -> scripts/agent-issue.mjs
```

The architecture test must allow the baseline component to remain unchanged,
split, shrink, or lose edges. It must fail if:

- any new cyclic component appears;
- any node outside the baseline joins a cycle;
- any new internal edge is added to a cyclic component; or
- two previously separate components become cyclically connected.

The first candidate must leave this baseline unchanged.

## Additive path and child-sync contract

The first candidate uses an additive implementation path:

```text
scripts/command-runner.mjs
  stable compatibility facade
        |
        v
scripts/adapters/command-runner.mjs
  CommandRunner implementation
```

The existing root module continues to export
`createCommandRunner` and `runCommand`. Existing imports remain valid.
`mission-control-review.mjs` is the only production consumer permitted to
import the new internal path.

Both paths must remain in `managedPaths` and in
`.bemoat/boilerplate-sync-manifest.json`. The old path is not removed,
renamed, or repurposed.

A simulated representative harness-only child sync must prove, before any
future rename or deletion is considered, that:

- an old child receives the new nested adapter in one sync;
- the stable root facade remains present and importable;
- the review command resolves the nested implementation;
- both exported managed-path lists are identical;
- child-owned files remain byte-for-byte unchanged; and
- no package command or CI workflow path changes.

No actual child sync is part of the first candidate.

Later deletion or rename work is outside this design. It requires a separate
Founder-approved design that defines stale-path removal, package-script
migration, backward compatibility duration, rollback, and child validation.

## First implementation candidate

The candidate is one CommandRunner boundary extraction only.

### Exact allowed files

1. `scripts/adapters/command-runner.mjs` (new)
2. `scripts/command-runner.mjs`
3. `scripts/mission-control-review.mjs`
4. `scripts/sync-boilerplate.mjs`
5. `.bemoat/boilerplate-sync-manifest.json`
6. `tests/int/command-runner.int.spec.ts`
7. `tests/int/mission-control-review.int.spec.ts`
8. `tests/int/boilerplate-sync.int.spec.ts`
9. `tests/int/scripts-architecture.int.spec.ts` (new)

No implementation file outside this list is permitted. The design and plan
documents belong to this correction pass and are not part of the future
implementation diff.

### Exact prohibited files and actions

- `package.json`, `pnpm-lock.yaml`, `.github/workflows/**`,
  `.githooks/**`, and `.bemoat-boilerplate-sync.json`;
- `scripts/pr-identity.mjs`, `scripts/correction-contract.mjs`,
  `scripts/mission-control-state.mjs`,
  `scripts/mission-control-issue-body-cas.mjs`,
  `scripts/agent-issue/**`, and every `scripts/guard-*.mjs`;
- every other root entrypoint, test, fixture, pinned snapshot, source module,
  application file, Cloudflare file, Payload file, and migration;
- deleting or renaming any path;
- changing any package command or GitHub Actions workflow;
- executing a child sync;
- changing Mission Control states, workflow semantics, diagnostics, CLI
  arguments, stdout/stderr behavior, or exit behavior.

Any need to touch a prohibited path stops the candidate and returns to Founder
decision.

## Verification contract for the future candidate

Focused verification:

```bash
pnpm exec vitest run \
  tests/int/command-runner.int.spec.ts \
  tests/int/mission-control-review.int.spec.ts \
  tests/int/mission-control-review-cli.int.spec.ts \
  tests/int/boilerplate-sync.int.spec.ts \
  tests/int/scripts-architecture.int.spec.ts
```

Full local gates:

```bash
pnpm run guard:safety
pnpm run check
git diff --check
```

GitHub gates:

- exact-head `CI` passes;
- exact-head `CI (starter strict)` passes;
- semantic review confirms only the nine allowed paths changed;
- child-sync test proves additive delivery without touching a real child.

No implementation commit, implementation push, implementation PR,
architecture guard implementation, or child sync is authorized by this
design-correction pass. The two docs-only correction artifacts may be committed
and published for durable Founder review.

## Context-cost evidence policy

### Measured evidence

Lines, bytes, file counts, import edges, fan-in, and static dependency closures
reported in this document were computed from the trusted baseline. Exact-base
GitHub CI also passed.

### Estimates

The previous `bytes / 4` conversion is an approximate token estimate. The
1,801-byte path listing is approximately 451 tokens by that estimate.
No measured model token usage or before/after task corpus supports a 60–80%
reduction claim.

The first candidate is expected to have negligible context-cost effect because
it preserves content and changes one import boundary. Its value is proving the
migration and dependency contracts safely.

### Required future measurement

Before scaling beyond CommandRunner, freeze at least five representative
historical maintenance tasks. For identical prompts and retrieval rules, record:

- files opened before the first correct edit;
- exact bytes and tokenizer-counted input tokens loaded;
- static transitive files, lines, bytes, and import edges;
- tool calls and elapsed time;
- focused and exact-head semantic pass/fail outcomes.

Report the median before/after change and raw per-task values. A percentage
claim is retained only if this corpus measures it.

## Decision gates

1. This correction pass may write and durably publish only this design and its
   implementation plan.
2. A separate Founder decision is required before the CommandRunner candidate
   may begin.
3. A successful CommandRunner candidate does not authorize another extraction.
4. Any later rename, deletion, child sync, cycle-reduction slice, or folder
   creation beyond `scripts/adapters/` requires its own approved scope.
