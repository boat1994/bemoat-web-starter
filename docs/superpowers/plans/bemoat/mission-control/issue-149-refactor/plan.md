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

The Mission Control workflow operates through deterministic state transitions tracked via an approved minimal schema-v2 workflow cursor.

### Target Workflow Cursor
- `schema_version`: `2`
- `state`: The active state (e.g., READY, REVIEW, CORRECTION_REQUIRED, FOUNDER_DECISION, DONE)

### Natural-Source Ownership Table
Review history, base/policy source, and task identity are derived from their natural sources, replacing the v1 bookkeeping ledger:
- **Task Identity (`active_task_issue`)**: Derived directly from the GitHub issue/PR context (active Issue URL, branch name).
- **Review Counters / Budget (`counters`)**: Derived from PR review history and CI run execution count on the active head.
- **Approved Base / Policy Source (`approved_base`, `guide_source`)**: Derived dynamically from the exact live protected base (`main`) at dispatch time.

### Correct Simplified Transitions
| Current State | Condition | Next State | Gate / Guard |
|---|---|---|---|
| READY | Delivery PR opened & verified | REVIEW | Agent CI preflight |
| REVIEW | Exact-head CI pass + Review pass | FOUNDER_DECISION (or DONE) | Review completion |
| REVIEW | Exact-head CI fail / Review fail | CORRECTION_REQUIRED | Correction tracking guard |
| CORRECTION_REQUIRED | Delivery PR updated & verified | REVIEW | Correction CI preflight |
| FOUNDER_DECISION | Founder overrides/approves | DONE | Founder Merge Gate |

These transitions preserve fail-closed outcomes, review budget limitations (by checking the PR/CI history), and all Founder gates.

## Compatibility and Migration Sequencing (MC-R1-002)

To safely transition from v1 to v2:

1. **v1→v2 Adapter/Migration & Canonical Writer**: 
   - A runtime schema-v2 adapter script (`scripts/mission-control-state.mjs`) will serve as the sole canonical writer for state blocks.
2. **Dual-Read Compatibility Window**:
   - The system will allow reading both v1 and v2 blocks during active migrations to prevent stranding active Issues.
3. **Scope-Preserving State-Block Guard**:
   - `scripts/guard-mission-control-drift.mjs` will enforce scope preservation and structural integrity during state migrations.
4. **Fail-Closed Version Mismatch Behavior**:
   - If a script detects an incompatible version or malformed cursor, it halts execution immediately (fail-closed).
5. **Tested Rollback**:
   - Explicit tested rollback paths ensuring manual or script-driven downgrades can recover stranded states.
6. **Upstream Representative-Workflow Gate**:
   - A full representative workflow (Issue #150 baseline test) will serve as a gate before any child sync is permitted.
7. **Explicit Child Compatibility & Rollback**:
   - Child projects will have a documented and explicit rollback path, ensuring child syncs do not break active child states.

## Baseline and Success Metrics (MC-R1-003)

### Pinned Baseline
- The mandatory guide (`docs/mission-control/mission-control-guide.md`) is pinned at exactly **819 lines / 38,100 bytes** based on Issue #150.
- Before/after captures must use the same pinned method established in Issue #150 (`scripts/capture-baseline.mjs`).

### Operational Success Metrics & Thresholds
- **Task Completion Rate**: Percentage of issues reaching `DONE` without unrecoverable halts.
- **Agent Runs per Completed Issue**: Target reduction in cycles for standard issues.
- **Reconciliation Frequency**: How often manual checklist reconciliation is required.
- **Founder Interventions**: Rate of escalations to `FOUNDER_DECISION`.
- **Elapsed Time**: Total duration from `READY` to `DONE`.
- **Context Cost**: Token count required for the agent to load the active policy.
- **Correctness**: Accuracy across representative implementation, correction, and blocked workflows.

### Evaluation Lifecycle
- **Representative Fixtures**: We will use predefined fixtures representing standard implementation/correction workflows.
- **Upstream Dogfood**: The refactored architecture must first pass our own internal upstream usage.
- **Later Bogus Pilot**: Deployment to the Bogus Jewelry repository for a real-world pilot.
- **Attribution Limits**: Any regressions outside the defined metrics must not be incorrectly attributed to the architecture refactor.

## Invariant Proof Traceability (MC-R1-004)

Complete invariant/contradiction coverage matrix mapping each stable invariant ID to its true normative owners and runtime boundaries.

| Invariant / Trace ID | Canonical Normative Definition | Runtime Enforcement Boundary / Guard | Characterization Test / Fixture | Applicable Role/Workflow | Manifest / Generated-Bundle Ownership |
|---|---|---|---|---|---|
| **MC-INV-01 (Founder Auth)** | `docs/mission-control/mission-control-guide.md` | `scripts/guard-mission-control-drift.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-INV-02 (Fail-Closed)** | `docs/mission-control/mission-control-guide.md` | `scripts/agent-issue.mjs` (Preflight halts) | `tests/int/mission-control-characterization.int.spec.ts` | All Roles | Manifest / Generated Role Bundle |
| **MC-INV-03 (Exact-Head)** | `docs/mission-control/mission-control-guide.md` | `scripts/agent-issue.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Reviewer / Corrector | Manifest / Generated Role Bundle |
| **MC-INV-04 (Review Budget)** | `docs/mission-control/mission-control-guide.md` | `scripts/mission-control-reconcile.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Reviewer | Manifest / Generated Role Bundle |
| **MC-INV-05 (Child-Sync)** | `docs/mission-control/mission-control-guide.md` | `scripts/sync-boilerplate.mjs` | `tests/int/guard-pack.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |
| **MC-SCENARIO-001 to 010 (Issue 150 Contradiction Traces)** | `docs/mission-control/dogfood/issue-150-expected-behavior-matrix.md` | `scripts/guard-mission-control-drift.mjs` | `tests/int/mission-control-characterization.int.spec.ts` | Mission Control | Manifest / Generated Role Bundle |

*(This matrix maps each stable invariant to one canonical definition, runtime enforcement boundary, guard, test, and role/workflow, and includes manifest/generated-role-bundle ownership to prevent a second policy truth.)*

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
