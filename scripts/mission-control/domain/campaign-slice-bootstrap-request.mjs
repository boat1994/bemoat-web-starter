import { canonicalSerialize, sha256Hex } from './task-attestation.mjs'

export const CAMPAIGN_SLICE_BOOTSTRAP_OPERATION = 'campaign-slice-bootstrap'
export const CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION = 1
export const CAMPAIGN_SLICE_BOOTSTRAP_REQUEST_ID_PREFIX = 'mc-campaign-slice-bootstrap-v1-'
export const CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:provisional:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:provisional:end -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_START =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:completion:v1 -->'
export const CAMPAIGN_SLICE_BOOTSTRAP_COMPLETION_MARKER_END =
  '<!-- bemoat-mission-control-campaign-slice-bootstrap:completion:end -->'

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
    founder_authorization_comment_id: String(founderAuthorizationCommentId),
    founder_authorization_body_sha256: founderAuthorizationBodySha256,
    campaign_issue_number: Number(campaignIssueNumber),
    slice_id: Number(sliceId),
    planning_handoff_comment_id: String(planningHandoffCommentId),
    planning_handoff_body_sha256: planningHandoffBodySha256,
    planning_result_comment_id: String(planningResultCommentId),
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
} = {}) {
  const payload = {
    schema_version: 1,
    status: 'provisional',
    operation: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION,
    request_id: requestId,
    repository,
    campaign_issue_number: Number(campaignIssueNumber),
    slice_id: Number(sliceId),
    founder_authorization_comment_id: String(founderAuthorizationCommentId),
    planning_handoff_comment_id: String(planningHandoffCommentId),
    planning_result_comment_id: String(planningResultCommentId),
    planning_baseline_sha: planningBaselineSha,
    protected_base_sha: protectedBaseSha,
    policy_path: policyPath,
    policy_version: policyVersion,
    policy_sha: policySha,
  }
  return [
    CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START,
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END,
    '',
    'This Issue is a recoverable provisional allocation for a campaign slice. It is not a managed Task until the canonical projection is complete.',
  ].join('\n')
}

export function parseCampaignSliceBootstrapProvisionalTaskBody(body = '') {
  const parsed = markerContents(
    body,
    CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_START,
    CAMPAIGN_SLICE_BOOTSTRAP_PROVISIONAL_MARKER_END,
  )
  if (!parsed.present) return { present: false, valid: false, provisional: null }
  if (!parsed.valid) {
    return { present: true, valid: false, reason: parsed.reason, provisional: null }
  }
  const provisional = parsed.value
  const valid = provisional?.schema_version === 1 &&
    provisional?.status === 'provisional' &&
    provisional?.operation === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION &&
    provisional?.operation_version === CAMPAIGN_SLICE_BOOTSTRAP_OPERATION_VERSION &&
    validRequestId(provisional?.request_id) &&
    typeof provisional?.repository === 'string' &&
    Number.isInteger(provisional?.campaign_issue_number) &&
    Number.isInteger(provisional?.slice_id) &&
    /^[1-9]\d*$/.test(String(provisional?.founder_authorization_comment_id ?? '')) &&
    /^[1-9]\d*$/.test(String(provisional?.planning_handoff_comment_id ?? '')) &&
    /^[1-9]\d*$/.test(String(provisional?.planning_result_comment_id ?? '')) &&
    /^[0-9a-f]{40}$/i.test(String(provisional?.planning_baseline_sha ?? '')) &&
    provisional?.protected_base_sha === provisional?.planning_baseline_sha &&
    typeof provisional?.policy_path === 'string' &&
    typeof provisional?.policy_version === 'string' &&
    /^[0-9a-f]{40}$/.test(String(provisional?.policy_sha ?? ''))
  return valid
    ? { present: true, valid: true, provisional }
    : {
        present: true,
        valid: false,
        reason: 'provisional allocation fields are invalid',
        provisional: null,
      }
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
