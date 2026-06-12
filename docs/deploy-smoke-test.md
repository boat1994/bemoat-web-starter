# Deploy smoke test

Use this checklist after deploying a child project or this starter to confirm the frontend, Payload admin, D1, R2, and Cloudflare routing are working in the deployed environment.

Replace `https://your-domain.example` with your deployed Worker URL or custom domain.

## Quick automated check (optional)

The optional script performs read-only HTTP checks against `/` and `/admin`. It does not use credentials and does not mutate production data.

```bash
BEMOAT_SMOKE_BASE_URL=https://your-domain.example pnpm run smoke:deploy
```

If `BEMOAT_SMOKE_BASE_URL` is missing, the script prints usage and exits with code `1`.

## Manual checklist

Work through each item in order. Mark pass or fail and note the URL or error you saw.

### Frontend routes

| Check | URL | Pass |
| --- | --- | --- |
| Home page loads (200, no Worker error page) | `/` | ☐ |
| Projects index loads | `/projects` | ☐ |
| Blog index loads | `/blog` | ☐ |

If a page returns 500 or a Cloudflare error, note the status code and any message in the response body before moving to triage below.

### Admin and Payload

| Check | URL / action | Pass |
| --- | --- | --- |
| Admin route loads (login or dashboard shell) | `/admin` | ☐ |
| Admin login page renders (email/password form) | `/admin/login` | ☐ |
| Payload can read at least one collection | Open `/admin/collections/projects` (or any collection) after login, or call `GET /api/projects?limit=1` | ☐ |

For the API check without logging in: a `401` or `403` still proves the Worker and Payload API route are alive. A `500` or connection error indicates a binding or secret problem.

### Database (D1)

| Check | How to verify | Pass |
| --- | --- | --- |
| D1 migration applied | `pnpm exec wrangler d1 migrations list D1 --env=$CLOUDFLARE_ENV --remote` shows migrations applied; deploy logs did not fail on `payload migrate` | ☐ |
| Frontend pages that query Payload return data or empty state, not 500 | Reload `/`, `/projects`, `/blog` | ☐ |

### Media storage (R2)

Skip this section if media upload is not configured for the project.

| Check | How to verify | Pass |
| --- | --- | --- |
| R2 binding present in `wrangler.jsonc` | Confirm `r2_buckets` entry for media | ☐ |
| Upload path works | In admin, upload a test image to Media; confirm it saves and the preview URL loads | ☐ |

Do not leave test uploads in production unless your team expects them. Delete test media after confirming the path.

### Cloudflare Worker and routing

| Check | How to verify | Pass |
| --- | --- | --- |
| Worker route responds on expected hostname | Browser or `curl -I https://your-domain.example/` returns Cloudflare/Worker headers, not DNS failure | ☐ |
| Custom domain (if used) points to the Worker | DNS and Workers route both configured | ☐ |

### Environment and secrets

| Check | How to verify | Pass |
| --- | --- | --- |
| `PAYLOAD_SECRET` set in Cloudflare | Workers dashboard → Settings → Variables and Secrets, or `wrangler secret list` | ☐ |
| Other required secrets present | Compare project docs and `wrangler.jsonc` bindings with dashboard | ☐ |
| `CLOUDFLARE_ENV` matches deploy target when running Wrangler locally | Same env name used for `pnpm run deploy` | ☐ |

## Failure triage

Use the symptom to narrow the fix before redeploying.

### Build failure

**Symptoms:** Deploy never completes; Cloudflare build logs show OpenNext or Next.js errors.

**Checks:**

- Run `pnpm run build` locally and fix TypeScript or import errors first.
- Confirm build command is `pnpm run build`, not `payload build`.
- After admin component changes, run `pnpm run generate:importmap` and commit the updated import map.

### Migration failure

**Symptoms:** `pnpm run deploy` fails during `payload migrate`; D1 schema errors in logs; admin or API returns 500 on collection reads.

**Checks:**

- Run `pnpm payload migrate:create` locally, review the migration SQL, and deploy again.
- List remote migrations: `pnpm exec wrangler d1 migrations list D1 --env=$CLOUDFLARE_ENV --remote`.
- Do not copy D1 database IDs from another project. Each child project has its own D1 instance.

### D1 binding issue

**Symptoms:** Worker starts but Payload cannot connect; errors mention D1, SQLite, or database binding.

**Checks:**

- In `wrangler.jsonc`, confirm the D1 binding name matches what Payload expects (typically `D1`).
- Confirm the database ID belongs to this project, not another repo.
- Redeploy after fixing bindings: `pnpm run deploy`.

### R2 binding issue

**Symptoms:** Media upload fails; admin shows upload errors; media URLs 404 or point to wrong bucket.

**Checks:**

- Confirm `r2_buckets` in `wrangler.jsonc` uses this project's bucket name.
- Verify the bucket exists in the Cloudflare dashboard for the same account.
- Confirm `@payloadcms/storage-r2` is configured in `payload.config.ts` for this project.

### Missing `PAYLOAD_SECRET`

**Symptoms:** Admin login fails unexpectedly; session errors; cryptic auth failures in Worker logs.

**Checks:**

- Set secret: `pnpm exec wrangler secret put PAYLOAD_SECRET --env=$CLOUDFLARE_ENV` (generate with `openssl rand -hex 32`).
- Redeploy after adding secrets so the Worker picks them up.

### Worker route or domain issue

**Symptoms:** DNS resolves but connection refused; wrong site; 522/525 from Cloudflare; only `*.workers.dev` works but custom domain does not.

**Checks:**

- Workers dashboard → Triggers: route pattern includes your domain.
- DNS: CNAME or A/AAAA records point to Cloudflare as documented for Workers custom domains.
- Compare the URL you smoke-test with the URL from the last successful deploy output.

## After smoke test passes

- Create an admin user if this is a fresh deploy and none exists yet.
- Seed or publish starter content (projects, posts) as needed for the site go-live.
- For child projects, run `pnpm run boilerplate:sync` on a schedule or after starter releases; re-run this smoke test after sync and deploy.

## Related docs

- [README — Deploy](../README.md#deploy)
- [README — Troubleshooting](../README.md#troubleshooting)
- [Agent loop — security and migrations](./agent-loop/security-and-migrations.md)
