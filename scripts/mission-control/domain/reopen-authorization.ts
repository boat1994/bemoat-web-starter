import { createHash } from 'node:crypto'

import {
  parseFounderMergeAuthorization,
  validateFounderAuthorizationRecord,
} from '../../mission-control-merge.mjs'
import { cloneReopenValue } from './reopen-state-projection.ts'

type Mapping = Record<string, unknown>
type AuthorizationOptions = Mapping & {
  authorizationComment: unknown
  repo: unknown
  issueNumber: unknown
  expectedPr: unknown
  expectedBase: unknown
  expectedOldHead: unknown
  expectedNewHead: unknown
  expectedReviewCycle: unknown
}
type AuthorizationInput = {
  authorization: Mapping
  comment: unknown
  comments: unknown[]
  trustedFounderLogins: unknown
  state: Mapping
  pr: Mapping
  options: AuthorizationOptions
}

export const REOPEN_AUTHORIZATION_BUNDLE_KIND = 'founder-reopen'

function stateConflict(message: unknown): Error {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message: unknown): Error {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function isObject(value: unknown): value is Mapping {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined
}

function normalizeId(value: unknown): string | null {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}

function normalizeSha(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex')
}

function requiredAlias(record: Mapping, names: string[], label: string): string {
  const entries = names
    .filter((name) => Object.hasOwn(record, name))
    .map((name) => record[name])
  if (entries.length === 0 || entries.some((value) => value === null || value === undefined || value === '')) {
    throw stateConflict(`Founder authorization ${label} is required`)
  }
  const normalized = entries.map((value) => String(value))
  if (new Set(normalized).size !== 1) {
    throw stateConflict(`Founder authorization ${label} is conflicting`)
  }
  return normalized[0]
}

export function parseFounderReopenAuthorization(body = ''): Mapping {
  try {
    const authorization: unknown = parseFounderMergeAuthorization(String(body))
    if (!isObject(authorization)) throw new Error('record must be one JSON object')
    return authorization
  } catch (error) {
    throw stateConflict(`Founder authorization evidence is not canonical: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function commentAuthor(comment: unknown): unknown {
  return field(field(comment, 'user'), 'login') ?? field(field(comment, 'author'), 'login') ?? field(comment, 'author_login') ?? null
}

function commentSupersedesId(comment: unknown, targetId: unknown): boolean {
  const body = String(field(comment, 'body') ?? '')
  if (
    body.includes(`supersedes: ${targetId}`) ||
    body.includes(`superseded_comment_id: ${targetId}`) ||
    (body.includes(String(targetId)) && /superseded|not authoritative/i.test(body))
  ) {
    return true
  }
  try {
    const record = parseFounderReopenAuthorization(body)
    const supersedesCommentIds = field(record, 'supersedes_comment_ids')
    const ids = [
      field(record, 'supersedes_comment_id'),
      ...(Array.isArray(supersedesCommentIds) ? supersedesCommentIds : []),
    ].filter((id) => id !== null && id !== undefined).map(String)
    return ids.includes(String(targetId))
  } catch {
    return false
  }
}

function assertCommentIdentity(comment: unknown, options: AuthorizationOptions): unknown {
  if (!comment || String(field(comment, 'id')) !== String(options.authorizationComment)) {
    throw stateConflict('Founder authorization comment ID is not the immutable live comment')
  }
  const expectedIssueUrl = `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`
  if (field(comment, 'issue_url') !== expectedIssueUrl) {
    throw stateConflict('Founder authorization comment is not attached to the Task Issue')
  }
  const author = commentAuthor(comment)
  if (!author || field(comment, 'author_association') !== 'OWNER') {
    throw stateConflict('Founder authorization comment is not authored by an authenticated OWNER')
  }
  return author
}

function assertNoCompetingAuthorization(comments: unknown[], targetComment: unknown, options: AuthorizationOptions): void {
  const targetId = String(field(targetComment, 'id'))
  for (const comment of comments) {
    if (String(field(comment, 'id')) === targetId) continue
    if (commentSupersedesId(comment, targetId)) {
      throw stateConflict(`Founder authorization ${targetId} is superseded by comment ${field(comment, 'id')}`)
    }

    let candidate: Mapping | null
    try {
      candidate = parseFounderReopenAuthorization(String(field(comment, 'body') ?? ''))
    } catch {
      candidate = null
    }
    if (
      field(candidate, 'bundle_kind') === REOPEN_AUTHORIZATION_BUNDLE_KIND &&
      normalizeId(field(candidate, 'task_issue')) === String(options.issueNumber) &&
      normalizeId(field(candidate, 'pr')) === String(options.expectedPr)
    ) {
      throw stateConflict(`competing Founder reopen authorization comment ${field(comment, 'id')} exists`)
    }
  }
}

function assertBoundedScope(value: unknown): string | unknown[] {
  if (typeof value === 'string') {
    if (value.trim()) return value
  } else if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.trim())
  ) {
    return cloneReopenValue(value)
  }
  throw stateConflict('Founder authorization bounded correction scope is required')
}

function assertFindingIds(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim()) ||
    new Set(value).size !== value.length
  ) {
    throw stateConflict('Founder authorization finding_ids must be a non-empty unique array')
  }
  return [...value]
}

export function assertFounderAuthorization({
  authorization,
  comment,
  comments,
  trustedFounderLogins,
  state,
  pr,
  options,
}: AuthorizationInput): {
  comment: unknown
  authorization: Mapping
  comments: unknown[]
  trustedFounderLogins: unknown[]
} {
  const author = assertCommentIdentity(comment, options)
  if (authorization.author_login !== author) {
    throw stateConflict('Founder authorization author_login does not match the live comment author')
  }
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw blockedExternal('repository-owned Founder identity configuration is unavailable')
  }

  const commentId = requiredAlias(authorization, ['comment_id', 'immutable_comment_id'], 'comment_id')
  if (commentId !== String(options.authorizationComment)) {
    throw stateConflict('Founder authorization comment_id does not match the immutable comment')
  }
  if (authorization.comment_id != null && authorization.immutable_comment_id != null &&
      String(authorization.comment_id) !== String(authorization.immutable_comment_id)) {
    throw stateConflict('Founder authorization comment IDs conflict')
  }
  if (authorization.immutable_comment_reference !== true) {
    throw stateConflict('Founder authorization immutable_comment_reference must be true')
  }
  if (authorization.non_superseded !== true || authorization.superseded_by != null) {
    throw stateConflict('Founder authorization is already superseded')
  }

  const bodyHash = hashBody(field(comment, 'body'))
  if (authorization.comment_sha256 != null && authorization.comment_sha256 !== bodyHash) {
    throw stateConflict('Founder authorization comment_sha256 does not match the immutable comment body')
  }
  assertNoCompetingAuthorization(comments, comment, options)

  if (
    authorization.schema_version !== 1 ||
    authorization.status !== 'approved' ||
    authorization.authority !== 'Founder' ||
    authorization.repository !== options.repo ||
    authorization.bundle_kind !== REOPEN_AUTHORIZATION_BUNDLE_KIND ||
    authorization.scope !== 'correction' ||
    authorization.action !== 'reopen'
  ) {
    throw stateConflict('Founder authorization record has an invalid status, repository, bundle, scope, or action')
  }
  const taskIssue = requiredAlias(authorization, ['task_issue'], 'Task Issue')
  if (normalizeId(taskIssue) !== String(options.issueNumber)) {
    throw stateConflict('Founder authorization Task Issue does not match the requested Issue')
  }
  const pullRequest = requiredAlias(authorization, ['pr'], 'PR')
  if (normalizeId(pullRequest) !== String(options.expectedPr)) {
    throw stateConflict('Founder authorization PR does not match the requested PR')
  }
  if (
    authorization.base !== options.expectedBase ||
    authorization.approved_base !== options.expectedBase ||
    authorization.policy_source_sha !== state.guide_source_sha ||
    authorization.policy_version !== state.guide_version ||
    authorization.protected_base_sha !== pr.baseRefOid
  ) {
    throw stateConflict('Founder authorization policy or protected-base evidence does not match live evidence')
  }

  const oldHead = requiredAlias(
    authorization,
    ['old_reviewed_head', 'previous_reviewed_head', 'prior_reviewed_head'],
    'old_reviewed_head',
  )
  if (normalizeSha(oldHead) !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict('Founder authorization old_reviewed_head does not match the reviewed head')
  }
  if (normalizeSha(authorization.exact_head) !== normalizeSha(options.expectedNewHead) ||
      normalizeSha(authorization.reviewed_head) !== normalizeSha(options.expectedNewHead)) {
    throw stateConflict('Founder authorization exact_head/reviewed_head must bind the authorized new live head')
  }

  const base = requiredAlias(authorization, ['base'], 'approved_base')
  if (authorization.base != null && authorization.approved_base != null &&
      authorization.base !== authorization.approved_base) {
    throw stateConflict('Founder authorization base bindings conflict')
  }
  if (base !== options.expectedBase || state.approved_base !== options.expectedBase || pr.baseRefName !== options.expectedBase) {
    throw stateConflict('Founder authorization approved base does not match live state and PR')
  }

  const reviewCycle = requiredAlias(authorization, ['review_cycle', 'for_review_number'], 'review_cycle')
  if (reviewCycle !== String(options.expectedReviewCycle)) {
    throw stateConflict('Founder authorization review cycle does not match managed state')
  }
  const reviewCommentId = requiredAlias(
    authorization,
    ['review_verdict_comment_id'],
    'original REVIEW_VERDICT comment ID',
  )
  if (reviewCommentId !== String(state.latest_review_verdict_comment_id)) {
    throw stateConflict('Founder authorization REVIEW_VERDICT lineage does not match managed state')
  }
  const resultCommentId = requiredAlias(
    authorization,
    ['original_result_comment_id'],
    'original RESULT comment ID',
  )
  if (resultCommentId !== String(state.latest_result_comment_id)) {
    throw stateConflict('Founder authorization RESULT lineage does not match managed state')
  }

  const boundedScope = assertBoundedScope(
    authorization.bounded_correction_scope ?? authorization.bounded_scope,
  )
  const correctionReason = authorization.correction_reason ?? authorization.reason
  if (typeof correctionReason !== 'string' || !correctionReason.trim()) {
    throw stateConflict('Founder authorization correction reason is required')
  }
  if (
    authorization.delta_review_requirement !== true &&
    authorization.delta_review_requirement !== 'Delta Review'
  ) {
    throw stateConflict('Founder authorization must require exactly one Delta Review')
  }
  if (authorization.required_next_review != null && authorization.required_next_review !== 'Delta Review') {
    throw stateConflict('Founder authorization required_next_review must be Delta Review')
  }
  if (authorization.maximum_correction_deliveries !== 1) {
    throw stateConflict('Founder authorization maximum_correction_deliveries must be 1')
  }
  const authorizationId = authorization.authorization_id
  if (typeof authorizationId !== 'string' || !authorizationId.trim()) {
    throw stateConflict('Founder authorization authorization_id is required and must not be synthesized')
  }

  const normalized: Mapping = {
    ...cloneReopenValue(authorization),
    comment_id: String(options.authorizationComment),
    immutable_comment_id: String(options.authorizationComment),
    comment_sha256: bodyHash,
    immutable_comment_reference: true,
    non_superseded: true,
    superseded_by: null,
    repository: options.repo,
    task_issue: Number(options.issueNumber),
    pr: Number(options.expectedPr),
    exact_head: normalizeSha(options.expectedNewHead),
    reviewed_head: normalizeSha(options.expectedNewHead),
    old_reviewed_head: normalizeSha(oldHead),
    base: options.expectedBase,
    approved_base: options.expectedBase,
    policy_source_sha: state.guide_source_sha,
    protected_base_sha: pr.baseRefOid,
    policy_version: state.guide_version,
    bundle_kind: REOPEN_AUTHORIZATION_BUNDLE_KIND,
    scope: 'correction',
    action: 'reopen',
    review_cycle: Number(options.expectedReviewCycle),
    for_review_number: Number(options.expectedReviewCycle),
    review_verdict_comment_id: reviewCommentId,
    original_review_verdict_comment_id: reviewCommentId,
    original_result_comment_id: resultCommentId,
    correction_reason: correctionReason,
    bounded_correction_scope: boundedScope,
    required_next_review: 'Delta Review',
    delta_review_requirement: true,
    maximum_correction_deliveries: 1,
    finding_ids: assertFindingIds(authorization.finding_ids),
    authorization_id: authorizationId,
    authorized_at: authorization.authorized_at ?? field(comment, 'created_at') ?? field(comment, 'createdAt'),
  }
  if (typeof normalized.authorized_at !== 'string' || !normalized.authorized_at) {
    throw stateConflict('Founder authorization authorized_at is required')
  }

  try {
    validateFounderAuthorizationRecord({
      authorization: normalized,
      authorizationCommentId: options.authorizationComment,
      trustedFounderLogins,
      expected: {
        repository: options.repo,
        taskIssue: Number(options.issueNumber),
        pr: Number(options.expectedPr),
        exactHead: normalizeSha(options.expectedNewHead),
        base: options.expectedBase,
        bundleKind: REOPEN_AUTHORIZATION_BUNDLE_KIND,
        policySourceSha: state.guide_source_sha,
        protectedBaseSha: pr.baseRefOid,
        policyVersion: state.guide_version,
        reviewCommentId,
        scope: 'correction',
        action: 'reopen',
      },
    })
  } catch (error) {
    throw stateConflict(`Founder authorization canonical verification failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    comment: cloneReopenValue(comment),
    authorization: normalized,
    comments: cloneReopenValue(comments),
    trustedFounderLogins: [...trustedFounderLogins],
  }
}
