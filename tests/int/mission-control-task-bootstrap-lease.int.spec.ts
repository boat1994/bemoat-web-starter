import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  LEASE_MARKER,
  createTaskBootstrapLeaseProtocol,
  parseLeaseComment,
  workflowLeaseBody,
} from '../../scripts/mission-control/domain/task-bootstrap-lease.mjs'

const ISSUE = 300
const SCOPE = 'task-bootstrap-projection'

type LeaseComment = { id: string | number, body: string }
type ReadLeaseComments = (issueNumber: number) => Promise<LeaseComment[]>
type PostLeaseComment = (issueNumber: number, body: string) => Promise<LeaseComment>
type LeaseProtocolDependencies = {
  readComments: ReadLeaseComments
  postComment: PostLeaseComment
  now?: () => number
}

function leaseComment(id: string, { scope = SCOPE, requestId, status = 'held', token }: {
  scope?: string
  requestId: string
  status?: string
  token: string
}) {
  return {
    id,
    body: workflowLeaseBody({ scope, requestId, status, leaseToken: token, issueNumber: ISSUE }),
  }
}

function harness(initialComments: LeaseComment[] = [], hooks: {
  afterPost?: (comment: LeaseComment, comments: LeaseComment[]) => void
} = {}) {
  const comments = [...initialComments]
  const posts: Array<{ issueNumber: number, body: string }> = []
  let nextId = 1
  const dependencies: LeaseProtocolDependencies = {
    readComments: async (_issueNumber) => comments,
    postComment: async (issueNumber, body) => {
      const comment = { id: `posted-${nextId++}`, body }
      posts.push({ issueNumber, body })
      comments.push(comment)
      hooks.afterPost?.(comment, comments)
      return comment
    },
  }
  const protocol = createTaskBootstrapLeaseProtocol({
    ...dependencies,
    now: () => 1700000000000,
    randomBytes: () => Buffer.from('0123456789abcdef', 'hex'),
  })
  return { comments, posts, protocol }
}

describe('task bootstrap Issue-only lease domain', () => {
  it('keeps GitHub transport in the adapter and lease decisions in the domain module', () => {
    const adapter = readFileSync('scripts/mission-control/adapters/task-bootstrap-github.mjs', 'utf8')
    expect(adapter).toContain("from '../domain/task-bootstrap-lease.mjs'")
    expect(adapter).toContain('createTaskBootstrapLeaseProtocol({ readComments: getIssueComments, postComment })')
    expect(adapter).not.toMatch(/async function acquireLease\(/)
    expect(adapter).not.toMatch(/async function releaseLease\(/)
    expect(adapter).not.toMatch(/function workflowLeaseBody\(/)
  })

  it('parses only the canonical lease marker and body shape', () => {
    const comment = leaseComment('lease-1', { requestId: 'request-a', token: 'token-a' })
    expect(LEASE_MARKER).toContain('task-bootstrap-lease:v1')
    expect(parseLeaseComment(comment)).toMatchObject({
      schema_version: 1,
      scope: SCOPE,
      issue_number: ISSUE,
      request_id: 'request-a',
      status: 'held',
      token: 'token-a',
      commentId: 'lease-1',
    })
    expect(parseLeaseComment({ id: 'not-a-lease', body: 'ordinary Issue comment' })).toBeNull()
    expect(parseLeaseComment({
      id: 'invalid-status',
      body: workflowLeaseBody({ scope: SCOPE, requestId: 'request-a', status: 'unknown', leaseToken: 'token-a', issueNumber: ISSUE }),
    })).toBeNull()
  })

  it('fails closed when a competing holder is already active for the same Issue and scope', async () => {
    const { protocol, posts } = harness([leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })])

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-b', scope: SCOPE }))
      .rejects.toMatchObject({ code: 'CAS_CONFLICT' })
    expect(posts).toHaveLength(0)
  })

  it('reuses the held token for the same deterministic request without posting again', async () => {
    const { protocol, posts } = harness([leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })])

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE }))
      .resolves.toEqual({ token: 'token-a', commentId: 'lease-a' })
    expect(posts).toHaveLength(0)
  })

  it('requires the posted lease to be the sole winner in the final reread', async () => {
    const { protocol, posts } = harness([], {
      afterPost: (_comment, comments) => {
        comments.push(leaseComment('competing', { requestId: 'request-b', token: 'token-b' }))
      },
    })

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE }))
      .rejects.toMatchObject({ code: 'CAS_CONFLICT' })
    expect(posts).toHaveLength(1)
  })

  it('does not authorize a writer when the final reread is ambiguous', async () => {
    const comments: Array<{ id: string, body: string }> = []
    let reads = 0
    const posts: string[] = []
    const readComments: ReadLeaseComments = async (_issueNumber) => {
      reads += 1
      if (reads === 2) throw Object.assign(new Error('comment read timed out'), { code: 'API_AMBIGUITY' })
      return comments
    }
    const postComment: PostLeaseComment = async (_issueNumber, body) => {
      posts.push(body)
      const comment = { id: 'posted-1', body }
      comments.push(comment)
      return comment
    }
    const dependencies: LeaseProtocolDependencies = { readComments, postComment, now: () => 1700000000000 }
    const protocol = createTaskBootstrapLeaseProtocol(dependencies)

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE }))
      .rejects.toMatchObject({ code: 'API_AMBIGUITY' })
    expect(posts).toHaveLength(1)
  })

  it('releases only the currently held token for the same request and scope', async () => {
    const { protocol, posts } = harness([leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })])

    await expect(protocol.releaseLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE, lease: { token: 'wrong-token' } }))
      .rejects.toMatchObject({ code: 'CAS_CONFLICT' })
    expect(posts).toHaveLength(0)

    await protocol.releaseLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE, lease: { token: 'token-a' } })
    expect(posts).toHaveLength(1)
    expect(parseLeaseComment({ id: 'released', body: posts[0].body })).toMatchObject({ status: 'released', token: 'token-a' })
  })

  it('keeps scopes and request identities isolated', async () => {
    const { protocol, posts } = harness([leaseComment('lease-a', { scope: 'scope-a', requestId: 'request-a', token: 'token-a' })])

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: 'scope-b' }))
      .resolves.toMatchObject({ token: `scope-b:request-a:1700000000000:0123456789abcdef` })
    expect(posts).toHaveLength(1)
  })
})
