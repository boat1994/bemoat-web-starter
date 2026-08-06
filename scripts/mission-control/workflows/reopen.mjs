import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import {
  parseFounderMergeAuthorization,
  validateFounderAuthorizationRecord,
} from '../../mission-control-merge.mjs'
import {
  parseMissionControlState,
  projectMissionControlStateBlock,
} from '../../mission-control-state.mjs'
import { writeIssueBodyWithLease } from '../../mission-control-issue-body-cas.mjs'
import { createHelpEnvelopeV1, formatTextHelp } from '../../cli/command-help.mjs'
import {
  CliInvocationError,
  parseCommandInvocation,
  resolveCommandIdentity,
} from '../../cli/command-invocation.mjs'
import {
  CLI_EXIT_CODES,
  classificationExitCode,
  createResultEnvelopeV1,
} from '../../cli/command-result.mjs'

export const REOPEN_AUTHORIZATION_BUNDLE_KIND = 'founder-reopen'
export const REOPEN_NEXT_ACTION = 'Execute exactly one bounded correction RESULT, then one Delta Review.'
export const REOPEN_USAGE = `Usage:
  pnpm run bemoat:mission-control:reopen -- <issue-number> [flags]

Required positional argument:
  <issue-number>                         Managed Task Issue number.

Required flags:
  --repo <owner/repository>              Repository containing the Task Issue.
  --expected-pr <number>                 Exact active PR number.
  --expected-base <branch>               Approved PR base branch.
  --expected-state <state>               Must be ELIGIBLE_FOR_FOUNDER_REVIEW.
  --expected-old-head <full-sha>         Immutable Review 1 head.
  --expected-new-head <full-sha>         Founder-authorized live correction head.
  --expected-review-cycle <number>       Existing review cycle; no increment.
  --expected-full-review-count <number>  Existing full-review count; no reset.
  --authorization-comment <id>           Immutable Founder authorization comment.

Authorization record:
  One raw JSON Founder record with the complete repository/Task/PR/base,
  old-head/new-head, policy, trusted identity, immutable comment, reason,
  bounded scope, one-delivery, and Delta Review bindings.

Supported pre-state and mutation:
  ELIGIBLE_FOR_FOUNDER_REVIEW -> FOUNDER_AUTHORIZED_CORRECTION
  The old head remains last_reviewed_head; the new head becomes unreviewed
  current_head. Counters and original RESULT/REVIEW_VERDICT identities remain.

Classifications:
  REOPENED, NO_OP, STATE_CONFLICT, or BLOCKED_EXTERNAL.

Example:
  pnpm run bemoat:mission-control:reopen -- 284 --repo boat1994/bemoat-web-starter \\
    --expected-pr 285 --expected-base main \\
    --expected-state ELIGIBLE_FOR_FOUNDER_REVIEW \\
    --expected-old-head <review-1-sha> --expected-new-head <correction-sha> \\
    --expected-review-cycle 1 --expected-full-review-count 1 \\
    --authorization-comment <immutable-comment-id>

Safe recovery:
  Stop on any drift, ambiguous write, or failed readback; reconcile the live
  Issue/PR evidence and obtain a fresh Founder authorization before retrying.`

const POSITIVE_ID_RE = /^[1-9]\d*$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const REOPEN_STATE = 'ELIGIBLE_FOR_FOUNDER_REVIEW'
const CORRECTION_STATE = 'FOUNDER_AUTHORIZED_CORRECTION'
const REOPEN_COMMAND = 'bemoat:mission-control:reopen'
const ENTRYPOINT = 'scripts/mission-control-reopen.mjs'

function stateConflict(message) {
  return new Error(`STATE_CONFLICT: ${message}`)
}

function blockedExternal(message) {
  return new Error(`BLOCKED_EXTERNAL: ${message}`)
}

function clone(value) {
  return structuredClone(value)
}

function normalizeId(value) {
  const match = String(value ?? '').match(/^#?([1-9]\d*)$/)
  return match?.[1] ?? null
}

function normalizeSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value) ? value.toLowerCase() : null
}

function hashBody(body) {
  return createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex')
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left)) {
    return Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
  }
  if (Array.isArray(right)) return false
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]))
  }
  return false
}

