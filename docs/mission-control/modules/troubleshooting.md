> Current work reconstructs with `bemoat:context` and publishes only
> `bemoat:handoff`. The stateful conflict/reconcile procedures below are
> historical migration compatibility and must not be used as new routing.

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

The custom merge wrappers are retired. Reconstruct the native GitHub merge,
review, check, protected-base, and Issue evidence with Context and stop on any
incomplete or conflicting historical projection. The reconciler never closes
or reopens Issues. Running it while the PR is merged
but the Issue remains open returns an actionable `STATE_CONFLICT`. Classified
CLI failures use `finalReason`, then `reason`, then
`Mission Control reconciliation failed without a diagnostic`, so `ERROR:` is
never blank.

No retained command retries Issue closure, `DONE` projection, or campaign
projection as part of merge completion. Delegated parents require their own
direct reconciliation authority and are not mutated by child task evidence.
