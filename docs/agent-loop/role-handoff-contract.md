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

> Execute the latest approved HANDOFF in Issue #104 after verifying live GitHub state.

Use this contract instead of copying long prompts, plan excerpts, command logs, or review transcripts into every comment.

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

## HANDOFF template

Mission Control posts `## HANDOFF` to authorize the next role. Include only the minimum fields relevant to the phase.

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

### HANDOFF minimum fields

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Target role / phase | Always |
| Single objective | Always |
| Execution profile | Mission Control specifies model/reasoning |
| Canonical references | Task Issue always; Main Issue/Plan/PR when they exist |
| Expected state | Code work continues on an existing branch or PR |
| Allowed scope | Always |
| Prohibited actions | Always |
| Required verification | Always |
| Stop conditions | Always |
| Founder gate | When merge, production, or destructive work is in scope |
| Next expected handoff | Always |

---

## RESULT template

Dev/Builder agents post `## RESULT` after implementation or correction. This extends the existing implementation report—do not create a second parallel report.

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

### Prohibited next action
<!-- e.g. do not merge, do not start Slice B, do not sync child repos -->

### Next handoff
<!-- e.g. Reviewer: post ## REVIEW_VERDICT after PR review and exact-head CI -->
```

### RESULT minimum fields

| Field | Required when |
|-------|----------------|
| Task log (timestamp, task/Issue/phase, executing role; model/reasoning when AI) | Always |
| Role / phase completed | Always |
| Branch, approved base, committed head | Code state exists |
| Summary | Always |
| Files or artifacts changed | Always |
| Commands and results | Always |
| GitHub-verified evidence | PR exists or CI is required |
| Local-only evidence | Local commands were run |
| Acceptance criteria audit | Task Issue has acceptance criteria |
| Blockers | When work cannot proceed |
| Residual risks | When risks remain |
| Prohibited next action | When dependent work must not start |
| Next handoff | Always |

---

## REVIEW_VERDICT template

Reviewer or Red Team posts `## REVIEW_VERDICT` with gate-level summary. Put file-level findings in PR review threads and link them here.

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

**Verdict:** PASS | BLOCKED

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
- None | <actionable list when BLOCKED>

### Re-review condition
<!-- What Dev must satisfy before the next REVIEW_VERDICT; e.g. fix threads X,Y and push new head -->

**Founder gate:** Required before merge | Not required | Already approved in <link>

### Next handoff
<!-- e.g. Mission Control posts correction HANDOFF | founder approval | merge by human -->
```

### REVIEW_VERDICT minimum fields

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

## Lifecycle example

One full cycle on Active Task Issue #104 with PR #105 (standalone task; no Main Issue). SHAs and CI URLs are snapshots; each receiver verifies live state.

### 1. HANDOFF — Mission Control → Dev

```markdown
## HANDOFF

