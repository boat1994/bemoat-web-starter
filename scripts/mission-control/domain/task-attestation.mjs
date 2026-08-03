import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export const TASK_ATTESTATION_SCHEMA = 'bemoat-mission-control-task-bootstrap-attestation'
export const TASK_ATTESTATION_OPERATION = 'task-bootstrap'
export const TASK_ATTESTATION_OPERATION_VERSION = 1
export const TASK_ATTESTATION_START = '<!-- bemoat-mission-control-task-attestation:v1 -->'
export const TASK_ATTESTATION_END = '<!-- bemoat-mission-control-task-attestation:end -->'

function fail(message) {
  const error = new Error(message)
  error.code = 'ATTESTATION_INVALID'
  throw error
}

function sortValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical payload cannot contain a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail(`canonical payload cannot contain undefined key ${key}`)
      output[key] = sortValue(value[key])
    }
    return output
  }
  fail(`canonical payload contains unsupported value type ${typeof value}`)
}

/** Deterministic JSON serialization used for every signed Mission Control record. */
export function canonicalSerialize(value) {
  return JSON.stringify(sortValue(value))
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function canonicalHash(value) {
  return sha256Hex(canonicalSerialize(value))
}

function signingInput({ schema, operation, operationVersion, keyId, payload }) {
  return canonicalSerialize({
    attestation_schema: schema,
    key_id: keyId,
    operation,
    operation_version: operationVersion,
    payload,
  })
}

/**
 * Sign a canonical, repository-owned record. The private key is intentionally
 * accepted only at the call boundary so callers can keep it inside a protected
 * Actions environment.
 * @param {{schema?: string, operation?: string, operationVersion?: number, keyId?: string, payload?: unknown, privateKey?: string}} options
 */
export function createSignedEnvelope({
  schema = TASK_ATTESTATION_SCHEMA,
  operation = TASK_ATTESTATION_OPERATION,
  operationVersion = TASK_ATTESTATION_OPERATION_VERSION,
  keyId,
  payload,
  privateKey,
} = {}) {
  if (!keyId || typeof keyId !== 'string') fail('signing key ID is required')
  if (!privateKey || typeof privateKey !== 'string') {
    const error = new Error('protected signing material is unavailable')
    error.code = 'BLOCKED_EXTERNAL'
    throw error
  }
  const normalizedPayload = sortValue(payload)
  const input = signingInput({
    schema,
    operation,
    operationVersion,
    keyId,
    payload: normalizedPayload,
  })
  const signature = sign(null, Buffer.from(input, 'utf8'), createPrivateKey(privateKey))
  return {
    schema_version: 1,
    attestation_schema: schema,
    operation,
    operation_version: operationVersion,
    algorithm: 'Ed25519',
    key_id: keyId,
    payload: normalizedPayload,
    payload_sha256: sha256Hex(input),
    signature_base64: signature.toString('base64'),
  }
}

export function renderSignedEnvelope(envelope, { start, end } = {}) {
  const markerStart = start ?? TASK_ATTESTATION_START
  const markerEnd = end ?? TASK_ATTESTATION_END
  return [markerStart, '```json', JSON.stringify(envelope, null, 2), '```', markerEnd].join('\n')
}

export function parseSignedEnvelope(body = '', { start, end } = {}) {
  const markerStart = start ?? TASK_ATTESTATION_START
  const markerEnd = end ?? TASK_ATTESTATION_END
  const starts = [...String(body).matchAll(new RegExp(escapeRegExp(markerStart), 'g'))]
  const ends = [...String(body).matchAll(new RegExp(escapeRegExp(markerEnd), 'g'))]
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { ok: false, reason: 'exactly one balanced signed-envelope marker pair is required', envelope: null }
  }
  const raw = String(body).slice(starts[0].index + markerStart.length, ends[0].index)
    .replace(/```json\s*|```/g, '').trim()
  try {
    const envelope = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return { ok: false, reason: 'signed envelope must be one JSON object', envelope: null }
    }
    return { ok: true, envelope }
  } catch (error) {
    return { ok: false, reason: `signed envelope is not valid JSON: ${error.message}`, envelope: null }
  }
}

