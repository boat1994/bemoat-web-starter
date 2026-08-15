import {
  ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY,
  sameValue,
  validateActiveCorrectionContractIdentity,
} from './active-correction-contract.ts'

function classifiedError(classification, message, details = {}) {
  const error = new Error(`${classification}: ${message}`)
  error.classification = classification
  Object.assign(error, details)
  return error
}

function exactNextAction(issueNumber) {
  return `pnpm run bemoat:agent:issue -- ${issueNumber} --phase correction`
}

export function assertOnlyIdentityMutation(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const allowed = new Set([
    ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY,
    'updated_at',
    'updated_by',
    'next_permitted_action',
  ])
  for (const key of keys) {
    if (allowed.has(key)) continue
    if (!sameValue(before?.[key], after?.[key])) {
      throw classifiedError('STATE_CONFLICT', `adopt-finding changed unrelated managed-state field ${key}`)
    }
  }
  for (const key of ['state', 'review_cycle', 'full_review_count', 'last_reviewed_head', 'current_head']) {
    if (!sameValue(before?.[key], after?.[key])) {
      throw classifiedError('STATE_CONFLICT', `adopt-finding must preserve ${key}`)
    }
  }
}

export function buildNextState(state, identity) {
  return {
    ...structuredClone(state),
    [ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]: identity,
    next_permitted_action: exactNextAction(
      String(state.active_task_issue ?? '').match(/#?(\d+)/)?.[1] ?? '',
    ),
    updated_at: new Date().toISOString(),
    updated_by: 'Mission Control adopt-finding',
  }
}

export function isIdenticalCompletedProjection({ state, identity, options, authorization }) {
  const existing = state?.[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY]
  if (!existing) return false
  const validated = validateActiveCorrectionContractIdentity(existing)
  if (!validated.ok) return false
  return (
    String(validated.identity.founder_authorization_comment_id) === String(options.authorizationComment) &&
    String(validated.identity.predecessor_comment_id) === String(options.predecessorComment) &&
    validated.identity.founder_authorization_body_sha256 === authorization.body_sha256 &&
    validated.identity.adoption_head === normalizeSha(options.expectedAdoptionHead) &&
    validated.identity.contract_fingerprint === identity.contract_fingerprint &&
    sameValue(validated.identity.contract, identity.contract)
  )
}

function normalizeSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null
}
