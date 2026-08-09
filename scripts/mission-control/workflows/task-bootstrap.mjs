import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { parseMissionControlState } from '../../mission-control-state.mjs'
import { compareAndSwapIssueBody } from '../../mission-control-issue-body-cas.mjs'
import {
  BOOTSTRAP_CONTRACT,
  parseFounderTaskBootstrapAuthorization,
  validateFounderTaskBootstrapAuthorization,
} from '../domain/task-bootstrap-authorization.mjs'
import {
  buildTaskBootstrapRequestIdentity,
  parseProvisionalTaskBody,
  renderProvisionalTaskBody,
} from '../domain/task-bootstrap-request.mjs'
import {
  TASK_ATTESTATION_OPERATION,
  TASK_ATTESTATION_OPERATION_VERSION,
  TASK_ATTESTATION_SCHEMA,
  canonicalHash,
  createSignedEnvelope,
  parseTaskAttestation,
  sha256Hex,
} from '../domain/task-attestation.mjs'
import {
  buildTaskOwnershipPayload,
  createTaskOwnershipRecord,
  parseTaskOwnershipRecord,
  renderTaskOwnershipRecord,
  verifyTaskOwnershipRecord,
} from '../domain/task-ownership-registry.mjs'
import {
  canonicalManagedStateBinding,
  renderCanonicalBootstrapTaskBody,
  runCanonicalManagedTaskPreflight,
} from '../domain/task-bootstrap-preflight.mjs'
import { classifyTaskBootstrapAllocation, matchesProvisional } from '../domain/task-bootstrap-allocation.mjs'

const REQUIRED_CI_NAMES = new Set(['ci', 'starter-ci'])

function bootstrapError(code, message, cause) {
  const error = new Error(`${code}: ${message}`, cause ? { cause } : undefined)
  error.code = code
  error.classification = code
  return error
}

function stateConflict(message, cause) { return bootstrapError('STATE_CONFLICT', message, cause) }
function blockedExternal(message, cause) { return bootstrapError('BLOCKED_EXTERNAL', message, cause) }
function projectionFailed(message, cause) { return bootstrapError('PROJECTION_FAILED', message, cause) }

function isAmbiguous(error) {
  if (!error) return false
  const code = error.code ?? error.classification
  return code === 'API_AMBIGUITY' || code === 'BLOCKED_EXTERNAL' || /timeout|network|response lost|unavailable|ambiguous/i.test(error.message ?? String(error))
}

function positiveId(value) {
  return /^[1-9]\d*$/.test(String(value ?? ''))
}

function issueIdentity(issue) {
  if (!issue || !positiveId(issue.number) || typeof issue.id !== 'string' || !issue.id || typeof issue.node_id !== 'string' || !issue.node_id) {
    throw blockedExternal('GitHub did not return a complete allocated Issue identity')
  }
  return {
    number: Number(issue.number),
    id: issue.id,
    node_id: issue.node_id,
    url: issue.url ?? issue.html_url ?? null,
  }
}

function prIdentity(pr) {
  if (!pr || !positiveId(pr.number) || typeof pr.id !== 'string' || !pr.id || typeof pr.node_id !== 'string' || !pr.node_id) {
    throw blockedExternal('GitHub did not return a complete PR identity')
  }
  return { number: Number(pr.number), id: pr.id, node_id: pr.node_id, url: pr.url ?? pr.html_url ?? null }
}

function bodyHash(body) {
  return sha256Hex(String(body ?? ''))
}

function exactHeadCi(pr) {
  const analysis = analyzeExactHeadCi(pr)
  if (!analysis.exactHeadVerified) throw stateConflict(`required exact-head CI is not verified: ${analysis.summary}`)
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
  const failed = checks.filter((check) => check?.conclusion === 'FAILURE' || check?.conclusion === 'CANCELLED' || check?.state === 'FAILURE')
  if (failed.length > 0) throw stateConflict('required exact-head CI contains a failed check')
  const successfulNames = new Set(checks.filter((check) => check?.conclusion === 'SUCCESS' || check?.state === 'SUCCESS').map((check) => check.name ?? check.context))
  for (const required of REQUIRED_CI_NAMES) {
    if (!successfulNames.has(required)) throw stateConflict(`required exact-head CI check ${required} is missing or unsuccessful`)
  }
  return analysis
}

