import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalSerialize, createSignedEnvelope, sha256Hex, verifySignedEnvelope } from '../../scripts/mission-control/domain/task-attestation.mjs'
import { parseProvisionalTaskBody, renderProvisionalTaskBody } from '../../scripts/mission-control/domain/task-bootstrap-request.mjs'
import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.mjs'
import { createTaskOwnershipRecord, verifyTaskOwnershipRecord } from '../../scripts/mission-control/domain/task-ownership-registry.mjs'
import { preflightCanonicalBootstrapTask, runCanonicalManagedTaskPreflight } from '../../scripts/mission-control/domain/task-bootstrap-preflight.mjs'

const workflowPath = '.github/workflows/mission-control-task-bootstrap.yml'

const AUTHORIZATION_COMMENT_ID = '9001'
const FOUNDER_LOGIN = 'boat1994'

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function authorizationFixture(typed: typeof import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')) {
  const authorization = typed.parseFounderTaskBootstrapAuthorization(
    typed.createFounderAuthorizationBody({ commentId: AUTHORIZATION_COMMENT_ID }),
  )
  const authorizationComment = {
    id: AUTHORIZATION_COMMENT_ID,
    body: typed.createFounderAuthorizationBody({ commentId: AUTHORIZATION_COMMENT_ID }),
    user: { login: FOUNDER_LOGIN },
    issue_number: typed.BOOTSTRAP_CONTRACT.parentIssue,
  }
  return { authorization, authorizationComment }
}

function expectStateConflict(action: () => unknown, message?: string) {
  try {
    action()
    throw new Error('expected Founder bootstrap authorization validation to throw')
  } catch (error) {
    expect(error).toMatchObject({ code: 'STATE_CONFLICT', classification: 'STATE_CONFLICT' })
    if (message) expect(error).toHaveProperty('message', `Founder bootstrap authorization is invalid: ${message}`)
  }
}

