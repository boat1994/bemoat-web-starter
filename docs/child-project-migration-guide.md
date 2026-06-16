# Child project harness migration guide v1

Practical playbook for migrating **existing Bemoat child projects** to the current starter harness safely. Written for **Composer 2.5** implementers; **GPT-5.5** gates high-risk decisions and red-team review.

**This guide does not run sync for you.** It defines audit mode, sync mode, diff boundaries, tests, PR conventions, rollback, and stop conditions.

Related docs:

- [Harness sync contract](./harness-sync-contract.md) — what harness includes and sync modes
- [Source of truth](./agent-loop/source-of-truth.md) — starter vs child ownership
- [Boilerplate sync command](./boilerplate-sync-command.md) — command reference
- [ADR 0005: PR-based harness migration](./adr/0005-pr-based-harness-migration.md) — why PRs, not direct pushes
- [ADR 0003: Narrow harness sync](./adr/0003-narrow-harness-sync.md) — list-driven sync boundaries
- [Guard pack v1](./guard-pack.md) — what `bemoat:guard:safety` runs
- [Agent operating manual](./agent-loop/operating-manual.md) — model roles and standard loop

---

## 1. Purpose

Roll out **harness-only** starter updates to a child project without touching product code, Payload schema, Cloudflare resource config, or secrets.

A harness migration PR in a child repo should contain **only**:

- Rails-managed harness files from `managedPaths` and `mergeKeepPaths`
- Sync metadata (`.bemoat-boilerplate-sync.json`)
- Package sync proposal (`.bemoat/package-sync-proposal.md`)
- Optionally `package.json` **only** when adding missing `bemoat:*` scripts (never overwrite existing script values)

**No product code changes** in a harness-only migration PR.

---

## 2. When to use this guide

Use this guide when:

- A child project needs updated agent rules, guards, CI, integration tests, or harness docs from `bemoat-web-starter`
- An issue or release note asks for harness adoption (for example after starter merges guard pack v1, harness contract, or child-safe CI)
- You are an agent assigned to **prepare or execute** a harness sync PR in a **child repo**

Do **not** use `--full` sync for existing production projects unless explicitly approved and the project still lacks starter seed files.

---

## 3. Non-goals

This guide does **not** cover:

- Running sync in this issue or any automated child migration
- Dependency upgrades or lockfile changes
- Payload schema, D1 migrations, or admin component changes
- Product features, frontend pages, or collection edits
- Copying `wrangler.jsonc`, D1 IDs, R2 names, Worker names, or secrets between projects
- Merging harness PRs (human only)

---

## 4. Readiness scoring table

Score each row **0** (fail), **1** (partial), or **2** (pass). **Minimum to proceed to sync: 18/24.** Scores below 14 require GPT-5.5 review before any file changes.

| # | Criterion | 0 | 1 | 2 | Score |
|---|-----------|---|---|---|-------|
| 1 | Child repo identified; not `bemoat-web-starter` itself | Wrong repo | Ambiguous | Clear child project | |
| 2 | Worktree clean (no unrelated uncommitted changes) | Dirty | Stashed but unverified | Clean `git status` | |
| 3 | On latest child `main` (or agreed base branch) | Behind / unknown | Fetched, not merged | Pulled and current | |
| 4 | Starter ref pinned or consciously chosen | Random commit | `main` without review | Tag or reviewed SHA (`BEMOAT_BOILERPLATE_REF`) | |
| 5 | Sync mode confirmed **`harness-only`** | `--full` planned | Unsure | Explicit `--harness-only` | |
| 6 | No pending Payload schema / migration work in same branch | Mixed scope | Related but separate issue | Harness-only scope | |
| 7 | `pnpm run boilerplate:check -- --harness-only` run (audit) | Not run | Run but not read | Run and drift understood | |
| 8 | Drift report reviewed; no surprise seed-only overwrites expected | Not reviewed | Skimmed | Every changed path categorized | |
| 9 | Child `package.json` `bemoat:*` scripts understood | Missing scripts unknown | Partial list | All managed scripts present or planned | |
| 10 | CI baseline known (child `.github/workflows/ci.yml` pre-sync) | Unknown | Assumed green | Recent green run or local equivalent | |
| 11 | Rollback owner identified (human) | None | Agent only | Named human approver | |
| 12 | Branch protection / PR workflow available | Direct push to main | PR possible but unprotected | PR required on `main` | |

