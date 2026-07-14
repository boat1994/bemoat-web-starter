# Role handoff comment contract

Canonical GitHub comment format for handing work between Mission Control, Dev/Builder agents, and Reviewer/Red Team roles on an **Active Task Issue**.

This document defines **comment transport only**. It does not change artifact precedence. For source-of-truth boundaries, conflict resolution, exact-head CI, and Main Issue milestone rules, see [project-progress-tracking.md](./project-progress-tracking.md).

## Purpose

Bemoat already has durable artifacts for scope, code state, and verification:

| Artifact | Owns |
|----------|------|
| Implementation Plan | Roadmap, slices, dependencies, verification contract |
| Main Issue | Durable cross-session progress and next permitted action |
| Active Task Issue | Bounded scope, acceptance criteria, task-specific gates |
| Pull Request + exact-head CI | Actual code state and GitHub-verified evidence |
| `.superpowers/sdd/progress.md` | Temporary local/session execution state |
| `pnpm run bemoat:agent:issue -- <issue>` | Read-only preflight to reconstruct live GitHub state |

The remaining gap is **transport between roles**. Mission Control, Dev, and Reviewer should be able to continue work with a short instruction such as:

> Execute the latest approved HANDOFF in Issue #106 after verifying live GitHub state.

Use this contract instead of copying long prompts, plan excerpts, command logs, or review transcripts into every comment.

## Compact-delta contract

GitHub role comments (`HANDOFF`, `RESULT`, `REVIEW_VERDICT`) are **compact deltas**, not standalone task specifications.

**Do:**

- Link the Active Task Issue, exact PR/head when relevant, prior `RESULT` / `REVIEW_VERDICT`, and the plan/spec section when one exists.
- State only the **active delta**: changed scope, verification delta, new stop conditions, blockers, and next handoff.
- Keep exact-state verification, material stop conditions, Critical/Important blockers, and founder gates when omission creates risk.

**Do not restate unless the content changed or omission creates material risk:**

- The Issue body
- The full acceptance-criteria set
- Prior command logs or evidence transcripts
- Unchanged scope and lifecycle rules already on the Issue or in a prior approved comment

**Length guideline:** Aim for about **15–25 lines**. That is a writing guideline, not a hard parser limit. Cutting material risk information to hit a line count is a failure. Lengthening for a material delta, blocker, or founder gate is correct.

Paste-ready defaults are the **concise operational templates** below. The **full reference templates** document every field; do not paste them as the default comment shape.

## Comment types

Post these markers on the **Active Task Issue** as searchable headings:

| Marker | Author | Purpose |
|--------|--------|---------|
| `## HANDOFF` | Mission Control | Send bounded work to the next role or phase |
| `## RESULT` | Dev/Builder agent | Report implementation or correction outcome |
| `## REVIEW_VERDICT` | Reviewer / Red Team | Summarize PASS or BLOCKED gate status |

Do not invent parallel report formats. `## RESULT` **is** the implementation report shape defined in [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation). The legacy heading `## Implementation PR ready` is an alias during transition; prefer `## RESULT` for new comments.

## Placement and source-of-truth rules

- `HANDOFF`, `RESULT`, and gate-level `REVIEW_VERDICT` belong on the **Active Task Issue**.
- Detailed inline code findings and file-level discussion belong in **PR review threads**.
- The **Main Issue** updates only for durable milestones or gates that are already GitHub-verified.
- The **PR current head**, merge state, and **exact-head CI** remain authoritative for code state.
- Comments that include branch names, SHAs, or CI status are **snapshots only**. The receiver must verify live GitHub state before acting.
- Link canonical artifacts (Task Issue, Main Issue, Plan section, PR, CI run) instead of copying long content into comments.
- The actionable handoff is the **latest approved, non-superseded** handoff for that phase—not an older agent summary or chat transcript.

## Snapshot rule

Any branch, base, head SHA, or CI status recorded in a comment reflects the state at posting time.

Before implementation, correction, or re-review:

1. Run `pnpm run bemoat:agent:issue -- <issue-number>` (read-only preflight).
2. Inspect the live PR head, approved base, merge state, and exact-head CI with `gh` or the GitHub UI.
3. Treat stale SHA or non-exact-head CI as a blocker until live state is confirmed.

## Evidence types

Separate evidence clearly in every `RESULT` and `REVIEW_VERDICT`:

