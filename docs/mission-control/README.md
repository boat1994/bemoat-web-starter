# Mission Control

Mission Control is the coordination layer for AI-assisted development in Bemoat
repositories. A maintainer who reads only this README should be able to install
it, configure ChatGPT, start a run, and know where policy details live—without
reading the entire guide first.

## What Mission Control is

Mission Control determines the current **verified** project state from GitHub,
selects **exactly one** permitted next action, routes that action to the correct
role (Dev, Reviewer, or Founder), records the durable result in GitHub, and
stops.

It is **not** the default implementation agent, a perpetual reviewer, or an
auto-merge system.

## What problem it solves

Without durable Mission Control state, work often:

- restarts full review after every small correction;
- treats Important / Minor / Nit findings as endless blockers;
- loses the review count when a new chat starts;
- treats chat history as the source of truth;
- burns agent quota on process churn instead of product progress.

Mission Control prevents that by keeping policy in the repository, state in
GitHub, normal review to three cycles, and evidence on the exact PR head.

## How the workflow changes

Before: chat session → implement → open-ended re-review → more nits → repeat.

After:

```text
Mission Control HANDOFF
  → Dev RESULT
  → Review 1 (full, task-bounded)
  → Correction RESULT (when required)
  → Review 2 (delta only)
  → Review 3 (Blocker/Critical verification only)
  → ELIGIBLE FOR FOUNDER REVIEW
  → Founder-approved merge
```

Rules that change day-to-day behavior:

- GitHub Issues/PR/CI are authoritative; chat is context only.
- One bounded Mission Control action (or one state transition) per run.
- Review 2/3 never restart a repository-wide search after a small correction.
- Minor/Nit cannot block completion.
- Founder gate remains required for merge.

## Canonical files

| File | Responsibility |
| --- | --- |
| [`mission-control-guide.md`](./mission-control-guide.md) | Only long-form operating policy |
| [`../../prompts/mission-control/chatgpt-project-loader.md`](../../prompts/mission-control/chatgpt-project-loader.md) | Ready-to-paste ChatGPT Project instruction |
| [`handoff-template.md`](./handoff-template.md) | Full `## HANDOFF` field checklist |
| [`result-template.md`](./result-template.md) | Full `## RESULT` / verdict field checklist |
| [`project-overrides.example.md`](./project-overrides.example.md) | Child override example |
| [`../agent-loop/role-handoff-contract.md`](../agent-loop/role-handoff-contract.md) | Compact GitHub comment transport |

**Authority:** For Core / multi-stage Mission Control work, reviewer verdicts and
review-budget rules come from the guide. The role-handoff contract owns compact
comment shape only; it must use the same verdict vocabulary (see below).

Normal Mission Control runs must load the guide from the **merged approved
protected base**, never from an unmerged task branch.

## Reviewer verdict vocabulary (single source)

For Core Mission Control review, `## REVIEW_VERDICT` must use exactly one of:

```text
CORRECTION REQUIRED
ELIGIBLE FOR FOUNDER REVIEW
BLOCKED FOR FOUNDER DECISION
BLOCKED EXTERNAL
STATE CONFLICT
```

Do not invent parallel gate words for Core MC work. Compact GitHub comments still
use the `## REVIEW_VERDICT` heading from the role-handoff contract, but the
verdict line uses this enum.

## How to install (starter)

1. Merge the Mission Control harness PR into the approved protected base (`main`
   while bootstrap applies; otherwise the repo’s protected integration branch).
2. Confirm the guide exists on that base:
   `docs/mission-control/mission-control-guide.md`
3. Run:

```bash
pnpm run guard:mission-control-contract
pnpm run guard:safety
```

4. Do not treat an unmerged feature-branch guide as operating policy.

## How to configure ChatGPT Project

1. Open `prompts/mission-control/chatgpt-project-loader.md`.
2. Copy the **entire** file into ChatGPT Project instructions.
3. Do **not** paste the full guide into Project instructions.
4. Start a fresh chat when dogfooding so chat history cannot masquerade as state.
5. Point the session at a real Issue/PR and ask Mission Control to reconstruct
   state and emit one next action.

## How to configure child repositories

1. After the starter merge, in the child repo run:

```bash
pnpm run bemoat:boilerplate:sync -- --harness-only
```

2. Review the sync diff. Do not copy Cloudflare IDs, Worker names, secrets, or
   child app infrastructure.
3. If the child needs project-specific gates, copy
   [`project-overrides.example.md`](./project-overrides.example.md) to
   `.bemoat/mission-control-overrides.md` and fill only **permitted** fields.