**Interpretation:**

| Total | Action |
|-------|--------|
| **≥ 18** | Proceed to sync mode after pre-sync audit checklist |
| **14–17** | Complete missing items; GPT-5.5 review recommended |
| **< 14** | **Stop.** Fix readiness gaps before sync |

---

## 5. Pre-sync audit checklist (read-only)

**Mode: audit only — no `boilerplate:sync` yet.**

- [ ] Confirm repository is a **child project**, not `bemoat-web-starter`
- [ ] Confirm task scope is **harness-only** (no product, schema, or dependency work)
- [ ] `git fetch origin && git status` — worktree clean
- [ ] `git checkout main && git pull origin main`
- [ ] (Optional) Pin starter ref: `export BEMOAT_BOILERPLATE_REF=vX.Y.Z` — see [releases.md](./releases.md)
- [ ] Run drift check:
  ```bash
  pnpm run boilerplate:check -- --harness-only
  ```
- [ ] Save or copy drift output for the PR description
- [ ] Verify drift touches **only** harness paths (see §7–§8)
- [ ] Read existing `.bemoat/package-sync-proposal.md` if present — note script/dependency recommendations (human review only)
- [ ] Confirm no local edits exist in rails-managed paths that must be **upstreamed to starter first** (sync overwrites them)
- [ ] If child customized `.gitignore`, expect **merge-keep** append only (not full replace)
- [ ] Record pre-sync test baseline (§10 **Before sync** matrix)

If audit reveals forbidden paths would change, seed-only files would appear in diff, or scope is mixed — **stop** (§13).

---

## 6. Harness-only sync boundaries

| Boundary | Harness-only behavior |
|----------|-------------------------|
| **Default mode** | `--harness-only` (also default when no flag) |
| **Rails (`managedPaths`)** | Overwritten from starter on sync |
| **Merge-keep (`.gitignore`)** | Child rules kept; missing starter rules appended |
| **Seed-only (`seedOnlyPaths`)** | **Skipped entirely** — no `src/collections`, `src/app/(frontend)`, `payload.config.ts`, etc. |
| **`package.json`** | Never overwritten; missing `bemoat:*` scripts added only |
| **`pnpm-lock.yaml`** | Never synced |
| **Never synced** | `wrangler.jsonc`, `.env*`, secrets, resource IDs, root `README.md` |
| **Child CI after sync** | Calls `bemoat:guard:safety` and `bemoat:test:int` only |
| **Sync commit metadata** | `.bemoat-boilerplate-sync.json`, `.bemoat/package-sync-proposal.md` |

**Audit vs sync:**

| Phase | Command | Modifies files? |
|-------|---------|-----------------|
| **Audit** | `pnpm run boilerplate:check -- --harness-only` | **No** |
| **Sync** | `pnpm run boilerplate:sync -- --harness-only` | **Yes** (harness paths only) |

---

## 7. Allowed changed files

After **`pnpm run boilerplate:sync -- --harness-only`**, the PR diff should include **only** paths from this list (plus sync metadata). If anything else appears, **stop before commit** (§13).

### Rails-managed (`managedPaths`)

| Category | Paths |
|----------|-------|
| Agent rules | `AGENTS.md`, `.cursor/rules/**` |
| Agent-loop & harness docs | `docs/agent-loop/**`, `docs/hardening.md`, `docs/releases.md`, `docs/deploy-smoke-test.md`, `docs/cloudflare-environments.md`, `docs/schema-evolution.md`, `docs/dev-boilerplate.md`, `docs/boilerplate-sync-command.md`, `docs/harness-sync-contract.md`, `docs/guard-pack.md` |
| GitHub rails | `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/agent-task.yml` |
| Harness scripts | `scripts/sync-boilerplate.mjs`, `scripts/check-boilerplate-drift.mjs`, `scripts/deploy-smoke-test.mjs`, `scripts/guard-*.mjs`, `scripts/install-git-hooks.mjs` |
| Hooks & tests | `.githooks/**`, `vitest.config.mts`, `vitest.setup.ts`, `tests/int/*.int.spec.ts`, `tests/fixtures/guard/**` |

