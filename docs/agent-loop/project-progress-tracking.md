# Main-Issue progress tracking

Canonical harness protocol for Core and multi-stage work across Bemoat starter and child projects.

Do **not** introduce `implementation-stage.md`, a Project Status Card, or any second committed progress file. Use the existing artifacts with clear responsibility boundaries.

## Artifact model

```text
Implementation Plan
= roadmap, Tasks, Slices, ordering, dependencies, contracts, and verification requirements

Main GitHub Issue checklist
= durable cross-session project stage and first incomplete milestone

Active Task Issue
= bounded active scope and acceptance criteria

Pull Request + exact-head CI
= actual code state and deterministic verification evidence

.superpowers/sdd/progress.md
= temporary local/session execution tracker while an agent is working

Execution ledger
= audit history for commits, RED/GREEN evidence, reviews, and residual risks
```

### Implementation Plan

The Implementation Plan is the canonical **roadmap and execution contract**. It owns:

- Task and Slice definitions
- ordering and dependencies
- architecture and interface contracts
- scope and non-scope
- deliverables
- required verification and review gates

The plan must **not** become a duplicate current-state dashboard. Task-step checkboxes inside a plan may remain execution instructions, but they are **not** the durable cross-session project stage.

### Main GitHub Issue

The Main Issue checklist is the canonical **durable project stage** for Core or multi-stage initiatives. Keep it concise. It owns:

- completed durable milestones
- the first incomplete milestone
- current Slice / Task / gate
- active Task Issue and PR pointers
- relevant plan section
- current blocker or dependency
- current founder gate
- one next permitted action

Do **not** copy full command logs, RED/GREEN transcripts, CI output, review transcripts, bundle reports, or long commit histories into the Main Issue. Those belong in Task Issues, PRs, and execution ledgers.

### Active Task Issue

Canonical source for bounded scope, acceptance criteria, allowed and forbidden files, required tests and evidence, review findings, and task-specific founder gates.

### Pull Request

Canonical source for actual code changes, implementation branch, approved base branch, current head SHA, review discussion, and current merge state.

### Exact-head CI

Canonical source for automated verification of the **exact current PR head SHA**.

- A successful CI run for an older SHA is **not** current evidence.
- Exact-head CI means GitHub verification attached to the exact current PR head SHA.
- The Main Issue may be updated after exact-head CI because editing an Issue does not change the PR head SHA.
- Do **not** create a documentation-only commit merely to record CI evidence after final CI is green.

### `.superpowers/sdd/progress.md`

Temporary local/session tracker only. It may contain command-level progress, RED/GREEN notes, temporary next-step notes, and interrupted-session recovery context.

It is **not** the cross-session, cross-device, or project-wide source of truth and must not replace the Main Issue checklist.

### Agent summaries

Previous chat, Composer, Codex, or reviewer summaries are hints only. They cannot override repository and GitHub evidence.

## Conflict precedence

When artifacts conflict:

1. The current PR head, merge state, and exact-head CI are authoritative for current code state.
2. The active Task Issue is authoritative for current bounded scope and acceptance.
3. The Implementation Plan is authoritative for roadmap, dependencies, and permitted ordering.
4. The Main Issue checklist is authoritative for the last synchronized durable project stage after GitHub verification.
5. `.superpowers/sdd/progress.md`, execution ledgers, and agent summaries cannot override verified Plan, Issue, PR, or CI state.
6. Correct the Main Issue only after the discrepancy is verified.

## Main Issue milestone model

Adapt milestones to the initiative. Recommended form:

```md
## Durable Progress

### Slice A — Foundation

- [x] Task 1 implementation complete
- [x] Task 1 task-level review passed
- [x] Exact-head CI passed
- [x] Founder merge approval
- [x] PR merged into the approved base branch

### Slice B — Acquisition Handoff

- [ ] ...

## Current Stage

- Current Slice:
- Current Task or gate:
- Active Task Issue:
- Active PR:
- Relevant plan section:
- Blocking findings:
- Founder gate:

## Next Permitted Action

One concrete action only.
```

## Durable checklist completion rules

