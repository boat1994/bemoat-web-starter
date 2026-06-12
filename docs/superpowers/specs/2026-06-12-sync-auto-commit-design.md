# Sync Auto Commit Design

## Goal

Update `scripts/sync-boilerplate.mjs` so each sync run creates a single Git commit containing only the sync-managed files, `package.json`, and `.bemoat-boilerplate-sync.json`.

## Required Behavior

1. Before sync starts, detect whether the working tree has local changes.
2. If local changes exist, stash them before any sync file updates.
3. Run the existing sync flow:
   - clone the source boilerplate repo
   - copy every path in `managedPaths`
   - merge the managed `package.json` sections
   - write `.bemoat-boilerplate-sync.json`
4. After sync completes, stage only:
   - every entry in `managedPaths`
   - `package.json`
   - `.bemoat-boilerplate-sync.json`
5. Create a commit only when at least one of those staged paths changed.
6. After the commit step, restore the stashed local changes with `git stash pop`.

## Git Safety Rules

- Do not stage unrelated files.
- Do not use `git add -A`.
- If there were no pre-existing changes, skip stash creation and skip stash pop.
- If the scoped sync paths produce no diff, skip commit but still restore any stash that was created.
- If `git stash pop` conflicts, surface the Git error instead of hiding it.

## Implementation Shape

- Keep the sync entrypoint in `scripts/sync-boilerplate.mjs`.
- Extract small Git helper functions so the behavior can be tested without shelling through the whole sync flow.
- Make the module importable from Vitest without auto-running `main()`.

## Tests

- Add a focused test proving the script exposes the sync commit scope including `.bemoat-boilerplate-sync.json`.
- Add an integration-style test using a temporary Git repo that verifies:
  - pre-existing local changes are stashed
  - only scoped sync files are committed
  - the stash is popped back afterward
  - unrelated tracked changes are not included in the sync commit
