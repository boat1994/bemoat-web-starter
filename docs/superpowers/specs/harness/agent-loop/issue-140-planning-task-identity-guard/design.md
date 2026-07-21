# Issue #140 Planning Task-Identity and Execution-Base Validation Specification

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

## Executive Summary

Issue #140 identifies a critical gap in multi-stage and Subagent-Driven Development (SDD) planning workflows: AI agents and human contributors can mistakenly reuse closed or terminal task issues (such as closed Task 10 Issue `#169`), reference mismatched issue numbers across spec and plan documents, generate branches from out-of-date planning-time SHAs instead of resolving the live protected base at dispatch, or create dedicated issues that hardcode conflicting existing numbers.

This specification defines the authoritative repository-owned design for deterministic planning task-identity and execution-base validation in `boat1994/bemoat-web-starter`.

## Architecture Decisions (Locked)

### 1. Canonical Contract Location and Versioned Schema
The canonical task identity is declared inside an explicit, machine-readable YAML marker block embedded directly in planning markdown documents:
`<!-- bemoat-task-identity:start -->` to `<!-- bemoat-task-identity:end -->`.
The schema (`schema_version: 1`) strictly defines:
- `schema_version`: integer (must be `1`).
- `main_issue`: string reference (`#106` or `owner/repo#106`) or `null` for standalone tasks.
- `task_key`: unique string identifier (`task-11`, `slice-a-task-1`, or `issue-140`).
- `task_issue_strategy`: enum string (`existing_dedicated_issue` or `create_before_execution`).
- `active_task_issue`: string reference (`#169`) when `existing_dedicated_issue`, or `null` when `create_before_execution`.
- `branch_template`: string representing expected branch prefix/pattern (`feature/169-task-11-slug`).
- `transition_target`: string representing expected terminal state or target issue transition (`DONE`, `AWAITING_REVIEW_1`, or `#169`).
- `planning_base_sha`: 40-character hex SHA representing the exact protected head when the plan was authored (`2489c7bf6d10ad8c2a724a7920bd83350102ee03`).
- `execution_base_rule`: string representing how the branch base is resolved at execution dispatch (`resolve_live_protected_base_at_dispatch`).
- `paired_spec`: relative path to the paired specification file.
- `paired_plan`: relative path to the paired implementation plan file.

### 2. Spec, Plan, and Contract Pairing
Spec and plan documents are explicitly paired via `paired_spec` and `paired_plan` inside the `<!-- bemoat-task-identity:start -->` block. When either document is evaluated by static guards or agent preflight, the validator loads both files, extracts both marker blocks, and verifies 100% field equality across all identity properties.

### 3. Static Deterministic Validation Behavior
Implemented in `scripts/guard-planning-contract.mjs` and registered in `GUARD_PACK` (`scripts/guard-pack.mjs`). Static validation runs without network access and rejects:
- Missing required fields or `schema_version !== 1`.
- Field mismatches across paired spec and plan documents (`PLAN002`).
- Branch naming templates (`branch_template`) tied to another task key or completed/unrelated issue number (`PLAN003`).
- Future transition instructions (`transition_target`) that target a terminal status (`DONE`, `MERGED`, `CLOSED`) while modifying or closing an already terminal issue (`PLAN004`).
- `create_before_execution` strategy when `active_task_issue` is populated with a concrete number (`PLAN005`).
- Missing or invalid `task_issue_strategy` (`PLAN006`).
- Executable branch creation that unconditionally uses `planning_base_sha` instead of resolving the live protected base (`PLAN007`).

### 4. Authenticated Live GitHub Verification Behavior
During `pnpm run bemoat:agent:issue -- <issue-number>` preflight (`scripts/agent-issue.mjs`), when `task_issue_strategy === "existing_dedicated_issue"` and `active_task_issue` is present, if authenticated GitHub CLI access (`gh`) is available, the preflight live-verifies:
- Issue exists in the target repository (`PLAN008`).
- Issue state is `OPEN` (not `CLOSED` or terminal `DONE`) (`PLAN008`).
- Issue title/body identifies the intended `task_key` (`PLAN009`).
- Issue body has compatible `Mission Control state` metadata (e.g. if `mission_control_mode: required`, state must not be `DONE` and `active_task_issue` matches) (`PLAN010`).
When `task_issue_strategy === "create_before_execution"`, preflight verifies no concrete active issue exists yet and blocks execution launch until the dedicated issue is created and `active_task_issue` is updated.

