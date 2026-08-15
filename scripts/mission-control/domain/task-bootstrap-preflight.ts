import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseMissionControlState, renderMissionControlState } from './task-state.mjs'
import { analyzeExactHeadCi } from '../../agent-issue/exact-head-ci.mjs'
import { canonicalHash, parseTaskAttestation, renderSignedEnvelope, verifyTaskAttestation } from './task-attestation.mjs'
import { parseProvisionalTaskBody } from './task-bootstrap-request.ts'

type RuntimeObject = Record<string, unknown>
type IdentityEvidence = RuntimeObject & {
  number?: string | number | null
  id?: string | number | null
  node_id?: string | number | null
}
type RepositoryEvidence = IdentityEvidence & { nameWithOwner?: string | null }
type IssueEvidence = IdentityEvidence & { body?: unknown }
type PullRequestEvidence = RuntimeObject & {
  number?: string | number | null
  id?: string | number | null
  node_id?: string | number | null
  headRefOid?: string | null
  baseRefName?: string | null
  statusCheckRollup?: unknown
}
type ParsedState = {
  present: boolean
  valid: boolean
  reason?: string
  state: RuntimeObject | null
}
type AttestationEnvelope = RuntimeObject & { payload?: RuntimeObject }
type ParsedAttestation =
  | { ok: true; envelope: AttestationEnvelope }
  | { ok: false; reason: string; envelope: null }
type PreflightResult = {
  ok: boolean
  reason: string | null
  classification: string | null
  evidence: unknown
}
type PreflightOptions = {
  issue?: IssueEvidence | null
  pullRequest?: PullRequestEvidence | null
  repository?: string | RepositoryEvidence | null
  repositoryIdentity?: RepositoryEvidence | null
  publicKey?: string | null
  signingKeyId?: string | null
  expectedProtectedBaseSha?: string | null
  expectedAuthorization?: (RuntimeObject & {
    commentId?: string | number | null
    bodySha256?: string | null
    authorLogin?: string | null
    parentIssue?: IdentityEvidence | null
  }) | null
  expectedWorkflow?: (RuntimeObject & {
    file?: string | null
    ref?: string | null
    sha?: string | null
    runId?: string | number | null
  }) | null
  policy?: (RuntimeObject & {
    path?: string | null
    version?: string | number | null
    sourceCommit?: string | null
    blobSha?: string | null
  }) | null
  requireBootstrapAttestation?: boolean
}

function result(ok: boolean, reason: string | null = null, classification: string | null = null, evidence: unknown = null): PreflightResult {
  return { ok, reason, classification, evidence }
}

export function canonicalManagedStateBinding(state: unknown): string {
  const detached = { ...(state as RuntimeObject), managed_state_sha256: null as null, task_attestation_sha256: null as null }
  return canonicalHash(detached)
}

export function renderCanonicalBootstrapTaskBody(state: unknown, attestation: unknown): string {
  return [
    '# Managed Task — canonical bootstrap',
    '',
    'This Issue was allocated by the protected Mission Control Task bootstrap transport.',
    'The provisional allocation is not authoritative; the signed attestation and managed state below are the canonical binding.',
    '',
    renderSignedEnvelope(attestation),
    '',
    renderMissionControlState(state as RuntimeObject),
    '',
    'Parent registry: Issue #262. Do not edit the signed attestation or managed state directly.',
  ].join('\n')
}

