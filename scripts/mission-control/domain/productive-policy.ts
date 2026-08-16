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
  'DELETION_REQUIRED',
  'IRREVERSIBLE_ACTION',
])

export function isBlockerMaterial(blockerReason: string): boolean {
  return MATERIAL_BLOCKER_REASONS.has(blockerReason)
}

type PolicyInput = Record<string, unknown>

export function isTransitionProductive(proposedTransition: PolicyInput): boolean {
  return (
    proposedTransition.changesAuthoritativeState === true ||
    proposedTransition.producesEvidence === true ||
    proposedTransition.resolvesMaterialBlocker === true ||
    proposedTransition.authorizesIrreversibleTransition === true
  )
}

export function isFullReconstructionPermitted(context: PolicyInput): boolean {
  return (
    context.isNewCoordinationSession === true ||
    context.hasProtectedBaseDrift === true ||
    context.hasPrHeadDrift === true ||
    context.hasNewEvidence === true ||
    context.hasDurableStateConflict === true ||
    context.isImmediatelyBeforeIrreversibleOperation === true
  )
}

export function isDurableRoleCommentJustified(action: PolicyInput): boolean {
  return (
    action.isDispatch === true ||
    action.isDelivery === true ||
    action.isIndependentReviewVerdict === true ||
    action.requiresFounderAuthority === true ||
    action.isStateConflictDiscovery === true ||
    action.isTerminalTransition === true
  )
}

export function requiresDeltaReview(correction: PolicyInput, context: PolicyInput): boolean {
  return correction.isMetadataOnly === true && context.hasUnchangedPrHead === true
}

export function isFounderDispatchHandoffAuthority(dispatch: PolicyInput): boolean {
  return (
    dispatch.isFounderIssued === true &&
    dispatch.isBoundedExecutionInstruction === true
  )
}

type TransitionHistory = {
  handoffCount: number
  initialResultCount: number
  reviewVerdictCount: number
  correctionResultCount: number
  blockingReviewCount: number
  founderDecisionCount: number
  terminalMergeResultCount: number
}

export function limitTransitions(history: TransitionHistory): boolean {
  return (
    history.handoffCount <= 1 &&
    history.initialResultCount <= 1 &&
    history.reviewVerdictCount <= 1 &&
    history.correctionResultCount <= history.blockingReviewCount &&
    history.founderDecisionCount <= 1 &&
    history.terminalMergeResultCount <= 1
  )
}