### Merge-keep

| Path | Expected diff |
|------|---------------|
| `.gitignore` | Append-only under `# Added by bemoat boilerplate sync` |

### Sync metadata (always)

| Path | Purpose |
|------|---------|
| `.bemoat-boilerplate-sync.json` | Records sync mode, ref, timestamp |
| `.bemoat/package-sync-proposal.md` | Human-review script and dependency drift |

### Conditional

| Path | When allowed |
|------|--------------|
| `package.json` | Only if sync **added missing** `bemoat:*` keys (never changed values of existing scripts) |

### Explicit rule

**No product code changes** — nothing under `src/` except harness test fixtures under `tests/fixtures/` should appear in a harness-only migration PR.

---

## 8. Forbidden changed files

If any of these appear in the post-sync diff, **do not commit**. Revert sync and stop (§13).

| Category | Forbidden paths / changes |
|----------|---------------------------|
| **Product / Payload app** | `src/app/(frontend)/**`, `src/app/(payload)/**`, `src/collections/**`, `src/globals/**`, `src/components/**`, `src/hooks/**`, `src/access/**`, `src/lib/**`, `src/payload.config.ts` |
| **Cloudflare config** | `wrangler.jsonc`, `open-next.config.ts` (unless explicitly in managedPaths and only harness-related — today treat unexpected changes as stop) |
| **Secrets & env** | `.env`, `.env.local`, `.env.production`, any file containing tokens or copied resource IDs |
| **Lockfile** | `pnpm-lock.yaml` (unless separate approved dependency PR) |
| **Project README** | `README.md` (project-owned; not in `managedPaths`) |
| **Dependency changes** | Manual edits to `dependencies` / `devDependencies` in same harness PR |
| **Non-namespaced scripts** | Changing `build`, `deploy`, `check`, `lint`, `typecheck`, etc. in the harness PR |
| **Database** | `migrations/**`, destructive SQL, D1 schema changes |
| **Unrelated fixes** | Any bugfix, refactor, or feature mixed into harness PR |

Applying items from `.bemoat/package-sync-proposal.md` belongs in a **separate human-reviewed PR**, not the harness-only PR.

---

## 9. Command checklist (agent execution)

Run in the **child project** repository unless noted.

```bash
# --- Setup ---
git fetch origin
git status                                    # 1. confirm clean worktree
git checkout main && git pull origin main
git checkout -b chore/harness-sync-YYYY-MM-DD # 2. create branch in child repo

# Optional: pin starter release
# export BEMOAT_BOILERPLATE_REF=vX.Y.Z

# --- Audit mode (read-only) ---
pnpm run boilerplate:check -- --harness-only  # 3. drift report
# 4. inspect drift report — categorize every path (§7–§8)

# --- Sync mode (writes files) ---
pnpm run boilerplate:sync -- --harness-only   # 5. apply harness rails
git status && git diff                        # 6. inspect diff — allowed files only?

# --- Post-sync validation (child harness entrypoints) ---
pnpm run bemoat:guard:safety                  # 7. central guard pack
pnpm run bemoat:test:int                      # 8. shared integration tests

# --- Optional stricter child-local checks ---
# pnpm run bemoat:check                       # if child defines lint + typecheck
# pnpm run check                              # if child defines full check script
# pnpm run build                              # if child defines build — before merge when practical

# --- PR workflow ---
git add -A                                    # only after diff review passes
git commit -m "chore: sync harness from bemoat-web-starter"
git push -u origin HEAD                       # 9. push branch
# 10. open PR (§11)
# 11. comment implementation report on source issue if issue-driven
```

