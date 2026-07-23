# Issue 150: Upstream Dogfood Evidence

## 1. Characterization Coverage
The tests in `tests/int/mission-control-characterization.int.spec.ts` successfully assert the failure logic for unmarked legacy blocks, which route correctly to `STATE_MIGRATION_REQUIRED`.
The test for duplicate and unbalanced markers also successfully routes to `STATE_MIGRATION_REQUIRED` by returning `valid: false`.

## 2. Review Budget Constraints
The test suite in `tests/int/mission-control-reconcile.int.spec.ts` was expanded and corrected.
- It asserts `full_review_count` never exceeds `1`.
- It asserts `CORRECTION REQUIRED` at Review 3 explicitly triggers `STATE_CONFLICT` (fails closed) because `CORRECTION_REQUIRED_3` is prohibited.
- `BLOCKED FOR FOUNDER DECISION` correctly increments to `review_cycle: 3` without emitting unauthorized Review 4 bounds.

## 3. Drift Guard Verification
A static contract-drift guard (`scripts/guard-mission-control-drift.mjs`) was introduced to ensure the reconciliation logic does not emit `CORRECTION_REQUIRED_3`. This guard is now wired into the `GUARD_PACK` which runs natively under `pnpm run check` and in CI.

## 4. Exact-SHA Baseline Capture
The script `scripts/capture-baseline.mjs` was modified to take an explicit reference/SHA (`c2637d6540f9200b01e8e0af1938e257975ada27`) and retrieve immutable data using `git show` and `git ls-tree`. The generated artifact (`docs/mission-control/dogfood/issue-150-baseline.md`) serves as the strict, machine-readable baseline.