function sameIssueBody(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left === right
}

function finalTaskBody({ state, attestation }) {
  return renderCanonicalBootstrapTaskBody(state, attestation)
}

export function buildInitialTaskState({ issueNumber, requestId, attestation, managedStateSha256 = null, now = null } = {}) {
  const payload = attestation?.payload ?? {}
  return {
    schema_version: 1,
    state: 'AWAITING_REVIEW_1',
    review_cycle: 0,
    full_review_count: 0,
    approved_base: BOOTSTRAP_CONTRACT.base,
    active_task_issue: `#${issueNumber}`,
    active_pr: `#${BOOTSTRAP_CONTRACT.pullRequest}`,
    current_head: BOOTSTRAP_CONTRACT.head,
    last_reviewed_head: null,
    guide_version: BOOTSTRAP_CONTRACT.policyVersion,
    guide_source_ref: 'main',
    guide_source_sha: BOOTSTRAP_CONTRACT.policySha,
    open_blockers: [],
    follow_up_issues: [],
    next_permitted_action: 'Run read-only Review 1 preflight; do not start Review 1.',
    material_change_status: 'none',
    updated_at: now,
    updated_by: 'Mission Control Task Bootstrap',
    parent_issue: `#${BOOTSTRAP_CONTRACT.parentIssue}`,
    policy_source: BOOTSTRAP_CONTRACT.policySource,
    policy_version: BOOTSTRAP_CONTRACT.policyVersion,
    policy_sha: BOOTSTRAP_CONTRACT.policySha,
    bootstrap_request_id: requestId,
    task_attestation_schema: payload.attestation_schema ?? TASK_ATTESTATION_SCHEMA,
    task_attestation_key_id: attestation?.key_id ?? null,
    task_attestation_sha256: attestation ? canonicalHash(attestation) : null,
    managed_state_sha256: managedStateSha256,
  }
}

function buildTaskAttestation({ repository, parentIssue, taskIssue, pullRequest, authorization, requestId, workflow, policy, signingKeyId, privateKey, managedStateSha256 = null }) {
  const payload = {
    attestation_schema: TASK_ATTESTATION_SCHEMA,
    operation: TASK_ATTESTATION_OPERATION,
    operation_version: TASK_ATTESTATION_OPERATION_VERSION,
    managed_state_sha256: managedStateSha256,
    repository: repository.nameWithOwner,
    repository_id: repository.id,
    repository_node_id: repository.node_id,
    protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    founder_login: authorization.authorLogin,
    authorization_comment_id: authorization.commentId,
    authorization_body_sha256: authorization.bodySha256,
    parent_issue_number: Number(parentIssue.number),
    parent_issue_id: parentIssue.id,
    parent_issue_node_id: parentIssue.node_id,
    task_issue_number: Number(taskIssue.number),
    task_issue_id: taskIssue.id,
    task_issue_node_id: taskIssue.node_id,
    pr_number: Number(pullRequest.number),
    pr_id: pullRequest.id,
    pr_node_id: pullRequest.node_id,
    base: pullRequest.baseRefName,
    head: pullRequest.headRefOid,
    policy_path: policy.path,
    policy_version: policy.version,
    policy_source_commit: policy.sourceCommit,
    policy_blob_sha: policy.blobSha,
    request_id: requestId,
    workflow_file: workflow.file,
    workflow_ref: workflow.ref,
    workflow_sha: workflow.sha,
    workflow_run_id: String(workflow.runId),
    signing_key_id: signingKeyId,
  }
  return createSignedEnvelope({
    keyId: signingKeyId,
    payload,
    privateKey,
  })
}

