# Day 16 P0 red-team — #27, #32, #33 only

Compact red-team result for the three P0 deliverables. **Does not** red-team #26, #28, #31, or #34.

Reviewers: GPT-5.5 or human with migration/security context.

---

## #27 — Central guard pack v1

**Protects against:** Secret leaks, destructive migrations, child CI calling raw scripts, package-manager drift, env placeholder mistakes, Cloudflare prod/dev binding mix-ups, missing frontend SEO metadata.

**Regressions caught:** `tests/int/guard-pack.int.spec.ts`, harness-contract fixtures, existing repo-safety and cloudflare-env int specs. Child path: `bemoat:guard:safety` → `scripts/guard-pack.mjs`.

**Does not cover:**

- Payload field rename / type swap (documented in [guard-pack.md](./guard-pack.md) known gaps)
- Every workflow file in arbitrary child repos (managed harness paths + starter `ci-starter.yml` only)
- Dependency audit, dedicated secret scanners, browser/e2e
- Mandatory `sitemap.ts` / `robots.ts` (validated only when present)

**Central and reusable?** **Yes.** Single orchestrator; child-facing `bemoat:guard:safety`; no product-specific scanners; pattern/heuristic guards only.

**Failures actionable?** **Yes.** [guard-pack.md](./guard-pack.md) maps each guard to fix guidance; fixtures prove pass/fail.

**Scanner creep?** **No** — no new dependency-heavy or product-specific scanners in v1.

| Block Day 17? | Follow-up issue? |
|---------------|------------------|
| **No** | Optional: AST/schema guard, expand workflow scan paths, require SEO routes when starter seed includes them |

---

## #32 — Child Project Migration Guide v1

**Protects against:** Messy harness-only PRs (product code, lockfile, wrangler, secrets mixed in), sync before audit, unreviewed `--full` sync on production children.

**Regressions caught:** Process-only — guide does not run sync. Paired with acceptance tests and `boilerplate:check -- --harness-only` for drift before write.

**Does not cover:**

- Executing sync in starter repo (by design)
- Dependency upgrades or Payload schema migration
- Automatic enforcement in CI (human + agent discipline)

**Audit vs sync separate?** **Yes.** §5 audit (`boilerplate:check`) vs §6 sync (`boilerplate:sync`); table in guide.

**Allowed/forbidden strict?** **Yes.** §7 allowed paths, §8 forbidden paths, readiness score gate (≥18/24 to proceed).

**Rollback clear?** **Yes.** §12 rollback checklist; PR template references pre-sync SHA.

**High-model gates clear?** **Yes.** Score 14–17 → GPT-5.5 recommended; &lt;14 → stop; P0 labeled `review:high-model` on issue.

| Block Day 17? | Follow-up issue? |
|---------------|------------------|
| **No** | After first real child migration: capture lessons in guide or KB if drift patterns appear |

---

## #33 — Starter Acceptance Test Suite v1

**Protects against:** Child-facing harness regressions (missing `bemoat:*` scripts, forbidden CI script calls, broken guard pack entrypoint, sync boundary violations).

**Regressions caught:** `tests/int/starter-acceptance.int.spec.ts` — scripts exist, harness contract on fixture child CI/hooks, `runGuardPack()` success, readable failure output, simulated harness-only sync without seeding product code.

**Does not cover:**

- Real GitHub Actions, Cloudflare deploy, `wrangler`, network child clone
- Browser / Playwright e2e
- Full guard pack on minimal child fixture (starter-specific paths like `wrangler.jsonc`, frontend SEO)
- Every child customization or optional `lint`/`build`/`check` scripts

**Child-facing path proven?** **Yes.** Fixture under `tests/fixtures/acceptance/child-project/`; sync test uses harness-only boundaries.

**Local and deterministic?** **Yes.** Vitest only; no network.

**Syncing intentional?** **Yes.** Suite ships via `managedPaths` / `tests/int/**`; children run `bemoat:test:int`.

| Block Day 17? | Follow-up issue? |
|---------------|------------------|
| **No** | Optional: extend fixture guard coverage; document first-child migration smoke checklist |

---

## Overall P0 verdict

| Deliverable | Ship confidence | Before first child harness PR |
|-------------|-----------------|-------------------------------|
| #27 Guard pack | High for v1 scope | High-model spot-check guard gaps table |
| #32 Migration guide | High | Human approves readiness score on real child |
| #33 Acceptance suite | High for contract tests | Confirm CI green after sync in child repo |

**Day 17 may start.** Schedule P0 red-team reviews before the first production child harness migration merge.
