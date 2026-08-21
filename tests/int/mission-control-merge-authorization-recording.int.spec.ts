import { test, expect } from 'vitest'
import { recordFounderMergeAuthorization } from '../../scripts/mission-control/domain/founder-merge-authorization-recording.ts'

test('SUCCESS on first authorized POST', async () => {
  const context = {
    repository: 'boat1994/bemoat-web-starter',
    issueNumber: 100,
    prNumber: 101,
    exactHead: '3'.repeat(40),
    base: 'dev',
    protectedBaseSha: '1'.repeat(40),
    policySource: 'docs/mission-control/mission-control-guide.md',
    policyVersion: '1.3.0',
    policySha: '2'.repeat(40),
    policySourceCommit: '1'.repeat(40),
    founderLogin: 'boat1994',
  }

  const state: { comments: Record<string, unknown>[] } = { comments: [] }

  const result = await recordFounderMergeAuthorization({
    context,
    readComments: async () => state.comments,
    postComment: async (issueNumber, body) => {
      const comment = { id: String(123 + state.comments.length), body, issue_number: issueNumber, user: { login: 'boat1994' }, created_at: '2021-01-01', updated_at: '2021-01-01' }
      state.comments.push(comment)
      return comment
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readComment: async (id) => state.comments.find(c => String(c.id) === String(id)) as any,
    acquireLease: async () => 'lease',
    releaseLease: async () => null,
  })

  expect(result.classification).toBe('SUCCESS')
  expect(result.mutationPerformed).toBe(true)
  expect(result.commentId).toBe('123')
  expect(result.receiptId).toBe('124')
  const managedAuthorization = JSON.parse(String(state.comments.find(comment => comment.id === result.commentId)?.body))
  expect(managedAuthorization).not.toHaveProperty('policy_source')
  expect(managedAuthorization).not.toHaveProperty('review_verdict_comment_id')
  
  // Test NO_OP on retry
  const retryResult = await recordFounderMergeAuthorization({
    context,
    readComments: async () => state.comments,
    postComment: async () => { throw new Error('should not mutate') },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readComment: async (id) => state.comments.find(c => String(c.id) === String(id)) as any,
    acquireLease: async () => 'lease',
    releaseLease: async () => null,
  })

  expect(retryResult.classification).toBe('NO_OP_IDENTICAL_RETRY')
  expect(retryResult.mutationPerformed).toBe(false)
  expect(retryResult.commentId).toBe('123')
  expect(retryResult.receiptId).toBe('124')
})

test('Fails if actor is not founder', async () => {
  const context = {
    repository: 'boat1994/bemoat-web-starter',
    issueNumber: 100,
    prNumber: 101,
    exactHead: '3'.repeat(40),
    base: 'dev',
    protectedBaseSha: '1'.repeat(40),
    policySource: 'docs/mission-control/mission-control-guide.md',
    policyVersion: '1.3.0',
    policySha: '2'.repeat(40),
    policySourceCommit: '1'.repeat(40),
    founderLogin: 'boat1994',
  }

  const promise = recordFounderMergeAuthorization({
    context,
    readComments: async () => [],
    postComment: async (issueNumber, body) => {
      return { id: '123', body, issue_number: issueNumber, user: { login: 'impostor' }, created_at: '2021-01-01', updated_at: '2021-01-01' }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readComment: async (id) => ({ id, body: '', issue_number: 100, user: { login: 'impostor' }, created_at: '2021-01-01', updated_at: '2021-01-01' } as any),
    acquireLease: async () => 'lease',
    releaseLease: async () => null,
  })

  await expect(promise).rejects.toThrow(/actor is not the trusted Founder/)
})

test('binds the selected immutable REVIEW_VERDICT comment into authorization and receipt', async () => {
  const context = {
    repository: 'boat1994/bemoat-web-starter',
    issueNumber: 100,
    prNumber: 101,
    exactHead: '3'.repeat(40),
    base: 'main',
    protectedBaseSha: '1'.repeat(40),
    policySource: 'docs/mission-control/mission-control-guide.md',
    policyVersion: '1.3.0',
    policySha: '2'.repeat(40),
    policySourceCommit: '1'.repeat(40),
    reviewVerdictCommentId: '777',
    founderLogin: 'boat1994',
  }

  const state: { comments: Record<string, unknown>[] } = { comments: [] }
  const result = await recordFounderMergeAuthorization({
    context,
    readComments: async () => state.comments,
    postComment: async (issueNumber, body) => {
      const comment = { id: String(777 + state.comments.length), body, issue_number: issueNumber, user: { login: 'boat1994' }, created_at: '2021-01-01', updated_at: '2021-01-01' }
      state.comments.push(comment)
      return comment
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readComment: async (id) => state.comments.find(c => String(c.id) === String(id)) as any,
    acquireLease: async () => 'lease',
    releaseLease: async () => null,
  })

  expect(JSON.parse(String(state.comments.find(comment => comment.id === result.commentId)?.body))).toMatchObject({
    review_verdict_comment_id: '777',
    policy_source: 'docs/mission-control/mission-control-guide.md',
    policy_source_sha: '2'.repeat(40),
    protected_base_sha: '1'.repeat(40),
  })
  expect(JSON.parse(String(state.comments.find(comment => comment.id === result.receiptId)?.body))).toMatchObject({
    review_verdict_comment_id: '777',
    policy_source: 'docs/mission-control/mission-control-guide.md',
    policy_source_sha: '2'.repeat(40),
    protected_base_sha: '1'.repeat(40),
  })
})