| Type | Definition | Examples |
|------|------------|----------|
| **GitHub-verified evidence** | Observable on GitHub without trusting local-only claims | PR URL, current head SHA from GitHub, exact-head CI run URL and conclusion, merged commit on approved base |
| **Local-only evidence** | Useful context that GitHub has not independently confirmed | Local `pnpm run check` output, unstaged working tree notes, agent session observations |

Do not present local-only evidence as GitHub-verified. Do not infer founder approval from CI green or a reviewer PASS.

## Execution audit fields

Every `HANDOFF`, `RESULT`, and `REVIEW_VERDICT` records a compact **Task log** so Mission Control can reconstruct who ran which phase and when. Keep this short—do not paste full command logs or review transcripts.

| Audit field | Required when |
|-------------|---------------|
| Timestamp with timezone | Always (use ISO-8601 with offset, e.g. `2026-07-14T18:50:32+07:00`) |
| Task / Issue and phase | Always |
| Executing role | Always |
| Model and reasoning | An AI agent performs the phase (omit for human-only Mission Control/founder notes, or record `human`) |

These audit fields are **minimum fields** alongside the role-specific tables below. They do not replace artifact precedence in [project-progress-tracking.md](./project-progress-tracking.md).

---

## Concise operational templates (paste-ready default)

Use these for posted comments. Include only the fields needed for this phase. Prefer links over restatement.

### HANDOFF (operational)

```markdown
## HANDOFF

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number>
- Phase: Dev | Reviewer | Red Team | Correction
- Executing role: Mission Control
- Model / reasoning: <model + tier> | human

**Target:** <role/phase>
**Objective:** <one sentence>
**Links:** Issue #<n> · prior RESULT/REVIEW_VERDICT <url> · PR <url> · plan § <path> (as applicable)
**State (verify live):** branch `<name>` · base `<base>` · head `<sha>` (if continuing)
**Delta scope:** <what changed / is allowed now>
**Verify:** <command / CI / review delta only>
**Stop:** <material stop conditions only>
**Founder gate:** Required | Not required | <link>
**Next:** <expected next comment>
```

### RESULT (operational)

```markdown
## RESULT

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number>
- Phase: Dev (implementation) | Dev (correction)
- Executing role: Dev / Builder
- Model / reasoning: <model + tier> | human

**Completed:** <phase>
**State:** branch `<name>` · base `<base>` · head `<sha>` (snapshot)
**PR:** <PR_URL>
**Summary:** <1–3 bullets of what changed>
**Evidence:** GitHub — head `<sha>`, CI <url> → pass/fail; Local — `<cmd>` → pass/fail
**AC audit:** Issue #<n> criteria — Done / Not done / N/A / Waiting (short status + pointer; no full restatement of Issue body)
**Blockers / risks:** None | <delta>
**Prohibited next:** <if any>
**Next:** <expected next comment>
```

### REVIEW_VERDICT (operational)

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number>
- Phase: Reviewer | Red Team | Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: <model + tier> | human

