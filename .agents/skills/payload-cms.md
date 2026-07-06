# Payload CMS Skill

Use this lightweight fallback when Payload CMS collections, globals, fields,
hooks, access control, endpoints, migrations, admin components, or generated
types are in scope and native Payload skills are unavailable.

This file intentionally does not duplicate the full Payload rule set. The
canonical Payload rule set remains:

- `.cursor/rules/payload-overview.md`
- `.cursor/rules/security-critical.mdc`
- `.cursor/rules/collections.md`
- `.cursor/rules/fields.md`
- `.cursor/rules/access-control-advanced.md`
- `.cursor/rules/access-control.md`
- `.cursor/rules/hooks.md`
- `.cursor/rules/queries.md`
- `.cursor/rules/endpoints.md`
- `.cursor/rules/components.md`
- `.cursor/rules/adapters.md`
- `.cursor/rules/field-type-guards.md`
- `.cursor/rules/plugin-development.md`
- `docs/schema-evolution.md`
- `docs/agent-loop/security-and-migrations.md`

Use `AGENTS.md` only as the repository-wide routing and safety entrypoint.

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
- Ensure roles exist when modifying collections or globals with access controls.

## Required Validation

- Payload schema changes: `pnpm run check` and `pnpm run generate:types`.
- Admin component changes: `pnpm run check` and
  `pnpm run generate:importmap`.
- Migration files: follow `docs/agent-loop/migration-draft-pr.md` and open a
  draft PR only.
