import { describe, expect, it } from 'vitest'

import {
  emptyCampaignSlice,
  projectCampaignBlockerResolved,
  projectCampaignSliceDone,
} from '../../scripts/mission-control/domain/merge-campaign-state-projection.mjs'

const UPDATED_AT = '2026-08-09T00:00:00.000Z'

function baseCampaign() {
  return {
    campaign_issue: '#215',
    campaign_lifecycle: 'ACTIVE',
    root_script_map: {
      validation_status: 'VALIDATED',
    },
    campaign_blockers: [
      { id: 'resolved-blocker' },
      { id: 'unrelated-blocker' },
    ],
    slices: {
      '1': {
        status: 'DONE',
        issue: '#201',
        pr: '#202',
        reviewed_head: 'a'.repeat(40),
        merged_commit: 'b'.repeat(40),
        authority_comment_ids: ['1'],
        blocker_ids: [] as string[],
      },
      '2': {
        status: 'DONE',
        issue: '#203',
        pr: '#204',
        reviewed_head: 'c'.repeat(40),
        merged_commit: 'd'.repeat(40),
        authority_comment_ids: ['2'],
        blocker_ids: [] as string[],
      },
      '3': {
        status: 'DONE',
        issue: '#205',
        pr: '#206',
        reviewed_head: 'e'.repeat(40),
        merged_commit: 'f'.repeat(40),
        authority_comment_ids: ['3'],
        blocker_ids: [] as string[],
      },
      '4': {
        status: 'DONE',
        issue: '#207',
        pr: '#208',
        reviewed_head: '1'.repeat(40),
        merged_commit: '2'.repeat(40),
        authority_comment_ids: ['4'],
        blocker_ids: [] as string[],
      },
      '5': {
        status: 'IN_PROGRESS',
        issue: '#222',
        pr: '#223',
        reviewed_head: '3'.repeat(40),
        merged_commit: null as string | null,
        authority_comment_ids: ['900'],
        blocker_ids: ['resolved-blocker'],
      },
      '6': {
        status: 'NOT_STARTED',
        issue: null as string | null,
        pr: null as string | null,
        reviewed_head: null as string | null,
        merged_commit: null as string | null,
        authority_comment_ids: [] as string[],
        blocker_ids: ['resolved-blocker'],
      },
      '7': {
        status: 'NOT_STARTED',
        issue: null as string | null,
        pr: null as string | null,
        reviewed_head: null as string | null,
        merged_commit: null as string | null,
        authority_comment_ids: [] as string[],
        blocker_ids: ['unrelated-blocker'],
      },
    },
  }
}

describe('projectCampaignSliceDone', () => {
  it('marks the target slice DONE, clears blockers, and preserves refs/ordering', () => {
    const campaign = baseCampaign()
    const next = projectCampaignSliceDone(campaign, {
      campaignSlice: 5,
      taskIssue: 222,
      prNumber: 223,
      reviewedHead: 'aa'.repeat(20),
      mergeCommit: 'bb'.repeat(20),
      authorizationCommentId: 901,
      updatedAt: UPDATED_AT,
    })

    expect(Object.keys(next.slices)).toEqual(Object.keys(campaign.slices))
    expect(next.slices['5']).toEqual({
      status: 'DONE',
      issue: '#222',
      pr: '#223',
      reviewed_head: 'aa'.repeat(20),
      merged_commit: 'bb'.repeat(20),
      authority_comment_ids: ['900', '901'],
      blocker_ids: [],
    })
    expect(next.slices['1']).toEqual(campaign.slices['1'])
    expect(next.slices['7']).toEqual(campaign.slices['7'])
    expect(next.updated_at).toBe(UPDATED_AT)
    expect(next.updated_by).toBe('Founder-authorized merge transport')
  })

  it('deep-clones so input campaign slices are not mutated', () => {
    const campaign = baseCampaign()
    const next = projectCampaignSliceDone(campaign, {
      campaignSlice: 5,
      taskIssue: 222,
      prNumber: 223,
      reviewedHead: 'aa'.repeat(20),
      mergeCommit: 'bb'.repeat(20),
      authorizationCommentId: 901,
      updatedAt: UPDATED_AT,
    })

    expect(next.slices).not.toBe(campaign.slices)
    expect(next.slices['5']).not.toBe(campaign.slices['5'])
    next.slices['5'].status = 'MUTATED'
    expect(campaign.slices['5'].status).toBe('IN_PROGRESS')
    expect(campaign.slices['5'].blocker_ids).toEqual(['resolved-blocker'])
  })

  it('rejects a slice that is not bound to the task issue', () => {
    expect(() => projectCampaignSliceDone(baseCampaign(), {
      campaignSlice: 5,
      taskIssue: 999,
      prNumber: 223,
      reviewedHead: 'aa'.repeat(20),
      mergeCommit: 'bb'.repeat(20),
      authorizationCommentId: 901,
      updatedAt: UPDATED_AT,
    })).toThrow('STATE_CONFLICT: campaign slice 5 is not bound to Task Issue #999')
  })
})

