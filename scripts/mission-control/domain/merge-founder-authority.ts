import { z } from 'zod'

import { resolveIssueNumber, resolvePrNumber } from '../../agent-issue/issue-references.mjs'

type AuthorizationRecord = { [key: string]: unknown }

type ExpectedAuthorization = {
  repository: unknown
  taskIssue: unknown
  pr: unknown
  exactHead: unknown
  base: unknown
  bundleKind: unknown
  policySourceSha: unknown
  protectedBaseSha: unknown
  policyVersion?: unknown
  reviewCommentId?: unknown
  scope: unknown
  action: unknown
}

type AuthorizationValidationInput = {
  authorization: unknown
  authorizationCommentId: unknown
  trustedFounderLogins: unknown
  expected: ExpectedAuthorization
}

type MergeAuthorizationValidationInput = {
  authorization: unknown
  authorizationCommentId: unknown
  issueNumber: unknown
  prNumber: unknown
  reviewedHead: unknown
  base: unknown
  repository: unknown
  policyVersion?: unknown
  reviewCommentId?: unknown
  policySourceSha: unknown
  protectedBaseSha: unknown
  trustedFounderLogins: unknown
}

type AuthorizationValidationError = Error & {
  code: typeof AUTHORIZATION_VALIDATION_FAILURE
  classification: typeof AUTHORIZATION_VALIDATION_FAILURE
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/i
const COMMENT_SHA_RE = /^[0-9a-f]{64}$/i

const MERGE_COMPLETION_BUNDLE_KIND = 'merge-completion'
const MERGE_COMPLETION_AUTHORITY_SCOPE = 'merge'
const decodedRawJsonObjectSchema = z.object({}).passthrough()

export const AUTHORIZATION_VALIDATION_FAILURE = 'AUTHORIZATION_VALIDATION_FAILURE'

function isAuthorizationRecord(value: unknown): value is AuthorizationRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function authorizationValidationFailure(message: string): AuthorizationValidationError {
  const details: Pick<AuthorizationValidationError, 'code' | 'classification'> = {
    code: AUTHORIZATION_VALIDATION_FAILURE,
    classification: AUTHORIZATION_VALIDATION_FAILURE,
  }
  return Object.assign(new Error(`${AUTHORIZATION_VALIDATION_FAILURE}: ${message}`), details)
}

function normalizeIssueNumber(value: unknown): unknown {
  return resolveIssueNumber(value)
}

function normalizePrNumber(value: unknown): unknown {
  return resolvePrNumber(value)
}

export function parseFounderMergeAuthorization(body: unknown = ''): AuthorizationRecord {
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

    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      throw authorizationValidationFailure('Founder merge authorization comment does not contain valid raw JSON evidence')
    }
    if (!isAuthorizationRecord(parsed)) {
      throw authorizationValidationFailure('Founder merge authorization evidence must decode to one JSON object, not a string or array')
    }
    const decoded = decodedRawJsonObjectSchema.safeParse(parsed)
    if (!decoded.success) {
      throw authorizationValidationFailure('Founder merge authorization evidence must decode to one JSON object, not a string or array')
    }
    return parsed
  }

  const lines = source.split('\n')
  const fields: Array<[RegExp, string]> = [
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

  const values: Record<string, string> = {}
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
    comment_id: null,
    immutable_comment_reference: true,
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

export function generateFounderMergeAuthorization(authorization: unknown): string {
  if (!isAuthorizationRecord(authorization)) {
    throw authorizationValidationFailure('Founder merge authorization generator requires an object, not a string or array')
  }
  const input = authorization
  if (input.non_superseded === false || input.superseded_by != null) {
    throw authorizationValidationFailure('Founder merge authorization generator cannot emit a superseded record')
  }
  const record: AuthorizationRecord = {
    ...structuredClone(input),
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
}: {
  body: unknown
  authorizationCommentId: unknown
  trustedFounderLogins: unknown
  expected: ExpectedAuthorization
}): AuthorizationRecord {
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
}: AuthorizationValidationInput): AuthorizationRecord {
  if (!Array.isArray(trustedFounderLogins) || trustedFounderLogins.length === 0) {
    throw authorizationValidationFailure('repository-owned Founder identity configuration is missing or empty')
  }
  if (!isAuthorizationRecord(authorization)) {
    throw authorizationValidationFailure('Founder authorization record is missing, stringified, or ambiguous')
  }
  const record = authorization
  const required = [
    record.schema_version === 1,
    record.status === 'approved',
    record.authority === 'Founder',
    typeof record.author_login === 'string' && record.author_login.length > 0,
    record.comment_id === null || String(record.comment_id) === String(authorizationCommentId),
    record.immutable_comment_reference === true,
    record.comment_id === null || (typeof record.comment_sha256 === 'string' && COMMENT_SHA_RE.test(record.comment_sha256)),
    record.non_superseded === true,
    record.superseded_by == null,
    record.repository === expected.repository,
    record.bundle_kind === expected.bundleKind,
    normalizeIssueNumber(record.task_issue) === expected.taskIssue,
    normalizePrNumber(record.pr) === expected.pr,
    FULL_SHA_RE.test(String(expected.exactHead)) && FULL_SHA_RE.test(String(record.exact_head)),
    record.exact_head === expected.exactHead,
    record.reviewed_head === expected.exactHead,
    record.base === expected.base,
    FULL_SHA_RE.test(String(expected.policySourceSha)) && record.policy_source_sha === expected.policySourceSha,
    FULL_SHA_RE.test(String(expected.protectedBaseSha)) && record.protected_base_sha === expected.protectedBaseSha,
    record.scope === expected.scope,
    record.action === expected.action,
    expected.policyVersion == null || record.policy_version === expected.policyVersion,
    expected.reviewCommentId == null || String(record.review_verdict_comment_id) === String(expected.reviewCommentId),
  ]
  if (required.some((condition) => !condition)) {
    throw authorizationValidationFailure('Founder authorization record does not bind trusted identity, immutable comment, non-supersession, repository, task, PR, exact head/base, scope, policy, and action')
  }
  if (!trustedFounderLogins.includes(record.author_login)) {
    throw authorizationValidationFailure('authorization comment author does not match repository-owned Founder identity configuration')
  }
  return record
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
}: MergeAuthorizationValidationInput): AuthorizationRecord {
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
