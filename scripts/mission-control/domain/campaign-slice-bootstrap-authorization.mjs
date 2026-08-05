import { createHash } from 'node:crypto'

import {
  createSignedEnvelope,
  parseSignedEnvelope,
  renderSignedEnvelope,
  verifySignedEnvelope,
} from './task-attestation.mjs'

export const CAMPAIGN_SLICE_BOOTSTRAP_AUTHORIZATION_SCHEMA =
  'bemoat-mission-control-campaign-slice-bootstrap-authorization'
export const CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA =
  'bemoat-mission-control-campaign-slice-bootstrap-attestation'
export const CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION = 'campaign-slice-bootstrap'
export const CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION = 1
export const CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA =
  'bemoat-mission-control-campaign-slice-bootstrap-ownership-registry'
export const CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION =
  'campaign-slice-bootstrap-ownership-register'
export const CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION = 1
export const CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:attestation:end -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:ownership-registry:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:ownership-registry:end -->'

export const CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT = Object.freeze({
  repository: 'boat1994/bemoat-web-starter',
  campaignIssueNumber: 215,
  sliceId: 5,
  policyPath: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'e79694467b89dace927c27a1022ec3d260a4a43c',
  protectedBaseRef: 'main',
  targetState: 'BLOCKED_FOR_FOUNDER_DECISION',
  workflowMode: 'planning_no_pr',
  reviewCycle: 0,
  fullReviewCount: 0,
})

function authorizationError(message) {
  const error = new Error(`Campaign slice bootstrap Founder authorization is invalid: ${message}`)
  error.code = 'STATE_CONFLICT'
  error.classification = 'STATE_CONFLICT'
  return error
}

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function normalizeCommentAuthor(comment) {
  return comment?.user?.login ?? comment?.author?.login ?? comment?.author_login ?? null
}

export function renderCampaignSliceBootstrapFounderAuthorization({
  repository = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.repository,
  campaignIssueNumber = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber,
  sliceId = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
  planningHandoffCommentId,
  planningResultCommentId,
  protectedBaseRef = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef,
  protectedBaseSha,
  policyPath = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policyPath,
  policyVersion = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policyVersion,
} = {}) {
  return [
    '## FOUNDER_AUTHORIZATION',
    '',
    `- Operation: ${CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION}`,
    `- Repository: ${repository}`,
    `- Campaign: #${campaignIssueNumber}`,
    `- Slice: ${sliceId}`,
    '- Decision: APPROVE bounded planning Task bootstrap',
    `- Planning HANDOFF: ${planningHandoffCommentId}`,
    `- Planning RESULT: ${planningResultCommentId}`,
    `- Protected base: ${protectedBaseRef}@${protectedBaseSha}`,
    `- Policy: ${policyPath}@${policyVersion}`,
    '',
  ].join('\n')
}

function supersedesComment(comment, targetId) {
  const body = String(comment?.body ?? '')
  const ids = [
    ...body.matchAll(/supersedes_comment_id\s*:\s*([1-9]\d*)/gi),
    ...body.matchAll(/supersedes_comment_ids\s*:\s*\[([^\]]*)\]/gi),
  ].flatMap((match) => String(match[1] ?? '').match(/[1-9]\d*/g) ?? [])
  return ids.includes(String(targetId))
}

/**
 * Validate the caller-supplied immutable Founder decision. The decision is
 * read by comment ID, checked against the trusted login allowlist, and bound
 * to the exact raw body bytes returned by GitHub.
 */
export function validateCampaignSliceBootstrapFounderAuthorization({
  authorizationComment,
  campaignIssue,
  founderLogins,
  comments = [],
  expected = CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT,
  planningHandoffCommentId,
  planningResultCommentId,
  protectedBaseSha,
} = {}) {
  const body = String(authorizationComment?.body ?? '')
  const author = normalizeCommentAuthor(authorizationComment)
  const canonical = renderCampaignSliceBootstrapFounderAuthorization({
    repository: expected.repository,
    campaignIssueNumber: expected.campaignIssueNumber,
    sliceId: expected.sliceId,
    planningHandoffCommentId,
    planningResultCommentId,
    protectedBaseRef: expected.protectedBaseRef,
    protectedBaseSha,
    policyPath: expected.policyPath,
    policyVersion: expected.policyVersion,
  })
  const valid = [
    positiveId(authorizationComment?.id),
    String(authorizationComment?.issue_number) === String(expected.campaignIssueNumber),
    campaignIssue?.number == null || String(campaignIssue.number) === String(expected.campaignIssueNumber),
    typeof author === 'string' && Array.isArray(founderLogins) && founderLogins.includes(author),
    body.trimEnd() === canonical.trimEnd(),
    body.includes(`- Planning HANDOFF: ${planningHandoffCommentId}`),
    body.includes(`- Planning RESULT: ${planningResultCommentId}`),
  ]
  if (valid.some((condition) => !condition)) {
    throw authorizationError('record does not bind the trusted Founder, Campaign slice, planning evidence, or protected base')
  }
  if (comments.some((comment) =>
    String(comment?.id) !== String(authorizationComment?.id) &&
    supersedesComment(comment, authorizationComment?.id),
  )) {
    throw authorizationError('authorization was explicitly superseded')
  }
  return {
    valid: true,
    authorLogin: author,
    commentId: String(authorizationComment.id),
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    schema: CAMPAIGN_SLICE_BOOTSTRAP_AUTHORIZATION_SCHEMA,
  }
}

