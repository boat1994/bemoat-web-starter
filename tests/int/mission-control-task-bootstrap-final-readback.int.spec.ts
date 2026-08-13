/* eslint-disable @typescript-eslint/no-explicit-any */
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import { createSignedEnvelope } from '../../scripts/mission-control/domain/task-attestation.mjs'
import {
  canonicalManagedStateBinding,
  renderCanonicalBootstrapTaskBody,
} from '../../scripts/mission-control/domain/task-bootstrap-preflight.mjs'
import { buildInitialTaskState } from '../../scripts/mission-control/domain/task-bootstrap-state.mjs'
import {
  buildTaskOwnershipPayload,
  createTaskOwnershipRecord,
} from '../../scripts/mission-control/domain/task-ownership-registry.mjs'
import { verifyFinalTask } from '../../scripts/mission-control/domain/task-bootstrap-final-readback.mjs'

const REPO = BOOTSTRAP_CONTRACT.repository
const KEY_ID = 'c5-test-key-1'
const REQUEST_ID = `mc-task-bootstrap-v1-${'a'.repeat(64)}`

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function fixture() {
  const keys = keyMaterial()
  const parentIssue = { number: BOOTSTRAP_CONTRACT.parentIssue, id: 'I_parent', node_id: 'N_parent' }
  const taskIssue = {
    number: 300,
    id: 'I_task_300',
    node_id: 'N_task_300',
    url: `https://github.com/${REPO}/issues/300`,
    state: 'OPEN',
    body: '',
  }
  const pullRequest = {
    number: BOOTSTRAP_CONTRACT.pullRequest,
    id: 'PR_263',
    node_id: 'PR_node_263',
    state: 'OPEN',
    isDraft: true,
    baseRefName: BOOTSTRAP_CONTRACT.base,
    baseRefOid: BOOTSTRAP_CONTRACT.protectedBaseSha,
    headRefOid: BOOTSTRAP_CONTRACT.head,
    statusCheckRollup: [
      { name: 'ci', conclusion: 'SUCCESS' },
      { name: 'starter-ci', conclusion: 'SUCCESS' },
    ],
  }
  const repository = { nameWithOwner: REPO, id: 'R_repo', node_id: 'R_node' }
  const policy = {
    path: BOOTSTRAP_CONTRACT.policySource,
    version: BOOTSTRAP_CONTRACT.policyVersion,
    sourceCommit: BOOTSTRAP_CONTRACT.protectedBaseSha,
    blobSha: BOOTSTRAP_CONTRACT.policySha,
  }
  const workflow = {
    file: BOOTSTRAP_CONTRACT.workflowFile,
    ref: 'refs/heads/main',
    sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
    runId: '1',
  }
  const authorization = {
    commentId: '9001',
    bodySha256: 'b'.repeat(64),
    authorLogin: 'boat1994',
  }
  const context = {
    repository,
    parentIssue,
    publicKey: keys.publicKey,
    signingKeyId: KEY_ID,
    workflow,
    policy,
  }
  const makeAttestation = (managedStateSha256: string | null) => createSignedEnvelope({
    keyId: KEY_ID,
    privateKey: keys.privateKey,
    payload: {
      attestation_schema: BOOTSTRAP_CONTRACT.attestationSchema,
      operation: 'task-bootstrap',
      operation_version: BOOTSTRAP_CONTRACT.operationVersion,
      managed_state_sha256: managedStateSha256,
      repository: REPO,
      repository_id: repository.id,
      repository_node_id: repository.node_id,
      protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      founder_login: authorization.authorLogin,
      authorization_comment_id: authorization.commentId,
      authorization_body_sha256: authorization.bodySha256,
      parent_issue_number: parentIssue.number,
      parent_issue_id: parentIssue.id,
      parent_issue_node_id: parentIssue.node_id,
      task_issue_number: taskIssue.number,
      task_issue_id: taskIssue.id,
      task_issue_node_id: taskIssue.node_id,
      pr_number: pullRequest.number,
      pr_id: pullRequest.id,
      pr_node_id: pullRequest.node_id,
      base: pullRequest.baseRefName,
      head: pullRequest.headRefOid,
      policy_path: policy.path,
      policy_version: policy.version,
      policy_source_commit: policy.sourceCommit,
      policy_blob_sha: policy.blobSha,
      request_id: REQUEST_ID,
      workflow_file: workflow.file,
      workflow_ref: workflow.ref,
      workflow_sha: workflow.sha,
      workflow_run_id: workflow.runId,
      signing_key_id: KEY_ID,
    },
  })
  const unsignedAttestation = makeAttestation(null)
  const detachedState = buildInitialTaskState({
    issueNumber: taskIssue.number,
    requestId: REQUEST_ID,
    attestation: unsignedAttestation,
  })
  const managedStateSha256 = canonicalManagedStateBinding(detachedState)
  const attestation = makeAttestation(managedStateSha256)
  const state = buildInitialTaskState({
    issueNumber: taskIssue.number,
    requestId: REQUEST_ID,
    attestation,
    managedStateSha256,
  })
  taskIssue.body = renderCanonicalBootstrapTaskBody(state, attestation)
  const registryRecord = createTaskOwnershipRecord({
    payload: buildTaskOwnershipPayload({
      repository: REPO,
      requestId: REQUEST_ID,
      parentIssue,
      taskIssue,
      pullRequest,
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      attestation,
      signingKeyId: KEY_ID,
    }),
    privateKey: keys.privateKey,
    signingKeyId: KEY_ID,
  })
  return {
    keys,
    context,
    authorization,
    requestId: REQUEST_ID,
    detachedState,
    state,
    managedStateSha256,
    attestation,
    registryRecord,
    issue: taskIssue,
    pullRequest,
  }
}

