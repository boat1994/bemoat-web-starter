import { canonicalSerialize, sha256Hex } from './task-attestation.mjs'

export const PROVISIONAL_TASK_MARKER = '<!-- bemoat-mission-control-task-bootstrap:provisional:v1 -->'
export const PROVISIONAL_TASK_END = '<!-- bemoat-mission-control-task-bootstrap:provisional:end -->'

type TaskBootstrapRequestInput = {
  repository?: unknown
  authorizationCommentId?: unknown
  authorizationBodySha256?: unknown
  parentIssue?: unknown
  pullRequest?: unknown
  base?: unknown
  head?: unknown
  protectedBaseSha?: unknown
  policyPath?: unknown
  policyVersion?: unknown
  policySha?: unknown
  targetMode?: unknown
}

export type TaskBootstrapRequestTuple = {
  operation: 'task-bootstrap'
  operation_version: 1
  repository: unknown
  authorization_comment_id: string
  authorization_body_sha256: unknown
  parent_issue: number
  pull_request: number | null
  base: unknown
  head: unknown
  protected_base_sha: unknown
  policy_path: unknown
  policy_version: unknown
  policy_sha: unknown
}

export type TaskBootstrapRequestIdentity = {
  requestId: string
  tuple: TaskBootstrapRequestTuple
}

export type ProvisionalTaskPayload = {
  [key: string]: unknown
  schema_version?: unknown
  status?: unknown
  request_id?: unknown
  repository?: unknown
  parent_issue?: unknown
  pr?: unknown
  base?: unknown
  head?: unknown
}

export type ProvisionalTaskParseResult =
  | { present: false; valid: false; provisional: null }
  | { present: true; valid: true; provisional: ProvisionalTaskPayload }
  | { present: true; valid: false; reason: string; provisional: null }

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
  targetMode = null,
}: TaskBootstrapRequestInput = {}): TaskBootstrapRequestIdentity {
  const planning = targetMode === 'planning_no_pr'
  const tuple: TaskBootstrapRequestTuple = {
    operation: 'task-bootstrap',
    operation_version: 1,
    repository,
    authorization_comment_id: String(authorizationCommentId),
    authorization_body_sha256: authorizationBodySha256,
    parent_issue: Number(parentIssue),
    pull_request: planning && pullRequest == null ? null : Number(pullRequest),
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

type RenderProvisionalTaskBodyInput = {
  requestId: unknown
  repository: unknown
  parentIssue: unknown
  pullRequest: unknown
  base: unknown
  head: unknown
  protectedBaseSha: unknown
  policyPath: unknown
  policyVersion: unknown
  policySha: unknown
}

export function renderProvisionalTaskBody({
  requestId,
  repository,
  parentIssue,
  pullRequest,
  base,
  head,
  protectedBaseSha,
  policyPath,
  policyVersion,
  policySha,
}: RenderProvisionalTaskBodyInput): string {
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

export function parseProvisionalTaskBody(body: unknown = ''): ProvisionalTaskParseResult {
  const source = String(body)
  const starts = [...source.matchAll(new RegExp(escapeRegExp(PROVISIONAL_TASK_MARKER), 'g'))]
  const ends = [...source.matchAll(new RegExp(escapeRegExp(PROVISIONAL_TASK_END), 'g'))]
  const start = starts[0]
  const end = ends[0]
  if (starts.length === 0 && ends.length === 0) return { present: false, valid: false, provisional: null }
  if (starts.length !== 1 || ends.length !== 1 || typeof start?.index !== 'number' || typeof end?.index !== 'number' || start.index > end.index) {
    return { present: true, valid: false, reason: 'provisional marker pair is unbalanced', provisional: null }
  }
  const raw = source.slice(start.index + PROVISIONAL_TASK_MARKER.length, end.index)
    .replace(/```json\s*|```/g, '').trim()
  try {
    const provisional: unknown = JSON.parse(raw)
    const valid = isProvisionalTaskPayload(provisional) && provisional.schema_version === 1 && provisional.status === 'provisional' &&
      typeof provisional.request_id === 'string' && /^mc-task-bootstrap-v1-[0-9a-f]{64}$/.test(provisional.request_id) &&
      typeof provisional.repository === 'string' && Number.isInteger(provisional.parent_issue) &&
      Number.isInteger(provisional.pr) && typeof provisional.base === 'string' &&
      typeof provisional.head === 'string' && /^[0-9a-f]{40}$/i.test(provisional.head)
    return valid
      ? { present: true, valid: true, provisional }
      : { present: true, valid: false, reason: 'provisional allocation fields are invalid', provisional: null }
  } catch (error) {
    return { present: true, valid: false, reason: `provisional allocation is not valid JSON: ${errorMessage(error)}`, provisional: null }
  }
}

function isProvisionalTaskPayload(value: unknown): value is ProvisionalTaskPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
