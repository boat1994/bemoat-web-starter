import { parseMissionControlState } from './task-state.ts'
import { parseCorrectionContract } from './correction-contract.ts'
import {
  fingerprintCorrectionContract,
  hashExactBody,
} from './correction-contract-fingerprint.mjs'

type RuntimeObject = { [key: string]: unknown }
type CorrectionContract = RuntimeObject & { findings: RuntimeObject[] }
type ActiveCorrectionContractIdentity = RuntimeObject & { contract: CorrectionContract }
type ParseContractResult =
  | { ok: true; contract: CorrectionContract }
  | { ok: false; errors: string[] }

const ACTIVE_CORRECTION_CONTRACT_REQUIRED_FIELDS = [
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
] as const

export const ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY = 'active_correction_contract_identity'
export const ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION = 1
export const ACTIVE_CORRECTION_CONTRACT_KIND = 'founder-adopted-finding'

function isRuntimeObject(value: unknown): value is RuntimeObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwnProperty(value: unknown, key: string): boolean {
  return value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    Object.hasOwn(value, key)
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return Reflect.get(value, key)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isCorrectionContract(value: unknown): value is CorrectionContract {
  return isRuntimeObject(value) && Array.isArray(value.findings) && value.findings.every(isRuntimeObject)
}

function parseContractResult(value: unknown): ParseContractResult {
  if (!isRuntimeObject(value)) return { ok: false, errors: ['correction contract parser returned an invalid result'] }
  if (value.ok === true && isCorrectionContract(value.contract)) {
    return { ok: true, contract: value.contract }
  }
  return {
    ok: false,
    errors: isStringArray(value.errors) ? value.errors : ['correction contract is invalid'],
  }
}

function cloneRuntimeObject(value: RuntimeObject): RuntimeObject {
  const clone: unknown = structuredClone(value)
  return isRuntimeObject(clone) ? clone : {}
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
  }
  if (Array.isArray(right)) return false
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameValue(Reflect.get(left, key), Reflect.get(right, key)))
  }
  return false
}

/**
 * Build the append-only reconciled contract from predecessor findings + one adopted finding.
 */
export function buildReconciledCorrectionContract({
  predecessorContract,
  adoptedFinding,
}: {
  predecessorContract: unknown
  adoptedFinding: unknown
}): { ok: true; contract: CorrectionContract } | { ok: false; errors: string[] } {
  if (!isRuntimeObject(predecessorContract)) {
    return { ok: false, errors: ['predecessor correction contract is required'] }
  }
  if (!Array.isArray(predecessorContract.findings) || predecessorContract.findings.length === 0) {
    return { ok: false, errors: ['predecessor findings are required'] }
  }
  if (!isRuntimeObject(adoptedFinding)) {
    return { ok: false, errors: ['adopted finding is required'] }
  }
  if (typeof adoptedFinding.id !== 'string' || !adoptedFinding.id.trim()) {
    return { ok: false, errors: ['adopted finding id is required'] }
  }
  const predecessorIds = new Set(predecessorContract.findings.map((finding) => (
    isRuntimeObject(finding) ? finding.id : undefined
  )))
  if (predecessorIds.has(adoptedFinding.id)) {
    return { ok: false, errors: [`adopted finding ${adoptedFinding.id} already exists in the predecessor contract`] }
  }

  const contract: CorrectionContract = {
    schema_version: predecessorContract.schema_version,
    mode: predecessorContract.mode ?? 'implementation_pr',
    reviewed_head: predecessorContract.reviewed_head,
    findings: [
      ...predecessorContract.findings.map((finding) => (
        isRuntimeObject(finding) ? cloneRuntimeObject(finding) : {}
      )),
      cloneRuntimeObject(adoptedFinding),
    ],
  }
  return { ok: true, contract }
}

