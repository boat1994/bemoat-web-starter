import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.mjs'
import { TASK_ATTESTATION_SCHEMA, canonicalHash } from './task-attestation.mjs'

/**
 * @param {{issueNumber?: number|string, requestId?: string, attestation?: object|null, managedStateSha256?: string|null, now?: string|null}} options
 */
export function buildInitialTaskState({ issueNumber, requestId, attestation, managedStateSha256 = null, now = null } = {}) {
  const payload = attestation?.payload ?? {}
  return {
    schema_version: 1,
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: BOOTSTRAP_CONTRACT.base,
    active_task_issue: `#${issueNumber}`,
    active_pr: `#${BOOTSTRAP_CONTRACT.pullRequest}`,
    current_head: BOOTSTRAP_CONTRACT.head,
    last_reviewed_head: null,
    guide_version: BOOTSTRAP_CONTRACT.policyVersion,
    guide_source_ref: 'main',
    guide_source_sha: BOOTSTRAP_CONTRACT.policySha,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.',
    material_change_status: 'none',
    updated_at: now,
    updated_by: 'Mission Control Task Bootstrap',
    parent_issue: `#${BOOTSTRAP_CONTRACT.parentIssue}`,
    policy_source: BOOTSTRAP_CONTRACT.policySource,
    policy_version: BOOTSTRAP_CONTRACT.policyVersion,
    policy_sha: BOOTSTRAP_CONTRACT.policySha,
    bootstrap_request_id: requestId,
    task_attestation_schema: payload.attestation_schema ?? TASK_ATTESTATION_SCHEMA,
    task_attestation_key_id: attestation?.key_id ?? null,
    task_attestation_sha256: attestation ? canonicalHash(attestation) : null,
    managed_state_sha256: managedStateSha256,
  }
}