4. Never add `.bemoat/mission-control-overrides.md` to `managedPaths`. Sync must
   leave that file byte-stable.
5. Run `pnpm run bemoat:guard:safety` (or
   `pnpm run bemoat:guard:mission-control-contract`) in the child.

## How to migrate existing tasks

When an active Core task already has review history but no valid state block:

1. Reconstruct completed review rounds from Issue/PR comments when evidence is
   clear.
2. Write the marker block with reconstructed `review_cycle` and
   `last_reviewed_head`.
3. If reconstruction is ambiguous, ask the Founder once for the starting cycle.
4. Return `STATE MIGRATION REQUIRED` until migration is complete.
5. Do **not** silently grant a fresh three-cycle budget.

Starter marker skeleton for Active Task Issues (Core / multi-stage only):

````md
<!-- bemoat-mission-control-state:start -->
```yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: null
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.0.0
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: "Identify one next bounded action"
material_change_status: none
updated_at: null
updated_by: null
```
<!-- bemoat-mission-control-state:end -->
````

Update only the content between the markers. Preserve human-authored Issue body
outside them. Small standalone tasks may omit this ceremony.

## Standard daily flow

Recommended kickoff when a valid handoff exists:

```text
Execute the latest approved ## HANDOFF in Issue #N after verifying live GitHub state.
```

When no valid handoff exists:

```text
Verify the live state of Issue #N and its active PR, identify exactly one permitted next action, and provide a compact ## HANDOFF.
```

Review cycle intent (details in the guide):

| Cycle | Type | Scope |
| --- | --- | --- |
| Review 1 | Full | Task-bounded AC, changed behavior, connected risk, exact-head checks |
| Review 2 | Delta | Enumerated findings + files since `last_reviewed_head` |
| Review 3 | Blocker verification | Unresolved Blocker/Critical only |

Important findings should be fixed inside remaining budget when bounded.
Minor/Nit become follow-ups. After Review 3, Mission Control chooses
`ELIGIBLE FOR FOUNDER REVIEW`, `BLOCKED FOR FOUNDER DECISION`, or
`BLOCKED EXTERNAL`—never Review 4.

## Common commands

```bash
# Mission Control contract only
pnpm run guard:mission-control-contract

# Full safety pack (includes Mission Control)
pnpm run guard:safety

# Focused tests
pnpm exec vitest run tests/int/mission-control-contract.int.spec.ts
pnpm exec vitest run tests/int/boilerplate-sync.int.spec.ts
pnpm exec vitest run tests/int/guard-pack.int.spec.ts

# Child harness pull (after starter merge)
pnpm run bemoat:boilerplate:sync -- --harness-only
```

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Guide missing on approved base | `BLOCKED EXTERNAL` — do not fall back to task-branch policy |
| Plan / Issue / PR / state disagree | `STATE CONFLICT` — one reconciliation action, then stop |
| Active task mid-review without state block | `STATE MIGRATION REQUIRED` — migrate; do not reset budget |
| PR head moved after a review | Prior verdict is historical only; cover the new exact head |
| Want another full review after a tiny fix | Not allowed; assign Review 2 delta unless Founder authorizes material change |
| Loader feels “too short” for policy details | Correct — read the guide; Project instruction stays the loader |

## Rollout sequence

1. Merge starter PR to protected base.
2. Replace long ChatGPT Project text with the loader file.
3. Dogfood a fresh session (repo/ref/SHA/version + one next action).
4. Dogfood Review 1 → correction → Review 2 delta.
5. Dogfood Review 3 nit → follow-up + `ELIGIBLE FOR FOUNDER REVIEW`.
6. Sync one child with `--harness-only`; confirm override unchanged.
7. Migrate active child tasks explicitly.
8. Use on ≥3 bounded tasks before changing policy again.

## Versioning the policy

Guide frontmatter `version` is semver:

- **Patch** — editorial only
- **Minor** — backward-compatible addition
- **Major** — incompatible state machine / budget / severity / completion change

Do not hardcode the policy commit SHA inside the guide file. The loader must
report the Git ref and SHA used for the run.

## Manual dogfood checklist (Founder)

1. Fresh Project bootstrap with loader only
2. Small correction → Review 2 delta (not full re-review)
3. Review 3 nit → follow-up + eligible for Founder Review
4. Verified blocker after Review 3 → blocked for Founder, no Review 4
5. Material change → stop for Founder decision
6. New session mid-task continues recorded cycle
7. Child sync preserves `.bemoat/mission-control-overrides.md` (sync int tests cover this)