export function parseTaskAttestation(body = '') {
  return parseSignedEnvelope(body)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function validFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function sameIdentity(actual, expected) {
  return actual?.number != null && String(actual.number) === String(expected.number) &&
    (expected.id == null || String(actual?.id) === String(expected.id)) &&
    (expected.node_id == null || String(actual?.node_id) === String(expected.node_id))
}

function bindingFailure(reason) {
  return { ok: false, reason, envelope: null }
}

/**
 * Verify only the generic canonical envelope; domain readers add their own bindings.
 * @param {{schema_version?: number, attestation_schema?: string, operation?: string, operation_version?: number, algorithm?: string, key_id?: string, payload?: unknown, payload_sha256?: string, signature_base64?: string}} envelope
 * @param {{publicKey?: string, expectedSchema?: string, expectedOperation?: string, expectedOperationVersion?: number, signingKeyId?: string, repository?: string}} options
 */
export function verifySignedEnvelope(envelope, {
  publicKey,
  expectedSchema,
  expectedOperation,
  expectedOperationVersion,
  signingKeyId,
  repository,
} = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return bindingFailure('signed envelope is missing')
  if (envelope.schema_version !== 1 || (expectedSchema != null && envelope.attestation_schema !== expectedSchema) ||
      (expectedOperation != null && envelope.operation !== expectedOperation) ||
      (expectedOperationVersion != null && envelope.operation_version !== expectedOperationVersion) ||
      envelope.algorithm !== 'Ed25519' || typeof envelope.key_id !== 'string' || !envelope.key_id ||
      typeof envelope.signature_base64 !== 'string' || !envelope.signature_base64 || !validSha(envelope.payload_sha256)) {
    return bindingFailure('signed envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  if (signingKeyId != null && envelope.key_id !== signingKeyId) return bindingFailure('signed envelope key ID does not match protected configuration')
  if (!publicKey || typeof publicKey !== 'string') return bindingFailure('committed public verification key is unavailable')
  let input
  try {
    input = signingInput({
      schema: envelope.attestation_schema,
      operation: envelope.operation,
      operationVersion: envelope.operation_version,
      keyId: envelope.key_id,
      payload: envelope.payload,
    })
  } catch (error) {
    return bindingFailure(error.message)
  }
  if (sha256Hex(input) !== envelope.payload_sha256) return bindingFailure('signed envelope canonical payload hash does not match')
  try {
    if (!verify(null, Buffer.from(input, 'utf8'), createPublicKey(publicKey), Buffer.from(envelope.signature_base64, 'base64'))) {
      return bindingFailure('signed envelope signature is invalid')
    }
  } catch (error) {
    return bindingFailure(`signed envelope signature could not be verified: ${error.message}`)
  }
  if (repository != null && envelope.payload?.repository !== repository) return bindingFailure('signed envelope repository binding does not match')
  return { ok: true, reason: null, envelope, payload: envelope.payload }
}

/**
 * Verify the complete task binding, not merely the Ed25519 signature. This is
 * the reusable cryptographic gate called by Task creation and managed-task
 * readers.
 */
export function verifyTaskAttestation(envelope, {
  publicKey,
  repository,
  repositoryIdentity,
  protectedBaseSha,
  authorizationCommentId,
  authorizationBodySha256,
  founderLogin,
  parentIssue,
  taskIssue,
  pullRequest,
  expectedHead,
  expectedBase,
  policy,
  requestId,
  expectedWorkflow,
  signingKeyId,
} = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return bindingFailure('attestation envelope is missing')
  if (envelope.schema_version !== 1 || envelope.attestation_schema !== TASK_ATTESTATION_SCHEMA ||
      envelope.operation !== TASK_ATTESTATION_OPERATION || envelope.operation_version !== TASK_ATTESTATION_OPERATION_VERSION ||
      envelope.algorithm !== 'Ed25519' || typeof envelope.key_id !== 'string' || !envelope.key_id ||
      typeof envelope.signature_base64 !== 'string' || !envelope.signature_base64 ||
      !validSha(envelope.payload_sha256)) {
    return bindingFailure('attestation envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  if (signingKeyId != null && envelope.key_id !== signingKeyId) return bindingFailure('attestation signing-key ID does not match protected configuration')
  if (!publicKey || typeof publicKey !== 'string') return bindingFailure('committed public verification key is unavailable')

  let input
  try {
    input = signingInput({
      schema: envelope.attestation_schema,
      operation: envelope.operation,
      operationVersion: envelope.operation_version,
      keyId: envelope.key_id,
      payload: envelope.payload,
    })
  } catch (error) {
    return bindingFailure(error.message)
  }
  if (sha256Hex(input) !== envelope.payload_sha256) return bindingFailure('attestation canonical payload hash does not match')
  let signature
  try {
    signature = Buffer.from(envelope.signature_base64, 'base64')
    if (!verify(null, Buffer.from(input, 'utf8'), createPublicKey(publicKey), signature)) {
      return bindingFailure('attestation signature is invalid')
    }
  } catch (error) {
    return bindingFailure(`attestation signature could not be verified: ${error.message}`)
  }

  const payload = envelope.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return bindingFailure('attestation payload is missing')
  const expectedRepository = typeof repository === 'object' ? repository.nameWithOwner : repository
  if (expectedRepository != null && payload.repository !== expectedRepository) return bindingFailure('attestation repository binding does not match live evidence')
  const liveRepository = repositoryIdentity ?? (typeof repository === 'object' ? repository : null)
  if (liveRepository?.id != null && String(payload.repository_id) !== String(liveRepository.id)) return bindingFailure('attestation repository ID does not match live evidence')
  if (liveRepository?.node_id != null && String(payload.repository_node_id) !== String(liveRepository.node_id)) return bindingFailure('attestation repository node ID does not match live evidence')
  if (payload.operation !== TASK_ATTESTATION_OPERATION || payload.signing_key_id !== envelope.key_id) {
    return bindingFailure('attestation operation or signing-key binding is invalid')
  }
  if (payload.authorization_body_sha256 != null && !validSha(payload.authorization_body_sha256)) {
    return bindingFailure('attestation authorization body hash is invalid')
  }
  if (payload.managed_state_sha256 != null && !validSha(payload.managed_state_sha256)) {
    return bindingFailure('attestation managed-state hash is invalid')
  }
  if (payload.request_id != null && !/^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(payload.request_id)) {
    return bindingFailure('attestation request ID is invalid')
  }
  const expectedPairs = [
    ['repository', expectedRepository],
    ['protected_base_sha', protectedBaseSha],
    ['founder_login', founderLogin],
    ['authorization_comment_id', authorizationCommentId == null ? null : String(authorizationCommentId)],
    ['authorization_body_sha256', authorizationBodySha256],
    ['base', expectedBase],
    ['head', expectedHead],
    ['request_id', requestId],
  ]
  for (const [key, expected] of expectedPairs) {
    if (expected != null && payload[key] !== expected) return bindingFailure(`attestation ${key} binding does not match live evidence`)
  }
  if (payload.attestation_schema !== TASK_ATTESTATION_SCHEMA || payload.operation_version !== TASK_ATTESTATION_OPERATION_VERSION) {
    return bindingFailure('attestation payload schema binding is invalid')
  }
  if (parentIssue && (!sameIdentity({ number: payload.parent_issue_number, id: payload.parent_issue_id, node_id: payload.parent_issue_node_id }, parentIssue))) {
    return bindingFailure('attestation parent Issue identity does not match live evidence')
  }
  if (taskIssue && (!sameIdentity({ number: payload.task_issue_number, id: payload.task_issue_id, node_id: payload.task_issue_node_id }, taskIssue))) {
    return bindingFailure('attestation Task Issue identity does not match live evidence')
  }
  if (pullRequest && (!sameIdentity({ number: payload.pr_number, id: payload.pr_id, node_id: payload.pr_node_id }, pullRequest))) {
    return bindingFailure('attestation PR identity does not match live evidence')
  }
  if (expectedWorkflow) {
    const workflowPairs = [
      ['workflow_file', expectedWorkflow.file],
      ['workflow_ref', expectedWorkflow.ref],
      ['workflow_sha', expectedWorkflow.sha],
      ['workflow_run_id', String(expectedWorkflow.runId)],
    ]
    for (const [key, expected] of workflowPairs) {
      if (expected != null && String(payload[key]) !== String(expected)) return bindingFailure(`attestation ${key} binding does not match workflow evidence`)
    }
  }
  if (policy) {
    const policyPairs = [
      ['policy_path', policy.path],
      ['policy_version', policy.version],
      ['policy_source_commit', policy.sourceCommit],
      ['policy_blob_sha', policy.blobSha],
    ]
    for (const [key, expected] of policyPairs) {
      if (expected != null && payload[key] !== expected) return bindingFailure(`attestation ${key} binding does not match policy evidence`)
    }
  }
  if (protectedBaseSha != null && !validFullSha(payload.protected_base_sha)) return bindingFailure('attestation protected-base SHA is invalid')
  if (expectedHead != null && payload.head !== expectedHead) return bindingFailure('attestation head is not the exact approved head')
  return { ok: true, reason: null, envelope }
}
