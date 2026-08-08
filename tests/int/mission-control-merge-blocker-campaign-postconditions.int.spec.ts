import { describe, expect, it } from 'vitest'

import {
  blockerResolutionCampaignPostconditions,
} from '../../scripts/mission-control/domain/merge-blocker-campaign-postconditions.mjs'

describe('blockerResolutionCampaignPostconditions', () => {
  it('projects the resolved blocker, ordered slices, and durable next action', () => {
    const campaign = {
      campaign_issue: '#215',
      campaign_lifecycle: 'ACTIVE',
      campaign_blockers: [
        { id: 'resolved-blocker' },
        { id: 'unrelated-blocker' },
      ],
      slices: {
        '1': { status: 'DONE', blocker_ids: ['resolved-blocker'] },
        '5': { status: 'NOT_STARTED', blocker_ids: ['unrelated-blocker'] },
      },
    }
    const nextAction = { action: 'Review Slice 5', started: false, slice: 5 }

    expect(blockerResolutionCampaignPostconditions(campaign, 'resolved-blocker', nextAction))
      .toEqual({
        campaign_issue: '#215',
        lifecycle: 'ACTIVE',
        blocker_ids: ['resolved-blocker', 'resolved-blocker'],
        unrelated_blockers: ['unrelated-blocker', 'unrelated-blocker'],
        slice_keys: ['1', '5'],
        slices: campaign.slices,
        slice5_status: 'NOT_STARTED',
        next_action: nextAction,
        durable_next_action: nextAction,
      })
  })

  it('deep-clones slices so the pure projection cannot mutate campaign input', () => {
    const campaign: {
      slices: Record<string, { status: string; blocker_ids: string[] }>
    } = {
      slices: { '5': { status: 'NOT_STARTED', blocker_ids: [] } },
    }

    const result = blockerResolutionCampaignPostconditions(campaign, 'blocker', {
      action: 'Review Slice 5',
      started: false,
      slice: 5,
    })

    expect(result.slices).not.toBe(campaign.slices)
    result.slices['5'].status = 'DONE'
    expect(campaign.slices['5'].status).toBe('NOT_STARTED')
  })
})
