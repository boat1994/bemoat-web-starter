import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_PROJECTION_KINDS,
  resolveCampaignProjectionKind,
} from '../../scripts/mission-control/domain/merge-campaign-projection.ts'
import { classifyCampaignOwnershipEvidence } from '../../scripts/mission-control/domain/merge-campaign-ownership.mjs'
import { campaignParseFailure } from '../../scripts/mission-control/domain/merge-campaign-errors.mjs'

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

describe('classifyCampaignOwnershipEvidence', () => {
  type Route = {
    projectionKind: string
    campaignIssue: number
    campaignSlice: number | null
    blockerBinding: { campaignBlockerId: string } | null
  }

  const route: Route = {
    projectionKind: CAMPAIGN_PROJECTION_KINDS.SLICE,
    campaignIssue: 215,
    campaignSlice: 3,
    blockerBinding: null,
  }
  const ownership = {
    verified: true,
    evidence_kind: 'campaign-projection',
    projectionKind: CAMPAIGN_PROJECTION_KINDS.SLICE,
    campaignIssue: '#215',
    campaignSlice: '3',
    taskIssue: '#222',
    prNumber: '#223',
  }

  it('classifies exact durable ownership evidence as valid', () => {
    expect(classifyCampaignOwnershipEvidence({ ownership, route, issueNumber: 222, prNumber: 223 })).toEqual({
      valid: true,
      ownership,
      reason: null,
    })
  })

  it.each([
    ['unverified evidence', { verified: false }, 'campaign merge route requires verified durable ownership evidence'],
    ['a mismatched projection kind', { projectionKind: CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION }, 'campaign ownership evidence projection kind differs from authorization'],
    ['a mismatched campaign Issue', { campaignIssue: 216 }, 'campaign ownership evidence campaign Issue differs from managed state'],
    ['a mismatched task tuple', { taskIssue: 999 }, 'campaign ownership evidence does not bind the exact task and PR'],
    ['a mismatched slice', { campaignSlice: 4 }, 'campaign ownership evidence slice differs from managed state'],
    ['non-canonical evidence', { evidence_kind: 'pull-request-body' }, 'campaign merge route requires canonical allocation or ownership-registry evidence'],
  ])('classifies %s as invalid without throwing', (_label, changes, reason) => {
    expect(classifyCampaignOwnershipEvidence({
      ownership: { ...ownership, ...changes },
      route,
      issueNumber: 222,
      prNumber: 223,
    })).toEqual({
      valid: false,
      ownership: null,
      reason,
    })
  })

  it('accepts task ownership registry evidence for a blocker route', () => {
    const blockerRoute: Route = {
      projectionKind: CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION,
      campaignIssue: 215,
      campaignSlice: null,
      blockerBinding: { campaignBlockerId: 'blocker-1' },
    }
    const blockerOwnership: Record<string, unknown> = {
      ...ownership,
      evidence_kind: 'task-ownership-registry',
      projectionKind: CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION,
      campaignSlice: null,
      campaignBlockerId: 'blocker-1',
    }

    expect(classifyCampaignOwnershipEvidence({
      ownership: blockerOwnership,
      route: blockerRoute,
      issueNumber: 222,
      prNumber: 223,
    })).toEqual({
      valid: true,
      ownership: blockerOwnership,
      reason: null,
    })
  })
})

describe('campaignParseFailure', () => {
  it('preserves blocked-external campaign parse failures', () => {
    expect(() => campaignParseFailure({
      classification: 'BLOCKED_EXTERNAL',
      reason: 'campaign evidence is unavailable',
    }, 'campaign evidence')).toThrow(
      'BLOCKED_EXTERNAL: campaign evidence: campaign evidence is unavailable',
    )
  })

  it('classifies other campaign parse failures as state conflicts', () => {
    expect(() => campaignParseFailure({
      classification: 'STATE_CONFLICT',
      reason: 'invalid campaign projection',
    }, 'campaign Issue #215')).toThrow(
      'STATE_CONFLICT: campaign Issue #215: invalid campaign projection',
    )
  })
})
