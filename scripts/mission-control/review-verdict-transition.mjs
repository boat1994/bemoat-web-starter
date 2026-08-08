import { parseCommentMarker } from './transition-identity.mjs'
import { classifyTransition, findMatchingComments } from './comment-evidence.mjs'
import { routingDriftClassification } from './coordinator-projection.mjs'
import { assertRoutingOnlyProjection } from './transition-guards.mjs'
import { verifyStatePostcondition } from './state-verification.mjs'

/**
 * Execute the Coordinator's routing-only REVIEW_VERDICT transition.
 *
 * The coordinator supplies transport and policy-boundary methods; this module
 * owns the review-verdict orchestration without changing the public facade.
 */
export async function reconcileReviewVerdict(
  coordinator,
  { verdictBody, projectReview, routingOnly = false, policy: rawPolicy = {} },
) {
  if (parseCommentMarker(verdictBody) !== 'REVIEW_VERDICT') {
    throw new Error('reconcileReviewVerdict requires a REVIEW_VERDICT role comment')
  }
  const original = await coordinator.readState()
  const preflightPolicy = coordinator.authorizeTransition({
    role: 'REVIEW_VERDICT',
    roleBody: verdictBody,
    prior: original,
    policy: rawPolicy,
  })
  const { identity, options } = coordinator._matchOptions(verdictBody, 'REVIEW_VERDICT')
  const comments = await coordinator.listComments()
  const matches = findMatchingComments(comments, identity, options)
  const matchClassification = classifyTransition(matches.length)
  if (matchClassification === 'BLOCKED_EXTERNAL') {
    throw new Error('BLOCKED_EXTERNAL: no matching REVIEW_VERDICT evidence')
  }
  if (matchClassification === 'STATE_CONFLICT') {
    throw new Error('STATE_CONFLICT: competing REVIEW_VERDICT comments')
  }
  const projected = coordinator._coordinatorOwnedRouting({
    identity,
    comment: matches[0],
    role: 'REVIEW_VERDICT',
    base: typeof projectReview === 'function' ? projectReview(original) : projectReview,
    prior: original,
  })
  const policy = coordinator.authorizeTransition({
    role: 'REVIEW_VERDICT',
    roleBody: verdictBody,
    comment: matches[0],
    prior: original,
    projected,
    policy: rawPolicy,
  })
  const effectiveRoutingOnly = routingOnly || policy.preserveSemanticEvidence
  if (effectiveRoutingOnly) {
    assertRoutingOnlyProjection({
      prior: original,
      projected,
      reason: 'routing-only REVIEW_VERDICT repair',
    })
  }
  if (
    (projected.review_cycle ?? original.review_cycle) < (original.review_cycle ?? 0) ||
    (projected.full_review_count ?? original.full_review_count) < (original.full_review_count ?? 0)
  ) {
    throw new Error('routing-only repair must not decrease review counters')
  }
  const classification = routingDriftClassification({
    prior: original,
    identity,
    comment: matches[0],
    role: 'REVIEW_VERDICT',
  })
  if (classification === null) {
    const verified = await coordinator.readState()
    verifyStatePostcondition(original, verified, [
      'state',
      'review_cycle',
      'full_review_count',
      'active_pr',
      'current_head',
      'last_reviewed_head',
      'latest_result_comment_id',
      'latest_review_verdict_comment_id',
      'latest_transition_identity',
      'founder_decision',
      'guide_version',
      'guide_source_ref',
      'guide_source_sha',
    ])
    return {
      outcome: 'NO_OP',
      classification: null,
      state: verified,
      comment: matches[0],
      identity,
      policy: preflightPolicy,
    }
  }
  const written = await coordinator.writeState(projected, original)
  verifyStatePostcondition(projected, written, [
    'state',
    'review_cycle',
    'full_review_count',
    'active_pr',
    'current_head',
    'last_reviewed_head',
    'latest_result_comment_id',
    'latest_review_verdict_comment_id',
    'latest_transition_identity',
    'founder_decision',
    'guide_version',
    'guide_source_ref',
    'guide_source_sha',
  ])
  return {
    outcome: 'RECONCILED',
    classification,
    state: written,
    comment: matches[0],
    identity,
    policy,
  }
}
