# Agent Operating Manual v1

Practical execution guide for Bemoat coding agents. Paste the [prompt seed](#prompt-seed) into Composer or Codex. Details live in linked docs — do not re-read all of `AGENTS.md` every turn.

## Model roles

| Role | Model | When to use |
|------|-------|-------------|
| **Implementer** | **Composer 2.5** | Branch, code, docs, tests, commit, push, PR, issue comment |
| **Requirements & decisions** | **GPT-5.5** | Clarify acceptance criteria, starter vs child, scope boundaries, stop/go |
| **Red team** | **GPT-5.5** | Security, access control, migration risk, overbuild, sync boundary violations |

**Default split:** GPT-5.5 plans and gates; Composer 2.5 implements. One session may play both — run the red-team pass before commit.

## Standard loop

```text
Plan → git status & branch gates → Acceptance criteria → Implement → Test → Red team → Commit → PR (open or update) → Sync upstream (if reusable)
```

| Phase | Owner | Output |
|-------|-------|--------|
| **Plan** | GPT-5.5 | Repo (starter vs child), branch name, files to touch, validation tier, stop risks |
| **Branch gates** | Composer 2.5 | `git status`, confirm branch, stop if dirty, never on `main` or routine-coding on `dev`, create `<type>/<issue-number>-<short-slug>` |
| **Acceptance criteria** | GPT-5.5 | Numbered checklist from issue; explicit out-of-scope |
| **Implement** | Composer 2.5 | Smallest complete diff; match conventions |
| **Test** | Composer 2.5 | Commands per [validation tier](../../AGENTS.md#validation-before-pr-and-merge) |
| **Red team** | GPT-5.5 | Security, schema, Cloudflare, scope, overbuild — stop or fix before commit |
| **Commit** | Composer 2.5 | One focused commit if checks pass |
| **PR** | Composer 2.5 | Open PR or update existing; template filled; `Closes #N`; issue implementation report |
| **Sync upstream** | Human + agent | Reusable harness/docs → starter PR; child follows [harness-sync-workflow.md](./harness-sync-workflow.md) |

Full workflow rails: [README.md](./README.md), [checklist.md](./checklist.md), [AGENTS.md](../../AGENTS.md#default-agent-workflow).

## Starter vs child — decision rule

Ask once at plan time. Full tables: [source-of-truth.md](./source-of-truth.md).

| If… | Then… |
|-----|--------|
| Every Bemoat site should get it (agent rules, guards, shared schema, harness scripts) | **Starter** (`bemoat-web-starter`) |
| Only one client/product needs it | **Child project** |
| Touches `wrangler.jsonc`, D1 ID, R2 name, Worker name, `.env`, secrets, domains | **Child only** — never copy IDs across projects |
| Fixes shared collection, agent docs, CI harness, `bemoat:*` scripts | **Starter** |
| Child already customized a seed-only file | **Child** — port starter improvements manually if desired |
| Unsure | Stop; triage via GitHub issue before editing |

**After starter merge:** child projects follow [harness-sync-workflow.md](./harness-sync-workflow.md) (`pnpm run boilerplate:sync -- --harness-only` on branch `chore/sync-harness-from-starter-<source-pr-number>`). See also [harness-sync-contract.md](../harness-sync-contract.md).

## Stop rule — avoid overbuild

Stop and report (do not commit) when any of these is true:

| Trigger | Action |
|---------|--------|
| Task exceeds issue acceptance criteria | Stop; list extras; wait for approval |
| Fix requires forbidden files (secrets, prod IDs, destructive `up()` without approval marker) | Stop; see [security-and-migrations.md](./security-and-migrations.md) |
| Payload field rename, type swap, or relation target/cardinality change | Stop; propose additive alternative per [schema-evolution.md](../schema-evolution.md) |
| Checks fail for unrelated pre-existing reasons | Report exact output; no drive-by refactors |
| Change belongs in child but you are in starter (or vice versa) | Stop; redirect repo |
| "While I'm here" refactor, new abstraction, or extra feature | **Do not** — file follow-up issue instead |
| Ambiguous requirements | Stop; ask or red-team clarify before coding |

**Mantra:** Smallest complete change. One issue → one PR → one focused commit (unless issue says otherwise).

## Validation commands

Child-facing automation calls **`bemoat:*` scripts only**. Guards run through the central pack — see [guard-pack.md](../guard-pack.md).

| Change type | Before commit/PR |
|-------------|------------------|
| Docs / markdown / CI config only (no `.ts`, `.tsx`, `.mjs` app or script changes) | `pnpm run guard:safety` |
| Code (TS, scripts, tests, components, collections) | `pnpm run check` (lint **zero warnings**, typecheck, test:int, guard:safety) |
| Payload schema | `pnpm run check` + `pnpm run generate:types` + migration if D1 |
| Admin components | `pnpm run check` + `pnpm run generate:importmap` |

In child repos use `pnpm run bemoat:guard:safety` and `pnpm run bemoat:check` when defined.

## Commit checklist

- [ ] On correct branch from latest `dev`
- [ ] Only allowed files in diff
- [ ] No `.env*`, secrets, tokens, or copied Cloudflare resource IDs
- [ ] Validation tier passed (evidence, not assumption)
- [ ] `git status` and diff summary reviewed
- [ ] Exactly one focused commit (unless issue requires more)
- [ ] Commit message states **why**, not a file list

**Do not commit if:** checks fail, forbidden files required, destructive `up()` migration without approval marker, or red-team stop triggered.

**Migration files alone:** commit, push, and open **draft** PR after checks — [migration-draft-pr.md](./migration-draft-pr.md).

## PR checklist

- [ ] Acceptance criteria met
- [ ] Branch pushed to origin
- [ ] Checked for existing PR on branch — open new or update existing (no duplicate)
- [ ] PR body: **Summary**, **Test plan**, **Risks**, **Human review needed**
- [ ] `Closes #<issue-number>` when working from an issue
- [ ] Source-of-truth answer: starter or child?
- [ ] Payload / migration / Cloudflare risks called out in PR
- [ ] **Migration PR:** draft only; did not mark ready for review or run production migration/deploy
- [ ] **Comment implementation report on source issue** — see [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation)
- [ ] Notify user: branch, files, commands, test result, commit hash, PR URL, risks
- [ ] **Do not merge** — human only

## Red team pass (before commit)

Run mentally or as a separate GPT-5.5 turn:

- [ ] Local API with `user` → `overrideAccess: false`
- [ ] Hooks pass `req` to nested Payload operations
- [ ] No privilege escalation in access control
- [ ] No secrets or resource IDs in tracked files
- [ ] Schema changes are additive-first
- [ ] Scope matches issue only — no overbuild
- [ ] Work is in the correct repo (starter vs child)
- [ ] Child harness edits use `bemoat:*` entrypoints only

Deep patterns: [security-critical.mdc](../../.cursor/rules/security-critical.mdc), [roles.md](./roles.md) (Red Team).

## Prompt seed

Copy into Composer or Codex when starting a Bemoat task:

```text
You are a Bemoat coding agent. Follow docs/agent-loop/operating-manual.md and docs/agent-loop/issue-driven-branch-workflow.md.

Repo: [bemoat-web-starter | child project name]
Issue: [#N title + URL]
Branch: <type>/<issue-number>-<short-slug> (create from dev if needed; never edit on main or routine-code on dev)

Required first steps:
1. git status
2. Confirm current branch
3. Stop if working tree is dirty with unrelated changes
4. Never modify main directly
5. Do not routine-code directly on dev
6. Create issue branch from dev if on main or dev:
   git fetch origin
   git switch dev
   git pull origin dev
   git switch -c docs/dev-branch-policy-sync-contract

Roles:
- Composer 2.5: implement, test, commit, push, PR (open or update), issue comment
- GPT-5.5: acceptance criteria, starter-vs-child decision, red team before commit

Loop: Plan → Branch gates → Acceptance criteria → Implement → Test → Red team → Commit → PR (open or update) → Harness sync closeout (if workflow change) → (sync upstream if reusable)

Before editing, report: branch name, files inspected, proposed file changes, risks.

Rules:
- Smallest complete diff; no overbuild or "while I'm here" changes
- Starter = reusable harness/docs/schema; child = wrangler, D1/R2 IDs, secrets, customer features
- Validation: docs-only → pnpm run guard:safety; code → pnpm run check
- Child automation: bemoat:* scripts only
- Complete branch → implement → check → commit → push → open or update PR → comment on issue
- Before closing issue (workflow/source-of-truth): check harness sync impact; follow-up sync issue or sync step required
- Do not merge; do not copy Cloudflare IDs or secrets across projects
- Stop if dirty tree, on main without branch, scope unclear, destructive migration, or schema rename/type change

Links: AGENTS.md, docs/agent-loop/checklist.md, docs/agent-loop/source-of-truth.md, docs/agent-loop/issue-driven-branch-workflow.md

Task:
[Paste issue body or user task here]
```

Starter-only links point to [boat1994/bemoat-web-starter](https://github.com/boat1994/bemoat-web-starter) and may not be present in child repos after harness sync.

## Related docs

| Doc | Use for |
|-----|---------|
| [README.md](./README.md) | High-level loop and artifacts |
| [checklist.md](./checklist.md) | Before/during/PR/CI/merge checklists |
| [source-of-truth.md](./source-of-truth.md) | Starter vs child ownership |
| [roles.md](./roles.md) | Builder, Reviewer, Migration, Red Team, Triage |
| [security-and-migrations.md](./security-and-migrations.md) | Secrets, guards, production deploy gates |
| [migration-draft-pr.md](./migration-draft-pr.md) | Draft PR workflow for D1/Payload migrations |
| [guard-pack.md](../guard-pack.md) | Central guard pack |
| [harness-sync-workflow.md](./harness-sync-workflow.md) | Child harness sync loop after starter merge |
| [harness-sync-contract.md](../harness-sync-contract.md) | What syncs to children |
| [child-project-migration-guide.md](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/child-project-migration-guide.md) | Starter-only child harness migration playbook |
