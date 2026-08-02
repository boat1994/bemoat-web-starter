## Existing-task migration behavior

For a managed existing task already under review without a valid state block:

1. Reconstruct prior completed review rounds from Issue/PR comments where evidence is clear.
2. Record the reconstructed count and reviewed SHAs.
3. If the count cannot be proven, ask the Founder to set the starting cycle once.
4. Do not grant a fresh three-cycle budget by default.
5. Return `STATE_MIGRATION_REQUIRED` until migration is complete.

## Active planning-task migration after guide 1.3.0

Issue #248 is the reference case for an active planning-only task. After this
policy merges, reload guide `1.3.0` from merged `main`, preserve RESULT comment `5156067541`, exact planning baseline
`main@fbb587f883e10a4b7f2c21d2af80da84b2f95084`, its authority/lineage,
`planning_no_pr` mode, counters `review_cycle: 0` and `full_review_count: 0`,
and null `active_pr`, `current_head`, and `last_reviewed_head` fields. Re-evaluate
only the permitted transition shape under the new bundle policy.

If the existing planning RESULT remains valid, retain it and record only the
next permitted action under the revised guide. If a policy-derived delta is
needed, record that bounded delta without rewriting characterization findings,
resetting counters, or inventing implementation authority. A separate Founder implementation authorization is required before any implementation HANDOFF; it
does not authorize merge. Slice 3 remains blocked until that separate Founder
implementation decision.
