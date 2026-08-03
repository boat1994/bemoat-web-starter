import {
  canonicalHash,
  createSignedEnvelope,
  parseSignedEnvelope,
  renderSignedEnvelope,
  verifySignedEnvelope,
} from './task-attestation.mjs'

export const TASK_REGISTRY_SCHEMA = 'bemoat-mission-control-task-ownership-registry'
export const TASK_REGISTRY_OPERATION = 'task-ownership-register'
export const TASK_REGISTRY_START = '<!-- bemoat-mission-control-task-registry:v1 -->'
export const TASK_REGISTRY_END = '<!-- bemoat-mission-control-task-registry:end -->'

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
} = {}) {
  return {
    schema_version: 1,
    registry_schema: TASK_REGISTRY_SCHEMA,
    repository,
    request_id: requestId,
    parent_issue_number: Number(parentIssue.number),
    parent_issue_id: parentIssue.id,
    parent_issue_node_id: parentIssue.node_id,
    task_issue_number: Number(taskIssue.number),
    task_issue_id: taskIssue.id,
    task_issue_node_id: taskIssue.node_id,
    pr_number: Number(pullRequest.number),
    pr_id: pullRequest.id,
    pr_node_id: pullRequest.node_id,
    base,
    head,
    protected_base_sha: protectedBaseSha,
    attestation_sha256: canonicalHash(attestation),
    signing_key_id: signingKeyId,
  }
}

export function createTaskOwnershipRecord({ payload, privateKey, signingKeyId } = {}) {
  return createSignedEnvelope({
    schema: TASK_REGISTRY_SCHEMA,
    operation: TASK_REGISTRY_OPERATION,
    operationVersion: 1,
    keyId: signingKeyId,
    payload,
    privateKey,
  })
}

export function renderTaskOwnershipRecord(record) {
  return renderSignedEnvelope(record, { start: TASK_REGISTRY_START, end: TASK_REGISTRY_END })
}

export function parseTaskOwnershipRecord(body = '') {
  return parseSignedEnvelope(body, { start: TASK_REGISTRY_START, end: TASK_REGISTRY_END })
}

export function verifyTaskOwnershipRecord(record, {
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
} = {}) {
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
  const payload = record.payload
  if (payload.registry_schema !== TASK_REGISTRY_SCHEMA || typeof payload.request_id !== 'string' ||
      !/^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(payload.request_id) ||
      !Number.isInteger(payload.task_issue_number) || !Number.isInteger(payload.pr_number) ||
      typeof payload.head !== 'string' || !/^[0-9a-f]{40}$/i.test(payload.head) ||
      typeof payload.attestation_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.attestation_sha256) ||
      payload.signing_key_id !== record.key_id || typeof payload.protected_base_sha !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(payload.protected_base_sha)) {
    return { ok: false, reason: 'registry ownership binding is invalid', record: null }
  }
  const identityChecks = [
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
  ]) {
    if (!expected) continue
    if (expected.id != null && String(payload[`${prefix}_id`]) !== String(expected.id)) return { ok: false, reason: `registry ${prefix} identity does not match live evidence`, record: null }
    if (expected.node_id != null && String(payload[`${prefix}_node_id`]) !== String(expected.node_id)) return { ok: false, reason: `registry ${prefix} node identity does not match live evidence`, record: null }
  }
  return { ok: true, reason: null, record }
}

export function classifyTaskOwnershipRecords(records = [], { requestId, pullRequest } = {}) {
  const valid = records.filter((record) => record?.valid && record.record)
  const sameRequest = valid.filter(({ record }) => record.payload.request_id === requestId)
  const competing = valid.filter(({ record }) =>
    String(record.payload.pr_number) === String(pullRequest),
  ).filter(({ record }) => record.payload.request_id !== requestId)
  return { valid, sameRequest, competing }
}
