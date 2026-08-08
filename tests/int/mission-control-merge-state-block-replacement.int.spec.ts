import { describe, expect, it } from 'vitest'

import { renderMissionControlState } from '../../scripts/mission-control-state.mjs'
import { stateBlockReplacement } from '../../scripts/mission-control/domain/merge-state-block-replacement.mjs'

describe('stateBlockReplacement', () => {
  const prior: Record<string, unknown> = {
    schema_version: 1,
    state: 'READY',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: 'main',
    active_task_issue: '#328',
    active_pr: '#332',
    current_head: null,
    last_reviewed_head: null,
    guide_version: '1.3.0',
    guide_source_ref: 'main',
    guide_source_sha: null,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Mission Control posts HANDOFF',
    material_change_status: 'none',
    updated_at: null,
    updated_by: null,
  }

  it('replaces the managed state block while preserving surrounding prose', () => {
    const next = { ...prior, state: 'DONE', updated_by: 'Mission Control' }
    const body = `prose before\n${renderMissionControlState(prior)}\nprose after`

    expect(stateBlockReplacement(body, next)).toBe(
      `prose before\n${renderMissionControlState(next)}\nprose after`,
    )
  })

  it('fails closed when the managed state block is missing', () => {
    expect(() => stateBlockReplacement('prose without a managed block', prior))
      .toThrow(/managed state block is missing/i)
  })
})
