# Sync Auto Commit Plan

## Phase 1: Payload CMS (Backend / Data Layer)

- [ ] **No Payload schema changes**

## Phase 2: Next.js Server Components & Data Fetching

- [ ] **No Next.js route changes**

## Phase 3: Sync Script Behavior

- [ ] **`scripts/sync-boilerplate.mjs`** `[Agent: Pro]`
  - Export small Git helpers for:
    - working tree detection
    - optional stash push / stash pop
    - scoped `git add`
    - scoped diff detection
    - scoped commit creation
  - Keep sync scope exact:
    - all `managedPaths`
    - `package.json`
    - `.bemoat-boilerplate-sync.json`
  - Guard module entry so tests can import helpers without running `main()`.
  - In `main()`:
    - optionally stash local changes
    - run existing sync copy / merge behavior
    - stage scoped paths only
    - commit only if scoped staged diff exists
    - restore stash in a `finally` path when one was created

## Phase 4: Tests

- [ ] **`tests/int/boilerplate-sync.int.spec.ts`** `[Agent: Pro]`
  - Add a failing test for exported sync commit scope.
  - Add a temporary-repo test that:
    - initializes Git
    - seeds tracked files for one managed path, one unrelated path, `package.json`, and `.bemoat-boilerplate-sync.json`
    - creates unrelated local changes before the sync commit helper runs
    - simulates sync-written content on scoped files
    - verifies the sync commit contains only scoped files
    - verifies unrelated local changes still exist after stash pop

## Phase 5: Verification

- [ ] **Commands** `[Agent: Pro]`
  - Run `pnpm run test:int -- --run tests/int/boilerplate-sync.int.spec.ts` if supported, otherwise run `pnpm exec vitest run --config ./vitest.config.mts tests/int/boilerplate-sync.int.spec.ts`
  - Run `pnpm exec tsc --noEmit`
