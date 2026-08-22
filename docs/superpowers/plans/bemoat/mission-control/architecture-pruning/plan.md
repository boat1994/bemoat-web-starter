<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-340-architecture-pruning"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#340"
branch_template: "docs/340-pruning-plan"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "5d69c4266cdec9d5bacdba7b98218bc5d2461abe"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: "docs/superpowers/plans/bemoat/mission-control/architecture-pruning/plan.md"
```
<!-- bemoat-task-identity:end -->

# Issue #340 Architecture Pruning Execution Plan

> **For agentic workers:** This plan is **Founder-gated**. Do **not** execute Class A–D pruning until a separate Founder pruning-approval comment explicitly authorizes this plan (or a named revision). REQUIRED SUB-SKILL after authorization: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking **after** Founder approval only.

**Goal:** Execute Option B (Pristine Journey Hub) pruning in ordered Class A → B batches while preserving Class C incident transport and Class D real-world recovery — without weakening Founder authority, exact-head CI, CAS/fail-closed, or protected oracles.

**Architecture:** Journey-first lean harness per normative `docs/mission-control/architecture-blueprint.md` on protected `main@5d69c4266cdec9d5bacdba7b98218bc5d2461abe`. Class A collapses proven re-export-only `.mjs` facades with no semantic change. Class B retires agent-bypass compatibility / duplicate SoT only after Class A is verified and separately Founder-authorized. Class C keeps `recover-review` until #274/#275 resolve. Class D keeps `reconcile`, `recover-state`, `reopen`, and related fail-closed recovery.

**Tech Stack:** Mission Control harness (`scripts/mission-control/**`, root command facades, guards, Vitest int specs), package `bemoat:*` scripts, structural-protection manifest, architecture-contract / inventory.

## Global Constraints

- **Binding baseline:** Plan against protected `main@5d69c4266cdec9d5bacdba7b98218bc5d2461abe` (Founder-named SHA; verified live at plan authorship). Reverify `origin/main` / GitHub `main` before any authorized execution.
- **Normative architecture:** `docs/mission-control/architecture-blueprint.md` (merged via PR #342). Design record at Draft PR #341 head `32944cc054b9023a1592dfb49c7d597536d15aac` is **evidence only**, not competing authority.
- **Policy unchanged:** `docs/mission-control/mission-control-guide.md` v1.3.0 remains sole long-form operating policy.
- **Option B direction ratified:** Issue #340 comment `5301913678` — architectural direction + docs-only merge of PR #342 **only**. That comment does **not** authorize pruning.
- **This plan does not authorize pruning.** Stop at Founder pruning approval. Class A execution starts only after Founder explicitly approves this plan (or a named revision).
- **Preserve always:** Founder authority; exact-head binding and CI; CAS/concurrency and fail-closed; deterministic reconciliation; `recover-state`; `reopen`; legitimate partial/ambiguous-failure recovery under correct canonical operation.
- **Class C preserve:** `recover-review` remains `INCIDENT_SPECIFIC / TEMPORARY` for #274 / #275 until that live consumer is separately resolved. Do not delete from static reachability alone; do not promote to core.
- **No Batch 6 / #333 Cluster F** from this plan. No merge of Draft PR #341. No production deploy/migration/child sync/retained-data mutation.
- **Static reachability ≠ deletion authority.** Every deletion requires live-consumer re-verification at execution time.
- **Do not weaken a failing test/guard merely to enable deletion.** First prove the protected behavior is outside the approved target contract, then get Founder auth for oracle/guard contract change.

## Required inputs (exact paths)

| Role | Path / ref |
| --- | --- |
| Normative blueprint | `docs/mission-control/architecture-blueprint.md` @ `main@5d69c4266cdec9d5bacdba7b98218bc5d2461abe` |
| Policy | `docs/mission-control/mission-control-guide.md` |
| Command usage | `docs/mission-control/command-reference.md` |
| Design evidence (non-normative) | `docs/superpowers/specs/bemoat/mission-control/architecture/design.md` @ `32944cc054b9023a1592dfb49c7d597536d15aac` (PR #341) |
| Founder Option B ratification | Issue #340 comment `5301913678` |
| Issue ACs | Issue #340 — “Acceptance criteria — later pruning phase” |
| Guard pack | `scripts/guards/pack.mjs` (`GUARD_PACK`, 13 IDs) |
| Structural protection | `scripts/structural-protection-manifest.json`, `scripts/guards/structural-protection.mjs` |
| Architecture contract | `scripts/architecture-contract.json`, `scripts/guards/scripts-architecture*.mjs` (as present on baseline) |

## Authority bounds (comment `5301913678`)

**Ratified:** Option B — Pristine Journey Hub as target architectural direction; docs-only merge of PR #342 at `5d69c426…` as normative blueprint publication.

**Explicitly not authorized by that comment:**

- pruning, deletion, or retirement of runtime files
- runtime or guard changes
- merge of Draft PR #341
- Issue #333 Batch 6 / Cluster F
- Issue #333 closure
- deployment, migration, production mutation, real child sync, or retained-data changes

**Preserved invariants (direction):** Founder authority, exact-head + CI, CAS/fail-closed, deterministic reconciliation, `recover-state`, `reopen`, real-world partial/ambiguous-failure recovery; `recover-review` remains incident-specific for #274/#275.

**Next gate named by Founder:** Any pruning or semantic simplification requires a **separate Founder decision** — this plan is that decision request.

## Pruning-phase acceptance criteria (from Issue #340)

Only after separate Founder authorization:

| Criterion | Plan coverage |
| --- | --- |
| Remove only capabilities classified obsolete/duplicate/unsupported by approved blueprint | Class A/B inventories below; Class C/D excluded from removal |
| Preserve current real-world failure recovery and active temporary consumers | Class D KEEP; Class C KEEP until #274/#275 closed |
| Update package commands, docs, tests, guards, manifests, sync inventory, and architecture contract consistently | Per-batch “affected surfaces” + validation |
| Do not weaken a failing test/guard merely to enable deletion | Explicit Founder-auth gate before oracle/guard/ratchet changes |
| Full focused and repository validation passes | Per-batch command lists |
| Exact-head CI passes | PR strategy |
| Remaining TS migration inventory regenerated from pruned protected baseline | Post-prune Task (after Class A±B land on protected main) |

---

## OUT OF SCOPE (this pruning phase)

- Executing any Class A/B deletion before Founder pruning approval of this plan
- Class C retirement of `recover-review` while #274/#275 remain live (separate Founder gate after consumers close)
- Weakening or retiring structural-protection **oracle SHA-256** anti-tampering
- Changing `structural-protection` line-count ratchet / grandfather ceilings (separate Founder decision; blueprint §11 item 3)
- Changing `frontend-seo` pack membership (separate Founder decision; blueprint §11 item 2)
- Broad `mission-control-contract` rule deletion without evidence-backed Class B auth
- Merging / closing Draft PR #341 as part of pruning
- Starting Issue #333 Batch 6 / Cluster F or closing #333
- Implementing #336 or #187
- Real child sync, deploy, migration, production/retained-data mutation
- Interrupting unrelated in-flight campaigns solely for pruning
- TypeScript-porting prune candidates “while we are here”

---

## Stop conditions

Stop and escalate to Founder / Mission Control — do **not** continue pruning — when:

1. Protected `main` has drifted from the SHA this plan binds to **and** the blueprint or recovery surface materially changed without plan revision.
2. Live #274 / #275 state conflicts with Class C assumptions (e.g. unexpected merge/close mid-Class-A) without re-verification.
3. A candidate’s live consumers expand beyond the batch inventory (production import, child harness path, CI workflow).
4. Any guard, protected oracle, or structural-protection hash fails and “fixing” would require weakening the oracle/guard contract.
5. Class B work is attempted before Class A verification evidence is recorded and Class B is separately Founder-authorized.
6. Dirty unrelated working tree / wrong branch / protected-branch edit risk.
7. Ambiguity whether a path is Class A (re-export-only, no semantic change) vs Class B (behavior / tolerance change).
8. Founder has not yet approved this plan (or approved revision) for execution.

**Hard stop for this planning deliverable:** awaiting Founder pruning approval. Do not start Class A execution from this docs PR alone.

---

## Recommended PR / draft strategy

| Stage | PR shape | Target | Notes |
| --- | --- | --- | --- |
| **0 — This plan** | **Draft** docs-only PR | `main` | Title marks “plan for Founder approval”; body states pruning **not** authorized until Founder approves; `Refs #340` |
| **1 — Class A Batch A1** | Small focused PR (prefer Draft until CI green, then Ready after Founder already authorized Class A) | `main` | Only named seed facades + importer/test retarget; no guard/oracle contract change |
| **2 — Class A Batch A2** | One or more small PRs | `main` | Additional proven re-export facades; each PR ≤ ~10 facade collapses preferred; reverify consumers per PR |
| **3 — Class B** | **Separate Draft PR(s)** after Class A on protected main | `main` | Requires **second** Founder auth (or explicit Class B clause in pruning approval). Never bundle with Class A |
| **4 — Guard/oracle/ratchet / frontend-seo / recover-review fate** | Dedicated Draft PRs | `main` | Each requires its own Founder authorization per blueprint §11 |
| **5 — Post-prune inventory** | Docs/checklist on surviving baseline | `main` | Regenerate #333 remaining TS surface estimate |

**Sizing rules:** Prefer multiple small PRs over one mega-prune. Do not mix Class A facade collapse with Class B semantic deletion. Do not mix runtime prune with structural-protection ratchet or pack-membership changes. Docs-only plan PR must not include runtime deletions.

**Rollback boundaries:**

- Git revert of the prune PR commit(s) restores facades/imports if no follow-on semantic change landed.
- Do not land irreversible manifest/oracle hash updates in the same commit as contested deletions without Founder auth.
- Class C/D paths must remain revert-safe (untouched in Class A).

---

## Pre-execution gate (after Founder pruning approval)

Run before touching runtime files:

- [ ] **Step 0.1:** Reverify `git fetch origin main && git rev-parse origin/main` and record tip. If ≠ plan binding SHA, compare blueprint + recovery surface; revise plan or get Founder re-bind.
- [ ] **Step 0.2:** Reverify Issue #274 / PR #275 live state (`gh issue view 274`, `gh pr view 275`).
- [ ] **Step 0.3:** Confirm Founder pruning-approval comment text explicitly authorizes Class A (and whether Class B is included or deferred).
- [ ] **Step 0.4:** Create topic branch from current protected main (e.g. `refactor/340-class-a-facade-batch-a1`), not from this plan branch alone if main moved.
- [ ] **Step 0.5:** Refresh mechanical facade inventory (re-export-only scan) and `git grep` consumers for Batch A1 paths.

Validation snapshot commands (docs-only plan phase — informational):

```bash
git fetch origin main
git rev-parse origin/main
# expect: 5d69c4266cdec9d5bacdba7b98218bc5d2461abe at plan authorship; reverify later
gh api repos/boat1994/bemoat-web-starter/issues/comments/5301913678 --jq .body
gh issue view 274 --json state,title
gh pr view 275 --json state,mergeable,title
```

---

## Class A — Low-risk facade / dead cleanup (FIRST)

**Meaning:** Collapse re-export-only `.mjs` → consumers import `.ts` (or sole implementation module) directly. **No semantic change.**

**Founder auth:** Required once for Class A execution via approval of this plan (or explicit “Class A authorized”). Does **not** imply Class B, guard pack changes, oracle/ratchet changes, or `recover-review` retirement.

### Batch A0 — Inventory freeze (no deletions)

**Files to touch:** None (read-only), or optional docs note under this plan folder only if Founder asks for refreshed inventory commit.

**Produce:**

- Mechanical list of `export * from './….ts'` facades under `scripts/mission-control/**`
- Per-facade: production importers, test importers, package.json / inventory / architecture-contract / pinned dogfood fixture references

**Leave alone:** All Class C/D recovery workflows; all 13 guards; structural-protection manifest contents.

**Validation:**

```bash
# mechanical facade list (example)
rg -n "^export \* from '\./.*\.ts'" scripts/mission-control -g '*.mjs'
pnpm run bemoat:guard:safety
```

**Rollback:** N/A (read-only).

### Batch A1 — Seed facades (blueprint-named Class A examples)

Evidence-backed seed set from blueprint §7.5 / design §4.7 (re-verify at execution):

| Facade | Implementation | Known live consumers (baseline scan) |
| --- | --- | --- |
| `scripts/mission-control/domain/brainstorming.mjs` | `brainstorming.ts` | `tests/int/mission-control-brainstorming.int.spec.ts` (imports `.mjs`; asserts root `scripts/mission-control-brainstorming.mjs` absent). Historical pinned dogfood fixtures still mention root path — **do not “fix” fixtures by weakening contracts**; update only if in-scope and hashes/inventory allow |
| `scripts/mission-control/domain/task-state-authorization.mjs` | `task-state-authorization.ts` | `tests/int/mission-control-task-state-boundary.int.spec.ts` path string |
| `scripts/mission-control/domain/merge-head-bindings.mjs` | `merge-head-bindings.ts` | `tests/int/mission-control-merge-head-bindings.int.spec.ts` (explicit facade content assertions) |

**Files expected to modify (execution time):**

- Delete or stop shipping the three `.mjs` re-export facades **after** importers updated
- Modify the int specs above to import `.ts` and drop facade-content assertions that encode re-export text
- Grep-fix any production importers still pointing at these `.mjs` paths
- Update inventory / sync manifests **only if** those paths are listed as managed harness files on current main

**Files / areas to leave alone in A1:**

- `scripts/mission-control/workflows/recover-review.mjs` (+ adapters/domain `review-recovery*`)
- `scripts/mission-control/workflows/recover-state.mjs`, `domain/recover-state-*`
- `scripts/mission-control/workflows/reopen.mjs`, `domain/reopen-*`
- `scripts/mission-control/workflows/reconcile.mjs`
- `scripts/guards/**`, `scripts/structural-protection-manifest.json` (unless a listed path hash must update because a **protected oracle file** changed — prefer **not** changing protected oracle files in A1)
- `frontend-seo` guard and pack membership
- Root command entrypoints for recovery (`scripts/mission-control-recover-*.mjs`, reopen, reconcile)

**Guards / tests / oracles affected:**

- Int specs listed above (must be updated, not skipped)
- `bemoat:guard:safety` / pack — expect **pass unchanged** if no guard sources touched
- Structural-protection oracle hashes — **must remain valid**; if an A1 edit would touch a hashed oracle file, **STOP** and split work / get Founder auth

**Validation commands:**

```bash
pnpm run bemoat:guard:safety
pnpm exec vitest run tests/int/mission-control-brainstorming.int.spec.ts \
  tests/int/mission-control-task-state-boundary.int.spec.ts \
  tests/int/mission-control-merge-head-bindings.int.spec.ts
pnpm run bemoat:test:int   # or repo-equivalent focused MC int suite if full suite is the gate
pnpm run guard:safety      # starter-internal alias if used in this repo’s docs-only/code tier
# If any .ts/.mjs production code changed beyond tests:
pnpm run check
```

**Rollback boundary:** Revert the A1 PR. Facades return; tests restore. No Class B semantics involved.

**Founder-auth gate:** Class A approval of this plan. **Additional Founder auth required** if A1 would need structural-protection manifest edits, guard rule changes, or pinned dogfood corpus hash rewrites beyond ordinary harness inventory path updates.

### Batch A2 — Remaining re-export-only facades (after A1 verified on protected main)

**Scope:** Other `scripts/mission-control/**/*.mjs` that are **only** `export * from './….ts'` (inventory at plan authorship included ~28 such facades; re-scan at execution). Examples present on baseline (not an authorization to delete all at once):

- `domain/task-state.mjs`, `domain/correction-contract.mjs`, `domain/pr-identity.mjs`, merge-* rendering/authority facades, task-bootstrap-* facades, `comment-evidence.mjs`, `review-verdict-projection.mjs`, `domain/recover-state-evidence.mjs` (**facade only** — underlying `.ts` and workflows are Class D KEEP), etc.

**Batching rule:** Prefer sub-batches of related modules (e.g. merge-* facades together; task-bootstrap-* together). **Never** delete a facade whose `.ts` is only reached through Class C incident paths without confirming production still has a TS import path.

**Special care:**

| Path | Care |
| --- | --- |
| `domain/recover-state-evidence.mjs` | Class A may collapse **facade** only; keep `recover-state` workflow + evidence semantics (Class D) |
| `domain/reopen-*.mjs` facades | Facade collapse OK; keep reopen workflow (Class D) |
| Anything imported by `workflows/recover-review.mjs` | Prefer leave facades until Class C retirement gate; or collapse only with tests proving recover-review still works |

**Investigate / possibly KEEP (not automatic A2):**

- `workflows/campaign-projection.mjs` (blueprint: investigate / possibly KEEP as workflow helper — may not be re-export-only)
- `diagnostics/github-comment-projection.mjs` — **KEEP** (active imports; J10)

**Validation:** Same as A1 plus any command smoke for touched domains:

```bash
pnpm run bemoat:guard:safety
pnpm run bemoat:test:int
pnpm run check   # when production TS/MJS graph changes
```

**Rollback:** Per-PR git revert.

**Founder-auth gate:** Covered by Class A approval **only if** still purely re-export collapse. If a “facade” is discovered to contain logic or dual SoT, reclassify to Class B and **stop**.

### Class A verification gate (required before Class B)

Record on Issue #340 (compact RESULT) after A1 (and after A2 if authorized in the same Class A approval):

- Exact PR URL(s) + head SHA(s)
- Commands + pass/fail
- Confirmation no Class C/D commands/paths removed
- Confirmation structural-protection oracles unchanged (or Founder-auth exception cited)

---

## Class B — Semantic simplification (ONLY AFTER Class A verified)

**Meaning:** Retire bypass-tolerance, duplicate sources of truth, or unsupported mimicry compatibility that changes fail/closed behavior for non-canonical agents.

**Founder auth:** **Separate** Founder decision (or explicit Class B clause). Class A approval alone is insufficient.

### Candidate themes (evidence-backed; finalize inventory at Class B kickoff)

| Theme | Tentative targets | Leave alone until dedicated auth |
| --- | --- | --- |
| B1 — Agent-bypass compatibility | Compatibility shims that tolerate non-canonical lifecycle mimicry / ad-hoc state mutation (census from blueprint §7.4 “Not recovery”) | Canonical command workflows J1–J11 |
| B2 — Duplicate SoT / drift matrices | Optional later MERGE of some `mission-control-drift` matrices into typed-domain tests **after** TS owns those matrices | Blind deletion of drift guard |
| B3 — MC contract rule shrink | Rule-level audit of `mission-control-contract` under Option B least-bypass posture | Wholesale guard removal |
| B4 — `scripts-architecture` rebaseline | Rebaseline contract to approved blueprint | Doing this inside a facade PR |
| B5 — `build-script-contract` alias subset | Alias simplification candidates called out in blueprint §8 | Core build-script platform rules |

**Explicit Class B items that need their own Founder gates (blueprint §11):**

1. **`frontend-seo` pack membership** — RETAIN as PLATFORM vs SPLIT out of central MC lean pack — **do not change in Class A; Founder decision required.**
2. **`structural-protection` line-count ratchet** — SPLIT oracle integrity (KEEP hashes) vs ratchet retire/rebaseline — **Founder decision required; oracle hashes stay.**
3. **`recover-review` fate after #274/#275 close** — default proposal delete incident transport — **Class C exit gate, not Class B mid-flight.**

**Files:** Exact paths TBD in a Class B kickoff inventory committed only after Class A verification; must cite live `git grep`, package scripts, CI workflows, and child harness inventory.

**Validation (minimum):**

```bash
pnpm run bemoat:guard:safety
pnpm run bemoat:test:int
pnpm run check
# Plus journey smokes for any command whose tolerance changed:
pnpm run bemoat:mission-control:reconcile -- --help --json
pnpm run bemoat:mission-control:recover-state -- --help --json
pnpm run bemoat:mission-control:reopen -- --help --json
# recover-review help remains available while Class C live:
pnpm run bemoat:mission-control:recover-review -- --help --json
```

**Rollback:** Dedicated revert PR; if guard/oracle contracts changed, rollback must restore manifests/hashes atomically.

**Stop:** Any Class B change that breaks exact-head, Founder allowlist, CAS/lease, or review-lineage invariants.

---

## Class C — Preserve incident-specific `recover-review` (#274 / #275)

**Disposition:** **KEEP / TEMPORARY** — not a prune batch.

| Surface | Action |
| --- | --- |
| `pnpm run bemoat:mission-control:recover-review` | Preserve |
| `scripts/mission-control-recover-review.mjs` | Preserve |
| `scripts/mission-control/workflows/recover-review.mjs` | Preserve |
| Related adapters / `domain/review-recovery.mjs` (+ tests) | Preserve |
| Docs labeling as INCIDENT_SPECIFIC | Keep accurate |

**Live consumer check (reverify at every phase):**

```bash
gh issue view 274 --repo boat1994/bemoat-web-starter --json state,title
gh pr view 275 --repo boat1994/bemoat-web-starter --json state,mergeable,title,headRefOid
```

**Founder-auth gate for retirement:** Only after #274/#275 resolved (or Founder explicitly redirects). Default proposal per blueprint: delete incident transport after consumer closed — **separate plan/PR**, not Class A/B.

**Out of Class A/B PRs:** Do not remove package script, command-reference entries, or routing-policy recovery metadata for `recover-review` while Class C applies.

---

## Class D — Preserve permanent real-world recovery

**Disposition:** **KEEP** — not a prune batch.

| Capability | Canonical command / owners | Action |
| --- | --- | --- |
| Deterministic reconciliation | `bemoat:mission-control:reconcile` → `workflows/reconcile.mjs` (+ domain) | Preserve |
| Recover absent managed state | `bemoat:mission-control:recover-state` → `workflows/recover-state.mjs`, `domain/recover-state-*` | Preserve (facade-only `.mjs` may collapse under Class A **without** removing semantics) |
| Founder-authorized reopen | `bemoat:mission-control:reopen` → `workflows/reopen.mjs`, `domain/reopen-*` | Preserve |
| Exact-head CI fail-closed / CAS / lease retry | domain + workflows + guards as on baseline | Preserve |
| Partial / ambiguous-failure recovery under correct canonical operation | per blueprint Preserve list | Preserve |

**Guards:** Platform/MC safety guards (repo-safety, harness-contract, mission-control-contract, mission-control-drift, structural-protection **oracle** integrity, etc.) stay RETAIN per blueprint §8 unless a later Founder gate says otherwise.

**Founder-auth gate:** None for “keep.” Any redesign/removal of Class D requires an explicit Founder decision outside this plan’s Class A scope.

---

## Affected validation matrix (summary)

| Batch | Primary commands | Expect |
| --- | --- | --- |
| Plan PR (this doc) | `pnpm run guard:safety` (docs/markdown tier) | Pass; no runtime diff |
| A1 / A2 | `bemoat:guard:safety`, focused vitest, `bemoat:test:int`, `check` if code graph changes | Pass; oracles unchanged |
| B* | Full code tier + command `--help --json` smokes for recovery commands | Pass; contract changes only if Founder-authorized |
| Post-prune | Regenerate TS migration inventory; exact-head CI on prune PR | Pass |

---

## Binding and non-claims

**Bound to:** `main@5d69c4266cdec9d5bacdba7b98218bc5d2461abe` + normative blueprint Option B + Founder comment `5301913678` (direction only).

**This document claims:**

- A Founder-reviewable pruning **execution plan**
- Class A-first sequencing
- Explicit Class C/D preservation
- Explicit stop at Founder pruning approval

**This document does not claim:**

- That pruning is authorized
- That Class A or Class B may start
- That Draft PR #341 is merged or closable by this plan alone
- That #333 Batch 6 may start
- That `recover-review` may be deleted
- That guard pack / structural ratchet / frontend-seo membership may change

---

## Task checklist (post-Founder-approval only)

### Task 1: Founder pruning approval recorded

- [ ] Confirm Issue #340 contains Founder text authorizing this plan path (or named revision SHA) for Class A (and Class B status: authorized / deferred).
- [ ] Stop if approval is direction-only or silent on pruning.

### Task 2: Pre-execution reverify (Steps 0.1–0.5)

- [ ] Record live `origin/main` SHA, #274/#275 state, and refreshed A1 consumer grep in the execution branch PR body.

### Task 3: Class A Batch A1 PR

- [ ] Retarget importers/tests for the three seed facades; remove re-export `.mjs` files; run validation; open PR; exact-head CI; merge only under normal Founder/MC merge rules for authorized work.
- [ ] Post compact RESULT on #340 with verification evidence.

### Task 4: Class A Batch A2 PRs (if included in approval)

- [ ] Sub-batch remaining proven re-export facades; skip investigate/KEEP paths; never touch Class C command surface.
- [ ] Post verification RESULT; declare Class A complete.

### Task 5: Class B kickoff (only if Founder authorized)

- [ ] Publish Class B inventory PR (docs) or section update; wait if inventory needs another Founder look.
- [ ] Execute semantic deletions in separate PRs; full validation; no oracle weakening.

### Task 6: Post-prune #333 inventory

- [ ] On pruned protected main, regenerate remaining TS migration surface estimate for Issue #333 resume planning (Batch 6 still separately gated).

### Task 7: Class C exit (future; separate Founder gate)

- [ ] When #274/#275 resolved, Founder decides delete vs redesign `recover-review`; execute under a new plan/PR.

---

## Self-review (plan authorship)

1. **Spec/blueprint coverage:** Class A–D, preserve list, guard §8/§11 gates, journey refusal of mimicry, #274/#275, pruning ACs — mapped above.
2. **Placeholder scan:** Class B exact file list intentionally deferred to kickoff inventory after Class A (called out as a Founder-facing deferral, not silent TBD implementation).
3. **Authority consistency:** Option B direction ≠ prune auth; Class A ≠ Class B; oracle/ratchet/frontend-seo/`recover-review` have separate gates.

---

## Execution handoff (after Founder approves pruning)

When Founder approves this plan for Class A (and states Class B deferred or included):

1. **Subagent-Driven (recommended)** — fresh subagent per Task 2–4, review between batches  
2. **Inline Execution** — `executing-plans` with checkpoints after A1 and after A2  

Until then: **no runtime pruning.**
