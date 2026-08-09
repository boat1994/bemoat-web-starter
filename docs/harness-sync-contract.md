# Harness sync contract

This document defines what **harness** means in Bemoat boilerplate sync and how to keep the contract complete when adding new shared rails.

## What "harness" includes

The harness is everything child projects need to run the same safety rails, workflow rules, deploy guards, and integration tests as `bemoat-web-starter`:

| Category | Examples |
|----------|----------|
| Agent rules | `AGENTS.md`, `.agents/*`, `.cursor/rules/*` |
| UI execution guardrails | `docs/ai/ui-skills.md`, `docs/ai/ui-execution-workflow.md`, `docs/ai/visual-qa-checklist.md`, `docs/ai/accessibility-baseline.md`, `prompts/ui/*` |
| Agent-loop docs | `docs/agent-loop/*`, `docs/hardening.md`, `docs/schema-evolution.md`, etc. |
| Mission Control policy | `docs/mission-control/*`, `prompts/mission-control/chatgpt-project-loader.md`, `scripts/guard-mission-control-contract.mjs` |
| Superpowers skill entry | Native `superpowers:using-superpowers` or portable fallback `.agents/skills/using-superpowers.md` (not `docs/superpowers/*`) |
| GitHub workflow and templates | `.github/workflows/ci.yml` (child-safe `bemoat:*` only), PR template, issue templates |
| Safety guards | `scripts/guard-pack.mjs` (orchestrator), `scripts/guard-repo-safety.mjs`, `scripts/guard-harness-contract.mjs`, `scripts/guard-mission-control-contract.mjs`, `scripts/guard-package-manager.mjs`, `scripts/guard-env-placeholder.mjs`, `scripts/guard-cloudflare-env.mjs`, `scripts/guard-frontend-seo.mjs`, `scripts/guards/structural-protection.mjs`, and `scripts/structural-protection-manifest.json` — see [guard-pack.md](./guard-pack.md) |
| Cloudflare deploy guards | Recommended `deploy` / `preview` scripts that call `guard:cloudflare-env` |
| Sync and drift | `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs` |
| Local git hooks | `.githooks`, `scripts/check-branch-safety.sh`, `scripts/install-git-hooks.mjs`, `hooks:install` |
| Vitest harness | `vitest.config.mts`, `vitest.setup.ts`, checkout-scoped process-lock helper and global setup |
| Shared integration tests | All `tests/int/**/*.int.spec.ts` files intended for child projects |

Child projects receive harness **files** through
**`pnpm run bemoat:boilerplate:sync -- --harness-only`**. Drift is reported by
**`pnpm run bemoat:boilerplate:check -- --harness-only`**. Use raw
`boilerplate:sync` / `boilerplate:check` aliases only when a child project
defines them.

## Canonical ownership of agent rules

Some duplication is intentional because different tools consume different
entrypoints. The canonical files below own the long-form policy; wrappers should
stay short, preserve tool metadata such as globs or triggers, and link back to
the canonical source.

