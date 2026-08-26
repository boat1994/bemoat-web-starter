# Bemoat agent loop

This folder is the operating manual for coding agents working on Bemoat web projects.

## Source of truth

**`bemoat-web-starter` is the source of truth for reusable Bemoat web project infrastructure.**

That includes shared Payload collections and globals, starter pages, helper utilities, agent rules, GitHub templates, CI patterns, and the `boilerplate:sync` behavior documented in the root README.

## How real projects are created

The default path for a **real Bemoat project** is **deploy-first**:

1. Use the **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)** button in the root README.
2. Let Cloudflare create or connect the project and its Cloudflare resources (Worker, D1, R2, secrets).
3. Clone the **generated child project** locally—not this starter repo directly.
4. Run install, generate import map, generate types, create migrations as needed, then dev and deploy.

Cloning `bemoat-web-starter` directly is only for **developing the starter itself**, not for starting a customer or product repo.

## Updating existing child projects

After a child project exists, pull reusable improvements from this starter with:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

Use raw `pnpm run boilerplate:sync -- --harness-only` only when that child
defines the non-namespaced alias.

Sync updates managed boilerplate paths, including agent rules (`AGENTS.md`, `.agents`, `.cursor/rules`), GitHub workflow rails (`.github/workflows/ci.yml`, PR and issue templates), `docs/agent-loop`, harness scripts (`guard-repo-safety`, `guard-cloudflare-env`, `install-git-hooks`, sync/drift/smoke), optional `.githooks`, harness integration tests, and the sync script itself.

Sync also merges **`.gitignore`**: child ignore rules are kept and missing starter rules are appended. It adds missing **`bemoat:*` scripts** when absent and writes **`.bemoat/package-sync-proposal.md`** with recommended non-namespaced scripts and dependencies for human review.

It does **not** overwrite project-specific infrastructure (`wrangler.jsonc`, D1 IDs, R2 bucket names, Worker names, `.env`, secrets), root `README.md` (unless you later add it to managed paths), `pnpm-lock.yaml`, or project-specific business modules. See [source-of-truth.md](./source-of-truth.md) and [harness-sync-contract.md](../harness-sync-contract.md).

For the canonical **child harness sync loop** (branch gates, sync command, validation, PR, report), see [harness-sync-workflow.md](./harness-sync-workflow.md).

For a step-by-step harness migration in child repos (audit mode, sync mode, PR conventions, rollback), use the [Child project migration guide](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/child-project-migration-guide.md) (starter-only).

## Task-only prompts

