export const MATERIAL_BLOCKER_REASONS = new Set([
  'MISSING_AUTHORITY',
  'CONFLICTING_AUTHORITY',
  'PROTECTED_BASE_DRIFT',
  'PR_HEAD_DRIFT',
  'MISSING_REQUIRED_CI',
  'FAILING_REQUIRED_CI',
  'MISSING_REVIEW_EVIDENCE',
  'DURABLE_STATE_CONFLICT',
  'MATERIAL_SCOPE_EXPANSION',
  'SECURITY_BOUNDARY_CHANGE',
  'TRUST_BOUNDARY_CHANGE',
  'DEPLOYMENT_REQUIRED',
  'MIGRATION_REQUIRED',
  'PRODUCTION_DATA_MUTATION',
  'IRREVERSIBLE_ACTION',
])

export function isBlockerMaterial(blockerReason) {
  return MATERIAL_BLOCKER_REASONS.has(blockerReason)
}

export function isTransitionProductive(proposedTransition) {
  return (
    proposedTransition.changesAuthoritativeState === true ||
    proposedTransition.producesEvidence === true ||
    proposedTransition.resolvesMaterialBlocker === true ||
    proposedTransition.authorizesIrreversibleTransition === true
  )
}

export function isFullReconstructionPermitted(context) {
  return (
    context.isNewCoordinationSession === true ||
    context.hasProtectedBaseDrift === true ||
    context.hasPrHeadDrift === true ||
    context.hasNewEvidence === true ||
    context.hasDurableStateConflict === true ||
    context.isImmediatelyBeforeIrreversibleOperation === true
  )
}

export function isDurableRoleCommentJustified(action) {
  return (
    action.isDispatch === true ||
    action.isDelivery === true ||
    action.isIndependentReviewVerdict === true ||
    action.requiresFounderAuthority === true ||
    action.isStateConflictDiscovery === true ||
    action.isTerminalTransition === true
  )
}

export function requiresDeltaReview(correction, context) {
  return correction.isMetadataOnly === true && context.hasUnchangedPrHead === true
}

export function isFounderDispatchHandoffAuthority(dispatch) {
  return (
    dispatch.isFounderIssued === true &&
    dispatch.isBoundedExecutionInstruction === true
  )
}

export function limitTransitions(history) {
  return (
    history.handoffCount <= 1 &&
    history.initialResultCount <= 1 &&
    history.reviewVerdictCount <= 1 &&
    history.correctionResultCount <= history.blockingReviewCount &&
    history.founderDecisionCount <= 1 &&
    history.terminalMergeResultCount <= 1
  )
}
