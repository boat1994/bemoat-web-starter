# Mission Control project overrides (example)

Copy this file to `.bemoat/mission-control-overrides.md` in a child repository.
That live path is **child-owned** and must never be listed in harness
`managedPaths`. Overrides may only add or narrow requirements; they must not
relax shared invariants from
[mission-control-guide.md](./mission-control-guide.md).

## Permitted override content

- approved base/integration branch
- Implementation Plan location conventions
- deployment environments and required gates
- manual QA requirements
- project-specific protected/forbidden paths
- project-specific required checks
- Founder/contact/escalation conventions
- whether a release/deploy approval is required after merge

## Forbidden override content

- review cycles greater than or fewer than the shared budget without an explicit upstream policy change
- treating Minor/Nit as blockers
- removing exact-head checks
- permitting auto-merge
- allowing destructive migrations or production deploy without approval
- making chat history authoritative
- permitting silent state resets

If an override conflicts with the shared guide, Mission Control returns
`STATE CONFLICT` and stops.

## Example skeleton

```yaml
approved_base: main
implementation_plan_root: docs/superpowers/plans/
required_checks:
  - pnpm run bemoat:guard:safety
manual_qa:
  - Smoke the affected route on mobile and desktop
protected_paths:
  - wrangler.jsonc
founder_contact: "@founder"
require_deploy_approval_after_merge: true
```
