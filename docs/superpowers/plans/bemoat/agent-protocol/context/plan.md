<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-410-context"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#410"
branch_template: "feature/410-refactor-agent-protocol-replace-stateful-mission"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "2d9ee92d171097042eed0caa32a2057139233e0d"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/bemoat/agent-protocol/context/design.md"
paired_plan: "docs/superpowers/plans/bemoat/agent-protocol/context/plan.md"
```
<!-- bemoat-task-identity:end -->

# Bemoat Context Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and verify the read-only deterministic `bemoat:context` command for Issue #410.

**Architecture:** A neutral evidence adapter normalizes Git/GitHub/policy/Issue/PR data; a pure router maps that model to one closed route. The CLI entrypoint only wires read operations, help discovery, deterministic serialization, and exit behavior.

**Tech Stack:** Node ESM, TypeScript modules loaded through the repository’s existing script conventions, Vitest, `gh`, and native Git commands.

**Spec:** `docs/superpowers/specs/bemoat/agent-protocol/context/design.md`

## Global Constraints

- Implement only `bemoat:context`; do not implement `bemoat:handoff` or legacy cleanup.
- Do not import `scripts/mission-control/**` from the context domain or create protocol persistence.
- Route selection must be pure over normalized evidence and limited to `IMPLEMENT`, `VERIFY`, `FIX`, `REVIEW`, `FOUNDER_GATE`, `COMPLETE`, and `STOP`.
- All required missing, contradictory, ambiguous, dirty, detached, unpushed, or local-only evidence fails closed.
- The command must not write GitHub, Git, branches, PRs, Issues, files, caches, journals, databases, receipts, leases, or state.
- Preserve Issue #333, PR #366, Issue #405, repository rulesets, production, deployment, and migration boundaries.

---

### Task 1: Establish pure context model, parser, and router tests

**Files:**
- Create: `scripts/context/model.ts`
- Create: `scripts/context/issue-parser.ts`
- Create: `scripts/context/router.ts`
- Test: `tests/int/context-router.int.spec.ts`
- Test: `tests/int/context-parser.int.spec.ts`

**Interfaces:**
- `ContextRoute = 'IMPLEMENT' | 'VERIFY' | 'FIX' | 'REVIEW' | 'FOUNDER_GATE' | 'COMPLETE' | 'STOP'`.
- `normalizeContextEvidence(input): NormalizedContextEvidence` validates and freezes the model.
- `parseIssueBody(body): { objective: string|null; scope: string|null; acceptanceCriteria: string[]; dependencies: string[] }`.
- `routeContext(evidence): ContextDecision` is pure and has no I/O.

- [x] **Step 1: Write failing parser and router tests** covering the Issue #410 body shape, exact route ordering, failed/pending/successful checks, merged completion, missing evidence, competing PRs, and `LOCAL_STATE_NOT_DURABLE`.
- [x] **Step 2: Run the focused tests and confirm they fail because the context modules do not exist.**

  Run: `pnpm exec vitest run --config ./vitest.config.mts tests/int/context-router.int.spec.ts tests/int/context-parser.int.spec.ts`

- [x] **Step 3: Implement the minimal typed evidence model, deterministic Markdown section parser, and pure route function.** The router must return reasons, one next action, and evidence URLs without consulting comments, files, environment, or prior results.
- [x] **Step 4: Re-run the focused tests and confirm green.**
- [x] **Step 5: Review the model for stable key/array ordering and absence of Mission Control imports.**

### Task 2: Add neutral read-only Git/GitHub evidence adapters

**Files:**
- Create: `scripts/context/evidence.ts`
- Create: `scripts/context/policy.ts`
- Create: `scripts/context/github.ts`
- Create: `scripts/context/local-git.ts`
- Test: `tests/int/context-evidence.int.spec.ts`

**Interfaces:**
- `collectContextEvidence({ cwd, issueNumber, env, run }): Promise<NormalizedContextEvidence>`.
- `readLocalGitEvidence({ cwd, run }): LocalGitEvidence`.
- `readGithubEvidence({ repo, issueNumber, run }): GithubEvidence`.
- `readProtectedPolicy({ repo, baseBranch, run }): PolicyEvidence`.

- [x] **Step 1: Write failing adapter tests with an injected runner** for repository identity, protected-base SHA, policy frontmatter/blob identity, Issue fields, PR resolution, exact-head checks/reviews, and local branch/upstream/visibility.
- [x] **Step 2: Run the adapter test file and confirm failures are caused by missing adapters, not fixture mistakes.**
- [x] **Step 3: Implement only read commands:** `git status`, `git branch`, `git rev-parse`, `git remote`, `git ls-remote`; `gh api`, `gh issue view`, and `gh pr view/list`. Do not expose a generic write-capable adapter.
- [x] **Step 4: Normalize malformed command output and unavailable commands into explicit evidence errors.**
- [x] **Step 5: Re-run focused evidence tests and confirm green.**
- [x] **Step 6: Run `rg -n "scripts/mission-control" scripts/context` and confirm no context-domain import exists.**

### Task 3: Add public CLI entrypoint and registry contract

**Files:**
- Create: `scripts/agent-context.mjs`
- Modify: `package.json`
- Modify: `scripts/cli/command-contract-registry.ts`
- Test: `tests/int/context-cli.int.spec.ts`
- Modify: `tests/int/cli-command-registry.int.spec.ts` only for exact package/registry inventory expectations.

**Interfaces:**
- Public invocation: `pnpm run bemoat:context -- <issue-number> [--json]`.
- Direct entrypoint: `node scripts/agent-context.mjs <issue-number> [--json]`.
- Help invocation: `pnpm run bemoat:context -- --help --json`.

- [x] **Step 1: Add failing CLI tests** for machine-readable help, invalid invocation, deterministic JSON route output, and normal text output.
- [x] **Step 2: Run the CLI tests and confirm failure because the package command and entrypoint are absent.**
- [x] **Step 3: Register the exact Tier B contract** with positive Issue input, optional JSON flag, read-only writes, STOP classifications, and no Mission Control transport role.
- [x] **Step 4: Implement the thin entrypoint using the existing invocation/help boundary and `collectContextEvidence`; keep output serialization deterministic.**
- [x] **Step 5: Re-run CLI and registry tests and confirm green.**

### Task 4: Prove no mutation and fail-closed boundaries

**Files:**
- Modify: `tests/helpers/cli-boundary-harness.ts` only if a context-specific read-command fixture is required.
- Test: `tests/int/context-cli.int.spec.ts`
- Test: `tests/int/context-evidence.int.spec.ts`

- [x] **Step 1: Add failing before/after filesystem and poisoned-executable tests** covering GitHub comment/Issue/PR writes, Git commit/push/reset/switch/branch creation, protocol files, caches, and databases.
- [x] **Step 2: Run the tests and confirm they fail until the entrypoint is wired and the harness recognizes the command.**
- [x] **Step 3: Implement the smallest adapter/entrypoint changes needed to keep all operations read-only.**
- [x] **Step 4: Add dirty, detached, unpushed, local-only, missing policy, wrong repository, exact-head mismatch, failed CI, pending CI, ambiguous PR, and contradictory Issue/PR tests.**
- [x] **Step 5: Run focused context tests, then `pnpm run bemoat:context -- --help --json` and `git diff --check`.**

### Task 5: Run repository validation and prepare delivery evidence

- [x] **Step 1: Run `pnpm run guard:safety`.**
- [x] **Step 2: Run `pnpm run lint`.**
- [x] **Step 3: Run `pnpm run typecheck`.**
- [x] **Step 4: Run `pnpm run test:int`.**
- [x] **Step 5: Re-run the focused context suite and inspect `git status --short` plus `git diff --stat`.**
- [x] **Step 6: Audit Issue #410 acceptance criteria for only the context slice; do not claim handoff or legacy-removal criteria complete.**
- [ ] **Step 7: Commit exactly one focused change, push the topic branch, and open/update one PR only if live policy and validation permit.**
