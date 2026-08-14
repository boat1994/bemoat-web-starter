## FORWARD_PLAN_RESULT

> Planning evidence only. This result does not authorize implementation, promotion, merge, Issue closure, or any Mission Control state transition. Mission Control must re-verify live GitHub state before using any proposed boundary or sequence.

**Head Advancement Notice**: 
- **Audit Basis SHA**: `7543e6ee419b890553d785991872ee6b7bbb3fe8`
- **Current Live SHA (at posting)**: `fb7df18f193454a1b4892c637420aee9304af90f`
- *Note: The live head has advanced since the audit basis. The plan below is based on the audit basis SHA. Any portions impacted by the advancement to `fb7df18f193454a1b4892c637420aee9304af90f` (task bootstrap state boundary) will require Mission Control reconciliation.*

## Verified live state (at audit time)
- **Issue #333**: OPEN
- **PR #339**: OPEN (unmerged)
- **Branch**: `refactor/333-campaign-normalize`
- **Latest Promoted Checkpoint (Audit Basis)**: `7543e6ee419b890553d785991872ee6b7bbb3fe8` (refactor(333): migrate task bootstrap request to TypeScript)
- **Current Exact Head CI State**: Presumed pending or passed at head; no blocking failures observed on the latest promoted SHA.
- **Durable Promoted Result Lineage**: Validated against `7543e6ee419b890553d785991872ee6b7bbb3fe8`.

## Already canonical TypeScript areas
The following domain boundaries have been successfully migrated and are the authoritative production implementations:
- **Campaign normalization & validation** (`campaign-normalize`, `campaign-parser`, `campaign-validator`, `campaign-enums`, `campaign-equality`)
- **Merge domain logic** (head bindings, state projection, commit messages, issue references, result rendering)
- **Role comment & review rendering** (`role-comment-rendering`, `review-result-rendering`)
- **Correction contract identity** (`active-correction-contract`, `correction-contract-fingerprint`)
- **Task Attestation & Auth** (`task-attestation`, `task-bootstrap-authorization`, `task-bootstrap-request`)
- **Identity & Auth boundaries** (`pr-identity`, `reopen-authorization`, `reopen-result-rendering`)

## Remaining production logic inventory

| Area / Component | Files | Classification | Direct dependencies | Consumers | Risk | Suggested batch |
|---|---|---|---|---|---|---|
| **Task Bootstrap** | `task-ownership-registry.mjs`, `task-bootstrap-registry-readback.mjs` | UNMIGRATED_PRODUCTION_LOGIC | `task-attestation` | `task-bootstrap-final-readback`, workflows | RUNTIME_TRUST_BOUNDARY | Increment 1 |
| **Task State** | `task-state.mjs`, `task-state-authorization.mjs` | UNMIGRATED_PRODUCTION_LOGIC | (internal) | preflight, merge, coordinator | STATE_AUTHORITY_SENSITIVE | Increment 2 |
| **Bootstrap Allocation** | `task-bootstrap-allocation.mjs`, `task-bootstrap-lease.mjs` | UNMIGRATED_PRODUCTION_LOGIC | `task-bootstrap-authorization` | preflight, workflows | TYPED_INTERNAL_CONTRACT | Increment 3 |
| **Bootstrap Preflight** | `task-bootstrap-preflight.mjs`, `task-bootstrap-final-readback.mjs` | UNMIGRATED_PRODUCTION_LOGIC | registry, state, attestation, request | workflows, merge | STATE_AUTHORITY_SENSITIVE | Increment 4 |
| **Merge Remainder** | `merge-head-bindings.mjs`, `merge-founder-authority.mjs`, `merge-comment-supersession.mjs`, `merge-review-verdict.mjs`, `merge-safe-execution-bundle.mjs`, `merge-state-block-replacement.mjs` | UNMIGRATED_PRODUCTION_LOGIC | CI bindings, task-state | workflows | STATE_AUTHORITY_SENSITIVE | Increment 5 |
| **Correction & Recovery** | `correction-contract.mjs`, `review-recovery.mjs`, `recover-state-evidence.mjs`, `recover-state-lineage.mjs`, `recover-state-projection.mjs` | UNMIGRATED_PRODUCTION_LOGIC | fingerprint, contract | recover-state workflow, adopt-finding | RECOVERY_RECONCILIATION | Increment 6 |
| **Adopt Finding** | `adopt-finding-authorization.mjs`, `adopt-finding-projection.mjs` | UNMIGRATED_PRODUCTION_LOGIC | contract, state | adopt-finding workflow | RUNTIME_TRUST_BOUNDARY | Increment 7 |
| **Coordinator Projections** | `coordinator-projection.mjs`, `review-verdict-projection.mjs`, `reconciliation-analysis.mjs`, `reconciliation-classification.mjs`, `reconciliation-proposals.mjs`, `comment-evidence.mjs` | UNMIGRATED_PRODUCTION_LOGIC | transition guards, state | transition logic | STATE_AUTHORITY_SENSITIVE | Increment 8 |
| **Coordinator Transitions** | `coordinator-transitions.mjs`, `review-verdict-binding.mjs`, `review-verdict-transition.mjs`, `transition-authorization.mjs`, `transition-guards.mjs`, `transition-identity.mjs`, `state-verification.mjs` | UNMIGRATED_PRODUCTION_LOGIC | projections | workflows | RUNTIME_TRUST_BOUNDARY | Increment 9 |
| **Adapters** | `github-transport.mjs`, `git-transport.mjs`, `*-github.mjs` | UNMIGRATED_PRODUCTION_LOGIC | (external gh API) | workflows | EXTERNAL_ADAPTER | Increment 10 |
| **Workflows** | `workflows/*.mjs` (13 files) | UNMIGRATED_PRODUCTION_LOGIC | domains, adapters | CLI / GH Actions | CLI_OBSERVABLE_BOUNDARY | Increment 11-13 |
| **Facades** | ~19 `.mjs` exports | LOGIC_FREE_COMPATIBILITY_FACADE | canonical `.ts` | unmigrated `.mjs` files | PURE_INTERNAL | Final Cleanup |

