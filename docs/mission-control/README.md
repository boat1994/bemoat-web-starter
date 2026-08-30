# Mission Control

Mission Control is the coordination layer for AI-assisted development in Bemoat
repositories. A maintainer who reads only this README should be able to install
it, configure ChatGPT, start a run, and know where policy details live—without
reading the entire guide first.

## What Mission Control is

Mission Control currently coordinates stateless bounded work through one
read-only reconstruction command and one append-only handoff command:

```text
bemoat:context <issue-number> --json
→ one bounded objective
→ bemoat:handoff <issue-number> --body-file <strict-handoff.json>
→ fresh GitHub reconstruction
```

`bemoat:context:sync-base` remains a retained protected-main synchronization
utility. Exact repository/base/PR/head/CI/review evidence, CLI Discovery,
generic safety, and child-sync rails remain shared infrastructure. Mission
Control is not the default implementation agent, a perpetual reviewer, or an
auto-merge system.

## What problem it solves

Without durable Mission Control state, work often:

- restarts full review after every small correction;
- treats Important / Minor / Nit findings as endless blockers;
- loses the review count when a new chat starts;
- treats chat history as the source of truth;
- burns agent quota on process churn instead of product progress.

The stateless protocol prevents that by keeping policy in the repository,
durable workflow evidence in GitHub, and every route bound to fresh exact
evidence. Historical managed-state records remain readable for migration only.

## How the workflow changes

Before: chat session → stateful coordinator → open-ended re-review → repeat.

After:

```text
bemoat:context
  → one bounded implementation / verification objective
  → bemoat:handoff (append-only HANDOFF)
  → fresh GitHub reconstruction by the next agent
```

The older stateful dispatch/delivery/review/reconcile/recovery/merge/task and
role-comment flow is documented below only as migration compatibility and is a
Phase 7 deletion candidate. This reconciliation does not delete or repair it.

Rules that change day-to-day behavior:

- GitHub Issues/PR/CI are authoritative; chat is context only.
- Each agent reconstructs live context before acting and publishes one final
  HANDOFF when the bounded objective is complete or a gate is reached.
- Chat/session memory is never workflow authority.
- Exact repository/base/PR/head/CI/review evidence remains authoritative.
- Generic safety and fail-closed behavior remain required.
- Founder review or merge gates remain human-owned where applicable.

## Canonical files

| File | Responsibility |
| --- | --- |
| [`mission-control-guide.md`](./mission-control-guide.md) | Only long-form operating policy |
| [`architecture-blueprint.md`](./architecture-blueprint.md) | Architectural source of truth (journeys, capabilities, target lean shape) |
| [`command-reference.md`](./command-reference.md) | Canonical command and credential-boundary reference |
| [`../../prompts/mission-control/chatgpt-project-loader.md`](../../prompts/mission-control/chatgpt-project-loader.md) | Ready-to-paste ChatGPT Project instruction |
| [`handoff-template.md`](./handoff-template.md) | Full `## HANDOFF` field checklist |
| [`result-template.md`](./result-template.md) | Historical RESULT/review compatibility checklist; not the final protocol |
| [`project-overrides.example.md`](./project-overrides.example.md) | Child override example |
| [`../agent-loop/role-handoff-contract.md`](../agent-loop/role-handoff-contract.md) | Compact GitHub comment transport |

**Authority:** The guide and `AGENTS.md` define the current context-to-handoff
protocol. The role-handoff and RESULT documents retain historical comment
formats only; they are not alternate supported transports.

Normal Mission Control runs must load the guide from the **merged approved
protected base**, never from an unmerged task branch.

The former managed-Task bootstrap and stateful runtime remain migration-only.
Do not use them for new work or perform their Phase 7 deletion in this
documentation reconciliation.

## Historical reviewer verdict vocabulary (migration-only)

For historical Core Mission Control records, `## REVIEW_VERDICT` uses exactly one of:

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

## Standard daily flow (current stateless protocol)

Always begin by reconstructing current context:

```text
pnpm run bemoat:context <issue-number> --json
```

After completing exactly one bounded objective, publish the durable handoff:

```text
pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>
```

The body file must contain exactly one strict JSON HANDOFF record matching the
machine-readable public contract; it is not a Markdown template or fenced JSON
block.

The next agent must fresh-reconstruct from GitHub. Historical review-cycle
records remain readable but do not authorize a new stateful command.

## Historical review-cycle compatibility

The following vocabulary is retained only for reading older managed Issues:

| Cycle | Type | Scope |
| --- | --- | --- |
| Review 1 | Full | Task-bounded AC, changed behavior, connected risk, exact-head checks |
| Review 2 | Delta | Enumerated findings + files since `last_reviewed_head` |
| Review 3 | Blocker verification | Unresolved Blocker/Critical only |

Important findings, Minor/Nit dispositions, and Founder gates remain historical
review evidence. New work records its bounded outcome and next route through
`bemoat:handoff`; it does not create a new RESULT or REVIEW_VERDICT.

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

## Current and historical commands

Current protocol commands:

```bash
pnpm run bemoat:context -- --help --json
pnpm run bemoat:context <issue-number> --json
pnpm run bemoat:handoff -- --help --json
pnpm run bemoat:handoff <issue-number> --body-file <strict-handoff.json>
pnpm run bemoat:context:sync-base -- --help --json
```

The commands below are retained historical migration-only examples. Deleted
Phase 7 commands have no registration or help contract and are not listed.

```bash
# Mission Control contract only
pnpm run guard:mission-control-contract

# Full safety pack (includes Mission Control)
pnpm run guard:safety

# Focused tests
pnpm exec vitest run tests/int/mission-control-contract.int.spec.ts
pnpm exec vitest run tests/int/boilerplate-sync.int.spec.ts
pnpm exec vitest run tests/int/guard-pack.int.spec.ts

# Terminal state projection only (the reconciler never closes Issues)
pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo owner/repo]

# Exceptional missing-state recovery (validation or one leased/CAS projection)
pnpm run bemoat:mission-control:recover-state -- <issue-number> --repo owner/repo --check

# Child harness pull (after starter merge)
pnpm run bemoat:boilerplate:sync -- --harness-only
```

## Historical migration-only troubleshooting

| Symptom | Response |
| --- | --- |
| Guide missing on approved base | `BLOCKED EXTERNAL` — do not fall back to task-branch policy |
| Plan / Issue / PR / state disagree (contradictory evidence) | `STATE CONFLICT` — one reconciliation action, then stop |
| Valid PR/head/CI/RESULT but stale state block | Deterministic reconciliation or incomplete delivery — not `STATE CONFLICT` |
| PR merged but managed Issue still open | `STATE CONFLICT` — reconstruct native GitHub evidence and stop; no custom merge wrapper may repair it |
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