function requireValue(options, key) {
  if (options[key] === null || options[key] === undefined || options[key] === '') {
    throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`)
  }
}

function requiredAlias(record, names, label) {
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

function parseExpectedNumber(value, label) {
  if (!POSITIVE_ID_RE.test(String(value ?? ''))) {
    throw stateConflict(`${label} must be a positive integer`)
  }
  return Number(value)
}

export function parseReopenArgs(argv = []) {
  if (argv.some((argument) => argument === '--help' || argument === '-h')) {
    return { help: true }
  }

  const options = {
    issueNumber: null,
    repo: null,
    expectedPr: null,
    expectedBase: null,
    expectedState: null,
    expectedOldHead: null,
    expectedNewHead: null,
    expectedReviewCycle: null,
    expectedFullReviewCount: null,
    authorizationComment: null,
  }
  const flags = {
    '--repo': 'repo',
    '--expected-pr': 'expectedPr',
    '--expected-base': 'expectedBase',
    '--expected-state': 'expectedState',
    '--expected-old-head': 'expectedOldHead',
    '--expected-new-head': 'expectedNewHead',
    '--expected-review-cycle': 'expectedReviewCycle',
    '--expected-full-review-count': 'expectedFullReviewCount',
    '--authorization-comment': 'authorizationComment',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    const key = flags[argument]
    if (key) {
      const value = argv[++index]
      if (!value || options[key] !== null) throw new Error(`${argument} requires one value`)
      options[key] = value
      continue
    }
    if (argument.startsWith('-') || options.issueNumber !== null) {
      throw new Error(`unexpected argument: ${argument}`)
    }
    options.issueNumber = argument
  }

  if (!POSITIVE_ID_RE.test(String(options.issueNumber ?? ''))) {
    throw new Error(REOPEN_USAGE)
  }
  for (const key of Object.keys(options).filter((key) => key !== 'issueNumber')) requireValue(options, key)

  if (options.expectedState !== REOPEN_STATE) {
    throw stateConflict(`--expected-state must be ${REOPEN_STATE}`)
  }
  if (!FULL_SHA_RE.test(options.expectedOldHead)) {
    throw stateConflict('--expected-old-head must be a full 40-character SHA')
  }
  if (!FULL_SHA_RE.test(options.expectedNewHead)) {
    throw stateConflict('--expected-new-head must be a full 40-character SHA')
  }
  if (options.expectedOldHead.toLowerCase() === options.expectedNewHead.toLowerCase()) {
    throw stateConflict('--expected-new-head must differ from --expected-old-head')
  }
  parseExpectedNumber(options.expectedPr, '--expected-pr')
  parseExpectedNumber(options.expectedReviewCycle, '--expected-review-cycle')
  parseExpectedNumber(options.expectedFullReviewCount, '--expected-full-review-count')
  if (!POSITIVE_ID_RE.test(options.authorizationComment)) {
    throw stateConflict('--authorization-comment must be a comment ID')
  }

  return options
}

export function parseFounderReopenAuthorization(body = '') {
  try {
    const authorization = parseFounderMergeAuthorization(String(body))
    if (!isObject(authorization)) throw new Error('record must be one JSON object')
    return authorization
  } catch (error) {
    throw stateConflict(`Founder authorization evidence is not canonical: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function commentAuthor(comment) {
  return comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null
}

function commentSupersedesId(comment, targetId) {
  const body = String(comment?.body ?? '')
  if (
    body.includes(`supersedes: ${targetId}`) ||
    body.includes(`superseded_comment_id: ${targetId}`) ||
    (body.includes(String(targetId)) && /superseded|not authoritative/i.test(body))
  ) {
    return true
  }
  try {
    const record = parseFounderReopenAuthorization(body)
    const ids = [
      record.supersedes_comment_id,
      ...(Array.isArray(record.supersedes_comment_ids) ? record.supersedes_comment_ids : []),
    ].filter((id) => id !== null && id !== undefined).map(String)
    return ids.includes(String(targetId))
  } catch {
    return false
  }
}

function assertCommentIdentity(comment, options) {
  if (!comment || String(comment.id) !== String(options.authorizationComment)) {
    throw stateConflict('Founder authorization comment ID is not the immutable live comment')
  }
  const expectedIssueUrl = `https://api.github.com/repos/${options.repo}/issues/${options.issueNumber}`
  if (comment.issue_url !== expectedIssueUrl) {
    throw stateConflict('Founder authorization comment is not attached to the Task Issue')
  }
  const author = commentAuthor(comment)
  if (!author || comment.author_association !== 'OWNER') {
    throw stateConflict('Founder authorization comment is not authored by an authenticated OWNER')
  }
  return author
}

function assertNoCompetingAuthorization(comments, targetComment, options) {
  const targetId = String(targetComment.id)
  for (const comment of comments) {
    if (String(comment?.id) === targetId) continue
    if (commentSupersedesId(comment, targetId)) {
      throw stateConflict(`Founder authorization ${targetId} is superseded by comment ${comment.id}`)
    }

    let candidate
    try {
      candidate = parseFounderReopenAuthorization(comment.body)
    } catch {
      candidate = null
    }
    if (
      candidate?.bundle_kind === REOPEN_AUTHORIZATION_BUNDLE_KIND &&
      normalizeId(candidate.task_issue) === String(options.issueNumber) &&
      normalizeId(candidate.pr) === String(options.expectedPr)
    ) {
      throw stateConflict(`competing Founder reopen authorization comment ${comment.id} exists`)
    }
  }
}

function assertBoundedScope(value) {
  if (typeof value === 'string') {
    if (value.trim()) return value
  } else if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.trim())
  ) {
    return clone(value)
  }
  throw stateConflict('Founder authorization bounded correction scope is required')
}

