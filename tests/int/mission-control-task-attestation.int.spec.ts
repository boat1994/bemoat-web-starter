import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import * as facade from '../../scripts/mission-control/domain/task-attestation.mjs'
import * as typed from '../../scripts/mission-control/domain/task-attestation.ts'

type Envelope = ReturnType<typeof typed.createSignedEnvelope>
type JsonObject = Record<string, unknown>

const EXPORTS = [
  'TASK_ATTESTATION_END',
  'TASK_ATTESTATION_OPERATION',
  'TASK_ATTESTATION_OPERATION_VERSION',
  'TASK_ATTESTATION_SCHEMA',
  'TASK_ATTESTATION_START',
  'canonicalHash',
  'canonicalSerialize',
  'createSignedEnvelope',
  'parseSignedEnvelope',
  'parseTaskAttestation',
  'renderSignedEnvelope',
  'sha256Hex',
  'verifySignedEnvelope',
  'verifyTaskAttestation',
]

const REPOSITORY = 'boat1994/bemoat-web-starter'
const PROTECTED_BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const AUTHORIZATION_BODY_SHA = 'c'.repeat(64)
const MANAGED_STATE_SHA = 'd'.repeat(64)
const REQUEST_ID = `mc-task-bootstrap-v1-${'e'.repeat(64)}`
const KEY_ID = 'genesis-test-key-1'

const parentIssue = { number: 262, id: 'I_parent', node_id: 'N_parent' }
const taskIssue = { number: 300, id: 'I_task', node_id: 'N_task' }
const pullRequest = { number: 263, id: 'PR_263', node_id: 'N_pr' }
const workflow = {
  file: '.github/workflows/mission-control-task-bootstrap.yml',
  ref: 'refs/heads/main',
  sha: PROTECTED_BASE_SHA,
  runId: '123',
}
const policy = {
  path: 'docs/mission-control/mission-control-guide.md',
  version: '1.3.0',
  sourceCommit: PROTECTED_BASE_SHA,
  blobSha: 'f'.repeat(40),
}

function keyMaterial() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function taskPayload(overrides: JsonObject = {}): JsonObject {
  return {
    attestation_schema: typed.TASK_ATTESTATION_SCHEMA,
    operation: typed.TASK_ATTESTATION_OPERATION,
    operation_version: typed.TASK_ATTESTATION_OPERATION_VERSION,
    managed_state_sha256: MANAGED_STATE_SHA,
    repository: REPOSITORY,
    repository_id: 'R_repo',
    repository_node_id: 'R_node',
    protected_base_sha: PROTECTED_BASE_SHA,
    founder_login: 'boat1994',
    authorization_comment_id: '9001',
    authorization_body_sha256: AUTHORIZATION_BODY_SHA,
    parent_issue_number: parentIssue.number,
    parent_issue_id: parentIssue.id,
    parent_issue_node_id: parentIssue.node_id,
    task_issue_number: taskIssue.number,
    task_issue_id: taskIssue.id,
    task_issue_node_id: taskIssue.node_id,
    pr_number: pullRequest.number,
    pr_id: pullRequest.id,
    pr_node_id: pullRequest.node_id,
    base: 'main',
    head: HEAD_SHA,
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
    ...overrides,
  }
}

function createEnvelope(payload: JsonObject = taskPayload(), material = keyMaterial()): Envelope {
  return typed.createSignedEnvelope({ keyId: KEY_ID, payload, privateKey: material.privateKey })
}

function verifyOptions(material: ReturnType<typeof keyMaterial>, overrides: JsonObject = {}) {
  return {
    publicKey: material.publicKey,
    repository: REPOSITORY,
    repositoryIdentity: { nameWithOwner: REPOSITORY, id: 'R_repo', node_id: 'R_node' },
    protectedBaseSha: PROTECTED_BASE_SHA,
    authorizationCommentId: '9001',
    authorizationBodySha256: AUTHORIZATION_BODY_SHA,
    founderLogin: 'boat1994',
    parentIssue,
    taskIssue,
    pullRequest,
    expectedHead: HEAD_SHA,
    expectedBase: 'main',
    policy,
    requestId: REQUEST_ID,
    expectedWorkflow: workflow,
    signingKeyId: KEY_ID,
    ...overrides,
  }
}

