import { createHash } from 'node:crypto'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

// Retained only as a read/migration compatibility helper. The stateful
// Founder-correction dispatcher and its reservation/write path were retired.
export function buildCorrectionHandoffBinding({ authorization, state, handoffBody, handoff }) {
  const target = handoffBody.match(/^\*\*Target:\*\*\s*(.+?)\s*$/m)?.[1]?.trim()
  if (!target) throw new Error('correction HANDOFF requires an explicit Target binding')
  const payload = {
    schema_version: 1,
    authorization_snapshot: {
      authorization_id: authorization.authorization_id,
      authority: authorization.authority,
      status: authorization.status,
      action: authorization.action,
      authorized_at: authorization.authorized_at,
      scope: authorization.scope,
      for_review_number: authorization.for_review_number,
      reviewed_head: authorization.reviewed_head,
      finding_ids: [...authorization.finding_ids],
    },
    authorization_id: authorization.authorization_id,
    target,
    active_pr: state.active_pr,
    exact_head: state.current_head,
    correction_base: authorization.reviewed_head,
    review_number: authorization.for_review_number,
    scope: authorization.scope,
    finding_ids: [...authorization.finding_ids],
    handoff_comment_id: String(handoff.id),
    handoff_created_at: handoff.created_at ?? handoff.createdAt ?? null,
    handoff_updated_at: handoff.updated_at ?? handoff.updatedAt ?? null,
    content_sha256: sha256(handoffBody),
  }
  return { ...payload, binding_sha256: sha256(JSON.stringify(payload)) }
}
