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

Before: chat session → stateful runtime → open-ended re-review → repeat.

After:

```text
bemoat:context
  → one bounded implementation / verification objective
  → bemoat:handoff (append-only HANDOFF)
  → fresh GitHub reconstruction by the next agent
```

The older stateful dispatch/delivery/review/reconcile/recovery/merge/task and
role-comment flow is documented below only as migration compatibility. The
legacy role-comment writer is retired; historical records remain readable.

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

The former managed-Task bootstrap and stateful runtime are retired historical
evidence. Do not use them for new work.

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

## Historical migration-only records

Older Issues may contain managed-state blocks and RESULT/REVIEW_VERDICT records.
They are read-only evidence for `bemoat:context`; do not reconstruct counters,
write state blocks, or invoke retired commands. If evidence is ambiguous,
`bemoat:context` stops for human review.

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

The current loop is the complete operational guidance. For policy details and
guard contracts, follow `AGENTS.md` and the linked canonical files above.
