# Issue 150: Expected Behavior Matrix

This artifact acts as a reusable benchmark fixture to prove the corrections made to Mission Control contract logic in Issue 150.

## Scenarios

| Scenario ID | Category | Validated Behavior | Test Reference |
|---|---|---|---|
| **MC-SCENARIO-001** | Policy/base resolution | `approved_base` is resolved accurately from durable state when present. | `Policy/base resolution (MC-SCENARIO-001)` |
| **MC-SCENARIO-002** | Durable reconstruction | Well-formed state strings correctly map back to canonical memory structures. | `Durable reconstruction and vocabulary preservation (MC-SCENARIO-002, MC-SCENARIO-009)` |
| **MC-SCENARIO-003** | Migration/conflict bounds | Invalid state schemas properly emit `STATE_MIGRATION_REQUIRED` blocking implementation. | `Migration/conflict/external boundaries (MC-SCENARIO-003, MC-SCENARIO-004)` |
| **MC-SCENARIO-004** | Conflict bounds | Unbalanced markers and missing state blocks are identified and guarded. | `Migration/conflict/external boundaries (MC-SCENARIO-003, MC-SCENARIO-004)` |
| **MC-SCENARIO-005** | Review-history preservation | Valid transitions increment cycles while locking `full_review_count` to exactly 1. | `Review-history preservation, no reset, no Review 4 (MC-SCENARIO-005, MC-SCENARIO-006)` |
| **MC-SCENARIO-006** | No Review 4 | Attempted Review 4 yields `STATE_CONFLICT` rather than an invalid state or reset. | `Review-history preservation, no reset, no Review 4 (MC-SCENARIO-005, MC-SCENARIO-006)` |
| **MC-SCENARIO-007** | Role-comment selection | Supersession accurately identifies the newest relevant role verdict/handoff comment. | `Role-comment selection and supersession (MC-SCENARIO-007)` |
| **MC-SCENARIO-008** | Reconciler / parser compatibility | Output proposals directly pass parser schema validation (no drift). | `Reconciler / parser compatibility (MC-SCENARIO-008)` |
| **MC-SCENARIO-009** | Vocabulary preservation | Legacy terms are correctly mapped or flagged for standard reconciliation. | `Durable reconstruction and vocabulary preservation (MC-SCENARIO-002, MC-SCENARIO-009)` |
| **MC-SCENARIO-010** | Exact-head CI requirements | Delivery and merge states are guarded against missing or stale exact-head verifications. | `Exact-head CI requirements (MC-SCENARIO-010)` |

## Verification Command
These bounds are verified mechanically via:
`pnpm exec vitest run tests/int/mission-control-characterization.int.spec.ts`
`pnpm run guard:safety`
