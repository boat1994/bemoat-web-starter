import { createHash } from 'node:crypto'

export type BootstrapContract = Readonly<{
  repository: string
  parentIssue: number
  pullRequest: number
  base: string
  head: string
  protectedBaseSha: string
  policySource: string
  policyVersion: string
  policySha: string
  workflowFile: string
  attestationSchema: string
  operationVersion: number
}>

export type CurrentBootstrapContract = Readonly<{
  repository: string
  base: string
  policySource: string
  workflowFile: string
  attestationSchema: string
  operationVersion: number
}>

export type JsonRecord = { [key: string]: unknown }

type AuthorizationComment = {
  id?: unknown
  body?: unknown
  issue_number?: unknown
  user?: JsonRecord | null
  author?: JsonRecord | null
  author_login?: unknown
  [key: string]: unknown
}

type ParentIssue = {
  number?: unknown
  [key: string]: unknown
}

type CreateFounderAuthorizationBodyOptions = {
  repository?: unknown
  parentIssue?: unknown
  pullRequest?: unknown
  base?: unknown
  head?: unknown
  protectedBaseSha?: unknown
  policySource?: unknown
  policyVersion?: unknown
  policySha?: unknown
  authorLogin?: unknown
  commentId?: unknown
  taskIssue?: unknown
  targetMode?: unknown
}

export type FounderTaskBootstrapAuthorizationResult = {
  valid: true
  authorLogin: unknown
  commentId: string
  bodySha256: string
  authorization: JsonRecord
}

type ValidateFounderTaskBootstrapAuthorizationOptions = {
  authorization?: JsonRecord | null
  authorizationComment?: AuthorizationComment
  parentIssue?: ParentIssue | null
  repository?: unknown
  founderLogins?: unknown[]
  parentComments?: unknown[]
  expected?: BootstrapContract
}

export const BOOTSTRAP_CONTRACT: BootstrapContract = Object.freeze({
  repository: 'boat1994/bemoat-web-starter',
  parentIssue: 262,
  pullRequest: 263,
  base: 'main',
  head: 'd5f0d1edf86f0c0f94a4891558ae6fcea7bfb73f',
  protectedBaseSha: 'f6ac355b98aa281dda2a49bcf2ddaeb279d8173d',
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'f46f5de1d5ee17669c7c4663893164ffb835b339',
  workflowFile: '.github/workflows/mission-control-task-bootstrap.yml',
  attestationSchema: 'bemoat-mission-control-task-bootstrap-attestation',
  operationVersion: 1,
})

/** Live-bound contract for current Founder-authorized existing-task recovery. */
export const CURRENT_BOOTSTRAP_CONTRACT: CurrentBootstrapContract = Object.freeze({
  repository: BOOTSTRAP_CONTRACT.repository,
  base: BOOTSTRAP_CONTRACT.base,
  policySource: BOOTSTRAP_CONTRACT.policySource,
  workflowFile: BOOTSTRAP_CONTRACT.workflowFile,
  attestationSchema: BOOTSTRAP_CONTRACT.attestationSchema,
  operationVersion: BOOTSTRAP_CONTRACT.operationVersion,
})

export const BOOTSTRAP_AUTHORIZATION_BUNDLE = 'task-bootstrap-genesis'
export const EXISTING_TASK_BOOTSTRAP_AUTHORIZATION_BUNDLE = 'task-bootstrap-existing'
export const BOOTSTRAP_AUTHORIZATION_SCOPE = 'task-initialization'
export const BOOTSTRAP_AUTHORIZATION_ACTION = 'create-managed-task'

