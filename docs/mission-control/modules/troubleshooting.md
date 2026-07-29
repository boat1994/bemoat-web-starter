## Conflict behavior

Distinguish **bookkeeping lag** from **genuine conflict**:

- **Bookkeeping lag:** one unambiguous live PR, exact head, exact-head CI result,
  and durable role output (`## RESULT` or `## REVIEW_VERDICT`) exist, but the
  managed state block is stale. Treat as **incomplete role delivery** or apply
  **deterministic reconciliation** — not `STATE CONFLICT`.
- **Genuine conflict:** contradictory durable evidence such as wrong or
  competing PR; head mismatch or unsafe ancestry; stale or non-matching CI;
  conflicting task pointer; inconsistent review history; scope or authorization
  mismatch. Return `STATE CONFLICT`, identify the conflicting fields and links,
  request or apply one bounded reconciliation action, and stop.

Do not guess which state is correct when evidence is contradictory.

### Issue-body write TOCTOU / lease CAS

Protocol writers (`mission-control-dispatch`, `agent-delivery`, and
`mission-control-reconcile` `writeState`) must not call unconditional
`gh issue edit` after a live reread. They win a GitHub Contents API file-`sha`
lease (branch `bemoat/mission-control-leases`) bound to transition identity +
observed body hash via `scripts/mission-control-issue-body-cas.mjs`, then
project the Issue body. Losers fail closed as `STATE_CONFLICT`. Issue PATCH
`If-Match` and GraphQL body version fields are unavailable (HTTP 400 / no
input).

**Residual risk:** non-protocol writers (manual GitHub UI edits or raw
`gh issue edit` outside the lease helper) can still mutate the Issue body
without taking the lease. Protocol writers detect many of those races with the
final pre-update reread and post-write `verifyStatePostcondition`, but a
manual edit in the final reread→edit gap remains a residual last-write-wins
window outside MC-vs-MC protocol coverage.
