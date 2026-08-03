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
  → Dev RESULT + state AWAITING_REVIEW_1 (atomic delivery)
  → Review 1 (full, task-bounded)
  → Correction RESULT (when required)
  → Review 2 (delta only)
  → Review 3 (Blocker/Critical verification only)
  → ELIGIBLE FOR FOUNDER REVIEW
  → Founder-approved merge
```

For managed implementation dispatch, use
`pnpm run bemoat:mission-control:dispatch -- <issue-number> --body-file <handoff.md>`
to bind `READY -> IN_PROGRESS` to the existing `## HANDOFF` transport with
rollback and concurrent-write protection.

Rules that change day-to-day behavior:

- GitHub Issues/PR/CI are authoritative; chat is context only.
- One bounded Mission Control action (or one state transition) per run.
- A durable state transition does not by itself require another model run.
- Review 2/3 never restart a repository-wide search after a small correction.
- Minor/Nit cannot block completion.
- Founder gate remains required for merge.

## Canonical files

| File | Responsibility |
| --- | --- |
| [`mission-control-guide.md`](./mission-control-guide.md) | Only long-form operating policy |
| [`command-reference.md`](./command-reference.md) | Canonical command and credential-boundary reference |
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

The one-time genesis managed-Task bootstrap is the exception for Issue
creation: its implementation is reviewed as an ordinary PR, while its runtime
still requires a separate exact Founder authorization, protected environment
approval, live evidence, and signed readback. Do not execute it against Issue
#262 during the implementation PR.

While Issue #262 remains unmanaged and Draft PR #266 is under review, use
`pnpm run bemoat:mission-control:unmanaged-genesis-review` to record signed
Full/Delta review evidence. The transport uses two linked raw-JSON Founder
authorizations: `FULL_RECORDING` first, then `DELTA_RECORDING`. A historical Full
binds its reviewed head and historical CI and does not require live-head
equality; it requires that head to be an ancestor of the live PR head. The sole
raw `## RESULT` exception is comment `5168547881`, consumed only as
`LEGACY_DELTA_EVIDENCE_RESULT`; generic `## RESULT` comments are
non-authoritative. Full-only or Delta-only evidence is insufficient, and the
transport never creates managed-state counters.

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

When an active task that requires managed Mission Control state already has review history but no valid state block:

1. Reconstruct completed review rounds from Issue/PR comments when evidence is
   clear.
2. Write the marker block with reconstructed `review_cycle` and
   `last_reviewed_head`.
3. If reconstruction is ambiguous, ask the Founder once for the starting cycle.
4. Return `STATE_MIGRATION_REQUIRED` until migration is complete.
5. Do **not** silently grant a fresh three-cycle budget.

Starter marker skeleton for Active Task Issues that explicitly require Mission Control state, or legacy Core tasks declaring both a Main Issue and Implementation Plan:

````md
<!-- bemoat-mission-control-state:start -->
```yaml
schema_version: 1
state: READY
review_cycle: 0
full_review_count: 0
approved_base: main
active_task_issue: "#<this active task issue>"
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: 1.1.0
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

## Cost-aware review routing

Mechanical head/CI/scope/state checks use scripts or low-reasoning coordination;
they are not semantic-review runs. One Full Semantic Review is the expensive
default, then corrections stay delta-bounded unless a proven material/high-risk
trigger or Founder authorization requires another full review. A changed head by
itself requires exact-head verification, not a full re-review.

| Profile | Default semantic review |
| --- | --- |
| FAST | Focused verification; no independent high-reasoning review by default. |
| STANDARD | One risk-adjusted review; Medium for bounded normal-risk work, High for material ambiguity or significant connected risk. |
| MANAGED | One independent High Full Semantic Review, then bounded Delta Review. |

Runtime model names are replaceable configuration: routing is based on required
capability and proven risk. Review 3 remains bounded; unresolved non-convergence
routes to #121 Double-Loop Review or Founder decision, never automatic Review 4.

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

# Unmanaged-genesis Full/Delta review recording (Issue #262 / PR #266 only)
# Requires BEMOAT_FOUNDER_LOGINS and protected signing material; do not run live during implementation
pnpm run bemoat:mission-control:unmanaged-genesis-review -- --founder-authorization-comment-id=<comment-id>

# Founder-authorized merge, Issue closure, DONE projection, and NO_OP proof
# Requires repository Actions variable BEMOAT_FOUNDER_LOGINS (comma-separated GitHub logins)
pnpm run bemoat:mission-control:merge -- <issue-number> --repo owner/repo --authorization-comment <comment-id>

# Terminal state projection only (the reconciler never closes Issues)
pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo owner/repo]

# Child harness pull (after starter merge)
pnpm run bemoat:boilerplate:sync -- --harness-only
```

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Guide missing on approved base | `BLOCKED EXTERNAL` — do not fall back to task-branch policy |
| Plan / Issue / PR / state disagree (contradictory evidence) | `STATE CONFLICT` — one reconciliation action, then stop |
| Valid PR/head/CI/RESULT but stale state block | Deterministic reconciliation or incomplete delivery — not `STATE CONFLICT` |
| PR merged but managed Issue still open | `STATE CONFLICT` — merge transport closes the Issue as completed, then rerun reconciliation |
| Reconcile prints a classified failure | Use the non-empty diagnostic; the CLI falls back from `finalReason` to `reason` to a safe literal |
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