describe('Mission Control bootstrap transport contract', () => {
  it('characterizes the raw JSON trust-boundary parser and exact failure shape', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')

    expect(typed.parseFounderTaskBootstrapAuthorization(' {"approved":true} \n')).toEqual({ approved: true })
    for (const body of [
      '',
      '   ',
      '```json\n{}\n```',
      'not json',
      '{} {}',
      '[]',
      'null',
      'true',
      '1',
      '"Founder"',
    ]) {
      expect(() => typed.parseFounderTaskBootstrapAuthorization(body), body).toThrowError(
        'Founder bootstrap authorization is invalid:',
      )
    }
    expectStateConflict(() => typed.parseFounderTaskBootstrapAuthorization('not json'), 'comment body is not valid JSON')
    expectStateConflict(() => typed.parseFounderTaskBootstrapAuthorization('[]'), 'comment body must decode to one JSON object')
    expectStateConflict(() => typed.parseFounderTaskBootstrapAuthorization('```{}'), 'comment must contain exactly one raw JSON object')
  })

  it('preserves deterministic genesis fixture values, coercions, placeholder IDs, and detached hash', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const body = typed.createFounderAuthorizationBody({ parentIssue: '262', commentId: 9001 })
    const authorization = typed.parseFounderTaskBootstrapAuthorization(body)

    expect(authorization).toMatchObject({
      schema_version: 1,
      status: 'approved',
      authority: 'Founder',
      author_login: FOUNDER_LOGIN,
      comment_id: AUTHORIZATION_COMMENT_ID,
      immutable_comment_reference: true,
      non_superseded: true,
      superseded_by: null,
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      bundle_kind: typed.BOOTSTRAP_AUTHORIZATION_BUNDLE,
      parent_issue: 262,
      task_issue: null,
      pr: typed.BOOTSTRAP_CONTRACT.pullRequest,
      exact_head: typed.BOOTSTRAP_CONTRACT.head,
      reviewed_head: typed.BOOTSTRAP_CONTRACT.head,
      base: typed.BOOTSTRAP_CONTRACT.base,
      policy_source: typed.BOOTSTRAP_CONTRACT.policySource,
      policy_source_sha: typed.BOOTSTRAP_CONTRACT.policySha,
      protected_base_sha: typed.BOOTSTRAP_CONTRACT.protectedBaseSha,
      policy_version: typed.BOOTSTRAP_CONTRACT.policyVersion,
      scope: typed.BOOTSTRAP_AUTHORIZATION_SCOPE,
      action: typed.BOOTSTRAP_AUTHORIZATION_ACTION,
    })
    expect(authorization.comment_sha256).toBe(
      sha256Hex(canonicalSerialize({ ...authorization, comment_sha256: null })),
    )
    expect(typed.createFounderAuthorizationBody({ commentId: null })).toContain('"comment_id": "<immutable-comment-id>"')
  })

  it('accepts the exact valid Founder genesis authorization and preserves the success shape', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const { authorization, authorizationComment } = authorizationFixture(typed)
    const result = typed.validateFounderTaskBootstrapAuthorization({
      authorization,
      authorizationComment,
      parentIssue: { number: typed.BOOTSTRAP_CONTRACT.parentIssue },
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    })

    expect(result).toEqual({
      valid: true,
      authorLogin: FOUNDER_LOGIN,
      commentId: AUTHORIZATION_COMMENT_ID,
      bodySha256: sha256Hex(authorizationComment.body),
      authorization,
    })

    expect(typed.validateFounderTaskBootstrapAuthorization({
      authorization,
      authorizationComment: { ...authorizationComment, user: undefined, author: { login: FOUNDER_LOGIN } },
      parentIssue: { number: typed.BOOTSTRAP_CONTRACT.parentIssue },
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    })).toMatchObject({ valid: true, authorLogin: FOUNDER_LOGIN })
    expect(typed.validateFounderTaskBootstrapAuthorization({
      authorization,
      authorizationComment: { ...authorizationComment, user: undefined, author: undefined, author_login: FOUNDER_LOGIN },
      parentIssue: { number: typed.BOOTSTRAP_CONTRACT.parentIssue },
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    })).toMatchObject({ valid: true, authorLogin: FOUNDER_LOGIN })
  })

  it('fails closed for Founder, trusted-login, comment-identity, and genesis tuple bindings', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const cases: Array<[string, (authorization: Record<string, unknown>, comment: Record<string, unknown>) => void]> = [
      ['schema_version', (authorization) => { authorization.schema_version = 2 }],
      ['status', (authorization) => { authorization.status = 'pending' }],
      ['authority', (authorization) => { authorization.authority = 'Maintainer' }],
      ['author_login', (authorization) => { authorization.author_login = 'other-founder' }],
      ['Founder comment author', (_authorization, comment) => { comment.user = { login: 'other-founder' } }],
      ['trusted Founder allowlist', () => undefined],
      ['immutable comment reference', (authorization) => { authorization.immutable_comment_reference = false }],
      ['non-superseded flag', (authorization) => { authorization.non_superseded = false }],
      ['superseded_by', (authorization) => { authorization.superseded_by = '9002' }],
      ['repository', (authorization) => { authorization.repository = 'other/repository' }],
      ['bundle_kind', (authorization) => { authorization.bundle_kind = 'delivery' }],
      ['parent_issue', (authorization) => { authorization.parent_issue = 999 }],
      ['task_issue', (authorization) => { authorization.task_issue = 300 }],
      ['pull request', (authorization) => { authorization.pr = 264 }],
      ['exact head', (authorization) => { authorization.exact_head = 'a'.repeat(40) }],
      ['reviewed head', (authorization) => { authorization.reviewed_head = 'a'.repeat(40) }],
      ['base', (authorization) => { authorization.base = 'dev' }],
      ['policy source', (authorization) => { authorization.policy_source = 'other.md' }],
      ['policy source SHA', (authorization) => { authorization.policy_source_sha = 'a'.repeat(40) }],
      ['protected base SHA', (authorization) => { authorization.protected_base_sha = 'a'.repeat(40) }],
      ['policy version', (authorization) => { authorization.policy_version = '9.9.9' }],
      ['scope', (authorization) => { authorization.scope = 'delivery' }],
      ['action', (authorization) => { authorization.action = 'merge' }],
      ['comment ID', (_authorization, comment) => { comment.id = '9002' }],
    ]

    for (const [label, mutate] of cases) {
      const { authorization, authorizationComment } = authorizationFixture(typed)
      mutate(authorization as Record<string, unknown>, authorizationComment as Record<string, unknown>)
      const founderLogins = label === 'trusted Founder allowlist' ? ['other-founder'] : [FOUNDER_LOGIN]
      expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({
        authorization,
        authorizationComment,
        parentIssue: { number: typed.BOOTSTRAP_CONTRACT.parentIssue },
        repository: typed.BOOTSTRAP_CONTRACT.repository,
        founderLogins,
      }))
    }
  })

  it('preserves optional parent/comment issue checks and detached comment hash behavior', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const { authorization, authorizationComment } = authorizationFixture(typed)
    const base = {
      authorization,
      authorizationComment,
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    }

    expect(typed.validateFounderTaskBootstrapAuthorization({ ...base, parentIssue: {} })).toMatchObject({ valid: true })
    expect(typed.validateFounderTaskBootstrapAuthorization({ ...base, authorizationComment: { ...authorizationComment, issue_number: undefined } })).toMatchObject({ valid: true })
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, parentIssue: { number: 999 } }), 'authorization parent Issue does not match the genesis parent')
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, authorizationComment: { ...authorizationComment, issue_number: 999 } }), 'authorization comment is not attached to the parent Issue')

    const withoutDetachedHash = { ...authorization }
    delete withoutDetachedHash.comment_sha256
    expect(typed.validateFounderTaskBootstrapAuthorization({ ...base, authorization: withoutDetachedHash })).toMatchObject({ valid: true })
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, authorization: { ...authorization, comment_sha256: 'not-a-sha' } }), 'comment_sha256 is not a SHA-256 digest')
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, authorization: { ...authorization, comment_sha256: 'a'.repeat(64) } }), 'authorization detached comment hash does not match')
  })

  it('preserves supersession arrays, same-ID exclusion, malformed-superseder ignore, and no timestamp ordering', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const { authorization, authorizationComment } = authorizationFixture(typed)
    const base = {
      authorization,
      authorizationComment,
      parentIssue: { number: typed.BOOTSTRAP_CONTRACT.parentIssue },
      repository: typed.BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    }
    const superseder = (body: string, id = '9002', extra: Record<string, unknown> = {}) => ({ id, body, ...extra })
    const supersedingBody = JSON.stringify({ supersedes_comment_id: AUTHORIZATION_COMMENT_ID })
    const supersedingArrayBody = JSON.stringify({ supersedes_comment_ids: [AUTHORIZATION_COMMENT_ID] })

    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, parentComments: [superseder(supersedingBody)] }), 'authorization was explicitly superseded')
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, parentComments: [superseder(supersedingArrayBody)] }), 'authorization was explicitly superseded')
    expect(typed.validateFounderTaskBootstrapAuthorization({ ...base, parentComments: [superseder(supersedingBody, AUTHORIZATION_COMMENT_ID)] })).toMatchObject({ valid: true })
    expect(typed.validateFounderTaskBootstrapAuthorization({ ...base, parentComments: [superseder('not JSON')] })).toMatchObject({ valid: true })
    expectStateConflict(() => typed.validateFounderTaskBootstrapAuthorization({ ...base, parentComments: [superseder(supersedingBody, '9002', { created_at: '1970-01-01T00:00:00Z' })] }), 'authorization was explicitly superseded')
  })

  it('keeps the exact typed implementation behind a logic-free facade', async () => {
    const facade = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.mjs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')

    expect(readFileSync('scripts/mission-control/domain/task-bootstrap-authorization.mjs', 'utf8')).toBe("export * from './task-bootstrap-authorization.ts'\n")
    expect(Object.keys(facade).sort()).toEqual(Object.keys(typed).sort())
    for (const name of Object.keys(facade) as Array<keyof typeof facade>) {
      expect(facade[name]).toBe(typed[name])
    }
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
