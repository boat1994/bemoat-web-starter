# Issue 150: Expected Behavior Matrix

The machine-readable source is [`issue-150-benchmark-scenarios.json`](./issue-150-benchmark-scenarios.json). It records policy intent, approved-base behavior, approved canonical behavior, fixture boundaries, executable test references, all twelve Issue #150 criteria, and all ten Issue #149 discovery contradictions.

| Scenario | Boundary | Approved canonical behavior |
|---|---|---|
| MC-SCENARIO-001 | Protected-base loader + recursive inventory | Loader-derived bundles and byte-preserving approved-SHA metrics |
| MC-SCENARIO-002 | State parser | Complete marked durable reconstruction |
| MC-SCENARIO-003 | Preflight | Explicit migration routing for legacy/malformed state |
| MC-SCENARIO-004 | Preflight + reconciler | Distinct STATE_CONFLICT and BLOCKED_EXTERNAL stops |
| MC-SCENARIO-005 | Review reconciler | Monotonic cycles and one Full Review maximum |
| MC-SCENARIO-006 | Review 3 | No CORRECTION_REQUIRED_3 or autonomous Review 4 |
| MC-SCENARIO-007 | Role transport | All three headings selected and superseded deterministically |
| MC-SCENARIO-008 | Drift guard | 104 state/counter cases, 15 review cases, parser compatibility, tamper rejection |
| MC-SCENARIO-009 | Approved-base prose facts | Vocabulary/model/link drift characterized without policy changes |
| MC-SCENARIO-010 | Exact-head evidence | Older-SHA success never satisfies current-head CI |

Verification:

```text
pnpm exec vitest run --config ./vitest.config.mts tests/int/mission-control-characterization.int.spec.ts tests/int/guard-pack.int.spec.ts
pnpm exec tsc --noEmit
pnpm run check
```
