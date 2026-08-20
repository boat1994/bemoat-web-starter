import { createHash } from 'node:crypto'

export const FOUNDER_AUTHORIZATION_RECEIPT_FORMAT = 'task-bootstrap-existing-receipt-v1'

type JsonRecord = Record<string, unknown>

function receiptError(message: string): never {
  const error = new Error(`Founder bootstrap authorization is invalid: ${message}`)
  Object.assign(error, { code: 'STATE_CONFLICT', classification: 'STATE_CONFLICT' })
  throw error
}

export function buildFounderAuthorizationReceiptBody({
  repository, issueNumber, founderLogin, protectedBaseSha, policySource, policyVersion, policySha,
  authorizationCommentId, authorizationBodySha256,
}: {
  repository: string; issueNumber: number; founderLogin: string; protectedBaseSha: string
  policySource: string; policyVersion: string; policySha: string
  authorizationCommentId: string; authorizationBodySha256: string
}): string {
  return JSON.stringify({
    receipt_format: FOUNDER_AUTHORIZATION_RECEIPT_FORMAT, schema_version: 1, repository,
    issue_number: issueNumber, founder_login: founderLogin, protected_base_sha: protectedBaseSha,
    policy_source: policySource, policy_version: policyVersion, policy_source_sha: policySha,
    authorization_comment_id: authorizationCommentId, authorization_body_sha256: authorizationBodySha256,
    scope: 'task-initialization', action: 'create-managed-task',
  }, null, 2)
}

export function parseFounderAuthorizationReceipt(body = ''): JsonRecord {
  let receipt: unknown
  try { receipt = JSON.parse(body) } catch { receiptError('receipt body is not valid JSON') }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || (receipt as JsonRecord).receipt_format !== FOUNDER_AUTHORIZATION_RECEIPT_FORMAT || (receipt as JsonRecord).schema_version !== 1) receiptError('receipt has an invalid format')
  return receipt as JsonRecord
}

function property(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

function author(value: unknown): string {
  const user = property(value, 'user')
  const nested = user && typeof user === 'object' ? property(user, 'login') : undefined
  return String(nested ?? property(value, 'author_login') ?? '')
}

export function assertImmutableCommentSnapshot(comment: unknown, label: string): void {
  const createdAt = property(comment, 'created_at')
  const updatedAt = property(comment, 'updated_at')
  if (createdAt != null && updatedAt != null && String(createdAt) !== String(updatedAt)) {
    receiptError(`${label} was mutated after creation`)
  }
}

export function validateFounderAuthorizationReceipt({ authorizationComment, parentComments = [], repository, founderLogin, issueNumber, protectedBaseSha, policySource, policyVersion, policySha }: {
  authorizationComment?: unknown; parentComments?: unknown[]; repository: string; founderLogin: string; issueNumber: number
  protectedBaseSha: string; policySource: string; policyVersion: string; policySha: string
}): void {
  assertImmutableCommentSnapshot(authorizationComment, 'authorization comment')
  const authorizationCommentId = String(property(authorizationComment, 'id') ?? '')
  const authorizationBody = String(property(authorizationComment, 'body') ?? '')
  const authorizationBodySha256 = createHash('sha256').update(authorizationBody, 'utf8').digest('hex')
  const expectedBody = buildFounderAuthorizationReceiptBody({ repository, issueNumber, founderLogin, protectedBaseSha, policySource, policyVersion, policySha, authorizationCommentId, authorizationBodySha256 })
  const receipts = parentComments.filter((comment) => String(property(comment, 'body') ?? '').includes(FOUNDER_AUTHORIZATION_RECEIPT_FORMAT))
  if (receipts.length !== 1) receiptError('exactly one immutable authorization receipt is required')
  const receipt = receipts[0]
  assertImmutableCommentSnapshot(receipt, 'authorization receipt')
  try { parseFounderAuthorizationReceipt(String(property(receipt, 'body') ?? '')) } catch { receiptError('authorization receipt is malformed') }
  if (String(property(receipt, 'body') ?? '') !== expectedBody) receiptError('authorization receipt does not bind the exact authorization ID and body hash')
  if (!/^\d+$/.test(String(property(receipt, 'id') ?? '')) || author(receipt) !== founderLogin || String(property(receipt, 'issue_number') ?? '') !== String(issueNumber)) receiptError('authorization receipt identity is invalid')
}
