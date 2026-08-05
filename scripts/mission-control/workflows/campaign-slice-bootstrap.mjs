import { canonicalHash, sha256Hex, verifySignedEnvelope } from '../domain/task-attestation.mjs'
import {
  canonicalManagedStateBinding,
} from '../domain/task-bootstrap-preflight.mjs'
import { parseCampaign } from '../domain/campaign-parser.mjs'
import { replaceCampaignBlock } from '../domain/campaign-renderer.mjs'
import { validateCampaign } from '../domain/campaign-validator.mjs'
import {
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_END,
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION,
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
  CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START,
  CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
  CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION,
  createCampaignSliceBootstrapAttestation,
  createCampaignSliceBootstrapOwnershipRegistry,
  parseCampaignSliceBootstrapOwnershipRegistry,
  renderCampaignSliceBootstrapOwnershipRegistry,
  verifyCampaignSliceBootstrapOwnershipRegistry,
  validateCampaignSliceBootstrapFounderAuthorization,
} from '../domain/campaign-slice-bootstrap-authorization.mjs'
import {
  buildCampaignSliceBootstrapRequestIdentity,
  parseCampaignSliceBootstrapCompletionMarker,
  parseCampaignSliceBootstrapProvisionalTaskBody,
  renderCampaignSliceBootstrapCompletionMarker,
  renderCampaignSliceBootstrapProvisionalTaskBody,
} from '../domain/campaign-slice-bootstrap-request.mjs'
import {
  renderMissionControlState,
  parseMissionControlState,
} from '../../mission-control-state.mjs'

const ALLOWLIST_KEYS = Object.freeze([
  'founder_authorization_comment_id',
  'campaign_issue_number',
  'slice_id',
  'planning_handoff_comment_id',
  'planning_result_comment_id',
  'planning_baseline_sha',
])

const FULL_SHA = /^[0-9a-f]{40}$/i
const SHA256 = /^[0-9a-f]{64}$/i
function bootstrapError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

function stateConflict(message, cause) {
  return bootstrapError('STATE_CONFLICT', message, cause)
}

function blockedExternal(message, cause) {
  return bootstrapError('BLOCKED_EXTERNAL', message, cause)
}

function projectionFailed(message, cause) {
  return bootstrapError('PROJECTION_FAILED', message, cause)
}

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function isAmbiguous(error) {
  const code = error?.code ?? error?.classification
  return code === 'API_AMBIGUITY' ||
    /ambiguous|response lost|timeout|network|unavailable/i.test(error?.message ?? String(error))
}

function issueIdentity(issue) {
  if (!issue || !positiveId(issue.number) ||
      typeof issue.id !== 'string' || !issue.id ||
      typeof issue.node_id !== 'string' || !issue.node_id) {
    throw blockedExternal('GitHub did not return a complete Task Issue identity')
  }
  return {
    number: Number(issue.number),
    id: issue.id,
    node_id: issue.node_id,
    url: issue.url ?? issue.html_url ?? null,
  }
}

function commentBodyHash(comment) {
  return sha256Hex(String(comment?.body ?? ''))
}

function validateCallerInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw stateConflict('caller input must contain the six allowlisted campaign-slice bootstrap fields')
  }
  const keys = Object.keys(input).sort()
  const expectedKeys = [...ALLOWLIST_KEYS].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw stateConflict('caller input contains fields outside the campaign-slice bootstrap allowlist')
  }
  for (const key of [
    'founder_authorization_comment_id',
    'planning_handoff_comment_id',
    'planning_result_comment_id',
  ]) {
    if (!positiveId(input[key])) throw stateConflict(`${key} must be a positive immutable comment ID`)
  }
  if (Number(input.campaign_issue_number) !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber ||
      Number(input.slice_id) !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId) {
    throw stateConflict('caller-selected Campaign or slice is outside the approved Design B bootstrap')
  }
  if (!FULL_SHA.test(String(input.planning_baseline_sha ?? ''))) {
    throw stateConflict('planning_baseline_sha must be an exact full commit SHA')
  }
}

async function readProvisioningAndPermissions(github) {
  let provisioning
  let permissions
  try {
    if (typeof github.getChildRepositoryProvisioning === 'function') {
      provisioning = await github.getChildRepositoryProvisioning()
    } else if (typeof github.isChildRepositoryProvisioned === 'function') {
      throw blockedExternal('explicit protected workflow provisioning evidence is unavailable')
    } else {
      throw blockedExternal('child repository provisioning evidence is unavailable')
    }
    if (typeof github.getWorkflowPermissions === 'function') {
      permissions = await github.getWorkflowPermissions()
    } else if (typeof github.getPermissions === 'function') {
      permissions = await github.getPermissions()
    } else {
      throw blockedExternal('workflow permission evidence is unavailable')
    }
  } catch (error) {
    if (error.code === 'BLOCKED_EXTERNAL') throw error
    throw blockedExternal('provisioning or workflow permission evidence was unavailable', error)
  }
  if (provisioning?.childRepository !== true || provisioning?.workflow !== true) {
    throw blockedExternal('child repository and protected workflow provisioning are required')
  }
  if (permissions?.issues !== 'write' || permissions?.contents !== 'read') {
    throw blockedExternal('the protected workflow requires issues: write and contents: read')
  }
}

async function readProtectedBase(github) {
  try {
    const base = typeof github.getProtectedBase === 'function'
      ? await github.getProtectedBase()
      : await github.getBranchCommit(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef)
    if (base?.ref !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef ||
        !FULL_SHA.test(String(base?.sha ?? ''))) {
      throw stateConflict('protected base readback is incomplete')
    }
    return base
  } catch (error) {
    if (error.code === 'STATE_CONFLICT') throw error
    throw blockedExternal('protected base evidence was unavailable', error)
  }
}

async function readPolicy(github) {
  try {
    const policy = await github.getPolicy({
      ref: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.protectedBaseRef,
      path: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policyPath,
    })
    if (policy?.path !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policyPath ||
        policy?.version !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policyVersion ||
        policy?.blobSha !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.policySha ||
        policy?.sourceCommit == null) {
      throw stateConflict('protected policy path, version, blob, or source is not the approved identity')
    }
    return policy
  } catch (error) {
    if (error.code === 'STATE_CONFLICT') throw error
    throw blockedExternal('protected policy evidence was unavailable', error)
  }
}

