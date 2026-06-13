# Changelog

All notable changes to the reusable **bemoat-web-starter** boilerplate layer are documented here. Child projects should read the section for their target sync ref before running `pnpm run boilerplate:sync`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version tags use semver with an optional theme suffix (see [docs/releases.md](./docs/releases.md)).

## Unreleased

### Added

- Boilerplate versioning policy in [docs/releases.md](./docs/releases.md)
- This changelog with release and sync guidance for child projects
- [docs/harness-sync-contract.md](./docs/harness-sync-contract.md) — harness scope, shared tests, and package manifest ownership rules

### Changed

- README and source-of-truth docs now reference version tags as stable sync points
- Boilerplate sync treats `package.json` as child-owned: only missing `bemoat:*` scripts are added automatically; recommended scripts and dependencies are surfaced in `.bemoat/package-sync-proposal.md`

## v0.3.0-sync-rails

> **Draft** — tag not yet published. Intended stable sync point for boilerplate sync rails and post-sync workflow. Sync with:
>
> `BEMOAT_BOILERPLATE_REF=v0.3.0-sync-rails pnpm run boilerplate:sync`

### Added

- `pnpm run boilerplate:sync` and `scripts/sync-boilerplate.mjs` managed path list
- Automatic git commit for sync-managed files after each sync
- Stash/restore behavior for local changes outside managed paths
- `.bemoat-boilerplate-sync.json` tracking of last sync ref

### Changed

- README documents sync scope, post-sync steps, and `BEMOAT_BOILERPLATE_REF` / `BEMOAT_BOILERPLATE_REPO` overrides

### Notes for child projects

- After syncing to this tag, run `pnpm install`, `generate:importmap`, `generate:types`, and `payload migrate:create`, then review migrations before deploy.
- Project-specific files (`wrangler.jsonc`, D1 IDs, R2 buckets, secrets) are never overwritten by sync.
