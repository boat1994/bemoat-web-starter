# Environment variables

## Tracked template

- **`.env.example`** — must exist; values must be empty or obvious placeholders.
- Guard: `scripts/guard-env-placeholder.mjs` (part of guard pack).

Current starter example:

```bash
PAYLOAD_SECRET=
```

Generate a real secret locally: `openssl rand -hex 32` (see `package.json` → `cloudflare.bindings.PAYLOAD_SECRET.description`).

## Forbidden in git

| File | Rule |
|------|------|
| `.env` | Never commit — listed in `.gitignore` |
| `.env.local`, `.env.production`, etc. | Never commit tracked copies with real values |
| Secrets in source/docs | Caught by `guard-repo-safety.mjs` |

## Cloudflare IDs and secrets

- D1/R2/Worker IDs belong in **`wrangler.jsonc` only** (child-owned).
- Do **not** copy IDs or secrets from starter to child or between children.
- CI uses `PAYLOAD_SECRET: ci-placeholder` — not a production secret.

## Deploy / preview guards

`pnpm run guard:cloudflare-env` (alias `bemoat:guard:cloudflare-env`) blocks unsafe production config — e.g. `env.production`, dev bindings matching production IDs.

## Local dev

```bash
pnpm install
pnpm wrangler login   # when Cloudflare CLI needed
pnpm dev
```

Copy `.env.example` → `.env` locally; never commit `.env`.

## Related

- [guard-pack.md](../guard-pack.md) — env and secret guards
- [security-and-migrations.md](../agent-loop/security-and-migrations.md) — stop conditions
