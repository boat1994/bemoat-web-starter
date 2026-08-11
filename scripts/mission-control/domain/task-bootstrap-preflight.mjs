import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseMissionControlState, renderMissionControlState } from './task-state.mjs'
import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { canonicalHash, parseTaskAttestation, renderSignedEnvelope, verifyTaskAttestation } from './task-attestation.mjs'
import { parseProvisionalTaskBody } from './task-bootstrap-request.mjs'

function result(ok, reason = null, classification = null, evidence = null) {
  return { ok, reason, classification, evidence }
}

export function canonicalManagedStateBinding(state) {
  const detached = { ...state, managed_state_sha256: null, task_attestation_sha256: null }
  return canonicalHash(detached)
}

export function renderCanonicalBootstrapTaskBody(state, attestation) {
  return [
    '# Managed Task — canonical bootstrap',
    '',
    'This Issue was allocated by the protected Mission Control Task bootstrap transport.',
    'The provisional allocation is not authoritative; the signed attestation and managed state below are the canonical binding.',
    '',
    renderSignedEnvelope(attestation),
    '',
    renderMissionControlState(state),
    '',
    'Parent registry: Issue #262. Do not edit the signed attestation or managed state directly.',
  ].join('\n')
}

/**
 * Entry-point adapter for agent, dispatch, review, reconcile, and merge
 * readers. Legacy Tasks return a successful legacy result; bootstrap Tasks are
 * always checked against the committed public key and their live Issue/PR.
 * @param {{issue?: any, pullRequest?: any, repository?: string, repositoryIdentity?: any, publicKey?: string, signingKeyId?: string, expectedProtectedBaseSha?: string, expectedAuthorization?: any, expectedWorkflow?: any, policy?: any}} options
 */
export function preflightCanonicalBootstrapTask({
  issue,
  pullRequest,
  repository,
  publicKey = null,
  signingKeyId = null,
  expectedProtectedBaseSha = null,
  expectedAuthorization = null,
  expectedWorkflow = null,
  policy = null,
  repositoryIdentity = null,
} = {}) {
  const body = String(issue?.body ?? '')
  const provisional = parseProvisionalTaskBody(body)
  if (provisional.present) return result(false, 'provisional allocation is not a managed Task', 'STATE_CONFLICT')
  const state = parseMissionControlState(body)
  const bootstrap = body.includes('bemoat-mission-control-task-attestation:v1') ||
    (state.valid && (Object.hasOwn(state.state, 'bootstrap_request_id') || Object.hasOwn(state.state, 'task_attestation_schema')))
  if (!bootstrap) return result(true, null, null, { legacy: true })
  const parsed = parseTaskAttestation(body)
  if (!parsed.ok) return result(false, parsed.reason, 'STATE_CONFLICT')
  const payload = parsed.envelope.payload ?? {}
  let verificationKey = publicKey
  if (!verificationKey) {
    try {
      verificationKey = readFileSync(resolve(process.cwd(), '.bemoat/mission-control/task-bootstrap-public-key.pem'), 'utf8')
    } catch (error) {
      return result(false, `committed public verification key is unavailable: ${error.message}`, 'BLOCKED_EXTERNAL')
    }
  }
  const livePullRequest = pullRequest ?? {
    number: payload.pr_number,
    id: null,
    node_id: null,
    headRefOid: payload.head,
    baseRefName: payload.base,
    statusCheckRollup: [],
  }
  const livePolicy = policy ?? {
    path: state.state?.policy_source ?? payload.policy_path,
    version: state.state?.policy_version ?? payload.policy_version,
    sourceCommit: payload.policy_source_commit,
    blobSha: state.state?.policy_sha ?? payload.policy_blob_sha,
  }
  const liveWorkflow = expectedWorkflow ?? {
    file: payload.workflow_file,
    ref: payload.workflow_ref,
    sha: payload.workflow_sha,
    runId: payload.workflow_run_id,
  }
  const liveAuthorization = expectedAuthorization ?? {
    commentId: payload.authorization_comment_id,
    bodySha256: payload.authorization_body_sha256,
    authorLogin: payload.founder_login,
    parentIssue: { number: payload.parent_issue_number },
  }
  return runCanonicalManagedTaskPreflight({
    issue,
    pullRequest: livePullRequest,
    repository,
    publicKey: verificationKey,
    signingKeyId: signingKeyId ?? state.state?.task_attestation_key_id ?? parsed.envelope.key_id,
    expectedProtectedBaseSha: expectedProtectedBaseSha ?? payload.protected_base_sha,
    expectedAuthorization: liveAuthorization,
    expectedWorkflow: liveWorkflow,
    policy: livePolicy,
    repositoryIdentity,
    requireBootstrapAttestation: true,
  })
}

