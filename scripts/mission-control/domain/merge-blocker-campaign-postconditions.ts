type CampaignBlocker = {
  id?: unknown
} | null

type CampaignSlice = {
  blocker_ids?: unknown[] | null
  status?: unknown
}

type Campaign = {
  campaign_issue?: unknown
  campaign_lifecycle?: unknown
  campaign_blockers?: CampaignBlocker[] | null
  slices?: Record<string, CampaignSlice> | null
}

type CampaignPostconditions = {
  campaign_issue: unknown
  lifecycle: unknown
  blocker_ids: unknown[]
  unrelated_blockers: unknown[]
  slice_keys: string[]
  slices: Record<string, CampaignSlice>
  slice5_status: unknown
  next_action: unknown
  durable_next_action: unknown
}

export function blockerResolutionCampaignPostconditions(
  campaign: Campaign | null | undefined,
  campaignBlockerId: unknown,
  durableNextAction: unknown,
): CampaignPostconditions {
  const blockerIds = [
    ...(campaign?.campaign_blockers ?? []).map((blocker) => blocker?.id),
    ...Object.values(campaign?.slices ?? {})
      .flatMap((slice) => Array.isArray(slice?.blocker_ids) ? slice.blocker_ids : []),
  ].filter(Boolean)
  return {
    campaign_issue: campaign?.campaign_issue,
    lifecycle: campaign?.campaign_lifecycle,
    blocker_ids: blockerIds.filter((id) => id === campaignBlockerId),
    unrelated_blockers: blockerIds.filter((id) => id !== campaignBlockerId),
    slice_keys: Object.keys(campaign?.slices ?? {}),
    slices: structuredClone(campaign?.slices ?? {}),
    slice5_status: campaign?.slices?.['5']?.status,
    next_action: durableNextAction,
    durable_next_action: durableNextAction,
  }
}
