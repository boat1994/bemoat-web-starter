/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  recordFounderAuthorization,
  buildExistingTaskAuthorizationBody,
} from '../../scripts/mission-control/domain/founder-authorization-recording.ts'
import {
  BOOTSTRAP_CONTRACT,
  parseFounderTaskBootstrapAuthorization,
  validateFounderTaskBootstrapAuthorization,
} from '../../scripts/mission-control/domain/task-bootstrap-authorization.ts'
import { buildFounderAuthorizationReceiptBody } from '../../scripts/mission-control/domain/founder-authorization-receipt.ts'
import { createTaskBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'
import { workflowLeaseBody } from '../../scripts/mission-control/domain/task-bootstrap-lease.ts'

const context = {
  repository: 'boat1994/bemoat-web-starter',
  issueNumber: 383,
  protectedBaseSha: 'a'.repeat(40),
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'b'.repeat(40),
  policySourceCommit: 'a'.repeat(40),
  founderLogin: 'boat1994',
}

type TestComment = {
  id: string
  body: string
  issue_number: number
  user: { login: string }
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

function comment(id: string, body: string, overrides: Record<string, unknown> = {}): TestComment {
  return {
    id,
    body,
    issue_number: context.issueNumber,
    user: { login: context.founderLogin },
    ...overrides,
  }
}

function receipt(id: string, authorizationId: string, body: string) {
  return comment(id, buildFounderAuthorizationReceiptBody({
    ...context,
    authorizationCommentId: authorizationId,
    authorizationBodySha256: createHash('sha256').update(body).digest('hex'),
  }))
}

const testLease = {
  acquireLease: async () => ({ token: 'test-token', commentId: 'lease-1' }),
  releaseLease: async () => {},
}

describe('Issue #383 immutable Founder authorization recording', () => {
  it('creates one final raw JSON body and binds the returned ID and exact body hash by readback', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const result = await recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async (): Promise<readonly Record<string, unknown>[]> => [],
      postComment: async (_issue, postedBody) => comment(postedBody === body ? '9001' : '9002', postedBody),
      readComment: async (id) => id === '9001' ? comment('9001', body) : receipt('9002', '9001', body),
    })

    expect(result).toMatchObject({
      classification: 'SUCCESS',
      commentId: '9001',
      bodySha256: createHash('sha256').update(body).digest('hex'),
      body,
    })
    expect(JSON.parse(body)).toMatchObject({
      authorization_format: 'task-bootstrap-existing-v2',
      comment_id: null,
      repository: context.repository,
      task_issue: context.issueNumber,
      protected_base_sha: context.protectedBaseSha,
    })
  })

  it('publishes a durable immutable receipt binding the authorization ID to its body hash', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const postedBodies: string[] = []
    const result = await recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => postedBodies.map((postedBody, index) => comment(String(9001 + index), postedBody)),
      postComment: async (_issue, postedBody) => {
        postedBodies.push(postedBody)
        return comment(String(9001 + postedBodies.length - 1), postedBody)
      },
      readComment: async (id) => comment(id, postedBodies[Number(id) - 9001]),
    })

    expect(result.receiptId).toBe('9002')
    expect(JSON.parse(postedBodies[1])).toMatchObject({
      receipt_format: 'task-bootstrap-existing-receipt-v1',
      authorization_comment_id: '9001',
      authorization_body_sha256: createHash('sha256').update(body).digest('hex'),
    })
  })

  it('does not classify a real task-bootstrap lease comment as Founder authorization evidence', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const result = await recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [{ id: 'lease-1', body: workflowLeaseBody({ scope: 'founder-authorization-recording', requestId: 'lease-request', status: 'held', leaseToken: 'lease-token', issueNumber: context.issueNumber }) }],
      postComment: async (_issue, postedBody) => comment(postedBody === body ? '9001' : '9002', postedBody),
      readComment: async (id) => id === '9001' ? comment('9001', body) : receipt('9002', '9001', body),
    })
    expect(result.classification).toBe('SUCCESS')
  })

  it('ignores live historical Founder decisions for managed bootstrap, merge, and Batch 1 repair', async () => {
    const comments: TestComment[] = [
      comment('5346289596', `FOUNDER_DECISION
Decision: APPROVE MANAGED STABILIZATION IMPLEMENTATION
Authority: Founder
Author: authenticated repository owner boat1994
Repository: boat1994/bemoat-web-starter
Task Issue: #380
Protected base: main@5538e8f74933209c195878f02a4b7a9191935cdd
Policy: docs/mission-control/mission-control-guide.md v1.3.0; blob 56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f
Scope: canonical managed bootstrap and bounded implementation of the stabilization batches defined in Issue #380
Action: authorize canonical managed bootstrap of Issue #380 and the bounded long-running implementation workflow defined by Issue #380`),
      comment('5350491198', `## FOUNDER_DECISION

**Decision:** APPROVE MERGE COMPLETION
**Authority:** Founder
**Author:** @boat1994
**Repository:** \`boat1994/bemoat-web-starter\`
**Task / Issue:** #380
**Action:** merge
**Scope:** merge
**Policy source SHA:** \`56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f\`
**Protected base SHA:** \`5538e8f74933209c195878f02a4b7a9191935cdd\`
**Non-superseded:** true`),
      comment('5350702619', `## FOUNDER_DECISION

**Decision:** APPROVE BOOTSTRAP RECOVERY BATCH 1
**Authority:** Founder
**Author:** @boat1994
**Repository:** boat1994/bemoat-web-starter
**Task / Issue:** #380
**Protected base:** main@35bdd8689c5ff52a5d51f98419ae498f0971090c
**Policy:** docs/mission-control/mission-control-guide.md
**Policy version:** 1.3.0
**Policy source SHA:** 56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f
**Scope:** bootstrap control-plane contract repair only
**Action:** implement and publish the bounded Bootstrap Recovery Batch 1 repair.
**Immutable comment reference:** true
**Non-superseded:** true`),
    ]
    const historicalBodies = comments.map(({ id, body: historicalBody }) => ({ id, body: historicalBody }))
    let nextId = 9101
    let posts = 0
    const result = await recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => comments,
      postComment: async (_issue, postedBody) => {
        posts += 1
        const posted = comment(String(nextId++), postedBody)
        comments.push(posted)
        return posted
      },
      readComment: async (id) => {
        const found = comments.find((entry) => entry.id === id)
        if (!found) throw new Error(`missing comment ${id}`)
        return found
      },
    })

    expect(result.classification).toBe('SUCCESS')
    expect(result.commentId).toBe('9101')
    expect(posts).toBe(2)
    expect(comments.slice(0, 3).map(({ id, body: historicalBody }) => ({ id, body: historicalBody }))).toEqual(historicalBodies)
  })

  it('requires the POST response ID and individual readback ID to match', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async (_issue, postedBody) => comment('9001', postedBody),
      readComment: async () => comment('9002', body),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: true })
  })

  it.each([
    ['policy path', { policySource: 'docs/other.md' }],
    ['policy version', { policyVersion: '9.9.9' }],
    ['policy blob SHA format', { policySha: 'B'.repeat(40) }],
    ['protected main SHA format', { protectedBaseSha: 'A'.repeat(40) }],
    ['policy source commit', { policySourceCommit: 'c'.repeat(40) }],
  ])('rejects invalid %s identity before building or posting authority', async (_name, override) => {
    let posts = 0
    await expect(recordFounderAuthorization({
      context: { ...context, ...override },
      ...testLease,
      readComments: async () => [],
      postComment: async (_issue, postedBody) => { posts += 1; return comment('9001', postedBody) },
      readComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('returns an identical retry without posting a duplicate', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    const result = await recordFounderAuthorization({
      context,
      readComments: async () => [comment('9001', body), receipt('9002', '9001', body)],
      postComment: async () => { posts += 1; return comment('9002', body) },
      readComment: async (id) => id === '9001' ? comment('9001', body) : receipt('9002', '9001', body),
      acquireLease: async () => ({ token: 't', commentId: 'lease-1' }),
      releaseLease: async () => {},
    })

    expect(result.classification).toBe('NO_OP_IDENTICAL_RETRY')
    expect(result.commentId).toBe('9001')
    expect(posts).toBe(0)
  })

  it('recovers an existing authorization by posting only its missing receipt', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    const result = await recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body)],
      postComment: async (_issue, postedBody) => { posts += 1; return comment('9002', postedBody) },
      readComment: async (id) => id === '9001' ? comment('9001', body) : receipt('9002', '9001', body),
    })
    expect(result.classification).toBe('SUCCESS')
    expect(result.commentId).toBe('9001')
    expect(result.receiptId).toBe('9002')
    expect(posts).toBe(1)
  })

  it('fails closed for a receipt with the wrong body hash or authorization comment ID', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const wrongHash = comment('9002', buildFounderAuthorizationReceiptBody({
      ...context, authorizationCommentId: '9001', authorizationBodySha256: '0'.repeat(64),
    }))
    const wrongId = comment('9003', buildFounderAuthorizationReceiptBody({
      ...context, authorizationCommentId: '9999', authorizationBodySha256: createHash('sha256').update(body).digest('hex'),
    }))
    for (const conflictingReceipt of [wrongHash, wrongId]) {
      let posts = 0
      await expect(recordFounderAuthorization({
        context,
        ...testLease,
        readComments: async () => [comment('9001', body), conflictingReceipt],
        postComment: async (_issue, postedBody) => { posts += 1; return comment('9010', postedBody) },
        readComment: async () => comment('9001', body),
      })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
      expect(posts).toBe(0)
    }
  })

  it('fails closed for a post-creation-mutated authorization snapshot without updating it', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body, { created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:01:00Z' })],
      postComment: async (_issue, postedBody) => { posts += 1; return comment('9002', postedBody) },
      readComment: async () => comment('9001', body, { created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:01:00Z' }),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('fails closed for a post-creation-mutated receipt snapshot without updating it', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const mutatedReceipt = receipt('9002', '9001', body)
    mutatedReceipt.created_at = '2026-08-20T10:00:00Z'
    mutatedReceipt.updated_at = '2026-08-20T10:01:00Z'
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body), mutatedReceipt],
      postComment: async (_issue, postedBody) => { posts += 1; return comment('9003', postedBody) },
      readComment: async (id) => id === '9001' ? comment('9001', body) : mutatedReceipt,
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('fails closed when receipt publication is uncertain and never edits the authorization', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    let edits = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body)],
      postComment: async () => { posts += 1; throw Object.assign(new Error('timeout'), { code: 'API_AMBIGUITY' }) },
      readComment: async () => comment('9001', body),
      updateComment: async () => { edits += 1 },
    } as any)).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT', mutationPerformed: true })
    expect(posts).toBe(1)
    expect(edits).toBe(0)
  })

  it('fails closed when identical replay readback returns a different comment ID', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      readComments: async () => [comment('9001', body)],
      postComment: async () => { posts += 1; return comment('9002', body) },
      readComment: async () => comment('9002', body),
      ...testLease,
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('preserves deterministic CAS lease contention as STATE_CONFLICT', async () => {
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      acquireLease: async () => { throw Object.assign(new Error('lease CAS lost'), { code: 'CAS_CONFLICT' }) },
      readComments: async () => [],
      postComment: async () => { throw new Error('must not post') },
      readComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
  })

  it('allows only one concurrent SUCCESS through the injected lease winner', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let held = false
    let posts = 0
    const options = {
      context,
      readComments: async (): Promise<readonly Record<string, unknown>[]> => [],
      postComment: async (_issue: number, postedBody: string) => { posts += 1; return comment(postedBody === body ? '9001' : '9002', postedBody) },
      readComment: async (id: string) => id === '9001' ? comment(id, body) : receipt(id, '9001', body),
      acquireLease: async () => {
        if (held) throw Object.assign(new Error('lease winner already exists'), { classification: 'STATE_CONFLICT' })
        held = true
        return { token: 't', commentId: 'lease-1' }
      },
      releaseLease: async () => { held = false },
    }
    const results = await Promise.allSettled([recordFounderAuthorization(options), recordFounderAuthorization(options)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(posts).toBe(2)
  })

  it.each([
    ['missing returned ID', async (body: string) => ({ body })],
    ['wrong actor', async (body: string) => comment('9001', body, { user: { login: 'attacker' } })],
    ['wrong Issue', async (body: string) => comment('9001', body, { issue_number: 384 })],
    ['mismatched readback body', async (_body: string) => comment('9001', '{}')],
  ])('fails closed for %s', async (_name, postResult) => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async () => postResult(body),
      readComment: async () => comment('9001', body),
    })).rejects.toMatchObject({ classification: expect.stringMatching(/STATE_CONFLICT|AMBIGUOUS_RESULT/) })
  })

  it('fails closed when the POST succeeds but live readback is ambiguous', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async (_issue, postedBody) => comment(postedBody === body ? '9001' : '9002', postedBody),
      readComment: async () => { throw Object.assign(new Error('timeout'), { code: 'BLOCKED_EXTERNAL' }) },
    })).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT', mutationPerformed: true })
  })

  it('normalizes lease release failure after a successful POST', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async (_issue, postedBody) => comment(postedBody === body ? '9001' : '9002', postedBody),
      readComment: async (id) => id === '9001' ? comment('9001', body) : receipt('9002', '9001', body),
      releaseLease: async () => { throw Object.assign(new Error('lease release timeout'), { code: 'CAS_CONFLICT' }) },
    })).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT', mutationPerformed: true })
  })

  it('normalizes uncertain existing-comment reads before mutation', async () => {
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => { throw new Error('transport timeout') },
      postComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
      readComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
    })).rejects.toMatchObject({ classification: 'AMBIGUOUS_RESULT', mutationPerformed: false })
  })

  it('requires a present positive Issue binding on POST and readback', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async (_issue, postedBody) => ({ ...comment('9001', postedBody), issue_number: null }),
      readComment: async () => ({ id: '9001', body, user: { login: context.founderLogin } }),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT' })
  })

  it.each([
    ['malformed', '## FOUNDER_DECISION\n**Scope:** task-initialization'],
    ['plain Founder decision', 'FOUNDER_DECISION\nscope: task-initialization\naction: create-managed-task'],
    ['labeled authorization format', 'authorization_format: task-bootstrap-existing-v2'],
    ['labeled bundle kind', 'bundle_kind: task-bootstrap-existing'],
    ['wrong scope', JSON.stringify({ authorization_format: 'task-bootstrap-existing-v2', scope: 'merge', action: 'create-managed-task' })],
    ['wrong action', JSON.stringify({ authorization_format: 'task-bootstrap-existing-v2', scope: 'task-initialization', action: 'merge' })],
  ])('rejects %s authorization-shaped evidence before POST', async (_name, body) => {
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body)],
      postComment: async () => { posts += 1; return comment('9002', buildExistingTaskAuthorizationBody(context)) },
      readComment: async () => comment('9002', buildExistingTaskAuthorizationBody(context)),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('stops when trusted protected-base or policy evidence drifts before POST', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      readComment: async () => comment('9001', body),
      postComment: async () => comment('9001', body),
      readContext: async () => ({ ...context, protectedBaseSha: 'c'.repeat(40) }),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
  })

  it('preserves a deterministic trusted-context classification before POST', async () => {
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async () => { throw new Error('must not post') },
      readComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
      readContext: async () => { throw Object.assign(new Error('Founder authority changed'), { classification: 'AUTHORITY_CONFLICT' }) },
    })).rejects.toMatchObject({ classification: 'AUTHORITY_CONFLICT', mutationPerformed: false })
  })

  it('preserves the primary deterministic error when lease cleanup also fails', async () => {
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [],
      postComment: async () => { throw new Error('must not post') },
      readComment: async () => comment('9001', buildExistingTaskAuthorizationBody(context)),
      readContext: async () => { throw Object.assign(new Error('protected head changed'), { classification: 'HEAD_DRIFT' }) },
      releaseLease: async () => { throw Object.assign(new Error('lease release timeout'), { code: 'API_AMBIGUITY' }) },
    })).rejects.toMatchObject({ classification: 'HEAD_DRIFT', mutationPerformed: false })
  })

  it('does not mutate when conflicting actor evidence already exists', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body, { user: { login: 'attacker' } })],
      postComment: async () => { posts += 1; return comment('9002', body) },
      readComment: async () => comment('9002', body),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('fails closed when a later durable comment supersedes the authorization', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const superseder = JSON.stringify({ supersedes_comment_id: '9001' })
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body), comment('9002', superseder)],
      postComment: async () => { throw new Error('must not post') },
      readComment: async () => comment('9001', body),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
  })

  it('rejects malformed or conflicting pre-existing evidence without mutation', async () => {
    const body = buildExistingTaskAuthorizationBody(context)
    let posts = 0
    await expect(recordFounderAuthorization({
      context,
      ...testLease,
      readComments: async () => [comment('9001', body), comment('9002', body)],
      postComment: async () => { posts += 1; return comment('9003', body) },
      readComment: async () => comment('9001', body),
    })).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })
    expect(posts).toBe(0)
  })

  it('lets bootstrap consume the v2 body only when the caller-bound fetched ID matches', () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const authorization = parseFounderTaskBootstrapAuthorization(body)
    const expected = {
      ...BOOTSTRAP_CONTRACT,
      parentIssue: context.issueNumber,
      pullRequest: null,
      head: null,
      protectedBaseSha: context.protectedBaseSha,
      policySha: context.policySha,
      policyVersion: context.policyVersion,
    } as unknown as typeof BOOTSTRAP_CONTRACT
    const comment = {
      id: '9001', body, issue_number: context.issueNumber,
      user: { login: context.founderLogin },
    }
    expect(validateFounderTaskBootstrapAuthorization({
      authorization, authorizationComment: comment, parentIssue: { number: context.issueNumber },
      repository: context.repository, founderLogins: [context.founderLogin], parentComments: [comment, receipt('9002', '9001', body)], expected,
      boundCommentId: '9001',
    }).valid).toBe(true)
    expect(() => validateFounderTaskBootstrapAuthorization({
      authorization, authorizationComment: comment, parentIssue: { number: context.issueNumber },
      repository: context.repository, founderLogins: [context.founderLogin], parentComments: [comment], expected,
      boundCommentId: '9002',
    })).toThrow('Founder bootstrap authorization is invalid')
    expect(() => validateFounderTaskBootstrapAuthorization({
      authorization: { ...authorization, bundle_kind: 'task-bootstrap-genesis' }, authorizationComment: comment,
      parentIssue: { number: context.issueNumber }, repository: context.repository, founderLogins: [context.founderLogin],
      parentComments: [comment], expected, boundCommentId: '9001',
    })).toThrow('Founder bootstrap authorization is invalid')
  })

  it('rejects post-creation-mutated authorization and receipt snapshots during bootstrap readback', () => {
    const body = buildExistingTaskAuthorizationBody(context)
    const authorization = parseFounderTaskBootstrapAuthorization(body)
    const expected = {
      ...BOOTSTRAP_CONTRACT,
      parentIssue: context.issueNumber,
      pullRequest: null,
      head: null,
      protectedBaseSha: context.protectedBaseSha,
      policySha: context.policySha,
      policyVersion: context.policyVersion,
    } as unknown as typeof BOOTSTRAP_CONTRACT
    const authorizationComment = comment('9001', body, {
      created_at: '2026-08-20T10:00:00Z',
      updated_at: '2026-08-20T10:01:00Z',
    })
    const validReceipt = receipt('9002', '9001', body)
    expect(() => validateFounderTaskBootstrapAuthorization({
      authorization, authorizationComment, parentIssue: { number: context.issueNumber },
      repository: context.repository, founderLogins: [context.founderLogin], parentComments: [authorizationComment, validReceipt], expected,
      boundCommentId: '9001',
    })).toThrow('Founder bootstrap authorization is invalid')

    const mutatedReceipt = receipt('9002', '9001', body)
    mutatedReceipt.created_at = '2026-08-20T10:00:00Z'
    mutatedReceipt.updated_at = '2026-08-20T10:01:00Z'
    const cleanAuthorization = comment('9001', body)
    expect(() => validateFounderTaskBootstrapAuthorization({
      authorization, authorizationComment: cleanAuthorization, parentIssue: { number: context.issueNumber },
      repository: context.repository, founderLogins: [context.founderLogin], parentComments: [cleanAuthorization, mutatedReceipt], expected,
      boundCommentId: '9001',
    })).toThrow('Founder bootstrap authorization is invalid')
  })

  it('does not treat arbitrary process input as the Founder allowlist', async () => {
    const calls: string[][] = []
    const adapter = createTaskBootstrapGithubAdapter({
      repository: context.repository,
      env: {
        ...process.env,
        BEMOAT_FOUNDER_LOGINS: 'attacker',
      },
      runGh: ((args: string[]) => {
        calls.push(args)
        return JSON.stringify({ value: 'boat1994,second-founder' })
      }) as any,
    } as any)
    await expect(adapter.getFounderLogins()).resolves.toEqual(['boat1994', 'second-founder'])
    expect(calls[0]).toEqual(['api', `repos/${context.repository}/actions/variables/BEMOAT_FOUNDER_LOGINS`])
  })
})
