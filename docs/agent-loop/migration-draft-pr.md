# Migration draft PR workflow

Agents may **commit, push, and open a draft PR** for database migration work after local checks pass. Opening a draft PR does not mutate production data.

Use with [security-and-migrations.md](./security-and-migrations.md), [checklist.md](./checklist.md), and [schema-evolution.md](../schema-evolution.md).

## When this workflow applies

Enter **migration draft PR mode** when the diff touches any of:

- `src/migrations/**` (Payload/D1 migration files)
- `src/migrations/index.ts` (migration registration)
- New or updated Payload migration SQL from `pnpm payload migrate:create`
- Database schema drift fixes tied to D1 or Payload migrations

Payload collection/global field changes that require a D1 migration also qualify, even when the migration file is generated in the same task.

## Allowed automatically (after checks pass)

1. Run the correct validation tier ([AGENTS.md § Validation](../../AGENTS.md#validation-before-pr-and-merge))
2. Run `pnpm run generate:types` when Payload schema changed
3. Commit changes (one focused commit unless the task requires more)
4. Push the issue branch
5. Open a **draft** PR targeting `develop` for normal migration work, or `main` only for approved hotfix/release work
6. Post the implementation report on the source issue

**Do not ask for human approval** before commit, push, or draft PR creation solely because migration files are in the diff.

## Required for migration PRs

### PR state and title

- PR **must** be created as **draft** (`gh pr create --draft`)
- PR **must stay draft** until a human explicitly approves marking ready for review
- Title prefix (pick the best fit):
  - `[D1 Migration]` — D1 SQL / `src/migrations/**`
  - `[Payload Migration]` — Payload schema driving a new migration
  - `[DB Migration]` — mixed or unclear; use when both apply

### PR body (minimum)

Include all sections below. Copy the checklist from [pull_request_template.md](../../.github/pull_request_template.md) **Schema and Migration Safety** and **Migrations and deploy** when applicable.

```markdown
## Summary
- What database or schema issue this fixes
- Whether the migration is additive, destructive, or mixed
- List of changed migration files

## Migration safety
- [ ] PR is draft
- [ ] No production migration has been run
- [ ] No production deploy has been run
- [ ] `up()` reviewed for additive or destructive behavior
- [ ] `down()` reviewed for destructive rollback SQL (warn below if present)
- [ ] Backup or rollback plan is known before production execution

## Commands run
<!-- Exact commands and pass/fail results -->

## Human approval required before
- Marking ready for review
- Merging
- Enabling auto-merge
- Running production D1 migration (`wrangler d1 migrations apply`, deploy pipeline, etc.)
- Running production Payload migration
- Deploying production (`wrangler deploy`, production CI, etc.)
- Running destructive rollback or `down()` migration against any non-local database
```

### Destructive `down()` warning

If `down()` contains destructive SQL (`DROP`, `TRUNCATE`, `DELETE FROM`, `RENAME`, `ALTER COLUMN`, etc.), call it out explicitly in **Migration safety** and **Risk review**, even though `guard:safety` only scans `up()` sections.

### Destructive `up()` without approval marker

`pnpm run guard:safety` still **fails** on destructive keywords in migration `up()` sections unless the file includes `bemoat:destructive-migration-approved`. Do not commit until the guard passes or the human adds the marker with explicit approval.

## Forbidden without separate explicit human approval

| Action | Why |
|--------|-----|
| Mark PR ready for review | `gh pr ready` — human reviews migration risk first |
| Merge PR | Humans merge after review |
| Enable auto-merge | Could merge before migration review |
| Run production D1 migration | Mutates production data |
| Run production Payload migration | Mutates production data |
| Deploy production | May apply migrations to production |
| Run destructive rollback / `down()` on shared or production DB | Data loss risk |

Local and preview migrations are fine when the task calls for them. Production is not.

## What still stops before commit

Migration draft PR mode does **not** override these stop conditions:

- Secrets, `.env*` files, or copied Cloudflare resource IDs — see [security-and-migrations.md](./security-and-migrations.md)
- **Unsafe Payload schema mutation** without additive replacement (field rename, type swap, relation target/cardinality change) — see [AGENTS.md § Production Schema Evolution](../../AGENTS.md#production-schema-evolution-rules)
- Destructive migration `up()` SQL without `bemoat:destructive-migration-approved` and human approval
- Ambiguous task, forbidden files, failing checks, or wrong repo (starter vs child)

## Example: open a migration draft PR

```bash
pnpm run generate:types   # if Payload schema changed
pnpm run check

git add -A
git commit -m "Add D1 migration for …"
git push -u origin HEAD

gh pr create --draft --title "[D1 Migration] Add index on posts.slug" --body "$(cat <<'EOF'
## Summary
- …

## Migration safety
- [x] PR is draft
- [x] No production migration has been run
- [x] No production deploy has been run
…
EOF
)"
```

## Related

- [security-and-migrations.md](./security-and-migrations.md) — secrets, guards, production deploy gates
- [schema-evolution.md](../schema-evolution.md) — additive-first Payload changes
- [guard-pack.md](../guard-pack.md) — `guard:safety` destructive SQL rules
