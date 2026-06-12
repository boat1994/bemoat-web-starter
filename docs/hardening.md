# Production hardening index

Quick map of production readiness docs for agents and humans working on Bemoat web projects.

## Documentation

| Topic | Doc |
|-------|-----|
| Release tags and sync policy | [docs/releases.md](./releases.md) |
| Post-deploy verification | [docs/deploy-smoke-test.md](./deploy-smoke-test.md) |
| Secrets and migration guardrails | [docs/agent-loop/security-and-migrations.md](./agent-loop/security-and-migrations.md) |
| Boilerplate drift check (`pnpm run boilerplate:check`) | [README § Boilerplate sync](../README.md#boilerplate-sync-command), [dev-boilerplate.md](./dev-boilerplate.md) — reports managed drift and missing seed files; customized starter app files are ignored |
| GitHub branch protection | [Branch protection checklist](#github-branch-protection-checklist) |

## Production hardening status

| Item | Status |
|------|--------|
| `main` branch protection | Manual — configure in GitHub repository settings (checklist below) |
| Release tags | Documented in [releases.md](./releases.md) |
| Drift check | `pnpm run boilerplate:check` available |
| Deploy smoke test | Checklist in [deploy-smoke-test.md](./deploy-smoke-test.md); optional `pnpm run smoke:deploy` |
| Secrets and migration guardrails | Documented in [security-and-migrations.md](./agent-loop/security-and-migrations.md) |

## GitHub branch protection checklist

Apply to `main` under **Settings → Branches → Branch protection rules**:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass before merging (CI workflow)
- [ ] Require branches to be up to date before merging
- [ ] Do not allow force pushes
- [ ] Do not allow deletions
- [ ] Restrict direct pushes to `main` (PR-only workflow)

Agents must not merge PRs; humans merge after review and green CI. See [agent-loop/checklist.md](./agent-loop/checklist.md#merge-readiness).
