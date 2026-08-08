import { createHash } from 'node:crypto'
import { isFounderDispatchHandoffAuthority } from './domain/productive-policy.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sameValue(left, right) {
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

export async function dispatchFounderAuthorizedCorrection({
  readState,
  writeState,
  postHandoff,
  retractHandoff,
  reserveAuthorization,
  releaseAuthorization,
  handoffBody,
  updatedAt = new Date().toISOString(),
  updatedBy = 'Mission Control',
}) {
  const original = await readState()
  const authorization = original?.founder_correction_authorization
  if (original?.state !== 'FOUNDER_AUTHORIZED_CORRECTION' || authorization?.status !== 'authorized') {
    throw new Error('dispatch requires an unconsumed Founder correction authorization')
  }
  if (!/^## (?:HANDOFF|AUTHORIZATION)\s*$/m.test(handoffBody ?? '') || !handoffBody.includes(authorization.authorization_id)) {
    throw new Error('correction HANDOFF must bind the Founder correction authorization identity')
  }
  if (!isFounderDispatchHandoffAuthority({
    isFounderIssued: authorization.authority === 'Founder' && authorization.status === 'authorized',
    isBoundedExecutionInstruction: true,
  })) {
    throw new Error('correction dispatch requires a Founder-issued bounded HANDOFF authority')
  }
  if (typeof reserveAuthorization !== 'function' || typeof releaseAuthorization !== 'function') {
    throw new Error('correction dispatch requires a race-safe authorization reservation')
  }

  const reservation = await reserveAuthorization(authorization, original)
  let handoff = null
  let consumed = null
  let writeAttempted = false
  try {
    if (!sameValue(await readState(), original)) {
      throw new Error('correction dispatch reservation found stale or consumed authority')
    }
    handoff = await postHandoff(handoffBody)
    if (!handoff?.id) throw new Error('correction HANDOFF did not return a comment identifier')
    consumed = {
      ...structuredClone(original),
      state: 'IN_PROGRESS',
      updated_at: updatedAt,
      updated_by: updatedBy,
      founder_correction_authorization: {
        ...structuredClone(authorization),
        schema_version: 2,
        status: 'consumed',
        handoff_comment_id: String(handoff.id),
        handoff_url: handoff.html_url ?? handoff.url ?? null,
        handoff_binding: buildCorrectionHandoffBinding({ authorization, state: original, handoffBody, handoff }),
      },
    }
    writeAttempted = true
    await writeState(consumed)
    if (!sameValue(await readState(), consumed)) {
      throw new Error('correction dispatch verification found a concurrent state change')
    }
    await releaseAuthorization(reservation)
    return { outcome: 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION', state: consumed }
  } catch (error) {
    let live = null
    try { live = await readState() } catch { /* indeterminate state retains reservation */ }
    if (consumed && sameValue(live, consumed)) {
      try { await releaseAuthorization(reservation) } catch { /* consumed state prevents replay */ }
      return { outcome: 'DISPATCHED_FOUNDER_AUTHORIZED_CORRECTION', state: consumed }
    }
    if (handoff && retractHandoff && (!writeAttempted || sameValue(live, original))) {
      try {
        await retractHandoff(handoff)
      } catch (retractError) {
        throw new Error('correction dispatch failed and HANDOFF rollback failed; reservation retained', { cause: retractError })
      }
    }
    if (!writeAttempted || sameValue(live, original)) {
      try { await releaseAuthorization(reservation) } catch { /* retained reservation fails closed */ }
    }
    throw new Error(
      `correction dispatch failed before verified Founder authorization consumption: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
