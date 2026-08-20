import { createHash } from 'node:crypto'
import { LEASE_MARKER } from './task-bootstrap-lease.ts'
import { BOOTSTRAP_CONTRACT } from './task-bootstrap-authorization.ts'

export const IMMUTABLE_EXISTING_AUTHORIZATION_FORMAT = 'task-bootstrap-existing-v2'

export type FounderAuthorizationRecordingContext = Readonly<{
  repository: string
  issueNumber: number
  protectedBaseSha: string
  policySource: string
  policyVersion: string
  policySha: string
  policySourceCommit: string
  founderLogin: string
}>

type Comment = {
  id?: unknown
  body?: unknown
  issue_number?: unknown
  user?: { login?: unknown } | null
  author?: { login?: unknown } | null
  author_login?: unknown
}

type RecordingOptions = Readonly<{
  context: FounderAuthorizationRecordingContext
  readComments: () => Promise<readonly Comment[]>
  postComment: (issueNumber: number, body: string) => Promise<Comment>
  readComment: (commentId: string) => Promise<Comment>
  readContext?: () => Promise<FounderAuthorizationRecordingContext>
  acquireLease: (request: { issueNumber: number; requestId: string; scope: string; expectedBodySha256: string }) => Promise<unknown>
  releaseLease: (request: { issueNumber: number; requestId: string; scope: string; lease: unknown }) => Promise<unknown>
}>

type RecordingResult = Readonly<{
  classification: 'SUCCESS' | 'NO_OP_IDENTICAL_RETRY'
  commentId: string
  body: string
  bodySha256: string
  mutationPerformed: boolean
}>

const CANONICAL_RESULT_CLASSIFICATIONS = new Set([
  'HELP',
  'SUCCESS',
  'NO_OP_IDENTICAL_RETRY',
  'INVALID_INVOCATION',
  'UNSUPPORTED_PRE_STATE',
  'STATE_CONFLICT',
  'AUTHORITY_CONFLICT',
  'HEAD_DRIFT',
  'BLOCKED_EXTERNAL',
  'EVIDENCE_CONFLICT',
  'AMBIGUOUS_RESULT',
  'INTERNAL_ERROR',
])

function recordingError(classification: string, message: string, mutationPerformed = false) {
  return Object.assign(new Error(message), { classification, mutationPerformed })
}

function errorClassification(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const record = error as Record<string, unknown>
  const value = record.classification ?? record.code
  return typeof value === 'string' ? value : null
}

function isCanonicalResultClassification(value: string | null): value is string {
  return value !== null && CANONICAL_RESULT_CLASSIFICATIONS.has(value)
}

function commentAuthor(comment: Comment): string {
  return String(comment.user?.login ?? comment.author?.login ?? comment.author_login ?? '')
}

function sameBody(comment: Comment, body: string): boolean {
  return typeof comment.body === 'string' && comment.body === body
}

function validateCommentBinding(comment: Comment, context: FounderAuthorizationRecordingContext, body: string, mutationPerformed = true) {
  if (!comment.id || !/^\d+$/.test(String(comment.id))) throw recordingError('AMBIGUOUS_RESULT', 'authorization POST/readback did not yield an immutable numeric comment ID', mutationPerformed)
  if (!sameBody(comment, body)) throw recordingError('STATE_CONFLICT', 'authorization comment body changed between POST and readback', mutationPerformed)
  if (commentAuthor(comment) !== context.founderLogin) throw recordingError('STATE_CONFLICT', 'authorization comment actor is not the trusted Founder', mutationPerformed)
  if (!Number.isSafeInteger(Number(comment.issue_number)) || Number(comment.issue_number) <= 0 || Number(comment.issue_number) !== context.issueNumber) throw recordingError('STATE_CONFLICT', 'authorization comment is not positively bound to the target Issue', mutationPerformed)
}