| Area | Canonical file(s) | Thin wrappers / entrypoints | Sync behavior |
|------|-------------------|-----------------------------|---------------|
| Root agent entrypoint | `AGENTS.md` | `ANTIGRAVITY.md` | Managed; overwritten in child projects |
| Starter vs child ownership | `docs/agent-loop/source-of-truth.md`, `docs/harness-sync-contract.md` | `AGENTS.md` summary, `.agents/skills/development-agent.md` | Managed |
| Issue-driven branch workflow | `docs/agent-loop/issue-driven-branch-workflow.md`, `docs/workflow/git-flow.md` | `AGENTS.md` summary, `.agents/skills/issue-workflow.md`, `.cursor/rules/branch-safety.mdc` | Managed |
| Validation and PR loop | `AGENTS.md`, `docs/agent-loop/checklist.md`, `docs/agent-loop/README.md` | `.agents/skills/development-agent.md`, `.agents/skills/regression.md` | Managed |
| Payload CMS rules | `.cursor/rules/payload-overview.md` plus related Payload topic files in `.cursor/rules/`; `.agents/skills/payload-cms.md` is the portable fallback index | `AGENTS.md` summary | Managed |
| Payload schema and migration safety | `docs/schema-evolution.md`, `docs/agent-loop/security-and-migrations.md`, `docs/agent-loop/migration-draft-pr.md` | `AGENTS.md` stop-condition summary, `.agents/skills/payload-cms.md` | Managed |
| Superpowers workflow | Native `superpowers:using-superpowers`; portable fallback `.agents/skills/using-superpowers.md` | `.cursor/rules/superpowers-using-superpowers.mdc`, `AGENTS.md` summary | Managed for fallback files; native skill is external |
| UI animation workflow | `.agents/skills/ui-animation.md`, `docs/ai/ui-execution-workflow.md`, `docs/ai/ui-skills.md` | `AGENTS.md` summary | Managed |
| Mission Control | `docs/mission-control/mission-control-guide.md` | `prompts/mission-control/chatgpt-project-loader.md`, `AGENTS.md` pointer, handoff/RESULT templates | Managed guide/loader/templates; live `.bemoat/mission-control-overrides.md` is child-owned and never managed |
| Tool-specific Cursor rules | Matching `.cursor/rules/*` file | Frontmatter metadata in `.mdc` files | Managed; keep trigger metadata and globs intact |

When reducing duplication, first confirm the rule exists in its canonical file
or move it there. Do not delete safety policy solely because it appears
duplicated.

## Sync modes

| Mode | When to use | Starter modules |
|------|-------------|-----------------|
| **`harness-only`** (default) | Existing projects with their own Payload schema, frontend, components, hooks, access, lib, and `payload.config.ts` | **Not copied** — `seedOnlyPaths` are skipped |
| **`full`** | New child projects or repos that still want missing starter files seeded once | Copied only when missing; never overwrites existing child files |

Commands:

```bash
# Existing repos (recommended)
pnpm run bemoat:boilerplate:sync -- --harness-only
pnpm run bemoat:boilerplate:check -- --harness-only

# New repos that want starter module seeding
pnpm run bemoat:boilerplate:sync -- --full
pnpm run bemoat:boilerplate:check -- --full
```

Use raw `boilerplate:sync` / `boilerplate:check` aliases only when the child
project defines those non-namespaced scripts.

CLI flags take precedence over `BEMOAT_SYNC_MODE`. Sync metadata in `.bemoat-boilerplate-sync.json` records `syncMode` and `seedOnlyPathsSkipped`.

### Source-driven sync manifest

The starter publishes **`.bemoat/boilerplate-sync-manifest.json`** — a static JSON copy of the sync path lists and package sync config. After cloning the starter, `scripts/sync-boilerplate.mjs` reads that manifest from the cloned source and uses it for the current run (`managedPaths`, `seedOnlyPaths`, `mergeKeepPaths`, package script lists). If the manifest is missing (very old starter ref), sync falls back to the local script constants.

This prevents the **first-sync paradox**: when the starter adds a new managed path, child projects with an older local sync script still copy the new path in **one** run because path discovery happens from the cloned manifest, not only from the already-loaded local constants. Maintain the manifest in `bemoat-web-starter` whenever you change `managedPaths` or related lists in `scripts/sync-boilerplate.mjs` (keep them identical; `tests/int/boilerplate-sync.int.spec.ts` asserts parity).

Starter modules (`src/app/(frontend)`, `src/collections`, `src/globals`, `src/components`, `src/hooks`, `src/access`, `src/lib`, `src/payload.config.ts`) are **not** harness.

## Starter-only paths (not synced)

These live in `bemoat-web-starter` for learning, reference, and starter development. They are **not** copied to child projects by `boilerplate:sync`:

| Path | Purpose |
|------|---------|
| `docs/superpowers` (except synced subpaths below) | Starter feature specs, plans, and historical planning work — not copied to child projects |

**Synced subpaths** are in `managedPaths` and **are** copied to child projects:

| Path | Purpose |
|------|---------|
| `docs/superpowers/README.md` | Canonical artifact names, reading order, folder conventions |
| `docs/superpowers/specs/README.md` | Specs folder guidance |
| `docs/superpowers/plans/README.md` | Plans folder guidance |
| `docs/superpowers/plans/_templates` | Reusable implementation and verification plan formats |
| `docs/superpowers/specs/_templates` | Reusable product, UX, and handoff spec formats |

