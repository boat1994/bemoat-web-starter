import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  LEASE_MARKER,
  createTaskBootstrapLeaseProtocol,
  parseLeaseComment,
  workflowLeaseBody,
} from '../../scripts/mission-control/domain/task-bootstrap-lease.ts'
import { createTaskBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'

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

const createLegacyGithubAdapter = createTaskBootstrapGithubAdapter as unknown as (options: {
  repository: string
  runGh: (...args: never[]) => unknown
}) => ReturnType<typeof createTaskBootstrapGithubAdapter>

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
  it('keeps the typed lease implementation after facade removal', async () => {
    const { existsSync } = await import('node:fs')
    const typed = await import('../../scripts/mission-control/domain/task-bootstrap-lease.ts')

    expect(existsSync('scripts/mission-control/domain/task-bootstrap-lease.mjs')).toBe(false)
    expect(Object.keys(typed).length).toBeGreaterThan(0)
  })

  it('keeps GitHub transport in the adapter and lease decisions in the domain module', () => {
    const adapter = readFileSync('scripts/mission-control/adapters/task-bootstrap-github.mjs', 'utf8')
    expect(adapter).toContain("from '../domain/task-bootstrap-lease.ts'")
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

  it('preserves marker presence, permissive fields, and JSON serialization edge behavior', () => {
    const validJson = JSON.stringify({
      schema_version: 1,
      scope: SCOPE,
      issue_number: 'not-a-number',
      request_id: 'request-a',
      status: 'held',
      token: 'token-a',
      observed_body_sha256: { legacy: true },
      commentId: 'payload-comment-id',
      unknown_key: 'preserved',
    })
    const validBody = [LEASE_MARKER, '```json', validJson, '```', '<!-- wrong end -->'].join('\n')
    expect(parseLeaseComment({ id: 'actual-comment-id', body: validBody })).toBeNull()

    const withoutEnd = validBody.replace('\n```\n<!-- wrong end -->', '')
    expect(parseLeaseComment({ id: 'actual-comment-id', body: withoutEnd })).toMatchObject({
      issue_number: 'not-a-number',
      observed_body_sha256: { legacy: true },
      unknown_key: 'preserved',
      commentId: 'actual-comment-id',
    })
    expect(parseLeaseComment({ id: 'missing-start', body: '<!-- bemoat-mission-control-task-bootstrap-lease:end -->' })).toBeNull()

    for (const [key, value] of [['scope', 0], ['request_id', false], ['token', '']] as const) {
      const fields = { schema_version: 1, scope: SCOPE, request_id: 'request-a', status: 'held', token: 'token-a', [key]: value }
      const body = [LEASE_MARKER, '```json', JSON.stringify(fields), '```'].join('\n')
      expect(parseLeaseComment({ id: `falsy-${key}`, body })).toBeNull()
    }

    const permissive = { schema_version: 1, scope: 42, request_id: { legacy: true }, status: 'released', token: ['legacy-token'] }
    expect(parseLeaseComment({ id: 'truthy-non-strings', body: [LEASE_MARKER, '```json', JSON.stringify(permissive), '```'].join('\n') })).toMatchObject(permissive)

    const serialized = workflowLeaseBody({ scope: undefined, requestId: undefined, status: undefined, leaseToken: undefined, issueNumber: 'not-a-number' })
    expect(serialized).toContain('"issue_number":null')
    expect(serialized).toContain('"observed_body_sha256":null')
    expect(serialized).not.toContain('"scope"')
    expect(serialized).not.toContain('"request_id"')
    expect(serialized).not.toContain('"status"')
    expect(serialized).not.toContain('"token"')
  })

  it('classifies malformed marked evidence as the same CAS conflict', async () => {
    const malformed = { id: 'malformed', body: `${LEASE_MARKER}\nnot-json` }
    const { protocol } = harness([malformed])

    await expect(protocol.readHeldLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE }))
      .rejects.toMatchObject({ code: 'CAS_CONFLICT', classification: 'CAS_CONFLICT' })
  })

  it('classifies non-array lease reads as API ambiguity', async () => {
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => ({ legacy: 'not-an-array' }),
      postComment: async (_issueNumber, body) => ({ id: 'unexpected', body }),
    })

    await expect(protocol.readLatestLease({ issueNumber: ISSUE, scope: SCOPE }))
      .rejects.toMatchObject({ code: 'API_AMBIGUITY', classification: 'API_AMBIGUITY' })
  })

  it('preserves adapter ambiguity, not-found, and null-payload classifications', async () => {
    const invalidJsonAdapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: () => 'not-json',
    })
    await expect(invalidJsonAdapter.getIssueComments(ISSUE)).rejects.toMatchObject({ code: 'API_AMBIGUITY' })

    const notFoundAdapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: () => { throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' }) },
    })
    await expect(notFoundAdapter.getIssue(ISSUE)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const nullCommentAdapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: () => '[null]',
    })
    await expect(nullCommentAdapter.getIssueComments(ISSUE)).rejects.toSatisfy((error: unknown) => {
      return error instanceof TypeError && !('code' in error) && !('classification' in error)
    })
  })

  it('binds policy sourceCommit to the caller-supplied live main SHA in current mode', async () => {
    const liveMainSha = 'a'.repeat(40)
    const calls: string[][] = []
    const adapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: (...args: never[]) => {
        calls.push(args[0] as unknown as string[])
        return JSON.stringify({ content: Buffer.from('version: 1.3.0\n').toString('base64'), sha: 'policy-blob' })
      },
    })
    await expect(adapter.getPolicy({ ref: liveMainSha, path: 'docs/mission-control/mission-control-guide.md', sourceCommit: liveMainSha }))
      .resolves.toMatchObject({ sourceCommit: liveMainSha })
    expect(calls[0]).toEqual(['api', `repos/boat1994/bemoat-web-starter/contents/docs/mission-control/mission-control-guide.md?ref=${liveMainSha}`])
  })

  it('does not inject obsolete bootstrap policy sourceCommit defaults', async () => {
    const adapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: () => JSON.stringify({ content: Buffer.from('version: 1.3.0\n').toString('base64'), sha: 'policy-blob' }),
    })
    await expect(adapter.getPolicy({ ref: 'main', path: 'docs/mission-control/mission-control-guide.md' }))
      .resolves.toMatchObject({ sourceCommit: null })
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
    expect(posts).toHaveLength(2)
    expect(parseLeaseComment({ id: 'released', body: posts[1].body })).toMatchObject({ status: 'released', request_id: 'request-a' })
  })

  it('releases every concurrent loser lease so a later retry can acquire', async () => {
    const comments: LeaseComment[] = []
    const posts: LeaseComment[] = []
    let initialReads = 0
    let resolveInitial!: () => void
    let resolveFinal!: () => void
    const initialBarrier = new Promise<void>((resolve) => { resolveInitial = resolve })
    const finalBarrier = new Promise<void>((resolve) => { resolveFinal = resolve })
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => {
        if (initialReads < 2) {
          initialReads += 1
          if (initialReads === 2) resolveInitial()
          await initialBarrier
        }
        return comments
      },
      postComment: async (_issueNumber, body) => {
        const comment = { id: `posted-${posts.length + 1}`, body }
        posts.push(comment)
        comments.push(comment)
        if (posts.filter((entry) => parseLeaseComment(entry)?.status === 'held').length === 2) resolveFinal()
        if (posts.filter((entry) => parseLeaseComment(entry)?.status === 'held').length <= 2) await finalBarrier
        return comment
      },
      now: () => 1700000000000,
      randomBytes: () => Buffer.from('0123456789abcdef', 'hex'),
    })

    const results = await Promise.allSettled([
      protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE }),
      protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-b', scope: SCOPE }),
    ])
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    const latest = new Map<string, ReturnType<typeof parseLeaseComment>>()
    for (const comment of comments) {
      const parsed = parseLeaseComment(comment)
      if (parsed) latest.set(String(parsed.request_id), parsed)
    }
    expect([...latest.values()].every((lease) => lease?.status === 'released')).toBe(true)
    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-c', scope: SCOPE })).resolves.toMatchObject({ token: expect.any(String) })
  })

  it('proves acquire with GET, POST, and a final GET readback', async () => {
    const sequence: string[] = []
    const comments: LeaseComment[] = []
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => { sequence.push('GET'); return comments },
      postComment: async (issueNumber, body) => {
        sequence.push('POST')
        const comment = { id: 'posted-1', body }
        comments.push(comment)
        return comment
      },
      now: () => 1700000000000,
      randomBytes: () => Buffer.from('0123456789abcdef', 'hex'),
    })

    await protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE })
    expect(sequence).toEqual(['GET', 'POST', 'GET'])
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

  it('keeps the lease release path at GET, GET, POST with token binding', async () => {
    const calls: string[] = []
    const comments: LeaseComment[] = [leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })]
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => { calls.push('GET'); return comments },
      postComment: async (issueNumber, body) => {
        calls.push('POST')
        const comment = { id: 'released', body }
        comments.push(comment)
        return comment
      },
    })

    const held = await protocol.readHeldLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE })
    await protocol.releaseLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE, lease: held })
    expect(calls).toEqual(['GET', 'GET', 'POST', 'GET'])

    const tokenBoundProtocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => comments,
      postComment: async (_issueNumber, body) => {
        const comment = { id: 'unexpected', body }
        comments.push(comment)
        return comment
      },
    })
    await expect(tokenBoundProtocol.releaseLease({
      issueNumber: ISSUE,
      requestId: 'request-a',
      scope: SCOPE,
      lease: { token: 'wrong-token' },
    })).rejects.toMatchObject({ code: 'CAS_CONFLICT' })
  })

  it('does not claim a release succeeded when the release POST response is lost after commit', async () => {
    const comments: LeaseComment[] = [leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })]
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => comments,
      postComment: async (_issueNumber, body) => {
        comments.push({ id: 'released', body })
        throw Object.assign(new Error('release response lost'), { code: 'API_AMBIGUITY' })
      },
    })

    await expect(protocol.releaseLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE, lease: { token: 'token-a' } }))
      .rejects.toMatchObject({ code: 'API_AMBIGUITY' })
    expect(parseLeaseComment(comments.at(-1))).toMatchObject({ status: 'released', request_id: 'request-a', token: 'token-a' })
  })

  it('requires the released marker to appear in the post readback', async () => {
    const comments: LeaseComment[] = [leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })]
    const protocol = createTaskBootstrapLeaseProtocol({
      readComments: async () => comments,
      postComment: async (_issueNumber, body) => ({ id: 'released', body }),
    })

    await expect(protocol.releaseLease({ issueNumber: ISSUE, requestId: 'request-a', scope: SCOPE, lease: { token: 'token-a' } }))
      .rejects.toMatchObject({ code: 'CAS_CONFLICT' })
  })

  it('keeps the adapter issue-body lease store on the existing Issue-comment boundary', async () => {
    const comments: LeaseComment[] = [leaseComment('lease-a', { requestId: 'request-a', token: 'token-a' })]
    const adapter = createLegacyGithubAdapter({
      repository: 'boat1994/bemoat-web-starter',
      runGh: (args: string[], options: { input?: string } = {}) => {
        if (args[0] === 'api' && options.input) {
          const payload = JSON.parse(options.input) as { body: string }
          const comment = { id: 'released', body: payload.body }
          comments.push(comment)
          return JSON.stringify(comment)
        }
        return JSON.stringify(comments)
      },
    })
    const store = await adapter.issueBodyLeaseStore({ issueNumber: ISSUE })

    await store.write({
      content: { transition_identity: 'request-a', status: 'released', observed_body_sha256: null },
      sha: 'lease-a',
    })
    expect(comments.at(-1)?.id).toBe('released')
    await expect(store.write({
      content: { transition_identity: 'request-a', status: 'released', observed_body_sha256: null },
      sha: 'lease-a',
    })).rejects.toMatchObject({ code: 'CAS_CONFLICT' })
  })

  it('keeps scopes and request identities isolated', async () => {
    const { protocol, posts } = harness([leaseComment('lease-a', { scope: 'scope-a', requestId: 'request-a', token: 'token-a' })])

    await expect(protocol.acquireLease({ issueNumber: ISSUE, requestId: 'request-a', scope: 'scope-b' }))
      .resolves.toMatchObject({ token: `scope-b:request-a:1700000000000:0123456789abcdef` })
    expect(posts).toHaveLength(1)
  })
})
