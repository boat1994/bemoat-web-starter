# Mission Control

Version-controlled Mission Control policy for Bemoat repositories. The starter
owns the shared guide; child projects may add
`.bemoat/mission-control-overrides.md` without relaxing shared invariants.

## Reading order

1. [mission-control-guide.md](./mission-control-guide.md) — canonical policy
2. [handoff-template.md](./handoff-template.md) / [result-template.md](./result-template.md) — full field checklists
3. [../agent-loop/role-handoff-contract.md](../agent-loop/role-handoff-contract.md) — compact GitHub comment transport
4. [project-overrides.example.md](./project-overrides.example.md) — child override contract
5. [../../prompts/mission-control/chatgpt-project-loader.md](../../prompts/mission-control/chatgpt-project-loader.md) — ChatGPT Project bootstrap

## Canonical versus thin entrypoints

| Entrypoint | Role |
| --- | --- |
| `docs/mission-control/mission-control-guide.md` | Only long-form policy |
| `prompts/mission-control/chatgpt-project-loader.md` | Short loader; must not duplicate policy |
| `AGENTS.md` | Pointer only |
| ChatGPT Project instructions | Paste the loader only |

## Copy the loader into ChatGPT Project

1. Open [chatgpt-project-loader.md](../../prompts/mission-control/chatgpt-project-loader.md).
2. Copy the full file into ChatGPT Project instructions.
3. Do not paste the guide itself into Project instructions.
4. Until this guide is merged to the approved protected base, treat the **merged** base guide as operating policy (not an unmerged feature branch).

## Child override

1. Copy [project-overrides.example.md](./project-overrides.example.md) to `.bemoat/mission-control-overrides.md` in the child repo.
2. Fill only permitted fields.
3. Never add the live override path to `managedPaths`. Harness sync must preserve it unchanged.

## Migrate an existing active task

If an active Core task lacks a valid Mission Control state block:

1. Reconstruct completed review rounds from Issue/PR comments when evidence is clear.
2. Write the marker block with reconstructed `review_cycle` and `last_reviewed_head`.
3. If reconstruction is ambiguous, ask the Founder once for the starting cycle.
4. Do not silently grant a fresh three-cycle budget.

See guide section **Existing-task migration behavior**.

## Version the policy

Frontmatter `version` uses semver:

- Patch: editorial clarification, no behavior change
- Minor: backward-compatible policy or template addition
- Major: incompatible state-machine, role, review-budget, severity, or completion behavior

Do not hardcode a source commit SHA in the guide file.

## Test and sync

```bash
pnpm run guard:mission-control-contract
pnpm run guard:safety
pnpm exec vitest run tests/int/mission-control-contract.int.spec.ts
pnpm exec vitest run tests/int/boilerplate-sync.int.spec.ts
```

Child projects pull updates with:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

## Manual dogfood checklist (Founder)

After merge, verify (not automated in the starter PR):

1. Fresh Project bootstrap with loader only
2. Small correction → Review 2 delta (not full re-review)
3. Review 3 nit → follow-up + eligible for Founder Review
4. Verified blocker after Review 3 → blocked for Founder, no Review 4
5. Material change → stop for Founder decision
6. New session mid-task continues recorded cycle
7. Child sync preserves `.bemoat/mission-control-overrides.md` (covered by sync int tests)
