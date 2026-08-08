import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

import { CAMPAIGN_PROJECTION_KINDS } from './merge-campaign-projection.mjs'

const OWNERSHIP_EVIDENCE_KINDS = new Set(['campaign-projection', 'task-ownership-registry'])

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

function invalid(reason) {
  return { valid: false, ownership: null, reason }
}

export function classifyCampaignOwnershipEvidence({ ownership, route, issueNumber, prNumber }) {
  if (!ownership || typeof ownership !== 'object' || Array.isArray(ownership) || ownership.verified !== true) {
    return invalid('campaign merge route requires verified durable ownership evidence')
  }
  const ownershipKind = ownership.projectionKind ?? ownership.projection_kind
  if (ownershipKind !== route.projectionKind) {
    return invalid('campaign ownership evidence projection kind differs from authorization')
  }
  if (normalizeIssueNumber(ownership.campaignIssue) !== route.campaignIssue) {
    return invalid('campaign ownership evidence campaign Issue differs from managed state')
  }
  if (normalizeIssueNumber(ownership.taskIssue) !== issueNumber ||
    normalizePrNumber(ownership.prNumber ?? ownership.pr) !== prNumber) {
    return invalid('campaign ownership evidence does not bind the exact task and PR')
  }
  if (ownershipKind === CAMPAIGN_PROJECTION_KINDS.SLICE) {
    if (Number(ownership.campaignSlice) !== route.campaignSlice) {
      return invalid('campaign ownership evidence slice differs from managed state')
    }
  } else if (ownership.campaignBlockerId !== route.blockerBinding?.campaignBlockerId) {
    return invalid('campaign ownership evidence blocker differs from authorization')
  }
  if (!OWNERSHIP_EVIDENCE_KINDS.has(ownership.evidence_kind)) {
    return invalid('campaign merge route requires canonical allocation or ownership-registry evidence')
  }
  return { valid: true, ownership, reason: null }
}