function validatePolicyIdentity(context: FounderAuthorizationRecordingContext) {
  const fullLowerSha = /^[0-9a-f]{40}$/
  if (!fullLowerSha.test(context.protectedBaseSha) || !fullLowerSha.test(context.policySha) || !fullLowerSha.test(context.policySourceCommit)) throw recordingError('STATE_CONFLICT', 'protected main or Mission Control policy identity is not a full lowercase SHA')
  if (context.policySource !== BOOTSTRAP_CONTRACT.policySource || context.policyVersion !== BOOTSTRAP_CONTRACT.policyVersion) throw recordingError('STATE_CONFLICT', 'Mission Control policy path or version does not match the protected contract')
  if (context.policySourceCommit !== context.protectedBaseSha) throw recordingError('STATE_CONFLICT', 'Mission Control policy source commit does not match protected main')
}

function supersedes(comment: Comment, targetId: string): boolean {
  if (typeof comment.body !== 'string') return false
  try {
    const parsed = JSON.parse(comment.body) as Record<string, unknown>
    const ids = [parsed.supersedes_comment_id, ...(Array.isArray(parsed.supersedes_comment_ids) ? parsed.supersedes_comment_ids : [])]
    return ids.some((id) => String(id) === targetId)
  } catch {
    return false
  }
}

function assertNotSuperseded(comments: readonly Comment[], id: string) {
  if (comments.some((comment) => String(comment.id) !== id && supersedes(comment, id))) throw recordingError('STATE_CONFLICT', 'Founder authorization is superseded')
}

function parseFinalBody(body: string, context: FounderAuthorizationRecordingContext) {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(body) } catch { throw recordingError('EVIDENCE_CONFLICT', 'authorization body is not valid JSON') }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw recordingError('EVIDENCE_CONFLICT', 'authorization body must be one raw JSON object')
  const keys = [...body.matchAll(/"([^"\\]+)"\s*:/g)].map((match) => match[1])
  if (new Set(keys).size !== keys.length) throw recordingError('EVIDENCE_CONFLICT', 'authorization body contains duplicate JSON keys')
  const expected: Record<string, unknown> = {
    authorization_format: IMMUTABLE_EXISTING_AUTHORIZATION_FORMAT,
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: context.founderLogin,
    comment_id: null,
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository: context.repository,
    bundle_kind: 'task-bootstrap-existing',
    parent_issue: context.issueNumber,
    task_issue: context.issueNumber,
    pr: null,
    exact_head: null,
    reviewed_head: null,
    base: 'main',
    policy_source: context.policySource,
    policy_source_sha: context.policySha,
    protected_base_sha: context.protectedBaseSha,
    policy_version: context.policyVersion,
    scope: 'task-initialization',
    action: 'create-managed-task',
    target_mode: 'planning_no_pr',
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in parsed) || parsed[key] !== value) throw recordingError('EVIDENCE_CONFLICT', `authorization body does not bind ${key}`)
  }
  return parsed
}

function looksAuthorizationShaped(body: unknown): boolean {
  const text = String(body ?? '')
  if (text.includes(LEASE_MARKER)) return false
  return /\bFOUNDER_DECISION\b/i.test(text) || /"(?:authorization_format|bundle_kind|scope|action|authority|comment_id)"\s*:/.test(text)
}

function classifyExistingAuthorizationComments(comments: readonly Comment[], context: FounderAuthorizationRecordingContext, body: string): Comment[] {
  const matches: Comment[] = []
  for (const comment of comments) {
    if (!looksAuthorizationShaped(comment.body)) continue
    if (!sameBody(comment, body)) throw recordingError('STATE_CONFLICT', 'conflicting, malformed, or semantically different authorization evidence already exists', false)
    if (!/^\d+$/.test(String(comment.id ?? '')) || commentAuthor(comment) !== context.founderLogin || !Number.isSafeInteger(Number(comment.issue_number)) || Number(comment.issue_number) !== context.issueNumber) throw recordingError('STATE_CONFLICT', 'authorization evidence has an invalid identity or Issue binding', false)
    matches.push(comment)
  }
  return matches
}

