import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import { canonicalHash, TASK_ATTESTATION_SCHEMA } from '../../scripts/mission-control/domain/task-attestation.mjs'
import { buildInitialTaskState } from '../../scripts/mission-control/domain/task-bootstrap-state.mjs'

describe('Mission Control Task bootstrap initial state projection', () => {
  it('preserves the canonical schema, bindings, attestation fields, timestamps, and null defaults', () => {
    const attestation = {
      key_id: 'genesis-test-key-1',
      payload: {
        attestation_schema: TASK_ATTESTATION_SCHEMA,
      },
    }

    expect(buildInitialTaskState({
      issueNumber: 300,
      requestId: 'mc-task-bootstrap-v1-' + 'a'.repeat(64),
      attestation,
      managedStateSha256: 'b'.repeat(64),
      now: '2026-08-01T00:00:00.000Z',
    })).toEqual({
      schema_version: 1,
      state: 'AWAITING_REVIEW_1',
      review_cycle: 0,
      full_review_count: 0,
      approved_base: BOOTSTRAP_CONTRACT.base,
      active_task_issue: '#300',
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
      updated_at: '2026-08-01T00:00:00.000Z',
      updated_by: 'Mission Control Task Bootstrap',
      parent_issue: `#${BOOTSTRAP_CONTRACT.parentIssue}`,
      policy_source: BOOTSTRAP_CONTRACT.policySource,
      policy_version: BOOTSTRAP_CONTRACT.policyVersion,
      policy_sha: BOOTSTRAP_CONTRACT.policySha,
      bootstrap_request_id: 'mc-task-bootstrap-v1-' + 'a'.repeat(64),
      task_attestation_schema: TASK_ATTESTATION_SCHEMA,
      task_attestation_key_id: 'genesis-test-key-1',
      task_attestation_sha256: canonicalHash(attestation),
      managed_state_sha256: 'b'.repeat(64),
    })
  })

  it('keeps optional timestamp, attestation, and managed-state values null by default', () => {
    expect(buildInitialTaskState({
      issueNumber: 301,
      requestId: 'request-id',
    })).toMatchObject({
      updated_at: null,
      task_attestation_schema: TASK_ATTESTATION_SCHEMA,
      task_attestation_key_id: null,
      task_attestation_sha256: null,
      managed_state_sha256: null,
    })
  })
})
