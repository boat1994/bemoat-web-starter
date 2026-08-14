import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

import { expectedSliceKeys } from './campaign-authority.ts'
import { sameCampaignValue } from './campaign-equality.ts'
import { validateNextAction } from './merge-next-action.mjs'

const BLOCKER_RESOLUTION_MAX_SLICE = 11

type Mapping = Record<string, unknown>
type ExpectedBindings = Mapping
type PostconditionOptions = {
  nextAction?: unknown
  expected?: ExpectedBindings
  requireTask?: boolean
}

function isMapping(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function arrayValues(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function stateConflict(message: string) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function normalizeIssueNumber(value: unknown): number | null {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value: unknown): number | null {
  return resolvePrNumber(value)
}

function expectedSliceKeysForBlockerResolution() {
  return expectedSliceKeys(BLOCKER_RESOLUTION_MAX_SLICE)
}

export function validateBlockerResolutionPostconditions(
  postconditions: unknown,
  { nextAction, expected = {}, requireTask = true }: PostconditionOptions = {},
): true {
  const task = field(postconditions, 'task')
  const campaign = field(postconditions, 'campaign')
  const expectedSliceKeys = expectedSliceKeysForBlockerResolution()
  const openBlockers = arrayValues(field(task, 'open_blockers'))
  const validTask = !requireTask || (
    field(task, 'state') === 'DONE' &&
    normalizeIssueNumber(field(task, 'task_issue')) === expected.taskIssue &&
    normalizePrNumber(field(task, 'canonical_pr')) === expected.prNumber &&
    field(task, 'reviewed_head') === expected.reviewedHead &&
    field(task, 'merge_commit') === expected.mergeCommit &&
    /^[1-9]\d*$/.test(String(field(task, 'final_result_comment_id') ?? '')) &&
    (!expected.finalResultCommentId || String(field(task, 'final_result_comment_id')) === String(expected.finalResultCommentId)) &&
    openBlockers !== null &&
    openBlockers.length === 0 &&
    field(task, 'next_permitted_action') === 'none on this task'
  )
  const slices = field(campaign, 'slices')
  const validSlices = isMapping(slices) &&
    sameArray(Object.keys(slices), expectedSliceKeys) &&
    expectedSliceKeys.slice(0, 4).every((key) => {
      const slice = field(slices, key)
      const authorityCommentIds = arrayValues(field(slice, 'authority_comment_ids'))
      const blockerIds = arrayValues(field(slice, 'blocker_ids'))
      return (
        field(slice, 'status') === 'DONE' &&
        field(slice, 'issue') != null &&
        field(slice, 'pr') != null &&
        typeof field(slice, 'reviewed_head') === 'string' &&
        typeof field(slice, 'merged_commit') === 'string' &&
        authorityCommentIds !== null &&
        authorityCommentIds.length > 0 &&
        blockerIds !== null &&
        !blockerIds.includes(expected.campaignBlockerId)
      )
    }) &&
    expectedSliceKeys.slice(4).every((key) => {
      const slice = field(slices, key)
      const authorityCommentIds = arrayValues(field(slice, 'authority_comment_ids'))
      const blockerIds = arrayValues(field(slice, 'blocker_ids'))
      return (
        field(slice, 'status') === 'NOT_STARTED' &&
        field(slice, 'issue') == null &&
        field(slice, 'pr') == null &&
        field(slice, 'reviewed_head') == null &&
        field(slice, 'merged_commit') == null &&
        authorityCommentIds !== null &&
        authorityCommentIds.length === 0 &&
        blockerIds !== null &&
        blockerIds.length === 0
      )
    })
  const durableNextAction = field(campaign, 'durable_next_action')
  const campaignBlockerIds = arrayValues(field(campaign, 'blocker_ids'))
  const campaignUnrelatedBlockers = arrayValues(field(campaign, 'unrelated_blockers'))
  const campaignSliceKeys = arrayValues(field(campaign, 'slice_keys'))
  const validCampaign =
    field(campaign, 'lifecycle') === 'ACTIVE' &&
    normalizeIssueNumber(field(campaign, 'campaign_issue')) === expected.campaignIssue &&
    campaignBlockerIds !== null &&
    !campaignBlockerIds.includes(expected.campaignBlockerId) &&
    campaignUnrelatedBlockers !== null &&
    sameArray(campaignSliceKeys, expectedSliceKeys) &&
    field(campaign, 'slice5_status') === 'NOT_STARTED' &&
    validSlices &&
    sameCampaignValue(field(campaign, 'next_action'), durableNextAction) &&
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

function sameArray(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index])
}
