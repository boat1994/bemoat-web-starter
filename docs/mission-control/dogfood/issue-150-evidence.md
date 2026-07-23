# Issue 150: Upstream Dogfood Evidence

## 1. Characterization Coverage
The tests in `tests/int/mission-control-characterization.int.spec.ts` successfully map all canonical constraints to traceable scenario IDs:
- **MC-SCENARIO-001**: Policy/base resolution (`resolves approved base from state block when present`)
- **MC-SCENARIO-002, MC-SCENARIO-009**: Durable reconstruction and vocabulary preservation (`successfully parses and preserves valid marked state blocks`)
- **MC-SCENARIO-003, MC-SCENARIO-004**: Migration, conflict, external boundaries (`strictly rejects unmarked MISSION_CONTROL_STATE YAML blocks and routes to STATE_MIGRATION_REQUIRED via analyzeProgressTracking`, `fails closed when markers are duplicate or unbalanced`, `emits STATE_CONFLICT when genuine state conflict is detected`)
- **MC-SCENARIO-005, MC-SCENARIO-006**: Review-history preservation, no reset, no Review 4 (`preserves review cycle and full review count without resetting on valid transitions`, `routes unauthorized Review 4 (CORRECTION REQUIRED at cycle 2) to STATE_CONFLICT`)
- **MC-SCENARIO-007**: Role-comment selection and supersession (`findLatestRoleComment selects the most recent comment matching the role`)
- **MC-SCENARIO-008**: Reconciler / parser compatibility (`ensures reconciler outputs are parsable state objects`)
- **MC-SCENARIO-010**: Exact-head CI requirements (`blocks delivery lag resolution when exact-head CI is missing`, `allows delivery lag resolution when exact-head CI is verified`)

## 2. Review Budget Constraints (Transition Matrix)
The executable drift guard in `scripts/guard-mission-control-drift.mjs` was converted to a runtime transition matrix. It verifies:
- `full_review_count` never exceeds `1`.
- `CORRECTION REQUIRED` at cycle 2 results in `STATE_CONFLICT` (not Review 4).
- Reconciler and parser compatibility guarantees exact parsing of proposals.

## 3. Exact-SHA Baseline Capture
The script `scripts/capture-baseline.mjs` generates an immutable `docs/mission-control/dogfood/issue-150-baseline.json` utilizing native `execFileSync` to yield un-trimmed Buffers and NUL-delimited `git ls-tree` to exactly enumerate and classify paths into the required bundles. Derived metrics assert perfectly against expectations. `docs/mission-control/dogfood/issue-150-baseline.md` provides a human-readable projection of the data.
