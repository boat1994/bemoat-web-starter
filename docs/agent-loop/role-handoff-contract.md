# Role handoff comment contract

Canonical GitHub comment format for handing work between Mission Control, Dev/Builder agents, and Reviewer/Red Team roles on an **Active Task Issue**.

This document defines **comment transport only**. It does not change artifact precedence. For source-of-truth boundaries, conflict resolution, exact-head CI, and Main Issue milestone rules, see [project-progress-tracking.md](./project-progress-tracking.md). For Mission Control review budget, durable Issue state markers, completion gates, and Core MC-gated `REVIEW_VERDICT` vocabulary, see [../mission-control/mission-control-guide.md](../mission-control/mission-control-guide.md).

### Core Mission Control verdict vocabulary

When a task is Mission Control-managed (`Mission Control mode: required`, or
the legacy Core task that declares both a Main Issue and an Implementation
Plan), `## REVIEW_VERDICT`
must use exactly one of these values — the same enum as the Mission Control
guide and RESULT template:

```text
CORRECTION REQUIRED
ELIGIBLE FOR FOUNDER REVIEW
BLOCKED FOR FOUNDER DECISION
BLOCKED EXTERNAL
STATE CONFLICT
```

Do not use bare `PASS` / `BLOCKED` as the verdict line for Core Mission Control
work. Those legacy shorthand words are retired for MC-gated tasks; map prior
docs mentally as: `PASS` → `ELIGIBLE FOR FOUNDER REVIEW`, and
`BLOCKED` → `CORRECTION REQUIRED` (or a more specific `BLOCKED_*` /
`STATE CONFLICT` outcome when that is what the evidence requires).

Mission Control management is not implied by the Core tier alone. A missing
state block on a non-managed task is warning-only; managed state must never be
silently initialized.

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

Use the wrapper to validate and post a concise operational comment:

```text
pnpm run bemoat:issue:comment -- <issue-number> [--repo owner/repo] [--body-file <path>] [--check] [--allow-warning]
```

Provide the body through `--body-file` or stdin, never both. The wrapper
validates the concise operational heading and its required fields: exactly one
`## HANDOFF`, `## RESULT`, or `## REVIEW_VERDICT`. It does not accept the
full reference templates below as post-ready bodies; reduce those examples to
the operational shape first. Use `--check` to validate without posting, and
use `--allow-warning` only to acknowledge a length warning. The wrapper does
not replace live preflight or Founder gates.

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

Paste-ready defaults are the **concise operational templates** below. The **full reference templates** keep complete documentation-only fenced examples plus field catalogs; do not paste the full reference block as the default comment shape.

### Temporary local-only detail artifact

When a compact `REVIEW_VERDICT` (or correction `HANDOFF`) cannot safely carry enough implementation detail, the reviewer may create a **temporary local scratch file** with the necessary correction detail.

Requirements:

- Prefer an **OS temp path outside the repo**; otherwise use a path proven ignored by Git.
- Never commit, push, attach to GitHub, or treat the file as canonical or GitHub-verified evidence.
- Use it only when the correction agent **shares the same local workspace**.
- Keep durable and file-level findings in **PR review threads**.
- **Delete** the temp file before posting the correction `## RESULT` or any `ELIGIBLE FOR FOUNDER REVIEW` verdict, and verify it is absent and untracked.

## Comment types

Post these markers on the **Active Task Issue** as searchable headings:

| Marker | Author | Purpose |
|--------|--------|---------|
| `## HANDOFF` | Mission Control | Send bounded work to the next role or phase |
| `## RESULT` | Dev/Builder agent | Report implementation or correction outcome |
| `## REVIEW_VERDICT` | Reviewer / Red Team | Gate-level review result using the Core Mission Control verdict enum |

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

Routine in-scope diagnosis, CI reruns, evidence reconciliation, and localized
corrections do not require Founder approval. Preserve Founder gates for material
scope/AC/architecture changes, exhausted review budget, reopening, merge,
production/migration/destructive work, and required manual QA.

## Evidence types

Separate evidence clearly in every `RESULT` and `REVIEW_VERDICT`:

| Type | Definition | Examples |
|------|------------|----------|
| **GitHub-verified evidence** | Observable on GitHub without trusting local-only claims | PR URL, current head SHA from GitHub, exact-head CI run URL and conclusion, merged commit on approved base |
| **Local-only evidence** | Useful context that GitHub has not independently confirmed | Local `pnpm run check` output, unstaged working tree notes, agent session observations |

