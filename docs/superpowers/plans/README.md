# Plans

Plans are execution artifacts. They describe how a feature will be implemented, verified, and delivered based on already-written specs.

## Organize by feature

Do not keep new plans as a flat list in the root `plans/` folder. Group them by project, initiative, and feature:

```text
docs/superpowers/plans/{project}/{initiative}/{feature}/
```

Example:

```text
docs/superpowers/plans/acme/launch/homepage/
  implementation-plan.md
  verification-plan.md
```

## Plans must reference exact inputs

Every implementation or verification plan should point to concrete spec files by exact path.

Good:

```text
Required inputs:
- docs/superpowers/specs/acme/launch/homepage/product-spec.md
- docs/superpowers/specs/acme/launch/homepage/ux-ui-spec.md
```

Avoid vague references such as:

- "the UX contract"
- "the design document"
- "the handoff"

If a plan depends on a document, include the exact file path.

## Use `_templates/` for reusable execution formats

The `_templates/` folder is the starter baseline for implementation and verification planning. Copy templates into feature folders and adapt them there.
