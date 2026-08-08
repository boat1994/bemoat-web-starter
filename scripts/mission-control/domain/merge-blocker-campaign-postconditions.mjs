export function blockerResolutionCampaignPostconditions(campaign, campaignBlockerId, durableNextAction) {
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