/**
 * Entry-point adapter for agent, dispatch, review, reconcile, and merge
 * readers. Legacy Tasks return a successful legacy result; bootstrap Tasks
 * are always checked against the committed public key and their live Issue/PR.
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
}: PreflightOptions = {}): PreflightResult {
  const body = String(issue?.body ?? '')
  const provisional = parseProvisionalTaskBody(body)
  if (provisional.present) return result(false, 'provisional allocation is not a managed Task', 'STATE_CONFLICT')
  const state = parseMissionControlState(body) as ParsedState
  const bootstrap = body.includes('bemoat-mission-control-task-attestation:v1') ||
    (state.valid && (Object.hasOwn(state.state ?? {}, 'bootstrap_request_id') || Object.hasOwn(state.state ?? {}, 'task_attestation_schema')))
  if (!bootstrap) return result(true, null, null, { legacy: true })
  const parsed = parseTaskAttestation(body) as ParsedAttestation
  if (parsed.ok === false) return result(false, parsed.reason, 'STATE_CONFLICT')
  const payload = parsed.envelope.payload ?? {}
  let verificationKey = publicKey
  if (!verificationKey) {
    try {
      verificationKey = readFileSync(resolve(process.cwd(), '.bemoat/mission-control/task-bootstrap-public-key.pem'), 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return result(false, `committed public verification key is unavailable: ${message}`, 'BLOCKED_EXTERNAL')
    }
  }
  const livePullRequest = pullRequest ?? {
    number: (payload as RuntimeObject).pr_number as string | number | null | undefined,
    id: null,
    node_id: null,
    headRefOid: (payload as RuntimeObject).head as string | null | undefined,
    baseRefName: (payload as RuntimeObject).base as string | null | undefined,
    statusCheckRollup: [] as unknown[],
  } satisfies PullRequestEvidence
  const livePolicy = policy ?? {
    path: state.state?.policy_source as string | null | undefined ?? (payload as RuntimeObject).policy_path as string | null | undefined,
    version: state.state?.policy_version as string | number | null | undefined ?? (payload as RuntimeObject).policy_version as string | number | null | undefined,
    sourceCommit: (payload as RuntimeObject).policy_source_commit as string | null | undefined,
    blobSha: state.state?.policy_sha as string | null | undefined ?? (payload as RuntimeObject).policy_blob_sha as string | null | undefined,
  } satisfies NonNullable<PreflightOptions['policy']>
  const liveWorkflow = expectedWorkflow ?? {
    file: (payload as RuntimeObject).workflow_file as string | null | undefined,
    ref: (payload as RuntimeObject).workflow_ref as string | null | undefined,
    sha: (payload as RuntimeObject).workflow_sha as string | null | undefined,
    runId: (payload as RuntimeObject).workflow_run_id as string | number | null | undefined,
  } satisfies NonNullable<PreflightOptions['expectedWorkflow']>
  const liveAuthorization = expectedAuthorization ?? {
    commentId: (payload as RuntimeObject).authorization_comment_id as string | number | null | undefined,
    bodySha256: (payload as RuntimeObject).authorization_body_sha256 as string | null | undefined,
    authorLogin: (payload as RuntimeObject).founder_login as string | null | undefined,
    parentIssue: { number: (payload as RuntimeObject).parent_issue_number as string | number | null | undefined },
  } satisfies NonNullable<PreflightOptions['expectedAuthorization']>
  return runCanonicalManagedTaskPreflight({
    issue,
    pullRequest: livePullRequest,
    repository,
    publicKey: verificationKey,
    signingKeyId: signingKeyId ?? state.state?.task_attestation_key_id as string | null | undefined ?? parsed.envelope.key_id as string | undefined,
    expectedProtectedBaseSha: expectedProtectedBaseSha ?? (payload as RuntimeObject).protected_base_sha as string | null | undefined,
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
}: PreflightOptions = {}): PreflightResult {
  if (!issue || !pullRequest) return result(false, 'Issue and PR evidence are required', 'BLOCKED_EXTERNAL')
  const parsedState = parseMissionControlState((issue.body ?? '') as string) as ParsedState
  if (!parsedState.present || !parsedState.valid) return result(false, parsedState.reason ?? 'managed state is missing or unreadable', 'STATE_CONFLICT')
  const state = parsedState.state as RuntimeObject
  const attestationPresent = String(issue.body ?? '').includes('bemoat-mission-control-task-attestation:v1') ||
    Object.hasOwn(state, 'bootstrap_request_id') || Object.hasOwn(state, 'task_attestation_schema')
  if (!requireBootstrapAttestation && !attestationPresent) {
    return result(true, null, null, { state, legacy: true })
  }
  const parsedAttestation = parseTaskAttestation((issue.body ?? '') as string) as ParsedAttestation
  if (parsedAttestation.ok === false) return result(false, parsedAttestation.reason, 'STATE_CONFLICT')
  const payload = parsedAttestation.envelope.payload as RuntimeObject
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
    requestId: (state.bootstrap_request_id ?? payload.request_id) as string | undefined,
    expectedWorkflow,
  } as Parameters<typeof verifyTaskAttestation>[1])
  if (!verification.ok) return result(false, verification.reason, 'STATE_CONFLICT')
  const expectedManagedStateSha256 = canonicalManagedStateBinding(state)
  if (state.managed_state_sha256 !== expectedManagedStateSha256 ||
      state.task_attestation_sha256 !== canonicalHash(parsedAttestation.envelope) ||
      payload.managed_state_sha256 !== expectedManagedStateSha256) {
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
