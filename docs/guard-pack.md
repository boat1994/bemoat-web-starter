# Central guard pack v1

The pack includes the managed toolchain-contract guard: it fails closed when
the exact TypeScript pin, Node floor, installed/lockfile proof, or strict
harness compiler roots diverge from `.bemoat/toolchain-contract.json`.

Reusable, deterministic checks that catch common agent and sync mistakes before they reach child repos. The pack is the single entry point for CI and local pre-PR validation.

## Commands

| Script | Purpose |
|--------|---------|
| `pnpm run bemoat:guard:pack` | Run the full central guard pack |
| `pnpm run bemoat:guard:safety` | Alias to the full pack (synced child CI and pre-push) |
| `pnpm run guard:safety` | Starter-internal alias to the full pack |
| `pnpm run bemoat:guard:harness-contract` | Harness contract only |
| `pnpm run bemoat:guard:mission-control-contract` | Mission Control contract only |
| `pnpm run bemoat:guard:cloudflare-env` | Cloudflare deploy guard only (also used before deploy/preview) |

Child-facing automation (`.github/workflows/ci.yml`, `.githooks/pre-commit`, `.githooks/pre-push`) uses branch safety plus **`bemoat:*`** scripts only. See [harness-sync-contract.md](./harness-sync-contract.md).

## Guard coverage

| Guard | Module | What it checks | How to fix |
|-------|--------|----------------|------------|
| **Secret leak** | `scripts/guard-repo-safety.mjs` | Obvious tokens/keys, secret-like env assignments, tracked `.env*` files (except `.env.example`), Cloudflare resource IDs outside `wrangler.jsonc` | Remove secrets from tracked files; use `.env.example` with empty values; keep D1/R2 IDs in `wrangler.jsonc` only |
| **Destructive SQL** | `scripts/guard-repo-safety.mjs` | `DROP`, `DELETE FROM`, `TRUNCATE`, `RENAME`, `ALTER COLUMN` in migration `up` sections | Use additive migrations; add `bemoat:destructive-migration-approved` only with human approval |
| **Direct script calls** | `scripts/guard-harness-contract.mjs` | Synced CI/hooks calling raw scripts (`lint`, `build`, `check`, `guard:safety`, …) | Call `bemoat:*` scripts from child-facing harness files |
| **Build script contract** | `scripts/guard-build-script-contract.mjs` | `scripts.build` calling OpenNext directly; missing wrapper, `build:next`, `build:cloudflare`, or `cf:build` alias; `open-next.config.ts` missing universal build re-entry | `build` → `node scripts/build.mjs`; `build:next` → `next build`; `build:cloudflare` → `opennextjs-cloudflare build`; `cf:build` → `pnpm run build`; `open-next.config.ts` `buildCommand` → `cross-env BEMOAT_BUILD_CONTEXT=opennext-next-build pnpm run build` |
| **Package manager drift** | `scripts/guard-package-manager.mjs` | Tracked `package-lock.json` / `yarn.lock` / `bun.lockb`; `npm`/`yarn`/`bun` install/run in harness workflows; missing `engines.pnpm` | Use pnpm only; keep `pnpm-lock.yaml`; declare `engines.pnpm` in `package.json` |
| **Env placeholder** | `scripts/guard-env-placeholder.mjs` | Missing `.env.example`; non-placeholder values in `.env.example` | Track `.env.example` with empty or obvious placeholder values only |
| **Cloudflare config** | `scripts/guard-cloudflare-env.mjs` | `CLOUDFLARE_ENV=production`; `env.production` in `wrangler.jsonc`; dev D1/R2 IDs matching production | Use top-level `wrangler.jsonc` for production; isolate `env.dev` bindings |
| **Frontend SEO** | `scripts/guards/frontend-seo.mjs` | Missing `metadata`/`generateMetadata` in `src/app/(frontend)/layout.tsx`; invalid `sitemap.ts`/`robots.ts` when present | Export `metadata` with `title` and `description`; add App Router SEO files when ready |
| **Mission Control contract** | `scripts/guard-mission-control-contract.mjs` | Missing/invalid guide frontmatter; review budget ≠ 3; missing required sections/templates; thin loader broken or oversized; `AGENTS.md` pointer missing; managed-path omissions; live `.bemoat/mission-control-overrides.md` accidentally managed; forbidden Review-4 / silent-reset / Minor-as-blocker markers | Restore canonical guide/loader/templates; keep loader thin; sync managed paths without managing the live override |
| **Planning contract** | `scripts/guard-planning-contract.mjs` | Missing or malformed `<!-- bemoat-task-identity:start -->` blocks; paired spec/plan identity mismatch; branch template or transition conflicts; invalid `task_issue_strategy`; unconditional planning SHA execution rule; live GitHub issue or Mission Control state conflicts when `gh` is available | Add balanced task-identity YAML to new or modified planning files under `docs/superpowers/specs/**` and `docs/superpowers/plans/**`; align paired documents; use `resolve_live_protected_base_at_dispatch`; keep executable issue references open |
| **Structural protection** | `scripts/guards/structural-protection.mjs` | Production `scripts/**/*.mjs` physical-line ceilings, immutable grandfathered maxima, manifest shape, symlinks, and SHA-256 fingerprints for protected test oracles | Keep new or moved scripts at 400 physical lines or fewer; do not alter the protected tests; change `scripts/structural-protection-manifest.json` only with Founder authorization |
| **Scripts architecture** | `scripts/guard-scripts-architecture.mjs` | Scripts architecture dependency graph contains unallowed cycles, unallowed edges, or violates adapter constraints | Ensure scripts dependency graph matches `scripts/architecture-contract.json` |

