# Superpowers planning contract recommendation (external maintainers)

This document is the canonical handoff for **external** Superpowers plugin and skill maintainers. The Bemoat harness in `bemoat-web-starter` validates planning artifacts with `scripts/guards/planning-contract-runtime.ts` and `scripts/guards/planning-contract.ts`; this repository does not patch upstream Superpowers plugin files directly.

## Goal

When Superpowers skills emit planning markdown, they should embed a versioned task-identity block so Bemoat child projects can statically validate paired spec/plan documents and block closed-issue reuse before implementation starts.

## When to emit the block

Emit the block in both paired outputs:

| Skill | Output file | Typical path |
|-------|-------------|--------------|
| `brainstorming` | Design spec | `docs/superpowers/specs/{project}/{initiative}/{feature}/design.md` |
| `writing-plans` | Implementation plan | `docs/superpowers/plans/{project}/{initiative}/{feature}/implementation-plan.md` |

Emit the block **once per file**, near the top of the document (after the title is fine). Both files must declare **identical** identity fields.

## Required marker format

Use exactly one balanced HTML comment pair. YAML may be wrapped in a fenced `yaml` code block inside the markers:

```markdown
<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: "#106"
task_key: "task-11"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#170"
branch_template: "feature/170-task-11-slug"
transition_target: "DONE"
planning_base_sha: "abcdef0123456789abcdef0123456789abcdef01"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/{project}/{initiative}/{feature}/design.md"
paired_plan: "docs/superpowers/plans/{project}/{initiative}/{feature}/implementation-plan.md"
```
<!-- bemoat-task-identity:end -->
```

### Field guidance

| Field | Recommendation |
|-------|----------------|
| `schema_version` | Always `1` until a new schema is published by Bemoat |
| `main_issue` | Parent epic (`#106` or `owner/repo#106`), or `null` when standalone |
| `task_key` | Stable slug such as `task-11` or `issue-140`; must appear in the dedicated task issue title/body when using `existing_dedicated_issue` |
| `task_issue_strategy` | `existing_dedicated_issue` when the task issue already exists; `create_before_execution` when implementation must create it first |
| `active_task_issue` | Concrete `#NNN` for `existing_dedicated_issue`; `null` for `create_before_execution` until the issue exists |
| `branch_template` | Branch prefix that includes the active task issue number (for example `feature/170-task-11-slug`) |
| `transition_target` | Expected terminal handoff (`DONE`, `MERGED`, `CLOSED`) or explicit issue reference |
| `planning_base_sha` | 40-character git SHA of the protected head at planning time (provenance only) |
| `execution_base_rule` | Always `resolve_live_protected_base_at_dispatch` — never `use_planning_base_sha_unconditionally` |
| `paired_spec` / `paired_plan` | Repo-relative paths to the paired design and implementation plan files |

## Pairing rules

1. `paired_spec` and `paired_plan` must point to the two files in the same planning package.
2. Every identity field except the paired path fields themselves must match byte-for-byte across spec and plan.
3. Do not emit conflicting `active_task_issue` values between design and plan (`PLAN002`).

## Strategy-specific behavior

### `existing_dedicated_issue`

- Set `active_task_issue` to the open dedicated GitHub issue for this task.
- Do not reference closed or terminal issues as the active task issue.
- Ensure the issue title or body contains `task_key`.

### `create_before_execution`

- Set `active_task_issue: null` during planning.
- After the dedicated issue is created, update **both** paired files to `existing_dedicated_issue` with the new issue number before implementation dispatch.

## Historical vs executable issue references

**Executable** (must be open and consistent):

- Values inside `<!-- bemoat-task-identity:start -->`
- Active `<!-- bemoat-mission-control-state:start -->` blocks on the task issue
- Form fields such as `Active Task Issue:`

**Historical** (allowed even when closed):

- Prose mentions of prior tasks
- `Durable Progress` checklist lines such as `- [x] Task 10 (#169)`

Do not move historical references into the task-identity block to "fix" closed-issue mentions.

## Validation surface in Bemoat

| Command | What is checked |
|---------|-----------------|
| `pnpm run guard:safety` / `pnpm run bemoat:guard:safety` | Static rules `PLAN001`–`PLAN007` on new or modified planning files |
| `pnpm run bemoat:context <issue>` | Read-only Context reconstruction; static planning rules remain in the safety guard |

Full diagnostic reference: [guard-pack.md](../guard-pack.md#planning-contract).

## Child project rollout

Child repositories receive the guard through harness sync:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

No retroactive migration is required for untouched legacy plans. New or edited planning packages should include the marker block from the first authoring pass.

## Maintainer checklist

- [ ] `brainstorming` emits `<!-- bemoat-task-identity:start -->` in `design.md`
- [ ] `writing-plans` emits the same identity values in `implementation-plan.md`
- [ ] `execution_base_rule` is `resolve_live_protected_base_at_dispatch`
- [ ] `paired_spec` and `paired_plan` use correct repo-relative paths
- [ ] Historical closed issues stay in prose/checklists, not in `active_task_issue`
