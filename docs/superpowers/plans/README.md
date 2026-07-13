# Plans

Plans are execution artifacts. They describe how a feature will be implemented, verified, and delivered based on already-written specs.

## Plan versus Main Issue boundaries

For Core or multi-stage initiatives:

- The **Implementation Plan** is the canonical roadmap and execution contract: Tasks, Slices, ordering, dependencies, contracts, deliverables, and verification requirements.
- The **Main GitHub Issue checklist** is the canonical durable project-stage tracker across sessions.
- `.superpowers/sdd/progress.md` is temporary local/session execution state only.

The plan must not become a duplicate current-state dashboard. Task-step checkboxes inside a plan are execution instructions, not the durable cross-session tracker.

Small tasks do not require a full plan or parent progress issue. See [project-progress-tracking.md](../../agent-loop/project-progress-tracking.md).

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
