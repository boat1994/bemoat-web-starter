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

Sync updates managed boilerplate paths. It does **not** overwrite project-specific infrastructure (`wrangler.jsonc`, D1 IDs, R2 bucket names, Worker names, `.env`, secrets). See [source-of-truth.md](./source-of-truth.md).

## Task-only prompts

Users do not need to repeat branch, check, commit, push, or PR steps in every message. Provide the task (or a GitHub issue); agents read `AGENTS.md` and this folder, then run the [Default Agent Workflow](../../AGENTS.md#default-agent-workflow) automatically unless you override it.

## High-level loop

```text
task → read AGENTS.md + agent-loop → branch → edit → test → show diff → commit → push → open PR → notify user
                                                                                                    ↓
                                                                              CI → review → merge (human only)
```

| Step | What happens |
|------|----------------|
| **Task** | User gives a short prompt or GitHub issue. Scope, allowed files, and risks may also live in the [agent-task](../../.github/ISSUE_TEMPLATE/agent-task.yml) template. |
| **Branch** | Short-lived branch from `main`; name reflects the task. |
| **Edit** | Follow `AGENTS.md`, allowed paths, and [checklist.md](./checklist.md). Smallest complete change. |
| **Test** | Run lint, typecheck, tests; `generate:importmap` / `generate:types` when needed. |
| **Show diff** | `git status` and diff summary before commit. |
| **Commit** | One focused commit only if checks pass and only allowed files changed. See commit safety in `AGENTS.md`. |
| **Push** | Push the branch to origin. |
| **Open PR** | Fill out the [pull request template](../../.github/pull_request_template.md). |
| **Notify user** | Task summary, branch, files changed, commands run, test result, commit hash, PR URL, risks, and human-review items. |
| **CI** | GitHub Actions must pass; inspect logs on failure—do not guess. |
| **Review** | Human or reviewer agent; watch Payload, migration, Cloudflare, sync risks. |
| **Merge** | **Human only.** Agents must not merge. Prefer `check:full` green when practical. |

## Artifacts in this folder

| File | Purpose |
|------|---------|
| [state-template.md](./state-template.md) | Session handoff between agents |
| [roles.md](./roles.md) | Builder, Reviewer, Migration, Red Team, GitHub Triage |
| [checklist.md](./checklist.md) | Before/during/PR/CI/merge checklists |
| [source-of-truth.md](./source-of-truth.md) | What lives in starter vs child projects |

## Agent entrypoint

All coding agents should start with:

```text
superpowers:using-superpowers
```

When GitHub issues, PRs, branches, or CI runs are in scope, use the GitHub skill (or `gh`) to inspect real state before acting.
