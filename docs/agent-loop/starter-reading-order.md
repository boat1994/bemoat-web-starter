# Starter reading order (agents)

Read in this order when picking up work on **`bemoat-web-starter`** or reasoning about harness sync. Skip sections you already applied this session.

| # | Doc | When to read | Why it matters | Link |
|---|-----|--------------|----------------|------|
| 1 | **Operating Manual** | Every new task or issue | Model roles, loop, validation tiers, stop rules, prompt seed | [operating-manual.md](./operating-manual.md) |
| 2 | **Child Project Migration Guide** | Child harness PR, `boilerplate:sync`, drift in a child repo | Audit vs sync, allowed/forbidden diffs, rollback, readiness gates | [child-project-migration-guide.md](../child-project-migration-guide.md) |
| 3 | **ADR index** | Architectural “why” or starter-vs-child disputes | Short decisions behind source-of-truth, `bemoat:*`, narrow sync, guards | [adr/README.md](../adr/README.md) |
| 4 | **Knowledge Base** | Quick “which command / what failed” lookup | Operational notes; links to authoritative docs | [knowledge/README.md](../knowledge/README.md) |
| 5 | **Guard pack** | Before changing guards, CI hooks, or `bemoat:guard:*` | Coverage, false positives, known gaps, fix table | [guard-pack.md](../guard-pack.md) |
| 6 | **Acceptance test docs** | Before changing harness tests or sync boundaries | What child path is proven; intentional deferrals | [starter-acceptance-tests.md](../starter-acceptance-tests.md) |

## Also keep open

- [AGENTS.md](../../AGENTS.md) — validation tiers, commit/PR workflow, schema stop conditions
- [harness-sync-contract.md](../harness-sync-contract.md) — managed vs seed-only paths (detail behind ADR 0003)
- [source-of-truth.md](./source-of-truth.md) — starter vs child ownership table

## Operating handoff

Starter context and Day 16 history: [starter-operating-handoff.md](../starter-operating-handoff.md). P0 red-team: [p0-red-team-review.md](../p0-red-team-review.md).
