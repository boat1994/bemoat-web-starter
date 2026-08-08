export const CAMPAIGN_PROJECTION_KINDS = Object.freeze({
  SLICE: 'campaign-slice',
  BLOCKER_RESOLUTION: 'blocker-resolution',
})

export function hasMeaningfulBindingValue(value) {
  return value !== null && value !== undefined &&
    !(typeof value === 'string' && value.trim().length === 0)
}

export function resolveCampaignProjectionKind(authorization = {}) {
  const explicitKind = authorization.projection_kind
  const hasBlockerBinding = hasMeaningfulBindingValue(authorization.campaign_blocker_id)

  if (explicitKind == null) {
    if (hasBlockerBinding) {
      return {
        valid: false,
        projectionKind: null,
        reason: 'blocker-resolution requires an explicit projection_kind',
      }
    }
    return { valid: true, projectionKind: CAMPAIGN_PROJECTION_KINDS.SLICE, reason: null }
  }
  if (explicitKind === CAMPAIGN_PROJECTION_KINDS.SLICE) {
    if (hasBlockerBinding) {
      return {
        valid: false,
        projectionKind: null,
        reason: 'campaign-slice projection cannot carry a campaign_blocker_id binding',
      }
    }
    return { valid: true, projectionKind: explicitKind, reason: null }
  }
  if (explicitKind !== CAMPAIGN_PROJECTION_KINDS.BLOCKER_RESOLUTION) {
    return {
      valid: false,
      projectionKind: null,
      reason: `unsupported campaign projection_kind: ${String(explicitKind)}`,
    }
  }
  if (hasMeaningfulBindingValue(authorization.campaign_slice)) {
    return {
      valid: false,
      projectionKind: null,
      reason: 'blocker-resolution projection prohibits campaign_slice',
    }
  }
  return { valid: true, projectionKind: explicitKind, reason: null }
}
