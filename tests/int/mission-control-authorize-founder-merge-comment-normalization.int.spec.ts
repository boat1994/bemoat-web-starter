import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createTaskBootstrapGithubAdapter } from '../../scripts/mission-control/adapters/task-bootstrap-github.mjs'
import {
  buildExistingMergeAuthorizationBody,
  recordFounderMergeAuthorization,
} from '../../scripts/mission-control/domain/founder-merge-authorization-recording.ts'

type AdapterComment = {
  id: number
  body: string
  issue_number: number | null
  issue_url: string
}

type CommentAdapter = {
  getIssueComments: (issueNumber: number) => Promise<AdapterComment[]>
  getIssueComment: (id: string | number) => Promise<AdapterComment>
  postIssueComment: (issueNumber: number, body: string) => Promise<AdapterComment>
}

const createTestAdapter = createTaskBootstrapGithubAdapter as unknown as (options: {
  repository: string
  runGh: (args: string[], options?: { input?: string }) => string
}) => CommentAdapter

const REPOSITORY = 'boat1994/bemoat-web-starter'
const AUTHORIZATION_ID = 5377691529
const REVIEW_VERDICT_ID = '5375263538'

const context = {
  repository: REPOSITORY,
  issueNumber: 395,
  prNumber: 396,
  exactHead: '42f69dbd37da70fc11b1606fa6d9f5e792f414dc',
  base: 'main',
  protectedBaseSha: 'baecd2df135bc2ffa6385b754d16375441671462',
  policySource: 'docs/mission-control/mission-control-guide.md',
  policyVersion: '1.3.0',
  policySha: 'de5d2c3ad25b483002b41ccb0beb0479f6c3ff4a',
  policySourceCommit: 'baecd2df135bc2ffa6385b754d16375441671462',
  reviewVerdictCommentId: REVIEW_VERDICT_ID,
  founderLogin: 'boat1994',
} as const

const LIVE_PARTIAL_AUTHORIZATION_BODY = `{
  "authorization_format": "merge-authorization-v1",
  "schema_version": 1,
  "status": "approved",
  "authority": "Founder",
  "author_login": "boat1994",
  "comment_id": null,
  "immutable_comment_reference": true,
  "non_superseded": true,
  "superseded_by": null,
  "repository": "boat1994/bemoat-web-starter",
  "bundle_kind": "merge-completion",
  "task_issue": 395,
  "pr": 396,
  "exact_head": "42f69dbd37da70fc11b1606fa6d9f5e792f414dc",
  "reviewed_head": "42f69dbd37da70fc11b1606fa6d9f5e792f414dc",
  "base": "main",
  "policy_source_sha": "de5d2c3ad25b483002b41ccb0beb0479f6c3ff4a",
  "protected_base_sha": "baecd2df135bc2ffa6385b754d16375441671462",
  "policy_version": "1.3.0",
  "policy_source": "docs/mission-control/mission-control-guide.md",
  "review_verdict_comment_id": "5375263538",
  "scope": "merge",
  "action": "merge"
}`

type RawRestComment = {
  id: number
  body: string
  user: { login: string }
  issue_url: string
  created_at: string
  updated_at: string
}

function issueUrl(issueNumber: number): string {
  return `https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`
}

