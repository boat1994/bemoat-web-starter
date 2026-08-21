/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  buildExistingTaskAuthorizationBody,
  recordFounderAuthorization,
} from '../../scripts/mission-control/domain/founder-authorization-recording.ts'
import { buildFounderAuthorizationReceiptBody } from '../../scripts/mission-control/domain/founder-authorization-receipt.ts'

const context = {
  repository: 'boat1994/bemoat-web-starter',
  issueNumber: 380,
  protectedBaseSha: '114ec8dbe8aecc65276a2426e655ee544d72aad3',
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: '56443e2b8e07b8d8325d6b5fdef7b49f305b1e1f',
  policySourceCommit: '114ec8dbe8aecc65276a2426e655ee544d72aad3',
  founderLogin: 'boat1994',
}

const issueUrl = `https://api.github.com/repos/${context.repository}/issues/${context.issueNumber}`
const body = buildExistingTaskAuthorizationBody(context)
const bodySha256 = createHash('sha256').update(body).digest('hex')

if (bodySha256 !== '67c6349033062b03a430e856c6f07a0fc41537c560a32bd417212714f10b77b9') {
  throw new Error(`historical authorization fixture changed: ${bodySha256}`)
}

type Comment = Record<string, unknown>

function historicalComment(overrides: Comment = {}): Comment {
  return {
    id: '5365740285',
    body,
    user: { login: context.founderLogin },
    issue_number: null,
    issue_url: issueUrl,
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...overrides,
  }
}

function recordingOptions(comment: Comment, onPost: (postedBody: string) => void = () => {}) {
  const receiptBody = buildFounderAuthorizationReceiptBody({
    ...context,
    authorizationCommentId: '5365740285',
    authorizationBodySha256: bodySha256,
  })
  return {
    context,
    acquireLease: async () => ({ token: 'test-token' }),
    releaseLease: async () => {},
    readComments: async () => [comment],
    postComment: async (_issueNumber: number, postedBody: string) => {
      onPost(postedBody)
      return { id: '5365740286', body: postedBody, user: { login: context.founderLogin }, issue_number: null as number | null, issue_url: issueUrl }
    },
    readComment: async (id: string) => id === '5365740285'
      ? comment
      : { id, body: receiptBody, user: { login: context.founderLogin }, issue_number: null, issue_url: issueUrl },
  }
}

describe('Issue #380 raw issue-comment identity characterization', () => {
  it('recovers the immutable partial authorization from a correct repository and Issue URL', async () => {
    const historical = historicalComment()
    const snapshot = JSON.stringify(historical)
    const postedBodies: string[] = []
    const result = await recordFounderAuthorization(recordingOptions(historical, (postedBody) => { postedBodies.push(postedBody) }) as any)

    expect(result.classification).toBe('SUCCESS')
    expect(result.commentId).toBe('5365740285')
    expect(postedBodies).toEqual([buildFounderAuthorizationReceiptBody({
      ...context,
      authorizationCommentId: '5365740285',
      authorizationBodySha256: bodySha256,
    })])
    expect(JSON.parse(postedBodies[0])).toMatchObject({
      receipt_format: 'task-bootstrap-existing-receipt-v1',
      repository: context.repository,
      issue_number: context.issueNumber,
      authorization_comment_id: '5365740285',
      authorization_body_sha256: bodySha256,
      founder_login: context.founderLogin,
    })
    expect(JSON.stringify(historical)).toBe(snapshot)
  })

  it('fails closed before creating a receipt when trusted context drifts after partial authorization readback', async () => {
    const historical = historicalComment()
    let posts = 0

    await expect(recordFounderAuthorization({
      ...recordingOptions(historical, () => { posts += 1 }),
      readContext: async () => ({ ...context, protectedBaseSha: 'a'.repeat(40) }),
    } as any)).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })

    expect(posts).toBe(0)
  })

  it('creates one receipt for the live partial authorization and returns its retry as a canonical no-op', async () => {
    const historical = historicalComment()
    const snapshot = JSON.stringify(historical)
    const comments: Comment[] = [historical]
    const postedBodies: string[] = []
    const receiptBody = buildFounderAuthorizationReceiptBody({
      ...context,
      authorizationCommentId: '5365740285',
      authorizationBodySha256: bodySha256,
    })
    const options = {
      context,
      acquireLease: async () => ({ token: 'test-token' }),
      releaseLease: async () => {},
      readContext: async () => context,
      readComments: async () => comments,
      postComment: async (_issueNumber: number, postedBody: string) => {
        postedBodies.push(postedBody)
        const posted = {
          id: '5365740286', body: postedBody, user: { login: context.founderLogin },
          issue_number: null as null, issue_url: issueUrl,
        }
        comments.push(posted)
        return posted
      },
      readComment: async (id: string) => {
        const found = comments.find((comment) => String(comment.id) === id)
        if (!found) throw new Error(`missing comment ${id}`)
        return found
      },
    }

    const first = await recordFounderAuthorization(options as any)
    const retry = await recordFounderAuthorization(options as any)

    expect(first).toMatchObject({
      classification: 'SUCCESS', commentId: '5365740285', receiptId: '5365740286',
      bodySha256, receiptBody, mutationPerformed: true,
    })
    expect(retry).toEqual({ ...first, classification: 'NO_OP_IDENTICAL_RETRY', mutationPerformed: false })
    expect(postedBodies).toEqual([receiptBody])
    expect(JSON.stringify(historical)).toBe(snapshot)
  })

  it('rejects a competing current authorization without creating a receipt', async () => {
    const historical = historicalComment()
    let posts = 0

    await expect(recordFounderAuthorization({
      ...recordingOptions(historical, () => { posts += 1 }),
      readComments: async () => [historical, historicalComment({ id: '5365740287', body: `${body}\n` })],
    } as any)).rejects.toMatchObject({ classification: 'STATE_CONFLICT', mutationPerformed: false })

    expect(posts).toBe(0)
  })

  it.each([
    ['correct repository, wrong Issue', { issue_url: `https://api.github.com/repos/${context.repository}/issues/381`, issue_number: null }],
    ['wrong repository, same Issue number', { issue_url: 'https://api.github.com/repos/other/repository/issues/380', issue_number: null }],
    ['missing issue identity', { issue_url: undefined, issue_number: null }],
    ['malformed issue URL', { issue_url: 'not-a-github-issue-url', issue_number: null }],
    ['issue URL with an empty path segment', { issue_url: `https://api.github.com/repos//${context.repository}/issues/${context.issueNumber}`, issue_number: null }],
    ['issue URL with a duplicate path segment', { issue_url: `https://api.github.com/repos/boat1994//bemoat-web-starter/issues/${context.issueNumber}`, issue_number: null }],
    ['numeric-looking issue number corroboration', { issue_url: issueUrl, issue_number: String(context.issueNumber) }],
    ['conflicting identity sources', { issue_url: issueUrl, issue_number: 381 }],
  ])('fails closed for %s without posting a receipt', async (_name, identity) => {
    let posts = 0
    const historical = historicalComment(identity)
    const snapshot = JSON.stringify(historical)

    await expect(recordFounderAuthorization(recordingOptions(historical, () => { posts += 1 }) as any)).rejects.toBeDefined()

    expect(posts).toBe(0)
    expect(JSON.stringify(historical)).toBe(snapshot)
  })
})
