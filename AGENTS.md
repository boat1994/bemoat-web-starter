# Bemoat Agent Rules

This is the short routing and safety entrypoint for agents working in
`bemoat-web-starter` and child projects that inherit the Bemoat harness.

Read this first, then follow the canonical docs it points to. Do not paste or
recreate long-form framework manuals here.

## Canonical Rule Map

| Area | Canonical file(s) |
| --- | --- |
| Root agent entrypoint | `AGENTS.md` |
| Starter vs child ownership | `docs/agent-loop/source-of-truth.md`, `docs/harness-sync-contract.md` |
| Issue branch workflow | `docs/agent-loop/issue-driven-branch-workflow.md`, `docs/workflow/git-flow.md` |
| Agent loop and checklist | `docs/agent-loop/README.md`, `docs/agent-loop/checklist.md` |
| Security and migrations | `docs/agent-loop/security-and-migrations.md`, `docs/schema-evolution.md` |
| Payload CMS rules | `.cursor/rules/payload-overview.md` and related `.cursor/rules/payload-*.md` / topic files; fallback `.agents/skills/payload-cms.md` |
| Superpowers workflow | Native `superpowers:using-superpowers`; fallback `.agents/skills/using-superpowers.md` |
| UI animation workflow | `.agents/skills/ui-animation.md`, `docs/ai/ui-execution-workflow.md` |
| Harness sync contract | `docs/harness-sync-contract.md` |

## Skill Workflow

Before substantive response, planning, editing, running implementation commands,
or reviewing code, check whether a native skill applies. If a relevant native
skill is available, use it first and follow it.

Required defaults:

- Start task work with native `superpowers:using-superpowers` when available.
- If native skill loading is unavailable, read
  `.agents/skills/using-superpowers.md`.
- For GitHub issues, PRs, branches, commits, CI runs, or GitHub URLs, use the
  GitHub skill when available, or the `.agents/skills/issue-workflow.md`
  fallback.
- For Payload CMS work, use the Payload CMS skill/rules listed in the canonical
  map.
- For UI animation work, use the UI animation skill/rules listed in the
  canonical map.

User instructions remain highest priority. If a native skill and repository
rule conflict, follow the explicit user/repository instruction and report the
conflict.

## Bemoat Source Of Truth Rules

- **`bemoat-web-starter` is the source of truth** for reusable Bemoat web
  project infrastructure: shared Payload schema, starter pages, agent rules,
  GitHub templates, CI patterns, sync behavior, and harness docs.
- Real child projects start from the README
  [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/boat1994/bemoat-web-starter)
  button, then clone the generated project locally.
- Do not recommend cloning this starter directly for real child projects unless
  the task is to develop the starter itself.
- Reusable improvements belong in this starter and flow to children through the
  child harness sync workflow (`pnpm run bemoat:boilerplate:sync -- --harness-only`).
  After a starter merge, child projects follow
  `docs/agent-loop/harness-sync-workflow.md`.
- Rails-managed paths are overwritten by sync: agent docs, CI, sync scripts,
  guards, harness tests, and other paths listed in `managedPaths`.
- Starter-seed app paths are copied only when missing in the child project.
  Existing child customizations are not overwritten automatically.
- Project-specific infrastructure belongs in child projects: `wrangler.jsonc`,
  D1 IDs, R2 bucket names, Worker names, `.env` files, Cloudflare secrets,
  domains, and customer integrations.
- Do not copy D1 IDs, R2 bucket names, Worker names, `.env` files, Cloudflare
  secrets, domains, or other project-specific resource IDs between projects.

## GitHub Workflow

- If an issue, PR, commit, branch, CI run, or GitHub URL is referenced, use the
  GitHub skill first when available, or `gh` for Actions logs and local gaps.
- Do not guess CI failures. Inspect failed workflow logs before proposing fixes.
- Agents may create branches, commit, push, open PRs, and comment on issues
  when the workflow requires it. Agents must not merge.
- Complete the full branch-to-PR workflow unless blocked by a stop condition or
  explicitly overridden by the user.

## Required First Steps Before File Edits

For issue-based work, follow
`docs/agent-loop/issue-driven-branch-workflow.md`.

1. Read the issue or task, `AGENTS.md`, and `docs/agent-loop/README.md`.
2. Run `git status` and confirm the current branch.
3. Stop if the working tree has unrelated staged, unstaged, or untracked
   changes.
4. Never modify `main` directly.
5. Do not implement routine work directly on `dev`.
6. If on `main` or `dev`, create a dedicated issue branch before editing.

Branch naming:

```text
<type>/<issue-number>-<short-slug>
```

