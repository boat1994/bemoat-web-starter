import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { canonicalSerialize, createSignedEnvelope, sha256Hex, verifySignedEnvelope } from '../../scripts/mission-control/domain/task-attestation.mjs'
import {
  PROVISIONAL_TASK_END,
  PROVISIONAL_TASK_MARKER,
  buildTaskBootstrapRequestIdentity,
  parseProvisionalTaskBody,
  renderProvisionalTaskBody,
} from '../../scripts/mission-control/domain/task-bootstrap-request.ts'
import { BOOTSTRAP_CONTRACT } from '../../scripts/mission-control/domain/task-bootstrap-authorization.ts'
import { createTaskOwnershipRecord, verifyTaskOwnershipRecord } from '../../scripts/mission-control/domain/task-ownership-registry.mjs'
import { preflightCanonicalBootstrapTask, runCanonicalManagedTaskPreflight } from '../../scripts/mission-control/domain/task-bootstrap-preflight.ts'

const workflowPath = '.github/workflows/mission-control-task-bootstrap.yml'

const AUTHORIZATION_COMMENT_ID = '9001'
const FOUNDER_LOGIN = 'boat1994'
const REQUEST_INPUT = {
  repository: BOOTSTRAP_CONTRACT.repository,
  authorizationCommentId: AUTHORIZATION_COMMENT_ID,
  authorizationBodySha256: 'b'.repeat(64),
  parentIssue: '262',
  pullRequest: '263',
  base: BOOTSTRAP_CONTRACT.base,
  head: BOOTSTRAP_CONTRACT.head,
  protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
  policyPath: BOOTSTRAP_CONTRACT.policySource,
  policyVersion: BOOTSTRAP_CONTRACT.policyVersion,
  policySha: BOOTSTRAP_CONTRACT.policySha,
}

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
  it('accepts a trusted Founder authorization for an existing planning-only Task Issue', async () => {
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    const body = typed.createFounderAuthorizationBody({
      parentIssue: 380,
      taskIssue: 380,
      pullRequest: null,
      head: null,
      targetMode: 'planning_no_pr',
      commentId: AUTHORIZATION_COMMENT_ID,
    })
    const authorization = typed.parseFounderTaskBootstrapAuthorization(body)

    expect(typed.validateFounderTaskBootstrapAuthorization({
      authorization,
      authorizationComment: {
        id: AUTHORIZATION_COMMENT_ID,
        body,
        user: { login: FOUNDER_LOGIN },
        issue_number: 380,
      },
      parentIssue: { number: 380 },
      repository: BOOTSTRAP_CONTRACT.repository,
      founderLogins: [FOUNDER_LOGIN],
    })).toMatchObject({
      valid: true,
      authorLogin: FOUNDER_LOGIN,
      commentId: AUTHORIZATION_COMMENT_ID,
      authorization: {
        bundle_kind: 'task-bootstrap-existing',
        task_issue: 380,
        target_mode: 'planning_no_pr',
        pr: null,
        exact_head: null,
        reviewed_head: null,
      },
    })
  })

  it('uses null PR and head values in the deterministic planning-only request identity', () => {
    const result = buildTaskBootstrapRequestIdentity({
      ...REQUEST_INPUT,
      parentIssue: 380,
      pullRequest: null,
      head: null,
      targetMode: 'planning_no_pr',
    })

    expect(result.tuple).toMatchObject({ parent_issue: 380, pull_request: null, head: null })
  })

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

  it('preserves the exact request-ID tuple field order, canonical serialization, hash, and result shape', () => {
    const result = buildTaskBootstrapRequestIdentity(REQUEST_INPUT)

    expect(Object.keys(result)).toEqual(['requestId', 'tuple'])
    expect(Object.keys(result.tuple)).toEqual([
      'operation',
      'operation_version',
      'repository',
      'authorization_comment_id',
      'authorization_body_sha256',
      'parent_issue',
      'pull_request',
      'base',
      'head',
      'protected_base_sha',
      'policy_path',
      'policy_version',
      'policy_sha',
    ])
    expect(result.tuple).toEqual({
      operation: 'task-bootstrap',
      operation_version: 1,
      repository: BOOTSTRAP_CONTRACT.repository,
      authorization_comment_id: AUTHORIZATION_COMMENT_ID,
      authorization_body_sha256: 'b'.repeat(64),
      parent_issue: 262,
      pull_request: 263,
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protected_base_sha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policy_path: BOOTSTRAP_CONTRACT.policySource,
      policy_version: BOOTSTRAP_CONTRACT.policyVersion,
      policy_sha: BOOTSTRAP_CONTRACT.policySha,
    })
    expect(canonicalSerialize(result.tuple)).toBe(
      '{"authorization_body_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","authorization_comment_id":"9001","base":"main","head":"d5f0d1edf86f0c0f94a4891558ae6fcea7bfb73f","operation":"task-bootstrap","operation_version":1,"parent_issue":262,"policy_path":"docs/mission-control/mission-control-guide.md","policy_sha":"f46f5de1d5ee17669c7c4663893164ffb835b339","policy_version":"1.3.0","protected_base_sha":"f6ac355b98aa281dda2a49bcf2ddaeb279d8173d","pull_request":263,"repository":"boat1994/bemoat-web-starter"}',
    )
    expect(result.requestId).toBe('mc-task-bootstrap-v1-a31107f39c003e07a26938cddc506fffdd46f5324bb06155820e4a3ea75dd37e')
  })

  it('preserves numeric coercion and rejects undefined or non-finite numeric tuple values', () => {
    expect(buildTaskBootstrapRequestIdentity({ ...REQUEST_INPUT, parentIssue: null, pullRequest: '' }).tuple).toMatchObject({
      parent_issue: 0,
      pull_request: 0,
    })

    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => buildTaskBootstrapRequestIdentity({ ...REQUEST_INPUT, parentIssue: value })).toThrow(
        'canonical payload cannot contain a non-finite number',
      )
    }
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

  it('keeps the authorization TypeScript owner after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-authorization.ts')
    expect(existsSync('scripts/mission-control/domain/task-bootstrap-authorization.mjs')).toBe(false)
    expect(Object.keys(typed).length).toBeGreaterThan(0)
  })

  it('keeps the request TypeScript owner after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-request.ts')
    expect(existsSync('scripts/mission-control/domain/task-bootstrap-request.mjs')).toBe(false)
    expect(Object.keys(typed).length).toBeGreaterThan(0)
  })

  it('keeps the preflight TypeScript owner after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-preflight.ts')
    expect(existsSync('scripts/mission-control/domain/task-bootstrap-preflight.mjs')).toBe(false)
    expect(Object.keys(typed).length).toBeGreaterThan(0)
  })

  it('preserves preflight input immutability and historical body conversion failures', () => {
    const issue = { number: 300, body: 'human-authored legacy task', extra: { untouched: true } }
    const snapshot = structuredClone(issue)

    expect(preflightCanonicalBootstrapTask({ issue })).toEqual({
      ok: true,
      reason: null,
      classification: null,
      evidence: { legacy: true },
    })
    expect(issue).toEqual(snapshot)
    expect(() => preflightCanonicalBootstrapTask({ issue: { body: { toString: () => { throw new TypeError('body conversion') } } } })).toThrowError('body conversion')
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
    expect(preflightCanonicalBootstrapTask({ issue: { number: 300, body }, pullRequest: { number: 263, headRefOid: BOOTSTRAP_CONTRACT.head, baseRefName: 'main' }, repository: BOOTSTRAP_CONTRACT.repository })).toEqual({
      ok: false,
      reason: 'provisional allocation is not a managed Task',
      classification: 'STATE_CONFLICT',
      evidence: null,
    })
    expect(runCanonicalManagedTaskPreflight({ issue: { number: 300, body }, pullRequest: { number: 263, headRefOid: BOOTSTRAP_CONTRACT.head, baseRefName: 'main' }, repository: BOOTSTRAP_CONTRACT.repository })).toEqual({
      ok: false,
      reason: 'managed state is missing or unreadable',
      classification: 'STATE_CONFLICT',
      evidence: null,
    })
  })

  it('preserves exact provisional rendering, parser permissiveness, marker pairing, and result reasons', () => {
    const renderInput = {
      requestId: `mc-task-bootstrap-v1-${'a'.repeat(64)}`,
      repository: BOOTSTRAP_CONTRACT.repository,
      parentIssue: '262',
      pullRequest: '263',
      base: BOOTSTRAP_CONTRACT.base,
      head: BOOTSTRAP_CONTRACT.head,
      protectedBaseSha: BOOTSTRAP_CONTRACT.protectedBaseSha,
      policyPath: BOOTSTRAP_CONTRACT.policySource,
      policyVersion: BOOTSTRAP_CONTRACT.policyVersion,
      policySha: BOOTSTRAP_CONTRACT.policySha,
    }
    const body = renderProvisionalTaskBody(renderInput)
    expect(body).toBe([
      PROVISIONAL_TASK_MARKER,
      '```json',
      '{',
      '  "schema_version": 1,',
      '  "status": "provisional",',
      `  "request_id": "${renderInput.requestId}",`,
      `  "repository": "${renderInput.repository}",`,
      '  "parent_issue": 262,',
      '  "pr": 263,',
      '  "base": "main",',
      `  "head": "${BOOTSTRAP_CONTRACT.head}",`,
      `  "protected_base_sha": "${BOOTSTRAP_CONTRACT.protectedBaseSha}",`,
      `  "policy_source": "${BOOTSTRAP_CONTRACT.policySource}",`,
      '  "policy_version": "1.3.0",',
      `  "policy_sha": "${BOOTSTRAP_CONTRACT.policySha}"`,
      '}',
      '```',
      PROVISIONAL_TASK_END,
      '',
      'This Issue is a recoverable provisional allocation. It is not a managed Task and must fail preflight until the signed canonical projection is complete.',
    ].join('\n'))

    expect(parseProvisionalTaskBody(`prefix\n${body}\nsuffix`)).toMatchObject({ present: true, valid: true, provisional: { parent_issue: 262, pr: 263 } })
    expect(parseProvisionalTaskBody(body.replace('"policy_sha":', '"extra": true,\n  "policy_sha":'))).toMatchObject({ present: true, valid: true, provisional: { extra: true } })
    expect(parseProvisionalTaskBody('')).toEqual({ present: false, valid: false, provisional: null })
    expect(parseProvisionalTaskBody(`${PROVISIONAL_TASK_MARKER}\n{}\n${PROVISIONAL_TASK_END}`)).toEqual({
      present: true,
      valid: false,
      reason: 'provisional allocation fields are invalid',
      provisional: null,
    })
    expect(parseProvisionalTaskBody(`${PROVISIONAL_TASK_MARKER}\n{\n${PROVISIONAL_TASK_END}`)).toEqual({
      present: true,
      valid: false,
      reason: "provisional allocation is not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
      provisional: null,
    })
    expect(parseProvisionalTaskBody(`${PROVISIONAL_TASK_MARKER}\n{}\n${PROVISIONAL_TASK_END}\n${PROVISIONAL_TASK_END}`)).toEqual({
      present: true,
      valid: false,
      reason: 'provisional marker pair is unbalanced',
      provisional: null,
    })
    expect(parseProvisionalTaskBody(`${PROVISIONAL_TASK_MARKER}\n${PROVISIONAL_TASK_MARKER}\n{}\n${PROVISIONAL_TASK_END}`)).toEqual({
      present: true,
      valid: false,
      reason: 'provisional marker pair is unbalanced',
      provisional: null,
    })
    expect(parseProvisionalTaskBody(`${PROVISIONAL_TASK_END}\n{}\n${PROVISIONAL_TASK_MARKER}`)).toEqual({
      present: true,
      valid: false,
      reason: 'provisional marker pair is unbalanced',
      provisional: null,
    })
  })

  it('keeps request and provisional helpers pure and non-mutating', () => {
    const requestInput = structuredClone(REQUEST_INPUT)
    const before = structuredClone(requestInput)
    const body = renderProvisionalTaskBody({
      requestId: `mc-task-bootstrap-v1-${'c'.repeat(64)}`,
      repository: requestInput.repository,
      parentIssue: requestInput.parentIssue,
      pullRequest: requestInput.pullRequest,
      base: requestInput.base,
      head: requestInput.head,
      protectedBaseSha: requestInput.protectedBaseSha,
      policyPath: requestInput.policyPath,
      policyVersion: requestInput.policyVersion,
      policySha: requestInput.policySha,
    })
    buildTaskBootstrapRequestIdentity(requestInput)
    parseProvisionalTaskBody(body)
    expect(requestInput).toEqual(before)
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
