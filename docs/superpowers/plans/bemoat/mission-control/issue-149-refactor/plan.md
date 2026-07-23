<!-- bemoat-task-identity:start -->
```yaml
schema_version: 1
main_issue: null
task_key: "issue-149"
task_issue_strategy: "existing_dedicated_issue"
active_task_issue: "#149"
branch_template: "docs/149-mission-control-architecture"
transition_target: "AWAITING_REVIEW_1"
planning_base_sha: "be367c3bf1bfd3787cd92f4ccb7d2eca7acb33d0"
execution_base_rule: "resolve_live_protected_base_at_dispatch"
paired_spec: null
paired_plan: "docs/superpowers/plans/bemoat/mission-control/issue-149-refactor/plan.md"
```
<!-- bemoat-task-identity:end -->

# Mission Control Architecture Refactor Plan (Issue 149)

This document provides the Founder-reviewable target architecture plan for simplifying Mission Control and modularizing `docs/mission-control/mission-control-guide.md`.

## Minimal Workflow/State Model (MC-R1-001)

The Mission Control workflow operates through deterministic state transitions tracked via an approved minimal schema-v2 workflow cursor, combined with natural GitHub evidence.

### Target Workflow Cursor
The minimum durable cursor fields required for deterministic workflow continuation are:
- `schema_version`: `2` (Durable)
- `state`: The active state (e.g., READY, REVIEW, CORRECTION_REQUIRED, FOUNDER_DECISION, DONE) (Durable)

### Natural-Source Ownership Table
Values derived from natural GitHub evidence rather than the durable cursor:
- **Task Identity / Active PR (`active_task_issue`, `active_pr`)**: Derived strictly from the GitHub issue/PR context (active Issue URL, branch name).
- **Review Counters / Budget (`review_cycle`, `full_review_count`)**: Derived strictly from approved, non-superseded `## REVIEW_VERDICT` history. Do not derive review budget from CI runs, commit count, or chat history.
- **Approved Base / Policy Source (`approved_base`, `guide_source`)**: Derived dynamically from the exact live protected base (`main`) at dispatch time.
- **Heads (`current_head`, `last_reviewed_head`)**: Recovered without ambiguity from the exact active PR API head and the exact `## REVIEW_VERDICT` head evidence.
- **Blockers & Next Action**: Recovered without ambiguity from the most recent approved, non-superseded `## REVIEW_VERDICT` or `## HANDOFF`.

If stale or contradictory cursor/evidence combinations are detected, they fail closed immediately.

### Correct Simplified Transitions
| Current State | Condition | Next State | Gate / Guard |
|---|---|---|---|
| READY | Delivery PR opened & verified | REVIEW | Agent CI preflight |
| REVIEW | Exact-head CI pass + Review pass | FOUNDER_DECISION (or DONE) | Review completion |
| REVIEW | Exact-head CI fail / Review fail | CORRECTION_REQUIRED | Correction tracking guard |
| CORRECTION_REQUIRED | Delivery PR updated & verified | REVIEW | Correction CI preflight |
| FOUNDER_DECISION | Founder overrides/approves | DONE | Founder Merge Gate |

These transitions preserve the simplified `REVIEW -> FIX -> REVIEW` flow, fail-closed outcomes, and review budget limitations (derived solely from approved non-superseded `## REVIEW_VERDICT` history).
The exact Founder gate prevents review success from implying unauthorized merge or completion. Completion to `DONE` requires verified Founder-authorized merge evidence when merge is Founder-gated.

## Compatibility and Migration Sequencing (MC-R1-002)

To safely transition from v1 to v2, follow this ordered executable migration sequence:

1. **v1→v2 Adapter/Migration & Canonical Writer Responsibility**: 
   - A proposed implementation surface will serve as the canonical writer for state blocks, independent of the existing v1 parser (`scripts/mission-control-state.mjs`). The exact script path is not strictly mandated here.