**PR / base / head:** <PR_URL> · `<base>` · `<sha>` (verify live)
**Verdict:** PASS | BLOCKED
**Findings:** Critical: None|<summary + thread> · Important: None|<summary + thread>
**Threads:** <PR_REVIEW_THREAD_URL> (file-level detail stays on the PR)
**Gates:** exact-head CI <url> → pass/fail · open blockers: None|...
**Corrections / re-review:** None | <delta>
**Founder gate:** Required | Not required | <link>
**Next:** <expected next comment>
```

### Operational minimum fields

| Comment | Always include | Include when material |
|---------|----------------|------------------------|
| HANDOFF | Task log, target, objective, Task Issue link, next | Model, state/head, prior verdict link, delta scope, verify, stop, founder gate |
| RESULT | Task log, completed phase, summary, next | Branch/base/head, PR, evidence links, short AC status, blockers, prohibited next |
| REVIEW_VERDICT | Task log, PR/base/head, verdict, findings summary, gates, next | Thread links, corrections, re-review condition, founder gate |

For the complete field catalog, see [Full reference templates](#full-reference-templates-documentation-only).

---

## Full reference templates (documentation only)

**Not the paste-ready default.** Use these to recall required fields when drafting a compact delta. Do not paste the full reference block into GitHub comments unless a material risk requires the extra detail.

### HANDOFF reference fields

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Target role / phase | Always |
| Single objective | Always |
| Execution profile | Mission Control specifies model/reasoning |
| Canonical references | Task Issue always; Main Issue/Plan/PR when they exist |
| Expected state | Code work continues on an existing branch or PR |
| Allowed scope | Always (state as **delta** when prior HANDOFF already defined unchanged scope) |
| Prohibited actions | Always (delta or pointer when unchanged) |
| Required verification | Always (delta preferred) |
| Stop conditions | Always (material stops only in compact form) |
| Founder gate | When merge, production, or destructive work is in scope |
| Next expected handoff | Always |

### RESULT reference fields

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Role / phase completed | Always |
| Branch, approved base, committed head | Code state exists |
| Summary | Always |
| Files or artifacts changed | Always (paths; not full diffs) |
| Commands and results | Always (pass/fail lines or links—not transcripts) |
| GitHub-verified evidence | PR exists or CI is required |
| Local-only evidence | Local commands were run |
| Acceptance criteria audit | Task Issue has acceptance criteria (status + brief evidence pointer; do not paste Issue body) |
| Blockers | When work cannot proceed |
| Residual risks | When risks remain |
| Prohibited next action | When dependent work must not start |
| Next handoff | Always |

### REVIEW_VERDICT reference fields

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Reviewed PR, approved base, exact head | Always |
| Verdict PASS or BLOCKED | Always |
| Critical / Important summary | Always |
| PR thread links | File-level findings exist |
| Evidence gaps | Any verification missing |
| Gate status | Always |
| Required corrections | BLOCKED |
| Re-review condition | BLOCKED or changes requested |
| Founder gate | Merge or production in scope |
| Next handoff | Always |

---

## Good and bad examples

Correction and re-review are the usual places agents over-paste. Prefer the good shape.

### Correction HANDOFF

**Bad** (restates canonical context):

```markdown
## HANDOFF
**Objective:** Implement compact-delta handoff for Issue #106.
**Full goal:** <pasted Issue Goal and Context>
**Scope:** <pasted full Scope and Out of Scope>
**Acceptance criteria:** <pasted entire AC list>
**Prior RESULT evidence:** <pasted command transcripts and file lists>
**Verification:** guard:safety, boilerplate:check, all walkthroughs, full AC audit...
```

**Good** (delta only):

```markdown
## HANDOFF

### Task log
- Timestamp: `2026-07-15T01:00:00+07:00`
- Task / Issue: #106
- Phase: Dev (correction)
- Executing role: Mission Control
- Model / reasoning: human

**Target:** Dev (correction)
**Objective:** Fix Important finding — add duplicated-context validation item per PR thread.
**Links:** Issue #106 · BLOCKED REVIEW_VERDICT <url> · PR <url>#discussion_r...
**State (verify live):** `docs/106-compact-delta-handoff-comments` · base `main` · head `abc1234`
**Delta scope:** `docs/agent-loop/role-handoff-contract.md` only
**Verify:** `pnpm run guard:safety`; resolve the PR thread
**Stop:** No scope expansion; no merge
**Next:** Dev `## RESULT` → re-review
```

### PASS re-review REVIEW_VERDICT

**Bad** (transcript + Issue restatement):

```markdown
## REVIEW_VERDICT
**Verdict:** PASS
**Recap of Issue #106 goal, scope, and all ACs:** ...
**Full prior RESULT command log:** ...
**Inline file diffs and review essay:** ...
```

**Good** (gate summary + links):

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-15T01:20:00+07:00`
- Task / Issue: #106
- Phase: Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**PR / base / head:** <PR_URL> · `main` · `def5678` (verify live)
**Verdict:** PASS
**Findings:** Critical: None · Important: None (thread resolved)
**Threads:** <prior discussion URL>
**Gates:** exact-head CI <url> → pass · open blockers: None
**Founder gate:** Required before merge
**Next:** Mission Control pre-merge checklist reconciliation → human merge
```

---

## Lifecycle example

One full cycle on Active Task Issue #106 with a docs PR (standalone task; no Main Issue). SHAs and CI URLs are snapshots; each receiver verifies live state. Comments below are **compact deltas**.

### 1. HANDOFF — Mission Control → Dev

```markdown
## HANDOFF