### Task log
- Timestamp: `2026-07-14T18:00:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Dev (implementation)
- Executing role: Mission Control
- Model / reasoning: human

**Target role / phase:** Dev (implementation)

**Single objective:** Implement docs-only handoff contract and wrapper links for Issue #104.

**Execution profile:** Composer 2.5, medium reasoning

**Canonical references:**
- Task Issue: #104
- Plan section: n/a (standalone task)

**Expected state:**
- Branch: create `docs/104-github-native-handoff-comments` from `main`
- Approved base: `main`

**Allowed scope:** `docs/agent-loop/**`, `AGENTS.md` link updates only

**Prohibited actions:** No parser/CLI/Actions changes; no child repo edits; no merge

**Required verification:** `pnpm run guard:safety`, `pnpm run boilerplate:check`

**Stop conditions:** Dirty unrelated working tree; checks fail

**Founder gate:** Not required for PR open

**Next expected handoff:** Dev posts `## RESULT` with PR URL
```

### 2. RESULT — Dev after first implementation

```markdown
## RESULT

### Task log
- Timestamp: `2026-07-14T18:20:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Dev (implementation)
- Executing role: Dev / Builder
- Model / reasoning: Composer 2.5, medium

**Role / phase completed:** Dev (implementation)

**Code state:**
- Branch: `docs/104-github-native-handoff-comments`
- Approved base: `main`
- Committed head SHA: `abc1234` (snapshot)

**PR:** https://github.com/boat1994/bemoat-web-starter/pull/105

### Summary
- Added `role-handoff-contract.md` and wrapper doc links.

### Files or artifacts changed
- `docs/agent-loop/role-handoff-contract.md`
- `AGENTS.md`, `docs/agent-loop/README.md`, ...

### Commands run
- `pnpm run guard:safety` → pass
- `pnpm run boilerplate:check` → pass

### GitHub-verified evidence
- PR head SHA: `abc1234`
- Exact-head CI: https://github.com/.../actions/runs/999 → pass

### Local-only evidence
- Manual link walkthrough from clean checkout → pass

### Acceptance criteria audit
- [ ] Canonical contract — `Done` — `role-handoff-contract.md` added
- [ ] Templates — `Done` — HANDOFF/RESULT/REVIEW_VERDICT sections present

### Blockers
- None

### Residual risks
- Child repos need harness sync after merge (documented; not in this PR)

### Prohibited next action
- Do not start dependent automation issue until contract is merged

### Next handoff
- Reviewer: post `## REVIEW_VERDICT` after PR review
```

### 3. REVIEW_VERDICT — BLOCKED

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-14T18:30:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Reviewer
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**Reviewed PR:** https://github.com/boat1994/bemoat-web-starter/pull/105
**Approved base:** `main`
**Exact head reviewed:** `abc1234`

**Verdict:** BLOCKED

### Critical / Important findings summary
- Important: Missing manual validation checklist item for stale SHA — see PR thread

### Detailed findings (PR threads)
- `docs/agent-loop/role-handoff-contract.md`: https://github.com/.../pull/105#discussion_r123

### Evidence gaps
- None

### Gate status
- Exact-head CI: pass
- Open Critical/Important blockers: 1 Important (checklist gap)

### Required corrections
- Add stale SHA item to manual validation checklist

### Re-review condition
- Push fix; exact-head CI green; resolve PR thread

**Founder gate:** Not required

### Next handoff
- Mission Control posts correction `## HANDOFF` to Dev
```

### 4. HANDOFF — Mission Control → Dev (correction)

```markdown
## HANDOFF

### Task log
- Timestamp: `2026-07-14T18:35:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Dev (correction)
- Executing role: Mission Control
- Model / reasoning: human

**Target role / phase:** Dev (correction)

**Single objective:** Address Important finding: add stale SHA checklist item per PR thread.

**Canonical references:**
- Task Issue: #104
- PR: https://github.com/boat1994/bemoat-web-starter/pull/105

**Expected state:**
- Branch: `docs/104-github-native-handoff-comments`
- Approved base: `main`
- Expected head SHA: `abc1234` (verify live)

**Allowed scope:** `docs/agent-loop/role-handoff-contract.md` only

**Prohibited actions:** No scope expansion; no merge

**Required verification:** `pnpm run guard:safety`; resolve PR thread

**Stop conditions:** New Critical/Important findings

**Founder gate:** Not required

**Next expected handoff:** Dev posts `## RESULT`; Reviewer re-reviews
```

### 5. RESULT — Dev after correction

```markdown
## RESULT

### Task log
- Timestamp: `2026-07-14T18:45:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Dev (correction)
- Executing role: Dev / Builder
- Model / reasoning: Composer 2.5, medium

**Role / phase completed:** Dev (correction)

**Code state:**
- Branch: `docs/104-github-native-handoff-comments`
- Approved base: `main`
- Committed head SHA: `def5678` (snapshot)

**PR:** https://github.com/boat1994/bemoat-web-starter/pull/105

### Summary
- Added stale SHA item to manual validation checklist.

### GitHub-verified evidence
- PR head SHA: `def5678`
- Exact-head CI: https://github.com/.../actions/runs/1000 → pass

### Local-only evidence
- `pnpm run guard:safety` → pass

### Acceptance criteria audit
- [ ] Manual validation checklist — `Done` — stale SHA item added

### Prohibited next action
- Do not merge until REVIEW_VERDICT PASS

### Next handoff
- Reviewer: post `## REVIEW_VERDICT`
```

### 6. REVIEW_VERDICT — PASS → founder gate

```markdown
## REVIEW_VERDICT

### Task log
- Timestamp: `2026-07-14T18:55:00+07:00`
- Task / Issue: #104 — GitHub-native handoff contract
- Phase: Re-review
- Executing role: Reviewer / Red Team
- Model / reasoning: GPT-5.6 Codex, medium

**Reviewed PR:** https://github.com/boat1994/bemoat-web-starter/pull/105
**Approved base:** `main`
**Exact head reviewed:** `def5678`

**Verdict:** PASS

### Critical / Important findings summary
- Critical: None
- Important: None (thread resolved)

### Gate status
- Exact-head CI: pass
- Acceptance criteria: met

### Required corrections
- None

**Founder gate:** Required before merge to `main` (human review)

### Next handoff
- Human founder: review PR, merge if acceptable. Mission Control may record the durable milestone after merge when a Main Issue exists.
```

---

## Manual validation checklist

Use before acting on a handoff, posting a dependent HANDOFF, or treating a gate as passed:

- [ ] **Canonical references present** — Task Issue linked; Main Issue, Plan section, and PR linked when they exist
- [ ] **Task log present** — Timestamp with timezone, task/Issue/phase, executing role; model/reasoning when an AI agent ran the phase
- [ ] **Live state verified** — Ran `bemoat:agent:issue` and confirmed branch, base, and PR head on GitHub
- [ ] **No stale SHA** — Comment head SHA matches current GitHub PR head (or correction HANDOFF explains expected drift)
- [ ] **Exact-head CI** — Required CI is for the **current** PR head, not an older SHA
- [ ] **Evidence types separated** — Local-only results are not labeled GitHub-verified
- [ ] **Allowed scope and stop conditions** — HANDOFF defines boundaries; implementation stayed within them
- [ ] **No open Critical/Important blockers** — REVIEW_VERDICT and PR threads show none before dependent work
- [ ] **Prohibited next action respected** — No merge, child sync, or dependent slice started early
- [ ] **Founder gate explicit** — Approval is linked or stated; not inferred from CI or reviewer PASS
- [ ] **Latest handoff only** — Acting on the newest approved, non-superseded HANDOFF for this phase
- [ ] **No duplicate reporting** — RESULT used instead of a parallel ad-hoc report format

---

## Child-sync impact

`docs/agent-loop/` is **harness-managed** in `bemoat-web-starter`. Child projects receive this contract through the normal harness sync workflow:

```bash
# In child repos after starter merge
pnpm run bemoat:boilerplate:sync -- --harness-only
```

This issue does not edit child repositories or add project-specific Cloudflare configuration. Record sync need in the Task Issue `RESULT` or Main Issue when the contract merges.

## Related docs

- [project-progress-tracking.md](./project-progress-tracking.md) — artifact precedence and Main Issue rules
- [AGENTS.md § Issue report](../../AGENTS.md#issue-report-after-pr-creation) — RESULT field requirements
- [state-template.md](./state-template.md) — local/session recovery only (not GitHub role transport)
- [roles.md](./roles.md) — which role produces or consumes each comment type
- [checklist.md](./checklist.md) — PR and review checklists referencing this contract
