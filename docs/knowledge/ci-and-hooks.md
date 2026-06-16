# CI and pre-push

## Child-safe CI (synced)

File: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — synced to children via `managedPaths`.

Steps:

1. `pnpm install --frozen-lockfile`
2. `pnpm run bemoat:guard:safety`
3. `pnpm run bemoat:test:int`

**Never** add raw script calls (`lint`, `check`, `guard:safety`, `test:int`, `build`, etc.) to this workflow. The harness contract guard enforces this.

## Starter strict CI (not synced)

File: [`.github/workflows/ci-starter.yml`](../../.github/workflows/ci-starter.yml) — runs only on `boat1994/bemoat-web-starter`.

Adds: `generate:importmap`, `generate:types`, `lint`, `typecheck`, `test:int`, `build`.

Starter maintainers: local `pnpm run check` before PR; CI strict workflow is the GitHub backstop.

## Pre-push hook (optional)

Install: `pnpm run hooks:install` (or `bemoat:hooks:install` in children).

[`.githooks/pre-push`](../../.githooks/pre-push) runs:

- `pnpm run bemoat:guard:safety`
- `pnpm run bemoat:test:int`

Does **not** run lint, typecheck, or build. CI remains authoritative.

## Rules for maintainers

| Do | Don't |
|----|-------|
| Call `bemoat:*` from synced CI and pre-push | Call `guard:safety`, `check`, `lint` from child-facing automation |
| Add new child-facing paths to `CHILD_FACING_HARNESS_PATHS` | Assume child has `lint` / `build` / `check` scripts |
| Use pnpm in workflows (`pnpm/action-setup`) | Commit `package-lock.json` or use npm/yarn in harness workflows |

PR/issue templates may mention raw scripts as **human instructions** — they are not scanned.

## Related

- [ADR 0002](../adr/0002-bemoat-script-contract.md)
- [common-failures.md](./common-failures.md) — CI/guard failures
