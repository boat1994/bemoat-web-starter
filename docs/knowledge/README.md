# Starter knowledge base

Short operational notes for coding agents. Read this index before editing `bemoat-web-starter` or reasoning about harness sync.

**Not a replacement** for ADRs, the operating manual, or contract docs — follow links when you need full detail.

## When to read what

| Situation | Start here |
|-----------|------------|
| New task / issue | [review-and-pr.md](./review-and-pr.md), [operating-manual.md](../agent-loop/operating-manual.md) |
| Starter vs child decision | [architecture.md](./architecture.md), [source-of-truth.md](../agent-loop/source-of-truth.md) |
| Which command to run | [package-scripts.md](./package-scripts.md), [guards-and-tests.md](./guards-and-tests.md) |
| Sync or migration | [harness-sync.md](./harness-sync.md), [child-project-migration-guide.md](../child-project-migration-guide.md) |
| CI failed or guard failed | [common-failures.md](./common-failures.md) |
| Deploy / Cloudflare | [deployment.md](./deployment.md), [environment.md](./environment.md) |

## Notes

| Note | One-line purpose |
|------|------------------|
| [architecture.md](./architecture.md) | Stack, starter vs child ownership |
| [package-scripts.md](./package-scripts.md) | `bemoat:*` vs starter-internal scripts |
| [harness-sync.md](./harness-sync.md) | Sync modes, path lists, metadata |
| [guards-and-tests.md](./guards-and-tests.md) | Guard pack, int tests, validation tiers |
| [ci-and-hooks.md](./ci-and-hooks.md) | Child CI vs starter strict CI, pre-push |
| [deployment.md](./deployment.md) | Cloudflare assumptions, child-owned config |
| [environment.md](./environment.md) | `.env.example`, secrets, IDs |
| [common-failures.md](./common-failures.md) | Symptom → fix table |
| [coding-conventions.md](./coding-conventions.md) | Diff size, scope, conventions |
| [review-and-pr.md](./review-and-pr.md) | Branch → PR → issue report loop |

## Source docs (authoritative)

| Doc | Use for |
|-----|---------|
| [AGENTS.md](../../AGENTS.md) | Full agent rules and validation tiers |
| [operating-manual.md](../agent-loop/operating-manual.md) | Model roles, loop, stop rules |
| [harness-sync-contract.md](../harness-sync-contract.md) | Harness definition and maintainer rules |
| [guard-pack.md](../guard-pack.md) | Guard coverage and known gaps |
| [adr/README.md](../adr/README.md) | Why decisions exist |
| [child-project-migration-guide.md](../child-project-migration-guide.md) | Child harness migration playbook |
