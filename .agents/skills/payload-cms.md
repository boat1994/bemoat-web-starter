# Payload CMS Skill

Use this lightweight fallback when Payload CMS collections, globals, fields,
hooks, access control, endpoints, migrations, admin components, or generated
types are in scope and native Payload skills are unavailable.

This file intentionally does not duplicate the full Payload rule set. The
source of truth remains:

- `AGENTS.md`
- `.cursor/rules/payload-overview.md`
- `.cursor/rules/security-critical.mdc`
- `.cursor/rules/collections.md`
- `.cursor/rules/fields.md`
- `.cursor/rules/access-control.md`
- `.cursor/rules/hooks.md`
- `.cursor/rules/queries.md`
- `.cursor/rules/endpoints.md`
- `.cursor/rules/components.md`
- `docs/schema-evolution.md`
- `docs/agent-loop/security-and-migrations.md`

## Required Safety Rules

- When passing `user` to Payload Local API calls, set
  `overrideAccess: false`.
- In hooks, pass `req` to nested Payload operations.
- Use context flags to avoid hook loops.
- Do not rename existing fields that may contain production data.
- Do not directly change existing field types, relationship targets, or
  relationship cardinality.
- Prefer additive schema changes, backfills, read fallbacks, and explicit human
  review before deletion.

## Required Validation

- Payload schema changes: `pnpm run check` and `pnpm run generate:types`.
- Admin component changes: `pnpm run check` and
  `pnpm run generate:importmap`.
- Migration files: follow `docs/agent-loop/migration-draft-pr.md` and open a
  draft PR only.

