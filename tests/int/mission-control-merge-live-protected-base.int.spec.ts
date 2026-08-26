import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- deterministic merge transport boundary */

async function execute(input: any) {
  const mergeTransport = await import('../../scripts/mission-control-merge.mjs')
  return mergeTransport.runFounderAuthorizedMerge(input)
}

const reviewedHead = 'c8a35d5ed0f78f2282d1d500cb79add7640a2b3d'
const historicalPrBase = '3c40c0bc9ec43225f6088b1f6cd4431868f7fef7'
const liveProtectedBase = 'e3972789f45a1fdf3b143926e854298f7a92f7ac'
const taskIssue = 367
const prNumber = 369
const reviewCommentId = '5338710000'
const authorizationCommentId = '5338711574'
const policySourceSha = '1111111111111111111111111111111111111111'
const mergeCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function successfulChecks() {
  return [
    { name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
    { name: 'starter-ci', conclusion: 'SUCCESS', status: 'COMPLETED' },
  ]
}

function createIncidentHarness(options: {
  pull?: Record<string, unknown>
  authorization?: Record<string, unknown>
} = {}) {
  const operations: string[] = []
  const issue = {
    number: taskIssue,
    state: 'OPEN',
    stateReason: null as string | null,
    managedState: {
      state: 'ELIGIBLE_FOR_FOUNDER_REVIEW',
      review_cycle: 1,
      full_review_count: 1,
      active_task_issue: `#${taskIssue}`,
      active_pr: `#${prNumber}`,
      current_head: reviewedHead,
      last_reviewed_head: reviewedHead,
      approved_base: 'main',
      guide_source_sha: policySourceSha,
      guide_version: '1.3.0',
      latest_review_verdict_comment_id: reviewCommentId,
    },
  }
  const pull = {
    number: prNumber,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefOid: reviewedHead,
    baseRefName: 'main',
    // This is the historical PR-creation snapshot, not the current protected base.
    baseRefOid: historicalPrBase,
    statusCheckRollup: successfulChecks(),
    closingIssuesReferences: [] as unknown[],
    title: 'Refs #367',
    body: 'Refs #367',
    commits: [] as unknown[],
    mergeCommit: null as { oid: string } | null,
    ...options.pull,
  }

  const founderAuthorization = {
    schema_version: 1,
    status: 'approved',
    authority: 'Founder',
    author_login: 'boat1994',
    immutable_comment_reference: true,
    comment_sha256: 'b'.repeat(64),
    non_superseded: true,
    superseded_by: null as string | null,
    repository: 'boat1994/bemoat-web-starter',
    bundle_kind: 'merge-completion',
    scope: 'merge',
    task_issue: taskIssue,
    pr: prNumber,
    exact_head: reviewedHead,
    reviewed_head: reviewedHead,
    base: 'main',
    policy_source_sha: policySourceSha,
    protected_base_sha: liveProtectedBase,
    policy_version: '1.3.0',
    review_verdict_comment_id: reviewCommentId,
    action: 'merge',
    comment_id: authorizationCommentId,
    ...options.authorization,
  }

  const deps = {
    readManagedIssue: async () => structuredClone(issue),
    readPullRequest: async () => structuredClone(pull),
    readProtectedRef: async (_repo: string, base: string) => {
      operations.push(`protected-ref:${base}`)
      return { ref: `refs/heads/${base}`, object: { sha: liveProtectedBase } }
    },
    readFounderAuthorization: async () => structuredClone(founderAuthorization),
    readTrustedFounderLogins: async () => ['boat1994'],
    readReviewVerdict: async (_repo: string, _issueNumber: number) => ({
      comment_id: reviewCommentId,
      verdict: 'ELIGIBLE FOR FOUNDER REVIEW',
      reviewed_head: reviewedHead,
      pr: prNumber,
      base: 'main',
      repository: _repo,
      issue: String(_issueNumber),
      non_superseded: true,
    }),
    markReadyForReview: async () => {
      operations.push('mark-ready')
    },
    mergePullRequest: async () => {
      operations.push(`merge:${reviewedHead}`)
      pull.state = 'MERGED'
      pull.mergeCommit = { oid: mergeCommit }
      return { mergeCommit: { oid: mergeCommit } }
    },
    verifyCommitOnProtectedBase: async () => true,
    postFinalResult: async () => {
      operations.push('result')
      return { id: '5338712000' }
    },
    closeIssueCompleted: async () => {
      operations.push('close')
      issue.state = 'CLOSED'
      issue.stateReason = 'COMPLETED'
    },
    writeTaskDone: async () => {
      operations.push('task-done')
      issue.managedState.state = 'DONE'
      return { state: 'DONE' }
    },
  }

  return { deps, operations }
}

describe('Issue #371 live protected-base merge authority binding', () => {
  it('accepts an exact-head reviewed PR when main advanced after review and PR.baseRefOid is historical', async () => {
    const harness = createIncidentHarness()

    await expect(execute({
      issueNumber: taskIssue,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId,
      deps: harness.deps,
    })).resolves.toMatchObject({
      outcome: 'DONE',
      issueNumber: taskIssue,
      prNumber,
      reviewedHead,
      mergeCommit,
    })

    expect(harness.operations).toEqual([
      'protected-ref:main',
      `merge:${reviewedHead}`,
      'result',
      'close',
      'task-done',
    ])
  })

  it.each([
    ['stale Founder protected-base authorization', { authorization: { protected_base_sha: historicalPrBase } }, /AUTHORIZATION_VALIDATION_FAILURE/],
    ['live PR head drift', { pull: { headRefOid: 'b'.repeat(40) } }, /STATE_CONFLICT/],
    ['live PR base-branch drift', { pull: { baseRefName: 'dev' } }, /STATE_CONFLICT/],
  ])('fails closed for %s before merge mutation', async (_label, options, expected) => {
    const harness = createIncidentHarness(options)

    await expect(execute({
      issueNumber: taskIssue,
      repo: 'boat1994/bemoat-web-starter',
      authorizationCommentId,
      deps: harness.deps,
    })).rejects.toThrow(expected)

    expect(harness.operations).toEqual(['protected-ref:main'])
  })
})