Child projects still get agent execution rails (`AGENTS.md`, `.agents`, `.cursor/rules`, `docs/agent-loop`, `docs/ai`, GitHub workflow rails, guards, sync scripts, harness tests). Agents invoke the native `superpowers:using-superpowers` skill or the portable fallback at `.agents/skills/using-superpowers.md` — not starter feature specs or plans under `docs/superpowers/{project}/…`.

### Child project planning workflow

Child repos receive the synced README and template paths above. They do **not** receive starter feature folders under `docs/superpowers/{project}/…` — create child-local feature folders instead.

For canonical artifact names, reading order, and folder conventions, read the **local synced** `docs/superpowers/README.md` after `boilerplate:sync`. Copy `_templates` into `docs/superpowers/{specs|plans}/{project}/{initiative}/{feature}/` before editing; do not edit synced template files in place for feature-specific work.

## What stays child-owned

These are **not** part of the harness sync contract:

- `README.md` (project-owned — existing projects keep their own README; harness documentation lives under `docs/*` and `AGENTS.md`)
- `package.json` (child-owned manifest)
- `pnpm-lock.yaml`
- `wrangler.jsonc`
- D1 database IDs and names
- R2 bucket names
- Worker names per environment
- `.env` files and Cloudflare secrets
- Custom domains
- Customized seed-only app files (`src/app/(frontend)/*`, collections, etc.)
- `.bemoat/mission-control-overrides.md` (child Mission Control project gates; never overwrite or delete on sync)

Deploy **script recommendations** are surfaced in a package sync proposal. Cloudflare **resource config** stays in each child repo.

## Merge-keep paths

Some child-owned files are merged during sync: existing content is preserved and missing starter entries are appended.

| Path | Sync behavior |
|------|---------------|
| `.gitignore` | Keep all child ignore rules; append missing starter rules under `# Added by bemoat boilerplate sync` |

Listed in `mergeKeepPaths` in `scripts/sync-boilerplate.mjs`. Drift check fails when starter rules are missing from the child file.

## Package manifest ownership

`package.json` is **child-owned**. Boilerplate sync does not treat it as a managed rails file.

| Category | Sync behavior |
|----------|---------------|
| `bemoat:*` scripts | Managed — sync **adds missing** namespaced scripts only; **never overwrites** existing entries |
| Non-namespaced scripts (`build`, `deploy`, `preview`, `check`, `lint`, `dev`, `start`, etc.) | **Never touched by default** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| Build/deploy contract (`build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`) | **Opt-in only** — pass `--apply-build-contract` to overwrite these scripts from the starter and sync `scripts/build.mjs` |
| Build contract files (`open-next.config.ts`) | **Opt-in only** — applied with `--apply-build-contract` via `buildContractFilePaths`; not in `managedPaths` |
| `src/payload.config.ts` build context | **Child-owned** — not overwritten; review manually after build contract rollout (see `src/lib/payloadBuildContext.ts`) |
| `dependencies` / `devDependencies` | **Never touched** — drift reported in `.bemoat/package-sync-proposal.md` (human review only) |
| `pnpm-lock.yaml` | Never synced |

### Managed toolchain contract

`.bemoat/toolchain-contract.json`, `tsconfig.harness-strict.json`, and the
`bemoat:typecheck` script are managed harness compatibility data. Children pin
the contract's exact TypeScript version, retain `strict: true` and effective
`strictNullChecks: true`, and run `pnpm run bemoat:typecheck` in synced CI.
Application dependencies remain child-owned; sync proposes rather than rewrites
them.

After sync, review **`.bemoat/package-sync-proposal.md`**. Do not apply script or dependency changes automatically unless you used **`--apply-build-contract`** for the build/deploy scripts. Update `package.json` manually for other drift when desired, then run **`pnpm install`**.

```bash
# Fix recursive OpenNext build or stale deploy scripts in child projects (overwrites build/deploy contract scripts + syncs scripts/build.mjs + open-next.config.ts)
pnpm run bemoat:boilerplate:sync -- --harness-only --apply-build-contract
```