Examples:

```text
fix/41-opennext-build-contract
feature/42-mobbin-reference-cms
chore/67-git-flow-branch-guardrails
docs/77-agent-rules-entrypoint
```

Create normal issue branches from latest `dev`. If a repository has no `dev`
branch yet, follow the bootstrap note in `docs/workflow/git-flow.md`: use the
safest available protected baseline, call out the temporary exception in the
PR, and do not merge yourself.

Before editing, report the branch name, files inspected, proposed file changes,
and notable risks.

## Default Agent Workflow

Users may provide only the task or a GitHub issue. Follow this loop
automatically unless the user explicitly overrides it, for example "do not
commit" or "docs only, no PR."

1. Read `AGENTS.md` and `docs/agent-loop/README.md`.
2. Inspect GitHub state when a URL, issue, PR, branch, commit, or CI run is in
   scope.
3. Classify task size using `docs/agent-loop/checklist.md` and use the minimum
   useful process for that tier.
4. Run the branch gates above.
5. Make the smallest complete change.
6. Run the required validation tier.
7. Show `git status` and a diff summary.
8. Commit exactly one focused change only if checks pass and only allowed files
   changed.
9. Push the issue branch.
10. Open a PR targeting `dev`, or update the existing PR for the branch.
11. Include `Closes #<issue-number>` in the PR body for GitHub issue work.
12. Post an implementation report comment on the source issue.
13. Notify the user with the final response checklist below.
14. Do not merge.

### Stop Conditions

Stop and report instead of editing, committing, pushing, or opening a PR when:

- The working tree is dirty with unrelated changes.
- The task is ambiguous enough to risk damaging existing work.
- The source issue number is unknown for issue-driven work.
- Checks fail and cannot be safely fixed in scope.
- Git authentication or permissions block push, PR creation, or issue comments.
- Forbidden files or project-specific infrastructure would be required.
- Secrets, Cloudflare resource IDs, production deploy actions, or production
  migrations are involved without explicit human approval.
- The change belongs in a child project instead of `bemoat-web-starter`.
- The task requires unsafe Payload schema mutation without an additive
  replacement.

## Validation Before PR And Merge

Run the correct validation before commit and PR. CI is the final source of
truth on GitHub.

| Change type | In `bemoat-web-starter` | In child projects | Notes |
| --- | --- | --- | --- |
| Docs, markdown, or CI config only | `pnpm run guard:safety` | `pnpm run bemoat:guard:safety` | Skip full checks unless code changed. |
| Harness sync docs or sync contract assumptions | `pnpm run guard:safety`; `pnpm run boilerplate:check` when useful | `pnpm run bemoat:guard:safety`; `pnpm run bemoat:boilerplate:check -- --harness-only` when checking sync drift | Protect child sync behavior. |
| Code changes (`.ts`, `.tsx`, `.mjs`, tests, scripts, components, collections, hooks) | `pnpm run check` | `pnpm run bemoat:check` when the child supports its local `lint` and `typecheck` scripts; otherwise run `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int`, and the child-owned code checks that exist | In this starter, lint must pass with zero warnings. |
| Payload schema changes | `pnpm run check` and `pnpm run generate:types` | Child code tier plus the child-owned `generate:types` script when present | Include migrations when D1 schema changes. |
| Admin component changes | `pnpm run check` and `pnpm run generate:importmap` | Child code tier plus the child-owned `generate:importmap` script when present | Required for Payload import map updates. |
| D1 or Payload migration files | Same tier as triggering change; `generate:types` if schema changed | Same child tier as triggering change; child-owned `generate:types` if schema changed | Open a draft PR only. |

Child projects receive a child-safe synced baseline where CI and optional
pre-push call only `bemoat:*` scripts, as documented in
`docs/harness-sync-contract.md`. Raw scripts such as `check`, `lint`,
`typecheck`, and `guard:safety` are starter-internal or child-local and must not
be assumed by synced automation.

### Migration Draft PR Mode

When the diff touches `src/migrations/**`, Payload/D1 migration files, or
schema drift fixes requiring a migration:

- Run the normal checks for the triggering change.
- Commit, push, and open a **draft** PR after checks pass.
- Prefix the PR title with `[D1 Migration]`, `[Payload Migration]`, or
  `[DB Migration]`.
- Confirm no production migration or deploy was run.
- Do not mark ready for review, merge, enable auto-merge, run production
  migrations, deploy production, or run destructive rollback without separate
  explicit human approval.

Full policy: `docs/agent-loop/migration-draft-pr.md`.

## Payload CMS Rules

