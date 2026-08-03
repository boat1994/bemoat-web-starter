import { sha256Hex, canonicalSerialize } from './task-attestation.mjs'

export const PROVISIONAL_TASK_MARKER = '<!-- bemoat-mission-control-task-bootstrap:provisional:v1 -->'
export const PROVISIONAL_TASK_END = '<!-- bemoat-mission-control-task-bootstrap:provisional:end -->'

export function buildTaskBootstrapRequestIdentity({
  repository,
  authorizationCommentId,
  authorizationBodySha256,
  parentIssue,
  pullRequest,
  base,
  head,
  protectedBaseSha,
  policyPath,
  policyVersion,
  policySha,
} = {}) {
  const tuple = {
    operation: 'task-bootstrap',
    operation_version: 1,
    repository,
    authorization_comment_id: String(authorizationCommentId),
    authorization_body_sha256: authorizationBodySha256,
    parent_issue: Number(parentIssue),
    pull_request: Number(pullRequest),
    base,
    head,
    protected_base_sha: protectedBaseSha,
    policy_path: policyPath,
    policy_version: policyVersion,
    policy_sha: policySha,
  }
  return {
    requestId: `mc-task-bootstrap-v1-${sha256Hex(canonicalSerialize(tuple))}`,
    tuple,
  }
}
export function renderProvisionalTaskBody({ requestId, repository, parentIssue, pullRequest, base, head, protectedBaseSha, policyPath, policyVersion, policySha }) {
  const payload = {
    schema_version: 1,
    status: 'provisional',
    request_id: requestId,
    repository,
    parent_issue: Number(parentIssue),
    pr: Number(pullRequest),
    base,
    head,
    protected_base_sha: protectedBaseSha,
    policy_source: policyPath,
    policy_version: policyVersion,
    policy_sha: policySha,
  }
  return [PROVISIONAL_TASK_MARKER, '```json', JSON.stringify(payload, null, 2), '```', PROVISIONAL_TASK_END,
    '', 'This Issue is a recoverable provisional allocation. It is not a managed Task and must fail preflight until the signed canonical projection is complete.'].join('\n')
}

export function parseProvisionalTaskBody(body = '') {
  const starts = [...String(body).matchAll(new RegExp(escapeRegExp(PROVISIONAL_TASK_MARKER), 'g'))]
  const ends = [...String(body).matchAll(new RegExp(escapeRegExp(PROVISIONAL_TASK_END), 'g'))]
  if (starts.length === 0 && ends.length === 0) return { present: false, valid: false, provisional: null }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { present: true, valid: false, reason: 'provisional marker pair is unbalanced', provisional: null }
  }
  const raw = String(body).slice(starts[0].index + PROVISIONAL_TASK_MARKER.length, ends[0].index)
    .replace(/```json\s*|```/g, '').trim()
  try {
    const provisional = JSON.parse(raw)
    const valid = provisional?.schema_version === 1 && provisional?.status === 'provisional' &&
      typeof provisional.request_id === 'string' && /^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(provisional.request_id) &&
      typeof provisional.repository === 'string' && Number.isInteger(provisional.parent_issue) &&
      Number.isInteger(provisional.pr) && typeof provisional.base === 'string' &&
      typeof provisional.head === 'string' && /^[0-9a-f]{40}$/i.test(provisional.head)
    return valid
      ? { present: true, valid: true, provisional }
      : { present: true, valid: false, reason: 'provisional allocation fields are invalid', provisional: null }
  } catch (error) {
    return { present: true, valid: false, reason: `provisional allocation is not valid JSON: ${error.message}`, provisional: null }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
