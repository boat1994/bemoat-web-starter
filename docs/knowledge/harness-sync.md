# Harness and sync

Full contract: [harness-sync-contract.md](../harness-sync-contract.md). Child migration: [child-project-migration-guide.md](../child-project-migration-guide.md).

## What “harness” means

Agent rules, child-safe CI, guards, sync/drift scripts, git hooks, Vitest config, and shared `tests/int/**/*.int.spec.ts` — everything a child needs to run the same safety rails without copying product code.

**Not harness:** `src/collections`, frontend pages, `payload.config.ts`, `wrangler.jsonc`, `README.md`, lockfile.

## Sync modes

| Mode | Flag | Use when |
|------|------|----------|
| **Harness-only** (default) | `--harness-only` | Existing child with its own app/schema |
| **Full** | `--full` | New child still missing starter seed files |

```bash
pnpm run boilerplate:check -- --harness-only   # audit first
pnpm run boilerplate:sync -- --harness-only    # apply rails
```

CLI flags beat `BEMOAT_SYNC_MODE`. Pin starter ref with `BEMOAT_BOILERPLATE_REF` for production syncs — see [releases.md](../releases.md).

## Path lists (in `scripts/sync-boilerplate.mjs`)

| List | Behavior |
|------|----------|
| `managedPaths` | Overwritten every sync |
| `seedOnlyPaths` | Skipped in harness-only; copied when missing in full mode |
| `mergeKeepPaths` | `.gitignore` — merge, do not replace |
| `managedPackageScripts` | Add missing `bemoat:*` only |

## After sync

1. Review `.bemoat/package-sync-proposal.md` — script/dependency drift is **human review only**, never auto-applied.
2. Check `.bemoat-boilerplate-sync.json` for `syncMode` and `seedOnlyPathsSkipped`.
3. Run `pnpm run bemoat:guard:safety` and `pnpm run bemoat:test:int` in the child.

## Maintainer checklist (new harness file)

1. Add path to `managedPaths` (or document as starter-only in `STARTER_ONLY_INT_TESTS`).
2. Extend `tests/int/boilerplate-sync.int.spec.ts` if needed.
3. If child-facing automation: add to `CHILD_FACING_HARNESS_PATHS` in `guard-harness-contract.mjs`.

## Related ADRs

- [0003](../adr/0003-narrow-harness-sync.md) — narrow, list-driven sync
- [0005](../adr/0005-pr-based-harness-migration.md) — PR-based child migration
