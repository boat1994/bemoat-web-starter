# Package scripts and commands

Source of truth: root [`package.json`](../../package.json).

## Public harness API (`bemoat:*`)

Child-facing automation (synced CI, pre-push) may call **only** these:

| Script | Purpose |
|--------|---------|
| `bemoat:branch:check` | Manual Git Flow branch safety check |
| `bemoat:guard:safety` | Full central guard pack (CI + optional pre-push) |
| `bemoat:guard:pack` | Same as above (explicit alias) |
| `bemoat:test:int` | Shared Vitest integration tests |
| `bemoat:guard:cloudflare-env` | Deploy env guard (when deploy scripts exist) |
| `bemoat:check` | `bemoat:guard:safety` + lint + typecheck + `bemoat:test:int` (when child defines lint/typecheck) |
| `bemoat:boilerplate:sync` / `bemoat:boilerplate:check` | Pull or audit harness from starter |
| `bemoat:hooks:install` | Install optional `.githooks/pre-commit` and `.githooks/pre-push` |

Sync adds missing `bemoat:*` entries in child `package.json` without overwriting existing values.

## Starter-internal scripts

Used in **this repo** and optional child tooling — **not** wired into synced CI/pre-push:

| Script | Typical use |
|--------|-------------|
| `branch:check` | Starter alias for `scripts/check-branch-safety.sh` |
| `guard:safety` | Starter alias to guard pack (used by `check` and ci-starter) |
| `check` | `guard:safety` + lint + typecheck + `test:int` — **required before starter code PRs** |
| `check:full` | lint + typecheck + full test + build — human pre-merge |
| `lint`, `typecheck`, `test:int`, `test`, `test:e2e` | Starter strict validation (see [Playwright E2E diagnostics](#playwright-e2e-diagnostics) for `test:e2e`) |
| `build`, `deploy`, `preview`, `deploy:*` | Cloudflare deploy pipeline |
| `generate:types`, `generate:importmap` | After Payload schema or admin component changes |
| `boilerplate:sync` / `boilerplate:check` | Non-namespaced aliases (same scripts as `bemoat:*` counterparts) |

## When to run what

| Change type | Command |
|-------------|---------|
| Docs / markdown / CI config only | `pnpm run guard:safety` |
| TypeScript, scripts, tests, components | `pnpm run check` |
| Payload schema | `pnpm run check` + `pnpm run generate:types` (+ migration if D1) |
| Admin components | `pnpm run check` + `pnpm run generate:importmap` |

In child repos: prefer `bemoat:guard:safety` and `bemoat:check` when defined.

## Playwright E2E diagnostics

`pnpm run test:e2e` runs Playwright with the starter `webServer` config in
[`playwright.config.ts`](../../playwright.config.ts): `command: 'pnpm dev'`,
`url: 'http://localhost:3000'`, `reuseExistingServer: true`. **Playwright
`webServer` remains the default starter pattern** — do not add a custom E2E
lifecycle wrapper, dynamic port allocator, or process-tree manager unless
repeated failures are reproduced across capable environments (not restricted
sandboxes alone).

### Restricted sandbox vs real defects

`listen EPERM`, netlink-denied, or similar errors when Playwright starts the
dev server often mean **local network binding is prohibited** in a restricted
sandbox (for example `--unshare-net` or netlink denied). Treat that as an
**environment restriction**, not automatically as a port conflict or application
defect. Reproduce in a capable local environment (for example WSL2 or a normal
host shell) before changing Playwright config or adding wrappers.

### Trace Playwright-managed server lifecycle

```bash
DEBUG=pw:webserver pnpm run test:e2e
```

Use this when diagnosing how Playwright starts, waits on, and tears down the
configured `webServer`.

### Surface masked application stdout/stderr

When Playwright reports the web server process exited early, run the configured
command separately to see raw server output:

```bash
pnpm dev
```

(`playwright.config.ts` sets `webServer.command` to `pnpm dev`.) Fix startup
errors shown there before attributing failure to Playwright or port ownership.

### Process-leak attribution checklist

Before claiming a leaked dev server or port conflict, collect:

1. **PID** and **PPID** of the suspected process
2. **Complete command line** (not just the process name)
3. **Listener / port-owner evidence** (for example `lsof -i :3000` or OS
   equivalent showing which PID owns the port)
4. **Cleanup action taken** (how the process was stopped)
5. **Post-cleanup verification** (port free, no matching listener, rerun
   succeeds)

Without this evidence, do not classify sandbox `EPERM` or ambiguous early-exit
messages as process leaks or starter defects.

## Engines

`package.json` declares `node >= 24.15.0` and `pnpm ^9 || ^10`. CI uses Node **24.15.0** and pnpm **10**.

## Related

- [harness-sync-contract.md](../harness-sync-contract.md) — script contract for maintainers
- [ADR 0002](../adr/0002-bemoat-script-contract.md) — why `bemoat:*` only in child automation
