import { parseCommentMarker } from './transition-identity.mjs'
import { routingDriftClassification } from './coordinator-projection.mjs'
import { classifyTransition, findMatchingComments } from './comment-evidence.mjs'
import { verifyStatePostcondition } from './state-verification.mjs'
import { sameValue } from './transition-guards.mjs'

/**
 * Transport-backed Coordinator transitions. The facade supplies the
 * coordinator instance so transport, evidence, and policy wiring remain
 * compatible with the existing public API.
 */
export async function integrateHandoff(coordinator, {
  handoffBody,
  transitionState,
  updatedAt,
  updatedBy,
  planningAuthorizationBaseSha,
  policy: rawPolicy = {},
}) {
  if (!/^## (?:HANDOFF|AUTHORIZATION)\s*$/m.test(handoffBody ?? '')) {
    throw new Error('integrateHandoff requires one HANDOFF or AUTHORIZATION role comment')
  }
  const original = await coordinator.readState()
  const planningCorrectionInitialization = original?.state === 'BLOCKED_FOR_FOUNDER_DECISION' &&
    original?.workflow_mode === 'planning_no_pr' &&
    original?.review_cycle === 0 &&
    original?.full_review_count === 0 &&
    original?.active_pr == null &&
    original?.current_head == null &&
    original?.last_reviewed_head == null &&
    original?.founder_decision?.status === 'declined' &&
    /Planning Correction 1 Initialization/i.test(handoffBody)
  if (original?.state !== 'READY' && !planningCorrectionInitialization) {
    throw new Error(`integrateHandoff requires READY, received ${original?.state ?? 'missing state'}`)
  }
  coordinator.authorizeTransition({ role: 'HANDOFF', roleBody: handoffBody, prior: original, policy: rawPolicy })
  const { identity, comment, recovered } = await coordinator._resolveComment(handoffBody, 'HANDOFF')
  const callerProjection = typeof transitionState === 'function'
    ? transitionState(original)
    : (transitionState ?? structuredClone(original))
  const projected = coordinator._coordinatorOwnedRouting({
    identity,
    comment,
    role: 'HANDOFF',
    updatedAt,
    updatedBy,
    base: callerProjection,
    prior: original,
    preserveState: planningCorrectionInitialization,
    planningAuthorizationBaseSha,
  })
  const policy = coordinator.authorizeTransition({
    role: 'HANDOFF',
    roleBody: handoffBody,
    comment,
    prior: original,
    projected,
    policy: rawPolicy,
  })
  const written = await coordinator.writeState(projected, original)
  verifyStatePostcondition(projected, written, [
    'state', 'latest_transition_identity', 'latest_handoff_comment_id', 'next_permitted_action',
  ])
  return {
    outcome: 'DISPATCHED',
    classification: routingDriftClassification({ prior: original, identity, comment, role: 'HANDOFF' }),
    state: written,
    comment,
    identity,
    recovered: Boolean(recovered),
    policy,
  }
}

export async function integrateResult(coordinator, {
  resultBody,
  projectState,
  verifyPreconditions,
  updatedAt,
  updatedBy,
  policy: rawPolicy = {},
}) {
  if (parseCommentMarker(resultBody) !== 'RESULT') {
    throw new Error('integrateResult requires a RESULT role comment')
  }
  if (typeof verifyPreconditions === 'function') await verifyPreconditions()
  const original = await coordinator.readState()
  coordinator.authorizeTransition({ role: 'RESULT', roleBody: resultBody, prior: original, policy: rawPolicy })
  const { identity, comment, created, recovered } = await coordinator._resolveComment(resultBody, 'RESULT')
  const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
  const projected = coordinator._coordinatorOwnedRouting({
    identity,
    comment,
    role: 'RESULT',
    updatedAt,
    updatedBy,
    base: callerProjection,
    prior: original,
  })
  const policy = coordinator.authorizeTransition({
    role: 'RESULT',
    roleBody: resultBody,
    comment,
    prior: original,
    projected,
    policy: rawPolicy,
  })
  try {
    const written = await coordinator.writeState(projected, original)
    verifyStatePostcondition(projected, written)
    return {
      outcome: 'DELIVERED',
      classification: routingDriftClassification({ prior: original, identity, comment, role: 'RESULT' }),
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
        `AMBIGUOUS_RESULT: unable to verify Issue state after RESULT comment and state write: ${
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
    if (sameValue(live, original)) {
      return {
        outcome: 'RECOVERABLE_ROUTING_DRIFT',
        classification: 'REPAIRABLE_DRIFT',
        state: original,
        comment,
        identity,
        recovered: Boolean(recovered),
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (sameValue(live, projected)) {
      verifyStatePostcondition(projected, live)
      return { outcome: 'DELIVERED', state: live, comment, identity, created }
    }
    throw new Error(
      `STATE_CONFLICT: incompatible concurrent authority after comment post: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function resumeProjection(coordinator, { roleBody, role, projectState, planningAuthorizationBaseSha }) {
  const { identity, options } = coordinator._matchOptions(roleBody, role)
  const comments = await coordinator.listComments()
  const matches = findMatchingComments(comments, identity, options)
  const classification = classifyTransition(matches.length)
  if (classification !== 'RESUME_PROJECTION') {
    throw new Error(`${classification}: cannot resume projection`)
  }
  const original = await coordinator.readState()
  const callerProjection = typeof projectState === 'function' ? projectState(original) : projectState
  const projected = coordinator._coordinatorOwnedRouting({
    identity,
    comment: matches[0],
    role,
    base: callerProjection,
    prior: original,
    planningAuthorizationBaseSha,
  })
  const written = await coordinator.writeState(projected, original)
  verifyStatePostcondition(projected, written)
  return { outcome: 'RESUMED', state: written, comment: matches[0], identity }
}

export async function assertCompatibleSnapshot(coordinator, expectedState) {
  const live = await coordinator.readState()
  const incompatibleKeys = ['state', 'active_pr', 'review_cycle', 'full_review_count']
  for (const key of incompatibleKeys) {
    if (expectedState?.[key] !== undefined && !sameValue(live?.[key], expectedState[key])) {
      throw new Error(`STATE_CONFLICT: incompatible concurrent state change on ${key}`)
    }
  }
  return live
}