export function createCampaignSliceBootstrapAttestation({
  payload,
  privateKey,
  keyId,
} = {}) {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {}
  return createSignedEnvelope({
    schema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
    operationVersion: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION,
    keyId,
    payload: normalizedPayload,
    privateKey,
  })
}

export function createCampaignSliceBootstrapOwnershipRegistry({
  payload,
  privateKey,
  keyId,
} = {}) {
  return createSignedEnvelope({
    schema: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION,
    operationVersion: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION,
    keyId,
    payload,
    privateKey,
  })
}

export function renderCampaignSliceBootstrapOwnershipRegistry(record) {
  return renderSignedEnvelope(record, {
    start: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_START,
    end: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_END,
  })
}

export function parseCampaignSliceBootstrapOwnershipRegistry(body = '') {
  return parseSignedEnvelope(body, {
    start: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_START,
    end: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_END,
  })
}

function sameIdentity(payload, prefix, expected) {
  if (!expected) return true
  return String(payload?.[`${prefix}_number`]) === String(expected.number) &&
    (expected.id == null || String(payload?.[`${prefix}_id`]) === String(expected.id)) &&
    (expected.node_id == null || String(payload?.[`${prefix}_node_id`]) === String(expected.node_id))
}

export function verifyCampaignSliceBootstrapOwnershipRegistry(record, {
  publicKey,
  repository,
  signingKeyId,
  expectedRequestId,
  expectedCampaignIssue,
  expectedSliceId,
  expectedTaskIssue,
  expectedAttestationSha256,
  expectedAuthorityCommentIds,
} = {}) {
  const verified = verifySignedEnvelope(record, {
    publicKey,
    repository,
    signingKeyId,
    expectedSchema: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
    expectedOperation: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION,
    expectedOperationVersion: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION,
  })
  if (!verified.ok) return { ok: false, reason: verified.reason, record: null }

  const payload = record.payload
  const authorityCommentIds = Array.isArray(payload?.authority_comment_ids)
    ? payload.authority_comment_ids.map(String)
    : null
  const expectedAuthority = expectedAuthorityCommentIds?.map(String)
  const valid = payload?.schema_version === 1 &&
    payload?.registry_schema === CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA &&
    payload?.operation === CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION &&
    payload?.operation_version === CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION &&
    payload?.signing_key_id === record.key_id &&
    typeof payload?.request_id === 'string' &&
    /^mc-campaign-slice-bootstrap-v1-[0-9a-f]{64}$/.test(payload.request_id) &&
    Number.isInteger(payload?.campaign_issue_number) &&
    Number.isInteger(payload?.slice_id) &&
    Number.isInteger(payload?.task_issue_number) &&
    typeof payload?.attestation_sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(payload.attestation_sha256) &&
    Array.isArray(authorityCommentIds) &&
    authorityCommentIds.length === 3 &&
    (expectedAuthority == null || expectedAuthority.every((id) => authorityCommentIds.includes(id))) &&
    sameIdentity(payload, 'campaign_issue', expectedCampaignIssue) &&
    sameIdentity(payload, 'task_issue', expectedTaskIssue) &&
    (expectedRequestId == null || payload.request_id === expectedRequestId) &&
    (expectedSliceId == null || payload.slice_id === Number(expectedSliceId)) &&
    (expectedAttestationSha256 == null || payload.attestation_sha256 === expectedAttestationSha256)
  if (!valid) return { ok: false, reason: 'campaign-slice ownership registry binding is invalid', record: null }
  return { ok: true, reason: null, record }
}
