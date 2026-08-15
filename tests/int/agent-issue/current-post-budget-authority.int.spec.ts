import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderMissionControlState } from '../../../scripts/mission-control/domain/task-state.ts'
import type { ExactHeadCiAnalysis } from '../../../scripts/agent-issue/exact-head-ci.ts'

async function loadModule() {
  return import('../../../scripts/agent-issue/current-post-budget-authority.mjs')
}

describe('Cluster E characterization (issue #333) — current-post-budget-authority', () => {
  it('validatePinnedFounderDecision checks metadata, content hash, and labeled fields', async () => {
    const { validatePinnedFounderDecision } = await loadModule()
    const body = `- **Canonical repository:** \`boat1994/test\`
- **Repository ID:** \`RID\`
- **Issue:** \`#92\`
- **PR:** \`#42\`
- **Specification RESULT comment:** \`1\`
- **Review 7 verdict comment:** \`2\`
- **Correction base:** \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`
- **Historical Review 3 authority source comment:** \`3\`
- **Historical HANDOFF comment:** \`4\`
- **Historical authorization ID:** \`auth\`
- **Historical reviewed head:** \`cccccccccccccccccccccccccccccccccccccccc\`
- **Historical action:** \`act\`
- **Historical authorization timestamp:** \`2026-01-01T00:00:00.000Z\`
- **Approved action:** \`MC-R1 on bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`
- **Finding IDs:** MC-R1
- **Historical finding IDs:** MC-R1
`
    const authority = {
      comment_id: '9001',
      content_sha256: createHash('sha256').update(body).digest('hex'),
      author_login: 'boat1994',
      author_association: 'OWNER',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      canonical_repository: 'boat1994/test',
      repository_id: 'RID',
      issue: '#92',
      pr: '#42',
      specification_result_comment_id: '1',
      review_7_verdict_comment_id: '2',
      correction_base: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      historical_review_3_source_comment_id: '3',
      historical_handoff_comment_id: '4',
      historical_authorization_id: 'auth',
      historical_reviewed_head: 'cccccccccccccccccccccccccccccccccccccccc',
      historical_action: 'act',
      historical_authorized_at: '2026-01-01T00:00:00.000Z',
      approved_action: 'MC-R1',
      finding_ids: ['MC-R1'],
      historical_finding_ids: ['MC-R1'],
    }
    const ok = validatePinnedFounderDecision({
      authority,
      source: {
        ok: true as const,
        comment: {
          id: '9001',
          html_url: 'https://github.com/boat1994/test/issues/92#issuecomment-9001',
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          body,
        },
      },
      issueNumber: 92,
      defaultRepo: 'boat1994/test',
    })
    expect(ok.ok).toBe(true)

    const badHash = validatePinnedFounderDecision({
      authority: { ...authority, content_sha256: 'f'.repeat(64) },
      source: {
        ok: true as const,
        comment: {
          id: '9001',
          html_url: 'https://github.com/boat1994/test/issues/92#issuecomment-9001',
          user: { login: 'boat1994' },
          author_association: 'OWNER',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          body,
        },
      },
      issueNumber: 92,
      defaultRepo: 'boat1994/test',
    })
    expect(badHash.errors).toContain('STATE CONFLICT: pinned Founder decision content hash does not match state')
  })

  it('recoverCurrentAuthority returns null for invalid state or post_budget_reviews < 4', async () => {
    const { recoverCurrentAuthority } = await loadModule()
    const baseArgs = {
      cwd: '/tmp',
      env: process.env,
      issueNumber: 92,
      comments: [] as Record<string, unknown>[],
      getDefaultRepo: () => 'boat1994/test',
      fetchIssueCommentById: () => ({ ok: false as const, reason: 'unused' }),
      fetchPullReviewCommentById: () => ({ ok: false as const, reason: 'unused' }),
      fetchPrByReference: () => ({ ok: false as const, reason: 'unused' }),
      analyzeExactHeadCi: (): ExactHeadCiAnalysis => ({
        available: false,
        exactHeadVerified: false,
        headSha: null,
        ciSha: null,
        summary: 'no ci',
      }),
    }
    expect(recoverCurrentAuthority({ ...baseArgs, issueBody: 'no state' })).toBeNull()
    expect(
      recoverCurrentAuthority({
        ...baseArgs,
        issueBody: `<!-- bemoat-mission-control-state:start -->
\`\`\`yaml
schema_version: 1
state: IN_PROGRESS
review_cycle: 3
full_review_count: 1
approved_base: main
active_task_issue: "#92"
active_pr: null
current_head: null
last_reviewed_head: null
guide_version: "1.0.0"
guide_source_ref: main
guide_source_sha: null
open_blockers: []
follow_up_issues: []
next_permitted_action: x
material_change_status: none
updated_at: "2026-01-01T00:00:00.000Z"
updated_by: x
post_budget_reviews: []
\`\`\`
<!-- bemoat-mission-control-state:end -->`,
      }),
    ).toBeNull()
  })

  it('recoverCurrentAuthority maps pinned source fetch failures to a single opaque error', async () => {
    const { recoverCurrentAuthority } = await loadModule()
    const reviewedHead = 'b'.repeat(40)
    const historicalHead = 'c'.repeat(40)
    const replacementBase = 'd'.repeat(40)
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
      open_blockers: ['MC-R1'],
      follow_up_issues: [],
      next_permitted_action: 'x',
      material_change_status: 'none',
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: 'x',
      post_budget_reviews: [4, 5, 6].map((review_number) => ({
        review_number,
        reviewed_head: reviewedHead,
        verdict: 'CORRECTION REQUIRED',
        verdict_comment_id: String(review_number + 6),
        authorization: {
          status: 'approved',
          authority: 'Founder',
          scope: 'review',
          review_number,
          reviewed_head: reviewedHead,
          action: 'a',
          authorized_at: '2026-01-01T00:00:00.000Z',
        },
        finding_dispositions: [{ finding_id: 'MC-R1', disposition: 'open' }],
      })).concat([{
        review_number: 7,
        reviewed_head: reviewedHead,
        verdict: 'CORRECTION REQUIRED',
        verdict_comment_id: '2',
        authorization: {
          status: 'approved',
          authority: 'Founder',
          scope: 'review',
          review_number: 7,
          reviewed_head: reviewedHead,
          action: 'a',
          authorized_at: '2026-01-01T00:00:00.000Z',
        },
        finding_dispositions: [{ finding_id: 'MC-R1', disposition: 'open' }],
      }]),
      founder_migration_authority: {
        schema_version: 3,
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        canonical_repository: 'boat1994/bemoat-web-starter',
        issue: '#92',
        pr: '#42',
        content_sha256: 'a'.repeat(64),
        comment_id: '1',
        specification_result_comment_id: '1',
        review_7_verdict_comment_id: '2',
        historical_review_3_source_comment_id: '3',
        historical_handoff_comment_id: '4',
        correction_base: reviewedHead,
        finding_ids: ['MC-R1'],
        historical_finding_ids: ['MC-R1'],
        historical_authorization_id: 'auth',
        historical_reviewed_head: historicalHead,
        historical_action: 'act',
        historical_authorized_at: '2026-01-01T00:00:00.000Z',
      },
      founder_decision: {
        status: 'approved',
        authority: 'Founder',
        scope: 'correction',
        for_review_number: 7,
        reviewed_head: reviewedHead,
        finding_ids: ['MC-R1'],
        action: '1',
        authorized_at: '2026-01-01T00:00:00.000Z',
      },
      founder_correction_authorization: {
        schema_version: 2,
        status: 'consumed',
        authority: 'Founder',
        scope: 'correction',
        for_review_number: 3,
        authorization_id: 'auth',
        reviewed_head: historicalHead,
        action: 'act',
        authorized_at: '2026-01-01T00:00:00.000Z',
        handoff_comment_id: '4',
        finding_ids: ['MC-R1'],
      },
      founder_base_change_decision: {
        status: 'approved',
        authority: 'Founder',
        old_pr: '#42',
        old_base: reviewedHead,
        replacement_pr: '#42',
        finding_scope: 'MC-R1',
        source_comment_id: '5',
        new_correction_base: replacementBase,
      },
      replacement_dispatch: {
        status: 'active',
        target: 'Dev / Correction Builder',
        handoff_comment_id: '5',
        active_pr: '#42',
        correction_base: replacementBase,
        implementation_head: reviewedHead,
        finding_ids: ['MC-R1'],
      },
    })

    const opaque = recoverCurrentAuthority({
      cwd: process.cwd(),
      env: process.env,
      issueNumber: 92,
      issueBody,
      comments: [] as Record<string, unknown>[],
      getDefaultRepo: () => 'boat1994/bemoat-web-starter',
      fetchIssueCommentById: () => ({ ok: false as const, reason: 'leaked reason' }),
      fetchPullReviewCommentById: () => ({ ok: false as const, reason: 'unused' }),
      fetchPrByReference: () => ({ ok: false as const, reason: 'unused' }),
      analyzeExactHeadCi: (): ExactHeadCiAnalysis => ({
        available: true,
        exactHeadVerified: true,
        headSha: reviewedHead,
        ciSha: reviewedHead,
        summary: 'ok',
      }),
    })
    expect(opaque).toEqual({ ok: false, errors: ['pinned authority source metadata is unavailable'] })
  })
})
