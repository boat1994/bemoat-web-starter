# Issue 150: Expected Behavior Matrix

This artifact acts as a reusable benchmark fixture to prove the corrections made to Mission Control contract logic in Issue 150.

## Review Budget and Constraints

| Scenario | Prior Behavior | Corrected Canonical Behavior |
|----------|----------------|------------------------------|
| `CORRECTION REQUIRED` at Review 1 (`review_cycle: 0`) | `CORRECTION_REQUIRED_1`, `review_cycle: 1` | `CORRECTION_REQUIRED_1`, `review_cycle: 1`, `full_review_count: 1` |
| `CORRECTION REQUIRED` at Review 2 (`review_cycle: 1`) | `CORRECTION_REQUIRED_2`, `review_cycle: 2` | `CORRECTION_REQUIRED_2`, `review_cycle: 2`, `full_review_count: 1` |
| `CORRECTION REQUIRED` at Review 3 (`review_cycle: 2`) | `CORRECTION_REQUIRED_3`, `review_cycle: 3` | `STATE_CONFLICT`, `review_cycle: 2`, `full_review_count: 1` (Invalid evidence, fails closed) |
| `BLOCKED FOR FOUNDER DECISION` at Review 3 (`review_cycle: 2`) | `BLOCKED_FOR_FOUNDER_DECISION`, `review_cycle: 3` | `BLOCKED_FOR_FOUNDER_DECISION`, `review_cycle: 3`, `full_review_count: 1` |

## Marker and Legacy Parser Contract

| Scenario | Prior Behavior | Corrected Canonical Behavior |
|----------|----------------|------------------------------|
| Unmarked `MISSION_CONTROL_STATE` block | Attempted to parse, sometimes failing or succeeding unreliably | Evaluates to `present: true`, `valid: false` and routes to `STATE_MIGRATION_REQUIRED` |
| Duplicate / unbalanced markers | Undefined / erratic | Evaluates to `present: true`, `valid: false`, pushing `STATE_MIGRATION_REQUIRED` block |
| Valid markers | Parses correctly | Parses correctly |

## Verification Command
These bounds are verified mechanically via:
\`pnpm exec vitest run tests/int/mission-control-reconcile.int.spec.ts\`
\`pnpm exec vitest run tests/int/mission-control-characterization.int.spec.ts\`