Do not present local-only evidence as GitHub-verified. Do not infer founder approval from CI green or a reviewer `ELIGIBLE FOR FOUNDER REVIEW`.

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
**Managed state:** AWAITING_REVIEW_1 · PR #<n> · `<sha>` · counters unchanged (0/0) — required when Delivery Coordinator completes initial delivery on managed tasks
**AC audit:** Issue #<n> criteria — Done / Not done / N/A / Waiting (short status + pointer; no full restatement of Issue body)
**Blockers / risks:** None | <delta>
**Prohibited next:** <if any>
**Efficiency:** Normal | High usage | Looped | Manual intervention
**Next:** <expected next comment>
```

`**Efficiency:**` is **optional**. Omit it on unremarkable runs. Include it when a qualitative signal helps later workflow analysis (abnormal resource use, agent loops, or human intervention). Allowed values: `Normal`, `High usage`, `Looped`, `Manual intervention`. You may append an approximate token count only when a tool shows a clear number **and** the run is abnormal — never require token recording when data is missing or the run is normal.

### FAST RESULT (operational)

Use only for `Small + Mission Control not required` work that has not triggered
an escalation. It is a compact `## RESULT`, not a new comment type.

```markdown
## RESULT
**Profile:** FAST
**Task:** #<number> · `<branch>` → `<base>` · head `<sha>`
**PR:** <PR_URL>
**Completed:** <one-sentence bounded result>
**Evidence:** Local — `<focused command>` → pass; GitHub — exact-head CI <url> → pass
**AC audit:** Done | N/A | Waiting for Founder review
**Risks / escalation:** None | <trigger and stop>
**Next:** Founder review / merge decision
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
**Verdict:** CORRECTION REQUIRED | ELIGIBLE FOR FOUNDER REVIEW | BLOCKED FOR FOUNDER DECISION | BLOCKED EXTERNAL | STATE CONFLICT
**Findings:** Critical: None|<summary + thread> · Important: None|<summary + thread>
**Threads:** <PR_REVIEW_THREAD_URL> (file-level detail stays on the PR)
**Gates:** exact-head CI <url> → pass/fail · open blockers: None|...
**Managed state:** <next state> · cycle <n> · full_review_count <n> · last_reviewed_head `<sha>` — required on managed tasks; write atomically with verdict
**Corrections / re-review:** None | <delta>
**Founder gate:** Required | Not required | <link>
**Next:** <expected next comment>
```

### Operational minimum fields

| Comment | Always include | Include when material |
|---------|----------------|------------------------|
| HANDOFF | Task log, target, objective, Task Issue link, next | Model, state/head, prior verdict link, delta scope, verify, stop, founder gate |
| RESULT | Task log, completed phase, summary, next | Branch/base/head, PR, evidence links, Managed state (delivery), short AC status, blockers, prohibited next, Efficiency |
| REVIEW_VERDICT | Task log, PR/base/head, verdict, findings summary, gates, next | Managed state (review), thread links, corrections, re-review condition, founder gate |

## Atomic delivery and review (managed tasks)

On managed tasks (`Mission Control mode: required`), role completion must be
**atomic**: the role comment and the managed state block update happen in the
same authorized run.

- **Delivery Coordinator:** after Draft PR + passing exact-head CI, post
  `## RESULT` and update the state block to `AWAITING_REVIEW_1` with
  `active_pr`, `current_head`, and counters unchanged at `0`/`0`.
- **Reviewer:** post `## REVIEW_VERDICT` and update `review_cycle`,
  `full_review_count`, `last_reviewed_head`, and the resulting state in the same
  run.
- **Allowed Issue edits:** only content between `bemoat-mission-control-state`
  markers. Do not edit acceptance-criteria checklists (Mission Control
  pre-merge reconciliation only).
- **Bookkeeping lag:** if PR/head/CI/RESULT are valid but the state block is
  stale, Mission Control reconciles deterministically — this is not
  `STATE_CONFLICT`.