function cloneEnvelope(envelope: Envelope): JsonObject {
  return structuredClone(envelope) as JsonObject
}

function thrown(fn: () => unknown): { code?: string; message?: string } {
  try {
    fn()
    return {}
  } catch (error) {
    if (!(error instanceof Error)) return {}
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return { code, message: error.message }
  }
}

describe('Mission Control task-attestation typed boundary', () => {
  it('keeps the facade and typed implementation at exactly the approved 14-export surface', () => {
    expect(Object.keys(facade).sort()).toEqual(EXPORTS)
    expect(Object.keys(typed).sort()).toEqual(EXPORTS)
    for (const name of EXPORTS) {
      expect(facade[name as keyof typeof facade]).toBe(typed[name as keyof typeof typed])
    }
  })

  it('canonicalizes nested objects deterministically while preserving arrays and input immutability', () => {
    const value = { z: 1, a: { d: 4, c: 3 }, b: [{ y: 2, x: 1 }, 3] }
    const snapshot = structuredClone(value)

    expect(typed.canonicalSerialize(value)).toBe('{"a":{"c":3,"d":4},"b":[{"x":1,"y":2},3],"z":1}')
    expect(typed.canonicalHash(value)).toBe('323339dfca1da07f707690797f296087d3d20f01ecb98c46b92014f67921c01f')
    expect(value).toEqual(snapshot)
    expect(typed.canonicalSerialize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(typed.canonicalHash({ b: 2, a: 1 })).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777')
    expect(typed.canonicalSerialize({ array: [3, 1, 2] })).toBe('{"array":[3,1,2]}')
    expect(typed.canonicalSerialize({ hole: [, 1], negativeZero: -0 })).toBe('{"hole":[null,1],"negativeZero":0}')
  })

  it.each([
    ['undefined object value', { value: { bad: undefined } }, 'canonical payload cannot contain undefined key bad'],
    ['undefined array value', { value: [undefined] }, 'canonical payload contains unsupported value type undefined'],
    ['NaN', { value: Number.NaN }, 'canonical payload cannot contain a non-finite number'],
    ['Infinity', { value: Number.POSITIVE_INFINITY }, 'canonical payload cannot contain a non-finite number'],
    ['-Infinity', { value: Number.NEGATIVE_INFINITY }, 'canonical payload cannot contain a non-finite number'],
    ['bigint', { value: BigInt(1) }, 'canonical payload contains unsupported value type bigint'],
    ['symbol', { value: Symbol('unsupported') }, 'canonical payload contains unsupported value type symbol'],
    ['function', { value: (): null => null }, 'canonical payload contains unsupported value type function'],
  ])('rejects %s with an attestation-invalid error', (_label: string, input: { value: unknown }, message: string) => {
    expect(() => typed.canonicalSerialize(input.value)).toThrowError(message)
    expect(thrown(() => typed.canonicalSerialize(input.value)).code).toBe('ATTESTATION_INVALID')
  })

  it('does not mutate payloads while signing and produces deterministic Ed25519 fields', () => {
    const material = keyMaterial()
    const payload = { nested: { z: 1, a: 2 }, array: [{ b: 2, a: 1 }] }
    const snapshot = structuredClone(payload)
    const first = typed.createSignedEnvelope({ keyId: KEY_ID, payload, privateKey: material.privateKey })
    const second = typed.createSignedEnvelope({ keyId: KEY_ID, payload, privateKey: material.privateKey })

    expect(payload).toEqual(snapshot)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      schema_version: 1,
      attestation_schema: typed.TASK_ATTESTATION_SCHEMA,
      operation: typed.TASK_ATTESTATION_OPERATION,
      operation_version: 1,
      algorithm: 'Ed25519',
      key_id: KEY_ID,
      payload: { array: [{ a: 1, b: 2 }], nested: { a: 2, z: 1 } },
    })
    expect(typed.verifySignedEnvelope(first, { publicKey: material.publicKey }).ok).toBe(true)
  })

  it('preserves thrown error boundaries for missing key ID, private material, malformed keys, and unsupported payloads', () => {
    const material = keyMaterial()
    const missingKeyId = () => typed.createSignedEnvelope({ payload: {}, privateKey: material.privateKey })
    const missingPrivateKey = () => typed.createSignedEnvelope({ keyId: KEY_ID, payload: {} })
    const malformedPrivateKey = () => typed.createSignedEnvelope({ keyId: KEY_ID, payload: {}, privateKey: 'not-a-private-key' })
    const unsupportedPayload = (): unknown => typed.createSignedEnvelope({ keyId: KEY_ID, payload: { bad: (): null => null }, privateKey: material.privateKey })

    expect(thrown(missingKeyId).code).toBe('ATTESTATION_INVALID')
    expect(thrown(missingPrivateKey).code).toBe('BLOCKED_EXTERNAL')
    expect(thrown(malformedPrivateKey)).toEqual(thrown(() => facade.createSignedEnvelope({ keyId: KEY_ID, payload: {}, privateKey: 'not-a-private-key' })))
    expect(thrown(unsupportedPayload).code).toBe('ATTESTATION_INVALID')
  })

  it('requires exactly one balanced marker pair and round-trips default and custom markers', () => {
    const envelope = createEnvelope()
    const rendered = typed.renderSignedEnvelope(envelope)
    expect(typed.parseSignedEnvelope(rendered)).toEqual({ ok: true, envelope })
    expect(typed.parseTaskAttestation(rendered)).toEqual({ ok: true, envelope })

    const custom = { start: '<!-- custom:start -->', end: '<!-- custom:end -->' }
    const customRendered = typed.renderSignedEnvelope(envelope, custom)
    expect(typed.parseSignedEnvelope(customRendered, custom)).toEqual({ ok: true, envelope })

    const malformed = [
      `${rendered}\n${rendered}`,
      rendered.replace(typed.TASK_ATTESTATION_START, typed.TASK_ATTESTATION_END),
      rendered.replace(typed.TASK_ATTESTATION_END, ''),
      `${typed.TASK_ATTESTATION_END}\n${rendered.replace(typed.TASK_ATTESTATION_START, '')}`,
      rendered.replace(JSON.stringify(envelope, null, 2), '{not-json}'),
      `${typed.TASK_ATTESTATION_START}\n[]\n${typed.TASK_ATTESTATION_END}`,
      `${typed.TASK_ATTESTATION_START}\n42\n${typed.TASK_ATTESTATION_END}`,
    ]
    for (const body of malformed) {
      expect(typed.parseSignedEnvelope(body)).toMatchObject({ ok: false, envelope: null })
    }
  })

  it('returns fail-closed generic verification results for schema, cryptographic, and repository failures', () => {
    const material = keyMaterial()
    const valid = typed.createSignedEnvelope({ keyId: KEY_ID, payload: { repository: REPOSITORY }, privateKey: material.privateKey })
    const validOptions = {
      publicKey: material.publicKey,
      expectedSchema: typed.TASK_ATTESTATION_SCHEMA,
      expectedOperation: typed.TASK_ATTESTATION_OPERATION,
      expectedOperationVersion: typed.TASK_ATTESTATION_OPERATION_VERSION,
      signingKeyId: KEY_ID,
      repository: REPOSITORY,
    }
    expect(typed.verifySignedEnvelope(valid, validOptions)).toEqual({ ok: true, reason: null, envelope: valid, payload: valid.payload })

    const cases: Array<[string, (candidate: JsonObject) => void]> = [
      ['schema', (candidate) => { candidate.schema_version = 2 }],
      ['operation', (candidate) => { candidate.operation = 'other' }],
      ['version', (candidate) => { candidate.operation_version = 2 }],
      ['algorithm', (candidate) => { candidate.algorithm = 'RSA' }],
      ['key ID', (candidate) => { candidate.key_id = 'other-key' }],
      ['signature field', (candidate) => { candidate.signature_base64 = '' }],
      ['hash field', (candidate) => { candidate.payload_sha256 = 'bad' }],
      ['canonical hash', (candidate) => { candidate.payload_sha256 = '0'.repeat(64) }],
      ['signature', (candidate) => { candidate.signature_base64 = Buffer.alloc(64).toString('base64') }],
      ['payload tampering', (candidate) => { candidate.payload = { repository: 'evil/repo' } }],
    ]
    for (const [label, mutate] of cases) {
      const candidate = cloneEnvelope(valid)
      mutate(candidate)
      const result = typed.verifySignedEnvelope(candidate, validOptions)
      expect(result.ok, label).toBe(false)
      expect(result).toMatchObject({ ok: false, envelope: null })
      expect(typeof result.reason).toBe('string')
    }
    expect(typed.verifySignedEnvelope(valid, { ...validOptions, publicKey: undefined })).toMatchObject({ ok: false, envelope: null })
    expect(typed.verifySignedEnvelope(valid, { ...validOptions, signingKeyId: 'wrong-key' })).toMatchObject({ ok: false, envelope: null })
    expect(typed.verifySignedEnvelope(valid, { ...validOptions, repository: 'evil/repo' })).toMatchObject({ ok: false, envelope: null })
    expect(typed.verifySignedEnvelope(null, validOptions)).toEqual({ ok: false, reason: 'signed envelope is missing', envelope: null })
  })

  it.each([
    ['repository', { repository: 'evil/repo' }],
    ['repository identity', { repositoryIdentity: { nameWithOwner: REPOSITORY, id: 'R_other', node_id: 'R_node' } }],
    ['protected base', { protectedBaseSha: '1'.repeat(40) }],
    ['Founder', { founderLogin: 'other-founder' }],
    ['authorization comment', { authorizationCommentId: '9002' }],
    ['authorization hash', { authorizationBodySha256: '1'.repeat(64) }],
    ['parent Issue', { parentIssue: { ...parentIssue, id: 'I_other' } }],
    ['Task Issue', { taskIssue: { ...taskIssue, node_id: 'N_other' } }],
    ['PR', { pullRequest: { ...pullRequest, number: 264 } }],
    ['base', { expectedBase: 'dev' }],
    ['head', { expectedHead: '1'.repeat(40) }],
    ['policy path', { policy: { ...policy, path: 'other.md' } }],
    ['policy version', { policy: { ...policy, version: '9.9.9' } }],
    ['policy source', { policy: { ...policy, sourceCommit: '1'.repeat(40) } }],
    ['policy blob', { policy: { ...policy, blobSha: '1'.repeat(40) } }],
    ['workflow file', { expectedWorkflow: { ...workflow, file: 'other.yml' } }],
    ['workflow ref', { expectedWorkflow: { ...workflow, ref: 'refs/heads/dev' } }],
    ['workflow SHA', { expectedWorkflow: { ...workflow, sha: '1'.repeat(40) } }],
    ['workflow run', { expectedWorkflow: { ...workflow, runId: '999' } }],
    ['request ID', { requestId: `mc-task-bootstrap-v1-${'1'.repeat(64)}` }],
    ['signing key', { signingKeyId: 'other-key' }],
    ['managed-state field', { payload: { managed_state_sha256: 'not-a-sha' } }],
  ] as Array<[string, JsonObject]>)('fails closed when the task binding changes for %s', (_label: string, change: JsonObject) => {
    const material = keyMaterial()
    const payload = change.payload && typeof change.payload === 'object' && !Array.isArray(change.payload)
      ? taskPayload(change.payload as JsonObject)
      : taskPayload()
    const envelope = createEnvelope(payload, material)
    const options = verifyOptions(material, change.payload ? {} : change)
    const result = typed.verifyTaskAttestation(envelope, options)

    expect(result).toMatchObject({ ok: false, envelope: null })
    expect(typeof result.reason).toBe('string')
  })

  it('accepts a fully bound task attestation and keeps returned and thrown boundaries distinct', () => {
    const material = keyMaterial()
    const envelope = createEnvelope(taskPayload(), material)
    const result = typed.verifyTaskAttestation(envelope, verifyOptions(material))

    expect(result).toEqual({ ok: true, reason: null, envelope })
    expect(typed.verifyTaskAttestation(null, verifyOptions(material))).toEqual({ ok: false, reason: 'attestation envelope is missing', envelope: null })
    expect(typed.parseSignedEnvelope('not-a-marker')).toMatchObject({ ok: false, envelope: null })
    expect(() => typed.createSignedEnvelope({ keyId: KEY_ID, payload: {}, privateKey: material.privateKey })).not.toThrow()
  })
})
