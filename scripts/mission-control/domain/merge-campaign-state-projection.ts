import {
  LEGACY_MAX_SLICE,
  expectedSliceKeys,
} from './campaign-authority.ts'
import { stateConflict } from './merge-errors.mjs'
import { normalizeIssueNumber } from './merge-issue-references.mjs'

const BLOCKER_RESOLUTION_MAX_SLICE = 11
const MERGE_TRANSPORT_UPDATED_BY = 'Founder-authorized merge transport'

type Mapping = Record<string, unknown>
type CampaignSlice = Mapping & {
  blocker_ids: string[]
  authority_comment_ids?: string[] | null
  issue?: string | null
  status?: string
}
type CampaignBlocker = Mapping & { id?: unknown }
type Campaign = Mapping & {
  campaign_blockers: CampaignBlocker[]
  root_script_map: Mapping
  slices: Record<string, CampaignSlice>
}
type CampaignAuthority = Mapping & { authorized_max_slice?: unknown }
type SliceDoneOptions = {
  campaignSlice: string | number
  taskIssue: number
  prNumber: number
  reviewedHead: string
  mergeCommit: string
  authorizationCommentId: string | number
  updatedAt?: string
  updatedBy?: string
}
type BlockerResolutionOptions = {
  campaignBlockerId: string
  authority: CampaignAuthority
  updatedAt?: string
  updatedBy?: string
}

export function emptyCampaignSlice(): CampaignSlice {
  return {
    status: 'NOT_STARTED',
    issue: null,
    pr: null,
    reviewed_head: null,
    merged_commit: null,
    authority_comment_ids: [],
    blocker_ids: [],
  }
}

export function projectCampaignSliceDone(campaign: Campaign, {
  campaignSlice,
  taskIssue,
  prNumber,
  reviewedHead,
  mergeCommit,
  authorizationCommentId,
  updatedAt = new Date().toISOString(),
  updatedBy = MERGE_TRANSPORT_UPDATED_BY,
}: SliceDoneOptions): Campaign {
  const key = String(campaignSlice)
  const priorSlice = campaign?.slices?.[key]
  if (!priorSlice || (priorSlice.issue != null && normalizeIssueNumber(priorSlice.issue) !== taskIssue)) {
    throw stateConflict(`campaign slice ${key} is not bound to Task Issue #${taskIssue}`)
  }
  return {
    ...structuredClone(campaign),
    slices: {
      ...structuredClone(campaign.slices),
      [key]: {
        ...structuredClone(priorSlice),
        status: 'DONE',
        issue: `#${taskIssue}`,
        pr: `#${prNumber}`,
        reviewed_head: reviewedHead,
        merged_commit: mergeCommit,
        blocker_ids: [],
        authority_comment_ids: [...new Set([...(priorSlice.authority_comment_ids ?? []), String(authorizationCommentId)])],
      },
    },
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
}

export function projectCampaignBlockerResolved(campaign: Campaign, {
  campaignBlockerId,
  authority,
  updatedAt = new Date().toISOString(),
  updatedBy = MERGE_TRANSPORT_UPDATED_BY,
}: BlockerResolutionOptions): Campaign {
  const priorCampaign = structuredClone(campaign)
  const currentMaxSlice = Math.max(...Object.keys(priorCampaign.slices).map(Number))
  const authorizedMaxSlice = Number(authority.authorized_max_slice)
  if (authorizedMaxSlice !== BLOCKER_RESOLUTION_MAX_SLICE) {
    throw stateConflict('blocker-resolution is bounded to the Founder-approved campaign range through Slice 11')
  }
  for (const key of expectedSliceKeys(LEGACY_MAX_SLICE - 3)) {
    if (priorCampaign.slices[key]?.blocker_ids?.includes(campaignBlockerId)) {
      throw stateConflict(`blocker-resolution may not mutate untouched campaign Slice ${key}`)
    }
  }
  const nextSlices = structuredClone(priorCampaign.slices)
  for (const key of expectedSliceKeys(authorizedMaxSlice).slice(currentMaxSlice)) {
    nextSlices[key] = emptyCampaignSlice()
  }
  for (const slice of Object.values(nextSlices)) {
    slice.blocker_ids = slice.blocker_ids.filter((id) => id !== campaignBlockerId)
  }
  const nextCampaign = {
    ...priorCampaign,
    campaign_lifecycle: 'ACTIVE',
    campaign_expansion_authority: authority,
    slices: nextSlices,
    root_script_map: {
      ...priorCampaign.root_script_map,
      validation_status: authorizedMaxSlice > LEGACY_MAX_SLICE
        ? 'PENDING_EXPANDED_IMPLEMENTATION'
        : priorCampaign.root_script_map.validation_status,
    },
    campaign_blockers: priorCampaign.campaign_blockers.filter((blocker) => blocker.id !== campaignBlockerId),
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
  const untouchedSlices = expectedSliceKeys(LEGACY_MAX_SLICE - 3)
    .every((key) => JSON.stringify(priorCampaign.slices[key]) === JSON.stringify(nextCampaign.slices[key]))
  if (!untouchedSlices) {
    throw stateConflict('blocker-resolution changed one or more protected campaign Slices 1–4')
  }
  return nextCampaign
}
