import { describe, expect, it } from 'vitest'
import yaml from 'yaml'

import { coordinatorOwnedRoutingProjection } from '../../scripts/mission-control/coordinator-projection.mjs'
import {
  normalizePlanningAuthorizationBaseSha,
  normalizeWorkflowMode,
  parseMissionControlState,
  populateOrPreservePlanningAuthorizationBaseSha,
} from '../../scripts/mission-control/domain/task-state.ts'

const LINEAGE = 'a'.repeat(40)
const CONFLICTING_LINEAGE = 'b'.repeat(40)

function readyState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    state: 'READY',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: 'main',
    active_task_issue: '"#92"',
    active_pr: null,
    current_head: null,
    last_reviewed_head: null,
    workflow_mode: 'planning_no_pr',
    guide_version: '1.2.0',
    guide_source_ref: 'main',
    guide_source_sha: null,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Mission Control posts HANDOFF',
    material_change_status: 'none',
    updated_at: '2026-07-31T00:00:00.000Z',
    updated_by: 'Mission Control',
    ...overrides,
  }
}

const handoff = {
  id: 'handoff-1',
  body: '## HANDOFF\n\n**Target:** Dev / Builder',
}

const identity = {
  taskId: '92',
  phase: 'Planning',
  role: 'HANDOFF',
  contentHash: 'content-hash',
}

function renderState(state: Record<string, unknown>): string {
  return [
    '<!-- bemoat-mission-control-state:start -->',
    '```yaml',
    yaml.stringify(state, { lineWidth: 0 }).trim(),
    '```',
    '<!-- bemoat-mission-control-state:end -->',
  ].join('\n')
}

describe('retained planning lineage and HANDOFF projection', () => {
  it('normalizes the additive workflow and lineage fields fail-closed', () => {
    expect(normalizeWorkflowMode('planning_no_pr')).toEqual({ ok: true, value: 'planning_no_pr' })
    expect(normalizeWorkflowMode('planning')).toMatchObject({ ok: false })
    expect(normalizePlanningAuthorizationBaseSha(`  ${LINEAGE.toUpperCase()}  `)).toEqual({
      ok: true,
      value: LINEAGE,
    })
    expect(normalizePlanningAuthorizationBaseSha('main')).toMatchObject({ ok: false })
  })

  it('populates, preserves, and rejects conflicting planning lineage authority', () => {
    const populated = populateOrPreservePlanningAuthorizationBaseSha(readyState(), LINEAGE)
    expect(populated).toEqual({ ok: true, state: { ...readyState(), planning_authorization_base_sha: LINEAGE }, populated: true })
    if (!populated.ok) return

    expect(populateOrPreservePlanningAuthorizationBaseSha(populated.state, LINEAGE)).toMatchObject({
      ok: true,
      populated: false,
    })
    expect(populateOrPreservePlanningAuthorizationBaseSha(populated.state, CONFLICTING_LINEAGE)).toEqual({
      ok: false,
      reason: 'planning_authorization_base_sha is immutable once authorized and conflicts with the requested lineage SHA',
    })
  })

  it('populates lineage through the production HANDOFF routing projection', () => {
    const projected = coordinatorOwnedRoutingProjection({
      identity,
      comment: handoff,
      role: 'HANDOFF',
      updatedAt: '2026-07-31T00:00:00.000Z',
      updatedBy: 'Mission Control',
      base: readyState(),
      prior: readyState(),
      planningAuthorizationBaseSha: LINEAGE,
    }) as Record<string, unknown>

    expect(projected.planning_authorization_base_sha).toBe(LINEAGE)
    expect(projected.state).toBe('IN_PROGRESS')
    expect(projected.latest_handoff_comment_id).toBe('handoff-1')
  })

  it('does not populate lineage for non-planning HANDOFF and preserves it on parse/render', () => {
    const projected = coordinatorOwnedRoutingProjection({
      identity,
      comment: handoff,
      role: 'HANDOFF',
      updatedAt: '2026-07-31T00:00:00.000Z',
      updatedBy: 'Mission Control',
      base: readyState({ workflow_mode: 'implementation_pr' }),
      prior: readyState({ workflow_mode: 'implementation_pr' }),
      planningAuthorizationBaseSha: LINEAGE,
    }) as Record<string, unknown>
    expect(projected).not.toHaveProperty('planning_authorization_base_sha')

    const parsed = parseMissionControlState(renderState({
      ...readyState(),
      planning_authorization_base_sha: LINEAGE,
    }))
    expect(parsed.valid).toBe(true)
    expect(parsed.state?.planning_authorization_base_sha).toBe(LINEAGE)
  })
})