function validateGenesisEvidence({ repository, parentIssue, pullRequest, mainCommit, policy, workflow }) {
  if (repository.nameWithOwner !== BOOTSTRAP_CONTRACT.repository) throw blockedExternal('this one-time genesis transport is not enabled for child repositories')
  if (parentIssue.number !== BOOTSTRAP_CONTRACT.parentIssue || parentIssue.state !== 'OPEN') throw stateConflict('parent Issue #262 is not open')
  const parentState = parseMissionControlState(parentIssue.body ?? '')
  if (parentState.present) throw stateConflict('parent Issue #262 contains a managed-state block')
  if (pullRequest.number !== BOOTSTRAP_CONTRACT.pullRequest || pullRequest.state !== 'OPEN' || pullRequest.isDraft !== true) throw stateConflict('PR #263 is not Draft/Open')
  if (pullRequest.baseRefName !== BOOTSTRAP_CONTRACT.base || pullRequest.baseRefOid !== BOOTSTRAP_CONTRACT.protectedBaseSha) throw stateConflict('PR #263 base is not the exact protected genesis base')
  if (pullRequest.headRefOid !== BOOTSTRAP_CONTRACT.head) throw stateConflict('PR #263 head is not the exact approved genesis head')
  if (mainCommit?.sha !== workflow.sha) throw stateConflict('workflow implementation SHA does not match the protected main ref readback')
  if (policy.path !== BOOTSTRAP_CONTRACT.policySource || policy.version !== BOOTSTRAP_CONTRACT.policyVersion || policy.blobSha !== BOOTSTRAP_CONTRACT.policySha || policy.sourceCommit !== BOOTSTRAP_CONTRACT.protectedBaseSha) {
    throw stateConflict('merged-main policy source/version/blob does not match the approved genesis policy')
  }
  if (workflow.file !== BOOTSTRAP_CONTRACT.workflowFile || workflow.ref !== 'refs/heads/main' || !positiveId(workflow.runId)) {
    throw stateConflict('workflow was not loaded from protected main')
  }
  exactHeadCi(pullRequest)
}

async function readRegistryRecords(github, parentIssueNumber, publicKey, repository, signingKeyId, expected = {}) {
  const comments = await github.getIssueComments(parentIssueNumber)
  const records = []
  for (const comment of comments) {
    if (!String(comment?.body ?? '').includes('bemoat-mission-control-task-registry:v1')) continue
    const parsed = parseTaskOwnershipRecord(comment.body)
    if (!parsed.ok) throw stateConflict(`parent ownership registry comment ${comment.id} is unreadable`)
    const verified = verifyTaskOwnershipRecord(parsed.envelope, {
      publicKey,
      repository,
      signingKeyId,
      ...expected,
    })
    if (!verified.ok) throw stateConflict(`parent ownership registry comment ${comment.id} failed verification: ${verified.reason}`)
    records.push({ comment, ...verified })
  }
  return { comments, records }
}

