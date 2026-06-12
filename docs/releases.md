# Boilerplate releases and versioning

`bemoat-web-starter` is the **source of truth** for reusable Bemoat web infrastructure. Child projects pull updates through `pnpm run boilerplate:sync`. This document explains how branches, tags, and changelogs fit together so sync stays predictable across many projects.

## Policy overview

| Ref type | Role | When child projects should use it |
|----------|------|-----------------------------------|
| **`main`** | Fast-moving source of truth. New shared work lands here first. | Active development, early adoption, or when you need a fix that is not yet tagged. |
| **Version tags** | Stable sync points with documented changes. | Production updates, scheduled maintenance, or any sync where you want a known, reviewable baseline. |

**`main` is always the latest shared code**, but it can include work that has not been through a formal release review. **Version tags mark points you can sync to deliberately**—with a changelog entry and a name that communicates scope.

### Child project guidance

- **During active development** on a child project, syncing from `main` is fine when you want the newest shared schema, pages, or agent docs.
- **Before production deploys or on a regular maintenance cadence**, sync from a **version tag** instead of `main`. Read the matching `CHANGELOG.md` section first, run migrations locally, and test before deploy.
- **Never copy** Cloudflare resource IDs, secrets, or `.env` files between projects. Version tags only affect boilerplate-managed paths; project-specific infrastructure stays in each child repo.

## Tag naming

Tags use [Semantic Versioning](https://semver.org/) with an optional **theme suffix** that describes the release focus. The suffix is informational; the numeric part still follows semver rules.

Suggested examples for early boilerplate history:

| Tag | Intended meaning |
|-----|------------------|
| `v0.1.0-foundation` | Initial reusable Payload + Cloudflare starter layer |
| `v0.2.0-agent-loop` | Agent workflow, docs, and GitHub templates |
| `v0.3.0-sync-rails` | Boilerplate sync script, managed paths, and post-sync workflow |
| `v1.0.0-stable` | First semver-stable baseline for production child projects |

Future tags should continue the pattern: `v<major>.<minor>.<patch>-<theme>` when a theme helps operators choose the right sync point (for example `v1.1.0-blog-schema`).

## Syncing from a version tag

The sync script accepts any git ref via `BEMOAT_BOILERPLATE_REF`. Default is `main`.

**Example — sync from a stable tag:**

```bash
BEMOAT_BOILERPLATE_REF=v0.3.0-sync-rails pnpm run boilerplate:sync
```

**Example — sync from `main` (default):**

```bash
pnpm run boilerplate:sync
```

**Example — sync from another branch:**

```bash
BEMOAT_BOILERPLATE_REF=dev pnpm run boilerplate:sync
```

After every sync, follow the post-sync steps in the root [README.md](../README.md#after-every-sync): install dependencies, regenerate Payload artifacts, create and review migrations, then test locally before deploy.

## Changelog policy

- **[CHANGELOG.md](../CHANGELOG.md)** records what changed in each release.
- **`Unreleased`** holds changes on `main` that are not yet tagged.
- When maintainers cut a release, they move items from `Unreleased` into a new version section, create the git tag (outside routine doc PRs), and child projects can point `BEMOAT_BOILERPLATE_REF` at that tag.

This PR documents the policy only; **tags are not created automatically** when changelog sections are drafted.

## Maintainer release checklist

1. Ensure `main` is green in CI.
2. Move `Unreleased` entries in `CHANGELOG.md` into a new `vX.Y.Z-theme` section with the release date.
3. Create and push the annotated tag `vX.Y.Z-theme` on the release commit (human step; not part of every docs PR).
4. Notify child project owners which tag to sync for production updates.

## Related docs

- [README.md](../README.md) — boilerplate sync command and post-sync workflow
- [docs/agent-loop/source-of-truth.md](./agent-loop/source-of-truth.md) — what lives in the starter vs child projects
- [CHANGELOG.md](../CHANGELOG.md) — per-release notes
