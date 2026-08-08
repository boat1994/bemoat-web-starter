import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const COMMENT_SHA_RE = /^[0-9a-f]{64}$/i
const MERGE_COMPLETION_BUNDLE_KIND = 'merge-completion'
const MERGE_COMPLETION_AUTHORITY_SCOPE = 'merge'

export const AUTHORIZATION_VALIDATION_FAILURE = 'AUTHORIZATION_VALIDATION_FAILURE'

export function authorizationValidationFailure(message) {
  const error = new Error(`${AUTHORIZATION_VALIDATION_FAILURE}: ${message}`)
  error.code = AUTHORIZATION_VALIDATION_FAILURE
  error.classification = AUTHORIZATION_VALIDATION_FAILURE
  return error
}

function normalizeIssueNumber(value) {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value) {
  return resolvePrNumber(value)
}

export function parseFounderMergeAuthorization(body = '') {
  if (typeof body !== 'string') {
    throw authorizationValidationFailure('Founder merge authorization evidence must be raw JSON text or canonical Markdown')
  }
  const source = body.trim()
  if (!source) {
    throw authorizationValidationFailure('Founder merge authorization evidence must contain exactly one raw JSON object or canonical Markdown decision')
  }

  if (source.startsWith('{')) {
    if (source.startsWith('```') || source.endsWith('```')) {
      throw authorizationValidationFailure('Founder merge authorization evidence must contain exactly one raw JSON object')
    }

    let parsed
    try {
      parsed = JSON.parse(source)
    } catch {
      throw authorizationValidationFailure('Founder merge authorization comment does not contain valid raw JSON evidence')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw authorizationValidationFailure('Founder merge authorization evidence must decode to one JSON object, not a string or array')
    }
    return parsed
  }

  const lines = source.split('\n')
  const fields = [
    [/^## FOUNDER_DECISION$/, 'header'],
    [/^$/, 'separator'],
    [/^\*\*Decision:\*\* APPROVE MERGE COMPLETION$/, 'decision'],
    [/^\*\*Authority:\*\* Founder$/, 'authority'],
    [/^\*\*Author:\*\* @([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)$/, 'author'],
    [/^\*\*Repository:\*\* `([^`\r\n]+)`$/, 'repository'],
    [/^\*\*Task \/ Issue:\*\* #([1-9]\d*)$/, 'task'],
    [/^\*\*PR:\*\* PR #([1-9]\d*)$/, 'pr'],
    [/^\*\*Approved base:\*\* `([^`\s]+)`$/, 'base'],
    [/^\*\*Exact reviewed head:\*\* `([0-9a-f]{40})`$/i, 'head'],
    [/^\*\*REVIEW_VERDICT comment ID:\*\* ([1-9]\d*)$/, 'reviewComment'],
    [/^\*\*Action:\*\* merge$/, 'action'],
    [/^\*\*Scope:\*\* merge$/, 'scope'],
    [/^\*\*Policy source SHA:\*\* `([0-9a-f]{40})`$/i, 'policySourceSha'],
    [/^\*\*Protected base SHA:\*\* `([0-9a-f]{40})`$/i, 'protectedBaseSha'],
    [/^\*\*Non-superseded:\*\* (true|false)$/, 'nonSuperseded'],
  ]
  if (lines.length !== fields.length) {
    throw authorizationValidationFailure('Founder merge authorization Markdown must match the canonical structured decision shape exactly')
  }

  const values = {}
  for (const [index, [pattern, name]] of fields.entries()) {
    const match = lines[index].match(pattern)
    if (!match) {
      throw authorizationValidationFailure('Founder merge authorization Markdown is incomplete, duplicated, conflicting, or non-canonical')
    }
    if (match[1] != null) values[name] = match[1]
  }

  const nonSuperseded = values.nonSuperseded === 'true'
  const head = values.head.toLowerCase()
  return {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: values.author,
    repository: values.repository,
    task_issue: Number(values.task),
    pr: Number(values.pr),
    base: values.base,
    exact_head: head,
    reviewed_head: head,
    review_verdict_comment_id: values.reviewComment,
    policy_source_sha: values.policySourceSha.toLowerCase(),
    protected_base_sha: values.protectedBaseSha.toLowerCase(),
    policy_version: '1.3.0',
    bundle_kind: MERGE_COMPLETION_BUNDLE_KIND,
    scope: 'merge',
    action: 'merge',
    non_superseded: nonSuperseded,
    superseded_by: null,
  }
}

export function generateFounderMergeAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw authorizationValidationFailure('Founder merge authorization generator requires an object, not a string or array')
  }
  if (authorization.non_superseded === false || authorization.superseded_by != null) {
    throw authorizationValidationFailure('Founder merge authorization generator cannot emit a superseded record')
  }
  const record = {
    ...structuredClone(authorization),
    non_superseded: true,
    superseded_by: null,
  }
  if (record.supersedes_comment_ids != null && (!Array.isArray(record.supersedes_comment_ids) ||
    record.supersedes_comment_ids.some((id) => !/^[1-9]\d*$/.test(String(id))))) {
    throw authorizationValidationFailure('Founder merge authorization supersession references must be positive comment IDs')
  }
  return JSON.stringify(record, null, 2)
}