async function scanTaskIssues({ github, request, publicKey, repository, signingKeyId, pullRequest, parentIssue, expectedWorkflow, policy, authorization }) {
  let issues
  try {
    issues = await github.listIssues({ state: 'all' })
  } catch (error) {
    throw blockedExternal('GitHub Issue listing was unavailable while checking recovery and ownership', error)
  }
  const provisional = []
  const signed = []
  for (const issue of issues ?? []) {
    if (!issue?.number || issue.pull_request) continue
    const provisionalParsed = parseProvisionalTaskBody(issue.body ?? '')
    if (provisionalParsed.present) {
      if (!provisionalParsed.valid) throw stateConflict(`provisional Issue #${issue.number} has invalid recovery metadata`)
      if (provisionalParsed.provisional.request_id === request.requestId && !matchesProvisional(provisionalParsed.provisional, { request, context: { repository, policy } })) {
        throw stateConflict(`provisional Task Issue #${issue.number} has a mismatched deterministic binding`)
      }
      if (provisionalParsed.provisional.request_id === request.requestId) provisional.push({ issue, provisional: provisionalParsed.provisional })
      else if (provisionalParsed.provisional.pr === BOOTSTRAP_CONTRACT.pullRequest && provisionalParsed.provisional.head === BOOTSTRAP_CONTRACT.head) {
        throw stateConflict(`competing provisional Task Issue #${issue.number} owns PR #${BOOTSTRAP_CONTRACT.pullRequest}`)
      }
    }
    if (!String(issue.body ?? '').includes('bemoat-mission-control-task-attestation:v1')) continue
    const parsedAttestation = parseTaskAttestation(issue.body ?? '')
    if (!parsedAttestation.ok) throw stateConflict(`Task Issue #${issue.number} contains an unreadable signed attestation`)
    const verification = runCanonicalManagedTaskPreflight({
      issue,
      pullRequest,
      repository: repository.nameWithOwner,
      publicKey,
      signingKeyId,
      expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      expectedAuthorization: { ...authorization, parentIssue },
      expectedWorkflow,
      policy,
      repositoryIdentity: repository,
      requireBootstrapAttestation: true,
    })
    if (!verification.ok) throw stateConflict(`Task Issue #${issue.number} signed attestation failed readout: ${verification.reason}`)
    signed.push({ issue, attestation: parsedAttestation.envelope })
    if (parsedAttestation.envelope.payload.request_id !== request.requestId &&
        parsedAttestation.envelope.payload.pr_number === BOOTSTRAP_CONTRACT.pullRequest &&
        parsedAttestation.envelope.payload.head === BOOTSTRAP_CONTRACT.head) {
      throw stateConflict(`competing valid Task Issue #${issue.number} owns PR #${BOOTSTRAP_CONTRACT.pullRequest}`)
    }
  }
  if (provisional.length > 1) throw stateConflict('multiple provisional Issues claim the same deterministic request ID')
  return { provisional: provisional[0] ?? null, signed: signed[0] ?? null }
}

async function createProvisionalIssue({ github, request, context }) {
  const body = renderProvisionalTaskBody({
    requestId: request.requestId,
    repository: context.repository.nameWithOwner,
    parentIssue: BOOTSTRAP_CONTRACT.parentIssue,
    pullRequest: BOOTSTRAP_CONTRACT.pullRequest,
    base: BOOTSTRAP_CONTRACT.base,
    head: BOOTSTRAP_CONTRACT.head,
    protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    policyPath: context.policy.path,
    policyVersion: context.policy.version,
    policySha: context.policy.blobSha,
  })
  try {
    const created = await github.createIssue({
      title: `[Mission Control][Provisional] Managed Task bootstrap for PR #${BOOTSTRAP_CONTRACT.pullRequest}`,
      body,
    })
    if (!created || created.body !== body) throw blockedExternal('provisional Issue creation did not return the exact allocated body')
    return { issue: created, created: true, body }
  } catch (error) {
    if (!isAmbiguous(error)) throw error
    // The API may have committed the Issue before the response was lost. The
    // caller re-scans by request ID; no guessed number or rebinding is allowed.
    throw blockedExternal('Issue creation response was ambiguous; retry with the same request ID to recover the provisional allocation', error)
  }
}

