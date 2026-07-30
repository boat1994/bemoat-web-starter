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

### Merged PR with an open managed Issue

Option A assigns Issue closure to merge transport, not the reconciler. Verify
the Founder-authorized exact head and merge commit, close the managed Issue as
completed, then run:

```bash
pnpm run bemoat:mission-control:reconcile -- <issue-number> [--repo owner/repo]
```

The reconciler never closes or reopens Issues. Running it while the PR is merged
but the Issue remains open returns an actionable `STATE_CONFLICT`. Classified
CLI failures use `finalReason`, then `reason`, then
`Mission Control reconciliation failed without a diagnostic`, so `ERROR:` is
never blank.

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