function authorizationError(message: string): never {
  const error = new Error(`Founder bootstrap authorization is invalid: ${message}`)
  Object.assign(error, { code: 'STATE_CONFLICT', classification: 'STATE_CONFLICT' })
  throw error
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseFounderTaskBootstrapAuthorization(body = ''): JsonRecord {
  if (typeof body !== 'string' || !body.trim() || body.trim().startsWith('```')) {
    authorizationError('comment must contain exactly one raw JSON object')
  }
  if (body.trim().startsWith('## FOUNDER_DECISION')) return parseMarkdownFounderDecision(body)
  let authorization: unknown
  try {
    authorization = JSON.parse(body.trim())
  } catch {
    authorizationError('comment body is not valid JSON')
  }
  if (!isJsonRecord(authorization)) {
    authorizationError('comment body must decode to one JSON object')
  }
  return authorization
}

const MARKDOWN_FIELD_NAMES: Record<string, string> = {
  status: 'status',
  decision: 'status',
  authority: 'authority',
  'author login': 'author_login',
  founder: 'author_login',
  'comment id': 'comment_id',
  'immutable comment reference': 'immutable_comment_reference',
  'non-superseded': 'non_superseded',
  repository: 'repository',
  'canonical repository': 'repository',
  'bundle kind': 'bundle_kind',
  'parent issue': 'parent_issue',
  'task issue': 'task_issue',
  issue: 'task_issue',
  'target issue': 'task_issue',
  pr: 'pr',
  'exact head': 'exact_head',
  'reviewed head': 'reviewed_head',
  base: 'base',
  'policy source': 'policy_source',
  'policy source sha': 'policy_source_sha',
  'protected base sha': 'protected_base_sha',
  'policy version': 'policy_version',
  scope: 'scope',
  action: 'action',
  'target mode': 'target_mode',
}

function parseMarkdownValue(raw: string): unknown {
  const value = raw.trim().replace(/^`|`$/g, '')
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^#?\d+$/.test(value)) return Number(value.replace(/^#/, ''))
  if (value === 'APPROVE' || value === 'APPROVED') return 'approved'
  return value
}

function parseMarkdownFounderDecision(body: string): JsonRecord {
  const lines = body.split(/\r?\n/)
  if (lines[0].trim() !== '## FOUNDER_DECISION') authorizationError('comment must contain exactly one structured Founder decision')
  const record: JsonRecord = { schema_version: 1 }
  const seen = new Set<string>()
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const match = line.match(/^\s*(?:-\s+)?\*\*([^*]+):\*\*\s+(.+)$/)
    if (!match) authorizationError('comment body must contain the exact structured Founder decision fields')
    const field = MARKDOWN_FIELD_NAMES[match[1].trim().toLowerCase()]
    if (!field || seen.has(field)) authorizationError('comment body contains an unknown or duplicate Founder decision field')
    seen.add(field)
    record[field] = parseMarkdownValue(match[2])
  }
  const required = Object.values(MARKDOWN_FIELD_NAMES).filter((field, index, fields) => fields.indexOf(field) === index && field !== 'parent_issue' && field !== 'task_issue')
  if (required.some((field) => !seen.has(field)) || (!seen.has('parent_issue') && !seen.has('task_issue'))) authorizationError('comment body must contain the exact structured Founder decision fields')
  if (!seen.has('parent_issue') && seen.has('task_issue')) record.parent_issue = record.task_issue
  if (!seen.has('task_issue') && seen.has('parent_issue')) record.task_issue = null
  record.status = record.status === 'approved' ? 'approved' : record.status
  record.immutable_comment_reference = record.immutable_comment_reference === true
  record.non_superseded = record.non_superseded === true
  return record
}

/**
 * Generate a deterministic fixture/authoring representation. The runtime does
 * not trust this helper or any caller-supplied values; it revalidates the live
 * comment and live GitHub evidence before mutation.
 */
export function createFounderAuthorizationBody({
  repository = BOOTSTRAP_CONTRACT.repository,
  parentIssue = BOOTSTRAP_CONTRACT.parentIssue,
  pullRequest = BOOTSTRAP_CONTRACT.pullRequest,
  base = BOOTSTRAP_CONTRACT.base,
  head = BOOTSTRAP_CONTRACT.head,
  protectedBaseSha = BOOTSTRAP_CONTRACT.protectedBaseSha,
  policySource = BOOTSTRAP_CONTRACT.policySource,
  policyVersion = BOOTSTRAP_CONTRACT.policyVersion,
  policySha = BOOTSTRAP_CONTRACT.policySha,
  authorLogin = 'boat1994',
  commentId = null,
  taskIssue = null,
  targetMode = null,
}: CreateFounderAuthorizationBodyOptions = {}) {
  const existing = targetMode === 'planning_no_pr'
  const record: JsonRecord = {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: authorLogin,
    comment_id: commentId == null ? '<immutable-comment-id>' : String(commentId),
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository,
    bundle_kind: existing ? EXISTING_TASK_BOOTSTRAP_AUTHORIZATION_BUNDLE : BOOTSTRAP_AUTHORIZATION_BUNDLE,
    parent_issue: Number(parentIssue),
    task_issue: existing ? Number(taskIssue) : null,
    pr: existing ? null : pullRequest,
    exact_head: existing ? null : head,
    reviewed_head: existing ? null : head,
    base,
    policy_source: policySource,
    policy_source_sha: policySha,
    protected_base_sha: protectedBaseSha,
    policy_version: policyVersion,
    scope: BOOTSTRAP_AUTHORIZATION_SCOPE,
    action: BOOTSTRAP_AUTHORIZATION_ACTION,
  }
  if (existing) record.target_mode = targetMode
  return JSON.stringify(record, null, 2)
}

