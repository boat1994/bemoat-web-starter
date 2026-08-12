import { normalizeIssueNumber, normalizePrNumber } from './merge-issue-references.mjs'
import { validateBlockerResolutionBindings } from './merge-blocker-bindings.mjs'
import { blockedExternal, stateConflict } from './merge-errors.mjs'
import { classifyCampaignOwnershipEvidence } from './merge-campaign-ownership.mjs'
import {
  CAMPAIGN_PROJECTION_KINDS,
  hasMeaningfulBindingValue,
  resolveCampaignProjectionKind,
} from './merge-campaign-projection.mjs'

export async function resolveCampaignMergeRoute({
  deps,
  repo,
  issueNumber,
  prNumber,
  authorization,
  state,
}) {
  const managedCampaignIssue = normalizeIssueNumber(state?.campaign_issue)
  const hasManagedCampaignClaim = hasMeaningfulBindingValue(state?.campaign_issue) ||
    hasMeaningfulBindingValue(state?.campaign_slice)

  if (!hasManagedCampaignClaim) return null
  if (!managedCampaignIssue) {
    throw stateConflict('managed campaign binding has an invalid campaign Issue')
  }

  const managedCampaignSlice = state?.campaign_slice == null ? null : Number(state.campaign_slice)
  const projectionClassification = resolveCampaignProjectionKind(authorization)
  if (!projectionClassification.valid) throw stateConflict(projectionClassification.reason)
  const projectionKind = projectionClassification.projectionKind
  let blockerBinding = null

  if (managedCampaignSlice != null) {
    if (!Number.isInteger(managedCampaignSlice) || managedCampaignSlice <= 0) {
      throw stateConflict('managed campaign binding has an invalid campaign slice')
    }
    if (projectionKind !== CAMPAIGN_PROJECTION_KINDS.SLICE) {
      throw stateConflict('campaign projection kind differs from managed campaign slice binding')
    }
    if (normalizeIssueNumber(authorization.campaign_issue) !== managedCampaignIssue ||
      Number(authorization.campaign_slice) !== managedCampaignSlice) {
      throw stateConflict('campaign authorization tuple differs from managed state')
    }
  } else {
    if (projectionKind !== CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION) {
      throw stateConflict('managed campaign binding requires an exact slice or blocker-resolution tuple')
    }
    blockerBinding = validateBlockerResolutionBindings({ authorization, state })
    if (blockerBinding.campaignIssue !== managedCampaignIssue) {
      throw stateConflict('blocker-resolution campaign Issue binding differs from managed state')
    }
  }

  if (typeof deps.readCampaignOwnership !== 'function') {
    throw blockedExternal('verified durable campaign ownership evidence is unavailable')
  }
  const route = {
    projectionKind,
    campaignIssue: managedCampaignIssue,
    campaignSlice: managedCampaignSlice,
    blockerBinding,
  }
  const ownership = await deps.readCampaignOwnership({
    repo,
    taskIssue: issueNumber,
    prNumber,
    campaignIssue: route.campaignIssue,
    campaignSlice: route.campaignSlice,
    campaignBlockerId: route.blockerBinding?.campaignBlockerId ?? null,
    projectionKind: route.projectionKind,
  })
  const ownershipClassification = classifyCampaignOwnershipEvidence({
    ownership,
    route,
    issueNumber,
    prNumber,
  })
  if (!ownershipClassification.valid) throw stateConflict(ownershipClassification.reason)
  return route
}

export function createCampaignOwnershipAdmission({ readCampaignIssue }) {
  return async function readCampaignOwnership({
    repo,
    taskIssue,
    prNumber,
    campaignIssue,
    campaignSlice,
    campaignBlockerId,
    projectionKind,
  }) {
    const parsed = await readCampaignIssue(repo, campaignIssue)
    if (projectionKind === CAMPAIGN_PROJECTION_KINDS.SLICE) {
      const slice = parsed.campaign?.slices?.[String(campaignSlice)]
      if (!slice ||
        normalizeIssueNumber(slice.issue) !== taskIssue ||
        normalizePrNumber(slice.pr) !== prNumber) {
        throw stateConflict(`campaign Slice ${campaignSlice} is not durably allocated to Task Issue #${taskIssue} and PR #${prNumber}`)
      }
      return {
        verified: true,
        evidence_kind: 'campaign-projection',
        projectionKind,
        campaignIssue,
        campaignSlice,
        taskIssue,
        prNumber,
      }
    }

    const blocker = (parsed.campaign?.campaign_blockers ?? [])
      .find((candidate) => candidate?.id === campaignBlockerId)
    if (!blocker ||
      normalizeIssueNumber(blocker.evidence?.issue) !== taskIssue ||
      normalizePrNumber(blocker.evidence?.pr) !== prNumber) {
      throw stateConflict(`campaign blocker ${campaignBlockerId} is not durably allocated to Task Issue #${taskIssue} and PR #${prNumber}`)
    }
    return {
      verified: true,
      evidence_kind: 'campaign-projection',
      projectionKind,
      campaignIssue,
      campaignBlockerId,
      taskIssue,
      prNumber,
    }
  }
}
