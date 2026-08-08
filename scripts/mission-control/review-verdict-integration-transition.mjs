import { parseCommentMarker, serializeTransitionIdentity } from './transition-identity.mjs'
import { findMatchingComments } from './comment-evidence.mjs'
import { routingDriftClassification } from './coordinator-projection.mjs'
import { assertRoutingOnlyProjection, sameValue } from './transition-guards.mjs'
import { verifyStatePostcondition } from './state-verification.mjs'

/**
 * Execute the Coordinator's comment-first REVIEW_VERDICT integration.
 *
 * The coordinator supplies transport and policy-boundary methods; this module
 * owns reviewer completion, replay detection, and recoverable write handling.
 */
export async function integrateReviewVerdict(
  coordinator,
  { verdictBody, projectState, verifyPreconditions, updatedAt, updatedBy, policy: rawPolicy = {} },
) {
  if (parseCommentMarker(verdictBody) !== 'REVIEW_VERDICT') {
    throw new Error('integrateReviewVerdict requires a REVIEW_VERDICT role comment')
  }
  if (typeof verifyPreconditions === 'function') await verifyPreconditions()
  const original = await coordinator.readState()
  const preflightPolicy = coordinator.authorizeTransition({
    role: 'REVIEW_VERDICT',
    roleBody: verdictBody,
    prior: original,
    policy: rawPolicy,
  })

  const { identity: requestedIdentity, options: matchOptions } = coordinator._matchOptions(verdictBody, 'REVIEW_VERDICT')
  const existingComments = await coordinator.listComments()
  const existingMatches = findMatchingComments(existingComments, requestedIdentity, matchOptions)
  const replayCandidate = existingMatches.length === 1 &&
    original?.latest_transition_identity === serializeTransitionIdentity(requestedIdentity) &&
    String(original?.latest_review_verdict_comment_id ?? '') === String(existingMatches[0].id)

  const projectForComment = (candidateComment) => {
    const callerProjection = typeof projectState === 'function'
      ? projectState(original, candidateComment, requestedIdentity)
      : projectState
    return coordinator._coordinatorOwnedRouting({
      identity: requestedIdentity,
      comment: candidateComment,
      role: 'REVIEW_VERDICT',
      base: callerProjection,
      prior: original,
      updatedAt,
      updatedBy: updatedBy ?? 'Reviewer',
    })
  }

  if (!replayCandidate) {
    const prospectiveComment = { id: '__prospective_review_verdict__', body: verdictBody }
    const prospectiveProjected = projectForComment(prospectiveComment)
    const prospectivePolicy = coordinator.authorizeTransition({
      role: 'REVIEW_VERDICT',
      roleBody: verdictBody,
      comment: prospectiveComment,
      prior: original,
      projected: prospectiveProjected,
      policy: rawPolicy,
    })
    if (prospectivePolicy.preserveSemanticEvidence) {
      assertRoutingOnlyProjection({
        prior: original,
        projected: prospectiveProjected,
        reason: 'metadata-only REVIEW_VERDICT projection',
      })
    }
  }

  const { identity, comment, created, recovered } = await coordinator._resolveComment(verdictBody, 'REVIEW_VERDICT')
  const serializedIdentity = serializeTransitionIdentity(identity)
  if (
    original?.latest_transition_identity === serializedIdentity &&
    String(original?.latest_review_verdict_comment_id ?? '') === String(comment.id)
  ) {
    return { outcome: 'REVIEWED', state: original, comment, identity, created: false, replayed: true, policy: preflightPolicy }
  }
  const projected = projectForComment(comment)
  const policy = coordinator.authorizeTransition({
    role: 'REVIEW_VERDICT',
    roleBody: verdictBody,
    comment,
    prior: original,
    projected,
    policy: rawPolicy,
  })
  if (policy.preserveSemanticEvidence) {
    assertRoutingOnlyProjection({
      prior: original,
      projected,
      reason: 'metadata-only REVIEW_VERDICT projection',
    })
  }
  try {
    const written = await coordinator.writeState(projected, original)
    verifyStatePostcondition(projected, written, [
      'state', 'review_cycle', 'full_review_count', 'current_head', 'last_reviewed_head',
      'latest_transition_identity', 'latest_review_verdict_comment_id', 'open_blockers',
    ])
    return {
      outcome: 'REVIEWED',
      classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
      state: written,
      comment,
      identity,
      created,
      recovered: Boolean(recovered),
      policy,
    }
  } catch (error) {
    if (!created) throw error
    let live
    try {
      live = await coordinator.readState()
    } catch (readError) {
      const ambiguous = new Error(
        `AMBIGUOUS_RESULT: unable to verify Issue state after REVIEW_VERDICT comment and state write: ${
          readError instanceof Error ? readError.message : String(readError)
        }`,
        { cause: error },
      )
      ambiguous.classification = 'AMBIGUOUS_RESULT'
      ambiguous.mutationPerformed = true
      if (typeof error?.legacyClassification === 'string') {
        ambiguous.legacyClassification = error.legacyClassification
      }
      throw ambiguous
    }
    if (sameValue(live, projected)) return {
      outcome: 'REVIEWED',
      classification: routingDriftClassification({ prior: original, identity, comment, role: 'REVIEW_VERDICT' }),
      state: live,
      comment,
      identity,
      created,
      recovered: Boolean(recovered),
    }
    if (sameValue(live, original)) {
      return {
        outcome: 'RECOVERABLE_ROUTING_DRIFT',
        classification: 'REPAIRABLE_DRIFT',
        state: original,
        comment,
        identity,
        created,
        recovered: Boolean(recovered),
        error: String(error),
      }
    }
    throw new Error(`STATE_CONFLICT: incompatible concurrent authority after verdict post: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}
