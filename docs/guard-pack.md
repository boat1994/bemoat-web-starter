# Central guard pack v1

Reusable, deterministic checks that catch common agent and sync mistakes before they reach child repos. The pack is the single entry point for CI and local pre-PR validation.

## Commands

| Script | Purpose |
|--------|---------|
| `pnpm run bemoat:guard:pack` | Run the full central guard pack |
| `pnpm run bemoat:guard:safety` | Alias to the full pack (synced child CI and pre-push) |
| `pnpm run guard:safety` | Starter-internal alias to the full pack |
| `pnpm run bemoat:guard:harness-contract` | Harness contract only |
| `pnpm run bemoat:guard:cloudflare-env` | Cloudflare deploy guard only (also used before deploy/preview) |

Child-facing automation (`.github/workflows/ci.yml`, `.githooks/pre-push`) calls **`bemoat:guard:safety`** only. See [harness-sync-contract.md](./harness-sync-contract.md).

## Guard coverage

| Guard | Module | What it checks | How to fix |
|-------|--------|----------------|------------|
| **Secret leak** | `scripts/guard-repo-safety.mjs` | Obvious tokens/keys, secret-like env assignments, tracked `.env*` files (except `.env.example`), Cloudflare resource IDs outside `wrangler.jsonc` | Remove secrets from tracked files; use `.env.example` with empty values; keep D1/R2 IDs in `wrangler.jsonc` only |
| **Destructive SQL** | `scripts/guard-repo-safety.mjs` | `DROP`, `DELETE FROM`, `TRUNCATE`, `RENAME`, `ALTER COLUMN` in migration `up` sections | Use additive migrations; add `bemoat:destructive-migration-approved` only with human approval |
| **Direct script calls** | `scripts/guard-harness-contract.mjs` | Synced CI/pre-push calling raw scripts (`lint`, `build`, `check`, `guard:safety`, …) | Call `bemoat:*` scripts from child-facing harness files |
| **Build script contract** | `scripts/guard-build-script-contract.mjs` | `scripts.build` calling OpenNext directly; missing wrapper, `build:next`, `build:cloudflare`, or `cf:build` alias | `build` → `node scripts/build.mjs`; `build:next` → `next build`; `build:cloudflare` → `opennextjs-cloudflare build`; `cf:build` → `pnpm run build`; deploy/preview use `pnpm run build` |
| **Package manager drift** | `scripts/guard-package-manager.mjs` | Tracked `package-lock.json` / `yarn.lock` / `bun.lockb`; `npm`/`yarn`/`bun` install/run in harness workflows; missing `engines.pnpm` | Use pnpm only; keep `pnpm-lock.yaml`; declare `engines.pnpm` in `package.json` |
| **Env placeholder** | `scripts/guard-env-placeholder.mjs` | Missing `.env.example`; non-placeholder values in `.env.example` | Track `.env.example` with empty or obvious placeholder values only |
| **Cloudflare config** | `scripts/guard-cloudflare-env.mjs` | `CLOUDFLARE_ENV=production`; `env.production` in `wrangler.jsonc`; dev D1/R2 IDs matching production | Use top-level `wrangler.jsonc` for production; isolate `env.dev` bindings |
| **Frontend SEO** | `scripts/guard-frontend-seo.mjs` | Missing `metadata`/`generateMetadata` in `src/app/(frontend)/layout.tsx`; invalid `sitemap.ts`/`robots.ts` when present | Export `metadata` with `title` and `description`; add App Router SEO files when ready |

Orchestrator: `scripts/guard-pack.mjs` runs guards in the order above and aggregates failures.

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

Integration tests: `tests/int/guard-pack.int.spec.ts` (plus existing `repo-safety-guard`, `harness-contract-guard`, `cloudflare-env-guard` specs).

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

## Known gaps (v1)

- No AST-based Payload field rename detection (agent rules + PR checklist only).
- `sitemap.ts` and `robots.ts` are **not required** — validated only when present. Add them in a follow-up when SEO routes are part of the starter seed.
- Package manager guard does not scan every workflow file in child repos — only managed harness paths plus starter `ci-starter.yml`.
- Not a replacement for dedicated secret scanners or dependency audit tools.

## Related docs

- [harness-sync-contract.md](./harness-sync-contract.md) — what syncs to child projects
- [agent-loop/security-and-migrations.md](./agent-loop/security-and-migrations.md) — migration approval policy
- [cloudflare-environments.md](./cloudflare-environments.md) — production vs dev deploy model
- [hardening.md](./hardening.md) — release and validation overview
