import { describe, expect, it } from 'vitest'
import { renderMissionControlState } from '../../../scripts/mission-control/domain/task-state.ts'

async function loadModule() {
  return import('../../../scripts/agent-issue/historical-review3-authority.mjs')
}

const handoffBodyV1 = `## HANDOFF

* Phase: Founder-authorized correction after Review 3
* Authorization: \`auth-1\`
* Task / Issue: #92
**Target:** Dev / Correction Builder
**Scope:** Bind the planning contract to the canonical repository protected branch and preserve lineage
PR head \`cccccccccccccccccccccccccccccccccccccccc\`
github.com/boat1994/test/pull/42
finding \`MC-R1\`
prohibition on Review 4
Do not start Review 4
`

describe('Cluster E characterization (issue #333) — historical-review3-authority', () => {
  it('returns reviewThree:false for absent managed state when not required', async () => {
    const { verifyReviewThreeCorrectionAuthorization } = await loadModule()
    const result = verifyReviewThreeCorrectionAuthorization({
      issueBody: 'No managed state here',
      contract: { reviewed_head: 'a'.repeat(40), findings: [{ id: 'MC-R1' }] },
      comments: [],
      issueNumber: 92,
      defaultRepo: 'boat1994/test',
      cwd: '/tmp',
      env: process.env,
      fetchIssueCommentById: () => ({ ok: false, reason: 'unused' }),
    })
    expect(result).toEqual({ ok: true, errors: [], reviewThree: false })
  })

  it('parseHandoffCommentSemanticPayload throws TypeError on non-string body', async () => {
    const { parseHandoffCommentSemanticPayload } = await loadModule()
    expect(() => parseHandoffCommentSemanticPayload(null as unknown as string, 'boat1994/test', '#92')).toThrow(TypeError)
  })

  it('parseHandoffCommentSemanticPayload reports duplicate keys as STATE CONFLICT', async () => {
    const { parseHandoffCommentSemanticPayload } = await loadModule()
    const body = `${handoffBodyV1}\n* Phase: duplicate`
    const result = parseHandoffCommentSemanticPayload(body, 'boat1994/test', '#92')
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.errors).toContain('STATE CONFLICT: duplicate phase in HANDOFF')
    }
  })

  it('schema v1 skips hash and binding checks after earlier gates pass', async () => {
    const { verifyReviewThreeCorrectionAuthorization } = await loadModule()
    const reviewedHead = 'cccccccccccccccccccccccccccccccccccccccc'
    const issueBody = renderMissionControlState({
      schema_version: 1,
      state: 'IN_PROGRESS',
      review_cycle: 3,
      full_review_count: 1,
      approved_base: 'main',
      active_task_issue: '#92',
      active_pr: '#42',
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      guide_version: '1.0.0',
      guide_source_ref: 'main',
      guide_source_sha: null,
      open_blockers: [],
      follow_up_issues: [],
      next_permitted_action: 'correction',
      material_change_status: 'none',
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: 'Mission Control',
      founder_correction_authorization: {
        schema_version: 1,
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        for_review_number: 3,
        authorization_id: 'auth-1',
        reviewed_head: reviewedHead,
        finding_ids: ['MC-R1'],
        action: 'approved',
        authorized_at: '2026-01-01T00:00:00.000Z',
        handoff_comment_id: '100',
      },
    })

    const comments = [
      { id: '100', body: handoffBodyV1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ]

    const result = verifyReviewThreeCorrectionAuthorization({
      issueBody,
      contract: { reviewed_head: reviewedHead, findings: [{ id: 'MC-R1' }] },
      comments,
      issueNumber: 92,
      defaultRepo: 'boat1994/test',
      cwd: '/tmp',
      env: process.env,
      fetchIssueCommentById: () => ({ ok: false, reason: 'unused' }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.reviewThree).toBe(true)
    }
  })
})
