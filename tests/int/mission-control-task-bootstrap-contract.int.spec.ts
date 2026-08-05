import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalSerialize, createSignedEnvelope, verifySignedEnvelope } from '../../scripts/mission-control/domain/task-attestation.mjs'
import {
  buildTaskBootstrapRequestIdentity,
  parseProvisionalTaskBody,
  renderProvisionalTaskBody,
} from '../../scripts/mission-control/domain/task-bootstrap-request.mjs'
import { createTaskBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'
import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import { createTaskOwnershipRecord, verifyTaskOwnershipRecord } from '../../scripts/mission-control/domain/task-ownership-registry.mjs'
import { preflightCanonicalBootstrapTask, runCanonicalManagedTaskPreflight } from '../../scripts/mission-control/domain/task-bootstrap-preflight.mjs'

const workflowPath = '.github/workflows/mission-control-task-bootstrap.yml'

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

type BootstrapGithubAdapterForContract = {
  getRepository: () => Promise<Record<string, unknown>>
  getIssue: (number: number) => Promise<Record<string, unknown>>
  getPullRequest: (number: number) => Promise<Record<string, unknown>>
  getPolicy: (input: { ref: string; path: string }) => Promise<Record<string, unknown>>
  createIssue: (input: { title: string; body: string }) => Promise<Record<string, unknown>>
  updateIssueBody: (number: number, body: string) => Promise<Record<string, unknown>>
  postIssueComment: (number: number, body: string) => Promise<Record<string, unknown>>
}

const createTaskBootstrapGithubAdapterForContract =
  createTaskBootstrapGithubAdapter as unknown as (input: {
    repository: string
    runGh: (args: string[], options?: { input?: string }) => string
  }) => BootstrapGithubAdapterForContract

describe('Mission Control bootstrap transport contract', () => {
  it('keeps the workflow dispatch entrypoint and package command stable', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    const cli = readFileSync('scripts/mission-control-task-create.mjs', 'utf8')
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(packageJson.scripts['bemoat:mission-control:task-bootstrap']).toBe(
      'node scripts/mission-control-task-create.mjs',
    )
    expect(cli).toContain('--founder-authorization-comment-id')
    expect(cli).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_KEY_ID')
    expect(cli).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('FOUNDER_AUTHORIZATION_COMMENT_ID')
  })

  it('keeps the GitHub adapter read/write surface on the intended Issue transport', async () => {
    const calls: Array<{ args: string[]; input?: string }> = []
    const runGh = (args: string[], options: { input?: string } = {}) => {
      calls.push({ args: [...args], input: options.input })
      const path = args.find((argument) => argument.startsWith('repos/')) ?? ''

      if (args[0] === 'pr') {
        return JSON.stringify({
          number: 263,
          url: `https://github.com/${BOOTSTRAP_CONTRACT.repository}/pull/263`,
          state: 'OPEN',
          isDraft: true,
          baseRefName: 'main',
          baseRefOid: BOOTSTRAP_CONTRACT.protectedBaseSha,
          headRefName: 'genesis',
          headRefOid: BOOTSTRAP_CONTRACT.head,
          statusCheckRollup: [],
        })
      }
      if (path === `repos/${BOOTSTRAP_CONTRACT.repository}`) {
        return JSON.stringify({ full_name: BOOTSTRAP_CONTRACT.repository, id: 1, node_id: 'R_node', default_branch: 'main' })
      }
      if (path.endsWith('/issues/262')) {
        return JSON.stringify({ number: 262, id: 10, node_id: 'I_parent', state: 'open', body: 'parent' })
      }
      if (path.endsWith('/pulls/263')) {
        return JSON.stringify({ number: 263, id: 20, node_id: 'PR_node' })
      }
      if (path.includes('/contents/')) {
        return JSON.stringify({
          content: Buffer.from('version: 1.3.0\n', 'utf8').toString('base64'),
          sha: BOOTSTRAP_CONTRACT.policySha,
        })
      }
      if (path.endsWith('/issues/262/comments')) {
        return JSON.stringify({ id: 30, body: JSON.parse(options.input ?? '{}').body, issue_url: `https://api.github.com/repos/${BOOTSTRAP_CONTRACT.repository}/issues/262` })
      }
      if (path.endsWith('/issues/300')) {
        return JSON.stringify({ number: 300, id: 31, node_id: 'I_task', state: 'open', body: JSON.parse(options.input ?? '{}').body })
      }
      if (path.endsWith('/issues')) {
        return JSON.stringify({ number: 300, id: 31, node_id: 'I_task', state: 'open', body: JSON.parse(options.input ?? '{}').body })
      }
      throw new Error(`unexpected GitHub fixture call: ${args.join(' ')}`)
    }
    const adapter = createTaskBootstrapGithubAdapterForContract({
      repository: BOOTSTRAP_CONTRACT.repository,
      runGh,
    })

    await expect(adapter.getRepository()).resolves.toMatchObject({
      nameWithOwner: BOOTSTRAP_CONTRACT.repository,
      node_id: 'R_node',
    })
    await expect(adapter.getIssue(262)).resolves.toMatchObject({
      number: 262,
      id: 'I_parent',
      node_id: 'I_parent',
      state: 'OPEN',
    })
    await expect(adapter.getPullRequest(263)).resolves.toMatchObject({
      number: 263,
      id: 'PR_node',
      node_id: 'PR_node',
      headRefOid: BOOTSTRAP_CONTRACT.head,
    })
    await expect(adapter.getPolicy({
      ref: 'main',
      path: BOOTSTRAP_CONTRACT.policySource,
    })).resolves.toMatchObject({
      version: '1.3.0',
      blobSha: BOOTSTRAP_CONTRACT.policySha,
      sourceCommit: BOOTSTRAP_CONTRACT.protectedBaseSha,
    })
    await adapter.createIssue({ title: 'provisional', body: 'body' })
    await adapter.updateIssueBody(300, 'next')
    await adapter.postIssueComment(262, 'comment')

    const writes = calls.filter(({ args }) => args.includes('--method'))
    expect(writes.map(({ args }) => args[args.indexOf('--method') + 1])).toEqual(
      expect.arrayContaining(['POST', 'PATCH', 'POST']),
    )
    expect(writes.some(({ args }) => args.some((argument) => argument.includes('/contents/')))).toBe(false)
  })

  it('exposes only the approved workflow input and Issues write boundary', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    expect(workflow).toContain('founder_authorization_comment_id:')
    expect(workflow).toContain('environment:\n      name: mission-control-task-creation')
    expect(workflow).toContain('group: mission-control-task-creation-${{ github.repository }}')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('issues: write')
    expect(workflow).toContain('contents: read')
    expect(workflow).not.toContain('contents: write')
    expect(workflow).not.toContain('pr_number:')
    expect(workflow).not.toContain('head_sha:')
    expect(workflow).not.toContain('issue_body:')
  })

  it('keeps private signing material out of the repository and workflow output', () => {
    const publicKey = readFileSync('.bemoat/mission-control/task-bootstrap-public-key.pem', 'utf8')
    const cli = readFileSync('scripts/mission-control-task-create.mjs', 'utf8')
    expect(publicKey).toContain('BEGIN PUBLIC KEY')
    expect(publicKey).not.toContain('PRIVATE KEY')
    expect(cli).not.toContain('console.log(process.env.BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY')
    expect(readFileSync(workflowPath, 'utf8')).toContain('BEMOAT_TASK_BOOTSTRAP_SIGNING_PRIVATE_KEY: ${{ secrets.')
  })

  it('uses deterministic canonical serialization and rejects a wrong public key', () => {
    const material = keys()
    const envelope = createSignedEnvelope({
      keyId: 'contract-key',
      payload: { z: 2, a: { d: true, c: [3, 2, 1] } },
      privateKey: material.privateKey,
    })
    expect(canonicalSerialize({ z: 2, a: { d: true, c: [3, 2, 1] } })).toBe(canonicalSerialize({ a: { c: [3, 2, 1], d: true }, z: 2 }))
    expect(verifySignedEnvelope(envelope, { publicKey: material.publicKey, expectedSchema: 'bemoat-mission-control-task-bootstrap-attestation', expectedOperation: 'task-bootstrap', expectedOperationVersion: 1, signingKeyId: 'contract-key' }).ok).toBe(true)
    expect(verifySignedEnvelope(envelope, { publicKey: keys().publicKey, expectedSchema: 'bemoat-mission-control-task-bootstrap-attestation', expectedOperation: 'task-bootstrap', expectedOperationVersion: 1, signingKeyId: 'contract-key' }).ok).toBe(false)
  })

  it('binds request identity to the immutable authorization, genesis, and policy tuple', () => {
    const input = {
      repository: BOOTSTRAP_CONTRACT.repository,
      authorizationCommentId: '9001',
      authorizationBodySha256: 'a'.repeat(64),
      parentIssue: BOOTSTRAP_CONTRACT.parentIssue,
      pullRequest: BOOTSTRAP_CONTRACT.pullRequest,
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policyPath: BOOTSTRAP_CONTRACT.policySource,
      policyVersion: BOOTSTRAP_CONTRACT.policyVersion,
      policySha: BOOTSTRAP_CONTRACT.policySha,
    }
    const first = buildTaskBootstrapRequestIdentity(input)
    const identicalRetry = buildTaskBootstrapRequestIdentity({ ...input })
    const changedAuthorization = buildTaskBootstrapRequestIdentity({
      ...input,
      authorizationBodySha256: 'b'.repeat(64),
    })

    expect(first.requestId).toMatch(/^mc-task-bootstrap-v1-[0-9a-f]{64}$/)
    expect(first).toEqual(identicalRetry)
    expect(changedAuthorization.requestId).not.toBe(first.requestId)
    expect(first.tuple).toMatchObject({
      operation: 'task-bootstrap',
      operation_version: 1,
      repository: BOOTSTRAP_CONTRACT.repository,
      authorization_comment_id: '9001',
      authorization_body_sha256: 'a'.repeat(64),
      parent_issue: 262,
      pull_request: 263,
      base: 'main',
      head: BOOTSTRAP_CONTRACT.head,
      protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policy_path: BOOTSTRAP_CONTRACT.policySource,
      policy_version: BOOTSTRAP_CONTRACT.policyVersion,
      policy_sha: BOOTSTRAP_CONTRACT.policySha,
    })
  })

  it('keeps provisional Issues outside managed preflight', () => {
    const body = renderProvisionalTaskBody({
      requestId: `mc-task-bootstrap-v1-${'a'.repeat(64)}`,
      repository: BOOTSTRAP_CONTRACT.repository,
      parentIssue: 262,
      pullRequest: 263,
      base: 'main',
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policyPath: BOOTSTRAP_CONTRACT.policySource,
      policyVersion: BOOTSTRAP_CONTRACT.policyVersion,
      policySha: BOOTSTRAP_CONTRACT.policySha,
    })
    expect(parseProvisionalTaskBody(body)).toMatchObject({ present: true, valid: true })
    expect(preflightCanonicalBootstrapTask({ issue: { number: 300, body }, pullRequest: { number: 263, headRefOid: BOOTSTRAP_CONTRACT.head, baseRefName: 'main' }, repository: BOOTSTRAP_CONTRACT.repository }).ok).toBe(false)
    expect(runCanonicalManagedTaskPreflight({ issue: { number: 300, body }, pullRequest: { number: 263, headRefOid: BOOTSTRAP_CONTRACT.head, baseRefName: 'main' }, repository: BOOTSTRAP_CONTRACT.repository }).ok).toBe(false)
  })

  it('fails closed for malformed or incomplete provisional allocation metadata', () => {
    const requestId = `mc-task-bootstrap-v1-${'a'.repeat(64)}`
    const body = renderProvisionalTaskBody({
      requestId,
      repository: BOOTSTRAP_CONTRACT.repository,
      parentIssue: BOOTSTRAP_CONTRACT.parentIssue,
      pullRequest: BOOTSTRAP_CONTRACT.pullRequest,
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policyPath: BOOTSTRAP_CONTRACT.policySource,
      policyVersion: BOOTSTRAP_CONTRACT.policyVersion,
      policySha: BOOTSTRAP_CONTRACT.policySha,
    })

    expect(parseProvisionalTaskBody(body.replace(
      requestId,
      `${requestId.slice(0, -1)}x`,
    ))).toMatchObject({
      present: true,
      valid: false,
      reason: 'provisional allocation fields are invalid',
    })
    expect(parseProvisionalTaskBody(body.replace(
      '<!-- bemoat-mission-control-task-bootstrap:provisional:end -->',
      '',
    ))).toMatchObject({
      present: true,
      valid: false,
      reason: 'provisional marker pair is unbalanced',
    })
    expect(parseProvisionalTaskBody(body.replace(
      '"status": "provisional"',
      '"status": "managed"',
    ))).toMatchObject({
      present: true,
      valid: false,
      reason: 'provisional allocation fields are invalid',
    })
  })

  it('signs and verifies parent registry ownership without exposing a write credential', () => {
    const material = keys()
    const record = createTaskOwnershipRecord({
      signingKeyId: 'registry-key',
      privateKey: material.privateKey,
      payload: {
        schema_version: 1,
        registry_schema: 'bemoat-mission-control-task-ownership-registry',
        repository: BOOTSTRAP_CONTRACT.repository,
        request_id: `mc-task-bootstrap-v1-${'b'.repeat(64)}`,
        parent_issue_number: 262,
        parent_issue_id: 'parent',
        parent_issue_node_id: 'parent-node',
        task_issue_number: 300,
        task_issue_id: 'task',
        task_issue_node_id: 'task-node',
        pr_number: 263,
        pr_id: 'pr',
        pr_node_id: 'pr-node',
        base: 'main',
        head: BOOTSTRAP_CONTRACT.head,
        protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
        attestation_sha256: 'c'.repeat(64),
        signing_key_id: 'registry-key',
      },
    })
    expect(verifyTaskOwnershipRecord(record, { publicKey: material.publicKey, repository: BOOTSTRAP_CONTRACT.repository, signingKeyId: 'registry-key' }).ok).toBe(true)
  })
})