function sameContext(left: FounderAuthorizationRecordingContext, right: FounderAuthorizationRecordingContext): boolean {
  const keys: (keyof FounderAuthorizationRecordingContext)[] = ['repository', 'issueNumber', 'protectedBaseSha', 'policySource', 'policyVersion', 'policySha', 'policySourceCommit', 'founderLogin']
  return keys.every((key) => left[key] === right[key])
}

export function buildExistingTaskAuthorizationBody(context: FounderAuthorizationRecordingContext): string {
  return JSON.stringify({
    authorization_format: IMMUTABLE_EXISTING_AUTHORIZATION_FORMAT,
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: context.founderLogin,
    comment_id: null,
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository: context.repository,
    bundle_kind: 'task-bootstrap-existing',
    parent_issue: context.issueNumber,
    task_issue: context.issueNumber,
    pr: null,
    exact_head: null,
    reviewed_head: null,
    base: 'main',
    policy_source: context.policySource,
    policy_source_sha: context.policySha,
    protected_base_sha: context.protectedBaseSha,
    policy_version: context.policyVersion,
    scope: 'task-initialization',
    action: 'create-managed-task',
    target_mode: 'planning_no_pr',
  }, null, 2)
}

export async function recordFounderAuthorization(options: RecordingOptions): Promise<RecordingResult> {
  const { context } = options
  if (context.repository !== 'boat1994/bemoat-web-starter') throw recordingError('STATE_CONFLICT', 'authorization repository is outside the protected starter')
  if (!Number.isSafeInteger(context.issueNumber) || context.issueNumber <= 0) throw recordingError('STATE_CONFLICT', 'authorization target Issue is invalid')
  if (typeof options.acquireLease !== 'function' || typeof options.releaseLease !== 'function') throw recordingError('STATE_CONFLICT', 'authorization recording requires repository coordination')
  validatePolicyIdentity(context)
  const body = buildExistingTaskAuthorizationBody(context)
  parseFinalBody(body, context)
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  const requestId = `founder-authorization-v2-${bodySha256}`
  let lease: unknown
  let mutationPerformed = false
  let primaryError: unknown = null
  try {
    try { lease = await options.acquireLease({ issueNumber: context.issueNumber, requestId, scope: 'founder-authorization-recording', expectedBodySha256: bodySha256 }) } catch (error) {
      const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null
      const suppliedClassification = typeof record?.classification === 'string' ? record.classification : null
      const suppliedCode = typeof record?.code === 'string' ? record.code : null
      if (suppliedClassification === 'STATE_CONFLICT') throw error
      if (suppliedClassification === 'CAS_CONFLICT' || suppliedCode === 'CAS_CONFLICT' || suppliedCode === 'STATE_CONFLICT') {
        throw recordingError('STATE_CONFLICT', `authorization coordination lease contention is deterministic: ${error instanceof Error ? error.message : String(error)}`, false)
      }
      throw recordingError('AMBIGUOUS_RESULT', `authorization coordination read/write is uncertain: ${error instanceof Error ? error.message : String(error)}`, false)
    }
    const readAndClassify = async () => {
      try {
        const comments = await options.readComments()
        return { comments, matches: classifyExistingAuthorizationComments(comments, context, body) }
      } catch (error) {
        if (error instanceof Error && 'classification' in error && error.classification === 'STATE_CONFLICT') throw error
        throw recordingError('AMBIGUOUS_RESULT', `authorization evidence readback is uncertain: ${error instanceof Error ? error.message : String(error)}`, false)
      }
    }
    let snapshot = await readAndClassify()
    let existing = snapshot.matches
    if (existing.length > 1) throw recordingError('STATE_CONFLICT', 'multiple identical Founder authorization comments are durable', false)
    if (existing.length === 1) {
      const durable = existing[0]
      const readback = await options.readComment(String(durable.id)).catch((error) => { throw recordingError('AMBIGUOUS_RESULT', `authorization replay readback is uncertain: ${error instanceof Error ? error.message : String(error)}`, false) })
      validateCommentBinding(readback, context, body, false)
      if (String(readback.id) !== String(durable.id)) throw recordingError('STATE_CONFLICT', 'identical authorization replay readback returned a different immutable comment ID', false)
      assertNotSuperseded((await readAndClassify()).comments, String(durable.id))
      return { classification: 'NO_OP_IDENTICAL_RETRY', commentId: String(durable.id), body, bodySha256, mutationPerformed: false }
    }
    if (options.readContext) {
      let rereadContext: FounderAuthorizationRecordingContext
      try {
        rereadContext = await options.readContext()
      } catch (error) {
        const classification = errorClassification(error)
        if (isCanonicalResultClassification(classification)) {
          if (error instanceof Error) Object.assign(error, { mutationPerformed: false })
          throw error
        }
        throw recordingError('AMBIGUOUS_RESULT', `pre-POST trusted evidence reread is uncertain: ${error instanceof Error ? error.message : String(error)}`, false)
      }
      if (!sameContext(rereadContext, context)) throw recordingError('STATE_CONFLICT', 'protected base, policy, target Issue, repository, or Founder identity drifted before POST', false)
    }
    snapshot = await readAndClassify()
    existing = snapshot.matches
    if (existing.length > 0) throw recordingError('STATE_CONFLICT', 'authorization evidence changed before POST', false)
    let posted: Comment
    try {
      mutationPerformed = true
      posted = await options.postComment(context.issueNumber, body)
    } catch (error) {
      throw recordingError('AMBIGUOUS_RESULT', `authorization POST outcome is unknown: ${error instanceof Error ? error.message : String(error)}`, mutationPerformed)
    }
    validateCommentBinding(posted, context, body)
    let readback: Comment
    try { readback = await options.readComment(String(posted.id)) } catch (error) {
      throw recordingError('AMBIGUOUS_RESULT', `authorization POST could not be confirmed by live readback: ${error instanceof Error ? error.message : String(error)}`, true)
    }
    validateCommentBinding(readback, context, body)
    if (String(readback.id) !== String(posted.id)) throw recordingError('STATE_CONFLICT', 'authorization POST and individual readback returned different immutable comment IDs', true)
    try { assertNotSuperseded((await readAndClassify()).comments, String(posted.id)) } catch (error) {
      if (error instanceof Error && 'classification' in error && error.classification === 'STATE_CONFLICT') throw Object.assign(error, { mutationPerformed: true })
      throw recordingError('AMBIGUOUS_RESULT', `authorization supersession readback is ambiguous: ${error instanceof Error ? error.message : String(error)}`, true)
    }
    return { classification: 'SUCCESS', commentId: String(posted.id), body, bodySha256, mutationPerformed: true }
  } catch (error) {
    primaryError = error
    if (typeof error === 'object' && error !== null && (error as Record<string, unknown>).mutationPerformed === true) mutationPerformed = true
    throw error
  } finally {
    if (lease != null) {
      try {
        await options.releaseLease({ issueNumber: context.issueNumber, requestId, scope: 'founder-authorization-recording', lease })
      } catch (error) {
        const primaryClassification = errorClassification(primaryError)
        if (isCanonicalResultClassification(primaryClassification)) throw primaryError
        const releaseClassification = errorClassification(error)
        const classification = !mutationPerformed && (releaseClassification === 'STATE_CONFLICT' || releaseClassification === 'CAS_CONFLICT')
          ? 'STATE_CONFLICT'
          : 'AMBIGUOUS_RESULT'
        throw recordingError(classification, `authorization lease release is not proven: ${error instanceof Error ? error.message : String(error)}`, mutationPerformed)
      }
    }
  }
}
