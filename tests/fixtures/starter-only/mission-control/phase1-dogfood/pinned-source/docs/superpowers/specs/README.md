# Specs

Specs are decision artifacts. They define what a feature should do, what direction it should follow, and what constraints future implementation must respect.

## Organize by feature

Do not let the root `specs/` folder become a flat document dump. New work should be grouped by project, initiative, and feature:

```text
docs/superpowers/specs/{project}/{initiative}/{feature}/
```

Example:

```text
docs/superpowers/specs/acme/launch/homepage/
  product-spec.md
  ux-ui-spec.md
  reference-pattern-handoff.md
  visual-direction-spec.md
  composer-handoff.md
```

## Use `_templates/` for reusable formats

The `_templates/` folder is the reusable starter baseline. Copy a template into the feature folder, then edit the copied file for that feature.

Do not treat `_templates/` as a place for feature-specific decisions.

## What belongs in specs

Common spec artifacts include:

- product scope and positioning
- UX reading flow and layout intent
- reference interpretation and pattern borrowing notes
- visual direction and anti-pattern guidance
- agent handoff constraints and boundaries

If a document tells the team what to build or what decisions are locked in, it belongs in `specs/`.
