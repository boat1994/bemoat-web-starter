import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { z } from 'zod'
const TASK_ATTESTATION_SCHEMA = 'bemoat-mission-control-task-bootstrap-attestation'
const TASK_ATTESTATION_OPERATION = 'task-bootstrap'
const TASK_ATTESTATION_OPERATION_VERSION = 1
const TASK_ATTESTATION_START = '<!-- bemoat-mission-control-task-attestation:v1 -->'
const TASK_ATTESTATION_END = '<!-- bemoat-mission-control-task-attestation:end -->'
type JsonValue = null | string | boolean | number | JsonValue[] | { [key: string]: JsonValue }
type Identity = { number?: string | number | null; id?: string | number | null; node_id?: string | number | null }
type Repository = Identity & {
  nameWithOwner?: string | null
}
type Workflow = {
  file?: string | null
  ref?: string | null
  sha?: string | null
  runId?: string | number | null
}
type Policy = {
  path?: string | null
  version?: string | number | null
  sourceCommit?: string | null
  blobSha?: string | null
}
const optionalString = z.string().nullable().optional()
const optionalNumber = z.number().nullable().optional()
const optionalIdentityValue = z.union([z.string(), z.number()]).nullable().optional()
const signedEnvelopeSchema = z.looseObject({ schema_version: z.number(), attestation_schema: z.string(), operation: z.string(), operation_version: z.number(), algorithm: z.string(), key_id: z.string(), payload: z.record(z.string(), z.json()), payload_sha256: z.string(), signature_base64: z.string() })
const taskPayloadSchema = z.looseObject({ attestation_schema: optionalString, operation: optionalString, operation_version: optionalNumber, managed_state_sha256: optionalString, repository: optionalString, repository_id: optionalIdentityValue, repository_node_id: optionalIdentityValue, protected_base_sha: optionalString, founder_login: optionalString, authorization_comment_id: optionalIdentityValue, authorization_body_sha256: optionalString, parent_issue_number: optionalIdentityValue, parent_issue_id: optionalIdentityValue, parent_issue_node_id: optionalIdentityValue, task_issue_number: optionalIdentityValue, task_issue_id: optionalIdentityValue, task_issue_node_id: optionalIdentityValue, pr_number: optionalIdentityValue, pr_id: optionalIdentityValue, pr_node_id: optionalIdentityValue, base: optionalString, head: optionalString, policy_path: optionalString, policy_version: z.union([z.string(), z.number()]).nullable().optional(), policy_source_commit: optionalString, policy_blob_sha: optionalString, request_id: optionalString, workflow_file: optionalString, workflow_ref: optionalString, workflow_sha: optionalString, workflow_run_id: optionalIdentityValue, signing_key_id: optionalString })
type SignedEnvelope = z.infer<typeof signedEnvelopeSchema>
type TaskPayload = z.infer<typeof taskPayloadSchema>
type ParseResult = { ok: true; envelope: Record<string, unknown> } | { ok: false; reason: string; envelope: null }
type VerificationResult = { ok: true; reason: null; envelope: unknown; payload?: unknown } | { ok: false; reason: string; envelope: null }
type GenericVerificationOptions = {
  publicKey?: string
  expectedSchema?: string
  expectedOperation?: string
  expectedOperationVersion?: number
  signingKeyId?: string
  repository?: string
}
type TaskVerificationOptions = {
  publicKey?: string
  repository?: string | Repository
  repositoryIdentity?: Repository
  protectedBaseSha?: string
  authorizationCommentId?: string | number
  authorizationBodySha256?: string
  founderLogin?: string
  parentIssue?: Identity
  taskIssue?: Identity
  pullRequest?: Identity
  expectedHead?: string
  expectedBase?: string
  policy?: Policy
  requestId?: string
  expectedWorkflow?: Workflow
  signingKeyId?: string
}
function fail(message: string): never {
  const error = new Error(message)
  Object.assign(error, { code: 'ATTESTATION_INVALID' })
  throw error
}
function blockedExternal(message: string): never {
  const error = new Error(message)
  Object.assign(error, { code: 'BLOCKED_EXTERNAL' })
  throw error
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return 'undefined'
}
function sortValue(value: Record<string, unknown>): Record<string, JsonValue>
function sortValue(value: unknown): JsonValue
function sortValue(value: unknown): JsonValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical payload cannot contain a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object') {
    const output: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value).sort()) {
      const entry = Reflect.get(value, key)
      if (entry === undefined) fail(`canonical payload cannot contain undefined key ${key}`)
      output[key] = sortValue(entry)
    }
    return output
  }
  fail(`canonical payload contains unsupported value type ${typeof value}`)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function canonicalSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value))
}
function sha256Hex(value: unknown): string {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}
function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalSerialize(value))
}
function signingInput({ schema, operation, operationVersion, keyId, payload }: {
  schema: unknown
  operation: unknown
  operationVersion: unknown
  keyId: string
  payload: unknown
}): string {
  return canonicalSerialize({
    attestation_schema: schema,
    key_id: keyId,
    operation,
    operation_version: operationVersion,
    payload,
  })
}
function createSignedEnvelope({
  schema = TASK_ATTESTATION_SCHEMA,
  operation = TASK_ATTESTATION_OPERATION,
  operationVersion = TASK_ATTESTATION_OPERATION_VERSION,
  keyId,
  payload,
  privateKey,
}: {
  schema?: string
  operation?: string
  operationVersion?: number
  keyId?: string
  payload?: Record<string, unknown>
  privateKey?: string
} = {}): SignedEnvelope {
  if (!keyId || typeof keyId !== 'string') fail('signing key ID is required')
  if (!privateKey || typeof privateKey !== 'string') blockedExternal('protected signing material is unavailable')
  if (payload === undefined) fail('canonical payload contains unsupported value type undefined')
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
function renderSignedEnvelope(envelope: unknown, { start, end }: { start?: string; end?: string } = {}): string {
  const markerStart = start ?? TASK_ATTESTATION_START
  const markerEnd = end ?? TASK_ATTESTATION_END
  return [markerStart, '```json', JSON.stringify(envelope, null, 2), '```', markerEnd].join('\n')
}
function parseSignedEnvelope(body = '', { start, end }: { start?: string; end?: string } = {}): ParseResult {
  const markerStart = start ?? TASK_ATTESTATION_START
  const markerEnd = end ?? TASK_ATTESTATION_END
  const starts = [...String(body).matchAll(new RegExp(escapeRegExp(markerStart), 'g'))]
  const ends = [...String(body).matchAll(new RegExp(escapeRegExp(markerEnd), 'g'))]
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index === undefined || ends[0].index === undefined || starts[0].index > ends[0].index) {
    return { ok: false, reason: 'exactly one balanced signed-envelope marker pair is required', envelope: null }
  }
  const raw = String(body).slice(starts[0].index + markerStart.length, ends[0].index)
    .replace(/```json\s*|```/g, '').trim()
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!isRecord(envelope)) {
      return { ok: false, reason: 'signed envelope must be one JSON object', envelope: null }
    }
    return { ok: true, envelope }
  } catch (error) {
    return { ok: false, reason: `signed envelope is not valid JSON: ${errorMessage(error)}`, envelope: null }
  }
}
function parseTaskAttestation(body = ''): ParseResult {
  return parseSignedEnvelope(body)
}
function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}
function validFullSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}
function sameIdentity(actual: Identity, expected: Identity): boolean {
  return actual.number != null && String(actual.number) === String(expected.number) &&
    (expected.id == null || String(actual.id) === String(expected.id)) &&
    (expected.node_id == null || String(actual.node_id) === String(expected.node_id))
}
function identityValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  return String(value)
}
function bindingFailure(reason: string): { ok: false; reason: string; envelope: null } {
  return { ok: false, reason, envelope: null }
}
function verifySignedEnvelope(envelope: unknown, {
  publicKey,
  expectedSchema,
  expectedOperation,
  expectedOperationVersion,
  signingKeyId,
  repository,
}: GenericVerificationOptions = {}): VerificationResult {
  if (!isRecord(envelope)) return bindingFailure('signed envelope is missing')
  const parsedEnvelope = signedEnvelopeSchema.safeParse(envelope)
  if (!parsedEnvelope.success) {
    return bindingFailure('signed envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  const signedEnvelope = parsedEnvelope.data
  if (expectedSchema != null && signedEnvelope.attestation_schema !== expectedSchema ||
      expectedOperation != null && signedEnvelope.operation !== expectedOperation ||
      expectedOperationVersion != null && signedEnvelope.operation_version !== expectedOperationVersion ||
      signedEnvelope.schema_version !== 1 || signedEnvelope.algorithm !== 'Ed25519' || !signedEnvelope.key_id ||
      !signedEnvelope.signature_base64 || !validSha(signedEnvelope.payload_sha256)) {
    return bindingFailure('signed envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  if (signingKeyId != null && signedEnvelope.key_id !== signingKeyId) return bindingFailure('signed envelope key ID does not match protected configuration')
  if (!publicKey || typeof publicKey !== 'string') return bindingFailure('committed public verification key is unavailable')
  let input: string
  try {
    input = signingInput({
      schema: signedEnvelope.attestation_schema,
      operation: signedEnvelope.operation,
      operationVersion: signedEnvelope.operation_version,
      keyId: signedEnvelope.key_id,
      payload: signedEnvelope.payload,
    })
  } catch (error) {
    return bindingFailure(errorMessage(error))
  }
  if (sha256Hex(input) !== signedEnvelope.payload_sha256) return bindingFailure('signed envelope canonical payload hash does not match')
  try {
    if (!verify(null, Buffer.from(input, 'utf8'), createPublicKey(publicKey), Buffer.from(signedEnvelope.signature_base64, 'base64'))) {
      return bindingFailure('signed envelope signature is invalid')
    }
  } catch (error) {
    return bindingFailure(`signed envelope signature could not be verified: ${errorMessage(error)}`)
  }
  if (repository != null && (!isRecord(signedEnvelope.payload) || signedEnvelope.payload.repository !== repository)) return bindingFailure('signed envelope repository binding does not match')
  return { ok: true, reason: null, envelope, payload: signedEnvelope.payload }
}
function verifyTaskAttestation(envelope: unknown, {
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
}: TaskVerificationOptions = {}): VerificationResult {
  if (!isRecord(envelope)) return bindingFailure('attestation envelope is missing')
  const parsedEnvelope = signedEnvelopeSchema.safeParse(envelope)
  if (!parsedEnvelope.success) {
    return bindingFailure('attestation envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  const signedEnvelope = parsedEnvelope.data
  const parsedPayload = taskPayloadSchema.safeParse(signedEnvelope.payload)
  if (!parsedPayload.success) {
    return bindingFailure(isRecord(signedEnvelope.payload) ? 'attestation payload schema is invalid' : 'attestation payload is missing')
  }
  const payload: TaskPayload = parsedPayload.data
  if (signedEnvelope.schema_version !== 1 || signedEnvelope.attestation_schema !== TASK_ATTESTATION_SCHEMA ||
      signedEnvelope.operation !== TASK_ATTESTATION_OPERATION || signedEnvelope.operation_version !== TASK_ATTESTATION_OPERATION_VERSION ||
      signedEnvelope.algorithm !== 'Ed25519' || !signedEnvelope.key_id ||
      !signedEnvelope.signature_base64 || !validSha(signedEnvelope.payload_sha256)) {
    return bindingFailure('attestation envelope schema, algorithm, key ID, or signature fields are invalid')
  }
  if (signingKeyId != null && signedEnvelope.key_id !== signingKeyId) return bindingFailure('attestation signing-key ID does not match protected configuration')
  if (!publicKey || typeof publicKey !== 'string') return bindingFailure('committed public verification key is unavailable')
  let input: string
  try {
    input = signingInput({
      schema: signedEnvelope.attestation_schema,
      operation: signedEnvelope.operation,
      operationVersion: signedEnvelope.operation_version,
      keyId: signedEnvelope.key_id,
      payload: signedEnvelope.payload,
    })
  } catch (error) {
    return bindingFailure(errorMessage(error))
  }
  if (sha256Hex(input) !== signedEnvelope.payload_sha256) return bindingFailure('attestation canonical payload hash does not match')
  try {
    const signature = Buffer.from(signedEnvelope.signature_base64, 'base64')
    if (!verify(null, Buffer.from(input, 'utf8'), createPublicKey(publicKey), signature)) {
      return bindingFailure('attestation signature is invalid')
    }
  } catch (error) {
    return bindingFailure(`attestation signature could not be verified: ${errorMessage(error)}`)
  }
  const expectedRepository = typeof repository === 'object' ? repository.nameWithOwner : repository
  if (expectedRepository != null && payload.repository !== expectedRepository) return bindingFailure('attestation repository binding does not match live evidence')
  const liveRepository = repositoryIdentity ?? (typeof repository === 'object' ? repository : null)
  if (liveRepository?.id != null && String(payload.repository_id) !== String(liveRepository.id)) return bindingFailure('attestation repository ID does not match live evidence')
  if (liveRepository?.node_id != null && String(payload.repository_node_id) !== String(liveRepository.node_id)) return bindingFailure('attestation repository node ID does not match live evidence')
  if (payload.operation !== TASK_ATTESTATION_OPERATION || payload.signing_key_id !== signedEnvelope.key_id) {
    return bindingFailure('attestation operation or signing-key binding is invalid')
  }
  if (payload.authorization_body_sha256 != null && !validSha(payload.authorization_body_sha256)) {
    return bindingFailure('attestation authorization body hash is invalid')
  }
  if (payload.managed_state_sha256 != null && !validSha(payload.managed_state_sha256)) {
    return bindingFailure('attestation managed-state hash is invalid')
  }
  if (payload.request_id != null && !/^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(String(payload.request_id))) {
    return bindingFailure('attestation request ID is invalid')
  }
  const expectedPairs: Array<[string, unknown]> = [
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
  if (parentIssue && !sameIdentity({ number: identityValue(payload.parent_issue_number), id: identityValue(payload.parent_issue_id), node_id: identityValue(payload.parent_issue_node_id) }, parentIssue)) {
    return bindingFailure('attestation parent Issue identity does not match live evidence')
  }
  if (taskIssue && !sameIdentity({ number: identityValue(payload.task_issue_number), id: identityValue(payload.task_issue_id), node_id: identityValue(payload.task_issue_node_id) }, taskIssue)) {
    return bindingFailure('attestation Task Issue identity does not match live evidence')
  }
  if (pullRequest && !sameIdentity({ number: identityValue(payload.pr_number), id: identityValue(payload.pr_id), node_id: identityValue(payload.pr_node_id) }, pullRequest)) {
    return bindingFailure('attestation PR identity does not match live evidence')
  }
  if (expectedWorkflow) {
    const workflowPairs: Array<[string, unknown]> = [
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
    const policyPairs: Array<[string, unknown]> = [
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
export {
  TASK_ATTESTATION_SCHEMA,
  TASK_ATTESTATION_OPERATION,
  TASK_ATTESTATION_OPERATION_VERSION,
  TASK_ATTESTATION_START,
  TASK_ATTESTATION_END,
  canonicalSerialize,
  sha256Hex,
  canonicalHash,
  createSignedEnvelope,
  renderSignedEnvelope,
  parseSignedEnvelope,
  parseTaskAttestation,
  verifySignedEnvelope,
  verifyTaskAttestation,
}