function assertFindingIds(value) {
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

function assertFounderAuthorization({
  authorization,
  comment,
  comments,
  trustedFounderLogins,
  state,
  pr,
  options,
}) {
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

  const bodyHash = hashBody(comment.body)
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

  const normalized = {
    ...clone(authorization),
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
    authorized_at: authorization.authorized_at ?? comment.created_at ?? comment.createdAt,
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
    comment: clone(comment),
    authorization: normalized,
    comments: clone(comments),
    trustedFounderLogins: [...trustedFounderLogins],
  }
}

async function readAuthorizationEvidence({ deps, options, state, pr }) {
  if (typeof deps.readComment !== 'function' ||
      typeof deps.readIssueComments !== 'function' ||
      typeof deps.readTrustedFounderLogins !== 'function') {
    throw blockedExternal('reopen transport dependencies cannot prove complete Founder authorization evidence')
  }
  const [comment, comments, trustedFounderLogins] = await Promise.all([
    deps.readComment(options.repo, options.authorizationComment),
    deps.readIssueComments(options.repo, options.issueNumber),
    deps.readTrustedFounderLogins(options.repo),
  ])
  if (!Array.isArray(comments)) {
    throw blockedExternal('live Issue comments are unavailable for authorization verification')
  }
  const parsed = parseFounderReopenAuthorization(comment?.body)
  const evidence = assertFounderAuthorization({
    authorization: parsed,
    comment,
    comments,
    trustedFounderLogins,
    state,
    pr,
    options,
  })
  if (!comments.some((entry) =>
    String(entry?.id) === String(comment.id) &&
    String(entry?.body ?? '') === String(comment.body ?? '')
  )) {
    throw stateConflict('immutable Founder authorization comment is not present in the live Issue comment set')
  }
  return evidence
}

function assertIssueIdentity(issue, options) {
  if (!issue || String(issue.number) !== String(options.issueNumber)) {
    throw stateConflict('live Issue number does not match the requested Task Issue')
  }
  if (String(issue.state).toUpperCase() !== 'OPEN') {
    throw stateConflict('managed Task Issue is not open')
  }
}

function assertReviewLineage(state) {
  for (const [key, label] of [
    ['latest_result_comment_id', 'original RESULT comment ID'],
    ['latest_review_verdict_comment_id', 'original REVIEW_VERDICT comment ID'],
  ]) {
    if (!POSITIVE_ID_RE.test(String(state?.[key] ?? ''))) {
      throw stateConflict(`${label} is missing from managed Review 1 lineage`)
    }
  }
  if (state.post_budget_reviews != null &&
      (!Array.isArray(state.post_budget_reviews) || state.post_budget_reviews.length > 0)) {
    throw stateConflict('reopen transport cannot replace post-budget review lineage')
  }
}

function assertPreState(issue, state, options) {
  assertIssueIdentity(issue, options)
  if (!isObject(state)) throw stateConflict('managed state is unavailable')
  if (state.state !== options.expectedState) {
    throw stateConflict(`issue state is ${state.state}, expected ${options.expectedState}`)
  }
  if (normalizeId(state.active_task_issue) !== String(options.issueNumber)) {
    throw stateConflict('managed state active Task Issue does not match the requested Issue')
  }
  if (normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('managed state active PR does not match the requested PR')
  }
  if (normalizeSha(state.current_head) !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict(`current head is ${state.current_head}, expected ${options.expectedOldHead}`)
  }
  if (normalizeSha(state.last_reviewed_head) !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict(`last reviewed head is ${state.last_reviewed_head}, expected ${options.expectedOldHead}`)
  }
  if (state.approved_base !== options.expectedBase) {
    throw stateConflict(`approved base is ${state.approved_base}, expected ${options.expectedBase}`)
  }
  if (String(state.review_cycle) !== String(options.expectedReviewCycle)) {
    throw stateConflict(`review cycle is ${state.review_cycle}, expected ${options.expectedReviewCycle}`)
  }
  if (String(state.full_review_count) !== String(options.expectedFullReviewCount)) {
    throw stateConflict(`full review count is ${state.full_review_count}, expected ${options.expectedFullReviewCount}`)
  }
  if (!normalizeSha(state.guide_source_sha) || typeof state.guide_version !== 'string' || !state.guide_version) {
    throw stateConflict('managed policy version/source evidence is incomplete')
  }
  if (state.guide_source_ref !== options.expectedBase) {
    throw stateConflict('managed policy source ref differs from the approved base')
  }
  if (!Array.isArray(state.open_blockers) || !Array.isArray(state.follow_up_issues)) {
    throw stateConflict('managed blocker and follow-up lineage is incomplete')
  }
  assertReviewLineage(state)
}

function assertPrPreflight(pr, options, expectedHead) {
  if (!pr || Number(pr.number) !== Number(options.expectedPr)) {
    throw stateConflict('live PR number does not match the requested PR')
  }
  if (String(pr.state).toUpperCase() !== 'OPEN') {
    throw stateConflict('live PR is not open')
  }
  if (pr.isDraft === true) throw stateConflict('live PR is still draft')
  if (pr.baseRefName !== options.expectedBase) {
    throw stateConflict('live PR base differs from the approved base')
  }
  if (!normalizeSha(pr.baseRefOid)) {
    throw stateConflict('live PR protected-base SHA is unavailable or malformed')
  }
  if (normalizeSha(pr.headRefOid) !== normalizeSha(expectedHead)) {
    throw stateConflict(`live PR head is ${pr.headRefOid}, expected ${expectedHead}`)
  }
}

function assertOnlyBoundedStateChanges(before, after) {
  const allowed = new Set([
    'state',
    'current_head',
    'founder_correction_authorization',
    'next_permitted_action',
    'updated_at',
    'updated_by',
  ])
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const key of keys) {
    if (!allowed.has(key) && !sameValue(before?.[key], after?.[key])) {
      throw stateConflict(`reopen projection changed unrelated state field ${key}`)
    }
  }
}

