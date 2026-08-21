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
      return { id: '5365740286', body: postedBody, user: { login: context.founderLogin }, issue_number: context.issueNumber }
    },
    readComment: async (id: string) => ({
      id,
      body: id === '5365740285' ? body : receiptBody,
      user: { login: context.founderLogin },
      issue_number: context.issueNumber,
    }),
  }
}

describe('Issue #380 raw issue-comment identity characterization', () => {
  it('recovers the immutable partial authorization from a correct repository and Issue URL', async () => {
    let posts = 0
    const result = await recordFounderAuthorization(recordingOptions(historicalComment(), () => { posts += 1 }) as any)

    expect(result.classification).toBe('SUCCESS')
    expect(result.commentId).toBe('5365740285')
    expect(posts).toBe(1)
  })

  it.each([
    ['correct repository, wrong Issue', { issue_url: `https://api.github.com/repos/${context.repository}/issues/381`, issue_number: 380 }],
    ['wrong repository, same Issue number', { issue_url: 'https://api.github.com/repos/other/repository/issues/380', issue_number: 380 }],
    ['missing issue identity', { issue_url: undefined, issue_number: null }],
    ['malformed issue URL', { issue_url: 'not-a-github-issue-url', issue_number: 380 }],
    ['conflicting identity sources', { issue_url: issueUrl, issue_number: 381 }],
  ])('fails closed for %s without posting a receipt', async (_name, identity) => {
    let posts = 0
    const historical = historicalComment(identity)
    const snapshot = JSON.stringify(historical)

    await expect(recordFounderAuthorization(recordingOptions(historical, () => { posts += 1 }) as any))
      .rejects.toMatchObject({ classification: 'EVIDENCE_CONFLICT', mutationPerformed: false })

    expect(posts).toBe(0)
    expect(JSON.stringify(historical)).toBe(snapshot)
  })
})
