import {
  normalizeTransitionIdentity,
  serializeTransitionIdentity,
} from '../transition-identity.mjs'
import {
  isExplicitlyNonAuthoritativeRoleBody,
  parseLegacyReviewVerdictBinding,
  parseRoleCommentBody,
  selectActiveRoleComments,
} from '../review-verdict-binding.mjs'

export const REBIND_COMMAND = 'bemoat:mission-control:rebind-review-lineage'
export const REBIND_ENTRYPOINT = 'scripts/mission-control-rebind-review-lineage.mjs'
export const REBIND_OWNER = 'Mission Control Lineage Rebind Transport'
export const BUNDLE_KIND = 'review-lineage-rebind'
export const AUTHORIZED_FOUNDER_LOGIN = 'boat1994'
export const AUTHORIZED_ASSOCIATION = 'OWNER'
export const ACCEPTED_PRE_STATE = 'ELIGIBLE_FOR_FOUNDER_REVIEW'

export const REGISTERED_TUPLE = Object.freeze({
  repo: 'boat1994/bemoat-web-starter',
  issueNumber: '259',
  expectedPr: '260',
  expectedBase: 'main',
  expectedState: ACCEPTED_PRE_STATE,
  expectedHead: 'b1ce5f58e7ffd0178d955ef7e93395209a7c4d28',
  expectedReviewCycle: '1',
  expectedFullReviewCount: '1',
  sourceComment: '5163387315',
  verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
})

const REQUIRED_AUTHORIZATION_KEYS = Object.freeze([
  'bundle_kind',
  'command',
  'repository',
  'task_issue',
  'pr',
  'base',
  'source_comment_id',
  'head',
  'expected_state',
  'review_cycle',
  'full_review_count',
  'verdict',
  'scope',
])

export function classifiedError(classification, message, details = {}) {
  const error = new Error(`${classification}: ${message}`)
  error.classification = classification
  Object.assign(error, details)
  return error
}

export function sameId(left, right) {
  return String(left ?? '') === String(right ?? '')
}

export function demotionPrefix(canonicalId) {
  return `[superseded] This REVIEW_VERDICT is not authoritative. Canonical lineage is comment ${canonicalId}. Original Review 1 evidence is preserved below.`
}

export function buildDemotionBody(sourceBody, canonicalId) {
  return `${demotionPrefix(canonicalId)}\n\n${String(sourceBody ?? '')}`
}

export function parseDemotedCanonicalId(body = '') {
  const match = String(body).match(
    /^\[superseded\] This REVIEW_VERDICT is not authoritative\. Canonical lineage is comment ([1-9]\d*)\./,
  )
  return match?.[1] ?? null
}

export function isDemotedSourceBody(body = '') {
  return parseDemotedCanonicalId(body) != null && isExplicitlyNonAuthoritativeRoleBody(body)
}

export function buildRebindTransitionIdentity({ body, options }) {
  const identity = normalizeTransitionIdentity(body, {
    taskId: String(options.issueNumber),
    phase: 'Review 1 lineage transport',
    role: 'REVIEW_VERDICT',
  })
  return JSON.stringify({
    kind: BUNDLE_KIND,
    source_comment_id: String(options.sourceComment),
    authorization_comment_id: String(options.authorizationComment),
    identity: JSON.parse(serializeTransitionIdentity(identity)),
  })
}

export function projectLineageRebindState({
  prior,
  commentId,
  transitionIdentity,
  updatedAt = new Date().toISOString(),
  updatedBy = REBIND_OWNER,
}) {
  if (!prior || typeof prior !== 'object') {
    throw classifiedError('STATE_CONFLICT', 'lineage rebind requires prior managed state')
  }
  return {
    ...structuredClone(prior),
    latest_review_verdict_comment_id: String(commentId),
    latest_transition_identity: transitionIdentity,
    updated_at: updatedAt,
    updated_by: updatedBy,
  }
}

export function assertRegisteredTuple(options) {
  const checks = [
    ['repo', options.repo, REGISTERED_TUPLE.repo],
    ['issueNumber', options.issueNumber, REGISTERED_TUPLE.issueNumber],
    ['expectedPr', options.expectedPr, REGISTERED_TUPLE.expectedPr],
    ['expectedBase', options.expectedBase, REGISTERED_TUPLE.expectedBase],
    ['expectedState', options.expectedState, REGISTERED_TUPLE.expectedState],
    ['expectedHead', String(options.expectedHead ?? '').toLowerCase(), REGISTERED_TUPLE.expectedHead],
    ['expectedReviewCycle', String(options.expectedReviewCycle), REGISTERED_TUPLE.expectedReviewCycle],
    ['expectedFullReviewCount', String(options.expectedFullReviewCount), REGISTERED_TUPLE.expectedFullReviewCount],
    ['sourceComment', String(options.sourceComment), REGISTERED_TUPLE.sourceComment],
  ]
  for (const [name, actual, expected] of checks) {
    if (String(actual ?? '') !== String(expected)) {
      throw classifiedError(
        'STATE_CONFLICT',
        `invocation ${name} does not match the registered lineage-rebind tuple`,
      )
    }
  }
}