function buildNextState(state, evidence, options) {
  const authorization = evidence.authorization
  const nextAuthorization = {
    ...clone(authorization),
    schema_version: 2,
    status: 'authorized',
    authority: 'Founder',
    scope: 'correction',
    action: 'reopen',
    for_review_number: Number(options.expectedReviewCycle),
    review_cycle: Number(options.expectedReviewCycle),
    authorization_id: authorization.authorization_id,
    reviewed_head: normalizeSha(options.expectedNewHead),
    old_reviewed_head: normalizeSha(options.expectedOldHead),
    exact_head: normalizeSha(options.expectedNewHead),
    finding_ids: clone(authorization.finding_ids),
    maximum_correction_deliveries: 1,
    correction_deliveries: 0,
    delta_review_requirement: true,
    required_next_review: 'Delta Review',
    delta_review_count: 0,
    correction_result_comment_id: null,
    delta_review_comment_id: null,
    merge_authorization_invalidated_head: normalizeSha(options.expectedOldHead),
    authorization_record: clone(authorization),
  }
  const nextState = {
    ...clone(state),
    state: CORRECTION_STATE,
    current_head: normalizeSha(options.expectedNewHead),
    next_permitted_action: REOPEN_NEXT_ACTION,
    founder_correction_authorization: nextAuthorization,
    updated_at: new Date().toISOString(),
    updated_by: 'Founder-authorized Reopen Transport',
  }
  assertOnlyBoundedStateChanges(state, nextState)
  return nextState
}

