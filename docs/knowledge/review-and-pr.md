# Review and PR conventions

Full rails: [AGENTS.md](../../AGENTS.md#default-agent-workflow), [checklist.md](../agent-loop/checklist.md), [operating-manual.md](../agent-loop/operating-manual.md).

## Standard loop

```text
branch → implement → check → commit → push → PR → issue comment → (human merge)
```

Agents complete the full loop by default — do not stop after implementation or ask permission to push/PR.

## Model roles (v1)

| Role | Model | Responsibility |
|------|-------|----------------|
| Implementer | Composer 2.5 | Code, docs, tests, commit, push, PR, issue report |
| Requirements / red team | GPT-5.5 | Acceptance criteria, starter vs child, security, scope gates |

Red-team pass before commit: security, schema, Cloudflare, overbuild, correct repo.

## PR body (minimum)

- **Summary** — what and why
- **Test plan** — commands run
- **Risks** — migration, sync, Cloudflare, scope
- **Human review needed** — explicit items
- **`Closes #N`** when from an issue

Use [pull_request_template.md](../../.github/pull_request_template.md).

## Merge policy

- **Humans merge only** — agents must not merge.
- **Migration PRs stay draft** until a human marks ready for review — agents must not use `gh pr ready`, merge, or enable auto-merge without explicit approval.
- Wait for CI green; inspect logs on failure (do not guess).
- Starter: prefer `check:full` green before human merge when practical.

## Migration draft PR

When the diff touches `src/migrations/**` or requires a D1/Payload migration:

- Agents may commit, push, and open a **draft** PR after checks pass — no pre-PR approval needed for migration files alone.
- Title: `[D1 Migration]`, `[Payload Migration]`, or `[DB Migration]` prefix.
- Body: migration safety checklist, commands run, confirm no production migration or deploy.
- Forbidden without explicit human approval: ready for review, merge, auto-merge, production migration, production deploy, destructive rollback.

Full policy: [migration-draft-pr.md](../agent-loop/migration-draft-pr.md).

## Issue implementation report

After opening PR, comment on the source issue with: PR URL, branch, summary, files changed, commands, test results, risks, human review needed, next step.

Template: [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation).

## Validation reminder

| Change | Before commit |
|--------|---------------|
| Docs only | `pnpm run guard:safety` |
| Code | `pnpm run check` |

## Related

- [ADR 0005](../adr/0005-pr-based-harness-migration.md) — PR-based harness flow
- [ADR 0007](../adr/0007-docs-and-tests-as-durable-assets.md) — docs as synced assets