export function assertCanonicalRebindBody(body, options) {
  const text = String(body ?? '')
  const headings = [...text.matchAll(/^##\s+([^\n#]+)\s*$/gm)].map((match) => match[1].trim())
  if (headings.length !== 1 || headings[0] !== 'REVIEW_VERDICT') {
    throw classifiedError('STATE_CONFLICT', 'rebind body must contain exactly one REVIEW_VERDICT heading')
  }
  if (!/^\*\*PR\s*\/\s*base\s*\/\s*head:\*\*/im.test(text)) {
    throw classifiedError('STATE_CONFLICT', 'rebind body must use canonical PR / base / head transport')
  }
  const parsed = parseRoleCommentBody(text)
  if (
    parsed.role !== 'REVIEW_VERDICT' ||
    String(parsed.prNumber) !== String(options.expectedPr) ||
    String(parsed.base ?? '').toLowerCase() !== String(options.expectedBase).toLowerCase() ||
    String(parsed.headSha ?? '').toLowerCase() !== String(options.expectedHead).toLowerCase() ||
    parsed.verdict !== REGISTERED_TUPLE.verdict
  ) {
    throw classifiedError(
      'STATE_CONFLICT',
      'rebind body must preserve the registered PR, base, exact head, and verdict',
    )
  }
  if (!new RegExp(`\\*\\*Task\\s*\\/\\s*Issue:\\*\\*\\s*#${options.issueNumber}\\b`, 'i').test(text)) {
    throw classifiedError('STATE_CONFLICT', 'rebind body must bind Task Issue #259')
  }
  if (isExplicitlyNonAuthoritativeRoleBody(text)) {
    throw classifiedError('STATE_CONFLICT', 'rebind body must remain authoritative canonical REVIEW_VERDICT evidence')
  }
}

export function parseFounderRebindAuthorization(body = '') {
  const text = String(body ?? '').trim()
  if (!text.startsWith('{') || !text.endsWith('}')) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization must be exactly one raw JSON object')
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization JSON could not be parsed')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization must be a JSON object')
  }
  const keys = Object.keys(parsed)
  if (keys.length !== REQUIRED_AUTHORIZATION_KEYS.length ||
      REQUIRED_AUTHORIZATION_KEYS.some((key) => !Object.hasOwn(parsed, key))) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization keys do not match the registered rebind contract')
  }
  return parsed
}

export function assertFounderAuthorization({ comment, options }) {
  if (!comment || !sameId(comment.id, options.authorizationComment)) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization comment is unavailable')
  }
  const login = comment.user?.login || comment.author
  const association = comment.author_association || comment.authorAssociation
  if (login !== AUTHORIZED_FOUNDER_LOGIN || association !== AUTHORIZED_ASSOCIATION) {
    throw classifiedError('AUTHORITY_CONFLICT', 'Founder authorization is not bound to trusted owner boat1994')
  }
  const parsed = parseFounderRebindAuthorization(comment.body)
  const expected = {
    bundle_kind: BUNDLE_KIND,
    command: REBIND_COMMAND,
    repository: REGISTERED_TUPLE.repo.toLowerCase(),
    task_issue: Number(REGISTERED_TUPLE.issueNumber),
    pr: Number(REGISTERED_TUPLE.expectedPr),
    base: REGISTERED_TUPLE.expectedBase.toLowerCase(),
    source_comment_id: Number(REGISTERED_TUPLE.sourceComment),
    head: REGISTERED_TUPLE.expectedHead.toLowerCase(),
    expected_state: REGISTERED_TUPLE.expectedState,
    review_cycle: Number(REGISTERED_TUPLE.expectedReviewCycle),
    full_review_count: Number(REGISTERED_TUPLE.expectedFullReviewCount),
    verdict: REGISTERED_TUPLE.verdict,
    scope: 'transport-correction-only',
  }
  const actual = {
    ...parsed,
    repository: String(parsed.repository ?? '').toLowerCase(),
    base: String(parsed.base ?? '').toLowerCase(),
    head: String(parsed.head ?? '').toLowerCase(),
    task_issue: Number(parsed.task_issue),
    pr: Number(parsed.pr),
    source_comment_id: Number(parsed.source_comment_id),
    review_cycle: Number(parsed.review_cycle),
    full_review_count: Number(parsed.full_review_count),
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw classifiedError(
        'AUTHORITY_CONFLICT',
        `Founder authorization ${key} does not match the registered lineage-rebind tuple`,
      )
    }
  }
}

