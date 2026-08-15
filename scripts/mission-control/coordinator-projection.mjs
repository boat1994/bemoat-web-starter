import {
  headsAlign,
  normalizeAuthorityHead,
  parseRoleCommentBody,
} from './review-verdict-binding.mjs'
import { populateOrPreservePlanningAuthorizationBaseSha } from './domain/task-state.ts'
import { serializeTransitionIdentity } from './transition-identity.mjs'

const COORDINATOR_OWNED_LINEAGE_KEYS = Object.freeze([
  'latest_handoff_comment_id',
  'latest_result_comment_id',
  'latest_review_verdict_comment_id',
  'latest_transition_identity',
])

export function coordinatorOwnedProjection({ prior = {}, base = {}, identity, comment, role }) {
  const owned = {
    ...structuredClone(prior ?? {}),
    ...structuredClone(base ?? {}),
  }

  // Callers may propose domain state, counters, and heads, but they cannot
  // manufacture comment lineage. Preserve the durable prior values first and
  // let the coordinator replace only the field owned by this role transition.
  for (const key of COORDINATOR_OWNED_LINEAGE_KEYS) {
    if (Object.hasOwn(prior ?? {}, key)) owned[key] = prior[key]
    else delete owned[key]
  }

  if (role === 'REVIEW_VERDICT') {
    for (const key of ['review_cycle', 'full_review_count']) {
      if (Number.isInteger(prior?.[key]) &&
          (!Number.isInteger(owned[key]) || owned[key] < prior[key])) {
        owned[key] = prior[key]
      }
    }
    const commentHead = parseRoleCommentBody(comment?.body ?? '').headSha
    const normalizedCommentHead = normalizeAuthorityHead(commentHead)
    const knownHead = normalizeAuthorityHead(base?.last_reviewed_head ?? base?.current_head ?? null)
    const reviewedHead = normalizedCommentHead && knownHead?.length === 40 &&
      normalizedCommentHead.length < 40 && headsAlign(normalizedCommentHead, knownHead)
      ? knownHead
      : (normalizedCommentHead ?? knownHead)
    if (reviewedHead) {
      owned.current_head = reviewedHead
      owned.last_reviewed_head = reviewedHead
    }
  }

  owned.latest_transition_identity = serializeTransitionIdentity(identity)
  if (role === 'HANDOFF') {
    owned.latest_handoff_comment_id = comment?.id != null ? String(comment.id) : null
  } else if (role === 'RESULT') {
    owned.latest_result_comment_id = comment?.id != null ? String(comment.id) : null
  } else if (role === 'REVIEW_VERDICT') {
    owned.latest_review_verdict_comment_id = comment?.id != null ? String(comment.id) : null
  }

  return owned
}

export function coordinatorOwnedRoutingProjection({
  identity,
  comment,
  role,
  updatedAt,
  updatedBy,
  base,
  prior,
  planningAuthorizationBaseSha,
  preserveState = false,
}) {
  const target = (comment?.body ?? '').match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  let owned = {
    ...coordinatorOwnedProjection({ prior, base, identity, comment, role }),
    latest_transition_identity: serializeTransitionIdentity(identity),
    updated_at: updatedAt ?? new Date().toISOString(),
    updated_by: updatedBy ?? 'Mission Control',
  }
  if (role === 'HANDOFF') {
    if (!preserveState) owned.state = 'IN_PROGRESS'
    owned.next_permitted_action = target
      ? (preserveState ? (owned.next_permitted_action ?? `${target} executes the authorized HANDOFF; do not re-post HANDOFF.`) : `${target} executes the authorized HANDOFF; do not re-post HANDOFF.`)
      : (preserveState ? (owned.next_permitted_action ?? 'Worker executes the authorized HANDOFF; do not re-post HANDOFF.') : 'Worker executes the authorized HANDOFF; do not re-post HANDOFF.')

    // planning_authorization_base_sha is ancestry authority for planning_no_pr only.
    // It is never derived from guide_source_sha (policy provenance at HANDOFF time).
    // Authoritative sources: explicit integrateHandoff seam, or durable state already set
    // when Mission Control authorized the planning branch from that exact commit.
    if (owned.workflow_mode === 'planning_no_pr') {
      const lineageSha = planningAuthorizationBaseSha ?? owned.planning_authorization_base_sha
      if (lineageSha == null || lineageSha === '') {
        throw new Error(
          'STATE_CONFLICT: planning_no_pr HANDOFF requires explicit planning_authorization_base_sha ancestry authority',
        )
      }
      const populated = populateOrPreservePlanningAuthorizationBaseSha(owned, lineageSha)
      if (!populated.ok) {
        throw new Error(`STATE_CONFLICT: ${populated.reason}`)
      }
      owned = populated.state
    }
  }
  return owned
}

export function routingDriftClassification({ prior = {}, identity, comment, role }) {
  const expectedIdentity = serializeTransitionIdentity(identity)
  const expectedId = comment?.id != null ? String(comment.id) : null
  const key = role === 'HANDOFF'
    ? 'latest_handoff_comment_id'
    : role === 'RESULT'
      ? 'latest_result_comment_id'
      : role === 'REVIEW_VERDICT'
        ? 'latest_review_verdict_comment_id'
        : null
  if (!key) return null
  if (String(prior?.[key] ?? '') !== String(expectedId ?? '') ||
      prior?.latest_transition_identity !== expectedIdentity) {
    return 'REPAIRABLE_DRIFT'
  }
  return null
}
