import { parseCommentMarker } from './transition-identity.mjs'
import {
  headsAlign,
  normalizeAuthorityHead,
  parseRoleCommentBody,
} from './review-verdict-binding.mjs'
import { isFounderDispatchHandoffAuthority } from './domain/productive-policy.mjs'

export function sameValue(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
      )
    }
    return value
  }
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export function policyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function resolveEvidenceHead({ verifiedHead, roleBody = '', comment = null }) {
  return normalizeAuthorityHead(
    verifiedHead ?? parseRoleCommentBody(comment?.body ?? roleBody).headSha,
  )
}

export function hasUnchangedReviewedHead({ prior, verifiedHead, roleBody = '', comment = null }) {
  const liveHead = resolveEvidenceHead({ verifiedHead, roleBody, comment })
  const reviewedHead = normalizeAuthorityHead(prior?.last_reviewed_head ?? prior?.current_head)
  return Boolean(liveHead && reviewedHead && liveHead === reviewedHead)
}

export function derivesResolvedMaterialBlocker({ prior = {}, projected = {} }) {
  const priorReason = prior.materialBlockerReason ?? prior.material_blocker_reason ?? null
  const projectedReason = projected?.materialBlockerReason ?? projected?.material_blocker_reason ?? null
  if (priorReason && !projectedReason) return true

  const priorBlockers = Array.isArray(prior.open_blockers) ? prior.open_blockers : []
  const projectedBlockers = Array.isArray(projected.open_blockers) ? projected.open_blockers : []
  return priorBlockers.some((blocker) => !projectedBlockers.includes(blocker))
}

export function deriveTransitionFacts({ role, roleBody = '', comment = null, prior = {}, projected = null, policy = {} }) {
  const marker = parseCommentMarker(comment?.body ?? roleBody)
  const evidenceProduced = Boolean(comment?.id != null || (marker && marker === role))
  const stateChanged = projected != null && !sameValue(prior, projected)
  const founderDispatch = policy.founderDispatch
  const founderAuthority = founderDispatch && role === 'HANDOFF' &&
    isFounderDispatchHandoffAuthority(founderDispatch)

  return {
    changesAuthoritativeState: stateChanged,
    producesEvidence: evidenceProduced,
    resolvesMaterialBlocker: projected != null && derivesResolvedMaterialBlocker({ prior, projected }),
    authorizesIrreversibleTransition: Boolean(founderAuthority && policy.authorizesIrreversibleTransition === true),
  }
}

const ROUTING_ONLY_PROJECTION_KEYS = new Set([
  'latest_review_verdict_comment_id',
  'latest_transition_identity',
  'updated_at',
  'updated_by',
])

export function assertRoutingOnlyProjection({ prior = {}, projected = {}, reason = 'routing-only projection' }) {
  const keys = new Set([...Object.keys(prior ?? {}), ...Object.keys(projected ?? {})])
  for (const key of keys) {
    if (!ROUTING_ONLY_PROJECTION_KEYS.has(key) && !sameValue(prior?.[key], projected?.[key])) {
      throw new Error(`STATE_CONFLICT: ${reason} changed ${key}`)
    }
  }
}

export function assertDeltaReviewHeadProjection({ role, prior = {}, projected = {}, reviewType, verifiedHead, roleBody = '', comment = null }) {
  if (role !== 'REVIEW_VERDICT' || reviewType !== 'delta') return

  const liveHead = resolveEvidenceHead({ verifiedHead, roleBody, comment })
  const priorHead = normalizeAuthorityHead(prior.last_reviewed_head ?? prior.current_head)
  if (!liveHead || !priorHead || headsAlign(liveHead, priorHead)) return

  const projectedHead = normalizeAuthorityHead(projected.last_reviewed_head ?? projected.current_head)
  if (!projectedHead || !headsAlign(projectedHead, liveHead) || headsAlign(projectedHead, priorHead)) {
    throw new Error('STATE_CONFLICT: changed-head delta review must replace prior semantic review evidence')
  }
}