function commentSupersedes(comment, targetId) {
  const body = String(comment?.body ?? '')
  const direct = [...body.matchAll(/supersedes_comment_id\s*:\s*([1-9]\d*)/gi)]
    .map((match) => match[1])
  const list = [...body.matchAll(/supersedes_comment_ids\s*:\s*\[([^\]]*)\]/gi)]
    .flatMap((match) => String(match[1]).match(/[1-9]\d*/g) ?? [])
  return [...direct, ...list].includes(String(targetId))
}

function findComment(comments, id) {
  return comments.find((comment) => String(comment?.id) === String(id)) ?? null
}

function validatePlanningComment(comment, {
  kind,
  input,
  protectedBaseSha,
  policy,
} = {}) {
  if (!comment || String(comment.issue_number) !== String(input.campaign_issue_number)) {
    throw stateConflict(`${kind} evidence is not attached to the approved Campaign Issue`)
  }
  const body = String(comment.body ?? '')
  const expectedHeader = kind === 'HANDOFF' ? '## HANDOFF' : '## RESULT'
  const expectedLines = [
    expectedHeader,
    `Campaign slice: ${input.slice_id}`,
    `main@${protectedBaseSha}`,
  ]
  if (kind === 'HANDOFF') expectedLines.push(policy.version)
  if (expectedLines.some((line) => !body.includes(line))) {
    throw stateConflict(`${kind} evidence is stale or does not bind the approved planning baseline`)
  }
  if (kind === 'RESULT' &&
      (!/Workflow mode:\**\s*planning_no_pr/.test(body) ||
        !/Review cycle:\**\s*0/.test(body) ||
        !/Full review count:\**\s*0/.test(body))) {
    throw stateConflict('planning RESULT does not bind the no-PR planning projection')
  }
  return {
    comment,
    bodySha256: commentBodyHash(comment),
  }
}