function assertPostState(issue, state, pr, evidence, options) {
  assertIssueIdentity(issue, options)
  if (!isObject(state) || state.state !== CORRECTION_STATE) {
    throw stateConflict('post-write Issue state is not FOUNDER_AUTHORIZED_CORRECTION')
  }
  if (state.current_head !== normalizeSha(options.expectedNewHead) ||
      state.last_reviewed_head !== normalizeSha(options.expectedOldHead) ||
      String(state.review_cycle) !== String(options.expectedReviewCycle) ||
      String(state.full_review_count) !== String(options.expectedFullReviewCount) ||
      state.approved_base !== options.expectedBase ||
      normalizeId(state.active_task_issue) !== String(options.issueNumber) ||
      normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('post-write state does not preserve the complete Review 1 lineage and counters')
  }
  if (String(state.latest_result_comment_id) !== String(evidence.authorization.original_result_comment_id) ||
      String(state.latest_review_verdict_comment_id) !== String(evidence.authorization.review_verdict_comment_id)) {
    throw stateConflict('post-write state changed the original RESULT or REVIEW_VERDICT identity')
  }
  if (state.guide_version !== evidence.authorization.policy_version ||
      state.guide_source_sha !== evidence.authorization.policy_source_sha) {
    throw stateConflict('post-write state changed policy lineage')
  }
  if (state.next_permitted_action !== REOPEN_NEXT_ACTION) {
    throw stateConflict('post-write state does not require one bounded correction and one Delta Review')
  }

  const authorization = state.founder_correction_authorization
  if (!isObject(authorization) ||
      authorization.schema_version !== 2 ||
      authorization.status !== 'authorized' ||
      authorization.authority !== 'Founder' ||
      authorization.scope !== 'correction' ||
      authorization.action !== 'reopen' ||
      authorization.authorization_id !== evidence.authorization.authorization_id ||
      authorization.old_reviewed_head !== normalizeSha(options.expectedOldHead) ||
      authorization.reviewed_head !== normalizeSha(options.expectedNewHead) ||
      authorization.exact_head !== normalizeSha(options.expectedNewHead) ||
      authorization.merge_authorization_invalidated_head !== normalizeSha(options.expectedOldHead) ||
      authorization.maximum_correction_deliveries !== 1 ||
      authorization.correction_deliveries !== 0 ||
      authorization.delta_review_requirement !== true ||
      authorization.required_next_review !== 'Delta Review' ||
      authorization.delta_review_count !== 0 ||
      authorization.correction_result_comment_id !== null ||
      authorization.delta_review_comment_id !== null ||
      !isObject(authorization.authorization_record) ||
      !sameValue(authorization.authorization_record, evidence.authorization)) {
    throw stateConflict('post-write Founder authorization record is incomplete or changed')
  }
  assertReviewLineage(state)
  assertPrPreflight(pr, options, options.expectedNewHead)
}

async function readIssueAndPr(deps, options) {
  if (typeof deps.readManagedIssue !== 'function' || typeof deps.readPullRequest !== 'function') {
    throw blockedExternal('reopen transport dependencies are incomplete')
  }
  const issue = await deps.readManagedIssue(options.issueNumber, options.repo)
  const state = issue?.managedState
  const pr = await deps.readPullRequest(options.expectedPr, options.repo)
  return { issue, state, pr }
}

function assertOptions(options) {
  if (!options || options.help) return
  for (const key of [
    'issueNumber',
    'repo',
    'expectedPr',
    'expectedBase',
    'expectedState',
    'expectedOldHead',
    'expectedNewHead',
    'expectedReviewCycle',
    'expectedFullReviewCount',
    'authorizationComment',
  ]) requireValue(options, key)
  if (options.expectedState !== REOPEN_STATE) throw stateConflict(`expected state must be ${REOPEN_STATE}`)
  if (!normalizeSha(options.expectedOldHead) || !normalizeSha(options.expectedNewHead)) {
    throw stateConflict('reopen heads must be full SHA values')
  }
}

