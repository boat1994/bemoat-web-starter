export const CHILD_SYNC_GATE_ISSUES = Object.freeze([182, 184])

export const CHILD_SYNC_GATE_REQUIREMENTS = Object.freeze({
  issuesMergedAndGreen: CHILD_SYNC_GATE_ISSUES,
  requiresLiveChildStateReconstruction: true,
  requiresFreshChildSyncHandoff: true,
})

export function assertChildSyncGateReady({ issues182Merged = false, issues184Merged = false, liveChildReconstructed = false, freshHandoffIssued = false } = {}) {
  const blockers = []
  if (!issues182Merged) blockers.push('Issue #182 must be merged and green on protected main')
  if (!issues184Merged) blockers.push('Issue #184 must be merged and green on protected main')
  if (!liveChildReconstructed) blockers.push('live child-state reconstruction required')
  if (!freshHandoffIssued) blockers.push('fresh child-sync HANDOFF required')
  if (blockers.length > 0) {
    throw new Error(`child-sync gate blocked: ${blockers.join('; ')}`)
  }
  return true
}

export function resolveChildSyncCommandGate({
  enforce = false,
  issues182Merged = false,
  issues184Merged = false,
  liveChildReconstructed = false,
  freshHandoffIssued = false,
} = {}) {
  if (!enforce) return { enforced: false, allowed: true }
  assertChildSyncGateReady({
    issues182Merged,
    issues184Merged,
    liveChildReconstructed,
    freshHandoffIssued,
  })
  return { enforced: true, allowed: true }
}