export function validateActiveCorrectionContractIdentity(
  identity: unknown,
): { ok: true; identity: ActiveCorrectionContractIdentity } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRuntimeObject(identity)) {
    return { ok: false, errors: ['active correction-contract identity must be an object'] }
  }
  if (identity.schema_version !== ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION) {
    errors.push(`active correction-contract identity schema_version must be ${ACTIVE_CORRECTION_CONTRACT_SCHEMA_VERSION}`)
  }
  if (identity.kind !== ACTIVE_CORRECTION_CONTRACT_KIND) {
    errors.push(`active correction-contract identity kind must be ${ACTIVE_CORRECTION_CONTRACT_KIND}`)
  }
  for (const key of ACTIVE_CORRECTION_CONTRACT_REQUIRED_FIELDS) {
    if (typeof identity[key] !== 'string' || !identity[key].trim()) {
      errors.push(`active correction-contract identity.${key} must be a non-empty string`)
    }
  }
  if (identity.non_superseded !== true) {
    errors.push('active correction-contract identity.non_superseded must be true')
  }
  if (!Number.isInteger(identity.task_issue) || Number(identity.task_issue) < 1) {
    errors.push('active correction-contract identity.task_issue must be a positive integer')
  }
  if (!Number.isInteger(identity.pr) || Number(identity.pr) < 1) {
    errors.push('active correction-contract identity.pr must be a positive integer')
  }
  let contractResult: ParseContractResult
  if (identity.contract) {
    contractResult = parseContractResult(parseCorrectionContract(`\`\`\`json\n${JSON.stringify(identity.contract)}\n\`\`\``))
  } else {
    contractResult = { ok: false, errors: ['active correction-contract identity.contract is required'] }
  }
  if (contractResult.ok === false) {
    errors.push(...(contractResult.errors.length > 0 ? contractResult.errors : ['active correction-contract identity.contract is invalid']))
  } else {
    const fingerprint = fingerprintCorrectionContract(contractResult.contract)
    if (identity.contract_fingerprint !== fingerprint) {
      errors.push('active correction-contract identity.contract_fingerprint does not match the embedded contract')
    }
    const normalizedIdentity: ActiveCorrectionContractIdentity = {
      ...identity,
      contract: contractResult.contract,
    }
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, identity: normalizedIdentity }
  }
  return { ok: false, errors }
}

type ResolveInput = {
  issueBody?: string
  managedState?: unknown
  latestCorrectionVerdictBody?: string | null
}

type ResolveResult =
  | {
      ok: true
      source: 'active_correction_contract_identity' | 'review_verdict'
      contract: CorrectionContract
      identity: ActiveCorrectionContractIdentity | null
    }
  | { ok: false; errors: string[] }

/**
 * Resolve the authoritative correction contract.
 * Prefer an active Founder-adopted identity when present; otherwise fall back to
 * the latest CORRECTION REQUIRED REVIEW_VERDICT contract.
 */
export function resolveAuthoritativeCorrectionContract({
  issueBody = '',
  managedState = null,
  latestCorrectionVerdictBody = null,
}: ResolveInput = {}): ResolveResult {
  let state: unknown = managedState
  if (!state && issueBody) {
    const parsed: unknown = parseMissionControlState(issueBody)
    if (isRuntimeObject(parsed) && parsed.present === true && parsed.valid === true) state = parsed.state
  }

  if (hasOwnProperty(state, ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY)) {
    const validated = validateActiveCorrectionContractIdentity(
      readProperty(state, ACTIVE_CORRECTION_CONTRACT_IDENTITY_KEY),
    )
    if (validated.ok === false) return { ok: false, errors: validated.errors }
    return {
      ok: true,
      source: 'active_correction_contract_identity',
      contract: validated.identity.contract,
      identity: validated.identity,
    }
  }

  if (typeof latestCorrectionVerdictBody === 'string' && latestCorrectionVerdictBody.trim()) {
    const parsed = parseContractResult(parseCorrectionContract(latestCorrectionVerdictBody))
    if (parsed.ok === false) return { ok: false, errors: parsed.errors }
    return {
      ok: true,
      source: 'review_verdict',
      contract: parsed.contract,
      identity: null,
    }
  }

  return { ok: false, errors: ['no authoritative correction contract is available'] }
}

export function reconstructDeltaReviewFindingUnion(
  input: ResolveInput = {},
): { ok: true; finding_ids: string[]; contract: CorrectionContract; source: string } | { ok: false; errors: string[] } {
  const resolved = resolveAuthoritativeCorrectionContract(input)
  if (resolved.ok === false) return resolved
  return {
    ok: true,
    source: resolved.source,
    contract: resolved.contract,
    finding_ids: resolved.contract.findings.map((finding) => String(finding.id)),
  }
}

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
}: {
  predecessorCommentId: unknown
  predecessorBody: unknown
  predecessorContract: CorrectionContract
  founderAuthorizationCommentId: unknown
  founderAuthorizationBody: unknown
  founderAuthorLogin: string
  adoptionHead: unknown
  repository: string
  taskIssue: unknown
  pr: unknown
  base: string
  baseSha: unknown
  adoptedFinding: RuntimeObject & { id: string }
  authorizationId: string
  contract: CorrectionContract
}): ActiveCorrectionContractIdentity {
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