export function assertLegacySourceComment({ comment, options }) {
  if (!comment || !sameId(comment.id, options.sourceComment)) {
    throw classifiedError('STATE_CONFLICT', `source comment ${options.sourceComment} is unavailable`)
  }
  if (isDemotedSourceBody(comment.body)) return comment
  const legacy = parseLegacyReviewVerdictBinding(comment.body)
  if (
    !legacy ||
    String(legacy.issueNumber) !== String(options.issueNumber) ||
    String(legacy.prNumber) !== String(options.expectedPr) ||
    String(legacy.base ?? '').toLowerCase() !== String(options.expectedBase).toLowerCase() ||
    String(legacy.head ?? '').toLowerCase() !== String(options.expectedHead).toLowerCase()
  ) {
    throw classifiedError(
      'STATE_CONFLICT',
      'source comment is not the registered legacy REVIEW_VERDICT binding',
    )
  }
  const parsed = parseRoleCommentBody(comment.body)
  if (parsed.role !== 'REVIEW_VERDICT' || parsed.verdict !== REGISTERED_TUPLE.verdict) {
    throw classifiedError('STATE_CONFLICT', 'source comment does not preserve the registered Review 1 verdict')
  }
  return comment
}

export function classifyActiveVerdicts({ comments, sourceComment, canonicalBody }) {
  const active = selectActiveRoleComments(comments, 'REVIEW_VERDICT')
  const matchingCanonicals = active.filter((comment) => String(comment.body ?? '') === String(canonicalBody))
  const competitors = active.filter((comment) =>
    !sameId(comment.id, sourceComment) &&
    String(comment.body ?? '') !== String(canonicalBody),
  )
  const source = active.find((comment) => sameId(comment.id, sourceComment)) ?? null
  return { active, matchingCanonicals, competitors, source }
}

export function assertLiveManagedPreState({ state, options }) {
  if (!state || state.state !== options.expectedState) {
    throw classifiedError(
      'UNSUPPORTED_PRE_STATE',
      `expected ${options.expectedState}, received ${state?.state ?? 'missing'}`,
    )
  }
  if (
    Number(state.review_cycle) !== Number(options.expectedReviewCycle) ||
    Number(state.full_review_count) !== Number(options.expectedFullReviewCount)
  ) {
    throw classifiedError('STATE_CONFLICT', 'live review counters do not match the registered 1/1 tuple')
  }
  if (String(state.active_task_issue) !== `#${options.issueNumber}`) {
    throw classifiedError('STATE_CONFLICT', 'live managed Task Issue does not match the registered tuple')
  }
  if (String(state.active_pr) !== `#${options.expectedPr}`) {
    throw classifiedError('STATE_CONFLICT', 'live managed PR does not match the registered tuple')
  }
  if (String(state.approved_base ?? '').toLowerCase() !== String(options.expectedBase).toLowerCase()) {
    throw classifiedError('STATE_CONFLICT', 'live approved base does not match the registered tuple')
  }
  if (String(state.current_head ?? '').toLowerCase() !== String(options.expectedHead).toLowerCase()) {
    throw classifiedError('STATE_CONFLICT', 'live current head does not match the registered tuple')
  }
}

export function assertUnchangedExceptLineage({ prior, next, commentId, transitionIdentity }) {
  const immutableKeys = [
    'schema_version', 'state', 'review_cycle', 'full_review_count', 'approved_base',
    'active_task_issue', 'active_pr', 'current_head', 'last_reviewed_head',
    'guide_version', 'guide_source_ref', 'guide_source_sha', 'open_blockers',
    'follow_up_issues', 'next_permitted_action', 'material_change_status',
  ]
  for (const key of immutableKeys) {
    if (JSON.stringify(next[key]) !== JSON.stringify(prior[key])) {
      throw classifiedError(
        'STATE_CONFLICT',
        `lineage rebind mutated managed state field ${key}`,
      )
    }
  }
  if (!sameId(next.latest_review_verdict_comment_id, commentId)) {
    throw classifiedError('STATE_CONFLICT', 'latest_review_verdict_comment_id was not rebound to the canonical comment')
  }
  if (next.latest_transition_identity !== transitionIdentity) {
    throw classifiedError('STATE_CONFLICT', 'latest_transition_identity was not updated to the rebind identity')
  }
  if (
    Number(next.review_cycle) !== Number(prior.review_cycle) ||
    Number(next.full_review_count) !== Number(prior.full_review_count) ||
    next.state !== prior.state
  ) {
    throw classifiedError('STATE_CONFLICT', 'lineage rebind must not increment or reset review counters or state')
  }
}
