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

## Minimal Workflow/State Model

The Mission Control workflow operates through deterministic state transitions tracked in a single marked block:

- **READY**: Pre-execution state, awaiting agent loop triggers.
- **AWAITING_REVIEW_{N}**: Agent implementation complete; pending human or exact-head automated review (N ranges from 1 to 3).
- **CORRECTION_REQUIRED_{N}**: Review failed; agent must correct its previous work (N ranges from 1 to 2).
- **BLOCKED_FOR_FOUNDER_DECISION**: Work requires explicit Founder decision/override (replaces autonomous Review 4).
- **ELIGIBLE_FOR_FOUNDER_REVIEW**: Final integration checks passed; ready for merge.
- **DONE**: Work merged and closed.

## Canonical vs GitHub-derived vs Removable Fields

- **Canonical (Required)**: `schema_version`, `state`, `counters` (cycle/review), `approved_base`, `guide_source`, `active_task_issue`, `next_permitted_action`.
- **GitHub-derived**: Status check rollups, PR head SHAs, branch names, issue/PR association, older-SHA CI success.
- **Removable/Deprecated**: `MISSION_CONTROL_STATE` (legacy unmarked block).

## Transition and Founder-gate Matrix

| Current State | Condition | Next State | Gate / Guard |
|---|---|---|---|
| READY | Delivery PR opened & verified | AWAITING_REVIEW_1 | Agent CI preflight |
| AWAITING_REVIEW_1 | Exact-head CI pass + Review pass | AWAITING_REVIEW_2 | Review 1 completion |
| AWAITING_REVIEW_{1,2} | Exact-head CI fail / Review fail | CORRECTION_REQUIRED_{1,2} | Correction tracking guard |
| AWAITING_REVIEW_3 | CI fail / Review fail | BLOCKED_FOR_FOUNDER_DECISION | No autonomous Review 4 gate |
| AWAITING_REVIEW_3 | All CI pass + Review 3 pass | ELIGIBLE_FOR_FOUNDER_REVIEW | 3-cycle limit check |
| ELIGIBLE_FOR_FOUNDER_REVIEW | Founder approves and merges | DONE | Founder Merge Gate |

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

## Compatibility and Migration Sequencing

1.  **Phase 1**: Merge characterization baseline (Issue #150 - completed).
2.  **Phase 2**: State migration of active issues (e.g., Issue #149 state block upgrade - completed).
3.  **Phase 3**: Extract modules into `docs/mission-control/modules/` while keeping them referenced in the legacy guide.
4.  **Phase 4**: Compact `mission-control-guide.md` to just the core kernel and routing logic.
5.  **Phase 5**: Update agent startup context configuration to load only the kernel by default, and modules conditionally.

## Rollback

- Revert `mission-control-guide.md` to the monolithic version via Git if module loading fails or invariants are breached.
- Issue state downgrades are explicitly forbidden (fail-closed); manual intervention by the Founder is required to fix broken states.

## Starter/Child Sync Safety

- Core kernel and all modules are tracked in `managedPaths`.
- Child projects sync the exact modularized architecture without modification.
- Child overrides may only narrow or strictly append to module rules; they must never relax shared kernel invariants.
- Preflight guards ensure sync integrity before work begins.

## Before/After Metrics

| Metric | Before | After (Target) |
|---|---|---|
| Startup Policy Proxy Tokens | ~100% (Monolith) | Reduced by >= 50% |
| Mandatory Kernel Lines | > 1000 lines | 200 - 350 lines |
| Invariant Traceability | Weak/Implied | Strong (Explicit IDs) |
| Context Contamination | High (all roles loaded) | Low (on-demand loading)|

## Bounded Implementation-Issue Decomposition

1.  **Issue A (Module Extraction)**: Create `docs/mission-control/modules/` and extract checklists, templates, and child-sync operations. Update the monolithic guide to source from them.
2.  **Issue B (Kernel Compaction)**: Strip `mission-control-guide.md` down to the 200-350 line kernel containing only universally required normative contracts.
3.  **Issue C (Context Loading)**: Update the chatGPT/agent bootstrap context and preflight scripts to load only the compact kernel and conditionally load modules.

## Invariant Proof Traceability

Every invariant maps directly to its owner module in the new architecture:

1.  **Founder-authority**: `mission-control-guide.md` (Kernel)
2.  **Fail-closed outcomes**: `mission-control-guide.md` (Kernel) + runtime script guards.
3.  **Exact-head rules**: `mission-control-guide.md` (Kernel) + `guard-planning-contract.mjs`
4.  **Review-budget/history**: `mission-control-guide.md` (Kernel) + `mission-control-reconcile.mjs`
5.  **Durable-state loading**: `mission-control-guide.md` (Kernel) + `mission-control-state.mjs`
6.  **Correction procedures**: `modules/correction-procedures.md` (Module)
7.  **Child-sync invariant**: `mission-control-guide.md` (Kernel) + `scripts/bemoat-sync.sh`