function readbackArgs(overrides: any = {}) {
  const { base: providedBase, ...actualOverrides } = overrides
  const base = providedBase ?? fixture()
  const issue = actualOverrides.issue ?? base.issue
  const pullRequest = actualOverrides.pullRequest ?? base.pullRequest
  return {
    github: {
      getIssue: async () => structuredClone(issue),
      getPullRequest: async () => structuredClone(pullRequest),
    },
    issueNumber: base.issue.number,
    context: base.context,
    authorization: base.authorization,
    requestId: base.requestId,
    attestation: base.attestation,
    registryRecord: base.registryRecord,
    expectedBody: base.issue.body,
    ...actualOverrides,
  }
}

describe('task bootstrap final readback boundary', () => {
  it('binds detached and projected initial states to the same managed-state hash', () => {
    const base = fixture()

    expect(canonicalManagedStateBinding(base.detachedState)).toBe(base.managedStateSha256)
    expect(base.state.managed_state_sha256).toBe(base.managedStateSha256)
    expect(canonicalManagedStateBinding(base.state)).toBe(base.managedStateSha256)
  })

  it('keeps terminal Task admission in the dedicated domain module', () => {
    const workflow = readFileSync('scripts/mission-control/workflows/task-bootstrap.mjs', 'utf8')

    expect(workflow).toContain(
      "import { verifyFinalTask } from '../domain/task-bootstrap-final-readback.mjs'",
    )
    expect(workflow).not.toMatch(/async function verifyFinalTask\(/)
    expect(workflow).toContain('const verifiedIssue = await verifyFinalTask({')
  })

  it('admits the exact final Issue only after canonical preflight and registry binding', async () => {
    const args = readbackArgs()

    await expect(verifyFinalTask(args)).resolves.toMatchObject({
      number: 300,
      id: 'I_task_300',
      node_id: 'N_task_300',
      body: args.expectedBody,
    })
  })

  it('fails closed when the projected body differs from final Issue readback', async () => {
    const args = readbackArgs({ expectedBody: 'different body' })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it.each([
    ['Task Issue', { getIssue: async () => { throw Object.assign(new Error('response lost'), { code: 'API_AMBIGUITY' }) } }],
    ['PR', { getPullRequest: async () => { throw Object.assign(new Error('response lost'), { code: 'API_AMBIGUITY' }) } }],
  ])('fails closed when %s readback is unavailable or ambiguous', async (_label, transport) => {
    const base = fixture()
    const args = readbackArgs({ base, github: { getIssue: async () => structuredClone(base.issue), getPullRequest: async () => structuredClone(base.pullRequest), ...transport } })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('fails closed when canonical managed-task preflight fails', async () => {
    const base = fixture()
    const args = readbackArgs({
      base,
      pullRequest: { ...base.pullRequest, statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }] },
    })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it.each([
    ['request identity', { requestId: `mc-task-bootstrap-v1-${'c'.repeat(64)}` }],
    ['attestation hash', { attestation: { ...fixture().attestation, payload: { ...fixture().attestation.payload, request_id: `mc-task-bootstrap-v1-${'d'.repeat(64)}` } } }],
  ])('fails closed when readback %s changes', async (_label, change) => {
    const base = fixture()
    const args = readbackArgs({ base, ...change })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('fails closed when the final Task Issue identity changes', async () => {
    const base = fixture()
    const args = readbackArgs({ base, issue: { ...base.issue, number: 301 } })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('fails closed when the registry binding changes', async () => {
    const base = fixture()
    const args = readbackArgs({
      base,
      registryRecord: { ...base.registryRecord, payload: { ...base.registryRecord.payload, task_issue_id: 'I_other' } },
    })

    await expect(verifyFinalTask(args)).rejects.toMatchObject({ code: 'BLOCKED_EXTERNAL' })
  })

  it('keeps the extracted module under the structural soft ceiling', () => {
    const lines = readFileSync('scripts/mission-control/domain/task-bootstrap-final-readback.mjs', 'utf8').split(/\r?\n/)
    expect(lines.at(-1) === '' ? lines.length - 1 : lines.length).toBeLessThanOrEqual(400)
  })
})