## Proposed remaining SDD increments

### 1. Task Ownership & Registry Readback
- **Goal**: Migrate the foundational task registry reading and verification boundaries.
- **Files**: `task-ownership-registry.mjs`, `task-bootstrap-registry-readback.mjs`
- **Why**: They share a trust boundary verifying on-chain ownership from GitHub comments.
- **Risk classification**: RUNTIME_TRUST_BOUNDARY
- **Tester tier**: Luna Medium
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: `task-attestation.ts` (already met)
- **Stop/escalation condition**: If attestation format or hashing logic requires breaking changes to accommodate TS strictness.

### 2. Task State & Authorization
- **Goal**: Migrate the core mission control state parser and stringifier.
- **Files**: `task-state.mjs`, `task-state-authorization.mjs`
- **Why**: `task-state` is the single source of truth for the issue body state block.
- **Risk classification**: STATE_AUTHORITY_SENSITIVE
- **Tester tier**: Luna High
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: Increment 1
- **Stop/escalation condition**: If YAML parsing typings expose existing runtime mutations that are unsafe.

### 3. Task Bootstrap Allocation & Lease
- **Goal**: Migrate task lease acquisition and allocation projection.
- **Files**: `task-bootstrap-allocation.mjs`, `task-bootstrap-lease.mjs`
- **Why**: High cohesion; allocation logic directly relies on lease primitives.
- **Risk classification**: TYPED_INTERNAL_CONTRACT
- **Tester tier**: Luna Medium
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: `task-bootstrap-authorization.ts` (already met)
- **Stop/escalation condition**: Randomness generation or lease structure conflicts.

### 4. Task Bootstrap Preflight & Final Readback
- **Goal**: Complete the task-bootstrap domain logic before workflows.
- **Files**: `task-bootstrap-preflight.mjs`, `task-bootstrap-final-readback.mjs`
- **Why**: These are the orchestration gateways that workflows call. They assemble the lower-level primitives.
- **Risk classification**: STATE_AUTHORITY_SENSITIVE
- **Tester tier**: Luna High
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: Increments 1, 2, 3
- **Stop/escalation condition**: Integration drift between attestation and state.

### 5. Merge Domain Remainder
- **Goal**: Finalize the remaining merge domain rules.
- **Files**: `merge-head-bindings.mjs`, `merge-founder-authority.mjs`, `merge-comment-supersession.mjs`, `merge-review-verdict.mjs`, `merge-safe-execution-bundle.mjs`, `merge-state-block-replacement.mjs`
- **Why**: The merge domain was partially migrated; these are the final semantic blocks.
- **Risk classification**: STATE_AUTHORITY_SENSITIVE
- **Tester tier**: Luna High
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: Core merge parser
- **Stop/escalation condition**: State block replacement logic drift.

### 6. Correction & Recovery Domain
- **Goal**: Migrate the correction contract parsing and recovery analysis.
- **Files**: `correction-contract.mjs`, `review-recovery.mjs`, `recover-state-evidence.mjs`, `recover-state-lineage.mjs`, `recover-state-projection.mjs`
- **Why**: Essential for disaster recovery and review workflow resumption.
- **Risk classification**: RECOVERY_RECONCILIATION
- **Tester tier**: Luna High
- **Dev tier**: Luna High
- **Verifier tier**: Luna High
- **Prerequisite**: `correction-contract-fingerprint.ts` (already met)
- **Stop/escalation condition**: Historical fallback compatibility breaks.

### 7. Adopt Finding Domain
- **Goal**: Migrate the adopt-finding projections.
- **Files**: `adopt-finding-authorization.mjs`, `adopt-finding-projection.mjs`
- **Why**: Small, isolated domain relying on correction contracts.
- **Risk classification**: RUNTIME_TRUST_BOUNDARY
- **Tester tier**: Luna Medium
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: Increment 6

