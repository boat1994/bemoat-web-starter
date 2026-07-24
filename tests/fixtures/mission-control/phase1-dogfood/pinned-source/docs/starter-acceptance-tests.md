# Starter acceptance tests

Starter acceptance tests prove the **child-facing harness** works from the perspective of a migrated child project. They complement the focused integration tests under `tests/int/` by validating public contracts in one place.

## Run locally

From the repository root:

```bash
pnpm run test:int
```

To run only the acceptance suite:

```bash
pnpm exec vitest run --config ./vitest.config.mts tests/int/starter-acceptance.int.spec.ts
```

In child projects after boilerplate sync, the same file is available and runs through `pnpm run bemoat:test:int`.

Starter maintainers should run the full gate before PR:

```bash
pnpm run check
```

## What is covered

| Scenario | Acceptance check |
|----------|------------------|
| Child-facing `bemoat:*` scripts exist | Required scripts in `package.json` and `managedPackageScripts` |
| Child-facing CI/hooks avoid raw script calls | Harness contract guard passes on `.github/workflows/ci.yml` and `.githooks/pre-push` |
| Guard pack runs from a clean checkout | `runGuardPack()` passes with readable success output |
| Failure output is understandable | Forbidden-script fixture reports file path, script name, and `bemoat:*` guidance |
| Simulated child minimal path | Fixture child gets missing `bemoat:*` scripts; harness contract passes; harness-only sync copies rails without seeding product code |
| Sync boundaries | `managedPaths` includes harness essentials; `seedOnlyPaths` and child-owned paths stay out of managed sync |

## Fixtures

- `tests/fixtures/acceptance/child-project/` — minimal child `package.json`, child-safe CI workflow, and pre-push hook used for simulated migration checks.
- `tests/fixtures/guard/harness-with-forbidden-scripts.yml` — reused for readable harness-contract failure output.

## Intentionally deferred

These gaps are by design for v1:

- Does **not** run real GitHub Actions workflows.
- Does **not** deploy to Cloudflare or exercise `wrangler`.
- Does **not** migrate a real child repository over the network.
- Does **not** run browser or Playwright e2e tests.
- Does **not** run the full guard pack against the minimal child fixture (product paths like `wrangler.jsonc` and frontend SEO are starter-specific).
- Does **not** validate every possible child customization or optional local scripts (`lint`, `build`, `check`).

See also: [harness-sync-contract.md](./harness-sync-contract.md), [guard-pack.md](./guard-pack.md), [child-project-migration-guide.md](./child-project-migration-guide.md).