| Milestone | Check only when |
|-----------|-----------------|
| Task implementation complete | Scoped implementation is complete; required focused tests pass; focused commit exists; no known implementation blocker remains |
| Task-level review passed | Required specification and quality/security reviews are complete; no Critical or Important finding remains open |
| Whole-slice review passed | All required Tasks in the Slice are complete; composed Slice behavior reviewed; no Critical or Important whole-slice finding remains |
| Focused tests, E2E, bundle, or contamination gates | Final code head used for the gate passes and the gate applies |
| Exact-head CI passed | GitHub CI succeeds on the exact current PR head SHA |
| Founder merge approval | Explicit founder decision recorded — do not infer from mergeability, green CI, or agent summaries |
| PR merged | PR merge commit exists in the approved base branch |

A Slice is not fully complete until its PR is merged into the approved base branch.

## Update timing

### During implementation

Use `.superpowers/sdd/progress.md` for temporary execution progress. Do **not** edit the Main Issue for every command, retry, RED/GREEN transition, minor corrective commit, or CI rerun.

### Before PR creation or update

- audit the active Task Issue acceptance criteria
- post or update the Task Issue implementation report
- update only Main Issue milestones that are already durably proven
- identify the current gate and next permitted action

### After review or exact-head CI

Update the Main Issue when a durable gate changes. This is the preferred place to record gate changes after final CI.

### After merge

Update the Main Issue when merge evidence is confirmed in the approved base branch.

## New-session resume protocol

```text
Main GitHub Issue
→ find the first incomplete Task, Slice, or gate
→ open the linked active Task Issue and Pull Request
→ verify branch, approved base, current head SHA, and exact-head CI
→ inspect unresolved Critical or Important findings
→ read only the referenced Task or Slice section of the Implementation Plan
→ continue only the next permitted action
```

Do not read the entire Implementation Plan merely to determine the current stage when the Main Issue already identifies the active milestone and relevant plan section.

## Agent completion protocol

Before closing a Task Issue or marking a durable Main Issue milestone:

1. Verify acceptance criteria against the Task Issue.
2. Confirm the PR head SHA and exact-head CI when CI is required.
3. Confirm no open Critical or Important findings block the gate.
4. Record founder approval only when explicitly given.
5. Update the Main Issue only for durably proven milestone or gate changes.
6. Post the implementation report on the Task Issue with PR URL, commands, test results, and acceptance criteria audit.

## Preflight (`bemoat:agent:issue`)

`pnpm run bemoat:agent:issue -- <issue-number>` stays **read-only**. It must never mutate issue checklists, plan files, PR state, branch state, or CI state.

### Hard blockers

Produce a clear blocker when:

- a declared Main Issue cannot be found
- a declared canonical Implementation Plan path cannot be found
- a declared relevant plan section cannot be resolved well enough to continue safely
- the current active PR is required to continue but cannot be identified deterministically
- exact-head CI is required by the current gate but current-head status cannot be verified
- the current gate is blocked by unresolved Critical or Important findings
- dependent work would begin before the Main Issue and GitHub evidence prove the prerequisite milestone

### Warnings only

Produce a warning, not a blocker, when:

- the issue is valid but has no Main Issue because the task is Small or standalone
- the issue has no Implementation Plan because the work does not require one
- the Main Issue is missing optional convenience metadata but the next permitted action is still deterministic
- older CI exists but exact-head CI is also available and authoritative

Do not silently fall back to a previous agent summary when declared GitHub or plan state is missing.

## Child adoption contract

After this starter change merges, each affected child project must:

1. create a dedicated harness-sync branch
2. run `pnpm run bemoat:boilerplate:sync -- --harness-only`
3. validate safety and harness drift
4. open or update a child sync PR
5. identify or normalize the initiative's Main Issue
6. add a concise durable progress checklist to the Main Issue from verified Plan and GitHub evidence
7. link active Task Issues and PRs
8. keep unproven and future milestones unchecked

See [harness-sync-workflow.md](./harness-sync-workflow.md) and [source-of-truth.md](./source-of-truth.md).

## Related docs

| Doc | Use for |
|-----|---------|
| [issue-driven-branch-workflow.md](./issue-driven-branch-workflow.md) | Branch gates and PR workflow |
| [checklist.md](./checklist.md) | Task-size tiers and validation |
| [issue-intake-contract.md](./issue-intake-contract.md) | Issue structure normalization |
| [../superpowers/plans/README.md](../superpowers/plans/README.md) | Plan organization and boundaries |
| [AGENTS.md](../../AGENTS.md) | Default agent workflow |