Managed namespaced scripts (see `managedPackageScripts` in `scripts/sync-boilerplate.mjs`):

- `bemoat:branch:check`
- `bemoat:issue:comment` — validates and safely posts a Mission Control `HANDOFF`, `RESULT`, or `REVIEW_VERDICT` comment; sync adds the wrapper only when the child has no existing namespaced entry
- `bemoat:mission-control:review` — validates, posts, and verifies the atomic durable-state projection for a canonical reviewer verdict
- `bemoat:guard:safety` (repo safety + harness contract)
- `bemoat:guard:harness-contract` (standalone harness contract check)
- `bemoat:guard:cloudflare-env`
- `bemoat:test:int`
- `bemoat:check`
- `bemoat:boilerplate:sync`
- `bemoat:boilerplate:check`
- `bemoat:hooks:install`

Suggested non-namespaced scripts (reported in proposal only — never auto-applied by default):

- `branch:check`, `build`, `build:next`, `build:cloudflare`, `cf:build`, `deploy`, `deploy:app`, `deploy:database`, `deploy:dev`, `preview`
- `check`, `check:full`, `lint`, `typecheck`, `test`, `test:int`
- `dev`, `start`

Proposal sections: **Script drift report (human review only)**, **Dependency drift report (human review only)**.

## Synced CI and hooks (child-safe baseline)

Package sync adds only missing `bemoat:*` scripts. Synced harness files must not assume non-namespaced scripts exist in child projects.

| Harness file | Runs on CI / pre-push |
|--------------|----------------------|
| `.github/workflows/ci.yml` | `pnpm install --frozen-lockfile`, `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int` |
| `.githooks/pre-commit` | `bash scripts/check-branch-safety.sh` |
| `.githooks/pre-push` | `bash scripts/check-branch-safety.sh`, `pnpm run bemoat:guard:safety`, `pnpm run bemoat:test:int` |

Do **not** call these directly from synced CI or hooks: `guard:safety`, `guard:cloudflare-env`, `check`, `check:full`, `typecheck`, `lint`, `build`, `deploy`, `deploy:app`, `deploy:database`, `preview`, or `test:int`.

Child projects may add stricter validation later (`check`, `lint`, `typecheck`, `build`, deploy scripts) and extend their own CI or pre-push when those scripts exist. `bemoat-web-starter` itself runs full validation locally and via [`.github/workflows/ci-starter.yml`](../.github/workflows/ci-starter.yml) (starter-only, not synced).

## Harness contract guard

`scripts/guard-harness-contract.mjs` enforces that **child-facing automation** calls only `bemoat:*` scripts.

| Child-facing path | Purpose |
|-------------------|---------|
| `.github/workflows/ci.yml` | Synced GitHub Actions workflow |
| `.githooks/pre-commit` | Optional local branch safety hook |
| `.githooks/pre-push` | Optional local branch safety + pre-push hook |

Human-facing templates (`.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/agent-task.yml`) may reference raw scripts as **local developer instructions** — they are not automation entry points and are not scanned by the guard.

The guard runs:

- as part of `pnpm run guard:safety` and `pnpm run bemoat:guard:safety`
- standalone via `pnpm run bemoat:guard:harness-contract`
- in integration tests (`tests/int/harness-contract-guard.int.spec.ts`)

If a maintainer adds a new child-facing automation file, add its path to `CHILD_FACING_HARNESS_PATHS` in `scripts/guard-harness-contract.mjs` and extend the guard tests.

## Child harness script contract

Child projects should treat **`bemoat:*` as the public harness API**. Synced CI and pre-push call only these scripts:

| Script | Purpose |
|--------|---------|
| `bemoat:branch:check` | Manual Git Flow branch safety check |
| `bemoat:guard:safety` | Central guard pack v1 (all reusable safety checks) |
| `bemoat:guard:pack` | Explicit alias for the central guard pack |
| `bemoat:test:int` | Shared Vitest integration tests |
| `bemoat:guard:cloudflare-env` | Cloudflare deploy environment guard (when deploy scripts exist) |
| `bemoat:guard:mission-control-contract` | Mission Control policy/loader/sync contract guard |
| `bemoat:check` | Optional stricter local/CI check when child defines `lint` and `typecheck` |
| `bemoat:boilerplate:sync` / `bemoat:boilerplate:check` | Pull harness updates from starter |
| `bemoat:hooks:install` | Install optional `.githooks/pre-commit` and `.githooks/pre-push` |

