import {
  isBlockerMaterial,
  isDurableRoleCommentJustified,
  isFounderDispatchHandoffAuthority,
  isFullReconstructionPermitted,
  isTransitionProductive,
  limitTransitions,
  requiresDeltaReview,
} from './domain/productive-policy.mjs'
import {
  assertDeltaReviewHeadProjection,
  deriveTransitionFacts,
  hasUnchangedReviewedHead,
  policyObject,
} from './transition-guards.mjs'

const COORDINATOR_ROLE_ACTIONS = {
  HANDOFF: { isDispatch: true },
  RESULT: { isDelivery: true },
  REVIEW_VERDICT: { isIndependentReviewVerdict: true },
}

/**
 * Authoritative Productive-Only gate for coordinator transitions. The result
 * is ephemeral policy evidence; durable state remains owned by the existing
 * projection and CAS transport.
 */
export function authorizeCoordinatorTransition({
  role = null,
  roleBody = '',
  comment = null,
  prior = {},
  projected = null,
  policy: rawPolicy = {},
  verifiedHead = null,
} = {}) {
  const policy = policyObject(rawPolicy)
  const requested = policyObject(policy.transition)
  const transitionWasProvided = Object.keys(requested).length > 0
  const transition = deriveTransitionFacts({ role, roleBody, comment, prior, projected, policy })
  if (transitionWasProvided && !isTransitionProductive(requested)) {
    throw new Error('STATE_CONFLICT: proposed transition is non-productive')
  }
  if (projected != null && requested.changesAuthoritativeState === true && !transition.changesAuthoritativeState) {
    throw new Error('STATE_CONFLICT: proposed state change was not observed in the authoritative projection')
  }
  if (requested.producesEvidence === true && !transition.producesEvidence) {
    throw new Error('STATE_CONFLICT: proposed evidence was not bound to an authoritative role comment')
  }
  if (requested.resolvesMaterialBlocker === true && !transition.resolvesMaterialBlocker) {
    throw new Error('STATE_CONFLICT: proposed material blocker resolution was not observed in the projection')
  }

  const materialBlockerReasons = [
    policy.materialBlockerReason,
    prior.materialBlockerReason,
    prior.material_blocker_reason,
    projected?.materialBlockerReason,
    projected?.material_blocker_reason,
    ...(Array.isArray(prior.open_blockers) ? prior.open_blockers : []),
    ...(Array.isArray(projected?.open_blockers) ? projected.open_blockers : []),
  ].filter((reason) => isBlockerMaterial(reason))
  const blockerReason = materialBlockerReasons[0] ?? null
  const materialRiskReason = policy.materialRiskReason ?? blockerReason ?? requested.materialRiskReason ?? null
  if (blockerReason && !transition.resolvesMaterialBlocker) {
    throw new Error(`STATE_CONFLICT: material blocker ${blockerReason} must remain blocking until resolved`)
  }
  const transitionHistory = prior.transition_history ?? prior.transitionHistory ?? policy.transitionHistory
  if (
    transitionHistory &&
    !limitTransitions(transitionHistory) &&
    !isBlockerMaterial(materialRiskReason)
  ) {
    throw new Error('STATE_CONFLICT: transition budget exceeded without a recognized material-risk reason')
  }

  const durableAction = policy.durableAction ?? COORDINATOR_ROLE_ACTIONS[role] ?? {}
  const durableRoleCommentJustified = isDurableRoleCommentJustified(durableAction)
  if (policy.requiresDurableRoleComment === true && !durableRoleCommentJustified) {
    throw new Error('STATE_CONFLICT: durable role comment is not justified by a productive action')
  }

  const founderDispatch = policy.founderDispatch ?? null
  let dispatchMode = null
  if (founderDispatch) {
    if (role !== 'HANDOFF' || !isFounderDispatchHandoffAuthority(founderDispatch)) {
      throw new Error('STATE_CONFLICT: Founder dispatch must be a bounded HANDOFF authority')
    }
    dispatchMode = 'FOUNDER_BOUNDED_HANDOFF'
  }

  const correction = policy.correction ?? {}
  const reviewType = policy.reviewType ?? (Number(prior?.review_cycle ?? 0) > 0 ? 'delta' : 'full')
  const unchangedPrHead = hasUnchangedReviewedHead({
    prior,
    verifiedHead,
    roleBody,
    comment,
  })
  const deltaReviewRequired = requiresDeltaReview(correction, { hasUnchangedPrHead: unchangedPrHead })
  if (deltaReviewRequired && reviewType !== 'delta') {
    throw new Error('STATE_CONFLICT: metadata-only correction requires delta verification')
  }

  const reconstructionContext = policy.reconstructionContext ?? {}
  const fullReconstructionPermitted = isFullReconstructionPermitted(reconstructionContext)
  if (policy.requiresFullReconstruction === true && !fullReconstructionPermitted) {
    throw new Error('STATE_CONFLICT: full reconstruction requires a material coordination reason')
  }
  if (deltaReviewRequired && policy.requiresFullReconstruction === true) {
    throw new Error('STATE_CONFLICT: metadata-only correction requires delta verification, not reconstruction')
  }
  if (deltaReviewRequired && role === 'HANDOFF') {
    throw new Error('STATE_CONFLICT: metadata-only correction does not require a new HANDOFF')
  }

  if (!isTransitionProductive(transition)) {
    throw new Error('STATE_CONFLICT: proposed transition is non-productive')
  }

  if (projected != null) {
    assertDeltaReviewHeadProjection({
      role,
      prior,
      projected,
      reviewType,
      verifiedHead,
      roleBody,
      comment,
    })
  }

  return {
    productive: true,
    transition,
    verificationMode: reviewType === 'delta' ? 'delta' : 'full',
    preserveSemanticEvidence: deltaReviewRequired,
    fullReconstructionPermitted,
    dispatchMode,
    ...(dispatchMode
      ? {
        requiresPreparation: false,
        requiresReadinessReview: false,
        requiresSecondAuthorization: false,
      }
      : {}),
  }
}
