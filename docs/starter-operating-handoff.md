# Starter operating handoff

Compact handoff for the **starter operating system**: harness contract, guard pack, agent manual, ADRs, child migration playbook, acceptance tests, and knowledge base (built during Day 16).

**Start new work from:** latest `main`.

## Day 16 deliverables

### Key files added or materially updated

| Area | Paths |
|------|-------|
| Harness contract | `docs/harness-sync-contract.md`, `scripts/guard-harness-contract.mjs`, `scripts/sync-boilerplate.mjs` |
| Guard pack v1 | `scripts/guard-pack.mjs`, `scripts/guard-*.mjs`, `docs/guard-pack.md`, `tests/int/guard-pack.int.spec.ts`, `tests/fixtures/guard/**` |
| Operating manual | `docs/agent-loop/operating-manual.md` |
| ADR pack | `docs/adr/0001`–`0007`, `docs/adr/README.md` |
| Migration guide | `docs/child-project-migration-guide.md` |
| Acceptance suite | `tests/int/starter-acceptance.int.spec.ts`, `tests/fixtures/acceptance/child-project/**`, `docs/starter-acceptance-tests.md` |
| Knowledge base | `docs/knowledge/**` |

## Closed Day 16 issues

| Issue | Title | PR | Priority |
|-------|-------|-----|----------|
| [#26](https://github.com/boat1994/bemoat-web-starter/issues/26) | Harden harness contract | [#29](https://github.com/boat1994/bemoat-web-starter/pull/29) | P0 |
| [#27](https://github.com/boat1994/bemoat-web-starter/issues/27) | Central guard and test pack v1 | [#30](https://github.com/boat1994/bemoat-web-starter/pull/30) | P0 |
| [#28](https://github.com/boat1994/bemoat-web-starter/issues/28) | Agent Operating Manual v1 | [#35](https://github.com/boat1994/bemoat-web-starter/pull/35) | P1 |
| [#31](https://github.com/boat1994/bemoat-web-starter/issues/31) | Starter ADR pack v1 | [#36](https://github.com/boat1994/bemoat-web-starter/pull/36) | P1 |
| [#32](https://github.com/boat1994/bemoat-web-starter/issues/32) | Child Project Migration Guide v1 | [#37](https://github.com/boat1994/bemoat-web-starter/pull/37) | P0 |
| [#33](https://github.com/boat1994/bemoat-web-starter/issues/33) | Starter Acceptance Test Suite v1 | [#38](https://github.com/boat1994/bemoat-web-starter/pull/38) | P0 |
| [#34](https://github.com/boat1994/bemoat-web-starter/issues/34) | Starter Knowledge Base v1 | [#39](https://github.com/boat1994/bemoat-web-starter/pull/39) | P1 |

## Day 16 validation

Starter PRs ran CI (`ci-starter.yml`): `guard:safety` → lint → typecheck → `test:int` (and build where applicable).

| Tier | Command | When |
|------|---------|------|
| Docs-only | `pnpm run guard:safety` | Markdown / CI config only |
| Code | `pnpm run check` | Scripts, tests, TS changes |
| Child-facing alias | `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int` | Same pack/tests via `bemoat:*` contract |

## What to read first

See [starter-reading-order.md](./agent-loop/starter-reading-order.md).

## P0 red-team (human / GPT-5.5)

Only [#27](https://github.com/boat1994/bemoat-web-starter/issues/27), [#32](https://github.com/boat1994/bemoat-web-starter/issues/32), [#33](https://github.com/boat1994/bemoat-web-starter/issues/33). Details: [p0-red-team-review.md](./p0-red-team-review.md).

**Verdict:** Schedule high-model review on P0 items before first child harness migration PR.

## Remaining risks

| Risk | Mitigation |
|------|------------|
| Guard pack v1 gaps (no AST schema rename, partial workflow scan) | Agent rules + PR checklist; follow-up issues if needed |
| Acceptance tests do not run real CI, deploy, or e2e | By design; child migration still needs human PR review |
| Closed Day 16 issues still carry `status:ready` | Cosmetic label drift — see below |
| `#27` is P0 but lacks `review:high-model` label | Treat as red-team required anyway (see red-team doc) |
| First real child harness migration untested end-to-end | Use migration guide + acceptance fixtures as gate |

## High-model review items

| Item | Label on issue | Action |
|------|----------------|--------|
| Guard pack (#27) | `priority:p0` only | **Red-team before child sync** — label gap |
| Migration guide (#32) | `review:high-model` | Human/GPT-5.5 review before first child migration |
| Acceptance suite (#33) | `review:high-model` | Human/GPT-5.5 review before relying on suite alone |
| ADR pack (#31), Knowledge base (#34) | `review:optional-high-model` | Review when changing ADRs or KB structure |
| Operating manual (#28) | none | Optional review on process changes |

## Label sanity checklist

**Scope:** verify label conventions on remaining work. **Do not change labels** unless explicitly instructed.

### Expected semantics

| Label | Meaning |
|-------|---------|
| `review:high-model` | GPT-5.5 / high reasoning review **required** before merge or first use |
| `review:optional-high-model` | Review when touching that area; not a hard gate |
| `status:ready` | Issue scoped and ready for an agent to pick up |
| `priority:p0` | Safety, harness contract, migration, or acceptance — blocks trust if wrong |
| `priority:p1` | Important docs/process; does not block harness adoption |

### Open issues (as of handoff)

| Check | Result |
|-------|--------|
| Open issues exist | **None** — no active label mismatches on open work |

### Closed Day 16 issues — flags only

| Issue | Labels present | Flag |
|-------|----------------|------|
| #26 | `priority:p0`, `status:ready` | `status:ready` on **closed** issue — stale |
| #27 | `priority:p0`, `status:ready` | Missing `review:high-model` for P0 guard; `status:ready` stale |
| #28 | `priority:p1`, `status:ready` | `status:ready` stale |
| #31 | `priority:p1`, `review:optional-high-model`, `status:ready` | `status:ready` stale |
| #32 | `priority:p0`, `review:high-model`, `status:ready` | `status:ready` stale |
| #33 | `priority:p0`, `review:high-model`, `status:ready` | `status:ready` stale |
| #34 | `priority:p1`, `review:optional-high-model`, `status:ready` | `status:ready` stale |

**Summary:** Priority and review labels match intent except **#27 missing `review:high-model`**. All closed issues still show `status:ready` — document only; no label edits in this handoff.

## Composer workflow prompt

Paste-ready prompt: [composer-issue-workflow-prompt.md](./agent-loop/composer-issue-workflow-prompt.md).

## Related entrypoints

- [docs/agent-loop/README.md](./agent-loop/README.md) — agent loop index
- [AGENTS.md](../AGENTS.md) — full rules and validation tiers
