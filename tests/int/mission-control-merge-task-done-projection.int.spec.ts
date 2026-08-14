import { describe, expect, it } from 'vitest'

import { projectTaskDoneState } from '../../scripts/mission-control/domain/merge-task-done-projection.ts'

describe('projectTaskDoneState', () => {
  it('projects DONE state while clearing blockers and preserving untouched fields', () => {
    const managedState = {
      schema_version: 1,
      state: 'READY_TO_MERGE',
      active_task_issue: '#222',
      active_pr: '#223',
      current_head: 'aa'.repeat(20),
      last_reviewed_head: 'aa'.repeat(20),
      campaign_issue: '#215',
      campaign_slice: '5',
      open_blockers: ['blocker-a'],
      review_verdict: { decision: 'APPROVE' },
      next_permitted_action: 'Founder merge',
      custom_metadata: { keep: true },
    }

    const next = projectTaskDoneState(managedState, {
      mergeCommit: 'bb'.repeat(20),
      resultCommentId: 555,
      updatedAt: '2026-08-09T00:00:00.000Z',
    })

    expect(next).toEqual({
      schema_version: 1,
      state: 'DONE',
      active_task_issue: '#222',
      active_pr: '#223',
      current_head: 'aa'.repeat(20),
      last_reviewed_head: 'aa'.repeat(20),
      campaign_issue: '#215',
      campaign_slice: '5',
      open_blockers: [],
      review_verdict: { decision: 'APPROVE' },
      next_permitted_action: 'none on this task',
      custom_metadata: { keep: true },
      merged_commit_sha: 'bb'.repeat(20),
      latest_result_comment_id: '555',
      updated_at: '2026-08-09T00:00:00.000Z',
      updated_by: 'Founder-authorized merge transport',
    })
  })

  it('deep-clones so source managed state is not mutated', () => {
    const managedState = {
      state: 'READY_TO_MERGE',
      open_blockers: ['blocker-a'],
      review_verdict: { decision: 'APPROVE' },
      next_permitted_action: 'Founder merge',
    }

    const next = projectTaskDoneState(managedState, {
      mergeCommit: 'bb'.repeat(20),
      resultCommentId: 555,
      updatedAt: '2026-08-09T00:00:00.000Z',
    })

    expect(next).not.toBe(managedState)
    expect(next.open_blockers).not.toBe(managedState.open_blockers)
    expect(next.review_verdict).not.toBe(managedState.review_verdict)
    next.open_blockers.push('mutated')
    next.review_verdict.decision = 'MUTATED'
    expect(managedState.open_blockers).toEqual(['blocker-a'])
    expect(managedState.review_verdict.decision).toBe('APPROVE')
    expect(managedState.state).toBe('READY_TO_MERGE')
    expect(managedState.next_permitted_action).toBe('Founder merge')
  })
})