function rawRestComment({
  id,
  body,
  issueNumber,
  createdAt = '2026-08-22T03:47:43Z',
  login = 'boat1994',
  issueUrlValue,
}: {
  id: number
  body: string
  issueNumber?: number
  createdAt?: string
  login?: string
  issueUrlValue?: string
}): RawRestComment {
  return {
    id,
    body,
    user: { login },
    issue_url: issueUrlValue ?? issueUrl(issueNumber ?? 395),
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function createRestGithub(initial: RawRestComment[] = []) {
  const comments = [...initial]
  const posts: Array<{ issueNumber: number; body: string }> = []
  let nextId = 9000

  const runGh = (args: string[], options: { input?: string } = {}) => {
    const path = args.find((arg) => arg.startsWith('repos/')) ?? ''
    if (args.includes('--paginate') && /\/issues\/(\d+)\/comments/.test(path)) {
      const pages = [comments.slice(0, Math.ceil(comments.length / 2) || comments.length)]
      if (comments.length > 1) pages.push(comments.slice(pages[0].length))
      return pages.map((page) => JSON.stringify(page)).join('\n')
    }
    if (args.includes('--method') && args.includes('POST') && /\/issues\/(\d+)\/comments$/.test(path)) {
      const issueNumber = Number(path.match(/\/issues\/(\d+)\/comments$/)?.[1])
      const body = JSON.parse(String(options.input ?? '{}')).body as string
      const comment = rawRestComment({ id: nextId++, body, issueNumber })
      comments.push(comment)
      posts.push({ issueNumber, body })
      return JSON.stringify(comment)
    }
    const commentMatch = path.match(/\/issues\/comments\/(\d+)$/)
    if (commentMatch && !args.includes('--method')) {
      const comment = comments.find((entry) => String(entry.id) === commentMatch[1])
      if (!comment) throw Object.assign(new Error('404 Not Found'), { code: 'NOT_FOUND' })
      return JSON.stringify(comment)
    }
    throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
  }

  const github = createTestAdapter({ repository: REPOSITORY, runGh })
  return { comments, posts, github }
}

function recordingThroughAdapter(github: CommentAdapter) {
  return {
    context,
    readComments: (): Promise<AdapterComment[]> => github.getIssueComments(context.issueNumber),
    postComment: (issueNumber: number, body: string): Promise<AdapterComment> => github.postIssueComment(issueNumber, body),
    readComment: (id: string): Promise<AdapterComment> => github.getIssueComment(id),
    acquireLease: async (): Promise<string> => 'lease',
    releaseLease: async (): Promise<null> => null,
  }
}

describe('authorize-founder merge recording comment normalization', () => {
  it('keeps the live #395 partial authorization body identical to the canonical builder', () => {
    expect(buildExistingMergeAuthorizationBody(context)).toBe(LIVE_PARTIAL_AUTHORIZATION_BODY)
  })

  it('normalizes a raw REST comment with issue_url for #395 to issue_number=395', async () => {
    const { github } = createRestGithub([
      rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
    ])
    const comment = await github.getIssueComment(AUTHORIZATION_ID)
    expect(comment).toMatchObject({
      id: AUTHORIZATION_ID,
      issue_number: 395,
      issue_url: issueUrl(395),
    })
    expect(comment).not.toHaveProperty('issue_number', null)
  })

  it('normalizes POST and direct readback through the same adapter boundary', async () => {
    const { github, posts } = createRestGithub()
    const posted = await github.postIssueComment(395, LIVE_PARTIAL_AUTHORIZATION_BODY)
    const readback = await github.getIssueComment(posted.id)
    expect(posts).toHaveLength(1)
    expect(posted.issue_number).toBe(395)
    expect(readback.issue_number).toBe(395)
    expect(readback.body).toBe(LIVE_PARTIAL_AUTHORIZATION_BODY)
    expect(readback.id).toBe(posted.id)
  })

  it('normalizes paginated Issue comment listing with the same issue_number representation', async () => {
    const { github } = createRestGithub([
      rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
      rawRestComment({ id: 111, body: 'ordinary comment', issueNumber: 395 }),
    ])
    const comments = await github.getIssueComments(395)
    expect(comments).toHaveLength(2)
    expect(comments.map((comment: { issue_number: unknown }) => comment.issue_number)).toEqual([395, 395])
  })

  it('resumes the 5377691529-shaped partial authorization by posting only the missing receipt', async () => {
    const { github, posts } = createRestGithub([
      rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
    ])
    const result = await recordFounderMergeAuthorization(recordingThroughAdapter(github))
    expect(result.classification).toBe('SUCCESS')
    expect(result.mutationPerformed).toBe(true)
    expect(result.commentId).toBe(String(AUTHORIZATION_ID))
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toContain('merge-authorization-receipt-v1')
    expect(posts[0]?.body).not.toContain('merge-authorization-v1')
    expect(JSON.parse(posts[0]?.body ?? '{}')).toMatchObject({
      authorization_comment_id: String(AUTHORIZATION_ID),
      authorization_body_sha256: createHash('sha256').update(LIVE_PARTIAL_AUTHORIZATION_BODY, 'utf8').digest('hex'),
      issue_number: 395,
      pr: 396,
    })
  })

  it('treats an identical completed retry as NO_OP without posting another authorization or receipt', async () => {
    const { github, posts } = createRestGithub([
      rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
    ])
    const first = await recordFounderMergeAuthorization(recordingThroughAdapter(github))
    const second = await recordFounderMergeAuthorization(recordingThroughAdapter(github))
    expect(first.classification).toBe('SUCCESS')
    expect(second.classification).toBe('NO_OP_IDENTICAL_RETRY')
    expect(second.mutationPerformed).toBe(false)
    expect(second.commentId).toBe(String(AUTHORIZATION_ID))
    expect(second.receiptId).toBe(first.receiptId)
    expect(posts).toHaveLength(1)
  })

  it('rejects a comment whose issue_url belongs to another Issue', async () => {
    const { github } = createRestGithub([
      rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 333 }),
    ])
    await expect(recordFounderMergeAuthorization(recordingThroughAdapter(github))).rejects.toMatchObject({
      classification: 'STATE_CONFLICT',
      message: expect.stringMatching(/not positively bound to the target Issue|invalid identity or Issue binding/),
    })
  })

  it('cannot bind a missing Issue URL to the target Issue', async () => {
    const { github } = createRestGithub([{
      ...rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
      issue_url: undefined as unknown as string,
    }])
    await expect(recordFounderMergeAuthorization(recordingThroughAdapter(github))).rejects.toMatchObject({
      classification: 'STATE_CONFLICT',
    })
  })

  it('cannot bind a malformed Issue URL to the target Issue', async () => {
    const { github } = createRestGithub([
      rawRestComment({
        id: AUTHORIZATION_ID,
        body: LIVE_PARTIAL_AUTHORIZATION_BODY,
        issueUrlValue: 'not-a-github-issue-url',
      }),
    ])
    await expect(recordFounderMergeAuthorization(recordingThroughAdapter(github))).rejects.toMatchObject({
      classification: 'STATE_CONFLICT',
    })
  })

  it('keeps raw unnormalized REST comments fail-closed in the recording domain', async () => {
    await expect(recordFounderMergeAuthorization({
      context,
      readComments: async () => [
        rawRestComment({ id: AUTHORIZATION_ID, body: LIVE_PARTIAL_AUTHORIZATION_BODY, issueNumber: 395 }),
      ],
      postComment: async () => {
        throw new Error('should not POST')
      },
      readComment: async () => {
        throw new Error('should not read')
      },
      acquireLease: async () => 'lease',
      releaseLease: async () => null,
    })).rejects.toMatchObject({
      classification: 'STATE_CONFLICT',
      message: expect.stringMatching(/invalid identity or Issue binding/),
    })
  })

  it('wires merge recording through the existing adapter comment methods', () => {
    const source = readFileSync('scripts/mission-control/workflows/authorize-founder.mjs', 'utf8')
    const mergeBlock = source.split("if (scope === 'merge')")[1]?.split('} else {')[0] ?? ''
    expect(mergeBlock).toContain('github.getIssueComments(issueNumber)')
    expect(mergeBlock).toContain('github.postIssueComment(number, body)')
    expect(mergeBlock).toContain('github.getIssueComment(id)')
    expect(mergeBlock).not.toContain('--paginate')
    expect(mergeBlock).not.toContain('-X')
    expect(mergeBlock).not.toContain('issues/comments/')
  })

  it('leaves task-bootstrap adapter Issue identity mapping unchanged', async () => {
    const { github } = createRestGithub([
      rawRestComment({ id: 1, body: 'bootstrap comment', issueNumber: 380 }),
    ])
    await expect(github.getIssueComments(380)).resolves.toEqual([
      expect.objectContaining({ id: 1, issue_number: 380, issue_url: issueUrl(380) }),
    ])
  })
})
