import {
  canonicalHash,
  createSignedEnvelope,
  parseSignedEnvelope,
  renderSignedEnvelope,
  verifySignedEnvelope,
} from './task-attestation.ts'

export const TASK_REGISTRY_SCHEMA = 'bemoat-mission-control-task-ownership-registry'
export const TASK_REGISTRY_OPERATION = 'task-ownership-register'
export const TASK_REGISTRY_START = '<!-- bemoat-mission-control-task-registry:v1 -->'
export const TASK_REGISTRY_END = '<!-- bemoat-mission-control-task-registry:end -->'

type RuntimeObject = Record<string, unknown>
type Identity = Record<string, unknown>
type SignedEnvelope = Record<string, unknown>
type VerificationResult = { ok: boolean; reason: string | null; record: SignedEnvelope | null }

export function buildTaskOwnershipPayload({
  repository,
  requestId,
  parentIssue,
  taskIssue,
  pullRequest,
  base,
  head,
  protectedBaseSha,
  attestation,
  signingKeyId,
}: {
  repository?: string
  requestId?: string
  parentIssue?: Identity
  taskIssue?: Identity
  pullRequest?: Identity
  base?: string
  head?: string
  protectedBaseSha?: string
  attestation?: RuntimeObject
  signingKeyId?: string
} = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    registry_schema: TASK_REGISTRY_SCHEMA,
    repository,
    request_id: requestId,
    parent_issue_number: Number(parentIssue?.number),
    parent_issue_id: parentIssue?.id,
    parent_issue_node_id: parentIssue?.node_id,
    task_issue_number: Number(taskIssue?.number),
    task_issue_id: taskIssue?.id,
    task_issue_node_id: taskIssue?.node_id,
    pr_number: Number(pullRequest?.number),
    pr_id: pullRequest?.id,
    pr_node_id: pullRequest?.node_id,
    base,
    head,
    protected_base_sha: protectedBaseSha,
    attestation_sha256: canonicalHash(attestation),
    signing_key_id: signingKeyId,
  }
}

export function createTaskOwnershipRecord({
  payload,
  privateKey,
  signingKeyId,
}: {
  payload?: RuntimeObject
  privateKey?: string
  signingKeyId?: string
} = {}): Record<string, unknown> & { payload: Record<string, unknown> } {
  return createSignedEnvelope({
    schema: TASK_REGISTRY_SCHEMA,
    operation: TASK_REGISTRY_OPERATION,
    operationVersion: 1,
    keyId: signingKeyId,
    payload,
    privateKey,
  }) as Record<string, unknown> & { payload: Record<string, unknown> }
}

export function renderTaskOwnershipRecord(record: Record<string, unknown>): string {
  return renderSignedEnvelope(record, { start: TASK_REGISTRY_START, end: TASK_REGISTRY_END })
}

export function parseTaskOwnershipRecord(body = ''): Record<string, unknown> {
  return parseSignedEnvelope(body, { start: TASK_REGISTRY_START, end: TASK_REGISTRY_END }) as Record<string, unknown>
}

export function verifyTaskOwnershipRecord(
  record: Record<string, unknown>,
  {
    publicKey,
    repository,
    signingKeyId,
    expectedParentIssue,
    expectedTaskIssue,
    expectedPullRequest,
    expectedBase,
    expectedHead,
    expectedProtectedBaseSha,
    expectedRequestId,
    expectedAttestationSha256,
  }: {
    publicKey?: string
    repository?: string
    signingKeyId?: string
    expectedParentIssue?: Identity
    expectedTaskIssue?: Identity
    expectedPullRequest?: Identity
    expectedBase?: string
    expectedHead?: string
    expectedProtectedBaseSha?: string
    expectedRequestId?: string
    expectedAttestationSha256?: string
  } = {},
): VerificationResult {
  if (!record || record.attestation_schema !== TASK_REGISTRY_SCHEMA || record.operation !== TASK_REGISTRY_OPERATION || record.operation_version !== 1) {
    return { ok: false, reason: 'registry record schema is invalid', record: null }
  }
  const result = verifySignedEnvelope(record, {
    publicKey,
    repository,
    expectedSchema: TASK_REGISTRY_SCHEMA,
    expectedOperation: TASK_REGISTRY_OPERATION,
    expectedOperationVersion: 1,
    signingKeyId,
  })
  if (!result.ok) return { ok: false, reason: result.reason, record: null }
  const payload = record.payload as Record<string, unknown>
  if (payload.registry_schema !== TASK_REGISTRY_SCHEMA || typeof payload.request_id !== 'string' ||
      !/^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(payload.request_id as string) ||
      !Number.isInteger(payload.task_issue_number) || !Number.isInteger(payload.pr_number) ||
      typeof payload.head !== 'string' || !/^[0-9a-f]{40}$/i.test(payload.head as string) ||
      typeof payload.attestation_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.attestation_sha256 as string) ||
      payload.signing_key_id !== record.key_id || typeof payload.protected_base_sha !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(payload.protected_base_sha as string)) {
    return { ok: false, reason: 'registry ownership binding is invalid', record: null }
  }
  const identityChecks: Array<[string, unknown]> = [
    ['parent_issue_number', expectedParentIssue?.number],
    ['task_issue_number', expectedTaskIssue?.number],
    ['pr_number', expectedPullRequest?.number],
    ['base', expectedBase],
    ['head', expectedHead],
    ['protected_base_sha', expectedProtectedBaseSha],
    ['request_id', expectedRequestId],
    ['attestation_sha256', expectedAttestationSha256],
  ]
  for (const [key, expected] of identityChecks) {
    if (expected != null && String(payload[key]) !== String(expected)) {
      return { ok: false, reason: `registry ${key} binding does not match live evidence`, record: null }
    }
  }
  for (const [prefix, expected] of [
    ['parent_issue', expectedParentIssue],
    ['task_issue', expectedTaskIssue],
    ['pr', expectedPullRequest],
  ] as Array<[string, Identity | undefined]>) {
    if (!expected) continue
    if (expected.id != null && String(payload[`${prefix}_id`]) !== String(expected.id)) return { ok: false, reason: `registry ${prefix} identity does not match live evidence`, record: null }
    if (expected.node_id != null && String(payload[`${prefix}_node_id`]) !== String(expected.node_id)) return { ok: false, reason: `registry ${prefix} node identity does not match live evidence`, record: null }
  }
  return { ok: true, reason: null, record: record as SignedEnvelope }
}

export function classifyTaskOwnershipRecords(
  records: Array<Record<string, unknown>> = [],
  { requestId, pullRequest }: { requestId?: string; pullRequest?: string | number } = {},
): Record<string, unknown> {
  const valid = records.filter((record) => record?.valid && record.record)
  const sameRequest = valid.filter((entry) => {
    const payload = (entry.record as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined
    return payload?.request_id === requestId
  })
  const competing = valid.filter((entry) => {
    const payload = (entry.record as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined
    return String(payload?.pr_number) === String(pullRequest)
  }).filter((entry) => {
    const payload = (entry.record as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined
    return payload?.request_id !== requestId
  })
  return { valid, sameRequest, competing }
}
