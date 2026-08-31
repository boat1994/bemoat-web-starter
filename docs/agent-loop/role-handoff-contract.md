# Stateless handoff contract

The only supported cross-agent transport is the append-only strict `HANDOFF`
record published by `bemoat:handoff` after fresh `bemoat:context`
reconstruction.

```text
bemoat:context <issue-number> --json
→ one bounded objective
→ bemoat:handoff <issue-number> --body-file <strict-handoff.json>
→ fresh GitHub reconstruction
```

Context is read-only. Handoff validates one exact schema-v1 JSON object,
appends one Issue comment, and verifies exact readback. Neither command creates
managed state, review counters, merge permission, or hidden workflow state.

## Required binding

Every HANDOFF binds:

- repository and Issue identity;
- bounded permitted and prohibited scope;
- executing agent and provider;
- branch, exact head, protected base, and PR when applicable;
- non-empty verified evidence;
- one route and compatible next action;
- explicit stop conditions; and
- local durability requirements and result.

The closed route vocabulary is `IMPLEMENT`, `VERIFY`, `FIX`, `REVIEW`,
`FOUNDER_GATE`, `COMPLETE`, and `STOP`. The canonical field shape and
publication example are in
[handoff-template.md](../mission-control/handoff-template.md). Runtime schema
validation remains authoritative.

## Evidence rules

- Reconstruct live GitHub and native Git evidence before acting. A HANDOFF is a
  bound snapshot, not permission to trust stale state.
- The PR current head and exact-head CI/review evidence are authoritative for
  code state.
- Required local changes must be committed and pushed before a durable HANDOFF.
- Missing, stale, partial, conflicting, or ambiguous authority/evidence fails
  closed.
- Historical RESULT, REVIEW_VERDICT, and managed-state comments are read-only
  migration inputs where Context still needs them. They are not supported
  publication formats or alternate routing authority.
- Never merge autonomously.

## Review and correction

Run an independent STANDARD semantic review against the exact candidate head
when policy requires it. A blocking finding routes to bounded correction,
focused and full verification, a new durable exact head, and Delta Review.
Implementation workers do not review their own work. Only the clean final exact
head may route to `FOUNDER_GATE`.

## Pre-merge checklist reconciliation gate

Immediately before the final Founder gate, Mission Control compares every
source-Issue acceptance criterion with live exact-head evidence and records each
as `Done`, `Not done`, `Not applicable`, or `Waiting for CI / human
review`. Completed items include concise evidence. Mission Control may
reconcile the Issue checklist only when live evidence uniquely supports the
edit; otherwise it records the mapped audit without changing the Issue body.
This gate does not authorize merge.

## Manual validation checklist

- Fresh Context reconstruction used the registered public CLI contract.
- Repository, Issue, protected base, PR, branch, and exact head agree.
- Required CI and independent review bind to the exact head.
- Scope, evidence, stop conditions, next action, and local durability are
  complete and non-ambiguous.
- The HANDOFF body contains exactly one strict JSON record and its readback is
  exact.
- The receiver must reconstruct fresh Context before continuing.
