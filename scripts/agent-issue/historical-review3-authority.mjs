import { createHash } from 'node:crypto'
import { findLatestRoleComment } from '../mission-control-reconcile.mjs'
import { parseMissionControlState } from '../mission-control-state.mjs'

export function verifyReviewThreeCorrectionAuthorization({ issueBody, contract, comments }) {
  const parsed = parseMissionControlState(issueBody ?? '')
  const managedRequired = /Mission\s+Control\s+mode:\s*required/i.test(issueBody ?? '')
  if (!parsed.present || !parsed.valid || !parsed.state) {
    if (managedRequired || parsed.present) {
      return { ok: false, errors: ['STATE CONFLICT: managed Mission Control state is missing or invalid for correction authorization'] }
    }
    // Unmanaged correction contracts retain their existing path.
    return { ok: true, errors: [], reviewThree: false }
  }
  const state = parsed.state
  const authorization = state.founder_correction_authorization
  const requiresReviewThreeAuthority = Boolean(authorization) || state.review_cycle === 3 ||
    (state.full_review_count === 1 && state.state === 'IN_PROGRESS')
  if (!requiresReviewThreeAuthority) return { ok: true, errors: [], reviewThree: false }
  if (state.review_cycle !== 3 || state.full_review_count !== 1) {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction must preserve counters 3/1'] }
  }
  if (state.state !== 'IN_PROGRESS' || !authorization || authorization.status !== 'consumed') {
    return { ok: false, errors: ['STATE CONFLICT: Review 3 correction requires a consumed Founder correction authorization'] }
  }
  if (authorization.for_review_number !== 3 || authorization.reviewed_head !== contract.reviewed_head ||
      authorization.reviewed_head !== state.last_reviewed_head || authorization.reviewed_head !== state.current_head) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization does not bind the Review 3 exact head'] }
  }
  const authorizedIds = [...authorization.finding_ids ?? []].sort()
  const contractIds = contract.findings.map((finding) => finding.id).sort()
  if (JSON.stringify(authorizedIds) !== JSON.stringify(contractIds)) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization finding IDs do not match the immutable contract'] }
  }
  const latestHandoff = findLatestRoleComment(comments, 'HANDOFF')
  const handoff = comments.find((comment) => String(comment.id) === String(authorization.handoff_comment_id))
  if (!handoff || String(latestHandoff?.comment?.id) !== String(authorization.handoff_comment_id) ||
      !/##\s+HANDOFF\s*$/m.test(handoff.body ?? '') || !(handoff.body ?? '').includes(authorization.authorization_id)) {
    return { ok: false, errors: ['STATE CONFLICT: Founder correction authorization is not bound to its exact active HANDOFF'] }
  }
  const binding = authorization.handoff_binding
  if (authorization.schema_version === 2) {
    const contentSha256 = createHash('sha256').update(handoff.body ?? '').digest('hex')
    const expectedFields = {
      authorization_snapshot: {
        authorization_id: authorization.authorization_id,
        authority: authorization.authority,
        status: 'authorized',
        action: authorization.action,
        authorized_at: authorization.authorized_at,
        scope: authorization.scope,
        for_review_number: authorization.for_review_number,
        reviewed_head: authorization.reviewed_head,
        finding_ids: authorization.finding_ids,
      },
      authorization_id: authorization.authorization_id,
      active_pr: state.active_pr,
      exact_head: state.current_head,
      correction_base: authorization.reviewed_head,
      review_number: authorization.for_review_number,
      scope: authorization.scope,
      finding_ids: authorization.finding_ids,
      handoff_comment_id: String(authorization.handoff_comment_id),
    }
    const liveTarget = (handoff.body ?? '').match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim() ?? null
    if (!binding || binding.content_sha256 !== contentSha256 ||
        binding.target !== liveTarget ||
        Object.entries(expectedFields).some(([key, value]) => JSON.stringify(binding[key]) !== JSON.stringify(value))) {
      return { ok: false, errors: ['STATE CONFLICT: immutable Founder correction HANDOFF binding does not match live content'] }
    }
    const { binding_sha256: recordedFingerprint, ...payload } = binding
    const actualFingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    if (recordedFingerprint !== actualFingerprint) {
      return { ok: false, errors: ['STATE CONFLICT: immutable Founder correction HANDOFF fingerprint is invalid'] }
    }
    const liveUpdatedAt = handoff.updatedAt ?? handoff.updated_at ?? null
    if (binding.handoff_updated_at !== liveUpdatedAt) {
      return { ok: false, errors: ['STATE CONFLICT: bound Founder correction HANDOFF was edited after dispatch'] }
    }
  }
  return { ok: true, errors: [], reviewThree: true }
}