For the complete field catalog, see [Full reference templates](#full-reference-templates-documentation-only).

---

## Full reference templates (documentation only)

**Not the paste-ready default.** These complete templates document every field. Prefer the concise operational templates when posting comments. Do not paste these full blocks into GitHub unless a material risk requires the extra detail.

### HANDOFF reference template

Mission Control posts `## HANDOFF` to authorize the next role. Include only the minimum fields relevant to the phase; in compact deltas, state unchanged scope as a pointer rather than a full restatement.

```markdown
## HANDOFF

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number> — <short task name>
- Phase: Dev (implementation) | Reviewer | Red Team | Correction
- Executing role: Mission Control
- Model / reasoning: <model + tier> | human

**Target role / phase:** Dev (implementation) | Reviewer | Red Team | Correction

**Single objective:**
<!-- One sentence. What must be true when this phase ends? -->

**Execution profile:**
<!-- When Mission Control sets it: model, reasoning tier, agent tool. Omit if default. -->

**Canonical references:**
- Task Issue: #<number> (this issue)
- Main Issue: #<number> (if applicable)
- Plan section: `docs/superpowers/plans/<path>` § <section> (if applicable)
- PR: <PR_URL> (if continuing existing work)
- Prior RESULT / REVIEW_VERDICT: <url> (when correcting or re-reviewing)

**Expected state (verify live before acting):**
- Branch: `<branch-name>`
- Approved base: `<main|dev|...>`
- Expected head SHA: `<sha>` (snapshot—verify on GitHub)

**Allowed scope:**
<!-- Files, behaviors, and outcomes permitted in this phase -->

**Prohibited actions:**
<!-- e.g. no merge, no child sync, no schema migration, no scope expansion -->

**Required verification:**
<!-- Commands, exact-head CI, review gates, founder approval -->

**Stop conditions:**
<!-- When to stop and post RESULT without continuing -->

**Founder gate:**
<!-- Required | Not required | Already approved in <link> -->

**Next expected handoff:**
<!-- e.g. Dev posts ## RESULT; Reviewer posts ## REVIEW_VERDICT -->
```

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Target role / phase | Always |
| Single objective | Always |
| Execution profile | Mission Control specifies model/reasoning |
| Canonical references | Task Issue always; Main Issue/Plan/PR/prior verdict when they exist |
| Expected state | Code work continues on an existing branch or PR |
| Allowed scope | Always (state as **delta** when prior HANDOFF already defined unchanged scope) |
| Prohibited actions | Always (delta or pointer when unchanged) |
| Required verification | Always (delta preferred) |
| Stop conditions | Always (material stops only in compact form) |
| Founder gate | When merge, production, or destructive work is in scope |
| Next expected handoff | Always |

### RESULT reference template

Dev/Builder agents post `## RESULT` after implementation or correction. This extends the existing implementation report—do not create a second parallel report. Prefer evidence links over transcripts.

```markdown
## RESULT

### Task log
- Timestamp: `<ISO-8601 with timezone>` (completion; include start time when useful)
- Task / Issue: #<number> — <short task name>
- Phase: Dev (implementation) | Dev (correction)
- Executing role: Dev / Builder
- Model / reasoning: <model + tier> | human

**Role / phase completed:** Dev (implementation) | Dev (correction)

**Code state (verify live on GitHub):**
- Branch: `<branch-name>`
- Approved base: `<main|dev|...>`
- Committed head SHA: `<sha>` (snapshot)

**PR:** <PR_URL>

### Summary
- ...

### Files or artifacts changed
- ...

### Commands run
- `...` → pass/fail

### GitHub-verified evidence
- PR head SHA (from GitHub): `<sha>`
- Exact-head CI: <CI_RUN_URL> → pass/fail/pending
- Other GitHub links: ...

### Local-only evidence
- `pnpm run check` → pass/fail (local)
- Other local commands or observations: ...

### Acceptance criteria audit
- [ ] Criterion — `Done` | `Not done` | `Not applicable` | `Waiting for CI / human review` — brief evidence

### Blockers
- None | ...

### Residual risks
- ...

### Efficiency
<!-- Optional. Normal | High usage | Looped | Manual intervention. Omit when unremarkable. Approximate tokens only when tool-visible and the run is abnormal. -->

### Prohibited next action
<!-- e.g. do not merge, do not start Slice B, do not sync child repos -->

### Next handoff
<!-- e.g. Reviewer: post ## REVIEW_VERDICT after PR review and exact-head CI -->
```

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
| Efficiency | When a qualitative execution signal helps later analysis (omit when unremarkable; approximate tokens only when tool-visible and abnormal) |
| Prohibited next action | When dependent work must not start |
| Next handoff | Always |

### REVIEW_VERDICT reference template

Reviewer or Red Team posts `## REVIEW_VERDICT` with gate-level summary. Put file-level findings in PR review threads and link them here. If compact form cannot carry enough correction detail, use a [temporary local-only detail artifact](#temporary-local-only-detail-artifact)—never paste a second source of truth into GitHub comments.

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `<ISO-8601 with timezone>`
- Task / Issue: #<number> — <short task name>
- Phase: Reviewer | Red Team | Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: <model + tier> | human

**Reviewed PR:** <PR_URL>
**Approved base:** `<main|dev|...>`
**Exact head reviewed:** `<sha>` (snapshot—verify current PR head matches)

**Verdict:** CORRECTION REQUIRED | ELIGIBLE FOR FOUNDER REVIEW | BLOCKED FOR FOUNDER DECISION | BLOCKED EXTERNAL | STATE CONFLICT

### Critical / Important findings summary
- Critical: None | <one-line summary + link to PR thread>
- Important: None | <one-line summary + link to PR thread>

### Detailed findings (PR threads)
- <file or topic>: <PR_REVIEW_THREAD_URL>

### Evidence gaps
- None | <missing exact-head CI, missing commands, stale SHA, etc.>

### Gate status
- Exact-head CI: pass/fail/pending — <CI_RUN_URL>
- Acceptance criteria: met / not met / partial
- Open Critical/Important blockers: None | ...

### Required corrections
- None | <actionable list when CORRECTION REQUIRED or BLOCKED FOR FOUNDER DECISION>

### Re-review condition
<!-- What Dev must satisfy before the next REVIEW_VERDICT; e.g. fix threads X,Y and push new head -->

**Founder gate:** Required before merge | Not required | Already approved in <link>

### Next handoff
<!-- e.g. Mission Control posts correction HANDOFF | founder approval | merge by human -->
```

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Reviewed PR, approved base, exact head | Always |
| Verdict (Core Mission Control enum) | Always |
| Critical / Important summary | Always |
| PR thread links | File-level findings exist |
| Evidence gaps | Any verification missing |
| Gate status | Always |
| Required corrections | CORRECTION REQUIRED or BLOCKED FOR FOUNDER DECISION |
| Re-review condition | CORRECTION REQUIRED or changes requested |
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
**Links:** Issue #106 · CORRECTION REQUIRED REVIEW_VERDICT <url> · PR <url>#discussion_r...
**State (verify live):** `docs/106-compact-delta-handoff-comments` · base `main` · head `abc1234`
**Delta scope:** `docs/agent-loop/role-handoff-contract.md` only
**Verify:** `pnpm run guard:safety`; resolve the PR thread
**Stop:** No scope expansion; no merge
**Next:** Dev `## RESULT` → re-review
```

### Eligible re-review REVIEW_VERDICT

**Bad** (transcript + Issue restatement):

```markdown
## REVIEW_VERDICT
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
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
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
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

### 3. REVIEW_VERDICT — CORRECTION REQUIRED

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-15T00:50:00+07:00`
- Task / Issue: #106
- Phase: Reviewer
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**PR / base / head:** <PR_URL> · `main` · `abc1234`
**Verdict:** CORRECTION REQUIRED
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
**Objective:** Add duplicated-context validation item per CORRECTION REQUIRED verdict thread.
**Links:** Issue #106 · prior CORRECTION REQUIRED REVIEW_VERDICT <url> · PR thread <url>
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
**Prohibited next:** Do not merge until ELIGIBLE FOR FOUNDER REVIEW
**Efficiency:** Looped
**Next:** Reviewer `## REVIEW_VERDICT`
```

### 6. REVIEW_VERDICT — ELIGIBLE FOR FOUNDER REVIEW → founder gate

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-15T01:15:00+07:00`
- Task / Issue: #106
- Phase: Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**PR / base / head:** <PR_URL> · `main` · `def5678`
**Verdict:** ELIGIBLE FOR FOUNDER REVIEW
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
- [ ] **Founder gate explicit** — Approval is linked or stated; not inferred from CI or reviewer `ELIGIBLE FOR FOUNDER REVIEW`
- [ ] **Latest handoff only** — Acting on the newest approved, non-superseded HANDOFF for this phase
- [ ] **No duplicate reporting** — RESULT used instead of a parallel ad-hoc report format
- [ ] **Length guideline respected without unsafe cuts** — ~15–25 lines preferred; material risk content kept even if longer
- [ ] **Temp detail artifact cleaned up** — If a local-only scratch file was used, it lived outside the repo (or was Git-ignored), was never committed/pushed/attached, and is deleted/absent/untracked before RESULT or `ELIGIBLE FOR FOUNDER REVIEW`

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
