import { resolveIssueNumber } from '../../agent-issue/issue-references.mjs'

type BlockerResolutionAuthorization = {
  campaign_issue?: unknown
  campaign_blocker_id?: unknown
}

type ManagedState = {
  campaign_issue?: unknown
  campaign_slice?: unknown
}

type BlockerResolutionBindingInput = {
  authorization: BlockerResolutionAuthorization
  state?: ManagedState | null
}

type BlockerResolutionBindings = {
  campaignIssue: number
  campaignBlockerId: string
}

function stateConflict(message: string) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function normalizeIssueNumber(value: unknown): number | null {
  return resolveIssueNumber(value)
}

export function validateBlockerResolutionBindings({
  authorization,
  state,
}: BlockerResolutionBindingInput): BlockerResolutionBindings {
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