Detailed Payload guidance lives in the Cursor rules and Payload fallback skill,
not in this root entrypoint:

- `.cursor/rules/payload-overview.md`
- `.cursor/rules/security-critical.mdc`
- `.cursor/rules/collections.md`
- `.cursor/rules/fields.md`
- `.cursor/rules/access-control.md`
- `.cursor/rules/access-control-advanced.md`
- `.cursor/rules/hooks.md`
- `.cursor/rules/queries.md`
- `.cursor/rules/endpoints.md`
- `.cursor/rules/components.md`
- `.cursor/rules/adapters.md`
- `.cursor/rules/field-type-guards.md`
- `.cursor/rules/plugin-development.md`
- `.agents/skills/payload-cms.md`

Non-negotiable Payload safety summary:

- Use TypeScript with generated Payload types.
- When passing `user` to Payload Local API calls, set `overrideAccess: false`.
- In hooks, pass `req` to nested Payload operations.
- Use context flags to avoid hook loops.
- Ensure required roles exist when modifying collections or globals with access
  controls.
- Run `generate:types` after schema changes.
- Run `generate:importmap` after creating or modifying admin components.

## Production Schema Evolution Rules

Production CMS data must survive schema changes. Follow
`docs/schema-evolution.md` and `docs/agent-loop/security-and-migrations.md`.

**Mantra:** Additive first. Backfill second. Switch reads third. Deprecate old
fields fourth. Delete last, only with backup and explicit approval.

Do not directly:

- Rename existing Payload fields that may contain production data.
- Change an existing field type.
- Change an existing relationship cardinality, such as single relation to
  `hasMany`.
- Change an existing relationship target, such as `categories` to `taxonomies`.
- Ship destructive migration SQL without explicit approval and the
  `bemoat:destructive-migration-approved` marker.

Use additive replacements instead:

- Add a new field or collection.
- Read the new field first and fall back to the old field during transition.
- Backfill in a separate reviewed migration or script.
- Mark old fields as deprecated in Payload admin notes.
- Remove old fields only after explicit human approval, production backup, and
  at least one stable release.

## Spec and Plan Document Organization

Design specifications (specs) and implementation plans must be organized according to the rules in `docs/superpowers/specs/README.md` and `docs/superpowers/plans/README.md`.
- Never place flat design specs or implementation plan files directly in the root of `docs/superpowers/specs/` or `docs/superpowers/plans/`.
- Always organize specs inside `{project}/{initiative}/{feature}/` subdirectories (e.g. `docs/superpowers/specs/bogus/catalog/minimal-luxury-detail/design.md`).
- Always organize plans inside `{project}/{initiative}/{feature}/` subdirectories (e.g. `docs/superpowers/plans/bogus/catalog/minimal-luxury-detail/plan.md`).

## Security And Commit Safety

- Do not commit secrets, `.env` files, Cloudflare account IDs, D1 IDs, R2 bucket
  names, Worker names, domains, or customer integration credentials.
- Do not commit unrelated refactors.
- Do not commit if checks fail.
- Do not commit if forbidden files changed.
- Use exactly one focused commit unless the task explicitly requires more.
- Review staged files before commit.

## UI Animation Policy

For UI animation tasks, run the `ui-animation` skill before implementation and
prefer Framer Motion for choreography unless the motion is a simple CSS-only
micro transition.

Trigger the animation workflow for drawer, collapse, expand, morph, handoff,
travel, transition, choreography, motion polish, visual QA, Framer Motion,
perceived continuity, blink, pop, snap, or jank.

Keep CSS responsible for base layout and static styling. Use Framer Motion for
sequencing, height reveal, enter/exit, layout perception, same-object
continuity, and state choreography. Respect `prefers-reduced-motion`.

Report the visual QA path, changed animation selectors/components, and remaining
motion risks.

## Issue Report After PR Creation

When work comes from a GitHub issue, opening the PR is not the final step.
After opening or updating the PR, add a comment to the source issue with:

- PR URL
- Branch name
- Summary of changes
- Files changed
- Commands run
- Test results
- Remaining risks
- Human review needed
- Next suggested step

Use this template:

```markdown
## Implementation PR ready

PR: <PR_URL>
Branch: `<BRANCH_NAME>`

### Summary
- ...

### Files changed
- ...

### Commands run
- ...

### Test results
- ...

### Remaining risks
- ...

### Human review needed
- ...

### Next suggested step
Review PR, wait for CI, then merge if green.

Closes when PR is merged.
```

## Final Response Format

End every task with:

- Task summary
- Branch name
- Files changed
- Commands run
- Test result
- Commit hash
- PR URL
- Risks
- Human review needed
