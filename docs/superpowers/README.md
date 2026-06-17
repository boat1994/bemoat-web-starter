# Superpowers Documentation

This folder holds reusable planning artifacts for projects created from `bemoat-web-starter`.

Use it to keep product, design, and implementation work organized by feature instead of dropping every document into one flat directory.

## What lives here

- `specs/`: decision artifacts such as product scope, UX/UI direction, visual interpretation, reference handoff, and composer handoff.
- `plans/`: execution artifacts such as implementation plans, verification plans, and other delivery checklists.
- `_templates/`: reusable boilerplate formats that child repos can copy into feature folders and adapt locally.

## Recommended folder convention

```text
docs/superpowers/specs/{project}/{initiative}/{feature}/
docs/superpowers/plans/{project}/{initiative}/{feature}/
```

Example:

```text
docs/superpowers/specs/acme/launch/homepage/
docs/superpowers/plans/acme/launch/homepage/
```

## Folder responsibilities

### `specs/`

Use `specs/` for planning documents that define what should be built and why.

Typical files include:

- `product-spec.md`
- `ux-ui-spec.md`
- `reference-pattern-handoff.md`
- `visual-direction-spec.md`
- `composer-handoff.md`
- `feature-readme.md`

### `plans/`

Use `plans/` for documents that explain how work will be executed and verified.

Typical files include:

- `implementation-plan.md`
- `verification-plan.md`
- execution checklists that point back to exact spec file paths

### `_templates/`

Use `_templates/` as the starter-owned source for reusable formats. Child repos should copy templates into their feature folders and then customize the copied files there.

## Reading order for a feature

Recommended order when reviewing a feature:

1. Product Spec
2. UX/UI Specification
3. Reference Pattern Handoff
4. Visual Direction Spec
5. Composer Handoff
6. Implementation Plan
7. Verification Plan

## Starter safety notes

- Do not dump all future specs directly into `docs/superpowers/specs/`.
- Do not dump all future plans directly into `docs/superpowers/plans/`.
- Copy templates into child feature folders before editing them.
- Keep child-project strategy, messaging, and business decisions inside child-project feature folders.
- Do not backport child-project-specific decisions into starter root docs unless they become reusable starter guidance.

## Legacy files

Older top-level files may still exist from earlier planning work. Treat them as historical artifacts and use the project/initiative/feature folder convention for new work.
