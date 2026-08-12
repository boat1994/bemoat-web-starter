import { parseMissionControlState } from './task-state.mjs'
import { parseCorrectionContract } from './correction-contract.mjs'
import {
  fingerprintCorrectionContract,
  hashExactBody,
} from './correction-contract-fingerprint.mjs'

export const ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY = 'active_correction_contract_identity'
export const ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION = 1
export const ACTIVE_CORRECTION_CONTRACT_KIND = 'founder-adopted-finding'

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameValue(left, right) {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
  }
  if (Array.isArray(right)) return false
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]))
  }
  return false
}

/**
 * Build the append-only reconciled contract from predecessor findings + one adopted finding.
 *
 * @param {{
 *   predecessorContract: object,
 *   adoptedFinding: object,
 * }} input
 * @returns {{ ok: true, contract: object } | { ok: false, errors: string[] }}
 */
export function buildReconciledCorrectionContract({ predecessorContract, adoptedFinding }) {
  if (!predecessorContract || typeof predecessorContract !== 'object' || Array.isArray(predecessorContract)) {
    return { ok: false, errors: ['predecessor correction contract is required'] }
  }
  if (!Array.isArray(predecessorContract.findings) || predecessorContract.findings.length === 0) {
    return { ok: false, errors: ['predecessor findings are required'] }
  }
  if (!adoptedFinding || typeof adoptedFinding !== 'object' || Array.isArray(adoptedFinding)) {
    return { ok: false, errors: ['adopted finding is required'] }
  }
  if (typeof adoptedFinding.id !== 'string' || !adoptedFinding.id.trim()) {
    return { ok: false, errors: ['adopted finding id is required'] }
  }
  const predecessorIds = new Set(predecessorContract.findings.map((finding) => finding.id))
  if (predecessorIds.has(adoptedFinding.id)) {
    return { ok: false, errors: [`adopted finding ${adoptedFinding.id} already exists in the predecessor contract`] }
  }

  const contract = {
    schema_version: predecessorContract.schema_version,
    mode: predecessorContract.mode ?? 'implementation_pr',
    reviewed_head: predecessorContract.reviewed_head,
    findings: [
      ...predecessorContract.findings.map((finding) => structuredClone(finding)),
      structuredClone(adoptedFinding),
    ],
  }
  return { ok: true, contract }
}

/**
 * @param {unknown} identity
 * @returns {{ ok: true, identity: object } | { ok: false, errors: string[] }}
 */
export function validateActiveCorrectionContractIdentity(identity) {
  const errors = []
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    return { ok: false, errors: ['active correction-contract identity must be an object'] }
  }
  if (identity.schema_version !== ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION) {
    errors.push(`active correction-contract identity schema_version must be ${ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION}`)
  }
  if (identity.kind !== ACTIVE_CORRECTION_CONTRACT_KIND) {
    errors.push(`active correction-contract identity kind must be ${ACTIVE_CORRECTION_CONTRACT_KIND}`)
  }
  for (const key of [
    'predecessor_comment_id',
    'predecessor_body_sha256',
    'predecessor_contract_fingerprint',
    'founder_authorization_comment_id',
    'founder_authorization_body_sha256',
    'founder_author_login',
    'adoption_head',
    'reviewed_head',
    'repository',
    'base',
    'base_sha',
    'contract_fingerprint',
    'adopted_finding_id',
    'authorization_id',
  ]) {
    if (typeof identity[key] !== 'string' || !identity[key].trim()) {
      errors.push(`active correction-contract identity.${key} must be a non-empty string`)
    }
  }
  if (identity.non_superseded !== true) {
    errors.push('active correction-contract identity.non_superseded must be true')
  }
  if (!Number.isInteger(identity.task_issue) || identity.task_issue < 1) {
    errors.push('active correction-contract identity.task_issue must be a positive integer')
  }
  if (!Number.isInteger(identity.pr) || identity.pr < 1) {
    errors.push('active correction-contract identity.pr must be a positive integer')
  }
  const contractResult = identity.contract
    ? parseCorrectionContract(`\`\`\`json\n${JSON.stringify(identity.contract)}\n\`\`\``)
    : { ok: false, errors: ['active correction-contract identity.contract is required'] }
  if (!contractResult.ok) {
    errors.push(...(contractResult.errors ?? ['active correction-contract identity.contract is invalid']))
  } else {
    const fingerprint = fingerprintCorrectionContract(contractResult.contract)
    if (identity.contract_fingerprint !== fingerprint) {
      errors.push('active correction-contract identity.contract_fingerprint does not match the embedded contract')
    }
    identity = { ...identity, contract: contractResult.contract }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, identity }
}

