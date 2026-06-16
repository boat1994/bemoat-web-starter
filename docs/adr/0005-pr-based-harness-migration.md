# ADR 0005: Harness changes flow through PRs; children sync harness-only by default

## Status

accepted

## Context

"Harness migration" here means **rolling out starter harness changes to child projects** — not D1/Payload database migrations (those have separate rules in [security-and-migrations.md](../agent-loop/security-and-migrations.md)).

Harness files (guards, CI, agent docs, integration tests) change frequently. Pushing directly to child `main` or auto-syncing from starter `main` without review would bypass CI, branch protection, and human judgment. Child app code must not be overwritten when adopting new rails.

## Decision

1. **Starter changes go through PRs** — Harness improvements merge to `bemoat-web-starter` `main` (or a release tag per [releases.md](../releases.md)) after CI and human review. Agents complete branch → implement → check → commit → push → PR → issue report; they do not merge.

2. **Children pull harness via explicit sync** — After upstream merge, child maintainers run:
   ```bash
   pnpm run boilerplate:check -- --harness-only
   pnpm run boilerplate:sync -- --harness-only
   ```
   Default mode is **`harness-only`**: rails update, starter app modules are skipped.

3. **Pin stable refs when needed** — Production child syncs may set `BEMOAT_BOILERPLATE_REF` to a release tag instead of tracking `main`.

4. **Package changes stay manual** — Sync proposes script and dependency drift in `.bemoat/package-sync-proposal.md`; humans apply what they need.

## Consequences

### Positive

- Every harness change is reviewable in starter PRs with CI evidence.
- Children choose when to sync; no silent overwrites of customized app code.
- `boilerplate:check` surfaces drift before `boilerplate:sync` modifies files.

### Negative

- Child projects lag starter until someone runs sync.
- Two-step flow (starter PR + child sync) requires discipline.

## Open questions

- Automated sync PRs in child repos — **proposed**, not implemented. Today sync is a manual local command.

## Related docs

- [Child project migration guide v1](../child-project-migration-guide.md) — audit/sync checklist, diff boundaries, rollback, and stop conditions for child harness PRs
