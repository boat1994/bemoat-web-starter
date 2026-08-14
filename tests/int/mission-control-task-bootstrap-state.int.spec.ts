import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import { canonicalHash, TASK_ATTESTATION_SCHEMA } from '../../scripts/mission-control/domain/task-attestation.mjs'
import { buildInitialTaskState } from '../../scripts/mission-control/domain/task-bootstrap-state.mjs'

describe('Mission Control Task bootstrap initial state projection', () => {
  it('keeps the compatibility facade logic-free and preserves observable key order', () => {
    expect(readFileSync('scripts/mission-control/domain/task-bootstrap-state.mjs', 'utf8')).toBe(
      "export * from './task-bootstrap-state.ts'\n",
    )

    expect(Object.keys(buildInitialTaskState({ issueNumber: 300 }))).toEqual([
      'schema_version',
      'state',
      'review_cycle',
      'full_review_count',
      'approved_base',
      'active_task_issue',
      'active_pr',
      'current_head',
      'last_reviewed_head',
      'guide_version',
      'guide_source_ref',
      'guide_source_sha',
      'open_blockers',
      'follow_up_issues',
      'next_permitted_action',
      'material_change_status',
      'updated_at',
      'updated_by',
      'parent_issue',
      'policy_source',
      'policy_version',
      'policy_sha',
      'bootstrap_request_id',
      'task_attestation_schema',
      'task_attestation_key_id',
      'task_attestation_sha256',
      'managed_state_sha256',
    ])
  })

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

  it('returns fresh mutable values and does not coerce pass-through fields', () => {
    const passThrough = { value: 'preserve' }
    const first = buildInitialTaskState({
      issueNumber: { toString: () => 'object-issue' },
      requestId: passThrough,
      now: passThrough,
      managedStateSha256: passThrough,
    })
    const second = buildInitialTaskState({ issueNumber: 301 })

    expect(first.active_task_issue).toBe('#object-issue')
    expect(first.bootstrap_request_id).toBe(passThrough)
    expect(first.updated_at).toBe(passThrough)
    expect(first.managed_state_sha256).toBe(passThrough)
    expect(first).not.toBe(second)
    expect(first.open_blockers).not.toBe(second.open_blockers)
    expect(first.follow_up_issues).not.toBe(second.follow_up_issues)

    first.open_blockers.push('local-only')
    first.follow_up_issues.push('#local-only')
    expect(second.open_blockers).toEqual([])
    expect(second.follow_up_issues).toEqual([])
  })

  it('preserves native coercion and destructuring failure boundaries', () => {
    expect(buildInitialTaskState().active_task_issue).toBe('#undefined')
    expect(buildInitialTaskState({ issueNumber: null }).active_task_issue).toBe('#null')
    expect(buildInitialTaskState({ issueNumber: 123n }).active_task_issue).toBe('#123')
    expect(() => buildInitialTaskState({ issueNumber: Symbol('issue') })).toThrow(TypeError)
    expect(() => buildInitialTaskState(null as never)).toThrow(TypeError)
  })

  it('preserves falsey and malformed attestation behavior', () => {
    for (const attestation of [false, 0, '', null, undefined]) {
      expect(buildInitialTaskState({ issueNumber: 302, attestation }).task_attestation_sha256).toBeNull()
      expect(buildInitialTaskState({ issueNumber: 302, attestation }).task_attestation_schema).toBe(TASK_ATTESTATION_SCHEMA)
    }

    const missingPayload: { key_id: string; payload: null } = { key_id: 'test-key', payload: null }
    expect(buildInitialTaskState({ issueNumber: 303, attestation: missingPayload })).toMatchObject({
      task_attestation_schema: TASK_ATTESTATION_SCHEMA,
      task_attestation_key_id: 'test-key',
      task_attestation_sha256: canonicalHash(missingPayload),
    })

    expect(() => buildInitialTaskState({ attestation: { payload: { undefined_value: undefined } } })).toThrow(
      'canonical payload cannot contain undefined key undefined_value',
    )
    expect(() => buildInitialTaskState({ attestation: { payload: { non_finite: Number.NaN } } })).toThrow(
      'canonical payload cannot contain a non-finite number',
    )
    expect(() => buildInitialTaskState({ attestation: { payload: { bigint: 1n } } })).toThrow(
      'canonical payload contains unsupported value type bigint',
    )
  })
})
