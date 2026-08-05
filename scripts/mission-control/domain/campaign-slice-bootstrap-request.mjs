import {
  createSignedEnvelope,
  canonicalSerialize,
  parseSignedEnvelope,
  renderSignedEnvelope,
  sha256Hex,
  verifySignedEnvelope,
} from './task-attestation.mjs'

export const CAMPAIGN_SLICE_BOOTSTRAP_OPERATION = 'campaign-slice-bootstrap'
export const CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION = 1
export const CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX = 'mc-campaign-slice-bootstrap-v1-'
export const CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_SCHEMA =
  'bemoat-mission-control-campaign-slice-bootstrap-provisional'
export const CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:provisional:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:provisional:end -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:completion:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:completion:end -->'

export function normalizeImmutableCommentId(value) {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  return /^[1-9]\d*$/.test(normalized) ? normalized : null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function markerContents(body, startMarker, endMarker) {
  const text = String(body ?? '')
  const starts = [...text.matchAll(new RegExp(escapeRegExp(startMarker), 'g'))]
  const ends = [...text.matchAll(new RegExp(escapeRegExp(endMarker), 'g'))]
  if (starts.length === 0 && ends.length === 0) {
    return { present: false, valid: false, value: null }
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { present: true, valid: false, reason: 'marker pair is unbalanced', value: null }
  }
  const raw = text
    .slice(starts[0].index + startMarker.length, ends[0].index)
    .replace(/```json\s*|```/g, '')
    .trim()
  try {
    const value = JSON.parse(raw)
    return { present: true, valid: true, value }
  } catch (error) {
    return {
      present: true,
      valid: false,
      reason: `marker content is not valid JSON: ${error.message}`,
      value: null,
    }
  }
}

function validRequestId(value) {
  return typeof value === 'string' &&
    new RegExp(`^${escapeRegExp(CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX)}[0-9a-f]{64}$`).test(value)
}

export function buildCampaignSliceBootstrapRequestIdentity({
  repository,
  founderAuthorizationCommentId,
  founderAuthorizationBodySha256,
  campaignIssueNumber,
  sliceId,
  planningHandoffCommentId,
  planningHandoffBodySha256,
  planningResultCommentId,
  planningResultBodySha256,
  planningBaselineSha,
  protectedBaseSha,
  policyPath,
  policyVersion,
  policySha,
  targetState = 'BLOCKED_FOR_FOUNDER_DECISION',
  workflowMode = 'planning_no_pr',
  reviewCycle = 0,
  fullReviewCount = 0,
  activePr = null,
  currentHead = null,
  lastReviewedHead = null,
} = {}) {
  const tuple = {
    operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
    repository,
    founder_authorization_comment_id: normalizeImmutableCommentId(founderAuthorizationCommentId),
    founder_authorization_body_sha256: founderAuthorizationBodySha256,
    campaign_issue_number: Number(campaignIssueNumber),
    slice_id: Number(sliceId),
    planning_handoff_comment_id: normalizeImmutableCommentId(planningHandoffCommentId),
    planning_handoff_body_sha256: planningHandoffBodySha256,
    planning_result_comment_id: normalizeImmutableCommentId(planningResultCommentId),
    planning_result_body_sha256: planningResultBodySha256,
    planning_baseline_sha: planningBaselineSha,
    protected_base_sha: protectedBaseSha,
    policy_path: policyPath,
    policy_version: policyVersion,
    policy_sha: policySha,
    target_state: targetState,
    workflow_mode: workflowMode,
    review_cycle: Number(reviewCycle),
    full_review_count: Number(fullReviewCount),
    active_pr: activePr,
    current_head: currentHead,
    last_reviewed_head: lastReviewedHead,
  }
  return {
    requestId: `${CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX}${sha256Hex(canonicalSerialize(tuple))}`,
    tuple,
  }
}

function provisionalPayloadFields({
  requestId,
  repository,
  campaignIssueNumber,
  sliceId,
  founderAuthorizationCommentId,
  planningHandoffCommentId,
  planningResultCommentId,
  planningBaselineSha,
  protectedBaseSha,
  policyPath,
  policyVersion,
  policySha,
  taskIssue = null,
} = {}) {
  return {
    schema_version: 1,
    status: 'provisional',
    provisional_schema: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
    request_id: requestId,
    repository,
    campaign_issue_number: Number(campaignIssueNumber),
    slice_id: Number(sliceId),
    founder_authorization_comment_id: normalizeImmutableCommentId(founderAuthorizationCommentId),
    planning_handoff_comment_id: normalizeImmutableCommentId(planningHandoffCommentId),
    planning_result_comment_id: normalizeImmutableCommentId(planningResultCommentId),
    planning_baseline_sha: planningBaselineSha,
    protected_base_sha: protectedBaseSha,
    policy_path: policyPath,
    policy_version: policyVersion,
    policy_sha: policySha,
    task_issue_number: taskIssue ? Number(taskIssue.number) : null,
    task_issue_id: taskIssue?.id ?? null,
    task_issue_node_id: taskIssue?.node_id ?? null,
  }
}

function provisionalFieldsValid(provisional) {
  return provisional?.schema_version === 1 &&
    provisional?.status === 'provisional' &&
    provisional?.provisional_schema === CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_SCHEMA &&
    provisional?.operation === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION &&
    provisional?.operation_version === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION &&
    validRequestId(provisional?.request_id) &&
    typeof provisional?.repository === 'string' &&
    Number.isInteger(provisional?.campaign_issue_number) &&
    Number.isInteger(provisional?.slice_id) &&
    normalizeImmutableCommentId(provisional?.founder_authorization_comment_id) != null &&
    normalizeImmutableCommentId(provisional?.planning_handoff_comment_id) != null &&
    normalizeImmutableCommentId(provisional?.planning_result_comment_id) != null &&
    /^[0-9a-f]{40}$/i.test(String(provisional?.planning_baseline_sha ?? '')) &&
    /^[0-9a-f]{40}$/i.test(String(provisional?.protected_base_sha ?? '')) &&
    typeof provisional?.policy_path === 'string' &&
    typeof provisional?.policy_version === 'string' &&
    /^[0-9a-f]{40}$/.test(String(provisional?.policy_sha ?? '')) &&
    Number.isInteger(provisional?.task_issue_number) &&
    typeof provisional?.task_issue_id === 'string' && provisional.task_issue_id &&
    typeof provisional?.task_issue_node_id === 'string' && provisional.task_issue_node_id
}

/**
 * Signed provisional body bound to the allocated Issue identity.
 * Unsigned marker copies are not recoverable provenance.
 */
export function renderCampaignSliceBootstrapProvisionalTaskBody({
  requestId,
  repository,
  campaignIssueNumber,
  sliceId,
  founderAuthorizationCommentId,
  planningHandoffCommentId,
  planningResultCommentId,
  planningBaselineSha,
  protectedBaseSha,
  policyPath,
  policyVersion,
  policySha,
  taskIssue,
  privateKey,
  keyId,
} = {}) {
  if (!taskIssue || !Number.isInteger(Number(taskIssue.number)) || !taskIssue.id || !taskIssue.node_id) {
    throw new Error('signed provisional allocation requires a complete Task Issue identity')
  }
  if (!privateKey || !keyId) {
    throw new Error('signed provisional allocation requires an explicit signing identity')
  }
  const payload = provisionalPayloadFields({
    requestId,
    repository,
    campaignIssueNumber,
    sliceId,
    founderAuthorizationCommentId,
    planningHandoffCommentId,
    planningResultCommentId,
    planningBaselineSha,
    protectedBaseSha,
    policyPath,
    policyVersion,
    policySha,
    taskIssue,
  })
  const envelope = createSignedEnvelope({
    schema: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    operationVersion: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
    keyId,
    payload,
    privateKey,
  })
  return [
    renderSignedEnvelope(envelope, {
      start: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START,
      end: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END,
    }),
    '',
    'This Issue is a recoverable provisional allocation for a campaign slice. It is not a managed Task until ownership and canonical projection are complete.',
  ].join('\n')
}

export function parseCampaignSliceBootstrapProvisionalTaskBody(body = '') {
  const parsed = parseSignedEnvelope(body, {
    start: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START,
    end: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END,
  })
  if (!parsed.ok) {
    // Preserve presence detection for unsigned/forged marker copies without treating them as valid.
    const present = String(body ?? '').includes(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START) ||
      String(body ?? '').includes(CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END)
    return {
      present,
      valid: false,
      reason: present ? (parsed.reason ?? 'provisional marker is not a signed envelope') : undefined,
      provisional: null,
      envelope: null,
    }
  }
  const provisional = parsed.envelope?.payload
  if (!provisionalFieldsValid(provisional)) {
    return {
      present: true,
      valid: false,
      reason: 'provisional allocation fields are invalid',
      provisional: null,
      envelope: null,
    }
  }
  return {
    present: true,
    valid: true,
    provisional,
    envelope: parsed.envelope,
  }
}

export function verifyCampaignSliceBootstrapProvisionalTaskBody(body, {
  publicKey,
  signingKeyId,
  repository,
  expectedRequestId,
  expectedTaskIssue,
} = {}) {
  const parsed = parseCampaignSliceBootstrapProvisionalTaskBody(body)
  if (!parsed.present) return { ok: false, reason: 'provisional marker absent', provisional: null }
  if (!parsed.valid || !parsed.envelope) {
    return { ok: false, reason: parsed.reason ?? 'provisional marker is not trusted provenance', provisional: null }
  }
  const verified = verifySignedEnvelope(parsed.envelope, {
    publicKey,
    repository,
    signingKeyId,
    expectedSchema: CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_SCHEMA,
    expectedOperation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    expectedOperationVersion: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
  })
  if (!verified.ok) {
    return { ok: false, reason: verified.reason, provisional: null }
  }
  const provisional = parsed.provisional
  if (expectedRequestId != null && provisional.request_id !== expectedRequestId) {
    return { ok: false, reason: 'provisional request identity mismatch', provisional: null }
  }
  if (expectedTaskIssue) {
    if (Number(provisional.task_issue_number) !== Number(expectedTaskIssue.number) ||
        String(provisional.task_issue_id) !== String(expectedTaskIssue.id) ||
        String(provisional.task_issue_node_id) !== String(expectedTaskIssue.node_id)) {
      return { ok: false, reason: 'provisional Task Issue identity mismatch', provisional: null }
    }
  }
  return { ok: true, reason: null, provisional, envelope: parsed.envelope }
}

export function renderCampaignSliceBootstrapCompletionMarker({
  requestId,
  repository,
  campaignIssueNumber,
  sliceId,
  taskIssue,
  taskBodySha256,
} = {}) {
  const payload = {
    schema_version: 1,
    status: 'complete',
    operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
    request_id: requestId,
    repository,
    campaign_issue_number: Number(campaignIssueNumber),
    slice_id: Number(sliceId),
    task_issue_number: Number(taskIssue?.number),
    task_issue_id: taskIssue?.id ?? null,
    task_issue_node_id: taskIssue?.node_id ?? null,
    task_body_sha256: taskBodySha256,
  }
  return [
    CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_START,
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_END,
  ].join('\n')
}

export function parseCampaignSliceBootstrapCompletionMarker(body = '') {
  const parsed = markerContents(
    body,
    CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_START,
    CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_END,
  )
  if (!parsed.present) return { present: false, valid: false, completion: null }
  if (!parsed.valid) return { present: true, valid: false, reason: parsed.reason, completion: null }
  const completion = parsed.value
  const valid = completion?.schema_version === 1 &&
    completion?.status === 'complete' &&
    completion?.operation === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION &&
    completion?.operation_version === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION &&
    validRequestId(completion?.request_id) &&
    typeof completion?.repository === 'string' &&
    Number.isInteger(completion?.campaign_issue_number) &&
    Number.isInteger(completion?.slice_id) &&
    Number.isInteger(completion?.task_issue_number) &&
    /^[0-9a-f]{64}$/.test(String(completion?.task_body_sha256 ?? ''))
  return valid
    ? { present: true, valid: true, completion }
    : { present: true, valid: false, reason: 'completion fields are invalid', completion: null }
}

// Short aliases mirror the genesis request module without sharing its markers.
export const renderProvisionalTaskBody = renderCampaignSliceBootstrapProvisionalTaskBody
export const parseProvisionalTaskBody = parseCampaignSliceBootstrapProvisionalTaskBody
