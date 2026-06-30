# Guards and tests

Detail: [guard-pack.md](../guard-pack.md), [starter-acceptance-tests.md](../starter-acceptance-tests.md).

## Central guard pack v1

Entry points:

- `pnpm run bemoat:guard:safety` — child CI / pre-push
- `pnpm run guard:safety` — starter-internal alias (same `guard-pack.mjs`)

Orchestrator runs guards in order: repo safety → harness contract → package manager → env placeholder → Cloudflare config → frontend SEO.

Standalone: `pnpm run bemoat:guard:harness-contract`, `pnpm run bemoat:guard:cloudflare-env`.

## Integration tests

| Command | Scope |
|---------|--------|
| `pnpm run test:int` / `bemoat:test:int` | All `tests/int/**/*.int.spec.ts` |
| `pnpm run check` | guard:safety + lint + typecheck + test:int (starter) |

Integration tests use an isolated wrangler persist directory (`.wrangler-test/state/v3` by default via `BEMOAT_TEST_WRANGLER_PERSIST` in `vitest.setup.ts`). `api.int.spec.ts` wipes only that path before booting Payload so dev D1 under `.wrangler/state` is never touched.

Notable specs: `guard-pack.int.spec.ts`, `harness-contract-guard.int.spec.ts`, `boilerplate-sync.int.spec.ts`, `starter-acceptance.int.spec.ts`.

## Starter acceptance suite v1

`tests/int/starter-acceptance.int.spec.ts` validates child-facing contracts in one place: required `bemoat:*` scripts, CI/hooks use namespaced scripts only, guard pack passes, harness-only sync boundaries.

Run alone:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/starter-acceptance.int.spec.ts
```

## Validation tiers (starter)

| Tier | When |
|------|------|
| `guard:safety` | Docs-only changes |
| `check` | Any code change before commit/PR — lint **zero warnings** |
| `check:full` | Human before merge when practical |

Child CI runs only `bemoat:guard:safety` + `bemoat:test:int`.

## Known gaps (v1)

- No AST Payload field-rename detection (rules + review only).
- `sitemap.ts` / `robots.ts` validated only when present.
- Package manager guard scans managed harness paths, not every child workflow.
- Acceptance suite does not run real GitHub Actions or Cloudflare deploy.

Full list: [guard-pack.md § Known gaps](../guard-pack.md#known-gaps-v1).
