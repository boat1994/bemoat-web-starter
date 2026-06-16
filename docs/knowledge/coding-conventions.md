# Coding conventions

## Diff discipline

- **Smallest complete change** that meets acceptance criteria.
- No "while I'm here" refactors, new abstractions, or extra features.
- One issue → one PR → one focused commit (unless issue says otherwise).

ADR: [0006 — stop overbuild early](../adr/0006-stop-overbuild-early.md).

## Scope by PR type

| PR type | Touch |
|---------|--------|
| Harness / docs / guards | `AGENTS.md`, `docs/*`, `scripts/guard-*`, CI, `tests/int/*` — **no** product feature work |
| Payload / frontend feature | `src/*` — run full `check` + generators as needed |
| Schema change | Additive-first only — no rename/retype in place | 

Stop conditions for schema: [schema-evolution.md](../schema-evolution.md), [AGENTS.md](../../AGENTS.md#production-schema-evolution-rules).

## Match existing code

- Read surrounding files before editing; match naming, imports, and patterns.
- Payload security: `overrideAccess: false` when passing `user` to Local API; pass `req` in hooks.
- TypeScript: run `check` / `tsc --noEmit` after code changes.

## Do not

- Invent architecture not reflected in repo docs or ADRs.
- Copy Cloudflare IDs, `.env`, or secrets across projects.
- Put product code in harness-only PRs.
- Edit child `wrangler.jsonc` from starter work.

## Tests

Add tests when they cover real harness or guard behavior — not trivial assertions. Harness changes should update or extend `tests/int/*` per [harness-sync-contract.md](../harness-sync-contract.md).

## Related

- [operating-manual.md § Stop rule](../agent-loop/operating-manual.md#stop-rule--avoid-overbuild)
- [security-critical.mdc](../../.cursor/rules/security-critical.mdc)
