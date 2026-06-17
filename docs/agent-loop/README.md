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
pnpm run boilerplate:sync
```

Sync updates managed boilerplate paths, including agent rules (`AGENTS.md`, `.cursor/rules`), GitHub workflow rails (`.github/workflows/ci.yml`, PR and issue templates), `docs/agent-loop`, harness scripts (`guard-repo-safety`, `guard-cloudflare-env`, `install-git-hooks`, sync/drift/smoke), optional `.githooks`, harness integration tests, and the sync script itself.

Sync also merges **`.gitignore`**: child ignore rules are kept and missing starter rules are appended. It adds missing **`bemoat:*` scripts** when absent and writes **`.bemoat/package-sync-proposal.md`** with recommended non-namespaced scripts and dependencies for human review.

It does **not** overwrite project-specific infrastructure (`wrangler.jsonc`, D1 IDs, R2 bucket names, Worker names, `.env`, secrets), root `README.md` (unless you later add it to managed paths), `pnpm-lock.yaml`, or project-specific business modules. See [source-of-truth.md](./source-of-truth.md) and [harness-sync-contract.md](../harness-sync-contract.md).

For the canonical **child harness sync loop** (branch gates, sync command, validation, PR, report), see [harness-sync-workflow.md](./harness-sync-workflow.md).

For a step-by-step harness migration in child repos (audit mode, sync mode, PR conventions, rollback), use the [Child project migration guide](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/child-project-migration-guide.md) (starter-only).

## Task-only prompts

Users do not need to repeat branch, check, commit, push, or PR steps in every message. Provide the task (or a GitHub issue); agents read `AGENTS.md` and this folder, then run the [Default Agent Workflow](../../AGENTS.md#default-agent-workflow) automatically unless you override it.

Agents **must complete the full branch-to-PR workflow** by default — branch, implement, check, commit, push, open PR, comment on the source issue — without stopping after implementation or asking permission to commit/push/open PR/comment. See [GitHub workflow requirement](../../AGENTS.md#github-workflow-requirement) and [Issue report after PR creation](../../AGENTS.md#issue-report-after-pr-creation) for stop conditions.

## High-level loop

```text
task → read AGENTS.md + agent-loop → git status & issue branch → edit → test → show diff → commit → push → open or update PR → comment on issue → notify user
                                                                                                                              ↓
                                                                                                        CI → review → merge (human only)
```

| Step | What happens |
|------|----------------|
| **Task** | User gives a short prompt or GitHub issue. Scope, allowed files, and risks may also live in the [agent-task](../../.github/ISSUE_TEMPLATE/agent-task.yml) template. |
| **Branch gates** | `git status`; stop if dirty; never work on `main`; create `<type>/<issue-number>-<short-slug>` from `main`. See [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md). |
| **Branch** | Short-lived dedicated issue branch from `main`; naming convention documented in [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md). |
| **Edit** | Follow `AGENTS.md`, allowed paths, and [checklist.md](./checklist.md). Smallest complete change. |
| **Test** | Run validation tier from `AGENTS.md`: docs-only → `guard:safety`; code → `check` (required). `generate:importmap` / `generate:types` when needed. |
| **Show diff** | `git status` and diff summary before commit. |
| **Commit** | One focused commit only if checks pass and only allowed files changed. See commit safety in `AGENTS.md`. |
| **Push** | Push the branch to origin. |
| **Open PR** | Open a new PR or **update the existing PR** if the branch already has one. Fill out the [pull request template](../../.github/pull_request_template.md). Include `Closes #<issue-number>`, summary, test plan, risks, and human-review notes. **Migration PRs:** draft only — see [migration-draft-pr.md](./migration-draft-pr.md). |
| **Comment on issue** | Post the implementation report on the source GitHub issue with PR link and review checklist. See [Issue report after PR creation](../../AGENTS.md#issue-report-after-pr-creation). |
| **Notify user** | Task summary, branch, files changed, commands run, test result, commit hash, PR URL, risks, and human-review items. |
| **CI** | GitHub Actions must pass; inspect logs on failure—do not guess. |
| **Review** | Human or reviewer agent; watch Payload, migration, Cloudflare, sync risks. |
| **Merge** | **Human only.** Agents must not merge. Prefer `check:full` green when practical. |

## Artifacts in this folder

| File | Purpose |
|------|---------|
| [starter-reading-order.md](./starter-reading-order.md) | Ordered docs for new tasks (operating manual → migration → ADRs → KB → guards → acceptance) |
| [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md) | Issue branch gates, naming, PR open/update, harness sync closeout |
| [harness-sync-workflow.md](./harness-sync-workflow.md) | Child project harness sync loop after starter merge |
| [composer-issue-workflow-prompt.md](./composer-issue-workflow-prompt.md) | Paste-ready Composer/Codex prompt for issue → PR workflow |
| [operating-manual.md](./operating-manual.md) | v1 execution manual — model roles, loop, prompt seed, stop rules |
| [state-template.md](./state-template.md) | Session handoff between agents |
| [roles.md](./roles.md) | Builder, Reviewer, Migration, Red Team, GitHub Triage |
| [security-and-migrations.md](./security-and-migrations.md) | Secrets, guards, production deploy gates |
| [migration-draft-pr.md](./migration-draft-pr.md) | Draft PR workflow for D1/Payload migrations |
| [checklist.md](./checklist.md) | Before/during/PR/CI/merge checklists |
| [source-of-truth.md](./source-of-truth.md) | What lives in starter vs child projects |
| [../hardening.md](../hardening.md) | Production hardening index (releases, drift check, smoke test, secrets, branch protection) |
| [Knowledge base](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/knowledge/README.md) | Starter-only — short notes on scripts, sync, guards, failures |
| [ADR index](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/adr/README.md) | Starter-only — why core starter choices exist |
| [Starter operating handoff](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/starter-operating-handoff.md) | Starter-only — deliverables, label sanity, P0 red-team, risks |

## Agent entrypoint

All coding agents should start by reading:

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/agent-loop/operating-manual.md`](./operating-manual.md)

Then run:

```text
superpowers:using-superpowers
```

When GitHub issues, PRs, branches, or CI runs are in scope, use the GitHub skill (or `gh`) to inspect real state before acting.