export const serializeFounderMergeAuthorization = generateFounderMergeAuthorization

export function validateFounderMergeAuthorizationEvidence({
  body,
  authorizationCommentId,
  trustedFounderLogins,
  expected,
}) {
  return validateFounderAuthorizationRecord({
    authorization: parseFounderMergeAuthorization(body),
    authorizationCommentId,
    trustedFounderLogins,
    expected,
  })
}

export function validateFounderAuthorizationRecord({
  authorization,
  authorizationCommentId,
  trustedFounderLogins,
  expected,
}) {
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw authorizationValidationFailure('repository-owned Founder identity configuration is missing or empty')
  }
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw authorizationValidationFailure('Founder authorization record is missing, stringified, or ambiguous')
  }
  const required = [
    authorization.schema_version === 1,
    authorization.status === 'approved',
    authorization.authority === 'Founder',
    typeof authorization.author_login === 'string' && authorization.author_login.length > 0,
    String(authorization.comment_id) === String(authorizationCommentId),
    authorization.immutable_comment_reference === true,
    typeof authorization.comment_sha256 === 'string' && COMMENT_SHA_RE.test(authorization.comment_sha256),
    authorization.non_superseded === true,
    authorization.superseded_by == null,
    authorization.repository === expected.repository,
    authorization.bundle_kind === expected.bundleKind,
    normalizeIssueNumber(authorization.task_issue) === expected.taskIssue,
    normalizePrNumber(authorization.pr) === expected.pr,
    FULL_SHA_RE.test(String(expected.exactHead)) && FULL_SHA_RE.test(String(authorization.exact_head)),
    authorization.exact_head === expected.exactHead,
    authorization.reviewed_head === expected.exactHead,
    authorization.base === expected.base,
    FULL_SHA_RE.test(String(expected.policySourceSha)) && authorization.policy_source_sha === expected.policySourceSha,
    FULL_SHA_RE.test(String(expected.protectedBaseSha)) && authorization.protected_base_sha === expected.protectedBaseSha,
    authorization.scope === expected.scope,
    authorization.action === expected.action,
    expected.policyVersion == null || authorization.policy_version === expected.policyVersion,
    expected.reviewCommentId == null || String(authorization.review_verdict_comment_id) === String(expected.reviewCommentId),
  ]
  if (required.some((condition) => !condition)) {
    throw authorizationValidationFailure('Founder authorization record does not bind trusted identity, immutable comment, non-supersession, repository, task, PR, exact head/base, scope, policy, and action')
  }
  if (!trustedFounderLogins.includes(authorization.author_login)) {
    throw authorizationValidationFailure('authorization comment author does not match repository-owned Founder identity configuration')
  }
  return authorization
}

export function validateFounderMergeAuthorization({
  authorization,
  authorizationCommentId,
  issueNumber,
  prNumber,
  reviewedHead,
  base,
  repository,
  policyVersion,
  reviewCommentId,
  policySourceSha,
  protectedBaseSha,
  trustedFounderLogins,
}) {
  return validateFounderAuthorizationRecord({
    authorization,
    authorizationCommentId,
    trustedFounderLogins,
    expected: {
      repository,
      taskIssue: issueNumber,
      pr: prNumber,
      exactHead: reviewedHead,
      base,
      bundleKind: MERGE_COMPLETION_BUNDLE_KIND,
      policySourceSha,
      protectedBaseSha,
      policyVersion,
      reviewCommentId,
      scope: MERGE_COMPLETION_AUTHORITY_SCOPE,
      action: 'merge',
    },
  })
}