**Starter repo note:** When developing this guide in `bemoat-web-starter`, validation is `pnpm run guard:safety` (docs-only tier).

---

## 10. Test matrix before and after sync

### Before sync (baseline)

Record results in the PR body. Stops are allowed if baseline is already red — fix or document before sync.

| Command | Required? | Purpose |
|---------|-----------|---------|
| `pnpm run boilerplate:check -- --harness-only` | **Yes** | Drift report; no file changes |
| `pnpm run bemoat:guard:safety` | Recommended | Pre-sync guard baseline |
| `pnpm run bemoat:test:int` | Recommended | Pre-sync test baseline |
| `pnpm run bemoat:check` | If defined | Stricter local/CI check |
| `pnpm run check` / `pnpm run build` | If defined | Child-local quality gates |

### After sync (must pass before commit)

| Command | Required? | Purpose |
|---------|-----------|---------|
| `git diff` / `git status` | **Yes** | Allowed-files-only review (§7–§8) |
| `pnpm run bemoat:guard:safety` | **Yes** | Guard pack v1 |
| `pnpm run bemoat:test:int` | **Yes** | Shared harness integration tests |
| `pnpm run bemoat:check` | If defined | Lint + typecheck via namespaced script |
| `pnpm run check` | Optional | Child full check if script exists |
| `pnpm run build` | Optional | Before merge when practical |
| CI on PR branch | **Yes before merge** | GitHub Actions on child repo |

**Failure handling:** If post-sync tests fail due to **harness** changes, fix in starter upstream or adjust child harness files only in scope — never mix product fixes into the same PR without approval.

---

## 11. PR naming and PR body block

### Branch naming

```
chore/harness-sync-YYYY-MM-DD
chore/harness-sync-<starter-tag>     # e.g. chore/harness-sync-v0.4.0
chore/<issue>-harness-sync           # e.g. chore/42-harness-sync
```

### PR title

```
chore: sync harness from bemoat-web-starter (<ref>)
```

Examples:

- `chore: sync harness from bemoat-web-starter (v0.4.0)`
- `chore: sync harness from bemoat-web-starter (main @ abc1234)`

### PR body block (copy into child PR)

```markdown
## Summary

Harness-only boilerplate sync from `bemoat-web-starter` — **no product code changes**.

- Sync mode: `harness-only`
- Starter ref: `<tag or SHA>`
- Drift checked before sync: yes

## Harness scope confirmation

- [ ] Diff contains only rails-managed paths, merge-keep `.gitignore`, sync metadata, and optional missing `bemoat:*` script additions
- [ ] No changes under `src/` product paths (collections, frontend, payload.config, etc.)
- [ ] No `wrangler.jsonc`, lockfile, `.env`, or README changes
- [ ] Package sync proposal reviewed; script/dependency changes **not** applied in this PR

## Commands run

```bash
pnpm run boilerplate:check -- --harness-only
pnpm run boilerplate:sync -- --harness-only
pnpm run bemoat:guard:safety
pnpm run bemoat:test:int
# optional: pnpm run bemoat:check / pnpm run check / pnpm run build
```

## Test result

| Command | Before sync | After sync |
|---------|-------------|------------|
| `bemoat:guard:safety` | | |
| `bemoat:test:int` | | |
| CI | n/a | pending / green |

## Rollback plan

Revert this PR or reset branch to pre-sync commit `<SHA>`. See [child project migration guide](https://github.com/boat1994/bemoat-web-starter/blob/main/docs/child-project-migration-guide.md#12-rollback-checklist).

## Risks

- CI workflow replacement may change required checks on GitHub
- New guards may fail on existing tracked files (secrets, package manager drift, SEO layout)
- Local pre-push hook changes if `.githooks` updated and reinstalled

## Human review needed

- [ ] Diff boundary review (harness-only)
- [ ] CI green on PR branch
- [ ] Approve merge (agent must not merge)

Closes #<issue-number>
```

Replace `<issue-number>` when the migration is issue-driven.