### 5. Behavior When GitHub Authentication is Unavailable
If `gh` CLI is unauthenticated or offline:
- Static validation (`pnpm run guard:safety`) completes fully and verifies all static rules and pairing contracts without failure.
- Live verification (`agent-issue.mjs`) reports a clear warning indicating live issue checks were skipped due to unavailable GitHub authentication. However, if `pnpm run bemoat:agent:issue -- <issue-number>` is invoked to start active implementation on an `existing_dedicated_issue`, and live metadata cannot be verified, preflight fails closed with guidance to run `gh auth login`.

### 6. Applicability Rule for New, Modified, and Legacy Planning Packages
- Only new or modified planning files (`docs/superpowers/specs/**` or `docs/superpowers/plans/**` changed in git working tree/staged/branch diff compared to `approved_base`) are required to contain valid `<!-- bemoat-task-identity:start -->` blocks.
- Legacy planning packages existing on `main` untouched by the PR are skipped during default guard runs, preventing backward incompatibility.

### 7. Historical vs. Executable Reference Treatment
- **Executable references**: Any issue number inside `<!-- bemoat-task-identity:start -->`, active `<!-- bemoat-mission-control-state:start -->` blocks, or form declarations (`Active Task Issue:`). Must be open, non-terminal, and match task identity.
- **Historical references**: Any issue number in prose, `Durable Progress` checklists (`- [x] Task 10 completed (#169)`), comments, or changelogs outside executable contract blocks. These are treated as historical evidence and are never rejected even if `#169` is closed `DONE`.

### 8. Structured Diagnostic Format
All violations output by `guard-planning-contract.mjs` and `agent-issue.mjs` follow the strict format:
`- [RuleID] FilePath: Message. Found: <value>. Reason: <reason>. Corrective action: <action>`
Diagnostic codes:
- `PLAN001`: Missing or malformed `<!-- bemoat-task-identity:start -->` block or `schema_version`.
- `PLAN002`: Paired spec and plan field mismatch.
- `PLAN003`: Branch template mismatch with task key or issue reference.
- `PLAN004`: Terminal transition target conflict.
- `PLAN005`: Concrete active issue declared under `create_before_execution` strategy.
- `PLAN006`: Missing or invalid `task_issue_strategy`.
- `PLAN007`: Unconditional planning-time SHA execution base rule.
- `PLAN008`: Live GitHub issue verification failure (not found, repository mismatch, or closed `DONE`).
- `PLAN009`: Live issue semantic `task_key` mismatch.
- `PLAN010`: Incompatible live Mission Control managed state.

### 9. Repository Ownership vs. External Superpowers Boundary
This repository (`boat1994/bemoat-web-starter`) owns the validation scripts (`scripts/guard-planning-contract.mjs`, `scripts/agent-issue.mjs`, `GUARD_PACK`) and manifest (`.bemoat/boilerplate-sync-manifest.json`).
We do not modify external Superpowers plugin files outside this repo. Instead, we deliver `docs/agent-loop/superpowers-planning-contract-recommendation.md` containing exact instructions for external plugin maintainers to emit `<!-- bemoat-task-identity:start -->` blocks during skill execution.

### 10. Child Synchronization Impact
- `scripts/guard-planning-contract.mjs` is added to `managedPaths` in `.bemoat/boilerplate-sync-manifest.json`.
- When child projects run `pnpm run bemoat:boilerplate:sync -- --harness-only`, they receive the new guard and `GUARD_PACK` update.
- Because `guard-planning-contract.mjs` checks only newly modified/added planning files, existing child project plans and `FAST`, `STANDARD`, and `MANAGED` workflows continue passing without required manual migration. No child rollout or sync is executed in this task.

## Acceptance Criteria Mapping
All 14 required regression and boundary cases are covered by explicit fixtures and integration tests in `tests/int/guard-planning-contract.int.spec.ts`.