Orchestrator: `scripts/guard-pack.mjs` runs guards in the order above and aggregates failures.

## structural-protection

The manifest uses `physical-lines-v1`: count LF bytes, then add one line only when a non-empty file lacks a trailing LF. CRLF and LF therefore have equal line counts. Accepted reductions ratchet a grandfathered file's effective maximum down to the accepted baseline; when a reduction reaches 400 lines or fewer, remove its grandfathered entry so the normal 400-line ceiling applies. Increasing a protected maximum requires explicit, auditable Founder authorization rather than an ordinary manifest edit. Deleted entries remain tombstones, while renamed destinations are new files and must meet the 400-line ceiling. There are no bypass flags or automatic manifest updates. The guard also rejects symlinks and fingerprints the two protected Mission Control test files before any assertion-level bypass can take effect.

## planning-contract

The planning contract guard validates task identity and execution-base rules for **new or modified** planning markdown under `docs/superpowers/specs/**` and `docs/superpowers/plans/**`. Legacy planning packages untouched by the current diff are skipped, so existing child plans keep passing after harness sync.

### Task identity marker block

Each planning document must declare exactly one balanced marker pair:

```markdown
<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-140"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#140"
branch_template: "feature/140-planning-task-identity"
transition_target: "DONE"
planning_base_sha: "2489c7bf6d10ad8c2a724a7920bd83350102ee03"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: "docs/superpowers/specs/.../design.md"
paired_plan: "docs/superpowers/plans/.../implementation-plan.md"
```
<!-- bemoat-task-identity:end -->
```

Required fields (`schema_version` must be `1`):

| Field | Purpose |
|-------|---------|
| `main_issue` | Parent epic reference (`#106`, `owner/repo#106`) or `null` for standalone tasks |
| `task_key` | Stable task identifier (`task-11`, `issue-140`) |
| `task_issue_strategy` | `existing_dedicated_issue` or `create_before_execution` |
| `active_task_issue` | Open dedicated issue (`#170`) or `null` when creating before execution |
| `branch_template` | Expected branch prefix/pattern aligned with the active issue |
| `transition_target` | Terminal status (`DONE`, `MERGED`, `CLOSED`) or target issue reference |
| `planning_base_sha` | 40-character hex SHA of the protected head when the plan was authored |
| `execution_base_rule` | Must be `resolve_live_protected_base_at_dispatch` for executable branch creation |
| `paired_spec` | Relative path to the paired design/spec file |
| `paired_plan` | Relative path to the paired implementation plan file |

Paired spec and plan documents must declare **identical** identity fields (except `paired_spec` / `paired_plan` paths themselves).

### Diagnostic codes

Violations use structured output:

`[PLAN00x] path/to/file.md: Message. Found: <value>. Reason: <reason>. Corrective action: <action>`

| Code | When it triggers |
|------|------------------|
| `PLAN001` | Missing or malformed marker block; unsupported `schema_version`; missing required fields |
| `PLAN002` | Paired spec and plan disagree on any identity field |
| `PLAN003` | `branch_template` references an issue number unrelated to `active_task_issue` / `main_issue` |
| `PLAN004` | `transition_target` is terminal (`DONE`, `MERGED`, `CLOSED`) while targeting a known closed/terminal issue |
| `PLAN005` | `create_before_execution` strategy declares a concrete `active_task_issue` |
| `PLAN006` | Missing, invalid, or inconsistent `task_issue_strategy` |
| `PLAN007` | `execution_base_rule` is `use_planning_base_sha_unconditionally` instead of live protected-base resolution |
| `PLAN008` | Live GitHub verification: issue missing, wrong repository, or not `OPEN` (`agent-issue` preflight and offline-aware guard paths) |
| `PLAN009` | Live issue title/body does not identify the declared `task_key` |
| `PLAN010` | Live Mission Control managed state is `DONE` or `active_task_issue` conflicts with the contract |

Static rules (`PLAN001`–`PLAN007`) run in `pnpm run guard:safety` / `pnpm run bemoat:guard:safety` without network access. Live rules (`PLAN008`–`PLAN010`) run during `pnpm run bemoat:agent:issue -- <issue-number>` when authenticated `gh` access is available.