async function projectWithCas({ github, issue, nextBody, requestId }) {
  const expectedBody = issue.body ?? ''
  if (typeof github.issueBodyLeaseStore === 'function') {
    try {
      return await compareAndSwapIssueBody({
        repo: BOOTSTRAP_CONTRACT.repository,
        issueNumber: issue.number,
        expectedBody,
        nextBody,
        transitionIdentity: requestId,
        holder: 'mission-control-task-bootstrap',
        deps: {
          leaseStore: await github.issueBodyLeaseStore({ issueNumber: issue.number }),
          readIssueBody: async () => (await github.getIssue(issue.number)).body,
          writeIssueBody: async ({ body }) => github.updateIssueBody(issue.number, body),
        },
      })
    } catch (error) {
      if (error.code === 'CAS_CONFLICT' || /STATE_CONFLICT|CAS_CONFLICT/.test(error.message ?? '')) throw stateConflict(error.message, error)
      throw projectionFailed('canonical Issue-body projection failed', error)
    }
  }
  if (typeof github.acquireIssueLease !== 'function') throw blockedExternal('Issue-only lease/CAS adapter is unavailable')
  let lease
  try {
    lease = await github.acquireIssueLease({ issueNumber: issue.number, requestId, expectedBodySha256: bodyHash(expectedBody), scope: 'task-bootstrap-projection' })
    const live = await github.getIssue(issue.number)
    if (!sameIssueBody(live.body, expectedBody)) throw stateConflict('Issue body changed before canonical projection')
    await github.updateIssueBody(issue.number, nextBody)
  } catch (error) {
    if (error.code === 'CAS_CONFLICT' || /STATE_CONFLICT|CAS_CONFLICT/.test(error.message ?? '')) throw stateConflict(error.message, error)
    if (error.code === 'BLOCKED_EXTERNAL') throw error
    throw projectionFailed('canonical Issue-body projection failed', error)
  } finally {
    if (lease && typeof github.releaseIssueLease === 'function') {
      try { await github.releaseIssueLease({ issueNumber: issue.number, requestId, lease }) } catch { /* readback remains authoritative */ }
    }
  }
}

async function verifyFinalTask({ github, issueNumber, context, authorization, requestId, attestation, registryRecord, expectedBody }) {
  let issue
  try { issue = await github.getIssue(issueNumber) } catch (error) { throw blockedExternal(`allocated Task Issue #${issueNumber} could not be read back`, error) }
  if (expectedBody != null && issue.body !== expectedBody) throw blockedExternal('Task Issue body readback differs from the body projected by the winning lease')
  let pullRequest
  try { pullRequest = await github.getPullRequest(BOOTSTRAP_CONTRACT.pullRequest) } catch (error) { throw blockedExternal('PR evidence was unavailable during final Task readback', error) }
  const preflight = runCanonicalManagedTaskPreflight({
    issue,
    pullRequest,
    repository: context.repository.nameWithOwner,
    publicKey: context.publicKey,
    signingKeyId: context.signingKeyId,
    expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    expectedAuthorization: { ...authorization, parentIssue: context.parentIssue },
    expectedWorkflow: context.workflow,
    policy: context.policy,
    repositoryIdentity: context.repository,
    requireBootstrapAttestation: true,
  })
  if (!preflight.ok) throw blockedExternal(`canonical managed-task preflight failed after projection: ${preflight.reason}`)
  const parsedAttestation = parseTaskAttestation(issue.body)
  if (!parsedAttestation.ok || parsedAttestation.envelope.payload.request_id !== requestId) throw blockedExternal('readback Task attestation does not match the deterministic request')
  if (canonicalHash(parsedAttestation.envelope) !== canonicalHash(attestation)) throw blockedExternal('readback Task attestation changed after projection')
  const registryVerification = verifyTaskOwnershipRecord(registryRecord, {
    publicKey: context.publicKey,
    repository: context.repository.nameWithOwner,
    signingKeyId: context.signingKeyId,
    expectedParentIssue: context.parentIssue,
    expectedTaskIssue: issue,
    expectedPullRequest: pullRequest,
    expectedBase: BOOTSTRAP_CONTRACT.base,
    expectedHead: BOOTSTRAP_CONTRACT.head,
    expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    expectedRequestId: requestId,
    expectedAttestationSha256: canonicalHash(parsedAttestation.envelope),
  })
  if (!registryVerification.ok || registryRecord.payload.attestation_sha256 !== canonicalHash(parsedAttestation.envelope) ||
      Number(registryRecord.payload.task_issue_number) !== Number(issue.number) || registryRecord.payload.task_issue_id !== issue.id ||
      registryRecord.payload.task_issue_node_id !== issue.node_id) {
    throw blockedExternal('parent ownership registry readback does not match the allocated Task')
  }
  return issue
}