async function runNoOp({ deps, options, issue, state, pr }) {
  assertIssueIdentity(issue, options)
  if (state.state !== CORRECTION_STATE) {
    throw stateConflict(`issue state is ${state.state}, expected ${CORRECTION_STATE}`)
  }
  if (normalizeId(state.active_task_issue) !== String(options.issueNumber) ||
      normalizeId(state.active_pr) !== String(options.expectedPr)) {
    throw stateConflict('post-state Task/PR ownership is incomplete')
  }
  if (state.last_reviewed_head !== normalizeSha(options.expectedOldHead)) {
    throw stateConflict('post-state last_reviewed_head does not preserve the old reviewed head')
  }
  if (state.current_head !== normalizeSha(options.expectedNewHead)) {
    throw stateConflict('post-state current_head does not match the requested new head')
  }
  if (String(state.review_cycle) !== String(options.expectedReviewCycle) ||
      String(state.full_review_count) !== String(options.expectedFullReviewCount)) {
    throw stateConflict('post-state counters changed')
  }
  assertPrPreflight(pr, options, options.expectedNewHead)
  const evidence = await readAuthorizationEvidence({ deps, options, state, pr })
  assertPostState(issue, state, pr, evidence, options)
  return { outcome: 'NO_OP', state }
}

export function createProductionDeps() {
  const runGh = defaultRunGh
  const readManagedIssue = async (issueNumber, repo) => {
    const issue = JSON.parse(runGh([
      'issue',
      'view',
      String(issueNumber),
      '--repo',
      repo,
      '--json',
      'number,id,title,body,state,stateReason',
    ]))
    const parsed = parseMissionControlState(issue.body)
    if (!parsed.present || !parsed.valid) {
      throw stateConflict(`Issue has invalid managed state: ${parsed.reason ?? 'missing state block'}`)
    }
    return { ...issue, managedState: parsed.state }
  }
  const readPullRequest = async (prNumber, repo) => JSON.parse(runGh([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repo,
    '--json',
    'number,state,isDraft,headRefOid,baseRefName,baseRefOid,statusCheckRollup',
  ]))
  const readComment = async (repo, commentId) => JSON.parse(runGh([
    'api',
    `repos/${repo}/issues/comments/${commentId}`,
  ]))
  const readIssueComments = async (repo, issueNumber) => {
    const pages = JSON.parse(runGh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ]))
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw blockedExternal('live Issue comment pagination is incomplete')
    }
    return pages.flat()
  }
  const readTrustedFounderLogins = async (repo) => {
    const variable = JSON.parse(runGh([
      'api',
      `repos/${repo}/actions/variables/BEMOAT_FOUNDER_LOGINS`,
    ]))
    const logins = String(variable.value ?? '')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean)
    if (
      logins.length === 0 ||
      logins.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login))
    ) {
      throw stateConflict('repository Actions variable BEMOAT_FOUNDER_LOGINS is invalid')
    }
    return logins
  }
  const writeIssueBody = async ({ repo, issueNumber, expectedBody, nextBody, transitionIdentity }) =>
    writeIssueBodyWithLease({
      repo,
      issueNumber,
      expectedBody,
      nextBody,
      transitionIdentity,
      holder: 'mission-control-reopen',
      repoFlag: repo,
      deps: { runGh },
    })
  return {
    readManagedIssue,
    readPullRequest,
    readComment,
    readIssueComments,
    readTrustedFounderLogins,
    writeIssueBody,
  }
}

function defaultRunGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env ?? process.env,
  })
  if (result.error || result.status !== 0) {
    if (options.allowNotFound && /\b404\b|not found/i.test(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)) {
      return null
    }
    throw blockedExternal(result.stderr || result.stdout || result.error?.message || 'GitHub CLI failed')
  }
  return result.stdout.trim()
}