### Task log
- Timestamp: `2026-07-15T00:10:00+07:00`
- Task / Issue: #106
- Phase: Dev (implementation)
- Executing role: Mission Control
- Model / reasoning: human

**Target:** Dev (implementation)
**Objective:** Implement compact-delta contract + pre-merge reconciliation gate for Issue #106.
**Links:** Issue #106 · parent #104 · merged PR #105
**State (verify live):** create `docs/106-compact-delta-handoff-comments` from `main` @ `e226b34`
**Delta scope:** `docs/agent-loop/role-handoff-contract.md` + concise wrapper links only
**Verify:** `pnpm run guard:safety`, `pnpm run boilerplate:check`, `git diff --check`, AC audit
**Stop:** No parser/CLI/Actions/child sync/product edits; no merge
**Founder gate:** Not required for PR open
**Next:** Dev posts `## RESULT`
```

### 2. RESULT — Dev after first implementation

```markdown
## RESULT

### Task log
- Timestamp: `2026-07-15T00:40:00+07:00`
- Task / Issue: #106
- Phase: Dev (implementation)
- Executing role: Dev / Builder
- Model / reasoning: Composer 2.5, medium

**Completed:** Dev (implementation)
**State:** `docs/106-compact-delta-handoff-comments` · base `main` · head `abc1234`
**PR:** https://github.com/boat1994/bemoat-web-starter/pull/<n>
**Summary:** Compact-delta templates split; reconciliation gate; wrapper links
**Evidence:** GitHub — head `abc1234`, CI <url> → pending; Local — guard:safety pass, boilerplate:check pass
**AC audit:** Issue #106 — all marked in PR body (Done / Waiting for CI)
**Prohibited next:** Do not merge; do not sync child repos
**Next:** Reviewer `## REVIEW_VERDICT`
```

### 3. REVIEW_VERDICT — BLOCKED

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-15T00:50:00+07:00`
- Task / Issue: #106
- Phase: Reviewer
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**PR / base / head:** <PR_URL> · `main` · `abc1234`
**Verdict:** BLOCKED
**Findings:** Important: missing duplicated-context validation item — <thread url>
**Gates:** exact-head CI pass · open blockers: 1 Important
**Corrections / re-review:** Add validation item; push; resolve thread
**Founder gate:** Not required
**Next:** Mission Control correction `## HANDOFF`
```

### 4. HANDOFF — Mission Control → Dev (correction)

```markdown
## HANDOFF

### Task log
- Timestamp: `2026-07-15T00:55:00+07:00`
- Task / Issue: #106
- Phase: Dev (correction)
- Executing role: Mission Control
- Model / reasoning: human

**Target:** Dev (correction)
**Objective:** Add duplicated-context validation item per BLOCKED verdict thread.
**Links:** Issue #106 · prior BLOCKED REVIEW_VERDICT <url> · PR thread <url>
**State (verify live):** branch `docs/106-…` · head `abc1234`
**Delta scope:** contract checklist only
**Verify:** `pnpm run guard:safety`; resolve thread
**Stop:** No scope expansion; no merge
**Next:** Dev `## RESULT` → re-review
```

### 5. RESULT — Dev after correction

```markdown
## RESULT

### Task log
- Timestamp: `2026-07-15T01:05:00+07:00`
- Task / Issue: #106
- Phase: Dev (correction)
- Executing role: Dev / Builder
- Model / reasoning: Composer 2.5, medium