### 8. Coordinator Projections
- **Goal**: Migrate the read-only projection layer of the coordinator.
- **Files**: `coordinator-projection.mjs`, `review-verdict-projection.mjs`, `reconciliation-analysis.mjs`, `reconciliation-classification.mjs`, `reconciliation-proposals.mjs`, `comment-evidence.mjs`
- **Why**: These modules project state without mutating; typing them establishes the shape for transitions.
- **Risk classification**: STATE_AUTHORITY_SENSITIVE
- **Tester tier**: Luna Medium
- **Dev tier**: Luna Medium
- **Verifier tier**: Luna High
- **Prerequisite**: Task state
- **Stop/escalation condition**: Inconsistent evidence extraction across GH API shapes.

### 9. Coordinator Transitions & Verification
- **Goal**: Migrate the mutation and guard layer of the coordinator.
- **Files**: `coordinator-transitions.mjs`, `review-verdict-binding.mjs`, `review-verdict-transition.mjs`, `transition-authorization.mjs`, `transition-guards.mjs`, `transition-identity.mjs`, `state-verification.mjs`
- **Why**: Core state machine logic; must be exactly behavior-preserving.
- **Risk classification**: RUNTIME_TRUST_BOUNDARY
- **Tester tier**: Luna High
- **Dev tier**: Luna High
- **Verifier tier**: Luna High (Max if behavioral changes are forced)
- **Prerequisite**: Increment 8
- **Stop/escalation condition**: Strict equality checks (`sameValue`) failing due to typing transformations.

### 10. Adapters (External Boundaries)
- **Goal**: Type the GH API and Git transport interfaces.
- **Files**: `adapters/*.mjs`
- **Risk classification**: TYPED_INTERNAL_CONTRACT
- **Tester tier**: Luna Medium

### 11-13. Workflows (The orchestration layer)
- **Goal**: Migrate the top-level workflow executions.
- **Files**: `workflows/*.mjs`
- **Risk classification**: CLI_OBSERVABLE_BOUNDARY
- **Tester tier**: Luna Medium

## Task-bootstrap remainder
1. `task-ownership-registry`
2. `task-bootstrap-registry-readback`
3. `task-state` & `task-state-authorization`
4. `task-bootstrap-allocation` & `task-bootstrap-lease`
5. `task-bootstrap-preflight`
6. `task-bootstrap-final-readback`
7. `workflows/task-bootstrap`
8. `adapters/task-bootstrap-github`

## Workflow remainder
The entire `workflows/` directory remains as `.mjs` (13 files). These rely on the domain layer. They can be migrated mechanically once their respective domains are fully typed. They represent the `CLI_OBSERVABLE_BOUNDARY` where actions are executed.

## Adapter remainder
The `adapters/` directory contains 8 `.mjs` files bridging to GitHub and Git. These are `TYPED_INTERNAL_CONTRACT` boundaries and should be migrated after the core domain but before or alongside the workflows.

## CLI remainder
CLI logic (`cli/` outside of mission-control) is out of scope for this campaign unless directly imported. `domain/merge-cli-args` and `domain/merge-cli-result-rendering` have already been migrated. No major CLI core logic remains in the `mission-control` refactor target.

## Compatibility facade retirement map
Currently, there are 19 `.mjs` files that serve as `LOGIC_FREE_COMPATIBILITY_FACADE`s.
- **Target**: Their corresponding `.ts` files.
- **Consumers**: Unmigrated `.mjs` workflows and root coordinator files.
- **Retirement Rule**: Facades **CANNOT** be removed while unmigrated `.mjs` consumers exist. 
- **Exact dependency**: The facade can only be deleted in the **Final convergence / cleanup gate** after the last consuming `.mjs` workflow or domain module is converted to `.ts`.

## Final convergence / cleanup gate
- **Goal**: Remove all `.mjs` facades, purge obsolete `.mjs` imports, and ensure strict `tsconfig.json` compliance across the entire `mission-control` directory.
- **Condition**: 100% of production logic in `scripts/mission-control` is `.ts`.

## Estimated campaign completion
- **Implementation %**: ~42% of files migrated (50 TS / ~117 total).
- **Behavioral entropy exhausted %**: ~65% (The most complex normalization, validation, attestation, and signature components are complete).
- **Likely increments remaining**: ~13-15 increments.
- **Likely wall-clock hours**: 10–13 hours (assuming 35-50 minutes per deterministic batch).

## Recommended next 3 increments
1. **Increment 1**: `task-ownership-registry` & `task-bootstrap-registry-readback` (Task Bootstrap Core part 1)
2. **Increment 2**: `task-state` & `task-state-authorization` (Task Bootstrap Core part 2)
3. **Increment 3**: `task-bootstrap-allocation` & `task-bootstrap-lease` (Task Bootstrap internal primitives)
