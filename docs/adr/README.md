# Architecture Decision Records (ADR)

Short decision records for core Bemoat starter choices. Each ADR captures **why** the system works this way so agents and child projects can reason without re-reading every doc.

## Status legend

| Status | Meaning |
|--------|---------|
| **accepted** | Current practice; reflected in repo behavior |
| **proposed** | Direction stated but not fully enforced or still evolving |
| **superseded** | Replaced by a later ADR (none yet) |
| **deprecated** | No longer recommended (none yet) |

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-starter-source-of-truth.md) | Starter as source of truth for reusable infrastructure | accepted |
| [0002](./0002-bemoat-script-contract.md) | Child-facing automation uses `bemoat:*` scripts only | accepted |
| [0003](./0003-narrow-harness-sync.md) | Harness sync is narrow, explicit, and list-driven | accepted |
| [0004](./0004-central-guard-pack.md) | Central guard pack v1 for reusable safety checks | accepted |
| [0005](./0005-pr-based-harness-migration.md) | Harness changes flow through PRs; children sync harness-only by default | accepted |
| [0006](./0006-stop-overbuild-early.md) | Stop overbuild before commit | accepted |
| [0007](./0007-docs-and-tests-as-durable-assets.md) | Docs and harness tests are durable, synced assets | accepted |

## Related docs

These ADRs summarize decisions also detailed in:

- [docs/agent-loop/source-of-truth.md](../agent-loop/source-of-truth.md)
- [docs/harness-sync-contract.md](../harness-sync-contract.md)
- [docs/guard-pack.md](../guard-pack.md)
- [docs/agent-loop/operating-manual.md](../agent-loop/operating-manual.md)

When an ADR and a detailed doc disagree, **repo behavior and the detailed contract doc win** until an ADR is updated.
