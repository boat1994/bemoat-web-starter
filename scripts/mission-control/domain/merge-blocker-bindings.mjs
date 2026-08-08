import { resolveIssueNumber } from '../../agent-issue/issue-references.mjs'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

export function validateBlockerResolutionBindings({ authorization, state }) {
  const campaignIssue = normalizeIssueNumber(authorization.campaign_issue)
  if (!campaignIssue) {
    throw stateConflict('blocker-resolution requires an exact campaign Issue binding')
  }
  if (state?.campaign_issue != null && normalizeIssueNumber(state.campaign_issue) !== campaignIssue) {
    throw stateConflict('blocker-resolution campaign Issue binding differs from managed state')
  }
  if (state?.campaign_slice != null) {
    throw stateConflict('blocker-resolution projection prohibits campaign_slice')
  }
  const campaignBlockerId = authorization.campaign_blocker_id
  if (typeof campaignBlockerId !== 'string' || campaignBlockerId.length === 0) {
    throw stateConflict('blocker-resolution requires an exact campaign blocker binding')
  }
  return { campaignIssue, campaignBlockerId }
}