Branch-scoped discovery uses `resolveApprovedBase()` to diff planning files changed since the protected integration baseline: `origin/dev`, then `dev`, then `origin/main`, then `main`. Child repos with `dev` therefore validate only planning files changed since `dev`; starter repos without `dev` continue to use `main`.

### Historical vs executable references

Only **executable** references are validated: issue numbers inside `<!-- bemoat-task-identity:start -->`, active `<!-- bemoat-mission-control-state:start -->` blocks, and form declarations such as `Active Task Issue:`. Historical mentions in prose or `Durable Progress` checklists (for example `- [x] Task 10 (#169)`) are allowed even when `#169` is closed.

Module: `scripts/guard-planning-contract.mjs`. Live Mission Control parsing reuses `scripts/mission-control-state.mjs`. External Superpowers emit guidance: [superpowers-planning-contract-recommendation.md](./agent-loop/superpowers-planning-contract-recommendation.md).

## Fixtures and tests

High-risk checks have fixtures under `tests/fixtures/guard/`:

| Fixture | Guard |
|---------|-------|
| `destructive-migration-unapproved.ts` | Destructive SQL (should fail) |
| `destructive-migration-approved.ts` | Destructive SQL with approval marker (should pass) |
| `harness-with-forbidden-scripts.yml` | Direct script call (should fail) |
| `harness-with-bemoat-scripts.yml` | Harness contract (should pass) |
| `package-recursive-build.json` | Recursive OpenNext `build` script (should fail) |
| `package-correct-build.json` | Universal build wrapper contract (should pass) |

Integration tests: `tests/int/guard-pack.int.spec.ts`, `tests/int/guard-planning-contract.int.spec.ts`, `tests/int/guard-planning-contract-child-dev-base.int.spec.ts`, `tests/int/guard-planning-contract-starter-main-base.int.spec.ts`, `tests/int/mission-control-contract.int.spec.ts` (plus existing `repo-safety-guard`, `harness-contract-guard`, `cloudflare-env-guard` specs).

Planning contract fixtures live under `tests/fixtures/planning/` and are managed harness paths so child sync receives the canonical invalid/valid planning documents.

Mission Control rule IDs: `MC001`–`MC012` (see `scripts/guard-mission-control-contract.mjs` and [mission-control/README.md](./mission-control/README.md)).

## False positive risk

| Guard | Risk | Mitigation |
|-------|------|------------|
| Secret patterns | Legitimate docs or test strings matching token shapes | Markdown and `tests/` are excluded from secret scans |
| Secret assignments | Long non-secret config strings matching `SECRET=` patterns | Placeholder heuristics; keep real secrets out of tracked files |
| Destructive SQL | Keyword matches inside comments or `down()` sections | Scans migration `up` section only; approval marker bypasses |
| Direct script calls | Human-facing templates mentioning raw scripts | Only child-facing automation paths are scanned |
| Package manager | Child adds custom workflow outside managed paths | Extend `PACKAGE_MANAGER_SCAN_PATHS` when adding automation |
| Env placeholder | Short custom values under 12 chars treated as placeholders | Use empty values or documented placeholders in `.env.example` |
| Cloudflare config | Starter `wrangler.jsonc` contains real project IDs | IDs in `wrangler.jsonc` are expected; guard blocks duplicates in `env.dev` |
| Frontend SEO | Custom frontend layouts without `(frontend)` route group | Guard skips when starter frontend layout path is absent |
| Mission Control | Editorial wording changes trigger section checks | Prefer stable `##` headings and invariant HTML markers; keep loader under 80 lines and free of long-form section titles |
| Planning contract | Closed issue numbers in historical prose or progress checklists | Guard scans only executable contract blocks and modified planning files; historical `- [x] Task N (#169)` references outside markers are ignored |
| Scripts architecture | Minor changes to scripts architecture trigger failures | Update `scripts/architecture-contract.json` when intentionally modifying architecture |

## Known gaps (v1)

- No AST-based Payload field rename detection (agent rules + PR checklist only).
- `sitemap.ts` and `robots.ts` are **not required** — validated only when present. Add them in a follow-up when SEO routes are part of the starter seed.
- Package manager guard does not scan every workflow file in child repos — only managed harness paths plus starter `ci-starter.yml`.
- Not a replacement for dedicated secret scanners or dependency audit tools.

## Related docs

- [harness-sync-contract.md](./harness-sync-contract.md) — what syncs to child projects
- [agent-loop/security-and-migrations.md](./agent-loop/security-and-migrations.md) — migration approval policy and planning task-identity invariants
- [cloudflare-environments.md](./cloudflare-environments.md) — production vs dev deploy model
- [hardening.md](./hardening.md) — release and validation overview