export async function runReopen({ options, deps }) {
  assertOptions(options)
  if (options?.help) return { outcome: 'HELP', state: null }
  if (!deps) throw blockedExternal('reopen transport dependencies are unavailable')

  let initial
  try {
    initial = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`live Issue/PR preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { issue, state, pr } = initial

  if (state?.state === CORRECTION_STATE) {
    return runNoOp({ deps, options, issue, state, pr })
  }
  assertPreState(issue, state, options)
  assertPrPreflight(pr, options, options.expectedNewHead)
  const evidence = await readAuthorizationEvidence({ deps, options, state, pr })

  let latest
  try {
    latest = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`live pre-mutation reread failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertPreState(latest.issue, latest.state, options)
  assertPrPreflight(latest.pr, options, options.expectedNewHead)
  if (!sameValue(latest.state, state) || latest.issue.body !== issue.body) {
    throw stateConflict('managed Issue changed during authorization preflight')
  }
  const nextState = buildNextState(latest.state, evidence, options)
  let nextBody
  try {
    nextBody = projectMissionControlStateBlock(latest.issue.body, nextState)
  } catch (error) {
    throw stateConflict(`managed state projection failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    await deps.writeIssueBody({
      repo: options.repo,
      issueNumber: options.issueNumber,
      expectedBody: latest.issue.body,
      nextBody,
      transitionIdentity: JSON.stringify({
        command: REOPEN_COMMAND,
        issue: String(options.issueNumber),
        pr: String(options.expectedPr),
        old_head: normalizeSha(options.expectedOldHead),
        new_head: normalizeSha(options.expectedNewHead),
        authorization_id: evidence.authorization.authorization_id,
      }),
    })
  } catch (error) {
    throw stateConflict(`Issue CAS/lease write outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`)
  }

  let verified
  try {
    verified = await readIssueAndPr(deps, options)
  } catch (error) {
    if (String(error?.message ?? '').startsWith('STATE_CONFLICT:') ||
        String(error?.message ?? '').startsWith('BLOCKED_EXTERNAL:')) throw error
    throw stateConflict(`post-write Issue/PR readback failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const postEvidence = await readAuthorizationEvidence({
    deps,
    options,
    state: verified.state,
    pr: verified.pr,
  })
  if (!sameValue(postEvidence.authorization, evidence.authorization)) {
    throw stateConflict('Founder authorization evidence changed during the state write')
  }
  if (verified.issue.body !== nextBody) {
    throw stateConflict('post-write Issue body readback does not match the projected body')
  }
  assertPostState(verified.issue, verified.state, verified.pr, postEvidence, options)
  if (!sameValue(verified.state, nextState)) {
    throw stateConflict('post-write managed state readback does not match the canonical projection')
  }
  return { outcome: 'REOPENED', state: verified.state }
}

function renderHelp(invocation) {
  if (invocation.format === 'json') {
    process.stdout.write(`${JSON.stringify(createHelpEnvelopeV1(invocation.contract))}\n`)
    return
  }

  process.stdout.write(formatTextHelp(invocation.contract))
}

function domainOptions(argv, values) {
  const domainArgv = argv.filter((argument) => argument !== '--' && argument !== '--json')
  const parsed = parseReopenArgs(domainArgv)
  return {
    ...parsed,
    issueNumber: values.issue_number,
    repo: values.repository,
    expectedPr: values.expected_pr,
    expectedBase: values.expected_base,
    expectedState: values.expected_state,
    expectedOldHead: values.expected_old_head,
    expectedNewHead: values.expected_new_head,
    expectedReviewCycle: values.expected_review_cycle,
    expectedFullReviewCount: values.expected_full_review_count,
    authorizationComment: values.authorization_comment,
  }
}

function isCanonicalClassification(value) {
  return typeof value === 'string' && Object.hasOwn(CLI_EXIT_CODES, value)
}

function mayHaveMutated(error) {
  if (error?.mutationPerformed === true || error?.classification === 'AMBIGUOUS_RESULT') {
    return true
  }

  const reason = error instanceof Error ? error.message : String(error)
  return /(?:CAS\/lease write outcome is ambiguous|post-write|state write|readback)/i.test(reason)
}

function runtimeClassification(error) {
  if (mayHaveMutated(error)) return 'AMBIGUOUS_RESULT'

  const reason = error instanceof Error ? error.message : String(error)
  const candidate = error?.classification ?? error?.code ??
    reason.match(/^(?:ERROR:\s*)?([A-Z_]+):/)?.[1]
  if (candidate === 'STATE_CONFLICT' && /\b(?:head|old_reviewed_head|current_head)\b/i.test(reason)) {
    return 'HEAD_DRIFT'
  }
  if (candidate === 'STATE_CONFLICT' && /Founder authorization|immutable Founder|authorization/i.test(reason)) {
    return 'AUTHORITY_CONFLICT'
  }
  return isCanonicalClassification(candidate) ? candidate : 'INTERNAL_ERROR'
}

function runtimeDetails(error) {
  const details = error instanceof CliInvocationError
    ? {
      argument: error.details.argument,
      reason: error.details.reason,
    }
    : {
      argument: null,
      reason: error instanceof Error ? error.message : String(error),
    }

  if (typeof error?.legacyClassification === 'string') {
    details.legacy_classification = error.legacyClassification
  }
  return details
}

function renderRuntimeError({ command, format, error, values = {} }) {
  const classification = runtimeClassification(error)
  const details = runtimeDetails(error)
  const mutationPerformed = mayHaveMutated(error)

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(createResultEnvelopeV1({
      command,
      outcome: 'ERROR',
      classification,
      mutation_performed: mutationPerformed,
      observed_pre_state: values.expected_state ?? null,
      repository: values.repository ?? null,
      issue_number: values.issue_number ?? null,
      pr_number: values.expected_pr ?? null,
      exact_head: values.expected_new_head ?? null,
      next_action: {
        type: 'STOP',
        command: null,
        reason: details.reason,
      },
      details,
    }))}\n`)
  } else {
    process.stderr.write(`${classification}: ${details.reason}\n`)
  }

  process.exitCode = classificationExitCode(classification)
}

function renderResult({ command, format, options, result }) {
  const legacyClassification = result.outcome
  const noOp = legacyClassification === 'NO_OP'
  const output = `Mission Control reopen ${legacyClassification}: Task #${options.issueNumber} -> ${result.state.state} ${result.state.review_cycle}/${result.state.full_review_count}`
  const envelope = createResultEnvelopeV1({
    command,
    outcome: noOp ? 'NO_OP' : 'SUCCESS',
    classification: noOp ? 'NO_OP_IDENTICAL_RETRY' : 'SUCCESS',
    mutation_performed: !noOp,
    observed_pre_state: options.expectedState,
    resulting_state: result.state.state,
    repository: options.repo,
    issue_number: options.issueNumber,
    pr_number: options.expectedPr,
    exact_head: options.expectedNewHead,
    next_action: noOp
      ? {
        type: 'COMPLETE',
        command: null,
        reason: 'The exact Founder-authorized reopen projection is already durable.',
      }
      : {
        type: 'COMMAND',
        command: 'bemoat:agent:delivery',
        reason: 'The bounded correction delivery is the only next mutation.',
      },
    details: {
      legacy_classification: legacyClassification,
      legacy_output: [output],
    },
  })

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(envelope)}\n`)
  } else {
    process.stdout.write(`${envelope.classification}: ${output}\n`)
  }

  process.exitCode = classificationExitCode(envelope.classification)
}

export async function main(argv = process.argv.slice(2), deps = null) {
  let command = null
  let invocation = null

  try {
    command = resolveCommandIdentity({
      fallback: REOPEN_COMMAND,
      env: deps?.env ?? (deps ? {} : process.env),
      entrypoint: ENTRYPOINT,
    })
    invocation = parseCommandInvocation(command, argv)

    if (invocation.mode === 'help') {
      renderHelp(invocation)
      return { outcome: 'HELP', state: null }
    }

    const options = domainOptions(argv, invocation.values)
    const result = await runReopen({
      options,
      deps: deps ?? createProductionDeps(),
    })
    renderResult({ command, format: invocation.format, options, result })
    return result
  } catch (error) {
    const format = invocation?.format ?? (argv.includes('--json') ? 'json' : 'text')
    renderRuntimeError({
      command: command ?? REOPEN_COMMAND,
      format,
      error,
      values: invocation?.values ?? {},
    })
    return null
  }
}