---

## 12. Rollback checklist

Use when post-sync tests fail, forbidden files were touched, or production CI breaks after merge.

### Before merge (preferred)

- [ ] Do **not** merge the PR
- [ ] `git checkout <branch> && git reset --hard origin/main` (or delete branch)
- [ ] Document failure in issue comment with command output
- [ ] If harness bug: fix **upstream in starter**, then re-run audit + sync

### After merge (emergency)

- [ ] Identify pre-sync commit: `git log --oneline -5` or PR merge commit parent
- [ ] Human approves revert:
  ```bash
  git revert -m 1 <merge-commit-sha>
  # or
  git reset --hard <pre-sync-sha>  # only with branch protection waiver
  ```
- [ ] Push revert PR; confirm CI green
- [ ] Re-run `pnpm run bemoat:guard:safety` and `pnpm run bemoat:test:int` on reverted state
- [ ] If `.githooks` was reinstalled locally, restore prior hook or run `git config --unset core.hooksPath`
- [ ] File starter issue if harness regression affects all children

### Partial rollback (package.json)

If only `bemoat:*` script additions are problematic:

- [ ] Revert `package.json` hunks manually
- [ ] Keep rails file updates if still valid
- [ ] Never leave child CI calling scripts that were removed

---

## 13. Stop and request high reasoning review when

Request **GPT-5.5** (or human) review before sync or commit when any condition is true:

| Stop trigger | Why |
|--------------|-----|
| Readiness score **< 14** | High risk of wrong repo, wrong mode, or dirty scope |
| Drift includes **seed-only** paths in `--harness-only` mode | Possible sync script bug or wrong flags |
| Post-sync diff touches **forbidden** paths (§8) | Data loss or product scope leak |
| Child has **local edits** in rails-managed files they need to keep | Must upstream to starter first, then sync |
| **`--full` sync** requested on customized production project | Overwrite risk on seed paths |
| Package proposal requires **dependency upgrades** in same PR | Out of harness-only scope |
| Guards fail on **secrets, resource IDs, or destructive migrations** | Security / production data risk |
| **`wrangler.jsonc` or D1/R2** changes appear | Cloudflare isolation risk |
| Mixed **Payload schema / migration** work in same branch | Violates conservative migration |
| Child CI would call **non-`bemoat:*` scripts** after sync | Harness contract violation |
| Baseline CI **already failing** and cause unknown | Sync may amplify failure |
| **Automated sync PR** requested but branch protection blocks | Needs human workflow design |
| Ambiguous **starter ref** (`main` vs tag) for production child | Release policy — see [releases.md](./releases.md) |
| Agent unsure **starter vs child** repo for the change | Wrong repo = wrong outcome |

**Mantra:** When in doubt, run audit only, paste drift + diff summary to GPT-5.5, and wait.

---

## 14. Final review checklist

Before requesting human merge:

- [ ] Readiness score ≥ 18 (or GPT-5.5 waived with comment)
- [ ] Pre-sync audit completed (§5)
- [ ] Sync mode was **`harness-only`**
- [ ] Post-sync diff matches **allowed files only** (§7)
- [ ] **No product code changes** in PR
- [ ] `pnpm run bemoat:guard:safety` — pass
- [ ] `pnpm run bemoat:test:int` — pass
- [ ] Optional child `check` / `build` — pass or documented N/A
- [ ] PR title and body follow §11
- [ ] Rollback plan documented with pre-sync commit SHA
- [ ] Implementation report posted on source issue (if issue-driven)
- [ ] **Agent did not merge**

---

## Quick reference: two modes

```text
AUDIT MODE                          SYNC MODE
────────────────────────────────    ────────────────────────────────
boilerplate:check -- --harness-only boilerplate:sync -- --harness-only
read drift report                   inspect git diff
score readiness (§4)                run bemoat:guard:safety + test:int
stop if forbidden paths             commit + PR + issue comment
```

**Composer 2.5** executes the checklist. **GPT-5.5** owns stop/go on §13 triggers and red-team review before commit.
