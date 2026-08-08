import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_PROJECTION_KINDS,
  resolveCampaignProjectionKind,
} from '../../scripts/mission-control/domain/merge-campaign-projection.mjs'

describe('resolveCampaignProjectionKind', () => {
  it.each([
    [{}, CAMPAIGN_PROJECTION_KINDS.SLICE],
    [{ projection_kind: CAMPAIGN_PROJECTION_KINDS.SLICE }, CAMPAIGN_PROJECTION_KINDS.SLICE],
    [{ projection_kind: CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION }, CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION],
  ])('classifies a valid %s authorization as %s', (authorization, projectionKind) => {
    expect(resolveCampaignProjectionKind(authorization)).toEqual({
      valid: true,
      projectionKind,
      reason: null,
    })
  })

  it.each([
    ['a blocker binding without an explicit kind', { campaign_blocker_id: 'blocker-1' }, 'blocker-resolution requires an explicit projection_kind'],
    ['a slice with a blocker binding', { projection_kind: CAMPAIGN_PROJECTION_KINDS.SLICE, campaign_blocker_id: 'blocker-1' }, 'campaign-slice projection cannot carry a campaign_blocker_id binding'],
    ['an unsupported kind', { projection_kind: 'unknown' }, 'unsupported campaign projection_kind: unknown'],
    ['a blocker resolution with a slice binding', { projection_kind: CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION, campaign_slice: 5 }, 'blocker-resolution projection prohibits campaign_slice'],
  ])('rejects %s', (_label, authorization, reason) => {
    expect(resolveCampaignProjectionKind(authorization)).toEqual({
      valid: false,
      projectionKind: null,
      reason,
    })
  })
})