2. **Dual-Read Compatibility Window**:
   - The system will allow reading both v1 and v2 blocks during active migrations to prevent stranding active Issues.
   - *Bounded Test/Exit Criteria:* A dual-read fixture successfully parses both v1 and v2 blocks without error.
3. **Scope-Preserving State-Block Guard**:
   - `scripts/guard-mission-control-drift.mjs` will enforce scope preservation and structural integrity during state migrations.
   - *Bounded Test/Exit Criteria:* Attempting to delete required immutable fields fails the guard.
4. **Fail-Closed Version Mismatch Behavior**:
   - If a script detects an incompatible version or malformed cursor, it halts execution immediately (fail-closed).
   - *Bounded Test/Exit Criteria:* A malformed `schema_version: 3` block triggers an immediate preflight halt.
5. **Tested Rollback**:
   - Explicit tested rollback paths ensuring manual or script-driven downgrades can recover stranded states.
   - *Bounded Test/Exit Criteria:* Reverting a v2 issue state to v1 passes the dual-read parser.
6. **Upstream Representative-Workflow Gate**:
   - A full representative workflow (Issue #150 baseline test) will serve as a gate before any child sync is permitted.
   - *Bounded Test/Exit Criteria:* The upstream dogfood loop completes successfully.
7. **Explicit Child Compatibility & Rollback**:
   - Child projects will have a documented and explicit rollback path, ensuring child syncs do not break active child states.
   - *Bounded Test/Exit Criteria:* A synced child project can safely resume a v1 state.

## Baseline and Success Metrics (MC-R1-003)

### Pinned Baseline
- The mandatory guide (`docs/mission-control/mission-control-guide.md`) is pinned at exactly **819 lines / 38,100 bytes** based on Issue #150.
- Before/after captures must use the same pinned method established in Issue #150 (`scripts/capture-baseline.mjs`).

### Operational Success Metrics & Measurement Basis
- **Task Completion Rate**: Percentage of issues reaching `DONE` without unrecoverable halts (measured via successful state transitions over total runs).
- **Agent Runs per Completed Issue**: Reduction in cycles for standard issues (measured via CI and commit history compared to v1 baseline).
- **Reconciliation Frequency**: How often manual checklist reconciliation is required (measured via frequency of `mission-control-reconcile` intervention).
- **Founder Interventions**: Rate of escalations to `FOUNDER_DECISION` (measured via state history).
- **Elapsed Time**: Total duration from `READY` to `DONE` (measured via issue timestamps).
- **Context Cost**: Token count required for the agent to load the active policy (measured via standard token estimators).
- **Correctness**: Accuracy across representative implementation, correction, and blocked workflows (measured against invariant traces).
*(Note: Numeric thresholds are left to the implementation phase and are not strictly mandated by this plan.)*

### Evaluation Lifecycle
- **Representative Fixtures**: We will use predefined fixtures explicitly representing standard implementation, correction, and blocked workflows.
- **Upstream Dogfood**: The refactored architecture must first pass our own internal upstream usage before the later Bogus/child pilot.
- **Later Bogus Pilot**: Deployment to the Bogus Jewelry repository and other child projects for a real-world pilot after upstream dogfood success.
- **Attribution Limits**: Any regressions outside the defined metrics must not be incorrectly attributed to the architecture refactor.

## Invariant Proof Traceability (MC-R1-004)

Complete invariant/contradiction coverage matrix mapping each stable invariant ID to its true normative owners and runtime boundaries.

| Invariant / Trace ID | Canonical Normative Owner | Runtime Enforcement Boundary | Actual Guard / Validator | Characterization Test / Fixture | Applicable Role/Workflow | Manifest / Generated-Projection Ownership |
|---|---|---|---|---|---|---|
| **MC-INV-01 (no-autonomous-review-4)** | `docs/mission-control/mission-control-guide.md` | Review Reconciliation | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-reconcile.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-INV-02 (no-silent-reset)** | `docs/mission-control/mission-control-guide.md` | Review Reconciliation | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-reconcile.int.spec.ts` | All Roles | Manifest / Generated Role Bundle |
| **MC-INV-03 (minor-nit-non-blocking)** | `docs/mission-control/mission-control-guide.md` | Policy-only | `(proposed)` | `(proposed)` | Reviewer | Manifest / Generated Role Bundle (implementation gap: no current executable enforcement exists) |
| **MC-INV-04 (delivery-owns-awaiting-review-1)** | `docs/mission-control/mission-control-guide.md` | Delivery Reconciliation | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-reconcile.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-INV-05 (reviewer-owns-counters)** | `docs/mission-control/mission-control-guide.md` | Review Reconciliation | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-reconcile.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-INV-06 (deterministic-reconciliation-not-conflict)** | `docs/mission-control/mission-control-guide.md` | State Reconciliation | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-reconcile.int.spec.ts` | All Roles | Manifest / Generated Role Bundle |
| **MC-INV-07 (double-loop-no-similar-edit-without-decision)** | `docs/mission-control/mission-control-guide.md` | Policy-only | `(proposed)` | `(proposed)` | Mission Control | Manifest / Generated Role Bundle (implementation gap: no current executable enforcement exists) |
| **MC-INV-08 (durable-state-is-not-an-agent-stage)** | `docs/mission-control/mission-control-guide.md` | State Validation | `scripts/mission-control-state.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-INV-09 (changed-head-is-not-full-review-escalation)** | `docs/mission-control/mission-control-guide.md` | Policy-only | `(proposed)` | `(proposed)` | Mission Control | Manifest / Generated Role Bundle (implementation gap: no current executable enforcement exists) |
| **MC-SCENARIO-001 (protected-base loading and inventory)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Protected-base loader + recursive inventory | `(proposed loader guard)` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle (implementation gap: no current executable enforcement guard exists) |
| **MC-SCENARIO-002 (durable reconstruction)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | State parser | `scripts/mission-control-state.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-003 (migration routing)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Preflight | `scripts/agent-issue.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-004 (fail-closed outcomes)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Preflight + reconciler | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-005 (review history)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Review reconciler | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Reviewer | Manifest / Generated Role Bundle |
| **MC-SCENARIO-006 (Review 3 budget)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Review 3 | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-007 (role transport)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Role transport | `scripts/mission-control-state.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-008 (semantic reconciliation guard)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Drift guard | `scripts/guard-mission-control-drift.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-009 (vocabulary and projection drift)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Approved-base prose facts | `(proposed)` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle (implementation gap: no current executable enforcement exists) |
| **MC-SCENARIO-010 (exact-head evidence)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | Exact-head evidence | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Reviewer | Manifest / Generated Role Bundle |

*(This matrix maps each stable invariant to its canonical normative owner, actual runtime enforcement boundary, actual guard/validator, characterization test, applicable role, and generated-role-bundle ownership.)*

## Policy/Module Responsibility Boundaries

1.  **Compact Mandatory Kernel (`mission-control-guide.md`)**:
    - Retains: Founder authority, protected-base policy loading, durable-state loading order, authoritative evidence precedence, fail-closed outcomes, state-conflict rules, exact PR-head/CI requirements, review counters/budget (no Review 4), role-comment selection/supersession, Founder gates, prohibited actions, canonical vocabulary.
2.  **Workflow/Role Modules (Loaded on demand)**:
    - Implementation procedures and routines
    - Review checklists and criteria
    - Correction procedures
    - Planning and no-PR paths
    - Migration instructions
    - Templates and examples
    - Troubleshooting guides
    - Child-sync operations

## Bounded Implementation-Issue Decomposition

1.  **Issue A (Module Extraction)**: Create `docs/mission-control/modules/` and extract checklists, templates, and child-sync operations. Update the monolithic guide to source from them.
2.  **Issue B (Kernel Compaction)**: Strip `mission-control-guide.md` down to the 200-350 line kernel containing only universally required normative contracts.
3.  **Issue C (Context Loading)**: Update the chatGPT/agent bootstrap context and preflight scripts to load only the compact kernel and conditionally load modules.
