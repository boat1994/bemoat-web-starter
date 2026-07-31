import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- executable .mjs boundary */
import * as reconcileModule from '../../scripts/mission-control-reconcile.mjs'

const { Coordinator, projectReviewVerdictState } = reconcileModule as unknown as Record<string, any>

const verdictBody = `## REVIEW_VERDICT

### Task log
- Timestamp: 2026-07-31T12:00:00+07:00
- Task / Issue: #231
- Phase: Reviewer
- Executing role: Reviewer / Red Team

**PR / base / head:** https://github.com/boat1994/bemoat-web-starter/pull/232 · \`main\` · \`deadbeef\`
**Verdict:** CORRECTION REQUIRED
**Findings:** Critical: None · Important: MC-R1-231-001
**Gates:** exact-head CI pass
**Next:** Dev posts correction RESULT
`

describe('mission-control review transition', () => {
  it('posts one verdict then projects its durable state exactly once on replay', async () => {
    let state: any = {
      state: 'AWAITING_REVIEW_1', review_cycle: 0, full_review_count: 0,
      active_pr: '#232', current_head: 'deadbeef', last_reviewed_head: null,
      open_blockers: [], next_permitted_action: 'Review 1',
    }
    const comments: any[] = []
    let postCount = 0
    const coordinator = new Coordinator({
      readState: async () => structuredClone(state),
      writeState: async (next: any, expected: any) => {
        expect(state).toEqual(expected)
        state = structuredClone(next)
        return structuredClone(state)
      },
      listComments: async () => comments,
      postComment: async (body: string) => {
        postCount += 1
        const comment = { id: '9001', body }
        comments.push(comment)
        return comment
      },
    })
    const project = (prior: any, comment: any, identity: any) => projectReviewVerdictState({
      prior, verdict: 'CORRECTION REQUIRED', reviewType: 'full', reviewedHead: 'deadbeef',
      commentId: comment.id, transitionIdentity: JSON.stringify(identity),
      findings: [{ finding_id: 'MC-R1-231-001' },], updatedAt: 'now', updatedBy: 'Reviewer',
    })

    const first = await coordinator.integrateReviewVerdict({ verdictBody, projectState: project })
    expect(first.outcome).toBe('REVIEWED')
    expect(state).toMatchObject({ state: 'CORRECTION_REQUIRED_1', review_cycle: 1, full_review_count: 1, latest_review_verdict_comment_id: '9001', open_blockers: ['MC-R1-231-001'] })

    const replay = await coordinator.integrateReviewVerdict({ verdictBody, projectState: project })
    expect(replay.outcome).toBe('REVIEWED')
    expect(postCount).toBe(1)
    expect(state.review_cycle).toBe(1)
  })

  it('keeps the review CLI as a sync-managed facade', async () => {
    const sync = await import('../../scripts/sync-boilerplate.mjs')
    expect(sync.managedPaths).toContain('scripts/mission-control-review.mjs')
    expect(sync.managedPackageScripts).toContain('bemoat:mission-control:review')
    expect((await import('../../package.json', { with: { type: 'json' } })).default.scripts['bemoat:mission-control:review'])
      .toBe('node scripts/mission-control-review.mjs')
  })
})