Raw implementation scripts (`lint`, `typecheck`, `build`, `deploy`, `preview`, `check`, `guard:safety`, etc.) are **starter-internal or child-local**. Do not call them from synced CI or hook templates.

## Shared integration tests

All files matching `tests/int/**/*.int.spec.ts` are shared harness tests unless explicitly marked starter-only.

Current shared tests (listed in `managedPaths` in `scripts/sync-boilerplate.mjs`):

- `tests/int/api.int.spec.ts`
- `tests/int/boilerplate-sync.int.spec.ts`
- `tests/int/cloudflare-env-guard.int.spec.ts`
- `tests/int/post-role-comment.int.spec.ts`
- `tests/int/guard-pack.int.spec.ts`
- `tests/int/structural-protection.int.spec.ts`
- `tests/int/command-contract-transport.int.spec.ts`
- `tests/int/harness-contract-guard.int.spec.ts`
- `tests/int/mission-control-contract.int.spec.ts`
- `tests/int/open-next-config.int.spec.ts`
- `tests/int/repo-safety-guard.int.spec.ts`
- `tests/int/starter-acceptance.int.spec.ts` (acceptance contract — see [starter-acceptance-tests.md](./starter-acceptance-tests.md))
- `tests/int/toolchain-contract.int.spec.ts`
- `tests/int/vitest-process-lock.int.spec.ts`

## Rules for maintainers

1. **New shared harness file** — Add the path to `managedPaths` in `scripts/sync-boilerplate.mjs`, mirror the same entry in `.bemoat/boilerplate-sync-manifest.json`, document new agent wrappers in the ownership table when relevant, and ensure `tests/int/boilerplate-sync.int.spec.ts` covers it (directly or via the shared int-test contract test).

2. **New safe namespaced script** — Add to `managedPackageScripts` if sync should add it when missing. Add starter `bemoat:*` values in this repo's `package.json`.

3. **New child-facing automation file** — Add to `CHILD_FACING_HARNESS_PATHS` in `scripts/guard-harness-contract.mjs` and cover it in `tests/int/harness-contract-guard.int.spec.ts`.

4. **New recommended non-namespaced script** — Add to `suggestedPackageScripts` so drift appears in the package sync proposal (human review only; never auto-applied).

5. **New merge-keep path** — Add to `mergeKeepPaths` with merge logic in `scripts/sync-boilerplate.mjs` and drift coverage in `scripts/check-boilerplate-drift.mjs`.

6. **Starter-only harness file** — Do not add to `managedPaths`. Document the path and reason in `STARTER_ONLY_INT_TESTS` in `tests/int/boilerplate-sync.int.spec.ts` so the contract test allows it.

7. **Starter-only documentation** — Do not add blanket parent paths to `managedPaths`. Document the path in `STARTER_ONLY_DOCS` in `tests/int/boilerplate-sync.int.spec.ts` (for example `docs/superpowers`). Add explicit subpaths to `managedPaths` when part of a starter-only tree must still sync (for example `docs/superpowers/README.md`, `docs/superpowers/plans/_templates`, and `docs/superpowers/specs/_templates`).

8. **Do not sync** `wrangler.jsonc`, resource IDs, secrets, `.env` files, or `pnpm-lock.yaml`.

9. **Do not add `README.md` to `managedPaths`.** Root README is project-owned. Existing projects keep their own README. Harness documentation lives under `docs/*` and `AGENTS.md`. `tests/int/boilerplate-sync.int.spec.ts` asserts `managedPaths` does not include `README.md`.

See also: [source-of-truth.md](./agent-loop/source-of-truth.md), [boilerplate-sync-command.md](./boilerplate-sync-command.md), [child-project-migration-guide.md](./child-project-migration-guide.md) (harness migration playbook for child repos), root [README.md](../README.md#what-boilerplate-sync-updates).
