# Deployment assumptions

Detail: [cloudflare-environments.md](../cloudflare-environments.md), [deploy-smoke-test.md](../deploy-smoke-test.md).

## Cloudflare model

- Deploy via OpenNext + Wrangler (`pnpm run build`, `pnpm run deploy`).
- **Production** = top-level `wrangler.jsonc` (no `--env`).
- **Dev remote** = `pnpm run deploy:dev` → `env.dev` in `wrangler.jsonc`.
- **Never** set `CLOUDFLARE_ENV=production` or add `env.production`.

`deploy` and `preview` scripts call `guard:cloudflare-env` before build.

## Child-owned (never sync, never copy between projects)

- `wrangler.jsonc`
- D1 database IDs and names
- R2 bucket names
- Worker names per environment
- Cloudflare secrets and custom domains

Starter `wrangler.jsonc` IDs are for **this** starter project only.

## Deploy commands (starter)

| Command | Purpose |
|---------|---------|
| `pnpm run deploy` | migrate remote D1 → optimize remote D1 → build → deploy production |
| `pnpm run deploy:dev` | same pipeline with `CLOUDFLARE_ENV=dev` |
| `pnpm run preview` | build + local preview worker |
| `pnpm run smoke:deploy` | optional post-deploy smoke helper |

`deploy:database` sets `PAYLOAD_MIGRATE_REMOTE=true` before `payload migrate`. Without that marker, Payload migrations can report success while updating Wrangler's local D1 simulation instead of the remote Cloudflare D1 database.

Agents: **do not** run deploy in docs-only or harness PRs. Destructive migration and production deploy need human approval — see [security-and-migrations.md](../agent-loop/security-and-migrations.md).

## Size note

README states this template expects **Cloudflare Paid Workers** (bundle may exceed free tier limit). Check current README if unsure.

## After deploy

Human checklist: [deploy-smoke-test.md](../deploy-smoke-test.md).
