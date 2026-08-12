import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

import { expectedSliceKeys } from './campaign-authority.mjs'
import { sameCampaignValue } from './campaign-equality.ts'
import { validateNextAction } from './merge-next-action.mjs'

const BLOCKER_RESOLUTION_MAX_SLICE = 11

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

function expectedSliceKeysForBlockerResolution() {
  return expectedSliceKeys(BLOCKER_RESOLUTION_MAX_SLICE)
}

export function validateBlockerResolutionPostconditions(
  postconditions,
  { nextAction, expected = {}, requireTask = true } = {},
) {
  const task = postconditions?.task
  const campaign = postconditions?.campaign
  const expectedSliceKeys = expectedSliceKeysForBlockerResolution()
  const validTask = !requireTask || (
    task?.state === 'DONE' &&
    normalizeIssueNumber(task.task_issue) === expected.taskIssue &&
    normalizePrNumber(task.canonical_pr) === expected.prNumber &&
    task.reviewed_head === expected.reviewedHead &&
    task.merge_commit === expected.mergeCommit &&
    /^[1-9]\d*$/.test(String(task.final_result_comment_id ?? '')) &&
    (!expected.finalResultCommentId || String(task.final_result_comment_id) === String(expected.finalResultCommentId)) &&
    Array.isArray(task.open_blockers) &&
    task.open_blockers.length === 0 &&
    task.next_permitted_action === 'none on this task'
  )
  const slices = campaign?.slices
  const validSlices = slices && typeof slices === 'object' && !Array.isArray(slices) &&
    sameArray(Object.keys(slices), expectedSliceKeys) &&
    expectedSliceKeys.slice(0, 4).every((key) => {
      const slice = slices[key]
      return (
        slice?.status === 'DONE' &&
        slice.issue != null &&
        slice.pr != null &&
        typeof slice.reviewed_head === 'string' &&
        typeof slice.merged_commit === 'string' &&
        Array.isArray(slice.authority_comment_ids) &&
        slice.authority_comment_ids.length > 0 &&
        Array.isArray(slice.blocker_ids) &&
        !slice.blocker_ids.includes(expected.campaignBlockerId)
      )
    }) &&
    expectedSliceKeys.slice(4).every((key) => {
      const slice = slices[key]
      return (
        slice?.status === 'NOT_STARTED' &&
        slice.issue == null &&
        slice.pr == null &&
        slice.reviewed_head == null &&
        slice.merged_commit == null &&
        Array.isArray(slice.authority_comment_ids) &&
        slice.authority_comment_ids.length === 0 &&
        Array.isArray(slice.blocker_ids) &&
        slice.blocker_ids.length === 0
      )
    })
  const durableNextAction = campaign?.durable_next_action
  const validCampaign =
    campaign?.lifecycle === 'ACTIVE' &&
    normalizeIssueNumber(campaign.campaign_issue) === expected.campaignIssue &&
    Array.isArray(campaign.blocker_ids) &&
    !campaign.blocker_ids.includes(expected.campaignBlockerId) &&
    Array.isArray(campaign.unrelated_blockers) &&
    sameArray(campaign.slice_keys, expectedSliceKeys) &&
    campaign.slice5_status === 'NOT_STARTED' &&
    validSlices &&
    sameCampaignValue(campaign.next_action, durableNextAction) &&
    validateNextAction(durableNextAction, { requiredSlice: 5 }).slice === 5
  const validSelectedAction = nextAction == null || sameCampaignValue(
    validateNextAction(nextAction, { requiredSlice: 5 }),
    validateNextAction(durableNextAction, { requiredSlice: 5 }),
  )
  if (!validTask || !validCampaign || !validSelectedAction) {
    throw stateConflict('blocker-resolution completion postconditions are incomplete, conflicting, reordered, or over-advanced')
  }
  return true
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index])
}