**Completed:** Dev (correction)
**State:** head `def5678` on same branch/PR
**Summary:** Added duplicated-context validation checklist item
**Evidence:** GitHub — head `def5678`, CI <url> → pass; Local — guard:safety pass
**AC audit:** validation AC — Done
**Prohibited next:** Do not merge until PASS
**Next:** Reviewer `## REVIEW_VERDICT`
```

### 6. REVIEW_VERDICT — PASS → founder gate

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-15T01:15:00+07:00`
- Task / Issue: #106
- Phase: Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**PR / base / head:** <PR_URL> · `main` · `def5678`
**Verdict:** PASS
**Findings:** Critical: None · Important: None
**Gates:** exact-head CI pass · open blockers: None
**Founder gate:** Required before merge
**Next:** Mission Control pre-merge checklist reconciliation → human merge
```

---

## Manual validation checklist

Use before acting on a handoff, posting a dependent HANDOFF, treating a gate as passed, or merging:

- [ ] **Canonical references present** — Task Issue linked; Main Issue, Plan section, and PR linked when they exist
- [ ] **Task log present** — Timestamp with timezone, task/Issue/phase, executing role; model/reasoning when an AI agent ran the phase
- [ ] **Compact delta** — Comment does not restate Issue body, full AC set, prior command logs, prior evidence transcripts, or unchanged scope/lifecycle rules without a material reason
- [ ] **No duplicated canonical context** — Links replace pasted Issue/AC/logs/evidence; unchanged rules are pointed at, not recopied
- [ ] **Live state verified** — Ran `bemoat:agent:issue` and confirmed branch, base, and PR head on GitHub
- [ ] **No stale SHA** — Comment head SHA matches current GitHub PR head (or correction HANDOFF explains expected drift)
- [ ] **Exact-head CI** — Required CI is for the **current** PR head, not an older SHA
- [ ] **Evidence types separated** — Local-only results are not labeled GitHub-verified
- [ ] **Allowed scope and stop conditions** — HANDOFF defines boundaries; implementation stayed within them; material stops/founder gates not dropped for brevity
- [ ] **No open Critical/Important blockers** — REVIEW_VERDICT and PR threads show none before dependent work
- [ ] **Prohibited next action respected** — No merge, child sync, or dependent slice started early
- [ ] **Founder gate explicit** — Approval is linked or stated; not inferred from CI or reviewer PASS
- [ ] **Latest handoff only** — Acting on the newest approved, non-superseded HANDOFF for this phase
- [ ] **No duplicate reporting** — RESULT used instead of a parallel ad-hoc report format
- [ ] **Length guideline respected without unsafe cuts** — ~15–25 lines preferred; material risk content kept even if longer

---

## Pre-merge checklist reconciliation gate

Before every merge, **Mission Control** audits every relevant checklist on the Active Task Issue against **live verified evidence** and updates checkboxes that are already proven.

Rules:

1. **Do not tick** a checkbox from an agent summary, chat transcript, or local-only report that has not been verified on GitHub (or another authoritative live source required by the task).
2. **Safe Issue-body edit:** When updating the Issue body, preserve the full existing body content (no silent section deletes), apply only the checklist/status changes justified by evidence, then **re-fetch** the Issue and confirm the update.
3. **Stale checkbox blocks merge** until either (a) a safe body update succeeds and re-fetch confirms the ticks, or (b) the founder **explicitly accepts** a reconciliation comment.
4. **Reconciliation comment** (fallback) must map **each** stale checkbox to exact PR/head, CI run, `RESULT` / `REVIEW_VERDICT`, and verified evidence. A generic waiver is invalid.
5. Founder acceptance of a reconciliation comment **does not** waive open Critical/Important findings or any later founder gate (merge, production, destructive work).

Dev/Builder agents still must **not** routinely edit the Task Issue checklist. Pre-merge reconciliation is Mission Control (or an explicitly instructed founder/MC action) under this gate.

Example reconciliation comment shape:

```markdown
## RECONCILIATION

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number>
- Phase: Pre-merge checklist reconciliation
- Executing role: Mission Control
- Model / reasoning: human

**PR / head:** <PR_URL> · `<sha>`
**CI:** <exact-head CI url> → pass
**Stale items mapped:**
- [ ] `<checkbox text>` → evidence: RESULT <url>, REVIEW_VERDICT <url>, CI <url>
**Request:** Founder accept this mapping **or** Mission Control will apply a safe Issue-body update after verification.
```

---

## Child-sync impact

`docs/agent-loop/` is **harness-managed** in `bemoat-web-starter`. After this contract change merges, child projects receive it through harness sync — **do not sync child repos in the implementation PR for this issue**:

```bash
# In child repos after starter merge
pnpm run bemoat:boilerplate:sync -- --harness-only
```

No new sync path or project-specific Cloudflare configuration is required. Record sync need in the Task Issue `RESULT` or Main Issue when the contract merges.

## Related docs

- [project-progress-tracking.md](./project-progress-tracking.md) — artifact precedence and Main Issue rules
- [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation) — RESULT field list (operational template lives here)
- [state-template.md](./state-template.md) — local/session recovery only (not GitHub role transport)
- [roles.md](./roles.md) — which role produces or consumes each comment type
- [checklist.md](./checklist.md) — PR and review checklists referencing this contract
