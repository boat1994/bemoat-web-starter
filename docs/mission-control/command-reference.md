# Mission Control command reference

The current supported cross-agent usage contract is the stateless
context-to-handoff protocol. Scripts read GitHub live at execution time; live
GitHub evidence overrides chat, copied handoffs, local notes, or stale values.

## Current supported protocol

```text
bemoat:context <issue-number> --json
→ one bounded objective
→ bemoat:handoff <issue-number> --body-file <strict-handoff.json>
→ fresh GitHub reconstruction
```

Run repository-defined CLI Discovery before invoking either command.
`bemoat:context:sync-base` remains a bounded protected-main synchronization
utility. Exact repository/base/PR/head/CI/review evidence, generic safety, and
child-sync mechanics remain supported shared infrastructure.

## Retired stateful command families

The reconciliation, finding-adoption, recovery, reopen, delivery, review, and
custom merge transports were removed in Phase 7. Historical Issue/comment
evidence remains readable through retained Context, Handoff, diagnostics, and
other migration readers; no executable route is available for those families.

## Retained command: authorize-founder

Record one immutable Founder task-bootstrap authorization body exactly once,
binding the live returned comment ID and body hash through readback. Resolve the
registered contract and safe help invocation through CLI Discovery before use.

## Command selection

| Command | Usage |
| --- | --- |
| `review` | Historical evidence is read-only; no managed review writer is available. |
| `authorize-founder` | Record the retained immutable Founder authorization. |
| (none) | Stop and request human review when evidence disagrees. |

## Preflight checklist

Before invoking a retained command, verify the repository, live Issue, expected
state, and absence of competing evidence. Resolve the registered contract and
`scripts/mission-control/transport-registry.mjs` before any durable write.

### Review checks

- [ ] Exact repository, base, PR, head, CI, and review evidence is live.
- [ ] The provided evidence has one unambiguous canonical binding.
- [ ] `NONCANONICAL_ROLE_EVIDENCE` fails closed.

## Review and merge evidence

The managed review writer and custom managed/STANDARD merge wrappers are
retired. Historical verdicts, merge authorizations, and receipts remain
readable where retained Context or diagnostics requires them. No public command
publishes managed `REVIEW_VERDICT` state, increments review counters, or writes
terminal managed projections. Context reconstructs ordinary native GitHub merge
authority and evidence and stops fail-closed on ambiguity.

Historical review evidence may show resulting counters `2/1` without granting
a review writer. A failed historical transport must never be replayed: rerun
the same canonical review command. Do not post another verdict manually.
Do not edit the immutable authorization comment.

## Partial failure and retry behavior

| Outcome | Meaning and retry handling |
| --- | --- |
| `STATE_CONFLICT` | Stop, refresh live evidence, and require human review. |
| `BLOCKED_EXTERNAL` | Retry only after external reads are available. |
| `NO_OP` | The retained projection is already durable; no retry is needed. |

## Shared stop rule

If live GitHub evidence disagrees with chat or a copied value, stop and classify
the discrepancy fail closed. Never repair managed Issue YAML directly. Re-read
live evidence and use the one canonical transport whose preconditions match;
otherwise stop for `STATE_CONFLICT` or `BLOCKED_EXTERNAL`.

## Managed-Task bootstrap

For an existing Task Issue whose Founder authorization is not yet durably
recorded, use the repository-owned transport after resolving its registered
contract:

```bash
pnpm run bemoat:mission-control:authorize-founder -- <issue-number> \
  --repo boat1994/bemoat-web-starter --json
```

The command derives the authenticated GitHub actor, Founder allowlist, target
Issue, protected `main` SHA, and merged policy identity from live GitHub
evidence. Help invocations perform no mutation.