/**
 * Canonical managed-task preflight. Legacy managed tasks remain readable, but
 * any task carrying bootstrap provenance must pass the signed-attestation gate.
 * @param {{issue?: any, pullRequest?: any, repository?: string, repositoryIdentity?: any, publicKey?: string, signingKeyId?: string, expectedProtectedBaseSha?: string, expectedAuthorization?: any, expectedWorkflow?: any, policy?: any, requireBootstrapAttestation?: boolean}} options
 */
export function runCanonicalManagedTaskPreflight({
  issue,
  pullRequest,
  repository,
  repositoryIdentity,
  publicKey,
  signingKeyId,
  expectedProtectedBaseSha,
  expectedAuthorization,
  expectedWorkflow,
  policy,
  requireBootstrapAttestation = false,
} = {}) {
  if (!issue || !pullRequest) return result(false, 'Issue and PR evidence are required', 'BLOCKED_EXTERNAL')
  const parsedState = parseMissionControlState(issue.body ?? '')
  if (!parsedState.present || !parsedState.valid) return result(false, parsedState.reason ?? 'managed state is missing or unreadable', 'STATE_CONFLICT')
  const state = parsedState.state
  const attestationPresent = String(issue.body ?? '').includes('bemoat-mission-control-task-attestation:v1') ||
    Object.hasOwn(state, 'bootstrap_request_id') || Object.hasOwn(state, 'task_attestation_schema')
  if (!requireBootstrapAttestation && !attestationPresent) {
    return result(true, null, null, { state, legacy: true })
  }
  const parsedAttestation = parseTaskAttestation(issue.body ?? '')
  if (!parsedAttestation.ok) return result(false, parsedAttestation.reason, 'STATE_CONFLICT')
  const payload = parsedAttestation.envelope.payload
  const verification = verifyTaskAttestation(parsedAttestation.envelope, {
    publicKey,
    signingKeyId,
    repository,
    repositoryIdentity,
    protectedBaseSha: expectedProtectedBaseSha,
    authorizationCommentId: expectedAuthorization?.commentId,
    authorizationBodySha256: expectedAuthorization?.bodySha256,
    founderLogin: expectedAuthorization?.authorLogin,
    parentIssue: expectedAuthorization?.parentIssue,
    taskIssue: issue,
    pullRequest,
    expectedHead: pullRequest.headRefOid,
    expectedBase: pullRequest.baseRefName,
    policy,
    requestId: state.bootstrap_request_id ?? payload.request_id,
    expectedWorkflow,
  })
  if (!verification.ok) return result(false, verification.reason, 'STATE_CONFLICT')
  const expectedManagedStateSha256 = canonicalManagedStateBinding(state)
  if (state.managed_state_sha256 !== expectedManagedStateSha256 ||
      state.task_attestation_sha256 !== canonicalHash(parsedAttestation.envelope) ||
      parsedAttestation.envelope.payload.managed_state_sha256 !== expectedManagedStateSha256) {
    return result(false, 'signed attestation does not bind the managed state projection', 'STATE_CONFLICT')
  }
  if (issue.body !== renderCanonicalBootstrapTaskBody(state, parsedAttestation.envelope)) {
    return result(false, 'managed Task body is not the canonical signed projection', 'STATE_CONFLICT')
  }
  if (state.bootstrap_request_id !== payload.request_id ||
      state.task_attestation_schema !== payload.attestation_schema ||
      state.task_attestation_key_id !== parsedAttestation.envelope.key_id ||
      state.active_task_issue !== `#${issue.number}` ||
      state.active_pr !== `#${pullRequest.number}` ||
      state.current_head !== pullRequest.headRefOid ||
      state.approved_base !== pullRequest.baseRefName ||
      state.parent_issue !== `#${expectedAuthorization?.parentIssue?.number ?? payload.parent_issue_number}` ||
      state.policy_source !== policy?.path || state.policy_version !== policy?.version || state.policy_sha !== policy?.blobSha) {
    return result(false, 'managed state does not mirror the signed canonical binding', 'STATE_CONFLICT')
  }
  const ci = analyzeExactHeadCi(pullRequest)
  if (!ci.exactHeadVerified) return result(false, ci.summary, 'STATE_CONFLICT')
  const successfulNames = new Set((Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : [])
    .filter((check) => check?.conclusion === 'SUCCESS' || check?.state === 'SUCCESS')
    .map((check) => check.name ?? check.context))
  for (const required of ['ci', 'starter-ci']) {
    if (!successfulNames.has(required)) return result(false, `required exact-head CI check ${required} is missing or unsuccessful`, 'STATE_CONFLICT')
  }
  return result(true, null, null, { state, attestation: parsedAttestation.envelope, ci, legacy: false })
}