Before selecting or running any registered `bemoat:*` command, follow the
canonical [Bemoat CLI Discovery](../../AGENTS.md#bemoat-cli-discovery) rule.
Discovery of `--help --json` precedes command execution.

Users do not need to repeat branch, check, commit, push, or PR steps in every message. Provide the task (or a GitHub issue); agents read `AGENTS.md` and this folder, then run the [Default Agent Workflow](../../AGENTS.md#default-agent-workflow) automatically unless you override it.

For issue-based work, agents pause once after branch setup and a passing issue
preflight: they summarize the issue goal, intended scope, out-of-scope work,
files or areas to inspect, expected validation, and notable risks or
assumptions. They must wait for an explicit human trigger such as `proceed`,
`continue`, `start dev`, `เริ่มได้`, or `dev ได้` before editing files.

After that trigger, agents **must complete the applicable branch-to-PR workflow** by default — implement, check, commit, push, audit acceptance criteria, open PR, and, when required by the workflow profile or an applicable review gate, publish a HANDOFF on the source issue with `bemoat:handoff` — without stopping after implementation or asking permission to commit/push/open PR/comment. FAST work without an applicable review or handoff gate may omit HANDOFF and REVIEW_VERDICT. See [GitHub Workflow](../../AGENTS.md#github-workflow) and [Handoff Protocol](../../AGENTS.md#handoff-protocol) for stop conditions.

## High-level loop

```text
task → read AGENTS.md + agent-loop → git status & issue branch → intent checkpoint → human trigger → edit → test → show diff → commit → push → AC audit → open or update PR → publish applicable HANDOFF → notify user
                                                                                                                                                                      ↓
                                                                                                                                                CI → review → merge (human only)
```

| Step | What happens |
|------|----------------|
| **Task** | User gives a short prompt or GitHub issue. Scope, allowed files, and risks may also live in the [agent-task](../../.github/ISSUE_TEMPLATE/agent-task.yml) template. |
| **Branch gates** | `git status`; stop if dirty; never work on `main` or routine-code on `dev`; if the only blocker is a clean protected or integration branch, create `<type>/<issue-number>-<short-slug>` and rerun issue preflight. See [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md) and [Git Flow guardrails](../workflow/git-flow.md). |
| **Branch** | Short-lived dedicated issue branch from `dev`; use the safest protected baseline only while the repo has no `dev` branch. Naming convention documented in [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md). |
| **Intent checkpoint** | After branch setup and a passing issue preflight, summarize issue goal, intended scope, out-of-scope work, files or areas to inspect, expected validation, and risks or assumptions. Wait for an explicit human trigger before editing. |
| **Edit** | Follow `AGENTS.md`, allowed paths, and [checklist.md](./checklist.md). Smallest complete change. |
| **Test** | Run the validation tier from `AGENTS.md`. In the starter, use the raw starter scripts such as `guard:safety` / `check`; in child projects, default to `bemoat:*` harness scripts and child-owned code checks. |
| **Show diff** | `git status` and diff summary before commit. |
| **Commit** | One focused commit only if checks pass and only allowed files changed. See commit safety in `AGENTS.md`. |
| **Push** | Push the branch to origin. |
| **AC audit** | Before PR creation/update and final reporting, copy or summarize the source issue acceptance criteria. Mark each item `Done`, `Not done`, `Not applicable`, or `Waiting for CI / human review`, and include brief evidence for completed items. Do not routinely edit the Issue checklist from Dev work; Mission Control pre-merge reconciliation follows [role-handoff-contract.md](./role-handoff-contract.md#pre-merge-checklist-reconciliation-gate). |
| **Open PR** | Open a new PR or **update the existing PR** if the branch already has one. Fill out the [pull request template](../../.github/pull_request_template.md). Include `Closes #<issue-number>`, summary, test plan, acceptance criteria audit, risks, and human-review notes. **Migration PRs:** draft only — see [migration-draft-pr.md](./migration-draft-pr.md). |
| **Publish HANDOFF** | For profiles or review gates that require cross-agent coordination, publish the final protocol record using `bemoat:handoff` (with appropriate route). FAST work without an applicable review or handoff gate may omit HANDOFF and REVIEW_VERDICT. See [Handoff Protocol](../../AGENTS.md#handoff-protocol). |
| **Notify user** | Task summary, branch, files changed, commands run, test result, commit hash, PR URL, risks, and human-review items. |
| **CI** | GitHub Actions must pass; inspect logs on failure—do not guess. |
| **Review** | Human or reviewer agent; watch Payload, migration, Cloudflare, sync risks. |
| **Merge** | **Human only.** Agents must not merge. Prefer the starter or child-local full check when defined and practical. |

## Artifacts in this folder

| File | Purpose |
|------|---------|
| [starter-reading-order.md](./starter-reading-order.md) | Ordered docs for new tasks (operating manual → migration → ADRs → KB → guards → acceptance) |
| [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md) | Issue branch gates, naming, PR open/update, harness sync closeout |
| [project-progress-tracking.md](./project-progress-tracking.md) | Main Issue durable progress, Plan boundaries, exact-head CI, resume protocol |
| [role-handoff-contract.md](./role-handoff-contract.md) | Compact-delta GitHub handoff comments (HANDOFF, RESULT, REVIEW_VERDICT) + pre-merge checklist reconciliation |
| [Mission Control guide](../mission-control/mission-control-guide.md) | Canonical review-budget, durable state, completion, and MC verdict policy (thin loader: `prompts/mission-control/chatgpt-project-loader.md`) |
| [self-red-team-scope-gate.md](./self-red-team-scope-gate.md) | Optional scope gate for material planning, specification expansion, and High Reasoning passes |
| [self-red-team-scope-gate-prompt.md](./self-red-team-scope-gate-prompt.md) | Copy/paste prompt for one constrained self red-team pass |
| [harness-sync-workflow.md](./harness-sync-workflow.md) | Child project harness sync loop after starter merge |
| [composer-issue-workflow-prompt.md](./composer-issue-workflow-prompt.md) | Paste-ready Composer/Codex prompt for issue → PR workflow |
| [operating-manual.md](./operating-manual.md) | v1 execution manual — model roles, loop, prompt seed, stop rules |
| [state-template.md](./state-template.md) | Session handoff between agents |
| [roles.md](./roles.md) | Builder, Reviewer, Migration, Red Team, GitHub Triage |
| [security-and-migrations.md](./security-and-migrations.md) | Secrets, guards, production deploy gates |
| [migration-draft-pr.md](./migration-draft-pr.md) | Draft PR workflow for D1/Payload migrations |
| [checklist.md](./checklist.md) | Before/during/PR/CI/merge checklists |
| [source-of-truth.md](./source-of-truth.md) | What lives in starter vs child projects |
| [../workflow/git-flow.md](../workflow/git-flow.md) | Git Flow branch roles, topic branch rules, hooks, and branch protection checklist |
| [../hardening.md](../hardening.md) | Production hardening index (releases, drift check, smoke test, secrets, branch protection) |
| [Knowledge base](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/knowledge/README.md) | Starter-only — short notes on scripts, sync, guards, failures |
| [ADR index](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/adr/README.md) | Starter-only — why core starter choices exist |
| [Starter operating handoff](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/starter-operating-handoff.md) | Starter-only — deliverables, label sanity, P0 red-team, risks |

## Agent entrypoint

All coding agents should start by reading:

- [`.agents/README.md`](../../.agents/README.md) when native skill loading is unavailable
- [`AGENTS.md`](../../AGENTS.md)
- [`docs/agent-loop/operating-manual.md`](./operating-manual.md)

Then run:

```text
superpowers:using-superpowers
```

When GitHub issues, PRs, branches, or CI runs are in scope, use the GitHub skill (or `gh`) to inspect real state before acting.
