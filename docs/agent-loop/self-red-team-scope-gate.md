# Self Red-Team Scope Gate

Use this gate when planning, specification expansion, or a proposed High
Reasoning pass is becoming material enough to delay implementation. The goal is
to reduce costly uncertainty, not to remove every uncertainty before coding.

For Small tasks with clear acceptance criteria, keep this mental or skip it with
a one-line reason. For Medium/Core tasks, new specs, implementation plans,
workflow rails, migrations, security, data contracts, or repeated analysis, run
one constrained pass before expanding the document or asking for another
expensive reasoning pass.

## Default Loop

```text
Find the smallest useful slice
-> clarify invariants and expensive-to-reverse decisions
-> run one constrained self red-team pass
-> resolve blockers only
-> start implementation
-> review again against the real diff, tests, and working UI
```

## Default Limits

Unless the owner explicitly overrides them:

- Use one active implementation slice at a time.
- Run at most one pre-implementation High Reasoning red-team pass after scope
  is directionally stable.
- Do not fully specify future phases.
- Do not reopen closed decisions without new evidence or a documented reopen
  condition.
- Stop planning when remaining findings are non-blocking and reversible.
- Prefer reviewing real code, diffs, tests, and UI over repeatedly reasoning
  from an abstract specification.

## High Reasoning Gate

Before requesting an expensive reasoning pass, check:

- [ ] Scope is directionally stable.
- [ ] There is a concrete artifact to inspect: issue, spec, code, diff, test,
      or UI.
- [ ] The output will produce a decision or implementation action.
- [ ] A mistake could cause expensive rework or regression.
- [ ] The same question has not already been analyzed without new evidence.

If the gate is weak, prefer direct implementation, a cheaper review, or
verification against the real artifact.

## Self Red-Team Questions

Challenge the current plan or specification with:

1. Is this requirement necessary for the active implementation slice?
2. If this decision is wrong later, is it expensive to reverse?
3. Is this edge case supported by current evidence, code, or an existing
   contract?
4. Does this detail block implementation now, or can it be verified during
   implementation?
5. Is the latest analysis producing a new decision or action, or only more
   wording and detail?
6. Has a closed decision been reopened without new evidence or its documented
   reopen condition being met?

Run at most one pre-implementation pass after scope is directionally stable
unless the owner explicitly asks for more or new evidence appears.

## Finding Classifications

| Classification | Meaning | Blocks implementation by default |
| --- | --- | --- |
| `BLOCKER` | A missing decision or contradiction prevents safe implementation of the active slice. | Yes |
| `EXPENSIVE_TO_REVERSE` | A wrong choice could cause migration, contract, security, architecture, or major regression cost. | Yes |
| `VERIFY_DURING_IMPLEMENTATION` | The concern is real but can be checked against code, tests, UI, or diff while building. | No |
| `FUTURE_BACKLOG` | Useful later, outside the active slice. | No |
| `SPECULATIVE` | Not backed by current evidence, contracts, or acceptance criteria. | No |

Only `BLOCKER` and `EXPENSIVE_TO_REVERSE` findings may block implementation by
default. `FUTURE_BACKLOG` and `SPECULATIVE` findings should get no more than
one sentence unless the owner explicitly promotes them into the active slice.

## Outcomes

End the pass with exactly one outcome:

| Outcome | Use when | Next action |
| --- | --- | --- |
| `START_IMPLEMENTATION` | No unresolved blocker or expensive-to-reverse decision remains. | Begin the smallest implementation slice. |
| `RESOLVE_BLOCKERS` | A `BLOCKER` or `EXPENSIVE_TO_REVERSE` finding must be decided before coding. | Resolve only those findings, then continue. |
| `MOVE_NON_BLOCKERS_TO_BACKLOG` | Remaining concerns are reversible, future, or speculative. | Note them briefly and start implementation. |

## Planning-Loop Detection

Flag a planning loop when one or more of these patterns appears:

- The same decision has been discussed more than twice without new evidence.
- Acceptance criteria are being rewritten without changing observable behavior.
- New edge cases do not affect architecture, data contracts, security,
  migrations, or existing invariants.
- Future functionality is receiving implementation-level detail.
- The document continues growing while the active slice remains unchanged.
- Another reasoning pass produces no new decision, patch, test, or
  implementation action.

Recommended stop message:

```text
SELF RED-TEAM: Further specification has diminishing returns. No unresolved
blocker or expensive-to-reverse decision remains. Move non-blocking findings to
backlog and begin the smallest implementation slice.
```

## Decision Ledger

Use a lightweight decision ledger in specs or plans when decisions are important
enough that reopening them would waste time.

```md
## Decision Ledger

| Decision | Status | Reason | Reopen only if |
| --- | --- | --- | --- |
| Example decision | Closed | Why it was chosen | New evidence or explicit condition |
```

Do not reopen a `Closed` decision unless the documented condition is met. This
section is optional for small tasks.

## Child Sync Impact

This guide and the reusable prompt live under `docs/agent-loop`, which is a
rails-managed harness path. Child projects receive updates after this starter
change is merged and they run
`pnpm run bemoat:boilerplate:sync -- --harness-only`. No new sync path is
required.

Related prompt: [self-red-team-scope-gate-prompt.md](./self-red-team-scope-gate-prompt.md).
