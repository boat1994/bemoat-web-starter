# Payload schema evolution (production-safe)

This guide applies to **bemoat-web-starter** and every child project that inherits its Payload schema patterns. It complements [agent-loop/security-and-migrations.md](./agent-loop/security-and-migrations.md) and [hardening.md](./hardening.md).

## Mantra

**Additive first. Backfill second. Switch reads third. Deprecate old fields fourth. Delete last, only with backup and explicit approval.**

## Additive first, migrate later, delete last

Production CMS fields may already hold customer content. Renaming, retyping, or retargeting a field in place can orphan or corrupt that data in D1.

| Phase | What to do |
|-------|------------|
| 1. Add | Introduce `fieldV2` (or a new collection) alongside the old field |
| 2. Backfill | Copy or transform data in a reviewed migration or one-off script |
| 3. Switch reads | Application code reads new field first, falls back to old |
| 4. Deprecate | Mark old field read-only or hidden in admin; keep for rollback |
| 5. Delete | Remove old field only after backup, stable release, and explicit human approval |

Semantic Payload changes (rename, type change, relation target, relation cardinality) are **not** reliably detectable in CI. Documentation, PR checklist, and agent stop conditions are the primary guardrails. Migration SQL patterns are checked by `pnpm run guard:safety`.

## Safe vs risky vs forbidden

| Change | Classification | Approach |
|--------|----------------|----------|
| New optional field | Safe | Add field; run `generate:types`; create migration if D1 needs new columns |
| New collection | Safe | Add collection; migrate; backfill if replacing a domain |
| Rename existing field | Forbidden (in place) | Add `nameV2`; deprecate `name`; backfill; delete later |
| Change field type | Forbidden (in place) | Add `fieldV2` with new type; backfill; deprecate old |
| Single → `hasMany` relation | Forbidden (in place) | Add `categoriesV2` with `hasMany`; backfill; deprecate old |
| Change `relationTo` target | Forbidden (in place) | Add new relation field or new collection; migrate domain |
| Drop column / table | Forbidden without approval | Requires human approval + `bemoat:destructive-migration-approved` in migration file |

## Payload field examples

### Add replacement field (rename pattern)

```typescript
{
  name: 'titleV2',
  type: 'text',
  required: true,
  admin: {
    description: 'Canonical title. Replaces deprecated headline field.',
  },
},
{
  name: 'headline',
  type: 'text',
  admin: {
    description: 'Deprecated: use titleV2 instead. Do not edit except for rollback support.',
    readOnly: true,
  },
},
```

### Hide deprecated field from editors (after new field is stable)

```typescript
{
  name: 'headline',
  type: 'text',
  admin: {
    hidden: true,
    description: 'Deprecated: kept for rollback and historical data only.',
  },
},
```

### Relation cardinality change (additive)

```typescript
// Old (keep, deprecated)
{
  name: 'category',
  type: 'relationship',
  relationTo: 'categories',
  admin: {
    readOnly: true,
    description: 'Deprecated: use categoriesV2 instead.',
  },
},
// New
{
  name: 'categoriesV2',
  type: 'relationship',
  relationTo: 'categories',
  hasMany: true,
},
```

### Domain change (new collection)

When the related domain changes (for example `categories` → `taxonomies`), prefer a **new collection** and new relationship fields rather than retargeting the old field.

```typescript
// posts collection — add new relation; do not change `category` relationTo
{
  name: 'taxonomies',
  type: 'relationship',
  relationTo: 'taxonomies',
  hasMany: true,
},
```

## Recommended fallback read pattern

Use new field first; fall back to old during transition. Centralize in a helper or hook so frontend and API stay consistent.

```typescript
export function resolveTitle(doc: { titleV2?: string | null; headline?: string | null }): string {
  return doc.titleV2?.trim() || doc.headline?.trim() || ''
}
```

In hooks or frontend:

```typescript
const title = doc.titleV2 ?? doc.headline ?? ''
```

After backfill is complete and reads use only `titleV2`, keep `headline` deprecated until a human approves removal.

## Backfill and cleanup phases

### Backfill

1. Ship additive schema + migration (new columns/tables only).
2. Run a **reviewed** backfill: migration `up`, script, or admin bulk job.
3. Verify counts and spot-check documents in staging or preview.
4. Switch reads to new field (with fallback until confidence is high).

### Cleanup (human-gated)

1. Confirm production backup of D1.
2. Confirm at least one stable release on new field.
3. Obtain explicit human approval in PR.
4. Hide or remove deprecated fields in Payload config.
5. Optional destructive migration to drop unused columns — only with approval marker and rollback plan.

## Production checklist

Before merging schema work that touches production-bound data:

- [ ] `pnpm run generate:types` (if Payload schema changed)
- [ ] `pnpm run generate:importmap` (if admin components changed)
- [ ] Migration created with `pnpm payload migrate:create` (if D1 schema changed)
- [ ] Migration reviewed (additive-only preferred; destructive flagged in PR)
- [ ] Production D1 backup planned or completed before prod migration
- [ ] Staging or preview smoke test after migration
- [ ] Human approval recorded before production migration
- [ ] Post-deploy smoke test (read paths, admin edit, critical APIs)

## Related docs

- [AGENTS.md](../AGENTS.md) — agent stop conditions
- [security-and-migrations.md](./agent-loop/security-and-migrations.md) — migration guard and deprecated field patterns
- [hardening.md](./hardening.md) — release and CI guard index