function readOptionalProperty(value: unknown, key: string): unknown {
  return value == null ? undefined : Reflect.get(Object(value), key)
}

function normalizeCommentAuthor(comment: AuthorizationComment | undefined): unknown {
  return readOptionalProperty(comment?.user, 'login') ??
    readOptionalProperty(comment?.author, 'login') ??
    comment?.author_login ??
    null
}

function supersedesComment(comment: unknown, targetId: unknown): boolean {
  let candidate: JsonRecord
  try {
    candidate = parseFounderTaskBootstrapAuthorization(String(readOptionalProperty(comment, 'body') ?? ''))
  } catch {
    return false
  }
  const ids = [
    candidate.supersedes_comment_id,
    ...(Array.isArray(candidate.supersedes_comment_ids) ? candidate.supersedes_comment_ids : []),
  ].filter((id) => id != null).map(String)
  return ids.includes(String(targetId))
}

export function validateFounderTaskBootstrapAuthorization({
  authorization,
  authorizationComment,
  parentIssue,
  repository,
  founderLogins,
  parentComments = [],
  expected = BOOTSTRAP_CONTRACT,
}: ValidateFounderTaskBootstrapAuthorizationOptions = {}): FounderTaskBootstrapAuthorizationResult {
  if (!isJsonRecord(authorization)) authorizationError('record is missing')
  const author = normalizeCommentAuthor(authorizationComment)
  const existing = authorization.bundle_kind === EXISTING_TASK_BOOTSTRAP_AUTHORIZATION_BUNDLE
  const expectedConditions = [
    authorization.schema_version === 1,
    authorization.status === 'approved',
    authorization.authority === 'Founder',
    typeof authorization.author_login === 'string' && authorization.author_login === author,
    Array.isArray(founderLogins) && founderLogins.length > 0 && founderLogins.includes(author),
    authorization.immutable_comment_reference === true,
    authorization.non_superseded === true,
    authorization.superseded_by == null,
    authorization.repository === repository,
    authorization.bundle_kind === (existing ? EXISTING_TASK_BOOTSTRAP_AUTHORIZATION_BUNDLE : BOOTSTRAP_AUTHORIZATION_BUNDLE),
    Number(authorization.parent_issue) === Number(existing ? authorization.task_issue : expected.parentIssue),
    existing ? Number(authorization.task_issue) > 0 : authorization.task_issue == null,
    existing ? authorization.target_mode === 'planning_no_pr' : String(authorization.pr) === String(expected.pullRequest),
    existing ? authorization.pr == null : authorization.exact_head === expected.head,
    existing ? authorization.exact_head == null && authorization.reviewed_head == null : authorization.reviewed_head === expected.head,
    authorization.base === expected.base,
    authorization.policy_source === expected.policySource,
    authorization.policy_source_sha === expected.policySha,
    authorization.protected_base_sha === expected.protectedBaseSha,
    authorization.policy_version === expected.policyVersion,
    authorization.scope === BOOTSTRAP_AUTHORIZATION_SCOPE,
    authorization.action === BOOTSTRAP_AUTHORIZATION_ACTION,
    String(authorizationComment?.id) === String(authorization.comment_id),
  ]
  if (existing && Number(authorization.parent_issue) !== Number(authorization.task_issue)) authorizationError('existing-task authorization parent and target Issue must be identical')
  if (expectedConditions.some((value) => !value)) authorizationError('record does not bind the trusted Founder, target, scope, policy, or comment identity')
  if (parentIssue?.number != null && String(parentIssue.number) !== String(existing ? authorization.task_issue : expected.parentIssue)) authorizationError(existing ? 'authorization parent Issue does not match the authorized target' : 'authorization parent Issue does not match the genesis parent')
  if (authorizationComment?.issue_number != null && String(authorizationComment.issue_number) !== String(existing ? authorization.task_issue : expected.parentIssue)) authorizationError(existing ? 'authorization comment is not attached to the authorized Issue' : 'authorization comment is not attached to the parent Issue')
  const laterSuperseder = parentComments.some((comment) =>
    String(readOptionalProperty(comment, 'id')) !== String(authorizationComment?.id) && supersedesComment(comment, authorizationComment?.id),
  )
  if (laterSuperseder) authorizationError('authorization was explicitly superseded')
  return {
    valid: true,
    authorLogin: author,
    commentId: String(authorizationComment!.id),
    bodySha256: createHash('sha256').update(String(authorizationComment!.body ?? ''), 'utf8').digest('hex'),
    authorization,
  }
}