/**
 * Resolve the authoritative correction contract.
 * Prefer an active Founder-adopted identity when present; otherwise fall back to
 * the latest CORRECTION REQUIRED REVIEW_VERDICT contract.
 *
 * @param {{
 *   issueBody?: string,
 *   managedState?: object | null,
 *   latestCorrectionVerdictBody?: string | null,
 * }} input
 * @returns {{
 *   ok: true,
 *   source: 'active_correction_contract_identity' | 'review_verdict',
 *   contract: object,
 *   identity: object | null,
 * } | { ok: false, errors: string[] }}
 */
export function resolveAuthoritativeCorrectionContract({
  issueBody = '',
  managedState = null,
  latestCorrectionVerdictBody = null,
} = {}) {
  let state = managedState
  if (!state && issueBody) {
    const parsed = parseMissionControlState(issueBody)
    if (parsed.present && parsed.valid) state = parsed.state
  }

  if (state && Object.hasOwn(state, ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY)) {
    const validated = validateActiveCorrectionContractIdentity(state[ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY])
    if (!validated.ok) return { ok: false, errors: validated.errors }
    return {
      ok: true,
      source: 'active_correction_contract_identity',
      contract: validated.identity.contract,
      identity: validated.identity,
    }
  }

  if (typeof latestCorrectionVerdictBody === 'string' && latestCorrectionVerdictBody.trim()) {
    const parsed = parseCorrectionContract(latestCorrectionVerdictBody)
    if (!parsed.ok) return { ok: false, errors: parsed.errors }
    return {
      ok: true,
      source: 'review_verdict',
      contract: parsed.contract,
      identity: null,
    }
  }

  return { ok: false, errors: ['no authoritative correction contract is available'] }
}

/**
 * Delta Review reconstruction of the reconciled finding union.
 *
 * @param {Parameters<typeof resolveAuthoritativeCorrectionContract>[0]} input
 * @returns {{ ok: true, finding_ids: string[], contract: object, source: string } | { ok: false, errors: string[] }}
 */
export function reconstructDeltaReviewFindingUnion(input = {}) {
  const resolved = resolveAuthoritativeCorrectionContract(input)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    source: resolved.source,
    contract: resolved.contract,
    finding_ids: resolved.contract.findings.map((finding) => finding.id),
  }
}

/**
 * Build the durable active correction-contract identity object.
 *
 * @param {object} input
 * @returns {object}
 */
export function buildActiveCorrectionContractIdentity({
  predecessorCommentId,
  predecessorBody,
  predecessorContract,
  founderAuthorizationCommentId,
  founderAuthorizationBody,
  founderAuthorLogin,
  adoptionHead,
  repository,
  taskIssue,
  pr,
  base,
  baseSha,
  adoptedFinding,
  authorizationId,
  contract,
}) {
  const predecessorBodySha = hashExactBody(predecessorBody)
  const predecessorFingerprint = fingerprintCorrectionContract(predecessorContract)
  const contractFingerprint = fingerprintCorrectionContract(contract)
  return {
    schema_version: ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION,
    kind: ACTIVE_CORRECTION_CONTRACT_KIND,
    predecessor_comment_id: String(predecessorCommentId),
    predecessor_body_sha256: predecessorBodySha,
    predecessor_contract_fingerprint: predecessorFingerprint,
    founder_authorization_comment_id: String(founderAuthorizationCommentId),
    founder_authorization_body_sha256: hashExactBody(founderAuthorizationBody),
    founder_author_login: founderAuthorLogin,
    non_superseded: true,
    adoption_head: String(adoptionHead).toLowerCase(),
    reviewed_head: String(predecessorContract.reviewed_head).toLowerCase(),
    repository,
    task_issue: Number(taskIssue),
    pr: Number(pr),
    base,
    base_sha: String(baseSha).toLowerCase(),
    contract_fingerprint: contractFingerprint,
    adopted_finding_id: adoptedFinding.id,
    authorization_id: authorizationId,
    contract: structuredClone(contract),
  }
}
