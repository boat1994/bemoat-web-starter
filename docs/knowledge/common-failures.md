# Common failures and fixes

Actionable symptoms from current guards and CI. For guard internals see [guard-pack.md](../guard-pack.md).

## Failure table

| Symptom | Likely cause | Fix | Source |
|---------|--------------|-----|--------|
| Harness contract guard: forbidden script in CI | `.github/workflows/ci.yml` or `.githooks/pre-push` calls `lint`, `check`, `guard:safety`, `test:int`, etc. | Replace with `pnpm run bemoat:guard:safety` and `pnpm run bemoat:test:int` only | [harness-sync-contract.md](../harness-sync-contract.md), `scripts/guard-harness-contract.mjs` |
| `guard:safety` / `bemoat:guard:safety` fails on secrets | Token-like strings or `SECRET=` assignments in tracked files | Remove secrets; use `.env` locally; keep `.env.example` as placeholders | [guard-pack.md](../guard-pack.md) |
| Env placeholder guard fails | Missing `.env.example` or real-looking values in `.env.example` | Add file with empty values (`KEY=`) or short documented placeholders | `scripts/guard-env-placeholder.mjs` |
| Destructive SQL in migration | `DROP`, `DELETE FROM`, `TRUNCATE`, etc. in migration `up` | Use additive SQL; or add `bemoat:destructive-migration-approved` only with human approval | [security-and-migrations.md](../agent-loop/security-and-migrations.md) |
| Cloudflare deploy log says Payload migrated, but live D1 is still missing tables | `deploy:database` ran `payload migrate` without `PAYLOAD_MIGRATE_REMOTE=true`, so migrations updated Wrangler's local D1 simulation | Update deploy scripts from starter; in existing child projects review `.bemoat/package-sync-proposal.md` or run sync with `--apply-build-contract`, then redeploy | [cloudflare-environments.md](../cloudflare-environments.md), `scripts/guard-build-script-contract.mjs` |
| Wrong sync mode overwrote product files | Ran `--full` on existing child, or expected seed paths in harness-only | Use `--harness-only` for existing projects; re-audit with `boilerplate:check` | [child-project-migration-guide.md](../child-project-migration-guide.md) |
| `src/collections` or frontend in harness PR diff | Full sync or mixed-scope branch | Revert product paths; harness-only PR should be rails + metadata + proposal only | [child-project-migration-guide.md §1](../child-project-migration-guide.md#1-purpose) |
| Node engine warning / CI Node mismatch | Local Node older than `engines.node` (`>=24.15.0`) | Use Node 24.15.0+ locally; match CI | `package.json`, `.github/workflows/ci.yml` |
| Package manager drift guard | `package-lock.json` / `yarn.lock` tracked, or npm in harness workflow | Remove alien lockfiles; use pnpm only; keep `engines.pnpm` | `scripts/guard-package-manager.mjs` |
| Cloudflare config guard fails | `CLOUDFLARE_ENV=production`, `env.production`, or dev D1/R2 IDs match production | Production at wrangler root; isolate `env.dev` bindings | [cloudflare-environments.md](../cloudflare-environments.md) |
| `starter-acceptance.int.spec.ts` fails | Missing `bemoat:*` scripts, contract drift, or sync boundary regression | Read Vitest output; fix `package.json` scripts, CI/hooks, or `managedPaths` in sync script | [starter-acceptance-tests.md](../starter-acceptance-tests.md) |
| Local `check` green but CI strict fails | Only ran child-safe subset; starter PR needs full gate | Run `pnpm run check` locally; ensure ci-starter steps pass (importmap, types, lint, build) | `.github/workflows/ci-starter.yml` |
| `pnpm run check` fails on lint warnings | ESLint `--max-warnings 0` | Fix every warning in touched files (and unrelated warnings when practical) | [AGENTS.md](../../AGENTS.md#lint-policy) |
| Frontend SEO guard fails | Missing `metadata` in `src/app/(frontend)/layout.tsx` | Export `metadata` with `title` and `description` | `scripts/guard-frontend-seo.mjs` |
| Boilerplate drift after starter merge | Child not synced | In child: `boilerplate:check` then `boilerplate:sync -- --harness-only` via PR | [harness-sync.md](./harness-sync.md) |
| Sync overwrote intentional child harness edit | Edited rails-managed file only in child | Upstream fix to starter, then sync; don't one-off edit managed paths in child | [source-of-truth.md](../agent-loop/source-of-truth.md) |

## Debug order

1. Read the **exact** guard or test output (file path + rule name).
2. Match symptom in the table above.
3. If unclear, open the linked source doc or script — do not guess a new rule.
