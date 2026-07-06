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

- Follow `AGENTS.md#validation-before-pr-and-merge`; do not assume raw
  non-namespaced scripts exist in child projects.
- In `bemoat-web-starter`: Payload schema changes require `pnpm run check` and
  `pnpm run generate:types`; admin component changes require `pnpm run check`
  and `pnpm run generate:importmap`.
- In child projects: use the child code tier from `AGENTS.md` first
  (`pnpm run bemoat:check` when the child supports its local `lint` and
  `typecheck` scripts; otherwise `pnpm run bemoat:guard:safety`,
  `pnpm run bemoat:test:int`, and the child-owned code checks that exist).
  Then run child-owned `generate:types` or `generate:importmap` scripts when
  they are present and the change requires them.
- Migration files: follow `docs/agent-loop/migration-draft-pr.md` and open a
  draft PR only.