/**
 * Canonical one-time Task bootstrap. All mutation is behind live evidence and
 * a repository-wide workflow concurrency gate; retries resume only the exact
 * deterministic request and never rebind an existing Task.
 */
export function createTaskBootstrapService({
  github,
  repository = BOOTSTRAP_CONTRACT.repository,
  publicKey,
  signingPrivateKey,
  signingKeyId,
  workflow,
} = {}) {
  async function bootstrap(options = {}) {
    const { founderAuthorizationCommentId, check = false } = options
    if (!positiveId(founderAuthorizationCommentId)) throw stateConflict('founder_authorization_comment_id must be a positive immutable comment ID')
    if (repository !== BOOTSTRAP_CONTRACT.repository || !publicKey || !signingPrivateKey || !signingKeyId) throw blockedExternal('protected genesis repository, public key, signing key ID, or private signing material is unavailable')
    if (!github || typeof github.getRepository !== 'function') throw blockedExternal('GitHub adapter is unavailable')

    let context
    try {
      const liveRepository = await github.getRepository()
      const parentIssue = await github.getIssue(BOOTSTRAP_CONTRACT.parentIssue)
      const parentComments = await github.getIssueComments(BOOTSTRAP_CONTRACT.parentIssue)
      const authorizationComment = await github.getIssueComment(Number(founderAuthorizationCommentId))
      const authorization = parseFounderTaskBootstrapAuthorization(authorizationComment.body)
      const founderLogins = await github.getFounderLogins()
      const validatedAuthorization = validateFounderTaskBootstrapAuthorization({
        authorization,
        authorizationComment,
        parentIssue,
        repository: liveRepository.nameWithOwner,
        founderLogins,
        parentComments,
      })
      const pullRequest = await github.getPullRequest(BOOTSTRAP_CONTRACT.pullRequest)
      const mainCommit = await github.getBranchCommit('main')
      const policy = await github.getPolicy({ ref: 'main', path: BOOTSTRAP_CONTRACT.policySource })
      validateGenesisEvidence({ repository: liveRepository, parentIssue, pullRequest, mainCommit, policy, workflow })
      context = {
        repository: liveRepository,
        parentIssue,
        pullRequest,
        policy,
        workflow,
        publicKey,
        signingKeyId,
        authorization: validatedAuthorization,
      }
    } catch (error) {
      if (error.code === 'STATE_CONFLICT' || error.code === 'BLOCKED_EXTERNAL') throw error
      throw blockedExternal('preflight evidence was unavailable or ambiguous', error)
    }

    const request = buildTaskBootstrapRequestIdentity({
      repository: context.repository.nameWithOwner,
      authorizationCommentId: context.authorization.commentId,
      authorizationBodySha256: context.authorization.bodySha256,
      parentIssue: BOOTSTRAP_CONTRACT.parentIssue,
      pullRequest: BOOTSTRAP_CONTRACT.pullRequest,
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policyPath: context.policy.path,
      policyVersion: context.policy.version,
      policySha: context.policy.blobSha,
    })

    if (check) {
      return { ok: true, outcome: 'PREFLIGHT_SUCCESS', requestId: request.requestId, issue: { number: null, url: null } }
    }

    let creationLease
    try {
      if (typeof github.acquireCreationLease === 'function') {
        creationLease = await github.acquireCreationLease({ repository: context.repository.nameWithOwner, requestId: request.requestId })
      } else if (typeof github.acquireIssueLease === 'function') {
        creationLease = await github.acquireIssueLease({ issueNumber: BOOTSTRAP_CONTRACT.parentIssue, requestId: `creation:${request.requestId}`, scope: 'repository-task-creation' })
      } else {
        throw blockedExternal('repository-wide serialized creation lease is unavailable')
      }

      const registryEvidence = {
        expectedParentIssue: context.parentIssue,
        expectedPullRequest: context.pullRequest,
        expectedBase: BOOTSTRAP_CONTRACT.base,
        expectedHead: BOOTSTRAP_CONTRACT.head,
        expectedProtectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      }
      const registry = await readRegistryRecords(github, BOOTSTRAP_CONTRACT.parentIssue, publicKey, context.repository.nameWithOwner, signingKeyId, registryEvidence)
      const scanned = await scanTaskIssues({
        github,
        request,
        publicKey,
        repository: context.repository,
        signingKeyId,
        pullRequest: context.pullRequest,
        parentIssue: context.parentIssue,
        expectedWorkflow: context.workflow,
        policy: context.policy,
        authorization: context.authorization,
      })

      const allocation = classifyTaskBootstrapAllocation({ request, context, registryRecords: registry.records, scanned })
      const existingRegistry = allocation.registry
      let taskIssue = allocation.issue
      const outcome = allocation.outcome
      if (allocation.kind === 'REGISTRY') {
        try {
          taskIssue = await github.getIssue(existingRegistry.record.payload.task_issue_number)
        } catch (error) {
          throw blockedExternal('existing request registry Task Issue could not be recovered', error)
        }
        const identity = issueIdentity(taskIssue)
        if (identity.id !== existingRegistry.record.payload.task_issue_id || identity.node_id !== existingRegistry.record.payload.task_issue_node_id) throw stateConflict('existing request registry points to a different Task identity')
      } else if (allocation.kind === 'CREATE_PROVISIONAL') {
        const created = await createProvisionalIssue({ github, request, context })
        taskIssue = created.issue
      }
      if (existingRegistry) {
        let existingIssue = taskIssue
        const provisional = parseProvisionalTaskBody(existingIssue.body ?? '')
        const hasAttestation = String(existingIssue.body ?? '').includes('bemoat-mission-control-task-attestation:v1')
        if (!hasAttestation && (!provisional.valid || !matchesProvisional(provisional.provisional, { request, context }))) {
          throw stateConflict('existing parent registry points to an Issue that cannot be recovered without rebinding it')
        }
      }
      const taskIdentity = issueIdentity(taskIssue)

      let attestation = null
      let projectedState = null
      let registryRecord = existingRegistry?.record ?? null
      const existingAttestation = parseTaskAttestation(taskIssue.body ?? '')
      if (existingAttestation.ok) {
        attestation = existingAttestation.envelope
      } else {
        const unsignedAttestation = buildTaskAttestation({
          repository: context.repository,
          parentIssue: context.parentIssue,
          taskIssue: taskIdentity,
          pullRequest: context.pullRequest,
          authorization: context.authorization,
          requestId: request.requestId,
          workflow: context.workflow,
          policy: context.policy,
          signingKeyId,
          ['privateKey']: signingPrivateKey,
        })
        const detachedState = buildInitialTaskState({
          issueNumber: taskIdentity.number,
          requestId: request.requestId,
          attestation: unsignedAttestation,
          now: null,
        })
        const managedStateSha256 = canonicalManagedStateBinding(detachedState)
        attestation = buildTaskAttestation({
          repository: context.repository,
          parentIssue: context.parentIssue,
          taskIssue: taskIdentity,
          pullRequest: context.pullRequest,
          authorization: context.authorization,
          requestId: request.requestId,
          workflow: context.workflow,
          policy: context.policy,
          signingKeyId,
          ['privateKey']: signingPrivateKey,
          managedStateSha256,
        })
        projectedState = buildInitialTaskState({
          issueNumber: taskIdentity.number,
          requestId: request.requestId,
          attestation,
          managedStateSha256,
          now: null,
        })
      }
      if (attestation.payload.request_id !== request.requestId || attestation.payload.task_issue_number !== taskIdentity.number || attestation.payload.task_issue_id !== taskIdentity.id || attestation.payload.task_issue_node_id !== taskIdentity.node_id) {
        throw stateConflict('existing Task attestation cannot be rebound to this request or Issue identity')
      }

      if (!registryRecord) {
        const registryPayload = buildTaskOwnershipPayload({
          repository: context.repository.nameWithOwner,
          requestId: request.requestId,
          parentIssue: context.parentIssue,
          taskIssue: taskIdentity,
          pullRequest: prIdentity(context.pullRequest),
          base: BOOTSTRAP_CONTRACT.base,
          head: BOOTSTRAP_CONTRACT.head,
          protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
          attestation,
          signingKeyId,
        })
        const candidate = createTaskOwnershipRecord({ payload: registryPayload, ['privateKey']: signingPrivateKey, signingKeyId })
        const refreshedRegistry = await readRegistryRecords(github, BOOTSTRAP_CONTRACT.parentIssue, publicKey, context.repository.nameWithOwner, signingKeyId, registryEvidence)
        const duplicate = recordForRequest(refreshedRegistry.records, request.requestId)
        if (duplicate) {
          if (duplicate.record.payload.task_issue_number !== taskIdentity.number || duplicate.record.payload.task_issue_id !== taskIdentity.id) throw stateConflict('recovery found a conflicting parent registry owner')
          registryRecord = duplicate.record
        } else {
          try {
            await github.postIssueComment(BOOTSTRAP_CONTRACT.parentIssue, renderTaskOwnershipRecord(candidate))
          } catch (error) {
            throw blockedExternal('parent ownership registry write was ambiguous or unavailable', error)
          }
          registryRecord = candidate
        }
      }

      const parsedTask = parseMissionControlState(taskIssue.body ?? '')
      const isFinal = parsedTask.valid && String(taskIssue.body ?? '').includes('bemoat-mission-control-task-attestation:v1')
      let expectedFinalBody = taskIssue.body ?? ''
      if (!isFinal) {
        const state = projectedState ?? buildInitialTaskState({
          issueNumber: taskIdentity.number,
          requestId: request.requestId,
          attestation,
          managedStateSha256: attestation.payload.managed_state_sha256,
          now: null,
        })
        const nextBody = finalTaskBody({ state, attestation })
        expectedFinalBody = nextBody
        await projectWithCas({ github, issue: taskIssue, nextBody, requestId: request.requestId })
      }

      const verifiedIssue = await verifyFinalTask({
        github,
        issueNumber: taskIdentity.number,
        context,
        authorization: context.authorization,
        requestId: request.requestId,
        attestation,
        registryRecord,
        expectedBody: expectedFinalBody,
      })
      return { ok: true, outcome, requestId: request.requestId, issue: verifiedIssue, registry: registryRecord, attestation }
    } catch (error) {
      if (error.code === 'PROJECTION_FAILED' || error.code === 'STATE_CONFLICT' || error.code === 'BLOCKED_EXTERNAL') throw error
      if (isAmbiguous(error)) throw blockedExternal('bootstrap evidence or mutation outcome is ambiguous; retry with the same authorization comment', error)
      throw error
    } finally {
      if (creationLease && typeof github.releaseCreationLease === 'function') {
        try { await github.releaseCreationLease({ repository: context.repository.nameWithOwner, requestId: request.requestId, lease: creationLease }) } catch { /* next run revalidates durable evidence */ }
      } else if (creationLease && typeof github.releaseIssueLease === 'function') {
        try { await github.releaseIssueLease({ issueNumber: BOOTSTRAP_CONTRACT.parentIssue, requestId: `creation:${request.requestId}`, lease: creationLease }) } catch { /* next run revalidates durable evidence */ }
      }
    }
  }
  return { bootstrap }
}

export { bootstrapError, exactHeadCi, finalTaskBody }
