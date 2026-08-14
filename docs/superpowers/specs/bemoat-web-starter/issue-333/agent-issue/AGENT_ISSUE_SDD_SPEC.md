# Agent-issue Cluster A TypeScript migration characterization

<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: "#333"
task_key: "issue-333-agent-issue-cluster-a"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#333"
branch_template: "refactor/333-cursor-agent-issue-batch-1"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "852bc07b4a4f5b301a603c9fb19e5d956b0bb0a4"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat-web-starter/issue-333/agent-issue/AGENT_ISSUE_SDD_SPEC.md"
paired_plan: null
```
<!-- bemoat-task-identity:end -->

Issue #333 Cluster A. Behavior-preserving port of pure/deterministic agent-issue
modules from `.mjs` to authoritative `.ts` with logic-free facades.

## Modules

| Legacy | Authoritative TS | Facade |
| --- | --- | --- |
| `constants.mjs` | `constants.ts` | `export * from './constants.ts'` |
| `pure-helpers.mjs` | `pure-helpers.ts` | `export * from './pure-helpers.ts'` |
| `issue-references.mjs` | `issue-references.ts` | `export * from './issue-references.ts'` |
| `exact-head-ci.mjs` | `exact-head-ci.ts` | `export * from './exact-head-ci.ts'` |

## Characterization contract

### issue-references

- Unwrap managed-state quoted layers (`'"#226"'` → `#226`).
- Reject unsafe integers (`9007199254740993`), `0`, leading-zero strings (`01`).
- Non-string objects → `null`.
- Positive safe integer number inputs resolve with `defaultRepo`.
- `parsePrReference('#N')` returns `{ number: 'N' }` without `repo`.

### exact-head-ci

- `null` PR → unavailable summary.
- Missing `headRefOid` → head could not be determined.
- Empty checks array → available but not verified; `olderShaSuccess: false`.
- Production array rollup vs `{ contexts: [...] }` rollup shapes.
- `FAILURE` / `CANCELLED` conclusions → failed summary.
- Older successful SHA without head match → `olderShaSuccess: true`.
- `ciSha` extracted from successful check `description` hash when present.
- Non-string truthy `headRefOid` with checks → native `TypeError` on `.slice`.

### pure-helpers

- `slugify` on non-string → native `TypeError`.
- `stripFencedCodeBlocks` removes fenced regions.
- `assignDeclarationValue` ignores `none` / `None` prefixes.
- `buildSuggestedBranchName` returns `null` when slug is empty.

### constants

- `docsToRead` is exactly four canonical agent-loop paths.

## Shared integration

- `tsconfig.harness-strict.json` includes `scripts/agent-issue/**/*.ts`.

## Out of scope (Cluster A)

- Zod validation (no genuine trust boundaries in these modules).
- `correction-preflight`, authority modules, orchestration entrypoints, manifests.