describe('projectCampaignBlockerResolved', () => {
  const authority = {
    authorized_max_slice: 11,
    decision: 'APPROVED',
  }

  it('expands slices through authorizedMaxSlice, clears the blocker, and updates validation_status', () => {
    const campaign = baseCampaign()
    const next = projectCampaignBlockerResolved(campaign, {
      campaignBlockerId: 'resolved-blocker',
      authority,
      updatedAt: UPDATED_AT,
    })

    expect(Object.keys(next.slices)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
    expect(next.slices['8']).toEqual(emptyCampaignSlice())
    expect(next.slices['11']).toEqual(emptyCampaignSlice())
    expect(next.slices['5'].blocker_ids).toEqual([])
    expect(next.slices['6'].blocker_ids).toEqual([])
    expect(next.slices['7'].blocker_ids).toEqual(['unrelated-blocker'])
    expect(next.campaign_blockers).toEqual([{ id: 'unrelated-blocker' }])
    expect(next.root_script_map.validation_status).toBe('PENDING_EXPANDED_IMPLEMENTATION')
    expect(next.campaign_lifecycle).toBe('ACTIVE')
    expect(next.campaign_expansion_authority).toEqual(authority)
    expect(next.slices['1']).toEqual(campaign.slices['1'])
    expect(next.slices['4']).toEqual(campaign.slices['4'])
    expect(next.updated_at).toBe(UPDATED_AT)
  })

  it('deep-clones campaign input and does not mutate prior slices', () => {
    const campaign = baseCampaign()
    const next = projectCampaignBlockerResolved(campaign, {
      campaignBlockerId: 'resolved-blocker',
      authority,
      updatedAt: UPDATED_AT,
    })

    expect(next.slices).not.toBe(campaign.slices)
    next.slices['5'].blocker_ids.push('mutated')
    expect(campaign.slices['5'].blocker_ids).toEqual(['resolved-blocker'])
    expect(campaign.campaign_blockers).toHaveLength(2)
  })

  it('rejects authority outside the Founder-approved Slice 11 bound', () => {
    expect(() => projectCampaignBlockerResolved(baseCampaign(), {
      campaignBlockerId: 'resolved-blocker',
      authority: { authorized_max_slice: 10 },
      updatedAt: UPDATED_AT,
    })).toThrow('STATE_CONFLICT: blocker-resolution is bounded to the Founder-approved campaign range through Slice 11')
  })

  it('rejects clearing a blocker from protected slices 1–4', () => {
    const campaign = baseCampaign()
    campaign.slices['2'].blocker_ids = ['resolved-blocker']
    expect(() => projectCampaignBlockerResolved(campaign, {
      campaignBlockerId: 'resolved-blocker',
      authority,
      updatedAt: UPDATED_AT,
    })).toThrow('STATE_CONFLICT: blocker-resolution may not mutate untouched campaign Slice 2')
  })
})