async function readPreflightContext(input, github, {
  publicKey,
  signingPrivateKey,
  signingKeyId,
} = {}) {
  await readProvisioningAndPermissions(github)
  let repository
  let campaignIssue
  let comments
  let founderLogins
  try {
    repository = await github.getRepository()
    campaignIssue = await github.getIssue(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
    comments = typeof github.getIssueComments === 'function'
      ? await github.getIssueComments(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
      : await github.listIssueComments(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
    founderLogins = typeof github.getTrustedFounderLogins === 'function'
      ? await github.getTrustedFounderLogins()
      : await github.getFounderLogins()
  } catch (error) {
    throw blockedExternal('repository, Campaign, comments, or Founder allowlist evidence was unavailable', error)
  }
  if (repository?.nameWithOwner !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.repository ||
      typeof repository?.id !== 'string' || typeof repository?.node_id !== 'string') {
    throw stateConflict('live repository identity is not the approved Campaign repository')
  }
  if (campaignIssue?.number !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber ||
      String(campaignIssue?.state).toLowerCase() !== 'open') {
    throw stateConflict('Campaign Issue #215 is not open')
  }
  const base = await readProtectedBase(github)
  if (base.sha !== input.planning_baseline_sha) {
    throw stateConflict('caller planning baseline does not match the protected base readback')
  }
  const policy = await readPolicy(github)
  if (policy.sourceCommit !== base.sha) {
    throw stateConflict('policy source commit does not match the protected planning baseline')
  }
  let campaignEvidence = null
  if (typeof github.getCampaignAuthorityEvidence === 'function') {
    try {
      campaignEvidence = await github.getCampaignAuthorityEvidence({ protectedBaseSha: base.sha })
    } catch (error) {
      throw blockedExternal('live Campaign expansion-authority evidence was unavailable', error)
    }
  }
  let authorizationComment
  try {
    authorizationComment = typeof github.getIssueComment === 'function'
      ? await github.getIssueComment(input.founder_authorization_comment_id)
      : findComment(comments, input.founder_authorization_comment_id)
  } catch (error) {
    throw stateConflict('caller-supplied Founder authorization comment could not be read', error)
  }
  const authorization = validateCampaignSliceBootstrapFounderAuthorization({
    authorizationComment,
    campaignIssue,
    founderLogins,
    comments,
    expected: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT,
    planningHandoffCommentId: input.planning_handoff_comment_id,
    planningResultCommentId: input.planning_result_comment_id,
    protectedBaseSha: base.sha,
  })
  const handoff = validatePlanningComment(findComment(comments, input.planning_handoff_comment_id), {
    kind: 'HANDOFF',
    input,
    protectedBaseSha: base.sha,
    policy,
  })
  const result = validatePlanningComment(findComment(comments, input.planning_result_comment_id), {
    kind: 'RESULT',
    input,
    protectedBaseSha: base.sha,
    policy,
  })
  if (comments.some((comment) =>
    String(comment?.id) !== String(handoff.comment.id) &&
    commentSupersedes(comment, handoff.comment.id),
  )) {
    throw stateConflict('planning HANDOFF evidence was superseded')
  }
  if (comments.some((comment) =>
    String(comment?.id) !== String(result.comment.id) &&
    commentSupersedes(comment, result.comment.id),
  )) {
    throw stateConflict('planning RESULT evidence was superseded')
  }
  const parsedCampaign = parseCampaign(campaignIssue.body ?? '', { evidence: campaignEvidence })
  if (!parsedCampaign.present || !parsedCampaign.valid) {
    throw stateConflict(`Campaign Issue #215 schema is invalid: ${parsedCampaign.reason ?? 'unreadable'}`)
  }
  const campaign = parsedCampaign.campaign
  const slice = campaign.slices?.[String(input.slice_id)]
  const emptyNotStartedWorld =
    slice?.status === 'NOT_STARTED' &&
    slice.issue === null &&
    slice.pr === null &&
    slice.reviewed_head === null &&
    slice.merged_commit === null &&
    Array.isArray(slice.authority_comment_ids) &&
    slice.authority_comment_ids.length === 0 &&
    Array.isArray(slice.blocker_ids) &&
    slice.blocker_ids.length === 0
  const alreadyPlanningWorld =
    slice?.status === 'PLANNING' &&
    positiveId(String(slice.issue ?? '').replace(/^#/, '')) &&
    slice.pr === null &&
    slice.reviewed_head === null &&
    slice.merged_commit === null
  if (campaign.campaign_issue !== '#215' ||
      campaign.campaign_lifecycle !== 'ACTIVE' ||
      (!emptyNotStartedWorld && !alreadyPlanningWorld) ||
      !Array.isArray(campaign.campaign_blockers) ||
      campaign.campaign_blockers.length !== 0) {
    throw stateConflict('Campaign Slice 5 is not an ACTIVE-compatible NOT_STARTED or planning recovery world')
  }
  return {
    repository,
    campaignIssue,
    comments,
    base,
    policy,
    authorization,
    handoff,
    result,
    campaign,
    campaignEvidence,
    publicKey,
    signingPrivateKey,
    signingKeyId,
  }
}

function parseCampaignSliceBootstrapAttestation(body) {
  const text = String(body ?? '')
  const starts = [...text.matchAll(new RegExp(
    CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g',
  ))]
  const ends = [...text.matchAll(new RegExp(
    CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'g',
  ))]
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index > ends[0].index) {
    return { ok: false, reason: 'exactly one balanced campaign-slice attestation marker pair is required' }
  }
  const raw = text.slice(
    starts[0].index + CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START.length,
    ends[0].index,
  ).replace(/```json\s*|```/g, '').trim()
  try {
    const envelope = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return { ok: false, reason: 'campaign-slice attestation must be a JSON object' }
    }
    return { ok: true, envelope }
  } catch (error) {
    return { ok: false, reason: `campaign-slice attestation is not valid JSON: ${error.message}` }
  }
}

function renderCampaignSliceBootstrapTaskBody(state, attestation) {
  return [
    '# Managed Task — campaign slice bootstrap',
    '',
    'This Issue was allocated by the protected Mission Control campaign-slice bootstrap transport.',
    'The provisional allocation is not authoritative; the distinct campaign-slice attestation and managed state below are canonical.',
    '',
    CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START,
    '```json',
    JSON.stringify(attestation, null, 2),
    '```',
    CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_END,
    '',
    renderMissionControlState(state),
    '',
    `Campaign registry: Issue #${CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber}, Slice ${CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId}.`,
  ].join('\n')
}

function buildTaskState({
  task,
  request,
  context,
  attestation,
  managedStateSha256,
  now,
} = {}) {
  return {
    schema_version: 1,
    state: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.targetState,
    review_cycle: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.reviewCycle,
    full_review_count: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.fullReviewCount,
    approved_base: context.base.ref,
    active_task_issue: `#${task.number}`,
    active_pr: null,
    current_head: null,
    last_reviewed_head: null,
    workflow_mode: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.workflowMode,
    planning_authorization_base_sha: context.base.sha,
    guide_version: context.policy.version,
    guide_source_ref: context.base.ref,
    guide_source_sha: context.policy.blobSha,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Founder decision on the bounded Campaign Slice 5 planning Task.',
    material_change_status: 'none',
    updated_at: now,
    updated_by: 'Mission Control Campaign Slice Bootstrap',
    parent_issue: `#${context.campaignIssue.number}`,
    policy_source: context.policy.path,
    policy_version: context.policy.version,
    policy_sha: context.policy.blobSha,
    bootstrap_request_id: request.requestId,
    task_attestation_schema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
    task_attestation_key_id: attestation.key_id,
    task_attestation_sha256: canonicalHash(attestation),
    managed_state_sha256: managedStateSha256,
    latest_result_comment_id: context.result.comment.id,
    latest_transition_identity: JSON.stringify({
      role: 'RESULT',
      taskId: String(task.number),
      phase: 'Investigation / Planning',
      contentHash: context.result.bodySha256,
    }),
  }
}

function buildTaskProjection({ task, request, context, now } = {}) {
  const payload = {
    attestation_schema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION,
    repository: context.repository.nameWithOwner,
    repository_id: context.repository.id,
    repository_node_id: context.repository.node_id,
    founder_login: context.authorization.authorLogin,
    founder_authorization_comment_id: context.authorization.commentId,
    founder_authorization_body_sha256: context.authorization.bodySha256,
    campaign_issue_number: context.campaignIssue.number,
    campaign_issue_id: context.campaignIssue.id,
    campaign_issue_node_id: context.campaignIssue.node_id,
    slice_id: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
    planning_handoff_comment_id: context.handoff.comment.id,
    planning_handoff_body_sha256: context.handoff.bodySha256,
    planning_result_comment_id: context.result.comment.id,
    planning_result_body_sha256: context.result.bodySha256,
    planning_baseline_sha: context.base.sha,
    protected_base_sha: context.base.sha,
    policy_path: context.policy.path,
    policy_version: context.policy.version,
    policy_sha: context.policy.blobSha,
    target_state: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.targetState,
    workflow_mode: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.workflowMode,
    review_cycle: 0,
    full_review_count: 0,
    active_pr: null,
    current_head: null,
    last_reviewed_head: null,
    task_issue_number: task.number,
    task_issue_id: task.id,
    task_issue_node_id: task.node_id,
    request_id: request.requestId,
    signing_key_id: context.signingKeyId,
    managed_state_sha256: null,
  }
  const provisionalAttestation = createCampaignSliceBootstrapAttestation({
    payload,
    ['privateKey']: context.signingPrivateKey,
    keyId: context.signingKeyId,
  })
  const detachedState = buildTaskState({
    task,
    request,
    context,
    attestation: provisionalAttestation,
    managedStateSha256: null,
    now,
  })
  const managedStateSha256 = canonicalManagedStateBinding(detachedState)
  const attestation = createCampaignSliceBootstrapAttestation({
    payload: { ...payload, managed_state_sha256: managedStateSha256 },
    ['privateKey']: context.signingPrivateKey,
    keyId: context.signingKeyId,
  })
  const state = buildTaskState({
    task,
    request,
    context,
    attestation,
    managedStateSha256,
    now,
  })
  return {
    attestation,
    state,
    body: renderCampaignSliceBootstrapTaskBody(state, attestation),
  }
}

function expectedPayloadMatches(payload, request, context, task) {
  return payload?.attestation_schema === CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA &&
    payload.operation === CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION &&
    payload.operation_version === CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION &&
    payload.repository === context.repository.nameWithOwner &&
    payload.repository_id === context.repository.id &&
    payload.repository_node_id === context.repository.node_id &&
    payload.founder_authorization_comment_id === context.authorization.commentId &&
    payload.founder_authorization_body_sha256 === context.authorization.bodySha256 &&
    payload.campaign_issue_number === Number(context.campaignIssue.number) &&
    payload.campaign_issue_id === context.campaignIssue.id &&
    payload.campaign_issue_node_id === context.campaignIssue.node_id &&
    payload.slice_id === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId &&
    payload.planning_handoff_comment_id === String(context.handoff.comment.id) &&
    payload.planning_handoff_body_sha256 === context.handoff.bodySha256 &&
    payload.planning_result_comment_id === String(context.result.comment.id) &&
    payload.planning_result_body_sha256 === context.result.bodySha256 &&
    payload.planning_baseline_sha === context.base.sha &&
    payload.protected_base_sha === context.base.sha &&
    payload.policy_path === context.policy.path &&
    payload.policy_version === context.policy.version &&
    payload.policy_sha === context.policy.blobSha &&
    payload.target_state === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.targetState &&
    payload.workflow_mode === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.workflowMode &&
    payload.review_cycle === 0 &&
    payload.full_review_count === 0 &&
    payload.active_pr === null &&
    payload.current_head === null &&
    payload.last_reviewed_head === null &&
    payload.task_issue_number === Number(task.number) &&
    payload.task_issue_id === task.id &&
    payload.task_issue_node_id === task.node_id &&
    payload.request_id === request.requestId &&
    payload.signing_key_id === context.signingKeyId &&
    SHA256.test(String(payload.managed_state_sha256 ?? ''))
}

function verifyTaskProjection(issue, request, context) {
  const parsedAttestation = parseCampaignSliceBootstrapAttestation(issue.body ?? '')
  if (!parsedAttestation.ok) throw stateConflict(`Task Issue #${issue.number} attestation is invalid: ${parsedAttestation.reason}`)
  const envelope = parsedAttestation.envelope
  const envelopeVerification = verifySignedEnvelope(envelope, {
    publicKey: context.publicKey,
    expectedSchema: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA,
    expectedOperation: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION,
    expectedOperationVersion: CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_OPERATION_VERSION,
    signingKeyId: context.signingKeyId,
    repository: context.repository.nameWithOwner,
  })
  if (!envelopeVerification.ok) {
    throw stateConflict(`Task Issue #${issue.number} attestation envelope failed signature verification: ${envelopeVerification.reason}`)
  }
  const task = issueIdentity(issue)
  if (!expectedPayloadMatches(envelope.payload, request, context, task)) {
    throw stateConflict(`Task Issue #${issue.number} attestation does not bind this request`)
  }
  const parsedState = parseMissionControlState(issue.body ?? '')
  if (!parsedState.present || !parsedState.valid) {
    throw stateConflict(`Task Issue #${issue.number} managed state is invalid: ${parsedState.reason ?? 'unreadable'}`)
  }
  const state = parsedState.state
  if (state.state !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.targetState ||
      state.review_cycle !== 0 ||
      state.full_review_count !== 0 ||
      state.active_task_issue !== `#${task.number}` ||
      state.active_pr !== null ||
      state.current_head !== null ||
      state.last_reviewed_head !== null ||
      state.workflow_mode !== CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.workflowMode ||
      state.planning_authorization_base_sha !== context.base.sha ||
      state.bootstrap_request_id !== request.requestId ||
      state.task_attestation_schema !== CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_SCHEMA ||
      state.task_attestation_key_id !== envelope.key_id ||
      state.latest_result_comment_id !== String(context.result.comment.id) ||
      !Array.isArray(state.open_blockers) ||
      state.open_blockers.length !== 0) {
    throw stateConflict(`Task Issue #${issue.number} managed state does not match the target projection`)
  }
  if (state.managed_state_sha256 !== canonicalManagedStateBinding(state) ||
      state.managed_state_sha256 !== envelope.payload.managed_state_sha256 ||
      state.task_attestation_sha256 !== canonicalHash(envelope) ||
      issue.body !== renderCampaignSliceBootstrapTaskBody(state, envelope)) {
    throw stateConflict(`Task Issue #${issue.number} is not the canonical campaign-slice projection`)
  }
  return { issue, task, attestation: envelope, state }
}

function provisionalMatches(provisional, request, context) {
  return provisional.request_id === request.requestId &&
    provisional.repository === context.repository.nameWithOwner &&
    provisional.campaign_issue_number === Number(context.campaignIssue.number) &&
    provisional.slice_id === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId &&
    provisional.founder_authorization_comment_id === String(context.authorization.commentId) &&
    provisional.planning_handoff_comment_id === String(context.handoff.comment.id) &&
    provisional.planning_result_comment_id === String(context.result.comment.id) &&
    provisional.planning_baseline_sha === context.base.sha &&
    provisional.protected_base_sha === context.base.sha &&
    provisional.policy_path === context.policy.path &&
    provisional.policy_version === context.policy.version &&
    provisional.policy_sha === context.policy.blobSha
}

async function scanTaskIssues(github, request, context) {
  let issues
  try {
    issues = await github.listIssues({ state: 'all' })
  } catch (error) {
    throw blockedExternal('Task Issue listing was unavailable during allocation recovery', error)
  }
  const provisional = []
  const final = []
  for (const issue of issues ?? []) {
    if (!issue || Number(issue.number) === Number(context.campaignIssue.number) || issue.pull_request) continue
    const body = String(issue.body ?? '')
    const provisionalParsed = parseCampaignSliceBootstrapProvisionalTaskBody(body)
    if (provisionalParsed.present) {
      if (!provisionalParsed.valid) {
        throw stateConflict(`provisional Task Issue #${issue.number} has invalid recovery metadata`)
      }
      const candidate = provisionalParsed.provisional
      const sameSlice = candidate.repository === context.repository.nameWithOwner &&
        candidate.campaign_issue_number === Number(context.campaignIssue.number) &&
        candidate.slice_id === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId
      if (sameSlice && !provisionalMatches(candidate, request, context)) {
        throw stateConflict(`provisional Task Issue #${issue.number} claims a competing request`)
      }
      if (provisionalMatches(candidate, request, context)) provisional.push({ issue, provisional: candidate })
      continue
    }
    const hasAttestation = body.includes(CAMPAIGN_SLICE_BOOTSTRAP_ATTESTATION_START)
    if (hasAttestation) {
      const parsed = parseCampaignSliceBootstrapAttestation(body)
      if (!parsed.ok) throw stateConflict(`Task Issue #${issue.number} has an unreadable campaign-slice attestation`)
      const payload = parsed.envelope.payload
      const sameSlice = payload?.repository === context.repository.nameWithOwner &&
        Number(payload?.campaign_issue_number) === Number(context.campaignIssue.number) &&
        Number(payload?.slice_id) === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId
      if (sameSlice && payload.request_id !== request.requestId) {
        throw stateConflict(`Task Issue #${issue.number} contains a competing campaign-slice request`)
      }
      if (payload.request_id === request.requestId) final.push({ issue, parsed })
      continue
    }
    // A raw Issue claiming to be a Task is not accepted provenance and must
    // never be silently adopted by this operation.
    if (/\btask\b/i.test(String(issue.title ?? '') + '\n' + body) &&
        !body.includes('bemoat-mission-control-task-attestation:v1')) {
      throw stateConflict(`raw Task Issue #${issue.number} has no accepted campaign-slice provenance`)
    }
  }
  if (provisional.length > 1 || final.length > 1) {
    throw stateConflict('multiple Task Issues claim the same campaign-slice request')
  }
  return {
    provisional: provisional[0] ?? null,
    final: final[0] ?? null,
  }
}

function campaignProjection(campaign, task, context, now) {
  const next = structuredClone(campaign)
  const key = String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId)
  next.slices[key] = {
    ...next.slices[key],
    status: 'PLANNING',
    issue: `#${task.number}`,
    pr: null,
    reviewed_head: null,
    merged_commit: null,
    authority_comment_ids: [
      context.authorization.commentId,
      String(context.handoff.comment.id),
      String(context.result.comment.id),
    ],
    blocker_ids: [],
  }
  next.updated_at = now
  next.updated_by = 'Mission Control Campaign Slice Bootstrap'
  next.next_permitted_action = 'Founder decision on the bounded Campaign Slice 5 planning Task.'
  return next
}

function campaignMatchesProjection(campaign, task, context) {
  const slice = campaign?.slices?.[String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId)]
  return campaign?.campaign_issue === '#215' &&
    campaign?.campaign_lifecycle === 'ACTIVE' &&
    Array.isArray(campaign?.campaign_blockers) &&
    campaign.campaign_blockers.length === 0 &&
    slice?.status === 'PLANNING' &&
    slice.issue === `#${task.number}` &&
    slice.pr === null &&
    slice.reviewed_head === null &&
    slice.merged_commit === null &&
    Array.isArray(slice.authority_comment_ids) &&
    slice.authority_comment_ids.length === 3 &&
    slice.authority_comment_ids.includes(String(context.authorization.commentId)) &&
    slice.authority_comment_ids.includes(String(context.handoff.comment.id)) &&
    slice.authority_comment_ids.includes(String(context.result.comment.id)) &&
    Array.isArray(slice.blocker_ids) &&
    slice.blocker_ids.length === 0
}

async function writeCampaignProjection(github, currentIssue, nextBody, requestId) {
  try {
    if (typeof github.compareAndSwapIssueBody !== 'function') {
      throw blockedExternal('Campaign Issue CAS/write adapter is unavailable')
    }
    await github.compareAndSwapIssueBody({
      number: currentIssue.number,
      expectedBody: currentIssue.body,
      body: nextBody,
      requestId,
    })
  } catch (error) {
    if (error.code === 'STATE_CONFLICT' || error.code === 'CAS_CONFLICT' ||
        /CAS_CONFLICT|compare-and-swap|state conflict/i.test(error.message ?? '')) {
      throw stateConflict('Campaign projection compare-and-swap conflicted', error)
    }
    if (error.code === 'BLOCKED_EXTERNAL') throw error
    throw projectionFailed('Campaign projection write failed', error)
  }
}

async function acquireLease(github, requestId) {
  if (typeof github.acquireCampaignLease === 'function') {
    return { lease: await github.acquireCampaignLease({ requestId }), kind: 'campaign' }
  }
  if (typeof github.acquireIssueLease === 'function') {
    return {
      lease: await github.acquireIssueLease({
        issueNumber: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber,
        requestId,
        scope: 'campaign-slice-bootstrap',
      }),
      kind: 'issue',
    }
  }
  throw blockedExternal('serialized Campaign slice lease/CAS adapter is unavailable')
}

async function releaseLease(github, holder, requestId) {
  if (!holder) return
  try {
    if (holder.kind === 'campaign' && typeof github.releaseCampaignLease === 'function') {
      await github.releaseCampaignLease({ requestId, lease: holder.lease })
    } else if (holder.kind === 'issue' && typeof github.releaseIssueLease === 'function') {
      await github.releaseIssueLease({
        issueNumber: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber,
        requestId,
        lease: holder.lease,
      })
    } else {
      holder.lease?.release?.()
    }
  } catch {
    // The next invocation revalidates the durable projection.
  }
}

function ownershipRegistryPayload(request, context, task, attestation) {
  return {
    schema_version: 1,
    registry_schema: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_SCHEMA,
    operation: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION,
    operation_version: CAMPAIGN_SLICE_BOOTSTRAP_REGISTRY_OPERATION_VERSION,
    repository: context.repository.nameWithOwner,
    repository_id: context.repository.id,
    repository_node_id: context.repository.node_id,
    campaign_issue_number: Number(context.campaignIssue.number),
    campaign_issue_id: context.campaignIssue.id,
    campaign_issue_node_id: context.campaignIssue.node_id,
    slice_id: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
    request_id: request.requestId,
    task_issue_number: Number(task.number),
    task_issue_id: task.id,
    task_issue_node_id: task.node_id,
    authority_comment_ids: [
      context.authorization.commentId,
      String(context.handoff.comment.id),
      String(context.result.comment.id),
    ],
    attestation_sha256: canonicalHash(attestation),
    signing_key_id: context.signingKeyId,
  }
}

async function readOwnershipRecords(github, context, request, task, attestation) {
  let entries
  try {
    entries = typeof github.getCampaignSliceOwnershipRecords === 'function'
      ? await github.getCampaignSliceOwnershipRecords({
        campaignIssueNumber: context.campaignIssue.number,
      })
      : await latestComments(github, context)
  } catch (error) {
    throw blockedExternal('Campaign slice ownership registry read was unavailable', error)
  }
  const valid = []
  for (const entry of entries ?? []) {
    let record = entry?.record ?? null
    if (!record && String(entry?.body ?? '').includes('campaign-slice-bootstrap:ownership-registry:v1')) {
      const parsed = parseCampaignSliceBootstrapOwnershipRegistry(entry.body)
      if (!parsed.ok) throw stateConflict(`Campaign slice ownership registry entry ${entry.id} is unreadable`)
      record = parsed.envelope
    }
    if (!record) continue
    const verification = verifyCampaignSliceBootstrapOwnershipRegistry(record, {
      publicKey: context.publicKey,
      repository: context.repository.nameWithOwner,
      signingKeyId: context.signingKeyId,
      expectedRequestId: record.payload?.request_id === request.requestId ? request.requestId : undefined,
      expectedCampaignIssue: context.campaignIssue,
      expectedSliceId: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
      expectedTaskIssue: record.payload?.task_issue_number === Number(task.number) ? task : undefined,
      expectedAttestationSha256: record.payload?.request_id === request.requestId
        ? canonicalHash(attestation)
        : undefined,
      expectedAuthorityCommentIds: [
        context.authorization.commentId,
        String(context.handoff.comment.id),
        String(context.result.comment.id),
      ],
    })
    if (!verification.ok) {
      throw stateConflict(`Campaign slice ownership registry entry ${entry?.id ?? 'record'} failed verification: ${verification.reason}`)
    }
    valid.push({ entry, record })
  }
  return valid
}

async function ensureOwnershipBinding(github, request, context, task, attestation) {
  const expectedAttestationSha256 = canonicalHash(attestation)
  const records = await readOwnershipRecords(github, context, request, task, attestation)
  const sameRequest = records.filter(({ record }) => record.payload.request_id === request.requestId)
  const competing = records.filter(({ record }) =>
    record.payload.repository === context.repository.nameWithOwner &&
    Number(record.payload.campaign_issue_number) === Number(context.campaignIssue.number) &&
    Number(record.payload.slice_id) === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId &&
    record.payload.request_id !== request.requestId,
  )
  if (competing.length > 0) throw stateConflict('Campaign Slice 5 ownership registry has a competing request')
  if (sameRequest.length > 1) throw stateConflict('Campaign Slice 5 ownership registry contains duplicate request bindings')
  if (sameRequest[0]) {
    const existing = sameRequest[0].record
    if (existing.payload.task_issue_number !== Number(task.number) ||
        existing.payload.task_issue_id !== task.id ||
        existing.payload.task_issue_node_id !== task.node_id ||
        existing.payload.attestation_sha256 !== expectedAttestationSha256) {
      throw stateConflict('Campaign Slice 5 ownership registry binds the request to different Task evidence')
    }
    return existing
  }

  const record = createCampaignSliceBootstrapOwnershipRegistry({
    payload: ownershipRegistryPayload(request, context, task, attestation),
    ['privateKey']: context.signingPrivateKey,
    keyId: context.signingKeyId,
  })
  try {
    if (typeof github.bindCampaignSliceOwnership !== 'function') {
      throw blockedExternal('Campaign slice ownership registry adapter is unavailable')
    }
    await github.bindCampaignSliceOwnership({
      requestId: request.requestId,
      taskIssueNumber: Number(task.number),
      taskIssueId: task.id,
      taskIssueNodeId: task.node_id,
      record,
      body: renderCampaignSliceBootstrapOwnershipRegistry(record),
    })
  } catch (error) {
    if (error.code === 'STATE_CONFLICT') throw error
    if (isAmbiguous(error)) throw blockedExternal('Campaign slice ownership registry write was ambiguous', error)
    throw projectionFailed('Campaign slice ownership registry write failed', error)
  }
  const reread = await readOwnershipRecords(github, context, request, task, attestation)
  const persisted = reread.find(({ record: candidate }) => candidate.payload.request_id === request.requestId)
  if (!persisted || canonicalHash(persisted.record) !== canonicalHash(record)) {
    throw projectionFailed('Campaign slice ownership registry write could not be verified')
  }
  return persisted.record
}

function completionForRequest(comments, requestId, task, context) {
  let matching = null
  for (const comment of comments ?? []) {
    const parsed = parseCampaignSliceBootstrapCompletionMarker(comment?.body ?? '')
    if (!parsed.present) continue
    if (!parsed.valid) throw stateConflict(`completion record ${comment.id} is invalid`)
    const completion = parsed.completion
    const sameSlice = completion.repository === context.repository.nameWithOwner &&
      completion.campaign_issue_number === Number(context.campaignIssue.number) &&
      completion.slice_id === CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId
    if (!sameSlice) continue
    if (completion.request_id !== requestId) {
      throw stateConflict('Campaign slice already has a competing completed request')
    }
    if (completion.task_issue_number !== Number(task.number) ||
        completion.task_issue_id !== task.id ||
        completion.task_issue_node_id !== task.node_id) {
      throw stateConflict('completion record points to a different Task identity')
    }
    matching = completion
  }
  return matching
}

async function recordCompletion(github, request, context, task) {
  const comments = typeof github.getIssueComments === 'function'
    ? await github.getIssueComments(context.campaignIssue.number)
    : await github.listIssueComments(context.campaignIssue.number)
  const existing = completionForRequest(comments, request.requestId, task, context)
  const body = String(task.body ?? '')
  const bodySha256 = sha256Hex(body)
  if (existing) {
    if (existing.task_body_sha256 !== bodySha256) {
      throw stateConflict('completion record does not bind the current canonical Task body')
    }
    return { recorded: false, completion: existing }
  }
  if (typeof github.postIssueComment !== 'function') {
    throw blockedExternal('Campaign slice completion record adapter is unavailable')
  }
  const marker = renderCampaignSliceBootstrapCompletionMarker({
    requestId: request.requestId,
    repository: context.repository.nameWithOwner,
    campaignIssueNumber: context.campaignIssue.number,
    sliceId: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
    taskIssue: task,
    taskBodySha256: bodySha256,
  })
  try {
    const posted = await github.postIssueComment(context.campaignIssue.number, marker)
    return { recorded: true, completion: posted }
  } catch (error) {
    if (isAmbiguous(error)) throw projectionFailed('Campaign slice completion record write was ambiguous', error)
    throw projectionFailed('Campaign slice completion record write failed', error)
  }
}

async function readCurrentCampaign(github, campaignEvidence = null) {
  let issue
  try {
    issue = await github.getIssue(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.campaignIssueNumber)
  } catch (error) {
    throw blockedExternal('Campaign Issue readback was unavailable', error)
  }
  const parsed = parseCampaign(issue.body ?? '', { evidence: campaignEvidence })
  if (!parsed.present || !parsed.valid) {
    throw stateConflict(`Campaign readback is invalid: ${parsed.reason ?? 'unreadable'}`)
  }
  return { issue, campaign: parsed.campaign }
}

async function readTask(github, taskNumber) {
  try {
    return await github.getIssue(taskNumber)
  } catch (error) {
    if (isAmbiguous(error)) throw projectionFailed(`Task Issue #${taskNumber} readback was unavailable after projection`, error)
    throw blockedExternal(`Task Issue #${taskNumber} readback was unavailable`, error)
  }
}

async function latestComments(github, context) {
  try {
    return typeof github.getIssueComments === 'function'
      ? await github.getIssueComments(context.campaignIssue.number)
      : await github.listIssueComments(context.campaignIssue.number)
  } catch (error) {
    throw blockedExternal('Campaign Issue comments were unavailable during completion recovery', error)
  }
}

export async function runCampaignSliceBootstrap(input, deps = {}) {
  validateCallerInput(input)
  const github = deps.github ?? deps
  if (!github || typeof github.getRepository !== 'function') {
    throw blockedExternal('Campaign slice bootstrap GitHub adapter is unavailable')
  }
  const publicKey = deps.publicKey
  const signingPrivateKey = deps.signingPrivateKey ?? deps.privateKey
  const signingKeyId = deps.signingKeyId ?? deps.keyId
  if (typeof publicKey !== 'string' || !publicKey ||
      typeof signingPrivateKey !== 'string' || !signingPrivateKey ||
      typeof signingKeyId !== 'string' || !signingKeyId) {
    throw blockedExternal('campaign-slice bootstrap signing material or committed public verification key is unavailable')
  }
  let context
  try {
    context = await readPreflightContext(input, github, {
      publicKey,
      signingPrivateKey,
      signingKeyId,
    })
  } catch (error) {
    throw error
  }
  const request = buildCampaignSliceBootstrapRequestIdentity({
    repository: context.repository.nameWithOwner,
    founderAuthorizationCommentId: context.authorization.commentId,
    founderAuthorizationBodySha256: context.authorization.bodySha256,
    campaignIssueNumber: context.campaignIssue.number,
    sliceId: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
    planningHandoffCommentId: context.handoff.comment.id,
    planningHandoffBodySha256: context.handoff.bodySha256,
    planningResultCommentId: context.result.comment.id,
    planningResultBodySha256: context.result.bodySha256,
    planningBaselineSha: context.base.sha,
    protectedBaseSha: context.base.sha,
    policyPath: context.policy.path,
    policyVersion: context.policy.version,
    policySha: context.policy.blobSha,
    targetState: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.targetState,
    workflowMode: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.workflowMode,
    reviewCycle: 0,
    fullReviewCount: 0,
    activePr: null,
    currentHead: null,
    lastReviewedHead: null,
  })
  const now = typeof deps.now === 'function' ? deps.now() : new Date().toISOString()
  let holder = null
  try {
    holder = await acquireLease(github, request.requestId)
    let current = await readCurrentCampaign(github, context.campaignEvidence)
    const scanned = await scanTaskIssues(github, request, context)
    let taskIssue = scanned.final?.issue ?? scanned.provisional?.issue ?? null
    let initialized = Boolean(scanned.final)
    if (current.campaign.campaign_lifecycle !== 'ACTIVE' ||
        !current.campaign.slices?.[String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId)]) {
      throw stateConflict('Campaign lifecycle or target slice is not available for projection')
    }
    const currentSlice = current.campaign.slices[String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId)]
    if (currentSlice.status === 'PLANNING') {
      if (!taskIssue || currentSlice.issue !== `#${taskIssue.number}`) {
        throw stateConflict('Campaign Slice 5 is already bound to a different Task')
      }
    } else if (currentSlice.status !== 'NOT_STARTED') {
      throw stateConflict('Campaign Slice 5 is not NOT_STARTED or already bound to this request')
    }
    if (!taskIssue) {
      if (typeof github.createIssue !== 'function') throw blockedExternal('Task Issue allocation adapter is unavailable')
      const provisionalBody = renderCampaignSliceBootstrapProvisionalTaskBody({
        requestId: request.requestId,
        repository: context.repository.nameWithOwner,
        campaignIssueNumber: context.campaignIssue.number,
        sliceId: CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId,
        founderAuthorizationCommentId: context.authorization.commentId,
        planningHandoffCommentId: context.handoff.comment.id,
        planningResultCommentId: context.result.comment.id,
        planningBaselineSha: context.base.sha,
        protectedBaseSha: context.base.sha,
        policyPath: context.policy.path,
        policyVersion: context.policy.version,
        policySha: context.policy.blobSha,
      })
      try {
        taskIssue = await github.createIssue({
          title: '[Mission Control][Provisional] Campaign Slice 5 planning Task bootstrap',
          body: provisionalBody,
        })
        if (!taskIssue || taskIssue.body !== provisionalBody) {
          throw blockedExternal('provisional Task allocation did not return the exact body')
        }
      } catch (error) {
        if (error.code === 'BLOCKED_EXTERNAL') throw error
        if (isAmbiguous(error)) {
          throw blockedExternal('Task allocation response was ambiguous; retry with the same request identity', error)
        }
        throw projectionFailed('Task allocation failed', error)
      }
      issueIdentity(taskIssue)
      if (typeof deps.failureInjector === 'function') {
        await deps.failureInjector('after-task-allocation')
      }
    }
    const taskIdentity = issueIdentity(taskIssue)
    let taskProjection
    if (initialized) {
      taskProjection = verifyTaskProjection(taskIssue, request, context)
    } else {
      const projection = buildTaskProjection({
        task: taskIdentity,
        request,
        context,
        now,
      })
      try {
        if (typeof github.updateIssueBody === 'function') {
          taskIssue = await github.updateIssueBody(taskIdentity.number, projection.body)
        } else if (typeof github.compareAndSwapIssueBody === 'function') {
          taskIssue = await github.compareAndSwapIssueBody({
            number: taskIdentity.number,
            expectedBody: taskIssue.body,
            body: projection.body,
            requestId: request.requestId,
          })
        } else {
          throw blockedExternal('Task Issue projection adapter is unavailable')
        }
      } catch (error) {
        if (error.code === 'BLOCKED_EXTERNAL') throw error
        if (error.code === 'STATE_CONFLICT' || error.code === 'CAS_CONFLICT') {
          throw stateConflict('Task projection compare-and-swap conflicted', error)
        }
        if (isAmbiguous(error)) throw projectionFailed('Task projection response was ambiguous', error)
        throw projectionFailed('Task managed-state projection failed', error)
      }
      if (!taskIssue || taskIssue.body !== projection.body) {
        throw projectionFailed('Task projection did not return the exact canonical body')
      }
      taskProjection = verifyTaskProjection(taskIssue, request, context)
    }
    await ensureOwnershipBinding(
      github,
      request,
      context,
      taskProjection.task,
      taskProjection.attestation,
    )
    if (!initialized && typeof deps.failureInjector === 'function') {
      await deps.failureInjector('after-task-initialization')
    }
    current = await readCurrentCampaign(github, context.campaignEvidence)
    const refreshedSlice = current.campaign.slices[String(CAMPAIGN_SLICE_BOOTSTRAP_CONTRACT.sliceId)]
    if (refreshedSlice.status === 'PLANNING') {
      if (!campaignMatchesProjection(current.campaign, taskIdentity, context)) {
        throw stateConflict('Campaign Slice 5 is bound but its projection does not match this request')
      }
    } else {
      if (refreshedSlice.status !== 'NOT_STARTED') {
        throw stateConflict('Campaign Slice 5 changed before projection')
      }
      if (typeof deps.failureInjector === 'function') {
        await deps.failureInjector('before-campaign-projection')
      }
      const nextCampaign = campaignProjection(current.campaign, taskIdentity, context, now)
      const validated = validateCampaign(nextCampaign, { evidence: context.campaignEvidence })
      if (!validated.valid) throw stateConflict(`Campaign projection is invalid: ${validated.reason ?? 'unreadable'}`)
      const replacement = replaceCampaignBlock(current.issue.body, validated.campaign, {
        evidence: context.campaignEvidence,
      })
      await writeCampaignProjection(github, current.issue, replacement.body, request.requestId)
    }
    const taskReadback = await readTask(github, taskIdentity.number)
    const verifiedTask = verifyTaskProjection(taskReadback, request, context)
    await ensureOwnershipBinding(
      github,
      request,
      context,
      verifiedTask.task,
      verifiedTask.attestation,
    )
    const campaignReadback = await readCurrentCampaign(github, context.campaignEvidence)
    if (!campaignMatchesProjection(campaignReadback.campaign, taskIdentity, context)) {
      throw projectionFailed('Campaign readback does not match the Task projection')
    }
    const comments = await latestComments(github, context)
    const completion = completionForRequest(comments, request.requestId, taskIdentity, context)
    if (completion) {
      if (completion.task_body_sha256 !== sha256Hex(String(verifiedTask.issue.body ?? ''))) {
        throw stateConflict('completed campaign-slice record does not bind the current Task body')
      }
      return {
        ok: true,
        outcome: 'NO_OP',
        requestId: request.requestId,
        issue: verifiedTask.issue,
        campaign: campaignReadback.campaign,
        attestation: verifiedTask.attestation,
      }
    }
    await recordCompletion(github, request, context, verifiedTask.issue)
    return {
      ok: true,
      outcome: 'SUCCESS',
      requestId: request.requestId,
      issue: verifiedTask.issue,
      campaign: campaignReadback.campaign,
      attestation: verifiedTask.attestation,
      taskProjection,
    }
  } catch (error) {
    if (error.code === 'STATE_CONFLICT' ||
        error.code === 'BLOCKED_EXTERNAL' ||
        error.code === 'PROJECTION_FAILED') {
      throw error
    }
    throw projectionFailed('campaign-slice bootstrap failed at a recoverable projection boundary', error)
  } finally {
    await releaseLease(github, holder, request.requestId)
  }
}

export {
  bootstrapError,
  parseCampaignSliceBootstrapAttestation,
  renderCampaignSliceBootstrapTaskBody,
}
