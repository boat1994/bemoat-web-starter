import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalSerialize, createSignedEnvelope, verifySignedEnvelope } from '../../scripts/mission-control/domain/task-attestation.mjs'
import { parseProvisionalTaskBody, renderProvisionalTaskBody } from '../../scripts/mission-control/domain/task-bootstrap-request.mjs'
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

describe('Mission Control bootstrap transport contract', () => {
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
